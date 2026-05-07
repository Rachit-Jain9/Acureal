import { Clock, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { assessStaleness, formatDaysOld } from '../../utils/staleness';

// StalenessBadge — class-aware data-freshness pill.
//
// Drops next to a dataset / row's "as of" date. Shows fresh/aging/stale based
// on the per-category half-life in `utils/staleness.js`. Hover surfaces the
// exact date + category half-life so reviewers know why something is flagged.
//
// Usage:
//   <StalenessBadge asOfDate={row.as_of_date} category="office_ipc" />
//   <StalenessBadge asOfDate={row.as_of_date} dataType={row.data_type} />
//
// Variants:
//   compact (default) — small inline pill, "Aging · 32d"
//   minimal           — just the colored dot, label in tooltip only
//   verbose           — full pill with "Aging · ~32 days ago" + half-life sub

const TONE_STYLES = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warn:    'bg-amber-50  text-amber-800  border-amber-200',
  danger:  'bg-rose-50   text-rose-800   border-rose-200',
  neutral: 'bg-bg-secondary text-content-muted border-hairline',
};

const DOT_COLOR = {
  success: 'bg-emerald-500',
  warn:    'bg-amber-500',
  danger:  'bg-rose-500',
  neutral: 'bg-content-muted',
};

export default function StalenessBadge({
  asOfDate,
  category,
  dataType,
  fallback,
  variant = 'compact',
  className,
}) {
  const result = assessStaleness(asOfDate, { category, dataType, fallback });
  const { status, daysOld, halfLifeDays, label, tone } = result;

  // Tooltip text — exact date + half-life context so reviewers can decide if
  // they trust the row. Not just "stale" — *why* it's stale.
  const dateStr = asOfDate ? new Date(asOfDate).toISOString().slice(0, 10) : 'unknown';
  const tooltip =
    status === 'unknown'
      ? `As-of date missing for this row.`
      : `As of ${dateStr} · ${formatDaysOld(daysOld)} · ${halfLifeDays}-day refresh window`;

  // motion-safe: respect prefers-reduced-motion via Tailwind's motion-safe variant.
  // Stale rows pulse slowly to draw attention without being aggressive.
  const pulseClass = status === 'stale' ? 'motion-safe:animate-pulse' : '';

  if (variant === 'minimal') {
    return (
      <span
        className={clsx('inline-flex items-center gap-1', className)}
        title={tooltip}
        aria-label={`Data freshness: ${label}`}
      >
        <span className={clsx('w-1.5 h-1.5 rounded-full', DOT_COLOR[tone], pulseClass)} />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  if (variant === 'verbose') {
    return (
      <span
        className={clsx(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium',
          'transition-colors duration-150',
          TONE_STYLES[tone],
          className,
        )}
        title={tooltip}
        aria-label={`Data freshness: ${label}`}
      >
        {status === 'stale' ? <AlertTriangle size={11} /> : <Clock size={11} />}
        <span>{label}</span>
        {daysOld != null && (
          <span className="text-content-muted/80 font-normal">· {formatDaysOld(daysOld)}</span>
        )}
      </span>
    );
  }

  // compact (default)
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-medium tabular-nums',
        'transition-colors duration-150',
        TONE_STYLES[tone],
        className,
      )}
      title={tooltip}
      aria-label={`Data freshness: ${label}`}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-full', DOT_COLOR[tone], pulseClass)} />
      <span>{label}</span>
      {daysOld != null && daysOld > 0 && <span className="text-content-muted/70">· {daysOld}d</span>}
    </span>
  );
}
