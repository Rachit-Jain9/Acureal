# REDIP — Security & Privacy Overview

**Status date:** 2026-05-20
**Audience:** prospective customers, institutional investors, and their security / privacy reviewers
**Owner:** REDIP engineering

## How to use this document

This is a plain, factual description of how REDIP protects customer data. It is
written to answer the questions a security or privacy diligence questionnaire
(SIG-Lite / CAIQ style) asks, without requiring a separate call. Every control
described below is implemented in the codebase today unless it appears in
section 16, *Known gaps and remediation roadmap*, which is deliberately honest
about what is not yet done.

It is not a legal contract and does not replace the Terms of Service, Privacy
Policy, or a negotiated Data Processing Agreement.

---

## 1. What REDIP is

REDIP is a real-estate deal-intelligence, due-diligence, underwriting, and
investor-reporting platform focused on Bengaluru and India. Customers create
private workspaces, upload deal documents, run financial models, and generate
reports. The platform is a decision-support tool — it is not a broker, valuer,
title certifier, RERA authority, or investment adviser.

## 2. Architecture

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React (Vite build), served as static assets | No customer data stored in the browser beyond a cached profile |
| Backend | Node.js / Express, running as Vercel serverless functions | Stateless request handlers; no long-lived workers |
| Database | Supabase (managed PostgreSQL) | Row-Level Security enforced on tenant tables |
| Object storage | Supabase Storage or Vercel Blob (private buckets) | Documents served only via short-lived signed URLs |
| Hosting / CDN | Vercel | TLS terminated at the edge; security headers applied platform-wide |

The deterministic financial engine is a separately versioned TypeScript package.
All financial mathematics is computed in deterministic code — never by an AI
model.

## 3. Data residency

The primary database and document storage run in **Supabase's Mumbai region
(`ap-south-1`), India**. Customer deal data, uploaded documents, and account
records are stored in India.

AI processing is performed by US-based providers (OpenAI, Anthropic) and Google.
Only the specific text or document content required for a feature is transmitted,
over TLS, for that single request; see section 11. Sub-processors are listed in
section 15. Enterprise customers requiring India-only AI processing should raise
this during contracting.

## 4. Authentication

- **Sessions** are carried in **httpOnly, Secure, SameSite=Lax cookies**. The
  access token is a short-lived (15-minute) JWT; it is never readable by
  JavaScript, which removes it as an XSS theft target.
- **Refresh tokens** are long-lived (30 days), stored only as SHA-256 hashes,
  path-scoped so they are sent only to the refresh endpoint, and **rotated on
  every use**. Reuse of a rotated token is detected and revokes the entire token
  family (the OAuth 2.0 reuse-detection pattern).
- **Multi-factor authentication** (TOTP) is supported, with one-time recovery
  codes.
- **Federated sign-in** via Google (OpenID Connect) is supported; the ID token's
  signature, audience, issuer, and expiry are verified server-side.
- **Passwords** are hashed with bcrypt (cost factor 12). New passwords are
  checked against the Have I Been Pwned breach corpus using k-anonymity (only a
  5-character hash prefix leaves the server).
- **Brute-force protection**: a per-account throttle locks an account for 15
  minutes after 5 failed attempts in a 15-minute window, layered on top of an
  IP-level rate limit on all auth endpoints.
- **Account creation is default-deny**: new accounts require an invitation token
  unless an operator explicitly enables open sign-up.
- **Email verification** is issued on signup.

## 5. Authorization and access control

- Access is **role-based** (owner / admin / analyst / viewer-tier roles), checked
  by middleware on protected routes.
- Every deal belongs to an organization (workspace). Users only see data for
  organizations they are a member of.
- Deal sharing is explicit and per-user.

## 6. Tenant isolation

Multi-tenant separation is enforced **at the database layer** with PostgreSQL
Row-Level Security, not only in application code. Tenant-scoped tables carry an
`organization_id` and RLS policies restrict every read and write to the caller's
current organization. Audit tables additionally have no UPDATE or DELETE policy,
making them append-only even under the application's database role.

## 7. Data protection

- **In transit:** all traffic is over TLS (HTTPS enforced; HSTS is sent with a
  two-year max-age and preload).
- **At rest:** the database and object storage are encrypted at rest by the
  storage providers.
- **Secrets:** all API keys and signing secrets are server-side environment
  variables; none are exposed to the browser bundle. A boot-time check refuses
  to start the application in production if a critical secret is missing or
  left at a placeholder value (fail-closed).
- **Audit-trail integrity:** financial-computation audit records are HMAC-signed
  so any later tampering is detectable.

## 8. Document handling

- Uploaded documents go to **private** storage buckets and are never publicly
  addressable.
- Downloads are served only through **short-lived signed URLs**.
- Uploads are validated against a **file-type allow-list** and a maximum size
  limit before they are accepted.
