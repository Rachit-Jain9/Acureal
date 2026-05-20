# Record of Processing Activities (RoPA)

**Status date:** 2026-05-20
**Owner:** REDIP engineering / Privacy Contact
**Review cadence:** annual, plus an out-of-band review on any new sub-processor or new category of personal data
**Maintained in:** version control — see the git history of this file for revision dates

## Purpose of this document

This is REDIP's internal Record of Processing Activities. It maps every way the
platform handles personal data: the purpose, the lawful basis, the categories of
data and of data principals, who receives the data, whether it crosses a border,
how long it is kept, and the safeguards applied.

The Digital Personal Data Protection Act, 2023 (DPDP) does not mandate a RoPA in
the explicit form the GDPR does, but maintaining one is how a Data Fiduciary
demonstrates the accountability DPDP §8 requires, and it is a standard request
in any institutional security or privacy diligence questionnaire. This document
is the single source of truth that the customer-facing Security & Privacy
Overview (`docs/SECURITY.md`) and the Privacy Policy summarise.

It is an internal document. It is not a contract and does not replace the Terms
of Service, Privacy Policy, or a negotiated Data Processing Agreement.

## Controller / processor split (DPDP roles)

REDIP operates in two distinct roles, and the distinction governs every entry
below:

- **REDIP as Data Fiduciary** (controller). For *account and identity data* — the
  name, email, phone, credentials, and session/security records of the people
  who hold REDIP logins — REDIP determines the purpose and means of processing
  and is the Data Fiduciary.
- **REDIP as Data Processor.** For *customer-uploaded deal content* — deal
  records, uploaded documents, and anything inside them — the customer
  organisation decides what to upload and why. The customer organisation is the
  Data Fiduciary; REDIP processes that content on the customer's behalf and on
  the customer's instructions. Personal data of third parties named in uploaded
  documents (promoters, sellers, landowners, their representatives) falls in this
  category: the customer is accountable for the lawful basis of collecting it;
  REDIP's obligation is to process it securely and only as instructed.

A negotiated Data Processing Agreement formalises the processor-role obligations;
publishing one is tracked in `docs/SECURITY.md` §16.

## How to read each entry

Each processing activity below records:

- **Purpose** — why the data is processed.
- **REDIP role** — Fiduciary or Processor.
- **Lawful basis** — under DPDP §4 (consent, or a "legitimate use" such as
  performance of a contract / compliance with law).
- **Data principals** — whose data it is.
- **Categories of personal data** — what is held.
- **Storage** — the table(s) / system, and where they physically run.
- **Recipients / sub-processors** — who else the data reaches.
- **Cross-border transfer** — whether data leaves India.
- **Retention** — how long, and the basis.
- **Safeguards** — the principal technical controls.

---

## 1. Account management & authentication

- **Purpose:** create and operate user accounts; authenticate sign-in; protect
  accounts against unauthorised access.
- **REDIP role:** Data Fiduciary.
- **Lawful basis:** legitimate use — necessary to perform the service contract
  with the user; account-security processing is necessary for compliance with the
  reasonable-security-practices obligation under IT Act §43A.
- **Data principals:** registered users (staff of REDIP customer organisations).
- **Categories of personal data:** name; email address; phone number (optional);
  bcrypt password hash; TOTP multi-factor secret and one-time recovery codes;
  Google OAuth identity claims (subject id, email, name) where federated sign-in
  is used; email-verification and invitation tokens; IP address and user agent of
  sign-in attempts; account lifecycle timestamps.
- **Storage:** `users`, `refresh_token_grants`, `login_attempts`,
  `mfa_challenges`, and related auth tables — Supabase PostgreSQL, Mumbai
  (`ap-south-1`), India.
- **Recipients / sub-processors:** Supabase (database); Google (verification of
  OAuth ID-token signature, where federated sign-in is used); Resend
  (verification and invitation email); "Have I Been Pwned" receives only a
  5-character SHA-1 prefix of a candidate password during the k-anonymity
  breach check — never the password and never any identifier.
- **Cross-border transfer:** OAuth verification and the password-breach check
  involve US/global providers; only the minimal values described above leave
  India. Account records themselves are stored in India.
