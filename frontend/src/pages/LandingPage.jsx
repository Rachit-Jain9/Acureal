import { useNavigate } from 'react-router-dom';

// ─────────────────────────────────────────────────────────────────────────────
// REDIP Landing — editorial, IC-grade.
// Design intent: Bloomberg + Stripe + Linear. Dense, typographic, grown-up.
// No gradient hero, no icon-in-colored-box, no "AI-powered" marketing surface.
// ─────────────────────────────────────────────────────────────────────────────

const ACCENT = 'text-[#c2410c]'; // burnt-orange, single accent across the page
const ACCENT_BG = 'bg-[#c2410c]';
const ACCENT_BORDER = 'border-[#c2410c]';
const ACCENT_WEAK = 'text-[#9a3412]';

function Nav() {
  const navigate = useNavigate();
  return (
    <nav className="sticky top-0 z-50 bg-white/85 backdrop-blur border-b border-stone-200">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-baseline gap-6">
          <span className="font-serif text-xl font-semibold tracking-tight text-stone-900">
            REDIP<span className={ACCENT}>.</span>
          </span>
          <span className="hidden sm:inline text-[11px] uppercase tracking-[0.18em] text-stone-500">
            Real Estate Deal Intelligence · India
          </span>
        </div>
        <div className="flex items-center gap-5">
          <button
            onClick={() => navigate('/login')}
            className="text-sm text-stone-700 hover:text-stone-900"
          >
            Sign in
          </button>
          <button
            onClick={() => navigate('/login')}
            className={`text-sm font-medium text-white px-3.5 py-1.5 rounded-sm ${ACCENT_BG} hover:brightness-95`}
          >
            Request access →
          </button>
        </div>
      </div>
    </nav>
  );
}

