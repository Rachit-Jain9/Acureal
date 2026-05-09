import { useState, useRef, useEffect } from 'react';
import { Bookmark, Plus, Check, Trash2, X, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';

/**
 * Saved views menu for the Deals list.
 *
 * Renders as a dropdown trigger that shows the active view name (or
 * "Saved views" when no view is active) + a chevron. Opening the
 * dropdown lists every saved view; clicking one applies it. Each
 * row has an X to delete. A "Save current view as…" affordance at
 * the bottom prompts for a name and persists the current filter set
 * via the supplied `onSave` callback.
 *
 * Props:
 *   views        — [{ id, name, filters }] from useSavedDealViews
 *   activeView   — view object whose filters match the current page state, or null
 *   currentFilters — the page's controlled filter snapshot (for the save action)
 *   onApply(view) — apply a saved view's filters to the page
 *   onSave(name, filters) — persist the supplied filters as a new view
 *   onRemove(id) — delete a saved view
 *   canSave      — boolean; disables the Save action when false (no dirty filters)
 */
export default function SavedViewsMenu({
  views,
  activeView,
  currentFilters,
  onApply,
  onSave,
  onRemove,
  canSave,
}) {
  const [open, setOpen] = useState(false);
  const [savingName, setSavingName] = useState(null); // null = not in save flow; '' = empty input
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Outside-click + escape to close.
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target)) return;
      setOpen(false);
      setSavingName(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setSavingName(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Focus the input when entering save flow.
  useEffect(() => {
    if (savingName !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [savingName]);

  const handleApply = (view) => {
    onApply(view);
    setOpen(false);
  };

  const handleConfirmSave = () => {
    const name = savingName?.trim();
    if (!name) return;
    onSave(name, currentFilters);
    setSavingName(null);
    setOpen(false);
  };

  const triggerLabel = activeView ? activeView.name : 'Saved views';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md',
          'border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          'transition-colors',
          activeView
            ? 'bg-accent-soft text-accent border-accent/30'
            : 'bg-bg-elevated text-content-primary border-hairline hover:bg-bg-secondary',
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Saved searches for this list"
      >
        <Bookmark size={13} />
        <span className="max-w-[140px] truncate">{triggerLabel}</span>
        {views.length > 0 && (
          <span className="text-[10px] text-content-muted tabular-nums">{views.length}</span>
        )}
        <ChevronDown size={12} className="text-content-muted" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-hairline bg-bg-elevated shadow-editorial"
        >
          <div className="px-3 py-2 border-b border-hairline flex items-center justify-between">
            <span className="text-eyebrow uppercase tracking-wider text-content-muted text-[10px] font-medium">
              Saved views
            </span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setSavingName(null);
              }}
              className="p-1 rounded text-content-muted hover:text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              aria-label="Close"
            >
              <X size={12} />
            </button>
          </div>

          <ul className="py-1 max-h-72 overflow-y-auto">
            {views.length === 0 && (
              <li className="px-3 py-3 text-xs text-content-muted text-center">
                No saved views yet. Apply some filters and save.
              </li>
            )}
            {views.map((view) => {
              const isActive = activeView?.id === view.id;
              return (
                <li
                  key={view.id}
                  className={clsx(
                    'group flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer',
                    isActive ? 'bg-accent-soft/40' : 'hover:bg-bg-secondary',
                  )}
                  role="menuitem"
                >
                  <button
                    type="button"
                    onClick={() => handleApply(view)}
                    className="flex-1 flex items-center gap-2 min-w-0 text-left focus-visible:outline-none focus-visible:underline"
                  >
                    {isActive ? (
                      <Check size={12} className="shrink-0 text-accent" />
                    ) : (
                      <span className="shrink-0 w-3" />
                    )}
                    <span className={clsx('truncate', isActive ? 'text-accent font-medium' : 'text-content-primary')}>
                      {view.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(view.id)}
                    className="p-1 rounded text-content-muted hover:text-data-negative hover:bg-bg-elevated transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    aria-label={`Delete ${view.name}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-hairline px-3 py-2">
            {savingName === null ? (
              <button
                type="button"
                onClick={() => setSavingName('')}
                disabled={!canSave}
                className={clsx(
                  'w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-md',
                  'border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  'transition-colors',
                  canSave
                    ? 'bg-bg-elevated text-content-primary border-hairline hover:bg-bg-secondary'
                    : 'bg-bg-secondary text-content-muted border-hairline cursor-not-allowed',
                )}
                title={canSave ? 'Save the current filters as a named view' : 'Apply at least one filter to save a view'}
              >
                <Plus size={11} />
                {canSave ? 'Save current view…' : 'No filters to save'}
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={savingName}
                  onChange={(e) => setSavingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleConfirmSave();
                    }
                    if (e.key === 'Escape') setSavingName(null);
                  }}
                  placeholder="View name…"
                  maxLength={60}
                  className="flex-1 px-2 py-1 text-xs border border-hairline rounded bg-bg-elevated text-content-primary focus-visible:outline-none focus-visible:border-accent"
                />
                <button
                  type="button"
                  onClick={handleConfirmSave}
                  disabled={!savingName.trim()}
                  className="px-2 py-1 text-xs rounded bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setSavingName(null)}
                  className="p-1 rounded text-content-muted hover:text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label="Cancel"
                >
                  <X size={11} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
