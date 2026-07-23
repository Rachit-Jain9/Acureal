import { useEffect, useRef, useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { formatDate } from '../../utils/format';

/**
 * Inline due-date control for a checklist row.
 *
 * WHY THIS EXISTS: `dd_items.due_date` was writable by the API but had no
 * editor anywhere in the product, so it was NULL on every organically-created
 * item. That made three downstream signals structurally dead — the dashboard's
 * "Overdue diligence" list, the Deals-list overdue chip, and the Portfolio Risk
 * Radar's overdue scoring term could never fire, for anyone. This control is
 * the missing input.
 *
 * DESIGN: the resting state is a styled chip (native date inputs cannot be
 * made to look consistent across browsers), and the native picker is swapped in
 * only while editing — full visual control where it matters, native keyboard
 * and mobile behaviour where it counts. Tone is derived, never decorative:
 * overdue reads negative, due within a week reads warning, everything else
 * stays quiet.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// Local-time ISO day (not toISOString, which shifts across the date line and
// would render "yesterday" for an evening IST edit).
const toInputValue = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

// Whole-day difference from today, so "due today" never reads as overdue
// because of the clock time.
const daysUntil = (value) => {
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return null;
  const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((startOfDue - startOfToday) / DAY_MS);
};

const describe = (days) => {
  if (days === null) return null;
  if (days < -1) return `${Math.abs(days)} days overdue`;
  if (days === -1) return 'Overdue by a day';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days <= 7) return `Due in ${days} days`;
  return null;
};

export default function DueDateChip({ value, onChange, disabled = false, itemName = 'item' }) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      // showPicker() is the difference between "a date field appeared" and
      // "the calendar opened". Guarded — not implemented everywhere, and it
      // throws if the input is not user-activated.
      try { inputRef.current.showPicker?.(); } catch { /* fall back to focus */ }
    }
  }, [editing]);

  const commit = (next) => {
    setEditing(false);
    const normalized = next || null;
    if (normalized !== toInputValue(value) && !(normalized === null && !value)) {
      onChange(normalized);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="date"
        defaultValue={toInputValue(value)}
        aria-label={`Due date for ${itemName}`}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
        }}
        className="text-xs rounded-full px-2 py-0.5 border border-accent bg-bg-elevated text-content-primary focus:outline-none focus:ring-1 focus:ring-accent"
      />
    );
  }

  const days = value ? daysUntil(value) : null;
  const overdue = days !== null && days < 0;
  const soon = days !== null && days >= 0 && days <= 7;
  const caption = describe(days);

  // Unset: a quiet affordance that only asserts itself on hover/focus, so a
  // long checklist does not read as a wall of empty date fields.
  if (!value) {
    if (disabled) return null;
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Set a due date for ${itemName}`}
        className="inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 border border-dashed border-hairline
                   text-content-muted hover:text-content-secondary hover:border-hairline-strong
                   focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent
                   active:scale-[0.97] transition-[color,border-color,transform] duration-120"
      >
        <CalendarDays size={11} aria-hidden="true" />
        Due date
      </button>
    );
  }

  // Overdue rides the semantic negative token. "Due soon" uses the amber
  // opacity tint this codebase already uses for cautions (ParcelIntelligence-
  // Panel, RmpStatusBanner) — it reads correctly on both themes, which a solid
  // palette shade would not.
  const tone = overdue
    ? 'border-data-negative/40 bg-data-negative/5 text-data-negative'
    : soon
      ? 'border-amber-500/40 bg-amber-500/10 text-content-secondary'
      : 'border-hairline text-content-secondary';

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => !disabled && setEditing(true)}
        disabled={disabled}
        aria-label={
          `Due ${formatDate(value)}${caption ? ` — ${caption}` : ''}`
          + `${disabled ? '' : `. Change the due date for ${itemName}`}`
        }
        title={caption || undefined}
        className={`inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 border bg-bg-elevated font-medium
                    ${tone}
                    ${disabled
                      ? 'cursor-default'
                      : 'hover:brightness-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.97]'}
                    transition-[filter,transform] duration-120`}
      >
        <CalendarDays size={11} aria-hidden="true" />
        {formatDate(value)}
        {caption && <span className="hidden sm:inline font-normal opacity-80">· {caption}</span>}
      </button>
      {!disabled && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={`Clear the due date for ${itemName}`}
          className="p-0.5 rounded-full text-content-muted hover:text-data-negative
                     focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent
                     transition-colors duration-120"
        >
          <X size={11} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
