import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, X, ArrowRight, Clock } from 'lucide-react';
import { dealsAPI } from '../../services/api';
import { useFocusTrap } from '../../hooks/useFocusTrap';

/**
 * Cmd-K command palette.
 *
 * Triggers:
 *   - Ctrl+K / Cmd+K from anywhere in the authenticated app
 *   - Escape to close
 *   - Backdrop click to close
 *
 * Surfaces (in priority order):
 *   1. Quick actions (typed-prefix or always-on entries that navigate)
 *   2. Recent items (last 8 deals visited, persisted in localStorage)
 *   3. Search results from dealsAPI.list({ search }) — only when query
 *      is at least 2 characters, debounced 200ms
 *
 * Why self-contained:
 *   - No new dependencies; uses existing react-router, react-query, Lucide.
 *   - Recent items live in localStorage so the palette is useful before any
 *     network round-trip on a slow connection.
 *
 * The component is mounted once at Layout level and renders nothing when
 * closed — there's no perf cost when idle.
 */

const RECENT_KEY = 'redip:cmdk:recent';
const MAX_RECENT = 8;

const QUICK_ACTIONS = [
  { id: 'dashboard',    label: 'Dashboard',                 hint: 'Pipeline overview',     to: '/dashboard',                  keywords: 'home overview' },
  { id: 'deals',        label: 'All deals',                 hint: 'Open the deals table',  to: '/dashboard/deals',            keywords: 'list pipeline' },
  { id: 'map',          label: 'Map',                       hint: 'Geospatial deal view',  to: '/dashboard/map',              keywords: 'gis location' },
  { id: 'comps',        label: 'Comparables',               hint: 'Pricing benchmarks',    to: '/dashboard/comps',            keywords: 'comp benchmarks pricing' },
  { id: 'intelligence', label: 'Daily intelligence brief',  hint: 'Today’s market take', to: '/dashboard/intelligence', keywords: 'brief market signals' },
  { id: 'reports',      label: 'Reports',                   hint: 'Exports & IC packs',    to: '/dashboard/reports',          keywords: 'export ic pdf' },
  { id: 'settings',     label: 'Settings',                  hint: 'Org & preferences',     to: '/dashboard/settings',         keywords: 'preferences profile' },
  { id: 'masterplan',   label: 'Master plan admin',         hint: 'Zone curation',         to: '/dashboard/settings/master-plan', keywords: 'rmp zone' },
  { id: 'parcel-admin', label: 'Parcel intelligence admin', hint: 'Evidence review',       to: '/dashboard/settings/parcel-intelligence', keywords: 'evidence review' },
];

const loadRecent = () => {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
};

const persistRecent = (items) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, MAX_RECENT)));
  } catch {
    /* localStorage may be disabled — silent best-effort */
  }
};

export const recordRecentDeal = (deal) => {
  if (!deal?.id) return;
  const next = [
    { id: deal.id, name: deal.name, city: deal.city || null, stage: deal.stage || null, visited_at: Date.now() },
    ...loadRecent().filter((d) => d.id !== deal.id),
  ];
  persistRecent(next);
};

const matchesQuery = (text, query) => {
  if (!query) return true;
  return String(text || '').toLowerCase().includes(query);
};

const useDebounced = (value, delay = 200) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
};

