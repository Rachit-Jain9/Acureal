import { useEffect, useMemo, useState } from 'react';
import {
  Layers, Loader2, ArrowUpRight, ArrowDownRight, Minus, TrendingUp, TrendingDown,
  FileText,
} from 'lucide-react';
import { financialsAPI } from '../../services/api';
import { resolveFinancialModelClass } from '../../utils/assetClasses';
import { preflightDealInput } from '../../utils/dealInputPreflight';
import MissingInputsCard from './MissingInputsCard';

// Per-asset-class scenario perturbations. Each scenario multiplies/adds
// to a set of drivers — the shape is `{ driver: { mult?, add? } }`.
//   mult: final = base * mult     (for ratios / prices)
//   add:  final = base + add      (for percent-point / month counts)
//
// The perturbations are opinionated but grounded: they mirror what an
// IC memo would show for a Bengaluru deal today. Downside and Upside
// are mirrors around Base — the analyst sees a fair, symmetric picture
// unless the driver is naturally one-sided (e.g. duration creep).
const SCENARIO_RECIPES = {
  residential_apartments: {
    downside: {
      label: 'Downside',
      summary: '-10% rate, +7% cost, +3mo delay',
      changes: {
        sellingRatePerSqft:      { mult: 0.90 },
        constructionCostPerSqft: { mult: 1.07 },
        projectDurationMonths:   { add: 3 },
        absorptionMonths:        { add: 6 },
      },
    },
    upside: {
      label: 'Upside',
      summary: '+8% rate, -4% cost, faster sales',
      changes: {
        sellingRatePerSqft:      { mult: 1.08 },
        constructionCostPerSqft: { mult: 0.96 },
        absorptionMonths:        { mult: 0.85 },
      },
    },
  },
  plotted_development: {
    downside: {
      label: 'Downside',
      summary: '-10% rate, +5% cost, slower sales',
      changes: {
        sellingRatePerSqft: { mult: 0.90 },
        devCostPerSqft:     { mult: 1.05 },
        absorptionMonths:   { add: 6 },
      },
    },
    upside: {
      label: 'Upside',
      summary: '+8% rate, faster absorption',
      changes: {
        sellingRatePerSqft: { mult: 1.08 },
        absorptionMonths:   { mult: 0.85 },
      },
    },
  },
  commercial_office: {
    downside: {
      label: 'Downside',
      summary: '-8% rent, +50bps cap, +3pp vacancy',
      changes: {
        baseRentPerSqftMonth: { mult: 0.92 },
        exitCapRate:          { add: 0.50 },
        vacancyPct:           { add: 3 },
      },
    },
    upside: {
      label: 'Upside',
      summary: '+6% rent, -25bps cap, -1pp vacancy',
      changes: {
        baseRentPerSqftMonth: { mult: 1.06 },
        exitCapRate:          { add: -0.25 },
        vacancyPct:           { add: -1 },
      },
    },
  },
  retail: {
    downside: {
      label: 'Downside',
      summary: '-10% rent, +75bps cap, +4pp vacancy',
      changes: {
        baseRentPerSqftMonth: { mult: 0.90 },
        exitCapRate:          { add: 0.75 },
        vacancyPct:           { add: 4 },
      },
    },
    upside: {
      label: 'Upside',
      summary: '+8% rent, -25bps cap',
      changes: {
        baseRentPerSqftMonth: { mult: 1.08 },
        exitCapRate:          { add: -0.25 },
      },
    },
  },
  industrial_warehousing: {
    downside: {
      label: 'Downside',
      summary: '-6% rent, +50bps cap, +3pp vacancy',
      changes: {
        baseRentPerSqftMonth: { mult: 0.94 },
        exitCapRate:          { add: 0.50 },
        vacancyPct:           { add: 3 },
      },
    },
    upside: {
      label: 'Upside',
      summary: '+5% rent, -25bps cap',
      changes: {
        baseRentPerSqftMonth: { mult: 1.05 },
        exitCapRate:          { add: -0.25 },
      },
    },
  },
  hospitality: {
    downside: {
      label: 'Downside',
      summary: '-10% ADR, -5pp occ, +50bps cap',
      changes: {
        adr:              { mult: 0.90 },
        stabilizedOccPct: { add: -5 },
        exitCapRate:      { add: 0.50 },
      },
    },
    upside: {
      label: 'Upside',
      summary: '+8% ADR, +3pp occ, -25bps cap',
      changes: {
        adr:              { mult: 1.08 },
        stabilizedOccPct: { add: 3 },
        exitCapRate:      { add: -0.25 },
      },
    },
  },
  villas: {
    downside: {
      label: 'Downside',
      summary: '-10% rate, +7% cost',
      changes: {
        sellingRatePerSqft:      { mult: 0.90 },
        constructionCostPerSqft: { mult: 1.07 },
      },
    },
    upside: {
      label: 'Upside',
      summary: '+8% rate, -4% cost',
      changes: {
        sellingRatePerSqft:      { mult: 1.08 },
        constructionCostPerSqft: { mult: 0.96 },
      },
    },
  },
  redevelopment: {
    downside: {
      label: 'Downside',
      summary: '-10% rate, +100bps finance',
      changes: {
        sellingRatePerSqft:      { mult: 0.90 },
        constructionCostPerSqft: { mult: 1.07 },
        financeCostPct:          { add: 1.0 },
      },
    },
    upside: {
      label: 'Upside',
      summary: '+8% rate, -50bps finance',
      changes: {
        sellingRatePerSqft:      { mult: 1.08 },
        financeCostPct:          { add: -0.5 },
      },
    },
  },
  mixed_use: {
    downside: {
      label: 'Downside',
      summary: '-10% rate, +7% cost',
      changes: {
        sellingRatePerSqft:      { mult: 0.90 },
        constructionCostPerSqft: { mult: 1.07 },
      },
    },
    upside: {
      label: 'Upside',
      summary: '+8% rate, -4% cost',
      changes: {
        sellingRatePerSqft:      { mult: 1.08 },
        constructionCostPerSqft: { mult: 0.96 },
      },
    },
  },
};

