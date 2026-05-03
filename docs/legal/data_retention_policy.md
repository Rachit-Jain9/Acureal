# Data Retention Policy (Internal)

**Effective Date:** [DATE]
**Owner:** Privacy Contact
**Review cadence:** annual

Per DPDP Act §8(7), personal data must be erased once the purpose is fulfilled and no statutory retention applies. This document is the canonical retention map for REDIP.

## Retention windows

| Category | Retention | Statutory / contractual basis |
|---|---|---|
| Account data (active) | account lifetime | Contract performance |
| Closed accounts | 90 days post-closure | Billing reconciliation |
| Deal documents / workspace data | account lifetime; on user request, deleted within 30 days | User control |
| Audit log (`deal_events`) | 7 years | Investor audit, IT Act §65B retention norms for evidentiary records |
| AI call logs (`ai_call_logs`) | 12 months | Cost reconciliation + AI-routing audit |
| Server access logs | 180 days | CERT-In Direction §II(v), April 2022 |
| Backups | 30 days rolling | Operational recovery |
| Grievance records | 5 years | Limitation Act |
| `user_legal_acceptances` | account lifetime + 7 years post-closure | Indian Contract Act enforceability |

## Erasure

- **User-initiated** — via grievance@[YOUR-DOMAIN]. Manual today; will be exposed as a self-service action in Phase 2 of the security roadmap.
- **Automated** (Phase 4) — `pg_cron` job nightly: hard-delete rows past retention. Audit log entry per deletion. Until built, manual.

## Statutory overrides

If an active legal hold, regulatory request, or tax obligation requires longer retention, the affected data is preserved until the obligation lapses; the user is informed if and when feasible.

## Review

This document is reviewed annually by the Privacy Contact. Material changes (e.g., new sub-processor, new statutory retention requirement) trigger an out-of-band review.

---

*Last review: [DATE]*
