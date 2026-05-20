# Breach Notification Runbook (CERT-In + DPDP)

**Internal — not user-facing.** This runbook is the on-call playbook when a security incident is suspected. Source authorities:

- **CERT-In Directions, April 2022, §II(v)** — incident report to CERT-In within **6 hours** of awareness.
- **Digital Personal Data Protection Act, 2023, §8(6)** — notification to the Data Protection Board of India and to affected Data Principals "as soon as possible".
- **IT Act, 2000, §43A + SPDI Rules, 2011** — reasonable security practices and breach response.

> **Operator action required before launch.** This runbook has three fields only
> the operator can fill: the **Incident Lead** name (see *Roles*), the **Legal
> Liaison** / lawyer name, and the **Last drill** date once a drill is run. Fill
> them before external launch — an unfilled `[NAME]` discovered mid-incident is a
> real delay against a 6-hour clock.

## Trigger

Any of the following:

- Confirmed or suspected unauthorized access to the database, storage, AI keys, or admin tooling.
- Data leak (intentional or accidental) where personal data may have been exposed.
- Ransomware, persistent unauthorized code, or compromise of build/deploy pipelines.
- DDoS or sustained outage > 30 minutes.
- AI provider key abuse (cost cap fired without explanation).
- Any other event a reasonable engineer would describe as a "security incident".

## Roles

- **Incident Lead:** [NAME] — owns the timeline, drives decisions.
- **Technical Responder:** founder — runs containment + investigation.
- **Legal Liaison:** [LAWYER NAME on retainer] — reviews external comms.

## Timeline

### Step 1 — Triage (T+0 to T+1h)

1. Confirm the incident is real (not a false-positive alert).
2. **Open an incident record** — insert a row in the `security_events` register
   (the incident table) with `detected_at` set to the moment of awareness. That
   timestamp starts the CERT-In 6-hour clock; the register also holds the
   `cert_in_reported_at` and DPDP notification timestamps, so the whole incident
   timeline lives in one auditable place.
3. Estimate blast radius: which tables, which orgs, which users are potentially affected.
4. Preserve logs (do not rotate; freeze backup retention).
5. Pause affected credentials and rotate:
   - `JWT_SECRET`
   - `DEAL_EVENTS_HMAC_KEY`
   - `PARCEL_SIGNING_SECRET`
   - `CRON_SECRET`
   - `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
   - any DB credential reuse path

### Step 2 — Notify CERT-In (T+1h to T+6h)

- Submit incident report at https://incident.cert-in.org.in/ within **6 hours** of awareness.
- Backup channel: incident@cert-in.org.in.
- Include: time of detection, type of incident, systems affected, suspected origin, current containment status, who was notified, what is being done.

### Step 3 — DPDP notification (T+6h to T+24h)

- Submit to the Data Protection Board of India (once constituted) using the prescribed form.
- Notify affected Data Principals via the email on file. The notice should be plain-English: what happened, what data was potentially affected, what we are doing about it, what they should do.

### Step 4 — Remediation (T+24h to T+7d)

- Patch root cause.
- Restore from clean backups if needed, following the recovery procedure in `docs/legal/backup_and_dr.md`; verify hashes / checksums match pre-incident state.
- Re-issue tokens; force user re-auth if compromised.
- Conduct post-mortem: what failed, what was missed, what we learn.
- Document changes in `SESSION_LOG.md` and a private incident log.

### Step 5 — Public statement (if material)

- Coordinate with legal liaison.
- Publish via Platform notice + email; do not publish before CERT-In acknowledgement.

## Verification matrix (pre-incident — keep this current)

| Item | Owner | Last verified |
|---|---|---|
| `JWT_SECRET` rotation procedure documented | founder | — |
| `DEAL_EVENTS_HMAC_KEY` rotation procedure | founder | — |
| `security_events` incident register reachable | founder | — |
| Backup & DR recovery procedure documented (`backup_and_dr.md`) | founder | 2026-05-20 |
| Backup restore drill executed | founder | — |
| Vercel admin access list | founder | — |
| Supabase admin access list | founder | — |
| Anthropic / Google / OpenAI billing alerts configured | founder | — |
| CERT-In contact details on file | founder | — |

## Last drill

[Date] — [Outcome / notes]

---

*This document is internal. Do not link to it from public-facing pages.*
