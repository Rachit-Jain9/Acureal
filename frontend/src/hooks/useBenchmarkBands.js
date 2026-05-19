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
 *   Array<{ kind: 'dscr'|'yoc', severity: 'critical'|'warn', label: string, detail: string }>
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
  // meaningful for income-generating assets). Both values are stored as
  // percentages by the kernel; convert (% - %) → bps via × 100.
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

  return warnings;
}

/**
 * Yield-on-Cost vs Exit Cap spread warning. Income-family only.
 * Mirrors validateYocVsExitCapSpread (PR-NX33).
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
