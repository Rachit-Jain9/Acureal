import { useQuery } from '@tanstack/react-query';
import { dealsAPI } from '../services/api';

/**
 * Live market-benchmark bands fetch (PR-NX52 — 2026-05-19).
 *
 * Returns the SAME thresholds the XLSX-export market-benchmark validators
 * (PR-NX28 + PR-NX33) use, but at INPUT TIME so the FinancialsPage can
 * show inline warnings as the operator types — not 5 hours later when
 * they download the workbook.
 *
 * Returned data shape:
 *   {
 *     bands: { p25, p50, p75, p95 } | null,   // null when < 3 verified comps
 *     count: int,
 *     verifiedCount: int,
 *     thresholds: {
 *       rbiDscrFloor: 1.20,
 *       yocVsExitCapMinSpreadBps: 50,
 *       yocVsExitCapHealthyBps: 200,
 *       compCoverageMinForBands: 5
 *     },
 *     location: { lat, lng, radius_km, project_type } | null,
 *     reason: string | undefined,             // when bands missing
 *   }
 *
 * Bands change only when comps are added/verified — 5-min stale time
 * is plenty. No-retry on 403/404.
 */
export function useBenchmarkBands(dealId) {
  return useQuery({
    queryKey: ['benchmark-bands', dealId],
    queryFn: () => dealsAPI.benchmarkBands(dealId).then((r) => r.data?.data),
    enabled: !!dealId,
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, err) => {
      const status = err?.response?.status;
      if (status === 403 || status === 404) return false;
      return failureCount < 2;
    },
  });
}

/**
 * Pure helper that converts the live bands + a user's input value into
 * a warning object (or null when input is fine).
 *
 * Mirrors the XLSX-export validators' rules so the live warning is the
 * EXACT same rule the operator will see at export time. Single source
 * of truth lives on backend (marketBenchmarkValidator + getBenchmarkBands);
 * the frontend re-applies them here for the live UX.
 *
 * Returns:
 *   { severity: 'critical'|'warn', label: string, detail: string } | null
 */
export function computeSellRateWarning(sellRate, bands) {
  if (sellRate == null || sellRate <= 0) return null;
  if (!bands || !Number.isFinite(bands.p95) || !Number.isFinite(bands.p25)) return null;
  if (sellRate > bands.p95) {
    return {
      severity: 'warn',
      label: 'Above 95th percentile of nearby comps',
      detail: `Sell rate ₹${Number(sellRate).toLocaleString('en-IN')}/sqft exceeds p95 ₹${Number(bands.p95).toLocaleString('en-IN')}/sqft. Justify premium against a comparable luxury / branded / location basis, or treat this as a sensitivity scenario.`,
    };
  }
  if (sellRate < bands.p25) {
    return {
      severity: 'warn',
      label: 'Below 25th percentile of nearby comps',
      detail: `Sell rate ₹${Number(sellRate).toLocaleString('en-IN')}/sqft is below p25 ₹${Number(bands.p25).toLocaleString('en-IN')}/sqft. Under-pricing may inflate gross margin; verify against quality / phasing / micro-market basis.`,
    };
  }
  return null;
}

/**
 * DSCR floor warning helper. Computes DSCR via standard amortization
 * from { noiCr, totalCostCr, debtLTV, debtRatePct, loanTermYears } and
 * compares against the RBI floor of 1.20×.
 *
 * Mirrors validateDscrFloor in marketBenchmarkValidator (PR-NX33).
 */
export function computeDscrWarning({ noiCr, totalCostCr, debtLTV, debtRatePct, loanTermYears = 7 }, thresholds) {
  const floor = thresholds?.rbiDscrFloor ?? 1.20;
  const n = Number(noiCr);
  const c = Number(totalCostCr);
  const ltv = Number(debtLTV);
  const r = Number(debtRatePct);
  const term = Number(loanTermYears);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (!Number.isFinite(c) || c <= 0) return null;
  if (!Number.isFinite(ltv) || ltv <= 0 || ltv > 1) return null;
  if (!Number.isFinite(r) || r <= 0 || r > 1) return null;
  if (!Number.isFinite(term) || term <= 0) return null;
  const loan = c * ltv;
  const annualDebtSvc = r === 0
    ? loan / term
    : loan * (r * Math.pow(1 + r, term)) / (Math.pow(1 + r, term) - 1);
  if (annualDebtSvc <= 0) return null;
  const dscr = n / annualDebtSvc;
  if (!Number.isFinite(dscr) || dscr >= floor) return null;
  return {
    severity: dscr < 1.00 ? 'critical' : 'warn',
    label: dscr < 1.00
      ? `DSCR ${dscr.toFixed(2)}× — does NOT cover annual debt service`
      : `DSCR ${dscr.toFixed(2)}× — below RBI Master Direction floor of ${floor.toFixed(2)}×`,
    detail: dscr < 1.00
      ? `NOI ₹${n.toFixed(2)} Cr cannot service annual debt ₹${annualDebtSvc.toFixed(2)} Cr at ${(r * 100).toFixed(2)}% × ${term}yr on ₹${loan.toFixed(2)} Cr loan. Only feasible if sponsor injects equity from outside cash flow.`
      : `NOI ₹${n.toFixed(2)} Cr ÷ annual debt service ₹${annualDebtSvc.toFixed(2)} Cr = ${dscr.toFixed(2)}×. Reduce DebtLTV, lower DebtRatePct, or extend LoanTermYears to bring DSCR ≥ ${floor.toFixed(2)}×.`,
  };
}

