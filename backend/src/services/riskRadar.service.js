'use strict';

/**
 * Deal Risk Radar — Workstream B of the product plan ("the Risk Sentinel").
 *
 * A standing, deterministic pre-mortem. For each failure mode that actually
 * sinks Indian real-estate deals, it synthesises a posture from facts already
 * in the deal — risk flags, due-diligence items, and statutory approvals —
 * and surfaces **"not yet verified" as a first-class state**. REDIP warns
 * before it is asked.
 *
 * No AI: this is pure deterministic synthesis over existing tables, so every
 * posture and every signal is explainable and auditable — the discipline
 * CLAUDE.md mandates for scoring.
 */

const { query } = require('../config/database');
const promoterProfileService = require('./promoterProfile.service');
const dealStructureMatrix = require('../utils/dealStructureMatrix');

// The failure-mode categories the radar reports. Each is backed by real data:
// risk_flags categories, dd_items categories, and (for approvals) the
// approval_items table. Promoter/execution and environmental are intentionally
// not separate rows — the data model has no distinct category for the former,
// and environmental approvals fold into Approvals & Regulatory.
const RADAR_CATEGORIES = [
  {
    key: 'title_ownership',
    label: 'Title & Ownership',
    risk: ['title', 'legal'],
    dd: ['title_ownership', 'seller_validity', 'land_classification'],
    approvals: false,
  },
  {
    key: 'approvals_regulatory',
    label: 'Approvals & Regulatory',
    risk: ['regulatory', 'zoning'],
    dd: ['statutory'],
    approvals: true,
  },
  {
    key: 'financial',
    label: 'Financial',
    risk: ['financial'],
    dd: ['financial_commercial'],
    approvals: false,
  },
  {
    key: 'physical_technical',
    label: 'Physical & Technical',
    risk: ['physical'],
    dd: ['physical_technical', 'project_specific'],
    approvals: false,
  },
  {
    key: 'market',
    label: 'Market & Demand',
    risk: ['market'],
    dd: [],
    approvals: false,
  },
];

const OPEN_FLAG_STATUSES = new Set(['open', 'flagged']);
const OPEN_DD_STATUSES = new Set(['pending', 'in_progress']);

// Exact-match lookups from the controlled vocabularies (domain.js) to a radar
// key, built once from RADAR_CATEGORIES.
const RISK_EXACT = {};
const DD_EXACT = {};
for (const cat of RADAR_CATEGORIES) {
  for (const r of cat.risk) RISK_EXACT[r] = cat.key;
  for (const d of cat.dd) DD_EXACT[d] = cat.key;
}

// Map a (possibly free-text) risk-flag category to a radar key. Exact match
// first; a keyword fallback covers anything outside the controlled set so a
// flag is never silently dropped.
const mapRiskCategory = (raw) => {
  const c = String(raw || '').trim().toLowerCase();
  if (RISK_EXACT[c]) return RISK_EXACT[c];
  if (/title|ownership|legal|encumbr|seller|deed/.test(c)) return 'title_ownership';
  if (/approv|regulat|zon|rera|statut|sanction|permit|noc/.test(c)) return 'approvals_regulatory';
  if (/financ|model|commercial|price|cost|under.?writ/.test(c)) return 'financial';
  if (/market|demand|absorpt|sales/.test(c)) return 'market';
  return 'physical_technical';
};

const mapDdCategory = (raw) => {
  const c = String(raw || '').trim().toLowerCase();
  if (DD_EXACT[c]) return DD_EXACT[c];
  if (/title|ownership|seller|classif/.test(c)) return 'title_ownership';
  if (/statut|approv|regulat|zon/.test(c)) return 'approvals_regulatory';
  if (/financ|commercial/.test(c)) return 'financial';
  return 'physical_technical';
};

const plural = (n) => (n === 1 ? '' : 's');

const emptyCategory = (cat) => ({
  key: cat.key,
  label: cat.label,
  // `total` counts open/flagged flags (these drive posture); `ever` counts
  // flags in any status (this proves the failure mode was engaged with).
  flags: { total: 0, ever: 0, critical: 0, high: 0, medium: 0, low: 0 },
  // `overdue` counts required, still-open DD items whose due_date has
  // already passed — these auto-escalate the category to "flagged" so the
  // radar warns about stale diligence without an operator having to
  // create a risk_flag by hand. The deterministic equivalent of the
  // "auto-flag from DD" gap the product audit called out.
  diligence: {
    total: 0,
    required_total: 0,
    required_open: 0,
    completed: 0,
    flagged: 0,
    overdue: 0,
  },
  approvals: cat.approvals
    ? { total: 0, required_total: 0, required_validated: 0, required_pending: 0, expired_required: 0 }
    : null,
});

