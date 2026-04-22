import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import useThemeStore from '../store/themeStore';
import { Moon, Sun } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// REDIP Landing — Precision Analysis system.
// Bloomberg DNA: near-black surface, crisp typography, blue trust accent,
// amber premium signal, tabular numerals everywhere.
// Fully themed: flips on html[data-theme] from dark → light.
// ─────────────────────────────────────────────────────────────────────────────

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
  const mode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);
  return (
    <nav
      className="sticky top-0 z-50 backdrop-blur"
      style={{
        backgroundColor: mode === 'dark' ? 'rgba(5,5,7,0.82)' : 'rgba(255,255,255,0.85)',
        borderBottom: '1px solid var(--color-border-primary)',
      }}
    >
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-baseline gap-6">
          <span
            className="font-serif text-xl font-semibold tracking-tight"
            style={{ color: 'var(--color-text-primary)' }}
          >
            REDIP
            <span style={{ color: 'var(--color-brand-premium)' }}>.</span>
          </span>
          <span
            className="hidden sm:inline text-[11px] uppercase tracking-[0.18em]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Real Estate Deal Intelligence · India
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-2 rounded-md transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {mode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            onClick={() => navigate('/login')}
            className="text-sm px-3 py-1.5 rounded-md transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Sign in
          </button>
          <button
            onClick={() => navigate('/login')}
            className="text-sm font-medium text-white px-3.5 py-1.5 rounded-md hover:brightness-110"
            style={{ backgroundColor: 'var(--color-brand-accent)' }}
          >
            Request access →
          </button>
        </div>
      </div>
    </nav>
  );
}

// Animated hero backdrop: drifting grid, subtle skyline, accent orbit, ticker.
function HeroBackdrop() {
  const mode = useThemeStore((s) => s.mode);
  const isDark = mode === 'dark';
  const gridStroke = isDark ? '#1e293b' : '#e2e8f0';
  const boldStroke = isDark ? '#334155' : '#cbd5e1';
  const spotStop   = isDark ? '#050507' : '#ffffff';
  const skylineFill = isDark ? '#f1f5f9' : '#0f172a';
  const skylineOp   = isDark ? 0.06 : 0.05;

  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Gradient wash */}
      <div
        className="absolute inset-0"
        style={{
          background: isDark
            ? 'radial-gradient(1200px 600px at 12% -10%, rgba(59,130,246,0.12), transparent 55%), radial-gradient(800px 500px at 90% 10%, rgba(245,184,0,0.08), transparent 55%), #050507'
            : 'radial-gradient(1200px 600px at 12% -10%, rgba(37,99,235,0.08), transparent 60%), radial-gradient(800px 500px at 90% 10%, rgba(245,184,0,0.06), transparent 60%), #ffffff',
        }}
      />
      {/* Drifting data grid */}
      <svg
        className="absolute inset-0 w-full h-full redip-hero-drift redip-hero-pulse"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="redip-grid-fine" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke={gridStroke} strokeWidth="0.5" />
          </pattern>
          <pattern id="redip-grid-bold" width="140" height="140" patternUnits="userSpaceOnUse">
            <path d="M 140 0 L 0 0 0 140" fill="none" stroke={boldStroke} strokeWidth="0.6" />
          </pattern>
          <radialGradient id="redip-spot" cx="50%" cy="40%" r="70%">
            <stop offset="0%"  stopColor={spotStop} stopOpacity="0" />
            <stop offset="60%" stopColor={spotStop} stopOpacity="0.45" />
            <stop offset="100%" stopColor={spotStop} stopOpacity="0.95" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#redip-grid-fine)" />
        <rect width="100%" height="100%" fill="url(#redip-grid-bold)" />
        <rect width="100%" height="100%" fill="url(#redip-spot)" />
      </svg>
      {/* Skyline silhouette */}
      <svg
        className="absolute bottom-0 left-0 w-[140%] h-[42%] redip-hero-skyline"
        style={{ opacity: skylineOp }}
        viewBox="0 0 1400 300"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          fill={skylineFill}
          d="M0 300 V220 H40 V160 H80 V200 H120 V120 H180 V170 H220 V90 H280 V140 H320 V60 H380 V130 H430 V180 H470 V110 H520 V40 H580 V100 H630 V170 H680 V80 H740 V130 H790 V60 H850 V20 H900 V80 H950 V140 H1000 V70 H1060 V110 H1110 V30 H1170 V90 H1220 V150 H1270 V60 H1330 V120 H1400 V300 Z"
        />
      </svg>
      {/* Accent orbit */}
      <svg
        className="absolute -top-24 -right-24 w-[560px] h-[560px] redip-hero-orbit"
        style={{ opacity: isDark ? 0.35 : 0.25 }}
        viewBox="0 0 200 200"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="100" cy="100" r="92" fill="none" stroke="var(--color-brand-accent)" strokeWidth="0.4" strokeDasharray="2 6" />
        <circle cx="100" cy="100" r="72" fill="none" stroke="var(--color-brand-accent)" strokeWidth="0.3" strokeDasharray="1 5" />
        <circle cx="100" cy="100" r="52" fill="none" stroke="var(--color-brand-premium)" strokeWidth="0.35" strokeDasharray="1 4" />
      </svg>
    </div>
  );
}

