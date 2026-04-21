import { useMemo } from 'react';
import { GitCompareArrows, TrendingUp, Wallet, Info, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { computeScenarios, fmtNum, fmtInr } from '../../utils/buildability';

// Side-by-side: Base FSI only vs With Premium FAR.
// Shows realized BUA delta, estimated BDA premium fee, revenue/value uplift,
// and net benefit — so the user can decide whether buying premium is worth it.
export default function ScenarioComparisonCard({ zone, property, assetClass }) {
  const scenarios = useMemo(
    () => computeScenarios({ zone, property, assetClass }),
    [zone, property, assetClass],
  );

  if (!scenarios || !scenarios.has_premium_available) return null;

  const { base_only, with_premium, base_programme, premium_programme,
          delta_bua_sqft, premium_bua_sqft, premium_fee_estimate,
          revenue_delta_inr, value_delta_inr, net_uplift_inr } = scenarios;

  const costRate = premium_programme?.build_cost_per_sqft;
  const additionalBuildCost = costRate != null ? costRate * delta_bua_sqft : null;
  const hasValueUplift = value_delta_inr && value_delta_inr > 0;
  const uplift = hasValueUplift ? value_delta_inr : revenue_delta_inr;
  const feeKnown = premium_fee_estimate?.fee_inr != null;
  const verdict = computeVerdict({ uplift, fee: premium_fee_estimate?.fee_inr, additionalBuildCost, feeKnown });

  return (
    <div className="card-editorial p-0 overflow-hidden">
      <div className="px-5 py-4 bg-gradient-to-r from-indigo-50 via-white to-primary-50 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-primary-500 text-white flex items-center justify-center shadow-sm">
            <GitCompareArrows size={15} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-gray-500">
              Premium FAR decision
            </div>
            <div className="text-sm font-semibold text-gray-800">Base FSI vs With Premium FAR</div>
          </div>
        </div>
        <Verdict verdict={verdict} />
      </div>

      <div className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ScenarioCol
            title="Base FSI only"
            subtitle="Free — no BDA premium payable"
            buildability={base_only}
            programme={base_programme}
            tone="gray"
          />
          <ScenarioCol
            title="With Premium FAR"
            subtitle="Add BDA premium fee, unlock extra BUA"
            buildability={with_premium}
            programme={premium_programme}
            tone="indigo"
            highlight
          />
        </div>

        {/* Delta summary */}
        <div className="mt-4 rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/50 to-white p-4">
          <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-indigo-700 mb-3 flex items-center gap-1.5">
            <Sparkles size={11} /> Incremental impact of going premium
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <DeltaTile
              icon={TrendingUp}
              label="Extra built-up"
              value={fmtNum(delta_bua_sqft)}
              unit="sqft"
              hint={`${fmtNum(premium_bua_sqft)} sqft premium FAR BUA`}
              tone="emerald"
            />
            <DeltaTile
              icon={Wallet}
              label="BDA premium fee"
              value={feeKnown ? fmtInr(premium_fee_estimate.fee_inr) : 'Set circle rate'}
              hint={premium_fee_estimate?.note}
              tone="amber"
              negative={feeKnown}
            />
            <DeltaTile
              icon={TrendingUp}
              label={hasValueUplift ? 'Asset-value uplift' : 'Revenue uplift'}
              value={uplift ? fmtInr(uplift) : '\u2014'}
              hint={hasValueUplift
                ? 'stabilised value at same cap rate'
                : 'sale-out revenue at market rate'}
              tone="indigo"
            />
            <DeltaTile
              icon={TrendingUp}
              label="Net uplift"
              value={feeKnown && uplift != null ? fmtInr(net_uplift_inr) : '\u2014'}
              hint={feeKnown && uplift != null
                ? 'uplift − premium fee (ex. extra build cost)'
                : 'needs circle rate to compute'}
              tone={net_uplift_inr > 0 ? 'emerald' : 'rose'}
              strong
            />
          </div>
          {additionalBuildCost != null && (
            <div className="mt-3 text-[11px] text-gray-500 flex items-start gap-1.5">
              <Info size={11} className="mt-0.5 flex-shrink-0" />
              <span>
                Additional construction cost to realize the extra BUA:
                <span className="ml-1 font-semibold text-gray-700">{fmtInr(additionalBuildCost)}</span>.
                Subtract from net uplift for a full economic view.
              </span>
            </div>
          )}
        </div>

        <div className="mt-3 text-[11px] text-gray-500 italic">
          Premium FAR fee is a planning-grade estimate at 40% of circle rate per sqft on the
          additional BUA — actual charge depends on RMP 2031 road-width tier and current
          BDA / BBMP rate schedule. Use your authority reference rates for the final number.
        </div>
      </div>
    </div>
  );
}

// -- pieces -----------------------------------------------------------------

function ScenarioCol({ title, subtitle, buildability, programme, tone, highlight }) {
  const tones = {
    gray:   'border-gray-200 bg-gradient-to-br from-gray-50/80 to-white',
    indigo: 'border-indigo-200 bg-gradient-to-br from-indigo-50/70 via-white to-primary-50/40 shadow-sm',
  };
  return (
    <div className={clsx('rounded-xl border p-4 relative', tones[tone] || tones.gray)}>
      {highlight && (
        <span className="absolute -top-2 right-3 text-[9px] px-2 py-0.5 rounded-full bg-indigo-600 text-white font-semibold uppercase tracking-wider">
          Max envelope
        </span>
      )}
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-800">{title}</div>
          <div className="text-[11px] text-gray-500">{subtitle}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <ScenStat label="Effective FSI" value={fmtNum(buildability.effective_fsi, 2)} />
        <ScenStat label="Realized BUA" value={fmtNum(buildability.realized_built_up_sqft)} unit="sqft" />
        <ScenStat label="Max floors" value={fmtNum(buildability.max_floors, 0)} />
        {programme?.unit_count != null ? (
          <ScenStat label={programme.group === 'commercial' ? 'Workstations' : 'Units'} value={fmtNum(programme.unit_count, 0)} />
        ) : programme?.leasable_sqft != null ? (
          <ScenStat label="Leasable" value={fmtNum(programme.leasable_sqft)} unit="sqft" />
        ) : programme?.keys != null ? (
          <ScenStat label="Keys" value={fmtNum(programme.keys, 0)} />
        ) : (
          <ScenStat label="Footprint" value={fmtNum(buildability.typical_footprint_sqft)} unit="sqft" />
        )}
      </div>

      {programme?.gross_revenue_inr != null && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
          <span className="text-gray-500">{programme.group === 'commercial' || programme.group === 'industrial' ? 'Stabilised rent (pa)' : 'Gross revenue'}</span>
          <span className="font-semibold text-gray-800">{fmtInr(programme.gross_revenue_inr)}</span>
        </div>
      )}
      {programme?.stabilised_value_inr != null && (
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className="text-gray-500">Stabilised value</span>
          <span className="font-semibold text-gray-800">{fmtInr(programme.stabilised_value_inr)}</span>
        </div>
      )}
    </div>
  );
}

