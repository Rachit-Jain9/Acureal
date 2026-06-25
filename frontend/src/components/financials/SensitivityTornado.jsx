import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Loader2, Info } from 'lucide-react';
import { runQuickCompute } from '../../utils/quickCompute';
import { useDefaultsMeta } from '../../hooks/useFinancials';
import { resolveFinancialModelClass } from '../../utils/assetClasses';
import { preflightDealInput } from '../../utils/dealInputPreflight';
import MissingInputsCard from './MissingInputsCard';

// Variables to perturb per asset class. Keys MUST exist in the kernel's
// input schema for `computeDeal({ raw })` — we stick to fields that
// WhatIfSliders already uses plus a few more the schema supports, so we
// don't silently ship a broken tornado the user can't interpret.
const TORNADO_VARS = {
  residential_apartments: [
    { key: 'sellingRatePerSqft',      label: 'Selling Rate' },
    { key: 'constructionCostPerSqft', label: 'Construction Cost' },
    { key: 'landCostCr',              label: 'Land Cost' },
    { key: 'financeCostPct',          label: 'Finance Rate' },
    { key: 'projectDurationMonths',   label: 'Project Duration' },
    { key: 'marketingCostPct',        label: 'Marketing Cost' },
  ],
  plotted_development: [
    { key: 'sellingRatePerSqft', label: 'Selling Rate' },
    { key: 'devCostPerSqft',     label: 'Development Cost' },
    { key: 'landCostCr',         label: 'Land Cost' },
    { key: 'saleableLandPct',    label: 'Saleable %' },
    { key: 'debtRatePct',        label: 'Debt Rate' },
  ],
  commercial_office: [
    { key: 'baseRentPerSqftMonth',   label: 'Base Rent' },
    { key: 'exitCapRate',            label: 'Exit Cap Rate' },
    { key: 'vacancyPct',             label: 'Vacancy' },
    { key: 'constructionCostPerSqft', label: 'Construction Cost' },
    { key: 'rentEscalationPct',      label: 'Rent Escalation' },
    { key: 'landCostCr',             label: 'Land Cost' },
  ],
  retail: [
    { key: 'baseRentPerSqftMonth',   label: 'Base Rent' },
    { key: 'exitCapRate',            label: 'Exit Cap Rate' },
    { key: 'vacancyPct',             label: 'Vacancy' },
    { key: 'constructionCostPerSqft', label: 'Construction Cost' },
    { key: 'rentEscalationPct',      label: 'Rent Escalation' },
    { key: 'landCostCr',             label: 'Land Cost' },
  ],
  industrial_warehousing: [
    { key: 'baseRentPerSqftMonth',   label: 'Base Rent' },
    { key: 'exitCapRate',            label: 'Exit Cap Rate' },
    { key: 'vacancyPct',             label: 'Vacancy' },
    { key: 'constructionCostPerSqft', label: 'Construction Cost' },
    { key: 'landCostCr',             label: 'Land Cost' },
  ],
  hospitality: [
    { key: 'adr',                      label: 'ADR' },
    { key: 'stabilizedOccPct',         label: 'Stabilized Occupancy' },
    { key: 'exitCapRate',              label: 'Exit Cap Rate' },
    { key: 'constructionCostPerKey',   label: 'Construction / Key' },
    { key: 'gopMarginPct',             label: 'GOP Margin' },
    { key: 'landCostCr',               label: 'Land Cost' },
  ],
  villas: [
    { key: 'sellingRatePerSqft', label: 'Selling Rate' },
    { key: 'constructionCostPerSqft', label: 'Construction Cost' },
    { key: 'landCostCr',              label: 'Land Cost' },
  ],
  redevelopment: [
    { key: 'sellingRatePerSqft',      label: 'Selling Rate' },
    { key: 'constructionCostPerSqft', label: 'Construction Cost' },
    { key: 'financeCostPct',          label: 'Finance Rate' },
  ],
  mixed_use: [
    { key: 'sellingRatePerSqft',      label: 'Selling Rate' },
    { key: 'constructionCostPerSqft', label: 'Construction Cost' },
    { key: 'landCostCr',              label: 'Land Cost' },
  ],
};

// Kernel returns all KPIs in display units (IRR already in percent form).
const KPI_OPTIONS = [
  { key: 'irr',            label: 'IRR',          suffix: '%',   decimals: 2, scale: 1   },
  { key: 'npv',            label: 'NPV',          suffix: ' Cr', decimals: 2, scale: 1   },
  { key: 'equityMultiple', label: 'Equity Mult.', suffix: '×',   decimals: 2, scale: 1   },
  { key: 'grossMarginPct', label: 'Gross Margin', suffix: '%',   decimals: 2, scale: 1   },
];

const PERTURBATION_PCT = 0.15;

const metaFor = (defaults, key) => {
  if (!defaults) return null;
  if (defaults[key]) return defaults[key];
  if (defaults[`${key}Pct`]) return defaults[`${key}Pct`];
  return null;
};