/**
 * Post-Calculate kernel-warning helper (PR-NX56 — 2026-05-19).
 *
 * Reads the ACTUAL kernel-computed `kpis.dscr`, `kpis.yieldOnCost`, and
 * `kpis.exitCapRate` (with fallback to `inputs.exitCapRate`) from the
 * normalized financials response, compares against the live thresholds
 * shipped by `useBenchmarkBands`, and returns a flat array of severity-
 * tagged warnings ready for `<BenchmarkWarning>` rendering.
 *
 * Unit conventions (matches kernel output / `normalizeFinancials`):
 *   - `kpis.dscr`         — ratio (1.20×, NOT %)
 *   - `kpis.yieldOnCost`  — percent (8.5, NOT 0.085)
 *   - `kpis.exitCapRate`  — percent (7.5, NOT 0.075)
 *
 * The predictive helpers `computeDscrWarning` + `computeYocSpreadWarning`
 * above are for INPUT TIME (before Calculate); this one is for AFTER
 * Calculate when we have the actual kernel output and don't need to
 * recompute from raw inputs.
 *
 * Returns:
 *   Array<{ kind: 'dscr'|'yoc'|'irr'|'equity_multiple', severity: 'critical'|'warn', label: string, detail: string }>
 *
 * dscr/yoc are income-family; irr/equity_multiple are the cross-asset-class
 * fundamental-economics floor (capital-loss boundaries read from kernel output).
 *
 * Empty array → all kernel KPIs are within band (panel hides).
 */
export function computeKernelWarnings(kpis, inputs, thresholds) {
  const warnings = [];
  if (!kpis || !thresholds) return warnings;

  // DSCR floor check — applies to any asset class that has a kernel DSCR
  // (income-family + structured-debt deals). Compare actual ratio to floor.
  const dscr = Number(kpis.dscr);
  const floor = Number(thresholds.rbiDscrFloor);
  if (Number.isFinite(dscr) && dscr > 0 && Number.isFinite(floor) && floor > 0 && dscr < floor) {
    const isCritical = dscr < 1.00;
    warnings.push({
      kind: 'dscr',
      severity: isCritical ? 'critical' : 'warn',
      label: isCritical
        ? `DSCR ${dscr.toFixed(2)}× — does NOT cover annual debt service`
        : `DSCR ${dscr.toFixed(2)}× — below RBI Master Direction floor of ${floor.toFixed(2)}×`,
      detail: isCritical
        ? `Computed DSCR ${dscr.toFixed(2)}× means NOI is insufficient to cover annual debt service from operations alone. Only feasible if sponsor injects equity from outside cash flow — flag as critical for IC.`
        : `Computed DSCR ${dscr.toFixed(2)}× is below the RBI Master Direction floor of ${floor.toFixed(2)}×. Reduce DebtLTV, lower DebtRatePct, or extend LoanTermYears to improve coverage.`,
    });
  }

  // YoC vs Exit Cap spread — income family only (yield-on-cost only
  // meaningful for income-generating assets). Both values are PERCENTS here
  // (e.g. 9.5 and 7.5) — verified end-to-end (#30): the kernel emits
  // yieldOnCost as a percent (income.ts ×100), and exitCapRate is the user's
  // "Exit Cap Rate (%)" input / the kernel echo (the visualization layer renders
  // both with a trailing % and an `8` default). So (% − %) × 100 → bps is
  // correct, and the display strings use the values directly (no ×100).
  //
  // DO NOT copy the backend export fix (PR #873, which divides yoc by 100): that
  // path receives exitCapRate as a FRACTION (buildWorkbook's toPctDecimal) and
  // yoc as a percent — a genuine mismatch. Here BOTH are percents, so dividing
  // would itself introduce a 100× bug.
  const yocPct = Number(kpis.yieldOnCost);
  const capPct = Number(kpis.exitCapRate ?? inputs?.exitCapRate);
  const minBps = Number(thresholds.yocVsExitCapMinSpreadBps);
  if (
    Number.isFinite(yocPct) && yocPct > 0 &&
    Number.isFinite(capPct) && capPct > 0 &&
    Number.isFinite(minBps) && minBps > 0
  ) {
    const spreadBps = Math.round((yocPct - capPct) * 100);
    if (spreadBps < minBps) {
      if (spreadBps < 0) {
        warnings.push({
          kind: 'yoc',
          severity: 'critical',
          label: `Negative YoC vs Exit Cap spread (${Math.abs(spreadBps)} bps deficit)`,
          detail: `Yield-on-Cost ${yocPct.toFixed(2)}% is BELOW Exit Cap Rate ${capPct.toFixed(2)}%. Developer earns LESS than a passive buyer of the stabilised asset — no economic reward for taking on development risk. Reconsider the deal structure or exit assumption.`,
        });
      } else {
        warnings.push({
          kind: 'yoc',
          severity: 'warn',
          label: `Thin YoC vs Exit Cap spread (${spreadBps} bps)`,
          detail: `Yield-on-Cost ${yocPct.toFixed(2)}% vs Exit Cap ${capPct.toFixed(2)}% leaves only ${spreadBps} bps. Conventional IC threshold is ${minBps}-200 bps; thin spread leaves no margin for cost overruns or lease-up delays.`,
        });
      }
    }
  }

  // Fundamental-economics floor — applies to EVERY asset class (residential,
  // plotted, hospitality, etc., not just income deals). Reads the kernel's own
  // IRR + equity multiple; re-derives nothing, so it cannot diverge from the
  // deterministic kernel. These are unambiguous capital-loss boundaries, not
  // judgment calls. NPV is intentionally NOT flagged here: the kernel discounts
  // it at the deal's 14-15% hurdle rate, so a negative NPV means "below the
  // required return", not "loses money" — flagging it as a loss would misstate
  // the economics. Guarded with Number.isFinite so partial models never trip.
  // Null-safe parse: Number(null) and Number('') are 0, which would falsely
  // trip the "< 0" / "< 1.0×" boundaries below — treat null/''/undefined as
  // "not present" so a partial model never fires a false capital-loss flag.
  const irrPct = kpis.irr == null || kpis.irr === '' ? NaN : Number(kpis.irr); // annual percent (e.g. 18 = 18%)
  if (Number.isFinite(irrPct) && irrPct < 0) {
    warnings.push({
      kind: 'irr',
      severity: 'critical',
      label: `Negative IRR (${irrPct.toFixed(1)}%) — returns below capital invested`,
      detail: `The kernel's annualised return is negative (${irrPct.toFixed(2)}%): projected cash flows return less than the capital invested. Re-examine the cost, pricing, and timing inputs and stress-test the downside before taking this to IC.`,
    });
  }
  const equityMultiple = kpis.equityMultiple == null || kpis.equityMultiple === ''
    ? NaN : Number(kpis.equityMultiple); // ratio (e.g. 2.1 = 2.1×)
  if (Number.isFinite(equityMultiple) && equityMultiple < 1.0) {
    warnings.push({
      kind: 'equity_multiple',
      severity: 'critical',
      label: `Equity multiple ${equityMultiple.toFixed(2)}× — below 1.0×`,
      detail: `Projected distributions return ${equityMultiple.toFixed(2)}× the invested equity — investor capital is not returned in full. Re-examine the structure and return profile before IC; below 1.0× is capital destruction unless an offsetting return source is documented.`,
    });
  }

  return warnings;
}

