// Product-tour state — a tiny Zustand store. `active` is the on/off
// switch for the welcome modal + coachmark walk-through. localStorage
// is the source of truth so the tour replays after a page refresh but
// never auto-opens again once the user has completed or skipped it.

import { create } from 'zustand';

const STORAGE_KEY = 'redip.productTour.completed';

const safeStorage = {
  read: () => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch (_) {
      return false;
    }
  },
  write: (completed) => {
    try {
      if (typeof window === 'undefined') return;
      if (completed) window.localStorage.setItem(STORAGE_KEY, '1');
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch (_) {
      // localStorage may be unavailable in private mode — fall back to in-memory.
    }
  },
};

const useTourStore = create((set) => ({
  // Auto-opens for any user who hasn't completed/skipped the tour yet.
  active: !safeStorage.read(),
  start: () => set({ active: true }),
  dismiss: () => {
    safeStorage.write(true);
    set({ active: false });
  },
  replay: () => {
    safeStorage.write(false);
    set({ active: true });
  },
}));

export default useTourStore;
