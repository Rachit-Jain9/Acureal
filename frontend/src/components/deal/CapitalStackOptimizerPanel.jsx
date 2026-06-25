import { useState } from 'react';
import { Banknote, ChevronRight, ChevronDown, Sparkles, CheckCircle2, XCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { useDealCapitalStack } from '../../hooks/useDealContext';

/**
 * CapitalStackOptimizerPanel — Phase 2 / Pillar 3 (second half), closes Phase 2.
 *
 * For the deal's asset class + kernel-computed financial summary, proposes
 * three capital-stack scenarios (Conservative / Base / Aggressive) and
 * checks each against Indian-bank covenant bands (LTV, LTC, stabilized DSCR).
 *
 * Each scenario carries:
 *   • Verdict from the closed dictionary (Recommend / Consider / Re-examine /
 *     Stress-test / Flag).
 *   • 0-100 score + score bar.
 *   • 3-line rationale led by the stack mix and the covenant signal.
 *   • Expandable: stack mix (equity / CF / pref / mezz percentages and rupee
 *     amounts), covenant checks (each with pass/fail + threshold), the five
 *     sub-factor scores.
 *
 * Pure compute, deterministic. No AI narration on this panel.
 *
 * Empty states honest:
 *   • no asset class           → "set an asset class to score"
 *   • no kernel run            → "run the financial model"
 *   • incomplete kernel output → "kernel output incomplete"
 */

const VERDICT_TONE = {
  Recommend:    'bg-pos-soft text-data-positive border-hairline',
  Consider:     'bg-accent-soft text-accent border-hairline',
  'Re-examine': 'bg-premium-soft text-premium border-hairline',
  'Stress-test':'bg-premium-soft text-premium border-hairline',
  Flag:         'bg-neg-soft text-data-negative border-hairline',
};

const BAND_BAR = {
  high:   'bg-data-positive',
  medium: 'bg-premium',
  low:    'bg-content-muted',
};

const FACTOR_LABEL = {
  covenant_compliance: 'Covenant compliance',
  debt_serviceability: 'Debt serviceability',
  capital_efficiency:  'Capital efficiency',
  cost_of_capital:     'Cost of capital',
  flexibility:         'Structural flexibility',
};

const fmtCr = (v) => {
  if (v == null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
};

const fmtPct = (v, decimals = 0) => {
  if (v == null) return '—';
  const n = Number(v) * 100;
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(decimals)}%`;
};

const fmtMultiple = (v, decimals = 2) => {
  if (v == null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(decimals)}×`;
};

function ScoreBar({ score, band }) {
  const pct = Math.max(0, Math.min(100, Number(score) || 0));
  return (
    <div className="w-full h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
      <div
        className={clsx('h-full transition-all duration-500 ease-out', BAND_BAR[band] || BAND_BAR.low)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function StackMixGrid({ mix, amounts }) {
  const rows = [
    { key: 'equity',               label: 'Equity',               pct: mix.equity_pct,               cr: amounts.equity },
    { key: 'construction_finance', label: 'Construction Finance', pct: mix.construction_finance_pct, cr: amounts.construction_finance },
    { key: 'pref_equity',          label: 'Preferred Equity',     pct: mix.pref_equity_pct,          cr: amounts.pref_equity },
    { key: 'mezz',                 label: 'Mezzanine',            pct: mix.mezz_pct,                 cr: amounts.mezz },
  ];
  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase tracking-wider text-content-muted font-medium mb-1">
        Capital stack mix
      </div>
      {/* Visual proportion bar */}
      <div className="flex w-full h-2 rounded-sm overflow-hidden border border-bg-tertiary mb-1">
        <div className="h-full bg-content-muted" style={{ width: `${mix.equity_pct}%` }} title={`Equity ${mix.equity_pct}%`} />
        <div className="h-full bg-accent" style={{ width: `${mix.construction_finance_pct}%` }} title={`Construction Finance ${mix.construction_finance_pct}%`} />
        <div className="h-full bg-premium" style={{ width: `${mix.pref_equity_pct}%` }} title={`Pref Equity ${mix.pref_equity_pct}%`} />
        <div className="h-full bg-data-highlight" style={{ width: `${mix.mezz_pct}%` }} title={`Mezzanine ${mix.mezz_pct}%`} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs">
        {rows.map((r) => (
          <div key={r.key} className="bg-bg-secondary rounded p-1.5">
            <div className="text-[10px] text-content-muted">{r.label}</div>
            <div className="text-sm font-semibold text-content-primary tabular-nums">
              {r.pct}%
            </div>
            <div className="text-[10px] text-content-muted tabular-nums">{fmtCr(r.cr)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CovenantRow({ label, item, formatValue }) {
  if (!item) {
    return (
      <div className="flex items-center justify-between text-xs py-0.5">
        <span className="text-content-muted">{label}</span>
        <span className="text-content-muted">not computed</span>
      </div>
    );
  }
  const Icon = item.passes ? CheckCircle2 : XCircle;
  const tone = item.passes ? 'text-data-positive' : 'text-data-negative';
  return (
    <div className="flex items-center justify-between text-xs py-0.5 tabular-nums">
      <div className="flex items-center gap-1.5">
        <Icon size={12} className={tone} />
        <span className="text-content-secondary">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={clsx('font-medium', item.passes ? 'text-content-primary' : 'text-data-negative')}>
          {formatValue(item.value)}
        </span>
        <span className="text-content-muted text-[10px]">
          {label === 'DSCR' ? `≥ ${formatValue(item.threshold)}` : `≤ ${formatValue(item.threshold)}`}
        </span>
      </div>
    </div>
  );
}

function CovenantsBlock({ covenants }) {
  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase tracking-wider text-content-muted font-medium mb-1">
        Covenant checks
      </div>
      <div className="space-y-0">
        <CovenantRow label="LTV" item={covenants.ltv} formatValue={(v) => fmtPct(v, 0)} />
        <CovenantRow label="LTC" item={covenants.ltc} formatValue={(v) => fmtPct(v, 0)} />
        <CovenantRow label="DSCR" item={covenants.dscr} formatValue={(v) => fmtMultiple(v)} />
      </div>
    </div>
  );
}

function FactorBreakdown({ factors }) {
  return (
    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
      {Object.entries(factors).map(([key, f]) => (
        <div key={key} className="text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-content-secondary font-medium">{FACTOR_LABEL[key] || key}</span>
            <span className="text-content-muted tabular-nums shrink-0">
              {f.score} / {f.of}
            </span>
          </div>
          <div className="text-content-muted leading-snug">{f.signal}</div>
        </div>
      ))}
    </div>
  );
}

function ScenarioRow({ entry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-hairline last:border-0 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {open ? (
              <ChevronDown size={12} className="text-content-muted shrink-0" />
            ) : (
              <ChevronRight size={12} className="text-content-muted shrink-0" />
            )}
            <span className="text-sm font-medium text-content-primary truncate">{entry.label}</span>
            <span
              className={clsx(
                'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border shrink-0',
                VERDICT_TONE[entry.verdict] || VERDICT_TONE.Flag,
              )}
            >
              {entry.verdict}
            </span>
          </div>
          <span className="text-sm font-semibold text-content-primary tabular-nums shrink-0">
            {entry.score}
            <span className="text-content-muted font-normal text-xs">/100</span>
          </span>
        </div>

        <div className="mt-1.5">
          <ScoreBar score={entry.score} band={entry.band} />
        </div>

        <ul className="mt-1.5 space-y-0.5">
          {entry.rationale.map((r, i) => (
            <li key={i} className="text-xs text-content-secondary leading-snug">
              {r}
            </li>
          ))}
        </ul>
      </button>

      {open && (
        <>
          <StackMixGrid mix={entry.mix} amounts={entry.amounts_cr} />
          {entry.covenants && <CovenantsBlock covenants={entry.covenants} />}
          {entry.factors && <FactorBreakdown factors={entry.factors} />}
        </>
      )}
    </div>
  );
}

export default function CapitalStackOptimizerPanel() {
  const slice = useDealCapitalStack();
  const { scenarios = [], reason, inputs } = slice;

  if (reason === 'no_asset_class') {
    return (
      <div className="card-editorial">
        <h3 className="text-base font-semibold text-content-primary flex items-center gap-2 mb-2">
          <Banknote size={16} className="text-content-muted" />
          Capital-Stack Optimizer
        </h3>
        <div className="text-sm text-content-muted py-2">
          Set an asset class for this deal to score capital-stack scenarios.
        </div>
      </div>
    );
  }

  if (reason === 'no_financial_model') {
    return (
      <div className="card-editorial">
        <h3 className="text-base font-semibold text-content-primary flex items-center gap-2 mb-2">
          <Banknote size={16} className="text-content-muted" />
          Capital-Stack Optimizer
        </h3>
        <div className="text-sm text-content-muted py-2">
          Run the financial model on the Financial tab to see capital-stack scenarios — the
          optimizer reads total project cost and stabilized DSCR from the kernel.
        </div>
      </div>
    );
  }

  if (reason === 'incomplete_kernel_output') {
    return (
      <div className="card-editorial">
        <h3 className="text-base font-semibold text-content-primary flex items-center gap-2 mb-2">
          <Banknote size={16} className="text-content-muted" />
          Capital-Stack Optimizer
        </h3>
        <div className="text-sm text-content-muted py-2">
          The financial model has incomplete kernel output — total project cost is missing.
          Recompute the model on the Financial tab.
        </div>
      </div>
    );
  }

  if (reason === 'unavailable' || scenarios.length === 0) {
    return null;
  }

  const top = scenarios[0];

  return (
    <div className="card-editorial">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
            <Banknote size={16} className="text-content-muted" />
            Capital-Stack Optimizer
          </h3>
          <div className="text-xs text-content-secondary mt-1">
            Three scenarios scored on covenant compliance (LTV / LTC / DSCR), debt serviceability,
            capital efficiency, cost of capital, and structural flexibility.
            {inputs && inputs.total_cost_cr != null && (
              <span className="ml-1 text-content-muted">
                Project cost {fmtCr(inputs.total_cost_cr)}
                {inputs.stabilized_dscr != null && ` · DSCR ${fmtMultiple(inputs.stabilized_dscr)}`}
                {inputs.gross_sales_value_cr != null && ` · GSV ${fmtCr(inputs.gross_sales_value_cr)}`}
              </span>
            )}
          </div>
        </div>
        {top && (
          <span className="text-[10px] uppercase tracking-wider text-content-muted shrink-0 flex items-center gap-1">
            <Sparkles size={11} />
            Top fit: <span className="text-content-primary font-medium normal-case tracking-normal">{top.label}</span>
          </span>
        )}
      </div>

      <div>
        {scenarios.map((entry) => (
          <ScenarioRow key={entry.scenario} entry={entry} />
        ))}
      </div>

      <div className="mt-3 pt-2 border-t border-hairline text-[10px] text-content-muted italic">
        Scenarios use Indian-market covenant baselines (HDFC / Axis / ICICI lending norms).
        Numbers are deterministic — no AI. Click any scenario to see the stack mix,
        covenant checks, and five factor breakdowns.
      </div>
    </div>
  );
}
