'use strict';

/**
 * Post-hoc numerical verifier (Tier-1 #3).
 *
 * Compares numbers that appear in an AI-generated narrative against a
 * deterministic snapshot from the DB. Pure functions — no DB calls, no
 * LLM calls, no side effects. The orchestrator (intelligence.service.js)
 * is responsible for assembling the snapshot and persisting the
 * resulting drift array onto `ai_artifacts.numerical_drifts`.
 *
 * Per CLAUDE.md hard rules:
 *   • Math is deterministic JS, never the LLM.
 *   • Drifts are FLAGGED, never auto-corrected. The narrative stays
 *     untouched; the UI surfaces drifts as a review prompt.
 *   • If a number is absent from the narrative, that's not a drift —
 *     the LLM chose not to discuss it.
 *
 * Severity tiers (relative drift = |claimed - snapshot| / |snapshot|):
 *   • high   — > 10% drift
 *   • medium — 5%–10% drift
 *   • low    — 1%–5% drift
 *   • OK     — < 1% drift, dropped from the output array
 *
 * Today's coverage (deal_analysis artifact type):
 *   • IRR percentage
 *   • Total revenue (₹ in Cr)
 *   • Total cost / land cost (₹ in Cr)
 *   • Land area (acres or sqft)
 *
 * Adding a new field: add one entry to FIELD_EXTRACTORS below with the
 * canonical key, the regex pattern that finds the claim near a hint
 * keyword, and the unit normalizer.
 */

// ──────────────────────────────────────────────────────────────────────────
// Number parsing helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Parse a numeric string allowing comma group separators (Indian: 1,20,000)
 * and US-style (1,200). Returns null on garbage.
 */
