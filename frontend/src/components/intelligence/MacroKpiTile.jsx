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

// Compact freshness stamp for a macro indicator. as_of_date is an ISO date
// (YYYY-MM-DD); render as "Mar 2026" so each tile shows its own vintage
// instead of silently implying the whole strip shares one date.
export const formatAsOf = (d) => {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
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
      {(kpi.source || kpi.as_of_date) && (
        <p className="mt-1 flex items-center gap-1.5 text-[10px] text-content-muted">
          {kpi.source && (
            kpi.source_url ? (
              <a
                href={kpi.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-accent-primary hover:text-accent-hover hover:underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary rounded-sm"
                title={`${kpi.source} — opens source in a new tab`}
              >
                {kpi.source}
              </a>
            ) : (
              <span className="truncate" title={kpi.source}>{kpi.source}</span>
            )
          )}
          {kpi.as_of_date && (
            <span className="shrink-0 tabular-nums" title="As-of date">
              · {formatAsOf(kpi.as_of_date)}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
