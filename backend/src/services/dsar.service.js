'use strict';

/**
 * Data Subject Access Request (DSAR) service — DPDP Act 2023 §11.
 *
 * Assembles the personal datan Acureal holds about a single user and serves the
 * Privacy Centre's two needs:
 *   - getPrivacyOverview(userId) — a light read model for the page.
 *   - buildDataExport(userId)    — the full machine-readable export.
 *
 * Scope is the user's OWN personal/account data: profile, organisation
 * memberships, consent decisions, legal acceptances, and an active-session
 * summary. Deal and document content belongs to the organisation workspace
 * (Acureal is a Data Processor for it) and is available inside the app; it is
 * intentionally not duplicated into a personal-data export.
 *
 * Every optional-table read is migration-tolerant: an absent table degrades
 * to empty rather than 500-ing the Privacy Centre.
 */

const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const log = require('../lib/logger').child({ module: 'dsar.service' });
const consentService = require('./consent.service');
const legalService = require('./legal.service');

const PG_UNDEFINED_TABLE = '42P01';

// Run a read that touches an optional table; an absent table degrades to []
// rather than bubbling a 500 into the Privacy Centre.
const safeRows = async (sql, params, context) => {
  try {
    const result = await query(sql, params);
    return result.rows;
  } catch (err) {
    if (err && err.code === PG_UNDEFINED_TABLE) {
      log.warn('dsar_optional_table_missing', { context });
      return [];
    }
    throw err;
  }
};

// Coarse, human-readable device label from a raw User-Agent string. The full
// UA is noisy and a mild fingerprint; a "Chrome on Windows" summary is enough
// for the data subject to recognise their own sessions.
const summarizeUserAgent = (ua) => {
  if (!ua || typeof ua !== 'string') return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad|iPod/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
};

// How the account signs in — derived from the OAuth binding + password flag.
const describeSignInMethod = (row) => {
  if (row.oauth_provider) {
    return row.password_set === false
      ? `${row.oauth_provider} only`
      : `${row.oauth_provider} + password`;
  }
  return 'password';
};

const accountStatus = (row) => {
  if (row.erased_at) return 'erased';
  if (row.account_closed_at) return 'closed';
  return row.is_active ? 'active' : 'inactive';
};

