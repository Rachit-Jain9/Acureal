import { useEffect, useMemo, useState } from 'react';
import {
  X, Search, Filter, Info, Database,
  Building2, Coins, TrendingUp, Landmark, Layers, Hotel, MapPin,
} from 'lucide-react';
import { financialsAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';
import { FINANCIAL_MODEL_LABEL_BY_ASSET_CLASS } from '../../utils/assetClasses';

// Heuristic bucketing by key prefix/substring so analysts scan a coherent
// default sheet rather than one flat alphabetical wall. The kernel registry
// is intentionally flat so downstream callers can tag a field however they
// want — this categorisation is presentation-only.
const CATEGORIES = [
  {
    id: 'land',       label: 'Land & Site',        icon: MapPin,
    match: (k) => /land|plot|area|fsi|loading|saleable|plotSize/i.test(k),
    accent: 'from-amber-500 to-orange-500',
  },
  {
    id: 'construction', label: 'Construction & Soft Cost', icon: Building2,
    match: (k) => /construction|devCost|approval|gst|architect|pmc|contingency|preOpening/i.test(k),
    accent: 'from-slate-500 to-zinc-500',
  },
  {
    id: 'revenue',    label: 'Revenue & Pricing',  icon: TrendingUp,
    match: (k) => /sellingRate|pricingEscalation|marketing|developerMargin|baseRent|rentEscalation|adr|fbRev|otherRev|anchor/i.test(k),
    accent: 'from-emerald-500 to-teal-500',
  },
  {
    id: 'stabilized', label: 'Stabilized Operations', icon: Layers,
    match: (k) => /vacancy|opex|tiPerSqft|lcMonths|gopMargin|ebitdaMargin|stabilizedOcc|adrGrowth/i.test(k),
    accent: 'from-sky-500 to-cyan-500',
  },
  {
    id: 'financing',  label: 'Financing & Debt',   icon: Landmark,
    match: (k) => /debtLTV|debtRate|debtTenor|interestRate|lrd|amortization|financeCost|debtCoverage/i.test(k),
    accent: 'from-indigo-500 to-blue-600',
  },
  {
    id: 'exit',       label: 'Exit & Discount',    icon: Coins,
    match: (k) => /entryCap|exitCap|exitMultiple|perpetuityGrowth|terminalValue|holdPeriod|exitStrategy|discountRate|forwardPurchase/i.test(k),
    accent: 'from-violet-500 to-purple-500',
  },
  {
    id: 'hospitality', label: 'Hospitality Specific', icon: Hotel,
    match: (k) => /keys|stabilizedOcc|preOpening|gopMargin|ebitdaMargin|fbRev|otherRev|adr/i.test(k),
    accent: 'from-rose-500 to-pink-500',
  },
];

function categorize(key) {
  for (const c of CATEGORIES) {
    if (c.match(key)) return c.id;
  }
  return 'other';
}

export default function DefaultsInspector({
  assetClass = 'residential_apartments',
  compactTrigger = false,
  open: openProp,
  onClose,
  hideTrigger = false,
}) {
  const isControlled = typeof openProp === 'boolean';
  const [openInternal, setOpenInternal] = useState(false);
  const open = isControlled ? openProp : openInternal;
  const close = () => {
    if (isControlled) onClose?.();
    else setOpenInternal(false);
  };
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    financialsAPI.defaults(assetClass)
      .then((res) => { if (!cancelled) setData(res?.data?.data || null); })
      .catch((err) => {
        if (cancelled) return;
        const msg = err?.response?.data?.message || err?.message || 'Failed to load defaults';
        setError(msg);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, assetClass]);

  const label = FINANCIAL_MODEL_LABEL_BY_ASSET_CLASS[assetClass] || 'Underwriting';

  const { grouped, totalCount, categoryCounts } = useMemo(() => {
    if (!data?.effective) {
      return { grouped: {}, totalCount: 0, categoryCounts: {} };
    }
    const entries = Object.entries(data.effective);
    const lowerSearch = search.trim().toLowerCase();
    const filtered = entries.filter(([key, meta]) => {
      if (!lowerSearch) return true;
      const hay = `${key} ${meta?.description || ''} ${meta?.source || ''} ${meta?.unit || ''}`.toLowerCase();
      return hay.includes(lowerSearch);
    });
    const g = {};
    const counts = {};
    for (const [key, meta] of filtered) {
      const cat = categorize(key);
      if (!g[cat]) g[cat] = [];
      g[cat].push([key, meta]);
      counts[cat] = (counts[cat] || 0) + 1;
    }
    for (const cat of Object.keys(g)) g[cat].sort((a, b) => a[0].localeCompare(b[0]));
    return { grouped: g, totalCount: filtered.length, categoryCounts: counts };
  }, [data, search]);

  const visibleCategories = useMemo(() => {
    const used = CATEGORIES.filter((c) => grouped[c.id]?.length);
    if (grouped.other?.length) {
      used.push({ id: 'other', label: 'Other', icon: Info, accent: 'from-gray-400 to-gray-500' });
    }
    return used;
  }, [grouped]);

  return (
    <>
      {!hideTrigger && (
        <button
          type="button"
          onClick={() => setOpenInternal(true)}
          className={
            compactTrigger
              ? 'inline-flex items-center gap-1.5 rounded-full border border-sky-200/80 bg-gradient-to-r from-sky-50 via-cyan-50 to-teal-50 px-3 py-1 text-[11px] font-semibold text-sky-700 shadow-sm transition hover:shadow-md hover:border-sky-300'
              : 'group inline-flex items-center gap-2 rounded-full border border-sky-200/80 bg-gradient-to-r from-sky-50 via-cyan-50 to-teal-50 px-3.5 py-1.5 text-xs font-semibold text-sky-700 shadow-sm transition hover:shadow-md hover:border-sky-300'
          }
          aria-label="View underwriting defaults with provenance"
          title="View all defaults and sources for this asset class"
        >
          <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 via-cyan-500 to-teal-500 text-white shadow-sm">
            <Database size={12} strokeWidth={2.5} />
          </span>
          <span className="tracking-wide">Defaults & Sources</span>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[70] flex">
          <button
            type="button"
            aria-label="Close defaults inspector"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={close}
          />
          <aside className="relative ml-auto flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
            <header className="relative overflow-hidden border-b border-hairline-strong bg-gradient-to-br from-slate-900 via-sky-900 to-cyan-900 px-6 py-5 text-white">
              <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gradient-to-br from-cyan-400/30 to-sky-400/10 blur-2xl" />
              <div className="absolute -bottom-10 left-10 h-32 w-32 rounded-full bg-teal-400/20 blur-2xl" />
              <div className="relative flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-cyan-200">
                    <Database size={12} /> Single Source of Truth
                  </div>
                  <h2 className="mt-1 text-2xl font-bold">Underwriting Defaults</h2>
                  <p className="mt-1 max-w-xl text-sm text-cyan-100/90">
                    Every default value fed into the <span className="font-semibold text-white">{label}</span> model —
                    with unit, typical range, citation, and last review date. Sourced from
                    <code className="mx-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px]">config/defaults.ts</code>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="relative mt-5 flex flex-col gap-3">
                <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5">
                  <Search size={14} className="text-cyan-200" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search key, source, unit, description…"
                    className="flex-1 bg-transparent text-sm text-white placeholder-cyan-200/70 outline-none"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="text-[10px] uppercase tracking-wider text-cyan-200 hover:text-white"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {visibleCategories.length > 0 && (
                  <nav className="flex flex-wrap gap-1.5">
                    <CategoryChip
                      active={activeCategory === 'all'}
                      onClick={() => setActiveCategory('all')}
                      icon={Filter}
                      accent="from-white/30 to-white/10"
                      label={`All (${totalCount})`}
                    />
                    {visibleCategories.map((c) => (
                      <CategoryChip
                        key={c.id}
                        active={activeCategory === c.id}
                        onClick={() => setActiveCategory(c.id)}
                        icon={c.icon}
                        accent={c.accent}
                        label={`${c.label} (${categoryCounts[c.id] || 0})`}
                      />
                    ))}
                  </nav>
                )}
              </div>
            </header>

            <div className="flex-1 overflow-y-auto bg-bg-secondary">
              {loading && (
                <div className="flex h-full items-center justify-center p-12">
                  <LoadingSpinner size="lg" />
                </div>
              )}

              {error && !loading && (
                <div className="m-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  <div className="font-semibold">Could not load defaults</div>
                  <div className="mt-1 text-xs">{error}</div>
                  <div className="mt-2 text-[11px] text-rose-600">
                    If the kernel dist is missing, run:
                    <code className="ml-1 rounded bg-rose-100 px-1.5 py-0.5">
                      cd packages/financial-kernel && npx tsc -p tsconfig.build.json
                    </code>
                  </div>
                </div>
              )}

              {!loading && !error && data && totalCount === 0 && (
                <div className="m-6 rounded-lg border border-hairline-strong bg-white px-4 py-8 text-center text-sm text-content-secondary">
                  No defaults match <span className="font-mono text-content-secondary">{search}</span>.
                </div>
              )}

              {!loading && !error && data && totalCount > 0 && (
                <div className="mx-auto max-w-2xl px-6 py-6 space-y-6">
                  {visibleCategories
                    .filter((c) => activeCategory === 'all' || activeCategory === c.id)
                    .map((c) => (
                      <CategorySection
                        key={c.id}
                        category={c}
                        items={grouped[c.id] || []}
                      />
                    ))}
                </div>
              )}
            </div>

            <footer className="border-t border-hairline-strong bg-white px-6 py-3 text-[11px] text-content-secondary">
              <div className="flex items-center justify-between gap-3">
                <span>
                  Bengaluru-shaped baseline · India-first · Values are institutional guidelines, not prescriptions.
                </span>
                {data?.assetClass && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-bg-secondary px-2 py-0.5 font-mono text-[10px] text-content-secondary">
                    {data.assetClass}
                  </span>
                )}
              </div>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}

function CategoryChip({ active, onClick, icon: Icon, accent, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition ${
        active
          ? `bg-gradient-to-r ${accent} text-white shadow-md`
          : 'bg-white/10 text-cyan-100 hover:bg-white/20'
      }`}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}

function CategorySection({ category, items }) {
  const Icon = category.icon;
  return (
    <section className="rounded-xl border border-hairline-strong bg-white shadow-sm overflow-hidden">
      <header className={`flex items-center gap-2 bg-gradient-to-r ${category.accent} px-4 py-2.5 text-white`}>
        <Icon size={14} />
        <h3 className="text-sm font-semibold tracking-wide">{category.label}</h3>
        <span className="ml-auto text-[10px] opacity-80">{items.length}</span>
      </header>
      <ul className="divide-y divide-hairline">
        {items.map(([key, meta]) => (
          <DefaultRow key={key} fieldKey={key} meta={meta} />
        ))}
      </ul>
    </section>
  );
}

function DefaultRow({ fieldKey, meta }) {
  if (!meta || typeof meta !== 'object') {
    return (
      <li className="px-4 py-2 text-xs text-content-muted">{fieldKey} — no metadata</li>
    );
  }
  const { value, unit, range, source, lastReviewed, description } = meta;
  const unitSuffix = formatUnit(unit);
  const rangeText = Array.isArray(range) && range.length === 2
    ? `${fmtNum(range[0])}–${fmtNum(range[1])}${unitSuffix}`
    : null;

  return (
    <li className="px-4 py-3 hover:bg-bg-secondary">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-[11px] font-semibold text-content-primary">{fieldKey}</code>
            {unit && (
              <span className="rounded bg-bg-secondary px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-content-secondary">
                {unit}
              </span>
            )}
          </div>
          {description && (
            <p className="mt-0.5 text-[11px] leading-snug text-content-secondary">{description}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-content-secondary">
            {rangeText && (
              <span>
                <span className="font-semibold text-content-secondary">Range:</span> {rangeText}
              </span>
            )}
            {source && (
              <span className="truncate">
                <span className="font-semibold text-content-secondary">Source:</span> {source}
              </span>
            )}
            {lastReviewed && (
              <span>
                <span className="font-semibold text-content-secondary">Reviewed:</span> {lastReviewed}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-sm font-semibold text-content-primary tabular-nums">
            {fmtNum(value)}
          </div>
          {unitSuffix && (
            <div className="text-[9px] text-content-muted">{unitSuffix.trim()}</div>
          )}
        </div>
      </div>
    </li>
  );
}

function fmtNum(v) {
  if (v == null) return '—';
  if (typeof v !== 'number') return String(v);
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 10000) return v.toLocaleString('en-IN');
  if (Number.isInteger(v)) return v.toString();
  return v.toString();
}

function formatUnit(unit) {
  if (!unit) return '';
  const norm = unit.toLowerCase();
  if (norm === 'ratio' || norm === 'none' || norm === 'unitless') return '';
  if (norm === 'pct' || norm === 'percent' || norm === '%') return '%';
  if (norm === 'inr') return ' ₹';
  if (norm === 'inr_cr' || norm === 'inr-cr' || norm === 'inrcr') return ' ₹Cr';
  return ` ${unit}`;
}
