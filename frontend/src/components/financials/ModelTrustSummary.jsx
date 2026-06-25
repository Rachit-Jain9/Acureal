import { ShieldCheck, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { useModelConfidence } from '../../hooks/useFinancials';

/**
 * Model Trust — Workstream A (Provenance Spine), cross-module integration.
 *
 * A compact readout of the Provenance-Spine Model Confidence signal built on
 * the DCF Underwriting page — how many key inputs are set for this deal vs. on
 * REDIP's benchmark defaults.
 *
 * The full panel lives on the DCF page (the model builder's surface). This
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
    chip: 'bg-pos-soft text-data-positive border-hairline',
    bar: 'bg-data-positive',
  },
  mixed: {
    label: 'Mixed basis',
    chip: 'bg-premium-soft text-premium border-hairline',
    bar: 'bg-premium',
  },
  'assumption-led': {
    label: 'Assumption-led',
    chip: 'bg-neg-soft text-data-negative border-hairline',
    bar: 'bg-data-negative',
  },
};

export default function ModelTrustSummary({ dealId }) {
  const { data: conf, isLoading: confLoading } = useModelConfidence(dealId);

  if (confLoading) {
    return (
      <div className="card-editorial">
        <div className="redip-skeleton h-4 w-36 rounded-md mb-2.5" />
        <div className="redip-skeleton h-2 w-full rounded-full mb-2.5" />
        <div className="redip-skeleton h-3.5 w-2/3 rounded-sm" />
      </div>
    );
  }

  const hasConf = !!conf && conf.available && typeof conf.confidencePct === 'number';
  if (!hasConf) return null;

  const band = BAND[conf.band] || BAND.mixed;

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

      <Link
        to={`/dashboard/financials/${dealId}`}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-content-secondary hover:text-accent transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1 py-0.5"
      >
        View the full confidence breakdown
        <ArrowRight size={12} />
      </Link>
    </div>
  );
}
