# Data Retention Policy (Internal)

**Status date:** 2026-05-20
**Owner:** Privacy Contact
**Review cadence:** annual, plus an out-of-band review on any new statutory
retention requirement or new data category
**Maintained in:** version control — see the git history of this file for
revision dates

Per DPDP Act 2023 §8(7), personal data must be erased once the purpose is
fulfilled and no statutory retention applies. This document is the canonical
retention map for Acureal. It reflects what the platform actually enforces today,
not a future intention — the automated retention sweep described under *Erasure*
is live in production.

## Retention windows

| Category | Store | Retention | Enforcement | Basis |
|---|---|---|---|---|
| Account data (active) | `users` | Account lifetime | — | Contract performance |
| Closed-account PII | `users` | Pseudonymised 90 days after closure | Automated daily | DPDP §8(7) erasure principle |
| Deal documents / workspace data | deal tables + storage buckets | Account lifetime; deleted within 30 days of a user deletion request | User-controlled | User control |
| Financial-computation audit | `deal_events` | 7 years | Manual purge (not auto-swept) | Investor audit; IT Act §65B evidentiary norms |
| Deal lifecycle audit | `deal_audit_log` | 7 years | Manual purge (not auto-swept) | Investor audit |
| AI call logs | `ai_call_logs` | 12 months (365 days) | Automated daily | Cost reconciliation + AI-routing audit |
| AI response cache | `ai_response_cache` | 90-day TTL (`expires_at`) | Automated daily | Operational cache; no long-term value |
| Refresh-token grants | `refresh_token_grants` | 90 days past expiry (forensic window) | Automated daily | Token-reuse forensics |
| Login-attempt records | `login_attempts` | 30 days after last failure, if no active lock | Automated daily | Brute-force throttle state |
| MFA challenges | `mfa_challenges` | Purged once expired | Automated daily | Short-lived auth state |
| Consent ledger | `user_consents` | Account lifetime + 7 years post-closure | Append-only | DPDP §6 consent record-keeping |
| Legal acceptances | `user_legal_acceptances` | Account lifetime + 7 years post-closure | Append-only | Indian Contract Act enforceability |
| Security-incident register | `security_events` | 7 years | Append-only | Incident audit; CERT-In / DPDP evidence |
| Server / access logs | hosting platform | Target 180 days | See note below | CERT-In Direction §II(v), April 2022 |
| Database backups | Supabase-managed | Provider-managed | See Backup & DR doc | Operational recovery |
| Grievance records | grievance channel | 5 years | Manual | Limitation Act |

**Note on server / access logs:** the 180-day CERT-In retention is the policy
target. Routing security/access logs to an India-resident store so that the full
180-day history accumulates is tracked as an open item in `docs/SECURITY.md` §16.

## Erasure

- **Account closure** is **self-service today**. A user can close their own
  account; on closure every refresh token is revoked and the account can no
  longer authenticate.
- **Scheduled erasure is automated and live.** A daily retention sweep runs in
  production via a Vercel scheduled job (`/api/cron/retention-sweep/daily`,
  03:35 UTC). It is implemented in `backend/src/services/retentionSweep.service.js`
  and, on each run:
  - pseudonymises the personal fields of accounts closed more than 90 days ago
    (email, name, phone replaced with non-identifying placeholders; password hash
    nulled). The row is preserved, not deleted, so foreign keys from deals, audit
    logs, and AI logs continue to resolve.
  - purges expired AI response-cache entries, refresh-token grants past their
    forensic window, stale login-attempt rows, AI call logs past 12 months, and
    expired MFA challenges.
  - is idempotent — a missed run is picked up by the next day's sweep — and each
    step is isolated so one failing query does not abort the rest. Per-table
    counts and any errors are emitted to logs.
- **Granular "see / download / correct my data"** self-service (the Privacy
  Centre) is in progress — tracked in `docs/SECURITY.md` §16. Until it ships,
  data-subject access and correction requests are handled manually via the
  grievance channel published in the Privacy Policy.

## What the sweep deliberately does not touch

User-authored content — deal documents, evidence facts, financial-computation
records (`deal_events`) — is never purged by the cron. It lives by deal lifecycle
and customer control, and is removed only on an explicit user deletion request or
at account erasure.

## Statutory overrides

If an active legal hold, regulatory request, or tax obligation requires longer
retention, the affected data is preserved until the obligation lapses; the user
is informed if and when feasible.

## Review

This document is reviewed annually by the Privacy Contact. Material changes —
a new sub-processor, a new statutory retention requirement, or a change to the
retention sweep — trigger an out-of-band review. The companion documents are the
Record of Processing Activities (`docs/legal/ropa.md`) and the Backup & Disaster
Recovery posture (`docs/legal/backup_and_dr.md`).

---

*Internal document. Revision history is the git history of this file.*
