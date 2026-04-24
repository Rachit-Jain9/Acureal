import { useMemo } from 'react';
import {
  Layers, Home, Briefcase, Hotel, Warehouse, Factory, Cpu, Heart,
  GraduationCap, Store, TreePine, Users, Building2, Info,
  ArrowRight, IndianRupee,
} from 'lucide-react';
import { clsx } from 'clsx';
import { computeProgramme, fmtNum, fmtInr } from '../../utils/buildability';
import { mapProgrammeToInputs, stashPrefill } from '../../utils/programmeToInputs';
import { toast } from '../common/Toast';

// Asset-class glyph. Single monochrome icon — no colored chips or tone
// gradients. The editorial design anchors on typography, not decoration.
const CLASS_ICON = {
  residential_apartments: Home,
  residential_villas:     Home,
  plotted_development:    TreePine,
  commercial_office:      Briefcase,
  commercial_retail:      Store,
  mixed_use:              Building2,
  industrial:             Factory,
  warehousing:            Warehouse,
  hospitality:            Hotel,
  data_center:            Cpu,
  senior_living:          Users,
  student_housing:        Users,
  healthcare:             Heart,
  education:              GraduationCap,
};

export default function AssetClassProgrammeCard({ buildability, property, dealId, setTab }) {
  const programme = useMemo(
    () => computeProgramme({ buildability, property }),
    [buildability, property],
  );

  if (!programme) return null;
  const Icon = CLASS_ICON[programme.asset_class] || Layers;

  const canApply = !!dealId && programme.has_programme
    && (programme.unit_count != null || programme.keys != null || programme.leasable_sqft != null
        || programme.build_cost_per_sqft != null);

  const handleApply = () => {
    const prefill = mapProgrammeToInputs({
      assetClass: programme.asset_class,
      programme,
      buildability,
    });
    if (!prefill) {
      toast.info('Nothing to apply — programme has no inputs mappable to the financial model yet.');
      return;
    }
    stashPrefill(dealId, prefill);
    toast.success('Buildability inputs staged for underwriting. Open the Financial tab to review.');
    if (typeof setTab === 'function') setTab('financials');
  };

  return (
    <div className="rounded-lg border border-line bg-paper-100 shadow-editorial overflow-hidden">
      {/* Editorial header — no gradient, hairline separator */}
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 border-b border-line">
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md border border-line bg-paper-200 text-ink-700">
            <Icon size={16} strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <p className="eyebrow">Development programme</p>
            <p className="mt-0.5 font-display text-lg font-semibold leading-tight text-ink-900 dark:text-white truncate">
              {programme.profile_label || 'Programme'}
            </p>
            {programme.has_programme && buildability?.realized_built_up_sqft != null && (
              <p className="mt-1 text-caption text-ink-500">
                Derived from <span className="tabular-nums">{fmtNum(buildability.realized_built_up_sqft)}</span> sqft realized envelope
              </p>
            )}
          </div>
        </div>
        {canApply && (
          <button
            type="button"
            onClick={handleApply}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-800 bg-ink-900 px-3 py-1.5 text-caption font-medium text-white transition-colors hover:bg-ink-800 focus:outline-none focus:ring-2 focus:ring-ink-300 focus:ring-offset-1 dark:hover:bg-white"
            title="Stage these programme outputs as starting inputs on the Financial tab"
          >
            Apply to underwriting
            <ArrowRight size={12} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="p-5">
        {!programme.has_programme ? (
          <p className="flex items-center gap-1.5 text-caption italic text-ink-500">
            <Info size={12} /> {programme.note}
          </p>
        ) : (
          <>
            {programme.metrics.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-line rounded-md overflow-hidden border border-line">
                {programme.metrics.map((m, i) => <MetricTile key={i} {...m} />)}
              </div>
            )}

            {Array.isArray(programme.unit_mix) && programme.unit_mix.length > 0 && (
              <UnitMixTable mix={programme.unit_mix} totalUnits={programme.unit_count} />
            )}

            {(programme.build_cost_inr != null || programme.gross_revenue_inr != null || programme.stabilised_value_inr != null) && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                {programme.build_cost_inr != null && (
                  <FinancialStrip
                    label="Construction cost"
                    value={fmtInr(programme.build_cost_inr)}
                    sub={programme.build_cost_per_sqft
                      ? `₹${fmtNum(programme.build_cost_per_sqft)}/sqft × ${fmtNum(programme.realized_bua_sqft)} sqft BUA`
                      : null}
                  />
                )}
                {programme.gross_revenue_inr != null && (
                  <FinancialStrip
                    label={programme.group === 'commercial' || programme.group === 'industrial'
                      ? 'Stabilised annual rent'
                      : 'Gross revenue (sale-out)'}
                    value={fmtInr(programme.gross_revenue_inr)}
                    sub={programme.cap_rate ? `at ${(programme.cap_rate * 100).toFixed(1)}% cap` : 'indicative'}
                  />
                )}
                {programme.stabilised_value_inr != null && (
                  <FinancialStrip
                    label="Stabilised asset value"
                    value={fmtInr(programme.stabilised_value_inr)}
                    sub="rent ÷ cap rate"
                  />
                )}
              </div>
            )}

            {programme.assumptions.length > 0 && (
              <details className="mt-5 rounded-md border border-line bg-paper-50/60">
                <summary className="flex cursor-pointer items-center justify-between px-4 py-2.5 text-caption list-none">
                  <span className="eyebrow flex items-center gap-1.5">
                    <Info size={11} /> Assumptions used
                  </span>
                  <span className="text-micro text-ink-400">Bengaluru 2026 benchmarks</span>
                </summary>
                <div className="grid grid-cols-1 gap-x-6 gap-y-1 px-4 pb-3 sm:grid-cols-2">
                  {programme.assumptions.map((a, i) => (
                    <div key={i} className="flex justify-between border-b border-line-soft py-1 text-caption last:border-0">
                      <span className="text-ink-500">{a.label}</span>
                      <span className="font-medium text-ink-800 tabular-nums">{a.value}</span>
                    </div>
                  ))}
                </div>
                <div className="px-4 pb-3 text-micro italic text-ink-400">
                  Benchmarks from RERA Karnataka (carpet ratios), BBMP bye-laws (lifts / parking),
                  CBRE &amp; Knight Frank 2025 Bengaluru market reports, RMP 2031 Draft.
                  Override any input on the Parcel or Financial tab to tailor the programme.
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MetricTile({ label, value, unit, hint }) {
  return (
    <div className="bg-paper-100 p-3">
      <div className="eyebrow">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="font-display text-xl font-semibold tabular-nums leading-none text-ink-900 dark:text-white">
          {value}
        </span>
        {unit && <span className="text-caption text-ink-500">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-micro text-ink-400">{hint}</div>}
    </div>
  );
}

function FinancialStrip({ label, value, sub }) {
  return (
    <div className="rounded-md border border-line bg-paper-100 px-3 py-3">
      <div className="eyebrow flex items-center gap-1.5">
        <IndianRupee size={10} strokeWidth={2} />
        {label}
      </div>
      <div className="mt-1.5 font-display text-lg font-semibold leading-tight text-ink-900 tabular-nums dark:text-white">
        {value}
      </div>
      {sub && <div className="mt-1 text-micro text-ink-500">{sub}</div>}
    </div>
  );
}

function UnitMixTable({ mix, totalUnits }) {
  const totalCarpet = mix.reduce((s, m) => s + (m.carpet_total_sqft || 0), 0);
  return (
    <div className="mt-5 overflow-hidden rounded-md border border-line">
      <div className="flex items-center justify-between border-b border-line bg-paper-200 px-4 py-2">
        <div className="eyebrow">Suggested unit mix</div>
        <div className="text-caption text-ink-500">
          Total <span className="font-semibold tabular-nums text-ink-900 dark:text-white">{fmtNum(totalUnits, 0)}</span> units
        </div>
      </div>
      <table className="w-full text-caption">
        <thead className="border-b border-line bg-paper-100">
          <tr className="eyebrow text-ink-500">
            <th className="px-4 py-1.5 text-left font-medium">Type</th>
            <th className="px-3 py-1.5 text-right font-medium">Share</th>
            <th className="px-3 py-1.5 text-right font-medium">Carpet / unit</th>
            <th className="px-4 py-1.5 text-right font-medium">Count</th>
            <th className="px-4 py-1.5 text-right font-medium">Total carpet</th>
          </tr>
        </thead>
        <tbody>
          {mix.map((m) => (
            <tr key={m.type} className="border-b border-line-soft last:border-0">
              <td className="px-4 py-1.5 font-medium text-ink-800">{m.type}</td>
              <td className="px-3 py-1.5 text-right text-ink-500 tabular-nums">{Math.round(m.share * 100)}%</td>
              <td className="px-3 py-1.5 text-right text-ink-500 tabular-nums">{fmtNum(m.carpet_sqft)} sqft</td>
              <td className="px-4 py-1.5 text-right font-semibold tabular-nums text-ink-900 dark:text-white">{fmtNum(m.count, 0)}</td>
              <td className="px-4 py-1.5 text-right text-ink-500 tabular-nums">{fmtNum(m.carpet_total_sqft)}</td>
            </tr>
          ))}
          <tr className="bg-paper-200">
            <td className="eyebrow px-4 py-1.5" colSpan={3}>Total</td>
            <td className="px-4 py-1.5 text-right font-semibold tabular-nums text-ink-900 dark:text-white">{fmtNum(totalUnits, 0)}</td>
            <td className="px-4 py-1.5 text-right font-semibold tabular-nums text-ink-900 dark:text-white">{fmtNum(totalCarpet)} sqft</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
