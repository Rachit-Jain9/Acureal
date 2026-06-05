# Your Pending Tasks — Operator Actions

A plain-English list of things only **you (Rachit)** can do. Each one needs an
account login, a decision, a person's name, or money — so they can't be done
from the code. Everything is written step-by-step, no jargon.

_Last updated: 2026-05-22. Listed most important first._

---

## 1. Turn on database backups — most important, protects against data loss

**Why it matters:** Right now REDIP's database may have **no automatic backups**.
If something ever goes wrong, deal data could be lost permanently. This is the
single most important item on this list.

**What to do:**

1. 🌐 In your web browser, open this exact link:
   `https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/database/backups`
2. Look at the page. It will either show a **list of daily backups**, or a message
   saying backups are **not available on your current plan**.
3. **If backups are not available (you're on the Free plan):** click the
   **"Upgrade"** button on that page and choose the **Pro** plan (about US$25 a
   month). Pro includes automatic daily backups. Confirm the upgrade.
4. After upgrading, return to the same Backups page. Within a day you should see
   daily backups starting to appear in the list.
5. **Reply to me with:** `backups on` — or paste a screenshot of the Backups page
   if anything looks different from the above.

**One small follow-up, once backups exist:**

6. On that same Backups page, each backup has a **"Restore"** option next to it.
   You do **not** need to actually restore anything — just confirm the option is
   there and reply `restore option visible`. (A proper practice restore can be
   done later, carefully, together.)

---

## 2. Hire a lawyer for two legal documents — start early, lawyers take time

**Why it matters:** Large customers (funds, banks, REITs) will check that REDIP
has proper legal paperwork before they sign up. Two documents are missing, and by
law I must **not** write them myself — they have to come from a real Indian
lawyer.

**The two documents needed:**

- A **Data Processing Agreement (DPA)** — explains how REDIP handles customer data.
- An **Acceptable Use Policy (AUP)** — the rules for what customers may and may not
  do with REDIP.

**What to do:**

1. Find an Indian lawyer or law firm familiar with technology/software products
   and the **DPDP Act 2023** (India's data-protection law). A startup-focused
   lawyer is perfectly fine.
2. Ask them to draft a **DPA** and an **AUP** for an India-based real-estate
   software product.
3. When they send the drafts back, forward them to me — there is already a place
   in the website built and waiting to host legal documents, so I can wire them
   in quickly.
4. **Reply to me with:** `lawyer engaged` once you've hired someone, so I know
   it's in motion.

---

## 3. Give me two names for the emergency plan — quick, about 2 minutes

**Why it matters:** REDIP has a written plan for what to do if there is ever a
security problem. It has two blank spots that need real people's names.

**What to do — just reply to me in chat with these two names:**

1. **Incident Lead** — the person in charge if something goes wrong (this is
   probably you).
2. **Legal Liaison** — the person who would contact the lawyer (probably also you,
   for now).

That's it — send me the two names and I will fill them into the plan document.

---

## 4. Set up a security email address — quick, about 5 minutes

**Why it matters:** Security researchers and customers expect a `security@` email
address to report problems to. REDIP's documents already point people to
`security@redip.in`, but that mailbox doesn't exist yet, so any such email would
bounce.

**What to do:**

1. 🌐 Go to wherever you manage email for the **redip.in** domain (for example
   Google Workspace, Zoho Mail, or your domain provider's email settings).
2. Create a new mailbox or alias: **security@redip.in**.
3. Point it to your own inbox so you actually see anything sent there.
4. **Reply to me with:** `security mailbox done`.

---

## 5. Database tidy-up — no rush, I prepare it and you click one button later

**Why it matters:** Over time REDIP has built up dozens of small database update
files. Combining them into one clean starting point makes the project tidier and
faster to set up from scratch. It is **not urgent** and nothing is broken.

**What to do:** Nothing yet. When you want this done, just tell me
`do the database tidy-up` and I will:

1. Prepare the single combined file.
2. Give you exact click-by-click steps to apply it in Supabase — the same kind of
   steps you've followed for past database updates.

---

## 6. Get a domain + turn on email sending — unlocks sign-up emails and K-RERA deadline reminders

**Why it matters:** A few useful features need REDIP to be able to *send* email — the
sign-up verification + password-reset links, and (new) automatic **K-RERA deadline
reminders** ("your quarterly update is due in 7 days"). Right now REDIP can't send any
email because there's no verified sending domain. You mentioned you'll get a domain
soon — this is the step that switches all of that on.

**What to do (once you have a domain, e.g. `redip.in`):**

1. 🌐 Go to **https://resend.com**, sign up (free to start), and log in.
2. Click **Domains → Add Domain**, type your domain (e.g. `redip.in`), click Add.
3. Resend shows a few **DNS records**. Go to wherever you bought the domain (GoDaddy,
   Namecheap, Cloudflare, etc.), open its DNS settings, and add those exact records
   (copy-paste each — don't retype).
4. Back on Resend, wait until the domain shows a green **Verified**.
5. Click **API Keys → Create API Key** and copy the key (it starts with `re_…`).
6. 🌐 Open **https://vercel.com/rachitjain348-4262s-projects/redip/settings/environment-variables**
   and add two settings:
   - `RESEND_API_KEY` = the `re_…` key you copied.
   - `MAIL_FROM` = `REDIP <noreply@redip.in>` (use your real domain).
7. **Reply to me with:** `email sending on`. I'll then switch on the automatic
   K-RERA compliance-deadline reminders — that part is already built and waiting.

**Until then nothing is broken:** the K-RERA deadline calendar is fully visible on
screen and in the Word download; this only adds the *automatic email nudges* on top.

---

## How to use this file

- The items are in **priority order** — work top to bottom.
- Items **3** and **4** are quick wins (a few minutes each).
- Item **1** is the most important — please don't leave it for long.
- Item **2** has the longest lead time, so start looking for a lawyer soon even
  though everything else can wait.
- When you finish one, tell me and I'll keep this file up to date.
