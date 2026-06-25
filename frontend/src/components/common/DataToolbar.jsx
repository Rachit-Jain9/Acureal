import { useState, useEffect, useRef, useId } from 'react';
import { Search, X, ChevronDown, SlidersHorizontal, ArrowUpDown } from 'lucide-react';
import clsx from 'clsx';
import useDebouncedValue from '../../hooks/useDebouncedValue';

/**
 * Editorial sort + filter toolbar — Bloomberg/Stripe/Linear vibe.
 *
 * One reusable surface that handles:
 *   • Debounced search input (250ms — matches FRONTEND_GUIDELINES §3)
 *   • Single- or multi-select chip groups (asset class, source, segment, etc.)
 *   • Sort dropdown (or pass `sortable` headers to handle it inline)
 *   • Active-filter pill row with × dismiss per filter
 *   • Result count
 *   • Clear-all
 *
 * Theme-aware via semantic tokens — works in both dark and light without
 * touching CSS. Respects prefers-reduced-motion via Tailwind's `motion-safe:`.
 */

// ── Debounced search input ─────────────────────────────────────────────────
export function SearchField({ value, onChange, placeholder, ariaLabel, autoFocus = false }) {
  const [local, setLocal] = useState(value || '');
  const debounced = useDebouncedValue(local, 250);
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (debounced !== lastEmitted.current) {
      lastEmitted.current = debounced;
      onChange(debounced);
    }
  }, [debounced, onChange]);

  // External resets (e.g. "Clear all") flow back into the local mirror.
  useEffect(() => {
    if (value !== local && value !== debounced) setLocal(value || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative flex-1 min-w-[220px]">
      <Search
        size={15}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none"
        aria-hidden="true"
      />
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder || 'Search...'}
        aria-label={ariaLabel || placeholder || 'Search'}
        autoFocus={autoFocus}
        className={clsx(
          'w-full pl-9 pr-9 py-2 rounded-lg text-sm',
          'bg-bg-elevated text-content-primary placeholder:text-content-muted',
          'border border-hairline-strong',
          'transition-colors duration-150 ease-out',
          'hover:border-hairline-strong',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent',
        )}
      />
      {local && (
        <button
          type="button"
          onClick={() => setLocal('')}
          aria-label="Clear search"
          className={clsx(
            'absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md',
            'text-content-muted hover:text-content-primary hover:bg-bg-secondary',
            'transition-colors duration-150 ease-out',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            'active:scale-[0.98]',
          )}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

// ── Single-select chip group ───────────────────────────────────────────────
//
// `options` = [{ value, label, count? }]. `count` shows a small adjacent
// numeric tally so the user sees how much they're slicing into.
export function FilterChipGroup({ label, value, onChange, options, allowAll = false, allLabel = 'All' }) {
  const list = allowAll
    ? [{ value: null, label: allLabel, count: options.reduce((s, o) => s + (o.count || 0), 0) }, ...options]
    : options;
  return (
    <div className="flex items-center gap-2 flex-wrap min-w-0">
      {label && (
        <span className="text-[10px] uppercase tracking-[0.1em] font-medium text-content-muted shrink-0">
          {label}
        </span>
      )}
      <div className="flex flex-wrap gap-1.5">
        {list.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={String(opt.value ?? '__all__')}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={active}
              className={clsx(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium',
                'border transition-colors duration-150 ease-out',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                'active:scale-[0.98]',
                active
                  ? 'bg-content-primary text-bg-primary border-content-primary shadow-sm'
                  : 'bg-bg-elevated text-content-secondary border-hairline-strong hover:bg-bg-secondary hover:border-content-muted',
              )}
            >
              <span>{opt.label}</span>
              {opt.count != null && (
                <span
                  className={clsx(
                    'tabular-nums text-[10px] font-semibold rounded px-1',
                    active ? 'bg-bg-primary/20 text-bg-primary' : 'text-content-muted',
                  )}
                >
                  {opt.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Sort dropdown ──────────────────────────────────────────────────────────
//
// Compact dropdown for sort selection. Pairs with a `sortBy` state in the
// parent. Closes on outside click + Escape.
export function SortDropdown({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value) || options[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        className={clsx(
          'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium',
          'bg-bg-elevated text-content-primary border border-hairline-strong',
          'transition-colors duration-150 ease-out',
          'hover:bg-bg-secondary hover:border-content-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          'active:scale-[0.98]',
        )}
      >
        <ArrowUpDown size={13} className="text-content-muted shrink-0" />
        <span className="text-content-secondary text-[10px] uppercase tracking-[0.08em]">Sort</span>
        <span className="font-semibold">{current?.label}</span>
        <ChevronDown
          size={13}
          className={clsx('text-content-muted transition-transform duration-150', open && 'rotate-180')}
        />
      </button>
      {open && (
        <ul
          id={id}
          role="listbox"
          className={clsx(
            'absolute right-0 mt-1.5 z-30 min-w-[200px]',
            'bg-bg-elevated border border-hairline-strong rounded-lg shadow-lg',
            'py-1 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 duration-150',
          )}
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <li key={opt.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={clsx(
                    'w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-3',
                    'transition-colors duration-100 ease-out',
                    'hover:bg-bg-secondary',
                    'focus-visible:outline-none focus-visible:bg-bg-secondary',
                    active && 'text-content-primary font-semibold bg-bg-secondary',
                  )}
                >
                  <span className="truncate">{opt.label}</span>
                  {active && <span className="text-accent text-[10px]">●</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Active filter pill bar ─────────────────────────────────────────────────
//
// Renders a horizontal row of pills representing the current filters; each
// has an × to remove just that filter. Result count + Clear all on the right.
export function ActiveFilters({ filters, onRemove, onClearAll, resultCount, totalCount }) {
  const visible = filters.filter((f) => f.value != null && f.value !== '' && f.value !== false);
  const showCount = resultCount != null && totalCount != null;

  if (visible.length === 0 && !showCount) return null;

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        {visible.map((f) => (
          <span
            key={f.id}
            className={clsx(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium',
              'bg-accent-soft text-accent border border-hairline',
            )}
            title={`${f.label}: ${f.displayValue || f.value}`}
          >
            <span className="text-content-muted">{f.label}:</span>
            <span className="truncate max-w-[140px]">{f.displayValue || f.value}</span>
            <button
              type="button"
              onClick={() => onRemove(f.id)}
              aria-label={`Remove ${f.label} filter`}
              className={clsx(
                'rounded-sm -mr-0.5 p-0.5',
                'transition-colors duration-100',
                'hover:bg-accent-soft',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              )}
            >
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {showCount && (
          <span className="text-[11px] tabular-nums text-content-muted">
            <span className="font-semibold text-content-secondary">{resultCount.toLocaleString()}</span>
            {resultCount !== totalCount && (
              <span> of {totalCount.toLocaleString()}</span>
            )}
            <span className="ml-1">{resultCount === 1 ? 'result' : 'results'}</span>
          </span>
        )}
        {visible.length > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className={clsx(
              'text-[11px] font-medium text-content-secondary',
              'transition-colors duration-150',
              'hover:text-content-primary',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded',
            )}
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}

// ── Toolbar shell ──────────────────────────────────────────────────────────
//
// Composes children inside an editorial frame. Use this as the host for
// SearchField + FilterChipGroup + SortDropdown + ActiveFilters.
export function DataToolbar({ children, className }) {
  return (
    <div
      className={clsx(
        'flex flex-col gap-3 p-3.5',
        'bg-bg-elevated border border-hairline-strong rounded-editorial',
        className,
      )}
    >
      {children}
    </div>
  );
}

DataToolbar.Search = SearchField;
DataToolbar.Chips = FilterChipGroup;
DataToolbar.Sort = SortDropdown;
DataToolbar.ActiveFilters = ActiveFilters;
DataToolbar.Icon = SlidersHorizontal;

export default DataToolbar;
