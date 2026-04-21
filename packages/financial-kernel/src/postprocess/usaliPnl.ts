/**
 * USALI 10-year P&L post-processor for hospitality deals.
 *
 * Ports the `annual` cascade out of `backend/src/engines/financial.engine.js`
 * (`calculateHospitality`, lines 1829-1946). Produces a year-indexed array of
 * 47-field rows that the UI's `HospitalityProformaSection` reads verbatim:
 * revenue breakdown, departmental profit, undistributed expenses, brand fees,
 * GOP, management fees, IBFC, fixed expenses, EBITDA, FF&E reserve, NOI — plus
 * per-key and per-revenue margin metrics (RevPAR, TRevPAR, GOP-PAR, EBITDA-PAR).
 *
 * Convention mirrors legacy:
 *   - Rooms revenue splits into owner-rate (contracted, fixed occ) and
 *     market-rate (ADR growth + occ ramp).
 *   - ADR grows at `adrGrowthPct` per year compounded; occupancy follows a
 *     linear ramp from `initialOccPct` to `stabilizedOccPct` over
 *     `stabilizationYear - 1` steps, flat thereafter.
 *   - Non-room revenue drivers are % of rooms revenue.
 *   - Departmental expenses are % of their respective revenue buckets.
 *   - Undistributed expenses + brand fees are % of total revenue.
 *   - Management fee = base % of total revenue + incentive % of max(0, GOP).
 *   - Fixed expenses (property tax, insurance, ground lease) are % of total
 *     revenue (except ground lease, which is an absolute Cr/year).
 *   - FF&E reserve is % of total revenue.
 *   - `round4` for money (Cr), `round2` for percents — legacy-identical.
 *
 * The UI reads (from `HospitalityProformaSection.jsx:182-230`):
 *   occupancy, adr, revPAR, trevPAR, roomsRevenueCr, fbRestaurantCr,
 *   fbBanquetCr, otherOperatedCr, parkingCr, leaseIncomeCr, totalRevenueCr,
 *   roomsDeptExpCr, fbDeptExpCr, otherDeptExpCr, deptProfitCr,
 *   aAndGCr, itCr, smCr, pomCr, utilitiesCr,
 *   brandRoyaltyCr, brandMktReservCr,
 *   gopCr, gopMarginPct,
 *   mgmtBaseCr, mgmtIncentiveCr, ibfcCr,
 *   propTaxCr, insuranceCr, groundLeaseCr,
 *   ebitdaCr, ebitdaMarginPct, ffeReserveCr, noiCr, noiMarginPct
 *
 * Also emitted for parity (not yet consumed by UI but persisted):
 *   ownerRoomsCr, marketRoomsCr, fbRevenueCr, totalDeptExpCr,
 *   deptProfitMarginPct, totalUndistCr, gopPAR, totalMgmtCr, totalFixedCr,
 *   ebitdaPAR.
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

  // Non-room revenue (% of rooms)
  fbRestaurantPctOfRooms?: number;
  fbBanquetPctOfRooms?: number;
  otherOperatedPctOfRooms?: number;
  parkingPctOfRooms?: number;
  leaseIncomeCrPa?: number;

  // Departmental expense ratios
  roomsDeptCostPct?: number;
  fbDeptCostPct?: number;
  otherDeptCostPct?: number;

  // Undistributed expenses (% of total revenue)
  aAndGPct?: number;
  itPct?: number;
  smPct?: number;
  pomPct?: number;
  utilitiesPct?: number;

  // Management fees
  mgmtBasePct?: number;
  mgmtIncentivePct?: number;

  // Brand fees (% of rooms)
  brandRoyaltyPctOfRooms?: number;
  brandMktReservPctOfRooms?: number;

  // Fixed expenses
  propertyTaxPctRev?: number;
  insurancePctRev?: number;
  groundLeaseCrPa?: number;

  // FF&E reserve
  ffeReservePct?: number;
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
 * produced by `calculateHospitality` at `financial.engine.js:1833-1946`.
 *
 * Caller supplies the same hospitality deal inputs legacy reads. Defaults
 * applied here match legacy's `|| fallback` semantics.
 */