function parseNumeric(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[, ]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const SQFT_PER_ACRE = 43560;

// ──────────────────────────────────────────────────────────────────────────
// Field extractors
// ──────────────────────────────────────────────────────────────────────────

/**
 * For each canonical field we care about, this registry tells the
 * orchestrator how to:
 *   • snapshot:   read the value out of the snapshot object the caller
 *                 assembles (e.g., financials.irr_pct → snapshot.irr_pct)
 *   • findClaim:  scan the narrative text for an LLM-claimed value tied
 *                 to a hint keyword (e.g., a percentage near "IRR")
 *   • normalize:  bring claim and snapshot into the same unit before
 *                 comparison (e.g., sqft ↔ acres for land area)
 *   • label:      human-readable name for UI surfacing
 */

// Helper: scan around hint-keyword occurrences for a numeric token.
// Returns { value, contextSnippet } for the FIRST hit, null if none.
function findNumberNearKeyword(text, keywords, valueRegex, opts = {}) {
  const radius = opts.radius || 60;
  const lowered = text.toLowerCase();
  for (const kw of keywords) {
    const kwLow = kw.toLowerCase();
    let idx = 0;
    while ((idx = lowered.indexOf(kwLow, idx)) !== -1) {
      const start = Math.max(0, idx - radius);
      const end = Math.min(text.length, idx + kwLow.length + radius);
      const window = text.slice(start, end);
      const match = window.match(valueRegex);
      if (match) {
        const num = parseNumeric(match[1]);
        if (num !== null) {
          // Context snippet around the matched value — trimmed for storage.
          const snippet = window.replace(/\s+/g, ' ').trim().slice(0, 100);
          return { value: num, contextSnippet: snippet };
        }
      }
      idx += kwLow.length;
    }
  }
  return null;
}

// Specific extractors. Each returns { value, contextSnippet, unit? } or null.

function findIrrClaim(text) {
  // Match a percentage near IRR / internal rate of return.
  // Pattern: an integer or decimal followed by % or "percent".
  // Allow patterns like "22%", "22.4%", "22 %", "22 percent".
  return findNumberNearKeyword(
    text,
    ['IRR', 'internal rate of return'],
    /([0-9]{1,3}(?:\.[0-9]{1,2})?)\s*(?:%|percent\b)/i,
  );
}

function findRevenueClaim(text) {
  // Currency-in-Cr near revenue / top line / project value / GDV.
  // Examples: "₹250 Cr", "Rs 250 Cr", "INR 250 Cr", "250 Cr revenue", etc.
  return findNumberNearKeyword(
    text,
    ['revenue', 'top line', 'topline', 'GDV', 'gross development value', 'project value', 'sales value'],
    /(?:₹|rs\.?|inr)?\s*([0-9]{1,5}(?:[, ][0-9]{2,3})*(?:\.[0-9]+)?)\s*(?:cr|crore|crores)\b/i,
  );
}

function findCostClaim(text) {
  return findNumberNearKeyword(
    text,
    ['total cost', 'project cost', 'land cost', 'development cost', 'cost basis', 'total outlay'],
    /(?:₹|rs\.?|inr)?\s*([0-9]{1,5}(?:[, ][0-9]{2,3})*(?:\.[0-9]+)?)\s*(?:cr|crore|crores)\b/i,
  );
}

function findLandAreaClaim(text) {
  // Look for "X acres" first (the more common Indian RE land unit).
  const acresMatch = findNumberNearKeyword(
    text,
    ['acre', 'acres', 'land area', 'site area', 'plot area'],
    /([0-9]{1,4}(?:[, ][0-9]{2,3})*(?:\.[0-9]+)?)\s*acres?\b/i,
  );
  if (acresMatch) return { ...acresMatch, unit: 'acres' };

  // Fallback: sqft.
  const sqftMatch = findNumberNearKeyword(
    text,
    ['sqft', 'sq ft', 'sft', 'square feet', 'square foot', 'land area', 'site area', 'plot area'],
    /([0-9]{1,7}(?:[, ][0-9]{2,3})*(?:\.[0-9]+)?)\s*(?:sq\.?\s*ft|sqft|sft|square\s*feet)\b/i,
  );
  if (sqftMatch) return { ...sqftMatch, unit: 'sqft' };

  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// Field registry — drives the orchestrator
// ──────────────────────────────────────────────────────────────────────────

const FIELD_REGISTRY = [
  {
    key: 'irr_pct',
    label: 'IRR',
    snapshotKey: 'irr_pct',
    findClaim: findIrrClaim,
    // Both snapshot and claim are already in % units; no conversion.
    normalize: (claim, snapshot) => ({
      claimNorm: claim?.value ?? null,
      snapshotNorm: snapshot ?? null,
      unit: '%',
    }),
  },
  {
    key: 'total_revenue_cr',
    label: 'Total revenue',
    snapshotKey: 'total_revenue_cr',
    findClaim: findRevenueClaim,
    normalize: (claim, snapshot) => ({
      claimNorm: claim?.value ?? null,
      snapshotNorm: snapshot ?? null,
      unit: '₹ Cr',
    }),
  },
  {
    key: 'total_cost_cr',
    label: 'Total cost',
    snapshotKey: 'total_cost_cr',
    findClaim: findCostClaim,
    normalize: (claim, snapshot) => ({
      claimNorm: claim?.value ?? null,
      snapshotNorm: snapshot ?? null,
      unit: '₹ Cr',
    }),
  },
  {
    key: 'land_area_acres',
    label: 'Land area',
    snapshotKey: 'land_area_acres',
    findClaim: findLandAreaClaim,
    // Convert sqft claims to acres so we compare on a single axis.
    normalize: (claim, snapshot) => {
      let claimAcres = null;
      if (claim) {
        claimAcres =
          claim.unit === 'sqft' ? claim.value / SQFT_PER_ACRE : claim.value;
      }
      return {
        claimNorm: claimAcres,
        snapshotNorm: snapshot ?? null,
        unit: 'acres',
      };
    },
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Drift comparison
// ──────────────────────────────────────────────────────────────────────────

const SEVERITY_THRESHOLDS = Object.freeze({
  HIGH: 10,
  MEDIUM: 5,
  LOW: 1,
});

function classifySeverity(deltaPct) {
  if (deltaPct >= SEVERITY_THRESHOLDS.HIGH) return 'high';
  if (deltaPct >= SEVERITY_THRESHOLDS.MEDIUM) return 'medium';
  if (deltaPct >= SEVERITY_THRESHOLDS.LOW) return 'low';
  return null; // sub-threshold — drop
}

/**
 * Verify a deal_analysis artifact's content against its snapshot.
 *
 * snapshot shape (caller assembles from the same DB rows that fed the
 * Claude prompt):
 *   {
 *     irr_pct:           number | null,
 *     total_revenue_cr:  number | null,
 *     total_cost_cr:     number | null,
 *     land_area_acres:   number | null,
 *   }
 *
 * Returns { drifts: [...], verifiedAt: ISO } regardless of whether
 * any drifts were found. drifts is [] when the narrative is clean.
 */
function verifyDealAnalysis({ contentMd, snapshot } = {}) {
  const drifts = [];
  const text = String(contentMd || '');

  if (!text.trim()) {
    return { drifts, verifiedAt: new Date().toISOString() };
  }

  for (const field of FIELD_REGISTRY) {
    const snapValue = snapshot ? snapshot[field.snapshotKey] : null;
    const claim = field.findClaim(text);

    // No claim in narrative → not a drift (LLM chose to skip).
    if (!claim) continue;

    // Claim present but no snapshot to compare → low-severity drift,
    // because the model may be quoting a number that doesn't exist
    // in the underwriting yet.
    if (snapValue == null) {
      drifts.push({
        field: field.key,
        label: field.label,
        claimed: claim.value,
        snapshot: null,
        delta_pct: null,
        severity: 'low',
        claim_context: claim.contextSnippet,
        reason: 'no_snapshot_value',
      });
      continue;
    }

    const { claimNorm, snapshotNorm, unit } = field.normalize(claim, snapValue);
    if (claimNorm == null || snapshotNorm == null || snapshotNorm === 0) {
      continue;
    }

    const deltaPct = Math.abs(claimNorm - snapshotNorm) / Math.abs(snapshotNorm) * 100;
    const severity = classifySeverity(deltaPct);
    if (!severity) continue; // sub-threshold

    drifts.push({
      field: field.key,
      label: field.label,
      claimed: round2(claimNorm),
      snapshot: round2(snapshotNorm),
      unit,
      delta_pct: round2(deltaPct),
      severity,
      claim_context: claim.contextSnippet,
    });
  }

  return { drifts, verifiedAt: new Date().toISOString() };
}

const round2 = (n) =>
  n == null || !Number.isFinite(n) ? n : Math.round(n * 100) / 100;

// Helper used by the orchestrator: build the snapshot object from the
// same data assembly function that fed Claude. Keeps verifier inputs
// strictly aligned with what the LLM saw.
function snapshotFromDealAnalysisInput(input) {
  if (!input || typeof input !== 'object') return null;
  const { financials = {}, deal = {} } = input;
  return {
    irr_pct: toNum(financials.irr_pct),
    total_revenue_cr: toNum(financials.total_revenue_cr),
    total_cost_cr: toNum(financials.total_cost_cr),
    land_area_acres: toNum(deal.land_area_acres),
  };
}

const toNum = (v) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

module.exports = {
  // Main orchestrator entrypoint
  verifyDealAnalysis,
  snapshotFromDealAnalysisInput,
  // Severity helper exported for tests + UI
  classifySeverity,
  SEVERITY_THRESHOLDS,
  // Individual extractors exported for tests
  findIrrClaim,
  findRevenueClaim,
  findCostClaim,
  findLandAreaClaim,
  // Pure helpers
  parseNumeric,
};
