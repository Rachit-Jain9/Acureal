// GuideCenter — the always-available, searchable in-app guide. A right-hand
// drawer (not a centred Modal — the guidelines bless drawers for side panels,
// and a knowledge base wants width for a category rail + browsable content).
//
// Content comes entirely from utils/productGuide.js, so the Guide, the tours
// and the per-page intros can never describe the same surface differently.
// Opened from the Header "?" button, the Cmd-K palette, the Settings card, or a
// per-page "?" (all via the guideStore / the `redip:guide-open` window event).
//
// Reuses the app's overlay machinery — useFocusTrap, body-scroll-lock, the
// Modal enter/exit motion contract — so it behaves like every other dialog and
// collapses to an instant flip under prefers-reduced-motion.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { X, Search, ArrowRight, Compass } from 'lucide-react';
import {
  GUIDE_CATEGORIES, GUIDE_ENTRIES,
} from '../../utils/productGuide';
import { GuideIcon } from './guideIcons';
import { Button } from '../../design-system';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import useReducedMotion from '../../hooks/useReducedMotion';
import useGuideStore from '../../store/guideStore';
import useAuthStore from '../../store/authStore';
import { isPlatformAdmin } from '../../utils/permissions';
import { getMostRecentDealId } from '../common/CommandPalette';

const EXIT_MS = 200;
const HIGHLIGHT_MS = 1800;

const haystack = (e) =>
  [e.label, e.eyebrow, e.what, e.why, ...(e.doThis || [])].join(' ').toLowerCase();