// Live-style ticker — real asset-class labels, not fake symbols.
function LiveTicker() {
  const items = [
    ['BLR · Residential', '14.0% IRR', 'pos'],
    ['BLR · Office',      '7.6% cap',   'neu'],
    ['MUM · Mixed-use',   '12.2% IRR',  'pos'],
    ['HYD · Logistics',   '9.4% yield', 'pos'],
    ['BLR · Plotted',     '26.1% IRR',  'pos'],
    ['NCR · Retail',      '8.0% cap',   'neu'],
    ['BLR · Hospitality', 'ADR ₹9,820', 'pre'],
    ['BLR · Redevelopment', '21.8% IRR', 'pos'],
  ];
  const row = [...items, ...items];
  return (
    <div
      className="relative overflow-hidden"
      style={{
        borderTop: '1px solid var(--color-border-primary)',
        borderBottom: '1px solid var(--color-border-primary)',
        backgroundColor: 'var(--color-bg-secondary)',
      }}
    >
      <div className="py-2 flex redip-ticker whitespace-nowrap">
        {row.map(([label, metric, tone], i) => (
          <div
            key={i}
            className="flex items-baseline gap-3 px-6 text-[12px] tabular-nums"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <span className="uppercase tracking-[0.12em] text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              {label}
            </span>
            <span
              style={{
                color:
                  tone === 'pos' ? 'var(--color-data-positive)' :
                  tone === 'pre' ? 'var(--color-brand-premium)' :
                                   'var(--color-data-neutral)',
                fontWeight: 600,
              }}
            >
              {metric}
            </span>
            <span style={{ color: 'var(--color-text-muted)' }}>·</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Hero() {
  const navigate = useNavigate();
  return (
    <section className="relative overflow-hidden" style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
      <HeroBackdrop />
      <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-16 md:pt-28 md:pb-24">
        <div
          className="text-[11px] uppercase tracking-[0.22em] mb-6 flex items-center gap-2"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: 'var(--color-data-positive)', boxShadow: '0 0 0 3px rgba(34,197,94,0.18)' }}
          />
          Live · Bengaluru / Greater Bengaluru priority
        </div>
        <h1
          className="font-serif text-5xl md:text-[64px] leading-[1.05] tracking-tight max-w-4xl"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Underwriting is a <em className="italic" style={{ color: 'var(--color-brand-accent)' }}>first-class</em> engineering problem.
        </h1>
        <p
          className="mt-7 text-lg md:text-xl leading-relaxed max-w-2xl"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          REDIP is the operating system for live real-estate deal work in India —
          a deterministic financial kernel, provenance-traced diligence, and IC-ready
          outputs. Built for GPs who will not ship a memo whose math they cannot defend.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3">
          <button
            onClick={() => navigate('/login')}
            className="text-sm font-medium text-white px-5 py-2.5 rounded-md hover:brightness-110"
            style={{ backgroundColor: 'var(--color-brand-accent)' }}
          >
            Start a deal →
          </button>
          <button
            onClick={() => navigate('/login')}
            className="text-sm font-medium px-5 py-2.5 rounded-md"
            style={{
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border-strong)',
              backgroundColor: 'transparent',
            }}
          >
            Request access
          </button>
        </div>

        {/* Editorial KPI strip with colored data signals */}
        <div
          className="mt-20 pt-8 grid grid-cols-2 md:grid-cols-4 gap-y-6 gap-x-8"
          style={{ borderTop: '1px solid var(--color-border-primary)' }}
        >
          {[
            ['10',  'Asset classes',    'residential → hospitality', 'neu'],
            ['15y', 'Quarterly horizon','per cash-flow line',         'neu'],
            ['7',   'DD layers',        'title → physical',           'pos'],
            ['8',   'Deal structures',  'outright · JV · JDA · …',    'pre'],
          ].map(([stat, label, note, tone]) => (
            <div key={label}>
              <div
                className="font-serif text-3xl md:text-4xl font-medium leading-none tabular-nums"
                style={{
                  color:
                    tone === 'pos' ? 'var(--color-data-positive)' :
                    tone === 'pre' ? 'var(--color-brand-premium)' :
                                     'var(--color-text-primary)',
                }}
              >
                {stat}
              </div>
              <div
                className="mt-2 text-xs uppercase tracking-[0.16em]"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {label}
              </div>
              <div className="mt-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{note}</div>
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
      tone: 'neu',
    },
    {
      tag: '§ Diligence',
      title: 'Seven layers, each scored by deal impact.',
      body: 'Title, regulatory, seller validity, statutory approvals, financial, project, and physical. Each DD item is classified as Deal-Breaker, Buildability-Blocker, Commercial-Blocker, or Secondary. Evidence links live inside the deal — not in a separate drive.',
      bullets: ['Kannada-language EC/RTC extraction', 'JDA/JV clause parsing', 'Missing-item detection'],
      tone: 'pos',
    },
    {
      tag: '§ Report',
      title: 'IC-ready outputs without reformatting.',
      body: 'A memo, a model, a DD summary, and a risk narrative. One click each. Every number is traced to its source — so the pushback in the IC room is about the deal, not about the spreadsheet.',
      bullets: ['Investor-grade PDF memo', 'Excel model export', 'Structured risk narrative'],
      tone: 'pre',
    },
  ];
  const toneColor = (t) =>
    t === 'pos' ? 'var(--color-data-positive)' :
    t === 'pre' ? 'var(--color-brand-premium)' :
                  'var(--color-brand-accent)';

  return (
    <section style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-24">
        <div className="grid md:grid-cols-3 gap-10 md:gap-8">
          {columns.map((c, i) => (
            <Reveal key={c.tag} delay={i * 90}>
              <div className="text-[11px] uppercase tracking-[0.22em] mb-4" style={{ color: toneColor(c.tone) }}>
                {c.tag}
              </div>
              <h3
                className="font-serif text-2xl leading-snug tracking-tight"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {c.title}
              </h3>
              <p className="mt-4 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                {c.body}
              </p>
              <ul
                className="mt-5 space-y-2 text-[13px] pt-4"
                style={{ borderTop: '1px solid var(--color-border-primary)' }}
              >
                {c.bullets.map((b) => (
                  <li key={b} className="flex items-baseline gap-2" style={{ color: 'var(--color-text-primary)' }}>
                    <span className="font-mono text-[11px]" style={{ color: toneColor(c.tone) }}>→</span>
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
    <section
      style={{
        backgroundColor: 'var(--color-bg-secondary)',
        borderBottom: '1px solid var(--color-border-primary)',
      }}
    >
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-24">
        <div className="grid md:grid-cols-12 gap-8">
          <Reveal className="md:col-span-4">
            <div className="text-[11px] uppercase tracking-[0.22em] mb-4" style={{ color: 'var(--color-brand-accent)' }}>
              § Asset coverage
            </div>
            <h2
              className="font-serif text-3xl md:text-4xl leading-tight tracking-tight"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Every asset class an Indian GP actually underwrites.
            </h2>
            <p
              className="mt-5 leading-relaxed text-[15px]"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Not a toy subset. Each class is modelled against its own cash-flow
              shape — apartment absorption is not a plotted layout, and a hotel
              is nobody&rsquo;s office tower.
            </p>
          </Reveal>
          <div className="md:col-span-8">
            <div style={{ borderTop: '1px solid var(--color-border-strong)' }}>
              {rows.map(([name, note], i) => (
                <Reveal key={name} delay={i * 30}>
                  <div
                    className="flex items-baseline justify-between py-3.5"
                    style={{ borderBottom: '1px solid var(--color-border-primary)' }}
                  >
                    <div className="flex items-baseline gap-4">
                      <span
                        className="font-mono text-[11px] tabular-nums"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                        {name}
                      </span>
                    </div>
                    <span className="text-[12.5px]" style={{ color: 'var(--color-text-muted)' }}>
                      {note}
                    </span>
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
    <section style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-24 grid md:grid-cols-12 gap-10">
        <Reveal className="md:col-span-5">
          <div
            className="text-[11px] uppercase tracking-[0.22em] mb-4"
            style={{ color: 'var(--color-brand-premium)' }}
          >
            § India, not a port
          </div>
          <h2
            className="font-serif text-3xl md:text-4xl leading-tight tracking-tight"
            style={{ color: 'var(--color-text-primary)' }}
          >
            A Western model bent onto Indian inputs breaks on contact.
          </h2>
        </Reveal>
        <Reveal className="md:col-span-7" delay={120}>
          <div
            className="text-[15px] leading-relaxed space-y-4"
            style={{ color: 'var(--color-text-secondary)' }}
          >
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
    <section
      style={{
        backgroundColor: 'var(--color-bg-secondary)',
      }}
    >
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-24">
        <div className="max-w-3xl">
          <div
            className="text-[11px] uppercase tracking-[0.22em] mb-5"
            style={{ color: 'var(--color-brand-premium)' }}
          >
            § Deploy
          </div>
          <h2
            className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Put REDIP on your pipeline.
          </h2>
          <p
            className="mt-5 text-lg max-w-2xl leading-relaxed"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Spin up a deal workspace, link a parcel, run the kernel, and export
            an IC memo in the time it would have taken to reconcile your
            spreadsheet tabs.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <button
              onClick={() => navigate('/login')}
              className="text-sm font-medium text-white px-5 py-2.5 rounded-md hover:brightness-110"
              style={{ backgroundColor: 'var(--color-brand-accent)' }}
            >
              Request access →
            </button>
            <button
              onClick={() => navigate('/login')}
              className="text-sm font-medium px-5 py-2.5 rounded-md"
              style={{
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border-strong)',
                backgroundColor: 'transparent',
              }}
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
    <footer
      style={{
        backgroundColor: 'var(--color-bg-primary)',
        borderTop: '1px solid var(--color-border-primary)',
      }}
    >
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-3 text-[12px]">
        <div>
          <span className="font-serif text-base" style={{ color: 'var(--color-text-primary)' }}>
            REDIP
            <span style={{ color: 'var(--color-brand-premium)' }}>.</span>
          </span>
          <span
            className="ml-3 uppercase tracking-[0.18em] text-[10.5px]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Real Estate Deal Intelligence
          </span>
        </div>
        <div style={{ color: 'var(--color-text-muted)' }}>
          India-first · No mock data · No fabricated facts
        </div>
        <div className="tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
          © {new Date().getFullYear()} REDIP
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div
      className="min-h-screen antialiased"
      style={{ backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text-primary)' }}
    >
      <Nav />
      <Hero />
      <LiveTicker />
      <Columns />
      <AssetClasses />
      <IndiaFirst />
      <Close />
      <Footer />
    </div>
  );
}
