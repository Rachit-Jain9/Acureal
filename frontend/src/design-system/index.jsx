// REDIP design-system primitives — editorial, IC-grade.
// Stone palette + burnt-orange (#c2410c) accent. No gradient soup.
// Import as: import { Card, SectionHeader, MetricTile, Badge, ErrorState } from '@/design-system'

import clsx from 'clsx';
import { AlertTriangle, Info } from 'lucide-react';

export const ACCENT = '#c2410c';

// ── Card ───────────────────────────────────────────────────────────────────
// A rectangular surface with 1px stone border, off-white fill, generous padding.
// No shadows by default; optional `elevated` adds a subtle shadow-sm.
export function Card({ as: As = 'div', elevated = false, className, children, ...rest }) {
  return (
    <As
      className={clsx(
        'bg-white border border-stone-200 rounded-sm',
        elevated && 'shadow-sm',
        className,
      )}
      {...rest}
    >
      {children}
    </As>
  );
}

// ── SectionHeader ──────────────────────────────────────────────────────────
// Editorial section title: small uppercase eyebrow + serif headline + optional sub.
export function SectionHeader({ eyebrow, title, sub, action, className }) {
  return (
    <header className={clsx('flex items-end justify-between gap-6 mb-5', className)}>
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500 mb-1.5">
            {eyebrow}
          </div>
        )}
        <h2 className="font-serif text-xl sm:text-2xl font-semibold text-stone-900 leading-tight tracking-tight">
          {title}
        </h2>
        {sub && <p className="text-sm text-stone-600 mt-1.5 max-w-2xl">{sub}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

// ── MetricTile ─────────────────────────────────────────────────────────────
// A single KPI tile. Label top, big value, optional delta + footnote.
// `tone` controls the delta colour: 'up' | 'down' | 'neutral'.
export function MetricTile({ label, value, unit, delta, tone = 'neutral', footnote, className }) {
  const toneClass = {
    up: 'text-emerald-700',
    down: 'text-rose-700',
    neutral: 'text-stone-500',
  }[tone];
  return (
    <div className={clsx('border border-stone-200 bg-white rounded-sm p-4', className)}>
      <div className="text-[11px] uppercase tracking-[0.16em] text-stone-500 mb-2">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <div className="font-serif text-2xl sm:text-3xl font-semibold text-stone-900 tabular-nums">
          {value}
        </div>
        {unit && <div className="text-sm text-stone-500">{unit}</div>}
      </div>
      {delta !== undefined && delta !== null && (
        <div className={clsx('text-xs mt-1.5 tabular-nums', toneClass)}>{delta}</div>
      )}
      {footnote && <div className="text-[11px] text-stone-400 mt-1.5">{footnote}</div>}
    </div>
  );
}

// ── Badge ──────────────────────────────────────────────────────────────────
// Small pill for status / tags. Tones kept minimal.
const BADGE_TONES = {
  neutral: 'bg-stone-100 text-stone-700 border-stone-200',
  accent:  'bg-[#fff1ea] text-[#9a3412] border-[#fed7c0]',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warn:    'bg-amber-50 text-amber-900 border-amber-200',
  danger:  'bg-rose-50 text-rose-800 border-rose-200',
};
export function Badge({ tone = 'neutral', children, className }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border text-[11px] font-medium uppercase tracking-[0.1em]',
        BADGE_TONES[tone] || BADGE_TONES.neutral,
        className,
      )}
    >
      {children}
    </span>
  );
}

// ── ErrorState ─────────────────────────────────────────────────────────────
// Inline, non-blocking error / empty-state card. Amber for warn, rose for error.
export function ErrorState({ tone = 'warn', title, children, action, className }) {
  const palette =
    tone === 'danger'
      ? { bg: 'bg-rose-50',  border: 'border-rose-200',  text: 'text-rose-900',  icon: 'text-rose-600' }
      : tone === 'info'
      ? { bg: 'bg-sky-50',   border: 'border-sky-200',   text: 'text-sky-900',   icon: 'text-sky-600' }
      : { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900', icon: 'text-amber-600' };
  const Icon = tone === 'info' ? Info : AlertTriangle;
  return (
    <div
      role="status"
      className={clsx(
        'flex gap-3 items-start border rounded-sm p-4',
        palette.bg, palette.border, palette.text, className,
      )}
    >
      <Icon size={18} className={clsx('shrink-0 mt-0.5', palette.icon)} />
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium text-sm mb-0.5">{title}</div>}
        {children && <div className="text-sm leading-relaxed opacity-90">{children}</div>}
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  );
}
