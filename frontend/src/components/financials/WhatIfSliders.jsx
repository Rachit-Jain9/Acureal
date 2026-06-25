import { useEffect, useMemo, useRef, useState } from 'react';
import { Sliders, ArrowUpRight, ArrowDownRight, Minus, RotateCcw } from 'lucide-react';
import { clsx } from 'clsx';
import { useQuickCompute, useDefaultsMeta } from '../../hooks/useFinancials';
import { clientQuickCompute, useClientKernel } from '../../utils/clientKernel';
import { resolveFinancialModelClass } from '../../utils/assetClasses';
import { preflightDealInput } from '../../utils/dealInputPreflight';
import MissingInputsCard from './MissingInputsCard';

// Fields the user can scrub per asset class. Keys MUST match the kernel's
// input-schema names (see packages/financial-kernel/src/inputSchema.ts) so
// `computeDeal({ raw })` understands them. The ordering controls which
// sliders render top-to-bottom.
//
// We deliberately keep this list short (≤5 per class). Sliders are for
// *intuition*, not an input-form replacement — the InputForm below handles
// full edits.
const SLIDER_FIELDS = {
  residential_apartments: [
    { key: 'sellingRatePerSqft', label: 'Selling Rate',    unit: '₹/sqft',  good: 'up',   decimals: 0 },
    { key: 'constructionCostPerSqft', label: 'Construction Cost', unit: '₹/sqft', good: 'down', decimals: 0 },
    { key: 'landCostCr',         label: 'Land Cost',       unit: '₹ Cr',    good: 'down', decimals: 2 },
    { key: 'financeCostPct',     label: 'Finance Rate',    unit: '% pa',    good: 'down', decimals: 2 },
    { key: 'projectDurationMonths', label: 'Duration',     unit: 'months',  good: 'down', decimals: 0 },
  ],
  plotted_development: [
    { key: 'sellingRatePerSqft', label: 'Selling Rate',    unit: '₹/sqft',  good: 'up',   decimals: 0 },
    { key: 'devCostPerSqft',     label: 'Dev Cost',        unit: '₹/sqft',  good: 'down', decimals: 0 },
    { key: 'landCostCr',         label: 'Land Cost',       unit: '₹ Cr',    good: 'down', decimals: 2 },
    { key: 'saleableLandPct',    label: 'Saleable %',      unit: '%',       good: 'up',   decimals: 1 },
  ],
  commercial_office: [
    { key: 'baseRentPerSqftMonth', label: 'Base Rent',     unit: '₹/sqft/mo', good: 'up', decimals: 1 },
    { key: 'exitCapRate',        label: 'Exit Cap Rate',   unit: '%',       good: 'down', decimals: 2 },
    { key: 'vacancyPct',         label: 'Vacancy',         unit: '%',       good: 'down', decimals: 1 },
    { key: 'constructionCostPerSqft', label: 'Construction Cost', unit: '₹/sqft', good: 'down', decimals: 0 },
  ],
  retail: [
    { key: 'baseRentPerSqftMonth', label: 'Base Rent',     unit: '₹/sqft/mo', good: 'up', decimals: 1 },
    { key: 'exitCapRate',        label: 'Exit Cap Rate',   unit: '%',       good: 'down', decimals: 2 },
    { key: 'vacancyPct',         label: 'Vacancy',         unit: '%',       good: 'down', decimals: 1 },
    { key: 'constructionCostPerSqft', label: 'Construction Cost', unit: '₹/sqft', good: 'down', decimals: 0 },
  ],
  industrial_warehousing: [
    { key: 'baseRentPerSqftMonth', label: 'Base Rent',     unit: '₹/sqft/mo', good: 'up', decimals: 1 },
    { key: 'exitCapRate',        label: 'Exit Cap Rate',   unit: '%',       good: 'down', decimals: 2 },
    { key: 'vacancyPct',         label: 'Vacancy',         unit: '%',       good: 'down', decimals: 1 },
    { key: 'constructionCostPerSqft', label: 'Construction Cost', unit: '₹/sqft', good: 'down', decimals: 0 },
  ],
  hospitality: [
    { key: 'adr',                label: 'ADR',             unit: '₹',       good: 'up',   decimals: 0 },
    { key: 'stabilizedOccPct',   label: 'Stabilized Occ.', unit: '%',       good: 'up',   decimals: 1 },
    { key: 'exitCapRate',        label: 'Exit Cap Rate',   unit: '%',       good: 'down', decimals: 2 },
    { key: 'hardCostPerSqft',    label: 'Hard Cost',       unit: '₹/sqft',  good: 'down', decimals: 0 },
  ],
  villas: [
    { key: 'sellingRatePerSqft', label: 'Selling Rate',    unit: '₹/sqft',  good: 'up',   decimals: 0 },
    { key: 'constructionCostPerSqft', label: 'Construction Cost', unit: '₹/sqft', good: 'down', decimals: 0 },
    { key: 'landCostCr',         label: 'Land Cost',       unit: '₹ Cr',    good: 'down', decimals: 2 },
  ],
  redevelopment: [
    { key: 'sellingRatePerSqft', label: 'Selling Rate',    unit: '₹/sqft',  good: 'up',   decimals: 0 },
    { key: 'constructionCostPerSqft', label: 'Construction Cost', unit: '₹/sqft', good: 'down', decimals: 0 },
    { key: 'financeCostPct',     label: 'Finance Rate',    unit: '% pa',    good: 'down', decimals: 2 },
  ],
  mixed_use: [
    { key: 'sellingRatePerSqft', label: 'Selling Rate',    unit: '₹/sqft',  good: 'up',   decimals: 0 },
    { key: 'constructionCostPerSqft', label: 'Construction Cost', unit: '₹/sqft', good: 'down', decimals: 0 },
    { key: 'landCostCr',         label: 'Land Cost',       unit: '₹ Cr',    good: 'down', decimals: 2 },
  ],
};

