'use strict';

/**
 * Per-purpose consent ledger service (DPDP Act 2023 §6).
 *
 * Backs the granular-consent system: every consent decision is appended as a
 * new row in public.user_consents. The newest row per (user_id, purpose) is
 * the current state — a withdrawal is a new granted = false row, never an
 * UPDATE, so §6(4) withdrawal is a fully auditable event.
 *
 * Migration 20260607_user_consents.sql creates the table. Until it is
 * applied every read degrades gracefully (available: false / empty history)
 * and every write surfaces a clear 503 — the app must not 500 on a request
 * just because the ledger table is one deploy behind the code.
 */

const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const log = require('../lib/logger').child({ module: 'consent.service' });

// The optional, separately-withdrawable processing purposes. Essential
// service is implied by using REDIP and is deliberately NOT in this list.
// Order is the canonical display order for the Privacy Centre.
const CONSENT_PURPOSES = Object.freeze([
  'product_improvement',
  'anonymized_benchmarking',
  'marketing',
  'ai_processing',
]);

// Where a consent decision originated. Mirrors the CHECK in the migration.
const CONSENT_SOURCES = Object.freeze(['signup', 'privacy_centre', 'admin', 'import']);

// Postgres "undefined_table" — thrown when 20260607 has not been applied yet.
const PG_UNDEFINED_TABLE = '42P01';

const isMissingTable = (err) => Boolean(err) && err.code === PG_UNDEFINED_TABLE;

/**
 * Append a single consent decision. Recording the same decision twice simply
 * leaves two identical-state rows, which is harmless (current state is
 * unchanged) and preserves the full audit trail.
 *
 * @param {object} input
 * @param {string}  input.userId
 * @param {string}  input.purpose       one of CONSENT_PURPOSES
 * @param {boolean} input.granted       the decision
 * @param {string}  [input.policyVersion]
 * @param {string}  [input.source]      one of CONSENT_SOURCES
 * @param {string}  [input.ipAddress]
 * @param {string}  [input.userAgent]
 * @param {object}  [client]  optional pg client, to enlist in a caller's
 *                            transaction (e.g. the registration transaction
 *                            recording signup toggles).
 */
const recordConsent = async (
  {
    userId,
    purpose,
    granted,
    policyVersion = null,
    source = 'privacy_centre',
    ipAddress = null,
    userAgent = null,
  },
  client = null
) => {
  if (!userId) {
    throw createError('recordConsent requires a userId.', 400);
  }
  if (!CONSENT_PURPOSES.includes(purpose)) {
    throw createError(`Unknown consent purpose: ${purpose}`, 400);
  }
  if (typeof granted !== 'boolean') {
    throw createError('Consent decision (granted) must be a boolean.', 400);
  }
  if (!CONSENT_SOURCES.includes(source)) {
    throw createError(`Unknown consent source: ${source}`, 400);
  }

  const exec = client ? client.query.bind(client) : query;
  try {
    const result = await exec(
      `INSERT INTO public.user_consents
         (user_id, purpose, granted, policy_version, source, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6::inet, $7)
       RETURNING id, user_id, purpose, granted, policy_version, source, created_at`,
      [userId, purpose, granted, policyVersion, source, ipAddress, userAgent]
    );
    return result.rows[0];
  } catch (err) {
    if (isMissingTable(err)) {
      log.error('user_consents table missing — apply migration 20260607', err);
      throw createError('Consent ledger is not yet available. Please try again shortly.', 503);
    }
    throw err;
  }
};

/**
 * Append several consent decisions at once. `decisions` is a
 * { purpose: boolean } map; unknown purposes and non-boolean values are
 * silently dropped so a malformed client payload cannot poison the ledger.
 * Returns the count of rows actually written.
 */
const recordConsents = async (
  {
    userId,
    decisions,
    policyVersion = null,
    source = 'privacy_centre',
    ipAddress = null,
    userAgent = null,
  },
  client = null
) => {
  if (!decisions || typeof decisions !== 'object') {
    throw createError('recordConsents requires a decisions object.', 400);
  }
  const entries = Object.entries(decisions).filter(
    ([purpose, granted]) => CONSENT_PURPOSES.includes(purpose) && typeof granted === 'boolean'
  );
  let recorded = 0;
  for (const [purpose, granted] of entries) {
    await recordConsent(
      { userId, purpose, granted, policyVersion, source, ipAddress, userAgent },
      client
    );
    recorded += 1;
  }
  return recorded;
};

/**
 * Current consent state for a user: a { purpose: boolean } map covering
 * every known purpose. Purposes the user has never decided on default to
 * false — DPDP is opt-in, and silence is not consent.
 *
 * `available` is false when the ledger table is not yet present, so callers
 * can distinguish "user declined everything" from "feature not migrated".
 */
const getConsentState = async (userId) => {
  const state = {};
  for (const purpose of CONSENT_PURPOSES) state[purpose] = false;

  if (!userId) return { state, available: true };

  try {
    const result = await query(
      `SELECT DISTINCT ON (purpose) purpose, granted
         FROM public.user_consents
        WHERE user_id = $1
        ORDER BY purpose, created_at DESC`,
      [userId]
    );
    for (const row of result.rows) {
      if (Object.prototype.hasOwnProperty.call(state, row.purpose)) {
        state[row.purpose] = row.granted === true;
      }
    }
    return { state, available: true };
  } catch (err) {
    if (isMissingTable(err)) {
      return { state, available: false };
    }
    throw err;
  }
};

/** Convenience: is one purpose currently granted for this user? */
const hasConsent = async (userId, purpose) => {
  if (!CONSENT_PURPOSES.includes(purpose)) return false;
  const { state } = await getConsentState(userId);
  return state[purpose] === true;
};

/**
 * Full append-only history for a user, newest first — every grant and
 * withdrawal. Powers the Privacy Centre audit view. Returns [] when the
 * ledger table is not yet present.
 */
const getConsentHistory = async (userId) => {
  if (!userId) return [];
  try {
    const result = await query(
      `SELECT id, purpose, granted, policy_version, source, created_at
         FROM public.user_consents
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC`,
      [userId]
    );
    return result.rows;
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
};

module.exports = {
  CONSENT_PURPOSES,
  CONSENT_SOURCES,
  recordConsent,
  recordConsents,
  getConsentState,
  hasConsent,
  getConsentHistory,
};
