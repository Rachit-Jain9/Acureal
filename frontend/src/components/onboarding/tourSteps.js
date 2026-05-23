// Tour content. WELCOME_PANES are the multi-pane intro modal; TOUR_STEPS
// are the coachmarks anchored on sidebar nav items. The `target` is a CSS
// selector matched at runtime, so steps for items the current user can't
// see (e.g. admin items for a Viewer) are filtered out automatically
// before the tour starts.

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

export const TOUR_STEPS = [
  {
    id: 'dashboard',
    target: '[data-tour="nav-dashboard"]',
    title: 'Dashboard',
    body: "Your live cockpit — pipeline value, active deals, average IRR, plus what's happening across your team today.",
  },
  {
    id: 'deals',
    target: '[data-tour="nav-deals"]',
    title: 'Deals',
    body: "Every deal you're working — from a half-sourced site visit to an IC-ready memo. Click any card to open its full workspace.",
  },
  {
    id: 'intelligence',
    target: '[data-tour="nav-intelligence"]',
    title: 'Market Intelligence',
    body: 'City-level benchmarks and market trends, Bengaluru first. Verified data sources only — no hand-wavy "market reports".',
  },
  {
    id: 'comps',
    target: '[data-tour="nav-comps"]',
    title: 'Comps',
    body: 'Verified transaction comparables. Every record carries its source and last-verified date. Search by location, asset class or vintage.',
  },
  {
    id: 'reports',
    target: '[data-tour="nav-reports"]',
    title: 'Reports & Exports',
    body: 'Investor-grade outputs — DOCX briefings, PPTX decks, XLSX models — all generated from live deal data with provenance baked in.',
  },
  {
    id: 'master-plan',
    target: '[data-tour="nav-master-plan"]',
    title: 'Master Plan',
    body: "Bengaluru's Revised Master Plan zones, overlaid on the parcel canvas. The ground truth your deals reference for FAR, setbacks and use.",
  },
  {
    id: 'parcel-intel',
    target: '[data-tour="nav-parcel-intel"]',
    title: 'Parcel Intelligence',
    body: 'Curate and enrich the parcel data REDIP uses across deals — auto-derived facts, cadastral overlays, audit-trail-backed corrections.',
  },
  {
    id: 'comps-queue',
    target: '[data-tour="nav-comps-queue"]',
    title: 'Comps Review Queue',
    body: 'AI-extracted comps land here for human review before they enter the verified database. Approve, edit or reject — provenance preserved.',
  },
  {
    id: 'ai-usage',
    target: '[data-tour="nav-ai-usage"]',
    title: 'AI Usage & Cost',
    body: 'Per-call provenance and cost for every AI extraction, synthesis and memo draft. Cost caps live here too.',
  },
  {
    id: 'ab-eval',
    target: '[data-tour="nav-ab-eval"]',
    title: 'A/B Evaluations',
    body: 'Run A/B experiments against AI prompts and rate the outputs — improving extraction quality without flying blind.',
  },
  {
    id: 'settings',
    target: '[data-tour="nav-settings"]',
    title: 'Settings',
    body: 'Your profile, security and workspace preferences — and you can replay this tour any time from here.',
  },
];
