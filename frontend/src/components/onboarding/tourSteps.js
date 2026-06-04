// Tour content. WELCOME_PANES are the multi-pane intro modal; TOUR_STEPS and
// DEAL_TOUR_STEPS are the coachmarks anchored on sidebar nav items and deal
// tabs respectively.
//
// TOUR_STEPS and DEAL_TOUR_STEPS are DERIVED from the single product catalog
// (utils/productGuide.js) so the tour copy and the in-app Guide can never drift
// apart. The shape the tours consume — { id, target, title, body } — is
// preserved exactly, so ProductTour/DealWorkspaceTour are untouched. The
// `target` is a CSS selector matched at runtime, so steps for items the current
// user can't see (e.g. admin items for a Viewer) are filtered out automatically
// before the tour starts.

import { GUIDE_ENTRIES } from '../../utils/productGuide';

const isSidebarTarget = (t) => typeof t === 'string' && t.startsWith('[data-tour=');
const isDealTarget = (t) => typeof t === 'string' && t.startsWith('#tab-');

// Catalog entry → tour step. Deal entries are namespaced `deal.*` in the
// catalog (so ids stay globally unique); strip the prefix here so the step id
// stays the bare tab id (`overview`, `comps`…) the Coachmark keys on.
const toStep = (e) => ({
  id: e.id.replace(/^deal\./, ''),
  target: e.tourTarget,
  title: e.label,
  body: e.what,
});

export const TOUR_STEPS = GUIDE_ENTRIES
  .filter((e) => isSidebarTarget(e.tourTarget))
  .map(toStep);

export const DEAL_TOUR_STEPS = GUIDE_ENTRIES
  .filter((e) => isDealTarget(e.tourTarget))
  .map(toStep);

export const WELCOME_PANES = [
  {
    title: 'Welcome to REDIP.',
    body: 'REDIP is the operating system for live real-estate deal work — sourcing, due diligence, underwriting, and IC prep, all in one workspace. Built for Bengaluru-first investors who care about depth, traceability, and not making the same mistake twice.',
  },
  {
    title: 'How REDIP makes your day easier.',
    bullets: [
      'Every number on every page traces back to a document. No more "where did this come from?".',
      'AI reads the messy stuff — sale deeds, title chains, RERA filings — so you can stay in judgment mode.',
      "Risks, approvals, and DD items live next to the deal, not in someone's inbox.",
    ],
  },
  {
    title: "Let's get you oriented.",
    body: "A short two-minute tour shows you where everything lives. Skip if you'd rather poke around on your own — you can replay it any time from Settings.",
  },
];
