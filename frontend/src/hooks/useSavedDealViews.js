import { useState, useEffect, useCallback } from 'react';

// Per-user saved-search store for the Deals list. localStorage-backed so
// it doesn't need a migration; an analyst's "My active sourcing", "All
// IC-ready", "Bengaluru office only" combinations stick across sessions
// on this device.
//
// Storage shape:
//   [
//     { id: '<uuid>', name: 'Active Bengaluru', filters: { stage, dealType, ... } },
//     ...
//   ]
//
// `filters` mirrors the controlled state on DealsPage (search / stage /
// dealType / priority / assignedToMe). New filter fields automatically
// flow in because we round-trip whatever the page hands us — the hook
// doesn't validate the keys, just persists them.
//
// Why localStorage, not the server: views are per-device + tiny. If
// they ever need to follow a user across devices, swap the storage
// backend in this file without touching the page.

const STORAGE_KEY = 'redip.deals.savedViews';
const MAX_VIEWS = 25; // sanity cap so a stuck save loop can't fill localStorage

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const safeRead = () => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
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

const safeWrite = (views) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
  } catch {
    /* localStorage may be disabled — silently no-op */
  }
};

// Pure: are two filter objects equivalent? Used to highlight the
// "active" saved view (the one whose filters exactly match what's
// currently selected) so the dropdown can render a checkmark.
export function filtersEqual(a, b) {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    // Treat '' and false and undefined and null as equivalent "empty"
    // so a fresh-state filter object compares clean against a saved
    // view that didn't store the empty fields.
    const empty = (v) => v === '' || v === undefined || v === null || v === false;
    if (empty(av) && empty(bv)) continue;
    if (av !== bv) return false;
  }
  return true;
}

export function useSavedDealViews() {
  const [views, setViews] = useState(() => safeRead());

  useEffect(() => {
    safeWrite(views);
  }, [views]);

  const save = useCallback((name, filters) => {
    const trimmed = String(name || '').trim().slice(0, 60);
    if (!trimmed) return null;
    const id = generateId();
    setViews((prev) => {
      const next = [...prev, { id, name: trimmed, filters: { ...filters } }];
      // Cap from the back so the analyst's most-recent saves win when
      // someone hits the limit.
      return next.length > MAX_VIEWS ? next.slice(-MAX_VIEWS) : next;
    });
    return id;
  }, []);

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

export { STORAGE_KEY, MAX_VIEWS };
