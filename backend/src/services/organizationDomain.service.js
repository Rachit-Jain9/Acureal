'use strict';

// Organization domain claims for domain-based onboarding. An admin claims their
// corporate domain (starts unverified/inert), proves control by publishing a DNS
// TXT record, and verifies it here. Only verified domains are ever matched for
// auto-join (the match itself lives in organization.service.joinByVerifiedDomain,
// which runs during signup). Per CLAUDE.md, verification is a real DNS lookup —
// never faked — so an unproven claim grants nothing.

const dns = require('dns').promises;
const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { normalizeEmailDomain, isPublicEmailDomain } = require('../utils/emailDomain');
const { normalizeRole } = require('../constants/roles');
const organizationAuditLog = require('./organizationAuditLog.service');
const log = require('../lib/logger').child({ module: 'organizationDomain.service' });

const DNS_HOST_PREFIX = '_redip-verify';
const dnsHost = (domain) => `${DNS_HOST_PREFIX}.${domain}`;
const dnsRecordValue = (token) => `redip-verify=${token}`;

const buildDnsInstructions = (domain, token) => ({
  host: dnsHost(domain),
  type: 'TXT',
  value: dnsRecordValue(token),
});

// Public shape: never leak the raw token once verified; while unverified, hand
// back the exact DNS record the admin must publish so the UI can render it.
const shapeDomain = (row) => ({
  id: row.id,
  domain: row.domain,
  verified: row.verified,
  default_role: row.default_role,
  require_admin_approval: row.require_admin_approval,
  verification_method: row.verification_method,
  verified_at: row.verified_at,
  created_at: row.created_at,
  verification: row.verified ? null : buildDnsInstructions(row.domain, row.verification_token),
});

const RETURNING = `RETURNING id, domain, verified, default_role, require_admin_approval,
                   verification_method, verification_token, verified_at, created_at`;

const listDomains = async (organizationId) => {
  const result = await query(
    `SELECT id, domain, verified, default_role, require_admin_approval,
            verification_method, verification_token, verified_at, created_at
       FROM organization_domains
      WHERE organization_id = $1
      ORDER BY created_at DESC`,
    [organizationId],
  );
  return result.rows.map(shapeDomain);
};

const addDomainClaim = async ({ organizationId, domain, actor }) => {
  const normalized = normalizeEmailDomain(domain);
  if (!normalized) {
    throw createError('Enter a valid domain, e.g. acme.in.', 400);
  }
  if (isPublicEmailDomain(normalized)) {
    throw createError(
      'Public email providers (gmail.com, outlook.com, etc.) cannot be claimed as an organization domain.',
      422,
    );
  }

  // Block claiming a domain another workspace has already PROVEN control of
  // (verified = TRUE). An unverified claim by someone else is harmless — only
  // one org can ever pass the DNS-TXT proof — so it must NOT block the real
  // owner. (Runs the same under the old global unique or the new
  // verified-only unique, so it is safe to deploy before the migration.)
  const verifiedElsewhere = await query(
    `SELECT 1 FROM organization_domains
      WHERE lower(domain) = lower($1) AND verified = TRUE AND organization_id <> $2
      LIMIT 1`,
    [normalized, organizationId],
  );
  if (verifiedElsewhere.rows.length > 0) {
    throw createError('That domain is already verified by another workspace.', 409);
  }

  let result;
  try {
    result = await query(
      `INSERT INTO organization_domains (organization_id, domain, claimed_by)
       VALUES ($1, $2, $3)
       ${RETURNING}`,
      [organizationId, normalized, actor.id],
    );
  } catch (error) {
    // UNIQUE(lower(domain)) → claimed already (this org or another). Specific
    // 409 message; errorHandler would otherwise map 23505 generically.
    if (error && error.code === '23505') {
      throw createError('That domain has already been claimed.', 409);
    }
    throw error;
  }

  const row = result.rows[0];
  await organizationAuditLog.recordAudit({
    organizationId,
    actorId: actor.id,
    eventType: 'domain_claim_added',
    after: { domain: row.domain },
  });
  return shapeDomain(row);
};

