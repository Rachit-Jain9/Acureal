// Skeleton — editorial loading placeholder primitive.
//
// REDIP standing rule (`docs/FRONTEND_GUIDELINES.md` §2): any operation that
// takes longer than 100ms must show a *skeleton* of the eventual content,
// not a spinning circle. Spinners are reserved for in-button pending states
// and full-page suspense fallbacks where the eventual layout is unknown.
//
// The shimmer keyframe lives in `index.css` (`.redip-skeleton`). Reduced-
// motion users see the static base — fully readable, no animation. Theme-
// aware: the shimmer flips contrast under `data-theme="light"`.

import clsx from 'clsx';

// ── Skeleton ───────────────────────────────────────────────────────────────
// Base block. Pass any height/width via className. Defaults to a single line
// of body text height (1rem).
//
// DECORATIVE BY DEFAULT (role="presentation" + aria-hidden). A skeleton bar is
// a visual placeholder; the LOADING STATE is announced by the surrounding
// region — wrap a cluster in a `<div role="status" aria-busy="true">` with an
// sr-only "Loading X" label (the SkeletonKpi/SkeletonCard/SkeletonList wrappers
// below already do this). That keeps a multi-bar loading cluster to a SINGLE
// status landmark instead of one "Loading" announcement per bar (a11y noise),
// per FRONTEND_GUIDELINES §4. For a STANDALONE skeleton that is itself the only
// loading indicator, opt in with role="status" (+ optional ariaLabel).
export function Skeleton({ className, style, role = 'presentation', ariaLabel, ...rest }) {
  const status = role === 'status';
  return (
    <div
      role={status ? 'status' : 'presentation'}
      aria-label={status ? (ariaLabel ?? 'Loading') : undefined}
      aria-busy={status ? true : undefined}
      aria-hidden={status ? undefined : true}
      className={clsx('redip-skeleton h-4 w-full', className)}
      style={style}
      {...rest}
    />
  );
}

// ── SkeletonLine ───────────────────────────────────────────────────────────
// Single line of text. `width` is a Tailwind width class — defaults to full.
export function SkeletonLine({ width = 'w-full', className }) {
  return <Skeleton className={clsx('h-3.5 rounded-sm', width, className)} ariaLabel={null} role="presentation" />;
}

// ── SkeletonHeading ────────────────────────────────────────────────────────
// Larger, display-weight placeholder for headings.
export function SkeletonHeading({ className }) {
  return <Skeleton className={clsx('h-7 w-2/3 rounded-md', className)} ariaLabel={null} role="presentation" />;
}

// ── SkeletonKpi ────────────────────────────────────────────────────────────
// Mirrors MetricTile's chrome so the layout doesn't reflow when real data
// lands. Eyebrow + big value + small footnote.
export function SkeletonKpi({ className }) {
  return (
    <div
      role="status"
      aria-label="Loading metric"
      aria-busy="true"
      className={clsx(
        'bg-bg-elevated border border-hairline rounded-editorial p-4 shadow-editorial',
        className,
      )}
    >
      <Skeleton className="h-3 w-1/3 rounded-sm mb-3" ariaLabel={null} role="presentation" />
      <Skeleton className="h-8 w-1/2 rounded-md" ariaLabel={null} role="presentation" />
      <Skeleton className="h-3 w-2/3 rounded-sm mt-3" ariaLabel={null} role="presentation" />
    </div>
  );
}

// ── SkeletonCard ───────────────────────────────────────────────────────────
// Generic card-shaped block. Used for chart-card placeholders. `height`
// controls the body skeleton height (charts are typically 260px).
export function SkeletonCard({ height = 'h-64', titleWidth = 'w-1/3', className }) {
  return (
    <div
      role="status"
      aria-label="Loading panel"
      aria-busy="true"
      className={clsx(
        'bg-bg-elevated border border-hairline rounded-editorial p-5',
        className,
      )}
    >
      <Skeleton className={clsx('h-4 rounded-sm mb-4', titleWidth)} ariaLabel={null} role="presentation" />
      <Skeleton className={clsx('w-full rounded-md', height)} ariaLabel={null} role="presentation" />
    </div>
  );
}

// ── SkeletonTableRow ───────────────────────────────────────────────────────
// One row of a tabular list. `columns` = number of cells; `cellWidths` lets
// callers vary per-column widths so the skeleton looks like the real table.
export function SkeletonTableRow({ columns = 4, cellWidths, className }) {
  const widths = cellWidths || Array.from({ length: columns }, (_, i) => (i === 0 ? 'w-3/4' : 'w-1/2'));
  return (
    <div
      role="presentation"
      className={clsx('flex items-center gap-4 py-3 border-b border-hairline', className)}
    >
      {widths.map((w, i) => (
        <Skeleton key={i} className={clsx('h-4 rounded-sm', w, i === 0 && 'flex-1')} ariaLabel={null} role="presentation" />
      ))}
    </div>
  );
}

// ── SkeletonList ───────────────────────────────────────────────────────────
// Helper to render N rows. Keeps callers concise for "loading list of N".
export function SkeletonList({ rows = 5, columns = 4, className }) {
  return (
    <div role="status" aria-label="Loading list" aria-busy="true" className={className}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonTableRow key={i} columns={columns} />
      ))}
    </div>
  );
}

export default Skeleton;
