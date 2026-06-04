// productGuide.js — the single source of truth for what every REDIP surface
// is, what you can do there, and why it exists.
//
// One catalog feeds four things, so the copy is written once and never drifts:
//   • the in-app Guide (components/guide/GuideCenter) — searchable, browsable;
//   • the sidebar + deal-workspace tours (components/onboarding/tourSteps
//     derives TOUR_STEPS / DEAL_TOUR_STEPS from the `tourTarget` entries);
//   • the per-page intros (components/guide/PageIntro);
//   • the welcome experience's role-tailored "first moves".
//
// `icon` is a STRING key (resolved to a lucide component in the UI layer) so
// this module stays plain serialisable data — easy to test, no React import.
//
// ORDER MATTERS. The array order below is what the tours walk, in order.
// Sidebar-target entries (tourTarget starting `[data-tour=`) become TOUR_STEPS;
// deal-tab entries (tourTarget starting `#tab-`) become DEAL_TOUR_STEPS. Keep
// the sidebar entries in sidebar render order (primary nav → admin group →
// settings) and the deal entries in DealDetailPage tab order.

export const GUIDE_CATEGORIES = [
  {
    id: 'navigate',
    label: 'Getting around',
    blurb: 'The main sections in the left sidebar — where the work lives.',
  },
  {
    id: 'deal-workspace',
    label: 'Inside a deal',
    blurb: 'Every tab in a deal, from the site facts to the signed audit trail.',
  },
  {
    id: 'deal-features',
    label: 'Signals, AI & lookups',
    blurb: 'The analysis panels, AI reads and data lookups you meet inside a deal.',
  },
  {
    id: 'admin',
    label: 'For operators',
    blurb: 'Shared data-curation surfaces, visible only to platform operators.',
  },
  {
    id: 'concepts',
    label: 'How REDIP thinks',
    blurb: 'The ideas that make the numbers trustworthy — provenance, confidence, the deterministic engine.',
  },
];