// Deterministic posture + human-readable signals for one category.
//   flagged    — an active problem (open flag, flagged DD item, overdue
//                required DD item, or expired approval)
//   cleared    — the category was assessed and all required work is done
//   unverified — not yet cleared: required work open, or nothing checked at all
const assessCategory = (c) => {
  const { flags, diligence: dd, approvals: ap } = c;
  const signals = [];

  const hasProblem =
    flags.total > 0
    || dd.flagged > 0
    || dd.overdue > 0
    || (ap ? ap.expired_required > 0 : false);
  const openWork = dd.required_open > 0 || (ap ? ap.required_pending > 0 : false);
  const assessed = dd.total > 0 || flags.ever > 0 || (ap ? ap.total > 0 : false);

  let posture;
  if (hasProblem) posture = 'flagged';
  else if (assessed && !openWork) posture = 'cleared';
  else posture = 'unverified';

  if (flags.total > 0) {
    const parts = ['critical', 'high', 'medium', 'low']
      .filter((s) => flags[s] > 0)
      .map((s) => `${flags[s]} ${s}`);
    signals.push({
      tone: 'negative',
      text: `${flags.total} open risk flag${plural(flags.total)}${parts.length ? ` — ${parts.join(', ')}` : ''}`,
    });
  }
  if (dd.flagged > 0) {
    signals.push({
      tone: 'negative',
      text: `${dd.flagged} diligence item${plural(dd.flagged)} flagged for follow-up`,
    });
  }
  if (dd.overdue > 0) {
    // Overdue is its own dedicated signal — distinct from "flagged for
    // follow-up" because the trigger (passed due date, still open) is
    // automatic and doesn't require an operator to have classified the
    // item. Same negative tone — same posture impact.
    signals.push({
      tone: 'negative',
      text: `${dd.overdue} required diligence item${plural(dd.overdue)} overdue`,
    });
  }
  if (ap && ap.expired_required > 0) {
    signals.push({
      tone: 'negative',
      text: `${ap.expired_required} required approval${plural(ap.expired_required)} expired`,
    });
  }
  if (dd.required_open > 0) {
    signals.push({
      tone: 'warn',
      text: `${dd.required_open} of ${dd.required_total} required diligence item${plural(dd.required_total)} still open`,
    });
  }
  if (ap && ap.required_pending > 0) {
    signals.push({
      tone: 'warn',
      text: `${ap.required_pending} of ${ap.required_total} required approval${plural(ap.required_total)} not yet validated`,
    });
  }
  if (!assessed) {
    signals.push({ tone: 'warn', text: 'No diligence recorded for this failure mode yet' });
  }
  if (posture === 'cleared') {
    signals.push({ tone: 'positive', text: 'Required diligence complete — no open flags' });
  }

  return { posture, signals };
};

/**
 * Build the Risk Radar for a deal. Returns the five failure-mode categories,
 * each with its posture, counts, and explainable signals, plus the worst-case
 * overall posture. Org-scoped via current_organization_id().
 *
 * Also reads the deal's (asset_class, deal_structure) and applies the matrix
 * preset (see `utils/dealStructureMatrix.js`) — adding one info-tone signal
 * per structurally-elevated failure mode. The preset NEVER escalates an
 * `unverified` category to `flagged` on its own (only real DD evidence does);
 * it only surfaces context so the empty-state radar tells the deal team where
 * to start.
 */