- **Retention:** for the account lifetime. On account closure, personal fields
  are pseudonymised 90 days later (see activity 8). `login_attempts` rows are
  purged 30 days after the last failure when no lock is active;
  `refresh_token_grants` 90 days past expiry; `mfa_challenges` once expired.
- **Safeguards:** bcrypt password hashing (cost factor 12); refresh tokens stored
  only as SHA-256 hashes, path-scoped, rotated on every use with reuse detection;
  httpOnly + Secure + SameSite cookies; per-account lockout and IP rate limiting;
  default-deny account creation (invitation required unless open sign-up is
  explicitly enabled); Row-Level Security.

## 2. Deal workspace & document management

- **Purpose:** deliver the core product — let customers create deals, upload deal
  documents, and run due-diligence, approvals, risk, and underwriting workflows.
- **REDIP role:** Data Processor (the customer organisation is the Data
  Fiduciary for the content it uploads).
- **Lawful basis:** processed on the customer's instruction under the service
  contract; the customer organisation is responsible for the lawful basis of the
  underlying personal data it chooses to upload.
- **Data principals:** customer-organisation users; and third parties named
  inside uploaded documents — promoters/builders, sellers, landowners, and their
  representatives.
- **Categories of personal data:** whatever the customer enters or uploads. This
  can include names, addresses, contact details, ownership and promoter details,
  and government identity numbers (e.g. PAN, Aadhaar) where they appear in sale
  deeds, agreements, encumbrance certificates, or RERA filings.
- **Storage:** deal/workspace tables in Supabase PostgreSQL (Mumbai, India);
  uploaded files in private Supabase Storage or Vercel Blob buckets.
- **Recipients / sub-processors:** Supabase (database + storage); Vercel (hosting
  / compute); AI providers for the extraction and synthesis activity (see
  activity 4).
- **Cross-border transfer:** deal data and documents are stored in India.
  Document *content* is transmitted to AI providers only as described in
  activity 4.
- **Retention:** for the account lifetime; deleted within 30 days of a customer
  deletion request. User-authored deal content is not purged by the automated
  retention sweep — it lives by deal lifecycle and customer control.
- **Safeguards:** private storage buckets, never publicly addressable; downloads
  only via short-lived signed URLs; upload file-type allow-list and size limit;
  all document processing server-side; Row-Level Security scoping every read and
  write to the caller's organisation; access to sensitive documents is logged.

## 3. Financial computation & deal audit trail

- **Purpose:** compute deal financials deterministically and keep an immutable,
  investor-grade audit trail of every material change to a deal.
- **REDIP role:** Data Processor (on behalf of the customer organisation).
- **Lawful basis:** performance of the service contract; supports the customer's
  own compliance and evidentiary needs (IT Act §65B norms for electronic
  records).
- **Data principals:** customer-organisation users (as actors recorded against
  each change).
- **Categories of personal data:** the acting user's identifier and timestamp
  attached to each financial computation and lifecycle change; the financial
  inputs/outputs themselves are deal data, not personal data.
- **Storage:** `deal_events` (HMAC-signed financial computations) and
  `deal_audit_log` (lifecycle mutations) — Supabase PostgreSQL, India.
- **Recipients / sub-processors:** Supabase only.
- **Cross-border transfer:** none.
- **Retention:** 7 years — investor-audit need and IT Act §65B evidentiary
  retention norms.
- **Safeguards:** HMAC-signed input/output hashes make later tampering
  detectable; append-only — the tables carry no UPDATE or DELETE RLS policy.

## 4. AI-assisted document extraction & synthesis

- **Purpose:** extract structured fields from uploaded documents (OCR-style
  extraction, classification, translation) and synthesise interpretive prose
  (summaries, risk narratives, IC-style memos). AI never performs financial
  mathematics — that is always deterministic code.
- **REDIP role:** Data Processor.
- **Lawful basis:** performance of the service contract for core extraction;
  optional AI features beyond core extraction are additionally gated by the
  `ai_processing` purpose in the consent ledger (activity 5).
- **Data principals:** customer-organisation users; third parties named in the
  documents being processed.
- **Categories of personal data:** the specific document text or content required
  for a given feature, plus the prompt constructed around it.
