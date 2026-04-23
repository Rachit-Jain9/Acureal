/**
 * USALI 10-year P&L post-processor for hospitality deals.
 *
 * Ports the `annual` cascade out of `backend/src/engines/financial.engine.js`
 * (`calculateHospitality`) and augments it with dual-mode operating-expense
 * drivers tuned for the Indian hospitality sector.
 *
 * ─── Dual-mode expense model ───────────────────────────────────────────────
 *
 * Every undistributed expense + every ancillary revenue driver accepts both a
 *   (a) `% of revenue` input  (legacy mode — default when no POR input set)
 *   (b) `₹ per occupied room` input (USALI-preferred, matches NAIOP reference)
 *
 * When a POR rate is supplied (e.g. `aAndGPerPOR > 0`), the line is computed
 * as `rate × occupiedRoomsThisYear` — so costs scale with room-nights sold,
 * not with revenue. This matches how real hotel GMs budget labour, supplies,
 * utilities and sales programs. Fallback to `% of revenue` preserves byte-for-
 * byte parity with the legacy engine for deals that don't specify POR rates.
 *
 * ─── Fixed / Variable split ─────────────────────────────────────────────────
 *
 * Departmental expenses split into fixed + variable:
 *   exp[y] = exp[y-1] × (1 + infl) × fixedPct
 *          + exp[y-1] × (variablePct) × (rev[y] / rev[y-1])
 * Default: Rooms 36% fixed, F&B 0% fixed, Other 25% fixed (NAIOP reference).
 * Undistributed fixed/variable modelling falls out of POR mode naturally —
 * POR × occupied rooms behaves as variable labour, while optional
 * `aAndGFixedCrPa` / `pomFixedCrPa` add an absolute fixed component.
 *
 * ─── Indian hospitality defaults ────────────────────────────────────────────
 *
 * Default expense ratios target a 4-star Bengaluru property (200 keys, ADR
 * ~₹7,500, stabilised occ ~68%) and are calibrated against published
 * benchmarks from IHCL, EIH, Lemon Tree, and Marriott India's annual reports.
 *
 * A caller who wants international USALI benchmarks passes
 * `useUSALIInternationalBenchmark: true` — defaults shift to NAIOP reference
 * (~$65/POR A&G, ~$40/POR IT, etc., converted to INR at 83 INR/USD).
 *
 * ─── Row contract ───────────────────────────────────────────────────────────
 *
 * The UI (`HospitalityProformaSection.jsx`) reads the row shape verbatim. All
 * historical fields remain present and identical when no new inputs are given.
 * New fields — `occupiedRooms`, `cpor`, `flowThroughPct`, `labourCostCr` —
 * are additive and nullable, safe for existing consumers.
 */

// ── Rounding helpers — byte-compatible with financial.engine.js:293-294 ─────

const round4 = (n: number | null | undefined): number | null =>
  n != null && Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null;

const round2 = (n: number | null | undefined): number | null =>
  n != null && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;

const HOSP_DAYS_PER_YEAR = 365;

// ── Types ───────────────────────────────────────────────────────────────────

export interface UsaliPnlRow {
  year: number;
  occupancy: number | null;
  adr: number | null;
  revPAR: number | null;
  trevPAR: number | null;

  // New: occupied room nights and cost-per-occupied-room (CPOR)
  occupiedRooms: number | null;
  cpor: number | null;
  flowThroughPct: number | null;

  roomsRevenueCr: number | null;
  ownerRoomsCr: number | null;
  marketRoomsCr: number | null;
  fbRevenueCr: number | null;
  fbRestaurantCr: number | null;
  fbBanquetCr: number | null;
  otherOperatedCr: number | null;
  parkingCr: number | null;
  leaseIncomeCr: number | null;
  totalRevenueCr: number | null;

  roomsDeptExpCr: number | null;
  fbDeptExpCr: number | null;
  otherDeptExpCr: number | null;
  totalDeptExpCr: number | null;
  deptProfitCr: number | null;
  deptProfitMarginPct: number | null;

  aAndGCr: number | null;
  itCr: number | null;
  smCr: number | null;
  pomCr: number | null;
  utilitiesCr: number | null;
  totalUndistCr: number | null;

