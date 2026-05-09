// Thin wrapper around the generic `useSavedViews` hook, kept so the
// Deals list keeps its tidy import path. Behaviour identical to the
// hook that shipped in PR #209 — same storage key, same cap, same
// surface — only the implementation moved.
//
// New surfaces (e.g. the Comps Review Queue) call `useSavedViews`
// directly with their own storage key.

import { useSavedViews, filtersEqual, DEFAULT_MAX_SAVED_VIEWS } from './useSavedViews';

export const STORAGE_KEY = 'redip.deals.savedViews';
export const MAX_VIEWS = DEFAULT_MAX_SAVED_VIEWS;

export function useSavedDealViews() {
  return useSavedViews({ storageKey: STORAGE_KEY, maxViews: MAX_VIEWS });
}

export { filtersEqual };
