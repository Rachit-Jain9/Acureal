import { useEffect, useRef, useState } from 'react';
import { Info, X, ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';
import StatCard from '../common/StatCard';
import { useDefaultsMeta } from '../../hooks/useFinancials';
import { getKpiMeta } from './kpiProvenanceRegistry';
import { resolveFinancialModelClass } from '../../utils/assetClasses';

// Map asset classes onto benchmark-band keys in the provenance registry
// ('residential' | 'income' | 'hospitality' | 'plotted'). This keeps the
// popover copy specific without the registry needing to know every
// asset class by name.
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

// Look up the current effective value for a driver key — first from the
// deal's own inputs, then from the defaults registry if unset.
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

// Pretty-print the driver name — converts camelCase to Title Case.
function prettyDriverName(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/ Pct$/, ' (%)')
    .replace(/ Cr$/, ' (\u20b9Cr)')
    .replace(/ Sqft$/, ' (sqft)')
    .replace(/ Months$/, ' (months)')
    .trim();
}

function formatDriverValue(val, key) {
  if (!Number.isFinite(val)) return '\u2014';
  if (/Pct$|Rate$/.test(key)) return `${val.toFixed(2)}%`;
  if (/Cr$/.test(key)) return `\u20b9${val.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
  if (/Sqft$/.test(key)) return `${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })} sqft`;
  if (/Months$/.test(key)) return `${Math.round(val)} mo`;
  if (/adr|rent/i.test(key)) return `\u20b9${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  return val.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function PopoverPanel({ meta, inputs, defaults, benchmarkKey, onClose, confidence }) {
  const drivers = (meta.drivers || [])
    .map((k) => ({ key: k, resolved: resolveDriver(k, inputs, defaults) }))
    .filter((d) => d.resolved != null);

  const benchmark = meta.benchmark?.[benchmarkKey] || null;
  const confidenceTone = {
    High:   'bg-emerald-50 text-emerald-700 border-emerald-200',
    Medium: 'bg-amber-50   text-amber-700   border-amber-200',
    Low:    'bg-rose-50    text-rose-700    border-rose-200',
  }[confidence || meta.confidence] || 'bg-gray-50 text-gray-600 border-gray-200';

  return (
    <div className="absolute top-full right-0 mt-1 w-80 z-20 bg-white rounded-lg shadow-xl border border-gray-200 text-left overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
            KPI Provenance
          </div>
          <div className="text-sm font-semibold text-gray-900 truncate">{meta.name}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 shrink-0 mt-0.5"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      <div className="px-3 py-2 space-y-2.5 text-xs">
        <div>
          <div className="text-[10px] uppercase text-gray-500 font-medium mb-0.5">Formula</div>
          <code className="text-[11px] text-gray-800 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 inline-block font-mono">
            {meta.formula}
          </code>
        </div>

        <div>
          <div className="text-[10px] uppercase text-gray-500 font-medium mb-0.5">Definition</div>
          <p className="text-gray-700 leading-snug">{meta.definition}</p>
        </div>

        {drivers.length > 0 && (
          <div>
            <div className="text-[10px] uppercase text-gray-500 font-medium mb-0.5">
              Drivers (current)
            </div>
            <ul className="space-y-1">
              {drivers.map((d) => (
                <li
                  key={d.key}
                  className="flex items-start justify-between gap-2 text-[11px] border-b last:border-b-0 border-gray-50 pb-1 last:pb-0"
                >
                  <span className="text-gray-600 min-w-0 truncate">{prettyDriverName(d.key)}</span>
                  <span className="text-right shrink-0">
                    <span className="font-medium text-gray-900 tabular-nums">
                      {formatDriverValue(d.resolved.value, d.key)}
                    </span>
                    <span
                      className={clsx(
                        'ml-1 text-[9px] px-1 py-0.5 rounded border uppercase tracking-wide',
                        d.resolved.sourceKind === 'user_input'
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          : d.resolved.sourceKind === 'asset_default'
                          ? 'bg-gray-50 text-gray-600 border-gray-200'
                          : 'bg-sky-50 text-sky-700 border-sky-200',
                      )}
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
          <div className="rounded border border-sky-100 bg-sky-50 px-2 py-1.5">
            <div className="text-[10px] uppercase text-sky-800 font-medium mb-0.5">
              Benchmark band
            </div>
            <p className="text-[11px] text-sky-900 leading-snug">{benchmark}</p>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className={clsx('text-[9.5px] uppercase tracking-wide border rounded px-1.5 py-0.5 font-semibold', confidenceTone)}>
            Confidence: {confidence || meta.confidence}
          </span>
        </div>
      </div>
    </div>
  );
}

// KPIStatCard — drop-in replacement for StatCard that adds a provenance
// popover. If no provenance entry exists for `kpiKey` the card renders
// identically to StatCard with no info affordance — callers can safely
// swap without checking.
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

  // Close on outside click / escape.
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
    return <StatCard title={title} value={value} subtitle={subtitle} icon={icon} trend={trend} accent={accent} />;
  }

  return (
    <div ref={containerRef} className="relative">
      <StatCard title={title} value={value} subtitle={subtitle} icon={icon} trend={trend} accent={accent} />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'absolute top-2 right-2 p-1 rounded-full transition-colors',
          open
            ? 'bg-indigo-100 text-indigo-700'
            : 'text-gray-300 hover:text-indigo-600 hover:bg-indigo-50',
        )}
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
