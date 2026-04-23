import { useEffect, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';
import { clsx } from 'clsx';
import { MetricTile } from '../../design-system';
import { useDefaultsMeta } from '../../hooks/useFinancials';
import { getKpiMeta } from './kpiProvenanceRegistry';
import { resolveFinancialModelClass } from '../../utils/assetClasses';

// Map asset classes onto benchmark-band keys in the provenance registry.
const BENCHMARK_KEY = {
  residential_apartments: 'residential',
  villas:                 'residential',
  mixed_use:              'residential',
  redevelopment:          'residential',
  plotted_development:    'plotted',
  commercial_office:      'income',
  retail:                 'income',
  industrial_warehousing: 'income',
  hospitality:            'hospitality',
};

const SOURCE_LABEL = {
  global_default:       'Global Default',
  asset_default:        'Asset Default',
  user_input:           'You',
  computed:             'Computed',
  market_benchmark:     'Market Benchmark',
  verified_transaction: 'Verified Txn',
};

function resolveDriver(driverKey, inputs, defaults) {
  const userVal = inputs?.[driverKey];
  if (userVal != null && userVal !== '' && Number.isFinite(Number(userVal))) {
    return { value: Number(userVal), sourceKind: 'user_input', sourceDetail: null };
  }
  const def = defaults?.[driverKey] || defaults?.[`${driverKey}Pct`] || null;
  if (def && Number.isFinite(Number(def.value))) {
    // `def.source` is a verbose citation ("JLL APAC ... snapshot average."),
    // not a canonical kind — show a short kind chip and keep the citation as
    // a separate detail line so long sources never blow out the popover.
    return {
      value: Number(def.value),
      sourceKind: 'asset_default',
      sourceDetail: def.source || null,
    };
  }
  return null;
}

function prettyDriverName(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/ Pct$/, ' (%)')
    .replace(/ Cr$/, ' (₹Cr)')
    .replace(/ Sqft$/, ' (sqft)')
    .replace(/ Months$/, ' (months)')
    .trim();
}

function formatDriverValue(val, key) {
  if (!Number.isFinite(val)) return '—';
  if (/Pct$|Rate$/.test(key)) return `${val.toFixed(2)}%`;
  if (/Cr$/.test(key)) return `₹${val.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
  if (/Sqft$/.test(key)) return `${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })} sqft`;
  if (/Months$/.test(key)) return `${Math.round(val)} mo`;
  if (/adr|rent/i.test(key)) return `₹${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  return val.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function sourceChipStyle(kind) {
  if (kind === 'user_input') {
    return {
      backgroundColor: 'var(--color-brand-accent-soft)',
      color: 'var(--color-brand-accent)',
      border: '1px solid var(--color-border-primary)',
    };
  }
  if (kind === 'market_benchmark' || kind === 'verified_transaction') {
    return {
      backgroundColor: 'rgba(20,184,166,0.14)',
      color: 'var(--color-data-highlight)',
      border: '1px solid var(--color-border-primary)',
    };
  }
  return {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text-secondary)',
    border: '1px solid var(--color-border-primary)',
  };
}

function confidenceChipStyle(level) {
  if (level === 'High') {
    return {
      backgroundColor: 'rgba(34,197,94,0.14)',
      color: 'var(--color-data-positive)',
      border: '1px solid rgba(34,197,94,0.3)',
    };
  }
  if (level === 'Medium') {
    return {
      backgroundColor: 'var(--color-brand-premium-soft)',
      color: 'var(--color-brand-premium)',
      border: '1px solid rgba(245,184,0,0.3)',
    };
  }
  if (level === 'Low') {
    return {
      backgroundColor: 'rgba(239,68,68,0.14)',
      color: 'var(--color-data-negative)',
      border: '1px solid rgba(239,68,68,0.3)',
    };
  }
  return {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text-secondary)',
    border: '1px solid var(--color-border-primary)',
  };
}