// KPI cards shown on the right. Each picks a field from the quick-compute
// response and formats it, plus a sign convention for delta coloring:
// "up" = higher is better (green when increasing); "down" = inverse.
const KPI_CARDS = [
  { key: 'irr',            label: 'IRR',         suffix: '%', decimals: 2, good: 'up'   },
  { key: 'npv',            label: 'NPV',         suffix: ' Cr', decimals: 2, good: 'up' },
  { key: 'equityMultiple', label: 'Equity Mult.', suffix: '×', decimals: 2, good: 'up'  },
  { key: 'grossMarginPct', label: 'Gross Margin', suffix: '%', decimals: 2, good: 'up'  },
];

// Kernel returns IRR already in percent form (14.0 for 14% p.a.). Do NOT scale.
const scaleForDisplay = (value) => {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
};

const fmtNumber = (n, decimals = 2) => {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

// Compact formatter for slider value labels — drops decimals for large
// integers (no one cares about ".00" on a ₹/sqft reading).
const fmtSliderValue = (n, decimals) => {
  if (n == null || !Number.isFinite(n)) return '—';
  if (decimals === 0 && Math.abs(n) >= 1000) return Math.round(n).toLocaleString('en-IN');
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

// Debounce hook used only on the HTTP-fallback path (`VITE_CLIENT_KERNEL=0`).
// When the client kernel is on, every slider tick computes synchronously
// in ~2 ms, so debouncing only inserts UI latency.
const useDebounced = (value, delayMs) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (delayMs <= 0) { setDebounced(value); return undefined; }
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
};

// Pick a slider range. We prefer the defaults registry's declared range
// (source-attributed, range-reviewed); if that's missing we fall back to
// [current × 0.7, current × 1.3]. Sliders must always have a non-trivial
// range — if the range collapses to a single point, we skip the field.
const pickRange = (current, meta) => {
  const [lo, hi] = Array.isArray(meta?.range) && meta.range.length === 2
    ? meta.range
    : [current * 0.7, current * 1.3];
  if (!(hi > lo)) return null;
  return [Number(lo), Number(hi)];
};

// Resolve the meta entry, with fallback from e.g. `exitCapRate` →
// `exitCapRatePct` (the defaults registry uses the Pct suffix for rates,
// but the kernel's input schema accepts the suffixless form).
const metaFor = (defaults, key) => {
  if (!defaults) return null;
  if (defaults[key]) return defaults[key];
  if (defaults[`${key}Pct`]) return defaults[`${key}Pct`];
  return null;
};

function KPIDelta({ baseValue, currentValue, decimals, suffix, label, good }) {
  const base = scaleForDisplay(baseValue);
  const curr = scaleForDisplay(currentValue);

  const delta = (base != null && curr != null) ? curr - base : null;
  const eps = 10 ** -(decimals + 1);
  const isFlat = delta != null && Math.abs(delta) < eps;
  const isBetter = delta != null && !isFlat && (good === 'up' ? delta > 0 : delta < 0);

  const Icon = isFlat ? Minus : isBetter ? ArrowUpRight : ArrowDownRight;

  // Editorial: neutral chrome carries the value; the directional delta line
  // (icon + colored text) carries the up/down signal. Avoids the saturated
  // whole-tile tint that competes with the page's other KPI surfaces.
  const deltaToneClass = isFlat
    ? 'text-content-muted'
    : isBetter
      ? 'text-data-positive'
      : 'text-data-negative';

  return (
    <div className="rounded-editorial bg-bg-secondary border border-hairline px-3 py-2.5">
      <div className="text-eyebrow uppercase text-content-muted font-medium">{label}</div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-lg font-semibold tabular-nums text-content-primary">
          {fmtNumber(curr, decimals)}
        </span>
        <span className="text-xs text-content-muted">{suffix}</span>
      </div>
      {delta != null && (
        <div className={clsx('flex items-center gap-0.5 font-medium mt-1 text-[11px]', deltaToneClass)}>
          <Icon size={12} />
          <span className="tabular-nums">
            {isFlat
              ? 'unchanged'
              : `${delta > 0 ? '+' : ''}${fmtNumber(delta, decimals)}${suffix.trim()}`}
          </span>
          <span className="font-normal text-content-muted">vs base</span>
        </div>
      )}
    </div>
  );
}

// A single slider row with label, current value, range ends.
function SliderRow({ field, currentValue, range, onChange, onReset, isResetDisabled }) {
  const [lo, hi] = range;
  const step = Math.max((hi - lo) / 100, field.decimals === 0 ? 1 : 10 ** -field.decimals);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-content-secondary">{field.label}</span>
        <div className="flex items-center gap-2">
          <span className="font-semibold tabular-nums text-content-primary">
            {fmtSliderValue(currentValue, field.decimals)}
          </span>
          <span className="text-content-muted">{field.unit}</span>
          <button
            type="button"
            onClick={onReset}
            disabled={isResetDisabled}
            className={clsx(
              'transition-colors text-content-muted',
              isResetDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:text-content-primary',
            )}
            title="Reset to base"
          >
            <RotateCcw size={11} />
          </button>
        </div>
      </div>
      <input
        type="range"
        min={lo}
        max={hi}
        step={step}
        value={currentValue}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-2"
        style={{ accentColor: 'var(--color-brand-accent)' }}
      />
      <div className="flex items-center justify-between tabular-nums text-[10px] text-content-muted">
        <span>{fmtSliderValue(lo, field.decimals)}</span>
        <span>{fmtSliderValue(hi, field.decimals)}</span>
      </div>
    </div>
  );
}

