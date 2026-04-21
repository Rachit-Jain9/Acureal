/**
 * Capital-stack post-processor.
 *
 * Ports the `computed.capitalStack` synthesis out of the legacy JS
 * engine (`backend/src/engines/financial.engine.js`) into the kernel.
 * The output shape is **not** a single polymorphic object — the legacy
 * engine emits three structurally different bundles depending on asset
 * class:
 *
 *   1. Construction-loan       (residential_apartments, plotted_development)
 *      → bullet repayment at exit; keys:
 *        totalCostCr, debtCr, equityCr, debtPct, equityPct,
 *        debtInterestCr, debtLTV, debtRatePct, debtTenorYears
 *      → emits `null` when debtLTV === 0.
 *
 *   2. Income-amortizing       (commercial_office, retail, industrial_warehousing)
 *      → amortizing loan against stabilized NOI; keys:
 *        totalCostCr, debtCr, equityCr, debtPct, equityPct,
 *        interestRatePct, amortizationYears, dscr, debtSchedule
 *      → emits `null` when debtCoverage === 0.
 *
 *   3. Hospitality-full        (hospitality)
 *      → construction-to-permanent + European 4-tier waterfall; keys:
 *        totalCostCr, debtCr, equityCr, debtPct, equityPct,
 *        interestRatePct, amortizationYears, dscr, minDSCR,
 *        debtYieldPct, debtSchedule, construction, permanent, waterfall
 *      → never null — the refinance path always produces a stack.
 *
 * The builders below mirror the legacy output key-for-key (including the
 * null-semantics), so downstream consumers (Frontend `DebtSchedulePanel`,
 * `HospitalityProformaSection`, backend `financial.service.js` column
 * binding, `dealExport.service.js`) receive the exact shape they were
 * coded against. Any deviation here causes silent UI/export regressions
 * — see `docs/LEGACY_SHAPE_AUDIT.md` for the full consumer matrix.
 *
 * Numbers are rounded identically to legacy: `round4` (4dp) for money
 * and `round2` (2dp) for percents / multiples. Math runs in IEEE-754
 * because the inputs have already been finalized by the kernel and
 * Decimal → number conversion happened at the serialization boundary;
 * re-promoting to Decimal here would only introduce drift vs. legacy.
 */

// ── Rounding helpers — byte-compatible with financial.engine.js:293-294 ─────

const round4 = (n: number | null | undefined): number | null =>
  n != null && Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null;

const round2 = (n: number | null | undefined): number | null =>
  n != null && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;

// ── Shape types ─────────────────────────────────────────────────────────────

/**
 * Construction-loan capital stack — bullet repayment model used for
 * for-sale residential and plotted-development deals. Debt is drawn on
 * an S-curve during construction and repaid at exit from sales receipts.
 */
export interface CapitalStackConstructionLoan {
  totalCostCr: number;
  debtCr: number;
  equityCr: number;
  debtPct: number;
  equityPct: number;
  debtInterestCr: number;
  debtLTV: number;
  debtRatePct: number;
  debtTenorYears: number | null;
}

/**
 * Income-amortizing capital stack — used for lease-up income assets
 * (office, retail, industrial). Debt is sized against stabilized NOI
 * via DSCR and amortizes over its tenor.
 */
export interface CapitalStackIncomeAmortizing {
  totalCostCr: number;
  debtCr: number;
  equityCr: number;
  debtPct: number;
  equityPct: number;
  interestRatePct: number;
  amortizationYears: number;
  dscr: number;
  debtSchedule: unknown;
}

/**
 * A single tier of a European back-end waterfall distribution.
 * `hurdlePct` is the cumulative LP IRR at which this tier activates;
 * `lpSharePct` / `gpSharePct` are the distribution splits within the
 * tier. `lpCr` / `gpCr` are the actual dollar allocations from the
 * modeled cash-flow stream.
 */
export interface CapitalStackWaterfallTier {
  name: string;
  hurdlePct: number;
  lpSharePct: number;
  gpSharePct: number;
  lpCr: number;
  gpCr: number;
}

