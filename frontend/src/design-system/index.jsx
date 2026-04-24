// REDIP design-system primitives — editorial, IC-grade.
// All colors route through CSS variables (see `frontend/src/index.css`), so
// both themes work with a single `data-theme` flip.
// Import as: import { Card, SectionHeader, MetricTile, ErrorState } from '@/design-system'
// Pill/status labels: use `components/common/Badge` (CSS-class-based, themed).

import clsx from 'clsx';
import { AlertTriangle, Info } from 'lucide-react';

// ── Card ───────────────────────────────────────────────────────────────────
// Neutral elevated surface. `elevated` adds a subtle drop shadow.
export function Card({ as: As = 'div', elevated = false, className, children, ...rest }) {
  return (
    <As
      className={clsx(
        'bg-bg-elevated border border-hairline rounded-editorial',
        elevated && 'shadow-editorial',
        className,
      )}
      {...rest}
    >
      {children}
    </As>
  );
}

// ── SectionHeader ──────────────────────────────────────────────────────────
// Editorial section title: small uppercase eyebrow + display headline + optional sub.
export function SectionHeader({ eyebrow, title, sub, action, className }) {
  return (
    <header className={clsx('flex items-end justify-between gap-6 mb-5', className)}>
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-eyebrow text-content-muted mb-1.5 font-medium">
            {eyebrow}
          </div>
        )}
        <h2 className="font-display text-lg sm:text-xl font-semibold text-content-primary leading-tight tracking-tight">
          {title}
        </h2>
        {sub && <p className="text-sm text-content-secondary mt-1.5 max-w-2xl">{sub}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

// ── MetricTile ─────────────────────────────────────────────────────────────
// A single KPI tile. Label top, big value, optional delta + footnote.
// `tone` controls the delta colour: 'up' | 'down' | 'neutral'.
// `action` renders in the top-right corner (e.g. provenance Info button).
// `children` are absolutely-anchored — use for popovers/tooltips that need
// to overlay the tile without affecting its layout.
export function MetricTile({
  label,
  value,
  unit,
  delta,
  tone = 'neutral',
  footnote,
  action,
  children,
  className,
}) {
  const toneClass = {
    up: 'text-data-positive',
    down: 'text-data-negative',
    neutral: 'text-content-muted',
  }[tone];
  return (
    <div
      className={clsx(
        'relative bg-bg-elevated border border-hairline rounded-editorial p-4',
        'shadow-editorial',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-eyebrow text-content-muted mb-2 min-w-0 truncate font-medium">
          {label}
        </div>
        {action && <div className="shrink-0 -mt-1 -mr-1">{action}</div>}
      </div>
      <div className="flex items-baseline gap-1.5">
        <div className="font-display text-2xl sm:text-3xl font-semibold text-content-primary tabular-nums tracking-tight">
          {value}
        </div>
        {unit && <div className="text-sm text-content-muted">{unit}</div>}
      </div>
      {delta !== undefined && delta !== null && (
        <div className={clsx('text-xs mt-1.5 tabular-nums', toneClass)}>{delta}</div>
      )}
      {footnote && <div className="text-[11px] text-content-muted mt-1.5">{footnote}</div>}
      {children}
    </div>
  );
}

// ── ErrorState ─────────────────────────────────────────────────────────────
// Inline, non-blocking error / empty-state card.
//  - warn  → amber (default): missing inputs, stale data
//  - danger → rose: compute errors, irrecoverable
//  - info  → sky: neutral informational message
export function ErrorState({ tone = 'warn', title, children, action, className }) {
  const palette =
    tone === 'danger'
      ? { bg: 'bg-rose-50',   border: 'border-rose-200',   text: 'text-rose-900',   icon: 'text-rose-600' }
      : tone === 'info'
      ? { bg: 'bg-sky-50',    border: 'border-sky-200',    text: 'text-sky-900',    icon: 'text-sky-600' }
      : { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-900',  icon: 'text-amber-600' };
  const Icon = tone === 'info' ? Info : AlertTriangle;
  return (
    <div
      role="status"
      className={clsx(
        'flex gap-3 items-start border rounded-editorial p-4',
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