export const GUIDE_ENTRIES = [
  // ─── Primary navigation ──────────────────────────────────────────────────
  {
    id: 'dashboard',
    category: 'navigate',
    label: 'Dashboard',
    icon: 'LayoutDashboard',
    route: '/dashboard',
    tourTarget: '[data-tour="nav-dashboard"]',
    eyebrow: 'Your cockpit',
    what: "Your live cockpit — pipeline value, active deals, average IRR, plus what's happening across your team today.",
    why: 'One glance tells you where the whole portfolio stands and what needs attention before it becomes a problem.',
    doThis: [
      'Scan the KPI strip: screened, underwritten and IC-ready counts',
      'Open the Attention panel to triage overdue DD and expiring approvals',
      'Customise which widgets you see with the gear menu',
    ],
  },
  {
    id: 'deals',
    category: 'navigate',
    label: 'Deals',
    icon: 'Briefcase',
    route: '/dashboard/deals',
    tourTarget: '[data-tour="nav-deals"]',
    eyebrow: 'The master object',
    what: "Every deal you're working — from a half-sourced site visit to an IC-ready memo. Click any card to open its full workspace.",
    why: 'Deals are the master object in REDIP — documents, diligence, risks and models all live inside a deal, never scattered across folders and inboxes.',
    doThis: [
      "Create a deal with whatever you have — even just 'Whitefield opportunity'",
      'Filter by stage, type or priority, or save a view you reuse',
      'Select several deals to compare, reassign or move stage in bulk',
    ],
  },
  {
    id: 'intelligence',
    category: 'navigate',
    label: 'Market Intelligence',
    icon: 'Brain',
    route: '/dashboard/intelligence',
    tourTarget: '[data-tour="nav-intelligence"]',
    eyebrow: 'The outside view',
    what: "City-level benchmarks and market trends, Bengaluru first. Verified data sources only — no hand-wavy 'market reports'.",
    why: 'Underwriting needs a defensible outside view. This is the broad, external market read that sits behind every deal-level comp.',
    doThis: [
      'Read the daily brief and macro KPIs',
      'Drill into residential, office, retail and industrial benchmarks',
      'Expand the transaction history by city and quarter',
    ],
  },
  {
    id: 'comps',
    category: 'navigate',
    label: 'Comps',
    icon: 'BarChart3',
    route: '/dashboard/comps',
    tourTarget: '[data-tour="nav-comps"]',
    eyebrow: 'Verified transactions',
    what: 'Verified transaction comparables. Every record carries its source and last-verified date. Search by location, asset class or vintage.',
    why: 'A comp is only as good as its provenance. REDIP keeps verified, listing and IPC sources visibly distinct so you never quote an unverified number as fact.',
    doThis: [
      'Filter by source, sort by rate or year-on-year growth',
      "Add a comp manually when you have one the feed doesn't",
      'Export the set for an offline working session',
    ],
  },
  {
    id: 'reports',
    category: 'navigate',
    label: 'Reports & Exports',
    icon: 'FileBarChart2',
    route: '/dashboard/reports',
    tourTarget: '[data-tour="nav-reports"]',
    eyebrow: 'Investor-grade output',
    what: 'Investor-grade outputs — Word briefings, PowerPoint decks, Excel models — all generated from live deal data with provenance baked in.',
    why: 'The numbers in your IC pack come straight from the deterministic engine, so the export always matches the workspace — no copy-paste drift.',
    doThis: [
      'Pick a report type: pipeline, financial, city-wise or performance',
      'Export to Word, PowerPoint, Excel or PDF',
      'Re-run any time — outputs refresh from the latest deal data',
    ],
  },
  {
    id: 'map',
    category: 'navigate',
    label: 'Map',
    icon: 'Map',
    route: '/dashboard/map',
    // No tourTarget — reachable by URL/search, not a sidebar tour stop.
    eyebrow: 'Spatial view',
    what: 'A spatial view of your deals and properties — stage heat, nearby comps and parcel locations on one canvas.',
    why: 'Location is half the underwriting in real estate. Seeing deals and comps geographically surfaces clustering and catchment that a list hides.',
    doThis: [
      'Toggle stage heat and the nearby-comps radius',
      'Search by locality and filter by zone',
      'Click a marker to jump to that property',
    ],
  },

  // ─── Admin group (platform operators only) ───────────────────────────────
  {
    id: 'master-plan',
    category: 'admin',
    label: 'Master Plan',
    icon: 'Map',
    route: '/dashboard/admin/master-plan',
    tourTarget: '[data-tour="nav-master-plan"]',
    platformAdminOnly: true,
    eyebrow: 'Zoning ground truth',
    what: "Bengaluru's Revised Master Plan zones, overlaid on the parcel canvas. The ground truth your deals reference for FAR, setbacks and use.",
    why: 'Zoning decides what can be built. Curating it centrally means every deal reads the same authoritative layer.',
    doThis: [
      'Review and approve zone assignments',
      'Attach evidence to each zone fact',
      'Extend coverage to new cities',
    ],
  },
  {
    id: 'parcel-intel',
    category: 'admin',
    label: 'Parcel Intelligence',
    icon: 'Database',
    route: '/dashboard/admin/parcel-intelligence',
    tourTarget: '[data-tour="nav-parcel-intel"]',
    platformAdminOnly: true,
    eyebrow: 'Curated parcel data',
    what: 'Curate and enrich the parcel data REDIP uses across deals — auto-derived facts, cadastral overlays, audit-trail-backed corrections.',
    why: 'Clean parcel data upstream means every deal reads trustworthy site facts without anyone re-keying them.',
    doThis: [
      'Review auto-derived parcel facts',
      'Correct fields with a full audit trail',
      'Tune the field rollup rules',
    ],
  },
  {
    id: 'comps-queue',
    category: 'admin',
    label: 'Comps Review Queue',
    icon: 'Inbox',
    route: '/dashboard/admin/comps-queue',
    tourTarget: '[data-tour="nav-comps-queue"]',
    platformAdminOnly: true,
    eyebrow: 'The verification gate',
    what: 'AI-extracted comps land here for human review before they enter the verified database. Approve, edit or reject — provenance preserved.',
    why: 'Nothing reaches the verified comp set without a human pass. This is the gate that keeps the database trustworthy.',
    doThis: [
      'Verify each field against the source',
      'Approve, edit or reject in bulk',
      'Assign items to a reviewer',
    ],
  },
  {
    id: 'ai-usage',
    category: 'admin',
    label: 'AI Usage & Cost',
    icon: 'Activity',
    route: '/dashboard/admin/ai-usage',
    tourTarget: '[data-tour="nav-ai-usage"]',
    platformAdminOnly: true,
    eyebrow: 'The AI meter',
    what: 'Per-call provenance and cost for every AI extraction, synthesis and memo draft. Cost caps live here too.',
    why: 'AI is a tool with a meter. Operators see exactly what was spent, on what, and can cap it.',
    doThis: [
      'Track token burn and cost by feature',
      'Inspect per-call provenance',
      'Set and review cost caps',
    ],
  },
  {
    id: 'ab-eval',
    category: 'admin',
    label: 'A/B Evaluations',
    icon: 'Beaker',
    route: '/dashboard/admin/ab-eval',
    tourTarget: '[data-tour="nav-ab-eval"]',
    platformAdminOnly: true,
    eyebrow: 'Measured quality',
    what: 'Run A/B experiments against AI prompts and rate the outputs — improving extraction quality without flying blind.',
    why: "Prompt quality compounds. Measuring it turns 'the AI feels better' into evidence.",
    doThis: [
      'Compare prompt variants side by side',
      'Rate outputs for quality',
      'Promote the winning variant',
    ],
  },
  {
    id: 'learning-signals',
    category: 'admin',
    label: 'Learning Signals',
    icon: 'Sparkles',
    route: '/dashboard/admin/learning-signals',
    // No tourTarget — documented in the Guide, not walked in the sidebar tour.
    platformAdminOnly: true,
    eyebrow: 'The learning loop',
    what: "The learning-loop telemetry — how REDIP's recommendations and extractions are performing over time.",
    why: 'Operators need to see, with numbers, whether the system is actually getting smarter.',
    doThis: [
      'Review recommendation accept / dismiss signals',
      'Spot extraction-quality drift early',
      'Feed findings back into prompt tuning',
    ],
  },
  {
    id: 'audit-trail',
    category: 'admin',
    label: 'Audit Trail',
    icon: 'ShieldCheck',
    route: '/dashboard/admin/audit-trail',
    // No tourTarget — documented in the Guide, not walked in the sidebar tour.
    platformAdminOnly: true,
    eyebrow: 'The system record',
    what: 'The system-wide, tamper-evident record of every material change across deals — mutations, stage moves, financial events.',
    why: 'Investor-grade reporting demands an immutable trail. Nothing material happens off the record.',
    doThis: [
      'Filter by event type, user or deal',
      'Inspect exactly what changed and when',
      'Trace a number back to the event that set it',
    ],
  },

  // ─── Settings (tail nav — kept last so the sidebar tour ends here) ────────
  {
    id: 'settings',
    category: 'navigate',
    label: 'Settings',
    icon: 'Settings',
    route: '/dashboard/settings',
    tourTarget: '[data-tour="nav-settings"]',
    eyebrow: 'Your account',
    what: 'Your profile, security and workspace preferences — and you can replay this tour or open the Guide any time from here.',
    why: 'Personal control sits here so the rest of the app stays focused on deal work.',
    doThis: [
      'Update your profile and password',
      'Turn on two-factor security',
      'Replay any onboarding surface or open the Guide',
    ],
  },

  // ─── Inside a deal (DealDetailPage tab order: overview → audit) ───────────
  {
    id: 'deal.overview',
    category: 'deal-workspace',
    label: 'Overview',
    icon: 'Gauge',
    tourTarget: '#tab-overview',
    eyebrow: 'The deal at a glance',
    what: 'The deal at a glance — headline economics, deal pulse, the risk radar, and the AI quick-analysis. The first place to land when you open a deal.',
    why: 'It synthesises every other tab into one read, so you know the shape of the deal in ten seconds.',
    doThis: [
      'Scan headline economics and the risk radar',
      'Read the AI quick-analysis — every claim links to its evidence',
      'Jump straight to any tab that needs work',
    ],
  },
  {
    id: 'deal.parcel',
    category: 'deal-workspace',
    label: 'Parcel / Site',
    icon: 'LandPlot',
    tourTarget: '#tab-parcel',
    eyebrow: 'What you are buying',
    what: 'The physical site — area, location, ownership, and the parcel-level facts every downstream decision hinges on.',
    why: 'Get the site wrong and every number downstream is wrong. This is the single source of truth for what you are actually buying.',
    doThis: [
      'Link or capture the property',
      'Auto-fill parcel context from uploaded documents',
      'View the site on the map',
    ],
  },
  {
    id: 'deal.zoning',
    category: 'deal-workspace',
    label: 'Regulatory / Zoning',
    icon: 'Ruler',
    tourTarget: '#tab-zoning',
    eyebrow: 'What you can build',
    what: 'Zoning, FAR, setbacks and the Master Plan overlay for this parcel. The rules that decide what you can actually build here.',
    why: 'Buildability sets the revenue ceiling. This tab turns regulation into a number the model can use.',
    doThis: [
      'Confirm the zone and FAR',
      'Apply buildability to the underwriting',
      'Attach the zoning documents',
    ],
  },
  {
    id: 'deal.documents',
    category: 'deal-workspace',
    label: 'Documents',
    icon: 'FileText',
    tourTarget: '#tab-documents',
    eyebrow: 'The evidence base',
    what: 'Title docs, RERA filings, financial models, site photos — uploaded once, then read by AI for cross-document analysis.',
    why: 'Documents are evidence. Everything REDIP claims about a deal traces back to a page in one of these files.',
    doThis: [
      'Drag in PDFs, Word, Excel or images',
      'Let AI extract and categorise them',
      'Search across every document at once',
    ],
  },
  {
    id: 'deal.activity',
    category: 'deal-workspace',
    label: 'Activity',
    icon: 'Clock',
    tourTarget: '#tab-activity',
    eyebrow: 'The deal timeline',
    what: 'Calls, site visits, notes, stage transitions — the auditable timeline of every action taken on this deal.',
    why: "Deal memory shouldn't live in someone's inbox. The timeline keeps the whole team on the same page.",
    doThis: [
      'Log a call, site visit or note',
      'Set a follow-up reminder',
      'See every stage move in order',
    ],
  },
  {
    id: 'deal.financial',
    category: 'deal-workspace',
    label: 'Financial',
    icon: 'Calculator',
    tourTarget: '#tab-financial',
    eyebrow: 'Underwrite the deal',
    what: 'The full financial model — IRR, NPV, equity multiple, debt schedule, JV / JDA waterfalls. Open this to underwrite the deal.',
    why: 'Every figure is computed by a deterministic engine — never an AI guess — so your IC numbers are reproducible and auditable.',
    doThis: [
      'Open the full model and enter assumptions',
      'Run sensitivities and what-if sliders',
      'Check the model-confidence read before you rely on it',
    ],
  },
  {
    id: 'deal.dd',
    category: 'deal-workspace',
    label: 'DD & Approvals',
    icon: 'ClipboardCheck',
    tourTarget: '#tab-dd',
    eyebrow: 'Close the gaps',
    what: "The diligence checklist and the approvals tracker — severity-scored, with an open / done score. Hover the small 'Evidence' pill on any row to see the source document, page and confidence that backs it.",
    why: 'Diligence is where deals die quietly. A scored, evidence-linked checklist makes the gaps impossible to ignore.',
    doThis: [
      'Seed the checklist, then work it down',
      'Score each item by severity',
      'Open the Evidence pill to trace a finding to its document',
    ],
  },
  {
    id: 'deal.risk',
    category: 'deal-workspace',
    label: 'Risk',
    icon: 'ShieldAlert',
    tourTarget: '#tab-risk',
    eyebrow: 'Kill the blind spots',
    what: 'Title, zoning, financial, physical, market and promoter risks — flagged, scored, and tied via the Evidence pill to the documents that surfaced them.',
    why: 'Indian real estate punishes blind spots — title, encumbrance, approvals, promoter execution. This register keeps them in front of you.',
    doThis: [
      'Log a risk with category and severity',
      'Track mitigation through to resolution',
      'Trace each flag back to its evidence',
    ],
  },
  {
    id: 'deal.comps',
    category: 'deal-workspace',
    label: 'Market / Comps',
    icon: 'Building2',
    tourTarget: '#tab-comps',
    eyebrow: 'Relative value',
    what: "Nearby verified comparables and this deal's relative-value read against the local market. Each comp's price carries its own Evidence pill so you can trace it back to a listing or registry entry.",
    why: "A deal-contextual comp set — distance, asset class, vintage — is what turns 'feels expensive' into a defensible number.",
    doThis: [
      'Review nearby comps ranked by similarity',
      'Toggle which comps you rely on',
      'Trace each price to its source',
    ],
  },
  {
    id: 'deal.audit',
    category: 'deal-workspace',
    label: 'Audit',
    icon: 'History',
    tourTarget: '#tab-audit',
    eyebrow: 'Prove what changed',
    what: 'The tamper-evident, signed trail of every material change to this deal — financial computations, stage moves, archive / restore.',
    why: 'An immutable trail is non-negotiable for investor-grade work. You can prove what changed, when, and what it produced.',
    doThis: [
      'Inspect KPI deltas between calculations',
      "Verify an event's integrity",
      'Replay a historical scenario',
    ],
  },

  // ─── Signals, AI & lookups inside a deal (no tab / tour stop — surfaced via
  //     the "?" on each panel header, and browsable here) ─────────────────────
  {
    id: 'deal.ai-analysis',
    category: 'deal-features',
    label: 'AI deal analysis',
    icon: 'Brain',
    eyebrow: 'AI read',
    what: 'An AI-written read of the deal — strengths, risks and next steps — composed from the deterministic signals and your uploaded documents.',
    why: 'A fast starting point, never a verdict. Every claim links to its evidence, and the legal four (title, encumbrance, RERA, approvals) stay human-verified — the AI never asserts them as fact.',
    doThis: [
      'Read it as interpretation, then check the evidence links',
      'Verify any title / RERA / approval claim against the source yourself',
      'Use it to decide which tab to dig into next',
    ],
  },
  {
    id: 'deal.ai-qa',
    category: 'deal-features',
    label: 'Ask about this deal',
    icon: 'Sparkles',
    eyebrow: 'AI read',
    what: "Ask plain-English questions about the deal; answers are grounded in this deal's own data and documents.",
    why: 'Faster than hunting across tabs — and every answer cites where it came from, so you can trust and trace it.',
    doThis: [
      'Ask about the numbers, risks, approvals or documents',
      'Open the cited source to confirm',
      'Treat it as a research aid, not a decision',
    ],
  },
  {
    id: 'deal.financial-model',
    category: 'deal-features',
    label: 'Financial model',
    icon: 'Calculator',
    eyebrow: 'Deterministic',
    what: 'The underwriting summary — IRR, NPV, margin, equity multiple — for this deal.',
    why: "Every figure is computed by deterministic code, reproducible from the inputs — never an AI guess. That's what makes your IC numbers defensible.",
    doThis: [
      'Open the full model to enter assumptions',
      'Run sensitivities and what-if sliders',
      'Check the model-confidence read before you rely on it',
    ],
  },
  {
    id: 'deal.street-lookup',
    category: 'deal-features',
    label: 'Street guidance lookup',
    icon: 'MapPin',
    eyebrow: 'Bengaluru data',
    what: 'The BBMP ward, zone and government guidance value for a Bengaluru street.',
    why: 'Guidance value anchors stamp duty and sets a defensible floor for negotiation — knowing it early sharpens the ask.',
    doThis: [
      'Confirm the ward and zone for the parcel',
      'Compare the guidance value to the asking price',
      'Carry the figure into the financial model',
    ],
  },
  {
    id: 'deal.planning-context',
    category: 'deal-features',
    label: 'Planning context',
    icon: 'Layers',
    eyebrow: 'Bengaluru data',
    what: 'The Bengaluru planning district and master-plan context around this parcel.',
    why: "Planning context drives what's buildable and permitted — the rules behind the revenue ceiling.",
    doThis: [
      'Check the planning district and existing land use',
      'Read it alongside the Zoning tab',
      'Flag any mismatch with the intended use',
    ],
  },
  {
    id: 'deal.risk-radar',
    category: 'deal-features',
    label: 'Risk Radar',
    icon: 'ShieldAlert',
    eyebrow: 'Risk',
    what: 'A standing pre-mortem at the top of the Risk tab — for each failure mode that sinks Indian real-estate deals, a posture: cleared, not-verified, or flagged.',
    why: "It keeps the blind spots that actually kill deals — title, encumbrance, approvals, promoter execution — in front of you, scored from the deal's own evidence rather than gut feel.",
    doThis: [
      'Scan the postures; treat anything flagged or unverified as open',
      'Open the evidence behind each posture to confirm it',
      'Work the flagged modes down before IC',
    ],
  },
  {
    id: 'deal.deal-doctor',
    category: 'deal-features',
    label: 'Deal Doctor',
    icon: 'Activity',
    eyebrow: 'Diagnostic',
    what: 'A diagnostic read of the deal that flags where the numbers, market or structure diverge from benchmarks — below or above bench, inconsistent, or missing support.',
    why: "It surfaces the soft problems a single number hides — a thin margin, an off-market cap rate, a capital stack that doesn't pencil — using a closed, non-judgmental verb set, never a verdict.",
    doThis: [
      'Read each call-out as a prompt to re-examine, not a conclusion',
      'Trace the diverging figure to its source',
      'Decide whether to stress-test or accept it',
    ],
  },
  {
    id: 'deal.ic-readiness',
    category: 'deal-features',
    label: 'IC Readiness',
    icon: 'ClipboardCheck',
    eyebrow: 'Decision-ready?',
    what: 'A scorecard of how ready this deal is to take to the Investment Committee — a 0–100 score across seven buckets (financials, documents, approvals and more) with what is verified, uploaded, or still missing.',
    why: "It turns \"are we ready to decide?\" into a concrete, evidence-backed checklist, so nothing reaches IC with a quiet gap. The score is computed from the deal's own data — not an opinion.",
    doThis: [
      'Work the missing and unverified items down',
      'Use it to judge IC-ready vs pre-IC',
      'Export the readiness pack for the committee',
    ],
  },
  {
    id: 'deal.promoter',
    category: 'deal-features',
    label: 'Promoter & Execution',
    icon: 'Building2',
    eyebrow: 'Execution risk',
    what: "Where you record the promoter / builder's verified track record — past delivery, delays and RERA project links. The posture (cleared / not-verified / flagged) is computed and feeds the Risk Radar.",
    why: "Promoter execution is one of the catastrophic ways Indian deals fail. This keeps the track record on the record — and REDIP never lets AI judge a promoter's competence or intent; that call stays yours.",
    doThis: [
      "Record and verify the promoter's delivery history",
      'Link any RERA projects',
      'Resolve the posture from not-verified to cleared or flagged',
    ],
  },
  {
    id: 'deal.risk-narrative',
    category: 'deal-features',
    label: 'Risk Profile Synthesis',
    icon: 'Sparkles',
    eyebrow: 'AI-assisted',
    what: "An AI-written synthesis of this deal's risk picture — the same prose that ships in your exported risk report, shown live on the Risk tab.",
    why: "It reads the whole risk register and tells the story in a paragraph so you grasp the shape fast. It's a starting point with evidence links — never a verdict, and it won't assert legal facts like clear title or RERA status; verify those yourself.",
    doThis: [
      'Read it as a summary, then confirm against the risk flags',
      'Trace each claim to its evidence',
      'Refresh it after the risk register changes',
    ],
  },
  {
    id: 'deal.ic-memo',
    category: 'deal-features',
    label: 'Full IC Memo',
    icon: 'FileText',
    eyebrow: 'AI-assisted',
    what: 'The long-form, multi-section IC memo drafted from this deal — the sign-off version of the Quick Analysis, AI-composed and ready to refine.',
    why: "It gets you most of the way to an investor-grade memo in seconds, grounded in the deal's real numbers and documents. AI drafts; you review and own the final word — and the legal four stay human-verified.",
    doThis: [
      'Generate, then read and edit before relying on it',
      'Check the numbers against the Financial tab',
      'Export it for the committee pack',
    ],
  },

  // ─── How REDIP thinks (concepts — no route, no tour stop) ─────────────────
  {
    id: 'concept.provenance',
    category: 'concepts',
    label: 'Provenance & evidence',
    icon: 'FileCheck',
    eyebrow: 'Trust',
    what: "Every number on every page can be traced back to a source document. Look for the small 'Evidence' pill across the DD, Risk and Comps tabs.",
    why: "Investor-grade work means never saying 'trust me'. If REDIP shows a figure, it can show you where it came from.",
    doThis: [
      'Hover any Evidence pill to see the source page and confidence',
      'Open the linked document to verify it yourself',
      'Treat anything without provenance as unverified',
    ],
  },
  {
    id: 'concept.confidence',
    category: 'concepts',
    label: 'Confidence & verification',
    icon: 'BadgeCheck',
    eyebrow: 'Trust',
    what: 'REDIP separates verified facts from unverified ones, and shows confidence and last-verified dates rather than implying false certainty.',
    why: 'Knowing how sure you are is as important as the number itself. Unverified comps look different from verified ones — on purpose.',
    doThis: [
      'Check the source and freshness on market data',
      "Watch for 'manual verification required' on low-confidence extractions",
      'Never quote an unverified figure as fact',
    ],
  },
  {
    id: 'concept.kernel',
    category: 'concepts',
    label: 'The deterministic engine',
    icon: 'Cpu',
    eyebrow: 'How the maths works',
    what: 'All financial math — IRR, NPV, sensitivities, area and price conversions — is computed by deterministic code, never by AI.',
    why: 'Numbers that drive a decision must be reproducible and auditable. AI interprets; it never does your arithmetic.',
    doThis: [
      'Read AI prose as interpretation, not calculation',
      'Re-run any model and get the identical answer',
      'Verify the figures in the deal Audit tab',
    ],
  },
  {
    id: 'concept.ai-guardrails',
    category: 'concepts',
    label: "How AI is used (and isn't)",
    icon: 'ShieldCheck',
    eyebrow: 'How the maths works',
    what: 'AI reads messy documents and drafts synthesis, but it never asserts statutory facts. Title, encumbrance, RERA and approval status stay extraction-aid only, with human verification.',
    why: 'On the four things that can sink a deal, REDIP refuses to put words in your mouth. AI surfaces the evidence; a person makes the call.',
    doThis: [
      'Use AI extractions as a starting point, not a verdict',
      'Verify the legal four against the source documents yourself',
      'Note the closed verb set — Recommend, Consider, Flag — never Buy or Approve',
    ],
  },
];

// Lookup by id (used by PageIntro and the Guide deep-links).
export function getGuideEntry(id) {
  return GUIDE_ENTRIES.find((e) => e.id === id) || null;
}

// Entries in a category, in catalog order (used by the Guide rail).
export function getGuideEntriesByCategory(categoryId) {
  return GUIDE_ENTRIES.filter((e) => e.category === categoryId);
}
