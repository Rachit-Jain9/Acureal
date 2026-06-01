import {
  Home, Landmark, Building2, Store, Warehouse, Hotel, ArrowUpRight,
} from 'lucide-react';

// Asset-class underwriting framing for the Financial Engine header.
//
// Credibility rule (CLAUDE.md): never present unverified market intel as
// authoritative. So the `thesis` copy here is STRATEGY framing — how to
// underwrite each asset class — NOT market statistics. Specific market facts
// (absorption volumes, stock, occupancy, cap-rate moves) were removed: they
// were unsourced, undated, and some contradicted the verified market_macro_kpis
// feed. The `bands` are typical underwriting ranges shown as general guidance,
// explicitly captioned as not deal-specific. Live, sourced numbers belong on
// the Market Intelligence / Comps surfaces, not in static per-class copy.
const CLASS_INSIGHTS = {
  residential_apartments: {
    icon: Home,
    accent: 'text-indigo-500',
    tagline: 'For-sale residential — cash-velocity play',
    thesis: 'End-user-led for-sale market. Underwrite for velocity over headline margin — the model monetises loading-factor uplift and books revenue on sellout milestones.',
    bands: [
      { label: 'Target margin', value: '18–25%' },
      { label: 'IRR band',      value: '20–28%' },
      { label: 'Turn time',     value: '30–42 mo' },
      { label: 'Exit',          value: 'Sellout' },
    ],
    insight: 'Velocity > margin. A 22% margin over 3 years beats 28% over 5 years on IRR.',
  },
  plotted_development: {
    icon: Landmark,
    accent: 'text-amber-500',
    tagline: 'Plotted layouts — infrastructure alpha',
    thesis: 'Land-heavy, low-construction. A slice of land value spent on roads & utilities unlocks an uplift on saleable plots — fast turn, sharp IRR. Approvals and infrastructure are the moat.',
    bands: [
      { label: 'Saleable %',  value: '50–60%' },
      { label: 'IRR band',    value: '22–30%' },
      { label: 'Turn time',   value: '18–30 mo' },
      { label: 'Capex/land',  value: '₹200–400/sf' },
    ],
    insight: 'Infrastructure is the moat — approvals + roads are what compress pricing on raw land.',
  },
  commercial_office: {
    icon: Building2,
    accent: 'text-sky-500',
    tagline: 'Grade A office — GCC-anchored core asset',
    thesis: 'GCC- and SaaS-anchored Grade-A core. Underwrite to a stabilised yield-on-cost, then a cap-rate exit (REIT / LRD / forward sale). Cap-rate movement, not rent, drives the value swing.',
    bands: [
      { label: 'Entry cap',     value: '6.5–8.0%' },
      { label: 'Rent',          value: '₹70–120/sf' },
      { label: 'IRR band',      value: '14–18%' },
      { label: 'Yield on cost', value: '9–11%' },
    ],
    insight: '100 bps of cap compression on a ₹800 Cr asset is ~₹85 Cr of value. Exit timing matters.',
  },
  retail: {
    icon: Store,
    accent: 'text-rose-500',
    tagline: 'Retail — footfall × conversion × basket',
    thesis: 'Anchor-plus-inline underwriting on long lease cycles and higher opex. Model realistic vacancy and anchor churn — experiential and F&B-led formats carry the rent.',
    bands: [
      { label: 'Inline rent',  value: '₹100–180/sf' },
      { label: 'Anchor share', value: '30–50%' },
      { label: 'Exit cap',     value: '7.5–9.0%' },
      { label: 'IRR band',     value: '13–17%' },
    ],
    insight: 'Anchor churn is the silent killer — model a realistic 12% vacancy, not 8%.',
  },
  industrial_warehousing: {
    icon: Warehouse,
    accent: 'text-emerald-500',
    tagline: 'Industrial / logistics — long NNN-style leases',
    thesis: 'Lowest capex, lowest opex, longest NNN-style leases. E-commerce and 3PL demand underpin tight caps — strong risk-adjusted yield when leasing holds.',
    bands: [
      { label: 'Construction', value: '₹1.2–2.5k/sf' },
      { label: 'Rent',         value: '₹18–40/sf' },
      { label: 'Vacancy',      value: '5–10%' },
      { label: 'Exit cap',     value: '7.5–9.5%' },
    ],
    insight: 'Cheapest capex + high occupancy + long leases = best risk-adjusted yield in Indian RE.',
  },
  hospitality: {
    icon: Hotel,
    accent: 'text-fuchsia-500',
    tagline: 'Hospitality — operating leverage at ramp',
    thesis: 'Operating-leverage play. ADR × Occ × Keys is the top line; GOP margins build from year-1 to stabilisation. Underwrite the stabilised EBITDA and a multiple exit — not the trailing.',
    bands: [
      { label: 'Cost/key',       value: '₹1–2.5 Cr' },
      { label: 'ADR',            value: '₹6k–15k' },
      { label: 'Stabilised occ', value: '68–75%' },
      { label: 'Exit multiple',  value: '9–12×' },
    ],
    insight: 'Year-1 is a loss-leader. Underwrite the stabilised EBITDA, not the trailing.',
  },
};

export default function AssetClassInsightBanner({ assetClass }) {
  const insight = CLASS_INSIGHTS[assetClass] || CLASS_INSIGHTS.residential_apartments;
  const Icon = insight.icon;

  return (
    <div className="rounded-xl border border-hairline-strong bg-bg-elevated shadow-editorial overflow-hidden">
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-hairline bg-bg-secondary">
              <Icon size={18} strokeWidth={2.1} className={insight.accent} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-content-muted">
                Investment thesis
              </p>
              <h3 className="text-base font-bold tracking-tight text-content-primary">{insight.tagline}</h3>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-bg-secondary px-2.5 py-1 text-[11px] font-medium text-content-secondary">
            Bengaluru-first · India-priority
          </span>
        </div>

        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-content-secondary">
          {insight.thesis}
        </p>

        <div className="mt-4">
          <p className="text-[10px] font-medium uppercase tracking-wider text-content-muted mb-1.5">
            Typical underwriting bands
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {insight.bands.map((b) => (
              <div key={b.label} className="rounded-lg border border-hairline bg-bg-secondary px-3 py-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-content-muted">{b.label}</div>
                <div className="font-mono text-base font-bold tabular-nums text-content-primary">{b.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-hairline-soft bg-bg-secondary/60 px-3 py-2">
          <ArrowUpRight size={13} strokeWidth={2.4} className="mt-0.5 shrink-0 text-content-muted" aria-hidden="true" />
          <p className="text-xs text-content-secondary">
            <span className="font-semibold text-content-primary">IC insight:</span> {insight.insight}
          </p>
        </div>

        <p className="mt-3 text-[11px] text-content-muted">
          General asset-class framing and typical bands — not verified market data for this deal. Underwrite against
          this site's own model and verified comps; see Market Intelligence for sourced, dated benchmarks.
        </p>
      </div>
    </div>
  );
}