// Kernel returns all KPIs in display units (IRR already in percent form).
const KPI_ROWS = [
  { key: 'irr',            label: 'IRR',          suffix: '%',   decimals: 2, scale: 1,   good: 'up' },
  { key: 'equityMultiple', label: 'Equity Mult.', suffix: '×',   decimals: 2, scale: 1,   good: 'up' },
  { key: 'npv',            label: 'NPV',          suffix: ' Cr', decimals: 2, scale: 1,   good: 'up' },
  { key: 'grossMarginPct', label: 'Gross Margin', suffix: '%',   decimals: 2, scale: 1,   good: 'up' },
  { key: 'revenue',        label: 'Revenue',      suffix: ' Cr', decimals: 2, scale: 1,   good: 'up' },
  { key: 'totalCost',      label: 'Total Cost',   suffix: ' Cr', decimals: 2, scale: 1,   good: 'down' },
];

// Produce the perturbed input set for a scenario. Returns a new shallow
// object — we never mutate the caller's base.
const applyChanges = (baseInputs, changes) => {
  const out = { ...(baseInputs || {}) };
  for (const [key, op] of Object.entries(changes)) {
    const current = Number(out[key]);
    if (!Number.isFinite(current)) continue;
    let next = current;
    if (typeof op.mult === 'number') next *= op.mult;
    if (typeof op.add === 'number')  next += op.add;
    out[key] = next;
  }
  return out;
};

