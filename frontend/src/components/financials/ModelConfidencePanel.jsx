import { useState } from 'react';
import { Gauge, ChevronRight, CheckCircle2, Circle } from 'lucide-react';
import { clsx } from 'clsx';
import { useModelConfidence } from '../../hooks/useFinancials';

/**
 * Model Confidence — Workstream A (Provenance Spine), read-side first slice.
 *
 * Shows, for a saved underwriting model, how many key inputs are set
 * specifically for this deal versus how many still run on REDIP's cited
 * benchmark library. Pure display — the classification is computed
 * deterministically server-side; this component never does math.
 *
 * Hides itself entirely when there is no financial model, the model class
 * is not yet catalogued, or the kernel build is unavailable.
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

const fmtValue = (v) =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN');

function StatusRow({ item }) {
  const isDealSet = item.status === 'deal-set';
  const Icon = isDealSet ? CheckCircle2 : Circle;
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="flex items-start gap-2 min-w-0">
        <Icon
          size={14}
          className={clsx('mt-0.5 shrink-0', isDealSet ? 'text-data-positive' : 'text-content-muted')}
        />
        <div className="min-w-0">
          <p className="text-sm text-content-primary">
            {item.label}
            <span className="text-content-muted tabular-nums"> · {fmtValue(item.value)}</span>
          </p>
          <p className="text-[11px] text-content-muted leading-snug">{item.basis}</p>
        </div>
      </div>
      <span
        className={clsx(
          'shrink-0 text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border',
          isDealSet
            ? 'bg-pos-soft text-data-positive border-hairline'
            : 'bg-bg-secondary text-content-muted border-hairline-strong',
        )}
      >
        {isDealSet ? 'Deal-specific' : 'Benchmark default'}
      </span>
    </div>
  );
}

export default function ModelConfidencePanel({ dealId }) {
  const { data, isLoading } = useModelConfidence(dealId);
  const [open, setOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="card-editorial">
        <div className="redip-skeleton h-5 w-44 rounded-md mb-3" />
        <div className="redip-skeleton h-8 w-28 rounded-md mb-3" />
        <div className="redip-skeleton h-2.5 w-full rounded-full" />
      </div>
    );
  }

  // No financial model / uncatalogued class / kernel unavailable → hide.
  if (!data || !data.available) return null;

  const { dealSetCount, defaultCount, total, confidencePct, band, inputs } = data;
  const meta = BAND[band] || BAND.mixed;

  // Group inputs by category, preserving the server-side catalogue order.
  const groups = [];
  for (const item of inputs || []) {
    let g = groups.find((x) => x.category === item.category);
    if (!g) {
      g = { category: item.category, items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }

  return (
    <div className="card-editorial">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
          <Gauge size={16} className="text-content-muted" />
          Model Confidence
        </h3>
        <span
          className={clsx(
            'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border',
            meta.chip,
          )}
        >
          {meta.label}
        </span>
      </div>

      {/* Headline metric */}
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-2xl font-bold text-content-primary tabular-nums">
          {confidencePct}%
        </span>
        <span className="text-sm text-content-secondary">
          of {total} key inputs set for this deal
        </span>
      </div>

      {/* Proportion bar */}
      <div
        className="h-2.5 w-full rounded-full bg-bg-secondary overflow-hidden"
        role="presentation"
      >
        <div
          className={clsx('h-full rounded-full transition-[width] duration-500 ease-out', meta.bar)}
          style={{ width: `${confidencePct}%` }}
        />
      </div>
      <p className="text-xs text-content-muted mt-1.5">
        {dealSetCount} set for this deal
        {defaultCount > 0 ? ` · ${defaultCount} on REDIP benchmark defaults` : ' · every key input is deal-specific'}
      </p>

      {/* Breakdown toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-content-secondary hover:text-accent transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1 py-0.5"
      >
        <ChevronRight
          size={13}
          className={clsx('transition-transform duration-150 ease-out', open && 'rotate-90')}
        />
        {open ? 'Hide input breakdown' : 'Show input breakdown'}
      </button>

      {open && (
        <div className="mt-2 space-y-3 border-t border-hairline pt-3">
          {groups.map((g) => (
            <div key={g.category}>
              <p className="text-[11px] uppercase tracking-wider font-medium text-content-muted mb-0.5">
                {g.category}
              </p>
              <div className="divide-y divide-hairline">
                {g.items.map((item) => (
                  <StatusRow key={item.key} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-content-muted mt-3 leading-snug">
        Confidence reflects how many key inputs are set for this deal versus running on
        REDIP&apos;s benchmark library. It is not a check that an input was verified
        against a source document.
      </p>
    </div>
  );
}
