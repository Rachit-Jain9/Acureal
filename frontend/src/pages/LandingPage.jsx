import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  GitBranch,
  Layers3,
  LockKeyhole,
  Moon,
  ShieldCheck,
  Sun,
  UserCheck,
} from 'lucide-react';
import useThemeStore from '../store/themeStore';
import { ASSET_CLASS_CONFIG } from '../utils/assetClasses';

function Reveal({ children, delay = 0, className = '' }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            el.style.transitionDelay = `${delay}ms`;
            el.classList.add('redip-revealed');
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div ref={ref} className={`redip-reveal ${className}`}>
      {children}
    </div>
  );
}

const SNAPSHOT_ROWS = [
  { label: 'Title chain', state: 'Reviewer requested seller clarification', tone: 'warn' },
  { label: 'Encumbrance certificate', state: 'Two date gaps need confirmation', tone: 'warn' },
  { label: 'RERA filing', state: 'Registration captured for human review', tone: 'ok' },
  { label: 'Approvals', state: 'Sanction plan and khata pending', tone: 'warn' },
  { label: 'Comps', state: 'No verified feed available yet', tone: 'muted' },
  { label: 'Financial model', state: 'Base case saved with assumption trail', tone: 'ok' },
];

const REPLAY_STEPS = [
  ['Sourced', 'Parcel and promoter details captured from intake notes.'],
  ['Extracted', 'Documents classified; title, EC, and RERA fields queued for review.'],
  ['Reviewed', 'Analyst adds notes, confidence bands, and source freshness.'],
  ['IC Ready', 'Open issues are either resolved, waived, or explicitly carried to memo.'],
];

const TRACE_ITEMS = [
  ['Source', 'Document excerpt, feed, or manually entered note.'],
  ['Freshness', 'Last refresh date plus stale-data warning.'],
  ['Confidence', 'Band, reason, and reviewer context.'],
  ['Reviewer', 'Human sign-off before material use.'],
];

const FINANCIAL_ITEMS = [
  'Nine canonical asset-class templates',
  'Scenario cards and sensitivity views',
  'Waterfall and capital-stack outputs',
  'Model version history with input diffs',
];

function Nav() {
  const navigate = useNavigate();
  const mode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);

  return (
    <nav className="sticky top-0 z-50 border-b border-hairline bg-bg-primary/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex min-w-0 items-baseline gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <span className="font-serif text-xl font-semibold tracking-tight text-content-primary">REDIP</span>
          <span className="hidden text-eyebrow uppercase text-content-muted sm:inline">
            India-first deal intelligence
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-content-secondary transition-colors hover:bg-bg-secondary hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
          >
            {mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="rounded-lg px-3 py-2 text-sm font-medium text-content-secondary transition-colors hover:bg-bg-secondary hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
          >
            Request access
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </nav>
  );
}