// What-if sliders panel. Drops beside/below a financial model view to let
// the user feel how KPIs move with marginal changes to key inputs.
//
// Props:
//  - assetClass: current asset class (may be a routed class e.g. mixed_use)
//  - baseInputs: the saved raw assumption set (from financials.inputs)
//  - baseKpis:   the saved kpis snapshot — used to render "vs base" deltas
//
// Compute path:
//  - Default: client kernel runs in-browser per slider tick (~2 ms, zero
//    network). Sliders feel native — KPIs move while dragging.
//  - VITE_CLIENT_KERNEL=0: fall back to the HTTP `/financials/quick-compute`
//    endpoint with a 250 ms debounce + React Query mutation.
export default function WhatIfSliders({ assetClass, baseInputs, baseKpis, onEditInputs }) {
  const modelClass = resolveFinancialModelClass(assetClass) || assetClass;
  const { data: defaultsData } = useDefaultsMeta(modelClass);
  const defaults = defaultsData?.effective || null;

  const preflight = preflightDealInput(baseInputs, assetClass);

  const fieldList = useMemo(
    () => (SLIDER_FIELDS[assetClass] || SLIDER_FIELDS[modelClass] || []),
    [modelClass, assetClass],
  );

  // Build the initial slider state from baseInputs, falling back to the
  // default value from the registry where the saved input is null/undef.
  // Skip fields whose range is degenerate (cannot render a useful slider).
  const sliderRows = useMemo(() => {
    const rows = [];
    for (const f of fieldList) {
      const baseVal = Number(baseInputs?.[f.key]);
      const meta = metaFor(defaults, f.key);
      const current = Number.isFinite(baseVal) ? baseVal : Number(meta?.value);
      if (!Number.isFinite(current)) continue;
      const range = pickRange(current, meta);
      if (!range) continue;
      rows.push({ field: f, base: current, range, meta });
    }
    return rows;
  }, [fieldList, baseInputs, defaults]);

  // Live slider values, keyed by field name. Initialized from base; reset
  // back to base when asset class or base inputs change underneath us.
  const [values, setValues] = useState({});
  useEffect(() => {
    const next = {};
    for (const r of sliderRows) next[r.field.key] = r.base;
    setValues(next);
  }, [sliderRows]);

  const isClient = useClientKernel();
  // Skip debounce on the client path — synchronous compute makes it pure
  // overhead. Server path keeps the 250 ms tradeoff.
  const debouncedValues = useDebounced(values, isClient ? 0 : 250);
  const quickCompute = useQuickCompute();

  // Cache of the last computed KPIs. We keep the previous result visible
  // while a new compute is in flight — that way the UI doesn't flicker
  // empty between scrubs.
  const lastResultRef = useRef(null);
  const [liveKpis, setLiveKpis] = useState(null);
  const [liveError, setLiveError] = useState(null);

  // Fire a compute whenever slider state changes. Client path runs the
  // kernel synchronously; server path goes through the React Query
  // mutation with cancellation for in-flight races.
  useEffect(() => {
    if (!preflight.ok) return;
    if (sliderRows.length === 0) return;
    if (Object.keys(debouncedValues).length === 0) return;

    const raw = { ...(baseInputs || {}), ...debouncedValues };

    if (isClient) {
      const r = clientQuickCompute({ assetClass, ...raw });
      if (r.success) {
        lastResultRef.current = r.data;
        setLiveKpis(r.data?.kpis || null);
        setLiveError(null);
      } else {
        setLiveError(r.message);
      }
      return;
    }

    let cancelled = false;
    quickCompute.mutate(
      { assetClass, ...raw },
      {
        onSuccess: (data) => {
          if (cancelled) return;
          lastResultRef.current = data;
          setLiveKpis(data?.kpis || null);
        },
      },
    );
    return () => { cancelled = true; };
    // quickCompute mutation object is stable across renders — safe to skip
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedValues, assetClass, baseInputs, sliderRows.length, isClient]);

  if (!preflight.ok) {
    return <MissingInputsCard missing={preflight.missing} panelLabel="What-If Sliders" onEditInputs={onEditInputs} />;
  }

  if (sliderRows.length === 0) {
    return null;
  }

  const isDirty = sliderRows.some((r) => {
    const v = values[r.field.key];
    if (v == null) return false;
    const eps = 10 ** -(r.field.decimals + 1);
    return Math.abs(v - r.base) > eps;
  });

  const resetAll = () => {
    const next = {};
    for (const r of sliderRows) next[r.field.key] = r.base;
    setValues(next);
  };

  return (
    <div className="rounded-editorial overflow-hidden bg-bg-elevated border border-hairline shadow-editorial">
      <div className="px-4 py-3 flex items-center justify-between border-b border-hairline bg-bg-secondary">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md flex items-center justify-center bg-accent text-white">
            <Sliders size={14} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-content-primary">What-If Sliders</h3>
            <p className="leading-tight text-[11px] text-content-muted">
              Live kernel re-compute — scrub inputs, watch KPIs move vs. base.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isClient && quickCompute.isPending && (
            <span className="font-medium animate-pulse text-[10px] text-accent">
              Computing…
            </span>
          )}
          <button
            type="button"
            onClick={resetAll}
            disabled={!isDirty}
            className={clsx(
              'font-medium px-2 py-1 rounded transition-colors text-[11px] border bg-transparent',
              isDirty
                ? 'text-content-primary border-hairline cursor-pointer hover:bg-bg-secondary'
                : 'text-content-muted border-hairline-soft cursor-not-allowed',
            )}
          >
            Reset all
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 p-4">
        {/* Sliders — span 3 on large screens */}
        <div className="lg:col-span-3 space-y-3.5">
          {sliderRows.map((r) => (
            <SliderRow
              key={r.field.key}
              field={r.field}
              currentValue={values[r.field.key] ?? r.base}
              range={r.range}
              onChange={(v) => setValues((prev) => ({ ...prev, [r.field.key]: v }))}
              onReset={() => setValues((prev) => ({ ...prev, [r.field.key]: r.base }))}
              isResetDisabled={Math.abs((values[r.field.key] ?? r.base) - r.base) < 10 ** -(r.field.decimals + 1)}
            />
          ))}
        </div>

        {/* KPI cards — span 2 */}
        <div className="lg:col-span-2 grid grid-cols-2 gap-2">
          {KPI_CARDS.map((card) => {
            const baseValue = baseKpis?.[card.key];
            const curr = liveKpis?.[card.key] ?? baseValue;
            return (
              <KPIDelta
                key={card.key}
                baseValue={baseValue}
                currentValue={curr}
                decimals={card.decimals}
                suffix={card.suffix}
                label={card.label}
                good={card.good}
              />
            );
          })}
        </div>
      </div>

      {(liveError || quickCompute.error) && (
        <div className="px-4 py-2 text-xs text-data-negative bg-neg-soft border-t border-hairline">
          Compute failed:{' '}
          {liveError
            || quickCompute.error?.response?.data?.message
            || quickCompute.error?.message
            || 'unknown error'}
        </div>
      )}
    </div>
  );
}