/**
 * European 4-tier waterfall output — RoC → pref → promote → promote.
 * LP and GP dollar allocations plus equity multiples for the full hold.
 */
export interface CapitalStackWaterfall {
  lpPct: number;
  gpPct: number;
  totalEquityCr: number;
  lpCapitalCr: number;
  gpCapitalCr: number;
  totalDistributionsCr: number;
  tiers: [
    CapitalStackWaterfallTier,
    CapitalStackWaterfallTier,
    CapitalStackWaterfallTier,
    CapitalStackWaterfallTier,
  ];
  totalLPCr: number;
  totalGPCr: number;
  lpEquityMultiple: number | null;
  gpEquityMultiple: number | null;
}

/** Construction-phase sub-bundle (hospitality only). */
export interface CapitalStackConstructionPhase {
  principalCr: number;
  ltcPct: number;
  ratePct: number;
  feesPct: number;
  idcCr: number;
  termYears: number;
}

/** Permanent-phase sub-bundle (hospitality only — post-refi). */
export interface CapitalStackPermanentPhase {
  principalCr: number;
  ltvPct: number;
  ratePct: number;
  ioYears: number;
  amortYears: number;
  refiYear: number;
  sizingCapRate: number;
  stabilizedValueCr: number;
  quarterlyPaymentCr: number;
  annualDebtServiceCr: number;
  totalInterestCr: number;
  balloonRepaymentCr: number;
}

/**
 * Full hospitality capital stack — construction-to-permanent financing
 * plus LP/GP waterfall. Always non-null for hospitality deals.
 */
export interface CapitalStackHospitality {
  totalCostCr: number;
  debtCr: number;
  equityCr: number;
  debtPct: number;
  equityPct: number;
  interestRatePct: number;
  amortizationYears: number;
  dscr: number;
  minDSCR: number | null;
  debtYieldPct: number | null;
  debtSchedule: unknown;
  construction: CapitalStackConstructionPhase | null;
  permanent: CapitalStackPermanentPhase | null;
  waterfall: CapitalStackWaterfall;
}

/**
 * Discriminated union for consumers that accept any variant.
 * `null` represents the "no debt" case (variants 1 and 2 only).
 */
export type CapitalStack =
  | CapitalStackConstructionLoan
  | CapitalStackIncomeAmortizing
  | CapitalStackHospitality;

// ── Builder 1: Construction-loan (residential, plotted) ─────────────────────

export interface ConstructionLoanCapitalStackArgs {
  totalCostCr: number;
  debtDrawnCr: number;
  debtInterestCr: number;
  /** Decimal fraction (0..1), e.g. 0.65 for 65% LTV. */
  debtLTV: number;
  debtRatePct: number;
  debtTenorYears: number | null;
}

/**
 * Build a construction-loan capital stack, or return `null` when no
 * debt is used. Mirrors `financial.engine.js:918-928` (residential) and
 * `:1162-1172` (plotted) byte-for-byte in key set, rounding, and null
 * semantics.
 */
export function buildConstructionLoanCapitalStack(
  args: ConstructionLoanCapitalStackArgs,
): CapitalStackConstructionLoan | null {
  if (!(args.debtLTV > 0)) return null;

  const { totalCostCr, debtDrawnCr, debtInterestCr, debtLTV, debtRatePct, debtTenorYears } =
    args;

  return {
    totalCostCr: round4(totalCostCr) as number,
    debtCr: round4(debtDrawnCr) as number,
    equityCr: round4(totalCostCr - debtDrawnCr) as number,
    debtPct: round2(debtLTV * 100) as number,
    equityPct: round2((1 - debtLTV) * 100) as number,
    debtInterestCr: round4(debtInterestCr) as number,
    debtLTV,
    debtRatePct,
    debtTenorYears:
      debtTenorYears != null && Number(debtTenorYears) > 0 ? Number(debtTenorYears) : null,
  };
}

// ── Builder 2: Income-amortizing (office, retail, industrial) ───────────────

