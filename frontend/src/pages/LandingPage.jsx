import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import useThemeStore from '../store/themeStore';
import {
  Moon, Sun, ArrowRight, ShieldCheck, AlertTriangle, FileText, TrendingUp,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// REDIP Landing — Precision Analysis system.
// Bloomberg DNA: near-black surface, crisp typography, blue trust accent,
// amber premium signal, tabular numerals everywhere.
// Fully themed: flips on html[data-theme] from dark → light.
//
// The page leads with the product itself — a faithful, on-brand illustration of
// the deal workspace — rather than describing it in prose. The figures inside
// the preview are an illustrative sample deal, not live data.
// ─────────────────────────────────────────────────────────────────────────────

// Shared CTA chrome — full interaction states per docs/FRONTEND_GUIDELINES.md §3.
const PRIMARY_CTA =
  'inline-flex items-center gap-1.5 text-sm font-medium text-white px-5 py-2.5 rounded-md ' +
  'bg-accent transition duration-150 ease-out hover:brightness-110 active:scale-[0.98] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60';

const SECONDARY_CTA =
  'inline-flex items-center gap-1.5 text-sm font-medium px-5 py-2.5 rounded-md ' +
  'text-content-primary border border-hairline-strong bg-transparent ' +
  'transition duration-150 ease-out hover:bg-bg-secondary hover:border-content-muted ' +
  'active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

const toneTextClass = (t) =>
  t === 'pos' ? 'text-data-positive' : t === 'pre' ? 'text-premium' : 'text-accent';

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
      className="sticky top-0 z-50 backdrop-blur border-b border-hairline"
      style={{
        backgroundColor: mode === 'dark' ? 'rgba(5,5,7,0.82)' : 'rgba(255,255,255,0.85)',
      }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3 sm:gap-6 min-w-0">
          <span className="font-serif text-xl font-semibold tracking-tight text-content-primary">
            REDIP
            <span className="text-premium">.</span>
          </span>
          <span className="hidden sm:inline text-[11px] uppercase tracking-[0.18em] text-content-muted">
            Real Estate Deal Intelligence · India
          </span>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          <button
            onClick={toggleTheme}
            aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-2 rounded-md text-content-secondary transition-colors duration-150 ease-out
              hover:text-content-primary hover:bg-bg-secondary
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {mode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            onClick={() => navigate('/login')}
            className="text-sm px-2 sm:px-3 py-1.5 rounded-md whitespace-nowrap text-content-secondary
              transition-colors duration-150 ease-out hover:text-content-primary hover:bg-bg-secondary
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Sign in
          </button>
          <button
            onClick={() => navigate('/login')}
            className="text-sm font-medium text-white px-3 sm:px-3.5 py-1.5 rounded-md whitespace-nowrap
              bg-accent transition duration-150 ease-out hover:brightness-110 active:scale-[0.98]
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <span className="hidden sm:inline">Request access </span>
            <span className="sm:hidden">Request </span>
            →
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

// Live-style ticker — real asset-class labels, illustrative metrics.
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
    <div className="relative overflow-hidden border-y border-hairline bg-bg-secondary">
      <div className="py-2 flex redip-ticker whitespace-nowrap">
        {row.map(([label, metric, tone], i) => (
          <div
            key={i}
            className="flex items-baseline gap-3 px-6 text-[12px] tabular-nums text-content-secondary"
          >
            <span className="uppercase tracking-[0.12em] text-[10px] text-content-muted">
              {label}
            </span>
            <span
              className={
                tone === 'pos' ? 'text-data-positive font-semibold' :
                tone === 'pre' ? 'text-premium font-semibold' :
                                 'text-data-neutral font-semibold'
              }
            >
              {metric}
            </span>
            <span className="text-content-muted">·</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Product-preview building blocks ─────────────────────────────────────────

function PreviewKpi({ label, value, delta, tone = 'neutral' }) {
  const toneClass =
    tone === 'up' ? 'text-data-positive' :
    tone === 'down' ? 'text-data-negative' :
    'text-content-muted';
  return (
    <div className="rounded-md border border-hairline bg-bg-secondary px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.12em] text-content-muted font-medium truncate">
        {label}
      </div>
      <div className="mt-1 font-display text-xl sm:text-2xl font-semibold text-content-primary tabular-nums tracking-tight">
        {value}
      </div>
      <div className={`mt-0.5 text-[11px] tabular-nums ${toneClass}`}>{delta}</div>
    </div>
  );
}

function PreviewRiskRow({ label, posture, tone }) {
  const ok = tone === 'ok';
  const Icon = ok ? ShieldCheck : AlertTriangle;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[12px] text-content-secondary">{label}</span>
      <span
        className={`inline-flex items-center gap-1 text-[11px] font-medium ${
          ok ? 'text-data-positive' : 'text-premium'
        }`}
      >
        <Icon size={12} />
        {posture}
      </span>
    </div>
  );
}

// Illustrative development cash-flow shape: investment phase, then returns.
function MiniCashflowChart() {
  const bars = [-7, -13, -16, -11, -5, 3, 9, 17, 22, 15, 8, 5];
  const max = Math.max(...bars.map((b) => Math.abs(b)));
  return (
    <div className="relative h-28 flex items-stretch gap-1.5" aria-hidden="true">
      <div className="absolute left-0 right-0 top-1/2 h-px bg-hairline" />
      {bars.map((v, i) => {
        const h = (Math.abs(v) / max) * 46;
        const positive = v >= 0;
        return (
          <div key={i} className="flex-1 relative">
            {/* Per-data-point geometry + colour — inline is required here. */}
            <div
              className="absolute left-0 right-0 rounded-[2px]"
              style={{
                height: `${h}%`,
                [positive ? 'bottom' : 'top']: '50%',
                backgroundColor: positive
                  ? 'var(--color-data-positive)'
                  : 'var(--color-border-strong)',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

// A faithful, on-brand illustration of the REDIP deal workspace. Figures are an
// illustrative sample deal — they are not live data.
function ProductPreview() {
  return (
    <Reveal delay={120} className="mt-14">
      <div
        role="img"
        aria-label="Preview of the REDIP deal workspace — underwriting KPIs, a quarterly cash-flow projection, the deal risk radar, and the evidence trail."
        className="relative mx-auto max-w-5xl"
      >
        <div className="rounded-editorial border border-hairline bg-bg-elevated shadow-editorial-lg overflow-hidden">
          {/* Window chrome */}
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-hairline bg-bg-secondary">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-serif text-sm font-semibold text-content-primary">
                REDIP<span className="text-premium">.</span>
              </span>
              <span className="text-content-muted text-xs hidden sm:inline">/</span>
              <span className="text-xs text-content-secondary truncate hidden sm:inline">
                Indiranagar Redevelopment
              </span>
            </div>
            <span className="inline-flex items-center text-[10px] uppercase tracking-[0.1em] font-semibold px-2 py-0.5 rounded-full bg-accent-soft text-accent">
              Underwriting
            </span>
          </div>

          {/* Cockpit body */}
          <div className="p-4 sm:p-5">
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-content-muted mb-3.5">
              <span>Redevelopment</span><span>·</span>
              <span>Indiranagar, Bengaluru</span><span>·</span>
              <span className="tabular-nums">2.4 acres</span><span>·</span>
              <span>JDA — area share</span>
            </div>

            {/* KPI row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <PreviewKpi label="Project IRR"      value="22.4%"   delta="+310 bps vs base" tone="up" />
              <PreviewKpi label="Equity multiple"  value="1.94×"   delta="+0.21× vs base"   tone="up" />
              <PreviewKpi label="Peak equity"      value="₹46.2 Cr" delta="Quarter 4 of 21"  tone="neutral" />
              <PreviewKpi label="DSCR — minimum"   value="1.38×"   delta="Above 1.20 floor" tone="up" />
            </div>

            {/* Chart + risk radar */}
            <div className="grid lg:grid-cols-[1.5fr_1fr] gap-3 mt-3">
              <div className="rounded-md border border-hairline bg-bg-secondary p-3.5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-content-muted font-medium">
                    Quarterly net cash flow · ₹ Cr
                  </span>
                  <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-content-muted">
                    <TrendingUp size={11} /> 15-yr horizon
                  </span>
                </div>
                <MiniCashflowChart />
              </div>
              <div className="rounded-md border border-hairline bg-bg-secondary p-3.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-content-muted font-medium">
                    Deal risk radar
                  </span>
                  <span className="text-[10px] text-premium font-medium">2 unverified</span>
                </div>
                <div className="divide-y divide-hairline-soft">
                  <PreviewRiskRow label="Title chain"       posture="Cleared"        tone="ok" />
                  <PreviewRiskRow label="Encumbrance"       posture="Cleared"        tone="ok" />
                  <PreviewRiskRow label="RERA deviation"    posture="Unverified"     tone="warn" />
                  <PreviewRiskRow label="Promoter delivery" posture="4 of 5 on time" tone="ok" />
                  <PreviewRiskRow label="Approval gap"      posture="1 open item"    tone="warn" />
                </div>
              </div>
            </div>

            {/* Evidence trail */}
            <div className="mt-3 flex items-center gap-2.5 flex-wrap rounded-md border border-hairline bg-bg-secondary px-3.5 py-2.5">
              <ShieldCheck size={13} className="text-accent shrink-0" />
              <span className="text-[11.5px] text-content-secondary">
                Evidence trail — <span className="text-content-primary font-medium tabular-nums">83%</span> of inputs sourced
                · <span className="tabular-nums">14</span> documents · verified 2 days ago
              </span>
              <span className="flex items-center gap-1.5 ml-auto">
                {['Sale deed', 'Encumbrance cert.', 'RERA filing'].map((c) => (
                  <span
                    key={c}
                    className="hidden md:inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-hairline-soft text-content-muted"
                  >
                    <FileText size={9} /> {c}
                  </span>
                ))}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Reveal>
  );
}

function Hero() {
  const navigate = useNavigate();
  const capabilities = [
    '10 asset classes',
    '15-year quarterly horizons',
    '7 diligence layers',
    '8 deal structures',
    'one deterministic kernel',
  ];
  return (
    <section className="relative overflow-hidden border-b border-hairline">
      <HeroBackdrop />
      <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-20 md:pt-28 md:pb-24">
        <div className="max-w-3xl">
          <div className="text-[11px] uppercase tracking-[0.22em] mb-6 flex items-center gap-2 text-content-muted">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: 'var(--color-data-positive)', boxShadow: '0 0 0 3px rgba(34,197,94,0.18)' }}
            />
            Institutional · Private beta
          </div>
          <h1 className="font-serif text-5xl md:text-[64px] leading-[1.05] tracking-tight text-content-primary">
            The deal intelligence platform <em className="italic text-accent">private capital</em> runs on.
          </h1>
          <p className="mt-7 text-lg md:text-xl leading-relaxed max-w-2xl text-content-secondary">
            REDIP unifies sourcing, diligence, underwriting, and investor-grade
            reporting into one workspace. AI accelerates the read. A deterministic
            financial kernel keeps the math unassailable. Every number traced to its
            source, every assumption stressed — so the memo your Investment
            Committee receives is the memo they approve.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <button onClick={() => navigate('/login')} className={PRIMARY_CTA}>
              Request access <ArrowRight size={15} />
            </button>
            <button onClick={() => navigate('/login')} className={SECONDARY_CTA}>
              Sign in
            </button>
          </div>
        </div>

        <ProductPreview />

        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[12px] text-content-muted">
          {capabilities.map((t, i) => (
            <span key={t} className="flex items-center gap-3">
              {i > 0 && <span aria-hidden className="text-content-muted/50">·</span>}
              <span>{t}</span>
            </span>
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
      bullets: ['Title-chain reconstruction', 'JDA/JV clause parsing', 'Missing-item detection'],
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

  return (
    <section className="border-b border-hairline">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-24">
        <div className="grid md:grid-cols-3 gap-10 md:gap-8">
          {columns.map((c, i) => (
            <Reveal key={c.tag} delay={i * 90}>
              <div className={`text-[11px] uppercase tracking-[0.22em] mb-4 ${toneTextClass(c.tone)}`}>
                {c.tag}
              </div>
              <h3 className="font-serif text-2xl leading-snug tracking-tight text-content-primary">
                {c.title}
              </h3>
              <p className="mt-4 text-sm leading-relaxed text-content-secondary">
                {c.body}
              </p>
              <ul className="mt-5 space-y-2 text-[13px] pt-4 border-t border-hairline">
                {c.bullets.map((b) => (
                  <li key={b} className="flex items-baseline gap-2 text-content-primary">
                    <span className={`font-mono text-[11px] ${toneTextClass(c.tone)}`}>→</span>
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
    <section className="bg-bg-secondary border-b border-hairline">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-24">
        <div className="grid md:grid-cols-12 gap-8">
          <Reveal className="md:col-span-4">
            <div className="text-[11px] uppercase tracking-[0.22em] mb-4 text-accent">
              § Asset coverage
            </div>
            <h2 className="font-serif text-3xl md:text-4xl leading-tight tracking-tight text-content-primary">
              Every asset class an Indian GP actually underwrites.
            </h2>
            <p className="mt-5 leading-relaxed text-[15px] text-content-secondary">
              Not a toy subset. Each class is modelled against its own cash-flow
              shape — apartment absorption is not a plotted layout, and a hotel
              is nobody&rsquo;s office tower.
            </p>
          </Reveal>
          <div className="md:col-span-8">
            <div className="border-t border-hairline-strong">
              {rows.map(([name, note], i) => (
                <Reveal key={name} delay={i * 30}>
                  <div className="flex items-baseline justify-between py-3.5 border-b border-hairline">
                    <div className="flex items-baseline gap-4">
                      <span className="font-mono text-[11px] tabular-nums text-content-muted">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="font-medium text-content-primary">
                        {name}
                      </span>
                    </div>
                    <span className="text-[12.5px] text-content-muted">
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

function Conviction() {
  return (
    <section className="border-b border-hairline">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-24 grid md:grid-cols-12 gap-10">
        <Reveal className="md:col-span-5">
          <div className="text-[11px] uppercase tracking-[0.22em] mb-4 text-premium">
            § Conviction, engineered
          </div>
          <h2 className="font-serif text-3xl md:text-4xl leading-tight tracking-tight text-content-primary">
            Every number traced. Every assumption stressed. Every memo, defensible in the room.
          </h2>
        </Reveal>
        <Reveal className="md:col-span-7" delay={120}>
          <div className="text-[15px] leading-relaxed space-y-4 text-content-secondary">
            <p>
              Other platforms export spreadsheets. REDIP exports conviction. A
              deterministic financial kernel that records every calculation —
              not just the final number. A provenance graph that shows exactly
              which driver moved which IRR. Scenario comparisons, sensitivity
              tornadoes, and confidence grades attached to every headline KPI.
            </p>
            <p>
              This is the difference between <em>&ldquo;the model says 14.2%&rdquo;</em> and
              <em> &ldquo;the model says 14.2%, here is the full chain of reasoning, the
              downside compression, and the three comparable transactions that
              anchor every line.&rdquo;</em> Institutional underwriting, engineered the
              way it should have been all along.
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
    <section className="bg-bg-secondary">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-24">
        <div className="max-w-3xl">
          <div className="text-[11px] uppercase tracking-[0.22em] mb-5 text-premium">
            § Deploy
          </div>
          <h2 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight text-content-primary">
            Put REDIP on your pipeline.
          </h2>
          <p className="mt-5 text-lg max-w-2xl leading-relaxed text-content-secondary">
            Spin up a deal workspace, link a parcel, run the kernel, and export
            an IC memo in the time it would have taken to reconcile your
            spreadsheet tabs.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <button onClick={() => navigate('/login')} className={PRIMARY_CTA}>
              Request access <ArrowRight size={15} />
            </button>
            <button onClick={() => navigate('/login')} className={SECONDARY_CTA}>
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
    <footer className="bg-bg-primary border-t border-hairline">
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-3 text-[12px]">
        <div>
          <span className="font-serif text-base text-content-primary">
            REDIP
            <span className="text-premium">.</span>
          </span>
          <span className="ml-3 uppercase tracking-[0.18em] text-[10.5px] text-content-muted">
            Real Estate Deal Intelligence
          </span>
        </div>
        <div className="text-content-muted">
          India-first · No mock data · No fabricated facts
        </div>
        <div className="tabular-nums text-content-muted">
          © {new Date().getFullYear()} REDIP
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen antialiased text-content-primary bg-bg-primary">
      <Nav />
      <Hero />
      <LiveTicker />
      <Columns />
      <AssetClasses />
      <Conviction />
      <Close />
      <Footer />
    </div>
  );
}
