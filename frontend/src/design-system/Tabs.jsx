// Tabs — accessible tab strip (WAI-ARIA APG tabs pattern, automatic activation).
//
// Renders the row of tab buttons only; the consumer renders the active panel
// and links it back with `role="tabpanel"` + `aria-labelledby={`tab-${id}`}`.
// Replaces hand-rolled tab bars that mutate inline styles on hover — every
// state here is a real CSS class, and Arrow/Home/End keys move between tabs
// via a roving tabindex.
//
//   <Tabs items={[{ id, label, icon?, count? }]} value={tab} onChange={setTab} />

import clsx from 'clsx';

export function Tabs({ items, value, onChange, ariaLabel, className }) {
  if (!items || items.length === 0) return null;
  const activeIndex = items.findIndex((t) => t.id === value);

  const handleKeyDown = (event) => {
    let nextIndex = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (activeIndex + 1) % items.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (activeIndex - 1 + items.length) % items.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = items.length - 1;
    }
    if (nextIndex == null) return;
    event.preventDefault();
    onChange(items[nextIndex].id);
    const tabs = event.currentTarget.querySelectorAll('[role="tab"]');
    const target = tabs[nextIndex];
    if (target instanceof HTMLElement) target.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={clsx('flex border-b border-hairline overflow-x-auto', className)}
    >
      {items.map((tab) => {
        const active = tab.id === value;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={tab.panelId ?? `panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={clsx(
              'relative inline-flex items-center gap-1.5 px-4 py-2.5 -mb-px',
              'text-sm font-medium whitespace-nowrap border-b-2',
              'transition-colors duration-150 ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:rounded-t-sm',
              active
                ? 'border-accent text-accent'
                : 'border-transparent text-content-muted hover:text-content-primary hover:border-hairline-strong',
            )}
          >
            {Icon && <Icon size={14} aria-hidden="true" />}
            <span>{tab.label}</span>
            {tab.count != null && (
              <span
                className={clsx(
                  'ml-0.5 text-[11px] tabular-nums rounded-full px-1.5 leading-5',
                  active ? 'bg-accent-soft text-accent' : 'bg-bg-secondary text-content-muted',
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