const fmtNumber = (n, decimals) => {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const fmtDelta = (delta, decimals, suffix) => {
  if (!Number.isFinite(delta)) return '—';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${fmtNumber(delta, decimals)}${suffix.trim()}`;
};

function ScenarioHeader({ name, summary, tone, kpisReady }) {
  const palette = {
    downside: {
      bg:     'rgba(239,68,68,0.08)',
      border: 'rgba(239,68,68,0.25)',
      icon:   'var(--color-data-negative)',
      Icon:   TrendingDown,
    },
    base: {
      bg:     'var(--color-surface)',
      border: 'var(--color-border-primary)',
      icon:   'var(--color-text-secondary)',
      Icon:   Minus,
    },
    upside: {
      bg:     'rgba(34,197,94,0.10)',
      border: 'rgba(34,197,94,0.25)',
      icon:   'var(--color-data-positive)',
      Icon:   TrendingUp,
    },
  }[tone];

  return (
    <div
      className="px-3 py-2.5"
      style={{
        backgroundColor: palette.bg,
        borderBottom: `1px solid ${palette.border}`,
      }}
    >
      <div className="flex items-center gap-1.5">
        <palette.Icon size={14} style={{ color: palette.icon }} />
        <span
          className="text-xs font-semibold"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {name}
        </span>
        {!kpisReady && (
          <Loader2
            size={11}
            className="animate-spin ml-auto"
            style={{ color: 'var(--color-text-muted)' }}
          />
        )}
      </div>
      <p
        className="leading-tight mt-0.5"
        style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}
      >
        {summary}
      </p>
    </div>
  );
}

function KPICell({ value, baseValue, row, showDelta, tone }) {
  const scaled = Number.isFinite(value) ? value * row.scale : null;
  const baseScaled = Number.isFinite(baseValue) ? baseValue * row.scale : null;
  const delta = (scaled != null && baseScaled != null) ? scaled - baseScaled : null;

  const eps = 10 ** -(row.decimals + 1);
  const isFlat = delta != null && Math.abs(delta) < eps;
  const isBetter = delta != null && !isFlat && (row.good === 'up' ? delta > 0 : delta < 0);

  const deltaColor = tone === 'base' || isFlat
    ? 'var(--color-text-muted)'
    : isBetter
      ? 'var(--color-data-positive)'
      : 'var(--color-data-negative)';

  const DeltaIcon = isFlat ? Minus : isBetter ? ArrowUpRight : ArrowDownRight;

  return (
    <div
      className="px-3 py-2 last:border-b-0"
      style={{ borderBottom: '1px solid var(--color-border-secondary)' }}
    >
      <div className="flex items-baseline gap-1">
        <span
          className="text-sm font-semibold tabular-nums"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {fmtNumber(scaled, row.decimals)}
        </span>
        <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
          {row.suffix.trim()}
        </span>
      </div>
      {showDelta && tone !== 'base' && delta != null && (
        <div
          className="flex items-center gap-0.5 font-medium mt-0.5 tabular-nums"
          style={{ fontSize: '10px', color: deltaColor }}
        >
          <DeltaIcon size={10} />
          <span>{isFlat ? 'unchanged' : fmtDelta(delta, row.decimals, row.suffix)}</span>
        </div>
      )}
    </div>
  );
}

// Renders one of three columns. `data.kpis` is null until the fetch lands.
function ScenarioColumn({ scenario, baseKpis, showDelta }) {
  return (
    <div
      className="flex-1 min-w-0 rounded-editorial overflow-hidden"
      style={{
        backgroundColor: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-primary)',
      }}
    >
      <ScenarioHeader
        name={scenario.label}
        summary={scenario.summary}
        tone={scenario.tone}
        kpisReady={scenario.kpis != null}
      />
      <div>
        {KPI_ROWS.map((row) => (
          <KPICell
            key={row.key}
            row={row}
            value={scenario.kpis?.[row.key]}
            baseValue={baseKpis?.[row.key]}
            showDelta={showDelta}
            tone={scenario.tone}
          />
        ))}
      </div>
    </div>
  );
}

export default function ScenarioComparison({ assetClass, baseInputs, baseKpis, onEditInputs }) {
  const modelClass = resolveFinancialModelClass(assetClass) || assetClass;
  const recipe = SCENARIO_RECIPES[modelClass] || SCENARIO_RECIPES[assetClass];

  const preflight = preflightDealInput(baseInputs, modelClass);

  const [downKpis,   setDownKpis]   = useState(null);
  const [upKpis,     setUpKpis]     = useState(null);
  const [error,      setError]      = useState(null);
  const [isLoading,  setIsLoading]  = useState(false);
  const [showDelta,  setShowDelta]  = useState(true);

  // Fire downside + upside quick-compute in parallel. No fetch for base —
  // we already have baseKpis from the parent.
  useEffect(() => {
    if (!preflight.ok) {
      setDownKpis(null);
      setUpKpis(null);
      return undefined;
    }
    if (!recipe || !baseInputs) {
      setDownKpis(null);
      setUpKpis(null);
      return undefined;
    }
    let cancelled = false;

    const downInputs = applyChanges(baseInputs, recipe.downside.changes);
    const upInputs   = applyChanges(baseInputs, recipe.upside.changes);

    setIsLoading(true);
    setError(null);
    setDownKpis(null);
    setUpKpis(null);

    Promise.all([
      financialsAPI.quickCompute({ assetClass, ...downInputs }),
      financialsAPI.quickCompute({ assetClass, ...upInputs }),
    ])
      .then(([dRes, uRes]) => {
        if (cancelled) return;
        setDownKpis(dRes.data?.data?.kpis || null);
        setUpKpis(uRes.data?.data?.kpis || null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(
          e.response?.data?.message
          || e.response?.data?.errors?.[0]?.message
          || e.message
          || 'Scenario compute failed',
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [assetClass, baseInputs, recipe]);

  const scenarios = useMemo(() => {
    if (!recipe) return [];
    return [
      { label: recipe.downside.label, summary: recipe.downside.summary, tone: 'downside', kpis: downKpis },
      { label: 'Base',                 summary: 'Current underwriting',  tone: 'base',     kpis: baseKpis   },
      { label: recipe.upside.label,   summary: recipe.upside.summary,   tone: 'upside',   kpis: upKpis     },
    ];
  }, [recipe, downKpis, upKpis, baseKpis]);

  if (!preflight.ok) {
    return <MissingInputsCard missing={preflight.missing} panelLabel="Scenario Comparison" onEditInputs={onEditInputs} />;
  }

  if (!recipe) return null;

  return (
    <div
      className="rounded-editorial overflow-hidden"
      style={{
        backgroundColor: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-primary)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div
        className="px-4 py-3 flex items-center justify-between gap-3"
        style={{
          borderBottom: '1px solid var(--color-border-primary)',
          backgroundColor: 'var(--color-bg-secondary)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
            style={{
              backgroundColor: 'var(--color-brand-premium)',
              color: 'var(--color-bg-primary)',
            }}
          >
            <Layers size={14} />
          </div>
          <div className="min-w-0">
            <h3
              className="text-sm font-semibold"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Scenario Comparison
            </h3>
            <p
              className="leading-tight truncate"
              style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}
            >
              IC-ready downside / base / upside — rerun through the kernel, rows = KPIs, deltas vs base.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isLoading && (
            <span
              className="flex items-center gap-1 font-medium"
              style={{ fontSize: '10px', color: 'var(--color-brand-premium)' }}
            >
              <Loader2 size={12} className="animate-spin" /> Running…
            </span>
          )}
          <label
            className="flex items-center gap-1.5 font-medium cursor-pointer"
            style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}
          >
            <input
              type="checkbox"
              checked={showDelta}
              onChange={(e) => setShowDelta(e.target.checked)}
              className="h-3 w-3 rounded"
              style={{ accentColor: 'var(--color-brand-premium)' }}
            />
            Show deltas
          </label>
        </div>
      </div>

      {error ? (
        <div
          className="px-4 py-3 text-xs"
          style={{
            color: 'var(--color-data-negative)',
            backgroundColor: 'rgba(239,68,68,0.08)',
            borderTop: '1px solid rgba(239,68,68,0.25)',
          }}
        >
          {error}
        </div>
      ) : (
        <>
          <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            {scenarios.map((s) => (
              <ScenarioColumn
                key={s.tone}
                scenario={s}
                baseKpis={baseKpis}
                showDelta={showDelta}
              />
            ))}
          </div>
          <div
            className="px-4 pb-3 flex items-start gap-2"
            style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}
          >
            <FileText size={11} className="mt-[1px] shrink-0" />
            <span>
              Downside/Upside perturbations are asset-class specific and reflect typical
              IC-memo sensitivities for Bengaluru deals. Deltas are shown against the
              current base underwriting, not a macro benchmark — the kernel recomputes the
              full deal for each scenario.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
