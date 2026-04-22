import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

// ─────────────────────────────────────────────────────────────────────────────
// REDIP Landing — editorial, IC-grade.
// Bloomberg + Stripe + Linear. Typographic, grown-up. Single burnt-orange accent.
// Animated translucent grid behind the hero; scroll-reveal on subsequent sections.
// ─────────────────────────────────────────────────────────────────────────────

const ACCENT = 'text-[#c2410c]';
const ACCENT_BG = 'bg-[#c2410c]';
const ACCENT_WEAK = 'text-[#9a3412]';

// Intersection-observer driven fade/slide-in. One-shot.
function Reveal({ children, delay = 0, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            el.style.transitionDelay = `${delay}ms`;
            el.classList.add('redip-revealed');
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);
  return (
    <div ref={ref} className={`redip-reveal ${className}`}>
      {children}
    </div>
  );
}

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

// Translucent animated background: slow-drifting grid + orbiting accent lines.
// Pure SVG + CSS — no deps, renders crisply at any size, ~0 CPU.
function HeroBackdrop() {
  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Warm paper wash */}
      <div className="absolute inset-0 bg-gradient-to-b from-white via-[#fdfaf4] to-white" />
      {/* Drifting architectural grid */}
      <svg
        className="absolute inset-0 w-full h-full opacity-[0.35] redip-hero-drift"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="redip-grid-fine" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#d6d3d1" strokeWidth="0.5" />
          </pattern>
          <pattern id="redip-grid-bold" width="140" height="140" patternUnits="userSpaceOnUse">
            <path d="M 140 0 L 0 0 0 140" fill="none" stroke="#b8b5b1" strokeWidth="0.7" />
          </pattern>
          <radialGradient id="redip-spot" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="65%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#redip-grid-fine)" />
        <rect width="100%" height="100%" fill="url(#redip-grid-bold)" />
        <rect width="100%" height="100%" fill="url(#redip-spot)" />
      </svg>
      {/* Skyline silhouette — translucent, slow pan */}
      <svg
        className="absolute bottom-0 left-0 w-[140%] h-[38%] opacity-[0.08] redip-hero-skyline"
        viewBox="0 0 1400 300"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          fill="#1c1917"
          d="M0 300 V220 H40 V160 H80 V200 H120 V120 H180 V170 H220 V90 H280 V140 H320 V60 H380 V130 H430 V180 H470 V110 H520 V40 H580 V100 H630 V170 H680 V80 H740 V130 H790 V60 H850 V20 H900 V80 H950 V140 H1000 V70 H1060 V110 H1110 V30 H1170 V90 H1220 V150 H1270 V60 H1330 V120 H1400 V300 Z"
        />
      </svg>
      {/* Accent orbit — a single slow burnt-orange arc */}
      <svg
        className="absolute -top-20 -right-20 w-[520px] h-[520px] opacity-30 redip-hero-orbit"
        viewBox="0 0 200 200"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="100" cy="100" r="90" fill="none" stroke="#c2410c" strokeWidth="0.4" strokeDasharray="2 6" />
        <circle cx="100" cy="100" r="70" fill="none" stroke="#c2410c" strokeWidth="0.3" strokeDasharray="1 5" />
        <circle cx="100" cy="100" r="50" fill="none" stroke="#c2410c" strokeWidth="0.3" strokeDasharray="1 4" />
      </svg>
    </div>
  );
}

function Hero() {
  const navigate = useNavigate();
  return (
    <section className="relative bg-white border-b border-stone-200 overflow-hidden">
      <HeroBackdrop />
      <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-16 md:pt-28 md:pb-24">
        <div className="text-[11px] uppercase tracking-[0.22em] text-stone-500 mb-6">
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
          <button
            onClick={() => navigate('/login')}
            className="text-sm font-medium text-stone-900 border-b border-stone-400 hover:border-stone-900 pb-0.5"
          >
            Request access
          </button>
        </div>

        <div className="mt-20 border-t border-stone-200 pt-8 grid grid-cols-2 md:grid-cols-4 gap-y-6 gap-x-8">
          {[
            ['10', 'Asset classes', 'residential → hospitality'],
            ['15y', 'Quarterly horizon', 'per cash-flow line'],
            ['7', 'DD layers', 'title → physical'],
            ['8', 'Deal structures', 'outright · JV · JDA · …'],
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
          {columns.map((c, i) => (
            <Reveal key={c.tag} delay={i * 90}>
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
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

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
          <Reveal className="md:col-span-4">
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
          </Reveal>
          <div className="md:col-span-8">
            <div className="border-t border-stone-300">
              {rows.map(([name, note], i) => (
                <Reveal key={name} delay={i * 30}>
                  <div className="flex items-baseline justify-between border-b border-stone-200 py-3.5">
                    <div className="flex items-baseline gap-4">
                      <span className="font-mono text-[11px] text-stone-400 tabular-nums">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-stone-900 font-medium">{name}</span>
                    </div>
                    <span className="text-[12.5px] text-stone-500">{note}</span>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function IndiaFirst() {
  return (
    <section className="bg-white border-b border-stone-200">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-24 grid md:grid-cols-12 gap-10">
        <Reveal className="md:col-span-5">
          <div className={`text-[11px] uppercase tracking-[0.22em] mb-4 ${ACCENT_WEAK}`}>
            § India, not a port
          </div>
          <h2 className="font-serif text-3xl md:text-4xl leading-tight tracking-tight text-stone-900">
            A Western model bent onto Indian inputs breaks on contact.
          </h2>
        </Reveal>
        <Reveal className="md:col-span-7" delay={120}>
          <div className="text-[15px] text-stone-700 leading-relaxed space-y-4">
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
        </Reveal>
      </div>
    </section>
  );
}

function Close() {
  const navigate = useNavigate();
  return (
    <section className="bg-stone-950 text-stone-100">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-24">
        <div className="max-w-3xl">
          <div className="text-[11px] uppercase tracking-[0.22em] mb-5 text-[#fb923c]">
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
      <Columns />
      <AssetClasses />
      <IndiaFirst />
      <Close />
      <Footer />
    </div>
  );
}
