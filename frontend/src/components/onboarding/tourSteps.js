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

// Deal-workspace tour — opens the first time the user lands on a
// deal-detail page. Anchored to each tab button (the Tabs primitive
// renders each as `id="tab-{tab.id}"`, so #tab-overview etc. are stable
// selectors). Same auto-skip behaviour as the sidebar tour if a target
// isn't in the DOM yet.
export const DEAL_TOUR_STEPS = [
  {
    id: 'overview',
    target: '#tab-overview',
    title: 'Overview',
    body: 'The deal at a glance — headline economics, deal pulse, the risk radar, and the AI quick-analysis. The first place to land when you open a deal.',
  },
  {
    id: 'parcel',
    target: '#tab-parcel',
    title: 'Parcel / Site',
    body: 'The physical site — area, location, ownership, and the parcel-level facts every downstream decision hinges on.',
  },
  {
    id: 'zoning',
    target: '#tab-zoning',
    title: 'Regulatory / Zoning',
    body: 'Zoning, FAR, setbacks and the Master Plan overlay for this parcel. The rules that decide what you can actually build here.',
  },
  {
    id: 'documents',
    target: '#tab-documents',
    title: 'Documents',
    body: 'Title docs, RERA filings, financial models, site photos — uploaded once, then read by AI for cross-document analysis.',
  },
  {
    id: 'activity',
    target: '#tab-activity',
    title: 'Activity',
    body: 'Calls, site visits, notes, stage transitions — the auditable timeline of every action taken on this deal.',
  },
  {
    id: 'financial',
    target: '#tab-financial',
    title: 'Financial',
    body: 'The full financial model — IRR, NPV, equity multiple, debt schedule, JV / JDA waterfalls. Open this to underwrite the deal.',
  },
  {
    id: 'dd',
    target: '#tab-dd',
    title: 'DD & Approvals',
    body: 'The diligence checklist and the approvals tracker. Severity-scored, with an open / done score. Hover the small "Evidence" pill on any row to see the source document — page and confidence — that backs it.',
  },
  {
    id: 'risk',
    target: '#tab-risk',
    title: 'Risk',
    body: 'Title, zoning, financial, physical, market and promoter risks — flagged, scored, and tied via the Evidence pill to the documents that surfaced them.',
  },
  {
    id: 'comps',
    target: '#tab-comps',
    title: 'Market / Comps',
    body: "Nearby verified transaction comparables and this deal's relative-value read against the local market. Each comp's price carries its own Evidence pill so you can trace it back to a listing or registry entry.",
  },
  {
    id: 'audit',
    target: '#tab-audit',
    title: 'Audit',
    body: 'The tamper-evident, HMAC-signed trail of every material change to this deal — financial computations, stage moves, archive / restore.',
  },
];
