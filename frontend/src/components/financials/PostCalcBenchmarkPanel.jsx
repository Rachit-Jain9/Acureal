import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card } from '../../design-system';
import BenchmarkWarning from './BenchmarkWarning';
import { useBenchmarkBands, computeKernelWarnings } from '../../hooks/useBenchmarkBands';

/**
 * PostCalcBenchmarkPanel (PR-NX56 — 2026-05-19)
 *
 * Renders BELOW the KPI tile strip on FinancialsPage AFTER Calculate.
 * Reads the actual kernel-computed `kpis.dscr`, `kpis.yieldOnCost`, and
 * `kpis.exitCapRate` and compares against the same thresholds the XLSX-
 * export validators (PR-NX28 + PR-NX33) use:
 *
 *   - DSCR floor: 1.20× (RBI Master Direction). Critical if < 1.00.
 *   - YoC vs Exit Cap spread: warn if < 50 bps, critical if negative.
 *
 * Completes PR-NX52's helpers — those covered input-time predictive
 * warnings (sell-rate on the form); this one covers post-Calculate
 * actual-kpi warnings.
 *
 * Renders nothing when there are no warnings (don't add noise when
 * the deal is within band) AND when bands haven't loaded. Renders a
 * compact positive-state confirmation only when bands ARE loaded AND
 * we have meaningful KPIs to check AND nothing tripped — so the
 * operator gets explicit "checked, all clear" feedback rather than
 * a silent absence.
 */
export default function PostCalcBenchmarkPanel({ dealId, kpis, inputs }) {
  const { data: bands, isLoading } = useBenchmarkBands(dealId);

  const warnings = useMemo(
    () => computeKernelWarnings(kpis, inputs, bands?.thresholds),
    [kpis, inputs, bands?.thresholds],
  );

  // Compute whether we had any meaningful KPI to evaluate (so we can
  // surface "all clear" only when we actually evaluated something).
  const evaluatedAnything = useMemo(() => {
    if (!kpis) return false;
    const dscrEvaluable = Number.isFinite(Number(kpis.dscr)) && Number(kpis.dscr) > 0;
    const yocEvaluable =
      Number.isFinite(Number(kpis.yieldOnCost)) && Number(kpis.yieldOnCost) > 0 &&
      Number.isFinite(Number(kpis.exitCapRate ?? inputs?.exitCapRate)) &&
      Number(kpis.exitCapRate ?? inputs?.exitCapRate) > 0;
    // Fundamental economics (IRR / equity multiple) apply to EVERY asset class —
    // including residential / plotted / hospitality deals that carry no DSCR or
    // YoC. Counting these as "evaluable" lets the panel surface a negative-IRR
    // or sub-1.0× flag (and the "all clear" confirmation) for those deals too.
    const fundamentalsEvaluable =
      Number.isFinite(Number(kpis.irr)) || Number.isFinite(Number(kpis.equityMultiple));
    return dscrEvaluable || yocEvaluable || fundamentalsEvaluable;
  }, [kpis, inputs]);

  // Hidden while bands are loading — don't flash a false "all clear".
  if (isLoading) return null;
  // Hidden when thresholds never arrived (no deal location / not configured).
  if (!bands?.thresholds) return null;
  // Hidden when there's nothing to evaluate yet (no DSCR + no income KPIs).
  if (!evaluatedAnything) return null;

  if (warnings.length === 0) {
    // Positive-state confirmation. Quiet green, single line, no scary tone.
    return (
      <Card elevated className="p-3">
        <div className="flex items-center gap-2 text-xs text-content-secondary">
          <CheckCircle2 size={14} className="text-data-positive flex-shrink-0" />
          <span>
            <span className="font-semibold text-content-primary">Underwriting benchmarks · all clear.</span>{' '}
            Returns, coverage, and yield-spread benchmarks are within IC + RBI thresholds.
          </span>
        </div>
      </Card>
    );
  }

  return (
    <Card elevated className="p-4">
      <h3 className="text-sm font-semibold text-content-primary mb-2 flex items-center gap-1.5">
        <AlertTriangle size={14} className="text-premium" />
        Underwriting Benchmarks
        <span className="text-[11px] font-normal text-content-muted ml-1">
          ({warnings.length} {warnings.length === 1 ? 'flag' : 'flags'} on kernel output)
        </span>
      </h3>
      <div className="space-y-2">
        {warnings.map((w, i) => (
          <BenchmarkWarning key={`${w.kind}-${i}`} warning={w} />
        ))}
      </div>
    </Card>
  );
}