function ScenStat({ label, value, unit }) {
  return (
    <div className="rounded-lg bg-white/60 border border-white px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-[0.08em] text-gray-500 font-medium">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-base font-bold text-gray-800 leading-tight">{value}</span>
        {unit && <span className="text-[10px] text-gray-500">{unit}</span>}
      </div>
    </div>
  );
}

function DeltaTile({ icon: Icon, label, value, unit, hint, tone, negative, strong }) {
  const tones = {
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-900',
    amber:   'bg-amber-50 border-amber-100 text-amber-900',
    indigo:  'bg-indigo-50 border-indigo-100 text-indigo-900',
    rose:    'bg-rose-50 border-rose-100 text-rose-900',
  };
  return (
    <div className={clsx('rounded-lg border p-2.5', tones[tone] || tones.indigo)}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] font-medium opacity-75">
        {Icon && <Icon size={10} />}
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={clsx('leading-tight', strong ? 'text-lg font-bold' : 'text-base font-semibold')}>
          {negative && typeof value === 'string' && value.startsWith('\u20b9') ? `\u2212${value.slice(1)}` : value}
        </span>
        {unit && <span className="text-[10px] opacity-60">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[10px] opacity-70">{hint}</div>}
    </div>
  );
}

function Verdict({ verdict }) {
  if (!verdict) return null;
  const tones = {
    go:      'bg-emerald-100 text-emerald-800 border border-emerald-200',
    noGo:    'bg-rose-100 text-rose-800 border border-rose-200',
    unknown: 'bg-gray-100 text-gray-700 border border-gray-200',
  };
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-semibold', tones[verdict.key])}>
      {verdict.icon}
      {verdict.label}
    </span>
  );
}

function computeVerdict({ uplift, fee, additionalBuildCost, feeKnown }) {
  if (!feeKnown || uplift == null) {
    return { key: 'unknown', label: 'Set circle rate to evaluate', icon: <Info size={11} /> };
  }
  const fullCost = (fee ?? 0) + (additionalBuildCost ?? 0);
  const roi = fullCost > 0 ? uplift / fullCost : null;
  if (roi != null && roi > 1.3) return { key: 'go', label: `Premium likely accretive · ${roi.toFixed(2)}× on fee+build`, icon: <TrendingUp size={11} /> };
  if (roi != null && roi < 1.0) return { key: 'noGo', label: `Premium dilutive · ${roi.toFixed(2)}×`, icon: <Info size={11} /> };
  return { key: 'unknown', label: `Marginal · ${roi ? roi.toFixed(2) + '×' : '—'}`, icon: <Info size={11} /> };
}
