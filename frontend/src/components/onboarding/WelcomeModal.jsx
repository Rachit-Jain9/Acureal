// WelcomeModal — Acureal's first-run welcome experience.
//
// A short, cinematic, multi-scene introduction shown the first time a user
// lands on the app: the vision, what makes Acureal trustworthy, one light
// personalisation step, and a tailored "where to start". Same props the tour
// orchestrator already passes (open / onStartTour / onSkip), so ProductTour is
// unchanged. Scene-to-scene motion reuses the app's `.redip-empty-in` fade-rise
// (globally collapsed to instant under prefers-reduced-motion).

import { useState } from 'react';
import {
  Sparkles, ChevronLeft, ChevronRight, FileCheck, Cpu, ShieldAlert,
  Briefcase, ClipboardCheck, Gauge, Compass, ArrowRight, Check,
} from 'lucide-react';
import { Modal, Button } from '../../design-system';
import useAuthStore from '../../store/authStore';
import useGuideStore from '../../store/guideStore';

const FOCUS_KEY = 'redip.welcome.focus';

const PILLARS = [
  {
    icon: FileCheck,
    title: 'Every number traces to a document',
    body: 'No more “where did this come from?” — provenance is one hover away.',
  },
  {
    icon: Cpu,
    title: 'The maths is deterministic',
    body: 'IRR, NPV and sensitivities are computed by code, never guessed by AI.',
  },
  {
    icon: ShieldAlert,
    title: 'Blind spots surface early',
    body: 'Title, approvals and promoter risk — flagged before they cost you.',
  },
];

const FOCUS_OPTIONS = [
  { id: 'source', icon: Briefcase, label: 'Source & screen deals', sub: 'Find and triage opportunities fast.' },
  { id: 'diligence', icon: ClipboardCheck, label: 'Run diligence & underwriting', sub: 'Documents, risk and the financial model.' },
  { id: 'decide', icon: Gauge, label: 'Review & decide', sub: 'IC prep, readiness and investor-grade output.' },
];

const START_BY_FOCUS = {
  source: 'Start by creating a deal — even a rough label like “Whitefield opportunity” works. Acureal is built for messy, early-stage sourcing.',
  diligence: 'Open a deal and head to Documents — drop in a title doc or RERA filing and AI does the first read. Then work the DD checklist down.',
  decide: 'Open a deal’s Overview for the ten-second read, then the Risk and DD tabs to see what stands between you and a confident call.',
  default: 'Create your first deal, or take the two-minute tour to see where everything lives. The Guide is always one click away.',
};

const LIFECYCLE = ['Sourcing', 'Diligence', 'Underwriting', 'IC'];

const TOTAL_SCENES = 4;

function PillarCard({ icon: Icon, title, body }) {
  return (
    <div className="rounded-lg border border-hairline-soft bg-bg-secondary p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-md border border-hairline-soft bg-bg-elevated text-accent">
        <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-semibold text-content-primary">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-content-secondary">{body}</p>
    </div>
  );
}