export interface IncomeAmortizingCapitalStackArgs {
  totalCostCr: number;
  /** Decimal fraction (0..1), e.g. 0.60 for 60% LTC. Legacy names this `debtCoverage`. */
  debtCoverage: number;
  interestRatePct: number;
  amortizationYears: number;
  dscr: number;
  debtSchedule: unknown;
}

/**
 * Build an income-amortizing capital stack, or return `null` when no
 * debt is used. Mirrors `financial.engine.js:1526-1536` exactly.
 *
 * `debtSchedule` is passed through opaquely — it is produced by the
 * kernel's financing module (or the legacy equivalent) and is carried
 * end-to-end for the frontend DebtSchedulePanel.
 */
export function buildIncomeAmortizingCapitalStack(
  args: IncomeAmortizingCapitalStackArgs,
): CapitalStackIncomeAmortizing | null {
  if (!(args.debtCoverage > 0)) return null;

  const { totalCostCr, debtCoverage, interestRatePct, amortizationYears, dscr, debtSchedule } =
    args;

  return {
    totalCostCr: round4(totalCostCr) as number,
    debtCr: round4(totalCostCr * debtCoverage) as number,
    equityCr: round4(totalCostCr * (1 - debtCoverage)) as number,
    debtPct: round2(debtCoverage * 100) as number,
    equityPct: round2((1 - debtCoverage) * 100) as number,
    interestRatePct,
    amortizationYears,
    dscr,
    debtSchedule,
  };
}

// ── Builder 3: Hospitality (construction → permanent + waterfall) ───────────

export interface HospitalityCapitalStackArgs {
  totalCostCr: number;
  finalConstDebtCr: number;
  equityCr: number;
  interestRatePct: number;
  amortizationYearsHosp: number;
  dscr: number;
  minDSCR: number | null;
  debtYieldPct: number | null;
  debtScheduleHosp: unknown;
  /** Construction-phase inputs. Null when no construction loan is sized. */
  construction: {
    finalConstDebtCr: number;
    /** Decimal fraction (0..1). Legacy names this `constLoanLTC`. */
    constLoanLTC: number;
    constLoanRatePct: number;
    constLoanFeesPct: number;
    idcCr: number;
    refiYear: number;
  } | null;
  /** Permanent-phase inputs. Null when the refi tranche is zero. */
  permanent: {
    refiPrincipalCr: number;
    /** Decimal fraction (0..1). */
    refiLTV: number;
    refiInterestRate: number;
    refiIOYears: number;
    refiAmortYears: number;
    refiYear: number;
    refiCapRate: number;
    stabilizedValueForRefi: number;
    refiQuarterlyPayment: number;
    refiTotalInterestCr: number;
    refiBalloonRepaymentCr: number;
  } | null;
  waterfall: CapitalStackWaterfall;
}

/**
 * Build the full hospitality capital stack. Always non-null — even for
 * all-equity hospitality deals we return the zero-debt variant with
 * `debtPct: 0 / equityPct: 100`, so the frontend's hospitality proforma
 * has a stable shape to render. Mirrors `financial.engine.js:2369-2402`.
 */
