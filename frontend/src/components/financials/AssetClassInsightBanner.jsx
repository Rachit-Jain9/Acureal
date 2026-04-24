import {
  Home, Landmark, Building2, Store, Warehouse, Hotel,
  TrendingUp, ArrowUpRight, Sparkles, Target,
} from 'lucide-react';

const CLASS_INSIGHTS = {
  residential_apartments: {
    icon: Home,
    gradient: 'from-indigo-600 via-violet-600 to-fuchsia-600',
    soft: 'from-indigo-50 via-violet-50 to-fuchsia-50',
    ring: 'ring-indigo-200',
    text: 'text-indigo-900',
    tagline: 'For-sale residential — cash-velocity play',
    thesis: 'Bengaluru absorbs ~65,000 units/year with end-user dominance (~75% non-investor). The model monetizes loading-factor uplift and recognizes revenue on sellout milestones.',
    kpis: [
      { label: 'Target Margin', value: '18–25%',   color: 'text-emerald-600' },
      { label: 'IRR Band',      value: '20–28%',   color: 'text-indigo-600' },
      { label: 'Turn Time',     value: '30–42 mo', color: 'text-amber-600' },
      { label: 'Exit',          value: 'Sellout',  color: 'text-rose-600' },
    ],
    persuasion: 'Velocity > margin. A 22% margin over 3 years beats 28% over 5 years on IRR.',
  },
  plotted_development: {
    icon: Landmark,
    gradient: 'from-amber-600 via-orange-600 to-rose-600',
    soft: 'from-amber-50 via-orange-50 to-rose-50',
    ring: 'ring-amber-200',
    text: 'text-amber-900',
    tagline: 'Plotted layouts — infrastructure alpha',
    thesis: 'Land-heavy, low-construction model. 15–25% of land value invested in roads & utilities unlocks 1.5–2.5× uplift on saleable plots. Fast turn, sharp IRR.',
    kpis: [
      { label: 'Saleable %',  value: '50–60%',    color: 'text-amber-600' },
      { label: 'IRR Band',    value: '22–30%',    color: 'text-emerald-600' },
      { label: 'Turn Time',   value: '18–30 mo',  color: 'text-indigo-600' },
      { label: 'Capex/Land',  value: '₹200–400', color: 'text-rose-600' },
    ],
    persuasion: 'Infrastructure is the moat — approvals + roads compress cap rates on raw land 40–70%.',
  },
  commercial_office: {
    icon: Building2,
    gradient: 'from-sky-600 via-blue-600 to-indigo-600',
    soft: 'from-sky-50 via-blue-50 to-indigo-50',
    ring: 'ring-sky-200',
    text: 'text-sky-900',
    tagline: 'Grade A office — GCC-fueled core asset',
    thesis: 'Bengaluru is India\'s #1 office market (~220M sqft stock, 85%+ occupancy). GCCs and SaaS drive 12M+ sqft annual absorption. REIT-ready, LRD-ready, forward-sale-ready.',
    kpis: [
      { label: 'Entry Cap',    value: '6.5–8.0%', color: 'text-sky-600' },
      { label: 'Rent',         value: '₹70–120', color: 'text-emerald-600' },
      { label: 'IRR Band',     value: '14–18%',   color: 'text-indigo-600' },
      { label: 'Yield on Cost',value: '9–11%',    color: 'text-amber-600' },
    ],
    persuasion: '100 bps of cap compression on ₹800 Cr asset = ₹85 Cr of value creation. Exit timing matters.',
  },
  retail: {
    icon: Store,
    gradient: 'from-rose-600 via-pink-600 to-fuchsia-600',
    soft: 'from-rose-50 via-pink-50 to-fuchsia-50',
    ring: 'ring-rose-200',
    text: 'text-rose-900',
    tagline: 'Retail — footfall × conversion × basket',
    thesis: 'Anchor-inline blend underwriting. Long lease cycles (7–10 yrs), higher opex (~22%), wider exit caps. Post-COVID, experiential and F&B-heavy malls outperform traditional formats.',
    kpis: [
      { label: 'Inline Rent',  value: '₹100–180', color: 'text-rose-600' },
      { label: 'Anchor Share', value: '30–50%',   color: 'text-fuchsia-600' },
      { label: 'Exit Cap',     value: '7.5–9.0%', color: 'text-amber-600' },
      { label: 'IRR Band',     value: '13–17%',   color: 'text-indigo-600' },
    ],
    persuasion: 'Anchor churn is the silent killer — model a realistic 12% vacancy, not 8%.',
  },
  industrial_warehousing: {
    icon: Warehouse,
    gradient: 'from-emerald-600 via-teal-600 to-cyan-600',
    soft: 'from-emerald-50 via-teal-50 to-cyan-50',
    ring: 'ring-emerald-200',
    text: 'text-emerald-900',
    tagline: 'Industrial / logistics — India\'s tightest cap',
    thesis: 'E-commerce (3× in 5 years) + 3PL consolidation has compressed logistics cap rates 75–125 bps since 2020. Lowest capex (~₹1,500/sqft), lowest opex (~15%), longest leases (7–9 yr NNN-style).',
    kpis: [
      { label: 'Construction', value: '₹1.2–2.5k',color: 'text-emerald-600' },
      { label: 'Rent',         value: '₹18–40',  color: 'text-teal-600' },
      { label: 'Vacancy',      value: '5–10%',    color: 'text-indigo-600' },
      { label: 'Exit Cap',     value: '7.5–9.5%', color: 'text-amber-600' },
    ],
    persuasion: 'Cheapest capex + highest occupancy + longest lease = best risk-adjusted yield in India RE.',
  },
  hospitality: {
    icon: Hotel,
    gradient: 'from-fuchsia-600 via-purple-600 to-violet-600',
    soft: 'from-fuchsia-50 via-purple-50 to-violet-50',
    ring: 'ring-fuchsia-200',
    text: 'text-fuchsia-900',
    tagline: 'Hospitality — operating leverage at ramp',
    thesis: 'ADR × Occ × Keys × 365 is the top line; F&B and ancillary layer 30–50% more. GOP margins triple from year-1 to year-3 stabilization. Exit on stabilized EBITDA × 9–12×.',
    kpis: [
      { label: 'Cost/Key',      value: '₹1–2.5 Cr', color: 'text-fuchsia-600' },
      { label: 'ADR',           value: '₹6k–15k',   color: 'text-purple-600' },
      { label: 'Stabilized Occ',value: '68–75%',    color: 'text-violet-600' },
      { label: 'Exit Multiple', value: '9–12×',     color: 'text-amber-600' },
    ],
    persuasion: 'Year-1 is a loss-leader. Underwrite the stabilized EBITDA, not the trailing.',
  },
};

