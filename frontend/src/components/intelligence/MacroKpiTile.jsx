/**
 * MacroKpiTile — single tile in the "Bengaluru Q1 2026 — Verified Macro
 * Indicators" strip on the Intelligence page. Pure render; no state.
 *
 * Extracted from IntelligencePage.jsx (2026-05-25, Task #6) along with
 * its `TREND_TONE` map and `formatYoY` helper so the macro-strip logic
 * lives in one place.
 */

export const TREND_TONE = {
  up: 'text-emerald-600',
  down: 'text-red-500',
  flat: 'text-content-muted',
};

export const formatYoY = (n) => {
  if (n === null || n === undefined) return null;
  const v = Number(n);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v}% YoY`;
};

export default function MacroKpiTile({ kpi }) {
  const tone = TREND_TONE[kpi.trend] || 'text-content-muted';
  const yoy = formatYoY(kpi.yoy_change_pct);
  return (
    <div className="rounded-xl border border-hairline-strong bg-bg-elevated px-4 py-3 hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.1em] font-medium text-content-muted">
          {kpi.metric_label}
        </p>
        {yoy && (
          <span className={`text-[10px] font-semibold tabular-nums ${tone}`}>
            {yoy}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-lg font-bold text-content-primary tabular-nums leading-tight">
        {kpi.value_text}
      </p>
      {kpi.source && (
        <p className="mt-1 text-[10px] text-content-muted truncate" title={kpi.source}>
          {kpi.source}
        </p>
      )}
    </div>
  );
}
