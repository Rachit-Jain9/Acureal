import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';

/**
 * Collapsible card primitive — editorial section with a clickable header
 * that toggles the body. Used by the deal Overview tab to fold less-
 * important readouts (Stage History, Recent Activities, Notes) into
 * named blocks the analyst can expand on demand.
 *
 * Persistence
 * ───────────
 * If `id` is provided, the expand/collapse state is persisted to
 * localStorage under `redip.ui.collapse.<id>`. Subsequent mounts read
 * the stored value, so an analyst's "I always collapse Stage History"
 * preference sticks across sessions. Pass `defaultExpanded` to set the
 * starting state when no preference exists yet.
 *
 * Props
 * ─────
 *   id              optional persistence key
 *   icon            Lucide icon component (rendered left of the title)
 *   eyebrow         small uppercase label above the title
 *   title           string OR ReactNode rendered as the section heading
 *   sub             optional sub-line under the title (only when expanded)
 *   meta            ReactNode rendered on the header right side; visible
 *                   in BOTH states so collapsed cards can still show a
 *                   summary (count, badge, freshness, etc.)
 *   defaultExpanded boolean — only consulted when no localStorage value
 *                   exists for this id (default: true)
 *   forceExpanded   boolean — when true, hides the toggle and renders
 *                   the content unconditionally. Useful for simple
 *                   page-level grouping where the chrome is desired but
 *                   the collapse affordance isn't.
 *   children        section content
 *
 * The header itself is a real <button> so keyboard + screen-reader users
 * get full toggle support (aria-expanded reflects state).
 */
export function CollapsibleCard({
  id,
  icon: Icon,
  eyebrow,
  title,
  sub,
  meta,
  defaultExpanded = true,
  forceExpanded = false,
  className,
  children,
}) {
  const storageKey = id ? `redip.ui.collapse.${id}` : null;
  // SSR-safe init — only consult localStorage on the client.
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === 'undefined') return defaultExpanded;
    if (!storageKey) return defaultExpanded;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === '1') return true;
      if (stored === '0') return false;
    } catch {
      /* ignore */
    }
    return defaultExpanded;
  });

  // Persist on change. We deliberately don't sync the initial value
  // back to storage — that would bloat localStorage with cards the
  // analyst never interacted with.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!storageKey || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, expanded ? '1' : '0');
    } catch {
      /* localStorage may be disabled — silently no-op */
    }
  }, [expanded, storageKey]);

  const isOpen = forceExpanded || expanded;
  const togglable = !forceExpanded;

  const HeaderTag = togglable ? 'button' : 'div';
  const headerProps = togglable
    ? {
        type: 'button',
        onClick: () => setExpanded((v) => !v),
        'aria-expanded': isOpen,
        className: clsx(
          'w-full flex items-center gap-3 px-4 py-3 text-left',
          'hover:bg-bg-secondary transition-colors',
          'focus-visible:outline-none focus-visible:bg-bg-secondary',
          'rounded-editorial',
        ),
      }
    : {
        className: 'flex items-center gap-3 px-4 py-3',
      };

  return (
    <section
      className={clsx(
        'bg-bg-elevated border border-hairline rounded-editorial',
        'transition-shadow',
        className,
      )}
    >
      <HeaderTag {...headerProps}>
        {Icon && (
          <Icon
            size={15}
            className="shrink-0 text-content-muted"
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div className="text-eyebrow uppercase text-content-muted font-medium tracking-wider mb-0.5 text-[10px]">
              {eyebrow}
            </div>
          )}
          <div className="font-display text-base font-semibold text-content-primary leading-tight">
            {title}
          </div>
          {sub && isOpen && (
            <div className="text-xs text-content-secondary mt-0.5">{sub}</div>
          )}
        </div>
        {meta && (
          <div className="shrink-0 flex items-center gap-2">
            {meta}
          </div>
        )}
        {togglable && (
          isOpen ? (
            <ChevronUp size={14} className="shrink-0 text-content-muted" aria-hidden />
          ) : (
            <ChevronDown size={14} className="shrink-0 text-content-muted" aria-hidden />
          )
        )}
      </HeaderTag>
      {isOpen && (
        <div className="px-4 pb-4 pt-0 border-t border-hairline-soft">
          {children}
        </div>
      )}
    </section>
  );
}

export default CollapsibleCard;
