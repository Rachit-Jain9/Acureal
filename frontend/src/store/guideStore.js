// guideStore — open/close state for the in-app Guide (components/guide/
// GuideCenter). The Guide is reachable from four places: the Header "?" button,
// the Cmd-K palette, the Settings onboarding card, and per-page "?" affordances
// (which dispatch the `redip:guide-open` window event). Centralising the open
// state here keeps every launcher decoupled from the drawer itself.
//
// The drawer renders at z-[200] — above the product tour (coachmark z-[120]),
// below the Cmd-K palette (z-[1000]) — so opening it cleanly covers a running
// tour without needing to tear the tour down.

import { create } from 'zustand';

const useGuideStore = create((set) => ({
  open: false,
  // Optional catalog entry id to focus when the Guide opens (a per-page "?"
  // passes the topic for that page so the drawer lands on the right card).
  topicId: null,
  openGuide: (topicId = null) => set({ open: true, topicId: topicId || null }),
  close: () => set({ open: false, topicId: null }),
}));

export default useGuideStore;