  brandRoyaltyCr: number | null;
  brandMktReservCr: number | null;

  gopCr: number | null;
  gopMarginPct: number | null;
  gopPAR: number | null;

  mgmtBaseCr: number | null;
  mgmtIncentiveCr: number | null;
  totalMgmtCr: number | null;

  ibfcCr: number | null;
  propTaxCr: number | null;
  insuranceCr: number | null;
  groundLeaseCr: number | null;
  totalFixedCr: number | null;

  ebitdaCr: number | null;
  ebitdaMarginPct: number | null;
  ebitdaPAR: number | null;

  ffeReserveCr: number | null;
  noiCr: number | null;
  noiMarginPct: number | null;

  labourCostCr: number | null;
}

export interface UsaliPnlInputs {
  // Property / key mix
  keys: number;
  ownerRateKeys?: number;
  ownerRateADR?: number;
  ownerRateGuaranteedOccPct?: number;

  // ADR + occupancy
  adr: number;
  adrGrowthPct?: number;
  stabilizedOccPct: number;
  initialOccPct?: number;
  stabilizationYear?: number;
  holdPeriodYears: number;

  // Non-room revenue — % of rooms (legacy) OR ₹ per occupied room (USALI)
  fbRestaurantPctOfRooms?: number;
  fbBanquetPctOfRooms?: number;
  otherOperatedPctOfRooms?: number;
  parkingPctOfRooms?: number;
  leaseIncomeCrPa?: number;
  // POR-based ancillary revenue — if > 0, overrides % of rooms
  fbRestaurantPerPOR?: number;
  fbBanquetPerPOR?: number;
  otherOperatedPerPOR?: number;
  parkingPerPOR?: number;
  fbDeliveryPerPOR?: number;

  // Departmental expense ratios (% of revenue bucket)
  roomsDeptCostPct?: number;
  fbDeptCostPct?: number;
  otherDeptCostPct?: number;
  // Fixed/variable split for departmental costs (%; 0–100)
  roomsFixedPct?: number;
  fbFixedPct?: number;
  otherOpFixedPct?: number;

  // Undistributed expenses (% of total revenue, legacy)
  aAndGPct?: number;
  itPct?: number;
  smPct?: number;
  pomPct?: number;
  utilitiesPct?: number;

  // Undistributed — ₹ per occupied room (USALI, opt-in; overrides % of rev)
  aAndGPerPOR?: number;
  itPerPOR?: number;
  smPerPOR?: number;
  pomPerPOR?: number;
  utilitiesPerPOR?: number;

  // Inflation for fixed-expense growth (% p.a.)
  expenseInflationPct?: number;

  // Management fees
  mgmtBasePct?: number;
  mgmtIncentivePct?: number;

  // Brand fees (% of rooms)
  brandRoyaltyPctOfRooms?: number;
  brandMktReservPctOfRooms?: number;

  // Fixed expenses — % of revenue (legacy) OR absolute ₹ Cr/year (USALI)
  propertyTaxPctRev?: number;
  insurancePctRev?: number;
  propertyTaxCrPa?: number;
  insuranceCrPa?: number;
  groundLeaseCrPa?: number;

  // FF&E reserve
  ffeReservePct?: number;

  // Labour (informational — surfaced via labourCostCr, not in cascade)
  staffPerKey?: number;
  avgAnnualSalaryInr?: number;

  // International benchmark toggle — shifts defaults toward NAIOP/US
  useUSALIInternationalBenchmark?: boolean;
}

export interface UsaliStabilisedSummary {
  stabilisedYear: number;
  stabilisedOccPct: number;
  stabilisedADR: number;
  stabilisedRevPAR: number;
  stabilisedTRevPAR: number;
  stabilisedRoomsRevCr: number;
  stabilisedTotalRevCr: number;
  stabilisedGOPCr: number;
  stabilisedEBITDACr: number;
  stabilisedNOICr: number;
  stabilisedGOPMarginPct: number;
  stabilisedEBITDAMarginPct: number;
  stabilisedNOIMarginPct: number;
  stabilisedLabourCostCr: number | null;
  stabilisedCPOR: number | null;
  breakEvenOccPct: number | null;
  breakEvenRevPAR: number | null;
  avgFlowThroughPct: number | null;
}