// ── Hero — typographic, no gradient, editorial kicker + real numbers strip ──
function Hero() {
  const navigate = useNavigate();
  return (
    <section className="bg-white border-b border-stone-200">
      <div className="max-w-6xl mx-auto px-6 pt-20 pb-16 md:pt-28 md:pb-24">
        <div className="text-[11px] uppercase tracking-[0.22em] text-stone-500 mb-6">
          <span className={ACCENT_WEAK}>Volume I · Issue 01</span>
          <span className="mx-3 text-stone-300">·</span>
          Bengaluru / Greater Bengaluru priority
        </div>
        <h1 className="font-serif text-5xl md:text-[64px] leading-[1.05] tracking-tight text-stone-900 max-w-4xl">
          Underwriting is a <em className="italic">first-class</em> engineering problem.
        </h1>
        <p className="mt-7 text-lg md:text-xl text-stone-700 leading-relaxed max-w-2xl">
          REDIP is the operating system for live real-estate deal work in India —
          a deterministic financial kernel, provenance-traced diligence, and IC-ready
          outputs. Built for GPs who will not ship a memo whose math they cannot defend.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3">
          <button
            onClick={() => navigate('/login')}
            className={`text-sm font-medium text-white px-5 py-2.5 rounded-sm ${ACCENT_BG} hover:brightness-95`}
          >
            Start a deal →
          </button>
          <a
            href="#kernel"
            className="text-sm font-medium text-stone-900 border-b border-stone-400 hover:border-stone-900 pb-0.5"
          >
            How the kernel works
          </a>
        </div>

        {/* Editorial KPI strip — real numbers, not icons */}
        <div className="mt-20 border-t border-stone-200 pt-8 grid grid-cols-2 md:grid-cols-5 gap-y-6 gap-x-8">
          {[
            ['10', 'Asset classes', 'residential → hospitality'],
            ['15y', 'Quarterly horizon', 'per cash-flow line'],
            ['7', 'DD layers', 'title → physical'],
            ['8', 'Deal structures', 'outright · JV · JDA · …'],
            ['₹', 'INR-native', 'lakh · crore · sqft'],
          ].map(([stat, label, note]) => (
            <div key={label}>
              <div className="font-serif text-3xl md:text-4xl font-medium text-stone-900 leading-none">
                {stat}
              </div>
              <div className="mt-2 text-xs uppercase tracking-[0.16em] text-stone-500">
                {label}
              </div>
              <div className="mt-1 text-[11px] text-stone-400">{note}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── The kernel — section that shows an actual artifact, not a claim ──
function Kernel() {
  return (
    <section id="kernel" className="bg-stone-50 border-b border-stone-200">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-24 grid md:grid-cols-12 gap-10">
        <div className="md:col-span-5">
          <div className={`text-[11px] uppercase tracking-[0.22em] mb-4 ${ACCENT_WEAK}`}>
            § The kernel
          </div>
          <h2 className="font-serif text-3xl md:text-4xl leading-tight tracking-tight text-stone-900">
            Deterministic. Provenance&#8209;traced. Defensible.
          </h2>
          <p className="mt-5 text-stone-700 leading-relaxed">
            Every KPI on a deal page resolves to a directed graph of inputs,
            derived values, and the formula that produced it. No LLM touches
            the math. A partner reading your memo can drill from IRR all the
            way to the stamp-duty assumption — in one click.
          </p>
          <ul className="mt-6 space-y-2.5 text-sm text-stone-800">
            {[
              'One kernel, ten asset classes, zero Python duplicates',
              'IRR, NPV, equity multiple, DSCR, yield on cost',
              'JDA · JV · revenue share · area share · profit share',
              'Kernel DAG visible in the UI — no black boxes',
            ].map((line) => (
              <li key={line} className="flex gap-3">
                <span className={`${ACCENT} font-serif leading-none pt-1`}>§</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Faux kernel output — makes the claim visible */}
        <div className="md:col-span-7">
          <div className="rounded-sm border border-stone-300 bg-white shadow-[0_1px_0_0_rgba(0,0,0,0.03)]">
            <div className="flex items-center justify-between px-4 py-2 border-b border-stone-200 bg-stone-100 text-[11px] uppercase tracking-[0.14em] text-stone-500">
              <span>Provenance · deal 2026-BLR-127</span>
              <span className="tabular-nums">residential_apartments</span>
            </div>
            <div className="p-5 font-mono text-[12.5px] leading-[1.75] text-stone-800">
              <div><span className="text-stone-400">kpi.</span>irr <span className="text-stone-400">=</span> <span className={ACCENT_WEAK}>14.03%</span></div>
              <div className="pl-5"><span className="text-stone-400">←</span> cashflow.equity <span className="text-stone-400">[60 quarters]</span></div>
              <div className="pl-10"><span className="text-stone-400">←</span> derived.netRevenue</div>
              <div className="pl-[60px]"><span className="text-stone-400">←</span> input.sellingRatePerSqft <span className="text-stone-400">=</span> 9,850</div>
              <div className="pl-[60px]"><span className="text-stone-400">←</span> input.plotAreaSqft × input.fsi <span className="text-stone-400">= BUA</span></div>
              <div className="pl-10"><span className="text-stone-400">←</span> derived.totalCost</div>
              <div className="pl-[60px]"><span className="text-stone-400">←</span> input.landCostCr <span className="text-stone-400">=</span> 42.00</div>
              <div className="pl-[60px]"><span className="text-stone-400">←</span> input.constructionCostPerSqft <span className="text-stone-400">=</span> 3,200</div>
              <div className="pl-[60px]"><span className="text-stone-400">←</span> derived.stampDutyCr <span className="text-stone-400">=</span> landCostCr × 0.056</div>
              <div className="mt-4 pt-3 border-t border-stone-200 text-stone-500 text-[11px]">
                Every IRR you show an IC is the root of a graph like this.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Three-column editorial: Underwrite / Diligence / Report ──
function Columns() {
  const columns = [
    {
      tag: '§ Underwrite',
      title: 'A deterministic financial engine.',
      body: 'Ten asset classes. Eight deal structures. Fifteen-year quarterly horizons. Sources & uses, debt schedules, JDA / JV waterfalls, scenario comparison, and sensitivity tornadoes — all from a single kernel in TypeScript.',
      bullets: ['Quick-compute < 50ms', 'What-If sliders with live KPI deltas', 'Downside / Base / Upside scenarios'],
    },
    {
      tag: '§ Diligence',
      title: 'Seven layers, each scored by deal impact.',
      body: 'Title, regulatory, seller validity, statutory approvals, financial, project, and physical. Each DD item is classified as Deal-Breaker, Buildability-Blocker, Commercial-Blocker, or Secondary. Evidence links live inside the deal — not in a separate drive.',
      bullets: ['Kannada-language EC/RTC extraction', 'JDA/JV clause parsing', 'Missing-item detection'],
    },
    {
      tag: '§ Report',
      title: 'IC-ready outputs without reformatting.',
      body: 'A memo, a model, a DD summary, and a risk narrative. One click each. Every number is traced to its source — so the pushback in the IC room is about the deal, not about the spreadsheet.',
      bullets: ['Investor-grade PDF memo', 'Excel model export', 'Structured risk narrative'],
    },
  ];
  return (
    <section className="bg-white border-b border-stone-200">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-24">
        <div className="grid md:grid-cols-3 gap-10 md:gap-8">
          {columns.map((c) => (
            <div key={c.tag}>
              <div className={`text-[11px] uppercase tracking-[0.22em] mb-4 ${ACCENT_WEAK}`}>
                {c.tag}
              </div>
              <h3 className="font-serif text-2xl leading-snug tracking-tight text-stone-900">
                {c.title}
              </h3>
              <p className="mt-4 text-sm text-stone-700 leading-relaxed">{c.body}</p>
              <ul className="mt-5 space-y-2 text-[13px] text-stone-800 border-t border-stone-200 pt-4">
                {c.bullets.map((b) => (
                  <li key={b} className="flex items-baseline gap-2">
                    <span className="text-stone-400 font-mono text-[11px]">→</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Asset classes — typographic grid, no chips ──
function AssetClasses() {
  const rows = [
    ['Residential apartments', 'Mumbai / NCR / Bengaluru stacks'],
    ['Villas', 'low-rise, plotted-adjacent'],
    ['Plotted development', 'layout approvals, saleable %'],
    ['Commercial office', 'Grade-A, leasing + yield'],
    ['Retail', 'high-street + mall'],
    ['Industrial / warehousing', 'logistics parks, peripheral'],
    ['Hospitality', 'ADR + occupancy stabilisation'],
    ['Mixed-use', 'residential + retail + office'],
    ['Redevelopment', 'FSI premiums + existing tenant TDR'],
    ['Raw land', 'appreciation-play, zone transitions'],
  ];
  return (
    <section className="bg-stone-50 border-b border-stone-200">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-24">
        <div className="grid md:grid-cols-12 gap-8">
          <div className="md:col-span-4">
            <div className={`text-[11px] uppercase tracking-[0.22em] mb-4 ${ACCENT_WEAK}`}>
              § Asset coverage
            </div>
            <h2 className="font-serif text-3xl md:text-4xl leading-tight tracking-tight text-stone-900">
              Every asset class an Indian GP actually underwrites.
            </h2>
            <p className="mt-5 text-stone-700 leading-relaxed text-[15px]">
              Not a toy subset. Each class is modelled against its own cash-flow
              shape — apartment absorption is not a plotted layout, and a hotel
              is nobody&rsquo;s office tower.
            </p>
          </div>
          <div className="md:col-span-8">
            <div className="border-t border-stone-300">
              {rows.map(([name, note], i) => (
                <div
                  key={name}
                  className="flex items-baseline justify-between border-b border-stone-200 py-3.5"
                >
                  <div className="flex items-baseline gap-4">
                    <span className="font-mono text-[11px] text-stone-400 tabular-nums">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-stone-900 font-medium">{name}</span>
                  </div>
                  <span className="text-[12.5px] text-stone-500">{note}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── India-first — short, specific ──
function IndiaFirst() {
  return (
    <section className="bg-white border-b border-stone-200">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-24 grid md:grid-cols-12 gap-10">
        <div className="md:col-span-5">
          <div className={`text-[11px] uppercase tracking-[0.22em] mb-4 ${ACCENT_WEAK}`}>
            § India, not a port
          </div>
          <h2 className="font-serif text-3xl md:text-4xl leading-tight tracking-tight text-stone-900">
            A Western model bent onto Indian inputs breaks on contact.
          </h2>
        </div>
        <div className="md:col-span-7 text-[15px] text-stone-700 leading-relaxed space-y-4">
          <p>
            Stamp duty and registration as a first-class kernel input. Plot area
            in sqft, sqyd, or acres — the same field. Money in lakh, crore, or
            INR. Dates in en-IN. RTC, Pahani, encumbrance certificates, JDA and
            JV clauses — parsed including Kannada-language records.
          </p>
          <p>
            Bengaluru-first by default: BBMP zoning, BDA khata, BMRDA layout
            approvals. The rest of the country arrives by configuration, not by
            rewrite.
          </p>
        </div>
      </div>
    </section>
  );
}

// ── Closing ──
function Close() {
  const navigate = useNavigate();
  return (
    <section className="bg-stone-950 text-stone-100">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-24">
        <div className="max-w-3xl">
          <div className={`text-[11px] uppercase tracking-[0.22em] mb-5 text-[#fb923c]`}>
            § Deploy
          </div>
          <h2 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight text-white">
            Put REDIP on your pipeline.
          </h2>
          <p className="mt-5 text-stone-400 text-lg max-w-2xl leading-relaxed">
            Spin up a deal workspace, link a parcel, run the kernel, and export
            an IC memo in the time it would have taken to reconcile your
            spreadsheet tabs.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <button
              onClick={() => navigate('/login')}
              className={`text-sm font-medium text-white px-5 py-2.5 rounded-sm ${ACCENT_BG} hover:brightness-110`}
            >
              Request access →
            </button>
            <button
              onClick={() => navigate('/login')}
              className="text-sm font-medium text-stone-200 border border-stone-700 hover:border-stone-400 px-5 py-2.5 rounded-sm"
            >
              Sign in
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-stone-950 text-stone-500 border-t border-stone-800">
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-3 text-[12px]">
        <div>
          <span className="font-serif text-stone-300 text-base">REDIP<span className="text-[#c2410c]">.</span></span>
          <span className="ml-3 uppercase tracking-[0.18em] text-stone-500 text-[10.5px]">
            Real Estate Deal Intelligence
          </span>
        </div>
        <div className="text-stone-500">
          India-first · No mock data · No fabricated facts
        </div>
        <div className="text-stone-600 tabular-nums">
          © {new Date().getFullYear()} REDIP
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-stone-900 antialiased">
      <Nav />
      <Hero />
      <Kernel />
      <Columns />
      <AssetClasses />
      <IndiaFirst />
      <Close />
      <Footer />
    </div>
  );
}
