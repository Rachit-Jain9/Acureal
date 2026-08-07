# Your Pending Tasks — Operator Actions (Rachit)

This is the **single, complete list of things only you can do** — the ones that
need an account login, a payment, a decision, a person's name, or a file only you
have. Everything else (the code, the database, the product) is built and verified.

**Goal: clear the 🔴 / 🟠 / 🟡 items below within ~1 month.** Work top to bottom.
After each one, reply with the little "done" phrase shown — that's how I keep this
list up to date. Everything is written step-by-step, no jargon.

_Last updated: 2026-08-04 (**two new items at the top — 0c and 0d**, both
quick. 0c stops test copies of the site from holding the real database's keys —
the code-side safety net is already live, so previews will refuse to start
until you flip the settings. 0d is your first one-command database update; it
also fixes a hidden cache bug that has been re-paying Google for address
lookups since late July. Still open from before: 5 (mailboxes — the legally
required one), 4 (two names), and 7 (the lawyer).)_

---

## ✅ Already handled — nothing for you to do here

- **✅ DONE (2026-08-07 — you authorised it in chat; I ran it).** The eight test
  deals are out of your live workspace. They were `E2E Sarjapur Plotted`,
  `E2E Whitefield Apartments`, `Stale-check test (PR-8)`,
  `TEST - Hotel Operating Roll (DELETE)`, `TEST - Land-rate flag (Gandhinagar)`,
  `TEST - Redevelopment Occupants (PR-8)`, `ZZ Bridge Verification (temp — delete
  me)` and `ZZ Plotted Verification (temp — delete me)`. Every one was checked
  first and held **nothing** — no documents, diligence items, risks, approvals,
  activities or reports — so no real work was touched. They were **archived, not
  deleted**: they still exist, they're just out of the way, and any of them can be
  brought back. Each archive is recorded in the deal history log with the reason,
  the same way the app records it when you archive a deal yourself. Your Deals
  list now shows the nine real ones.

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

## 0c. Stop test copies of the site from touching the real database (added 2026-08-04)

**What this is.** Every time code changes, Vercel builds a "preview" — a test
copy of the site. Right now those test copies hold the keys to the **real**
database, because three settings are shared with every environment. A test copy
of unmerged code should never be able to read or change live customer data.
I've already built the safety net in code (a preview that finds itself holding
the real keys now refuses to start), and I've built a separate practice
database for previews to use instead. You just need to flip the settings.

🌐 In your browser, open: https://vercel.com/dashboard → click the **Acureal**
project → **Settings** (top bar) → **Environment Variables** (left menu).

For **each** of these three rows — `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` — do the same four clicks:

1. Find the row by name (use the search box at the top of the list).
2. Click the **⋯** at the right end of the row → click **Edit**.
3. In the **Environments** section of the dialog, **untick "Preview" and
   "Development"** so that ONLY **Production** stays ticked. Do **not** touch
   the value itself.
4. Click **Save**. Success signal: a green "Updated" toast.