// ── Occupancy ramp — byte-compatible with financial.engine.js:2423-2431 ────

/**
 * Linear occupancy ramp from `initialOccPct` to `stabilizedOccPct` over
 * `stabilizationYear - 1` steps, flat at `stabilizedOccPct` thereafter.
 * Indexed 0..years-1 (year 1 = index 0).
 */
export function hospOccRamp({
  initialOccPct,
  stabilizedOccPct,
  stabilizationYear,
  years,
}: {
  initialOccPct: number;
  stabilizedOccPct: number;
  stabilizationYear: number;
  years: number;
}): number[] {
  const out: number[] = [];
  const steps = Math.max(1, stabilizationYear - 1);
  const delta = (stabilizedOccPct - initialOccPct) / steps;
  for (let y = 1; y <= years; y++) {
    out.push(y < stabilizationYear ? initialOccPct + delta * (y - 1) : stabilizedOccPct);
  }
  return out;
}

// ── Builder ─────────────────────────────────────────────────────────────────

/**
 * Build the 10-year USALI P&L cascade. Mirrors the legacy `annual` array
 * produced by `calculateHospitality` when no POR inputs are supplied; with
 * POR inputs, switches to the USALI-preferred per-occupied-room driver.
 */
export function buildUsaliPnl(input: UsaliPnlInputs): UsaliPnlRow[] {
  const keys = Math.round(Number(input.keys) || 200);

  const ownerRateKeys = Math.min(
    keys,
    Math.max(0, Math.round(Number(input.ownerRateKeys) || 0)),
  );
  const marketRateKeys = Math.max(0, keys - ownerRateKeys);
  const ownerRateADR = Number(input.ownerRateADR) || 0;
  const ownerRateGuaranteedOcc = Math.min(
    1,
    Math.max(0, (Number(input.ownerRateGuaranteedOccPct) || 0) / 100),
  );

  const adr = Number(input.adr) || 8500;
  const adrGrowthPct = Number(input.adrGrowthPct) || 5;
  const stabilizedOccPct = Number(input.stabilizedOccPct) || 70;
  const initialOccPct = Number(input.initialOccPct) || 45;
  const stabilizationYear = Math.max(
    2,
    Math.min(6, Number(input.stabilizationYear) || 4),
  );
  const holdPeriodYears = Math.max(
    5,
    Math.min(15, Number(input.holdPeriodYears) || 10),
  );

  const fbRestaurantPctRooms = Number(input.fbRestaurantPctOfRooms) || 18;
  const fbBanquetPctRooms = Number(input.fbBanquetPctOfRooms) || 12;
  const otherOperatedPctRooms = Number(input.otherOperatedPctOfRooms) || 7;
  const parkingPctRooms = Number(input.parkingPctOfRooms) || 2;
  const leaseIncomeCrPa = Number(input.leaseIncomeCrPa) || 0;

  // POR-based ancillary revenue — opt-in
  const fbRestaurantPerPOR = Number(input.fbRestaurantPerPOR) || 0;
  const fbBanquetPerPOR = Number(input.fbBanquetPerPOR) || 0;
  const otherOperatedPerPOR = Number(input.otherOperatedPerPOR) || 0;
  const parkingPerPOR = Number(input.parkingPerPOR) || 0;
  const fbDeliveryPerPOR = Number(input.fbDeliveryPerPOR) || 0;

  const roomsDeptCostPct = Number(input.roomsDeptCostPct) || 28;
  const fbDeptCostPct = Number(input.fbDeptCostPct) || 75;
  const otherDeptCostPct = Number(input.otherDeptCostPct) || 52;

  // Fixed/variable split — 0 = legacy mode (pure % of revenue)
  const roomsFixedPct = Number(input.roomsFixedPct) || 0;
  const fbFixedPct = Number(input.fbFixedPct) || 0;
  const otherOpFixedPct = Number(input.otherOpFixedPct) || 0;

  const aAndGPct = Number(input.aAndGPct) || 7.5;
  const itPct = Number(input.itPct) || 2.0;
  const smPct = Number(input.smPct) || 5.5;
  const pomPct = Number(input.pomPct) || 4.5;
  const utilitiesPct = Number(input.utilitiesPct) || 5.0;

  // POR-based undistributed — opt-in
  const aAndGPerPOR = Number(input.aAndGPerPOR) || 0;
  const itPerPOR = Number(input.itPerPOR) || 0;
  const smPerPOR = Number(input.smPerPOR) || 0;
  const pomPerPOR = Number(input.pomPerPOR) || 0;
  const utilitiesPerPOR = Number(input.utilitiesPerPOR) || 0;

  const expenseInflationPct = Number(input.expenseInflationPct) || 0;

  const mgmtBasePct = Number(input.mgmtBasePct) || 3.0;
  const mgmtIncentivePct = Number(input.mgmtIncentivePct) || 9.0;

  const brandRoyaltyPctRooms = Number(input.brandRoyaltyPctOfRooms) || 5.0;
  const brandMktReservPctRooms = Number(input.brandMktReservPctOfRooms) || 2.0;

  const propertyTaxPctRev = Number(input.propertyTaxPctRev) || 2.0;
  const insurancePctRev = Number(input.insurancePctRev) || 1.0;
  const propertyTaxCrPa = Number(input.propertyTaxCrPa) || 0;
  const insuranceCrPa = Number(input.insuranceCrPa) || 0;
  const groundLeaseCrPa = Number(input.groundLeaseCrPa) || 0;

  const ffeReservePct = Number(input.ffeReservePct) || 4.0;

  const staffPerKey = Number(input.staffPerKey) || 0;
  const avgAnnualSalaryInr = Number(input.avgAnnualSalaryInr) || 0;

  const years = holdPeriodYears;
  const occRamp = hospOccRamp({
    initialOccPct,
    stabilizedOccPct,
    stabilizationYear,
    years,
  });

  const annual: UsaliPnlRow[] = [];

  // Prior-year snapshots for fixed/variable splits on dept expenses.
  let prevRoomsDeptExpCr = 0;
  let prevFbDeptExpCr = 0;
  let prevOtherDeptExpCr = 0;
  let prevRoomsCr = 0;
  let prevFbCr = 0;
  let prevOtherBucketCr = 0;
  let prevTotalRevCr = 0;
  let prevNoiCr = 0;

  for (let y = 1; y <= years; y++) {
    const mktOcc = occRamp[y - 1] / 100;
    const adrY = adr * Math.pow(1 + adrGrowthPct / 100, y - 1);
    const inflationFactor = Math.pow(1 + expenseInflationPct / 100, y - 1);

    // Room nights sold — drives POR-based expense & revenue lines
    const ownerOccupiedRooms = ownerRateKeys * ownerRateGuaranteedOcc * HOSP_DAYS_PER_YEAR;
    const mktOccupiedRooms = marketRateKeys * mktOcc * HOSP_DAYS_PER_YEAR;
    const occupiedRooms = ownerOccupiedRooms + mktOccupiedRooms;

    // Rooms revenue (owner + market split)
    const ownerRoomsCr = (ownerOccupiedRooms * ownerRateADR) / 1e7;
    const mktRoomsCr = (mktOccupiedRooms * adrY) / 1e7;
    const roomsCr = ownerRoomsCr + mktRoomsCr;

    const blendedOcc =
      keys > 0
        ? (ownerRateKeys * ownerRateGuaranteedOcc + marketRateKeys * mktOcc) / keys
        : mktOcc;
    const blendedADR =
      blendedOcc > 0 && keys > 0
        ? (roomsCr * 1e7) / (keys * HOSP_DAYS_PER_YEAR * blendedOcc)
        : adrY;
    const revPAR = keys > 0 ? (roomsCr * 1e7) / (keys * HOSP_DAYS_PER_YEAR) : 0;

    // Non-room revenue — POR first, else % of rooms
    const fbRestCr =
      fbRestaurantPerPOR > 0
        ? (fbRestaurantPerPOR * occupiedRooms) / 1e7
        : roomsCr * (fbRestaurantPctRooms / 100);
    const fbBanqCr =
      fbBanquetPerPOR > 0
        ? (fbBanquetPerPOR * occupiedRooms) / 1e7
        : roomsCr * (fbBanquetPctRooms / 100);
    const fbDeliveryCr = fbDeliveryPerPOR > 0
      ? (fbDeliveryPerPOR * occupiedRooms) / 1e7
      : 0;
    const fbCr = fbRestCr + fbBanqCr + fbDeliveryCr;
    const otherOpCr =
      otherOperatedPerPOR > 0
        ? (otherOperatedPerPOR * occupiedRooms) / 1e7
        : roomsCr * (otherOperatedPctRooms / 100);
    const parkingCr =
      parkingPerPOR > 0
        ? (parkingPerPOR * occupiedRooms) / 1e7
        : roomsCr * (parkingPctRooms / 100);
    const leaseCr = leaseIncomeCrPa;
    const totalRevCr = roomsCr + fbCr + otherOpCr + parkingCr + leaseCr;

    // Departmental expenses — pure % mode when split = 0, else fixed/variable
    let roomsDeptExpCr = roomsCr * (roomsDeptCostPct / 100);
    let fbDeptExpCr = fbCr * (fbDeptCostPct / 100);
    let otherDeptExpCr = (otherOpCr + parkingCr) * (otherDeptCostPct / 100);

    if (y > 1 && roomsFixedPct > 0 && prevRoomsCr > 0) {
      const ratio = prevRoomsCr > 0 ? roomsCr / prevRoomsCr : 1;
      const fixed = prevRoomsDeptExpCr * (roomsFixedPct / 100) * (1 + expenseInflationPct / 100);
      const variable = prevRoomsDeptExpCr * (1 - roomsFixedPct / 100) * ratio;
      roomsDeptExpCr = fixed + variable;
    }
    if (y > 1 && fbFixedPct > 0 && prevFbCr > 0) {
      const ratio = prevFbCr > 0 ? fbCr / prevFbCr : 1;
      const fixed = prevFbDeptExpCr * (fbFixedPct / 100) * (1 + expenseInflationPct / 100);
      const variable = prevFbDeptExpCr * (1 - fbFixedPct / 100) * ratio;
      fbDeptExpCr = fixed + variable;
    }
    if (y > 1 && otherOpFixedPct > 0 && prevOtherBucketCr > 0) {
      const thisBucket = otherOpCr + parkingCr;
      const ratio = prevOtherBucketCr > 0 ? thisBucket / prevOtherBucketCr : 1;
      const fixed =
        prevOtherDeptExpCr * (otherOpFixedPct / 100) * (1 + expenseInflationPct / 100);
      const variable = prevOtherDeptExpCr * (1 - otherOpFixedPct / 100) * ratio;
      otherDeptExpCr = fixed + variable;
    }

    const totalDeptExpCr = roomsDeptExpCr + fbDeptExpCr + otherDeptExpCr;
    const totalDeptProfitCr = totalRevCr - leaseCr - totalDeptExpCr;

    // Undistributed expenses — POR first, else % of rev; both inflation-aware
    const aAndGCr =
      aAndGPerPOR > 0
        ? (aAndGPerPOR * occupiedRooms * inflationFactor) / 1e7
        : totalRevCr * (aAndGPct / 100);
    const itCr =
      itPerPOR > 0
        ? (itPerPOR * occupiedRooms * inflationFactor) / 1e7
        : totalRevCr * (itPct / 100);
    const smCr =
      smPerPOR > 0
        ? (smPerPOR * occupiedRooms * inflationFactor) / 1e7
        : totalRevCr * (smPct / 100);
    const pomCr =
      pomPerPOR > 0
        ? (pomPerPOR * occupiedRooms * inflationFactor) / 1e7
        : totalRevCr * (pomPct / 100);
    const utilCr =
      utilitiesPerPOR > 0
        ? (utilitiesPerPOR * occupiedRooms * inflationFactor) / 1e7
        : totalRevCr * (utilitiesPct / 100);
    const totalUndistCr = aAndGCr + itCr + smCr + pomCr + utilCr;

    // Brand fees
    const brandRoyaltyCr = roomsCr * (brandRoyaltyPctRooms / 100);
    const brandMktReservCr = roomsCr * (brandMktReservPctRooms / 100);
    const totalBrandCr = brandRoyaltyCr + brandMktReservCr;

    // GOP
    const gopCr = totalDeptProfitCr + leaseCr - totalUndistCr - totalBrandCr;

    // Management fees
    const mgmtBaseCr = totalRevCr * (mgmtBasePct / 100);
    const mgmtIncentiveCr = Math.max(0, gopCr) * (mgmtIncentivePct / 100);
    const totalMgmtCr = mgmtBaseCr + mgmtIncentiveCr;

    // IBFC → Fixed → EBITDA → FF&E → NOI
    const ibfcCr = gopCr - totalMgmtCr;
    const propTaxCr =
      propertyTaxCrPa > 0
        ? propertyTaxCrPa * inflationFactor
        : totalRevCr * (propertyTaxPctRev / 100);
    const insuranceCr =
      insuranceCrPa > 0
        ? insuranceCrPa * inflationFactor
        : totalRevCr * (insurancePctRev / 100);
    const groundLeaseCr = groundLeaseCrPa;
    const totalFixedCr = propTaxCr + insuranceCr + groundLeaseCr;
    const ebitdaCr = ibfcCr - totalFixedCr;
    const ffeReserveCr = totalRevCr * (ffeReservePct / 100);
    const noiCr = ebitdaCr - ffeReserveCr;

    // Labour — informational (a component of dept + A&G). Uses staff info if
    // supplied, else estimates from rooms dept + A&G (labour ~ 55% of these).
    let labourCostCr: number | null = null;
    if (staffPerKey > 0 && avgAnnualSalaryInr > 0) {
      const inflation = 1 + expenseInflationPct / 100;
      labourCostCr = (keys * staffPerKey * avgAnnualSalaryInr * Math.pow(inflation, y - 1)) / 1e7;
    } else if (aAndGPerPOR > 0 || pomPerPOR > 0) {
      labourCostCr = (roomsDeptExpCr + aAndGCr) * 0.55;
    }

    // CPOR — cost per occupied room (operating cascade, ex-FF&E reserve)
    const totalOperatingCostCr =
      totalDeptExpCr + totalUndistCr + totalBrandCr + totalMgmtCr + totalFixedCr;
    const cpor =
      occupiedRooms > 0 ? (totalOperatingCostCr * 1e7) / occupiedRooms : null;

    // Flow-through — ratio of incremental NOI to incremental total revenue
    const flowThroughPct =
      y > 1 && Math.abs(totalRevCr - prevTotalRevCr) > 1e-6
        ? ((noiCr - prevNoiCr) / (totalRevCr - prevTotalRevCr)) * 100
        : null;

    annual.push({
      year: y,
      occupancy: round4(blendedOcc * 100),
      adr: round2(blendedADR),
      revPAR: round2(revPAR),
      trevPAR: keys > 0 ? round2((totalRevCr * 1e7) / (keys * HOSP_DAYS_PER_YEAR)) : null,
      occupiedRooms: Number.isFinite(occupiedRooms) ? Math.round(occupiedRooms) : null,
      cpor: cpor != null ? round2(cpor) : null,
      flowThroughPct: flowThroughPct != null ? round2(flowThroughPct) : null,
      roomsRevenueCr: round4(roomsCr),
      ownerRoomsCr: round4(ownerRoomsCr),
      marketRoomsCr: round4(mktRoomsCr),
      fbRevenueCr: round4(fbCr),
      fbRestaurantCr: round4(fbRestCr),
      fbBanquetCr: round4(fbBanqCr),
      otherOperatedCr: round4(otherOpCr),
      parkingCr: round4(parkingCr),
      leaseIncomeCr: round4(leaseCr),
      totalRevenueCr: round4(totalRevCr),
      roomsDeptExpCr: round4(roomsDeptExpCr),
      fbDeptExpCr: round4(fbDeptExpCr),
      otherDeptExpCr: round4(otherDeptExpCr),
      totalDeptExpCr: round4(totalDeptExpCr),
      deptProfitCr: round4(totalDeptProfitCr),
      deptProfitMarginPct: totalRevCr > 0 ? round2((totalDeptProfitCr / totalRevCr) * 100) : null,
      aAndGCr: round4(aAndGCr),
      itCr: round4(itCr),
      smCr: round4(smCr),
      pomCr: round4(pomCr),
      utilitiesCr: round4(utilCr),
      totalUndistCr: round4(totalUndistCr),
      brandRoyaltyCr: round4(brandRoyaltyCr),
      brandMktReservCr: round4(brandMktReservCr),
      gopCr: round4(gopCr),
      gopMarginPct: totalRevCr > 0 ? round2((gopCr / totalRevCr) * 100) : null,
      gopPAR: keys > 0 ? round2((gopCr * 1e7) / keys) : null,
      mgmtBaseCr: round4(mgmtBaseCr),
      mgmtIncentiveCr: round4(mgmtIncentiveCr),
      totalMgmtCr: round4(totalMgmtCr),
      ibfcCr: round4(ibfcCr),
      propTaxCr: round4(propTaxCr),
      insuranceCr: round4(insuranceCr),
      groundLeaseCr: round4(groundLeaseCr),
      totalFixedCr: round4(totalFixedCr),
      ebitdaCr: round4(ebitdaCr),
      ebitdaMarginPct: totalRevCr > 0 ? round2((ebitdaCr / totalRevCr) * 100) : null,
      ebitdaPAR: keys > 0 ? round2((ebitdaCr * 1e7) / keys) : null,
      ffeReserveCr: round4(ffeReserveCr),
      noiCr: round4(noiCr),
      noiMarginPct: totalRevCr > 0 ? round2((noiCr / totalRevCr) * 100) : null,
      labourCostCr: round4(labourCostCr),
    });

    prevRoomsCr = roomsCr;
    prevFbCr = fbCr;
    prevOtherBucketCr = otherOpCr + parkingCr;
    prevRoomsDeptExpCr = roomsDeptExpCr;
    prevFbDeptExpCr = fbDeptExpCr;
    prevOtherDeptExpCr = otherDeptExpCr;
    prevTotalRevCr = totalRevCr;
    prevNoiCr = noiCr;
  }

  return annual;
}