function StatusPill({ tone, children }) {
  const toneClass = {
    ok: 'border-hairline text-data-positive',
    warn: 'border-hairline text-content-secondary',
    muted: 'border-hairline text-content-muted',
  }[tone] || 'border-hairline text-content-muted';

  return (
    <span className={`inline-flex rounded-full border bg-bg-secondary px-2 py-0.5 text-[11px] font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

function DealFileSnapshot() {
  return (
    <div className="rounded-editorial border border-hairline bg-bg-elevated shadow-editorial">
      <div className="border-b border-hairline p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-eyebrow uppercase text-content-muted">Demo deal file</p>
            <h2 className="mt-1 text-lg font-semibold text-content-primary">Bengaluru Redevelopment, Redacted</h2>
            <p className="mt-1 text-sm text-content-secondary">
              Sample data only. No legal conclusion implied.
            </p>
          </div>
          <StatusPill tone="warn">In review</StatusPill>
        </div>
      </div>
      <div className="grid gap-0 lg:grid-cols-[1fr_240px]">
        <div className="divide-y divide-hairline">
          {SNAPSHOT_ROWS.map((row, index) => (
            <div
              key={row.label}
              className={`${index > 2 ? 'hidden sm:grid' : 'grid'} gap-3 px-4 py-3 sm:grid-cols-[160px_1fr_auto] sm:items-center`}
            >
              <p className="text-sm font-medium text-content-primary">{row.label}</p>
              <p className="text-sm text-content-secondary">{row.state}</p>
              <StatusPill tone={row.tone}>{row.tone === 'ok' ? 'Linked' : row.tone === 'warn' ? 'Open' : 'Pending'}</StatusPill>
            </div>
          ))}
        </div>
        <div className="hidden border-t border-hairline bg-bg-secondary p-4 sm:block lg:border-l lg:border-t-0">
          <p className="text-eyebrow uppercase text-content-muted">Reviewer trail</p>
          <div className="mt-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-content-primary">Open risks</p>
              <p className="mt-1 text-sm text-content-secondary">Title gap, approval dependency, comp freshness.</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-content-primary">Human sign-off</p>
              <p className="mt-1 text-sm text-content-secondary">Required before memo export or IC use.</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-content-primary">AI label</p>
              <p className="mt-1 text-sm text-content-secondary">AI-assisted - requires human review.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  const navigate = useNavigate();

  return (
    <section className="border-b border-hairline bg-bg-primary">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 pb-8 pt-10 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:pb-9 lg:pt-12">
        <Reveal>
          <p className="text-eyebrow uppercase text-content-muted">Traceable conviction for Indian real estate</p>
          <h1 className="mt-5 font-serif text-4xl font-semibold leading-tight tracking-tight text-content-primary sm:text-5xl lg:text-6xl">
            REDIP is the deal room between sourcing and IC decision.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-content-secondary sm:text-lg">
            Bring fragmented title, EC, RERA, approvals, comps, underwriting, and reviewer notes into one source-linked workspace built for serious Indian real estate work.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
            >
              Start a deal
              <ArrowRight size={16} />
            </button>
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="rounded-lg border border-hairline bg-bg-elevated px-5 py-2.5 text-sm font-semibold text-content-primary transition-colors hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
            >
              Request access
            </button>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <DealFileSnapshot />
        </Reveal>
      </div>
    </section>
  );
}

function WhyRedip() {
  const cards = [
    {
      icon: Layers3,
      title: 'India-specific diligence',
      body: 'REDIP is designed around fragmented records, reviewer judgment, and source freshness instead of generic CRM fields.',
    },
    {
      icon: GitBranch,
      title: 'Workflow to IC',
      body: 'Sourcing, diligence, underwriting, risk notes, waterfall, and memo prep stay connected in one deal workspace.',
    },
    {
      icon: LockKeyhole,
      title: 'No fake certainty',
      body: 'Unsupported data is marked as missing or pending. Legal, zoning, and title conclusions require human verification.',
    },
  ];

  return (
    <section className="border-b border-hairline bg-bg-secondary py-14">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Reveal>
          <p className="text-eyebrow uppercase text-content-muted">Why REDIP</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-content-primary">
            Built for the messy middle of Indian deal work.
          </h2>
        </Reveal>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {cards.map((card, index) => (
            <Reveal key={card.title} delay={index * 80} className="h-full">
              <div className="h-full rounded-editorial border border-hairline bg-bg-elevated p-5 shadow-sm">
                <card.icon size={18} className="text-content-muted" />
                <h3 className="mt-4 text-base font-semibold text-content-primary">{card.title}</h3>
                <p className="mt-2 text-sm leading-6 text-content-secondary">{card.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function TraceableConviction() {
  return (
    <section className="border-b border-hairline bg-bg-primary py-14">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <Reveal>
          <p className="text-eyebrow uppercase text-content-muted">Traceable Conviction</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-content-primary">
            Every material claim opens back to evidence.
          </h2>
          <p className="mt-4 text-sm leading-7 text-content-secondary">
            A risk flag, assumption, or KPI should never be a dead end. REDIP makes source, freshness, confidence, reviewer, and notes visible where decisions happen.
          </p>
        </Reveal>
        <Reveal delay={80}>
          <div className="grid gap-3 sm:grid-cols-2">
            {TRACE_ITEMS.map(([title, body]) => (
              <div key={title} className="rounded-editorial border border-hairline bg-bg-elevated p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-content-muted" />
                  <h3 className="text-sm font-semibold text-content-primary">{title}</h3>
                </div>
                <p className="mt-2 text-sm leading-6 text-content-secondary">{body}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function DiligenceReplay() {
  return (
    <section className="border-b border-hairline bg-bg-secondary py-14">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Reveal>
          <p className="text-eyebrow uppercase text-content-muted">Diligence Replay</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-content-primary">
            Watch conviction evolve as evidence arrives.
          </h2>
        </Reveal>
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          {REPLAY_STEPS.map(([title, body], index) => (
            <Reveal key={title} delay={index * 90}>
              <div className="relative rounded-editorial border border-hairline bg-bg-elevated p-5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-hairline bg-bg-secondary text-sm font-semibold text-content-primary">
                  {index + 1}
                </div>
                <h3 className="mt-5 text-base font-semibold text-content-primary">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-content-secondary">{body}</p>
                <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-bg-secondary">
                  <div className="h-full rounded-full bg-accent motion-safe:transition-all motion-safe:duration-700" style={{ width: `${25 + index * 25}%` }} />
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinancialDefensibility() {
  return (
    <section className="border-b border-hairline bg-bg-primary py-14">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
        <Reveal>
          <p className="text-eyebrow uppercase text-content-muted">Financial Defensibility</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-content-primary">
            Underwriting that is explicit, versioned, and reviewable.
          </h2>
          <p className="mt-4 text-sm leading-7 text-content-secondary">
            Financial math stays deterministic. AI can help summarize or extract, but KPIs, scoring, area normalization, and capital-stack calculations stay in code.
          </p>
        </Reveal>
        <Reveal delay={80}>
          <div className="rounded-editorial border border-hairline bg-bg-elevated p-5 shadow-sm">
            <div className="grid gap-3">
              {FINANCIAL_ITEMS.map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-lg border border-hairline bg-bg-secondary px-4 py-3 text-sm text-content-secondary">
                  <FileCheck2 size={16} className="shrink-0 text-content-muted" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function HumanReview() {
  return (
    <section className="border-b border-hairline bg-bg-secondary py-14">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
        <Reveal>
          <p className="text-eyebrow uppercase text-content-muted">Human Review</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-content-primary">
            AI speeds the work. Humans own the judgment.
          </h2>
        </Reveal>
        <Reveal delay={80}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-editorial border border-hairline bg-bg-elevated p-5">
              <ShieldCheck size={18} className="text-content-muted" />
              <h3 className="mt-4 text-base font-semibold text-content-primary">Decision labels</h3>
              <p className="mt-2 text-sm leading-6 text-content-secondary">
                AI-assisted narratives carry review labels in UI and exports so users know what still needs verification.
              </p>
            </div>
            <div className="rounded-editorial border border-hairline bg-bg-elevated p-5">
              <UserCheck size={18} className="text-content-muted" />
              <h3 className="mt-4 text-base font-semibold text-content-primary">Reviewer accountability</h3>
              <p className="mt-2 text-sm leading-6 text-content-secondary">
                Material changes are meant to preserve who changed what, why it changed, and which source supported it.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function AssetClasses() {
  return (
    <section className="bg-bg-primary py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Reveal>
          <p className="text-eyebrow uppercase text-content-muted">Canonical asset classes</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {ASSET_CLASS_CONFIG.map((assetClass) => (
              <span key={assetClass.value} className="rounded-full border border-hairline bg-bg-elevated px-3 py-1.5 text-sm text-content-secondary">
                {assetClass.label}
              </span>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-bg-primary text-content-primary">
      <Nav />
      <Hero />
      <WhyRedip />
      <TraceableConviction />
      <DiligenceReplay />
      <FinancialDefensibility />
      <HumanReview />
      <AssetClasses />
    </div>
  );
}