export function buildHospitalityCapitalStack(
  args: HospitalityCapitalStackArgs,
): CapitalStackHospitality {
  const {
    totalCostCr,
    finalConstDebtCr,
    equityCr,
    interestRatePct,
    amortizationYearsHosp,
    dscr,
    minDSCR,
    debtYieldPct,
    debtScheduleHosp,
    construction,
    permanent,
    waterfall,
  } = args;

  const debtPct =
    totalCostCr > 0 ? (round2((finalConstDebtCr / totalCostCr) * 100) as number) : 0;
  const equityPct =
    totalCostCr > 0 ? (round2((equityCr / totalCostCr) * 100) as number) : 100;

  return {
    totalCostCr: round4(totalCostCr) as number,
    debtCr: round4(finalConstDebtCr) as number,
    equityCr: round4(equityCr) as number,
    debtPct,
    equityPct,
    interestRatePct,
    amortizationYears: amortizationYearsHosp,
    dscr,
    minDSCR,
    debtYieldPct,
    debtSchedule: debtScheduleHosp,
    construction: construction
      ? {
          principalCr: round4(construction.finalConstDebtCr) as number,
          ltcPct: round2(construction.constLoanLTC * 100) as number,
          ratePct: construction.constLoanRatePct,
          feesPct: construction.constLoanFeesPct,
          idcCr: round4(construction.idcCr) as number,
          termYears: construction.refiYear,
        }
      : null,
    permanent: permanent
      ? {
          principalCr: round4(permanent.refiPrincipalCr) as number,
          ltvPct: round2(permanent.refiLTV * 100) as number,
          ratePct: permanent.refiInterestRate,
          ioYears: permanent.refiIOYears,
          amortYears: permanent.refiAmortYears,
          refiYear: permanent.refiYear,
          sizingCapRate: permanent.refiCapRate,
          stabilizedValueCr: round4(permanent.stabilizedValueForRefi) as number,
          quarterlyPaymentCr: round4(permanent.refiQuarterlyPayment) as number,
          annualDebtServiceCr: round4(permanent.refiQuarterlyPayment * 4) as number,
          totalInterestCr: round4(permanent.refiTotalInterestCr) as number,
          balloonRepaymentCr: round4(permanent.refiBalloonRepaymentCr) as number,
        }
      : null,
    waterfall,
  };
}

// ── Builder 4: European 4-tier waterfall ────────────────────────────────────

export interface BuildWaterfallArgs {
  equityCr: number;
  /**
   * Quarterly levered cash flows keyed by quarter index. Index 0..constQ
   * are construction-phase outflows; index constQ+1..constQ+4*holdYears
   * are operating-phase distributions.
   */
  cashFlows: ReadonlyArray<number>;
  holdPeriodYears: number;
  constQ: number;
  /** Decimal fractions (0..1), summing to 1.0 in the base case. */
  lpPct: number;
  gpPct: number;
  /** IRR hurdles in percent (e.g. 10 means 10%). */
  tier2Hurdle: number;
  tier3Hurdle: number;
  tier4Hurdle: number;
  /** Promote splits in percent — GP's share above the hurdle. */
  tier2PromotePct: number;
  tier3PromotePct: number;
  tier4PromotePct: number;
}

/**
 * Build a European back-end 4-tier waterfall:
 *   Tier 1 — pro rata Return of Capital
 *   Tier 2 — LP pref to `tier2Hurdle`, promote above
 *   Tier 3 — LP pref to `tier3Hurdle`, larger promote above
 *   Tier 4 — all residual above `tier3Hurdle` with the final promote split
 *
 * Mirrors `financial.engine.js:2517-2585` byte-for-byte in math and
 * rounding. The quirky `tier2Need / Math.max(0.01, 1 - tier2PromotePct/100)`
 * denominator is preserved — it's a guard against divide-by-zero when
 * the promote share is 100%, and changing it would diverge from legacy.
 */