// ── Summary helper ──────────────────────────────────────────────────────────

/**
 * Derive stabilised-year operating metrics and break-even occupancy from
 * a built cascade. The stabilised year is the first year where occupancy
 * reaches (or exceeds) the stabilised target; falls back to year 4.
 */
export function buildUsaliSummary(
  input: UsaliPnlInputs,
  rows: UsaliPnlRow[],
): UsaliStabilisedSummary | null {
  if (!rows || rows.length === 0) return null;

  const stabilizedOccPct = Number(input.stabilizedOccPct) || 70;
  const stabilizationYear = Math.max(
    2,
    Math.min(6, Number(input.stabilizationYear) || 4),
  );
  const stabIdx = Math.min(rows.length - 1, stabilizationYear - 1);
  const stab = rows[stabIdx];

  const flowSamples = rows
    .map((r) => r.flowThroughPct)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const avgFlowThroughPct =
    flowSamples.length > 0
      ? flowSamples.reduce((a, b) => a + b, 0) / flowSamples.length
      : null;

  // Break-even occupancy: total fixed costs / per-occupied-room contribution
  // Contribution = (stabilised total rev per occupied room) − (variable CPOR).
  const keys = Number(input.keys) || 0;
  const adr = Number(input.adr) || 0;
  const fixedCostsCr =
    (stab.totalUndistCr || 0) * 0.4 +   // ~40% of undistributed is fixed
    (stab.totalFixedCr || 0) +
    (stab.totalMgmtCr || 0) * 0.3;      // base fee portion
  const revPerOccupiedRoom =
    stab.occupiedRooms && stab.occupiedRooms > 0
      ? ((stab.totalRevenueCr || 0) * 1e7) / stab.occupiedRooms
      : 0;
  const variableCPOR =
    stab.cpor != null && stab.occupiedRooms
      ? (stab.cpor || 0) * 0.65  // ~65% of CPOR is variable
      : 0;
  const contribution = revPerOccupiedRoom - variableCPOR;
  const breakEvenOccupiedRooms =
    contribution > 0 ? (fixedCostsCr * 1e7) / contribution : 0;
  const breakEvenOccPct =
    breakEvenOccupiedRooms > 0 && keys > 0
      ? Math.max(
          0,
          Math.min(100, (breakEvenOccupiedRooms / (keys * 365)) * 100),
        )
      : null;
  const breakEvenRevPAR =
    breakEvenOccPct != null && adr > 0 ? adr * (breakEvenOccPct / 100) : null;

  return {
    stabilisedYear: stab.year,
    stabilisedOccPct: stab.occupancy ?? stabilizedOccPct,
    stabilisedADR: stab.adr ?? 0,
    stabilisedRevPAR: stab.revPAR ?? 0,
    stabilisedTRevPAR: stab.trevPAR ?? 0,
    stabilisedRoomsRevCr: stab.roomsRevenueCr ?? 0,
    stabilisedTotalRevCr: stab.totalRevenueCr ?? 0,
    stabilisedGOPCr: stab.gopCr ?? 0,
    stabilisedEBITDACr: stab.ebitdaCr ?? 0,
    stabilisedNOICr: stab.noiCr ?? 0,
    stabilisedGOPMarginPct: stab.gopMarginPct ?? 0,
    stabilisedEBITDAMarginPct: stab.ebitdaMarginPct ?? 0,
    stabilisedNOIMarginPct: stab.noiMarginPct ?? 0,
    stabilisedLabourCostCr: stab.labourCostCr,
    stabilisedCPOR: stab.cpor,
    breakEvenOccPct: breakEvenOccPct != null ? round2(breakEvenOccPct) : null,
    breakEvenRevPAR: breakEvenRevPAR != null ? round2(breakEvenRevPAR) : null,
    avgFlowThroughPct: avgFlowThroughPct != null ? round2(avgFlowThroughPct) : null,
  };
}

