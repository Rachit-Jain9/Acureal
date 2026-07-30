# Backup & Disaster Recovery Posture (Internal)

**Status date:** 2026-05-20
**Owner:** Acureal engineering
**Review cadence:** annual, plus after any restore drill or production incident
**Maintained in:** version control — see the git history of this file

## Purpose

This document records how Acureal customer data is backed up, how it is encrypted
at rest, and how the platform would be recovered after data loss or a
destructive incident. It exists so that the recovery answer to a security
diligence questionnaire is written down and testable, not improvised.

It is an internal document. The customer-facing summary lives in
`docs/SECURITY.md` §14.

## 1. What must be recoverable

| Asset | System | Criticality |
|---|---|---|
| Account, deal, and audit data | Supabase PostgreSQL (Mumbai, `ap-south-1`) | Critical — primary system of record |
| Uploaded deal documents | Supabase Storage / Vercel Blob private buckets | Critical — customer-irreplaceable content |
| Application code & config | Git (GitHub) + Vercel | Recoverable from version control; redeployable |
| Environment secrets | Vercel environment variables | Held by the operator; rotation procedure in the breach runbook |

Application code is not a backup concern in the data-loss sense — it is in
version control and redeploys from a commit. The recovery focus is the database
and the document store.

## 2. Backup posture

### 2.1 Database

The PostgreSQL database is managed by Supabase, which takes **automated backups**
of the project. The retention depth and the availability of **Point-in-Time
Recovery (PITR)** depend on the project's Supabase plan tier.

> **Operator to confirm and record here:** the active Supabase plan tier, the
> automated-backup frequency and retention it provides, and whether PITR is
> enabled. This is a dashboard lookup — Supabase project → Database → Backups.

PITR matters because it changes the recovery point from "last daily snapshot"
(up to ~24h of potential loss) to "any moment within the PITR window" (seconds).
If the diligence target is a strict RPO, PITR should be enabled.

### 2.2 Document storage

Uploaded documents live in **private** storage buckets — never publicly
addressable, served only via short-lived signed URLs. Bucket contents are part
of the managed-storage provider's durability guarantees.

> **Operator to confirm and record here:** whether storage-bucket contents are
> covered by a provider backup/replication guarantee, or whether a periodic
> export is required to meet the document-recovery objective.

### 2.3 Encryption at rest

Database and object storage are **encrypted at rest by the storage providers**
(industry-standard AES-256-class encryption, provider-managed keys). Acureal does
not operate its own at-rest encryption layer on top; it relies on the managed
providers, which is the standard posture for a Supabase/Vercel stack. This is
stated to customers in `docs/SECURITY.md` §7.

## 3. Recovery objectives (targets)

These are the **targets**. They are not yet evidenced by a completed restore
drill — see §5.

| Objective | Target | Notes |
|---|---|---|
| RTO (Recovery Time Objective) | Within 4 hours of a decision to restore | Time to a working, verified database from a backup |
| RPO (Recovery Point Objective) | ≤ 24 hours without PITR; ≤ 5 minutes with PITR enabled | Driven entirely by whether PITR is on — see §2.1 |

The RTO assumes the failure is data corruption / loss, not a Supabase regional
outage. A full regional outage is outside Acureal's direct control and is governed
by Supabase's own availability commitments.

## 4. Recovery procedure

This is the runbook for restoring the database after data loss or corruption. It
is deliberately written so the operator can follow it without prior context.

1. **Decide and declare.** Confirm the loss is real and that restore (not
   forward-fix) is the right call. If the cause is a security incident, open a
   `security_events` row and follow the breach-notification runbook in parallel.
2. **Freeze writes.** Put the application into a maintenance state (or take it
   offline) so a restore is not racing live traffic. Note the time.
3. **Pick the recovery point.** With PITR, choose a timestamp just before the
   loss. Without PITR, choose the most recent clean daily backup.
4. **Restore.** In the Supabase dashboard → Database → Backups, restore to the
   chosen point. Supabase restores into the project (or a new project, depending
   on the restore type offered by the plan).
5. **Verify integrity.** Before reopening traffic, check:
   - row counts on the key tables (`users`, `deals`, `deal_events`) are sane;
   - the most recent `deal_events` rows still verify against their HMAC
     signatures (tampering / partial-restore check);
   - a sample uploaded document downloads via a signed URL.
6. **Reconcile documents.** Confirm the document store is consistent with the
   restored database (no deal rows pointing at missing files, and vice versa).
7. **Reopen.** Lift the maintenance state. Record the actual recovery time.
8. **Post-restore.** Write up what was lost (the gap between the recovery point
   and the failure), notify affected customers if material, and log the event in
   `SESSION_LOG.md` and the incident log.

## 5. Restore-drill status

A restore drill validates that the procedure above actually works and that the
RTO/RPO targets are real.

**Status: not yet executed.**

> **Operator action:** schedule and run one restore drill — ideally restoring
> into a throwaway Supabase project so production is untouched. Record the
> outcome in the table below and update the verification matrix in the
> breach-notification runbook. The drill turns the §3 targets from claims into
> evidence, which is what a diligence reviewer will ask for.

| Drill date | Recovery point used | Measured RTO | Outcome / notes |
|---|---|---|---|
| — | — | — | Not yet run |

## 6. Related documents

- `docs/SECURITY.md` §14 — customer-facing availability & recovery summary.
- `docs/legal/breach_notification_runbook.md` — incident-driven restores (Step 4).
- `docs/legal/data_retention_policy.md` — backup retention row.

---

*Internal document. Reviewed annually and after every restore drill or incident.*
