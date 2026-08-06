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

// ── Address canonicalisation for LOOKUPS ────────────────────────────────────
//
// This repo stores gmail addresses in TWO shapes, and it is not a bug we can
// simply normalise away after the fact:
//
//   • /register and /login apply express-validator's normalizeEmail(), whose
//     gmail defaults strip dots, drop +tags, and fold googlemail.com → gmail.com.
//     So password signups are stored DOT-STRIPPED.
//   • The Google sign-in path stores claims.email.toLowerCase() verbatim
//     (auth.service.js), dots INTACT. So Google signups are stored DOTTED.
//
// Both conventions are live in production data. Any pre-identity lookup that
// picks one shape silently fails to find accounts stored in the other — the
// failure mode that made password reset dead for every dotted-gmail Google
// account (found in the 2026-08-06 adversarial review: the request leg logged
// "unknown email" and the enumeration-resistant generic 200 hid it completely).
//
// canonicalEmail() reproduces normalizeEmail's gmail behaviour explicitly
// rather than importing `validator` — that package is only a TRANSITIVE dep of
// express-validator, and a security-relevant identity function should not
// inherit a third party's defaults or its hoisting.
const GOOGLE_MAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

const canonicalEmail = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  if (at <= 0) return raw;
  let local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  if (!GOOGLE_MAIL_DOMAINS.has(domain)) return raw;
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  local = local.replace(/\./g, '');
  if (!local) return raw; // "....@gmail.com" — degenerate; don't invent an address
  return `${local}@gmail.com`;
};

// Every stored shape a typed address might match, most-literal first. Callers
// try them in order and take the first hit. Deduped, so non-gmail addresses
// (the overwhelming majority, and every corporate domain) cost exactly one
// lookup — the dual query is gmail-only.
const emailLookupCandidates = (value) => {
  const literal = String(value || '').trim().toLowerCase();
  const canonical = canonicalEmail(literal);
  return canonical && canonical !== literal ? [literal, canonical] : [literal];
};

module.exports = {
  PUBLIC_EMAIL_PROVIDERS,
  normalizeEmailDomain,
  isPublicEmailDomain,
  canonicalEmail,
  emailLookupCandidates,
};
