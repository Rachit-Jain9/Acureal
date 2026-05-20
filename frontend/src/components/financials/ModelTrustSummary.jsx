import { ShieldCheck, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { useModelConfidence, useConfidenceRange } from '../../hooks/useFinancials';

/**
 * Model Trust — Workstream A (Provenance Spine), cross-module integration.
 *
 * A compact, fused readout of the two Provenance-Spine signals built on the
 * DCF Underwriting page:
 *   - Model Confidence — how many key inputs are set for this deal vs. on
 *     REDIP's benchmark defaults.
 *   - Confidence Range — what the still-unverified assumptions do to the
 *     headline KPIs.
 *
 * The full panels live on the DCF page (the model builder's surface). This
 * strip carries the verdict to where a deal is actually reviewed — the deal
 * Overview and the Financial tab — so "how much do I trust these numbers"
 * travels with the numbers themselves.
 *
 * Pure display — both signals are computed deterministically server-side.
 * Hides itself entirely when the deal has no financial model.
 */

const BAND = {
  grounded: {
    label: 'Well-grounded',
    chip: 'bg-green-50 text-green-700 border-green-200',
    bar: 'bg-green-500',
  },
  mixed: {
    label: 'Mixed basis',
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
    bar: 'bg-amber-500',
  },
  'assumption-led': {
    label: 'Assumption-led',
    chip: 'bg-rose-50 text-rose-700 border-rose-200',
    bar: 'bg-rose-500',
  },
};

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

export default function ModelTrustSummary({ dealId }) {
  const { data: conf, isLoading: confLoading } = useModelConfidence(dealId);
  const { data: range, isLoading: rangeLoading } = useConfidenceRange(dealId);

  if (confLoading || rangeLoading) {
    return (
      <div className="card-editorial">
        <div className="redip-skeleton h-4 w-36 rounded-md mb-2.5" />
        <div className="redip-skeleton h-2 w-full rounded-full mb-2.5" />
        <div className="redip-skeleton h-3.5 w-2/3 rounded-sm" />
      </div>
    );
  }

  const hasConf = !!conf && conf.available && typeof conf.confidencePct === 'number';
  const hasRange =
    !!range && range.available && Array.isArray(range.kpis) && range.kpis.length > 0;
  if (!hasConf && !hasRange) return null;

  const band = hasConf ? BAND[conf.band] || BAND.mixed : null;
  const kpis = hasRange ? range.kpis : [];
  const anySwing = kpis.some((k) => k.swing > 0);

  return (
    <div className="card-editorial">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
          <ShieldCheck size={16} className="text-content-muted" />
          Model Trust
        </h3>
        {band && (
          <span
            className={clsx(
              'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border',
              band.chip,
            )}
          >
            {band.label}
          </span>
        )}
      </div>

      {hasConf && (
        <>
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-xl font-bold text-content-primary tabular-nums">
              {conf.confidencePct}%
            </span>
            <span className="text-sm text-content-secondary">
              of {conf.total} key inputs set for this deal
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-bg-secondary overflow-hidden">
            <div
              className={clsx('h-full rounded-full transition-[width] duration-500 ease-out', band.bar)}
              style={{ width: `${conf.confidencePct}%` }}
            />
          </div>
        </>
      )}

      {hasRange && (
        <div className={clsx(hasConf && 'mt-3 border-t border-hairline pt-2.5')}>
          {anySwing ? (
            <>
              <p className="text-[11px] uppercase tracking-wider font-medium text-content-muted mb-1.5">
                Headline numbers — range from unverified assumptions
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {kpis.map((k) => (
                  <div key={k.key} className="text-sm tabular-nums">
                    <span className="text-content-muted">{k.label} </span>
                    <span className="font-semibold text-content-primary">
                      {fmtKpi(k.base, k.unit)}
                    </span>
                    {k.swing > 0 && (
                      <span className="text-content-muted">
                        {' '}
                        ({fmtKpi(k.low, k.unit)}&ndash;{fmtKpi(k.high, k.unit)})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-content-secondary">
              Every key assumption is set for this deal — the headline numbers carry no
              benchmark-driven range.
            </p>
          )}
        </div>
      )}

      <Link
        to={`/dashboard/financials/${dealId}`}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-content-secondary hover:text-primary-600 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 rounded px-1 py-0.5"
      >
        View the full confidence breakdown
        <ArrowRight size={12} />
      </Link>
    </div>
  );
}