- All document processing happens server-side.

## 9. Audit logging

REDIP keeps two complementary, append-only audit trails per deal:

- **Financial computations** — every model run is recorded with HMAC-signed
  input and output hashes, so a reported number can be cryptographically tied to
  the exact engine and inputs that produced it, and replayed.
- **Lifecycle changes** — stage transitions, archive/restore, reassignment, and
  material edits are recorded with actor, timestamp, and before/after state.

AI calls are separately logged (provider, model, latency, cost) for cost and
routing audit.

## 10. Data lifecycle and retention

- **Account closure** is self-service. On closure, all refresh tokens are
  revoked and the account can no longer authenticate.
- **Erasure**: 90 days after closure, personal fields are anonymized
  (pseudonymized) by a scheduled job, in line with the erasure principle of the
  Digital Personal Data Protection Act, 2023 (§8(7)).
- A **daily retention job** purges expired data — AI response cache, expired
  refresh-token grants, stale login-attempt records, and AI call logs past their
  retention window.
- Retention windows for each data category are documented in the internal Data
  Retention Policy.

## 11. AI governance

- **AI never performs financial mathematics.** All IRR, NPV, DSCR, waterfall,
  and unit calculations are produced by the deterministic engine. AI is
  restricted to interpretive prose (summaries, narratives, risk framing) around
  numbers it does not generate.
- AI features use **paid provider API endpoints**, whose terms state that API
  inputs and outputs are not used to train provider models by default. REDIP
  does not use consumer AI products for customer data.
- AI provider routing is configurable per task and recorded for audit.
- A configurable **daily cost cap** blocks AI spend beyond a set ceiling.
- AI outputs that influence decisions are presented with source references and
  require human review.

## 12. Application security

- **Security headers** (platform-wide): HSTS, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and a
  restrictive Content-Security-Policy.
- **CORS** is restricted to an explicit origin allow-list.
- **Rate limiting** is applied in tiers: strict on authentication endpoints,
  moderate on AI/export endpoints, and a general ceiling on all other API
  traffic.
- **Input validation** is applied on API request bodies.
- **Dependencies** are managed with lockfiles; the platform runs on Node 20+.

## 13. Incident response

REDIP maintains an internal breach-notification runbook covering detection,
containment, credential rotation, and notification. It reconciles two regulatory
clocks:

- **CERT-In** — reportable cyber incidents are to be reported within 6 hours of
  awareness.
- **DPDP** — affected individuals and the Data Protection Board are notified per
  the DPDP Rules timelines.

The runbook treats the 6-hour CERT-In window as the operational trigger.

## 14. Availability and recovery

- The application runs on Vercel's managed, auto-scaling serverless platform.
- The database is managed by Supabase with automated backups.

## 15. Sub-processors

| Sub-processor | Purpose | Data handled |
|---|---|---|
| Supabase | Managed PostgreSQL database and object storage (Mumbai, India) | All account, deal, and document data |
| Vercel | Application hosting, serverless compute, CDN | Request traffic; application logs |
| OpenAI | AI — reasoning, market synthesis, embeddings | Document text / prompts for the specific request |
| Anthropic | AI — narrative synthesis, extraction fallback | Document text / prompts for the specific request |
| Google | Gemini AI (document extraction); Google Identity Services (sign-in); Maps (geocoding) | Document content; OAuth identity claims; addresses/coordinates |
| Resend | Transactional email (verification, invitations) | Recipient email address and message content |

Map tile and weather providers receive geographic coordinates only; they do not
receive personal or deal data.

## 16. Known gaps and remediation roadmap

REDIP is on an active security and privacy hardening program. The following
items are tracked; status is current as of the date above:

| Item | Status |
|---|---|
| Automatic redaction of sensitive ID numbers before AI calls (defense-in-depth) | In place |
| Dedicated security-incident register | In place |
| Maintained Record of Processing Activities (RoPA) | In place |
| Granular, per-purpose consent (separate from bundled Terms/Privacy acceptance) | In progress — backend consent ledger built |
| Self-service "see / export my data" (DPDP access & portability) | Planned — erasure already self-service |
| Backup & disaster-recovery posture and recovery procedure | Documented — restore drill pending |
| India-resident security-log retention for the CERT-In 180-day requirement | In progress |
| Published Data Processing Agreement and public sub-processor page | Planned |
| Independent penetration test; SOC 2 / ISO 27001 readiness | Planned |
| Legal-counsel sign-off on public-facing policies before external launch | Planned |

## 17. Reporting a security issue

Please report suspected vulnerabilities to **security@redip.in**. We aim to
acknowledge reports promptly and ask that you give us a reasonable window to
remediate before any public disclosure.

---

*This document reflects the state of the platform on the status date above and
will be revised as the roadmap items in section 16 are completed.*