export default function AssetClassInsightBanner({ assetClass }) {
  const insight = CLASS_INSIGHTS[assetClass] || CLASS_INSIGHTS.residential_apartments;
  const Icon = insight.icon;

  return (
    <div className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${insight.soft} ring-1 ${insight.ring} shadow-sm`}>
      <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-white/40 blur-3xl" />
      <div className="absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-white/30 blur-2xl" />

      <div className="relative p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${insight.gradient} text-white shadow-md`}>
              <Icon size={20} strokeWidth={2.2} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-semibold uppercase tracking-widest ${insight.text}/80`}>
                  Investment Thesis
                </span>
                <Sparkles size={10} className={insight.text} />
              </div>
              <h3 className={`text-base font-bold ${insight.text}`}>{insight.tagline}</h3>
            </div>
          </div>

          <div className={`inline-flex items-center gap-1.5 rounded-full border border-white/50 bg-white/70 px-3 py-1 text-[11px] font-semibold ${insight.text} shadow-sm backdrop-blur`}>
            <Target size={11} />
            Bengaluru-first • India-priority
          </div>
        </div>

        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-content-secondary">
          {insight.thesis}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {insight.kpis.map((k, i) => (
            <div key={i} className="rounded-xl border border-white/60 bg-white/80 px-3 py-2 shadow-sm backdrop-blur">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-content-secondary">{k.label}</div>
              <div className={`font-mono text-base font-bold ${k.color}`}>{k.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-xl border border-white/70 bg-white/70 px-3 py-2 backdrop-blur">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
            <ArrowUpRight size={12} strokeWidth={2.5} />
          </div>
          <p className="text-xs font-medium italic text-content-secondary">
            <span className="font-semibold not-italic text-content-primary">IC insight:</span> {insight.persuasion}
          </p>
        </div>
      </div>
    </div>
  );
}
