import { useState, useEffect, useCallback } from 'react';

// Generic saved-search store. Per-page localStorage-backed CRUD over
// `[{ id, name, filters }]`. Used by:
//   • Deals list (storageKey='redip.deals.savedViews')
//   • Comps Review Queue (storageKey='redip.compsQueue.savedViews')
//
// `filters` is an opaque object — the hook doesn't validate keys, just
// round-trips whatever the page hands it. This keeps it cheap to add a
// new filter column on either page without touching the hook.
//
// Why localStorage, not the server: views are per-device + tiny. If
// they ever need to follow a user across devices, swap the storage
// backend in this file without touching the page.

const DEFAULT_MAX_VIEWS = 25; // sanity cap so a stuck save loop can't fill localStorage

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const safeRead = (storageKey) => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop entries missing the required fields so a corrupted payload
    // can't blow up the menu render.
    return parsed.filter(
      (v) => v && typeof v.id === 'string' && typeof v.name === 'string' && v.filters && typeof v.filters === 'object',
    );
  } catch {
    return [];
  }
};

const safeWrite = (storageKey, views) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(views));
  } catch {
    /* localStorage may be disabled — silently no-op */
  }
};

// Pure: are two filter objects equivalent? Used to highlight the
// "active" saved view (the one whose filters exactly match what's
// currently selected) so the dropdown can render a checkmark.
//
// Empty / undefined / false / null are treated as equivalent so a
// fresh-state filter object compares clean against a saved view that
// didn't store the empty fields. (e.g. filtering out an empty `search`
// in the persisted payload doesn't break recall.)
export function filtersEqual(a, b) {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    const empty = (v) => v === '' || v === undefined || v === null || v === false;
    if (empty(av) && empty(bv)) continue;
    if (av !== bv) return false;
  }
  return true;
}

/**
 * Per-page saved-views store.
 *
 * Args:
 *   storageKey   localStorage key (e.g. 'redip.deals.savedViews')
 *   maxViews     optional cap (default 25)
 *
 * Returns: { views, save(name, filters), remove(id), rename(id, name),
 *           findActive(currentFilters) }
 */
export function useSavedViews({ storageKey, maxViews = DEFAULT_MAX_VIEWS } = {}) {
  if (!storageKey) {
    throw new Error('useSavedViews: `storageKey` is required.');
  }
  const [views, setViews] = useState(() => safeRead(storageKey));

  useEffect(() => {
    safeWrite(storageKey, views);
  }, [storageKey, views]);

  const save = useCallback((name, filters) => {
    const trimmed = String(name || '').trim().slice(0, 60);
    if (!trimmed) return null;
    const id = generateId();
    setViews((prev) => {
      const next = [...prev, { id, name: trimmed, filters: { ...filters } }];
      // Cap from the back so the analyst's most-recent saves win when
      // someone hits the limit.
      return next.length > maxViews ? next.slice(-maxViews) : next;
    });
    return id;
  }, [maxViews]);

  const remove = useCallback((id) => {
    setViews((prev) => prev.filter((v) => v.id !== id));
  }, []);

  const rename = useCallback((id, name) => {
    const trimmed = String(name || '').trim().slice(0, 60);
    if (!trimmed) return;
    setViews((prev) => prev.map((v) => (v.id === id ? { ...v, name: trimmed } : v)));
  }, []);

  // Find the currently-active view (if any) — the one whose filters
  // exactly match the supplied filter object. Used by the menu to
  // tag the active item.
  const findActive = useCallback(
    (currentFilters) => views.find((v) => filtersEqual(v.filters, currentFilters)) || null,
    [views],
  );

  return { views, save, remove, rename, findActive };
}

export const DEFAULT_MAX_SAVED_VIEWS = DEFAULT_MAX_VIEWS;
