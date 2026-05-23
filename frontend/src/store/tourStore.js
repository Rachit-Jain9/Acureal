// Product-tour state — three onboarding surfaces live here:
//   1. The sidebar welcome tour (`active`) — first-time orientation walk
//      through the sidebar, opened by the welcome modal.
//   2. The deal-workspace tour (`dealTourActive`) — opens the first time
//      the user lands on a deal-detail page, walking through each tab
//      with a coachmark.
//   3. The Getting Started dashboard panel (`gettingStartedDismissed`) —
//      first-run guidance on the dashboard when the workspace has zero
//      deals. Shown until dismissed; never reappears once dismissed
//      unless explicitly replayed from Settings.
//
// localStorage is the source of truth so each surface replays after a
// refresh but never auto-opens again once the user has completed or
// skipped it. Centralising in the store also means the Settings
// "replay" buttons can trigger a re-show without a page reload.

import { create } from 'zustand';

const SIDEBAR_KEY = 'redip.productTour.completed';
const DEAL_KEY = 'redip.dealWorkspaceTour.completed';
const GETTING_STARTED_KEY = 'redip.gettingStarted.dismissed';

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

  // Getting Started dashboard panel ───────────────────────────────────────
  // `dismissed` (rather than `active`) because the panel is dismissable
  // but its actual visibility also depends on whether the workspace has
  // any deals — DashboardPage owns that combined check.
  gettingStartedDismissed: safeRead(GETTING_STARTED_KEY),
  dismissGettingStarted: () => {
    safeWrite(GETTING_STARTED_KEY, true);
    set({ gettingStartedDismissed: true });
  },
  replayGettingStarted: () => {
    safeWrite(GETTING_STARTED_KEY, false);
    set({ gettingStartedDismissed: false });
  },
}));

export default useTourStore;
