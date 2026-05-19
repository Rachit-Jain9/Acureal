# BETA AI Tier — Pending Feature Roadmap

_Created 2026-05-19 after PR #426 (BETA per-user quota gate) shipped._
_Owner: Rachit. Review when first paid BETA users sign up._

This file tracks the 5 highest-impact features queued for the paid-BETA AI
tier. They're queued (not "next sprint pending") — the operator explicitly
parked them to focus on architecture wins first.

See also:
- `docs/PRICING.md` — pricing tiers + per-export economics.
- `SESSION_LOG.md` — chronological build history. The 2026-05-19 entries
  ship the foundation: PR-NX67 (AI augment layer), PR-NX69 (BETA quota gate).

---

## Status legend

- **QUEUED** — scoped, not started.
- **IN PROGRESS** — active branch.
- **SHIPPED** — merged to master.

---

## 1. PPTX cross-product parity for the 5 augment narratives

**Status:** QUEUED · **Effort:** ~1 hour · **Priority:** P0 for paid BETA

The AI augment layer (PR-NX67) ships content in the DOCX export only. The
investor-facing PowerPoint deck still shows the old "AI synthesis could
not be generated" placeholders for the 5 market-context sections.

**What to build:**
- Mirror the 5 augment narratives into the PPTX deck.
- 5 new slides (or 5 enhanced slides) — Why This Area, Demographics,
  Job Growth, Social Infrastructure, Supply & Demand Pipeline.
- Each slide carries the same "AI-GENERATED FROM GENERAL KNOWLEDGE"
  amber disclosure as the DOCX.
- Quota-exceeded message also surfaces on the PPTX (same pattern as
  the DOCX `augmentQuotaCallout` helper).

**Files touched:**
- `backend/src/services/exports/pptx/slides.js` — add 5 new render fns.
- `backend/src/services/exports/pptx/deckContext.js` — add 5 manifest entries.
- `backend/src/services/dealPptx.service.js` — add 5 switch cases.
- `backend/tests/dealPptx.service.test.js` — add 5 tests.

**Architecture pattern:** Follow PR-NX54 (the 3 NX43/44/45 narrative slides
already on the deck). Reuse `renderAiDisclosureBanner` + `renderAttributionFooter`
+ `renderUnavailablePanel` helpers — they already exist.

**Acceptance:**
- Download a Jigani PPTX → 5 new slides show Bengaluru content with amber
  AI banner.
- Download as a non-admin user who's exhausted quota → 5 slides show
  "Premium AI Insights · Quota Exceeded" message instead.

---

## 2. XLSX cross-product parity for the 5 augment narratives

**Status:** QUEUED · **Effort:** ~1 hour · **Priority:** P0 for paid BETA

Same gap as #1 but on the Excel workbook. The "AI Synthesis" tab
(PR-NX57) currently has the 3 NX43/44/45 narratives only.

**What to build:**
- Extend the AI Synthesis sheet with 5 new sections (one per augment).
- Each section: amber disclosure banner → content → attribution row.
- Quota-exceeded path renders a "Premium AI · Quota Exceeded" callout
  identical to the DOCX wording.

**Files touched:**
- `backend/src/services/exports/xlsx/v2/buildWorkbook.js` — extend the
  `buildAiSynthesisSheet` function with 5 new sections.
- `backend/tests/exports.xlsxV2.test.js` — add ~10 tests.

**Architecture pattern:** Follow PR-NX57 (the existing 3-section
implementation). Each section reuses `renderSectionBand` + `renderEyebrow`
+ `renderBodyText` + `renderAttribution` + `renderUnavailable` helpers.

**Acceptance:**
- Open Jigani XLSX → AI Synthesis tab shows 8 sections (3 existing + 5 new).
- Each has the same disclosure + attribution layout for cross-format
  consistency.

---

## 3. Admin Usage Dashboard

**Status:** QUEUED · **Effort:** ~2 hours · **Priority:** P1 for paid BETA

A new admin-only page at `/dashboard/admin/ai-usage` that lets the
operator see who's consuming AI quota and intervene.

**What to build:**

Backend:
- New route `GET /api/admin/ai-augment-usage` (admin/owner only). Returns:
  ```json
  {
    "users": [
      { "id", "email", "name", "role",
        "ai_augment_reports_used",
        "ai_augment_last_used_at",
        "is_at_limit": true|false }
    ],
    "summary": {
      "total_users": int,
      "users_at_limit": int,
      "users_with_quota": int,
      "reports_consumed_total": int,
      "reports_consumed_last_7d": int  // from ai_call_logs
    },
    "cost_summary": {
      "augment_task": "ai_market_context",
      "total_cost_usd_30d": float,
      "calls_30d": int,
      "avg_cost_per_call_usd": float
    }
  }
  ```
- Reuse `aiUsage.service.js` for the cost slice (already has
  `getAiUsage` that aggregates `ai_call_logs` by task).
- Admin override endpoint: `PATCH /api/admin/users/:id/ai-quota` with
  body `{ reports_used: int }` so the operator can reset a user's
  counter or grant extra credits. Audit-logged.

Frontend:
- New page `frontend/src/pages/AiUsageAdminPage.jsx`. KPI strip + sortable
  user table with columns: Email, Role, Used / Limit, Last Used, Reset
  button (admin/owner only).
