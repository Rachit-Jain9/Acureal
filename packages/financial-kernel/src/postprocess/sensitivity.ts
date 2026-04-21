/**
 * Sensitivity-matrix post-processors — kernel-native port of the four
 * legacy variants in `backend/src/engines/financial.engine.js`:
 *
 *   - buildResidentialSensitivity (line 1557) — 9×9, full engine re-run
 *   - buildPlottedSensitivity     (line 1583) — 9×9, full engine re-run
 *   - buildIncomeSensitivity      (line 1609) — 5×5, lightweight quick-CF
 *   - buildHospSensitivity        (line 2479) — multi-grid, quick-IRR
 *
 * For residential and plotted we re-run `computeDeal` per cell so the
 * matrix reflects the kernel's canonical math (deeper than legacy's
 * shortcut of stubbing just `skipSensitivity`). For income and
 * hospitality the legacy lightweight projections are faithful enough —
 * porting them verbatim keeps the cells directionally honest without
 * re-running USALI per cell.
 *
 * Output shape matches legacy field-for-field: frontend
 * `SensitivityMatrix.jsx` reads `{ sellingRates, constructionCosts,
 * irrGrid, axis, variations }`. Hospitality additionally returns
 * `occAdr`, `hardCost`, `interestRate`, `capRate` sub-objects.
 */

import type { AssetClass, DealInputs } from '../types';
import { computeDeal } from '../registry';
import { hospOccRamp } from './usaliPnl';

const round4 = (n: number | null | undefined): number | null =>
  n != null && Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null;

