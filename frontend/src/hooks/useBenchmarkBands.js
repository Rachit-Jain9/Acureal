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