// Pick a symmetric ±15% window around the current value, clipped to the
// defaults-registry declared range when one exists. This keeps every
// variable on equal footing (same relative swing) so the tornado reads
// as impact-per-unit-uncertainty, not impact-per-crazy-stretch.
//
// If the base value is integer-typed (e.g. projectDurationMonths,
// holdPeriodYears, keys) the perturbed bounds are rounded to the nearest
// int — the backend validator declares those fields `isInt` and would
// otherwise reject the fan-out request with a 400.
const pickBounds = (current, meta) => {
  const isIntTyped = Number.isInteger(current);
  let low  = current * (1 - PERTURBATION_PCT);
  let high = current * (1 + PERTURBATION_PCT);
  if (Array.isArray(meta?.range) && meta.range.length === 2) {
    const [rlo, rhi] = meta.range.map(Number);
    if (Number.isFinite(rlo) && Number.isFinite(rhi) && rhi > rlo) {
      low  = Math.max(rlo, low);
      high = Math.min(rhi, high);
    }
  }
  if (isIntTyped) {
    low  = Math.round(low);
    high = Math.round(high);
  }
  return [low, high];
};

const fmtDelta = (delta, decimals, suffix) => {
  if (!Number.isFinite(delta)) return '—';
  const sign = delta > 0 ? '+' : '';
  const trimmed = delta.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${sign}${trimmed}${suffix.trim()}`;
};

export default function SensitivityTornado({ assetClass, baseInputs, baseKpis, onEditInputs }) {
  const modelClass = resolveFinancialModelClass(assetClass) || assetClass;
  const { data: defaultsData } = useDefaultsMeta(modelClass);
  const defaults = defaultsData?.effective || null;

  const preflight = preflightDealInput(baseInputs, assetClass);

  const [kpiKey, setKpiKey] = useState('irr');
  const [isComputing, setIsComputing] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  const varList = useMemo(
    () => TORNADO_VARS[assetClass] || TORNADO_VARS[modelClass] || [],
    [modelClass, assetClass],
  );

  const kpi = useMemo(
    () => KPI_OPTIONS.find((o) => o.key === kpiKey) || KPI_OPTIONS[0],
    [kpiKey],
  );

  // Fire 2N quick-compute calls in parallel on mount (and whenever the
  // base inputs or asset class change). The kernel endpoint is stateless
  // and cheap, so running a fan-out of ~14 requests is fine — the
  // `cancelled` flag guards against result bleed if the user switches
  // classes mid-flight.
  useEffect(() => {
    if (!preflight.ok) {
      setResults([]);
      return undefined;
    }
    if (varList.length === 0 || !baseInputs) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;

    const buildPayload = (overrides) => ({
      assetClass,
      ...(baseInputs || {}),
      ...overrides,
    });

    const run = async () => {
      setIsComputing(true);
      setError(null);
      try {
        const tasks = [];
        for (const v of varList) {
          const current = Number(baseInputs?.[v.key]);
          const meta = metaFor(defaults, v.key);
          const fallbackValue = Number(meta?.value);
          const usedCurrent = Number.isFinite(current) ? current : fallbackValue;
          if (!Number.isFinite(usedCurrent) || usedCurrent === 0) continue;

          const [lo, hi] = pickBounds(usedCurrent, meta);
          if (!(hi > lo)) continue;

          tasks.push(
            Promise.all([
              runQuickCompute(buildPayload({ [v.key]: lo })),
              runQuickCompute(buildPayload({ [v.key]: hi })),
            ]).then(([downRes, upRes]) => ({
              v,
              current: usedCurrent,
              low: lo,
              high: hi,
              downKpis: downRes?.kpis || null,
              upKpis:   upRes?.kpis   || null,
            })),
          );
        }

        const settled = await Promise.all(tasks);
        if (cancelled) return;
        setResults(settled);
      } catch (e) {
        if (cancelled) return;
        setError(
          e.response?.data?.message
          || e.response?.data?.errors?.[0]?.message
          || e.message
          || 'Sensitivity run failed',
        );
      } finally {
        if (!cancelled) setIsComputing(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [assetClass, baseInputs, defaults, varList]);

  // Translate raw KPI swings into display-unit deltas, rank by magnitude.
  const bars = useMemo(() => {
    if (!baseKpis) return [];
    const baseVal = Number(baseKpis[kpi.key]);
    if (!Number.isFinite(baseVal)) return [];

    const rows = [];
    for (const r of results) {
      const down = Number(r.downKpis?.[kpi.key]);
      const up   = Number(r.upKpis?.[kpi.key]);
      if (!Number.isFinite(down) || !Number.isFinite(up)) continue;
      const deltaDown = (down - baseVal) * kpi.scale;
      const deltaUp   = (up   - baseVal) * kpi.scale;
      const magnitude = Math.max(Math.abs(deltaDown), Math.abs(deltaUp));
      if (magnitude === 0) continue;
      rows.push({
        label: r.v.label,
        down: deltaDown,
        up:   deltaUp,
        magnitude,
        low:  r.low,
        high: r.high,
        current: r.current,
      });
    }
    rows.sort((a, b) => b.magnitude - a.magnitude);
    return rows;
  }, [results, baseKpis, kpi]);

  const maxMagnitude = bars.length > 0 ? bars[0].magnitude : 0;

  if (!preflight.ok) {
    return <MissingInputsCard missing={preflight.missing} panelLabel="Sensitivity Tornado" onEditInputs={onEditInputs} />;
  }

  if (varList.length === 0) return null;

  return (
    <div className="rounded-editorial overflow-hidden bg-bg-elevated border border-hairline shadow-editorial">
      <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-hairline bg-bg-secondary">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-data-highlight text-white">
            <BarChart3 size={14} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-content-primary">Sensitivity Tornado</h3>
            <p className="leading-tight truncate text-[11px] text-content-muted">
              Each bar: {kpi.label} change when the input swings ±15% around base. Ranked by impact.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isComputing && (
            <span className="flex items-center gap-1 font-medium text-[10px] text-data-highlight">
              <Loader2 size={12} className="animate-spin" />
              Running {varList.length * 2} scenarios…
            </span>
          )}
          <label className="font-medium text-[11px] text-content-secondary">
            KPI:
            <select
              value={kpiKey}
              onChange={(e) => setKpiKey(e.target.value)}
              className="ml-1.5 font-medium px-2 py-1 rounded cursor-pointer focus:outline-none text-[11px] border border-hairline bg-bg-elevated text-content-primary"
            >
              {KPI_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error ? (
        <div className="px-4 py-3 text-xs text-data-negative bg-neg-soft border-t border-hairline">
          {error}
        </div>
      ) : bars.length === 0 && !isComputing ? (
        <div className="px-4 py-6 text-center text-xs text-content-muted">
          No variable in this model moves {kpi.label} by a measurable amount.
        </div>
      ) : (
        <div className="p-4">
          <TornadoChart bars={bars} maxMagnitude={maxMagnitude} kpi={kpi} />
          <div className="mt-4 pt-3 flex items-start gap-2 text-[10px] text-content-muted border-t border-hairline-soft">
            <Info size={11} className="mt-[1px] shrink-0" />
            <span>
              Left bar = KPI at 15% below base value. Right bar = KPI at 15% above. Color
              reflects whether the move helps (green) or hurts (red) the deal — the
              direction is set by the kernel's computed return, not by an asset-class
              heuristic.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Map dynamic per-bar fill colors (driven by JS state from kernel-computed
// up/down deltas) onto CSS-var-backed values. The colors themselves must be
// inline since they're computed per-bar, but routing through CSS vars means
// theme switching still works.
const POSITIVE = 'var(--color-data-positive)';
const NEGATIVE = 'var(--color-data-negative)';

function TornadoChart({ bars, maxMagnitude, kpi }) {
  return (
    <div className="space-y-1.5">
      {bars.map((b) => {
        const downPct = maxMagnitude > 0 ? Math.min(50, (Math.abs(b.down) / maxMagnitude) * 50) : 0;
        const upPct   = maxMagnitude > 0 ? Math.min(50, (Math.abs(b.up)   / maxMagnitude) * 50) : 0;
        const downLeft = 50 - downPct;

        const downFill = b.down < 0 ? NEGATIVE : POSITIVE;
        const upFill   = b.up   > 0 ? POSITIVE : NEGATIVE;
        const downLabelColor = b.down < 0 ? NEGATIVE : POSITIVE;
        const upLabelColor   = b.up   > 0 ? POSITIVE : NEGATIVE;

        return (
          <div
            key={b.label}
            className="grid grid-cols-[8rem_1fr_9rem] items-center gap-3 text-xs group"
            title={`Base ${b.current.toLocaleString('en-IN')} → tested ${b.low.toLocaleString('en-IN')} … ${b.high.toLocaleString('en-IN')}`}
          >
            <div className="font-medium truncate text-right text-content-secondary">
              {b.label}
            </div>
            <div className="relative h-7">
              <div className="absolute inset-y-0 left-1/2 w-px bg-hairline-strong" />
              <div
                className="absolute top-1 bottom-1 rounded-l-sm transition-all duration-300 opacity-85"
                style={{
                  left: `${downLeft}%`,
                  width: `${downPct}%`,
                  backgroundColor: downFill,
                }}
              />
              <div
                className="absolute top-1 bottom-1 rounded-r-sm transition-all duration-300 opacity-85"
                style={{
                  left: '50%',
                  width: `${upPct}%`,
                  backgroundColor: upFill,
                }}
              />
            </div>
            <div className="flex items-center justify-between tabular-nums font-medium text-[10.5px]">
              <span style={{ color: downLabelColor }}>
                {fmtDelta(b.down, kpi.decimals, kpi.suffix)}
              </span>
              <span className="text-content-muted opacity-60">|</span>
              <span style={{ color: upLabelColor }}>
                {fmtDelta(b.up, kpi.decimals, kpi.suffix)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