export default function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState(() => loadRecent());
  const inputRef = useRef(null);

  const debouncedQuery = useDebounced(query.trim(), 200);

  // Refresh recent list whenever the palette opens — captures visits made
  // since the component last rendered.
  useEffect(() => {
    if (open) {
      setRecent(loadRecent());
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      setQuery('');
    }
  }, [open]);

  // Global key listener: Cmd/Ctrl+K toggles, Escape closes.
  useEffect(() => {
    const handler = (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Allow other parts of the app to open the palette without simulating
  // a keystroke. Header's search affordance dispatches this event so a
  // mouse click reveals the same Cmd-K experience the keyboard shortcut
  // gives.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('redip:cmdk-open', onOpen);
    return () => window.removeEventListener('redip:cmdk-open', onOpen);
  }, []);

  const trimmedQ = debouncedQuery.toLowerCase();

  const dealSearch = useQuery({
    queryKey: ['cmdk', 'deal-search', trimmedQ],
    queryFn: () => dealsAPI.list({ search: trimmedQ, limit: 10 }).then((r) => r.data?.data || []),
    enabled: open && trimmedQ.length >= 2,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const filteredQuickActions = useMemo(
    () =>
      QUICK_ACTIONS.filter(
        (a) => matchesQuery(a.label, trimmedQ) || matchesQuery(a.hint, trimmedQ) || matchesQuery(a.keywords, trimmedQ)
      ),
    [trimmedQ]
  );

  const filteredRecent = useMemo(
    () => (trimmedQ ? recent.filter((d) => matchesQuery(d.name, trimmedQ)) : recent),
    [recent, trimmedQ]
  );

  const dealResults = (dealSearch.data || []).map((d) => ({
    id: d.id,
    name: d.name,
    city: d.city || d.property_city || null,
    stage: d.stage,
  }));

  // Flat list used for arrow-key navigation. Order mirrors render order.
  const flatItems = useMemo(() => {
    const items = [];
    filteredQuickActions.forEach((a) => items.push({ kind: 'action', payload: a }));
    filteredRecent.forEach((d) => items.push({ kind: 'recent', payload: d }));
    dealResults.forEach((d) => items.push({ kind: 'deal', payload: d }));
    return items;
  }, [filteredQuickActions, filteredRecent, dealResults]);

  useEffect(() => {
    setActiveIndex(0);
  }, [trimmedQ, dealSearch.data]);

  const navigateTo = (item) => {
    if (item.kind === 'action') {
      navigate(item.payload.to);
    } else if (item.kind === 'recent' || item.kind === 'deal') {
      const deal = item.payload;
      if (item.kind === 'deal') recordRecentDeal(deal);
      navigate(`/dashboard/deals/${deal.id}`);
    }
    setOpen(false);
  };

  const onKeyDownInput = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(flatItems.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatItems[activeIndex];
      if (item) navigateTo(item);
    }
  };

  // Trap focus inside the palette while it's open. Hook must run on every
  // render (rules of hooks); the trap deactivates when `open` is false.
  // The existing window-level Escape handler stays — pass `autoFocus: false`
  // because the input itself auto-focuses via inputRef on open.
  const trapRef = useFocusTrap(open, { autoFocus: false });

  if (!open) return null;

  let runningIndex = 0;
  const renderRow = (label, hint, item, suffix = null, icon = null) => {
    const idx = runningIndex++;
    const isActive = idx === activeIndex;
    return (
      <button
        type="button"
        key={`${item.kind}-${item.payload.id || idx}`}
        onClick={() => navigateTo(item)}
        onMouseEnter={() => setActiveIndex(idx)}
        className={`w-full flex items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors text-content-primary ${
          isActive ? 'bg-surface' : 'hover:bg-surface'
        }`}
      >
        <span className="flex items-center gap-3 min-w-0">
          {icon}
          <span className="min-w-0">
            <div className="truncate font-medium">{label}</div>
            {hint && <div className="truncate text-xs text-content-muted">{hint}</div>}
          </span>
        </span>
        {suffix}
        <ArrowRight className="w-3.5 h-3.5 shrink-0 text-content-muted" />
      </button>
    );
  };

  return (
    <div
      ref={trapRef}
      className="fixed inset-0 z-[1000] flex items-start justify-center pt-[10vh] px-4"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="absolute inset-0 bg-black/45" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl rounded-lg shadow-2xl bg-bg-secondary border border-hairline"
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline">
          <Search className="w-4 h-4 shrink-0 text-content-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDownInput}
            placeholder="Type to search deals or jump to a page…"
            className="flex-1 bg-transparent outline-none text-sm py-1.5 text-content-primary"
            aria-label="Command palette search"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:bg-surface"
            aria-label="Close command palette"
          >
            <X className="w-4 h-4 text-content-muted" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {filteredQuickActions.length > 0 && (
            <div className="mb-2">
              <div className="px-2 py-1 text-[11px] uppercase tracking-wider text-content-muted">
                Jump to
              </div>
              {filteredQuickActions.map((action) =>
                renderRow(
                  action.label,
                  action.hint,
                  { kind: 'action', payload: action },
                  null
                )
              )}
            </div>
          )}

          {filteredRecent.length > 0 && (
            <div className="mb-2">
              <div className="px-2 py-1 text-[11px] uppercase tracking-wider text-content-muted">
                Recent deals
              </div>
              {filteredRecent.map((deal) =>
                renderRow(
                  deal.name,
                  deal.city || deal.stage || null,
                  { kind: 'recent', payload: deal },
                  null,
                  <Clock className="w-3.5 h-3.5 shrink-0 text-content-muted" />
                )
              )}
            </div>
          )}

          {trimmedQ.length >= 2 && (
            <div>
              <div className="px-2 py-1 text-[11px] uppercase tracking-wider text-content-muted">
                Deals matching &ldquo;{trimmedQ}&rdquo;
              </div>
              {dealSearch.isFetching && (
                <div className="px-3 py-2 text-xs text-content-muted">Searching deals…</div>
              )}
              {!dealSearch.isFetching && dealResults.length === 0 && (
                <div className="px-3 py-2 text-xs text-content-muted">No deals matched.</div>
              )}
              {dealResults.map((deal) =>
                renderRow(
                  deal.name,
                  [deal.city, deal.stage].filter(Boolean).join(' · '),
                  { kind: 'deal', payload: deal }
                )
              )}
            </div>
          )}

          {trimmedQ.length < 2 && filteredQuickActions.length === 0 && filteredRecent.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-content-muted">
              Press <kbd>↑</kbd> <kbd>↓</kbd> to navigate, <kbd>Enter</kbd> to select, <kbd>Esc</kbd> to close.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-3 py-1.5 text-[11px] border-t border-hairline text-content-muted">
          <span>
            <kbd>{navigator?.platform?.includes('Mac') ? '⌘' : 'Ctrl'}</kbd>+<kbd>K</kbd> toggles this palette
          </span>
          <span>{flatItems.length} result{flatItems.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}