export function buildUsaliPnl(input: UsaliPnlInputs): UsaliPnlRow[] {
  // Resolve with legacy-identical defaults.
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

  const roomsDeptCostPct = Number(input.roomsDeptCostPct) || 28;
  const fbDeptCostPct = Number(input.fbDeptCostPct) || 75;
  const otherDeptCostPct = Number(input.otherDeptCostPct) || 52;

  const aAndGPct = Number(input.aAndGPct) || 7.5;
  const itPct = Number(input.itPct) || 2.0;
  const smPct = Number(input.smPct) || 5.5;
  const pomPct = Number(input.pomPct) || 4.5;
  const utilitiesPct = Number(input.utilitiesPct) || 5.0;

  const mgmtBasePct = Number(input.mgmtBasePct) || 3.0;
  const mgmtIncentivePct = Number(input.mgmtIncentivePct) || 9.0;

  const brandRoyaltyPctRooms = Number(input.brandRoyaltyPctOfRooms) || 5.0;
  const brandMktReservPctRooms = Number(input.brandMktReservPctOfRooms) || 2.0;

  const propertyTaxPctRev = Number(input.propertyTaxPctRev) || 2.0;
  const insurancePctRev = Number(input.insurancePctRev) || 1.0;
  const groundLeaseCrPa = Number(input.groundLeaseCrPa) || 0;

  const ffeReservePct = Number(input.ffeReservePct) || 4.0;

  const years = holdPeriodYears;
  const occRamp = hospOccRamp({
    initialOccPct,
    stabilizedOccPct,
    stabilizationYear,
    years,
  });

  const annual: UsaliPnlRow[] = [];

  for (let y = 1; y <= years; y++) {
    const mktOcc = occRamp[y - 1] / 100;
    const adrY = adr * Math.pow(1 + adrGrowthPct / 100, y - 1);

    // Rooms revenue (owner + market split)
    const ownerRoomsCr =
      (ownerRateKeys * ownerRateADR * ownerRateGuaranteedOcc * HOSP_DAYS_PER_YEAR) / 1e7;
    const mktRoomsCr = (marketRateKeys * adrY * mktOcc * HOSP_DAYS_PER_YEAR) / 1e7;
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

    // Non-room revenue
    const fbRestCr = roomsCr * (fbRestaurantPctRooms / 100);
    const fbBanqCr = roomsCr * (fbBanquetPctRooms / 100);
    const fbCr = fbRestCr + fbBanqCr;
    const otherOpCr = roomsCr * (otherOperatedPctRooms / 100);
    const parkingCr = roomsCr * (parkingPctRooms / 100);
    const leaseCr = leaseIncomeCrPa;
    const totalRevCr = roomsCr + fbCr + otherOpCr + parkingCr + leaseCr;

    // Departmental expenses
    const roomsDeptExpCr = roomsCr * (roomsDeptCostPct / 100);
    const fbDeptExpCr = fbCr * (fbDeptCostPct / 100);
    const otherDeptExpCr = (otherOpCr + parkingCr) * (otherDeptCostPct / 100);
    const totalDeptExpCr = roomsDeptExpCr + fbDeptExpCr + otherDeptExpCr;
    const totalDeptProfitCr = totalRevCr - leaseCr - totalDeptExpCr;

    // Undistributed expenses
    const aAndGCr = totalRevCr * (aAndGPct / 100);
    const itCr = totalRevCr * (itPct / 100);
    const smCr = totalRevCr * (smPct / 100);
    const pomCr = totalRevCr * (pomPct / 100);
    const utilCr = totalRevCr * (utilitiesPct / 100);
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
    const propTaxCr = totalRevCr * (propertyTaxPctRev / 100);
    const insuranceCr = totalRevCr * (insurancePctRev / 100);
    const groundLeaseCr = groundLeaseCrPa;
    const totalFixedCr = propTaxCr + insuranceCr + groundLeaseCr;
    const ebitdaCr = ibfcCr - totalFixedCr;
    const ffeReserveCr = totalRevCr * (ffeReservePct / 100);
    const noiCr = ebitdaCr - ffeReserveCr;

    annual.push({
      year: y,
      occupancy: round4(blendedOcc * 100),
      adr: round2(blendedADR),
      revPAR: round2(revPAR),
      trevPAR: keys > 0 ? round2((totalRevCr * 1e7) / (keys * HOSP_DAYS_PER_YEAR)) : null,
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
    });
  }

  return annual;
}
