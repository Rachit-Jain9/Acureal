import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

/**
 * StatCard — editorial metric card (Precision Analysis).
 *
 * Routes through semantic CSS variables so the card repaints on a single
 * `data-theme` flip. Accent rail uses the data signal palette:
 *   green  → positive (above bench / upside)
 *   amber  → premium (rare — top deal, exceptional)
 *   red    → negative (risk)
 *   blue   → neutral (trust / default)
 */
const ACCENT_RAIL = {
  green:   'var(--color-data-positive)',
  amber:   'var(--color-brand-premium)',
  red:     'var(--color-data-negative)',
  blue:    'var(--color-brand-accent)',
  neutral: 'var(--color-brand-accent)',
};

export default function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  accent,
  delta,         // preferred over `trend`; e.g. { value: '+12.4%', positive: true }
  deltaLabel,    // optional caption under delta
}) {
  const railColor = accent ? ACCENT_RAIL[accent] : null;
  const computedDelta = delta ?? (trend != null
    ? {
        value: `${trend > 0 ? '+' : ''}${trend}%`,
        positive: trend > 0,
        trailing: 'from last month',
      }
    : null);

  return (
    <div
      className="relative rounded-editorial px-5 py-4 transition-colors"
      style={{
        backgroundColor: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-primary)',
        boxShadow: 'var(--shadow-card)',
        paddingLeft: railColor ? '1.5rem' : undefined,
      }}
    >
      {railColor && (
        <span
          aria-hidden="true"
          className="absolute inset-y-3 left-0 w-0.5 rounded-r-sm"
          style={{ backgroundColor: railColor, opacity: 0.85 }}
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <p
          className="truncate"
          style={{
            fontSize: '0.6875rem',
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            color: 'var(--color-text-secondary)',
            fontWeight: 500,
          }}
        >
          {title}
        </p>
        {Icon && (
          <Icon
            size={14}
            strokeWidth={1.75}
            className="shrink-0"
            style={{ color: 'var(--color-text-muted)' }}
          />
        )}
      </div>

      <p
        className="mt-2 truncate tabular-nums"
        style={{
          fontSize: '1.75rem',
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          letterSpacing: '-0.015em',
          lineHeight: 1.1,
        }}
      >
        {value}
      </p>

      {(subtitle || computedDelta) && (
        <div className="mt-3 flex items-end justify-between gap-3">
          {subtitle && (
            <p
              className="truncate"
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-text-muted)',
                letterSpacing: '0.02em',
              }}
            >
              {subtitle}
            </p>
          )}
          {computedDelta && (
            <span
              className="inline-flex items-center gap-0.5 tabular-nums shrink-0"
              style={{
                fontSize: '0.75rem',
                fontWeight: 500,
                color: computedDelta.positive
                  ? 'var(--color-data-positive)'
                  : 'var(--color-data-negative)',
              }}
            >
              {computedDelta.positive ? (
                <ArrowUpRight size={12} strokeWidth={2} />
              ) : (
                <ArrowDownRight size={12} strokeWidth={2} />
              )}
              {computedDelta.value}
              {computedDelta.trailing && (
                <span
                  className="ml-1"
                  style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}
                >
                  {computedDelta.trailing}
                </span>
              )}
            </span>
          )}
        </div>
      )}
      {deltaLabel && !subtitle && (
        <p
          className="mt-1"
          style={{
            fontSize: '0.75rem',
            color: 'var(--color-text-muted)',
            letterSpacing: '0.02em',
          }}
        >
          {deltaLabel}
        </p>
      )}
    </div>
  );
}