const getRiskRadar = async (dealId) => {
  const [riskRes, ddRes, approvalRes, dealRes] = await Promise.all([
    query(
      `SELECT category, severity, status
         FROM risk_flags
        WHERE deal_id = $1 AND organization_id = current_organization_id()
          AND deleted_at IS NULL`,
      [dealId]
    ),
    query(
      `SELECT category, status, is_required, due_date
         FROM dd_items
        WHERE deal_id = $1 AND organization_id = current_organization_id()
          AND deleted_at IS NULL`,
      [dealId]
    ),
    query(
      `SELECT is_required, is_validated, status, expiry_date
         FROM approval_items
        WHERE deal_id = $1 AND organization_id = current_organization_id()
          AND deleted_at IS NULL`,
      [dealId]
    ),
    query(
      `SELECT asset_class, deal_structure
         FROM deals
        WHERE id = $1 AND organization_id = current_organization_id()`,
      [dealId]
    ),
  ]);

  const byKey = {};
  for (const cat of RADAR_CATEGORIES) byKey[cat.key] = emptyCategory(cat);

  // Risk flags — every flag proves engagement (`ever`); only open/flagged
  // flags drive posture and the severity breakdown.
  for (const row of riskRes.rows) {
    const c = byKey[mapRiskCategory(row.category)];
    c.flags.ever += 1;
    if (!OPEN_FLAG_STATUSES.has(String(row.status || '').toLowerCase())) continue;
    const sev = String(row.severity || 'medium').toLowerCase();
    c.flags.total += 1;
    if (c.flags[sev] !== undefined) c.flags[sev] += 1;
  }

  // Due-diligence items.
  const nowMs = Date.now();
  for (const row of ddRes.rows) {
    const c = byKey[mapDdCategory(row.category)];
    const status = String(row.status || 'pending').toLowerCase();
    const required = row.is_required !== false;
    c.diligence.total += 1;
    if (required) c.diligence.required_total += 1;
    if (status === 'flagged') c.diligence.flagged += 1;
    else if (status === 'completed') c.diligence.completed += 1;
    else if (required && OPEN_DD_STATUSES.has(status)) {
      c.diligence.required_open += 1;
      // Auto-escalation: a required, still-open DD item whose due_date
      // has passed is treated as a flagged signal. The original status
      // stays untouched in the database — this is a deterministic
      // computation at radar-query time, no side effects.
      if (row.due_date && new Date(row.due_date).getTime() < nowMs) {
        c.diligence.overdue += 1;
      }
    }
  }

  // Approvals — all fold into Approvals & Regulatory.
  const apCat = byKey.approvals_regulatory.approvals;
  const now = Date.now();
  for (const row of approvalRes.rows) {
    apCat.total += 1;
    if (row.is_required === false) continue;
    apCat.required_total += 1;
    if (row.expiry_date && new Date(row.expiry_date).getTime() < now) {
      apCat.expired_required += 1;
    }
    if (row.is_validated === true) apCat.required_validated += 1;
    else apCat.required_pending += 1;
  }

  const categories = RADAR_CATEGORIES.map((cat) => {
    const c = byKey[cat.key];
    return { ...c, ...assessCategory(c) };
  });

  // Sixth failure mode — promoter / execution (B4). Computed from the deal's
  // promoter track-record profile; migration-tolerant (an unrecorded or
  // pre-migration profile reads as 'unverified'), so the radar never breaks.
  categories.push(await promoterProfileService.getPromoterRadarCategory(dealId));

  // Structure-aware preset overlay. The matrix knows which failure modes are
  // structurally elevated for a (class, structure) pair — when a category in
  // that list is still `unverified`, add an info-tone signal so the deal team
  // sees WHERE to start diligence on day one. The preset never escalates
  // posture: only real DD evidence does.
  const dealRow = dealRes.rows[0] || {};
  const matrixPreset = dealStructureMatrix.getRiskPreset(
    dealRow.asset_class,
    dealRow.deal_structure,
  );
  if (matrixPreset.elevated.length > 0 && dealRow.deal_structure) {
    const structureLabel = dealRow.deal_structure.replace(/_/g, ' ').toUpperCase();
    for (const cat of categories) {
      if (!matrixPreset.elevated.includes(cat.key)) continue;
      if (cat.posture !== 'unverified') continue;
      cat.signals = [
        ...(cat.signals || []),
        {
          tone: 'info',
          text: `Structurally elevated for ${structureLabel} deals — prioritise diligence here.`,
        },
      ];
    }
  }

  const overall_posture = categories.some((c) => c.posture === 'flagged')
    ? 'flagged'
    : categories.some((c) => c.posture === 'unverified')
      ? 'unverified'
      : 'cleared';

  return {
    generated_at: new Date().toISOString(),
    overall_posture,
    categories,
    structure_preset: matrixPreset.notes
      ? { notes: matrixPreset.notes, elevated: matrixPreset.elevated }
      : null,
  };
};

module.exports = {
  getRiskRadar,
  // Exported for unit tests.
  RADAR_CATEGORIES,
  mapRiskCategory,
  mapDdCategory,
};
