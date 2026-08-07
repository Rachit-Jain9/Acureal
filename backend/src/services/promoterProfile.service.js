'use strict';

/**
 * Promoter / builder track-record service — Workstream B (B4).
 *
 * Promoter execution risk — a builder who has delivered late on four of five
 * projects — is one of the catastrophic Indian-RE failure modes, and the one
 * the deal model had no home for. This service owns the per-deal promoter
 * profile (deal_promoter_profiles, migration 20260609) and computes a
 * deterministic execution posture from the analyst's verified findings.
 *
 * No AI: the posture is pure, explainable rule logic in the Risk Radar's
 * vocabulary (cleared / unverified / flagged), so it slots straight into the
 * radar as a sixth failure-mode category.
 *
 * Migration-tolerant: until 20260609 is applied every read degrades to an
 * unverified result (the radar and the deal workspace never 500), and the
 * upsert surfaces a clear 503.
 */

const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const karnatakaRera = require('./karnatakaReraTracker.service');
const log = require('../lib/logger').child({ module: 'promoterProfile.service' });

const PG_UNDEFINED_TABLE = '42P01';
const PG_UNDEFINED_COLUMN = '42703';
const isMissingTable = (err) => Boolean(err) && err.code === PG_UNDEFINED_TABLE;
const isMissingColumn = (err) => Boolean(err) && err.code === PG_UNDEFINED_COLUMN;
// Migration-tolerant for both the base table (20260609) and the K-RERA link
// columns (20260618) — every read degrades cleanly when either is absent.
const isMissingSchema = (err) => isMissingTable(err) || isMissingColumn(err);

const ENTITY_TYPES = Object.freeze([
  'individual',
  'partnership',
  'llp',
  'private_limited',
  'public_limited',
  'trust',
  'other',
]);

const SELECT_COLUMNS = `id, deal_id, organization_id, promoter_name, entity_type,
  years_active, total_projects, delivered_on_time, delivered_delayed,
  ongoing_projects, rera_registered, rera_complaints, notes,
  verified_by, verified_at, created_at, updated_at,
  linked_rera_promoter_name, linked_rera_match_confidence,
  linked_rera_at, linked_rera_by`;

// Pre-20260618 fallback — drops the K-RERA link columns so the profile read
// still works on older databases. Promoter card still renders; the K-RERA
// cross-link section just stays inert.
const SELECT_COLUMNS_LEGACY = `id, deal_id, organization_id, promoter_name, entity_type,
  years_active, total_projects, delivered_on_time, delivered_delayed,
  ongoing_projects, rera_registered, rera_complaints, notes,
  verified_by, verified_at, created_at, updated_at`;

// Coerce to a non-negative integer, or null.
const toCount = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const toText = (v) => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t || null;
};

/**
 * Deterministic execution posture from a promoter profile. Pure function —
 * exported for unit tests and reused by the Risk Radar.
 */
