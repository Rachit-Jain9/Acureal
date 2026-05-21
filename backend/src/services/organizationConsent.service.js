'use strict';

/**
 * Organization-level consent / data-governance ledger service
 * (Workstream C2 — the Data Network's consent foundation).
 *
 * The org-level half of the docs/DATA_GOVERNANCE.md §3 Layer-4 gate. An
 * organization is a data fiduciary that owns its deal data; whether that
 * data — even de-identified — contributes to a shared benchmark pool is an
 * org-level decision that sits above any individual user's consent.
 *
 * Every decision is appended as a new row in public.organization_consents.
 * The newest row per (organization_id, purpose) is the current state — a
 * reversal is a new row, never an UPDATE, so the org's governance posture is
 * fully auditable.
 *
 * Polarity: the sole purpose today is `benchmark_opt_out`. `granted = true`
 * means the opt-out is engaged ("do not benchmark"); `granted = false`, or
 * no row, means the org has not opted out.
 *
 * Migration 20260612_organization_consents.sql creates the table. Until it is
 * applied every read degrades gracefully (available: false / empty history)
 * and every write surfaces a clear 503 — the app must not 500 just because
 * the ledger table is one deploy behind the code.
 */

const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const log = require('../lib/logger').child({ module: 'organizationConsent.service' });

// Org-level data-governance purposes. One today; the list (and the migration
// CHECK) widen together as more org-level data-use decisions are added.
const ORG_CONSENT_PURPOSES = Object.freeze(['benchmark_opt_out']);

// Where an org-level decision originated. Mirrors the CHECK in the migration.
const ORG_CONSENT_SOURCES = Object.freeze(['settings', 'admin', 'import']);

// Postgres "undefined_table" — thrown when 20260612 has not been applied yet.
const PG_UNDEFINED_TABLE = '42P01';

const isMissingTable = (err) => Boolean(err) && err.code === PG_UNDEFINED_TABLE;

/**
 * Append a single org-level governance decision. Recording the same decision
 * twice simply leaves two identical-state rows, which is harmless (current
 * state is unchanged) and preserves the full audit trail.
 *
 * @param {object} input
 * @param {string}  input.organizationId
 * @param {string}  input.purpose        one of ORG_CONSENT_PURPOSES
 * @param {boolean} input.granted        the decision
 * @param {string}  [input.changedBy]    the acting owner/admin user id
 * @param {string}  [input.source]       one of ORG_CONSENT_SOURCES
 * @param {string}  [input.ipAddress]
 * @param {string}  [input.userAgent]
 * @param {object}  [client]  optional pg client, to enlist in a caller's transaction.
 */
const recordOrgConsent = async (
  {
    organizationId,
    purpose,
    granted,
    changedBy = null,
    source = 'settings',
    ipAddress = null,
    userAgent = null,
  },
  client = null
) => {
  if (!organizationId) {
    throw createError('recordOrgConsent requires an organizationId.', 400);
  }
  if (!ORG_CONSENT_PURPOSES.includes(purpose)) {
    throw createError(`Unknown organization consent purpose: ${purpose}`, 400);
  }
  if (typeof granted !== 'boolean') {
    throw createError('Organization consent decision (granted) must be a boolean.', 400);
  }
  if (!ORG_CONSENT_SOURCES.includes(source)) {
    throw createError(`Unknown organization consent source: ${source}`, 400);
  }

  const exec = client ? client.query.bind(client) : query;
  try {
    const result = await exec(
      `INSERT INTO public.organization_consents
         (organization_id, purpose, granted, changed_by, source, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6::inet, $7)
       RETURNING id, organization_id, purpose, granted, changed_by, source, created_at`,
      [organizationId, purpose, granted, changedBy, source, ipAddress, userAgent]
    );
    return result.rows[0];
  } catch (err) {
    if (isMissingTable(err)) {
      log.error('organization_consents table missing — apply migration 20260612', err);
      throw createError(
        'Organization governance settings are not yet available. Please try again shortly.',
        503
      );
    }
    throw err;
  }
};

/**
 * Current governance state for an organization: a { purpose: boolean } map
 * covering every known purpose. Purposes the org has never decided on default
 * to false — for `benchmark_opt_out`, false means "not opted out".
 *
 * `available` is false when the ledger table is not yet present, so callers
 * can distinguish a real "not opted out" from "feature not migrated".
 */
const getOrgConsentState = async (organizationId) => {
  const state = {};
  for (const purpose of ORG_CONSENT_PURPOSES) state[purpose] = false;

  if (!organizationId) return { state, available: true };

  try {
    const result = await query(
      `SELECT DISTINCT ON (purpose) purpose, granted
         FROM public.organization_consents
        WHERE organization_id = $1
        ORDER BY purpose, created_at DESC`,
      [organizationId]
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

/**
 * Convenience: has this organization engaged the "do not benchmark" opt-out?
 * Returns false when the org has not opted out — and also false when the
 * ledger table is not yet migrated (the safe default: the *other* gate
 * condition, per-user consent, defaults closed, so nothing can leak).
 */
const isBenchmarkingOptedOut = async (organizationId) => {
  const { state } = await getOrgConsentState(organizationId);
  return state.benchmark_opt_out === true;
};

/**
 * Full append-only history for an organization, newest first — every
 * governance decision with the acting user's name resolved for display.
 * Returns [] when the ledger table is not yet present.
 */
const getOrgConsentHistory = async (organizationId) => {
  if (!organizationId) return [];
  try {
    const result = await query(
      `SELECT oc.id, oc.purpose, oc.granted, oc.source, oc.created_at,
              oc.changed_by,
              u.name  AS changed_by_name,
              u.email AS changed_by_email
         FROM public.organization_consents oc
         LEFT JOIN public.users u ON u.id = oc.changed_by
        WHERE oc.organization_id = $1
        ORDER BY oc.created_at DESC, oc.id DESC`,
      [organizationId]
    );
    return result.rows;
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
};

module.exports = {
  ORG_CONSENT_PURPOSES,
  ORG_CONSENT_SOURCES,
  recordOrgConsent,
  getOrgConsentState,
  isBenchmarkingOptedOut,
  getOrgConsentHistory,
};
