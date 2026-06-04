// REDIP design-system primitives — editorial, IC-grade.
// All colors route through CSS variables (see `frontend/src/index.css`), so
// both themes work with a single `data-theme` flip.
// Import as: import { Button, Modal, Tabs, Field, Card, SectionHeader, MetricTile, Skeleton, ... } from '../design-system'
// Pill/status labels: use `components/common/Badge` (CSS-class-based, themed).

// Skeleton loading primitives — re-exported from a dedicated file so the
// keyframe + variants stay co-located.
export {
  default as Skeleton,
  SkeletonLine,
  SkeletonHeading,
  SkeletonKpi,
  SkeletonCard,
  SkeletonTableRow,
  SkeletonList,
} from './Skeleton';

// Virtualized list — auto-windows long lists (>= threshold rows).
export { default as VirtualizedList } from './VirtualizedList';

// Collapsible section card — editorial chrome + persistent expand/collapse.
export { CollapsibleCard } from './CollapsibleCard';

// Checkbox — accessible checkbox control.
export { default as Checkbox } from './Checkbox';

// Interactive primitives — see each file for the full prop contract.
export { default as Button } from './Button';
export { Modal } from './Modal';
export { Tabs } from './Tabs';
export { Field, Input, Select, Textarea } from './Field';
export { Tooltip } from './Tooltip';

// Promise-based confirm dialog (replacement for native `window.confirm`).
// Mount <ConfirmDialogContainer /> once at the app root, then call
// `await confirm({ title, tone, message })` from anywhere.
export { confirm, ConfirmDialogContainer } from './ConfirmDialog';

import { useRef } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Info, HelpCircle } from 'lucide-react';
import useCountUp from '../hooks/useCountUp';
import useReducedMotion from '../hooks/useReducedMotion';

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

// A subtle "?" affordance that opens the in-app Guide to a specific topic.
// Decoupled via a window event (no import of the guide module) so any panel or
// primitive can offer contextual help without a dependency cycle. Exported for
// panels with custom (non-SectionHeader) headers; SectionHeader uses it via the
// `helpTopic` prop.
export function GuideHelp({ topic, label }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('redip:guide-open', { detail: { topicId: topic } }))}
      aria-label={`What is ${label}? Open the guide`}
      title="What is this? — open the Guide"
      className="shrink-0 rounded p-0.5 text-content-muted transition-colors duration-150 ease-out hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <HelpCircle size={14} aria-hidden="true" />
    </button>
  );
}

