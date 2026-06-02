import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, X, Sparkles, TrendingUp, Layers,
  GitFork, Landmark, Building2, IndianRupee, Waves,
  ChevronRight, ChevronDown, Gauge, Target, Scale,
  Route, ArrowRight, TrendingDown, Activity, Percent,
} from 'lucide-react';

const TABS = [
  { id: 'overview',   label: 'Overview',        icon: Sparkles,    accent: 'from-indigo-500 to-violet-500' },
  { id: 'dcfflow',    label: 'DCF Flow',        icon: Route,       accent: 'from-blue-500 to-indigo-500' },
  { id: 'kpis',       label: 'KPIs',            icon: Gauge,       accent: 'from-emerald-500 to-teal-500' },
  { id: 'cashflow',   label: 'Cash Flow',       icon: Waves,       accent: 'from-sky-500 to-cyan-500' },
  { id: 'terminal',   label: 'Terminal Value',  icon: Target,      accent: 'from-violet-500 to-purple-500' },
  { id: 'costs',      label: 'Costs & Stack',   icon: Layers,      accent: 'from-rose-500 to-pink-500' },
  { id: 'waterfall',  label: 'Waterfall',       icon: GitFork,     accent: 'from-amber-500 to-orange-500' },
  { id: 'debt',       label: 'Debt',            icon: Landmark,    accent: 'from-slate-500 to-zinc-500' },
  { id: 'class',      label: 'Asset Class',     icon: Building2,   accent: 'from-fuchsia-500 to-purple-500' },
];

const ASSET_CLASS_DEEP_DIVE = {
  residential_apartments: {
    headline: 'Residential Apartments — For-Sale Cash Velocity',
    thesis: 'Bengaluru remains one of India\'s deepest end-user-led markets. The model monetizes a gross-to-saleable area uplift via loading factor, recognizes revenue on an S-curve aligned with construction progress, and deploys GST (1–5% affordable / 18% commercial) on the RERA receipts side.',
    unitEconomics: [
      { label: 'Saleable Area',          formula: 'Plot × FSI × (1 + Loading Factor)' },
      { label: 'Top-line Revenue',       formula: 'Saleable sqft × Selling Rate × (1 + Escalation)^t' },
      { label: 'Hard Cost',              formula: 'Gross Built-up × Construction Rate' },
      { label: 'Soft Cost Stack',        formula: 'Approvals + Architect + PMC + Marketing + Contingency + GST' },
      { label: 'Developer Profit',       formula: 'Revenue − (Land + Hard + Soft + Finance)' },
    ],
    benchmarks: [
      { k: 'Selling Rate',  v: '₹7,500–12,000 /sqft', ctx: 'Prime Bengaluru' },
      { k: 'Construction',  v: '₹4,000–5,500 /sqft', ctx: 'Grade A spec' },
      { k: 'Margin',        v: '18–25%',              ctx: 'Institutional target' },
      { k: 'IRR',           v: '20–28%',              ctx: 'Levered project IRR' },
    ],
  },
  plotted_development: {
    headline: 'Plotted Development — Infrastructure-Enabled Land Banking',
    thesis: 'Plotted layouts convert raw land into saleable inventory by investing ~15–25% of land value into roads, drainage, and amenities. Returns are driven by land value uplift rather than construction margin. Typical saleable efficiency: 50–60% of gross land.',
    unitEconomics: [
      { label: 'Saleable Land',   formula: 'Total Land × Saleable %' },
      { label: 'Plot Count',      formula: '⌊Saleable Land ÷ Avg Plot Size⌋' },
      { label: 'Revenue',         formula: 'Saleable sqft × Rate /sqft (or sqyd × ÷9)' },
      { label: 'Dev Cost',        formula: 'Total Land × Dev Rate /sqft + GST' },
      { label: 'Margin',          formula: 'Revenue − (Land + Dev + Approvals + Marketing + Finance)' },
    ],
    benchmarks: [
      { k: 'Saleable %',    v: '50–60%',               ctx: 'After roads/parks' },
      { k: 'Dev Cost',      v: '₹200–400 /sqft land', ctx: 'Infra + utilities' },
      { k: 'Hold',          v: '18–30 months',         ctx: 'Approval to sellout' },
      { k: 'IRR',           v: '22–30%',               ctx: 'Land-heavy, fast turn' },
    ],
  },
  commercial_office: {
    headline: 'Commercial Office — Stabilized Yield + Cap Rate Compression',
    thesis: 'Bengaluru Grade A office trades at 6.5–8% entry cap with secular demand from GCCs and SaaS. The model layers rent × escalation × (1 − vacancy), deducts opex, applies DCF through hold, and exits via cap-rate sale, LRD refinance, or forward purchase. NOI yield + cap compression drive the levered IRR.',
    unitEconomics: [
      { label: 'Gross Rent',    formula: 'Leasable sqft × Rent × 12 × (1 + esc)^t' },
      { label: 'EGI',           formula: 'Gross Rent × (1 − Vacancy %)' },
      { label: 'NOI',           formula: 'EGI × (1 − Opex %)' },
      { label: 'Exit Value',    formula: 'Stabilized NOI ÷ Exit Cap Rate' },
      { label: 'Yield on Cost', formula: 'Stabilized NOI ÷ Total Dev Cost' },
    ],
    benchmarks: [
      { k: 'Rent',          v: '₹70–120 /sqft/mo', ctx: 'Grade A CBD/ORR' },
      { k: 'Vacancy',       v: '8–12%',            ctx: 'Stabilized' },
      { k: 'Entry Cap',     v: '6.5–8.0%',         ctx: 'Core institutional' },
      { k: 'IRR',           v: '14–18%',           ctx: 'Levered, 5–7yr hold' },
    ],
  },
  retail: {
    headline: 'Retail — Anchor-Inline Blend, Footfall-Linked NOI',
    thesis: 'Retail underwriting splits tenant rent by anchor (discounted, lease-backbone) vs inline (full rate, higher churn). Opex runs hotter than office (~22%) due to common-area services. Hold cycles are longer (7–10 years) and exit caps trade wider than office.',
    unitEconomics: [
      { label: 'Blended Rent',  formula: 'Anchor% × Rent × (1 − Disc) + (1 − Anchor%) × Rent' },
      { label: 'EGI',           formula: 'Leasable × Blended × 12 × (1 − Vacancy)' },
      { label: 'NOI',           formula: 'EGI × (1 − Opex %)' },
      { label: 'Exit',          formula: 'Stabilized NOI ÷ Exit Cap' },
      { label: 'Leasing Cost',  formula: 'TI /sqft × Leasable + LC months × Rent' },
    ],
    benchmarks: [
      { k: 'Inline Rent',   v: '₹100–180 /sqft/mo', ctx: 'Bengaluru mall' },
      { k: 'Anchor Disc.',  v: '15–30%',            ctx: 'Vs inline' },
      { k: 'Exit Cap',      v: '7.5–9.0%',          ctx: 'Retail spread' },
      { k: 'Hold',          v: '7–10 yrs',          ctx: 'Longer lease cycle' },
    ],
  },
  industrial_warehousing: {
    headline: 'Industrial & Warehousing — Low-Capex, High Occupancy',
    thesis: 'Industrial/logistics is the highest-occupancy, lowest-capex real estate asset in India. Construction costs ~₹1,200–2,500/sqft (vs ₹5,000+ for office), opex runs ~15%, and tenant profile (3PL, e-commerce) drives 7–10 year NNN-style leases. Rising e-comm penetration has tightened cap rates 75–125 bps since 2020.',
    unitEconomics: [
      { label: 'Gross Rent',  formula: 'Floor sqft × Rent × 12 × (1 + esc)^t' },
      { label: 'EGI',         formula: 'Gross × (1 − 5–10% Vacancy)' },
      { label: 'NOI',         formula: 'EGI × (1 − ~15% Opex)' },
      { label: 'Exit',        formula: 'NOI ÷ Exit Cap (7.5–9.5%)' },
      { label: 'Hurdle',      formula: 'Target yield on cost ≥ 200 bps > exit cap' },
    ],
    benchmarks: [
      { k: 'Construction',  v: '₹1,200–2,500 /sqft', ctx: 'Shed/warehouse' },
      { k: 'Rent',          v: '₹18–40 /sqft/mo',    ctx: 'Bengaluru periphery' },
      { k: 'Opex',          v: '12–16%',             ctx: 'NNN-lite' },
      { k: 'IRR',           v: '15–19%',             ctx: 'Levered, 7yr hold' },
    ],
  },
  hospitality: {
    headline: 'Hospitality — ADR × Occ × EBITDA Margin',
    thesis: 'Hotel underwriting is ADR × Occupancy × 365 × Keys, with F&B and other revenue layered in. Operating leverage is sharp — GOP margins ramp from 18% in year-1 to 35–45% at stabilization (year 3–4). Exit on stabilized EBITDA × multiple (9–12×) or EBITDA yield (8–10%).',
    unitEconomics: [
      { label: 'RevPAR',        formula: 'ADR × Occupancy %' },
      { label: 'Room Revenue',  formula: 'RevPAR × Keys × 365' },
      { label: 'Total Revenue', formula: 'Room × (1 + F&B % + Other %)' },
      { label: 'GOP',           formula: 'Revenue × GOP Margin' },
      { label: 'EBITDA',        formula: 'Revenue × EBITDA Margin' },
    ],
    benchmarks: [
      { k: 'Cost / Key',    v: '₹1.0–2.5 Cr',      ctx: 'Mid to luxury' },
      { k: 'ADR',           v: '₹6,000–15,000',    ctx: 'Bengaluru upscale' },
      { k: 'Stabilized Occ',v: '68–75%',           ctx: 'Year 3+' },
      { k: 'Exit EBITDA',   v: '9–12×',            ctx: 'Institutional' },
    ],
  },
};