const removeDomainClaim = async ({ organizationId, domainId, actor }) => {
  const result = await query(
    `DELETE FROM organization_domains
      WHERE organization_id = $1 AND id = $2
      RETURNING id, domain`,
    [organizationId, domainId],
  );
  if (result.rows.length === 0) {
    throw createError('Domain claim not found.', 404);
  }
  await organizationAuditLog.recordAudit({
    organizationId,
    actorId: actor.id,
    eventType: 'domain_claim_removed',
    before: { domain: result.rows[0].domain },
  });
  return { removed: true, domain: result.rows[0].domain };
};

// Deterministic DNS-TXT proof of control. Flips verified = TRUE iff a TXT record
// at _redip-verify.<domain> carries this claim's token. A missing/mismatched
// record is an expected "not yet" state (422 with guidance), not a 500.
const verifyDomain = async ({ organizationId, domainId, actor }) => {
  const claim = await query(
    `SELECT id, domain, verified, verification_token, default_role,
            require_admin_approval, verification_method, verified_at, created_at
       FROM organization_domains
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, domainId],
  );
  if (claim.rows.length === 0) {
    throw createError('Domain claim not found.', 404);
  }
  const row = claim.rows[0];
  if (row.verified) {
    return shapeDomain(row);
  }

  const expected = dnsRecordValue(row.verification_token);
  let records;
  try {
    records = await dns.resolveTxt(dnsHost(row.domain));
  } catch (error) {
    log.info('domain_verify_dns_miss', { domain: row.domain, code: error && error.code });
    throw createError(
      'No matching DNS TXT record found yet. Add the record shown, then try again — DNS can take a few minutes to propagate.',
      422,
    );
  }

  const flattened = (records || []).map((parts) => parts.join('').trim());
  if (!flattened.includes(expected)) {
    throw createError(
      'A TXT record exists but its value does not match. Double-check the value and try again.',
      422,
    );
  }

  let updated;
  try {
    updated = await query(
      `UPDATE organization_domains
          SET verified = TRUE, verified_at = NOW(), updated_at = NOW()
        WHERE organization_id = $1 AND id = $2
        ${RETURNING}`,
      [organizationId, domainId],
    );
  } catch (error) {
    // The verified-only unique index (lower(domain) WHERE verified = TRUE)
    // race-guards a simultaneous verify of the same domain by another
    // workspace — whoever proves control first wins; the loser gets a clear 409.
    if (error && error.code === '23505') {
      throw createError('Another workspace has already verified this domain.', 409);
    }
    throw error;
  }
  await organizationAuditLog.recordAudit({
    organizationId,
    actorId: actor.id,
    eventType: 'domain_verified',
    after: { domain: row.domain },
  });
  return shapeDomain(updated.rows[0]);
};

// Admin-tunable join policy for a verified domain: which role auto-joiners get
// (never owner) and whether an admin must approve each join.
const setDomainPolicy = async ({ organizationId, domainId, defaultRole, requireAdminApproval, actor }) => {
  const updates = [];
  const values = [organizationId, domainId];
  let i = 3;

  if (defaultRole !== undefined) {
    const role = normalizeRole(defaultRole);
    if (!role || role === 'owner') {
      throw createError('default_role must be admin, editor, or viewer.', 400);
    }
    updates.push(`default_role = $${i}::organization_role`);
    values.push(role);
    i += 1;
  }
  if (requireAdminApproval !== undefined) {
    updates.push(`require_admin_approval = $${i}`);
    values.push(requireAdminApproval === true);
    i += 1;
  }
  if (updates.length === 0) {
    throw createError('No policy fields to update.', 400);
  }
  updates.push('updated_at = NOW()');

  const result = await query(
    `UPDATE organization_domains SET ${updates.join(', ')}
      WHERE organization_id = $1 AND id = $2
      ${RETURNING}`,
    values,
  );
  if (result.rows.length === 0) {
    throw createError('Domain claim not found.', 404);
  }
  const row = result.rows[0];
  await organizationAuditLog.recordAudit({
    organizationId,
    actorId: actor.id,
    eventType: 'domain_policy_changed',
    after: {
      domain: row.domain,
      default_role: row.default_role,
      require_admin_approval: row.require_admin_approval,
    },
  });
  return shapeDomain(row);
};

module.exports = {
  listDomains,
  addDomainClaim,
  removeDomainClaim,
  verifyDomain,
  setDomainPolicy,
  buildDnsInstructions,
};