function GuideEntryCard({ entry, categoryLabel, highlighted, onTakeThere }) {
  const takeThere = onTakeThere(entry);
  return (
    <article
      id={`guide-entry-${entry.id}`}
      className={
        'rounded-lg border bg-bg-secondary p-4 transition-colors duration-200 ease-out '
        + (highlighted ? 'border-accent/60 ring-2 ring-accent/25' : 'border-hairline')
      }
    >
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-hairline-soft bg-bg-elevated text-accent">
          <GuideIcon name={entry.icon} size={16} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-eyebrow uppercase tracking-wider text-content-muted">
              {entry.eyebrow}
            </span>
            {categoryLabel && (
              <span className="rounded-full border border-hairline-soft px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-content-muted">
                {categoryLabel}
              </span>
            )}
          </div>
          <h3 className="mt-0.5 text-sm font-semibold text-content-primary">{entry.label}</h3>
        </div>
      </div>

      <p className="mt-2.5 text-sm leading-relaxed text-content-secondary">{entry.what}</p>

      {entry.why && (
        <p className="mt-2.5 border-l-2 border-hairline-strong pl-3 text-sm leading-relaxed text-content-muted">
          <span className="font-medium text-content-secondary">Why it matters — </span>
          {entry.why}
        </p>
      )}

      {entry.doThis?.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {entry.doThis.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-content-secondary">
              <ArrowRight size={13} className="mt-1 shrink-0 text-accent" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}

      {takeThere && (
        <div className="mt-3.5">
          <Button
            variant="secondary"
            size="sm"
            rightIcon={<ArrowRight size={13} />}
            onClick={takeThere.onClick}
          >
            {takeThere.label}
          </Button>
        </div>
      )}
    </article>
  );
}

export default function GuideCenter() {
  const open = useGuideStore((s) => s.open);
  const topicId = useGuideStore((s) => s.topicId);
  const openGuide = useGuideStore((s) => s.openGuide);
  const close = useGuideStore((s) => s.close);
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = isPlatformAdmin(user);

  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState(GUIDE_CATEGORIES[0].id);
  const [highlightId, setHighlightId] = useState(null);
  const searchRef = useRef(null);

  // Any part of the app can open the Guide (optionally to a topic) by
  // dispatching `redip:guide-open` — mirrors the Cmd-K open pattern.
  useEffect(() => {
    const onOpen = (e) => openGuide(e?.detail?.topicId || null);
    window.addEventListener('redip:guide-open', onOpen);
    return () => window.removeEventListener('redip:guide-open', onOpen);
  }, [openGuide]);

  // Entries the current user can actually reach (admin surfaces hidden from
  // non-operators), plus the categories that still have content.
  const visibleEntries = useMemo(
    () => GUIDE_ENTRIES.filter((e) => !e.platformAdminOnly || isAdmin),
    [isAdmin],
  );
  const categories = useMemo(
    () => GUIDE_CATEGORIES.filter((c) => visibleEntries.some((e) => e.category === c.id)),
    [visibleEntries],
  );
  const catLabel = useMemo(
    () => Object.fromEntries(GUIDE_CATEGORIES.map((c) => [c.id, c.label])),
    [],
  );

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const results = useMemo(() => {
    if (searching) return visibleEntries.filter((e) => haystack(e).includes(q));
    return visibleEntries.filter((e) => e.category === activeCat);
  }, [visibleEntries, searching, q, activeCat]);

  // Mount/visible lifecycle + the slide-in animation (mirrors Modal.jsx).
  useEffect(() => { if (open) setMounted(true); }, [open]);
  useEffect(() => {
    if (!mounted) return undefined;
    if (open) {
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), reduced ? 0 : EXIT_MS);
    return () => clearTimeout(t);
  }, [open, mounted, reduced]);

  // Lock body scroll while the drawer occupies the screen.
  useEffect(() => {
    if (!mounted) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [mounted]);

  // Reset transient UI each time the drawer opens, and land on the requested
  // topic's category + scroll it into view if a per-page "?" passed one.
  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    const entry = topicId ? GUIDE_ENTRIES.find((e) => e.id === topicId) : null;
    if (entry) setActiveCat(entry.category);
    const raf = requestAnimationFrame(() => {
      if (entry) {
        document.getElementById(`guide-entry-${entry.id}`)
          ?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
        setHighlightId(entry.id);
      } else {
        searchRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [open, topicId, reduced]);

  // Fade the topic highlight out after a beat.
  useEffect(() => {
    if (!highlightId) return undefined;
    const t = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlightId]);

  const trapRef = useFocusTrap(mounted && open, { onEscape: close, autoFocus: false });

  const takeThereFor = (entry) => {
    if (entry.route) {
      return { label: 'Take me there', onClick: () => { navigate(entry.route); close(); } };
    }
    if (typeof entry.tourTarget === 'string' && entry.tourTarget.startsWith('#tab-')) {
      const tab = entry.tourTarget.slice('#tab-'.length);
      return {
        label: 'Open in a deal',
        onClick: () => {
          const dealId = getMostRecentDealId();
          navigate(dealId ? `/dashboard/deals/${dealId}?tab=${tab}` : '/dashboard/deals');
          close();
        },
      };
    }
    return null;
  };

  const selectCategory = (id) => { setActiveCat(id); setQuery(''); };

  if (!mounted) return null;
  const animate = !reduced;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex justify-end">
      <div
        aria-hidden="true"
        onClick={close}
        className={
          'absolute inset-0 bg-black/50 '
          + (animate ? 'transition-opacity duration-200 ease-out ' : '')
          + (animate && !shown ? 'opacity-0' : 'opacity-100')
        }
      />
      <aside
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Acureal Guide"
        className={
          'relative flex h-full w-full max-w-2xl flex-col border-l border-hairline bg-bg-elevated shadow-editorial-lg '
          + (animate ? 'transition-transform duration-[280ms] ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform ' : '')
          + (animate && !shown ? 'translate-x-full' : 'translate-x-0')
        }
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md border border-hairline-soft bg-bg-secondary text-accent">
              <Compass size={16} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-display text-base font-semibold text-content-primary">Guide</h2>
              <p className="text-sm text-content-secondary">What everything does — and why it matters.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close guide"
            className="shrink-0 rounded-md p-1.5 text-content-muted transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-hairline px-5 py-3">
          <div className="flex items-center gap-2 rounded-md border border-hairline bg-bg-secondary px-3 py-2 focus-within:border-accent/40">
            <Search size={15} className="shrink-0 text-content-muted" aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search every page, tab and concept…"
              aria-label="Search the guide"
              className="w-full bg-transparent text-sm text-content-primary outline-none placeholder:text-content-muted"
            />
            {searching && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="shrink-0 rounded p-0.5 text-content-muted hover:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Body: category rail + content */}
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* Rail — horizontal chips on mobile, vertical list on sm+ */}
          <nav
            aria-label="Guide categories"
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-hairline px-3 py-2 sm:w-48 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:border-b-0 sm:border-r sm:py-3"
          >
            {categories.map((c) => {
              const active = !searching && c.id === activeCat;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectCategory(c.id)}
                  aria-pressed={active}
                  className={
                    'shrink-0 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 '
                    + (active
                      ? 'bg-accent-soft font-medium text-accent'
                      : 'text-content-secondary hover:bg-bg-secondary')
                  }
                >
                  {c.label}
                </button>
              );
            })}
          </nav>

          {/* Content */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {!searching && (
              <p className="mb-3 text-sm text-content-muted">
                {categories.find((c) => c.id === activeCat)?.blurb}
              </p>
            )}
            {searching && (
              <p className="mb-3 text-eyebrow uppercase tracking-wider text-content-muted">
                {results.length} {results.length === 1 ? 'result' : 'results'} for “{query.trim()}”
              </p>
            )}
            {results.length === 0 ? (
              <div className="rounded-lg border border-hairline bg-bg-secondary px-4 py-8 text-center text-sm text-content-muted">
                Nothing matches “{query.trim()}”. Try a page name like “comps” or “risk”.
              </div>
            ) : (
              <div className="space-y-3">
                {results.map((entry) => (
                  <GuideEntryCard
                    key={entry.id}
                    entry={entry}
                    categoryLabel={searching ? catLabel[entry.category] : null}
                    highlighted={entry.id === highlightId}
                    onTakeThere={takeThereFor}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