// ── SectionHeader ──────────────────────────────────────────────────────────
// Editorial section title: small uppercase eyebrow + display headline + optional sub.
// `icon` is an optional Lucide component rendered left of the title (muted).
// `size` controls the headline scale: 'md' (default, h2) | 'sm' (h3, for sub-sections within a Card).
// `helpTopic` (optional) renders a subtle "?" that opens the Guide to that topic.
export function SectionHeader({ icon: Icon, eyebrow, title, sub, action, size = 'md', className, helpTopic }) {
  const H = size === 'sm' ? 'h3' : 'h2';
  const headlineClass =
    size === 'sm'
      ? 'font-display text-base font-semibold text-content-primary leading-tight tracking-tight flex items-center gap-2 min-w-0'
      : 'font-display text-lg sm:text-xl font-semibold text-content-primary leading-tight tracking-tight flex items-center gap-2 min-w-0';
  return (
    <header
      className={clsx(
        'flex items-end justify-between gap-6',
        size === 'sm' ? 'mb-3' : 'mb-5',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
            {eyebrow}
          </div>
        )}
        <H className={headlineClass}>
          {Icon && <Icon size={16} className="text-content-muted shrink-0" aria-hidden="true" />}
          <span className="truncate">{title}</span>
          {helpTopic && (
            <GuideHelp topic={helpTopic} label={typeof title === 'string' ? title : 'this section'} />
          )}
        </H>
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
  /**
   * If `value` is a finite number AND `format` is provided, MetricTile
   * runs `useCountUp` to animate from previous → next over 600ms. The
   * formatter (`format(n) => string`) is called every animation frame
   * so the displayed text matches the underlying type the caller wants
   * (₹12.4 Cr, 18.4%, 1,240 deals, etc.).
   *
   * If `value` is non-numeric or `format` is omitted, falls back to the
   * existing cross-fade-on-key-change behaviour.
   */
  format,
  // Opt-in: a subtle ≤2.5° parallax tilt on hover, reserved for page-level
  // hero KPI tiles (FRONTEND_GUIDELINES §6 explicitly blesses this). Off by
  // default so dense in-panel MetricTiles stay flat. Collapses to no-op under
  // prefers-reduced-motion.
  interactive = false,
}) {
  const reduced = useReducedMotion();
  const tiltRef = useRef(null);
  const tiltOn = interactive && !reduced;
  // Cursor-follow tilt via direct ref mutation (no per-frame React state) so
  // it stays at 60fps; a short transition smooths the follow + the reset.
  const handleTilt = (e) => {
    const el = tiltRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const rx = -(((e.clientY - r.top) / r.height) - 0.5) * 5; // ±2.5°
    const ry = (((e.clientX - r.left) / r.width) - 0.5) * 5;
    el.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(1.01)`;
  };
  const resetTilt = () => {
    const el = tiltRef.current;
    if (el) el.style.transform = '';
  };
  const toneClass = {
    up: 'text-data-positive',
    down: 'text-data-negative',
    neutral: 'text-content-muted',
  }[tone];
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : null;
  const animateNumber = numericValue !== null && typeof format === 'function';
  // Hook always runs (rules-of-hooks) but is a no-op when target is non-finite.
  const animated = useCountUp(numericValue ?? 0);
  const displayValue = animateNumber ? format(animated) : value;
  return (
    <div
      ref={tiltOn ? tiltRef : undefined}
      onMouseMove={tiltOn ? handleTilt : undefined}
      onMouseLeave={tiltOn ? resetTilt : undefined}
      className={clsx(
        'relative bg-bg-elevated border border-hairline rounded-editorial p-4',
        'shadow-editorial',
        tiltOn && 'transition-[transform,box-shadow,border-color] duration-200 ease-out will-change-transform hover:shadow-editorial-lg hover:border-hairline-strong',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-eyebrow uppercase text-content-muted mb-2 min-w-0 truncate font-medium">
          {label}
        </div>
        {action && <div className="shrink-0 -mt-1 -mr-1">{action}</div>}
      </div>
      <div className="flex items-baseline gap-1.5">
        {/* `key={value}` re-mounts the node on change so the keyframe replays.
            The `metric-value-fade` class collapses to a no-op under
            `prefers-reduced-motion` (see index.css). When `format` is
            supplied, `useCountUp` provides the animation directly so we
            disable the cross-fade keyframe to avoid double animation. */}
        <div
          key={animateNumber ? 'count-up' : String(value)}
          className={clsx(
            'font-display text-2xl sm:text-3xl font-semibold text-content-primary tabular-nums tracking-tight',
            !animateNumber && 'metric-value-fade',
          )}
        >
          {displayValue}
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

// ── StatTile ───────────────────────────────────────────────────────────────
// Compact secondary summary tile for use INSIDE a panel/card, where MetricTile
// would over-emphasize. Neutral chrome (no shadow, smaller value font) so the
// tile visually subordinates to the page-level KPIs above it.
// `negative` flips the value colour to data-negative (use for explicit losses).
export function StatTile({ label, value, footnote, negative = false, className }) {
  return (
    <div className={clsx('bg-bg-secondary rounded-lg p-3', className)}>
      <p className="text-xs text-content-muted mb-0.5">{label}</p>
      <p
        className={clsx(
          'text-base font-bold tabular-nums',
          negative ? 'text-data-negative' : 'text-content-primary',
        )}
      >
        {value}
      </p>
      {footnote && <p className="text-xs text-content-muted mt-0.5">{footnote}</p>}
    </div>
  );
}

// ── ErrorState ─────────────────────────────────────────────────────────────
// Inline, non-blocking error / empty-state card.
//  - warn  → amber (default): missing inputs, stale data
//  - danger → rose: compute errors, irrecoverable
//  - info  → sky: neutral informational message
export function ErrorState({ tone = 'warn', title, children, action, className }) {
  // Theme-aware tones: opacity-based tints read correctly on both light and
  // dark surfaces (the old solid bg-*-50 / text-*-900 rendered as a bright box
  // in dark mode), with the colour carried by the icon + border accent and the
  // body text on the primary token.
  const palette =
    tone === 'danger'
      ? { bg: 'bg-rose-500/10',  border: 'border-rose-500/30',  text: 'text-content-primary', icon: 'text-rose-500' }
      : tone === 'info'
      ? { bg: 'bg-sky-500/10',   border: 'border-sky-500/30',   text: 'text-content-primary', icon: 'text-sky-500' }
      : { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-content-primary', icon: 'text-amber-500' };
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
