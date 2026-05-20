import { useState } from 'react';
import { ArrowLeftRight, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { useConfidenceRange } from '../../hooks/useFinancials';

/**
 * Confidence Range — Workstream A (Provenance Spine), slice 2.
 *
 * Shows the headline KPIs (IRR, NPV, equity multiple) as deterministic
 * ranges: what each becomes when the model's still-unverified assumptions are
 * swept across their cited benchmark bands. The ranges are computed
 * server-side by re-running the deterministic kernel — this component never
 * does math, it only renders.
 *
 * Hides itself when there is no financial model or the class is uncatalogued.
 */

const PRIMARY_LABEL = { irr: 'IRR', npv: 'NPV' };

const fmtKpi = (v, unit) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (unit === 'pct') return `${v}%`;
  if (unit === 'x') return `${v}x`;
  if (unit === 'inr_cr') {
    const sign = v < 0 ? '−' : '';
    return `${sign}₹${Math.abs(v).toLocaleString('en-IN')} Cr`;
  }
  return String(v);
};

const fmtDelta = (v, unit) => {
  if (v === null || v === undefined) return '—';
  const m = Math.abs(v);
  if (unit === 'inr_cr') return `±₹${m.toLocaleString('en-IN')} Cr`;
  if (unit === 'x') return `±${m}x`;
  return `±${m}%`;
};

// A range track: the [low, high] span, with the base value marked.
function RangeBar({ low, base, high }) {
  const span = high - low;
  const pos = span > 0 ? Math.min(100, Math.max(0, ((base - low) / span) * 100)) : 50;
  return (
    <div className="relative h-2 rounded-full bg-primary-100" role="presentation">
      <div
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary-600 shadow-sm transition-[left] duration-500 ease-out"
        style={{ left: `${pos}%` }}
      />
    </div>
  );
}

function KpiRangeRow({ kpi }) {
  const { label, unit, base, low, high, swing } = kpi;
  const hasSwing = swing > 0;
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-sm font-medium text-content-secondary">{label}</span>
        <span className="text-xl font-bold text-content-primary tabular-nums">
          {fmtKpi(base, unit)}
        </span>
      </div>
      {hasSwing ? (
        <>
          <RangeBar low={low} base={base} high={high} />
          <div className="flex justify-between mt-1">
            <span className="text-[11px] text-content-muted tabular-nums">{fmtKpi(low, unit)}</span>
            <span className="text-[11px] text-content-muted tabular-nums">{fmtKpi(high, unit)}</span>
          </div>
        </>
      ) : (
        <p className="text-[11px] text-content-muted">
          No benchmark-driven range — every input feeding this is set for the deal.
        </p>
      )}
    </div>
  );
}

export default function ConfidenceRangePanel({ dealId }) {
  const { data, isLoading } = useConfidenceRange(dealId);
  const [open, setOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="card-editorial">
        <div className="redip-skeleton h-5 w-44 rounded-md mb-3" />
        <div className="redip-skeleton h-2 w-full rounded-full mb-2" />
        <div className="redip-skeleton h-2 w-2/3 rounded-full" />
      </div>
    );
  }

  // No financial model / uncatalogued class / kernel unavailable → hide.
  if (!data || !data.available) return null;

  const { kpis = [], drivers = [], unverifiedCount = 0, primaryKpi } = data;
  if (kpis.length === 0) return null;

  const hasRange = kpis.some((k) => k.swing > 0);
  const primaryUnit = primaryKpi === 'npv' ? 'inr_cr' : 'pct';
  const primaryLabel = PRIMARY_LABEL[primaryKpi] || 'returns';

  return (
    <div className="card-editorial">
      <h3 className="text-base font-semibold text-content-primary flex items-center gap-2 mb-1">
        <ArrowLeftRight size={16} className="text-content-muted" />
        Confidence Range
      </h3>

      {hasRange ? (
        <>
          <p className="text-xs text-content-muted mb-3">
            Where the headline numbers land if the {unverifiedCount} unverified
            assumption{unverifiedCount === 1 ? '' : 's'} sit at the edges of their
            benchmark bands.
          </p>

          <div className="divide-y divide-hairline">
            {kpis.map((k) => (
              <KpiRangeRow key={k.key} kpi={k} />
            ))}
          </div>

          {drivers.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-content-secondary hover:text-primary-600 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 rounded px-1 py-0.5"
              >
                <ChevronRight
                  size={13}
                  className={clsx('transition-transform duration-150 ease-out', open && 'rotate-90')}
                />
                {open ? 'Hide what widens the range' : 'Show what widens the range'}
              </button>

              {open && (
                <div className="mt-2 space-y-2 border-t border-hairline pt-3">
                  {drivers.map((d) => (
                    <div key={d.key} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-content-primary">{d.label}</p>
                        {d.benchmarkSource && (
                          <p className="text-[11px] text-content-muted leading-snug">
                            {d.benchmarkSource}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-content-primary tabular-nums">
                          {fmtDelta(d.swing, primaryUnit)}
                        </p>
                        <p className="text-[11px] text-content-muted tabular-nums">
                          {primaryLabel} {fmtKpi(d.low, primaryUnit)}&ndash;{fmtKpi(d.high, primaryUnit)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <p className="text-[11px] text-content-muted mt-3 leading-snug">
            Each range end is a real, reproducible run of REDIP&apos;s deterministic engine —
            the model&apos;s output if every unverified assumption sits at the edge of its
            plausible band, not a probability forecast. Setting a deal-specific value for an
            input removes it from the range.
          </p>
        </>
      ) : (
        <p className="text-sm text-content-secondary">
          Every key assumption is set for this deal — the model carries no
          benchmark-driven range.
        </p>
      )}
    </div>
  );
}