- Add to navigation under Admin section.

**Files touched:**
- `backend/src/routes/admin.routes.js` (or new `admin.aiUsage.routes.js`)
- `backend/src/services/aiUsageAdmin.service.js`
- `frontend/src/pages/AiUsageAdminPage.jsx`
- `frontend/src/services/api.js` (adminAPI additions)
- Sidebar nav

**Acceptance:**
- Log in as admin → see new "AI Usage" admin nav item.
- Page loads with the user table + summary KPIs.
- Click "Reset to 0" on a user → toast confirms, counter resets, deal
  exports work for that user again.

---

## 4. "Use AI for this export" checkbox on Reports page

**Status:** QUEUED · **Effort:** ~1 hour · **Priority:** P1 for paid BETA

Today, every export auto-consumes a user's 1 free AI credit. The
checkbox lets non-admin users opt OUT of consuming their credit on a
given export — they get the structured-data-only report (free) and
save their AI credit for a deal that really needs it.

**What to build:**

Backend:
- Accept new query parameter `?ai_augment=false` on the 4 export endpoints.
- When `ai_augment=false`, skip the augment generation regardless of
  quota status. Counter is NOT incremented.

Frontend:
- Add a checkbox on Reports page: **☑️ Generate AI market narratives (uses 1 of your quota)**
- Default: checked for admin/owner (unlimited), unchecked for everyone else
  (so they OPT IN explicitly each time).
- Show remaining quota next to checkbox: "1 of 1 reports remaining."
- When unchecked, the export skips the augment entirely.

**Files touched:**
- `backend/src/routes/export.routes.js` — parse query param, pass to
  `getDealExportContext` as `options.skipAiAugment`.
- `backend/src/services/dealExport.service.js` — wire the option into
  the augment-call branch.
- `frontend/src/pages/ReportsPage.jsx` — add checkbox + quota counter.
- Tests on both sides.

**Acceptance:**
- Non-admin user opens Reports page → sees unchecked checkbox + "1 of
  1 reports remaining."
- They generate without checking → structured-data DOCX downloads,
  counter stays at 0.
- They check the box, generate → AI-augmented DOCX downloads, counter
  goes 0 → 1.
- Next export attempt with box checked → counter blocks, shows quota
  exceeded message.

---

## 5. "Request more quota" button + admin email

**Status:** QUEUED · **Effort:** ~1 hour · **Priority:** P2

When a non-admin user hits the quota wall, they should have a 1-click
way to ask the admin for more. Admin gets an email; admin can grant.

**What to build:**

Backend:
- New endpoint `POST /api/me/request-ai-quota` (auth required).
  Body: `{ deal_id?: uuid, message?: string }`.
- Looks up all admin/owner users in the requester's org, sends them an
  email via the existing email service. Email body: "<requester name>
  requested more AI quota for deal <deal name>. They've used <N> of
  their <limit> free reports. Click here to grant 1 more credit:
  https://redip.../dashboard/admin/ai-usage?grant=<user-id>"
- Rate-limited: 1 request per user per 24h.

Frontend:
- In the `augmentQuotaCallout` DOCX block — n/a (PDF output).
- Add an in-app banner on Reports page when quota=0: "Quota exceeded.
  **[Request more credits]** button."
- Toast on success: "Request sent to admin."

**Files touched:**
- `backend/src/routes/me.routes.js` (or new `quotaRequest.routes.js`).
- `backend/src/services/quotaRequest.service.js`.
- `backend/src/services/email.service.js` — new template.
- `frontend/src/pages/ReportsPage.jsx` — banner + button.

**Acceptance:**
- Non-admin hits quota → banner appears on Reports page.
- They click "Request more" → toast confirms, admin receives email
  within 1 minute.
- Admin clicks the email link → lands on AI Usage admin page with
  the requesting user's row highlighted + a "Grant +1" button.

---

## Implementation order recommendation

Logical bundle order when this gets picked up:

**Sprint 1 (4 hours):**
- #1 + #2 (PPTX + XLSX parity) — closes the cross-product gap, unlocks
  investor-facing paid BETA pitch.
- #4 (opt-in checkbox) — gives users explicit control over their credit.

**Sprint 2 (3 hours):**
- #3 (admin dashboard) — operator visibility into usage patterns.
- #5 (request-more workflow) — self-service quota requests.

That's ~7 hours of focused work to ship the complete paid-BETA loop.
Defer to when pricing is finalized.

---

## Architectural decisions baked in

These are NOT up for debate during implementation — they're settled:

- **Augment is a SECOND-CHANCE FALLBACK.** Verified payload data always
  wins. Augment only fills empty sections.
- **No fabricated numbers.** AI is prompted to use qualitative framing
  only. Specific INR/sqft, km, % are NEVER generated.
- **Disclaimer is non-negotiable.** Every augmented section carries the
  amber "AI-GENERATED FROM GENERAL KNOWLEDGE" banner. Per CLAUDE.md.
- **Admin / owner bypass.** Always unlimited. Defensive DB re-check
  protects against stale JWTs.
- **Outage protection.** If Claude is down and all envelopes fail, no
  counter increment. User isn't punished for our outage.
- **English only.** Defence-in-depth regex strips non-Latin scripts.
- **Kill switch.** `AI_MARKET_CONTEXT_ENABLED=false` disables augment
  globally without a redeploy.