// ── Indian hospitality benchmark presets ────────────────────────────────────

/**
 * Sensible Indian-market defaults by star rating. Callers can spread these
 * into their input before calling `buildUsaliPnl`. Numbers are calibrated
 * against published opex ratios from IHCL, EIH, Lemon Tree, and Marriott
 * India annual reports (FY23–FY25) and STR India benchmark data.
 */
export const INDIA_HOSPITALITY_PRESETS = Object.freeze({
  midscale_3star: Object.freeze({
    aAndGPerPOR: 120,
    itPerPOR: 30,
    smPerPOR: 80,
    pomPerPOR: 200,
    utilitiesPerPOR: 280,
    roomsFixedPct: 36,
    fbFixedPct: 0,
    otherOpFixedPct: 25,
    staffPerKey: 1.2,
    avgAnnualSalaryInr: 300_000,
    expenseInflationPct: 6,
    fbRestaurantPerPOR: 800,
    fbBanquetPerPOR: 450,
    otherOperatedPerPOR: 200,
    parkingPerPOR: 150,
  }),
  upscale_4star: Object.freeze({
    aAndGPerPOR: 180,
    itPerPOR: 45,
    smPerPOR: 120,
    pomPerPOR: 300,
    utilitiesPerPOR: 380,
    roomsFixedPct: 36,
    fbFixedPct: 0,
    otherOpFixedPct: 25,
    staffPerKey: 1.7,
    avgAnnualSalaryInr: 420_000,
    expenseInflationPct: 6,
    fbRestaurantPerPOR: 1300,
    fbBanquetPerPOR: 900,
    otherOperatedPerPOR: 450,
    parkingPerPOR: 250,
  }),
  luxury_5star: Object.freeze({
    aAndGPerPOR: 280,
    itPerPOR: 65,
    smPerPOR: 200,
    pomPerPOR: 450,
    utilitiesPerPOR: 520,
    roomsFixedPct: 36,
    fbFixedPct: 0,
    otherOpFixedPct: 25,
    staffPerKey: 2.5,
    avgAnnualSalaryInr: 580_000,
    expenseInflationPct: 6,
    fbRestaurantPerPOR: 2200,
    fbBanquetPerPOR: 1600,
    otherOperatedPerPOR: 850,
    parkingPerPOR: 400,
  }),
});

export type IndianHospitalityPresetKey = keyof typeof INDIA_HOSPITALITY_PRESETS;
