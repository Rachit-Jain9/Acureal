import { useMemo } from 'react';
import {
  Layers, Home, Briefcase, Hotel, Warehouse, Factory, Cpu, Heart,
  GraduationCap, Store, TreePine, Users, Building2, Info, Sparkles, IndianRupee,
} from 'lucide-react';
import { clsx } from 'clsx';
import { computeProgramme, fmtNum, fmtInr } from '../../utils/buildability';

// Asset-class → icon. Used purely for decoration.
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

// Asset-class → gradient tone for the header.
const CLASS_TONE = {
  residential_apartments: 'from-emerald-500 to-teal-500',
  residential_villas:     'from-emerald-500 to-lime-500',
  plotted_development:    'from-lime-500 to-emerald-500',
  commercial_office:      'from-indigo-500 to-blue-500',
  commercial_retail:      'from-pink-500 to-rose-500',
  mixed_use:              'from-violet-500 to-indigo-500',
  industrial:             'from-slate-500 to-gray-500',
  warehousing:            'from-amber-500 to-orange-500',
  hospitality:            'from-rose-500 to-pink-500',
  data_center:            'from-cyan-500 to-blue-500',
  senior_living:          'from-teal-500 to-emerald-500',
  student_housing:        'from-fuchsia-500 to-pink-500',
  healthcare:             'from-red-500 to-rose-500',
  education:              'from-sky-500 to-indigo-500',
};

