// Product-tour state — two tours actually live here:
//   1. The sidebar welcome tour (`active`) — first-time orientation walk
//      through the sidebar, opened by the welcome modal.
//   2. The deal-workspace tour (`dealTourActive`) — opens the first time
//      the user lands on a deal-detail page, walking through each tab
//      with a coachmark.
//
// localStorage is the source of truth so each tour replays after a refresh
// but never auto-opens again once the user has completed or skipped it.

import { create } from 'zustand';

const SIDEBAR_KEY = 'redip.productTour.completed';
const DEAL_KEY = 'redip.dealWorkspaceTour.completed';

const safeRead = (key) => {
  try {
    return typeof window !== 'undefined'
      && window.localStorage.getItem(key) === '1';
  } catch (_) {
    return false;
  }
};

const safeWrite = (key, completed) => {
  try {
    if (typeof window === 'undefined') return;
    if (completed) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch (_) {
    // localStorage may be unavailable in private mode — fall back to in-memory.
  }
};

const useTourStore = create((set) => ({
  // Sidebar tour ──────────────────────────────────────────────────────────
  active: !safeRead(SIDEBAR_KEY),
  start: () => set({ active: true }),
  dismiss: () => {
    safeWrite(SIDEBAR_KEY, true);
    set({ active: false });
  },
  replay: () => {
    safeWrite(SIDEBAR_KEY, false);
    set({ active: true });
  },

  // Deal-workspace tour ───────────────────────────────────────────────────
  dealTourActive: !safeRead(DEAL_KEY),
  dismissDealTour: () => {
    safeWrite(DEAL_KEY, true);
    set({ dealTourActive: false });
  },
  replayDealTour: () => {
    safeWrite(DEAL_KEY, false);
    set({ dealTourActive: true });
  },
}));

export default useTourStore;
