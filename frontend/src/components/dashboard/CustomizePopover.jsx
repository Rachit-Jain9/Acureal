import { useEffect, useRef } from 'react';
import { Settings2, Eye, EyeOff, ChevronUp, ChevronDown, RotateCcw, X } from 'lucide-react';
import { clsx } from 'clsx';
import { DEFAULT_WIDGETS } from '../../hooks/useDashboardLayout';

/**
 * Dashboard customize popover. Anchors below the Customize button.
 *
 * Per-widget controls:
 *   • Toggle visibility (eye / eye-off icon)
 *   • Reorder up / down (chevron buttons; disabled at boundaries)
 *
 * Always-on widgets (kpi_strip) show a faded eye icon and refuse to
 * hide — KPIs are the page's primary scan, no analyst should be one
 * accidental click away from a blank dashboard.
 *
 * "Reset" button at the bottom returns to the default layout.
 *
 * Persistence + ordering live in useDashboardLayout; this component is
 * purely the editing surface.
 */
export default function CustomizePopover({ open, onClose, layout, toggleVisible, moveUp, moveDown, reset }) {
  const containerRef = useRef(null);
  // Outside-click + escape to close. The button that opens the popover
  // sits outside containerRef so we exempt it via aria-haspopup.
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target)) return;
      // Don't close when the click was on the toggle button itself.
      if (e.target.closest('[data-customize-toggle]')) return;
      onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const labelById = Object.fromEntries(DEFAULT_WIDGETS.map((w) => [w.id, w.label]));
  const alwaysById = Object.fromEntries(DEFAULT_WIDGETS.map((w) => [w.id, !!w.always]));

  return (
    <div
      ref={containerRef}
      className="absolute right-0 top-full mt-2 z-30 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-hairline bg-bg-elevated shadow-editorial"
      role="dialog"
      aria-label="Customize dashboard"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
        <div className="flex items-center gap-2">
          <Settings2 size={13} className="text-content-muted" />
          <span className="text-sm font-medium text-content-primary">Customize dashboard</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-content-muted hover:text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          aria-label="Close"
        >
          <X size={13} />
        </button>
      </div>
      <p className="px-4 pt-3 text-[11px] text-content-muted leading-relaxed">
        Show, hide, and reorder dashboard sections. Saved per device.
      </p>
      <ul className="py-2 max-h-[60vh] overflow-y-auto">
        {layout.map((entry, idx) => {
          const isAlways = alwaysById[entry.id];
          const isFirst = idx === 0;
          const isLast = idx === layout.length - 1;
          return (
            <li
              key={entry.id}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-secondary"
            >
              <button
                type="button"
                onClick={() => toggleVisible(entry.id)}
                disabled={isAlways}
                className={clsx(
                  'p-1 rounded text-content-muted transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  isAlways
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:text-content-primary hover:bg-bg-elevated',
                )}
                title={isAlways ? 'KPIs always visible' : (entry.visible ? 'Hide' : 'Show')}
                aria-pressed={entry.visible}
                aria-label={entry.visible ? `Hide ${labelById[entry.id]}` : `Show ${labelById[entry.id]}`}
              >
                {entry.visible ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
              <span className={clsx('flex-1 text-sm', entry.visible ? 'text-content-primary' : 'text-content-muted line-through')}>
                {labelById[entry.id] || entry.id}
              </span>
              <button
                type="button"
                onClick={() => moveUp(entry.id)}
                disabled={isFirst}
                className="p-1 rounded text-content-muted hover:text-content-primary hover:bg-bg-elevated transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label={`Move ${labelById[entry.id]} up`}
              >
                <ChevronUp size={13} />
              </button>
              <button
                type="button"
                onClick={() => moveDown(entry.id)}
                disabled={isLast}
                className="p-1 rounded text-content-muted hover:text-content-primary hover:bg-bg-elevated transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label={`Move ${labelById[entry.id]} down`}
              >
                <ChevronDown size={13} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between px-4 py-3 border-t border-hairline bg-bg-secondary/40 rounded-b-md">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 text-xs text-content-secondary hover:text-content-primary transition-colors focus-visible:outline-none focus-visible:underline"
        >
          <RotateCcw size={11} />
          Reset to defaults
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center px-3 py-1 text-xs rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          Done
        </button>
      </div>
    </div>
  );
}