- **Storage:** AI request/response metadata (provider, model, latency, cost,
  cache key) in `ai_call_logs` and `ai_response_cache` — Supabase, India.
  Document content is transmitted to the provider for the single request and is
  not stored by REDIP outside the customer's own workspace.
- **Recipients / sub-processors:** Google (Gemini — extraction, OCR,
  translation); Anthropic (Claude — synthesis, reasoning); OpenAI (reasoning,
  embeddings). All are accessed over paid API endpoints whose terms state that
  API inputs/outputs are not used to train provider models by default.
- **Cross-border transfer:** **yes** — document content is transmitted to
  US-based providers (and Google's global infrastructure) for processing.
  DPDP §16 permits such transfers except to countries the Central Government may
  restrict. Enterprise customers requiring India-only AI processing should raise
  this at contracting; this is stated in `docs/SECURITY.md` §3.
- **Retention:** `ai_call_logs` 12 months (cost reconciliation and routing
  audit); `ai_response_cache` entries expire on a 90-day TTL; provider-side
  retention is governed by each provider's API terms.
- **Safeguards:** deterministic redaction of recognisable government identity and
  secret patterns (e.g. Aadhaar, PAN, bank-account numbers) before any provider
  call; a prompt-injection guard so instructions embedded in an uploaded document
  cannot reach the model as commands; AI output validated structurally before
  use; a configurable daily AI cost cap; TLS in transit; AI outputs that
  influence decisions carry source references and require human review.

## 5. Legal acceptance & consent records

- **Purpose:** record that each user accepted the current Terms of Service and
  Privacy Policy, and capture granular, per-purpose consent decisions.
- **REDIP role:** Data Fiduciary.
- **Lawful basis:** compliance with a legal obligation — DPDP §6 requires
  consent to be recorded against a specific notice version; the Indian Contract
  Act makes a clear assent record necessary for enforceability.
- **Data principals:** registered users.
- **Categories of personal data:** user identifier; the legal-document version
  accepted; consent purpose and grant/withdraw decision; acceptance/decision
  timestamp; IP address and user agent at the time of the decision.
- **Storage:** `legal_documents`, `user_legal_acceptances`, and `user_consents` —
  Supabase PostgreSQL, India.
- **Recipients / sub-processors:** Supabase only.
- **Cross-border transfer:** none.
- **Retention:** for the account lifetime plus 7 years post-closure — needed to
  evidence enforceable acceptance and to honour a later dispute or audit.
- **Safeguards:** append-only ledgers — a consent withdrawal is a new row, never
  an update; Row-Level Security restricts each user to their own rows; writes go
  only through the backend service role.

## 6. Security monitoring & incident management

- **Purpose:** detect, record, and respond to security-relevant events; meet the
  reasonable-security-practices and incident-reporting obligations.
- **REDIP role:** Data Fiduciary.
- **Lawful basis:** legitimate use and compliance with a legal obligation —
  CERT-In incident-reporting Directions and IT Act §43A.
- **Data principals:** registered users; any individual implicated in a security
  event.
- **Categories of personal data:** event detail; affected user/organisation
  identifiers; IP addresses; server access and application logs.
- **Storage:** `security_events` (the incident register), `login_attempts`, and
  server/application logs. Database tables run in India. Server logs are
  currently emitted to the hosting platform; routing security/access logs to an
  India-resident store for the CERT-In 180-day requirement is tracked in
  `docs/SECURITY.md` §16.
- **Recipients / sub-processors:** Supabase; Vercel (platform logs).
- **Cross-border transfer:** platform log processing may occur outside India
  pending the India-resident log-sink work referenced above.
- **Retention:** security/access logs targeted at 180 days (CERT-In Direction
  §II(v)); `security_events` incident records 7 years (incident audit);
  `login_attempts` 30 days.
- **Safeguards:** `security_events` is append-only with RLS read-scoping; it
  carries the CERT-In 6-hour and DPDP notification clocks; the breach-notification
  runbook governs response.

## 7. Transactional email

- **Purpose:** send account email — verification, password, and workspace
  invitations.
- **REDIP role:** Data Fiduciary.
- **Lawful basis:** legitimate use — necessary to deliver the service the user
  requested.
- **Data principals:** registered users and invited prospective users.
- **Categories of personal data:** recipient email address; message content
  (verification links, invitation details).
- **Storage:** message dispatch is handled by the email provider; REDIP stores
  the underlying account/invitation records in Supabase, India.
- **Recipients / sub-processors:** Resend (email delivery).
- **Cross-border transfer:** email dispatch is handled by a non-India provider.
- **Retention:** dispatch records per the provider's retention; REDIP-side
  invitation tokens expire and are cleaned up with account housekeeping.
- **Safeguards:** TLS in transit; tokens are single-purpose and time-limited.
- **Note:** REDIP sends no marketing email today. If marketing email is
  introduced, it will be gated on the `marketing` purpose in the consent ledger
  (activity 5).

## 8. Account closure & scheduled erasure

- **Purpose:** honour account closure and the DPDP erasure principle.
- **REDIP role:** Data Fiduciary.
- **Lawful basis:** compliance with a legal obligation — DPDP §8(7) requires
  erasure once the purpose is fulfilled and no statutory retention applies.
- **Data principals:** users who have closed their account.
- **Categories of personal data:** the account-identity fields listed in
  activity 1.
- **Storage / process:** on closure, `users.account_closed_at` is set and all
  refresh tokens are revoked; a closed account can no longer authenticate. 90
  days later the daily retention sweep pseudonymises the personal fields (email,
  name, phone are replaced with non-identifying placeholders; the password hash
  is nulled). The row itself is preserved, not deleted, so foreign keys from
  deals, audit logs, and AI logs continue to resolve — the standard
  pseudonymisation pattern.
- **Recipients / sub-processors:** Supabase only.
- **Cross-border transfer:** none.
- **Retention:** 90-day grace window post-closure, then pseudonymisation; the
  pseudonymised row persists for referential integrity.
- **Safeguards:** the grace window is fixed at first closure; erasure runs as an
  idempotent daily job; see the Data Retention Policy for the full retention map.

## 9. Cost & usage accounting

- **Purpose:** track AI spend and feature usage for cost control and billing
  accuracy.
- **REDIP role:** Data Fiduciary.
- **Lawful basis:** legitimate use — operating the service sustainably — and,
  where it informs billing, performance of the contract.
- **Data principals:** customer-organisation users.
- **Categories of personal data:** acting user/organisation identifier attached
  to per-call cost, model, and latency metrics; feature-usage counters.
- **Storage:** `ai_call_logs`, `ai_augment_usage_quota` — Supabase, India.
- **Recipients / sub-processors:** Supabase only.
- **Cross-border transfer:** none.
- **Retention:** 12 months (`ai_call_logs`).
- **Safeguards:** Row-Level Security; no payment-card data is processed by
  REDIP.

## 10. Geocoding & map display

- **Purpose:** resolve property addresses to coordinates and render maps.
- **REDIP role:** Data Processor (operating on deal/property data).
- **Lawful basis:** performance of the service contract.
- **Data principals:** not directed at individuals — the inputs are property
  addresses and coordinates, not personal data. Listed here for completeness of
  the data-flow map.
- **Categories of data:** property addresses; geographic coordinates.
- **Recipients / sub-processors:** Google (Maps / geocoding); OpenStreetMap and
  ArcGIS map-tile servers; Open-Meteo (weather). Tile and weather providers
  receive coordinates only.
- **Cross-border transfer:** geocoding and tile requests are served by non-India
  providers; no personal or deal-party data is included.
- **Retention:** none held by REDIP beyond the resolved coordinates stored
  against the property record.
- **Safeguards:** only addresses/coordinates are sent — never names, ownership
  details, or document content.

---

## Sub-processor summary

The sub-processors referenced above are listed, with the data each handles, in
`docs/SECURITY.md` §15. That table is the customer-facing summary; this RoPA is
the internal detail. Any change to the sub-processor set triggers an out-of-band
review of both documents.

## Review log

| Date | Reviewer | Change |
|---|---|---|
| 2026-05-20 | REDIP engineering | Initial RoPA authored and verified against the codebase. |

---

*Internal document. Reviewed at least annually and on any material change to
processing. Revision history is the git history of this file.*