export default function WelcomeModal({ open, onStartTour, onSkip }) {
  const [scene, setScene] = useState(0);
  const [focus, setFocus] = useState(null);
  const user = useAuthStore((s) => s.user);
  const openGuide = useGuideStore((s) => s.openGuide);
  const firstName = String(user?.name || '').trim().split(/\s+/)[0];

  const reset = () => { setScene(0); setFocus(null); };
  const handleSkip = () => { reset(); onSkip(); };
  const handleStartTour = () => { reset(); onStartTour(); };
  const handleOpenGuide = () => { reset(); onSkip(); openGuide(); };

  const chooseFocus = (id) => {
    const next = focus === id ? null : id;
    setFocus(next);
    try {
      if (next) window.localStorage.setItem(FOCUS_KEY, next);
      else window.localStorage.removeItem(FOCUS_KEY);
    } catch (_) { /* private mode — best effort */ }
  };

  const isLast = scene === TOTAL_SCENES - 1;

  const footer = (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {Array.from({ length: TOTAL_SCENES }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all duration-200 ease-out ${
              i === scene ? 'w-4 bg-accent' : 'w-1.5 bg-hairline-strong'
            }`}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        {scene > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setScene((s) => s - 1)}
            leftIcon={<ChevronLeft size={13} />}
          >
            Back
          </Button>
        )}
        {!isLast && (
          <Button variant="secondary" size="sm" onClick={handleSkip}>
            Skip — I&apos;ll explore
          </Button>
        )}
        {isLast ? (
          <>
            <Button variant="secondary" size="sm" onClick={handleSkip}>
              Explore on my own
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleStartTour}
              rightIcon={<ChevronRight size={13} />}
            >
              Take the 2-min tour
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setScene((s) => s + 1)}
            rightIcon={<ChevronRight size={13} />}
          >
            Next
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={handleSkip}
      size="lg"
      ariaLabel="Welcome to Acureal"
      footer={footer}
      closeOnOverlayClick={false}
    >
      <div key={scene} className="redip-empty-in py-2">
        <div className="flex items-center gap-1.5 text-eyebrow font-medium uppercase text-accent">
          <Sparkles size={13} aria-hidden="true" />
          {scene === 2 ? 'Make it yours' : `Getting started · ${scene + 1} of ${TOTAL_SCENES}`}
        </div>

        {/* Scene 0 — vision */}
        {scene === 0 && (
          <div>
            <h2 className="mt-2 text-2xl font-semibold text-content-primary">
              Welcome to Acureal{firstName ? `, ${firstName}` : ''}.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-content-secondary">
              The operating system for live real-estate deal work — sourcing, due
              diligence, underwriting and IC prep, all in one workspace. Built for
              Bengaluru-first investors who care about depth, traceability, and not
              making the same mistake twice.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
              {LIFECYCLE.map((step, i) => (
                <span key={step} className="flex items-center gap-2">
                  <span className="rounded-full border border-hairline-soft bg-bg-secondary px-2.5 py-1 text-xs font-medium text-content-secondary">
                    {step}
                  </span>
                  {i < LIFECYCLE.length - 1 && (
                    <ChevronRight size={13} className="text-content-muted" aria-hidden="true" />
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Scene 1 — what's different */}
        {scene === 1 && (
          <div>
            <h2 className="mt-2 text-2xl font-semibold text-content-primary">
              Why Acureal earns your trust.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-content-secondary">
              Three guarantees sit under everything you&apos;ll see.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {PILLARS.map((p) => <PillarCard key={p.title} {...p} />)}
            </div>
          </div>
        )}

        {/* Scene 2 — personalise */}
        {scene === 2 && (
          <div>
            <h2 className="mt-2 text-2xl font-semibold text-content-primary">
              Where will you spend most of your time?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-content-secondary">
              Pick one and we&apos;ll point you to the right starting move. Optional —
              everything stays available either way.
            </p>
            <div className="mt-5 space-y-2.5">
              {FOCUS_OPTIONS.map((opt) => {
                const selected = focus === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => chooseFocus(opt.id)}
                    aria-pressed={selected}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3.5 text-left transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                      selected
                        ? 'border-accent/60 bg-accent-soft'
                        : 'border-hairline-soft bg-bg-secondary hover:border-hairline-strong'
                    }`}
                  >
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${selected ? 'border-accent/40 bg-bg-elevated text-accent' : 'border-hairline-soft bg-bg-elevated text-content-secondary'}`}>
                      <opt.icon size={17} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-content-primary">{opt.label}</span>
                      <span className="block text-sm text-content-secondary">{opt.sub}</span>
                    </span>
                    {selected && <Check size={16} className="shrink-0 text-accent" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Scene 3 — launch */}
        {scene === 3 && (
          <div>
            <h2 className="mt-2 text-2xl font-semibold text-content-primary">
              You&apos;re set{firstName ? `, ${firstName}` : ''}. Here&apos;s your starting point.
            </h2>
            <div className="mt-4 rounded-lg border border-hairline-soft bg-bg-secondary p-4">
              <p className="text-sm leading-relaxed text-content-secondary">
                {START_BY_FOCUS[focus] || START_BY_FOCUS.default}
              </p>
            </div>
            <button
              type="button"
              onClick={handleOpenGuide}
              className="mt-4 inline-flex items-center gap-1.5 rounded text-xs font-medium text-accent transition-colors duration-150 ease-out hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <Compass size={13} aria-hidden="true" />
              Or open the Guide — what every page and tab does
              <ArrowRight size={12} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
