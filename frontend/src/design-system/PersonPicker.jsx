// PersonPicker — searchable colleague picker (WAI-ARIA combobox + listbox).
//
// Built for the access-control program: Share Deal today, workspace invites and
// the external-proposal flow next. Deliberately people-shaped rather than a
// generic Combobox — avatar, name, email and an org badge are the whole point,
// and a general option-renderer API would be a much larger surface to get right.
//
// The caller owns the data. This component never decides who is eligible: it
// renders exactly the list it is handed, because eligibility (own workspace,
// active, not already shared, not you) is a server decision. See
// dealShare.service.js listShareCandidates.
//
// Keyboard contract (WAI-ARIA 1.2 combobox with list autocomplete):
//   ↓ / ↑     move the active option, opening the list if closed
//   Enter     select the active option
//   Esc       close the list; if already closed, clear the query
//   Tab       leaves the widget (list closes, nothing selected)
// The input keeps DOM focus throughout; the active option is communicated via
// aria-activedescendant, so screen readers announce it without a focus move.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Search, Check, Loader2 } from 'lucide-react';

// Initials for the avatar. Two letters from a name ("Rachit Jain" → RJ), else
// one from the email. Never renders an empty circle.
const initialsFor = (person) => {
  const name = (person?.name || '').trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2))
      .toUpperCase();
  }
  const email = (person?.email || '').trim();
  return email ? email[0].toUpperCase() : '?';
};

export function PersonAvatar({ person, size = 32, className }) {
  return (
    <div
      className={clsx(
        'rounded-full bg-bg-secondary border border-hairline flex items-center justify-center shrink-0',
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="text-[11px] font-semibold text-content-secondary tracking-tight">
        {initialsFor(person)}
      </span>
    </div>
  );
}

export function PersonPicker({
  people = [],
  loading = false,
  value = null,              // the selected person object, or null
  onChange,
  onQueryChange,
  placeholder = 'Search colleagues by name or email',
  emptyMessage = 'No colleagues found.',
  emptyAction = null,        // node rendered under the empty message
  badgeLabel = null,         // e.g. the workspace's verified domain
  disabled = false,
  id: idProp,
}) {
  const reactId = useId();
  const id = idProp || `person-picker-${reactId}`;
  const listboxId = `${id}-listbox`;

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  // The list is authoritative — never re-filter client-side, or the UI would
  // start disagreeing with the server about who is eligible.
  const options = useMemo(() => people || [], [people]);

  // Keep the active option in range as results stream in.
  useEffect(() => {
    setActiveIndex((i) => (options.length === 0 ? 0 : Math.min(i, options.length - 1)));
  }, [options]);

  // Close on outside click. Escape is handled on the input so it can also clear.
  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const commit = (person) => {
    if (!person) return;
    onChange?.(person);
    setQuery('');
    onQueryChange?.('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleQuery = (next) => {
    setQuery(next);
    onQueryChange?.(next);
    setOpen(true);
    setActiveIndex(0);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (options.length === 0) return;
      setActiveIndex((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        return (next + options.length) % options.length; // wraps both ways
      });
      return;
    }
    if (e.key === 'Enter') {
      if (open && options[activeIndex]) {
        e.preventDefault();          // don't submit the surrounding form
        commit(options[activeIndex]);
      }
      return;
    }
    if (e.key === 'Escape') {
      // First Escape closes the list; a second clears what was typed. Escape
      // must not bubble to the parent dialog while the list is open, or one
      // keystroke would close both.
      if (open) { e.stopPropagation(); setOpen(false); return; }
      if (query) { e.stopPropagation(); handleQuery(''); setOpen(false); }
    }
  };

  // A chosen person replaces the input entirely — the selection is the state,
  // and leaving a text box alongside it invites the two to disagree.
  if (value) {
    return (
      <div className="flex items-center gap-3 min-w-0 px-3 py-2 rounded-lg border border-hairline-strong bg-bg-elevated">
        <PersonAvatar person={value} size={28} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-content-primary truncate">
            {value.name || value.email}
          </p>
          {value.name && (
            <p className="text-xs text-content-muted truncate">{value.email}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => { onChange?.(null); setTimeout(() => inputRef.current?.focus(), 0); }}
          className="text-xs text-content-secondary hover:text-content-primary transition-colors duration-150 ease-out rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          Change
        </button>
      </div>
    );
  }

  const showEmpty = open && !loading && options.length === 0;

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && options[activeIndex] ? `${id}-opt-${options[activeIndex].id}` : undefined
          }
          autoComplete="off"
          disabled={disabled}
          value={query}
          placeholder={placeholder}
          onChange={(e) => handleQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="w-full pl-9 pr-3 py-2 border border-hairline-strong rounded-lg text-sm bg-bg-elevated text-content-primary placeholder:text-content-muted transition-colors duration-150 ease-out focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:opacity-50"
        />
      </div>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-hairline-strong bg-bg-elevated shadow-editorial-lg overflow-hidden">
          {/* Skeleton, not a spinner, for the initial roster fetch. */}
          {loading && options.length === 0 ? (
            <div className="p-2 space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-1.5">
                  <div className="w-8 h-8 rounded-full bg-bg-secondary animate-pulse motion-reduce:animate-none" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-1/3 rounded bg-bg-secondary animate-pulse motion-reduce:animate-none" />
                    <div className="h-2.5 w-1/2 rounded bg-bg-secondary animate-pulse motion-reduce:animate-none" />
                  </div>
                </div>
              ))}
            </div>
          ) : showEmpty ? (
            <div className="px-3 py-4 text-center">
              <p className="text-sm text-content-secondary">{emptyMessage}</p>
              {emptyAction && <div className="mt-2">{emptyAction}</div>}
            </div>
          ) : (
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Colleagues"
              className="max-h-60 overflow-y-auto py-1"
            >
              {options.map((person, index) => {
                const active = index === activeIndex;
                return (
                  <li
                    key={person.id}
                    id={`${id}-opt-${person.id}`}
                    role="option"
                    aria-selected={active}
                    // onMouseDown, not onClick: mousedown fires before the
                    // input's blur, so the list is still mounted when it lands.
                    onMouseDown={(e) => { e.preventDefault(); commit(person); }}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={clsx(
                      'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors duration-150 ease-out',
                      active ? 'bg-bg-secondary' : 'bg-transparent',
                    )}
                  >
                    <PersonAvatar person={person} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-content-primary truncate">
                        {person.name || person.email}
                      </p>
                      {person.name && (
                        <p className="text-xs text-content-muted truncate">{person.email}</p>
                      )}
                    </div>
                    {badgeLabel && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-bg-secondary text-content-muted border border-hairline">
                        {badgeLabel}
                      </span>
                    )}
                    {active && <Check size={14} className="shrink-0 text-accent" aria-hidden="true" />}
                  </li>
                );
              })}
              {/* Refreshing an already-populated list: a quiet inline note
                  rather than replacing results the user is reading. */}
              {loading && (
                <li className="flex items-center gap-2 px-3 py-2 text-xs text-content-muted" aria-hidden="true">
                  <Loader2 size={12} className="animate-spin motion-reduce:animate-none" />
                  Searching…
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default PersonPicker;