const asNum = (v: unknown, fallback = 0): number => {
  if (v == null) return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const pctLabel = (v: number): string =>
  `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`;
const bpsLabel = (v: number): string =>
  `${v >= 0 ? '+' : ''}${v} bps`;

// ─── Quarterly IRR — legacy-compatible Newton + bisection ────────────
// Legacy `calculateIRR` treats the series as quarterly and returns
// annual percent. Kernel's public `irrAnnualPct` is monthly, so we keep
// a local helper here for the lightweight paths below.

function irrAnnualPctQuarterly(cashFlows: readonly number[]): number | null {
  if (!cashFlows || cashFlows.length < 2) return null;
  if (!cashFlows.some((c) => c < 0) || !cashFlows.some((c) => c > 0)) return null;

  const MAX_ITER = 1000;
  const PREC = 1e-10;
  const npv = (r: number) =>
    cashFlows.reduce((s, c, t) => s + c / Math.pow(1 + r, t), 0);
  const dnpv = (r: number) =>
    cashFlows.reduce(
      (s, c, t) => (t === 0 ? s : s - (t * c) / Math.pow(1 + r, t + 1)),
      0,
    );

  for (const r0 of [0.05, 0.02, 0.10, 0.15, 0.01, 0.20]) {
    let r = r0;
    for (let i = 0; i < MAX_ITER; i++) {
      const d = dnpv(r);
      if (Math.abs(d) < 1e-15) break;
      const rNew = r - npv(r) / d;
      if (!Number.isFinite(rNew) || rNew <= -1) break;
      if (Math.abs(rNew - r) < PREC) {
        if (Math.abs(npv(rNew)) < 0.001) {
          return Math.round((Math.pow(1 + rNew, 4) - 1) * 1e8) / 1e6;
        }
      }
      r = rNew;
    }
  }

  // Bisection fallback
  let lo = -0.9999;
  let hi = 10;
  for (let h = 0.5; h <= 50; h += 0.5) {
    if (npv(-0.9999) * npv(h) < 0) { hi = h; break; }
  }
  for (let i = 0; i < MAX_ITER * 2; i++) {
    const mid = (lo + hi) / 2;
    if (Math.abs(npv(mid)) < PREC || (hi - lo) / 2 < PREC) {
      return Math.round((Math.pow(1 + mid, 4) - 1) * 1e8) / 1e6;
    }
    if (npv(lo) * npv(mid) < 0) hi = mid;
    else lo = mid;
  }
  return null;
}

const safeCfs = (cfs: readonly number[]): number[] =>
  cfs.map((v) => (Number.isFinite(v) ? v : 0));

// ─── Shared output shapes ────────────────────────────────────────────

export interface SensitivityMatrix {
  readonly sellingRates: readonly number[];
  readonly constructionCosts: readonly number[];
  readonly irrGrid: readonly (readonly (number | null)[])[];
  readonly axis: readonly [string, string];
  readonly variations: readonly string[];
}

export interface HospSensitivity extends SensitivityMatrix {
  readonly occAdr: {
    readonly rows: readonly number[];
    readonly cols: readonly number[];
    readonly irrGrid: readonly (readonly (number | null)[])[];
    readonly rowLabel: string;
    readonly colLabel: string;
  };
  readonly hardCost: {
    readonly variations: readonly string[];
    readonly irr: readonly (number | null)[];
  };
  readonly interestRate: {
    readonly variations: readonly string[];
    readonly irr: readonly (number | null)[];
  };
  readonly capRate: {
    readonly variations: readonly string[];
    readonly irr: readonly (number | null)[];
  };
}

export interface BuildSensitivityArgs {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly assetClass: AssetClass;
}

// ─── Residential / villas / redevelopment — 9×9 full re-run ──────────

const RES_VARS = [-0.20, -0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15, 0.20] as const;
const RES_AXIS: readonly [string, string] = ['Constr. Cost/sqft', 'Selling Rate/sqft'];

function tryComputeIrr(raw: Readonly<Record<string, unknown>>, assetClass: AssetClass): number | null {
  try {
    const inputs: DealInputs = { assetClass, raw };
    const result = computeDeal(inputs);
    return result.kpis.irr;
  } catch {
    return null;
  }
}

export function buildResidentialSensitivity(args: BuildSensitivityArgs): SensitivityMatrix {
  const { raw, assetClass } = args;
  const baseSelling = asNum(raw.sellingRatePerSqft);
  const baseConstruction = asNum(raw.constructionCostPerSqft);
  if (baseSelling <= 0 || baseConstruction <= 0) {
    return emptyGrid(RES_AXIS);
  }

  const sellingRates = RES_VARS.map((v) => Math.round(baseSelling * (1 + v)));
  const constructionCosts = RES_VARS.map((v) => Math.round(baseConstruction * (1 + v)));
  const irrGrid = constructionCosts.map((cc) =>
    sellingRates.map((sr) =>
      tryComputeIrr(
        { ...raw, constructionCostPerSqft: cc, sellingRatePerSqft: sr, skipSensitivity: true },
        assetClass,
      ),
    ),
  );
  return {
    sellingRates,
    constructionCosts,
    irrGrid,
    axis: RES_AXIS,
    variations: RES_VARS.map(pctLabel),
  };
}

// ─── Plotted — 9×9 full re-run ───────────────────────────────────────

const PLOT_AXIS: readonly [string, string] = ['Dev. Cost/sqft', 'Selling Rate/sqft'];

export function buildPlottedSensitivity(args: BuildSensitivityArgs): SensitivityMatrix {
  const { raw, assetClass } = args;
  const baseSelling = asNum(raw.sellingRatePerSqft);
  const baseDev = asNum(raw.devCostPerSqft);
  if (baseSelling <= 0 || baseDev <= 0) {
    return emptyGrid(PLOT_AXIS);
  }

  const sellingRates = RES_VARS.map((v) => Math.round(baseSelling * (1 + v)));
  const devCosts = RES_VARS.map((v) => Math.round(baseDev * (1 + v)));
  const irrGrid = devCosts.map((dc) =>
    sellingRates.map((sr) =>
      tryComputeIrr(
        { ...raw, sellingRatePerSqft: sr, devCostPerSqft: dc, skipSensitivity: true },
        assetClass,
      ),
    ),
  );
  return {
    sellingRates,
    constructionCosts: devCosts,
    irrGrid,
    axis: PLOT_AXIS,
    variations: RES_VARS.map(pctLabel),
  };
}

// ─── Income (office / retail / industrial / mixed_use) — 5×5 lightweight

const INCOME_RENT_VARS = [-0.20, -0.10, 0, 0.10, 0.20] as const;
const INCOME_CAP_VARS = [5, 6, 7, 8, 9] as const;
const INCOME_AXIS: readonly [string, string] = ['Exit Cap Rate (%)', 'Base Rent/sqft/mo'];

interface IncomeQuickParams {
  readonly leasableAreaSqft: number;
  readonly baseRentMonth: number;
  readonly exitCapRate: number;
  readonly rentEscalationPct: number;
  readonly vacancyPct: number;
  readonly opexPct: number;
  readonly holdPeriodYears: number;
  readonly constructionMonths: number;
  readonly constructionCostSqft: number;
  readonly landCostCr: number;
  readonly stampDutyCr: number;
  readonly approvalCostCr: number;
  readonly tiCostCr: number;
  readonly lcCostCr: number;
}

function buildIncomeQuickCFs(p: IncomeQuickParams): number[] {
  const constQ = Math.ceil(p.constructionMonths / 3);
  const opQ = p.holdPeriodYears * 4;
  const totalQ = constQ + opQ;
  const cfs = new Array(totalQ + 1).fill(0);
  const totalCost =
    p.landCostCr
    + (p.leasableAreaSqft * p.constructionCostSqft) / 1e7
    + p.stampDutyCr
    + p.approvalCostCr
    + (p.tiCostCr || 0)
    + (p.lcCostCr || 0);
  cfs[0] = -totalCost;
  for (let q = 1; q <= opQ; q++) {
    const yearIdx = Math.ceil(q / 4);
    const occ = q <= 2 ? 0.70 : 1 - p.vacancyPct / 100;
    const esc = Math.pow(1 + p.rentEscalationPct / 100, yearIdx - 1);
    const qNOI =
      (p.leasableAreaSqft * p.baseRentMonth * 3 * esc * occ * (1 - p.opexPct / 100)) / 1e7;
    if (constQ + q <= totalQ) cfs[constQ + q] += qNOI;
  }
  const noiExit =
    ((p.leasableAreaSqft * p.baseRentMonth * 12 * (1 - p.vacancyPct / 100) * (1 - p.opexPct / 100))
      / 1e7)
    * Math.pow(1 + p.rentEscalationPct / 100, p.holdPeriodYears);
  cfs[totalQ] += noiExit / (p.exitCapRate / 100);
  return safeCfs(cfs);
}

export function buildIncomeSensitivity(args: BuildSensitivityArgs): SensitivityMatrix {
  const { raw } = args;
  const baseRentMonth = asNum(raw.baseRentPerSqftMonth ?? raw.baseRentMonth);
  const leasableAreaSqft = asNum(raw.leasableAreaSqft ?? raw.saleableAreaSqft);
  if (baseRentMonth <= 0 || leasableAreaSqft <= 0) {
    return emptyGrid(INCOME_AXIS);
  }

  const baseParams: IncomeQuickParams = {
    leasableAreaSqft,
    baseRentMonth,
    exitCapRate: asNum(raw.exitCapRate, 7.5),
    rentEscalationPct: asNum(raw.rentEscalationPct, 5),
    vacancyPct: asNum(raw.vacancyPct, 10),
    opexPct: asNum(raw.opexPct, 20),
    holdPeriodYears: asNum(raw.holdPeriodYears, 5),
    constructionMonths: asNum(raw.constructionMonths ?? raw.projectDurationMonths, 36),
    constructionCostSqft: asNum(raw.constructionCostPerSqft ?? raw.constructionCostSqft),
    landCostCr: asNum(raw.landCostCr),
    stampDutyCr: asNum(raw.stampDutyCr),
    approvalCostCr: asNum(raw.approvalCostCr),
    tiCostCr: asNum(raw.tiCostCr),
    lcCostCr: asNum(raw.lcCostCr),
  };

  const rents = INCOME_RENT_VARS.map((v) => Math.round(baseRentMonth * (1 + v) * 100) / 100);
  const capRates = [...INCOME_CAP_VARS];
  const irrGrid = capRates.map((cap) =>
    rents.map((rent) => {
      try {
        return irrAnnualPctQuarterly(
          buildIncomeQuickCFs({ ...baseParams, baseRentMonth: rent, exitCapRate: cap }),
        );
      } catch {
        return null;
      }
    }),
  );
  return {
    sellingRates: rents,
    constructionCosts: capRates,
    irrGrid,
    axis: INCOME_AXIS,
    variations: INCOME_CAP_VARS.map((c) => `${c}%`),
  };
}

// ─── Hospitality — multi-grid lightweight ────────────────────────────

const HOSP_DEFAULT_SQFT_PER_KEY = 550;
const HOSP_DAYS_PER_YEAR = 365;

interface HospQuickParams {
  readonly keys: number;
  readonly sqftPerKey: number;
  readonly adr: number;
  readonly stabilizedOccPct: number;
  readonly exitCapRate: number;
  readonly constLoanRatePct: number;
  readonly hardCostPerSqft: number;
  readonly landCostCr: number;
  readonly ffePerKey: number;
  readonly osePerKey: number;
  readonly preOpeningPerKey: number;
  readonly holdPeriodYears: number;
  readonly constQ: number;
  readonly noiMarginPct: number;
}

function hospQuickIRR(p: HospQuickParams): number | null {
  const bua = p.keys * (p.sqftPerKey || HOSP_DEFAULT_SQFT_PER_KEY);
  const hard = (bua * p.hardCostPerSqft) / 1e7;
  const gst = hard * 0.18;
  const ffe = (p.keys * p.ffePerKey) / 1e7;
  const ose = (p.keys * p.osePerKey) / 1e7;
  const pre = (p.keys * p.preOpeningPerKey) / 1e7;
  const soft = hard * 0.115;
  const appr = hard * 0.02;
  const base = hard + soft + appr + ffe + ose;
  const cont = base * 0.05;
  const idc =
    (p.landCostCr * 1.066 + base + cont) * 0.55 * 0.5 * (p.constLoanRatePct / 100) * (p.constQ / 4)
    + (p.landCostCr * 1.066 + base + cont) * 0.55 * 0.01;
  const total = p.landCostCr * 1.066 + base + gst + cont + pre + idc;

  const opQ = p.holdPeriodYears * 4;
  const totalQ = p.constQ + opQ;
  const cfs = new Array(totalQ + 1).fill(0);
  cfs[0] = -total;

  const ramp = hospOccRamp({
    initialOccPct: 45,
    stabilizedOccPct: p.stabilizedOccPct,
    stabilizationYear: 4,
    years: p.holdPeriodYears,
  });
  for (let y = 1; y <= p.holdPeriodYears; y++) {
    const occ = ramp[y - 1] / 100;
    const adrY = p.adr * Math.pow(1.05, y - 1);
    const roomsRev = (p.keys * adrY * occ * HOSP_DAYS_PER_YEAR) / 1e7;
    const totalRev = roomsRev * 1.39;
    const noi = totalRev * (p.noiMarginPct / 100);
    for (let q = 1; q <= 4; q++) {
      if (p.constQ + (y - 1) * 4 + q <= totalQ) cfs[p.constQ + (y - 1) * 4 + q] += noi / 4;
    }
  }
  const exitOcc = p.stabilizedOccPct / 100;
  const exitADR = p.adr * Math.pow(1.05, p.holdPeriodYears - 1);
  const exitRooms = ((p.keys * exitADR * exitOcc * HOSP_DAYS_PER_YEAR) / 1e7) * 1.39;
  const exitNoi = exitRooms * (p.noiMarginPct / 100);
  cfs[totalQ] += (exitNoi / (p.exitCapRate / 100)) * 0.96;

  try {
    return irrAnnualPctQuarterly(safeCfs(cfs));
  } catch {
    return null;
  }
}

const HOSP_AXIS: readonly [string, string] = ['Occupancy (%)', 'ADR (₹)'];

export function buildHospSensitivity(args: BuildSensitivityArgs): HospSensitivity {
  const { raw } = args;
  const keys = Math.round(asNum(raw.keys, 200));
  const sqftPerKey = asNum(raw.sqftPerKey, HOSP_DEFAULT_SQFT_PER_KEY);
  const adr = asNum(raw.adr, 8500);
  const stabilizedOccPct = asNum(raw.stabilizedOccPct, 70);
  const exitCapRate = asNum(raw.exitCapRate, 7.5);
  const constLoanRatePct = asNum(raw.constLoanRatePct, 10.5);

  const baseParams: HospQuickParams = {
    keys,
    sqftPerKey,
    adr,
    stabilizedOccPct,
    exitCapRate,
    constLoanRatePct,
    hardCostPerSqft: asNum(raw.hardCostPerSqft, 11000),
    landCostCr: asNum(raw.landCostCr),
    ffePerKey: asNum(raw.ffePerKey, 2500000),
    osePerKey: asNum(raw.osePerKey, 400000),
    preOpeningPerKey: asNum(raw.preOpeningPerKey, 350000),
    holdPeriodYears: Math.max(5, Math.min(15, asNum(raw.holdPeriodYears, 10))),
    constQ: 12,
    noiMarginPct: 28,
  };

  const occVars = [-15, -10, 0, 10, 15].map((d) => Math.max(40, Math.min(90, stabilizedOccPct + d)));
  const adrVars = [-0.20, -0.10, 0, 0.10, 0.20].map((v) => Math.round(adr * (1 + v)));
  const occAdrIrrGrid = occVars.map((o) =>
    adrVars.map((a) => hospQuickIRR({ ...baseParams, adr: a, stabilizedOccPct: o })),
  );

  const hcVars = [-15, -10, 0, 10, 15];
  const irVars = [-150, -75, 0, 75, 150];
  const crVars = [-100, -50, 0, 50, 100];
  const hardCostIrr = hcVars.map((pct) =>
    hospQuickIRR({ ...baseParams, hardCostPerSqft: baseParams.hardCostPerSqft * (1 + pct / 100) }),
  );
  const interestIrr = irVars.map((bps) =>
    hospQuickIRR({ ...baseParams, constLoanRatePct: baseParams.constLoanRatePct + bps / 100 }),
  );
  const capRateIrr = crVars.map((bps) =>
    hospQuickIRR({ ...baseParams, exitCapRate: baseParams.exitCapRate + bps / 100 }),
  );

  return {
    sellingRates: adrVars,
    constructionCosts: occVars,
    irrGrid: occAdrIrrGrid,
    axis: HOSP_AXIS,
    variations: occVars.map((o) => `${Math.round(o)}%`),
    occAdr: {
      rows: occVars,
      cols: adrVars,
      irrGrid: occAdrIrrGrid,
      rowLabel: 'Occupancy (%)',
      colLabel: 'ADR (₹)',
    },
    hardCost: {
      variations: hcVars.map((v) => `${v >= 0 ? '+' : ''}${v}%`),
      irr: hardCostIrr.map((n) => round4(n)),
    },
    interestRate: {
      variations: irVars.map(bpsLabel),
      irr: interestIrr.map((n) => round4(n)),
    },
    capRate: {
      variations: crVars.map(bpsLabel),
      irr: capRateIrr.map((n) => round4(n)),
    },
  };
}

// ─── Dispatcher ──────────────────────────────────────────────────────

function emptyGrid(axis: readonly [string, string]): SensitivityMatrix {
  return {
    sellingRates: [],
    constructionCosts: [],
    irrGrid: [],
    axis,
    variations: [],
  };
}

/**
 * Pick the right sensitivity variant for the given asset class.
 * Returns `null` for asset classes where sensitivity is not emitted
 * (land_parcel) — caller treats that as "no matrix".
 */
export function buildSensitivityMatrix(
  args: BuildSensitivityArgs,
): SensitivityMatrix | HospSensitivity | null {
  switch (args.assetClass) {
    case 'residential_apartments':
    case 'villas':
    case 'redevelopment':
    case 'mixed_use':
      // Mixed-use routes through the residential model in the kernel
      // (see `assets/mixed_use.ts`), so the sensitivity dispatcher
      // follows the same convention.
      return buildResidentialSensitivity(args);
    case 'plotted_development':
      return buildPlottedSensitivity(args);
    case 'commercial_office':
    case 'retail':
    case 'industrial_warehousing':
      return buildIncomeSensitivity(args);
    case 'hospitality':
      return buildHospSensitivity(args);
    case 'land_parcel':
      return null;
    default: {
      const _exhaustive: never = args.assetClass;
      throw new Error(`buildSensitivityMatrix: unknown asset class ${String(_exhaustive)}`);
    }
  }
}