function PopoverPanel({ meta, inputs, defaults, benchmarkKey, onClose, confidence, anchorRef }) {
  const drivers = (meta.drivers || [])
    .map((k) => ({ key: k, resolved: resolveDriver(k, inputs, defaults) }))
    .filter((d) => d.resolved != null);

  const benchmark = meta.benchmark?.[benchmarkKey] || null;
  const effectiveConfidence = confidence || meta.confidence;

  // Viewport-aware positioning — `right-0` anchor works for cards on the right
  // half of the viewport, but clips off-screen on leftmost cards (the popover
  // is 320px / w-80 and extends *left* from the anchor). Measure the anchor
  // on mount and flip the horizontal alignment when there's no room to the
  // left. Falls back to `right-0` when the ref isn't ready yet.
  const [align, setAlign] = useState('right');
  const panelRef = useRef(null);
  useEffect(() => {
    const anchor = anchorRef?.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const panelWidth = Math.min(320, vw - 32); // w-80, capped to viewport − 2rem
    // Preferred: extend left from anchor's right edge (align right). Only
    // flip to left-anchor when that would overflow the viewport's left edge.
    const wouldOverflowLeft = rect.right - panelWidth < 8;
    const wouldOverflowRight = rect.left + panelWidth > vw - 8;
    if (wouldOverflowLeft && !wouldOverflowRight) setAlign('left');
    else setAlign('right');
  }, [anchorRef]);

  return (
    <div
      ref={panelRef}
      className={clsx(
        'absolute top-full mt-1 z-20 rounded-editorial text-left overflow-hidden',
        align === 'right' ? 'right-0' : 'left-0',
      )}
      style={{
        width: 'min(20rem, calc(100vw - 2rem))',
        backgroundColor: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-primary)',
        boxShadow: 'var(--shadow-elevated)',
      }}
    >
      <div
        className="px-3 py-2 flex items-start justify-between gap-2"
        style={{ borderBottom: '1px solid var(--color-border-secondary)' }}
      >
        <div className="min-w-0">
          <div
            className="font-semibold"
            style={{
              fontSize: '10px',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: 'var(--color-text-muted)',
            }}
          >
            KPI Provenance
          </div>
          <div
            className="text-sm font-semibold truncate"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {meta.name}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 mt-0.5"
          style={{ color: 'var(--color-text-muted)' }}
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      <div className="px-3 py-2 space-y-2.5 text-xs">
        <div>
          <div
            className="font-medium mb-0.5"
            style={{
              fontSize: '10px',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--color-text-muted)',
            }}
          >
            Formula
          </div>
          <code
            className="inline-block font-mono px-1.5 py-0.5 rounded"
            style={{
              fontSize: '11px',
              color: 'var(--color-text-primary)',
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border-secondary)',
            }}
          >
            {meta.formula}
          </code>
        </div>

        <div>
          <div
            className="font-medium mb-0.5"
            style={{
              fontSize: '10px',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--color-text-muted)',
            }}
          >
            Definition
          </div>
          <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
            {meta.definition}
          </p>
        </div>

        {drivers.length > 0 && (
          <div>
            <div
              className="font-medium mb-0.5"
              style={{
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--color-text-muted)',
              }}
            >
              Drivers (current)
            </div>
            <ul className="space-y-1">
              {drivers.map((d) => (
                <li
                  key={d.key}
                  className="pb-1 last:pb-0"
                  style={{
                    fontSize: '11px',
                    borderBottom: '1px solid var(--color-border-secondary)',
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className="min-w-0 truncate"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {prettyDriverName(d.key)}
                    </span>
                    <span className="flex items-baseline gap-1 shrink-0">
                      <span
                        className="font-medium tabular-nums"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {formatDriverValue(d.resolved.value, d.key)}
                      </span>
                      <span
                        className="px-1 py-0.5 rounded uppercase tracking-wide"
                        style={{
                          fontSize: '9px',
                          letterSpacing: '0.08em',
                          ...sourceChipStyle(d.resolved.sourceKind),
                        }}
                      >
                        {SOURCE_LABEL[d.resolved.sourceKind] || 'Default'}
                      </span>
                    </span>
                  </div>
                  {d.resolved.sourceDetail && (
                    <div
                      className="truncate mt-0.5"
                      style={{
                        fontSize: '10px',
                        color: 'var(--color-text-muted)',
                      }}
                      title={d.resolved.sourceDetail}
                    >
                      {d.resolved.sourceDetail}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {benchmark && (
          <div
            className="rounded px-2 py-1.5"
            style={{
              backgroundColor: 'var(--color-brand-accent-soft)',
              border: '1px solid var(--color-border-primary)',
            }}
          >
            <div
              className="font-medium mb-0.5"
              style={{
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--color-brand-accent)',
              }}
            >
              Benchmark band
            </div>
            <p
              style={{
                fontSize: '11px',
                color: 'var(--color-text-primary)',
                lineHeight: 1.4,
              }}
            >
              {benchmark}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <span
            className="uppercase font-semibold rounded px-1.5 py-0.5"
            style={{
              fontSize: '9.5px',
              letterSpacing: '0.08em',
              ...confidenceChipStyle(effectiveConfidence),
            }}
          >
            Confidence: {effectiveConfidence}
          </span>
        </div>
      </div>
    </div>
  );
}

// Map legacy StatCard accent/trend props onto MetricTile's tone + delta so
// call sites in FinancialsPage don't need to change.
function deriveDelta(trend) {
  if (trend == null || !Number.isFinite(Number(trend))) return null;
  const n = Number(trend);
  return `${n > 0 ? '+' : ''}${n}% vs last month`;
}

function deriveTone(accent, trend) {
  if (accent === 'green') return 'up';
  if (accent === 'red') return 'down';
  if (trend != null && Number.isFinite(Number(trend))) {
    return Number(trend) >= 0 ? 'up' : 'down';
  }
  return 'neutral';
}

export default function KPIStatCard({
  // eslint-disable-next-line no-unused-vars
  title, value, subtitle, icon, trend, accent, kpiKey,
  assetClass, inputs, confidence,
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const meta = getKpiMeta(kpiKey);
  const modelClass = resolveFinancialModelClass(assetClass) || assetClass;
  const { data: defaultsData } = useDefaultsMeta(modelClass);
  const defaults = defaultsData?.effective || null;
  const benchmarkKey = BENCHMARK_KEY[modelClass] || BENCHMARK_KEY[assetClass] || null;

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const delta = deriveDelta(trend);
  const tone = deriveTone(accent, trend);

  // No provenance metadata → render a plain editorial tile; still receive
  // trend/accent mappings so the visual is identical to the provenance case.
  if (!meta) {
    return (
      <MetricTile
        label={title}
        value={value}
        footnote={subtitle}
        delta={delta}
        tone={tone}
      />
    );
  }

  const infoButton = (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className={clsx(
        'p-1 rounded-full transition-colors',
        open
          ? 'bg-[#fff1ea] text-[#9a3412]'
          : 'text-stone-400 hover:bg-[#fff1ea] hover:text-[#9a3412]',
      )}
      title="See formula, drivers, and source"
      aria-label="Show KPI provenance"
      aria-expanded={open}
    >
      <Info size={13} />
    </button>
  );

  return (
    <div ref={containerRef} className="relative">
      <MetricTile
        label={title}
        value={value}
        footnote={subtitle}
        delta={delta}
        tone={tone}
        action={infoButton}
      />

      {open && (
        <PopoverPanel
          meta={meta}
          inputs={inputs}
          defaults={defaults}
          benchmarkKey={benchmarkKey}
          onClose={() => setOpen(false)}
          confidence={confidence}
          anchorRef={containerRef}
        />
      )}
    </div>
  );
}
