// EmptyState — REDIP's canonical "nothing here yet" panel.
//
// docs/FRONTEND_GUIDELINES.md §11 ("Content presence — never empty, never
// anxious") requires every empty surface to carry a friendly placeholder
// and, where one exists, a one-click path to get started. This primitive
// standardises that: a soft icon chip, a clear title, an optional
// explanatory line, and up to two actions.
//
//   size="md" (default) — full-width list pages (Deals, Comps, …)
//   size="sm"           — empty states nested inside cards / dashboard widgets

import { Inbox } from 'lucide-react';

const SIZES = {
  sm: { wrap: 'py-8', chip: 'h-11 w-11', icon: 20, title: 'text-sm' },
  md: { wrap: 'py-12', chip: 'h-14 w-14', icon: 26, title: 'text-base' },
};

export default function EmptyState({
  title = 'Nothing here yet',
  description = '',
  icon: Icon = Inbox,
  action,
  secondaryAction,
  size = 'md',
  className = '',
}) {
  const s = SIZES[size] || SIZES.md;
  return (
    <div
      className={`redip-empty-in flex flex-col items-center justify-center text-center ${s.wrap} ${className}`.trim()}
    >
      {Icon && (
        <div
          className={`${s.chip} mb-3 flex items-center justify-center rounded-full border border-hairline-soft bg-bg-secondary text-content-muted`}
        >
          <Icon size={s.icon} strokeWidth={1.75} aria-hidden="true" />
        </div>
      )}
      <p className={`${s.title} font-semibold text-content-primary`}>{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-content-secondary">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
