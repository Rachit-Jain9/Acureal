# Your Pending Tasks — Operator Actions (Rachit)

This is the **single, complete list of things only you can do** — the ones that
need an account login, a payment, a decision, a person's name, or a file only you
have. Everything else (the code, the database, the product) is built and verified.

**Goal: clear the 🔴 / 🟠 / 🟡 items below within ~1 month.** Work top to bottom.
After each one, reply with the little "done" phrase shown — that's how I keep this
list up to date. Everything is written step-by-step, no jargon.

_Last updated: 2026-08-02 (**new item 0 at the top — please do that one first.** A
security audit found a second, unguarded entrance to the database; closing it is
one paste and changes nothing about how the site works. Otherwise unchanged: 5b,
5c and 5d are all DONE and verified live. Still open: 5 (mailboxes — the legally
required one), 4 (two names), and 7 (the lawyer).)_

---

## ✅ Already handled — nothing for you to do here

- **✅ DONE (2026-07-17 — operator ran it; verified live).** The Bengaluru
  locality → Planning District lookup (`20260619_district_localities.sql`) is
  applied: **480 localities across all 42 districts**, indexes built, row-level
  security on. Localities that previously resolved to nothing now resolve
  automatically — Ejipura and Jakkasandra → PD-03, Bellandur → PD-12,
  Jarakabandekaval → PD-19. Verified on the Jaraka Bande deal: the Planning
  context panel moved from *"address-token-fuzz · 60% confidence"* to
  *"locality-index · 85% confidence"*, and the district label tightened from a
  23-village blob to **PD-42 — Rajanakunte**. It had been throwing an error in
  production since mid-June because the update was written but never run.
  (Provenance, on the record: the locality list comes from the BDA's RMP 2031
  draft, withdrawn in 2020. Acceptable here because it only puts a **district
  name label** on an address — it never feeds FAR, zoning, or approval
  decisions. Say the word if you'd rather drop it; nothing depends on it.)

- **Database security** verified live on 2026-06-09: the important security fix is
  applied and Supabase's own security scanner found nothing needing action.
  (This section used to claim the database was *fully* up to date and that you
  never needed to apply updates — that was wrong, and it's why the update above sat
  unnoticed for a month. Migrations are applied by hand here, so "written" never
  means "live" until someone runs it.)
- **The website features** (large-number helpers, charts, exports, deal workspace,
  K-RERA tracking, etc.) are built and live.
- **AI + file uploads** are working in production, so those keys are set. (If
  anything AI- or upload-related ever misbehaves, tell me and I'll check the keys.)

---

# 🔴 DO FIRST — protects your data and money (this week)

## 0. Close the second door into the database — **most urgent thing on this list**

**What's wrong.** Your database has two entrances. One is the Acureal website,
which we've checked carefully for years. The other is a general-purpose entrance
that Supabase switches on for every project — and nobody had ever looked at it.
It was left wide open: it would hand out **everyone's scrambled passwords**, the
**six-digit-code secret** for your own login, **everyone's name, email and phone
number across all workspaces**, and it would let a stranger **create accounts** or
**sign in as any user without knowing their password**.

**How bad is it right now?** Nobody can walk in today — the entrance needs a
specific project key, and that key does not appear anywhere on your website, in
your code, or on the internet. But Supabase treats that kind of key as *safe to
publish*, so it's the sort of thing that leaks by accident one day. And the hole
repairs itself back open every time we add a new table. So: not on fire, but it
must be shut properly, and it's a 30-second job.

**What you need to do.** Run one database update. I'll paste the exact text into
our chat — **do not** copy it from a web page; a browser add-on once smuggled the
words "Adobe Acrobat" into a copied database update and broke it.

1. 🌐 Open: `https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new`
2. 💬 Copy the block I post in chat (use the little copy button on the code block).
3. 📋 Paste it into the big empty box.
4. Click the green **Run** button at the bottom-right.
5. **Success looks like:** a small results table appears at the bottom. Every
   number in it should be **0**, except the last one, which should be **3**, and
   the `anon_can_read_password_hashes` column should say **false**.
6. **Reply:** `door closed` — and paste a screenshot of that results table. I'll
   verify it against the live database myself and confirm.

Nothing on the website changes for you or anyone else — the app uses its own
separate key, which this doesn't touch.

## 0b. Lock deal sharing to your own workspace — second paste, same place

**What's wrong.** The "share a deal" feature looked people up by email address
and nothing else. So a deal could be shared with **someone in a completely
different customer's workspace** — and they'd get the whole thing: documents,
the financial model, diligence, risks, the full activity history. Nine
permission rules in the database were quietly set up to allow exactly that.

**How bad is it right now?** Nobody has ever shared a deal — the sharing list is
completely empty — so nothing has leaked. It was simply possible.

**What you need to do.** One more database update, same place as item 0. I'll
paste the exact text in chat.

1. 🌐 Open: `https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new`
2. 💬 Copy the block I post in chat (use the copy button).
3. 📋 Paste it into the big empty box → click green **Run**.
4. **Success looks like:** a results table with **two zeros**.
5. **Reply:** `sharing locked`.

From then on, sharing a deal only works with people in your own workspace —
which is everyone who should see it anyway. Sharing with genuine outsiders
(an external lawyer or investor) is something we'd build properly later, with an
expiry date, a watermark and the ability to withdraw access.


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

1. 🌐 Open: `https://vercel.com/rachitjain348-4262s-projects/acureal/settings/environment-variables`
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

## 5. 🔴 Create TWO email addresses on acureal.in — one is required by law
**Why:** The site tells people to write to two addresses. Neither exists yet, so
right now those emails **bounce**. One of them, `grievance@`, is legally required
in India (the Digital Personal Data Protection Act says a company must publish a
working Grievance Officer contact).

These need to **receive** mail. That's a different thing from Resend in 6b, which
only **sends**. You need both.

### Which provider — checked 2026-07-30
GoDaddy's own email (the "Set up Email" banner on your domain page) is a **paid
subscription** — it offers Microsoft 365 or Titan, priced per mailbox per month,
and its setup wizard currently errors out. For two addresses that will receive a
handful of messages a year, that's poor value.

| Option | Cost | Trade-off |
|---|---|---|
| **Zoho Mail free plan** ⭐ | Free — 5 users, 1 domain, 5 GB each | Webmail only (no Outlook/Apple Mail app). Fine for low-volume compliance inboxes. |
| GoDaddy Titan / Microsoft 365 | Paid, per mailbox per month | Simplest, but a recurring bill for two rarely-used addresses |
| Cloudflare Email Routing | Free, forwards into your Gmail | Requires moving the domain's nameservers to Cloudflare — **don't do this now**, it would disturb the DNS we just got working |

**Recommendation: Zoho Mail's free plan.** Real mailboxes, no cost, and it works
alongside the DNS we just set up (it only adds MX records).

⚠️ Whichever you pick, adding its MX records at GoDaddy will ask for a fresh
6-digit code texted to your phone — same as the domain setup.

I can't do this part for you: it needs a new account signed up in your name and a
mailbox password set, and I don't create accounts or enter passwords.

1. Sign up at `https://www.zoho.com/mail/` → choose the **Forever Free** plan.
2. Add `acureal.in` as your domain; Zoho gives you DNS records to add at GoDaddy.
3. Create the two mailboxes: `security@acureal.in` and `grievance@acureal.in`.
4. Send a test email to each from your Gmail and confirm they arrive.
5. **Reply:** `mailboxes done` — and tell me if you'd rather I document a
   different provider instead.

---

## 5b. ✅ DONE (2026-08-01 — operator ran it; verified live)
"Since your last visit" is ON: open a deal you haven't touched in a while and
the top of the Overview says what changed without you (new documents, new
risks, diligence progress). The first paste failed amusingly — a browser
extension smuggled the words "Adobe Acrobat" into the copied text and the
database refused the lot — the clean re-paste succeeded and was verified.

## 5c. ✅ DONE (2026-08-01 — operator ran it; verified live)
The database's applied-updates diary is complete again: 42 catch-up entries
written, the two missing June index entries created, and the checker now
reports **zero unrecorded, zero partial, zero unapplied** across all 136
update files. From here on, one command re-checks it any time.

## 5d. ✅ DONE (2026-08-01 — operator ran it; verified live)
The four things July's security upgrade quietly broke are repaired: benchmark
panels read again, the A/B quality tool works, usage-learning signals are
being recorded again, and Admin › Signups shows everyone across all
workspaces (not just yours). Verified live: the repair functions exist in
production and no security rule references the phantom setting any more.

---

# 🟡 NEEDS LEAD TIME — start soon

## 6. ✅ DONE (2026-07-30) — acureal.in is LIVE
Nothing left to do here. The site now answers at **https://acureal.in** with a
valid padlock, and the old address forwards to it.

What was set up, for the record:

| Where | Setting | Value |
|---|---|---|
| GoDaddy DNS | `A` record on `@` | `216.150.1.1` (replaced the old WebsiteBuilder parking record) |
| GoDaddy DNS | `CNAME` on `www` | left as `acureal.in.` — Vercel accepts it as valid |
| Vercel Domains | `acureal.in` | Production · Valid Configuration |
| Vercel Domains | `www.acureal.in` | 308 permanent redirect → `acureal.in` |
| Vercel env | `CORS_ORIGINS` | `https://acureal.in,https://www.acureal.in,https://redip.vercel.app` |
| Code | `vercel.json` | host-scoped 308 from `redip.vercel.app` → `acureal.in` |

Verified live: `acureal.in` → 200; `www.acureal.in` → 308 → apex; and every path
on the old address forwards, including the homepage.

Two notes worth keeping:
- Vercel's recommended apex IP is now **`216.150.1.1`**, not the older
  `76.76.21.21`. Both work; the new one is what its dashboard asks for.
- **Every DNS change at GoDaddy needs a fresh 6-digit code texted to your phone.**
  Three wrong entries locks DNS editing for 24 hours. Budget for that on any
  future record change — including the Resend records in 6b below.

### ✅ Google sign-in on the new domain — fixed 2026-07-31
Signing in with Google on `acureal.in` failed with **"Access blocked: Authorization
Error · Error 400: origin_mismatch"**. The Google OAuth client's *Authorized
JavaScript origins* still listed only `https://redip.vercel.app` and
`http://localhost:5173`, so Google refused to issue a token to the new domain.
`https://acureal.in` and `https://www.acureal.in` have been added (old entries
kept). Verified persisted in Google Cloud Console.

**Remember for any future domain change:** a new domain needs to be registered in
THREE independent places, and each fails differently and silently —
1. **Vercel → Domains** (else the site does not answer),
2. **`CORS_ORIGINS`** in Vercel env (else the browser blocks API calls),
3. **Google Cloud → OAuth client → Authorized JavaScript origins** (else Google
   sign-in dies with `origin_mismatch` while password sign-in keeps working, so
   it looks like the domain is fine).

### ⚠️ One unrelated thing spotted on the GoDaddy page
**Auto-renew is OFF** and `acureal.in` expires **29 Jul 2027** (₹899/yr). If it
ever lapses, the domain — and with it the site and every email address on it —
stops working, and someone else can buy the name. Worth turning on:
`https://dcc.godaddy.com/control/portfolio/acureal.in/settings` → **Turn Auto-renew On**.

## 6b. ✅ DONE (2026-07-31) — email sending is ON and verified
We did this together on 2026-07-31: Resend is connected to `acureal.in` (domain
shows green **Verified**), the sending key is installed in Vercel, and we proved
it end-to-end — a real verification email from **Acureal `<noreply@acureal.in>`**
landed in a real Gmail inbox, and the link inside it works (an earlier bug sent
people to a dead address; that was found and fixed the same day).

New signups now receive their verification email, and password-reset links work.

_Note: the K-RERA deadline reminders mentioned here earlier are **not** waiting on
email — they're deferred for a different reason (no live deal has a RERA number
entered yet, so there is nothing to remind about). Details live in TODO_MANUAL.md._

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
