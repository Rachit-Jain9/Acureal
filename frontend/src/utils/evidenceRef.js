/**
 * Evidence-ref router (E1, Phase 1 / Pillar 1 follow-up).
 *
 * Every recommendation / Deal Doctor / micro-market card carries an
 * `evidence: [{ ref, label }]` array where each `ref` is a stable string
 * like:
 *
 *   kernel:irr                          → Financial tab, scroll to IRR tile
 *   kernel:landCr                       → Financial tab, scroll to land cost
 *   comps:median                        → Comps tab
 *   deal:sales_price_per_sqft           → Overview tab, scroll to that KPI
 *   approval:<uuid> / approvals:list    → DD tab
 *   dd:overdue / dd:deal_breakers       → DD tab
 *   doc:<id> / doc:area_statement       → Documents tab
 *   risk:flags                          → Risk tab
 *   promoter:profile                    → Risk tab (promoter card)
 *
 * `parseEvidenceRef(ref)` returns `{ tab, scrollTo }` for navigation or
 * `null` when the ref is unrouted (UI then renders it as inert text).
 *
 * Pure data + lookup — no DOM access. Used by `useEvidenceNavigate`.
 */

const EXACT_MAP = {
  // Kernel KPIs / costs / revenue / dscr
  'kernel:irr':             { tab: 'financial', scrollTo: 'kpi-irr' },
  'kernel:npv':             { tab: 'financial', scrollTo: 'kpi-npv' },
  'kernel:equityMultiple':  { tab: 'financial', scrollTo: 'kpi-equity-multiple' },
  'kernel:landCr':          { tab: 'financial', scrollTo: 'cost-land' },
  'kernel:revenue':         { tab: 'financial', scrollTo: 'revenue-total' },
  'kernel:totalCost':       { tab: 'financial', scrollTo: 'cost-total' },
  'kernel:dscrMonthly':     { tab: 'financial', scrollTo: 'dscr-monthly' },
  'kernel:grossMargin':     { tab: 'financial', scrollTo: 'kpi-gross-margin' },
  'kernel:yieldOnCost':     { tab: 'financial', scrollTo: 'kpi-yield-on-cost' },
  'kernel:exitValue':       { tab: 'financial', scrollTo: 'exit-value' },
  'kernel:residualLandValue': { tab: 'financial', scrollTo: 'residual-land-value' },

  // Comps
  'comps:median':           { tab: 'comps', scrollTo: 'comps-median' },
  'comps:absorption_median':{ tab: 'comps', scrollTo: 'comps-absorption' },
  'comps:cap_rate_band':    { tab: 'comps', scrollTo: 'comps-cap-rate' },

  // Deal-level inputs (live in Overview metric tiles)
  'deal:sales_price_per_sqft':         { tab: 'overview', scrollTo: 'deal-sales-price' },
  'deal:absorption_units_per_quarter': { tab: 'overview', scrollTo: 'deal-absorption' },
  'deal:exit_cap_rate_pct':            { tab: 'overview', scrollTo: 'deal-exit-cap' },
  'deal:saleable_sqft':                { tab: 'overview', scrollTo: 'deal-saleable' },
  'deal:hurdle_irr_pct':               { tab: 'overview', scrollTo: 'deal-hurdle' },

  // Approvals + DD
  'approvals:list':         { tab: 'dd', scrollTo: 'approvals-list' },
  'dd:overdue':             { tab: 'dd', scrollTo: 'dd-overdue' },
  'dd:deal_breakers':       { tab: 'dd', scrollTo: 'dd-deal-breakers' },
  'dd:items':               { tab: 'dd' },

  // Risk + promoter
  'risk:flags':             { tab: 'risk', scrollTo: 'risk-flags' },
  'promoter:profile':       { tab: 'risk', scrollTo: 'promoter-profile' },
};

// Prefix fallbacks for refs that carry a dynamic id (e.g. approval:abc-123).
const PREFIX_MAP = {
  approval:  { tab: 'dd', scrollTo: 'approvals-list' },
  doc:       { tab: 'documents' },
  document:  { tab: 'documents' },
  comp:      { tab: 'comps' },
  promoter:  { tab: 'risk', scrollTo: 'promoter-profile' },
  risk:      { tab: 'risk', scrollTo: 'risk-flags' },
};

/**
 * Parse an evidence ref string into a navigation target.
 *
 * @param {string} ref  e.g. "kernel:irr" or "approval:abc-uuid"
 * @returns {{ tab: string, scrollTo?: string } | null}
 *   null when the ref is unrouted — UI renders as inert text.
 */
export function parseEvidenceRef(ref) {
  if (typeof ref !== 'string' || ref.length === 0) return null;
  // Exact match first.
  if (EXACT_MAP[ref]) return EXACT_MAP[ref];
  // Prefix match — e.g. "approval:abc-123" → use the "approval" entry.
  const colonIdx = ref.indexOf(':');
  if (colonIdx > 0) {
    const prefix = ref.slice(0, colonIdx);
    if (PREFIX_MAP[prefix]) return PREFIX_MAP[prefix];
  }
  return null;
}

/** True iff the ref will route somewhere. UI uses this to decide whether to render the click affordance. */
export function isNavigableRef(ref) {
  return parseEvidenceRef(ref) !== null;
}

// Internals exported for tests.
export const __INTERNAL = { EXACT_MAP, PREFIX_MAP };
