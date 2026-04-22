import { useEffect, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';
import { clsx } from 'clsx';
import StatCard from '../common/StatCard';
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
    return {
      value: Number(def.value),
      sourceKind: def.source || 'asset_default',
      sourceDetail: def.lastReviewed || null,
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

function PopoverPanel({ meta, inputs, defaults, benchmarkKey, onClose, confidence }) {
  const drivers = (meta.drivers || [])
    .map((k) => ({ key: k, resolved: resolveDriver(k, inputs, defaults) }))
    .filter((d) => d.resolved != null);

  const benchmark = meta.benchmark?.[benchmarkKey] || null;
  const effectiveConfidence = confidence || meta.confidence;

  return (
    <div
      className="absolute top-full right-0 mt-1 w-80 z-20 rounded-editorial text-left overflow-hidden"
      style={{
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
                  className="flex items-start justify-between gap-2 pb-1 last:pb-0"
                  style={{
                    fontSize: '11px',
                    borderBottom: '1px solid var(--color-border-secondary)',
                  }}
                >
                  <span
                    className="min-w-0 truncate"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {prettyDriverName(d.key)}
                  </span>
                  <span className="text-right shrink-0">
                    <span
                      className="font-medium tabular-nums"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {formatDriverValue(d.resolved.value, d.key)}
                    </span>
                    <span
                      className="ml-1 px-1 py-0.5 rounded uppercase tracking-wide"
                      style={{
                        fontSize: '9px',
                        letterSpacing: '0.08em',
                        ...sourceChipStyle(d.resolved.sourceKind),
                      }}
                    >
                      {SOURCE_LABEL[d.resolved.sourceKind] || d.resolved.sourceKind}
                    </span>
                  </span>
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

export default function KPIStatCard({
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

  if (!meta) {
    return (
      <StatCard
        title={title}
        value={value}
        subtitle={subtitle}
        icon={icon}
        trend={trend}
        accent={accent}
      />
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <StatCard
        title={title}
        value={value}
        subtitle={subtitle}
        icon={icon}
        trend={trend}
        accent={accent}
      />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'absolute top-2 right-2 p-1 rounded-full transition-colors',
        )}
        style={{
          backgroundColor: open ? 'var(--color-brand-accent-soft)' : 'transparent',
          color: open ? 'var(--color-brand-accent)' : 'var(--color-text-muted)',
        }}
        onMouseEnter={(e) => {
          if (!open) {
            e.currentTarget.style.backgroundColor = 'var(--color-brand-accent-soft)';
            e.currentTarget.style.color = 'var(--color-brand-accent)';
          }
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'var(--color-text-muted)';
          }
        }}
        title="See formula, drivers, and source"
        aria-label="Show KPI provenance"
        aria-expanded={open}
      >
        <Info size={13} />
      </button>

      {open && (
        <PopoverPanel
          meta={meta}
          inputs={inputs}
          defaults={defaults}
          benchmarkKey={benchmarkKey}
          onClose={() => setOpen(false)}
          confidence={confidence}
        />
      )}
    </div>
  );
}