const assessPromoter = (profile) => {
  if (!profile || !profile.promoter_name) {
    return {
      posture: 'unverified',
      signals: [{ tone: 'warn', text: 'No promoter track record recorded yet' }],
      summary: { recorded: false },
    };
  }

  const onTime = Number.isFinite(profile.delivered_on_time) ? profile.delivered_on_time : 0;
  const delayed = Number.isFinite(profile.delivered_delayed) ? profile.delivered_delayed : 0;
  const deliveredTotal = onTime + delayed;
  const onTimeRate = deliveredTotal > 0 ? onTime / deliveredTotal : null;
  const onTimePct = onTimeRate != null ? Math.round(onTimeRate * 100) : null;

  const signals = [];
  let problems = 0;
  let warns = 0;

  if (Number.isFinite(profile.rera_complaints) && profile.rera_complaints > 0) {
    problems += 1;
    signals.push({
      tone: 'negative',
      text: `${profile.rera_complaints} RERA complaint${profile.rera_complaints === 1 ? '' : 's'} on record`,
    });
  }
  if (deliveredTotal >= 3 && onTimeRate != null && onTimeRate < 0.6) {
    problems += 1;
    signals.push({
      tone: 'negative',
      text: `Weak delivery record — ${onTime} of ${deliveredTotal} projects on time (${onTimePct}%)`,
    });
  }
  if (profile.rera_registered === false) {
    warns += 1;
    signals.push({ tone: 'warn', text: 'Promoter is not RERA-registered' });
  }
  if (deliveredTotal >= 3 && onTimeRate != null && onTimeRate >= 0.6 && onTimeRate < 0.85) {
    warns += 1;
    signals.push({
      tone: 'warn',
      text: `Mixed delivery record — ${onTime} of ${deliveredTotal} on time (${onTimePct}%)`,
    });
  }
  if (deliveredTotal > 0 && deliveredTotal < 3) {
    warns += 1;
    signals.push({
      tone: 'warn',
      text: 'Too few completed projects to rate delivery reliably',
    });
  }
  if (deliveredTotal === 0) {
    // No recorded delivery split — execution quality cannot be assessed, so
    // the promoter stays unverified rather than being assumed clear.
    warns += 1;
    signals.push({
      tone: 'warn',
      text: 'Promoter recorded, but delivery history not yet filled in',
    });
  }
  if (profile.rera_registered === true && !Number.isFinite(profile.rera_complaints)) {
    // Acureal has no K-RERA complaints feed — a blank field means nobody has
    // looked, not that the register is clean. Same reasoning as the
    // deliveredTotal === 0 clause above: unchecked keeps the posture
    // unverified rather than letting it reach `cleared`.
    warns += 1;
    signals.push({ tone: 'warn', text: 'RERA complaints not yet checked' });
  }

  let posture;
  if (problems > 0) posture = 'flagged';
  else if (warns > 0) posture = 'unverified';
  else posture = 'cleared';

  if (posture === 'cleared') {
    signals.push({
      tone: 'positive',
      text:
        deliveredTotal >= 3 && onTimePct != null
          ? `Strong delivery record — ${onTime} of ${deliveredTotal} projects on time (${onTimePct}%)`
          : 'Promoter track record recorded — no concerns flagged',
    });
    if (profile.rera_registered === true) {
      // Reachable only when rera_complaints is a real recorded 0 — the warn
      // above keeps an unchecked profile out of the `cleared` branch entirely.
      // Phrased as what the register says, not as a statutory conclusion.
      signals.push({ tone: 'positive', text: 'RERA-registered; complaints recorded: 0' });
    }
  }

  return {
    posture,
    signals,
    summary: {
      recorded: true,
      promoter_name: profile.promoter_name,
      delivered_total: deliveredTotal,
      on_time_pct: onTimePct,
    },
  };
};

/** Fetch the promoter profile for a deal, or null. Migration-tolerant on
 *  both the base table (20260609) AND the K-RERA link columns (20260618). */
