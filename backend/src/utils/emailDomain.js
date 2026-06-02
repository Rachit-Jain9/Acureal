'use strict';

// Deterministic email-domain helpers for domain-based onboarding. Pure, no I/O,
// no AI — rule-engine logic, so it lives in utils and is unit-tested directly.
//
// PUBLIC_EMAIL_PROVIDERS is the single source of truth for "consumer mailbox,
// never a corporate identity": a signup from one of these can neither auto-join
// an organization nor be claimed as an org domain. India-first entries
// (yahoo.co.in, rediffmail.com, zohomail.in) are included deliberately.

const PUBLIC_EMAIL_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com', 'rocketmail.com',
  'rediffmail.com', 'rediff.com',
  'proton.me', 'protonmail.com', 'pm.me',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'gmx.com', 'gmx.net',
  'zoho.com', 'zohomail.com', 'zohomail.in',
  'mail.com', 'hey.com', 'fastmail.com', 'fastmail.fm',
  'yandex.com', 'tutanota.com', 'hushmail.com',
]);

// Extract the registrable domain from an email or a raw domain string:
// lower-cased, trimmed, '@' and any trailing FQDN dot stripped. Returns null
// when there is nothing usable (no '@', no dot) so callers can cleanly branch
// on "no corporate domain → personal workspace".
const normalizeEmailDomain = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  const afterAt = raw.includes('@') ? raw.slice(raw.lastIndexOf('@') + 1) : raw;
  const domain = afterAt.replace(/^@+/, '').replace(/\.+$/, '').trim();
  if (!domain || !domain.includes('.')) return null;
  return domain;
};

const isPublicEmailDomain = (value) => {
  const normalized = normalizeEmailDomain(value);
  return normalized ? PUBLIC_EMAIL_PROVIDERS.has(normalized) : false;
};

module.exports = {
  PUBLIC_EMAIL_PROVIDERS,
  normalizeEmailDomain,
  isPublicEmailDomain,
};
