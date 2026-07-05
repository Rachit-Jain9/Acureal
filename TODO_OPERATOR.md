# Your Pending Tasks — Operator Actions (Rachit)

This is the **single, complete list of things only you can do** — the ones that
need an account login, a payment, a decision, a person's name, or a file only you
have. Everything else (the code, the database, the product) is built and verified.

**Goal: clear the 🔴 / 🟠 / 🟡 items below within ~1 month.** Work top to bottom.
After each one, reply with the little "done" phrase shown — that's how I keep this
list up to date. Everything is written step-by-step, no jargon.

_Last updated: 2026-06-09._

---

## ✅ Already handled — nothing for you to do here

- **Database is fully up to date and secure.** Verified live on 2026-06-09: every
  database update (including the important security fix) is already applied, and
  Supabase's own security scanner found nothing that needs action. You do **not**
  need to apply any database updates.
- **The website features** (large-number helpers, charts, exports, deal workspace,
  K-RERA tracking, etc.) are built and live.
- **AI + file uploads** are working in production, so those keys are set. (If
  anything AI- or upload-related ever misbehaves, tell me and I'll check the keys.)

---

# 🔴 DO FIRST — protects your data and money (this week)

## 1. ✅ DONE (2026-06-25 — Supabase Pro active, verified via API; daily backups auto-included, first appears within 24h) — Turn on database backups — most important
**Why:** Right now your database may have **no automatic backups**. If something
ever goes wrong, deal data could be lost permanently.

1. 🌐 Open: `https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/database/backups`
2. If it says backups are **not available on your plan**, click **Upgrade** and pick
   the **Pro** plan (about US$25/month — includes automatic daily backups). Confirm.
3. Within a day, daily backups start appearing in the list.
4. **Reply:** `backups on` (or paste a screenshot if it looks different).
5. One small follow-up: each backup has a **Restore** option next to it — you don't
   need to restore anything, just confirm it's there and reply `restore option visible`.

## 2. ✅ DONE (2026-06-25 — operator confirmed deleted) — Delete the old Google Maps key — closes a leaked-key hole
**Why:** An old Google Maps key was once exposed. The new key is already in the site,
but **the old leaked key still works until you delete it** in Google Cloud.

1. 🌐 Open: `https://console.cloud.google.com/google/maps-apis/credentials`
2. You'll see a list of API keys. Find the **old one you're no longer using**
   (if unsure which is old, reply here and I'll help you tell them apart).
3. Click the old key → **Delete** (or **Regenerate** if you'd rather keep the slot).
4. While you're there: on your **current** key, make sure there's a **billing budget
   cap** set so a runaway can never cost a fortune.
5. **Reply:** `maps key deleted`.

## 3. ✅ DONE (2026-06-25 — AI_DAILY_COST_CAP_USD set in Vercel) — Set the AI spending cap — ~2 minutes
**Why:** This puts a hard daily dollar limit on the AI features so they can never
overspend, no matter what.

1. 🌐 Open: `https://vercel.com/rachitjain348-4262s-projects/redip/settings/environment-variables`
2. Click **Add New** (or **Add Another**).
3. Name (Key): `AI_DAILY_COST_CAP_USD`  ·  Value: `25` (or whatever daily US-dollar
   ceiling you're comfortable with).
4. Click **Save**.
5. **Reply:** `cost cap set` — I'll confirm the cap is active on the next publish.

---

# 🟠 QUICK WINS — a few minutes each

## 4. Two names for the emergency plan
**Why:** The written "what to do if there's a security problem" plan has two blank
spots that need real people.

Just **reply** with these two names:
- **Incident Lead** — the person in charge if something goes wrong (probably you).
- **Legal Liaison** — the person who'd contact the lawyer (probably you, for now).

## 5. Create a security@ email address
**Why:** Your documents tell security researchers to email `security@redip.in`, but
that mailbox doesn't exist yet — so any such email would bounce.

1. 🌐 Go to wherever you manage email for **redip.in** (Google Workspace, Zoho, or
   your domain provider's email settings).
2. Create a mailbox or alias **security@redip.in**, pointed to your own inbox.
3. **Reply:** `security mailbox done`.

---

# 🟡 NEEDS LEAD TIME — start soon

## 6. Get a domain + turn on email sending
**Why:** A few features need REDIP to *send* email — sign-up verification + password
reset links, and automatic **K-RERA deadline reminders**. Right now it can't send any
email because there's no verified sending domain. (Nothing is broken without it — the
K-RERA calendar is fully visible on screen and in the Word download; this just adds
the email nudges.)

Once you have a domain (e.g. `redip.in`):
1. 🌐 Go to `https://resend.com`, sign up (free to start), log in.
2. **Domains → Add Domain**, type your domain, click Add.
3. Resend shows a few **DNS records**. Go to where you bought the domain (GoDaddy,
   Namecheap, Cloudflare, etc.), open its DNS settings, and add those exact records
   (copy-paste each — don't retype).
4. Back on Resend, wait for the domain to show a green **Verified**.
5. **API Keys → Create API Key**, copy the key (starts with `re_…`).
6. 🌐 Open `https://vercel.com/rachitjain348-4262s-projects/redip/settings/environment-variables`
   and add two settings:
   - `RESEND_API_KEY` = the `re_…` key.
   - `MAIL_FROM` = `REDIP <noreply@redip.in>` (your real domain).
7. **Reply:** `email sending on` — I'll switch on the automatic K-RERA reminders
   (already built and waiting).

## 7. Hire a lawyer for two legal documents
**Why:** Big customers (funds, banks, REITs) check for proper legal paperwork before
signing up. Two documents are missing, and by law they must come from a real Indian
lawyer — I can't write them.

The two documents: a **Data Processing Agreement (DPA)** and an **Acceptable Use
Policy (AUP)**.

1. Find an Indian lawyer/firm familiar with tech products and the **DPDP Act 2023**
   (a startup-focused lawyer is fine).
2. Ask them to draft a **DPA** and an **AUP** for an India-based real-estate software product.
3. Forward the drafts to me — there's already a place built and waiting in the site to
   host legal documents, so I can wire them in quickly.
4. **Reply:** `lawyer engaged` once you've hired someone, so I know it's in motion.

---

# 🟢 WHEN YOU'RE READY — no rush, just tell me

These need nothing from you right now. When you want them, send the phrase and I'll do it.

- **8. ✅ DONE (2026-07-05 — database tidy-up).** Made the database folder clean +
  self-explanatory: **one authoritative, current index of every migration**
  (`database/current_schema.sql`, regenerated from the real files — all 123, grouped
  by month) + a plain **`database/README.md`** explaining every file and how a fresh
  database is built. Nothing touched on production (it was already fully applied),
  and no working files were deleted — a literal "delete 123 files into one" would
  risk breaking fresh-database setup for no gain (the files are the safe, idempotent
  history). No action needed from you.
- **9. Guidance-value PDF (unlocks 11 placeholder rows).** Bengaluru guidance/circle-
  rate values are placeholders until you give me **one** official PDF. Go to
  `https://igr.karnataka.gov.in/english` → **Revised Guidelines Value** → pick Bengaluru
  Urban/Rural → pick any SRO → download the PDF → **drag it into our chat**. The first
  one teaches the pattern; the rest are automatic (~$0.05 each).
- **10. Resume a paused data stream.** Co-working, student-housing, senior-living, and
  data-centre benchmarks are scaffolded and paused at your request. Say
  `resume co-working` (or student housing / senior living / data center) and I'll build
  the extraction for it.

---

# 🔒 BIG / BLOCKED — not this month unless a customer needs it

- **Investor-package cryptographic signing.** Tamper-proof digital signatures on
  exported investor packages need a dedicated signing-key service (HSM/KMS) + a
  compliance decision on the scheme. It's a bigger project — flag it if a specific
  customer requires signed packages and I'll scope it with you. (We deliberately don't
  fake a signature — a fake is worse than none.)

---

## How to use this file
- The items are in **priority order** — work top to bottom.
- Reply with the small `done` phrase after each so I keep this current.
- **Target: clear 🔴 / 🟠 / 🟡 within ~1 month.** The 🟢 items have no deadline.
- This file is the **single source of truth** for operator actions. Engineering
  detail (for me) lives in `TODO_MANUAL.md`; data-source limitations in `TODO_DATA.md`;
  legal constraints in `TODO_LEGAL.md`.