const getProfile = async (dealId) => {
  // Try the full SELECT first (with K-RERA link columns). If those columns
  // aren't there yet (20260618 not applied) fall back to the legacy SELECT.
  try {
    const result = await query(
      `SELECT ${SELECT_COLUMNS}
         FROM public.deal_promoter_profiles
        WHERE deal_id = $1
          AND organization_id = current_organization_id()
        LIMIT 1`,
      [dealId]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    if (isMissingColumn(err)) {
      // Pre-20260618 schema — read the legacy column set instead.
      try {
        const legacy = await query(
          `SELECT ${SELECT_COLUMNS_LEGACY}
             FROM public.deal_promoter_profiles
            WHERE deal_id = $1
              AND organization_id = current_organization_id()
            LIMIT 1`,
          [dealId]
        );
        return legacy.rows[0] || null;
      } catch (legacyErr) {
        if (isMissingTable(legacyErr)) return null;
        throw legacyErr;
      }
    }
    throw err;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  K-RERA cross-link — Phase 1 / Pillar 6
//
//  The analyst's manual profile is sovereign. The K-RERA cross-link adds
//  "what the public record shows" alongside it, never overwriting the
//  analyst's findings. The link is a column on the profile; the K-RERA
//  aggregates come from regulatory_data.karnataka_rera_promoter_index via
//  karnatakaReraTracker.service.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Top trigram-similar K-RERA promoters for a free-text promoter name.
 * Used by the PromoterProfileCard to surface "did you mean ...?" candidates
 * after the analyst records a name. Empty array when K-RERA tables are
 * empty (the right empty-state per CLAUDE.md "no fake connectivity").
 */
const findReraCandidates = async (promoterName, { limit = 5, minSimilarity = 0.35 } = {}) => {
  if (!promoterName || promoterName.trim().length < 2) return [];
  return karnatakaRera.findPromoterCandidates(promoterName, { limit, minSimilarity });
};

/**
 * Confirm a K-RERA promoter as the canonical match for this deal's profile.
 * Records who linked it + when + at what trigram similarity. Idempotent
 * (UPSERT-style UPDATE: linking the same promoter twice is a no-op).
 *
 * Returns the updated profile row. Throws:
 *   - 404 if no profile exists for the deal (analyst must record first)
 *   - 503 if the K-RERA link columns aren't migrated yet (20260618)
 */
const linkReraPromoter = async (dealId, reraPromoterName, userId = null, matchConfidence = null) => {
  const cleanName = toText(reraPromoterName);
  if (!cleanName) throw createError('A K-RERA promoter name is required.', 400);

  const conf =
    matchConfidence === null || matchConfidence === undefined
      ? null
      : (() => {
          const n = Number(matchConfidence);
          if (!Number.isFinite(n) || n < 0 || n > 1) return null;
          return Number(n.toFixed(3));
        })();

  try {
    const result = await query(
      `UPDATE public.deal_promoter_profiles
          SET linked_rera_promoter_name    = $1,
              linked_rera_match_confidence = $2,
              linked_rera_at               = NOW(),
              linked_rera_by               = $3,
              updated_at                   = NOW()
        WHERE deal_id = $4
          AND organization_id = current_organization_id()
        RETURNING ${SELECT_COLUMNS}`,
      [cleanName, conf, userId, dealId]
    );
    if (!result.rows[0]) {
      throw createError(
        'No promoter profile to link — record the promoter first, then link the K-RERA match.',
        404
      );
    }
    return result.rows[0];
  } catch (err) {
    if (err.statusCode) throw err;
    if (isMissingTable(err)) {
      throw createError('Promoter profiles are not yet available. Please try again shortly.', 503);
    }
    if (isMissingColumn(err)) {
      log.error('deal_promoter_profiles.linked_rera_* missing — apply migration 20260618', err);
      throw createError(
        'The K-RERA cross-link feature is not yet enabled. Please try again shortly.',
        503
      );
    }
    throw err;
  }
};

/** Clear the K-RERA cross-link. Idempotent — unlinking a non-linked profile
 *  returns the profile unchanged. */
const unlinkReraPromoter = async (dealId) => {
  try {
    const result = await query(
      `UPDATE public.deal_promoter_profiles
          SET linked_rera_promoter_name    = NULL,
              linked_rera_match_confidence = NULL,
              linked_rera_at               = NULL,
              linked_rera_by               = NULL,
              updated_at                   = NOW()
        WHERE deal_id = $1
          AND organization_id = current_organization_id()
        RETURNING ${SELECT_COLUMNS}`,
      [dealId]
    );
    if (!result.rows[0]) {
      throw createError('No promoter profile found for this deal.', 404);
    }
    return result.rows[0];
  } catch (err) {
    if (err.statusCode) throw err;
    if (isMissingTable(err)) {
      throw createError('Promoter profiles are not yet available. Please try again shortly.', 503);
    }
    if (isMissingColumn(err)) {
      throw createError(
        'The K-RERA cross-link feature is not yet enabled. Please try again shortly.',
        503
      );
    }
    throw err;
  }
};

/**
 * Build the K-RERA cross-check slice for a profile. Returns:
 *   {
 *     candidates: [{promoter_name, sim_score}, ...],  // top fuzzy matches
 *     linked: { promoter_name, match_confidence, linked_at } | null,
 *     stats:  { total_projects, completed, ongoing, lapsed, ... } | null,
 *   }
 *
 * Empty / null shape when K-RERA tables aren't populated. Pure read —
 * never throws so the profile card always renders.
 */
const getReraCrossCheck = async (profile) => {
  if (!profile || !profile.promoter_name) {
    return { candidates: [], linked: null, stats: null };
  }
  const linkedName = profile.linked_rera_promoter_name || null;

  // If linked: fetch the K-RERA aggregate stats for that exact name; do not
  // resurface candidates (the link is settled).
  if (linkedName) {
    const stats = await karnatakaRera.getPromoterStats(linkedName);
    return {
      candidates: [],
      linked: {
        promoter_name: linkedName,
        match_confidence: profile.linked_rera_match_confidence ?? null,
        linked_at: profile.linked_rera_at || null,
      },
      stats: stats || null,
    };
  }

  // Not linked yet: surface up to 5 fuzzy candidates for the operator to
  // confirm. Empty array when no K-RERA data exists.
  const candidates = await findReraCandidates(profile.promoter_name);
  return { candidates, linked: null, stats: null };
};

/** Profile + its computed assessment + K-RERA cross-check — the read model
 *  for the Promoter card. */
const getProfileWithAssessment = async (dealId) => {
  const profile = await getProfile(dealId);
  const rera = await getReraCrossCheck(profile);
  return {
    profile,
    assessment: assessPromoter(profile),
    rera,
  };
};

/**
 * The Risk Radar category for promoter execution. Shaped like the radar's
 * other categories so it slots straight in as the sixth failure mode.
 */
const getPromoterRadarCategory = async (dealId) => {
  const profile = await getProfile(dealId);
  const { posture, signals } = assessPromoter(profile);
  return {
    key: 'promoter_execution',
    label: 'Promoter & Execution',
    posture,
    signals,
    flags: { total: 0, ever: 0, critical: 0, high: 0, medium: 0, low: 0 },
    diligence: { total: 0, required_total: 0, required_open: 0, completed: 0, flagged: 0 },
    approvals: null,
  };
};

/**
 * Create or replace the promoter profile for a deal. The PUT is a full-document
 * update — the editor holds every field and submits the whole profile. Records
 * verified_by / verified_at provenance on every save.
 */
const upsertProfile = async (dealId, data = {}, userId = null) => {
  // The deal must belong to the caller's organisation.
  let dealCheck;
  try {
    dealCheck = await query(
      `SELECT 1 FROM public.deals
        WHERE id = $1 AND organization_id = current_organization_id()
        LIMIT 1`,
      [dealId]
    );
  } catch (err) {
    if (isMissingTable(err)) throw createError('Deal not found.', 404);
    throw err;
  }
  if (!dealCheck.rows[0]) {
    throw createError('Deal not found.', 404);
  }

  const entityType = ENTITY_TYPES.includes(data.entity_type) ? data.entity_type : null;
  const reraRegistered =
    data.rera_registered === true || data.rera_registered === false
      ? data.rera_registered
      : null;

  try {
    const result = await query(
      `INSERT INTO public.deal_promoter_profiles
         (deal_id, promoter_name, entity_type, years_active, total_projects,
          delivered_on_time, delivered_delayed, ongoing_projects, rera_registered,
          rera_complaints, notes, verified_by, verified_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
       ON CONFLICT (deal_id) DO UPDATE SET
         promoter_name     = EXCLUDED.promoter_name,
         entity_type       = EXCLUDED.entity_type,
         years_active      = EXCLUDED.years_active,
         total_projects    = EXCLUDED.total_projects,
         delivered_on_time = EXCLUDED.delivered_on_time,
         delivered_delayed = EXCLUDED.delivered_delayed,
         ongoing_projects  = EXCLUDED.ongoing_projects,
         rera_registered   = EXCLUDED.rera_registered,
         rera_complaints   = EXCLUDED.rera_complaints,
         notes             = EXCLUDED.notes,
         verified_by       = EXCLUDED.verified_by,
         verified_at       = EXCLUDED.verified_at,
         updated_at        = NOW()
       RETURNING ${SELECT_COLUMNS}`,
      [
        dealId,
        toText(data.promoter_name),
        entityType,
        toCount(data.years_active),
        toCount(data.total_projects),
        toCount(data.delivered_on_time),
        toCount(data.delivered_delayed),
        toCount(data.ongoing_projects),
        reraRegistered,
        toCount(data.rera_complaints),
        toText(data.notes),
        userId || null,
      ]
    );
    return result.rows[0];
  } catch (err) {
    if (isMissingTable(err)) {
      log.error('deal_promoter_profiles table missing — apply migration 20260609', err);
      throw createError(
        'Promoter profiles are not yet available. Please try again shortly.',
        503
      );
    }
    throw err;
  }
};

module.exports = {
  ENTITY_TYPES,
  assessPromoter,
  getProfile,
  getProfileWithAssessment,
  getPromoterRadarCategory,
  upsertProfile,
  // K-RERA cross-link (Phase 1 / Pillar 6)
  findReraCandidates,
  linkReraPromoter,
  unlinkReraPromoter,
  getReraCrossCheck,
};