/**
 * Yield-on-Cost vs Exit Cap spread warning. Income-family only.
 * Mirrors validateYocVsExitCapSpread (PR-NX33).
 *
 * NOTE (#30, 2026-06-24): currently UNUSED in the app — the live post-Calculate
 * path is `computeKernelWarnings` above. This helper assumes yieldOnCost /
 * exitCapRate are FRACTIONS (0.085 / 0.075 — hence × 10000, and the ×100 in the
 * display strings), which is INCONSISTENT with the rest of the financials UI,
 * where both are PERCENTS (the "Exit Cap Rate (%)" field, `kpis.yieldOnCost`
 * percent). If you ever wire this to live input-time data, convert to fractions
 * first (value / 100) or it will be 100× off — better, extend
 * `computeKernelWarnings` (which already handles the live percent units).
 */
export function computeYocSpreadWarning({ yieldOnCost, exitCapRate }, thresholds) {
  const minBps = thresholds?.yocVsExitCapMinSpreadBps ?? 50;
  const yoc = Number(yieldOnCost);
  const cap = Number(exitCapRate);
  if (!Number.isFinite(yoc) || yoc <= 0) return null;
  if (!Number.isFinite(cap) || cap <= 0) return null;
  const spreadBps = Math.round((yoc - cap) * 10000);
  if (spreadBps >= minBps) return null;
  if (spreadBps < 0) {
    return {
      severity: 'critical',
      label: `Negative YoC vs Exit Cap spread (${Math.abs(spreadBps)} bps deficit)`,
      detail: `Yield-on-Cost ${(yoc * 100).toFixed(2)}% is BELOW Exit Cap Rate ${(cap * 100).toFixed(2)}%. Developer earns LESS than a passive buyer of a stabilised asset — no economic reward for development risk.`,
    };
  }
  return {
    severity: 'warn',
    label: `Thin YoC vs Exit Cap spread (${spreadBps} bps)`,
    detail: `Yield-on-Cost ${(yoc * 100).toFixed(2)}% vs Exit Cap ${(cap * 100).toFixed(2)}% leaves only ${spreadBps} bps. Conventional IC threshold is ${minBps}-200 bps; thin spread leaves no margin for cost overruns or lease-up delays.`,
  };
}