// Profile fields safe to surface to the data subject. password_hash, MFA
// secrets and the raw OAuth subject id are excluded.
const getProfile = async (userId) => {
  const result = await query(
    `SELECT id, email, name, phone, role, is_active, password_set,
            oauth_provider, email_verified_at,
            terms_accepted_at, privacy_accepted_at,
            last_login_at, account_closed_at, erased_at,
            created_at, updated_at
       FROM public.users
      WHERE id = $1
      LIMIT 1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone || null,
    role: row.role,
    account_status: accountStatus(row),
    sign_in_method: describeSignInMethod(row),
    password_set: row.password_set !== false,
    email_verified: Boolean(row.email_verified_at),
    email_verified_at: row.email_verified_at || null,
    terms_accepted_at: row.terms_accepted_at || null,
    privacy_accepted_at: row.privacy_accepted_at || null,
    last_login_at: row.last_login_at || null,
    account_closed_at: row.account_closed_at || null,
    account_created_at: row.created_at,
    last_updated_at: row.updated_at,
  };
};

// Every workspace the user belongs to, with their role in each.
const getOrganisationMemberships = (userId) =>
  safeRows(
    `SELECT o.id   AS organization_id,
            o.name AS organization_name,
            o.slug AS organization_slug,
            om.role,
            om.is_active,
            om.joined_at
       FROM public.organization_members om
       JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id = $1
      ORDER BY om.joined_at ASC NULLS LAST`,
    [userId],
    'organization_members'
  );

// Active (non-revoked, unexpired) sign-ins. Token hashes are never surfaced.
const getActiveSessions = async (userId) => {
  const rows = await safeRows(
    `SELECT created_at, expires_at, ip_address, user_agent
       FROM public.refresh_token_grants
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC`,
    [userId],
    'refresh_token_grants'
  );
  return rows.map((r) => ({
    started_at: r.created_at,
    expires_at: r.expires_at,
    ip_address: r.ip_address || null,
    device: summarizeUserAgent(r.user_agent),
  }));
};

// Legal-document acceptances (Terms / Privacy / etc.). Wrapped defensively so
// a legal-table hiccup never blocks the rest of the Privacy Centre.
const getLegalAcceptances = async (userId) => {
  try {
    const rows = await legalService.getUserAcceptances(userId);
    return rows.map((r) => ({
      document_kind: r.kind,
      version: r.version,
      accepted_at: r.accepted_at,
      effective_at: r.effective_at,
      ip_address: r.ip_address || null,
    }));
  } catch (err) {
    log.warn('dsar_legal_acceptances_failed', { error: err.message });
    return [];
  }
};

const mapConsentHistoryRow = (r) => ({
  purpose: r.purpose,
  granted: r.granted,
  decided_at: r.created_at,
  policy_version: r.policy_version || null,
  source: r.source,
});

/**
 * Light read model for the Privacy Centre page. The consent toggles are
 * loaded separately by the page from GET /api/consent (the editable surface),
 * so the overview deliberately omits consent state.
 */
const getPrivacyOverview = async (userId) => {
  const [profile, organisations, legalAcceptances, sessions] = await Promise.all([
    getProfile(userId),
    getOrganisationMemberships(userId),
    getLegalAcceptances(userId),
    getActiveSessions(userId),
  ]);
  if (!profile) throw createError('User not found.', 404);
  return {
    profile,
    organisation_memberships: organisations,
    legal_acceptances: legalAcceptances,
    active_sessions: sessions,
  };
};

/**
 * Full machine-readable export of the user's personal data (DPDP §11
 * right to access). Returned as a structured object the route serialises
 * to a downloadable JSON file.
 */
const buildDataExport = async (userId) => {
  const [profile, organisations, legalAcceptances, consentState, consentHistory, sessions] =
    await Promise.all([
      getProfile(userId),
      getOrganisationMemberships(userId),
      getLegalAcceptances(userId),
      consentService.getConsentState(userId),
      consentService.getConsentHistory(userId),
      getActiveSessions(userId),
    ]);
  if (!profile) throw createError('User not found.', 404);
  return {
    export_metadata: {
      generated_at: new Date().toISOString(),
      subject_user_id: userId,
      platform: 'Acureal — Real Estate Deal Intelligence Platform',
      format_version: '1.0',
      scope:
        'Personal account datan Acureal holds about you, under the Digital Personal ' +
        'Data Protection Act, 2023 (§11 — right to access). Deal, document and ' +
        'workspace content belongs to your organisation and is available inside ' +
        'the app; it is not duplicated into this personal-data export.',
    },
    profile,
    organisation_memberships: organisations,
    legal_acceptances: legalAcceptances,
    consents: {
      current: consentState.state,
      available: consentState.available,
      history: consentHistory.map(mapConsentHistoryRow),
    },
    active_sessions: sessions,
  };
};

/**
 * Identity check gating the data export. A hijacked session must not be able
 * to one-click exfiltrate the whole personal-data file, so password accounts
 * must re-enter their password. OAuth-only accounts have no user-chosen
 * password — there the authenticated session is itself the proof of
 * possession (the same posture set-first-password takes).
 */
const verifyExportIdentity = async (userId, password) => {
  const result = await query(
    'SELECT password_hash, password_set FROM public.users WHERE id = $1 LIMIT 1',
    [userId]
  );
  const row = result.rows[0];
  if (!row) throw createError('User not found.', 404);

  if (row.password_set === false) {
    return { verified: true, method: 'session' };
  }
  if (!password || typeof password !== 'string') {
    throw createError('Enter your account password to confirm the export.', 400);
  }
  const ok = await bcrypt.compare(password, row.password_hash || '');
  if (!ok) {
    throw createError('Incorrect password.', 401);
  }
  return { verified: true, method: 'password' };
};

module.exports = {
  getPrivacyOverview,
  buildDataExport,
  verifyExportIdentity,
  // Exported for unit tests.
  summarizeUserAgent,
};
