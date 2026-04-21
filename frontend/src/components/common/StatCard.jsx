import { clsx } from 'clsx';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

/**
 * StatCard — editorial metric card.
 *
 * Design intent: Bloomberg/Linear-grade density. Uppercase eyebrow label,
 * large tabular number as the hero, optional signed delta pill, optional
 * caption. Icons render as subtle monochrome glyphs — no colored chips,
 * no pastel backgrounds. `accent` kept as a soft tinted left-rail so the
 * card can signal classification (green/amber/red) without shouting.
 *
 * Backwards-compatible with prior StatCard API: `{title, value, subtitle,
 * icon, trend, accent}`.
 */
const ACCENT_RAIL = {
  green: 'before:bg-emerald-500/70',
  amber: 'before:bg-amber-500/70',
  red:   'before:bg-rose-500/70',
};

export default function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  accent,
  delta,         // preferred over `trend`; e.g. { value: '+12.4%', positive: true }
  deltaLabel,    // optional caption under delta (e.g. "vs. base case")
}) {
  const rail = accent ? ACCENT_RAIL[accent] : null;
  const computedDelta = delta ?? (trend != null
    ? {
        value: `${trend > 0 ? '+' : ''}${trend}%`,
        positive: trend > 0,
        trailing: 'from last month',
      }
    : null);

  return (
    <div
      className={clsx(
        'relative rounded-lg border border-line bg-paper-100 px-5 py-4',
        'shadow-editorial transition-colors hover:border-line-strong',
        'dark:border-slate-700 dark:bg-slate-900',
        rail && [
          'before:absolute before:inset-y-3 before:left-0 before:w-0.5',
          'before:rounded-full pl-6',
          rail,
        ],
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow truncate">{title}</p>
        {Icon && (
          <Icon
            className="text-ink-400 shrink-0 dark:text-slate-500"
            size={14}
            strokeWidth={1.75}
          />
        )}
      </div>

      <p className="metric mt-2 truncate">{value}</p>

      {(subtitle || computedDelta) && (
        <div className="mt-3 flex items-end justify-between gap-3">
          {subtitle && (
            <p className="text-caption text-ink-500 truncate dark:text-slate-400">
              {subtitle}
            </p>
          )}
          {computedDelta && (
            <span
              className={clsx(
                'inline-flex items-center gap-0.5 text-caption font-medium tabular-nums shrink-0',
                computedDelta.positive
                  ? 'text-pos dark:text-emerald-400'
                  : 'text-neg dark:text-rose-400',
              )}
            >
              {computedDelta.positive ? (
                <ArrowUpRight size={12} strokeWidth={2} />
              ) : (
                <ArrowDownRight size={12} strokeWidth={2} />
              )}
              {computedDelta.value}
              {computedDelta.trailing && (
                <span className="text-ink-400 font-normal ml-1 dark:text-slate-500">
                  {computedDelta.trailing}
                </span>
              )}
            </span>
          )}
        </div>
      )}
      {deltaLabel && !subtitle && (
        <p className="text-caption text-ink-400 mt-1 dark:text-slate-500">{deltaLabel}</p>
      )}
    </div>
  );
}
