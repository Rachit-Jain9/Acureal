'use strict';

// Resolves the "platform org" — the workspace whose verified data is exposed
// platform-wide, read-only: the shared comps catalog plus every Market
// Intelligence benchmark reader and the AI brief assembly. Writes stay
// strictly per-org.
//
// Resolution order:
//   1. PLATFORM_ORG_ID env pin (a UUID) — explicit, zero DB dependency.
//      The workspace that owns platform-curated data is configuration, not
//      something to infer from whoever happens to be on the admin allowlist.
//   2. Legacy fallback: the earliest-created user on the PLATFORM_ADMIN_EMAILS
//      allowlist → their default_organization_id.
//
// Failure semantics (hardened 2026-07-23 — this module used to cache a
// silent null for the whole process lifetime on one bad cold-start query,
// making every platform comp/benchmark quietly vanish):
//   • a resolved org id caches for the process lifetime;
//   • a null — not-found OR query error — caches only for RETRY_TTL_MS,
//     then the next call re-attempts;
//   • query errors are logged and reported to Sentry with a stable
//     fingerprint (the request itself still succeeds — degraded, own-org-only
//     — so without explicit capture nothing would ever surface).
// getPlatformOrgId NEVER throws into a request path: null → own-org-only.

const { query } = require('../config/database');
const log = require('../lib/logger').child({ module: 'platform.org' });
const { Sentry, isEnabled } = require('../lib/sentry');

const DEFAULT_PLATFORM_EMAIL = 'rachitj579@gmail.com';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// How long a null resolution (absent or errored) is trusted before retrying.
const RETRY_TTL_MS = 60_000;

const UNSET = Symbol('platform-org-unset');
let cached = UNSET;
let cachedAt = 0;
let inFlight = null;
let invalidPinWarned = false;

const getPlatformAdminEmails = () => {
  const raw = process.env.PLATFORM_ADMIN_EMAILS || DEFAULT_PLATFORM_EMAIL;
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
};

// Env pin, validated. An invalid pin is a loud misconfiguration (once per
// process) that falls through to the legacy lookup rather than hard-failing.
const getPinnedPlatformOrgId = () => {
  const raw = process.env.PLATFORM_ORG_ID;
  if (!raw || !String(raw).trim()) return null;
  const candidate = String(raw).trim().toLowerCase();
  if (UUID_RE.test(candidate)) return candidate;
  if (!invalidPinWarned) {
    invalidPinWarned = true;
    log.error('platform_org_id_invalid', { value_length: candidate.length });
    if (isEnabled()) {
      Sentry.captureMessage('[platform-org] PLATFORM_ORG_ID is set but not a UUID — falling back to the email lookup', {
        level: 'error',
        tags: { subsystem: 'platform_org' },
        fingerprint: ['platform-org', 'invalid-env-pin'],
      });
    }
  }
  return null;
};

const getPlatformOrgId = async () => {
  const pinned = getPinnedPlatformOrgId();
  if (pinned) return pinned;

  if (cached !== UNSET) {
    // Non-null resolutions are stable for the process lifetime; null is
    // re-attempted after the TTL so a transient DB error can't hide platform
    // data for the whole warm instance.
    if (cached !== null || Date.now() - cachedAt < RETRY_TTL_MS) return cached;
    cached = UNSET;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const emails = getPlatformAdminEmails();
    if (emails.length === 0) {
      cached = null;
      cachedAt = Date.now();
      return null;
    }
    try {
      const result = await query(
        `SELECT default_organization_id
           FROM users
          WHERE LOWER(email) = ANY($1::text[])
            AND default_organization_id IS NOT NULL
          ORDER BY created_at ASC
          LIMIT 1`,
        [emails],
      );
      cached = result.rows[0]?.default_organization_id || null;
      if (cached === null) {
        // Degraded but expected on a fresh install — warn, no Sentry.
        log.warn('platform_org_admin_not_found', { emails_count: emails.length });
      }
    } catch (err) {
      // Fail closed to own-org-only, but LOUDLY: the request still 200s, so
      // nothing else will ever report this. Fingerprint collapses the
      // 60s-retry repeats into one Sentry issue.
      cached = null;
      log.error('platform_org_lookup_failed', err);
      if (isEnabled()) {
        Sentry.captureException(err, {
          tags: { subsystem: 'platform_org' },
          fingerprint: ['platform-org', 'lookup-failed'],
        });
      }
    }
    cachedAt = Date.now();
    return cached;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
};

const __resetPlatformOrgCache = () => {
  cached = UNSET;
  cachedAt = 0;
  inFlight = null;
  invalidPinWarned = false;
};

module.exports = {
  getPlatformOrgId,
  getPlatformAdminEmails,
  __resetPlatformOrgCache,
};