export function buildHospitalityWaterfall(args: BuildWaterfallArgs): CapitalStackWaterfall {
  const {
    equityCr,
    cashFlows,
    holdPeriodYears,
    constQ,
    lpPct,
    gpPct,
    tier2Hurdle,
    tier3Hurdle,
    tier4Hurdle,
    tier2PromotePct,
    tier3PromotePct,
    tier4PromotePct,
  } = args;

  const annualLevered = new Array<number>(holdPeriodYears + 1).fill(0);
  let initialOutflow = 0;
  for (let q = 0; q <= constQ; q++) initialOutflow += cashFlows[q] ?? 0;
  annualLevered[0] = initialOutflow;
  for (let y = 1; y <= holdPeriodYears; y++) {
    for (let q = 1; q <= 4; q++) {
      annualLevered[y] += cashFlows[constQ + (y - 1) * 4 + q] ?? 0;
    }
  }

  const lpCapital = equityCr * lpPct;
  const gpCapital = equityCr * gpPct;
  const totalDistributions = annualLevered.reduce(
    (s, v, i) => (i === 0 ? s : s + Math.max(0, v)),
    0,
  );

  // Tier 1 — pro rata return of capital
  const t1 = Math.min(totalDistributions, equityCr);
  const t1LP = t1 * lpPct;
  const t1GP = t1 * gpPct;
  let remaining = Math.max(0, totalDistributions - t1);

  const hurdleGross = (rate: number): number =>
    lpCapital * (Math.pow(1 + rate / 100, holdPeriodYears) - 1);

  // Tier 2 — LP preferred return up to tier2 IRR, then promote kicks in
  const tier2Need = hurdleGross(tier2Hurdle) - hurdleGross(0);
  const tier2Pool = Math.min(remaining, tier2Need / Math.max(0.01, 1 - tier2PromotePct / 100));
  const t2LP = tier2Pool * (1 - tier2PromotePct / 100);
  const t2GP = tier2Pool * (tier2PromotePct / 100);
  remaining -= tier2Pool;

  // Tier 3
  const tier3Need = hurdleGross(tier3Hurdle) - hurdleGross(tier2Hurdle);
  const tier3Pool = Math.max(
    0,
    Math.min(remaining, tier3Need / Math.max(0.01, 1 - tier3PromotePct / 100)),
  );
  const t3LP = tier3Pool * (1 - tier3PromotePct / 100);
  const t3GP = tier3Pool * (tier3PromotePct / 100);
  remaining -= tier3Pool;

  // Tier 4 — residual above tier3 hurdle
  const tier4Pool = Math.max(0, remaining);
  const t4LP = tier4Pool * (1 - tier4PromotePct / 100);
  const t4GP = tier4Pool * (tier4PromotePct / 100);

  const totalLP = t1LP + t2LP + t3LP + t4LP;
  const totalGP = t1GP + t2GP + t3GP + t4GP;

  return {
    lpPct: round2(lpPct * 100) as number,
    gpPct: round2(gpPct * 100) as number,
    totalEquityCr: round4(equityCr) as number,
    lpCapitalCr: round4(lpCapital) as number,
    gpCapitalCr: round4(gpCapital) as number,
    totalDistributionsCr: round4(totalDistributions) as number,
    tiers: [
      {
        name: 'Tier 1 — Return of Capital',
        hurdlePct: 0,
        lpSharePct: round2(lpPct * 100) as number,
        gpSharePct: round2(gpPct * 100) as number,
        lpCr: round4(t1LP) as number,
        gpCr: round4(t1GP) as number,
      },
      {
        name: `Tier 2 — to ${tier2Hurdle}% IRR`,
        hurdlePct: tier2Hurdle,
        lpSharePct: round2((1 - tier2PromotePct / 100) * 100) as number,
        gpSharePct: round2(tier2PromotePct) as number,
        lpCr: round4(t2LP) as number,
        gpCr: round4(t2GP) as number,
      },
      {
        name: `Tier 3 — to ${tier3Hurdle}% IRR`,
        hurdlePct: tier3Hurdle,
        lpSharePct: round2((1 - tier3PromotePct / 100) * 100) as number,
        gpSharePct: round2(tier3PromotePct) as number,
        lpCr: round4(t3LP) as number,
        gpCr: round4(t3GP) as number,
      },
      {
        name: `Tier 4 — above ${tier3Hurdle}% IRR`,
        hurdlePct: tier4Hurdle,
        lpSharePct: round2((1 - tier4PromotePct / 100) * 100) as number,
        gpSharePct: round2(tier4PromotePct) as number,
        lpCr: round4(t4LP) as number,
        gpCr: round4(t4GP) as number,
      },
    ],
    totalLPCr: round4(totalLP) as number,
    totalGPCr: round4(totalGP) as number,
    lpEquityMultiple: lpCapital > 0 ? (round4(totalLP / lpCapital) as number) : null,
    gpEquityMultiple: gpCapital > 0 ? (round4(totalGP / gpCapital) as number) : null,
  };
}