export default function MethodologyExplorer({
  assetClass = 'residential_apartments',
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
  const [tab, setTab] = useState('overview');

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

  const classDive = useMemo(
    () => ASSET_CLASS_DEEP_DIVE[assetClass] || ASSET_CLASS_DEEP_DIVE.residential_apartments,
    [assetClass]
  );

  return (
    <>
      {!hideTrigger && (
        <button
          type="button"
          onClick={() => setOpenInternal(true)}
          className="inline-flex items-center gap-2 rounded-full border border-hairline bg-bg-elevated px-3.5 py-1.5 text-xs font-semibold text-content-secondary transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
          aria-label="How this model works"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white">
            <BookOpen size={12} strokeWidth={2.5} />
          </span>
          <span className="tracking-wide">Methodology</span>
          <Sparkles size={12} className="text-content-muted" />
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[70] flex">
          <button
            type="button"
            aria-label="Close methodology"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={close}
          />
          <aside className="relative ml-auto flex h-full w-full max-w-3xl flex-col bg-bg-elevated shadow-2xl">
            <header className="relative overflow-hidden border-b border-hairline-strong bg-slate-900 px-6 py-5 text-white">
              <div className="relative flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-indigo-200">
                    <Sparkles size={12} /> Underwriting Playbook
                  </div>
                  <h2 className="mt-1 text-2xl font-bold">How This Model Works</h2>
                  <p className="mt-1 max-w-xl text-sm text-indigo-100/90">
                    Every KPI, cash-flow line, and waterfall tranche — mapped to the deterministic formula behind it.
                    No black boxes. Built for IC-grade defensibility.
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
              <nav className="relative mt-5 flex flex-wrap gap-1.5">
                {TABS.map((t) => {
                  const Icon = t.icon;
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        active
                          ? `bg-gradient-to-r ${t.accent} text-white shadow-md`
                          : 'bg-white/10 text-indigo-100 hover:bg-white/20'
                      }`}
                    >
                      <Icon size={12} />
                      {t.label}
                    </button>
                  );
                })}
              </nav>
            </header>

            <div className="flex-1 overflow-y-auto bg-bg-secondary">
              <div className="mx-auto max-w-2xl px-6 py-6">
                {tab === 'overview'  && <OverviewSection />}
                {tab === 'dcfflow'   && <DCFFlowSection assetClass={assetClass} />}
                {tab === 'kpis'      && <KpisSection />}
                {tab === 'cashflow'  && <CashflowSection />}
                {tab === 'terminal'  && <TerminalValueSection />}
                {tab === 'costs'     && <CostsSection />}
                {tab === 'waterfall' && <WaterfallSection />}
                {tab === 'debt'      && <DebtSection />}
                {tab === 'class'     && <ClassDeepDive data={classDive} assetClass={assetClass} />}
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

/* ───────────────────── Small Primitives ───────────────────── */

function SectionTitle({ icon: Icon, gradient, title, subtitle }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} text-white shadow-sm`}>
        <Icon size={18} />
      </div>
      <div>
        <h3 className="text-lg font-bold text-content-primary">{title}</h3>
        {subtitle && <p className="text-xs text-content-secondary">{subtitle}</p>}
      </div>
    </div>
  );
}

function Formula({ label, expr, note }) {
  return (
    <div className="rounded-lg border border-hairline-strong bg-bg-elevated p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-content-secondary">{label}</div>
      <code className="mt-1 block rounded bg-bg-secondary px-2 py-1.5 text-[13px] font-mono text-content-primary">{expr}</code>
      {note && <p className="mt-1.5 text-xs text-content-secondary">{note}</p>}
    </div>
  );
}

function Pill({ tone = 'indigo', children }) {
  const tones = {
    indigo:  'bg-indigo-50 text-indigo-700 border-indigo-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rose:    'bg-rose-50 text-rose-700 border-rose-200',
    amber:   'bg-amber-50 text-amber-800 border-amber-200',
    sky:     'bg-sky-50 text-sky-700 border-sky-200',
    violet:  'bg-violet-50 text-violet-700 border-violet-200',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

function StepRow({ idx, title, body, tone = 'indigo' }) {
  const tones = {
    indigo:  'bg-indigo-500',
    emerald: 'bg-emerald-500',
    rose:    'bg-rose-500',
    amber:   'bg-amber-500',
    sky:     'bg-sky-500',
    violet:  'bg-violet-500',
  };
  return (
    <div className="flex gap-3">
      <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${tones[tone]} text-[11px] font-bold text-white shadow`}>{idx}</div>
      <div className="flex-1">
        <div className="text-sm font-semibold text-content-primary">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-content-secondary">{body}</div>
      </div>
    </div>
  );
}

/* ───────────────────── Sections ───────────────────── */

function OverviewSection() {
  return (
    <div className="space-y-5">
      <SectionTitle
        icon={Sparkles}
        gradient="from-indigo-500 to-violet-500"
        title="Deterministic, Defensible, Disclosed"
        subtitle="LLMs never touch the math. Every rupee is a formula."
      />
      <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 p-4">
        <p className="text-sm leading-relaxed text-content-secondary">
          REDIP's Financial Engine is built on the same principles you'd find in an institutional IC memo:
          <span className="font-semibold text-indigo-900"> transparency over cleverness</span>. Every KPI card,
          cash-flow row, and waterfall tranche traces back to a published formula. There are no AI-generated numbers,
          no undisclosed assumptions, and no generic templates.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Pill tone="emerald">Per-quarter S-curve draws</Pill>
          <Pill tone="indigo">Compound preferred return</Pill>
          <Pill tone="amber">GP catch-up tranche</Pill>
          <Pill tone="sky">Amortizing P&amp;I + balloon</Pill>
          <Pill tone="violet">Base / Bull / Bear scenarios</Pill>
          <Pill tone="rose">6 asset classes</Pill>
        </div>
      </div>

      <div className="space-y-3">
        <StepRow idx="1" tone="emerald" title="Inputs are validated server-side"
          body="Express-validator enforces bounds (e.g., FSI 0.1–20, cap rates 1–30%). Illegal combinations fail fast with a 422 and a plain-English message — not a silent NaN." />
        <StepRow idx="2" tone="sky" title="Deterministic engine runs the math"
          body="The TypeScript financial kernel (@redip/financial-kernel) executes BigInt-backed Decimal math — no LLMs, no Monte Carlo noise. The same inputs always produce the same outputs, down to four decimal places." />
        <StepRow idx="3" tone="indigo" title="Cash flows built on a per-quarter grid"
          body="Construction draws follow an S-curve; revenue collections are anchored to sellout velocity; operating NOI is compounded by escalation. Interest accrues on the actual outstanding balance each quarter." />
        <StepRow idx="4" tone="amber" title="KPIs computed by standard finance"
          body="IRR via Newton-Raphson on the quarterly series (annualized), NPV via WACC-based discount, Equity Multiple as total distributions ÷ total equity, DSCR as NOI ÷ annual debt service." />
        <StepRow idx="5" tone="violet" title="Scenarios persisted, not regenerated"
          body="Base/Bull/Bear KPIs are stored in the financial_scenarios table with their multipliers. Sensitivities are live-grid recomputes, not LLM guesses." />
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-2 text-amber-900">
          <Target size={14} />
          <span className="text-sm font-semibold">Why this beats a CBRE/JLL associate's spreadsheet</span>
        </div>
        <ul className="mt-2 space-y-1 text-xs text-amber-900">
          <li>• <span className="font-semibold">Zero link rot</span> — it's a schema, not 47 tabs with =INDIRECT references.</li>
          <li>• <span className="font-semibold">Auditable</span> — every field is validated; every formula is open-source readable.</li>
          <li>• <span className="font-semibold">Asset-class native</span> — 6 specialized models, not one monolith with patched columns.</li>
          <li>• <span className="font-semibold">Composable waterfalls</span> — compound pref + catch-up + promote, exactly as the LPA would specify.</li>
        </ul>
      </div>
    </div>
  );
}

function KpisSection() {
  return (
    <div className="space-y-5">
      <SectionTitle icon={Gauge} gradient="from-emerald-500 to-teal-500" title="Return Metrics — The KPI Stack" subtitle="What IC actually looks at" />

      <Formula
        label="IRR (Levered Project IRR)"
        expr="Σ CFₜ / (1 + IRR)^t = 0, solved via Newton-Raphson"
        note="Cash flows are on a quarterly grid; IRR is annualized (×4 in simple, or (1+q)^4−1 in compound). Converges in ≤20 iterations."
      />
      <Formula
        label="NPV"
        expr="NPV = Σ CFₜ / (1 + r)^t — r = discount rate (user input, typically 12–15%)"
        note="If NPV > 0 at the user's discount rate, the deal clears the hurdle. Discount rate should reflect blended cost of capital."
      />
      <Formula
        label="Equity Multiple (MOIC)"
        expr="Σ Distributions to Equity / Σ Equity Contributions"
        note="Unitless. Institutional targets: 1.8–2.5× over 5–7 years for core+; 2.5–4.0× for opportunistic."
      />
      <Formula
        label="Yield on Cost"
        expr="Stabilized NOI / Total Development Cost"
        note="For income assets. The spread between yield on cost and exit cap rate is the development premium — target ≥ 150–200 bps."
      />
      <Formula
        label="DSCR"
        expr="NOI / Annual Debt Service"
        note="Lender covenants usually demand ≥ 1.25×. Below 1.0× means the asset can't service its debt."
      />
      <Formula
        label="Developer Margin (for-sale)"
        expr="(Revenue − All-in Cost) / All-in Cost"
        note="For residential/plotted. Bengaluru institutional targets: 18–25% gross margin."
      />

      <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
          <Scale size={14} /> Sign conventions matter
        </div>
        <p className="mt-1 text-xs text-emerald-900/90">
          Equity contributions are negative; distributions are positive. Construction draws are cost (negative);
          revenue collections are positive. Finance interest accrues negatively on the capital stack. Get the signs
          wrong and IRR collapses silently — this is the #1 spreadsheet error in the industry.
        </p>
      </div>
    </div>
  );
}

function CashflowSection() {
  return (
    <div className="space-y-5">
      <SectionTitle icon={Waves} gradient="from-sky-500 to-cyan-500" title="Cash Flow Construction" subtitle="How per-quarter numbers are built" />

      <div className="rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50 to-cyan-50 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-sky-800">S-Curve Construction Draws</div>
        <p className="mt-1 text-sm leading-relaxed text-content-secondary">
          Construction doesn't draw linearly — it ramps. REDIP builds a <span className="font-semibold">Beta(2, 2) S-curve</span>
          across the construction window, with mass concentrated in the middle quarters. This is the institutional standard
          for cost-to-complete modeling.
        </p>
        <div className="mt-3 flex items-end gap-1 h-16">
          {[0.05, 0.10, 0.16, 0.19, 0.18, 0.15, 0.10, 0.07].map((h, i) => (
            <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-sky-500 to-cyan-400" style={{ height: `${h * 400}%` }} />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-content-secondary">
          <span>Q1</span><span>Q2</span><span>Q3</span><span>Q4</span><span>Q5</span><span>Q6</span><span>Q7</span><span>Q8</span>
        </div>
      </div>

      <Formula
        label="Finance Cost (Construction)"
        expr="Σ (Outstanding Debtₜ × rate/4)   for t in quarters"
        note="Interest accrues on the actual outstanding balance each quarter — not on 50% of peak (which is the shortcut associates use). This captures the real cost of the debt-draw lag."
      />
      <Formula
        label="Revenue Collection (For-Sale)"
        expr="Revenueₜ = Sellout% at sellout curve × Total Revenue × (1 + escalation)^t"
        note="Bookings recognized as Saleable × Rate; cash recognized on collection milestones (20/30/40/10 typical)."
      />
      <Formula
        label="Operating NOI (Income Assets)"
        expr="NOIₜ = Leasable × Rent × 12 × (1 − vacancy) × (1 − opex) × (1 + esc)^t"
        note="Year-1 NOI is lease-up (stabilized occupancy by year 2–3). Escalation compounds annually on the in-place rent."
      />
      <Formula
        label="Exit Proceeds (Cap Rate Sale)"
        expr="Exit = (Stabilized NOI × (1 + esc)) / Exit Cap Rate   [less selling costs]"
        note="Exit NOI is forward-looking by one period — buyer underwrites the next year's NOI, not the trailing one."
      />

      <div className="rounded-xl border border-hairline-strong bg-bg-elevated p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-secondary">Quarterly Cash Flow Waterfall</div>
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between rounded bg-emerald-50 px-2 py-1"><span>+ Revenue / NOI</span><span className="font-mono">inflows</span></div>
          <div className="flex justify-between rounded bg-rose-50 px-2 py-1"><span>− Hard & Soft Costs</span><span className="font-mono">outflows</span></div>
          <div className="flex justify-between rounded bg-amber-50 px-2 py-1"><span>− Finance Cost (accrued)</span><span className="font-mono">outflows</span></div>
          <div className="flex justify-between rounded bg-sky-50 px-2 py-1"><span>+ Debt Draw  /  − P&amp;I</span><span className="font-mono">capital stack</span></div>
          <div className="flex justify-between rounded bg-violet-50 px-2 py-1"><span>+ Exit Proceeds (terminal)</span><span className="font-mono">inflows</span></div>
          <div className="flex justify-between rounded bg-bg-primary px-2 py-1 font-semibold text-white"><span>= Equity Cash Flow</span><span className="font-mono">to IRR/NPV</span></div>
        </div>
      </div>
    </div>
  );
}

function CostsSection() {
  return (
    <div className="space-y-5">
      <SectionTitle icon={Layers} gradient="from-rose-500 to-pink-500" title="Cost Stack & Capital Sources" subtitle="Where money goes, where money comes from" />

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-rose-100 bg-rose-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-rose-800">Hard Costs</div>
          <ul className="mt-2 space-y-1 text-xs text-content-secondary">
            <li>• Construction: GFA × ₹/sqft</li>
            <li>• Site works</li>
            <li>• Contingency: 5–8%</li>
            <li>• GST on works: 12–18%</li>
          </ul>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">Soft Costs</div>
          <ul className="mt-2 space-y-1 text-xs text-content-secondary">
            <li>• Approvals (BBMP/BMRDA)</li>
            <li>• Architect: 1.5–3%</li>
            <li>• PMC: 1–2%</li>
            <li>• Marketing: 3–6% of rev</li>
          </ul>
        </div>
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-indigo-800">Land & Acquisition</div>
          <ul className="mt-2 space-y-1 text-xs text-content-secondary">
            <li>• Land cost (Cr)</li>
            <li>• Stamp duty: 5–6.5%</li>
            <li>• Registration: 1%</li>
            <li>• Typically equity-funded</li>
          </ul>
        </div>
        <div className="rounded-xl border border-sky-100 bg-sky-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-sky-800">Finance</div>
          <ul className="mt-2 space-y-1 text-xs text-content-secondary">
            <li>• Construction debt: 12–16% pa</li>
            <li>• LRD refinance: 8.5–10% pa</li>
            <li>• Fees: 1–2% upfront</li>
            <li>• Per-quarter accrual</li>
          </ul>
        </div>
      </div>

      <div className="rounded-xl border border-hairline-strong bg-bg-elevated p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-content-secondary">Capital Stack Seniority</div>
        <div className="flex items-center gap-1.5 text-xs">
          <div className="flex-1 rounded-l-md bg-bg-primary px-3 py-2 font-semibold text-white">Senior Debt (1st lien)</div>
          <div className="flex-1 bg-slate-600 px-3 py-2 font-semibold text-white">Mezzanine</div>
          <div className="flex-1 bg-emerald-600 px-3 py-2 font-semibold text-white">Pref Equity</div>
          <div className="flex-1 rounded-r-md bg-indigo-600 px-3 py-2 font-semibold text-white">Common Equity</div>
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-content-secondary">
          <span>Lowest risk • Lowest return</span>
          <span>Highest risk • Highest return</span>
        </div>
      </div>
    </div>
  );
}

function WaterfallSection() {
  return (
    <div className="space-y-5">
      <SectionTitle icon={GitFork} gradient="from-amber-500 to-orange-500" title="Waterfall & Promote" subtitle="How profits split between LP and GP" />

      <div className="rounded-xl border border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">The 4-Tranche JV Waterfall</div>
        <div className="mt-3 space-y-2">
          {[
            { tier: '1', name: 'Return of Capital', who: 'LP + GP pro-rata', detail: 'Both partners recover their original equity contribution first.' },
            { tier: '2', name: 'Preferred Return',  who: 'LP until pref hurdle', detail: 'LP earns a compounded 10–12% on committed capital before GP sees promote.', tone: 'emerald' },
            { tier: '3', name: 'GP Catch-Up',       who: 'GP until target promote %', detail: 'GP catches up to the agreed promote split (e.g., 20%). Optional — only if LPA specifies.', tone: 'amber' },
            { tier: '4', name: 'Promote / Carry',   who: 'Split by promote % (e.g., 80/20)', detail: 'All residual profit split LP/GP at the promote ratio.', tone: 'violet' },
          ].map((t, i) => (
            <div key={i} className="rounded-lg border border-white bg-white/70 p-2.5 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-600 text-xs font-bold text-white">{t.tier}</span>
                <span className="text-sm font-semibold text-content-primary">{t.name}</span>
                <span className="ml-auto text-[11px] font-medium text-content-secondary">→ {t.who}</span>
              </div>
              <p className="mt-1 pl-8 text-xs text-content-secondary">{t.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <Formula
        label="Preferred Return — Compound (Institutional Default)"
        expr="Pref = Equity × ((1 + r)^years − 1)"
        note="Compounds annually on unreturned capital. LPs strongly prefer this — simple pref undercompensates for time."
      />
      <Formula
        label="Preferred Return — Simple (Retail Default)"
        expr="Pref = Equity × r × years"
        note="Linear accrual. Same headline hurdle, materially smaller dollar amount over 5+ year holds."
      />
      <Formula
        label="GP Catch-Up Formula"
        expr="C = (p × (pref_L + pref_D) − pref_D) / (1 − p)"
        note="p = promote fraction (e.g., 0.20). Solves for the GP catch-up amount that puts them at 20% of total pref + catch-up distributions — i.e., exactly at the promote ratio going into tranche 4."
      />
      <Formula
        label="JDA (Joint Development) Split"
        expr="Developer Margin = Revenue − (Owner Share + Dev Cost + Finance)"
        note="Landowner gets their share of revenue/units (typically 40–50% for Bengaluru). Developer bears construction and marketing risk for the balance."
      />
    </div>
  );
}

function DebtSection() {
  return (
    <div className="space-y-5">
      <SectionTitle icon={Landmark} gradient="from-slate-600 to-zinc-600" title="Debt Schedule" subtitle="Construction finance, operating debt, and LRD" />

      <div className="rounded-xl border border-sky-100 bg-sky-50 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-sky-900">Construction Phase (S-Curve Draws)</div>
        <p className="mt-1 text-sm text-content-secondary">
          Debt draws track construction S-curve. Interest-only during construction — accrued per-quarter on the
          outstanding balance. No principal amortization while the asset isn't yet generating NOI.
        </p>
      </div>

      <Formula
        label="Annuity P&I (Operating Phase)"
        expr="Payment = P × (r / (1 − (1 + r)^-n))"
        note="P = outstanding principal, r = periodic rate (annual ÷ 4 for quarterly), n = total periods. Standard CRE amortization."
      />
      <Formula
        label="Interest Portion (each period)"
        expr="Interestₜ = Balanceₜ₋₁ × r"
        note="Front-loaded: early quarters are ~90% interest, gradually shifting toward principal."
      />
      <Formula
        label="Balloon at Exit"
        expr="Balloon = Remaining Principal at t = hold period end"
        note="CRE debt rarely fully amortizes over the hold — the balance rolls to the buyer (assumption) or is paid from exit proceeds."
      />
      <Formula
        label="LRD (Lease-Rental Discounting) Refinance"
        expr="LRD Proceeds = Stabilized Asset Value × LRD LTV"
        note="At stabilization (typically year 2–3), the construction loan is refinanced with a lower-cost LRD. Proceeds in excess of construction debt distribute to equity — cash-on-cash lift for LPs."
      />

      <div className="rounded-xl border border-hairline-strong bg-bg-elevated p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-secondary">Debt Cost Hierarchy (typical, India, 2026)</div>
        <div className="space-y-1.5">
          {[
            { type: 'Construction Finance',   rate: '13–15%', tone: 'bg-rose-500' },
            { type: 'Operating Term Loan',    rate: '10–12%', tone: 'bg-amber-500' },
            { type: 'LRD (Lease Discounting)', rate: '8.5–10%', tone: 'bg-emerald-500' },
            { type: 'CMBS / Bond Refinance',  rate: '8–9%',  tone: 'bg-sky-500' },
          ].map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className={`h-2 flex-1 rounded-full ${r.tone}`} />
              <span className="w-40 text-xs font-medium text-content-secondary">{r.type}</span>
              <span className="w-16 text-right text-xs font-mono text-content-primary">{r.rate}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClassDeepDive({ data, assetClass }) {
  const labels = {
    residential_apartments:  'Residential Apartments',
    plotted_development:     'Plotted Development',
    commercial_office:       'Commercial Office',
    retail:                  'Retail',
    industrial_warehousing:  'Industrial & Warehousing',
    hospitality:             'Hospitality',
  };
  return (
    <div className="space-y-5">
      <SectionTitle
        icon={Building2}
        gradient="from-fuchsia-500 to-purple-500"
        title={labels[assetClass] || 'Asset Class Deep Dive'}
        subtitle="Class-specific mechanics & benchmarks"
      />

      <div className="rounded-xl border border-fuchsia-100 bg-gradient-to-br from-fuchsia-50 to-purple-50 p-4">
        <div className="text-sm font-bold text-fuchsia-900">{data.headline}</div>
        <p className="mt-1.5 text-sm leading-relaxed text-content-secondary">{data.thesis}</p>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-secondary">Unit Economics Chain</div>
        <div className="space-y-2">
          {data.unitEconomics.map((u, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-hairline-strong bg-bg-elevated p-2.5">
              <ChevronRight size={14} className="shrink-0 text-fuchsia-500" />
              <div className="min-w-[130px] text-xs font-semibold text-content-secondary">{u.label}</div>
              <code className="flex-1 rounded bg-bg-secondary px-2 py-1 text-[12px] font-mono text-content-primary">{u.formula}</code>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-secondary">Market Benchmarks (Bengaluru, 2026)</div>
        <div className="grid grid-cols-2 gap-2">
          {data.benchmarks.map((b, i) => (
            <div key={i} className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">{b.k}</div>
              <div className="mt-0.5 font-mono text-sm font-bold text-content-primary">{b.v}</div>
              <div className="text-[10px] text-content-secondary">{b.ctx}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────── DCF Flow Section ───────────────────── */

const DCF_STAGES = [
  {
    id: 'revenue',
    number: '01',
    title: 'Revenue',
    icon: IndianRupee,
    gradient: 'from-emerald-500 to-teal-500',
    border: 'border-emerald-200',
    surface: 'from-emerald-50 to-teal-50',
    text: 'text-emerald-900',
    tagline: 'Top-line ingestion per quarter',
    summary: 'For-sale: bookings × rate, recognized on the sellout curve. Income: leasable × rent × 12 × (1 − vacancy). Hospitality: ADR × occupancy × keys × 365.',
    formulas: [
      { k: 'For-sale',   f: 'Revenueₜ = Saleable × Rate × (1 + esc)^t' },
      { k: 'Income',     f: 'Revenueₜ = Leasable × Rent × 12 × (1 − vacancy)' },
      { k: 'Hospitality', f: 'Revenueₜ = ADR × Occ × Keys × 365' },
    ],
    inputs: ['Saleable area / Leasable sqft / Keys', 'Rate or rent or ADR', 'Escalation', 'Vacancy / occupancy'],
  },
  {
    id: 'noi',
    number: '02',
    title: 'NOI',
    icon: Activity,
    gradient: 'from-blue-500 to-indigo-500',
    border: 'border-blue-200',
    surface: 'from-blue-50 to-indigo-50',
    text: 'text-blue-900',
    tagline: 'Net operating income after opex',
    summary: 'EGI discounts gross revenue for vacancy. NOI subtracts opex (office ~18%, retail ~22%, industrial ~15%). Hospitality shifts to GOP / EBITDA margin on total revenue.',
    formulas: [
      { k: 'EGI',     f: 'Gross Rent × (1 − Vacancy %)' },
      { k: 'NOI',     f: 'EGI × (1 − Opex %)' },
      { k: 'EBITDA',  f: 'Revenue × EBITDA Margin %' },
    ],
    inputs: ['Opex % (asset-class specific)', 'Vacancy / bad-debt allowance', 'GOP / EBITDA margin (hospitality)'],
  },
  {
    id: 'cashflow',
    number: '03',
    title: 'Cash Flow',
    icon: Waves,
    gradient: 'from-sky-500 to-cyan-500',
    border: 'border-sky-200',
    surface: 'from-sky-50 to-cyan-50',
    text: 'text-sky-900',
    tagline: 'Quarterly equity cash flow stream',
    summary: 'Construction draws on S-curve (negative), operating NOI (positive), finance cost accruals, and debt draws / P&I. Output: quarterly equity cash flow feeding IRR and NPV.',
    formulas: [
      { k: 'Construction', f: 'Drawₜ = Hard × S-curveₜ  (beta 2,2)' },
      { k: 'Finance',      f: 'Interestₜ = Balanceₜ₋₁ × (rate / 4)' },
      { k: 'Equity CF',    f: 'Σ NOIₜ − Opexₜ − Debt Serviceₜ + Draws − Costs' },
    ],
    inputs: ['Construction window', 'Debt rate, LTV, term', 'Sellout / lease-up curve'],
  },
  {
    id: 'terminal',
    number: '04',
    title: 'Terminal Value',
    icon: Target,
    gradient: 'from-violet-500 to-purple-500',
    border: 'border-violet-200',
    surface: 'from-violet-50 to-purple-50',
    text: 'text-violet-900',
    tagline: 'Exit valuation in year N',
    summary: 'Four interchangeable methods: exit cap rate (default), exit multiple, Gordon perpetuity growth, or contractual forward purchase. The chosen TV is added to the final quarter\'s cash flow before IRR/NPV.',
    formulas: [
      { k: 'Exit Cap',   f: 'TV = NOI_exit ÷ Exit Cap Rate' },
      { k: 'Multiple',   f: 'TV = NOI_stabilized × Exit Multiple (9–12×)' },
      { k: 'Perpetuity', f: 'TV = NOI_exit × (1 + g) ÷ (r − g)' },
      { k: 'Forward',    f: 'TV = Contractual Price (₹ Cr)' },
    ],
    inputs: ['Exit cap rate', 'Exit multiple', 'Perpetuity growth g', 'Forward-purchase price'],
  },
  {
    id: 'npv',
    number: '05',
    title: 'NPV / IRR',
    icon: Percent,
    gradient: 'from-amber-500 to-orange-500',
    border: 'border-amber-200',
    surface: 'from-amber-50 to-orange-50',
    text: 'text-amber-900',
    tagline: 'Discounted return metrics',
    summary: 'All quarterly equity cash flows (including the discounted TV injected in the terminal quarter) are discounted at WACC for NPV. IRR solves the same series for the rate at which NPV = 0.',
    formulas: [
      { k: 'NPV', f: 'Σ CFₜ ÷ (1 + r/4)^t  — r = discount rate' },
      { k: 'IRR', f: 'Σ CFₜ ÷ (1 + IRR/4)^t = 0   (Newton-Raphson)' },
      { k: 'PV of TV', f: 'TV ÷ (1 + r)^holdYears' },
    ],
    inputs: ['Discount rate / WACC', 'Hold period', 'Final-quarter terminal value'],
  },
];

function DCFFlowSection({ assetClass }) {
  const [expanded, setExpanded] = useState('terminal');
  const assetNote = useMemo(() => {
    const notes = {
      residential_apartments: 'For-sale flow — the terminal stage is sellout completion, not a cap-rate exit. Use exit_multiple or implied developer margin instead of cap-rate TV.',
      plotted_development: 'Plotted layouts exit via inventory sellout. TV typically = remaining unsold × escalated rate, not a capitalized NOI.',
      commercial_office: 'Office TV is dominated by exit-cap sensitivity — a 50bps compression swings NPV materially. Run the Value-vs-Cap curve in the viz layer.',
      retail: 'Retail blends anchor (discounted) + inline rents, and exit caps trade 75–125 bps wider than office.',
      industrial_warehousing: 'Warehousing has the tightest opex ratio (~15%) and cap rates in the 7.5–9.5% band.',
      hospitality: 'Hospitality substitutes EBITDA for NOI. TV default is exit multiple on stabilized EBITDA (9–12×).',
    };
    return notes[assetClass] || notes.commercial_office;
  }, [assetClass]);

  return (
    <div className="space-y-5">
      <SectionTitle
        icon={Route}
        gradient="from-blue-500 to-indigo-500"
        title="DCF Flow — End-to-End"
        subtitle="Revenue → NOI → Cash Flow → Terminal Value → NPV / IRR"
      />

      <div className="rounded-xl border border-blue-100 bg-gradient-to-br from-slate-900 via-indigo-900 to-violet-900 p-5 text-white shadow-sm">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-indigo-200">
          <Sparkles size={12} /> The Five-Stage Pipeline
        </div>
        <p className="mt-1 text-sm leading-relaxed text-indigo-100/90">
          Every rupee in the model flows through exactly these five stages. Click any card to expand its formulas,
          required inputs, and cross-references to the code path that executes it.
        </p>
      </div>

      {/* Pipeline strip */}
      <div className="hidden md:flex items-center justify-between gap-1">
        {DCF_STAGES.map((s, i) => {
          const Icon = s.icon;
          const isActive = expanded === s.id;
          return (
            <div key={s.id} className="flex items-center flex-1">
              <button
                type="button"
                onClick={() => setExpanded(s.id)}
                className={`flex-1 flex flex-col items-center gap-1 rounded-xl border p-2.5 transition ${
                  isActive
                    ? `bg-gradient-to-br ${s.surface} ${s.border} shadow-md scale-[1.02]`
                    : 'bg-bg-elevated border-hairline-strong hover:border-hairline-strong hover:shadow-sm'
                }`}
              >
                <div className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br ${s.gradient} text-white shadow`}>
                  <Icon size={14} />
                </div>
                <div className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? s.text : 'text-content-secondary'}`}>
                  {s.number}
                </div>
                <div className={`text-xs font-bold ${isActive ? s.text : 'text-content-primary'}`}>{s.title}</div>
              </button>
              {i < DCF_STAGES.length - 1 && (
                <ArrowRight size={14} className="mx-1 shrink-0 text-content-muted" />
              )}
            </div>
          );
        })}
      </div>

      {/* Expandable stage cards */}
      <div className="space-y-3">
        {DCF_STAGES.map((s) => {
          const Icon = s.icon;
          const isOpen = expanded === s.id;
          return (
            <div
              key={s.id}
              className={`rounded-xl border overflow-hidden transition-all ${
                isOpen ? `${s.border} shadow-md` : 'border-hairline-strong'
              }`}
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : s.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition ${
                  isOpen ? `bg-gradient-to-r ${s.surface}` : 'bg-bg-elevated hover:bg-bg-secondary'
                }`}
              >
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${s.gradient} text-white shadow`}>
                  <Icon size={16} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${isOpen ? s.text : 'text-content-muted'}`}>
                      Stage {s.number}
                    </span>
                  </div>
                  <div className={`text-sm font-bold ${isOpen ? s.text : 'text-content-primary'}`}>{s.title}</div>
                  <div className="text-xs text-content-secondary">{s.tagline}</div>
                </div>
                <ChevronDown
                  size={16}
                  className={`shrink-0 transition-transform ${isOpen ? 'rotate-180 text-content-secondary' : 'text-content-muted'}`}
                />
              </button>

              {isOpen && (
                <div className="border-t border-white/50 bg-white/60 backdrop-blur-sm px-4 py-4 space-y-3">
                  <p className="text-sm leading-relaxed text-content-secondary">{s.summary}</p>

                  <div className="space-y-2">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-content-secondary">Formulas</div>
                    {s.formulas.map((row, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-hairline-strong bg-bg-elevated p-2">
                        <span className={`text-[11px] font-semibold min-w-[90px] ${s.text}`}>{row.k}</span>
                        <code className="flex-1 rounded bg-bg-secondary px-2 py-1 text-[12px] font-mono text-content-primary">{row.f}</code>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border border-hairline-strong bg-bg-elevated p-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-content-secondary mb-1.5">Driving Inputs</div>
                    <div className="flex flex-wrap gap-1.5">
                      {s.inputs.map((inp, i) => (
                        <span key={i} className="inline-flex items-center rounded-full border border-hairline-strong bg-bg-secondary px-2 py-0.5 text-[11px] font-medium text-content-secondary">
                          {inp}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-4">
        <div className="flex items-center gap-2">
          <Building2 size={14} className="text-violet-700" />
          <span className="text-xs font-bold uppercase tracking-wider text-violet-900">
            {ASSET_CLASS_DEEP_DIVE[assetClass]?.headline?.split('—')[0]?.trim() || 'Asset-Class Note'}
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-content-secondary">{assetNote}</p>
      </div>
    </div>
  );
}

/* ───────────────────── Terminal Value Section ───────────────────── */

const TV_METHODS = [
  {
    id: 'exit_cap_rate',
    title: 'Exit Cap Rate',
    tagline: 'Most common for stabilized income assets',
    icon: Gauge,
    gradient: 'from-emerald-500 to-teal-500',
    surface: 'from-emerald-50 to-teal-50',
    border: 'border-emerald-200',
    formula: 'TV = NOI_exit ÷ Exit Cap Rate',
    example: 'NOI_exit = ₹42 Cr, Cap = 7.5% → TV = 42 ÷ 0.075 = ₹560 Cr',
    when: 'Office, retail, industrial — anywhere a liquid cap-rate market exists. Buyers underwrite forward NOI.',
    pros: ['Directly observable from recent sales', 'Market-consistent', 'Easy to sensitivity-test'],
    cons: ['Caps change rapidly in tight cycles', 'Less robust for niche assets'],
  },
  {
    id: 'exit_multiple',
    title: 'Exit Multiple',
    tagline: 'Hospitality / operating assets',
    icon: Layers,
    gradient: 'from-blue-500 to-indigo-500',
    surface: 'from-blue-50 to-indigo-50',
    border: 'border-blue-200',
    formula: 'TV = NOI_stabilized × Exit Multiple',
    example: 'EBITDA = ₹18 Cr, 10× → TV = ₹180 Cr',
    when: 'Hotels, serviced apartments, student housing — wherever EBITDA-multiple comps are the market norm.',
    pros: ['Aligns with how M&A/IPO markets price', 'Simpler to explain to operators'],
    cons: ['Multiple range is wide (7–14×)', 'Hides embedded growth assumption'],
  },
  {
    id: 'perpetuity_growth',
    title: 'Perpetuity Growth (Gordon)',
    tagline: 'Stabilized, long-hold, steady-state',
    icon: TrendingUp,
    gradient: 'from-violet-500 to-purple-500',
    surface: 'from-violet-50 to-purple-50',
    border: 'border-violet-200',
    formula: 'TV = NOI_exit × (1 + g) ÷ (r − g)',
    example: 'NOI = ₹42 Cr, g = 3%, r = 11% → TV = 42 × 1.03 ÷ 0.08 = ₹541 Cr',
    when: 'Core-plus strategies assuming asset lives forever — India REIT underwriting, annuity-style income.',
    pros: ['Academically rigorous', 'Smooth with long-dated cash flows'],
    cons: ['r − g spread must be > 0 or the formula explodes', 'Highly sensitive to g — ±100bps swings TV 15–25%'],
  },
  {
    id: 'forward_purchase',
    title: 'Forward Purchase',
    tagline: 'Contractual pre-committed exit',
    icon: GitFork,
    gradient: 'from-amber-500 to-orange-500',
    surface: 'from-amber-50 to-orange-50',
    border: 'border-amber-200',
    formula: 'TV = Contractual Forward Price (₹ Cr)',
    example: 'Signed forward with institutional buyer at ₹485 Cr → TV = ₹485 Cr',
    when: 'Deal has a signed forward purchase agreement (BlackRock / Blackstone / GIC style pre-commitments).',
    pros: ['Zero exit-pricing risk', 'Known, bankable exit date'],
    cons: ['Lower price vs open-market', 'Counterparty / contingency risk'],
  },
];

function TerminalValueSection() {
  const [activeMethod, setActiveMethod] = useState('exit_cap_rate');
  const active = TV_METHODS.find((m) => m.id === activeMethod) || TV_METHODS[0];
  const ActiveIcon = active.icon;

  return (
    <div className="space-y-5">
      <SectionTitle
        icon={Target}
        gradient="from-violet-500 to-purple-500"
        title="Terminal Value — The Exit Valuation"
        subtitle="Four methods, one unified pipeline"
      />

      <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-4">
        <div className="flex items-center gap-2 text-violet-900">
          <Sparkles size={14} />
          <span className="text-sm font-bold">Terminal value is ≥50% of NPV for most income assets</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-content-secondary">
          On a 5–7 year hold, the discounted terminal value typically accounts for 45–65% of total NPV.
          Getting the exit assumption right matters more than squeezing an extra 10 bps of rent escalation.
          REDIP supports four methods — pick the one that matches your market and thesis.
        </p>
      </div>

      {/* Method picker */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {TV_METHODS.map((m) => {
          const Icon = m.icon;
          const isActive = activeMethod === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setActiveMethod(m.id)}
              className={`relative rounded-xl border p-3 text-left transition ${
                isActive
                  ? `bg-gradient-to-br ${m.surface} ${m.border} shadow-md`
                  : 'bg-bg-elevated border-hairline-strong hover:border-hairline-strong hover:shadow-sm'
              }`}
            >
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${m.gradient} text-white shadow-sm`}>
                <Icon size={14} />
              </div>
              <div className="mt-2 text-xs font-bold text-content-primary">{m.title}</div>
              <div className="text-[10px] text-content-secondary leading-tight mt-0.5">{m.tagline}</div>
            </button>
          );
        })}
      </div>

      {/* Active method detail */}
      <div className={`rounded-xl border ${active.border} bg-gradient-to-br ${active.surface} p-5`}>
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${active.gradient} text-white shadow`}>
            <ActiveIcon size={18} />
          </div>
          <div>
            <div className="text-lg font-bold text-content-primary">{active.title}</div>
            <div className="text-xs text-content-secondary">{active.tagline}</div>
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-bg-elevated border border-hairline shadow-sm p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-content-secondary mb-1">Formula</div>
          <code className="block rounded bg-bg-secondary px-3 py-2 text-sm font-mono text-content-primary">{active.formula}</code>
          <div className="mt-2 flex items-start gap-2 text-xs">
            <span className="mt-0.5 inline-block rounded bg-bg-primary px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">example</span>
            <span className="font-mono text-content-secondary">{active.example}</span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-800 mb-1.5">Pros</div>
            <ul className="space-y-1 text-xs text-content-secondary">
              {active.pros.map((p, i) => <li key={i}>• {p}</li>)}
            </ul>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-rose-800 mb-1.5">Cons</div>
            <ul className="space-y-1 text-xs text-content-secondary">
              {active.cons.map((c, i) => <li key={i}>• {c}</li>)}
            </ul>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-hairline-strong bg-bg-elevated p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-content-secondary mb-1">When to use</div>
          <p className="text-xs text-content-secondary">{active.when}</p>
        </div>
      </div>

      <Formula
        label="PV of Terminal Value"
        expr="PV_TV = TV ÷ (1 + discountRate)^holdPeriodYears"
        note="The TV is computed in year N, then discounted back to t = 0 before being added into NPV. Engine injects the non-discounted TV into the final quarter's cash flow — the standard NPV formula handles the discount."
      />

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-2 text-amber-900">
          <TrendingDown size={14} />
          <span className="text-sm font-bold">Perpetuity Growth — fallback logic</span>
        </div>
        <p className="mt-1 text-xs text-amber-900">
          If <code className="font-mono font-bold">r ≤ g</code> (discount rate not strictly greater than growth), the perpetuity
          formula is mathematically invalid (division by zero or negative). REDIP falls back to the exit-cap method in that case
          rather than throwing, preserving auditability and preventing NaN propagation.
        </p>
      </div>
    </div>
  );
}
