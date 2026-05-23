'use strict';

// Resolves the "platform org" — the workspace whose verified data is
// exposed platform-wide. Today's only consumer is the shared comps
// catalog: every workspace can READ the platform admin's verified comps
// alongside their own org's. Writes stay strictly per-org.
//
// Source of truth for who the platform admin is: PLATFORM_ADMIN_EMAILS
// env var (comma-separated), falling back to the founding admin email.
// We pick the earliest-created user from that allowlist and treat their
// default_organization_id as the platform org. Result is cached for the
// process lifetime; lookup failures resolve to null (own-org-only).

const { query } = require('../config/database');

const DEFAULT_PLATFORM_EMAIL = 'rachitj579@gmail.com';

const UNSET = Symbol('platform-org-unset');
let cached = UNSET;
let inFlight = null;

const getPlatformAdminEmails = () => {
  const raw = process.env.PLATFORM_ADMIN_EMAILS || DEFAULT_PLATFORM_EMAIL;
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
};

const getPlatformOrgId = async () => {
  if (cached !== UNSET) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const emails = getPlatformAdminEmails();
    if (emails.length === 0) {
      cached = null;
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
    } catch (_) {
      // Resolve to null on lookup failure — callers fall back to
      // own-org-only visibility instead of erroring out the request.
      cached = null;
    }
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
  inFlight = null;
};

module.exports = {
  getPlatformOrgId,
  getPlatformAdminEmails,
  __resetPlatformOrgCache,
};