Also check (don't change values, just look): if rows called `SUPABASE_KEY` or
`BLOB_READ_WRITE_TOKEN` exist, give them the same treatment (Production only).
And confirm `DATABASE_SSL_MODE` and `DATABASE_CA_CERT` both say **Production**
— those two caused the 6-minute outage on 2026-08-02, so we check their scope
whenever we're on this page.

Then add ONE new setting so previews use the practice database:

5. Click **Add Another** (or **Add New**) at the top.
6. Key — paste exactly: `DATABASE_URL`
7. Value — paste exactly (one line, nothing to fill in):
   ```
   postgresql://redip_app.aphgtgyuuycorhqhjxqx:bb4898885ac210c0006e12981f3da6d0@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
   ```
8. In **Environments**, tick **ONLY "Preview"**. Untick everything else.
9. Click **Save**. Success signal: the list now shows TWO `DATABASE_URL` rows —
   one marked Production, one marked Preview.

That practice database contains only made-up test companies ("Rehearsal Alpha"
/ "Rehearsal Beta") — no real data. If you ever want to click around a preview,
sign in there with `alpha-owner@rehearsal.test` / `Rehearse123!`.

**Reply "scoped"** when done. (File uploads won't work on previews — that's
expected and fine; the real site is untouched.)

## 0d. Run your first automatic database update (added 2026-08-04 · ~2 minutes)

The copy-paste-into-the-browser step is retired. Database updates now apply
from one command, which first SHOWS what it would do, changes nothing without
an explicit flag, undoes everything if a step fails, and keeps the ledger
honest. It was proven by rebuilding a complete throwaway copy of your database
from scratch before ever touching production.

There is one update waiting: it fixes a hidden bug where the address-lookup
cache silently stopped saving results after the July security upgrade, so the
site has been re-paying Google for lookups it had already done.

🖥 In your terminal (VS Code, at the project folder):

1. Copy-paste and run:
   ```
   git pull
   ```
2. Copy-paste and run (this only SHOWS the plan — it changes nothing):
   ```
   node backend/scripts/migration-apply.js
   ```
   Success signal: a table of every update with a PLAN column, ending in
   "Dry run only".
3. Copy-paste and run (this applies the one waiting update):
   ```
   node backend/scripts/migration-apply.js --apply --only 20260807_geocode_cache_write_policy.sql
   ```
   Success signal: a line starting `✓ applied 20260807_geocode_cache_write_policy.sql`.

**Reply "applied"** (and paste the ✓ line if you like) — I'll verify against
the live database.

## 0. ✅ DONE (2026-08-02 — you ran it; verified live) — Close the second door into the database

The second entrance is shut. Verified against the live database straight after
your run: **0** tables reachable by the anonymous role in either area, **0**
powerful functions reachable, **password hashes unreachable** (the check reads
`false`), and the app's own access untouched at **80** tables. The only things
left are 3 mapping-reference tables that Supabase itself owns and that contain
no customer data.

One honest correction on my side: I told you every number should be 0. One
column read **10**, which looked wrong but wasn't — my read-back question was
too broad and was counting harmless everyday helper functions alongside the
dangerous ones. Those 10 run with *your visitor's* permissions, which are now
none, so they can't reach anything. I've since narrowed that check and it now
reads **0**, and I've fixed the same over-counting in the hourly monitor so it
can't cry wolf. The repair itself was correct from the start.

<details>
<summary>The original instructions, for the record</summary>

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

</details>

## 0b. ✅ DONE (2026-08-02 — you ran it; verified live) — Deal sharing locked to your workspace

Both numbers came back **0**: no cross-workspace permission rules left, and no
existing share pointing outside a workspace. Sharing a deal now only works with
people in your own workspace.

<details>
<summary>The original instructions, for the record</summary>

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

</details>


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

## 4. ⏸ ON HOLD (your call, 2026-08-07) — Two names for the emergency plan
**Status: you said "keep it on hold". Nobody should ask you for these again until
you raise it.** Nothing is broken in the meantime; the security plan simply has
two "TBD" spots.

When you want to close it, reply with two names:
- **Incident Lead** — the person in charge if something goes wrong (probably you).
- **Legal Liaison** — the person who'd contact the lawyer (probably you, for now).

A third name — the **Grievance Officer** that Indian law requires the privacy page
to publish — is part of the same decision and is on hold with it. Note that this
one is a legal obligation, not just paperwork: while it is blank, the privacy page
names an address (see item 5) but no person.

## 5. 🔴 Create TWO email addresses on acureal.in — one is required by law
**Why:** The site tells people to write to two addresses. Neither exists yet, so
right now those emails **bounce**. One of them, `grievance@`, is legally required
in India (the Digital Personal Data Protection Act says a company must publish a
working Grievance Officer contact).

These need to **receive** mail. That's a different thing from Resend in 6b, which
only **sends**. You need both.

### ✏️ REWRITTEN 2026-08-07 — the old Zoho plan below is obsolete, don't follow it

The earlier advice (sign up for Zoho Mail free) was written on 2026-07-30, before
you moved acureal.in to **Google Workspace**. I checked the live DNS today:

```
acureal.in    MX preference = 1, mail exchanger = smtp.google.com
```

Google is already receiving mail for the domain. So you do **not** need a new
provider, a new account, a new password, or any DNS change. You need two
**aliases** on the mailbox you already have — Google gives you up to 30 free, and
mail sent to them simply lands in your normal `rachit.jain@acureal.in` inbox.

This is about a two-minute job. It is the only thing standing between the site
and a legal obligation: `grievance@acureal.in` is printed on your live privacy
page, and today mail to it bounces.

**I can't do this one for you.** It needs an admin sign-in at Google, and I don't
enter passwords or sign into accounts — that's a hard line regardless of access
you offer me. The steps are below and they're all clicking.

🌐 **In your browser:**

1. Go to **https://admin.google.com** and sign in as `rachit.jain@acureal.in`.
2. In the left menu click **Directory** → **Users**.
3. Click your own name in the list (**Rachit Jain**).
4. Click the box titled **User information**, then click **Email aliases**.
5. Click **Add an alias**. In the box that appears, type: `grievance`
   — the `@acureal.in` part is already filled in for you.
6. Click **Add an alias** again and type: `security`
7. Click the blue **SAVE** button at the bottom.
8. You'll see the two new addresses listed under "Email aliases".

⏳ Google says aliases can take up to 24 hours to start working; in practice it's
usually a few minutes.

✅ **How to check it worked:** from your personal Gmail, send a short email to
`grievance@acureal.in`. It should arrive in your `rachit.jain@acureal.in` inbox.
Do the same for `security@acureal.in`.

**Reply:** `mailboxes done` — or paste a screenshot if the screen looks different
from the steps above.

<details>
<summary>Old advice from 2026-07-30 (obsolete — kept for history)</summary>

GoDaddy's own email was a paid subscription with a broken setup wizard, so the
recommendation then was Zoho Mail's free plan (5 users, 1 domain, 5 GB each,
webmail only), with Cloudflare Email Routing ruled out because it would have
required moving nameservers and disturbing DNS that had just been made to work.
All of that is moot now that Google Workspace holds the domain's MX.