export default function AssetClassProgrammeCard({ buildability, property }) {
  const programme = useMemo(
    () => computeProgramme({ buildability, property }),
    [buildability, property],
  );

  if (!programme) return null;
  const Icon = CLASS_ICON[programme.asset_class] || Layers;
  const tone = CLASS_TONE[programme.asset_class] || 'from-gray-500 to-slate-500';

  return (
    <div className="card p-0 overflow-hidden">
      {/* Gradient header */}
      <div className={clsx('px-5 py-4 text-white bg-gradient-to-r', tone)}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Icon size={18} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-white/80">
                Development programme
              </div>
              <div className="text-lg font-semibold leading-tight">
                {programme.profile_label || 'Programme'}
              </div>
              {programme.has_programme && buildability?.realized_built_up_sqft != null && (
                <div className="text-[11px] text-white/80 mt-0.5">
                  Derived from {fmtNum(buildability.realized_built_up_sqft)} sqft realized envelope
                </div>
              )}
            </div>
          </div>
          {programme.has_programme && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-white/20 text-white font-medium">
              <Sparkles size={10} />
              Asset-class tailored
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-5">
        {!programme.has_programme ? (
          <p className="text-xs text-gray-500 italic flex items-center gap-1.5">
            <Info size={12} /> {programme.note}
          </p>
        ) : (
          <>
            {/* Metric tiles */}
            {programme.metrics.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {programme.metrics.map((m, i) => <MetricTile key={i} {...m} />)}
              </div>
            )}

            {/* Residential unit mix table */}
            {Array.isArray(programme.unit_mix) && programme.unit_mix.length > 0 && (
              <UnitMixTable mix={programme.unit_mix} totalUnits={programme.unit_count} />
            )}

            {/* Revenue + cost strip */}
            {(programme.build_cost_inr != null || programme.gross_revenue_inr != null || programme.stabilised_value_inr != null) && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                {programme.build_cost_inr != null && (
                  <FinancialStrip
                    label="Construction cost"
                    value={fmtInr(programme.build_cost_inr)}
                    sub={programme.build_cost_per_sqft
                      ? `\u20b9${fmtNum(programme.build_cost_per_sqft)}/sqft × ${fmtNum(programme.realized_bua_sqft)} sqft BUA`
                      : null}
                    tone="amber"
                  />
                )}
                {programme.gross_revenue_inr != null && (
                  <FinancialStrip
                    label={programme.group === 'commercial' || programme.group === 'industrial'
                      ? 'Stabilised annual rent'
                      : 'Gross revenue (sale-out)'}
                    value={fmtInr(programme.gross_revenue_inr)}
                    sub={programme.cap_rate ? `at ${(programme.cap_rate * 100).toFixed(1)}% cap` : 'indicative'}
                    tone="emerald"
                  />
                )}
                {programme.stabilised_value_inr != null && (
                  <FinancialStrip
                    label="Stabilised asset value"
                    value={fmtInr(programme.stabilised_value_inr)}
                    sub="rent ÷ cap rate"
                    tone="indigo"
                  />
                )}
              </div>
            )}

            {/* Assumptions footer */}
            {programme.assumptions.length > 0 && (
              <details className="mt-4 rounded-lg bg-gray-50 border border-gray-100">
                <summary className="px-3 py-2 cursor-pointer text-[11px] font-semibold text-gray-700 uppercase tracking-[0.1em] list-none flex items-center justify-between">
                  <span className="flex items-center gap-1.5"><Info size={11} /> Assumptions used</span>
                  <span className="text-[10px] font-normal text-gray-400">Bengaluru 2026 benchmarks</span>
                </summary>
                <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                  {programme.assumptions.map((a, i) => (
                    <div key={i} className="flex justify-between text-[11px] py-0.5 border-b border-gray-100 last:border-0">
                      <span className="text-gray-500">{a.label}</span>
                      <span className="font-medium text-gray-700">{a.value}</span>
                    </div>
                  ))}
                </div>
                <div className="px-3 pb-3 text-[10px] text-gray-400 italic">
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

// -- Helpers ----------------------------------------------------------------

function MetricTile({ label, value, unit, hint }) {
  return (
    <div className="rounded-xl bg-gradient-to-br from-gray-50 to-white border border-gray-100 p-3">
      <div className="text-[10px] uppercase tracking-[0.1em] font-medium text-gray-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-lg font-bold text-gray-800 leading-none">{value}</span>
        {unit && <span className="text-[10px] text-gray-500">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-[10px] text-gray-400">{hint}</div>}
    </div>
  );
}

function FinancialStrip({ label, value, sub, tone }) {
  const tones = {
    amber:   'from-amber-50 to-amber-100/60 border-amber-100 text-amber-900',
    emerald: 'from-emerald-50 to-emerald-100/60 border-emerald-100 text-emerald-900',
    indigo:  'from-indigo-50 to-indigo-100/60 border-indigo-100 text-indigo-900',
  };
  return (
    <div className={clsx('rounded-xl bg-gradient-to-br border p-3', tones[tone] || tones.amber)}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold opacity-70">
        <IndianRupee size={10} />
        {label}
      </div>
      <div className="mt-1 text-xl font-bold leading-none">{value}</div>
      {sub && <div className="mt-1 text-[10px] opacity-70">{sub}</div>}
    </div>
  );
}

function UnitMixTable({ mix, totalUnits }) {
  const totalCarpet = mix.reduce((s, m) => s + (m.carpet_total_sqft || 0), 0);
  return (
    <div className="mt-4 rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-700">
          Suggested unit mix
        </div>
        <div className="text-[11px] text-gray-500">
          Total <span className="font-semibold text-gray-800">{fmtNum(totalUnits, 0)}</span> units
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-white border-b border-gray-100 text-[10px] uppercase tracking-[0.08em] text-gray-500">
          <tr>
            <th className="text-left px-4 py-1.5 font-medium">Type</th>
            <th className="text-right px-3 py-1.5 font-medium">Share</th>
            <th className="text-right px-3 py-1.5 font-medium">Carpet / unit</th>
            <th className="text-right px-4 py-1.5 font-medium">Count</th>
            <th className="text-right px-4 py-1.5 font-medium">Total carpet</th>
          </tr>
        </thead>
        <tbody>
          {mix.map((m) => (
            <tr key={m.type} className="border-b border-gray-50 last:border-0">
              <td className="px-4 py-1.5 text-gray-800 font-medium">{m.type}</td>
              <td className="px-3 py-1.5 text-right text-gray-600 text-xs">{Math.round(m.share * 100)}%</td>
              <td className="px-3 py-1.5 text-right text-gray-600 text-xs">{fmtNum(m.carpet_sqft)} sqft</td>
              <td className="px-4 py-1.5 text-right font-semibold text-gray-800">{fmtNum(m.count, 0)}</td>
              <td className="px-4 py-1.5 text-right text-gray-700 text-xs">{fmtNum(m.carpet_total_sqft)}</td>
            </tr>
          ))}
          <tr className="bg-gray-50">
            <td className="px-4 py-1.5 text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-600" colSpan={3}>Total</td>
            <td className="px-4 py-1.5 text-right font-bold text-gray-800">{fmtNum(totalUnits, 0)}</td>
            <td className="px-4 py-1.5 text-right font-bold text-gray-800 text-xs">{fmtNum(totalCarpet)} sqft</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
