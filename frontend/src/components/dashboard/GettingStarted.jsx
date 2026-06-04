// GettingStarted — REDIP's first-run setup checklist.
//
// Presentational: it receives a live, role-aware checklist (built in
// utils/setupChecklist.js from real workspace data) and renders it with a
// progress ring, ticked/unticked rows, and a celebratory done-state. The
// dashboard owns the data + the visibility gating:
//   • full mode  — replaces the empty dashboard while a workspace is first-run;
//   • compact mode — a slim progress card above the live dashboard, shown until
//     every step is done (or the user dismisses it), so momentum is visible as
//     items tick off across sessions.

import { Link } from 'react-router-dom';
import {
  CheckCircle2, Circle, ArrowRight, Sparkles, Compass,
} from 'lucide-react';
import { Card, Button } from '../../design-system';
import useCountUp from '../../hooks/useCountUp';
import useReducedMotion from '../../hooks/useReducedMotion';
import useGuideStore from '../../store/guideStore';

function ProgressRing({ done, total }) {
  const reduced = useReducedMotion();
  const animated = useCountUp(done);
  const size = 46;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-border-primary)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-brand-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          className={reduced ? '' : 'transition-[stroke-dashoffset] duration-700 ease-out'}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums text-content-primary">
        {Math.round(animated)}/{total}
      </span>
    </div>
  );
}

function ChecklistRow({ item }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-hairline-soft bg-bg-secondary p-3.5">
      <span className={`mt-0.5 shrink-0 ${item.done ? 'text-data-positive' : 'text-content-muted'}`}>
        {item.done
          ? <CheckCircle2 size={18} aria-label="Done" />
          : <Circle size={18} aria-label="Not done yet" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${item.done ? 'text-content-muted line-through' : 'text-content-primary'}`}>
          {item.label}
        </p>
        {!item.done && <p className="mt-0.5 text-sm text-content-secondary">{item.hint}</p>}
      </div>
      {!item.done && item.to && (
        <Button
          as={Link}
          to={item.to}
          variant="secondary"
          size="sm"
          rightIcon={<ArrowRight size={13} />}
          className="mt-0.5 shrink-0"
        >
          {item.cta}
        </Button>
      )}
    </li>
  );
}

export default function GettingStarted({ userName, items = [], compact = false, onDismiss }) {
  const openGuide = useGuideStore((s) => s.openGuide);
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const complete = total > 0 && done === total;
  const firstName = String(userName || '').trim().split(/\s+/)[0];

  // Celebratory done-state (only reachable in full mode — the dashboard hides
  // the compact card the moment the checklist completes).
  if (complete && !compact) {
    return (
      <Card elevated className="p-6 sm:p-7">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-data-positive">
            <CheckCircle2 size={22} aria-hidden="true" />
          </span>
          <div>
            <div className="flex items-center gap-1.5 text-eyebrow font-medium uppercase text-accent">
              <Sparkles size={13} aria-hidden="true" />
              All set
            </div>
            <h2 className="mt-1 text-xl font-semibold text-content-primary">
              You&apos;re all set{firstName ? `, ${firstName}` : ''}.
            </h2>
            <p className="mt-1.5 max-w-xl text-sm text-content-secondary">
              You&apos;ve found your way around REDIP. The Guide is always one click
              away whenever you want a refresher on any page or feature.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Compass size={14} />}
                onClick={() => openGuide()}
              >
                Open the Guide
              </Button>
              {onDismiss && (
                <Button variant="ghost" size="sm" onClick={onDismiss}>
                  Dismiss
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // Compact card shows only the still-actionable steps; the ring conveys
  // overall progress so done items don't need to take up space.
  if (compact) {
    const remaining = items.filter((i) => !i.done);
    return (
      <Card elevated className="p-4 sm:p-5">
        <div className="flex items-center gap-4">
          <ProgressRing done={done} total={total} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-eyebrow font-medium uppercase text-accent">
              <Sparkles size={12} aria-hidden="true" />
              Finish setting up
            </div>
            <p className="mt-0.5 text-sm font-semibold text-content-primary">
              {done} of {total} first moves done
            </p>
          </div>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 rounded text-xs font-medium text-content-muted transition-colors duration-150 ease-out hover:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Dismiss
            </button>
          )}
        </div>
        <ul className="mt-4 space-y-2.5">
          {remaining.map((item) => <ChecklistRow key={item.id} item={item} />)}
        </ul>
      </Card>
    );
  }

  // Full first-run panel.
  return (
    <Card elevated className="p-6 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-eyebrow font-medium uppercase text-accent">
            <Sparkles size={13} aria-hidden="true" />
            Getting started
          </div>
          <h2 className="mt-2 text-xl font-semibold text-content-primary">
            Welcome to REDIP{firstName ? `, ${firstName}` : ''}.
          </h2>
          <p className="mt-1.5 max-w-xl text-sm text-content-secondary">
            A few first moves to get the most out of your workspace. Each one
            ticks off on its own as you go — the dashboard fills in with live
            pipeline, risk and IRR data as you work.
          </p>
        </div>
        <ProgressRing done={done} total={total} />
      </div>

      <ol className="mt-6 space-y-3">
        {items.map((item) => <ChecklistRow key={item.id} item={item} />)}
      </ol>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => openGuide()}
          className="inline-flex items-center gap-1.5 rounded text-xs font-medium text-accent transition-colors duration-150 ease-out hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Compass size={13} aria-hidden="true" />
          Or explore the Guide
        </button>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded text-xs font-medium text-content-muted transition-colors duration-150 ease-out hover:text-content-secondary active:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Skip for now
          </button>
        )}
      </div>
    </Card>
  );
}