</details>

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
- **8c. ✅ DONE (2026-08-02 — you deleted it; verified live).** Supabase now reports
  zero add-ons. That was the last thing anywhere still talking to the second
  database entrance, so it is now closed both by permission and by having no
  users left.

<details>
<summary>Original instructions, for the record</summary>

- **Delete one leftover add-on — 30 seconds, and the only step left on this.**
  I removed the unused `investor-package` add-on from the code after confirming
  it had never done anything: **zero** records written in its entire life across
  all three of its tables, and no activity in its logs. A copy is still sitting
  in Supabase, so please delete it there:
  1. 🌐 Open: `https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/functions`
  2. Find **investor-package** in the list.
  3. Click it → the **⋯** (or **Settings**) menu → **Delete function** → confirm.
  4. **Reply:** `function deleted`.

  It belonged to a feature we never launched (tamper-proof signed investor
  packs). If we ever build that, it gets rebuilt properly with its own limited
  database access.

</details>

- **8b. ✅ DONE (2026-08-02 — verified live).** Your database connection now checks
  **who** it is talking to, not merely that the line is scrambled. The System
  Health page confirms it: *"Transport verify-full · server certificate and
  hostname verified"*. Your downloaded certificate was checked against the live
  database first — its fingerprint matched what production actually presents,
  exactly.

  **It cost about six minutes of downtime, and that was my mistake.** I gave you
  two settings in one message and told you to republish without first checking
  that *both* covered Production. The certificate had saved as Development-only,
  so verification switched on with no certificate available and sign-ins failed
  until you corrected the scope and republished. Two things worked as designed:
  the failure was loud and instant rather than subtle, and the fix was a setting
  rather than a code rollback. Lesson recorded — when a change needs two
  settings, verify both are saved AND correctly scoped before any republish.

  To revert at any time: set `DATABASE_SSL_MODE` to `relaxed` and republish.

<details>
<summary>Original instructions, for the record</summary>

- **Make the database connection check who it's talking to — 3 steps, needs one
  file from you.** The connection is scrambled (encrypted) but never checks the
  identity of the machine at the other end. Turning that check on needs
  Supabase's own certificate first, because they sign their database with a
  private authority — switching it on without the certificate takes the site
  down instantly. So the order matters, and step 1 is yours:

  1. 🌐 Open: `https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/settings/database`
  2. Scroll to **SSL Configuration** → click **Download certificate**. You'll get
     a file called `prod-ca-2021.crt`.
  3. 💬 **Drag that file into our chat.** It's a public certificate, not a
     password — safe to share. I'll then run it against the live database and
     confirm it's the right one *before* anything changes.

  For the record, here's what your database actually presents today (I read it
  straight off the live connection, no password needed). The file you download
  should trace back to this root:

  ```
  Supabase Root 2021 CA
  sha256  80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:
          82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
  ```

  After you send it: I verify it, you paste it into one Vercel setting, flip a
  second setting to `verify-full`, and it's done — reversible in seconds if
  anything misbehaves.

</details>

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
