# REDIP Session Log

Running history of every working session. Read this to understand what was built, what changed, and what's next — even if the chat session is gone.

---

## 2026-05-30 (Master-plan upload file_type parity — extend the #663 hardening to the regulatory source path) (PR #666)

Follow-up to **PR #663**, which hardened the *deal-document* direct-upload confirm step to derive `file_type` server-side from the file extension and ignore the client's claim. The parallel *master-plan source-document* confirm step (`confirmSourceDocumentUpload`) had been left trusting and storing the client-supplied `fileType` straight into `regulatory_data.master_plan_documents.file_type`.

Not currently exploitable as inline stored-XSS — the only master-plan serve path (`getSourceDocumentDownload` → `getDownloadUrl`) signs with `{ download: true }`, so Supabase serves the file as `Content-Disposition: attachment`, and the stored `file_type` is only read for extraction routing (`isExtractableSource`), never emitted as an HTTP header. Shipped for **defense-in-depth + parity** with the deal path.

### PR opened (CI green)

| PR | What landed |
|---|---|
| [#666](https://github.com/Rachit-Jain9/REDIP/pull/666) | **security(masterplan): server-derive source-document content-type.** New `SOURCE_EXT_TO_MIME` map (covers every `ALLOWED_SOURCE_EXTENSIONS` entry) + `sourceContentType()` helper (fallback `application/octet-stream`). `confirmSourceDocumentUpload` stores `sourceContentType(<validated filename>)` instead of `textOrNull(fileType)`; the filename is captured once before the corpus merge reassigns `planName`. Extraction routing preserved — every `EXTRACTABLE_EXTENSIONS` entry maps to a pdf/image MIME, so `isExtractableSource` still matches via both its extension and mime branches. +3 regression tests (client-claimed `text/html` `.pdf` → stored `application/pdf`; `.png` → `image/png`, stays extractable; `.docx` can't be spoofed extractable). Full backend suite 2926 green (comps-queue suites excluded — separate in-flight WIP). All 7 CI checks green. |

### Environment note
The OneDrive-synced repo hit the documented git-corruption hazard hard this session — branch labels/refs flipped repeatedly mid-work (another machine's active comps-queue-preview hardening session was replaying refs into the shared checkout). Worked around it: based everything off the verified remote `origin/master`, guarded every commit on HEAD/branch identity, and pushed by explicit commit SHA. Feature commit + PR landed safely on origin despite the local churn.

### What's left for the operator
1. **Authorize the merge** of #666 (reply "merge"). No migration or manual step required.

---

## 2026-05-30 (Document-pipeline hardening — finish the upload/serve security surface, red-teamed) (PR #663)

Block goal: complete the document-security surface that PR #658 (critical cross-tenant fix) opened — the medium upload/serve findings (#6/#7) from the security audit. On orientation, found that **#8 (document-access audit logging) had already shipped + merged** via an earlier spawned task: `DOCUMENT_ACCESSED` event + `documentAccessLog.sink.js` (migration-tolerant) wired into all three download paths, plus the migration file `20260530_document_access_log.sql`. Flagged that migration for the operator to run (TODO_MANUAL.md) — until then access-logging no-ops harmlessly.

### PR opened (CI green)

| PR | What landed |
|---|---|
| [#663](https://github.com/Rachit-Jain9/REDIP/pull/663) | **Document upload/serve hardening (#6/#7).** confirmDirectUpload now validates server-side instead of trusting the client: re-checks the extension allow-list, derives `file_type` from a new `EXT_TO_MIME` map (ignores the client's `fileType` — a `.pdf` PUT as `text/html` is stored as `application/pdf`), and verifies the **true** object size via `getObjectSize` (Supabase `.list` metadata) → 413 + logged best-effort cleanup. `storage.getDownloadUrl` signs Supabase URLs with `{ download: true }` so documents are served `Content-Disposition: attachment`, never rendered inline → a file built to execute can't run as a script when opened. `supabase.getSignedUrl` gained a back-compatible `options` arg. +3 tests (11 in document.security suite); full backend suite 2981 green. |

### Adversarial red-team of the diff (15 agents, 4 angles: XSS-bypass, validation-bypass, regression, signature-compat)
**Rejected 7 of 11 raised** — independently confirmed (against the installed `@supabase/storage-js`) that `download:true` is honoured, the deal-document + master-plan + extraction sinks are all covered, the #658 SSRF + cross-tenant guards are intact, no regressions, no contract breaks, suite green. **4 confirmed, all low/medium, none same-origin XSS:**
- **Medium (scope gap, NOT defeat):** the **comps review-queue** detail page still renders `raw_doc_url` (a Vercel Blob URL) in an `<iframe>`/`<img>` — a separate, admin-gated sink the deal-document fix doesn't cover. The writer MIME allow-lists exclude `text/html`/`svg` and the blob host is cross-origin (no app session), so the residual is a sandboxed inline-PDF render, not script execution. **Spawned as a follow-up task** (route comps preview through a guarded download/stream path + tighten the https gate).
- **Low:** the true-size check is fail-**open** if storage metadata is unavailable (cost/quota control only, behind org-auth). Kept fail-open (a fail-closed check could block legit uploads if metadata lags after PUT); flagged to verify `metadata.size` population on a live bucket.
- **Low nit (fixed in-PR):** the 413 cleanup-delete now logs failures instead of swallowing them.
- **Low nit (intended):** master-plan "Open source" now downloads the regulatory PDF instead of opening it inline — the same no-inline-serve hardening; noted in the PR.

### Flagged for the operator (recorded in TODO_MANUAL.md)
1. **Run migration `20260530_document_access_log.sql`** (Supabase SQL editor) — until then sensitive-document access isn't recorded (the code is migration-tolerant + no-ops).
2. **`RESEND_API_KEY` deferred** until a sending domain exists (operator decision) — prod email fails closed meanwhile (no token leak). Also set `AI_DAILY_COST_CAP_USD`.
3. **Confirm the old Google Maps key is deleted in Google Cloud Console** (Vercel was updated; the old key is in git history → burned until deleted in GCP).

### What's left for the operator
1. **Authorize the merge** of #663 (reply "merge").
2. Do the three items above (the doc-access migration + the Google-key GCP deletion are the substantive ones).
3. Optional one-click follow-up chips left in the session: comps-preview inline hardening; the earlier document-access-logging is already merged.

---

## 2026-05-30 (Document-access audit log — closes deferred security item #8) (PR #662)

Closes the one MEDIUM compliance gap left open from the security-hardening block (PRs #658–#660): CLAUDE.md requires logging access to sensitive documents, but none of the three download paths recorded one. Followed the spawned-task spec exactly, including the verifier's constraint to keep document events out of the closed-enum `activities` timeline.

### PR opened (CI green)

| PR | What landed |
|---|---|
| [#662](https://github.com/Rachit-Jain9/REDIP/pull/662) | **feat(security): immutable access log for sensitive-document downloads.** New append-only `document_access_log` table — org-scoped RLS (read + insert), **no UPDATE/DELETE policy** → append-only; **polymorphic `document_id`** (deal documents *and* masterplan source PDFs) with **no FK** so the audit row survives document deletion; snapshotted `document_name`. New `DOCUMENT_ACCESSED` event + fail-open `documentAccessLog.sink` (mirrors the `DOCUMENT_UPLOADED` → sink pattern). The three download paths — `document.service.getSignedUrl` (`signed_url`), `streamDownload` (`download`), and `masterplan.service.getSourceDocumentDownload` (`masterplan_source` / `signed_url`) — publish on **successful access only** (never on a 404 / storage error); routes thread `req.user.id` + `req.user.organization_id` + `req.ip` + user-agent. **Deliberately NOT routed into `activities`** — its `activity_type` is a closed enum that excludes document events and would pollute the investor-facing deal timeline (the verifier's explicit constraint). +3 test files. |

### Verification
Full backend suite green (**2978**). Migration passes `scripts/lint-migrations.js` **and** `scripts/audit_rls.py` (RLS-coverage gate) — `document_access_log` is counted among the 41 org-scoped tables that are RLS-protected with ≥1 policy. CI "Audit & migration lint" job green; backend/frontend/kernel running at time of writing.

### What's left for the operator
1. **Run the one database update** that creates the table — exact click-by-click Supabase SQL-editor steps are in the PR #662 body. The app fails open until then: downloads keep working, the access rows just aren't saved yet.
2. **Authorize the merge** of #662 when ready (not merged autonomously, per the merge-boundary rule).

---

## 2026-05-30 (Security + data-integrity hardening + an app-wide bundle win — adversarially audited) (PRs #658–#660)

Block goal: the biggest un-audited surface for an investor-grade platform with enterprise diligence in the pipeline is **security + data integrity**. Ran a 6-dimension adversarial **Workflow** (access-control/IDOR, injection/SSRF, secrets exposure, file-upload/document security, data-integrity/financial correctness, resilience/cost-DoS) — 29 agents, every finding re-verified against the real code by a skeptic agent and classified auto-fixable vs flag-for-operator. **11 confirmed (1 critical, 2 high, 6 medium, 2 low); 1 rejected.** Implemented all 10 auto-fixable; flagged the 1 credential item. Separately, live bundle analysis surfaced an app-wide perf bug (recharts on nearly every page).

### PRs opened (all CI green)

| PR | What landed |
|---|---|
| [#658](https://github.com/Rachit-Jain9/REDIP/pull/658) | **🔴 CRITICAL — cross-tenant document exfiltration + storage SSRF.** `confirmDirectUpload` stored the client-supplied `storagePath` verbatim; downloads sign it with the Supabase **service-role** key (bypasses storage RLS), so an org-A user could confirm a row at org-B's key and download another tenant's title deeds / financials. A `storagePath` of `https://attacker/…` made the download/extraction fetch an SSRF. Fix (pure app-layer, no RLS/migration): re-derive the expected `organizations/<org>/deals/<deal>/` prefix and reject scheme/`..`/absolute/cross-org paths; `getDownloadUrl`/`fetchStoredFile` only pass an https value through when it is a genuine `.blob.vercel-storage.com` object (closes the SSRF even for legacy/poisoned rows); generic client error messages (provider internals logged server-side only). +8 regression tests. |
| [#659](https://github.com/Rachit-Jain9/REDIP/pull/659) | **Security hardening sweep.** (a) **SSRF** — the Maps-shortlink redirect-follow re-validates every hop against a Google-owned-host check and dropped the generic `goo.gl` shortener. (b) **Cost-DoS** — dedicated `aiLimiter` (20/min, keyed by user→IP) on the genuinely-expensive AI routes (Q&A, qa/stream, sensitivity-/risk-narrative, property capture); **workspace deliberately excluded** because its narration is now response-cached (PR #651), so limiting it would throttle normal navigation; + `AI_DAILY_COST_CAP_USD` surfaced as a boot warning. (c) **Mailer** — fails closed in prod instead of logging verification/reset tokens; recipient emails redacted (`a***@domain`); `RESEND_API_KEY` surfaced as a boot warning. |
| [#660](https://github.com/Rachit-Jain9/REDIP/pull/660) | **Bundle — recharts (115 KB gz) off every non-chart page.** `clsx` (a 0.5 KB helper used almost everywhere AND by recharts) had no explicit chunk, so Rollup trapped it inside `vendor-recharts` — meaning every component using `clsx` (Badge, CollapsibleCard, DashboardPage, …) statically pulled the whole recharts chunk. Pinned `clsx` to a 0.37 KB `vendor-utils` chunk + lazy-loaded the two dashboard chart widgets. Verified against the built output: recharts is now imported by exactly 2 chunks (lazy DashboardCharts + FinancialsPage), down from ~dozens. |

### Verification
Full backend suite **2949–2953** across the branches; frontend **1057**; frontend build green; `npm audit --audit-level=high` clean. Every PR's Backend/Frontend/Kernel checks green.

### Flagged for the operator (cannot be done in code)
1. **🔑 Rotate the Google Maps API key — REQUIRED.** A live billable key (and its "rotated-to" replacement) is committed in `SESSION_LOG.md` **and in git history** (commit 55045e7). Redacting the doc (done this block) does NOT revoke it. Treat **both** committed values as burned: in Google Cloud Console, generate a fresh **third** key, set it as `GOOGLE_MAPS_API_KEY` + `VITE_GOOGLE_MAPS_API_KEY` in Vercel, restrict the browser key to HTTP referrers (`redip.vercel.app/*`, `*.vercel.app/*`, `localhost`) and the server key to the Geocoding/Places APIs, and set a billing budget/quota cap. (Exact click-by-click steps are in the chat recap.)
2. **Set `AI_DAILY_COST_CAP_USD` and `RESEND_API_KEY` in Vercel** — the boot now warns when either is unset. The cap is the only hard ceiling on AI spend; without `RESEND_API_KEY`, prod email now fails closed (won't send) rather than logging tokens.

### Deferred (tracked follow-ups)
- **Document-pipeline mediums (#6/#7):** server-side MIME/size validation on the direct-upload path + serving uploads as attachments (kill stored-XSS via inline content-type). App-layer, no migration — own focused PR.
- **Document-access audit logging (#8):** CLAUDE.md requires logging sensitive-document access; none of the download paths do. Needs a one-table migration + a `DOCUMENT_ACCESSED` event sink (do NOT route into the `activities` table — it validates against a closed activity-type list). Spawned as a task.
- **In-page form labels:** PropertyDetailPage (~49 controls) — the remaining form after last block's RiskTab/DDTab/modal pass.

### What's left for the operator
1. **Authorize the merge batch.** Recommended order: **#658 first (CRITICAL)**, then #659, #660. Reply "merge all" and I'll merge in order (rebasing each onto master so CI re-greens) and confirm the production deploy lands on the true tip.
2. **Do the two env / key actions above** (key rotation is the important one).

---

## 2026-05-30 (Deal-page performance + accessibility + a security unblock — measured, adversarially audited) (PRs #651–#655)

Block goal: differentiate from prior bug/correctness blocks by going after **performance, accessibility, and integration** — measured where possible, not vibes. Opened with a 6-dimension multi-agent **Workflow** (bundle splitting, backend deal-page latency, React render, network/caching, accessibility, cross-module integration). 30 agents, each finding adversarially verified against the real code by a second skeptic agent. 9 findings confirmed, 1 rejected, 2 dimensions (bundle + integration) lost to a structured-output failure and re-checked by hand instead. The confirmed findings clustered hard on **backend deal-page latency**, with one issue flagged independently by two dimensions.

### PRs opened (all CI green except the pre-existing axios audit, which #655 fixes)

| PR | What landed |
|---|---|
| [#651](https://github.com/Rachit-Jain9/REDIP/pull/651) | **perf: take AI narration off the hot deal-workspace read path.** `getDealWorkspace` — the single read behind the whole deal page — re-ran the recommendation **and** deal-doctor AI narrators synchronously on every load (one live LLM round-trip per `ai_narratable` card, + reprompt, + call-log writes), with no cache, the two narrator phases serialized, and a 30s client `staleTime` that re-fired the whole read (re-narrating server-side) on revisits. Three low-risk, verified changes: (1) **cache-gate `narrateCard`** with a content-addressed `cache:{inputSha256,promptSha256,promptVersion}` (mirrors `aiMarketContext.service.js`) so an unchanged deal viewed again is a cache hit — no SDK call, no tokens; covers both narrators. (2) **parallelize** the recommendation + deal-doctor slices (`Promise.all` of two `optional()` thunks; IC-readiness consumer still runs after). (3) raise `useDealWorkspace` `staleTime` 30s → 5min (mutations already invalidate `['deal-workspace',id]`). +2 narrator tests assert the cache descriptor is content-addressed. Backend 2945 / frontend 1057 green. |
| [#652](https://github.com/Rachit-Jain9/REDIP/pull/652) | **a11y: convert six raw-div modals to the `Modal` primitive.** New Deal + bulk Archive/Reassign/Stage/Delete (DealsPage) and Add Comparable (CompsPage) were hand-rolled `fixed inset-0` overlays — no focus-trap, no Escape, no `role="dialog"`/`aria-modal`. All six now use `design-system/Modal` (portal, focus-trap, Escape, scroll-lock, animated, reduced-motion fallback). Behaviour preserved: bulk modals still gate close while busy; Delete keeps its rose treatment + type-DELETE-to-confirm; New Deal / Add Comparable keep `<form>` submit via the HTML `form="…"` attribute on the footer Button. Every dialog control gained `htmlFor`/`id`. ~430 lines of overlay boilerplate removed; DealsPage chunk 55.5 → 50.0 KB. |
| [#653](https://github.com/Rachit-Jain9/REDIP/pull/653) | **perf: reuse one financials row instead of fetching it ~5×.** `getDealById` already loads `deal.financials` after proving visibility; the composer then re-fetched it 4 more times (its own `getFinancials` + `getScenarios`/`getFinancialGraph`/`listDealEvents` each calling `getFinancials` as a visibility gate — every one an `INNER JOIN deals` re-check). Added an optional `{financialsRow}` to those three (shared `resolveFinancialsRow` preserves `getFinancials`' exact 404 contract for standalone callers) and threaded `deal.financials` through. RLS still guards the table, so the trusted-composer skip opens no hole. 5 reads → 1, full parallelism kept. Workspace test updated to the new contract; backend 2943 green. |
| [#654](https://github.com/Rachit-Jain9/REDIP/pull/654) | **a11y: associate labels with controls in the Risk + DD/Approval forms.** RiskTab (new-flag + per-card edit form — edit ids suffixed with the flag id) and DDTab (new-DD-item + new-approval forms, + an `aria-label` on the per-row status dropdown) had visual-only labels with no `htmlFor`/`id`; the selects announced nothing to screen readers. Purely additive attributes. Build green, RiskTab tests pass. |
| [#655](https://github.com/Rachit-Jain9/REDIP/pull/655) | **chore(security): bump axios 1.15.2 → 1.16.1.** Live audit of the open PRs found the **Audit & migration lint** CI gate failing identically on all of them — not from this block's code, but because axios 1.15.2 sits in the affected range of four HIGH advisories (NO_PROXY bypass / prototype-pollution DoS + header-injection + full MITM). 1.16.1 patches all four within the existing `^1.6.2` range; bumped in both backend (the audited workspace) and frontend. `npm audit --audit-level=high` now exits 0; backend 2943 / frontend 1057 green. **Merging this first turns CI green on #651–#654.** |

### Findings confirmed but deferred (tracked, not done this block)
- **AI narration → lazy on-demand endpoint** (the bigger first-paint win past the cache-gate) — needs its own client hydration UX; #651 captured the low-risk share.
- **Document / activity / waterfall visibility re-checks** — same "already-authorized read variant" pattern as #653, separate smaller pass.
- **Kernel graph/scenarios recompute-on-read** — persist `financialGraph` into `model_params` with an `engineVersion` gate (verifier flagged staleness risk without the gate).
- **Deal-mutation over-invalidation** — `useDeals` mutations invalidate 7+ cache trees; verifier rated it low/optional and flagged archive/restore as possibly-dead UI.
- **In-page form labels** — PropertyDetailPage (~49 controls) is the remaining form after #654.
- **Dashboard recharts (115 KB gz) on the landing path** — already a separate vendor chunk; deferring it needs a chart-component extraction + Suspense, marginal once cached.

### Parked for operator review
- An **uncommitted working-tree change was found on master at session start**: it deleted the entire "Sources & Uses" + permanent-refinance card from `HospitalityProformaSection.jsx` (103 lines). Provenance unknown, outside this block's scope, and removing a standard institutional financial output is a product call I won't make silently. **Stashed** (`git stash` — fully recoverable) so the tree was clean. Operator: tell me "restore it" or "ship the removal" and I'll act.

### Verification
- Backend suite **2943** (2945 on #651 with its +2 tests); frontend suite **1057**; frontend build green; `npm audit --audit-level=high` exits 0 both workspaces. Each PR's Backend/Frontend/Kernel/Vercel checks are green; the audit gate goes green once #655 lands.

### What's left for the operator
1. **Authorize the merge batch.** Recommended order: **#655 first** (turns the audit gate green everywhere), then #651, #653 (backend perf), then #652, #654 (frontend a11y). Merging = production deploy, so this needs your go-ahead. Reply "merge all" and I'll merge in that order and confirm the production deploy lands on the true tip.
2. **Decide on the parked "Sources & Uses" removal** (restore vs ship).
3. Optional: live smoke-test the deal page after deploy (modals open/close with keyboard, deal page feels snappy on revisit).

---

## 2026-05-28 (Smart Property Capture — collapse the 6-click new-property flow into one paste) (PR #626 + #628 + #629)

Operator brief: linking a property to a deal felt "complex, tedious, confusing, and annoying." The New Deal modal's Property dropdown only showed existing properties, so for every new opportunity (which by definition has a new address) the user had to (1) save the deal with no property, (2) open the deal, (3) navigate to Parcel/Site tab, (4) click Link Property, (5) click "+ Create new", (6) blindly fill a 7-field form with no map / no auto-fill / no confidence — six clicks before the first real action.

First-principles audit confirmed the infrastructure was already in REDIP — Google Places + Geocoding, Plus Codes, K-GIS adapter, BBMP street index + guidance value, the auto-derive-context orchestrator, Gemini extraction — the 7-field form just used none of it. Reframed as **Smart Property Capture**: one paste box that accepts any Bengaluru-sourcer-realistic input, then one preview card with map + BBMP/K-GIS/guidance enrichment + verify-links, then save.

### PRs opened + merged

| PR | What landed |
|---|---|
| [#626](https://github.com/Rachit-Jain9/REDIP/pull/626) | **Backend — parser + capture endpoint.** New `backend/src/utils/propertyCaptureParser.js` (pure detection, no I/O): classifies a raw input as `googleMapsUrl` / `latLng` / `plusCode` / `surveyNumber` / `freeText` / `address` via regex + URL allow-list (SSRF-safe). New `backend/src/services/propertyCapture.service.js` (orchestrator): per-classification resolvers — shortlink redirect-follow for `maps.app.goo.gl`, Google Geocoding for Plus Codes (defaults Bengaluru area context for short codes), reverse-geocode for lat/lng, existing geocoder cascade for addresses, Gemini structured-output extraction for broker narratives (area / asking / asset class / deal structure). Fans out to `deriveParcelContextFromAddress` so the candidate already carries BBMP ward + K-GIS hierarchy + guidance value before the response leaves the server. New `POST /api/properties/capture` route placed above the `/:id` catch-all per the PR #380 ordering rule. **57 new tests** (38 parser unit + 19 service tests with mocked axios / geocoder / Gemini). Also includes a `chore(audit): npm audit fix` commit that cleared the pre-existing high-severity `tmp` Path Traversal CVE blocking CI. |
| [#629](https://github.com/Rachit-Jain9/REDIP/pull/629) | **Frontend — `<PropertyCaptureField>` + replace the 7-field form.** New `frontend/src/components/deal/PropertyCaptureField.jsx` (~340 LOC): two-phase UX — capture (paste + AI-extract checkbox + Capture button) → preview (classification chip, geocode-confidence badge, mini Leaflet map with the resolved pin, fields grid for address/coords/BBMP ward/K-GIS taluk-village/survey/guidance value, AI-extraction panel for free-text narratives, verify-links chips to Bhoomi / K-GIS / Google Sat, warning banner for low-confidence matches, editable name input, Save button that POSTs `suggestedFields` to `/properties`). New `useCaptureProperty` hook + `propertiesAPI.capture()` client. `PropertyPickerModal` inside `ParcelTab.jsx` drops its 7-field create form and renders `<PropertyCaptureField compact />` instead; modal widens to `max-w-2xl` in create mode to fit the preview card. **7 new component tests** (mocked hooks + Leaflet). |
| [#628](https://github.com/Rachit-Jain9/REDIP/pull/628) | **Inline capture in the New Deal modal — closes the 6-click loop.** Adds `propertyMode` state to `DealsPage.jsx` (`'pick'` ↔ `'capture'`). The Property field now has a "+ Create new (paste link / Plus Code / address)" toggle next to the dropdown label; clicking it expands `<PropertyCaptureField>` inline below. On save, `handlePropertyCaptured` sets `form.propertyId` to the new ID, defaults the Deal Name to the captured property name (when blank — saves a keystroke for the common "name-the-deal-after-the-parcel" case), and flips back to the picker (which auto-selects the new property because `useCaptureProperty` invalidates the properties cache). Also added `onKeyDown={Enter→preventDefault}` to the capture field's name input so it doesn't accidentally submit the parent New Deal form. |

### Production verification (live on `redip.vercel.app`)

- Master CI on post-merge build: all five checks green — Audit & migration lint, Backend, Frontend, Financial kernel, CI passed.
- Vercel production deployment: Ready (green) on master after PR #628 merged.
- Pending: operator manual smoke test of the actual paste-flows (a Google Maps shortlink, a Plus Code, a survey number, a broker narrative) on the live site.

### Cumulative impact (this block)

- **Backend tests**: 2,873 → **2,930** (+57: 38 parser + 19 service)
- **Frontend tests**: 1,035 → **1,042** (+7 component tests)
- **New canonical modules**:
  - `backend/src/utils/propertyCaptureParser.js` — ~270 LOC, pure classifier
  - `backend/src/services/propertyCapture.service.js` — ~430 LOC, orchestrator
  - `frontend/src/components/deal/PropertyCaptureField.jsx` — ~340 LOC, capture + preview
- **New route**: `POST /api/properties/capture` (route placed above `/:id` per ordering rule)
- **Friction removed**: New-deal-with-new-property flow goes from **6 clicks + 7 blank fields** → **2 clicks + 1 paste**.

### What the user can see now that they couldn't before

1. **Open the New Deal modal** → next to the Property dropdown there's a new toggle: **"+ Create new (paste link / Plus Code / address)"**. Click it and a paste box expands inline.
2. **Paste a Google Maps share link** from a broker's WhatsApp → REDIP follows the shortlink, extracts coordinates, reverse-geocodes the address, runs BBMP / K-GIS / guidance enrichment, and shows a preview card with a mini map and one Save button.
3. **Paste a Plus Code** like `3JV8+P4W Bengaluru` → same flow, resolved via Google Geocoding with Bengaluru defaulted as the area context for short codes.
4. **Paste a survey number** like `Survey No. 45/2, Devanahalli` → REDIP geocodes the village context, keeps the survey number on the candidate, surfaces the Bhoomi / K-GIS verify links for manual confirmation (legal four — survey/khata/title/RERA — stays human-verified).
5. **Paste lat/lng coordinates** → reverse-geocoded to address with provider/confidence shown.
6. **Paste a broker WhatsApp narrative** like `"5 acres on KIAL road near airport, asking 18 cr, RERA registered"` → Gemini extracts area/asking/asset-class/deal-structure into the suggested fields, then the address is geocoded, then the candidate is built. The "AI-extracted" violet panel makes provenance obvious.
7. **The same `<PropertyCaptureField>` is also wired into the Link Property modal's "+ Create new" tab** — so the improvement reaches both the new-deal-from-scratch path AND the link-property-to-existing-deal path.

### CLAUDE.md respected

- **AI routing policy honored** — free-text extraction is Gemini (per "document/text extraction" routing); deterministic math (lat/lng parsing, Plus Code detection, address dedup) is pure code. No LLM in any decision path that touches title chain / khata / RERA / approvals (the legal four).
- **No fabrication** — every resolved field carries the provider + confidence. Low-confidence matches (<0.7 or `status='approximate'`) raise an amber warning banner. Failed resolution returns warnings + suggested-field nulls; UI never paints a fake pin.
- **SSRF-safe** — the URL parser allow-lists Google-owned hosts only (`maps.app.goo.gl`, `goo.gl`, `maps.google.com`, etc.); anything else is rejected before any HTTP fetch.
- **Cost-aware** — Gemini is opt-in via the `aiAssisted` request flag (default true, but the frontend exposes a checkbox); pure-format inputs (Plus Code / URL / lat/lng / survey number) never touch Gemini.
- **Route ordering** — `POST /capture` is above the `GET /:id` catch-all (PR #380 ordering bug pattern explicitly avoided).
- **Single capture component reused** — `<PropertyCaptureField>` lives in `frontend/src/components/deal/` and is consumed by both `ParcelTab.jsx` (Link Property modal) and `DealsPage.jsx` (New Deal modal). One source of truth for the capture UX.
- **PR cadence** — three decomposed PRs, chained in order; each PR ships independently if needed (backend without the frontend still adds a usable API; frontend without #628 still improves the Link-Property flow).

### What's left for the operator

1. **Manual smoke test on the live site** — try each input type once and confirm the preview card renders correctly (map pin + BBMP ward + K-GIS + verify links).
2. **Eventually**: a follow-up PR for the remaining 3 moderate npm audit advisories (`@anthropic-ai/sdk`, `uuid`, `exceljs` — all require `--force` / breaking dep bumps; intentionally deferred to a dedicated PR that can validate the breaking changes).
3. **Optional follow-up**: drop-a-pin mode (a "I literally only have a pin on a map" entry path that opens the Leaflet map for the user to click directly) — designed but not built this block; the capture flow already covers it because the user can right-click a Google Maps pin → copy coordinates → paste, but a native pin-drop UI would be slicker.

---

## 2026-05-27 (ninth 10-hour block — E7: Admin Dashboard) — Phase 4 main now COMPLETE (PR #623–#624)

Continuation immediately after the eighth block (Pillar 7 V2). Operator brief asked for the next phase; only E7 (Admin Dashboard) remained on the Phase 4 main list. Audit confirmed the existing admin nav already had AI Usage, A/B Eval, Comps Queue, Parcel Intelligence, and Master Plan — what was missing was operator visibility into the **learning-loop telemetry** (PR #618's consumer would tell the engine to re-rank cards but nobody could see what was captured) and a **filtered audit-trail surface** on `deal_events` (the dashboard widget showed only the last 10 events with no filters). Plus there was no unified `/admin` landing — the operator had to click into each sub-page individually.

### PRs opened + merged

| PR | What landed |
|---|---|
| [#623](https://github.com/Rachit-Jain9/REDIP/pull/623) | **E7-PR1 — Learning Signal Health admin view.** New `learningSignals.adminReport.service.js` (~310 LOC) with five aggregator methods (`getSummary`, `getTopRules`, `getActiveAdjustments`, `getDailySeries`, `getDashboard` composite). New `GET /api/admin/learning-signals?days=N` route. New `AdminLearningSignalsPage.jsx` with 4 KPI cards (verdicts captured, dismiss/apply rates, attribution rate), stacked daily-trend sparkline (no chart library — keeps admin bundle slim), currently-active adjustments list (mirrors the consumer's `computeMultiplier` policy exactly so the page shows what the engine IS doing right now), and side-by-side top-dismissed / top-applied leaderboards. New `useLearningSignals` hook, new `adminAPI.getLearningSignals()` client, new sidebar entry, new route behind `RequirePlatformAdmin`. **15 new backend tests** covering zero-baseline, missing-table tolerance, percentage math, day-window clamping, leaderboard ordering, full active-adjustments policy alignment (legal carve-outs stay at 1.0, acted ≥ dismissed stays at 1.0, ≥6 dismiss → 0.7 floor, ≥3 → 0.85, strongest-first sort + tiebreak by dismiss_count desc). |
| [#624](https://github.com/Rachit-Jain9/REDIP/pull/624) | **E7-PR2 + E7-PR3 — Audit Trail + Admin Home landing.** Bundled because they're a cohesive set. **Audit Trail**: new `GET /api/admin/audit-trail?days=N&eventType=X&dealId=Y&limit=L` endpoint (the dashboard's lightweight `/recent-events` widget endpoint stays unchanged — backward-compatible). New `AdminAuditTrailPage.jsx` with filter chips (window 24h/7d/30d/90d/year, event type with counts, row limit 50/100/200), refresh button, compact events table with relative time + tooltip absolute time, event-type tone badges (info/amber/rose), click-through deal links, HMAC-chain footer. New `useAuditTrail` hook, new `adminAPI.getAuditTrail()`. **Admin Home**: new `AdminHomePage.jsx` at `/dashboard/admin` (no subpath — first page the operator hits when clicking Admin). Seven tiles (AI Usage / Learning Signals / Audit Trail / Comps Review / Parcel Intelligence / Master Plan / A/B Evals), each with live KPI snapshots where data is available — tiles share the same hooks the detail pages use so React Query dedupes the fetch when the operator drills in. Two new sidebar entries (Learning Signals · Sparkles icon, Audit Trail · ShieldCheck icon). |

### Production verification (live on `redip.vercel.app`)

- **`/dashboard/admin`** → 7 tiles render: AI Usage & Cost (with "Today" eyebrow), Learning Signals (with "Last 7 days"), Audit Trail (with "Last 24h"), Comps Review Queue, Parcel Intelligence, Master Plan, A/B Evaluations.
- **`/dashboard/admin/learning-signals`** → 4 KPI cards (Verdicts captured / Dismissed / Applied / Attribution rate), "Verdicts per day · 30-day window" trend, "No rules are currently being de-ranked" (correct empty state for a fresh org), Top dismissed + Top applied leaderboards, window picker chips (7/30/90/Year).
- **`/dashboard/admin/audit-trail`** → Header "0 events in the last 7 days" (correct empty state for a fresh org), 9 filter chips render: window 24h/7d (active)/30d/90d/Year, event-type "All (0)" (active), limit 50 (active)/100/200.

### Cumulative impact (this block)

- **Backend tests**: 2,858 → **2,873** (+15 across the adminReport aggregator)
- **New canonical modules**:
  - `backend/src/services/learningSignals.adminReport.service.js` — 310 LOC, five aggregator methods over `improvement_signals`
  - `frontend/src/pages/AdminLearningSignalsPage.jsx` — 310 LOC, KPIs + sparkline + adjustments + leaderboards
  - `frontend/src/pages/AdminAuditTrailPage.jsx` — 230 LOC, filtered events table
  - `frontend/src/pages/AdminHomePage.jsx` — 165 LOC, 7-tile composition
  - `frontend/src/hooks/useLearningSignals.js`, `frontend/src/hooks/useAuditTrail.js`
- **New routes**:
  - `GET /api/admin/learning-signals` (composite payload)
  - `GET /api/admin/audit-trail` (filtered events + catalog)
  - Frontend: `/dashboard/admin` (new home), `/dashboard/admin/learning-signals`, `/dashboard/admin/audit-trail`
- **Sidebar**: 5 → **7** admin entries (alphabetical within group)

### What the user can see now that they couldn't before

1. **Click "Admin" in the nav** → land on **Operations Home** with 7 tiles showing live snapshots: AI spend last 24h, learning-loop verdicts last 7 days + how many rules are being de-ranked right now, audit events last 24h. Click any tile to drill in.
2. **Click "Learning Signals"** → see the verdicts captured this month, the dismiss / apply rates, the daily trend (red / amber / green stacked sparkline for dismissed / snoozed / applied), and the **list of rules the engine is currently de-ranking** (each row shows the exact 0.7× or 0.85× multiplier the consumer applies + the policy reason).
3. **Click "Audit Trail"** → see every HMAC-signed kernel run across the org, filterable by time window / event type / row limit. Click any deal name to open the full workspace in a new tab. The footer explains the HMAC chain.

### CLAUDE.md respected

- **Read-only** — nothing writes to `improvement_signals` or `deal_events` from any of these surfaces.
- **RLS-scoped** on every read (the table policies filter to `current_organization_id`).
- **Operator-only** — every page is behind `RequirePlatformAdmin`; the routes use `requireRole('admin','analyst')`.
- **Mirrors consumer policy exactly** — the Learning Signals page's "active adjustments" list uses the same `computeMultiplier()` the recommendation engine uses, so the two surfaces can never disagree about whether a rule is being de-ranked.
- **HMAC chain preserved** — the Audit Trail surfaces the existing signatures; no path to re-sign or tamper with them through this page.
- **No new schema** — both endpoints query existing tables (`improvement_signals` from PR #618's capture path, `deal_events` from the HMAC-signed audit log).

### Phase 4 main — COMPLETE

| Item | Status |
|---|---|
| Pillar 7 V1 — Deal Q&A | ✅ Shipped earlier |
| Pillar 7 V2 — Citation surface expansion | ✅ Eighth block (#621) |
| Pillar 8 — Learning Loop v2 consumer side | ✅ Seventh block (#618) |
| E2 — Reverse provenance | ✅ Seventh block (#619) |
| **E7 — Admin dashboard** | ✅ **Ninth block (#623, #624)** |

**Phase 4 main is now fully shipped.** Eight 10-hour blocks have been worked across Phase 4 (prologue + main entries). Operator-gated items remain: G1 (DPA + AUP via Indian legal counsel), G2 (Supabase PITR drill + Incident Lead names + `security@redip.in` mailbox), Google Maps key referrer-restriction at Cloud Console.

### What's next

With Phase 4 done, the obvious queued surfaces are exhausted in the formal plan. Future blocks would likely focus on:
- **Polish / depth** — extend the Q&A V2 slice coverage as new workspace slices ship; expand DependentsPopover to more surfaces; surface the team_feedback chip in DOCX exports
- **Wait-for-users** — Landeed / Surepass / Actowiz / WhatsApp intake (operator's "buy once we have users" gate)
- **New Phase 5** — operator strategy call; no items currently queued

---

## 2026-05-27 (eighth 10-hour block — Pillar 7 V2: Q&A citation expansion) — Q&A now cites the full workspace, not just the deal snapshot (PR #621)

Continuation immediately after the seventh block (Pillar 8 + E2). Operator brief named **Pillar 7 V2** specifically: "Natural-language 'ask the deal' Q&A with citation gating. Most complex remaining feature — needs a constrained narrator + retrieval over the workspace payload." Audit showed V1 was ALREADY shipped at considerable depth (~1,376 LOC across `dealQa.service.js` + `DealQaBox.jsx` + `useDealQa.js`) — streaming SSE answers, pgvector doc retrieval, citation chips with excerpts + similarity scores, numerical drift detection, history with per-row delete, Cmd/Ctrl-Enter shortcut. **V2 = expand the citation surface**, not rebuild the panel.

### Why V2 mattered

V1's synthetic citations cover **only 4 slices**: `deal_snapshot` / `risk_flags` / `comps` / `financials`. But the deal workspace ships **15+ structural slices** today — IC Readiness Pack, K-RERA Readiness, Micro-Market Briefing, Best Use Simulator, Deal-Structure Recommender, Capital-Stack Optimizer, Promoter Profile, DD checklist, Approvals, Recommendation Engine cards, Deal Doctor findings, JDA/JV waterfall, plus the Pillar 8 team_feedback signal. So asking "Why is this deal Pre-IC?" forced a citation to vague `deal_snapshot` instead of the IC Readiness Pack's specific top-gap labels. Asking "What does the Deal Doctor flag?" had no clean citation surface at all.

### PR opened + merged

| PR | What landed |
|---|---|
| [#621](https://github.com/Rachit-Jain9/REDIP/pull/621) | **Pillar 7 V2 — Q&A citation surface expanded from 4 → 16 slices.** Backend: new `getDealWorkspace(dealId, { lite: true })` option that skips AI narration + persistence + activities/audit events (saves the ~500-800ms narrator round-trip on every question) while still producing the deterministic recommendation + deal-doctor cards. `dealQa.assembleContext` fires the lite-workspace fetch in parallel with the V1 reads. New `slimWorkspaceForPrompt(workspace)` helper trims each slice to its prompt-budget shape (≤12 entries per array, only citable fields). `SYNTHETIC_CITATION_IDS` extended from 4 to 16: + `ic_readiness`, `karnataka_rera_readiness`, `micro_market`, `best_use`, `deal_structure_recommender`, `capital_stack_optimizer`, `promoter_profile`, `dd_checklist`, `approvals`, `recommendations`, `deal_doctor`, `waterfall`. `SYNTHETIC_CITATION_LABELS` updated with friendly UI labels. `SYSTEM_PROMPT` rewritten with the full slice catalog + per-slice guidance ("for 'Why is this deal Pre-IC?' cite ic_readiness, not deal_snapshot"), the closed verb-dictionary reminder, and the CLAUDE.md legal carve-out (no AI legal conclusions on title / encumbrance / RERA-status / statutory-approvals — flag for independent verification only). Frontend: `SUGGESTED_QUESTIONS` expanded from 4 V1 prompts to 8 V2 prompts that lead the model into the new slices. 7 new backend tests + DealQaBox component tests updated; all 164 backend + 12 frontend Q&A tests pass; zero regressions across recommendation/learning-signal/dealWorkspace suites. |

### Cumulative impact (this block)

- **Backend tests**: 2,851 → **2,858** (+7 across V2 slice validation + hydrator labels + buildPromptPayload behavior)
- **Frontend tests**: 1,045 → **1,045** (DealQaBox test updated, count unchanged)
- **Modified canonical modules**:
  - `backend/src/services/dealQa.service.js` (+220 LOC of slim-workspace helper, expanded SYNTHETIC ids + labels, rewritten SYSTEM_PROMPT, buildPromptPayload extension)
  - `backend/src/services/dealWorkspace.service.js` (+15 LOC for `lite` option threading)
  - `backend/tests/dealQa.service.test.js` (+90 LOC of V2 coverage)
  - `frontend/src/components/deal/DealQaBox.jsx` (4 → 8 SUGGESTED_QUESTIONS)
  - `frontend/src/components/deal/__tests__/DealQaBox.test.jsx` (V2 prompt assertions)

### What the user can do now that they couldn't before

Ask any of these questions on a deal's Overview tab → model returns an answer with a citation chip linking to the SPECIFIC slice that grounds the claim, not just "Deal snapshot":

- **"Why is this deal Pre-IC? What are the top gaps?"** → cites IC Readiness Pack with specific top-gap labels (e.g., "Land schedule incomplete", "Financial model not finalised").
- **"What does the Deal Doctor flag?"** → cites Deal Doctor findings with verb + severity + topic.
- **"What is the best use for this parcel?"** → cites Best Use Simulator's top-scoring asset classes with reasons.
- **"How does the promoter's delivery track record look?"** → cites Promoter Profile with delivery + RERA + complaint counts.
- **"What's the verdict on the recommended deal structure?"** → cites Deal-Structure Recommender with structure score + tier.
- **"Summarize the K-RERA readiness and any missing approvals."** → cites K-RERA Readiness Pack + Approvals with the missing list.
- **"How does the asking price compare to nearby comps?"** → still cites Comps (V1 already covered this).
- **"What are the open title risks?"** → still cites Risk Flags + Deal Doctor (legal carve-out reinforced — model flags for independent verification rather than giving a legal opinion).

All 8 V2 prompts visible as suggestion chips on a fresh deal's Q&A box.

### CLAUDE.md respected

- **Lite-mode workspace** skips AI narration but keeps deterministic recommendation + deal-doctor cards → Q&A model cites the same evidence the UI does, with no double-narration cost.
- **Legal carve-out reinforced in the prompt**: title / encumbrance / RERA-status / statutory-approvals are flagged for independent verification, never given a legal verdict.
- **Closed verb dictionary preserved**: Recommend / Consider / Re-examine / Flag / Stress-test for recommendations; Diverges / Lacks support / Inconsistent / Below benchmark / Above benchmark / Missing for diagnoses. Forbidden: Buy / Reject / Approve / Decline / Clear / Pass.
- **Every citation post-validated** against the expanded slice id set; the model can't fabricate a `made_up_slice_id` and have it survive into the persisted history row.

### Phase 4 main status

| Item | Status |
|---|---|
| Pillar 7 — Deal Q&A (V1) | ✅ Already shipped earlier |
| Pillar 7 V2 — Citation surface expansion | ✅ Shipped (#621) |
| Pillar 8 — Learning Loop v2 consumer side | ✅ Shipped previous block (#618) |
| E2 — Reverse provenance | ✅ Shipped previous block (#619) |
| **E7 — Admin dashboard (operator-only AI cost + audit + learning-signal health)** | ⏳ **Last Phase 4 main entry queued** |

### What's next

Only **E7 (Admin dashboard)** remains on the Phase 4 main list. Operator-gated items (G1 DPA + AUP via Indian legal counsel; G2 Supabase PITR drill / Incident Lead names / `security@redip.in` mailbox; Google Maps key restriction at Cloud Console) continue to await external action.

---

## 2026-05-27 (seventh 10-hour block — Pillar 8 consumer side + E2 reverse provenance) — Learning loop now ADAPTS, evidence graph now reverses (PR #618-#619)

Continuation immediately after the sixth block's polish + comparison work landed. Operator brief opened with the same "best work you have ever done" line and gave discretion to pick the next direction. I confirmed that the three plan-file headline gaps (2D routing, confidence bands, promoter score, output provenance) are all already shipped (verified in the sixth block), and pivoted to the two highest-leverage genuinely-pending items: **Pillar 8 consumer side** (make captured verdicts actually re-rank cards) and **E2 reverse provenance** ("what depends on this document?").

### PRs opened + merged

| PR | What landed |
|---|---|
| [#618](https://github.com/Rachit-Jain9/REDIP/pull/618) | **Pillar 8 v2 — Learning Loop consumer side.** The CAPTURE side was shipped (PR-C) months ago — every `dismiss` / `snooze` / `acted` verdict on a Recommendation Engine card writes a values-free row to `public.improvement_signals`. This PR is the **READ** side that's been missing: a deterministic per-`(org, rule_id)` count aggregator over a 90-day trailing window + a multiplier policy that re-ranks cards within an org. New service `learningSignals.aggregator.service.js`. Recommendation engine accepts a `teamFeedback` Map; each emitted card now gets a `team_feedback` field; sort re-keys on `severity × multiplier`. Original `severity` preserved so the audit log shows the rule's untouched assessment. New "Adapted for your team" chip on `RecommendationsPanel`. 65 new tests (19 aggregator + 7 engine integration + 39 preserved engine regressions). 124 total recommendation + learning-signal tests pass. |
| [#619](https://github.com/Rachit-Jain9/REDIP/pull/619) | **E2 — reverse provenance ("what depends on this document?").** The polymorphic `evidence_links` table records claim → source links forward (DD item / approval / risk flag / scenario CITES document / regulatory source). This PR ships the reverse traversal: `GET /api/evidence-links/dependents/:sourceKind/:sourceId`. New service function `listDependents()` with LEFT-JOIN-to-every-owning-entity SELECT (uses the existing partial indexes). New `DependentsPopover.jsx` reusable component wired into the DocumentsTab — every document row gets a small "Dependents" (Network icon) button. Click → grouped list of every DD / approval / risk flag / scenario that cites this document, with parent deal links. Comp source kind returns empty + a note (comps route through the future comp_reliance signal layer). 18 new tests (8 backend + 10 frontend). All 92 common-component frontend tests pass. No new schema, no migration. |

### Multiplier policy (Pillar 8 — deterministic ladder)

| Condition | Multiplier |
|---|---|
| Legal carve-out topic (`legal_title` / `legal_rera` / `legal_approvals` / `legal_encumbrance`) | **1.0 always** |
| `acted_count >= dismiss_count` AND `acted_count > 0` | **1.0** |
| `dismiss_count >= 6` | **0.7** (floor) |
| `dismiss_count >= 3` | **0.85** |
| Otherwise | **1.0** |

The floor of 0.7 means a card **never disappears from de-ranking alone** — a strongly-dismissed card still ranks above the same-severity zero-feedback card by at most 30% of the severity span. The decision to actually HIDE a card stays with the operator (Dismiss button), not the platform.

### Architecture choices (Pillar 8)

| Approach | Verdict | Why |
|---|---|---|
| Block-list rules after N dismissals | **Rejected** | Loses correctness; team dismissing-out-of-fatigue would silently hide critical findings. |
| Bayesian rule scoring with priors | **Rejected** | Overkill at current data volume. Counts + thresholds are defensible and explainable. |
| ML-learned re-ranker | **Out of scope** | Deterministic ranking is part of REDIP's audit-friendliness contract — two runs on the same data must produce the same order. |
| Deterministic per-`(org, rule)` count aggregation + policy ladder | **Chosen** | Pure, explainable, snapshot-reproducible. |

### Cumulative impact (this block)

- **Backend tests**: 2,809 → **2,851** (+42 across aggregator + engine integration + reverse-provenance service)
- **Frontend tests**: 1,025 → **1,045** (+20 across team-feedback chip + DependentsPopover)
- **New canonical modules**:
  - `backend/src/services/learningSignals.aggregator.service.js` — 215 LOC, per-org rule-feedback aggregator
  - `backend/src/services/evidenceLinks.service.listDependents()` — new function in the existing module (~100 LOC addition)
  - `frontend/src/components/common/DependentsPopover.jsx` — 270 LOC, reusable reverse-traversal UI
- **Modified**:
  - `backend/src/services/recommendation/index.js` — accepts `teamFeedback`, applies multiplier + re-sort
  - `backend/src/services/dealWorkspace.service.js` — fetches the aggregator before invoking the engine
  - `backend/src/routes/evidenceLinks.routes.js` — new `GET .../dependents/...` route
  - `frontend/src/components/deal/RecommendationsPanel.jsx` — "Adapted for your team" chip on cards
  - `frontend/src/components/deal/DocumentsTab.jsx` — Dependents button per document row
  - `frontend/src/services/api.js` — new `evidenceLinksAPI.dependents()` client

### What the user can do now that they couldn't before

- **The Recommendation Engine actually LEARNS.** Dismiss a card 3+ times across your team in the last 90 days and that rule's cards quietly de-rank — a small "Adapted: dismissed N× this month" chip explains why. Apply the rule's recommendations several times and the platform notices ("Applied 5× by your team"). The card never disappears from de-ranking alone — only the order changes; the dismiss button is still the only way to hide a card. Legal carve-out topics (title / RERA / approvals / encumbrance) **never** de-rank, regardless of feedback.
- **Reverse-impact lookup on every document.** Open the Documents tab, click the new Network icon next to any file → instant grouped list of every DD item / approval / risk flag / scenario across your org that cites this document, each linking back to its parent deal in a new tab. Lets you answer "what breaks if I delete this PDF?" without leaving the page.

### CLAUDE.md respected

- **Pillar 8**: deterministic + snapshot-reproducible (two runs on the same data produce the same order). Values-free aggregation — counts of verdicts, never document values, never PII. Read-side only; never writes to `improvement_signals`. Legal carve-out topics stay strict — no AI rephrasing, no de-ranking.
- **E2**: read-only — never modifies any state. Pure SQL aggregation, no AI prose. Org-scoped via RLS on `evidence_links` + `current_organization_id()`. No new schema; reuses the existing polymorphic table + its partial indexes.

### Phase 4 main entries status

| Item | Status |
|---|---|
| Pillar 8 — Learning Loop v2 consumer side | ✅ Shipped (#618) |
| E2 — Claim / provenance graph (reverse traversal) | ✅ Shipped (#619) |
| Pillar 7 — Q&A v2 (natural-language workspace Q&A) | Queued — LLM-heavy, needs citation gating design |
| E7 — Admin dashboard (operator-only AI cost + audit views) | Queued — admin skeleton exists, needs surfaces |

### What's next

Pillar 7 (Q&A v2) and E7 (Admin dashboard) remain queued. Operator-gated items (G1 DPA + AUP via Indian legal counsel; G2 Supabase PITR drill / Incident Lead names / security@redip.in mailbox; Google Maps key restriction at Cloud Console) all await external action.

---

## 2026-05-27 (sixth 10-hour block — quality + polish + deal comparison) — Diagnostic cleanup, theme tokens, side-by-side comparison (PR #614–#616)

Continuation immediately after Phase 4 prologue's 7-PR arc landed. The operator's brief opened with the standing "take your time to do quality work" line and gave me discretion to choose the next direction. I did a deep technical review and found that the three headline gaps from the original plan file (`REDIP Pending.docx`) — 2D routing matrix · confidence bands · promoter track-record scoring — are ALL already shipped:

- **2D routing matrix** → `backend/src/utils/dealStructureMatrix.js` exists, wired into approvals.service.js (`getAdditionalApprovals`), riskRadar.service.js (`getRiskPreset`), dealStructureRecommender.service.js (`isValidPair`). Frontend parity test enforces lockstep.
- **Confidence bands** → `backend/src/services/confidenceRange.service.js` + `frontend/src/components/financials/ConfidenceRangePanel.jsx` ship deterministic perturbation-of-unverified-inputs (not Monte Carlo) — exactly what the plan asked for.
- **Promoter score** → `backend/src/services/promoterProfile.service.js` has `assessPromoter()` returning cleared/unverified/flagged posture from a 5-factor scorer.

Plus **output provenance** → `frontend/src/components/financials/KPIStatCard.jsx` already implements click-ℹ → popover with formula + drivers + benchmark band + confidence badge.

So the block pivoted from "ship the missing plan-file items" to **"polish + integrate + ship one well-targeted new capability"**.

### PRs opened + merged

| PR | What landed |
|---|---|
| [#614](https://github.com/Rachit-Jain9/REDIP/pull/614) | **CLEANUP — drop the portfolio-readiness diagnostic console.error from PR #611.** The flat single-line diagnostic was load-bearing while we hunted the f.kpis/f.dscr column bug across PR #606-#612. With the root-cause fix in (#612), the error path no longer fires; the diagnostic was just adding log noise. Kept the structured `log.warn` (pino) as canonical telemetry — if a new error ever surfaces here we can re-add the flat line. |
| [#615](https://github.com/Rachit-Jain9/REDIP/pull/615) | **FEAT — side-by-side deal comparison modal (2–4 deals).** New `CompareDealsModal.jsx` mounted from a "Compare" button in the existing DealsPage bulk-action bar (visible only when 2–4 deals are selected). Bloomberg-style grid: rows are signal groups (Headline kernel KPIs · Capital posture · IC readiness · Risk · DD · Approvals · Documents · Promoter · Top blocker), columns are deals, sticky leftmost signal column + sticky deal headers. Frontend-only — fires `useDealWorkspace(id)` in parallel via React Query's `useQueries`; cache key matches the per-deal route so cold loads are shared. 16 focused unit tests. Production-verified with 4 deals (Jakkur, KR Puram, Chirping Ridge, Jigani-Apartments) returning real kernel data (IRR 13.6%, NPV ₹-3.89 Cr) and em-dashes for missing values. |
| [#616](https://github.com/Rachit-Jain9/REDIP/pull/616) | **POLISH — PrivacyCentre Card surfaces from `bg-white` to `bg-bg-elevated`.** Two-line fix for the last residual raw-Tailwind surface on a dashboard page. The card borders already used token classes (`border-hairline-strong`) so the mismatch was just visual inconsistency under the data-theme="dark" repaint. The Legal pages keep their deliberate `stone-*` newspaper palette (line 1-3 comment explicit on each). |

### Smoke test (Chrome MCP walkthrough — task #43)

Verified the full primary nav after the 12-PR Phase 4 prologue arc + this block's three additions. Clean across:

- **Dashboard** → all 9 widgets render (KPIs · Attention · Risk Radar · Portfolio Readiness · Pipeline · Cities · Recent Activities · Top Deals by IRR · AI cost). Portfolio Readiness API returns 6 deals · 1 pre_ic · 5 early · average 23 · 6 top_blockers ranked by severity.
- **Deals** → 7 deals listed with per-card readiness chips. Multi-select checkboxes work; bulk action bar appears; new **Compare** button is the styled accent-pill (visible only when 2–4 selected).
- **Compare modal** (production-verified) → 4 deals side-by-side, sticky signal column + sticky deal headers, real kernel data, em-dash fallbacks for missing values, footer disclaimer present.
- **Market Intelligence** → loads; honestly-unavailable state per CLAUDE.md (no verified feed for the consumer yet).
- **Comps** → 15-row table renders cleanly.
- **Reports** → loads cleanly (the sidebar route is `/dashboard/reports`, not `/dashboard/exports`).
- **Deal Detail** → 8 tabs render (Overview · Parcel/Site · Documents · Activity · Financial · DD & Approvals · Risk · Market/Comps). Overview surfaces Recommendations, Micro-Market Briefing, Strategic Fit (Best Use · Deal Structure · Capital Stack), Quick Analysis, Full IC Memo, Evidence & Sources, Q&A. Financial tab empty-state CTA renders correctly for deals without a kernel run.

No 404s on real routes. No console errors observed. The Phase 4 prologue's Portfolio Readiness payload (verified earlier) is still healthy.

### Cumulative impact (this block)

- **Frontend tests**: 1,009 → **1,025** (+16 across CompareDealsModal)
- **New canonical modules**:
  - `frontend/src/components/deals/CompareDealsModal.jsx` — 270 LOC, signal-table primitive
- **Modified**: `frontend/src/pages/DealsPage.jsx` (Compare button + modal wiring), `frontend/src/pages/PrivacyCentrePage.jsx` (token cleanup), `backend/src/services/portfolioReadiness.service.js` (drop diagnostic)

### What the user can see now that they couldn't before

- **Tick 2–4 deals on `/deals` → click Compare → side-by-side workspace view in seconds.** Decide which candidate to push next with kernel KPIs, IC readiness, Risk posture, DD progress, approvals, promoter, and the top IC gap all on one screen — no tab-flipping, no losing context.
- Deal-name headers in the modal link to the full deal workspace in a new tab so you can drill in without closing the comparison.

### What stayed clean / honest

- Every number in the comparison modal traces back to a kernel run on the source deal. Nothing invented; nothing averaged across deals.
- Footer disclaimer: *"Comparison is an organisation aid — never an IC verdict."* Closed verb dictionary throughout.
- No new schema, no new backend, no AI prose.

### Why the plan-file headline gaps were already done

All three top items from the operator's 2026-05-25 "REDIP Pending" review (Section 5.1 / 5.2 / 5.3) had landed during the multi-block work since that review. Re-auditing what's actually shipped saved this block from accidentally re-doing 1-3 weeks of work that was already complete. The lesson noted in CLAUDE.md still applies: **inspect the codebase before treating a plan-file item as "pending"**.

### What's next

Phase 4 main entries remain queued (Pillar 7 Q&A v2, Pillar 8 Learning Loop v2 consumer side, E7 admin dashboard). E2 (claim/provenance graph) is its own architectural block. Operator-gated items (G1 DPA + AUP, G2 Supabase PITR drill) await external action.

---

## 2026-05-27 (fifth 10-hour block — Phase 4 prologue) — Portfolio Readiness aggregator (PR #605) + 6 follow-up fixes that finally cracked it (PR #606–#612)

Continuation from the Phase 3 closeout. Operator brief opened with the same standing instruction — "Do what is best for website. Take your time to do quality work" — and pointed me at the per-deal IC Readiness Pack that had just shipped. Per-deal posture was now strong; the missing piece was the **cross-deal portfolio zoom**: "across every live deal in this workspace, where do we stand on IC + RERA prep, and which deals need attention next?"

That became **Phase 4 prologue — the Portfolio Readiness aggregator**.

### PRs opened + merged

| PR | What landed |
|---|---|
| [#605](https://github.com/Rachit-Jain9/REDIP/pull/605) | **Phase 4 prologue feature — Portfolio Readiness aggregator + Dashboard widget + per-card chips.** Rolls up IC + RERA readiness signals across every live deal in the workspace into a single dashboard-friendly payload. New service `portfolioReadiness.service.js` with 5 sub-scorers summing to 100 (financial fit · DD progress · approvals progress · documents · context: coords + promoter + open deal-breakers). New tier mapping (IC-ready ≥75 · Pre-IC ≥55 · Diligence ≥35 · Early). New dashboard widget `PortfolioReadinessWidget.jsx` mounted between the Risk Radar and the Pipeline chart. New per-card chip on every deal card on the Deals list page surfacing tier + score + top-blocker. New hook `usePortfolioReadiness()` with 30s staleTime. 35 unit tests + 5 integration tests on the panel. |
| [#606](https://github.com/Rachit-Jain9/REDIP/pull/606) | **FIX — stage-enum cast + LIVE_DEAL_STAGES.** First production verification showed the widget empty. Initial diagnosis: the SQL used `'sourcing'` as a default stage but the canonical enum value is `'sourced'`, and the stage filter was hardcoded inside the service instead of importing `LIVE_DEAL_STAGES` from `constants/domain.js`. Fixed both. Still empty after deploy. |
| [#607](https://github.com/Rachit-Jain9/REDIP/pull/607) | **FIX — rewrite SQL as deals-then-aggregates (multi-query) instead of subqueries-in-SELECT.** Second diagnosis: maybe the correlated-subquery shape was the problem. Split into 5 sequential queries (deals + 4 parallel aggregates on dd_items / approval_items / documents / deal_promoter_profiles) with per-aggregate safeAggregate wrappers. Still empty. |
| [#608](https://github.com/Rachit-Jain9/REDIP/pull/608) | **FIX — LEFT JOIN properties for lat/lng + restore enum stage cast.** Third diagnosis: PR #607 referenced `d.property_lat` / `d.property_lng` but those columns live on `properties`, not `deals` (`deals.property_id` is the FK). Fixed by adding `LEFT JOIN properties p ON p.id = d.property_id` and aliasing `p.lat AS property_lat`. Also restored `stage = ANY($2::deal_stage[])` (enum cast, matches the working Portfolio Risk Radar). **Still empty.** |
| [#609](https://github.com/Rachit-Jain9/REDIP/pull/609) | **FIX — use buildVisibleDealCondition to match /api/deals semantics.** Fourth diagnosis: `/api/deals` returns the 6 deals fine but my service still returns 0. Difference: `/api/deals` uses `buildVisibleDealCondition` which adds a `deal_shares` OR clause. Mirrored that exact predicate. **Still empty.** |
| [#610](https://github.com/Rachit-Jain9/REDIP/pull/610) | **FIX — diagnostic console.error with full pg error fields.** At this point we'd shipped 4 fixes with no observable progress. The runtime logs showed "Database query error: {   t..." truncated by Vercel UI before revealing the actual error code/message. Added a parallel `console.error('[portfolio-readiness] query failed:', {code, message, where, hint, detail})` that emits the structured PG error fields so the truncation couldn't hide the cause. |
| [#611](https://github.com/Rachit-Jain9/REDIP/pull/611) | **FIX — flatten diagnostic to single-line string.** PR #610's object-form `console.error` still got cut after the first key. Replaced with a flat single-line format: `[portfolio-readiness:err] code=42703 msg=... where=... hint=... detail=...` so the full diagnostic survives Vercel's UI truncation. Pulling logs by literal string `"42703"` finally matched — confirming the error was PG code **42703 — undefined_column**. |
| [#612](https://github.com/Rachit-Jain9/REDIP/pull/612) | **🎯 ROOT-CAUSE FIX — `f.kpis` doesn't exist on `financials`; use `f.dscr`.** Once the error code was visible, the cause was obvious in 60 seconds. The SQL was SELECTing `f.kpis` from `financials`, but **that column lives on `financial_scenarios` (per-scenario Base/Bull/Bear snapshots), not on `financials`**. `financials` exposes the kernel outputs as top-level columns (`irr_pct`, `dscr`, `npv_cr`, …). Three small changes: (1) drop `f.kpis`, add `f.dscr`; (2) simplify `scoreFinancialFit` to read `row.dscr` directly instead of `row.kpis?.dscr`; (3) update unit-test fixtures to the real PG row shape. All 35 tests pass. **Production verification: `deals_count = 6, totals.total = 6, pre_ic = 1, early = 5, average_score = 23, top_ready = [Jigani-Apartments (pre_ic, 58), Gattahalli (early, 19), Commercial Retail (early, 19), Jakkur (early, 14), Chirping Ridge (early, 14)], top_blockers = [open deal-breakers: 6, no financial model: 3, DD not seeded: 5, approvals not seeded: 4]`.** |

### Why this arc took 7 PRs (the lesson)

The unit tests passed because they mocked rows in the shape the **workspace composer** emits (`{ irr_pct, kpis: { dscr } }`) — a synthesised shape downstream of the per-deal SQL. But the portfolio aggregator reads `financials` directly with no composer in between, so production PG saw the raw column shape and threw 42703. **The fixture didn't match the actual table.**

That meant every "fix" PR #606 → #609 was correctly fixing a *real-but-secondary* issue (stage casts, JOIN shape, visibility predicate) without touching the *primary* one — because the failing column was never in any test assertion. The diagnostic-logging detour (PR #610 + #611) was the actual breakthrough: once the PG error code reached the logs in a form Vercel didn't truncate, the targeted fix took 60 seconds.

**What I'd do differently next time**: if a same-shape sibling endpoint works and mine doesn't, the *first* move is logging the raw PG error in a form that survives the production log viewer. The 4 fix PRs that preceded the diagnostic detour were unnecessary delay. Shipping the diagnostic *first* would have collapsed the arc from 7 PRs to 2.

### Cumulative impact (this block)

- **Backend tests**: 2,774 → **2,809** (+35 across portfolio readiness service)
- **Frontend tests**: 1,004 → **1,009** (+5 on the dashboard widget)
- **New canonical modules**:
  - `backend/src/services/portfolioReadiness.service.js` — 5-scorer aggregator + 7 portfolio-blocker rules
  - `frontend/src/components/dashboard/PortfolioReadinessWidget.jsx` — widget UI
- **New route**: `GET /api/dashboard/portfolio-readiness`
- **New hook**: `usePortfolioReadiness()`
- **Modified**: `frontend/src/hooks/useDashboardLayout.js` (added `portfolio_readiness` widget), `frontend/src/pages/DealsPage.jsx` (per-card readiness chip), `frontend/src/components/deals/DealCard.jsx` (chip rendering)

### What the user can do now that they couldn't before

- **Open the dashboard** and see a **Portfolio Readiness** tile between the Risk Radar and the Pipeline chart. Tier counts (IC-ready · Pre-IC · Diligence · Early), portfolio average score, top 4 portfolio-wide blockers sorted by severity + affected deal count, top-5 IC-ready deals, top-5 needs-attention deals — all clickable through to the per-deal IC Readiness Pack.
- **Visit the Deals list page** and see a readiness chip on every deal card showing its tier (color-coded), 0-100 score, and one-line top-blocker (e.g. "DD not seeded", "no documents uploaded", "promoter / coords missing").
- The Portfolio Readiness widget honours per-user dashboard layout — operators can hide it, reorder it, reset to defaults via the existing customize popover.

### CLAUDE.md respected

Closed verb dictionary (`Recommend / Consider / Re-examine / Flag / Stress-test`) preserved in the portfolio blocker recommended-actions. The disclaimer on the widget + the API payload reads: *"Portfolio Readiness is an aggregated organisation aid — composed deterministically from each deal's deal-team-recorded findings. It does NOT represent an Investment Committee verdict on any deal; only an inventory of where the deals stand on IC-prep."* Tone bar: institutional / analytical / sharp / diagnostic. No theatrical language, no slander-grade claims about deals or promoters.

### Phase 4 prologue status

| Item | Status |
|---|---|
| Portfolio Readiness service + dashboard widget + per-card chips | ✅ Shipped (#605 + the 6 follow-up fixes) |
| Production verification — 6 deals, tier counts populated, top blockers ranked | ✅ Confirmed via API |
| Diagnostic logging cleanup (drop the `[portfolio-readiness:err]` console.error now that the error path no longer fires) | ⏳ Low-priority follow-up |

### What's next

Phase 4 prologue is **shipped + verified**. Main Phase 4 entries (Pillar 7 Q&A v2, Pillar 8 Learning Loop v2, E7 admin dashboard) are queued. E2 (claim / provenance graph) remains its own architectural block.

---

## 2026-05-27 (fourth 10-hour block) — Phase 3 closeout: Pillar 5 IC Readiness Pack + xlsxV2 flake fix (PR #602–#603)

Continuation immediately after Pillar 4's K-RERA Readiness Pack landed. The operator's brief opened with "did you do Pillar 5 and E2 yet?" — clarifying that neither had been built. After a focused comparative-options pass, **Pillar 5** was chosen as the natural next (mirrors the proven Pillar 4 architecture; pairs the readiness-pack pair) with E2 deferred to its own architectural block.

### PRs opened + merged

| PR | What landed |
|---|---|
| [#602](https://github.com/Rachit-Jain9/REDIP/pull/602) | **FIX — Per-suite Jest timeout for heavy XLSX V2 builders.** Stabilises the 1-of-2,732 timeout flake we caught in the previous block. Added `jest.setTimeout(60000)` at the top of `exports.xlsxV2.test.js` + `exports.xlsxV2.realism.test.js`. Same pattern the existing `crossProductReconciliation.test.js` already uses. Full suite goes back to clean-green: **160 / 160 suites · 2,732 / 2,732 tests** under the same parallel load that previously flaked. |
| [#603](https://github.com/Rachit-Jain9/REDIP/pull/603) | **P3-PR4 + P3-PR5 — IC Readiness Pack (Pillar 5).** Companion to the K-RERA Readiness Pack. For every deal (regardless of asset class), composes a 7-bucket inventory of what IC expects: Financial Underwriting · Title & Legal · Statutory Approvals · Market & Comps · Promoter & Execution · Risk & Diagnosis · Document Hygiene. 30 items, weights summing to exactly 100. Same five-tier evidence model as Pillar 4. Readiness tiers: IC-ready (≥75%) / Pre-IC (≥55%) / Diligence-stage (≥35%) / Early. Pure composer over already-loaded workspace slices (financial, dd, risk, approvals, documents, micro_market, best_use, rera_readiness, promoter, deal_doctor) + a comps proximity query. Panel + DOCX download in one PR. Mounts FIRST on the DD tab (above K-RERA pack — IC is the broader posture; RERA is one cluster within it). |

### Cumulative impact (this block)

- **Backend tests**: 2,732 → **2,774** (+42 across icReadiness service + DOCX exporter)
- **Frontend tests**: 1,000 → **1,004** (+4 on the IC panel)
- **New canonical modules**:
  - `backend/src/services/icReadiness.service.js` — 7-bucket composer with semantic detect functions
  - `backend/src/services/exports/docx/buildIcReadiness.js` — DOCX builder
  - `frontend/src/components/deal/IcReadinessPanel.jsx` — panel + Download DOCX button
- **New route**: `GET /exports/deals/:dealId/ic-readiness/docx`
- **New workspace slice**: `workspace.ic_readiness`
- **New hook**: `useDealIcReadiness()`

### What the user can do now that they couldn't before

- **Open any deal** and see an **IC Readiness Pack** card at the top of the DD & Approvals tab. 0-100 score, IC-readiness tier badge, headline counts (Verified / Uploaded / Available / Pending / Missing), 7 expandable buckets with 30 items showing evidence source + recommended next steps, and a top-gaps strip sorted by severity.
- **Click Download DOCX** at the top of the panel and get a polished Word document with cover-page disclaimer, executive summary, per-bucket sections, top gaps, closing scope page, and a footer disclaimer on every page. The deal team hands this to the IC committee.
- **For residential / plotted / villas / mixed-use / redevelopment deals**, both readiness packs surface — IC pack at the top (broader posture), K-RERA pack below (specific to RERA filing).
- **For commercial / hospitality / industrial / raw-land deals**, only the IC pack surfaces — the K-RERA pack honestly says "not applicable for this asset class".

### CLAUDE.md respected

Same legal-adjacency posture as Pillar 4. Never asserts "IC will approve" or "deal is investment-grade" — only "X of Y IC-readiness items have verified evidence". Disclaimer surfaced on the panel, the DOCX cover banner, the closing scope page, and a footer on every DOCX page: *"IC Readiness Pack · Organisation aid · NOT an IC approval verdict"*.

### Phase 3 status

| Item | Status |
|---|---|
| Pillar 4 — Karnataka RERA Readiness Pack | ✅ Shipped (#599 + #600) |
| Pillar 5 — IC Readiness Pack | ✅ Shipped (#603) |
| **E2 — Claim / provenance graph** | **Still pending** — its own architectural block; queryable "show me every claim that depends on this comp / document" |

### Operator actions required

**Zero this block.** Every PR is pure code reading data that already exists on the deal. No migrations.

---

## 2026-05-26 (evening, third 10-hour block) — Phase 3 of the property-consultant quarter: Pillar 4 — Karnataka RERA Readiness Pack (PR #599–#600)

Continuation immediately after the Phase 2 wrap (#598). The operator's brief opened with a comparative-options ask + Chrome QA + "best work ever, not subpar". Two PRs shipped end-to-end (a deep-design PR, not a volume block).

### PRs opened + merged

| PR | What landed |
|---|---|
| [#599](https://github.com/Rachit-Jain9/REDIP/pull/599) | **P3-PR1 — Karnataka RERA Readiness Pack.** For residential / plotted / villas / mixed-use / redevelopment deals, composes a structured K-RERA filing-readiness inventory across 7 buckets (Application & Declaration, Title & Ownership, Plan & Approvals, Project Specs, Promoter Identity, Escrow & Finance, Professional Certificates) with ~30 items. Each item has a detect spec (approval types + name patterns + doc patterns + extracted field keys), a 1-5 weight, a recommended action, and a five-tier evidence resolution (verified > uploaded > available > pending > missing) with status precedence approval > extracted field > document. Pure compute over workspace-already-loaded data, no extra DB round-trips. CLAUDE.md hard rule respected: never asserts "RERA compliant" — only "X of Y items have verified evidence". Disclaimer surfaced in the UI. Service-layer applicability matrix correctly excludes commercial / hospitality / industrial / raw-land. Panel mounts ABOVE the existing DD + Approvals sections on the DD tab. 40 unit tests + 4 panel tests. |
| [#600](https://github.com/Rachit-Jain9/REDIP/pull/600) | **P3-PR2 — DOCX export.** One-click download of the readiness pack as a polished Word document the operator hands to their CA / architect / lawyer. Cover with brand + readiness score + amber-bordered disclaimer banner. Executive summary with headline counts + per-bucket completeness table. Per-bucket sections with item tables (label, status, evidence, recommended next step). Top Gaps section. Closing Scope & Disclaimer page. Footer on every page: "Organisation aid · NOT a RERA compliance verdict". Not-applicable asset classes get a short single-page document explaining why no pack is generated. 8 unit tests on the DOCX builder; route at `GET /exports/deals/:dealId/rera-readiness/docx`. |

### Cumulative impact (Phase 3 only — Pillar 4)

- **Backend tests**: 2,684 → ~2,732 (+~48 across readiness service + DOCX exporter)
- **Frontend tests**: 1,000 (+4 on the panel — kept clean)
- **New canonical modules**:
  - `backend/src/services/karnatakaReraReadiness.service.js` — pure composer
  - `backend/src/services/exports/docx/buildReraReadiness.js` — DOCX builder
  - `frontend/src/components/deal/KarnatakaReraReadinessPanel.jsx`
- **New route**: `GET /exports/deals/:dealId/rera-readiness/docx`
- **New workspace slice**: `workspace.karnataka_rera_readiness`
- **New hook**: `useDealReraReadiness()`

### What the user can do now that they couldn't before

- **Open any residential / plotted / villas / mixed-use / redevelopment deal** and see a **K-RERA Readiness Pack** card at the top of the DD & Approvals tab — readiness score 0-100, tier badge (early / partial / mostly / filing-ready), headline counts (Verified / Uploaded / Available / Pending / Missing), 7 expandable buckets with ~30 items showing evidence source + recommended next steps, and a top-gaps strip sorted by severity.
- **For non-residential deals** the card honestly says "Commercial / hospitality / industrial / raw-land projects are outside K-RERA project-level registration" — no fake checklist.
- **Click Download DOCX** at the top of the panel and get a polished Word document with the cover-page disclaimer banner, per-bucket tables, top gaps, and a footer disclaimer on every page. The operator hands this to their CA / architect / lawyer; nobody can mistake it for a RERA compliance verdict.

### CLAUDE.md hard rule

Phase 3 ships the most legally-adjacent feature so far. Every layer surfaces the same line:

> "This is an organisation aid for the deal team and their CA / architect / lawyer. It does NOT represent a Karnataka RERA compliance verdict — only an inventory of the documents and fields required for K-RERA project registration. The statutory determination of RERA compliance rests with the human professional."

That line is on the panel, on the cover page of the DOCX, on the closing Scope page of the DOCX, and (shortened) on every footer of the DOCX. The recommended-action text uses operational verbs ("upload the EC document", "open the escrow account at a scheduled bank") not statutory ones ("is compliant", "is RERA-valid"). The verb dictionary that protects the Recommendation Engine + Deal Doctor extends naturally to this surface.

### Operator actions required

**Zero this block.** Every PR reads data that already exists on the deal (approvals + documents). No migrations to apply.

### Phase 3 entry points still pending

- **Pillar 5 — DD Pack**: organize and validate the full DD checklist for IC handoff. Companion to the RERA Readiness Pack (RERA = filing readiness; DD = IC readiness). Reuses the same evidence-tier model + DOCX-export pattern.
- **E2 — Claim / provenance graph**: queryable "show me every claim that depends on this comp / this document". Foundation for advanced audit + IC-prep workflows.

Both orthogonal to Phase 3's RERA work; each can ship in its own focused block.

---

## 2026-05-26 (afternoon, 10-hour focused block) — Phase 2 of the property-consultant quarter: Pillars 2 + 3 + Strategic Fit grouping + stale-chunk auto-recovery (PR #593–#597)

Continuation immediately after the Phase 1 wrap (#592). The operator's brief opened with a deep-technical-review ask: identify the highest-impact pending work, group related pieces, compare multiple approaches per major decision, and treat this as 10 hours of focused quality work. Five PRs landed end-to-end.

### PRs opened + merged

| PR | Pillar / Workstream | What landed |
|---|---|---|
| [#593](https://github.com/Rachit-Jain9/REDIP/pull/593) | **P2-PR1** — Pillar 2 | **Best Use Simulator** — scores the seven core asset classes (residential apartments / plotted / commercial office / retail / industrial-warehousing / hospitality / mixed-use) on fitness to monetise the parcel. Five deterministic sub-scorers (demand fit, price realisability, growth signal, approval-timeline risk, capital intensity). Verdict from the closed dictionary. New workspace slice + standalone route + Overview panel with expandable factor breakdowns. 26 unit tests, all asset-class baselines documented. |
| [#594](https://github.com/Rachit-Jain9/REDIP/pull/594) | **P2-PR2** — Pillar 3 (first half) | **Deal-Structure Recommender** — scores the eight deal structures (outright / JV / JDA / revenue-share / area-share / profit-share / ground-lease / hybrid) for the deal's asset class + promoter posture + micro-market context. Hard-floor to Flag on the 4 structurally-incoherent pairs from `dealStructureMatrix`. Reuses the existing matrix + promoter posture; pure compute over the workspace, no extra DB round-trips. 21 unit tests including the flagged-promoter / oversupply edge cases. |
| [#595](https://github.com/Rachit-Jain9/REDIP/pull/595) | **P2-PR3** — Pillar 3 (second half) | **Capital-Stack Optimizer** — three scenarios (Conservative / Base / Aggressive) scored against per-asset-class Indian-bank covenant bands (LTV / LTC / DSCR). Reads kernel output from `workspace.financial.summary`; overlays alternate capital-stack templates without re-running the kernel. Closes Phase 2 and the property-consultant trio (what to build × how to structure × **how to fund**). 34 unit tests including a coverage smoke that pins every asset class has 3 stack templates summing to exactly 100%. |
| [#596](https://github.com/Rachit-Jain9/REDIP/pull/596) | **P2-PR4** — Phase 2 closeout polish | **Strategic Fit Section** — visually unifies the three Phase 2 ranking cards under a single section header on the Overview tab. Glanceable summary strip surfaces top-fit verdict per question ("Best Use: Residential / Structure: Revenue Share / Capital Stack: Aggressive"). Collapsible section. Honest empty-state copy when any panel is unavailable. 4 new unit tests covering the all-unavailable bow-out, summary chips, collapse behaviour, and the three verdict surfaces. |
| [#597](https://github.com/Rachit-Jain9/REDIP/pull/597) | **FIX-PR** — production stability | **Stale-chunk auto-recovery** spotted during browser verification. After several rapid deploys today, the operator's tab hit "Failed to fetch dynamically imported module: …DealsPage-X.js" and required a hard refresh. Extended `ErrorBoundary` + added a global handler in `main.jsx` to detect chunk-load errors (Chrome / Safari / Firefox / Vite / Webpack message patterns) and force a single full reload with a sessionStorage guard preventing reload loops. 13 new tests. Every future REDIP deploy is now non-disruptive for users with tabs open during the deploy window. |

### Cumulative impact (Phase 2 only)

- **Backend tests**: 2,603 → **2,684** (+81 across the three new services).
- **Frontend tests**: 964 → **996** (+32 across the three new panels + the Strategic Fit wrapper + ErrorBoundary).
- **New canonical modules**: `backend/src/services/bestUseSimulator.service.js`, `dealStructureRecommender.service.js`, `capitalStackOptimizer.service.js`. New routes: `/api/best-use/simulate`, `/api/deal-structure-recommender/score`, `/api/capital-stack-optimizer/score`. Extended `dealWorkspace.service.js` with three new slices.
- **New UI surfaces**: `BestUseSimulatorPanel`, `DealStructureRecommenderPanel`, `CapitalStackOptimizerPanel`, `StrategicFitSection` wrapper. All mounted on the Overview tab.
- **Production stability**: stale-chunk auto-recovery shipped (PR #597).

### What the user can do now that they couldn't before

- **Open any deal with a parcel coordinate** and see a **Best Use Simulator** card on the Overview — seven asset classes ranked 0-100 on fitness to monetise the site, with a verdict (Recommend / Consider / Re-examine / Stress-test / Flag), a three-line "why" rationale, and an expandable factor breakdown showing the exact benchmark or baseline behind each score. Deterministic; no AI.
- **Open any deal with an asset class set** and see a **Deal-Structure Recommender** card — eight ways to structure the deal (outright / JV / JDA / revenue-share / area-share / profit-share / ground-lease / hybrid) scored against deal economics + promoter posture + market signals. The recommender reacts to the promoter (flagged promoter → revenue-share with escrow rises to the top; cleared promoter → outright captures upside) and to the market (oversupply → share downside; tight market → capture upside). Refuses to recommend physically impossible combinations (hard-floor to Flag).
- **Open any deal where the kernel has run** and see a **Capital-Stack Optimizer** card — three scenarios (Conservative / Base / Aggressive) with covenant checks (LTV / LTC / DSCR) against typical HDFC / Axis / ICICI lending norms. Each scenario expands to show the stack mix (equity / construction-finance / pref / mezz with rupee amounts), covenant pass/fail per ratio, and the five factor breakdowns.
- **See all three at a glance** — the Strategic Fit Section header surfaces the top-fit verdict from each card on a single summary strip, so the deal team can scan the consultant answer (what to build × how to structure × how to fund) in one line before deep-diving.
- **Stop getting stuck on stale-chunk errors after a deploy.** REDIP now auto-recovers — one second reload, no Ctrl+Shift+R required.

### Browser-verified end-to-end

Used the Chrome MCP integration to load production REDIP on the Jigani Apartments deal mid-block. Verified:

- Strategic Fit Section header renders with the "Phase 2 / Pillars 2-3" tag.
- Summary strip surfaces real verdicts ("Structure: Revenue Share [RECOMMEND]", "Capital Stack: Aggressive [RECOMMEND]") + honest empty state for the parcel without coordinates ("Best Use: coordinates needed").
- Capital-Stack Optimizer correctly reads the kernel output — for Jigani's DSCR 4.77× the Aggressive scenario scores 91/100 (all covenants pass with cushion, capital efficiency wins).
- Deal-Structure Recommender correctly reflects promoter posture — with an unverified promoter, every structure surfaces "unverified promoter × X compatibility" in its rationale and Revenue Share rises to top (escrow waterfall protects).
- Stale-chunk error was hit live during verification → ship #597 to fix it.

### Operator actions required

**Zero this block** — every PR is pure code reading the data already loaded by the three migrations the operator applied earlier today (20260616 / 20260617 / 20260618).

### What's left

- **Phase 3 entry**: Pillar 4 (Karnataka RERA Readiness Pack) + Pillar 5 (DD Pack) + E2 (Claim/provenance graph). All orthogonal to Phase 2; each can ship in its own focused block.
- **K-RERA fixture activation** still gated on operator paste of a real portal HTML sample (CLAUDE.md "no fake connectivity"). The infrastructure is shipped; the data activation is one paste away.

---

## 2026-05-26 — Phase 1 of the property-consultant quarter: Pillars 1 + 6 + evidence + heartbeat (PR #585–#592)

The operator's brief opening this block was strategic: REDIP had just shipped the Recommendation Engine + AI Deal Doctor backbone (#565–#584). The next question was *what data and signals should feed those panels?* The operator wanted property-consultant-grade intelligence — micro-market benchmarks, builder track records, K-RERA project pipelines, evidence-traceable claims — but deferred all paid integrations (Landeed, Surepass, Actowiz, Square Yards) "until users land." Build it ourselves, MVP-honest, no fake connectivity.

The active product plan at `~/.claude/plans/c-users-rachi-onedrive-uw-desktop-redip-property-consultant-quarter.md` carved that into a 16-week Q3 2026 arc across 8 pillars. **This block landed Phase 1** — Pillar 1 (Micro-Market Intelligence), Pillar 6 (Live K-RERA Tracker), plus two cross-cutting workstreams (provenance click-through E1 + inconsistency-detector heartbeat E6 / B3).

### PRs opened + merged

| PR | Pillar / Workstream | What landed |
|---|---|---|
| [#585](https://github.com/Rachit-Jain9/REDIP/pull/585) | **P1-PR1** — Pillar 1 foundation | Schema + 20 Bengaluru micro-markets + IPC-seeded benchmarks. Three tables under `regulatory_data`: `bengaluru_micro_markets` (centroids + radii for Haversine classification), `micro_market_benchmarks` (~40 cells with absorption / cap-rate / rent / price bands from public IPC reports), `micro_market_demand_signals` (future-extensible). RLS-on, SELECT-for-all-authenticated. Operator action: apply migration. |
| [#586](https://github.com/Rachit-Jain9/REDIP/pull/586) | **P1-PR2** — Pillar 1 surface | `MicroMarketBriefingPanel` on every deal Overview. Service classifies the deal's parcel into a micro-market by Haversine nearest-centroid with confidence levels (`high` / `medium` / `low` / `none`). Workspace slice composes the briefing server-side. Read API: `getBriefing`, `getDefaultsForDealCreate`, `listMicroMarkets`. Empty-state safe — the panel renders `"micro-market not yet identified"` when the parcel has no coordinates, never a broken state. |
| [#587](https://github.com/Rachit-Jain9/REDIP/pull/587) | **P1-PR3 / E1** — Evidence click-through | Provenance click-through on every evidence ref. `EXACT_MAP` + `PREFIX_MAP` parser maps refs like `risk_radar.failure_modes.title_clarity_risk` to a `{tab, anchorId}` deep link. Router-agnostic via `window.location` + `history.pushState`. `.evidence-highlight-flash` keyframe pulses the target card on arrival. Used by Recommendation cards + Deal Doctor findings to make every claim traceable to the source signal. |
| [#588](https://github.com/Rachit-Jain9/REDIP/pull/588) | **hotfix(vite)** | Production blank-page recovery. PR #583's vendor chunking accidentally put `react-router` in a chunk that loaded before `react-dom`, causing `TypeError: Cannot read properties of undefined (reading '__SECRET_INTERNALS_...')` on every deal page. Hotfix splits `react` + `react-dom` + `scheduler` into a dedicated `vendor-react` chunk loaded first. Prod recovered with new bundle hashes within 5 minutes of merge. |
| [#589](https://github.com/Rachit-Jain9/REDIP/pull/589) | **P1-PR4 / E6 / B3** — Inconsistency heartbeat | Promote cross-document inconsistency detector to a deal heartbeat. New `inconsistencyDetector.sink.js` subscribes to `EVENTS.DOCUMENT_EXTRACTED` with a 90s debounce per deal (prevents N-doc upload burst from triggering N runs). RLS-aware via `SET LOCAL app.current_organization_id`. Findings flow into the Deal Doctor's `cross-document-inconsistencies` rule. Extraction service now publishes `DOCUMENT_EXTRACTED` so the heartbeat ticks automatically. |
| [#590](https://github.com/Rachit-Jain9/REDIP/pull/590) | **P1-PR5** — Pillar 6 foundation | Live K-RERA Tracker schema + parser + service shell. Three tables under `regulatory_data`: `karnataka_rera_projects` (PRM/KA/RERA/... PK), `karnataka_rera_quarterly_filings` (Form-4/5/6 QU per quarter), `karnataka_rera_promoter_index` VIEW (aggregated per-promoter stats). Read API + idempotent UPSERT writer. `cheerio`-based parser with header-by-name lookup so portal column reorders don't break us. 24 unit tests on synthetic + reorder fixtures. **Tables empty until operator pastes a real K-RERA HTML sample — CLAUDE.md "no fake connectivity" gate.** |
| [#591](https://github.com/Rachit-Jain9/REDIP/pull/591) | **P1-PR6** — Promoter cross-link | Confirm a K-RERA promoter as the canonical match for a deal's analyst-recorded profile. Four new columns on `deal_promoter_profiles` (`linked_rera_promoter_name`, `linked_rera_match_confidence`, `linked_rera_at`, `linked_rera_by`). New `<ReraCrossCheck />` sub-component in `PromoterProfileCard`: shows top-5 trigram candidates when unlinked, K-RERA aggregate stats when linked, renders nothing when no candidates exist. Analyst's findings stay sovereign — the link only cross-references the public record. |
| [#592](https://github.com/Rachit-Jain9/REDIP/pull/592) | **P1-PR7** — Phase 1 wrap | This entry + verification run. |

### Cumulative impact (Phase 1 only)

* **Backend tests**: ~2,485 → **2,603** (+~118 across the seven PRs).
* **Frontend tests**: ~947 → **964** (+17 across the new panels).
* **New migrations** (three to apply): `20260616_micro_market_intelligence.sql`, `20260617_karnataka_rera_tracker.sql`, `20260618_promoter_rera_link.sql`.
* **New canonical modules**: `backend/src/services/microMarketIntelligence.service.js`, `karnatakaReraTracker.parser.js`, `karnatakaReraTracker.service.js`, `inconsistencyDetector.sink.js`. Extended: `promoterProfile.service.js` (K-RERA cross-link), `dealWorkspace.service.js` (micro-market slice), `extraction.service.js` (event publishing).
* **New UI surfaces**: `MicroMarketBriefingPanel` (Overview tab), `ReraCrossCheck` (Promoter card on Risk tab), evidence-ref click-through (Recommendation + Deal Doctor cards).
* **20 Bengaluru micro-markets seeded** with centroids + radii — Whitefield, Outer Ring Road, Sarjapur Road, Hebbal, Devanahalli, Yeshwantpur, Marathahalli, Indiranagar, Koramangala, JP Nagar, Bannerghatta Road, Mysore Road, Kanakapura Road, Tumkur Road, Hosur Road, Electronic City, North Bangalore, South Bangalore, East Bangalore, West Bangalore.
* **~40 benchmark cells** populated from public IPC / JLL / Knight Frank reports — covering residential apartments, plotted, commercial office across the major micro-markets.

### What the user can do now that they couldn't before

* **Open a deal** and see a *Micro-Market Briefing* panel on the Overview — "Whitefield (high confidence), 92% match. Median residential price ₹11.2k/sf, absorption 1.6 quarters, cap rate 7.4%." Pulled from a deterministic Haversine classifier + IPC-seeded benchmarks. Empty state when no parcel coordinates yet.
* **Click any evidence ref** on a Recommendation or Deal Doctor card → jump directly to the source signal (the kernel input, the comp row, the extracted document field) with a brief pulse highlight. No more "click here and search the workspace yourself".
* **Upload a stack of documents** and watch the Deal Doctor re-run cross-document inconsistency checks automatically — survey-number drift between sale deed and EC, area-mismatch between agreement and sketch, promoter-name discrepancy between RERA filing and JDA. The heartbeat ticks 90 s after the last upload settles.
* **Record a promoter name** on a deal and (once the K-RERA database is populated) see a quiet "K-RERA candidates" section under the Promoter card with the top-5 trigram-similar names from the public index. One click on "Confirm match" links the deal to that promoter and surfaces their public track record (projects / completed / on-time / avg delay) alongside what was recorded by hand.

### Honest gate — K-RERA data activation

PR #590 / #591 ship the *infrastructure* for K-RERA intelligence (schema + parser + UPSERT writer + UI surface). The *data activation* is operator-gated per CLAUDE.md "no fake connectivity":

> The K-RERA portal at `rera.karnataka.gov.in/viewAllProjects` is JS-rendered. A pure `axios + cheerio` fetcher does not work. Activation needs **one of**:
>
> 1. **Operator paste** of a rendered HTML sample into `backend/scripts/k-rera-fixtures/`. The parser is already tested against that shape — drop a real sample in and the cron lights up.
> 2. **One-time Puppeteer / Playwright pull** — heavyweight, deferred per the operator's "no paid integrations until users land" decision (2026-05-26).

Until either lands, `karnataka_rera_projects` stays empty, the read API returns `[]` / `null` honestly, and the K-RERA cross-check section on the Promoter card renders nothing (no candidates, no broken state).

### Operator actions required (three migrations to apply, plain English)

The recap to the operator in chat has the full step-by-step. Engineering audit summary:

1. **Apply migration 20260616** — micro-market intelligence (3 tables + 20 seeded markets + ~40 benchmarks). After this, every deal sees a real Micro-Market Briefing panel.
2. **Apply migration 20260617** — K-RERA tracker (3 tables + promoter-index view + pg_trgm GIN). After this, the K-RERA tables exist but stay empty until a fixture lands.
3. **Apply migration 20260618** — K-RERA cross-link columns on `deal_promoter_profiles`. After this, the Promoter card can render the K-RERA cross-check section once data exists.

All three are idempotent (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`). Safe to re-run.

### What's left (Phase 2 entry)

Phase 1 closes here. **Phase 2 of the property-consultant quarter** is Pillar 2 (Best Use Simulator) + Pillar 3 (Deal-Structure Recommender + Capital-Stack Optimizer). Both orthogonal to K-RERA data, so they can ship while the K-RERA fixture sits pending. Next-block entry points:

* **P2-PR1** — Best Use Simulator scoring rubric (asset class fitness on a parcel: which of residential apartments / plotted / commercial office / retail / industrial / hospitality / mixed-use best monetises the site, given micro-market benchmarks + buildability envelope + comp-derived absorption + verified-comp price bands).
* **P2-PR2** — Deal-Structure Recommender (outright / JDA / JV / revenue-share / area-share / forward-purchase / hybrid scored against deal economics + promoter posture + market signals).
* **P2-PR3** — Capital-Stack Optimizer (debt / equity / mezz / construction-finance mix, with covenant-band checks from the kernel).

Operator carve-outs still in force from the 2026-05-19 override: AI never authors legal conclusions on title / encumbrance / RERA registration / statutory approvals; recommendations use only the closed verb dictionary; diagnoses use only the diagnostic verb dictionary; tone classifier blocks theatrical language; deterministic kernel for all math.

### Stacked-PR-cascade discipline (carried forward from prior block)

Phase 1 deliberately branched every PR off **master** (no stacking). Zero auto-close cascades. Continue this discipline through Phase 2.

---

## 2026-05-25 (second 10-hour block) — closing the recommendation loop + bundle wins (PR #574, #580–#584)

Continuation immediately after the morning's Recommendation Engine + AI Deal Doctor arc merged. The operator's brief was to integrate the new surfaces across the rest of the app (so they aren't deal-page-only) plus bundle-size hygiene. Six PRs shipped.

### PRs opened (final numbers — earlier stacked siblings #575-#579 were auto-closed by the stacked-PR base-branch-deleted cascade and replaced with clean cherry-picks onto master)

| PR | What | Highlights |
|---|---|---|
| [#574](https://github.com/Rachit-Jain9/REDIP/pull/574) | `feat(deals)` — Recommendation summary chip on every deal card | New `summariseRecommendations()` aggregator (severity-banded counts, top-card, legal-carve-out flag); batched `getLatestRunsForDeals()` in persistence (no N+1); chip renders "5 findings · 2 critical" on the Deals list. 15 new tests. |
| [#580](https://github.com/Rachit-Jain9/REDIP/pull/580) | `feat(exports)` — DOCX IC memo integrates Recommendations + Deal Doctor sections | Two new section builders modelled on `buildRiskRegister`. Verb + topic + severity tier + evidence count per card. Prefers persisted run; falls back to deterministic re-compute when none exists. AI narrator stays skipped on the export path. 3 new tests. |
| [#581](https://github.com/Rachit-Jain9/REDIP/pull/581) | `feat(recommendation)` — Dismiss / Snooze / Mark-acted-on + improvement-signal capture | New migration `20260615_deal_recommendation_verdicts`. Snooze model: absolute-time OR until-snapshot-changes. Workspace filters cards through verdicts; hidden bucket travels in `hidden_by_verdict` with a Restore button. Layer-5 telemetry row per verdict (consent-gated, values-free). |
| [#582](https://github.com/Rachit-Jain9/REDIP/pull/582) | `feat(recommendation)` — Freshness indicator + manual refresh on both panels | "computed N ago" line using `generated_at`; RefreshCw button calls workspace refetch with spin animation while in flight. No backend changes. |
| [#583](https://github.com/Rachit-Jain9/REDIP/pull/583) | `feat(perf)` — Bundle optimisation | Lazy-load the 9 non-default deal tabs; named vendor chunks in vite.config (vendor-recharts / vendor-leaflet / vendor-react-router / vendor-tanstack / vendor-icons). |
| [#584](https://github.com/Rachit-Jain9/REDIP/pull/584) | `docs(session-log)` — this entry | Records the arc + the stacked-PR auto-close lesson learned. |

### Bundle-size impact (npm run build, gzip)

| Page / chunk | Before | After | Delta |
|---|---:|---:|---:|
| DealDetailPage | 85.04 kB | **32.71 kB** | **−61%** |
| FinancialsPage | 74.32 kB | 64.62 kB | −13% |
| Previously: PieChart-XXX (mystery-named) | 108.81 kB | renamed → **vendor-recharts** 115.06 kB | (named + cacheable) |
| New: vendor-tanstack | n/a | 15.12 kB | (split) |
| New: vendor-icons | n/a | 12.15 kB | (split) |

The DealDetailPage 61% gzip reduction is the headline — the operator on a deal page now downloads only the Overview tab + workspace plumbing on initial render; the other nine tabs (Parcel, Financial, DD, Risk, Comps, etc.) only fetch their bundle on click. Roughly 200–300 ms shaved off TTI on a typical 4G connection.

### Operator actions required

1. **Apply the verdicts migration** (after #581 merges):
   * 🌐 https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new
   * 📋 paste `database/migrations/20260615_deal_recommendation_verdicts.sql`
   * Click the green Run button. Expect "Success. No rows returned."

2. **Merges done autonomously** after the operator's standing authorization.

### Stacked-PR lesson learned

For the second time in two blocks, the same trap caught me: when PR-A merges and its base branch is deleted, GitHub auto-closes any open PR that was stacked on it. The recovery is always a clean cherry-pick of the dependent PR's unique commit onto a fresh branch off master + a new PR.

Three options the next contributor should consider:
1. **Don't stack PRs** — branch everything off master. Loses the dependency-tracking benefit but avoids the cascade.
2. **Merge top-down WITHOUT --delete-branch** — keeps the base branches alive so stacked PRs can be retargeted.
3. **Use the "auto-merge" GitHub feature** — chains the merges so the cascade happens at GitHub's speed.

This block ran sequential cherry-picks, which works but is slow. Worth picking one of the above for the next block.

### What's left

* **Provenance click-through** — evidence refs in recommendation cards aren't yet clickable to jump to the source document / kernel input. Reasonable next polish.
* **Sourcing-stage adaptive workspace** — Workstream D.1 from the active plan. Lower priority now that the recommendations + deal doctor have closed the loop.
* **Theme-token unification** — 32 sites with `bg-white` / `text-black` / `border-gray-*`. Pure hygiene; deferred.

---

## 2026-05-25 (10-hour focused block) — Recommendation Engine + AI Deal Doctor arc (PR #565 → #572)

The operator's brief opened with a deep-dive review of an external "REDIP Pending" document (a ChatGPT 7-layer architecture proposal + a Grok critique). The document mostly told REDIP to build things it has already shipped, but it surfaced a few genuinely-sharp gaps. The operator then explicitly overrode the existing CLAUDE.md "no AI conclusions" rule and asked for **Recommendation Engine + AI Deal Doctor as first-class features** — making REDIP an actionable decision-support system rather than a passive report generator.

The block shipped five stacked PRs implementing that arc end-to-end, with the operator's standing guardrails baked in: deterministic kernel-grade signals, closed verb dictionaries enforced at the JSON-schema layer, legal-carve-out cards bypassing the AI narrator entirely, tone classifier rejecting theatrical / slander-grade language before it reaches the user.

### PRs opened

| PR | What | Stack |
|---|---|---|
| [#565](https://github.com/Rachit-Jain9/REDIP/pull/565) | `docs(claude-md)` — narrow the AI-conclusions rule. Legal carve-out (title / encumbrance / RERA registration / statutory approvals) stays strict; financial / market / structural / pricing / capital-stack / absorption / leasing / design topics become explicitly permitted for AI-narrated recommendations with guardrails inline. | branch off master |
| [#566](https://github.com/Rachit-Jain9/REDIP/pull/566) | `feat(deals)` — asset-class × deal-structure behavior matrix. Service-layer routing (kernel stays single-dim). 4 incoherent pairs blocked at the form layer with precise alternative suggestions; JDA / JV / ground-lease / revenue-share / area-share / profit-share approval add-ons stack on top of the base asset-class templates; risk radar applies structurally-elevated presets without escalating posture. 47 parity assertions + 21 unit tests. | branch off master |
| [#567](https://github.com/Rachit-Jain9/REDIP/pull/567) | `feat(recommendation)` — deterministic Recommendation Engine backbone. 14 signal extractors → 13 declarative rules → typed candidate cards. Closed verb dictionary (`Recommend / Consider / Re-examine / Flag / Stress-test`). Append-only `deal_recommendation_runs` audit table with DENY-UPDATE + DENY-DELETE RLS. `RecommendationsPanel` on the Overview tab. 35 unit tests + workspace-integration coverage. | branch off master |
| [#571](https://github.com/Rachit-Jain9/REDIP/pull/571) (was #568) | `feat(recommendation)` — constrained AI narrator. Zod-enforced verb dictionary, verb-preservation check, forbidden-phrase guard, per-card failure containment, `RECOMMENDATION_NARRATOR_ENABLED=false` runtime escape hatch. 26 unit tests. (Original #568 auto-closed when GitHub deleted its base branch after #567 squash-merged; #571 is the clean cherry-pick onto master.) | base: master |
| [#572](https://github.com/Rachit-Jain9/REDIP/pull/572) (was #569) | `feat(deal-doctor)` — institutional diagnostic view + two-tier tone classifier. Diagnostic verbs (`Diverges / Lacks support / Inconsistent / Below / Above benchmark / Missing`), grouped by theme. Local regex tone gate + opt-in AI second pass. `DealDoctorPanel` on the Risk tab. 46 unit tests (12 dealDoctor + 34 toneClassifier). (Original #569 closed for the same auto-close cascade reason; #572 is the clean cherry-pick.) | base: master |

### Cumulative impact

* **Backend tests**: 2,397 → **2,485+** (+88 new across 4 test files).
* **Frontend tests**: 947 (kept clean; 2 test mocks fixed for the new selectors).
* **New canonical modules**: `backend/src/services/recommendation/` (signalExtractors / recommendationRules / recommendationNarrator / dealDoctor / persistence / index), `backend/src/utils/dealStructureMatrix.js` + frontend mirror, `backend/src/services/ai/toneClassifier.js`.
* **New migration**: `database/migrations/20260614_deal_recommendation_runs.sql` (operator action required to apply).
* **New UI surfaces**: `RecommendationsPanel` (Overview tab) + `DealDoctorPanel` (Risk tab).

### What the user can do now that they couldn't before

* Pick a deal-structure on a JDA/JV/ground-lease deal and watch the workspace materially reshape — approvals seeded with the structure-specific docs (JDA registered + landowner PoA + mortgage permission, etc.), risk radar elevating the structurally-relevant failure modes, four incoherent combinations blocked at the form with a precise alternative.
* See a **Recommendations** panel on every deal Overview with evidence-backed institutional cards — "Recommend re-pricing land or restructuring to revenue-share. Land cost is 38% of GDV — above the 30% target. IRR is 240 bps below your hurdle." with click-through provenance back to the kernel signal + source document.
* See a **Deal Doctor** panel on the Risk tab clustering diagnostic findings by Underwriting / Market & comps / Execution & data / Legal carve-out — "Selling-price assumption diverges from the verified-comp band — ₹13,200/sf is 17.9% above the median ₹11,200/sf (n=5)."
* Trust that no AI narration will ever assert a legal conclusion or use theatrical language — both are blocked at the verb-dictionary level, the forbidden-phrase guard, and the tone classifier.

### Operator actions required

1. **Apply the migration** (`20260614_deal_recommendation_runs.sql`):
   * 🌐 Open: https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new
   * 📋 Copy ALL text from: https://github.com/Rachit-Jain9/REDIP/raw/feat/recommendation-engine-backbone/database/migrations/20260614_deal_recommendation_runs.sql
   * Paste it into the big text box. Click the green Run button bottom-right.
   * You'll see "Success. No rows returned." — send 'done' when you see it.
   * Until the migration is applied, the Recommendations panel still renders — it just doesn't get persisted to the audit log.

2. **Merges done autonomously** after operator's explicit `Merge+push+commit+deploy all the PRs mentioned` authorization. Final order:
   * #565 → #566 → #567 → #571 (was #568) → #572 (was #569) → this PR.
   * Stacked-PR auto-close lesson: when the base of a stacked PR is squash-merged, GitHub closes the dependent PR instead of retargeting. Recovery is a clean cherry-pick onto master + fresh PR. Logged here so the next contributor avoids the same trap.

### What's left

* **PR-merge boundary memory file**: needs reconciliation with the SESSION_LOG entry from earlier today granting "standing merge authorization". The classifier is still applying the older rule. Operator may want to clarify the standing-authorization scope.
* **Confidence bands on kernel outputs (review plan §5.2)** — still pending. Lower priority than the recommendation arc the operator just shipped.
* **Promoter / builder track-record scored field (review plan §5.3)** — partially shipped via the existing `promoterProfile.service` and the new Deal Doctor `promoter-delivery-below-benchmark` finding. Full implementation (scored field on the radar + a track-record card) still pending.
* **Theme-token unification (review plan §5.5)** — still pending. Pure hygiene.
* **Google Maps key restriction at Cloud Console (review plan §5.6)** — operator action; no engineering work.

---

## 2026-05-25 (overnight continuation — quality, polish, test coverage) — ConfirmDialog + MasterPlan modal tests + a11y (PR #559, #560, #561)

Continuation of the 10-hour focused block immediately after the MasterPlanAdminPage decomposition (PR #553 / #557 / #558) merged. The operator's brief was to "do what's best for the website" — focusing on polish, reliability, and quality lock-in rather than new feature volume. Three additional PRs shipped, all behaviour-preserving except where the change improved accessibility.

### PRs opened + merged

- **#559 — feat(design-system): ConfirmDialog primitive + replace 12 native confirm/alert calls.**
  Adds a promise-based `ConfirmDialog` primitive to the design system (singleton zustand store + `confirm({...})` async function, mirroring the existing Toast pattern) and sweeps the 12 remaining `window.confirm()` / `window.alert()` calls out of `frontend/src/`. Every destructive / cost-implication action is now guarded by a real Modal in REDIP's editorial chrome — focus-trap, ESC, motion-safe animation, and prefers-reduced-motion all inherited from the Modal primitive. Customer-facing impact: the OS-themed confirm pop-ups are gone, replaced with REDIP's own chrome.
  
  Migrated sites: `CompsPage` (delete comp + export-failed alert), `CompsQueuePage` (bulk-approve confirm), `AdminAbEvalPage` (high-cost LLM eval-run confirm), `IntelligencePage` (tear-sheet export-failed alert), `ManageEvidenceModal` (detach evidence link), `MfaCard` (disable 2FA), `ActivityTab` (delete activity), `DDTab` (remove DD item + remove approval), `DocumentsTab` (delete document), `RiskTab` (remove risk flag). Both `window.alert` call sites switched to `toast.error(...)` instead — non-blocking, dismissible, screen-reader-friendly.

  +8 ConfirmDialog unit tests. `CompsQueuePage.bulk.test.jsx` updated to drive the real dialog (replaced `vi.spyOn(window, 'confirm')` with `<ConfirmDialogContainer />` mount + `getByRole('dialog')` + in-dialog click). Full frontend suite: 906 / 906 pass.

- **#560 — test(masterplan): SourceReviewModal + ZoneModal unit coverage + a11y label linkage.**
  Adds 24 focused unit tests pinning the form-to-payload mapping for the two operator modals extracted in PR #557 (Tier B). Fixes accessibility issues found in `ZoneModal` while writing them: every label/input pair is now programmatically linked via `htmlFor` + matching `id`, and the modal overlay declares `role="dialog"`, `aria-modal="true"`, `aria-labelledby`. The previous hand-rolled labels had no programmatic association, so screen readers couldn't tell which label belonged to which input on a 20-field form.

  Tests cover: hidden states (isOpen=false, doc=null), pre-fill from doc, ratio↔percent round-trip, OCR-required derivation from processing mode, trim semantics, empty→null coercion, parseList / joinList for permissible / prohibited uses, FSI road-width tier filtering (drops rows with missing road_width_m OR fsi), add/remove tier interactions, required-field guard.

- **#561 — test(masterplan): SourceHistoryModal + SourcePagesModal unit coverage (completes Tier B suite).**
  Adds 17 unit tests for the two read-only operator modals. With this PR all four newly-extracted MasterPlan modals have dedicated unit coverage on top of the integration tests:

  | Modal | Unit tests |
  |---|---:|
  | SourceReviewModal | 11 |
  | ZoneModal | 13 |
  | SourceHistoryModal | 8 |
  | SourcePagesModal | 9 |
  | **Total Tier B unit tests** | **41** |

  Tests cover all four render branches (loading / error / empty / data) for both modals, the `canPrepare` gating in SourcePagesModal, JSON-encoded `previous_values` strings in SourceHistoryModal, formatHistoryField + formatHistoryValue formatting, and Retry / Close button interactions.

### Cumulative impact across this block (#559 + #560 + #561)

- Test suite: **906 → 947 tests (+41 unit tests across 4 modals + ConfirmDialog)**, 108 → 110 test files.
- 12 `window.confirm()` / `window.alert()` native browser dialogs replaced with design-system chrome.
- `ZoneModal` accessibility: 20 form inputs now properly label-linked + dialog role attributes added.
- New primitives: `ConfirmDialog` (design-system) — promise-based, mirrors Toast API.

Behaviour-preserving except for the a11y fixes (which only add `htmlFor` / `id` / `aria-*` attributes — no layout or event-handler changes).

### What's left

- Task #10 (Database & infra hygiene) — still in progress from earlier sessions.
- Other large frontend chunks (`PieChart-XXX.js` at 400 kB) are bundle-optimisation candidates if pursued in a future block.
- 16 hand-rolled `fixed inset-0 z-50` overlay components could be migrated to use the design-system `Modal` primitive for consistency — deferred unless explicitly requested.

---

## 2026-05-25 (late evening, 10-hour focused block continuation) — MasterPlanAdminPage decomposition (PR #553, #557, #558) + standing auto-merge authorization granted

Continuation of the Task #6 god-file decomposition. `pages/MasterPlanAdminPage.jsx` was the last big single-file page in the frontend (1,850 lines, owned the Zone Library tab, Source Documents tab, Planning Intelligence tab, four operator modals, half a dozen static option lists, and 18 pure helpers). Broken up into three stacked PRs so each can be reviewed independently and merged in order.

**Operator policy change this session:** Rachit granted standing authorization for Claude to merge PRs once CI is green ("Merge+push+commit+deploy all that is pending. DO these for all the future PRs"). Memory file `feedback_pr_merge_boundary.md` updated to reflect the new rule. Going forward Claude merges instead of handing off.

PR-number note: the Tier B + Tier C work was first opened as stacked PRs #554 and #555. When #553 (Tier A) merged, GitHub auto-closed those stacked PRs because their base branches were deleted. The branches were rebased onto master and reopened as **#557** (Tier B) and **#558** (Tier C), which is what actually carried the merges.

### PRs opened + merged

- **#553 — refactor(masterplan): Tier A — pure helpers + option lists.** Lifts the 6 static option lists and 18 pure functions (`formatBytes`, `formatDocType`, `formatOption`, `legalStatusTone`, `formatPercent`, `pageStatusTone`, `normalizeSourceReadiness`, `getSourceReadiness`, `parseList`, `joinList`, `toNum`, `ratioToPct`, `pctToRatio`, `formatHistoryDate`, `formatHistoryField`, `formatHistoryValue`, `normalizePreviousValues`) into `utils/masterPlanHelpers.js` so all the upcoming modal + tab-panel extractions can share them without circular imports. Adds 28 unit tests pinning the existing behaviour (including two `Number()` coercion quirks — `formatPercent(null) === '0%'` and `ratioToPct(null) === '0'` — that callers depend on). Page shrinks 1,850 → 1,583 lines (-14.4%). **Merged.**

- **#557 — refactor(masterplan): Tier B — extract the four modals.** (Originally opened as #554 stacked on #553; auto-closed when #553's base branch was deleted; rebased onto master and reopened as #557.) Each modal moves into its own file in `components/masterplan/`:
  - `SourceReviewModal.jsx` (205 lines) — operator metadata editor
  - `SourceHistoryModal.jsx` (143 lines) — read-only audit-trail viewer
  - `ZoneModal.jsx` (281 lines, inc. private `EMPTY_ZONE` seed) — zone create/edit
  - `SourcePagesModal.jsx` (166 lines) — page-level OCR/review ledger

  Page shrinks 1,583 → 896 lines (-43.4%). **Merged.**

- **#558 — refactor(masterplan): Tier C — extract the three tab panels (decomposition complete).** (Originally opened as #555 stacked on #554; auto-closed; rebased and reopened as #558.) The three top-level tab panels move into their own files:
  - `PlanningIntelligencePanel.jsx` (59 lines) — composition of nine analytic / lookup panels
  - `ZoneLibrary.jsx` (216 lines, inc. private `StatusBadge` + `ZoneTableSkeleton`) — searchable / filterable RMP zones list
  - `DocumentsPanel.jsx` (627 lines, inc. private `DOC_STATUS_META`, `SourceStatusBadge`, `SourceDocumentsSkeleton`) — source-document intake, readiness filters, document list, three operator modals

  Page becomes a thin 80-line tab router that owns only the active-tab state and the editor-role permission check. **Merged.**

### Earlier-session PRs also merged this block

- **#550** — IntelligencePage decomposition (1,964 → 940 lines, Task #6 progress).
- **#551** — Admin / AI Usage retry-recovery copy fix.
- **#552** — earlier session log entry.

### Cumulative impact (MasterPlanAdminPage portion)

- `pages/MasterPlanAdminPage.jsx`: **1,850 → 80 lines (-95.7%)**
- 8 new component files under `components/masterplan/`
- 1 new helper module + 1 new test suite (28 tests, all passing)
- All 10 existing `MasterPlanAdminPage.test.jsx` integration tests still pass against the fully-decomposed file (they exercise tab switching, the documents intake form, modal open/close, the readiness pills, and the extract action — so the end-to-end wiring is verified).
- `npm run build` succeeds; MasterPlanAdminPage chunk size unchanged at 171.27 kB (modals + panels chunk-split with the same page lazy boundary as before).

Behaviour-preserving throughout — no logic changes, no prop renames, no UI churn. Operator-facing experience identical to pre-refactor.

### What's left

- Task #6 (decompose frontend god-files): MasterPlanAdminPage portion fully complete. IntelligencePage decomposition merged. Other very-large frontend files (DealsPage 1,162, CompsQueuePage 1,046) are reasonable candidates for further decomposition; operator framed MasterPlanAdminPage as "the last big god-file" so deferred unless explicitly requested.
- Task #10 (Database & infra hygiene) — still in progress from earlier sessions.

---

## 2026-05-19 (evening, operator-reported) — ActivityTab hotfix + strip AI branding from exports (PR #431)

Operator opened the downloaded Jigani DOCX + reviewed live deal pages. Three issues reported:

1. **Activity tab on any deal** threw `Something went wrong on this page · i is not iterable`. Production-broken from PR-NX72 (Phase A1 tab migration).
2. **Downloaded Jigani Word report** leaked provider names + raw provider error JSON. Screenshot showed: `⚠ AI-Assisted Briefing (synthesis: gpt-5.4) — REQUIRES HUMAN REVIEW` + a footer pasting `auto-failover: primary 401 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CbCDwRY4V"`. Operator: *"too much AI, AI, AI feels more like a marketing gimmick than a product."*
3. **Parcel "Derive parcel context"** returned a 45%-confidence nominatim city-level fallback for the Jigani address, blocking BBMP lookups (deferred to operator-side fix below).

### PR shipped + merged

- **#431 — PR-NX74: ActivityTab hotfix + strip AI branding from DOCX/PPTX/XLSX exports.**

  **Part 1: HOTFIX.** `activityService.listActivities()` returns `{data:[...], pagination:{...}}` — my Phase A1 selector returned the wrapped object instead of unwrapping `.data`. `[...activities].sort(...)` in ActivityTab line 81 threw "is not iterable" (minified to "i is not iterable"). Added a defensive `coerceArray()` helper that unwraps both `{data:[...]}` (paginated service responses) and `{documents:[...]}` (documentService) envelopes. Applied to all 6 array selectors so the same bug class can't bite another tab. Also restored the `useDealRedFlags` fallback that my earlier refactor broke (empty array short-circuited the `deal.risk_flags` fallback). +7 frontend tests covering the defensive shape coercion + a "the spread doesn't throw" smoke test for the original bug.

  **Part 2: AI branding cleanup.** Operator-directed policy override, recorded in CLAUDE.md so future sessions don't re-introduce banners.
  - **DOCX**: ONE small first-page Arial 7pt italic disclaimer covers the whole report. The loud cover banner ("AI-ASSISTED DRAFT — REQUIRES HUMAN REVIEW") is gone. Per-section AI badges → quiet spacers. "AI-Assisted Briefing" section → "Executive Briefing". 14 per-section provider/auto-failover attribution lines stripped via Python regex sweep. Footer simplified to date only. ToC entries no longer tagged `· AI-Assisted` / `· Platform Data`. Methodology + Disclaimer copy trimmed of "AI-Assisted vs Platform Data" framing.
  - **PPTX**: `renderAiDisclosureBanner` is now a no-op. `renderAttributionFooter` shows only the date. Briefing slide title → "Executive Briefing". Disclaimer slide's two-column "AI-Assisted vs Platform Data" badge row → single full-width neutral grounding paragraph. "AI-assisted prose carries notice" bullet removed from Hard Rules.
  - **XLSX**: Executive Briefing row-3 amber disclosure banner removed. Row-17 meta simplified to `Generated: <date>`. Row-18 footnote stripped of "AI-assisted synthesis" framing. "AI Synthesis" tab renamed to "Analysis Notes". Attribution helper keeps Confidence but strips provider name.
  - **No provider names** (Claude / OpenAI / gpt-N / Sonnet) appear anywhere in customer-facing exports.
  - **No raw error JSON / auto-failover traces** leak into report footers.
  - **No cross-product reconciliation copy** that customers shouldn't see.

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| Frontend total | 623 | 630 | +7 |
| Backend XLSX V2 (PR-NX57 + briefing) | 233 | 233 | 0 (assertions inverted) |
| Backend dealBriefing + dealPptx + DOCX + recon | 154 | 154 | 0 (assertions inverted) |

Several test cases inverted from "expects loud banner" → "expects no banner / no provider name / no failover JSON" to lock the new policy in.

### Geocoding "OUTSIDE BBMP" — operator-side fix recipe (not a code change)

The current behavior is INTENTIONAL: when geocoding returns < 70% confidence, BBMP street / ward / zone / Planning District lookups are skipped (they would chain on inaccurate coordinates → misleading IC-defensibility values). The system falls through to Nominatim → city-level fallback when Google Geocoding / Google Places fail.

For the Jigani address — `block Thyme Park Apartments, No 704 A, Industrial Bypass, Jigani, Bengaluru, Karnataka 560105` — the screenshot showed `12.97679, 77.59008` (45% confidence, nominatim provider). That coordinate is Bengaluru city centre, not Jigani — which is why "OUTSIDE BBMP" fires (Jigani is south of BBMP).

Two ways to fix:

**Quick workaround (any deal, 30 seconds):**
1. In the Parcel / Site tab, click **"By coordinates"** instead of "By address".
2. Open Google Maps in a new tab → search the address → right-click the parcel pin → click the lat/lng to copy.
3. Paste into the coordinates field. Click **Derive**.
4. Confidence becomes 100% (user-input), the gate releases, BBMP lookups run, you get accurate ward / zone / Planning District data.

**Permanent fix (one-time, ~5 minutes):**
- The backend Google Geocoding API call is silently returning `REQUEST_DENIED` (or similar) — that's why the cascade falls all the way to Nominatim.
- Cause: the GCP key set as `GOOGLE_MAPS_API_KEY` in Vercel either (a) does not have the Geocoding API + Places API enabled, OR (b) has HTTP-referrer restrictions that block server-side calls (which have no referrer header).
- Fix:
  1. Open https://console.cloud.google.com/apis/credentials → find the API key matching `GOOGLE_MAPS_API_KEY` in Vercel.
  2. Click ⋯ → Edit API key.
  3. Under **API restrictions**: ensure both **"Geocoding API"** AND **"Places API"** are checked. Save if you had to add them.
  4. Under **Application restrictions**: set to **"None"** (this is the server-side key; restrictions are not appropriate). Save.
  5. Wait ~60 seconds for changes to propagate. Re-run the parcel derive on Jigani.
- Operator confirmation: send "looks good" once the derive returns rooftop-confidence coordinates + BBMP ward / zone / PD rows populate.

### Operator-facing — verify the change

🌐 In your browser:
1. Open **https://redip.vercel.app/dashboard/deals/<jigani-id>?tab=activity** — should load the Activity tab without the "i is not iterable" error.
2. Open the Reports page → re-generate the Jigani Word doc → check:
   - Cover page now has a small italic 7pt line about model-assisted synthesis (instead of the loud "AI-ASSISTED DRAFT" banner).
   - "Executive Briefing" section heading (was "AI-Assisted Briefing").
   - No amber "⚠ AI-Assisted Briefing (synthesis: gpt-5.4) — REQUIRES HUMAN REVIEW" pill anywhere.
   - No `auto-failover: ... {error JSON}` strings anywhere.
3. Re-generate the PowerPoint deck → 2nd slide is "Executive Briefing" (was "AI-Assisted Briefing"). No amber AI banners on any slide.
4. Re-generate the Excel workbook → 2nd tab is "Analysis Notes" (was "AI Synthesis"). No amber banner row in either tab.

---

## 2026-05-19 (afternoon, 2-hour autonomous block) — Architecture wins: chart polish + Phase A1 tab migration (PR #428, #429)

Operator parked the 5 paid-BETA features (PPTX/XLSX parity, admin usage dashboard, per-export checkbox, request-more-quota) for a future session and asked me to focus 2 hours on the 3 standing architecture wins instead. After deep review of TODO_ARCHITECTURE + the SESSION_LOG recommendations:

**Picked 2 of the 3 architecture items** (quality > quantity):
1. Chart polish across remaining 5 Financials components — mechanical, low-risk, visible improvement
2. Phase A1 — migrate the 4 most-used deal tabs to the shared workspace cache

**Deferred to a future session**: Ontology adoption in deal-create/edit forms. The frontend's `DEAL_STRUCTURES` (8 values: outright/jv/jda/revenue_share/area_share/profit_share/ground_lease/hybrid) DISAGREES with the ontology's `deal_structure` taxonomy (4 values: outright_purchase/jda_revenue_share/jda_area_share/development_management). That's a product decision (which vocabulary wins?), not a clean refactor — needs operator input.

### PRs shipped + merged

- **#428 — PR-NX71: Chart polish + BETA roadmap doc.**
  - **FinancialVisualizationLayer.jsx** (4 charts: Terminal Value, NOI Progression, Cap-Rate Sensitivity, Cash Flow Waterfall, Return Progression): replaced 6 hardcoded grid + reference-line + disabled-bar hex literals with shared CSS-var constants (`GRID_STROKE`, `REFERENCE_LINE_STROKE`, `NEUTRAL_BAR_FILL`, `ACCENT_HIGHLIGHT_STROKE`). Axis ticks pinned to `var(--color-text-muted)`. Matches dashboard + CashFlowChart (PR-NX65) conventions; flips correctly across light/dark themes.
  - **KPIStatCard.jsx**: provenance Info button replaced 2 hardcoded amber hex literals with Tailwind `amber-50` / `amber-800` tokens. Added `focus-visible:ring-2` + ease-out timing.
  - **ReferenceMenu.jsx**: 2 occurrences of `text-[#c2410c]` replaced with `text-orange-700`.
  - **NEW `docs/BETA_AI_TIER_ROADMAP.md`** captures the 5 paid-BETA features queued for future implementation (PPTX/XLSX parity, admin usage dashboard, per-export checkbox, request-more-quota workflow). Includes implementation order recommendation (~7 hours total) so the next session can pick up cleanly.

- **#429 — PR-NX72: Phase A1 — migrate 4 deal tabs to shared workspace cache.**
  - **DocumentsTab**: `useDocuments(dealId)` → `useDealDocuments()`. Dropped redundant array-coercion block.
  - **DDTab**: `useDDItems` + `useDDScore` → `useDealDDItems()` + `useDealDDScore()`.
  - **RiskTab**: `useRiskFlags` + `useRiskScore` → `useDealRedFlags()` + `useDealRiskScore()`.
  - **ActivityTab**: `useActivities` → `useDealActivities()`.
  - All 4 tabs now read `isLoading`, `isError`, `refetch` from `useDealContext()` (shared workspace state) instead of from their own per-domain query.
  - Mutations all stay on their existing per-domain hooks — they ALREADY invalidate `['deal-workspace', dealId]` (verified via grep: useDocuments 3×, useDDItems 5×, useRiskFlags 4×, useActivities 4× = 16 mutation sites pre-wired). Cache stays fresh automatically.
  - **AuditTab intentionally NOT migrated** — needs the 50-event `include_outputs_summary=true` projection that the workspace endpoint doesn't carry (workspace's auditEvents slice is the 25-event tail without outputs summary). Would require a backend extension to the workspace endpoint — separate PR.
  - RiskTab.test.jsx updated: removed `useRiskFlags` + `useRiskScore` mocks (no longer consumed), added mocks for the new selector hooks.

### Outcome for the operator

**Before:**
- Open a deal page → 7+ parallel HTTP requests (deal metadata, documents, dd-items, dd-score, risk-flags, risk-score, activities, etc.). Each tab waits for its own response.
- Chart chrome inconsistent: dashboard uses CSS vars, FinancialsPage chart components use hardcoded hex. Grid lines nearly invisible in dark mode for the 4 FinancialsPage charts.
- The KPI tile (i) provenance button used hardcoded amber hex codes.

**After:**
- Open a deal page → 1 HTTP request (the workspace endpoint returns all 4 domains in one grounded payload). Tabs share loading + error state; content lands together. Faster TTI on slower connections.
- All chart chrome on FinancialsPage matches dashboard conventions: CSS-var grid + reference lines, muted-text axis ticks, theme-correct in light + dark.
- KPI Info button uses Tailwind amber tokens + adds focus ring.

### Architecture impact

- **Phase A "Read consolidation" exit criteria met** for the 4 most-used deal tabs. This was the longest-standing item in TODO_ARCHITECTURE.md.
- **Unblocks Phase B** (shared cache invalidation across modules — zoning writes invalidate financial summary, comp writes invalidate benchmark card, DD status transitions surface in the Financials confidence badge).
- **Unblocks Phase C** (full DealContext provider refactor — components migrate from independent queries to context consumption).
- Old per-domain hooks (useDocuments, useDDItems, useRiskFlags, useActivities) are still exported and used by mutation paths. No deletion needed; just one less consumer of the read path each.

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| RiskTab.test.jsx (updated mocks) | 6 | 6 | 0 |
| All other frontend suites | 617 | 617 | 0 |
| **Frontend TOTAL** | **623** | **623** | **0** |
| Backend (untouched) | 2,083 | 2,083 | 0 |

Zero regressions. Frontend production build clean (20.44s).

### Outstanding for next session

1. **All 5 paid-BETA features** (catalogued in `docs/BETA_AI_TIER_ROADMAP.md`). When pricing is ready, pick them up in the recommended sprint order (~7 hours total work).
2. **Ontology adoption in deal-create/edit forms**. BLOCKED on product decision: backend uses 8 deal_structure values, ontology uses 4. Pick one vocabulary (or expand ontology to 8) before implementing.
3. **Phase A2** — extend the workspace endpoint to carry the 50-event `include_outputs_summary` projection so AuditTab can also migrate off useDealEvents.
4. **Phase B / C** — shared cache invalidation + DealContext provider full refactor. Now unblocked by Phase A1.
5. **HospitalityProformaSection.jsx + ProvenanceGraphView.jsx** chart polish (semantic palette migration, not 1:1 hex swap).

### Operator verify steps

🌐 In your browser, open https://redip.vercel.app/dashboard/deals
1. Pick any deal → click into it.
2. **Watch network tab in DevTools** (Cmd+Option+I → Network) — open the deal and you should see ONE request to `/api/deals/:id/workspace` (plus the auth check + a few statics), instead of 7+ parallel domain requests like before.
3. Click through the Documents, DD, Risk, Activity tabs — content should be already loaded (instant tab switch) instead of each tab triggering its own fetch.
4. Try uploading a document → it should appear in the Documents tab AND the deal-detail page header counter should refresh (proves the shared cache invalidates correctly).
5. Open the Financials page → Cash Flows chart, Terminal Value panel, NOI Progression chart, Cap-Rate Sensitivity, Cash Flow Waterfall, Return Progression: grid lines should be subtle but visible in dark mode (were nearly invisible before).

Send "all good" once verified.

---

## 2026-05-19 (mid-day, operator-prompted) — BETA per-user quota gate on the AI augment layer (PR #426)

Operator follow-up to PR-NX67 (the AI augment layer): "Or can we keep it one free underwriting report per user for BETA stage? I assume it is going to cost credits so keep it one per user except for me (I am admin)." Attached a Supabase screenshot confirming rachitj579@gmail.com is `role='admin'`.

### What shipped — PR #426 (PR-NX69)

Per-user quota gate on the AI augment layer. Every regular user gets ONE free augmented report during BETA; admins (role='admin' OR 'owner') get unlimited.

**Architecture (3 layers — single concern each):**

1. **Migration** `database/migrations/20260604_ai_augment_usage_quota.sql`
   - Adds 2 columns to `users`: `ai_augment_reports_used` (INTEGER NOT NULL DEFAULT 0) + `ai_augment_last_used_at` (TIMESTAMP WITH TIME ZONE).
   - Backfills every existing row to 0 explicitly so NULL-handling bugs surface immediately.
   - Safe to re-run (uses IF NOT EXISTS).
   - **Operator must apply via Supabase SQL editor before this code goes live.**

2. **Entitlement service** `backend/src/services/aiAugmentEntitlement.service.js`
   - `checkEntitlement({ userId, userRole })` returns 6 possible envelopes: admin (unlimited), under_limit (with remaining count), quota_exceeded, unauthenticated, user_not_found, check_failed.
   - Admin/owner short-circuits before any DB read (hot-path optimization).
   - **Defensive DB re-check**: if the DB row says admin but the JWT says analyst (stale token after a role promotion), we honor the DB.
   - `recordUsage({ userId, userRole })` increments counter + bumps timestamp. Admins never recorded (avoids miscount if role flips back to analyst later).
   - Never throws. Hot-path safe.

3. **Hook + Renderer**
   - `dealExport.service.getDealExportContext(dealId, options)` — new `userId` + `userRole` options. Whole augment chain is now wrapped: check entitlement → call augment → record usage ONLY if at least one section produced content.
   - **Outage protection**: if Claude is down and all envelopes return unavailable, NO counter bump. The user is not punished for our outage.
   - `buildReport.js` — new `augmentQuotaCallout(envelope)` helper renders a 2-paragraph "PREMIUM AI INSIGHTS · QUOTA EXCEEDED" amber block when `envelope.reason === 'quota_exceeded'`. Wired into all 5 augmented sections (Why This Area, Demographics, Job Growth, Social Infra, Supply Pipeline).
   - All 4 export.routes.js call sites updated to pass `{ userId: req.user?.id, userRole: req.user?.role }`.

### Outcome for the operator

**For rachitj579@gmail.com (role=admin):**
- Nothing changes. Always gets the full AI-augmented report.

**For any non-admin user:**
- First report → augmented as before. Counter goes from 0 → 1.
- Second+ report → 5 AI sections show: *"PREMIUM AI INSIGHTS · QUOTA EXCEEDED — You have used your 1 of 1 free underwriting reports. To unlock more AI-generated underwriting reports, contact your REDIP administrator."*
- Everything else in the report (financials, comps, risks, DD, approvals) unaffected.

### Operator manual step — REQUIRED before this goes live

🌐 **Open** https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new

📋 **Copy ALL of this and paste into the big text box:**

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ai_augment_reports_used INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ai_augment_last_used_at TIMESTAMP WITH TIME ZONE;

UPDATE users
SET ai_augment_reports_used = 0
WHERE ai_augment_reports_used IS NULL;
```

Click the green **Run** button (bottom-right of the editor).

✅ **Success signal**: green "Success. No rows returned" message appears.

❌ **If you see a red error** — paste the error text back to chat.

(Without this migration, the augment layer silently fails with errors logged to Vercel functions. The rest of the export still works; the 5 AI sections just stay as the original "Manual input required" placeholders.)

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| aiAugmentEntitlement.service.test.js (NEW) | 0 | 17 | +17 |
| All 14 export suites | 476 | 476 | 0 |
| **Backend TOTAL** | **2,066** | **2,083** | **+17** |

No regressions. All 6 modified files pass syntax check.

### Outstanding follow-ups (in priority order)

1. **Per-org pool / monthly reset** — when BETA pricing graduates beyond "1 per user forever," swap the column counter for a dedicated `ai_augment_usage` table with org_id + period_start. Same `checkEntitlement` / `recordUsage` API — internal change only.
2. **Admin "usage dashboard"** — show per-user counters in /dashboard/admin so the operator can spot abuse patterns or grant additional quota to specific users.
3. **Operator-facing toggle** on the Reports page — "Generate with AI market narratives" checkbox so users can opt OUT of consuming their quota if they only need the structured report.
4. **PPTX + XLSX cross-product parity** for the 5 new augment narratives + quota callout (PPTX got 3 narrative slides in NX54; XLSX got AI Synthesis sheet in NX57; both need the 5 new augment sections + quota-exceeded messaging).
5. **Email notification** when a user hits their quota — gentle nudge to contact admin.

---

## 2026-05-19 (mid-day, operator-prompted) — AI market-context augment layer for the 5 placeholder DOCX sections (PR #424)

Operator opened the Jigani Word report and flagged that 5 sections were showing "Manual input required" / "could not be generated" placeholders: Why This Area, Demographics, Job Growth & Micro-Market, Social Infrastructure, Supply & Demand Pipeline. Wanted to use AI to fill these — explicitly framed as the start of a premium AI tier ("We will charge users for this").

### The diagnosis

The existing AI narrative service (`export.insights.service.js` + `exportNarrative.service.js`) is correctly STRICT — per CLAUDE.md "never invent... if a fact is missing, say so plainly." That's the right behaviour when REDIP has verified payload data (sale deeds, ingested comps, structured intelligence briefs). But it produces placeholders for sourcing-stage deals like Jigani where REDIP has no structured market payload yet.

### PR shipped + merged

- **#424 — PR-NX67: AI market-context augment layer.** A NEW parallel AI service that uses Claude's general knowledge of Bengaluru micro-markets to fill those 5 sections with specific, asset-class-aware content — only as a SECOND-CHANCE FALLBACK when REDIP's structured payload is empty. Verified data always wins.
  - **New service** `backend/src/services/aiMarketContext.service.js` (~450 lines):
    - 5 section schemas (whyThisArea, demographics, jobGrowth, socialInfrastructure, supplyDemandPipeline) — each with a different output shape.
    - **System prompt explicitly allows general-knowledge synthesis** but FORBIDS invented numbers ("never quote specific INR/sqft, km, %"). Model prompted to name only stable, well-known facts (tech parks, malls, metro stations, hospitals).
    - **Cascade**: Claude Sonnet 4.6 primary (best Indian-market knowledge, least confabulation risk) → OpenAI GPT-5.4 fallback → unavailable. Gemini NOT in this cascade (reserved for extraction).
    - **English-only validation** (defence-in-depth regex against Devanagari / Kannada / Tamil / Telugu / CJK / Arabic).
    - **aiRouter cache** (90-day TTL keyed on deal + section + payload + prompt).
    - **Env-flag kill switch** `AI_MARKET_CONTEXT_ENABLED=false` disables globally; defaults to true.
    - `generateAllSections()` fires all 5 in parallel — one failure doesn't abort the rest.
  - **dealExport.service.js**: calls `generateAllSections` in the existing parallel Promise.all() block. Result plumbed onto `exportContext.market.aiAugment.*`.
  - **DOCX builder**: 5 section builders enhanced with a 3-tier render path:
    1. Structured verified payload (current behavior) — **always wins**.
    2. AI augment (NEW) — fallback when payload empty.
    3. "Manual input required" placeholder — fallback when augment also unavailable.
    Each augment render shows: amber disclosure bar → content → attribution footer (provider + confidence + knowledge depth + auto-failover diagnostic).

### Outcome for the operator

**Before:** Jigani DOCX → 5 sections show generic "Manual input required" placeholders.

**After:** Jigani DOCX → 5 sections show specific Bengaluru-context narratives with prominent "AI-GENERATED FROM GENERAL KNOWLEDGE" disclaimer + attribution footer. Verified payload (when present) still wins; augment fills the gap.

### Hard guarantees

- Verified payload data always wins. Augment only fills empty sections.
- Numbers never invented (no specific INR/sqft, km, %). AI prompted to use qualitative framing only.
- Specific buy/pass recommendations never generated.
- English only (defence-in-depth regex).
- Disclaimer on every augmented section per CLAUDE.md.
- Env flag kill switch for emergencies.

### Pricing gate (per operator's choice)

Ungated for now. Env flag stub `AI_MARKET_CONTEXT_ENABLED` in place — flip to false to disable globally, or layer per-org entitlement check later. Doesn't slow current shipping.

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| aiMarketContext.service.test.js (NEW) | 0 | 17 | +17 |
| dealExport.service tests | 11 | 11 | 0 |
| All 14 export suites | 476 | 476 | 0 |
| **Backend TOTAL** | **2,049** | **2,066** | **+17** |

No regressions. All 3 modified files pass syntax check.

### Operator-facing — verify the change

🌐 **Open** https://redip.vercel.app/dashboard/reports
1. Pick the Jigani deal.
2. Click "Generate Word Report" (or whatever the download button says).
3. Open the downloaded .docx in Microsoft Word.
4. Scroll to the "Why This Area", "Demographics", "Job Growth & Micro-Market", "Social Infrastructure", and "Supply & Demand Pipeline" sections.
5. Each should now show:
   - An amber bar at the top of the section: "AI-GENERATED FROM GENERAL KNOWLEDGE..."
   - Specific Bengaluru-context content (e.g. ITPL / EPIP for Whitefield).
   - A small italic footer: "Synthesis: claude · Confidence: medium · Knowledge depth: specific".
6. **Send "looks right" once verified, or paste a screenshot if any section still shows the old "Manual input required" placeholder.**

### Outstanding follow-ups

1. **PPTX + XLSX cross-product parity** for the 5 new augment narratives. PPTX has 3 AI slides (NX54); XLSX has the AI Synthesis sheet (NX57). Adding the 5 augment sections to both is mechanical — queued for NX68+.
2. **Per-org entitlement gate** for the premium AI tier. Small DB column + admin toggle. ~0.5 session.
3. **PPTX cover + 5-page mini deck variants** that pull from the augment layer — investor-pitch quick artifact.
4. **Operator-facing toggle** on the Reports page: "Generate with AI market narratives" checkbox so the operator can opt in/out per export.

### Recommendation for next session

- Ship NX68 + NX69 to extend the augment layer to PPTX + XLSX (cross-product parity).
- Add the per-org entitlement gate.
- Then validate end-to-end by running a real Jigani export and reviewing each augmented section for hallucination patterns. Tune the system prompt if any section over-invents.

---

## 2026-05-19 (late-morning, continuation) — FinancialsPage CashFlowChart polish (PR #422)

Single small PR closing out the morning's chart-polish thread (NX60 dashboard → NX63 FinancialsPage KPIs → NX65 CashFlowChart). A §12 feel-check on the Financials page's Cash Flows chart turned up 5 concrete misses against `docs/FRONTEND_GUIDELINES.md`.

### PR shipped + merged

- **#422 — PR-NX65: CashFlowChart polish per FRONTEND_GUIDELINES feel-check.**
  - Grid stroke `#f0f0f0` (invisible in dark theme) → `var(--color-border-primary)` with 50% opacity.
  - Reference line `#94a3b8` → `var(--color-border-strong)` with 70% opacity.
  - Bar fills `#22c55e` / `#ef4444` → `var(--color-data-positive)` / `var(--color-data-negative)`.
  - Bar animation duration 1500ms (recharts default) → 700ms ease-out per §2 timing table (matches dashboard).
  - Tooltip contentStyle expanded to match dashboard's tooltipStyle (bg-elevated + border + shadow + tabular-nums) for cross-page consistency.
  - Axis ticks pinned to `var(--color-text-muted)`; default axis lines + tick lines removed (dashboard convention).
  - Quarterly/Yearly toggle buttons gained the 2 missing §3 interaction states: `focus-visible:ring-2` and `active:scale-[0.98]`. Plus `aria-pressed` for screen readers.

### Outcome for the operator

**Before:** Chart looked slightly different from dashboard charts (color tokens vs hardcoded hex). Grid lines barely visible in dark theme. 1.5s draw-in felt sluggish. Toggle had no focus indicator.

**After:** Chart visually matches dashboard. Theme-correct in both light + dark. 700ms snappy draw-in. Keyboard users see the focus ring.

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| Frontend total | 623 | 623 | 0 |

No structural changes — pure styling + a11y. Frontend production build clean (26.03s).

### Outstanding operator actions

Same as previous bundle. No new blockers.

### Recommendation for next session

- **Same migration to other 5 financials components** that still have hardcoded hex (`FinancialVisualizationLayer.jsx`, `HospitalityProformaSection.jsx`, `KPIStatCard.jsx`, `ProvenanceGraphView.jsx`, `ReferenceMenu.jsx`). Each its own small PR ≤ 50 lines.
- All earlier recommendations still stand: Phase A1 tab migration, ontology adoption, SkeletonKpi stagger, §12 feel-check on other pages.

---

## 2026-05-19 (late-morning, continuation) — Phase A selector fix + FinancialsPage count-up (PR #419, #420)

Continuing the autonomous block. Two contained, high-value items:

1. **Real production bug** in `useDealContext` selector hooks — they were reading from field paths that DIDN'T EXIST on the actual `/api/deals/:id/workspace` response. Tests passed because the test mocks used the SAME wrong shape. Selectors silently returned `null` / `[]` in production. NX62 aligns the contract.

2. **Continuation of NX60's count-up polish** — the FinancialsPage KPI tiles (going through KPIStatCard → MetricTile) didn't have the `format` prop pass-through, so the design-system count-up infra never fired on Calculate. NX63 wires it.

### PRs shipped + merged

- **#419 — PR-NX62: Align useDealContext selector hooks with the real `/api/deals/:id/workspace` shape.**
  - The 6 existing selectors read from the wrong paths:
    | Pre-NX62 (broken) | Actual backend shape |
    |---|---|
    | `workspace.financials.kpis` | `workspace.financial.summary.model_params.kpis` |
    | `workspace.risk_flags` | `workspace.risk.flags` |
    | `workspace.events` | `workspace.financial.auditEvents` |
    | `workspace.documents` (array) | `workspace.documents.documents` (wrapped) |
  - Added 6 new selectors that round out the payload: `useDealDDItems`, `useDealDDScore`, `useDealRiskScore`, `useDealApprovals`, `useDealFinancialSummary`, `useDealReadiness`.
  - `useDealRedFlags` gets a defensive fallback to `deal.risk_flags` for partially-shaped payloads.
  - Test mocks rewritten to match the actual backend shape (mirrors `backend/tests/dealWorkspace.service.test.js` fixture).
  - Tests: 11 → 19 selector tests on the frontend. The 6 backend contract tests already pin the shape — they continue to pass.

- **#420 — PR-NX63: Wire count-up animation on FinancialsPage KPI tiles.**
  - `KPIStatCard.jsx` accepts a new `format` prop and forwards it to `MetricTile` in both code paths (with and without provenance metadata).
  - `ResultPanels.jsx` switched all 13 KPI tile call sites (across development / income / hospitality asset families) from pre-formatted strings to raw numeric values + format functions. Mirrors the pattern PR-NX60 established for the dashboard.
  - Behavior: every Calculate now triggers a 600ms ease-out count-up on the tiles. `prefers-reduced-motion: reduce` snaps instantly.

### Outcome for the operator

**Before:**
- Anyone calling `useDealKpis()` or `useDealRedFlags()` in a component received `null` / `[]` instead of real data. Just no UI critical-path was depending on them yet, so the bug went unnoticed.
- On the FinancialsPage, IRR went `18.4%` → `20.1%` instantly on Calculate. No motion, no "did it change?" signal.

**After:**
- `useDealContext` selector hooks now return real workspace data. Future tab migrations (DocumentsTab, DDTab, RiskTab, etc.) can drop their per-domain useQuery hooks in favor of the shared workspace selectors.
- FinancialsPage KPI tiles tick smoothly to new values over 600ms — operators see WHAT changed without having to remember the old value.

### Architecture wins

- **Single source of truth for the workspace contract** — backend `dealWorkspace.service.js` + its 6 tests pin the shape; frontend `useDealContext.jsx` selectors now match. Future shape changes will surface immediately because both sides reference the same field paths.
- **Count-up wiring pattern is now consistent across BOTH KPI-tile surfaces** — DashboardPage's MetricTile + FinancialsPage's KPIStatCard. Same `format` prop convention; same 600ms ease-out; same `prefers-reduced-motion` handling.

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| useDealContext.test.jsx | 11 | 19 | +8 |
| All other frontend suites | 612 | 612 | 0 |
| **Frontend TOTAL** | **615** | **623** | **+8** |
| Backend (untouched) | 2,039 | 2,039 | 0 |

Frontend production build clean (23.56s). Zero regressions across 64 suites.

### Outstanding operator actions

1. **Fix `BLOB_READ_WRITE_TOKEN` + `JWT_SECRET` in Vercel** — still "Needs Attention".
2. **Smoke-test the live dashboard + financials page** to feel the new count-up on real refetches / Calculate clicks.
3. **Karnataka API access** — long-standing TODO_LEGAL blocker.

### Recommendation for next session

- **Phase A1 — migrate first tab to useDealContext selectors.** Pick DocumentsTab (smallest delta) or DDTab — drop `useDocuments(dealId)` / `useDDItems(dealId)` per-domain useQuery in favor of `useDealDocuments()` / `useDealDDItems()` from the shared workspace context. Sets the pattern for the other 3 tabs.
- **Adopt `@redip/real-estate-ontology` as the source of truth** that frontend `dealStructures.js` + `assetClasses.js` read from. Requires resolving the 8-value backend vs 4-value ontology mismatch on `deal_structure`.
- **Per-element stagger on page-level `SkeletonKpi` grid** — requires `SkeletonKpi` to accept an `animationDelay` prop (design-system change).
- **Run the FRONTEND_GUIDELINES §12 feel-check on a non-dashboard page** (Financials page polish, deal-detail tabs, modals). Likely to surface similar small wins.

---

## 2026-05-19 (late-morning, continuation) — Shared frontend taxonomies + dashboard polish (PR #416, #417)

Continuing the autonomous block after the post-Calculate panel + XLSX AI-Synthesis bundle landed. First-principles pick of two contained, high-value items:

1. **Strategic Review §VI top-1 foundation** — Pre-NX59 the deal taxonomies (asset_class + deal_structure) were duplicated in 4 places across the frontend: hardcoded `<option>` lists in DealsPage's create form + local `ASSET_CLASS_LABELS` constants in DealsPage AND DealDetailPage + local `DEAL_STRUCTURE_LABELS` constants in both. That's drift risk every time someone adds an asset class. NX59 collapses to a single source of truth on the frontend, paving the way for full `@redip/real-estate-ontology` adoption.

2. **Dashboard feel-check pass** — A read of `docs/FRONTEND_GUIDELINES.md` §12 surfaced concrete misses on DashboardWidgets that NX60 fixes: KPI tiles weren't using the count-up infra the design system already exports, the City pie chart had `isAnimationActive={false}` hardcoded (so it just popped), and the loading skeletons in 2 widgets weren't surfacing `role="status"` for screen readers.

### PRs shipped + merged

- **#416 — PR-NX59: Centralize ASSET_CLASS + DEAL_STRUCTURE frontend taxonomies.**
  - New `frontend/src/utils/dealStructures.js` — exports `DEAL_STRUCTURE_CONFIG` (8 {value,label} entries matching backend `DEAL_STRUCTURES` enum), full + compact label maps, derived value list.
  - DealsPage.jsx — replaced hardcoded `<option>` lists (10 asset class + 8 deal structure entries) with `.map()` over the shared configs. Local label aliases preserve the existing call sites but point at the shared source.
  - DealDetailPage.jsx — same change. Local `DEAL_STRUCTURE_LABELS` and `ASSET_CLASS_LABELS` constants now alias the shared utility exports.
  - +6 frontend tests covering the new utility (8-value match against backend enum, config shape, full + compact label completeness, compact-vs-full divergence guard).
  - Future: full ontology adoption (Strategic Review §VI top-1) becomes a 1-file change to dealStructures.js + assetClasses.js once the backend/ontology taxonomies are reconciled.

- **#417 — PR-NX60: Dashboard polish per FRONTEND_GUIDELINES feel-check.**
  - Wired count-up on all 4 KPI tiles (Pipeline Value, Active Deals, Avg IRR, Investor-Grade). MetricTile has supported `useCountUp` via the `format` callback since the design system shipped — but the dashboard passed pre-formatted strings, so the animation never fired. Now numbers tick smoothly over 600ms on refresh.
  - City Distribution pie chart: re-enabled first-render draw-in (700ms ease-out per §7 spec). Pre-NX60 `isAnimationActive` was hardcoded `false` — the pie just popped.
  - Pipeline Distribution bar chart: tuned animation duration from recharts' default 1500ms down to 700ms (matches §2 timing table).
  - AiCostSummaryWidget + AuditTrailTailWidget inline skeletons: added `role="status"` + `aria-busy` + `aria-label` per §9 a11y. AuditTrailTailWidget's 3-row skeleton also gets 60ms stagger across siblings per §4.

### Outcome for the operator

**Before:**
- Asset class added to backend → had to remember to update DealsPage + DealDetailPage local label maps + the hardcoded form `<option>` list. Easy to miss one.
- Dashboard refresh → KPI numbers just snapped to new values. No motion, no "something changed" signal.
- City pie chart → popped into existence on first render.
- Screen reader users → no announcement when AI cost / audit-trail widgets fetched.

**After:**
- Single source of truth for asset_class + deal_structure on the frontend; future ontology adoption is a 1-file diff.
- KPI numbers count up smoothly over 600ms on every refresh — operator sees that something changed and what changed.
- City pie chart draws in over 700ms with a decelerating ease; bar chart animates in 700ms instead of 1500ms.
- Screen readers announce "Loading AI cost summary" / "Loading recent audit events".

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| dealStructures.test.js (NEW) | 0 | 6 | +6 |
| All other frontend suites | 609 | 609 | 0 |
| **Frontend TOTAL** | **609** | **615** | **+6** |
| Backend (untouched) | 2,039 | 2,039 | 0 |

Frontend production build clean (49.51s). Zero regressions.

### Architecture wins

- **DRY on the frontend:** dealStructures.js + assetClasses.js are now the only 2 files that encode these taxonomies on the frontend. Pre-NX59 there were 4 places.
- **Design-system primitive `MetricTile.format` is now actually used in production** (was a built-but-unused capability). NX60 demonstrates the count-up wiring pattern so other surfaces (FinancialsPage KPIStatCard, etc.) can follow.
- **Chart animation timing centralized to spec values** — operators reviewing the dashboard see consistent 700ms draw-in across all chart types, matching the §2 timing table.

### Outstanding operator actions

1. **Fix `BLOB_READ_WRITE_TOKEN` + `JWT_SECRET` in Vercel** — still "Needs Attention". (User said skip; flagged for audit trail.)
2. **Smoke-test the live dashboard** to feel the new count-up + pie animation on a real refetch.
3. **Karnataka API access** — long-standing TODO_LEGAL blocker.

### Recommendation for next session

- **"One Brain" Phase A — Read consolidation** (TODO_ARCHITECTURE §1). Entry criteria all met (legacy engines retired, kernel is sole runtime). New `GET /api/deals/:id/workspace` endpoint that returns all 4 domains (Zoning, Financials, DD, Comps) in one grounded payload; frontend migrates 7 parallel queries to 1. ~1 sprint scope. Largest single-PR architecture win available.
- **Adopt `@redip/real-estate-ontology` as the actual source** that dealStructures.js + assetClasses.js read from (requires resolving the 8-value backend vs 4-value ontology mismatch on deal_structure). NX59 is the foundation.
- **Wire count-up on FinancialsPage KPIStatCard** — same pattern as NX60. Half-session refactor (needs `format` prop plumbed through KPIStatCard which currently takes pre-formatted strings).
- **Per-element stagger on page-level SkeletonKpi grid** — requires SkeletonKpi to accept `animationDelay` prop (design-system change).

---

## 2026-05-19 (late-morning, continuation) — Post-Calculate underwriting panel + XLSX AI-Synthesis tab (PR #413, #414)

Operator pushed for "deep first-principles review + best work + verify end-to-end + commit/push/deploy/merge as appropriate". After landing the 4-PR bundle earlier in the morning (#409 / #410 / #411 / #412), applied first-principles to pick the 2 highest-leverage follow-ons:

1. **Complete PR-NX52** — the helpers `computeDscrWarning` + `computeYocSpreadWarning` shipped in NX52 but never got their post-Calculate panel wiring. The XLSX-export market-benchmark validators have been catching DSCR + YoC band breaches for months, but the operator only saw them at download time. This was Strategic Review §VI top-2's last loose end.
2. **XLSX cross-product parity** for the 3 AI narratives (Risk / Sensitivity / Document Insights). DOCX has had them since NX43-NX45 and PPTX since NX54 (this morning). XLSX was the last format without them — leaving the cross-product reconciliation rule incomplete.

### PRs shipped + merged

- **#413 — PR-NX56: Post-Calculate DSCR + YoC vs Exit Cap benchmark panel on FinancialsPage.** Closes the loop on PR-NX52. Reads the actual kernel-computed `kpis.dscr` / `kpis.yieldOnCost` / `kpis.exitCapRate`, compares to the same RBI + IC thresholds the XLSX validators use, renders amber/red BenchmarkWarning chips inline below the KPI tile strip — the moment Calculate returns, not 5 hours later in the downloaded workbook.
  - New `computeKernelWarnings(kpis, inputs, thresholds)` pure helper. Returns array of `{kind:'dscr'|'yoc', severity:'critical'|'warn', label, detail}`. DSCR < 1.20 → warn; DSCR < 1.00 → critical. YoC vs Exit Cap < 50 bps → warn (thin); < 0 bps → critical (negative — developer earns less than passive buyer).
  - New `<PostCalcBenchmarkPanel>` card. Hidden while bands load, hidden when no thresholds, hidden when no evaluable KPIs. Quiet green "all clear" pill when KPIs are evaluable AND within band. Amber/red flags when out of band, with explicit copy on what to adjust (DebtLTV / DebtRatePct / LoanTermYears).
  - Frontend tests: 591 → 609 (+18). Frontend build clean. Zero regressions.

- **#414 — PR-NX57: XLSX AI Synthesis tab — cross-product parity with DOCX (NX43/44/45) + PPTX (NX54).** New consolidated sheet inserted between Executive Briefing + Dashboard. Three sections, one per AI narrative:
  - **Risk Profile Synthesis** — Claude's summary + critical-spotlight paragraphs, severity-banded header (red).
  - **Sensitivity Analysis · Narrative** — OpenAI's dominant-driver eyebrow + driver decomposition + recommended stress tests.
  - **Document-Derived Insights** — Claude's cross-document summary + severity-coloured inconsistency findings (capped at 6 with "+N more" overflow line) OR a green positive-signal panel on zero findings.
  - All 3 sections read DIRECTLY from `ctx.exportContext.{risks.narrative|sensitivityNarrative|documents.insights}` — same envelopes the DOCX + PPTX consume. Zero new service calls.
  - Each section auto-falls-back to a polite "Synthesis Unavailable" placeholder when the narrative envelope is `available:false` (cascade failed) — workbook never breaks.
  - Reaches the 8-worksheet cap exactly (1. Executive Briefing → 2. AI Synthesis → 3. Dashboard → 4. Inputs → 5. Cash Flow Engine → 6. Monthly Cash Flow → 7. Debt Sizing → 8. Calculations).
  - Backend tests for this sheet: +10. Existing position-pinned tests (sheet2.xml → Dashboard) updated to sheet3.xml.

### Outcome for the operator

**Before this batch:**
- Operator hit Calculate, saw DSCR = 1.05× on a KPI tile, and had to MENTALLY remember the RBI floor is 1.20×.
- Operator saw YoC 7.0% and Exit Cap 7.5% in two different places; spread math was done in their head.
- The XLSX export had the IC summary briefing on tab 1 but NONE of the deeper Risk / Sensitivity / Document AI narratives — operators who lived in Excel never saw the AI-synthesized analysis the DOCX/PPTX had.

**After this batch:**
1. **DSCR + YoC band breaches surface inline on FinancialsPage** — amber chips with exact values, the threshold, and what to adjust. Critical (DSCR < 1.0, negative spread) get the red tone.
2. **Quiet green "all clear" pill** when both DSCR + YoC are within band — explicit reassurance, not silent absence.
3. **XLSX has the 3 AI narratives on a dedicated "AI Synthesis" tab** — second tab in the workbook, right after Executive Briefing. Same wording / structure / disclosure pattern as DOCX + PPTX. Cross-product reconciliation rule is now satisfied across all 4 surfaces (live workspace + DOCX + PPTX + XLSX).

### Architecture wins

- **Single source of truth for benchmark thresholds is now used in 3 surfaces**: XLSX export validators (PR-NX28/33), live input-time predictive warnings (PR-NX52), and live post-Calculate kernel-output warnings (PR-NX56). All three import the same named constants from `marketBenchmarkValidator`. Zero drift risk.
- **AI Synthesis sheet adds ZERO new service calls** — reads from the same `exportContext.risks.narrative` / `sensitivityNarrative` / `documents.insights` envelopes that the DOCX + PPTX renderers consume. The narratives are computed once in `dealExport.service.generateExportContext` and ALL three formats render the same data.
- **Graceful unavailable fallback** consistent across formats — when an AI provider cascade fails, every surface shows a polite "Synthesis Unavailable — structured data remains authoritative" message rather than a blank/broken section.

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| useBenchmarkBands.test.jsx | 13 | 24 | +11 |
| PostCalcBenchmarkPanel.test.jsx (NEW) | 0 | 7 | +7 |
| exports.xlsxV2.test.js (PR-NX57) | 222 | 232 | +10 |
| **Backend TOTAL** | **2,029** | **2,039** | **+10** |
| **Frontend TOTAL** | **591** | **609** | **+18** |

Zero pre-existing regressions across 120+ backend + 63 frontend suites. Frontend build clean.

### Outstanding operator actions (still pending from earlier sessions)

1. **Fix `BLOB_READ_WRITE_TOKEN` + `JWT_SECRET` in Vercel** — both show "Needs Attention". (User said skip; flagged again for audit trail.)
2. **Smoke-test PR-NX47 through PR-NX57** on a real deal — see the live AI panels + post-Calculate warnings fire end-to-end against actual data.
3. **Karnataka API access** — long-standing TODO_LEGAL blocker.

### Recommendation for next session

- **Adopt `@redip/real-estate-ontology` in deal-create / deal-edit forms** (Strategic Review §VI top-1, still NOT STARTED) — the last unfinished item from the Tier-1 backlog. Removes drift risk between 3 places that encode asset_class / deal_structure / exit_strategy.
- **"One Brain" unified DealContext — Phase A read consolidation** — single `/api/deals/:id/workspace` endpoint serving all tabs. Entry criteria are still met. Largest single-PR architecture win available.
- **Audit dashboard skeleton/animation behaviour against `docs/FRONTEND_GUIDELINES.md`** — feel-check pass section 12. Easy, high-polish, low-risk.

---

## 2026-05-19 (mid-morning, 4-PR follow-on) — Live warnings + Overview chip + 3 PPTX AI narrative slides (PR #409, #410, #411)

Operator said "deep technical review + highest-impact pending work + 10 hours" — applied first-principles to pick a hybrid bundle of (1) the long-pending Strategic Review §VI top-2 item (live market-benchmark warnings on FinancialsPage), (2) extension of yesterday's ProvenanceChip work onto the Overview tab, and (3) cross-product parity for the 3 new DOCX AI capabilities (Risk / Sensitivity / Document Insights narratives) by adding them as PPTX slides. Operator goal: "seamless and well-integrated across modules, professional, sophisticated, state-of-the-art, free of errors."

### PRs shipped + merged

- **#409 — PR-NX52: Live market-benchmark warnings on Financials inputs (Strategic Review §VI top-2 — LANDED).** The XLSX-export market-benchmark validators (PR-NX28 #348 + PR-NX33 #363) ran only at export time — operators could save bad inputs that don't surface for hours. NX52 wires the same thresholds into FinancialsPage so warnings fire AS THE OPERATOR TYPES.
  - New `getBenchmarkBands(comps)` export on marketBenchmarkValidator — returns structured `{ count, verifiedCount, bands:{p25,p50,p75,p95}, thresholds:{rbiDscrFloor,yocVsExitCapMinSpreadBps,yocVsExitCapHealthyBps,compCoverageMinForBands} }`. Bands null when < 3 verified comps.
  - New `GET /api/deals/:id/benchmark-bands` route — fetches nearby comps (5 km, project_type from asset_class), returns the band data + thresholds + location context. 404 on missing deal, null bands on no coordinates.
  - Frontend: `useBenchmarkBands(dealId)` hook + 3 pure warning-computation helpers (`computeSellRateWarning`, `computeDscrWarning`, `computeYocSpreadWarning`) that mirror the XLSX validators' rules. Sell-rate warning wired into InputForm; DSCR + YoC helpers ready for follow-up wiring after kernel-output values become available post-calculate.
  - New `<BenchmarkWarning>` component with severity tones (amber for warn / red for critical) + AlertTriangle / AlertOctagon icons. +12 backend tests + 18 frontend tests.

- **#410 — PR-NX53: ProvenanceChip on OverviewTab Land Area card.** Extends PR-NX50's ParcelTab chip wiring to the Overview tab where operators land first. Only Land Area gets the chip — `asset_class` and `land_ask_price_cr` aren't in the ontology extraction_field_map today. Same `useFieldProvenance` + `<ProvenanceChip>` from PR-NX50 — no new patterns.

- **#411 — PR-NX54: 3 NEW PPTX AI narrative slides (cross-product parity with DOCX PR-NX43 / NX44 / NX45).** The DOCX got 3 new AI sections in the overnight bundle; the PPTX (the investor-facing deck) had none of them. NX54 adds:
  - **Risk Profile Synthesis** slide after Risks & Mitigants — 2-card layout (Summary + Critical Spotlight). Mirrors DOCX PR-NX43.
  - **Sensitivity Analysis · Narrative** slide after Cash Flow & Sensitivity — Dominant Driver eyebrow + Driver Decomposition card + Recommended Stress Tests card. Mirrors DOCX PR-NX44.
  - **Document-Derived Insights** slide after Risk Narrative, before Pros & Cons — Cross-Document Summary + severity-sorted Inconsistency Findings list (or positive-signal green panel on 0 findings). Mirrors DOCX PR-NX45.
  - All 3 slides reuse `context.exportContext.risks.narrative` / `sensitivityNarrative` / `documents.insights` — already populated by dealExport.service since the DOCX work. No new service calls. Each slide ALWAYS renders — falls back to a polite "Synthesis Unavailable" panel when the narrative envelope is `available: false`. +5 tests (manifest placement + render-succeeds when narratives present AND when unavailable).

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| getBenchmarkBands.test.js (NEW) | 0 | 12 | +12 |
| BenchmarkWarning.test.jsx (NEW) | 0 | 5 | +5 |
| useBenchmarkBands.test.jsx (NEW) | 0 | 13 | +13 |
| dealPptx.service.test.js | 17 | 22 | +5 |
| **Backend TOTAL** | **2,012** | **2,029** | **+17** |
| **Frontend TOTAL** | **573** | **591** | **+18** |

Zero pre-existing regressions across 120 backend + 58 frontend suites. All builds clean.

### Outcome for the operator

**Before this batch:**
- Operator typed bad SellRatePerSqft into the Financials inputs → no warning. Saved → exported workbook 5 hours later → THEN saw the validator warn in the XLSX Export QA section.
- Overview tab key-metric cards never showed provenance — only the ParcelTab fields had chips.
- Investor PPTX deck had structured Risks / Sensitivity / Documents slides but NO AI synthesis on any of them.

**After this batch:**
1. **As the operator types in Financials inputs**, sell-rate warnings appear inline below the input. Same rule as the XLSX validator: above p95 of nearby verified comps → amber "above 95th percentile" warning; below p25 → "below 25th percentile" warning.
2. **Overview tab Land Area card** now shows a tiny (i) chip when the value was auto-filled from a document extraction. Hover for source document + applied date + ontology version.
3. **PPTX deck now has 3 NEW AI narrative slides**. Investors get the same Claude/OpenAI synthesis the DOCX has — no more "structured tables only" gap.

### Architecture wins

- **Single source of truth for benchmark thresholds**: The RBI DSCR floor (1.20), YoC vs ExitCap spread bands, comp-coverage minimum live as named exports on marketBenchmarkValidator. Both the XLSX export validator AND the live-warning helpers consume the same constants — zero drift risk. Every future surface (live financial-input warnings, dashboard cards, KPI ribbons) just imports the same source.
- **PPTX slides read directly from exportContext**: No new precomputation needed for the 3 new slides. The DOCX work (NX43/44/45) already plumbed the narratives onto exportContext via dealExport.service. PPTX renderers read them straight. Cross-format parity for free.
- **All AI panels have graceful fallback**: Every narrative slide / panel auto-falls-back to a polite "Synthesis Unavailable" rendering when no narrative was generated. Deck / DOCX never breaks regardless of AI provider state.

### Outstanding operator actions (still pending from earlier sessions)

1. **Fix `BLOB_READ_WRITE_TOKEN` + `JWT_SECRET` in Vercel** — both show "Needs Attention". (User said skip; flagged again for SESSION_LOG audit trail.)
2. **Smoke-test the live AI panels (PR-NX47/48/49/50)** + new live warnings (PR-NX52) + new PPTX slides (PR-NX54) on a real deal.
3. **Karnataka API access** — long-standing TODO_LEGAL blocker.

### Recommendation for next session

After this bundle, the AI-content stack in REDIP is parity-complete across DOCX + PPTX + live workspace. Natural next priorities:

- **Wire DSCR + YoC live warnings into a post-Calculate panel on FinancialsPage** — the helpers shipped in NX52 are ready; just need a small panel that reads from the computed financial-graph and renders 2-3 warnings inline. ~0.5 session.
- **Adopt `@redip/real-estate-ontology` in deal-create / deal-edit forms** (Strategic Review §VI top-1, still NOT STARTED) — removes drift risk between 3 places that encode asset_class / deal_structure / exit_strategy.
- **XLSX cross-product parity for the 3 new AI narratives** — XLSX should get Risk + Sensitivity + Document Insights tabs/sections matching the DOCX/PPTX. ~1 session.
- **"One Brain" unified DealContext — Phase A read consolidation** — single `/api/deals/:id/workspace` endpoint serving all tabs. Entry criteria still met.

---

## 2026-05-19 (early morning, continuation) — Live workspace AI: 4-PR bundle bringing DOCX AI capabilities into the live frontend (PR #403, #404, #405, #406)

After the operator said "go" on the next bundle, applied first-principles reasoning: the 6 AI capabilities shipped in the overnight bundle (PR-NX40 through NX45) are ALL invisible in the live workspace — operators have to download a DOCX to see them. That's a discoverability + utility gap that beats every Tier-1 backlog item in impact. Pivoted to bringing 4 of those capabilities + the long-pending Strategic Review §VI top-2 (provenance chips) into the live frontend.

### PRs shipped + merged

- **#403 — PR-NX47: Live AI Risk Profile Synthesis panel on RiskTab.** New `GET /api/deals/:dealId/risk-narrative` route + `useRiskNarrative` hook + `<RiskNarrativePanel>` mounted between the RiskScoreCard and the Risk Flags table. Same `generateRiskNarrative` service that ships in DOCX (PR-NX43). Cascade Claude → OpenAI → unavailable. Hidden entirely on clean deals (no risks logged). +5 backend tests, +8 frontend tests.

- **#404 — PR-NX48: Live AI Sensitivity Narrative panel on FinancialsPage.** New `GET /api/financials/:dealId/sensitivity-narrative` route + `useSensitivityNarrative` hook + `<SensitivityNarrativePanel>` mounted ABOVE the SensitivityTornado chart. Same `generateSensitivityNarrative` service that ships in DOCX (PR-NX44). Cascade OpenAI → Claude → unavailable (flipped order — sensitivity is numerical reasoning). Eyebrow line shows "Dominant driver: <name>". Soft-fails on missing financial row + sparse grid. Inline parseSensitivityMatrix helper handles JSONB-or-string raw input. +6 backend tests, +7 frontend tests.

- **#405 — PR-NX49: Live AI Cross-Document Analysis panel on DocumentsTab.** New `GET /api/deals/:dealId/document-insights` route + `useDocumentInsights` hook + `<DocumentInsightsPanel>` mounted at the top of the tab (between SemanticSearchPanel and the header). Same `generateDocumentInsights` service that ships in DOCX (PR-NX45). Backend reshapes the extraction-service envelope (merged `fields`) → service-expected shape (raw `structured_fields`). Severity-sorted findings list with [Critical] / [High] / [Medium] / [Low] tone-coloured tags + Recommended action lines. Positive-signal "No inconsistencies detected" with shield-check icon when findings empty. +5 backend tests, +8 frontend tests.

- **#406 — PR-NX50: ProvenanceChip — inline provenance for auto-filled fields (Strategic Review §VI top-2).** New `GET /api/deals/:id/field-provenance` route on deal.routes.js — joins deal_audit_log (metadata.source='document_extraction') → users → document_extractions → documents via lateral jsonb_array_elements_text on metadata.source_extraction_ids. Returns per-field map with applied_at, applied_by_name, applied_value, source_document_names/types, target_table, ontology_version. Latest-overwrite-wins for repeated fills. `useFieldProvenance` hook + `<ProvenanceChip>` component (tiny inline (i) chip with hover popover). ParcelTab's FieldRow extended to accept optional `field` + `provenance` props; 14 site-info rows now show chips when auto-filled (survey_number, pid, khata_no, land_area_sqft, owner_name, etc.). Renders nothing when no provenance entry — safe to drop in everywhere. +6 backend tests, +6 frontend tests.

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| risk.narrativeRoute.test.js (NEW) | 0 | 5 | +5 |
| financial.sensitivityNarrativeRoute.test.js (NEW) | 0 | 6 | +6 |
| extraction.documentInsightsRoute.test.js (NEW) | 0 | 5 | +5 |
| deal.fieldProvenanceRoute.test.js (NEW) | 0 | 6 | +6 |
| RiskNarrativePanel.test.jsx (NEW) | 0 | 8 | +8 |
| SensitivityNarrativePanel.test.jsx (NEW) | 0 | 7 | +7 |
| DocumentInsightsPanel.test.jsx (NEW) | 0 | 8 | +8 |
| ProvenanceChip.test.jsx (NEW) | 0 | 6 | +6 |
| RiskTab.test.jsx | 6 | 6 | mock added for useRiskNarrative |
| **Backend TOTAL** | **1,990** | **2,012** | **+22** |
| **Frontend TOTAL** | **544** | **573** | **+29** |

Zero pre-existing regressions across 119 backend + 58 frontend suites. All builds clean.

### Architecture pattern across the 4 PRs

Each PR follows the same shape:
  1. New backend route: `GET /api/.../<narrative-or-insight>` that fetches the required service inputs (deal + risk_flags / financials / extractions / audit log) RLS-scoped via existing service helpers, then calls the same `export.insights.service` function the DOCX builder uses, then returns the canonical envelope.
  2. New frontend hook: `useXxx(dealId)` React Query wrapper with 5-min stale time + no-retry on 403/404.
  3. New frontend component: `<XxxPanel>` with skeleton-during-load + error-state + AI-assisted disclosure badge + attribution line (confidence + provider + auto-failover) + Refresh button + render-nothing-when-unavailable.
  4. Mount in the relevant tab between existing surfaces — operator sees the AI interpretation FIRST, then the structured data.

This means every NEW AI capability shipped to the DOCX going forward automatically has a "drop-in to live workspace" template. Future surfaces (PPTX-equivalent panels, dashboard rollups) follow the same pattern.

### Outcome for the operator

**Before this batch:** All 6 AI capabilities from the overnight bundle (IC opinion, demographics, pros & cons failover, risk narrative, sensitivity narrative, document insights) were invisible in the live workspace. To read any of them, the operator had to download a DOCX.

**After this batch:**
- **Risk tab** opens with the 2-paragraph Claude risk profile synthesis above the structured table.
- **FinancialsPage** opens with the 2-paragraph OpenAI sensitivity narrative + dominant-driver label above the tornado chart.
- **Documents tab** opens with the Claude cross-document analysis + severity-sorted inconsistency findings above the upload UI.
- **Parcel tab** site-info fields show tiny (i) chips next to every auto-filled value — hover to see "Auto-filled from sale-deed.pdf · 2d ago · by Rachit Jain · v1.0.0".

Every AI capability shipped to DOCX is now equally accessible in the live workspace. The DOCX becomes a SNAPSHOT of what's live, not the only place to find it.

### Outstanding operator actions (still pending from earlier sessions)

1. **Fix `BLOB_READ_WRITE_TOKEN` + `JWT_SECRET` in Vercel** — both show "Needs Attention". (User said skip; flagged again here for the SESSION_LOG audit trail.)
2. **Apply 5 backlogged Supabase migrations** — listed in TODO_MANUAL.md.
3. **Karnataka API access** — long-standing TODO_LEGAL blocker.

### Recommendation for next session

After this 4-PR bundle, the AI-content stack in REDIP is complete end-to-end across BOTH export and live surfaces. Natural next priorities:

- **Adopt `@redip/real-estate-ontology` in deal-create / deal-edit forms** (Strategic Review §VI top-1, still NOT STARTED) — removes drift risk between 3 places that encode asset_class / deal_structure / exit_strategy.
- **Live market-benchmark warnings on financial input forms** (Strategic Review §VI top-3) — port PR-NX28/NX33 validators to fire AS THE OPERATOR TYPES on FinancialsPage, not only at export time. Needs new `/api/deals/:id/benchmark-bands` endpoint + `useBenchmarkBands` hook.
- **"One Brain" unified DealContext** — TODO_ARCHITECTURE Phase A read consolidation could ship as a standalone win. Entry criteria are now met.

---

## 2026-05-19 (overnight) — DOCX AI-content uplift: 3 placeholder fixes + 3 new AI capabilities (PR #396, #397, #398, #399, #400, #401)

After the operator downloaded the Jigani DOCX and shared it (`redip-Jigani-_Apartments-underwriting-2026-05-18.docx`), inspected the file and found 3 flagship AI sections silently falling back to "not available" placeholder text despite the back-end machinery being shipped. Pivoted to a 6-PR AI-content uplift bundle that (a) fixes the 3 silent failures and (b) adds 3 NEW AI-driven capabilities — using all 3 AI providers (Claude, OpenAI, Gemini) meaningfully across the report per the operator's "use all the AI APIs to make it better, more informative, with good content" directive.

### PRs shipped + merged

**Phase 1 — Fixes for silently-firing placeholders (3 PRs)**

- **#396 — PR-NX40: IC opinion failover cascade.** The Executive Summary IC opinion rendered "AI-generated investor-grade opinion is not available" because `generateDealInsights` did one Claude call and returned `unavailable` on any failure. Applied PR-NX21's failover pattern: Claude (maxTokens bumped 700→1200) → OpenAI explicit override → unavailable. Returns canonical envelope with `provider` + `fallbackReason` fields; DOCX footer surfaces "Synthesis: claude-sonnet-4-6 · auto-failover: Claude 429 rate_limited — succeeded on openai" so operators see exactly which model produced the opinion and what went wrong. +9 tests.

- **#397 — PR-NX41: Wire planning_district demographics.** The Demographics section was hardcoded to read `exportContext.market.demographics` but `dealExport.service` never wrote that key. Added `p.auto_derived_pd_code` (and ward/zone) to `DEAL_EXPORT_SQL`; new `fetchDealDemographics()` helper looks up the PD by code in `regulatory_data.planning_districts` and enriches via the existing `enrichPdWithDemographics()` function (which reads from `regulatory_data.evidence_facts`). Shape-maps RMP fields → DOCX-renderer keys with 100× ha→km² conversion. DOCX `buildDemographics` extended with 3 new rows (area in ha+km², BBMP wards in PD, revenue villages) + provenance line ("Source: BBMP RMP-2031 (2011 census base)"). Empty-state hint added: "Bengaluru deals: open the Parcel tab → click Derive → Apply → re-download." +5 tests.

- **#398 — PR-NX42: Claude tertiary failover for narrative sections.** The Pros & Cons section rendered "AI-assisted Pros & Cons synthesis is not available" because the cascade was Gemini → OpenAI → unavailable with Claude (the resilience layer everywhere else in the AI stack) missing. Added `callClaude` (maxTokens 900) as the 3rd tier in `exportNarrative.service.generateSection`. Errors now collected from EVERY tier so the operator sees the full diagnostic. Affects all 4 narrative sections: prosCons, whyThisArea, cashflowLevers, demographicsSynthesis. +4 tests + 2 existing tests updated to reflect 3-tier cascade.

**Phase 2 — NEW AI capabilities (3 PRs)**

- **#399 — PR-NX43: Risk Register narrative synthesis (Claude primary).** Pre-NX43 the Risk Register showed the structured table only. Added `generateRiskNarrative` (Claude → OpenAI cascade) that produces 2 paragraphs ABOVE the table: (1) overall risk profile synthesis with severity-mix interpretation, (2) critical-spotlight callout explicitly naming each critical/high item with WHY-it-matters context for the asset class + structure. No-op fast paths on empty / all-closed risk lists (zero AI cost on clean deals). Render between the summary count line and the structured table — IC reader sees "what does this mean?" first, then the data. +10 tests.

- **#400 — PR-NX44: Sensitivity narrative (OpenAI primary).** Pre-NX44 the Financials section showed the sensitivity tornado SVG without narrative. Added `generateSensitivityNarrative` with provider order FLIPPED to OpenAI primary, Claude secondary (rationale: sensitivity analysis is fundamentally numerical reasoning, OpenAI GPT-5.4 excels there). Produces 2 paragraphs: (1) driver decomposition ranking top 2-3 inputs by bps of IRR swing, (2) recommended stress tests as concrete what-ifs with expected IRR impact. Plus a `dominant_driver` short label rendered in the eyebrow. Auto-no-op on degenerate matrix (< 3×3 grid). +10 tests.

- **#401 — PR-NX45: NEW Document-Derived Insights section (flagship).** 21st section in the DOCX, between Provenance and Pros & Cons. Two halves:
  - **Per-doctype extracted facts** (data display, no AI call): groups completed extractions by `doc_type`, renders top 8 fields per extraction as label-value tables. Operator sees Owner Name / Survey Number / Consideration / etc. extracted from each sale deed / EC / khata / RERA cert — no more clicking into each doc to remember what's on it.
  - **Cross-document analysis** (Claude primary, OpenAI secondary): `generateDocumentInsights` reads the structured_fields from all completed extractions and detects inconsistencies the human would miss in a 30-document deal package. Surfaces 0-5 findings with severity (critical = title/owner mismatch, high = survey/khata mismatch, medium = area/value, low = trivial), each with title + description naming the contradicting documents + recommendation. Plus a summary paragraph framing the document set.

  Completes the "use all 3 AI APIs across the report" story: Gemini does extraction (PR-NX25) + narratives (NX42 primary), Claude does IC opinion (NX40) + risk synthesis (NX43) + cross-doc reasoning (NX45 primary), OpenAI does sensitivity (NX44 primary). Each section picks the right AI for the job + has the other two as failover layers. +12 new tests + 2 existing tests updated for the new 21-section count (was 20).

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| export.insights.failover.test.js (NEW) | 0 | 9 | +9 |
| dealExport.demographics.test.js (NEW) | 0 | 5 | +5 |
| exports.narrative.test.js | 22 | 26 | +4 |
| export.insights.riskNarrative.test.js (NEW) | 0 | 10 | +10 |
| export.insights.sensitivity.test.js (NEW) | 0 | 10 | +10 |
| export.insights.docInsights.test.js (NEW) | 0 | 12 | +12 |
| exports.docx.test.js | 51 | 53 | +2 (updates) |
| **Backend TOTAL** | **1,940** | **1,990** | **+50** |

Zero pre-existing regressions across 115 backend suites. All builds clean.

### Outcome for the operator

**Before this batch (Jigani DOCX, 2026-05-18):**
- Executive Summary → placeholder "AI-generated investor-grade opinion is not available"
- Demographics → placeholder "Demographic data is not yet available"
- Pros & Cons → placeholder "AI-assisted Pros & Cons synthesis is not available"
- Risk Register → structured table only (no narrative)
- Financials → sensitivity tornado only (no interpretation)
- No document-derived insights anywhere

**After this batch:**
- Executive Summary → real IC opinion (Claude with OpenAI failover, footer shows provenance)
- Demographics → real BBMP RMP-2031 facts for Bengaluru deals with `auto_derived_pd_code`; honest hint to "run Derive on Parcel tab" otherwise
- Pros & Cons → real Pros + Cons synthesis (Gemini → OpenAI → Claude cascade)
- Risk Register → AI synthesis paragraphs ABOVE the structured table
- Financials → sensitivity narrative ABOVE the tornado with bps-precise driver decomposition + stress-test recommendations
- NEW Document-Derived Insights section → all extracted facts grouped by doctype + Claude-detected inconsistencies across the document set

### Outstanding operator actions (still pending from earlier sessions)

1. **Fix `BLOB_READ_WRITE_TOKEN`** in Vercel — still shows "Needs Attention" (Vercel Blob disconnect).
2. **Fix `JWT_SECRET`** in Vercel — still shows "Needs Attention".
3. **Smoke-test the Jigani DOCX again** after this batch deploys (~3 min): all 5 placeholder sections should now render real content; the brand-new Document-Derived Insights section should appear at position 17 between Provenance and Pros & Cons.

### Recommendation for next session

The DOCX is now richest, most-AI-leveraged export REDIP produces. Natural next-highest-leverage items from the strategic backlog:
- **Adopt `@redip/real-estate-ontology` across deal-create / deal-edit forms** (Strategic Review §VI top-1, NOT STARTED)
- **Provenance chips on individual deal fields** showing the source doc + extraction confidence inline (Strategic Review §VI top-2, NOT STARTED)
- **Live market-benchmark warnings on financial input forms** (port PR-NX28/NX33 to fire at input time, not export time) — Strategic Review §VI top-3, NOT STARTED
- **Same multi-provider failover pattern applied to the XLSX briefing service** — already shipped in PR-NX21 actually, but worth verifying the same diagnostics surface in the XLSX as in the DOCX

---

## 2026-05-18 (late) — Phase C polish complete: provenance chips + Kaveri verify-links + bulk lookup admin + parcel mini-map (4 PRs)

Closed out Phase C of the autonomous-window plan. Operator pre-cleared three blockers in this window: (a) ab-eval migration applied, (b) comps geocoding `--apply` run lifting 56 → 71 of 81 comps to precise pins, (c) C-6 permanently struck from the record (memory + repo, never to be re-proposed). The four remaining Phase C items shipped end-to-end:

### PRs shipped + merged

- **#390 — `feat(deal/parcel)` C-1**: `DerivedValueChip` primitive (`frontend/src/components/common/`) — small `(i)` chip showing source + confidence inline, hover/focus popover with full provenance (source, confidence %, age "derived 3s ago", per-row extras like PDF page / K-GIS taluk / BBMP street). Wired into all 6 AutoFillParcelContextCard rows; reusable on downstream cards in future PRs. 15 new tests. (+342/-10)
- **#391 — `feat(deal/parcel)` C-4**: `VerifyLinksSection` (new) renders all 7 authority deep-links the backend has been emitting since PR #354 (Bhoomi RTC, Kaveri EC, BBMP e-Aasthi, K-RERA, IGR Guidance, K-GIS Cadastral, Google Maps satellite) with one-click "Copy + Open" affordance. Backend tighten: Kaveri `copy_text` is now SRO + Survey + Village + Hobli only (the canonical EC search keys) — no more PID/Khata/Bhoomi noise. 10 new tests. (+351/-2)
- **#392 — `feat(admin/planning)` C-5**: `BulkAddressLookupPanel` mounted at the bottom of `/admin/planning-intelligence`. Paste up to 50 addresses, 5-at-a-time concurrency-limited runner against the same auto-derive endpoint, 10-column results table (Address · Status · Coords · Within BBMP · Zone · Ward · Guidance band · PD · K-GIS taluk · Warnings), "Copy as Excel-ready table" TSV button (intentionally NOT labelled as CSV per operator's standing rule from 2026-05-10). 13 new tests. (+647)
- **#393 — `feat(deal/parcel)` C-8**: `DerivedParcelMiniMap` (240px compact map) mounted between AutoFillCard field rows and verify-links. Renders K-GIS GeoJSON polygon (blue stroke + 12% fill) when available, falls back to a 50m buffered orange-dashed circle when not — explicitly badged "Approximate boundary" so the operator never mistakes a placeholder for a survey-precise outline. Tile-layer toggle (Streets/Satellite), Google sat deep-link in chrome. Hidden when `coordinatesGate.gated` (red-banner case from PR #385). master_plan_zones polygon overlay deferred — that data isn't loaded yet. 13 new tests. (+465)

### Operator actions completed mid-window

- **Migration `20260526_ab_eval_runs.sql`** applied via Supabase SQL editor (operator confirmed "Success").
- **Comps geocoding upgrade** ran `scripts/upgrade-comps-geocoding.mjs --apply --allow-cross-locality`. Pre-state 56/81 precise → post-state 71/81 precise (+15 upgraded, +5 already-good, +5 stage-2 low-precision kept, 0 errored). 5 cross-locality corrections flagged for manual `locality` column review (Sobha Lake Gardens, Embassy Verde, Brigade Horizon, Godrej MSR City, Birla Trimaya / Godrej MSR City) — operator can spot-check at leisure.

### Memory + repo policy updates persisted in perpetuity

- **C-6 permanently skipped**: new memory file `decisions_permanently_skipped.md` + index update in `MEMORY.md` — no future Claude or Cowork session will propose or surface C-6 again.

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| Frontend total | 493 | 544 | +51 |

Backend untouched in this window. All builds clean across all 4 merges.

### Outcome for the operator

Phase C of the autonomous-window plan is **100% complete** (C-1 ✅, C-3 ✅, C-4 ✅, C-5 ✅, C-6 🚫 permanently skipped, C-7 ✅, C-8 ✅ — with C-3 and C-7 having shipped in earlier windows). The auto-derive flow on the deal Parcel/Site tab is now fully polished:

- Every auto-filled value has a `(i)` chip → click to see source + confidence + age + provenance details.
- A small map below the field list shows exactly where Google placed the address (the pin) and what the parcel outline looks like (blue polygon from K-GIS or orange dashed-circle approximation).
- All 7 authority portals (Bhoomi / Kaveri / BBMP / RERA / IGR / K-GIS / Google sat) are one click away with the right search payload pre-loaded on the clipboard.
- On the admin Planning Intelligence page, a new panel lets the operator paste 50 addresses and screen them for BBMP-vs-not, zone, ward, guidance band in ~20 seconds.

### Status table (autonomous-window plan, end-of-Phase-C)

| Item | Status | Notes |
|---|---|---|
| Phase A (4 PRs, data recovery) | ✅ Shipped | Operator applied 4 migrations in window 1 |
| Phase B (3 PRs, geocoding orchestrator) | ✅ Shipped | Live end-to-end after operator removed GCP key referrer restriction |
| Phase C-1 (provenance chips) | ✅ Shipped (#390) | This window |
| Phase C-3 (Overview warnings strip) | ✅ Shipped (window 1) | #378 |
| Phase C-4 (Kaveri verify-links section) | ✅ Shipped (#391) | This window |
| Phase C-5 (bulk address lookup) | ✅ Shipped (#392) | This window |
| Phase C-6 (reverse search filters) | 🚫 **Permanently skipped** | Operator decision 2026-05-18, never re-propose |
| Phase C-7 (ward spread tile) | ✅ Shipped (window 2) | #383 |
| Phase C-8 (mini-map) | ✅ Shipped (#393) | This window |

### Plain-English recap (4 bullets, no jargon)

- Every auto-filled box on the deal Parcel page now has a tiny `(i)` button. Hover or click it to see exactly where the number came from (Google? BBMP? K-GIS?), how confident, and how recent.
- Below the boxes, there's now a small map showing where the address sits — with the actual parcel outline drawn in blue if K-GIS has it, or an orange dashed circle as a placeholder if not. Toggle between street view and satellite.
- All 7 government portals (Bhoomi, Kaveri, BBMP, RERA, IGR, K-GIS, Google satellite) are now one click away. Click "Copy + Open" — it puts the right search text on your clipboard AND opens the portal in a new tab. Paste, search, done.
- New admin tool: paste up to 50 addresses, get a table back with zone/ward/guidance/PD/warnings for each. Useful for screening leads before turning them into deals.

### What's left to do

Nothing in the autonomous-window plan. The plan is closed. Future work is unscoped — pick up when the operator surfaces new priorities.

---

## 2026-05-18 (3-hour autonomous window) — full AutoFillCard persistence + out-of-BBMP clarity + ward spread benchmark (3 PRs + hotfix)

Operator went to the gym; this window picked up the highest-impact pending work from the overnight Phase-C list — specifically the items that (a) close the loop on PR #377's "acknowledged but not persisted" half-truth, (b) fix the half-broken UI exposed when the operator first tried the AutoFillCard on a non-BBMP deal (Pointec Pens in Attibele Industrial Area), and (c) ship the Bayesian sanity-check tile that uses the just-restored UAV data. Plus a hotfix from a route-order bug the operator caught right before the gym (PR #380).

### PRs shipped + merged

- **#380 — `fix(properties)` HOTFIX** (caught from operator's screenshot just before the window): the new `/auto-derive-context` route was being intercepted by `GET /:id` (catch-all), returning the misleading "Invalid data format provided" error for every Derive click. Moved the literal-path route above the catch-all + added a regression test (`property.routes.order.test.js`) that route-stack-inspects the registration order so future single-segment GET routes can't regress this. (+112 / -34 lines, +3 tests)
- **#381 — `feat(properties)` PR-1**: closes the persistence gap from PR #377. New migration `20260602_properties_auto_derived_context_columns.sql` adds 13 `auto_derived_*` columns to `public.properties` + 3 partial indexes (zone/PD/ward) for fast PR-C6 reverse-search filtering. New dedicated `applyAutoDerivedContext(id, {picks, derivedSource}, userId)` service function + `PATCH /properties/:id/apply-auto-derived-context` endpoint. ParcelTab's Apply handler rewritten to call it — now every picked field persists, not just lat/lng. Slimmed JSONB source payload (~5KB) preserves the provenance trail. (+431 / -27 lines, +7 tests)
- **#382 — `feat(deal/parcel)` PR-2**: fixes the Attibele Industrial Area UX gap. For deals outside the BBMP bbox, the AutoFillCard previously rendered BBMP ward / zone / PD rows with "Not derived" placeholders — looked broken. Now: (a) new `OutsideBbmpExplainer` banner reads "This parcel sits outside BBMP city limits — K-GIS places it in Anekal, Bangalore Urban", (b) `buildFieldRows` skips the three BBMP-specific rows entirely when `withinBbmp: false`, (c) summary chip gains a "in [Taluk] taluk" suffix. K-GIS / Coordinates / Warnings rows still render (they're valid anywhere in Karnataka). (+82 / -3 lines, +1 test)
- **#383 — `feat(deal/spread)` PR-3 (C7)**: ward spread benchmark tile. Companion to the per-deal "Spread vs guidance" tile from PR #353. New `getWardSpreadBenchmark(propertyId)` service joins deals to properties, filters to deals with the same `auto_derived_ward_no`, computes each comparable deal's spread % in JS against its OWN gazette band (not a ward-wide constant — so Zone B in Ward 84 doesn't get unfairly anchored to Zone A guidance), returns p25/median/p75/min/max + capped 10-row sample. New `WardSpreadBenchmarkTile` component renders the percentile distribution + a "this deal is +Xpp vs ward median" comparison line with tone-coloured chip (below_p25 / within_band / above_p75). Honest empty states for `ward_not_derived` and `insufficient_data` (N<3). 10-sample API cap for response-size hygiene. RLS-respecting. (+621 / -0 lines, +14 tests)

### Deliberately NOT shipped this window

- **C1+C2 (Provenance chips + visual diff)** — defer. The AutoFillCard already shows source + confidence inline. A separate primitive applied to DealStreetLookupCard / MasterPlanZonePanel would be moderate polish, ~45 min. Lower priority than the 3 PRs above. ETA next window.
- **C4 (Kaveri deep-link)** — investigated and confirmed not actionable. Kaveri is an auth-walled SPA that doesn't accept URL query parameters for SRO / taluk / village pre-fill. The existing `parcelVerificationLinks.js` already implements the right pattern (homepage link + copy-paste payload). CLAUDE.md hard rule prevents shipping a fake deep link. Marking C4 as "🚫 not actionable — operator-paste workflow is the correct UX given portal constraints" — recommend dropping from the roadmap unless Kaveri publishes a public API.
- **C5 (Bulk lookup admin page)** — large new page, defer.
- **C6 (Reverse search filters)** — now unblocked by PR #381's columns, but needs a one-time backfill on existing 80 deals before the dropdowns return useful data. Backfill is operator opt-in. Defer.
- **C8 (Map polygon overlay)** — needs `master_plan_zones.geom` to be loaded (external dataset). Defer.

### Tests

| Suite | Start (post-window-1) | End | Δ |
|---|---:|---:|---:|
| Backend total | 1,902 | 1,915 | +13 |
| Frontend total | 482 | 491 | +9 |
| **Total** | **2,384** | **2,406** | **+22** |

All green. Frontend build clean across all 4 merges.

### Operator action queue (1 new migration)

Add to the existing queue (4 from window-1 still pending application — see prior entry):

5. `database/migrations/20260602_properties_auto_derived_context_columns.sql` — adds 13 `auto_derived_*` columns + 3 partial indexes. Idempotent. Until applied, every AutoFillCard Apply returns `column "auto_derived_*" does not exist`. After applying, the persisted picks light up downstream surfaces on the next deal page render.

### Smoke checks (post-deploy + migration)

- **Pointec Pens deal (Attibele Industrial Area)** → Parcel tab → Derive → see the new amber "outside BBMP" explainer + 3 rows (Coordinates / K-GIS hierarchy / Applicable warnings). No empty placeholders for BBMP ward/zone/PD.
- **Any Bengaluru deal inside BBMP** → Derive → 6 rows populate → Apply → toast "6 fields applied to property record." Reopen deal → values still there.
- **DealStreetLookupCard** on any deal where auto-derive has been applied → scroll past the 4-tile grid → see the new "Ward {N} benchmark" tile. With ≥3 other ward deals applied, see the percentile distribution + "this deal vs ward median" chip.

### Outcome for the operator

The Killer Feature is now complete and robust:
- Persistence is end-to-end. No more half-acknowledged picks.
- Non-BBMP deals (Anekal / Hosakote / Magadi / etc) show an honest explanation instead of broken-looking empty rows.
- A new IC-grade tile gives the deal team a market-context anchor ("median ward spread is +18%, this deal is in the typical band").
- The route-order regression test guarantees the misleading "Invalid data format provided" error can't come back.

### Status table (autonomous-window plan rollup, after both windows)

| PR | Phase | Status | Notes |
|---|---|---|---|
| A1-A4 (data recovery) | A | ✅ Shipped (#371-#374) | Applied 2026-05-17 |
| B1-B3 (geocoding orchestrator) | B | ✅ Shipped (#375-#377) | Live in production |
| B follow-on: auto_derived_* columns + full persistence | — | ✅ Shipped (#381) | Operator: apply `20260602` migration |
| Hotfix: auto-derive route order | — | ✅ Shipped (#380) | Live |
| Out-of-BBMP UX clarity | — | ✅ Shipped (#382) | Live |
| C3 (Warnings strip on Overview) | C | ✅ Shipped (#378) | Live |
| C7 (Ward spread benchmark) | C | ✅ Shipped (#383) | Lights up after operator applies + deals get auto-derived |
| C1+C2 (Provenance chips + visual diff) | C | 🔴 Not started | ~45 min, polish |
| C4 (Kaveri deep-link) | C | 🚫 Not actionable | Portal doesn't support deep links; existing UX is already correct |
| C5 (Bulk lookup admin page) | C | 🔴 Not started | Large new page |
| C6 (Reverse search) | C | 🔴 Not started | Now unblocked by #381; needs operator backfill of existing 80 deals |
| C8 (Map polygon overlay) | C | 🔴 Not started | Needs master_plan_zones.geom data load |

11 of 14 plan PRs shipped end-to-end (78%). The 3 remaining are polish (C1+C2), depend on data not yet loaded (C8), or are large net-new surfaces (C5) — none are blocking the killer feature.

### Plain-English recap (4 bullets, no jargon)

- Clicking Apply on the AutoFillCard now writes EVERY field the user kept (not just the map pin) to the property record — so reopening the deal shows them already filled in. Closes the "acknowledged but not persisted" half-truth from yesterday's window.
- Deals outside BBMP city limits (like the Attibele Industrial Area one the operator tried first) now show a clear amber explainer — "K-GIS places this in Anekal, Bangalore Urban" — and hide the BBMP-only rows that don't apply. No more empty placeholders that look like a bug.
- The deal page gains a "Ward benchmark" tile right below the existing spread tile: p25 / median / p75 spread vs guidance across other deals in the same BBMP ward, plus a "this deal is +Xpp vs median" comparison. Gives IC committees a Bayesian read on whether the asking price is pushy or in line with the micro-market.
- A regression test now guarantees the "Invalid data format" error the operator caught right before the gym can't come back — any future single-segment GET route under /properties will fail CI if it's registered after the catch-all.

---

## 2026-05-17 (overnight autonomous window) — Phase A data recovery + Phase B geocoding orchestrator + Phase C warnings strip (9 PRs)

After confirming the legacy Tokyo Supabase project was deleted and auditing what was lost (1,016 BBMP UAV rows · 85 evidence facts · 42 PD demographics · 13 land-use facts), the operator green-lit a 10-hour autonomous window to: (a) recover everything Tokyo had as proper repo migrations, (b) ship the long-promised geocoding auto-fill orchestrator ("type an address → zone, FSI, guidance value, ward, PD auto-fill"), and (c) close the highest-value Phase C UX gap (city-level callouts on deal Overview). 9 PRs across the 3 phases, all merged.

### PRs shipped + merged

**Phase A — data recovery (4 PRs + 1 chore)**

- **#370 — `chore(bbmp)`**: committed the trigram-similarity fallback in `scripts/enrich-bbmp-street-zones.js` that produced tonight's 100% BBMP street-zone coverage. Fixes the previous-session gap where the live tweak never made it into the repo — future re-seeds now reach 100% automatically. (+37/-3 lines)
- **#371 — `feat(masterplan)` PR-A2**: restored all 42 Bengaluru Planning District demographics from RMP 2031 Volume-4 PDR via Gemini multimodal (~$0.03 spend, zero null fields). One self-contained migration with a 14KB JSONB literal that re-seeds the District Intelligence panel + DealPlanningContextCard automatically once the operator applies. (+463 lines)
- **#372 — `feat(masterplan)` PR-A1**: restored the BBMP UAV rate card (108 rows: 18 property-use categories × 6 zones) hand-extracted from Gazette Notification 384, dated 09-Mar-2016. Hand-extracted not LLM because misreading a Roman numeral in a 6-zone printed table would flip rates by 5-10×. Confidence 0.95, review_status 'approved'. (+223 lines)
- **#373 — `feat(masterplan)` PR-A3**: restored the 2015 → 2031 land-use shift table (14 existing + 12 proposed shares + 4 totals + 22 named landmarks + 7 adjacent planning authorities = 32 evidence_facts rows) hand-extracted from the Existing/Proposed Land Use maps. Both source PDFs are single-page summary tables — no LLM needed. (+159 lines)
- **#374 — `feat(masterplan)` PR-A4**: restored SDZ corridors (5), heritage zones (12), NGT drainage classification, regional parks aggregate, PRR alignment (118 km), and 17 substantive zoning rule narratives via Gemini extraction over Volume-3 (Master Plan Document) + Volume-1 (Vision). Closes the deferred callouts gap from PR A3. Total spend ~$0.04. (+282 lines)

**Phase B — geocoding auto-fill orchestrator (3 PRs)**

- **#375 — `feat(properties)` PR-B1**: backend `parcelContext.service.js` + endpoint `GET /api/properties/auto-derive-context?address=...&lat=...&lng=...` that takes either an address or lat/lng and returns ONE structured payload by fanning out in parallel to Google geocoding (with Nominatim fallback, already shipped), K-GIS adapter (already shipped), BBMP street index, planning district demographics (PR #371), city-level callouts (PR #374), and verify-links helper (already shipped). Master plan zone NOT auto-derived because polygons aren't loaded — honest about gap per CLAUDE.md. 12 new tests, 1899 backend tests total. (+679 lines)
- **#376 — `feat(deal/parcel)` PR-B2**: frontend `AutoFillParcelContextCard` standalone component + `useAutoDeriveParcelContext` react-query hook. Type address or paste coords → see 6 derived rows (coordinates, ward, BBMP zone + guidance value, planning district + demographics, K-GIS hierarchy, applicable warnings) each with source chip + confidence + skip toggle. Skeleton during load, ErrorState on failure, all four interaction states, tabular-nums, always-on AI disclaimer. 12 component tests, 474 frontend tests total. (+711 lines)
- **#377 — `feat(deal/parcel)` PR-B3**: wired AutoFillParcelContextCard at the top of the deal Parcel/Site tab whenever a property is linked AND user has edit rights. Apply handler: persists lat/lng via existing `useUpdateProperty`, acknowledges the remaining picks via toast (full persistence requires a follow-up `auto_derived_*` columns migration). Killer-demo flow now works end-to-end. (+51 lines)

**Phase C — UX polish (1 of 7 PRs in this window)**

- **#378 — `feat(deal/overview)` PR-C3**: new `DealAutoDerivedWarningsStrip` mounted on the deal Overview tab. Pulls heritage/SDZ/NGT/PRR/regional-parks callouts from the auto-derive payload, renders as a calm warn-tinted row with up to 4 chips + "+N more" overflow. Stops the IC failure mode ("we discovered the parcel was inside a heritage zone at IC"). Cache-shared with the Parcel tab card via the same react-query hook. 8 component tests, 482 frontend tests total. (+197 lines)

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| Backend total | 1,887 | 1,899 | +12 |
| Frontend total | 462 | 482 | +20 |
| **Total** | **2,349** | **2,381** | **+32** |

All green. Frontend build clean across all 9 merges.

### Operator action queue (4 new migrations to apply, in order)

Paste each into Supabase SQL editor (preferred) or run `psql "$DATABASE_URL" -f <file>`.

1. `database/migrations/20260529_planning_district_demographics.sql` — restores 42 PD demographics.
2. `database/migrations/20260530_bbmp_uav_rate_card.sql` — restores 108 UAV rate-card rows.
3. `database/migrations/20260531_land_use_insight_and_city_callouts.sql` — restores 32 land-use + landmark + boundary facts.
4. `database/migrations/20260601_rmp_vol3_vol1_callouts_and_rules.sql` — restores 6 high-signal callout + rule narrative facts.

After applying, smoke checks:
- `/admin/planning-intelligence`: District Intelligence shows 42 PDs with demographics. UAV Benchmark shows 18×6 matrix. Land Use Insight shows 2015→2031 shift. Source Explorer + Review Queue show 100+ facts.
- On a fresh Bengaluru deal: Parcel/Site tab → AutoFillParcelContextCard at the top. Type "100 Brigade Road" → 6 fields populate in <2s. Click Apply → lat/lng + map pin update. Overview tab → warnings strip shows 5 callouts.

### Outcome for the operator

The Tokyo deletion is fully cauterized — every dataset that was lost is back in the repo as a proper migration (no more direct-SQL-only seeds). Beyond that, the killer feature is shipped: type an address on a Bengaluru deal and see 6 facts auto-derive in 1-2 seconds with full provenance. ~15 minutes of manual portal-bouncing compresses into one click. The Overview tab now also surfaces city-level warnings (heritage / SDZ / NGT / PRR) on first load so they can't be missed at IC.

### What's NOT in this window (deferred to future sessions)

Phase C still has 6 PRs to ship. None are blocking. Order by impact:
- **C1+C2** — Provenance chips + visual diff (small primitive applied to AutoFillCard + DealStreetLookupCard + MasterPlanZonePanel).
- **C7** — "Median spread in this ward (across N other deals)" tile next to the existing Spread-vs-Guidance tile.
- **C4** — Inline Kaveri deep-link with prefilled SRO (needs verification that Kaveri portal supports query params; fall back to copy-to-clipboard).
- **C5** — Bulk address lookup admin page (paste up to 50 addresses, get derived contexts).
- **C6** — Reverse search "all deals in Zone D / PD-11 / Ward 84" on the Deals list page (requires backfill script to populate `auto_derived_*` columns on existing 80 deals).
- **C8** — Map view of derived parcel polygon + zone overlay (K-GIS GeoJSON + master_plan_zones — requires polygon import).

Also deferred: `auto_derived_*` column migration on `properties` so all six picks from the AutoFillCard persist (not just lat/lng). Sketched in the plan but worth its own PR with the schema change.

### Status table (autonomous-window plan)

| PR | Phase | Status | Notes |
|---|---|---|---|
| A2 (Planning Districts) | A | ✅ Shipped (#371) | Operator: apply `20260529` migration |
| A1 (BBMP UAV) | A | ✅ Shipped (#372) | Operator: apply `20260530` migration |
| A3 (Land Use + landmarks) | A | ✅ Shipped (#373) | Operator: apply `20260531` migration |
| A4 (SDZ/heritage/NGT/PRR + rules) | A | ✅ Shipped (#374) | Operator: apply `20260601` migration |
| B1 (Backend orchestrator) | B | ✅ Shipped (#375) | No migration needed |
| B2 (Frontend AutoFillCard + hook) | B | ✅ Shipped (#376) | No migration needed |
| B3 (Wire into Parcel/Site tab) | B | ✅ Shipped (#377) | No migration needed |
| C3 (Warnings strip on Overview) | C | ✅ Shipped (#378) | No migration needed |
| C1+C2 (Provenance chips + visual diff) | C | 🔴 Not started | Small, ~45 min |
| C7 (Ward-spread benchmark tile) | C | 🔴 Not started | Backend SQL + 1 frontend tile |
| C4 (Kaveri deep-link) | C | 🔴 Not started | Verify portal query-param support first |
| C5 (Bulk lookup admin page) | C | 🔴 Not started | Largest pending Phase-C PR |
| C6 (Reverse search) | C | 🔴 Not started | Needs `auto_derived_*` columns migration first |
| C8 (Map view + polygon) | C | 🔴 Not started | Largest pending — needs polygon import |

### Plain-English recap (4 bullets, no jargon)

- The night before, the Tokyo project was deleted and a lot of city-level data went with it. Every piece is now back in the repo as proper migrations the operator can apply with one click each — 42 Planning Districts with population + density, the BBMP property-tax rate card, the 2015 → 2031 land-use shift, and 5 Special Development Zones + 12 heritage zones + drainage / Peripheral Ring Road callouts.
- On every Bengaluru deal's Parcel tab there is now a new card: type an address, click Derive, and 6 facts about that location come back in 1-2 seconds — the BBMP ward, the property-tax zone with its guidance rate band, the planning district with its population, the K-GIS taluk/village/survey-number candidates, and a list of city-wide warnings to check against. The map pin auto-updates when Apply is clicked.
- On every Bengaluru deal's Overview tab there is now a warnings strip — heritage zones, SDZ corridors, NGT drainage buffer, PRR alignment. Each one says "verify against this parcel", never "this parcel is in one" (we don't have ward polygons yet, so that would be a fake claim).
- About 15 minutes of manual lookup on K-GIS + BBMP street search + RMP PDF + heritage inventory compresses into one click of Derive + Apply. The full payload also feeds the IC memo / Pros & Cons synthesis with traceable provenance.

---

## 2026-05-17 (night) — DOCX institutional-grade bundle: Risk / DD / Approvals / Provenance / ToC / Methodology (PR #365, #366, #367)

After the operator confirmed every outstanding manual action (export-events migration applied, `DOCX_REPORT_ENABLED=1` flipped, Claude key rotated, auto-fill + market-benchmark smoke tests passed), pivoted to closing the DOCX institutional-grade depth gaps surfaced in the pending-tasks audit. Per the surveyed-and-stale `EXPORTS_REWRITE_STATUS.md`, DOCX claimed feature-complete with 15 sections — but compared to what an IC reviewer expects from a paid (₹4,999) institutional-grade underwriting report, the DOCX was missing dedicated Risk Register, DD Status, Approvals Tracker, Provenance trail, Table of Contents, and Methodology appendix. This batch closes all 6 gaps in 3 PRs.

### PRs shipped + merged

- **#365 — PR-NX35: Risk Register + DD Status + Approvals Tracker.** Three new platform-data sections (`buildRiskRegister`, `buildDDStatus`, `buildApprovalsTracker`) inserted between Financials and Pros & Cons in the DOCX. Pull from existing `exportContext.{risks, dd, approvals}.{summary, items}`. Each section: tone-coloured severity / status cells via `severityColor()` helper, tables sorted by severity / status with summary line up top, honest empty-state when the underlying DB table isn't populated (with explicit "apply Karnataka template" hint for Approvals). All three use `platformBadge()` (no AI synthesis) — IC reviewer reads structured truth BEFORE the AI Pros & Cons interpretation. Two new shared helpers exported via `__internal`: `labelFromCode` (snake_case → Title Case) and `severityColor` (severity/status → palette token). +12 tests.

- **#366 — PR-NX36: Provenance & Source Register.** New section between Approvals Tracker and Pros & Cons that closes the audit-trust loop for institutional reviewers. Two subsections: (a) **Uploaded source documents** table with per-doc extraction status (e.g., "12 fields · gemini" / "Failed" / "Pending"); (b) **Auto-fill events (extracted → applied)** table pulling every `deal_audit_log` row where `metadata.source='document_extraction'` (the audit trail PR-NX25 writes when operator approves field application). Tone-coloured extraction status (green when fields > 0, red on error). 30-row truncation note for large inventories. Enriched `dealExport.service.js` `getDealExportContext()` with 2 parallel queries (autoFillEventsResult + extractionStatusResult), both soft-failing on 42P01 for backward compat. New `exportContext.provenance` slice; additive (XLSX/PPTX ignore today). +9 tests.

- **#367 — PR-NX37: Table of Contents + Methodology & Assumptions appendix.** Two final structural additions that close the DOCX completeness gap:
  - **Static Table of Contents** right after Cover. 20-entry list of every section in canonical order with AI-Assisted vs Platform Data tag per entry. Deliberately static (not Word's native `TableOfContents` field) so Google Docs preview / Word Online / older Word render entries on first paint without F9. New `SECTION_ORDER` constant is the single source of truth.
  - **Methodology & Assumptions appendix** between Overall Score and Disclaimer. Names the deterministic TypeScript financial kernel + asset-class-specific models (residential RERA escrow, hospitality USALI, commercial NOI, plotted absorption, mixed-use blend, raw-land entitlement), states the no-AI-numerics rule, asserts cross-product consistency across XLSX + PPTX + DOCX, lists every India-specific encoding (GST tiers, Karnataka stamp duty, RERA 70/30, BBMP UAV, Khata A/B, JDA, lender ecosystem), and renders a 3-column table of every operator input the kernel consumed (alphabetical, 80-row truncation note for large models). +12 tests.

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| exports.docx.test.js | 20 | 53 | +33 |
| **Backend TOTAL** | **1,854** | **1,887** | **+33** |

Zero pre-existing regressions across 105 backend suites. No frontend changes. No DB migrations.

### Outcome for the operator

**Before this batch:**
- DOCX report had no dedicated Risk Register / DD Status / Approvals Tracker — operators saw AI Pros & Cons without first reading the operator-curated platform facts.
- Source-document attribution lived only in the in-app Audit tab (PR-NX31); the printable DOCX never carried the provenance trail.
- No Table of Contents at the top, no Methodology appendix at the bottom.
- The two reference roadmap docs (`EXPORTS_REWRITE_STATUS.md`, `XLSX_INSTITUTIONAL_GRADE_ROADMAP.md`) were stale: 16 India-localization items marked 🔴 Open were actually shipped in PR-I1 through PR-I16.

**After this batch:**
1. **DOCX is now structurally complete** — 22 sections (Cover · ToC · AI-Assisted Briefing · Executive Summary · Site · Overview · Demographics · Why-area · Job Growth · Social Infra · Supply/Demand · Comparables · Better Alts · Financials · **Risk Register** · **DD Status** · **Approvals Tracker** · **Provenance** · Pros & Cons · Score · **Methodology** · Disclaimer).
2. Every IC reviewer downloading the DOCX now sees the operator-curated truth (risks/DD/approvals) BEFORE the AI synthesis, the full provenance trail (uploaded docs + auto-fill events) for audit, and a methodology appendix naming the kernel + every assumption.
3. `EXPORTS_REWRITE_STATUS.md` + `XLSX_INSTITUTIONAL_GRADE_ROADMAP.md` updated to reflect the actual production state.

### Outstanding operator actions (still carried)

1. **Smoke-test the new DOCX sections** on a real deal: confirm Risk Register / DD Status / Approvals Tracker populate when underlying tables are seeded; confirm Provenance section shows uploaded documents + auto-fill events; confirm Table of Contents appears on page 2 and Methodology appendix appears near the end.
2. **No new manual actions** introduced by this batch (no migrations, no env vars, no operator setup required).

### Recommendation for next session

The DOCX is now structurally complete and audit-grade. The next-highest-leverage work from Strategic Review §VI:
- **Adopt the ontology across deal-create / deal-edit forms** (frontend + backend express-validator pull from `@redip/real-estate-ontology` not `constants/domain.js`). Risk: medium — needs cross-check vs existing constants for drift.
- **Provenance chips on deal fields** — render a tiny "from sale-deed.pdf" chip next to fields populated via auto-fill, driven by the same `deal_audit_log` metadata that PR-NX31 surfaces in the timeline and PR-NX36 surfaces in the DOCX. Cross-cutting visual change; 1–2 sessions.
- **Live market-benchmark warnings on financial input forms** — port PR-NX28/NX33 validators to fire as the operator types in the Financials page, not only at export time. Needs a new `useBenchmarkBands(dealId)` hook + a server endpoint to ship comp percentiles. 1 session.

---

## 2026-05-17 (afternoon/evening) — Auto-fill discoverability + AuditTab ingestion rendering + income-deal validators (PR #361, #362, #363)

After the operator confirmed the overnight ingestion bundle and the BBMP enrichment closed, pivoted to follow-up work that **compounds the value of what shipped overnight**. The user asked for "highest priority right now" with "first principles thinking." First-principles question: what's the biggest *missed-opportunity* gap in the just-shipped auto-fill workflow? Answer: discoverability (operators landing on Overview tab don't know auto-fill exists) and trust (Audit timeline showed doc-ingestion events as generic "Edited" entries, indistinguishable from manual edits). Then completed PR-NX28's market-benchmark validators with income-deal coverage (DSCR + YoC spread).

### PRs shipped + merged

- **#361 — PR-NX30: AutoFillReadyCard on Deal Overview tab.** Closes the discoverability gap from PR-NX26. Pre-NX30, the only entry point to the auto-fill modal was a button buried in the Documents tab header — operators landing on the Overview tab (the default first-paint) had no signal extractions were waiting. New compact card right between DealQaBox and the Below-the-fold CollapsibleCards: "N fields ready to auto-fill from documents" with Sparkles icon, AI-assisted pill, source-doc-type citation ("Extracted from sale deed · khata extract · rera registration"). Click → opens the same `AutoFillFromDocumentsModal` from PR-NX26. Renders nothing when no extractions are mapped. +7 component tests.

- **#362 — PR-NX31: Distinctive AuditTab rendering for document_extraction events.** PR-NX25's apply-extractions endpoint writes `deal_audit_log` rows with `event_type='updated'` + `metadata.source='document_extraction'` + `applied_fields_count` + `source_extraction_ids` + `target_table` + `ontology_version` — but AuditTab.jsx rendered them with the generic "Edited" badge, losing the entire provenance story. New `resolveEffectiveCfg(event)` helper detects the metadata signature and returns a synthetic `DOC_EXTRACTION_CFG` (Sparkles icon, "Auto-filled from documents" label). `MutationDiff` now prepends an amber-tinted attribution banner — "📄 7 fields applied from 2 document extractions → deal record  v1.0.0" — before the per-field diff. `target_table='properties'` maps to "linked property." Generic edits (no metadata.source) render untouched. +5 AuditTab tests.

- **#363 — PR-NX33: Income-deal market-benchmark validators (DSCR + YoC spread).** Completes PR-NX28's market-benchmark coverage with income-family validators:
  - `validateDscrFloor` — computes DSCR via standard amortization formula from `ctx.kernelKpis.{noi, totalCost}` + `core.{debtLTV, debtRatePct}` + `ctx.inputs.loanTermYears`. Fires WARN when DSCR < 1.20 (RBI Master Direction floor for Indian LRD / project-finance lenders) with citation of exact NOI ÷ debt-service inputs + suggested lever. Escalated WARN below 1.00× ("NOI does not cover annual debt service").
  - `validateYocVsExitCapSpread` — checks the developer's reward for taking development risk. Negative spread → WARN ("developer earns LESS than a passive buyer of stabilised"). 0 to 50 bps → WARN ("THIN development premium"). 50+ bps → silent.
  Both added to the runner array already wired by PR-NX28 (no buildExportQa changes needed). +17 tests covering every band + edge case.

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| AutoFillReadyCard.test.jsx (NEW) | 0 | 7 | +7 |
| AuditTab.test.jsx | 19 | 24 | +5 |
| marketBenchmarkValidator.test.js | 28 | 45 | +17 |
| **Backend TOTAL** | **1,829** | **1,854** | **+25** |
| **Frontend TOTAL** | **457** | **462** | **+5** |

Zero pre-existing regressions. Frontend build clean (~15s). Preview boots clean with zero console errors.

### Outcome for the operator

**Before this batch:**
- Auto-fill was invisible unless you knew to go to the Documents tab.
- Audit timeline showed doc-ingestion events as generic "Edited (N fields)" — indistinguishable from manual edits.
- Income-deal Excel exports could ship with DSCR 0.85× (impossible per RBI) or YoC < ExitCap (no economic reason to build) and QA showed PASS.

**After this batch:**
1. Open any deal → "N fields ready to auto-fill from documents" appears above the fold with the source-doc citation. One click → modal opens.
2. Open the Audit tab → doc-ingestion events have a distinctive Sparkles icon + "Auto-filled from documents" badge + attribution banner naming the source extraction count, target table, and ontology version. Manual edits stay clearly distinct.
3. Income-deal exports flag DSCR < 1.20× (with computed value + inputs + which lever to dial back) and YoC ≤ Exit-Cap spread (with bps deficit + suggested adjustments). Cite-or-null per AI_ROADMAP — every WARN carries the exact citation.

### Outstanding operator actions (carried)

1. **Smoke-test the auto-fill workflow end-to-end** on a real deal: upload sale deed → extract → look for the new Overview card → click → modal opens → apply subset → check Audit tab for the new "Auto-filled from documents" entry with attribution banner.
2. **Smoke-test the income-deal validators** by opening an income-family deal (hospitality / office / retail), entering aggressive debt sizing on thin NOI → Excel export QA should now show DSCR WARN. Enter YoC ≤ ExitCap → spread WARN.
3. **Verify the leaked Claude key rotation** — carried from PR-NX22.

### Recommendation for next session

After this 3-PR follow-up, the Document Ingestion + Auto-fill workflow is **complete end-to-end with full audit trust**, and market-benchmark validators cover both development AND income families. Remaining top priorities from Strategic Review §VI:

- **Adopt the ontology across deal-create / deal-edit forms** (`@redip/real-estate-ontology` as the source of truth instead of `constants/domain.js`). Risk: medium — needs cross-check vs existing constants for drift. 1 session.
- **Provenance chips on deal fields** — show a tiny "from sale-deed.pdf" chip next to any deal field that was populated via auto-fill (driven by the same `deal_audit_log` metadata that PR-NX31 surfaces in the timeline). 1–2 sessions.
- **Live market-benchmark warnings on financial input forms** — port PR-NX28/NX33 validators to fire as the operator types in the Financials page, not only at export time. Needs a new `useBenchmarkBands(dealId)` hook + a server endpoint to ship comp percentiles. 1 session.

---

## 2026-05-17 (closing window) — BBMP enrichment to 100% + UAV↔Street cross-link + housekeeping (PR #359, plus this PR)

**What was worked on in plain English:**
- Closed both manual operator actions from earlier in the day:
  - **Tokyo Supabase project deleted** by the user via dashboard (`lsbhrbvuynzqhdtzczco` is gone; Mumbai `niamgjbxxgmmffggumvj` is the sole production project).
  - **BBMP zone enrichment taken from 30% → 100%** (9,913 / 9,913 streets classified). User added ~$10 of Gemini credits; total spend was ~$0.05.
- Made the UAV Benchmark zone column headers click-through into the Bengaluru Street Lookup with that zone pre-filtered + auto-scrolled into view (PR #359, the only code change in this window).
- Captured the heuristic SQL that took coverage from 46% (after LLM pass) to 100% as a reproducible script (`scripts/apply-bbmp-zone-inheritance.sql`) so the production write is documented and re-runnable on a fresh DB.

**How the 30%→100% enrichment broke down:**

| Tier | Method | Rows | Confidence |
|---|---|---|---|
| Heuristic | Phase 2a (single-zone PDF pages, no LLM) | included in trigram below | 0.75 |
| **LLM exact** | Gemini-extracted street, exact name match | 1,846 | 0.85 |
| **LLM fuzzy** | Gemini-extracted, trigram fallback (sim ≥ 0.3) | 3,873 | 0.65 |
| Inherit (prior, same ARO) | Page N inherits page N-1's dominant zone | 1,978 | 0.55 |
| Inherit (next, same ARO) | First page of section inherits page N+1 | 1,695 | 0.45 |
| Inherit (cross-ARO neighbour) | NULL aro_section rows | 439 | 0.40 |
| Inherit (chained iterations) | Multi-page deserts, iterated to fixed point | 82 | 0.35 |
| **Total** | | **9,913 (100%)** | |

**PRs opened/merged:**
- PR #359 — `feat(planning-intelligence): UAV Benchmark zone headers cross-link into Street Lookup` — squash-merged as `240b846`.
- (This PR) — `docs(bbmp): close out enrichment + Tokyo deletion, capture inheritance SQL` — open for merge.

**Verification:**
- BBMP street index: 9,913 / 9,913 (100%) enriched on Mumbai production. Every row carries a `confidence_score` (0.35–0.85) so the Review Queue can surface the lowest-confidence ones first for human verification.
- Backend test suite: 1,837 (unchanged — no service code changed in this window).
- Frontend test suite: 447 → 450 (+3 for the UAV↔Street event handshake tests).
- CI: every PR landed with all checks green.

**Manual blockers still pending:**
- None from the BBMP arc. The two earlier blockers (refresh GEMINI_API_KEY → run enrichment; delete Tokyo project) are both closed.

**What's left from the broader product roadmap (unchanged from previous entries):**
- K-GIS adapter is built but the cache is empty — cross-verification surface will light up as soon as real parcels trigger K-GIS lookups.
- IC PPTX slide for BBMP guidance — deliberately deferred because the deal page already shows the same data inline.
- Cross-locality K-GIS Bhoomi/Kaveri/RERA integrations remain credentials-blocked (recorded in TODO_DATA.md).

---

## 2026-05-17 (second 10-hr autonomous tail) — BBMP runbook + Ward Summary (PRs #356, #357)

**What was worked on in plain English:**
- Documented the two manual operator actions left after the BBMP arc (refresh `GEMINI_API_KEY` from Vercel → run the LLM enrichment script; delete the legacy Tokyo Supabase project via dashboard) directly in `TODO_MANUAL.md` so they're discoverable from the standard "what's pending" workflow.
- Added a ninth surface to the admin Planning Intelligence tab: **BBMP Ward Summary** — 198 wards rolled up by street index. Per-ward street count, dominant zone (the UAV zone code that wins the plurality of enriched streets), dominant-zone share %, distinct-zone count, median guidance bandwidth midpoint, sample ARO area. Sortable by every column, filterable by ward number / area name / single-letter zone code (A–F treated as exact-match-only so it doesn't collide with "RESIDENTIAL" via substring).

**PRs opened/merged:**
- PR #356 — `docs(todo-manual): add BBMP Phase 2b enrichment + Tokyo deletion runbooks` — squash-merged.
- PR #357 — `feat(planning-intelligence): BBMP Ward Summary — 198 wards rolled up by street index` — squash-merged.

**Verification:**
- Backend test suite: 1,835 → 1,837 (+2 covering the per-ward aggregate + the empty case).
- Frontend test suite: 434 → 447 (+13 across BbmpWardSummaryPanel sort/filter/tone-mapped badges + the page-test mock for `useBbmpWardSummary`).
- Build clean (34 s).
- CI: every PR landed with all checks green.

**Manual blockers still pending (no change since #355's entry):**
- Refresh `GEMINI_API_KEY` locally (`vercel env pull backend/.env.local`) → run `scripts/enrich-bbmp-street-zones.js` to take street zone coverage from 30% → ~100%.
- Delete Tokyo Supabase project `lsbhrbvuynzqhdtzczco` via dashboard (Supabase MCP exposes only pause/restore).

**What's left:**
- Cross-link the UAV Benchmark zone column headers to the Street Lookup with pre-selected zone filter — deferred this session; ~30 min frontend-only change when prioritised.
- K-GIS ↔ BBMP street-index cross-verification — adapter already exists but `kgis_cache` is empty; build the cross-verify surface once a real parcel triggers a cache populate.
- IC PPTX slide for BBMP guidance value — duplicates what's now on the deal page; revisit only if IC packets need standalone defensibility.

---

## 2026-05-17 (continued, ~10 hr autonomous window) — BBMP Guidance Value end-to-end (PRs #350, #351, #352, #353, #354)

**What was worked on in plain English:**
- Extracted the entire 686-page BBMP Guidance Value gazette into a searchable street-level index — **9,913 streets** with ward + source-page on every row, indexed in Postgres with a trigram GIN for fuzzy search.
- Built a **Bengaluru Street Lookup** panel on the admin Planning Intelligence tab — search any area or street, see the BBMP ward + the exact gazette page in milliseconds.
- Filled in the **BBMP zone (A–F) + IGR-style guidance value bandwidth (Rs. min–max / sqft)** for 2,943 streets (30%) using a deterministic heuristic over the pypdf zone footers; the remaining 70% are queued for an LLM enrichment pass that needs a working `GEMINI_API_KEY`.
- Wired the lookup directly into **every Bengaluru deal's Zoning tab** with a card that pre-seeds the search from the linked property and shows top-match zone, guidance band, and corpus coverage.
- Added a pure-JS **spread-vs-guidance kernel** that compares the deal's transaction price per sqft against the matched guidance bandwidth and renders a four-state signal (*Undervalued / Fair / Overpriced / Bubble risk*) with a **risk-adjusted not-to-exceed entry price** (`guidance_mid × 1.10`).
- Added a **"Verify on Kaveri"** CTA on the deal-side card pointing to the live IGR portal with the exact terms to enter, plus a sharpened disclaimer making the BBMP-property-tax-zone vs IGR-sale-deed-guidance distinction explicit.

**PRs opened/merged:**
- PR #350 — `feat(planning-intelligence): Bengaluru Street Lookup — 9,913 streets from the BBMP Guidance Value PDF` — squash-merged.
- PR #351 — `feat(planning-intelligence): Phase 2 — zone enrichment + zone-filter chips` — squash-merged.
- PR #352 — `feat(deal): wire Bengaluru Street Lookup into every Bengaluru deal's Zoning tab` — squash-merged.
- PR #353 — `feat(deal): spread vs guidance signal on Bengaluru deal Zoning tab` — squash-merged.
- PR #354 — `feat(deal): Verify-on-Kaveri CTA + IGR-vs-BBMP disclaimer on street lookup` — open (in CI at time of writing).

**Verification:**
- Backend test suite: 1,834 → 1,835 (+1 sweep of new street-lookup service tests; the 6 new tests are within the same single-suite parent describe).
- Frontend test suite: ~370 → 434 (+64 across guidance-value kernel parity, BengaluruStreetLookupPanel, DealStreetLookupCard, spread tile, Kaveri CTA).
- Frontend production build: clean every PR (10–22 s, no new warnings).
- CI: every PR landed with all checks green (Backend / Frontend / Financial kernel / Audit & migration lint / Vercel).

**Manual blockers (need your action when you wake up):**
- ⚠️ Both `GEMINI_API_KEY` and `ANTHROPIC_API_KEY` in `backend/.env` + `backend/.env.local` return 401 INVALID. Refreshing either unlocks `scripts/enrich-bbmp-street-zones.js` to fill in the remaining ~70% of unenriched street rows (~$1 cost, ~15 min runtime).
- ⚠️ Two Supabase projects exist: `lsbhrbvuynzqhdtzczco` (Tokyo, REDIP-Tokyo, has prior session's regulatory data) and `niamgjbxxgmmffggumvj` (ap-south, REDIP, matches `backend/.env`). The street index seed + heuristic enrichment landed in niam only. Tell me which Vercel production uses and I'll sync the other.
- Both projects had the schema migration applied so the table exists in both regardless.

**What's left:**
- LLM pass over the 70 multi-zone PDF pages to enrich the remaining ~7,000 streets (script ready, blocked on API keys).
- IC PPTX export could carry the BBMP guidance section inline — chose to defer because the deal page already shows it; revisit if IC packets need standalone defensibility.
- K-GIS integration for parcel polygon + village-code lookup (per GROK doc; would unlock geo-anchored guidance value joins) — separate, larger feature.

---

## 2026-05-17 (overnight) — Document Ingestion + Auto-fill MVP + Market-Benchmark Validators (PR #345, #346, #347, #348)

After the operator confirmed PR-NX24 fixed the charts ("Perfect. It works."), pivoted to the next flagship priority per docs/STRATEGIC_REVIEW_2026_05_15.md §III.1 — Document Ingestion + AI auto-fill. The extraction half was already shipped (Gemini 3.1 Flash-Lite extracts 15+ doctypes into `document_extractions.structured_fields` with confidence scores), but operators still had to manually re-enter every extracted field into the deal form. This batch closes that workflow gap end-to-end.

### PRs shipped + merged

- **#345 — PR-NX25: Canonical real-estate ontology + apply-extractions endpoint.** Two new artifacts:
  1. **`@redip/real-estate-ontology` v1.0.0** — the first-class versioned artifact called for by Strategic Review §III.2. Single source of truth shared across backend, frontend, and exports. Encodes the 10 native asset classes (with `family` and `india_notes`), 4 deal structures, family-conditional exit strategies, zoning + ownership enums, area unit conversions (sqft / acres / sqm / sqyd / guntha (Karnataka) / ground (TN)), pricing constants (₹ ↔ ₹Cr ↔ ₹Lakh), extraction field map (canonical_key → {table, column, value_type, transform, india_context, min/max guardrails}), confidence bands. `validateAndCoerce()` is the apply-extractions gate — type coerce + range/length check + transform application in one call. 51 tests pin every taxonomy + conversion + transform path.
  2. **`POST /api/deals/:id/apply-extractions`** — operator-approved extraction values land on the deal + linked property in a single transaction. Ontology-routed (each canonical field knows its destination table.column). Fail-soft per field (one out-of-range value doesn't kill the batch). Transactional (deal + property + source-marking commit together). Audit-attributed (one `deal_audit_log` row per target table with `metadata.source='document_extraction'` + `source_extraction_ids` + `ontology_version`). Marks source `document_extractions` as consumed via `correction_history` JSONB append (zero-migration audit linkage). 17 service tests pin routing, fail-soft, RLS, last-write-wins, JSONB append shape.

- **#346 — PR-NX26: AutoFillFromDocumentsModal — operator UI.** The frontend that consumes PR-NX25. New "Auto-fill from documents (N)" button on the Documents tab header (visible only when ≥1 extraction is mapped). Click opens a wide modal listing every canonical extracted field as a row with: current vs proposed value side-by-side (with "overwrites" warning), confidence pill (high/medium/low), source-document chip, per-field india_context tooltip explaining WHY the field matters. HIGH-confidence rows auto-selected on first render; bulk actions for select-all-by-band. Mandatory amber "AI-assisted — requires human review" banner per CLAUDE.md. Sticky footer CTA "Apply N fields". Vite alias `@redip/real-estate-ontology` imports the same v1.json the backend validates against — keeps frontend labels + routing in lock-step with backend writes. 14 modal tests cover open/closed, auto-selection, bulk actions, overwrite warnings, applyMutation invocation shape.

- **#348 — PR-NX28: Comp-derived market-benchmark validators.** Strategic Review §III.3 — "Validation engine extension (market-benchmark rules from verified comps)" — was the explicit next priority after the ingestion bundle landed. Pre-NX28 the 8 existing validators in `buildExportQa()` were deterministic + structural ("DebtLTV must be 0-1", "ExitCapRate must be present"). They never cross-checked operator inputs against the verified comp feed, so an aspirational sell rate (₹X above the 95th-percentile comp) passed QA silently. New module `marketBenchmarkValidator.js` adds 3 fail-open WARN validators: (a) `validateSellRateBands` — fires WARN if SellRatePerSqft is above p95 or below p25 of nearby verified comps with citation showing the count + percentile values; (b) `validateCompCoverage` — fires WARN when zero verified or <5 verified comps (benchmark is unreliable below this threshold); (c) `validateCompFreshness` — fires WARN when latest comp.launch_year is 3+ years older than the export year (Bengaluru micro-markets move 10–20%/yr). Each validator is fail-open, skipped silently when prerequisites aren't met, severity WARN (never blocker — per CLAUDE.md "never expose unverified market intelligence as authoritative"). +28 tests pin the percentile helper, the verified-rate extractor, each validator's positive/negative/edge cases, and the orchestrator's fail-open guarantee.

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| ontology.test.js (NEW) | 0 | 51 | +51 |
| dealApplyExtractions.service.test.js (NEW) | 0 | 17 | +17 |
| marketBenchmarkValidator.test.js (NEW) | 0 | 28 | +28 |
| AutoFillFromDocumentsModal.test.jsx (NEW) | 0 | 14 | +14 |
| **Backend TOTAL** | **1,784** | **1,829** | **+45** |
| **Frontend TOTAL** | **360** | **374** | **+14** |

Zero pre-existing test regressions across 104 backend suites + 44 frontend suites. Frontend build clean (~26s). Backend route compiles cleanly. Vite dev server boots clean with zero console errors.

### Outcome for the operator

**Before this batch:** Upload sale deed → Gemini extracts 30+ fields → see them on the extraction badge per document → manually retype each field into the deal form (Owner Name, Survey Number, Khata Number, PID, Land Area, Consideration, RERA Number, …). Deal-creation friction was the single largest workflow drag per the Strategic Review.

**After this batch:**
1. Upload sale deed → extraction runs as before.
2. Open the deal's Documents tab → see a new "Auto-fill from documents (N)" button next to "Upload Document."
3. Click it → modal opens with a side-by-side review of every mapped field. High-confidence ones are pre-checked.
4. Eyeball, tick/untick, click "Apply N fields." Deal + linked property are populated in one transaction.
5. Deal timeline now shows a "Fields applied from documents" audit row with source-extraction attribution.

What used to take 10–15 minutes of mechanical retyping now takes ~30 seconds of review.

### Outstanding operator actions

1. **Verify the leaked Claude key was rotated.** (Carried from PR-NX22; operator decided to skip but acknowledged risk.)
2. **End-to-end smoke after `d833327` deploys** (~3 min): upload a real sale deed PDF to a Bengaluru deal, wait for extraction, click "Auto-fill from documents", verify the field-comparison UI looks right + the apply flow populates the deal + the audit timeline shows the new entry.
3. **No DB migrations required.** Uses existing tables (deals, properties, document_extractions.correction_history, deal_audit_log).

### Recommendation for next session

After this overnight batch, the top three Strategic Review priorities are LANDED (doc ingestion, ontology, validation engine). Next-natural follow-ups, each independently shippable:

- **Adopt the ontology across existing services** — currently `dealApplyExtractions.service.js` is the only consumer of `@redip/real-estate-ontology`. Migrate the deal-create / deal-edit forms (frontend + backend express-validator) to pull asset-class / deal-structure / exit-strategy options from the ontology instead of `constants/domain.js`. Removes the drift risk where the backend ontology says "redevelopment" but the frontend hardcodes a stale list. **Risk**: medium — need to diff existing constants against ontology and reconcile any divergence. 1-session scope, NOT recommended for unattended autonomous execution.
- **Audit-log timeline UI surface for doc-ingestion auto-fill events** — PR-NX25's audit rows carry `metadata.source='document_extraction'` + `source_extraction_ids` + `applied_fields_count` + `ontology_version`, but the AuditTab UI renders them with the generic "Fields updated" label. A dedicated icon + summary ("7 fields applied from sale-deed.pdf by Rachit") plus an expand-to-see-which-fields drill-down makes the audit reviewable + builds trust. 1-session scope.
- **More market-benchmark validators** — PR-NX28 handles SellRatePerSqft + comp coverage + freshness. Future additions: DSCR < 1.20 BLOCK (RBI Master Direction floor), Yield-on-Cost vs Exit Cap spread WARN (negative spread), Construction-cost-per-sqft band check vs Bengaluru benchmarks. Each is a small validator. 1-session scope.

---

## 2026-05-16 (night) — Chart-injection root-cause hotfix + briefing truncation fix (PR #343)

Operator reported "Charts STILL missing from prod files" after PR-NX17 (drawing-ordering fix) shipped. Verified via screenshot that `REDIP_SKIP_ALL_POST_INJECTION` was deleted from Vercel — so the bug had to be code-side, not env. Diagnosed two independent silent failures plus a truncation issue in the briefing path. Bundled all three into one tight hotfix.

### PRs shipped + merged

- **#343 — PR-NX24: per-chart fault tolerance + extLst lift + Claude max_tokens bump.** Three independent root-causes consolidated:
  1. **Per-chart failure killed entire batch.** `injectChartsIntoXlsx` built all chart XML in a single try block — if any spec threw (bad range, unsupported type, escape edge case), the whole injection rejected and the outer catch swallowed it. Zero charts shipped even when 2/3 specs were valid. Post-fix: each spec gets its own try/catch in a per-chart loop. Bad specs skip with a logged warning; good ones still ship. Wholesale throw only fires when ZERO charts survived. Chart-index resequencing keeps `chart1.xml` / `chart2.xml` contiguous when middle specs fail.
  2. **Sparkline extLst patch produced schema-invalid XML.** `patchWorksheetXmlForSparklines` did `.replace(/<\/extLst>\s*/, sparklineExt + '</extLst>')` which spliced sparkline content INSIDE any existing extLst. When ExcelJS had placed an extLst BEFORE `legacyDrawing` (its iconSet conditional-formatting position), the merged extLst stayed at the wrong position — violating CT_Worksheet child-order schema. Excel auto-repair fired and scrubbed the Dashboard. Post-fix: the patcher detects schema-later elements after any existing extLst and LIFTS the extLst out, re-inserting it right before `</worksheet>` with both old + new ext children. Result: extLst always lands LAST per OOXML, exactly one per sheet.
  3. **AI Briefing truncated mid-JSON.** Operator's 14:54 UTC prod file footer read "primary returned malformed JSON — auto-failover succeeded on openai." Claude was being capped at 700 tokens — enough for SYSTEM_PROMPT's required keys but no headroom for asset-class-specific commentary. Bumped to 1200 across all three call sites (primary Claude, secondary OpenAI, secondary Claude) via a shared `PROVIDER_MAX_TOKENS` constant. Cost: +$0.0075/export.

  Plus operator-greppable diagnostics: `injectChartsIntoXlsx` accepts an optional `diagnostics` opts object; `buildWorkbook` passes one and on any failure emits `[CHARTS-FAILED hospitality/abc-123] 1/3 chart(s) failed (2 shipped). Failures: [1] sankey "Risk Distribution": unsupported chart type` so operators can grep Vercel logs for per-spec attribution. +9 new regression tests covering partial success / all-bad throws / extLst lift / end-to-end with comments + iconSet + sparklines coexisting.

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| exports.xlsxChartInjector.test.js | 20 | 29 | +9 |
| Other backend | 1,755 | 1,755 | 0 |
| **TOTAL** | **1,775** | **1,784** | **+9** |

Zero pre-existing test regressions. Frontend build clean (~13s).

### Outcome for the operator

**Before this hotfix:** Hospitality / mixed-use Dashboards shipped chart-less even though logs said "chart injection succeeded." Briefing footer routinely read "auto-failover succeeded on openai" because Claude's response was malformed-JSON (truncated). No way to know WHICH chart broke without re-running locally.

**After this hotfix:**
1. Charts render even when one spec has a quirk that previously killed the batch.
2. AI Briefing reads as a complete multi-paragraph narrative (Claude finishes properly at 1200 tokens, no fallback needed).
3. When a chart fails, operator greps Vercel logs for `[CHARTS-FAILED]` and sees exactly which spec + why — "sankey" type unsupported, "$Z$99" range invalid, etc.

### Outstanding operator actions (carried)

1. **Verify the leaked Claude key was rotated.** Operator decided to skip rotation but acknowledged risk.
2. **Re-download a hospitality deal export after `e09ef05` deploys** (~3 min). Expected: Dashboard charts render; briefing footer reads "Synthesis: Claude Sonnet 4.6" (no auto-failover suffix since truncation is fixed); if any chart fails, Vercel logs have a `[CHARTS-FAILED]` line.

### Recommendation for next session

Per prior strategic-review synthesis: **Document Ingestion + AI auto-fill MVP** (Priority 1 in STRATEGIC_REVIEW_2026_05_15.md). The XLSX export pipeline is now hardened against the chart / briefing failure modes; the AI provider stack is failover-cascaded and self-diagnosing. Next-highest-leverage work is closing the deal-creation friction (manual 30+-field entry → upload sale deed → Gemini extracts → operator reviews/commits → deal record auto-populated). Gemini-first with Claude fallback already wired via PR-NX21 cascade. 2-session scope.

---

## 2026-05-16 (late evening) — AI Reliability Bundle: failover + health surface (PR #339, #340, #341)

After confirming the operator's still-broken prod state (downloaded Pointec Pens + Jigani both shipped at 14:54 UTC still showing "templated fallback" + no charts despite the operator's morning env-var fixes), pivoted to **AI Reliability** — the gap between "AI works in code" and "AI works in production reliably." Operator green-lit the auto-failover code change I had pending. Bundled with health surface to make the entire AI infrastructure self-diagnosing.

### PRs shipped + merged

- **#339 — PR-NX21: AI Briefing multi-provider failover cascade.** `generateDealBriefing` now tries 3 paths in order: PRIMARY (Claude Sonnet 4.6) → SECONDARY (OpenAI GPT-5.4, auto-cross-over) → TEMPLATED. Operator never sees "templated fallback" unless BOTH AI providers are simultaneously down. New briefing schema fields: `source` (tri-state: `ai-assisted-claude` | `ai-assisted-openai` | `templated`), `provider` (model id), `fallbackReason` (diagnostic when primary failed, e.g., "Claude 401 invalid_api_key — auto-failover succeeded on openai"). All 3 export builders (XLSX / DOCX / PPTX) updated to recognize the new tri-state source via `startsWith('ai-assisted')` + surface `fallbackReason` in the briefing footer. +4 tests.

- **#340 — PR-NX22: AI Health backend endpoint.** New `GET /api/admin/ai-health` + `aiHealth.service.js` surface live operational status for Gemini / Claude / OpenAI. Per-provider: configured + lastCall (status / latency / task / errorCode + errorMessage) + 7d aggregates (calls / successRate / p50 / p95 latency) + coarse `healthBand` classification (`healthy` / `degraded` / `unhealthy` / `unknown`). Overall band picks worst across the 3. Soft-fails if `ai_call_logs` unavailable. Admin/analyst-gated, org-scoped via RLS. +22 tests.

- **#341 — PR-NX23: AI Health frontend widget on Settings page.** New `AIHealthWidget` mounted on SettingsPage right above the existing `AIUsageWidget`. 3 provider rows with color-coded status dot + label, last-call timestamp + 7d summary inline, click-to-expand reveals last-call detail (task / latency / error code + message) + 7d aggregates (calls / success rate / p50 / p95 latency). Auto-refresh every 60s. Overall health pill in widget header. Hairline borders + neutral greys per FRONTEND_GUIDELINES.md.

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| dealBriefing.service.test.js | 61 | 65 | +4 |
| aiHealth.service.test.js (NEW) | 0 | 22 | +22 |
| Other backend | 1,667 | 1,668 | +1 |
| **TOTAL** | **1,749** | **1,775** | **+26** |

Zero pre-existing test regressions. Frontend build clean (~13-17s).

### Outcome for the operator

**Before this batch:** Operator's prod has `ANTHROPIC_API_KEY` showing "Needs Attention" in Vercel → every AI Briefing falls to templated → operator only discovers this by downloading a deal export and reading the footer.

**After this batch:**
1. Briefing auto-fails over to OpenAI when Claude is broken. The operator's NEXT download will likely show "Synthesis: gpt-5.4 · auto-failover: Claude 401 invalid_api_key" — REAL AI briefing + visible diagnosis.
2. Settings page in REDIP now shows 3 colored status pills. Red dot next to Claude with "Last call: error — 401 invalid_api_key" tells operator EXACTLY which env var to fix.
3. Worst case (both AI providers down): footer says "cause: Claude 401; OpenAI 429 rate_limited" — actionable instead of vague "AI unavailable."

### Outstanding operator actions (carried)

1. **Verify the leaked Claude key was rotated.** Operator decided to skip rotation but acknowledged risk.
2. **Charts still missing from prod files.** Either `REDIP_SKIP_ALL_POST_INJECTION` is still set in Production scope (not just Preview), OR there's a deploy that hasn't propagated. Operator should verify in Vercel env vars page (search for "REDIP").
3. **Re-download after `f03d4a8` deploys** (~3 min). Expected: briefing footer says "Synthesis: gpt-5.4 · auto-failover: ..." (if Anthropic key still broken) OR "Synthesis: Claude Sonnet 4.6" (if key works); native charts render on Dashboard; Settings page shows new AI Provider Health widget.

### Recommendation for next session

Per the prior strategic-review synthesis, the next-highest-leverage work is **Document Ingestion + AI auto-fill MVP** (Priority 1 in STRATEGIC_REVIEW_2026_05_15.md). Now that Gemini key is restored AND the AI reliability foundation is hardened, the document-extraction pipeline (Gemini-first with Claude fallback already wired) should be production-trustworthy. 2-session scope. Closes the deal-creation friction (manual 30+-field entry → upload sale deed → AI extract → operator review/commit).

Honorable mention: **Tier 4 B (Briefing visual diff)** — combined with PR-NX10 scenarios + the now-resilient briefing, this is the defining "every edit produces a measurable, accountable shift" UX moment.

---

## 2026-05-16 (evening) — Cross-product AI Briefing parity + reconciliation suite + doc sync (PR #335, #336, #337)

After the morning's Pointec Pens root-cause fix (PR-NX17, drawing-element OOXML ordering), the XLSX export is stable. Pivoted from firefighting to feature work. Per operator direction ("highest priority right now, multiple things that go well together"), read every .md file in the repo + did first-principles synthesis. Picked the **3-PR compound bundle** that extends recent work + adds validation + cleans hygiene.

### PRs shipped + merged

- **#335 — PR-NX18: AI-Assisted Briefing parity for DOCX + PPTX.** Extends the asset-class × deal-structure × exit-strategy aware briefing (shipped in PR-NX12 #328 for XLSX) to DOCX and PPTX. Single source of truth: `backend/src/services/exports/xlsx/v2/dealBriefing.service.js`. Each format calls it via a small adapter that reshapes its own context. DOCX gets a new "AI-Assisted Briefing" section between Cover and Executive Summary (mandatory amber disclosure, 4 asset-class-aware bullets, crimson risk callout, footer with synthesis attribution). PPTX gets a new "AI-Assisted Briefing" slide at position 2 (right after Cover, before Contents). +11 tests verifying slide manifest placement, asset-class-aware language (hospitality USALI vs office leasing), section ordering, graceful zero-KPI fallback.

- **#336 — PR-NX19: Cross-product reconciliation test suite.** New `exports.crossProductReconciliation.test.js` builds the same `exportContext` through all 3 export builders (XLSX / DOCX / PPTX) and asserts the asset-class-aware briefing language matches across all three. Catches a regression where any one builder drifts from the shared service. Covers 3 asset classes (hospitality, commercial_office, residential JDA) × 5 assertion types per class (asset class label, economics language, GST framing, deal structure language, mandatory disclosure). PPTX built via Node subprocess (`execFileSync` pattern from existing tests) because pptxgenjs has a dynamic ES-module import incompatible with Jest's default VM. +14 tests, all pass.

- **#337 — PR-NX20: Stale doc refresh.** 4 .md files where model IDs + cross-product references had drifted from prod reality. AI_ROADMAP §3.1 header bumped to 2026-05-16 (legacy snapshot preserved as §3.1.legacy); §8.1 model routing table updated to PR-NX9 defaults (Gemini 3.1 Flash-Lite, GPT-5.4, Claude Sonnet 4.6) + adds the new `narrative_synthesis` task. PARCEL_INTELLIGENCE_DECK updated all 5 "Gemini 2.5 Flash" references → 3.1 Flash-Lite. TODO_MANUAL model bump timestamp 2026-05-05 → 2026-05-15 (PR-NX9), Gemini model ID fixed from `gemini-3-flash-preview` → `gemini-3.1-flash-lite`, per-task routing env-var overrides documented. OPERATOR_HANDBOOK adds a stale-notice banner pointing to SESSION_LOG.md for the ~175 PRs since 2026-05-04.

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| exports.docx.test.js | 13 | 20 | +7 |
| dealPptx.service.test.js | 13 | 17 | +4 |
| exports.crossProductReconciliation.test.js | 0 | 14 | +14 |
| Other backend | 1,722 | 1,722 | 0 |
| **TOTAL** | **1,720** | **1,749** | **+29** |

Zero pre-existing test regressions across all 101 backend suites. Frontend build clean (~14-30s).

### Architecture wins from this batch

- **Single source of truth for briefing language.** All 3 export formats now consume `dealBriefing.service.js`. A reviewer downloading the same deal as XLSX, PPTX, or DOCX sees verbatim identical headline language. Cross-product consistency is machine-enforced (PR-NX19 reconciliation suite).
- **Per-asset-class narrative coverage 100%.** 10 native asset classes × 4 deal structures × 7 exit strategies × 3 export formats = full coverage of the matrix.
- **Stale doc debt cleared.** Operator handbook + AI roadmap + parcel intel deck + TODO_MANUAL all reflect current model defaults + cross-product references. No more "wait, which Gemini are we on?" questions.

### Outstanding operator actions (carried from prior sessions)

1. **Re-download Pointec Pens** after Vercel deploys commit `d22207a` (~3 min). Confirm hospitality Dashboard loads cleanly with native charts (PR-NX17 should have fixed the root-cause OOXML ordering issue).
2. **Verify Vercel env vars** so AI Briefing fires (PR-NX12/NX18 currently falling back to templated in prod per operator's earlier file):
   - `ANTHROPIC_API_KEY` must be set
   - Optionally `AI_PROVIDER_NARRATIVE_SYNTHESIS=claude` (default after PR-NX9 anyway)
   - Optionally `CLAUDE_MODEL=claude-sonnet-4-6`
3. **Remove `REDIP_SKIP_ALL_POST_INJECTION` env var** (set during PR-NX16 debugging — no longer needed since PR-NX17 fixed the root cause).

### Recommendation for next session

Per the .md file synthesis, the next highest-leverage work is **Document ingestion + AI auto-fill MVP** (STRATEGIC_REVIEW Priority 1; biggest moat). 2-session scope. Closes the deal-creation friction (manual entry of 30+ inputs → upload sale deed + AI extract + operator review + commit).

Honorable mention: **Live what-if buildability sliders on Parcel Tab** (PARCEL_INTELLIGENCE_DECK Q-next T1; 1 session, zero LLM cost). Bloomberg-grade interaction.

---

## 2026-05-15 (late afternoon) — Pointec Pens audit + 4-PR comprehensive fix (PR #327, #328, #329, #330)

Operator audit flagged 14 issues in the downloaded Pointec Pens Excel (hospitality deal). Top: Dashboard sheet stripped to nothing by Excel auto-repair due to malformed XML in PR #325 cell-note serialization. Below that: briefing said "0 sqft hospitality" + "rent inputs pending" (asset-class-blind), GST framing wrong for hospitality, phantom rent field on hospitality Inputs sheet, several minor UX issues.

### PRs shipped + merged

- **#327 — HOTFIX: cell.note plain-string** (covered in morning). XML corruption fix that restored the Dashboard sheet.

- **#328 — PR-NX12: Asset-class × structure × exit-strategy aware briefing narrative.** Fixes briefing snapshot extractor to derive sqft from `hospitalityKeys × sqftPerKey` when SaleableAreaSqft is 0 (the "0 sqft hospitality" bug). Splits economics builder into 10 asset-class-specific functions (hospitality USALI, retail anchor/vanilla/CAM, office CAM-loaded rent, industrial warehouse, residential launch price + RERA velocity, villas luxury premium, plotted sell-rate minus dev cost, mixed-use component blend, redevelopment landowner area-share, raw land entitlement stage). Adds 4 deal-structure-specific capital-stack builders (outright / JDA-RS / JDA-AS / DM). Adds 7 exit-strategy-specific exit-phrase builders. Adds 10 asset-class-specific India GST framings (hospitality construction inputs + room nights; office GST on rent + ITC; residential UC sale + affordable carve-out; plotted no-GST; raw land no-GST + Karnataka conversion fee). Adds asset-class-specific risk notes (hospitality occupancy break-even, retail anchor concentration, mixed-use single-component dominance, plotted velocity, raw-land entitlement). +40 tests.

- **#329 — PR-NX13: Asset-class-aware Inputs sheet visibility.** Hospitality now skips both `incomeRevenueSection` (rent/sqft) and `incomeOpExSection` (office-style opex) — USALI section supplies the correct keys-based revenue + departmental-cost inputs. Hospitality + raw_land hide Loading Factor + Carpet Area rows (sale-side carpet concepts that don't apply). Raw_land + plotted_development skip RERA Escrow section (no construction milestones). Office / retail / industrial / residential / villas / mixed-use / redevelopment unchanged (regression-test guarded). Inputs sheet for hospitality dropped from 1011 → 919 cells (= ~92 phantom rent rows hidden). +8 tests.

- **#330 — PR-NX14: Briefing prefix unification + provider metadata fix + Project Schedule label clarity + 3-state approvals reconciliation.** Both AI-active and templated-fallback paths now share "⚠ AI-Assisted Briefing" prefix with synthesis path in parentheses. Footer no longer claims "OpenAI gpt-4o" (stale since PR-NX9) — now says "Claude Sonnet 4.6" or the operator-actionable env-var hint when fallback. "Project Duration / Quarters" relabeled to "Construction Duration (months, build phase) / Total Modeling Horizon (quarters, incl. operating hold)" to eliminate the "48 months = 16 quarters, why 56?" confusion. Approvals reconciliation status gets a third "ℹ Headline only — populate line items below" state for when the operator hasn't itemized yet (instead of alarming "⚠ Drift > 5%"). +4 tests.

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| exports.xlsxV2.test.js | 211 | 223 | +12 |
| dealBriefing.service.test.js | 19 | 61 | +42 |
| exports.xlsxV2.realism.test.js | 42 | 42 | 0 |
| assetClassDefaults.test.js | 15 | 15 | 0 |
| Other backend | 1,377 | 1,375 | -2 |
| **TOTAL** | **1,664** | **1,716** | **+52** |

Zero pre-existing test regressions across all 101 backend suites. Frontend build clean throughout (~14-44s).

### Outstanding operator actions

1. **Re-download a deal Excel** to verify the Pointec Pens-class bugs are fixed end-to-end. Dashboard should load without repair popup; hospitality deals should read "100-key hospitality (~55,000 sqft GFA)" not "0 sqft hospitality"; rent-based phrasing replaced by USALI Keys × ADR; GST line says "construction inputs + room nights" not "under-construction sale"; Loading Factor row gone from hospitality Inputs; Schedule labels self-documenting.

2. **Verify Vercel env vars** so AI briefing fires (currently dark per audit):
   - `ANTHROPIC_API_KEY` must be set (per project_context.md it was set on 2026-05-05, but worth re-confirming)
   - `AI_PROVIDER_NARRATIVE_SYNTHESIS=claude` (or empty — Claude is the default after PR-NX9 if no override)
   - `CLAUDE_MODEL=claude-sonnet-4-6` (default; can be empty)
   - Optional: insert `('narrative_synthesis', 'claude', 'claude-sonnet-4-6')` into `ai_routing_config` table for admin-panel visibility
   - When working, footer row 17 should read `Provider: Claude Sonnet 4.6 · Cached on deal-snapshot hash` (not `Synthesis: deterministic templated fallback`).

### Items NOT fixed in this batch (deliberate)

- **"EM 2.46x doesn't reconcile with IRR 9.3%"** — my initial triage flagged this as a bug, but on reflection EM and IRR legitimately diverge when there are interim cash flows (operating NOI over 7 years + terminal sale). The Pointec Pens hospitality deal has both, so the divergence is expected. Not a bug. No action needed unless the operator can demonstrate a specific deal where the kernel computes inconsistent EM.
- **ADR Base = ADR Peak both ₹7,000** — operator-overridden value. The asset-class defaults in `assetClassDefaults.js` correctly differentiate (`hospitalityADRBase: 7500`, `hospitalityADRPeak: 11500`). Not a bug.
- **Number of Keys = 100 (default = 250)** — operator-overridden value. Not a bug.

### Recommendation for next session

Operator should:
1. Re-download the Pointec Pens Excel and confirm end-to-end fix (5 min)
2. If the briefing still shows templated fallback, set Vercel env per action #2 above (5 min)
3. If still issues, share the new file — there may be a third-tier bug below the asset-class-blindness we've now fixed

---

## 2026-05-15 (afternoon) — Probability-weighted scenarios + full-coverage KPI icon-sets (PRs #324, #325)

Operator directive: *"Pls start with whatever is best for website. We have all the time in the world. Do multiple steps/ tasks together that is convenient for you and best for the website, goes well together. Verify it works with no errors, no problems and no bugs and then push+commit+deploy."*

Two thematically coherent PRs that compound on the morning's PR-NX10 sensitivity work and the PR-NX8 dashboard visual depth.

### PRs shipped + merged

- **#324 — Probability-Weighted Scenarios + Top-Driver Sensitivity Ranking (PR-NX10).** New Dashboard sections below Debt Maturity Ladder: 4-scenario blend (Bull 25% / Base 50% / Bear 20% / Lehman 5%) with asymmetric tail weighting per Knight 2018 IC convention. Each scenario shocks 4 input axes simultaneously and computes a single yield-on-cost (income) or project margin (development). Derives an **Expected-Value IRR** as SUMPRODUCT(weights × scenario outputs) — the single headline number IC underwrites against. Adds **Top-6 Driver Ranking** with low/high-case deltas, basis-point range, cumulative running sum, asset-class-aware driver list. Every formula live-recalcs against Inputs named ranges — zero hardcoded numbers, zero AI, methodology footer cites academic basis. +18 tests.

- **#325 — Full-coverage KPI icon-sets with Bengaluru benchmark bands (PR-NX11).** New `KPI_BENCHMARKS` table in `assetClassDefaults.js` with Bengaluru-priority red/amber/green thresholds for every Dashboard KPI tile. Every entry carries an explicit citation (Cushman, JLL, Knight Frank, HVS, RBI) per CLAUDE.md "verified data only" rule. New `benchmarkFor(assetClass, family, kpi)` resolver with 3-step precedence (asset-class → family → null). Replaces the partial 2-3-tile icon-set wiring with full 6-tile coverage per family. Asset-class threshold swaps (office yield-on-cost 8.0-11.0% vs warehousing 9.0-12.0%) reflect real Bengaluru market bands, not generic globals. Down-is-good KPIs (exit cap rate) use `reverse: true`. Hover any KPI tile → cell comment shows benchmark range + source. +22 tests across two test files (15 in new `assetClassDefaults.test.js`, 7 in `exports.xlsxV2.test.js`).

### Architecture additions

- `backend/tests/assetClassDefaults.test.js` — new test file for KPI_BENCHMARKS structure + benchmarkFor precedence
- `KPI_BENCHMARKS` export in `assetClassDefaults.js` — family defaults + per-asset-class overrides with citations
- Dashboard scenario block at rows after Debt Maturity Ladder; Driver ranking block below scenarios

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| exports.xlsxV2.test.js | 186 | 211 | +25 |
| assetClassDefaults.test.js | 0 | 15 | +15 |
| Other backend | 1,436 | 1,436 | 0 |
| **TOTAL** | **1,622** | **1,662** | **+40** |

Zero pre-existing test regressions across all 101 backend suites. Frontend build clean both PRs (~22-26s).

### Production verification (pending — manual)

Two manual smoke tests outstanding from the morning batch + this batch:

1. **PR-NX10 (this batch)** — Download a deal XLSX from prod and scroll to the bottom of the Dashboard (below the Debt Maturity Ladder). Verify:
   - "Probability-Weighted Scenarios — Bull / Base / Bear / Lehman" section appears with 4 scenario rows
   - Probability sum row shows 100%
   - Expected-Value Yield-on-Cost (income) or Expected-Value Project Margin (dev) is a non-zero number
   - Top-Driver Sensitivity Ranking lists 6 drivers with cumulative range

2. **PR-NX11 (this batch)** — Same workbook. Verify:
   - Every KPI tile (6 per family) shows a red/amber/green traffic-light icon next to the number
   - Hover any tile (e.g. Yield on Cost) — comment includes "KPI Benchmark" + source citation
   - Cap rate tile shows green when low, red when high (inverted direction)

3. **PR-NX7 / NX9 (from morning batch)** — AI Briefing tab first row 17 should now read `Provider: claude-sonnet-4-6` (Claude active) vs `Synthesis: deterministic templated` (fallback). If fallback only, debug `ANTHROPIC_API_KEY` + `ai_routing_config narrative_synthesis` row.

### What's next (carry-over from morning, unchanged)

**Tier 1 (real depth):**
1. AI Briefing production smoke test (~30 min)
2. Native P&L drivers for 9 mapped asset classes
3. Sheet count 7-8 → ≤5 (operator directive)
4. ~~Dedicated Sensitivity worksheet~~ — superseded by today's PR-NX10 (Dashboard-embedded scenarios + drivers)
5. Lease Roll + Construction Drawdown

**Recommendation for next session:** Tier 4 B (Briefing visual diff on deal updates) — combined with today's Dashboard depth, every input edit produces a measurable, accountable shift visible in both the briefing narrative AND the scenario block.

---

## 2026-05-15 — Per-deal Excel exports → investor-grade, India-native, AI-augmented (PRs #312–#320)

Operator directive at the start: *"Make sure everything is accurate, specific, credible, precise, relevant, correct, reliable, informative, interesting, impactful."* + later: *"Generate excel exports specific and relevant to each deal. It should be generated based on deal type and structure, asset type, inputs and assumptions and exit strategy given by user."*

Nine PRs shipped, +125 tests, zero regressions. The per-deal XLSX moved from "spreadsheet of numbers" to investor-grade IC briefing package.

### PRs shipped + merged

- **#312 — Accuracy fixes from Pointec Pens audit.** Stabilised NOI formula was `BF18 × 4` (lifetime aggregate × 4, ~14× over-statement). Replaced with trailing-year SUM via INDEX. Same pattern for Cash-on-Cash (Q2 → stabilised year). Net Sale Proceeds → final-quarter INDEX. Income-family IRR convergence fixed by injecting initial equity outflow at Q1. `returnCfLegacyRow` off-by-one (11 → 12 for income).
- **#313 / #314 — Reference Template Library (since removed).** 65 downloadable templates (19 asset classes × deal structures). Polish PR added hero strip + search + India badges + defaults preview. **Reverted in PR-317** per operator pivot: "no separate tab, make per-deal exports themselves specific."
- **#315 — India regulatory cell comments + Khata wiring.** 20+ hover tooltips citing Finance Act 2019, GST Council notification 03/2019-CT(R), Karnataka Stamp Act 1957, BBMP Property Tax Rules 2009, RERA Act 2016, RBI Master Direction, Income Tax Act Sections 111/112A/194-IA, Karnataka Municipality Act 1964. KhataExitMultiplier wired into income Reversion + ImpliedNetExitValueCr.
- **#316 — Derived-value loop closure.** MixUseBlendedRatePerSqft → SellRatePerSqft default for mixed_use. ApprovalCostCr ↔ ApprovalsBreakdownSumCr reconciliation row with auto-flag. EffectiveExitFactor × KhataExitMultiplier injected into dev-family final-quarter Quarter Sales for bulk_exit_completion strategy.
- **#317 — Per-deal identity headers + removed Templates UI.** Dashboard subtitle: `{Asset} · {Structure} · Exit: {Strategy} · {Hold} · {City} · {Micro-market}`. Sidebar nav cleaned up. TemplatesPage.jsx kept as orphaned file but unlinked.
- **#318 — Asset-class defaults bridge.** New `assetClassDefaults.js` layered into `resolveEngineAssumptions()`. Closes the gap where sparse-input deals exported as mostly-zero workbooks. Deconflicted from kernel-published keys (rentPerSqftPerMonth, exitCapRatePct) to avoid shadowing kernel values.
- **#319 — AI-Assisted Executive Briefing (flagship).** New first tab on every workbook. Three-layer architecture: deterministic numeric snapshot extraction → AI synthesis via OpenAI gpt-4o (cached) → templated fallback. Mandatory "⚠ AI-Assisted — REQUIRES HUMAN REVIEW" disclosure per CLAUDE.md. 4-bullet narrative + auto-flagged risk note + full disclosure footnote.
- **#320 — Capital Stack + Debt Maturity Ladder + snapshot-realism suite.** Two new Dashboard sections with data-bar visualizations + reconciliation status flag. 42 realism tests across 6 representative fixtures asserting headline KPIs land in asset-class plausibility bands. Catches PR-312-class regressions automatically.

### Architecture additions

- `backend/src/services/exports/xlsx/v2/assetClassDefaults.js` — Bengaluru-priority defaults for 10 native asset classes
- `backend/src/services/exports/xlsx/v2/dealBriefing.service.js` — AI + templated narrative generation
- `backend/tests/exports.xlsxV2.realism.test.js` — 6-fixture snapshot suite

### Tests

| Suite | Start | End | Δ |
|---|---:|---:|---:|
| exports.xlsxV2.test.js | 120 | 186 | +66 |
| dealBriefing.service.test.js | 0 | 19 | +19 |
| exports.xlsxV2.realism.test.js | 0 | 42 | +42 |
| Other backend | 1,377 | 1,375 | -2 |
| **TOTAL** | **1,497** | **1,622** | **+125** |

### Production verification (pending — manual)

- AI Briefing path is built but unverified in prod. Download a deal XLSX, check the Briefing footer for `Provider: OpenAI gpt-4o` (AI active) vs `Synthesis: deterministic templated narrative` (fallback). If fallback only, debug `OPENAI_API_KEY` runtime visibility + `ai_routing_config` reasoning task entry.

### What's next (tiered)

**Tier 1 (real depth):**
1. AI Briefing production smoke test (~30 min)
2. Native P&L drivers for 9 mapped asset classes (Data Centre, Co-living, BTR, Logistics Park, etc.) — currently share P&L with closest native
3. Sheet count 7-8 → ≤5 (operator directive); consolidate Monthly Cash Flow + Debt Sizing into Calculations
4. Dedicated Sensitivity worksheet (2D tables + IRR contour + Spider + Bull/Base/Bear/Lehman overlay)
5. Lease Roll (income) + Construction Drawdown (dev) — pre-req: `lease_tenants` + `construction_milestones` data models

**Tier 2 (polish):** AI briefing on DOCX + PPTX · sheet protection unlocking only inputs · native chart objects · sparklines on every tile

**Tier 4 (better alternatives, ranked):**
- A: Streaming briefing preview on Reports page (~1 session)
- B: Briefing visual diff on deal updates (~1 session, flagship)
- C: Nightly briefing pre-cache cron (~half session)
- D: AI comp commentary on Dashboard (~1-2 sessions)
- E: Risk heatmap on Dashboard from `risks` table (~half session)
- F: Comp-to-deal positioning scatter chart (~1 session)
- G: PDF IC-summary one-pager (~1 session)
- H: Briefing feedback loop / thumbs-up-down (~half session)
- I: Document-to-input auto-population via Gemini (~1-2 sessions)
- ~~J: Hindi/Kannada translation~~ (skipped per operator)

### Recommendation for next session

Top pick: **Tier 4 B (Briefing visual diff)** — flagship UX. Combined with the PR-NX8 realism suite, every input edit produces a measurable, accountable narrative shift.
Runner-up: **Tier 1 #1 (AI smoke test)** — 30 min, confirms the flagship feature actually fires in prod.

---

## 2026-05-12 — XLSX Excel polish batch: formula-driven tiles, Exit Strategy, dropdowns, Post-Tax IRR (PRs #292, #293, #294, #295, #296)

Operator directive: *"Pls make the excel sheets specific and relevant to each deal type and its asset class with different deal structure and exit strategy. Hardcode values and numbers only where necessary. Use formulas, cell references, linkages and locking of cells wherever possible, applicable and required. Make sure there are no errors or bugs or problems and nothing breaks in the excel sheet with no invalid value."*

Two operator-provided downloads as the starting evidence:
- `redip-Jigani-_Apartments (4).xlsx` (residential / development family)
- `redip-Pointec_Pens_and_Energy_Private_Limited (1).xlsx` (industrial via PR-292 inference)

### PRs shipped + merged

- **#292 — fix(exports/xlsx): formula-driven Dashboard tiles + sanity-check banner + stronger asset-class inference.** Headline KPI tiles now ALWAYS prefer formula over kernel literal (live recalc on Inputs edits). Sanity banner at row 3 catches negative margin / negative cash flow. Asset-class inference upgraded with industrial / corporate / energy / pharma keyword rules + Private Limited / Pvt Ltd suffix → industrial. Residential-marketing guard rejects "Sunshine Energy Towers" / "Powerhouse Residences" from mis-classifying as industrial.
- **#293 — feat(exports/xlsx): Exit Strategy section — family-conditional (PR-EX).** New Inputs section: Development family gets `ExitStrategyType` dropdown (outright_sale, hold_to_lease, partial_sale_partial_hold) → `EffectiveExitFactor` derived. Income family gets `ExitStrategyType` (sale_to_institutional, refinance, hold_forever) + Total Exit Cost composition (selling + broker + legal). `ImpliedNetExitValueCr` formula = NOI ÷ Cap × (1 − TotalExitCost).
- **#294 — fix(exports/xlsx): Implied Net Exit Value bug + Reversion wiring + Dashboard CF rules.** Critical bug fix: `ImpliedNetExitValueCr` was referencing B6 (Asset Class text) instead of NOI — IFERROR collapsed it silently to ₹0 Cr. Replaced with `INDEX('Cash Flow Engine'!18:18, TotalQuarters+1)` for the last-quarter NOI. Reversion row updated to use `(1-TotalExitCostPct)` instead of bare `(1-SellingCostPct)`. Dashboard KPI tiles added red/amber/green conditional formatting per family (B4/B7 income vs B7/D7/F4 dev).
- **#295 — feat(exports/xlsx): Excel-native dropdowns on all categorical input cells (PR-DD).** Every categorical input gets a `dataValidation type='list'` dropdown — KhataStatus, DealStructureLabel, LenderType (11 options), RateBenchmark, LoanType, IndexationRegime, MilestoneEscalationModel, RawLandCurrentStage, ExitStrategyType (family-conditional list). Friendly error popup on invalid entry. Numeric cells confirmed unaffected.
- **#296 — feat(exports/xlsx): Dashboard Post-Tax IRR row (India LTCG/STCG-adjusted) — PR-NX.** New row 22 on every Dashboard: Post-Tax IRR = B21 × (1 − EffectiveCGRate). Effective rate (12.5% LTCG ≥ 2yr, 30% STCG slab < 2yr) and the hold-period driver echoed in C22/E22 for traceability. Cascade-shifted every row below 22 (+1): disclosure footnote, sensitivity grid, tornado driver formulas + chart anchor + chart spec ranges, scenario strip, Quarterly Trend table + combo chart series refs, JV waterfall offsets.

### Tests

1497 backend tests passing at end of session (was 1472 at the start of the day, +25 tests across PR-292/293/294/295/296).

127 of those are XLSX V2 tests (up from 110). New test coverage:
- 7 Post-Tax IRR row tests (label / formula / disclosure / shifted titles)
- 10 dropdown tests (per categorical option group)
- 4 conditional formatting tests (red/amber/green per KPI)
- 4+ ImpliedNetExitValueCr / Reversion / sanity-banner formula tests

### What's next (deferred follow-ups)

- Wire `EffectiveExitFactor` into dev-family Quarter sales formula (currently sits in Inputs as derived but doesn't feed Phasing)
- Wire `MixUseBlendedRatePerSqft` into `SellRatePerSqft` default for mixed_use (operator currently pastes derived into primary input)
- Wire `KhataExitMultiplier` into Phasing P&L
- Auto-sync `ApprovalsBreakdownSumCr` ↔ `ApprovalCostCr`
- Monthly cash flow detail (vs current quarterly) — large refactor

---

## 2026-05-11 (evening) — Claude→OpenAI provider switch + India batch I8-I16 closed (PRs #284, #285, #286, #289, #290)

Two operator directives this session:
1. *"USe ChatGPT AI (5.4) API everywhere in the website wherever it is using Claude"* — frontend was hitting "Anthropic credit balance too low" on Deal Analysis.
2. *"Pls continue with next steps, phase, tiers, tasks"* — close out the remaining 9 India localization items (I8-I16).

### Provider switch (Claude → OpenAI)

- **#284 — refactor(ai): switch reasoning + market synthesis from Claude to OpenAI GPT-5.4.** Flipped routing defaults in `providerRegistry.getRoutingConfig`. Rewired the typed `runClaudeReasoning` / `runClaudeReasoningStream` wrappers in `aiRouter.js` to be routing-aware. Added `runOpenAIReasoningStream` to providerRegistry. 11 service-level gate checks flipped from `getProviderAvailability().claude` to `.gpt_compatible`.
- **#285 — fix(ai): default OpenAI model to gpt-4o.** After #284 routed to OpenAI, the deal-analysis panel returned 400 BadRequest because `gpt-5.4` was a placeholder name. Switched code defaults + DB rows to the real `gpt-4o`. Router cache hot-reloaded in 60s, no deploy required.
- **Operator manual action**: added `AI_PROVIDER_REASONING=openai`, `AI_PROVIDER_MARKET_SYNTHESIS=openai`, `OPENAI_MODEL=gpt-4o` to Vercel env vars (belt-and-suspenders; DB wins anyway).

### India localization batch — final 9 items (I8-I16)

- **#286 — PR-I8/I9/I10: BLR Land & Approvals.** Premium FSI / TDR (`PremiumFSICostCr` flows into hardCost) + Title & Khata Status (BLR-specific A vs B + derived multiplier) + 12-row Karnataka approval breakdown (Khata / BDA / BBMP / BWSSB / BESCOM / KSPCB / Airport NOC / Fire / Lift / RERA / OC / CC + derived sum).
- **#289 — PR-I12/I13: Income-asset depth.** Re-opened from original #287 after rebasing to clear section-list conflicts. Hospitality (ADR base + peak + Peak Share + derived Blended ADR / RevPAR / Implied Revenue, only for hospitality) + Retail (Anchor share + anchor/vanilla rents + CAM recovery + derived Blended Rent, only for retail).
- **#290 — PR-I11/I14/I15/I16: Sales mechanics + multi-component assets.** Re-opened from #288. Milestone escalation (residential/villas/mixed_use) + Plot-level absorption (plotted_development) + Mixed-Use Component Breakdown (mixed_use/redevelopment) + Raw-Land Entitlement Pipeline (raw_land). Each section visible only for its target asset class.

### India roadmap status — CLOSED ✅

All 16 items shipped (I1-I7 prior sessions; I8-I16 this session):

| # | Title | PR | Status |
|---|-------|----|----|
| I1 | GST + Stamp Duty + Registration | #271 | ✅ |
| I2 | RERA Escrow 70/30 split | #275 | ✅ |
| I3 | JDA / Revenue / Area-share | #276 | ✅ |
| I4 | Property Tax BBMP UAV | #277 | ✅ |
| I5 | Carpet vs Super-Built-up + Loading | #280 | ✅ |
| I6 | Lender ecosystem | #281 | ✅ |
| I7 | Taxation block | #282 | ✅ |
| I8 | Khata status | #286 | ✅ |
| I9 | Premium FSI / TDR | #286 | ✅ |
| I10 | Approvals & RERA breakdown | #286 | ✅ |
| I11 | Milestone escalation | #290 | ✅ |
| I12 | Hospitality ADR / RevPAR | #289 | ✅ |
| I13 | Retail CAM + anchor split | #289 | ✅ |
| I14 | Plot-level absorption | #290 | ✅ |
| I15 | Mixed-use components | #290 | ✅ |
| I16 | Raw-land entitlement | #290 | ✅ |

### Tests

226 export tests passing at end of session (was 199 at start of evening, +27 across the PRs).

### Production XLSX verified

Downloaded the Jigani Apartments XLSX from production. Confirmed 7 sheets in correct order; Dashboard opens first; Total Revenue ₹637 Cr matches Reports page.

### What's next (out of scope this session)

- Monthly cash flow detail (vs current quarterly) — large refactor
- 2D sensitivity tables beyond the current 5×5
- KPI icon-sets + sparklines
- Premium colour theme refinement
- Wire `KhataExitMultiplier` and `MixUseBlendedRatePerSqft` into Phasing P&L (currently operator pastes derived values into primary inputs)
- Auto-sync `ApprovalsBreakdownSumCr` ↔ `ApprovalCostCr` (currently operator manually reconciles)

---

## 2026-05-11 (late afternoon) — XLSX 7-sheet restructure + India localization I5-I7 (PRs #279, #280, #281, #282)

Operator directive 2026-05-11 (late): *"Dont have so many worksheets. gets confusing. Have maximum 6-7 and dashboard should be first followed by inputs and assumptions and followed by rest. Make it properly structured, organised, well architected and framed."*

Continued the India localization batch with both a structural reorganization (PR-R1) and three new India-context Inputs sections (I5/I6/I7).

### PRs shipped + merged

- **#279 — PR-R1: Consolidate 9 sheets → 7, Dashboard first.** Reordered + physically combined sheets to match the operator directive. New 7-sheet workbook:
  1. **Dashboard** (was position 4 → now position 1)
  2. **Inputs & Assumptions** (was position 1 → now position 2)
  3. **Cash Flow Engine** (NEW combined: was Phasing + Cash Flow as 2 sheets)
  4. **Debt Sizing & Amortization** (NEW combined: was Debt Sizing + Amortization as 2 sheets)
  5. **Sponsor LP Waterfall** (unchanged)
  6. **Unit Mix** (unchanged)
  7. **Calculations** (hidden, unchanged)
  
  Row position shifts: Cash Flow rows moved by `cfOffset` (income +20, dev +26). Amortization rows moved by `amortShift = 30`. Cross-sheet refs `'Phasing & Sales Collection'!` → `'Cash Flow Engine'!`; `'Debt Sizing'!B28` → `'Debt Sizing & Amortization'!B28`. Net +353/-232.

- **#280 — PR-I5: Carpet vs Super-Built-up Area + Loading Factor.** Added `LoadingFactor` (default 1.25) and DERIVED `CarpetAreaSqft` (= SaleableAreaSqft / LoadingFactor) to General Site Information. Existing "Saleable / Leasable Area" relabelled to "Saleable / Leasable Area (Super Built-up)". RERA Section 4(2)(h) compliance — sale-side marketing must be in carpet area. No behaviour change to revenue math. The section writer was extended to apply output styling (locked, paper fill) to derived formula cells.

- **#281 — PR-I6: India Lender Ecosystem — Debt Profile inputs.** Added a "Debt Profile (India Lender Ecosystem)" section with 7 rows: Lender Type, Rate Benchmark (Repo/MCLR/Fixed), Spread bps, Loan Type (Construction/LRD/PF/Mezz), Processing Fee, Prepayment Penalty, and DERIVED Implied All-In Rate. Asset-class-aware defaults — income deals → HDFC Capital / MCLR / LRD; development deals → HDFC Bank / Repo / Project Finance. Informational only; no behaviour change to existing debt math.

- **#282 — PR-I7: Taxation (India) — LTCG / TDS / Indexation inputs.** Added a "Taxation (India)" section at the bottom of Inputs with 5 rows: LTCG Rate (12.5% post-Jul-2024), TDS u/s 194-IA (1%), Indexation Regime (categorical: post_2024_no_indexation default), Effective Holding Period (years), and DERIVED Applicable Capital Gains Rate (branches by hold period — LTCG if ≥ 2 yrs, STCG slab ~30% if < 2). Informational; a future PR can wire EffectiveCGRate into a Dashboard Net-of-Tax IRR row.

### Operational gotchas this session

- **Stacked PR auto-close cascade.** When a PR is merged with `--delete-branch`, any PRs based on it auto-close. PR-I6 had to be rebased onto updated master after PR-I5 merged, and PR-I7 rebased after PR-I6 merged. Each rebase had small test-file end-of-file conflicts (both PRs appended new `describe` blocks).
- **Merge conflict pattern**: both branches appended `describe('PR-IN', ...)` blocks at the same end-of-file location. Resolution: keep both describe blocks, ordered by PR number.

### Tests
**200 export tests green** at end of batch (was 199 before R1+I5+I6+I7; net +1 from row-shift consolidation absorbing 4 tests + 14 new India tests).

### India localization batch progress

| # | Status | Title |
|---|--------|-------|
| I1 | ✅ | GST + Stamp Duty + Registration as real cost lines |
| I2 | ✅ | RERA Escrow 70/30 split |
| I3 | ✅ | JDA / Revenue-Share / Area-Share deal structures |
| I4 | ✅ | Property Tax BBMP UAV method |
| I5 | ✅ | Carpet vs Super-Built-up + Loading Factor |
| I6 | ✅ | India Lender Ecosystem (Debt Profile) |
| I7 | ✅ | Taxation block (LTCG + TDS + Indexation) |
| I8 | 🔴 | Khata status (A/B-khata exit haircut) |
| I9 | 🔴 | Premium FSI / TDR cost line |
| I10 | 🔴 | Approvals & RERA registration breakdown |
| I11 | 🔴 | Milestone-anchored sale-rate escalation |
| I12 | 🔴 | Hospitality ADR/RevPAR with seasonality |
| I13 | 🔴 | Retail CAM + anchor split |
| I14 | 🔴 | Plot-level absorption |
| I15 | 🔴 | Component-level revenue for mixed-use |
| I16 | 🔴 | Raw-land entitlement milestones |

7 of 16 India items done. The structural restructure (R1) is also done.

### Operator verification still pending
Download a fresh `.xlsx` and confirm:
1. 7 tabs total: Dashboard | Inputs & Assumptions | Cash Flow Engine | Debt Sizing & Amortization | Sponsor LP Waterfall | Unit Mix (+ hidden Calculations)
2. Dashboard opens first; Inputs second
3. The new General Site row "Carpet Area (RERA marketing area)" computes correctly
4. The "Debt Profile" + "Taxation (India)" sections render with sensible defaults

---

## 2026-05-11 (afternoon) — India localization batch I1-I4 (PRs #270, #271, #275, #276, #277)

Operator directive ("make sure everything is catered and specific and relevant to the way pro forma or financial modelling is done for different real estate asset classes and deal structure in India") triggered a pivot from the structural institutional-grade arc to **India-specific correctness** for every line item.

### Roadmap pivot (PR #270)
- Dropped US-centric items (Forward SOFR rate curve)
- Added new "India localization batch" section with 16 prioritised gaps (I1-I16)
- Top 4 (I1-I4) shipped same session; I5-I16 documented for next phase

### PRs shipped + merged

- **#271 — PR-I1: GST + Stamp Duty + Registration as REAL cost lines.** Previously decorative inputs that didn't flow into any formula. Now:
  - New "India Statutory Levies" section on Inputs sheet with `StampRegPct` (Karnataka 6.6% default) and `GstPct` (asset-class-aware: residential 5%, commercial 0% net of ITC, plotted 0%)
  - Phasing sheet: 3 new rows (Stamp Duty Q1-only, GST construction-spread, Total Statutory Levies)
  - Calculations Cost Build: Total cost now = Hard + Soft + Statutory (B28, was B25)
  - Debt Sizing + Waterfall Total Project Cost formulas include the levies
  - 7 new tests. Closes biggest correctness hole.

- **#275 — PR-I2: RERA Escrow 70/30 split** (originally #272, re-opened after stack rebase). Indian RERA Act 2016 mandates 70% of customer payments go to escrow. Pre-PR-I2 the model overstated developer cash inflow by ~70%. Now:
  - New `RERAEscrowPct` input (default 0.70)
  - Phasing sheet: 5-row escrow ledger (To Escrow / Free Cash / Drawdown / Balance / Net) between rows 11-15
  - Drawdown matches construction quarter-by-quarter
  - Cash Flow Inflow row now references Net (row 15), not Gross (row 10)
  - 6 new tests + 2 existing tests updated for row shifts

- **#276 — PR-I3: JDA / Revenue-Share / Area-Share deal structures** (originally #273, re-opened). 40-60% of Bengaluru residential is JDA-structured but pre-PR-I3 the model showed developer keeping 100% of revenue. Now:
  - New "Deal Structure" section (development family only) with categorical text + `LandownerSharePct` input
  - Auto-derives structure from kernel `deal.deal_structure` ("jda" / "jv" / "JDA Revenue Share" / "jda area share" / "DM" → mapped labels)
  - Auto-seeds LandownerSharePct from kernel's `jv_split_landowner_pct` when structure is JDA-like
  - Phasing row 15 formula multiplies by `(1 - LandownerSharePct)` — reducing developer's effective inflow
  - 6 new tests

- **#277 — PR-I4: Property Tax BBMP UAV method** (originally #274, re-opened). Pre-PR-I4 used "% of EGR" which is wrong for India. BBMP / BMC / MCGM all use Unit Area Value method (INR/sqft/year × area). Now:
  - `PropertyTaxPct` → `PropertyTaxPerSqftYr` (default ₹40 = mid-range Zone A commercial BLR)
  - Phasing formula: `=-SaleableAreaSqft*PropertyTaxPerSqftYr/4/10000000` (area-driven, not revenue-driven)
  - Same value every quarter (property tax doesn't scale with occupancy)
  - Backward-compat: legacy `propertyTaxPct` heuristically converts (1.5% × ₹1200 typical rent → ~₹18)
  - 5 new tests

### Merge complications
PRs I2/I3/I4 were initially opened as stacked PRs (each based on the previous). When PR-I1 was squash-merged with --delete-branch, GitHub auto-closed PR-I2 because its base branch was gone. Same cascade for I3+I4 after I2 closed.

Resolution: cherry-picked each commit (5315151, 5249827, 4bcdf36) onto fresh `-v2` branches based on current master, opened new PRs (#275, #276, #277), each CI-green and merged in sequence. Final result identical to what stacked merge would have produced — just with new PR numbers in the audit trail.

### Tests
**190 export tests green** at end of batch (was 173 before I1; +17 across the four PRs: 7 + 6 + 6 + 5 minus 7 from row shifts + label updates).

### What's still NOT done — India batch
12 more India-localization items in the roadmap (I5-I16), in priority order:
- I5 Carpet vs Super-Built-up + Loading Factor (RERA marketing compliance)
- I6 Lender ecosystem (SBI / HDFC / ICICI / Edelweiss; Repo + spread / MCLR)
- I7 Taxation block (LTCG 12.5%, TDS 1%, Net-of-Tax IRR)
- I10 Approvals & RERA registration breakdown (Khata / BDA / BBMP / BWSSB / etc.)
- I8 Khata status (A / B-khata exit haircut)
- I12 Hospitality ADR / Occupancy / RevPAR with seasonality
- I13 Retail CAM + anchor-vs-vanilla rent split
- I9 Premium FSI / TDR cost line
- I11 Milestone-anchored sale-rate escalation
- I14 Plot-level absorption
- I15 Component-level revenue for mixed-use
- I16 Raw-land entitlement milestones

---

## 2026-05-11 (overnight) — Institutional-grade rebuild arc, FINAL BATCH (PRs #267, #268, #269)

The closing batch of the 7-PR institutional-grade XLSX rebuild arc. All three structural PRs (PR-B, PR-D, PR-E) shipped sequentially with full test coverage.

### PRs shipped

- **#267 — PR-B: Permanent Debt Sizing sheet.** New 'Debt Sizing' sheet computing lender-approved permanent loan as **MIN of four sub-limits** matching the reference templates (RE-540 "Permanent Debt Calculation"):
  - LTC (Loan-to-Cost) — construction stage
  - LTV (Loan-to-Value) — permanent stage on stabilised value
  - DCR (Debt Coverage Ratio) — NOI ÷ DCR ÷ annual PMT factor
  - DY (Debt Yield) — NOI ÷ minimum yield
  
  Asset-class branching: income family uses MIN of all four with stabilised NOI (from kernel `stabilized_noi_cr` → `noi_cr` → modeled Phasing!N18×4 fallback); development family uses LTC only (LTV/DCR/DY render "—" with notes). 4 new named ranges: PermMaxLTV, PermMinDCR, PermMinDY, ConstrMaxLTC. Amortization Schedule's Loan Amount now references `'Debt Sizing'!B28` instead of legacy `DebtLTV × Total Cost`. Net +260/-15, 173 tests.

- **#268 — PR-D: Sponsor / LP Waterfall sheet.** New 'Sponsor LP Waterfall' sheet with 3-tier pour-over (NAIOP "Waterfall - IRR Hurdles" + RE-540 "Waterfall" pattern). Sections:
  1. **Capital Stack** — Total Cost / Loan / Equity / LP-vs-GP split
  2. **Proceeds & Pref Accrual** — Project Hold Period, Total Cash, LP Pref Accrual (compounded), Tier 1 LP Distribution = MIN(proceeds, capital + pref), Residual
  3. **Promote Split** — Residual × PromoteLPPct (default 80%) + PromoteGPPct (default 20%), GP Return of Capital, GP Net Promote
  4. **Final Investor Returns** — LP Total + GP Total + Equity Multiples + Annualised IRRs (single-exit approximation)
  
  5 new named ranges: LPEquityPct, GPEquityPct, PrefReturnRate, PromoteLPPct, PromoteGPPct. Net +220/-10, 175 tests.

- **#269 — PR-E: Unit Mix sheet.** New 'Unit Mix' sheet with asset-class-aware unit-by-unit breakdown (RE-540 Assumptions rows 14-31 / NAIOP "Unit Mix" pattern):
  - residential_apartments / villas → unit types (Studio / 1-4 BHK or villa types) × Count × SF × Sell Rate
  - hospitality → 4 key types × Keys × SF × ADR (revenue = ADR × 365 × 65% occupancy)
  - plotted_development → 4 plot sizes × Count × SF × Sell Rate
  - commercial_office / retail / industrial_warehousing → 3 floor types per class × Bays × SF × Monthly Rent × 12
  - mixed_use / redevelopment / raw_land → empty-state note (multi-component or area-driven, doesn't fit unit table)
  
  Per-row Total SF + Total Revenue (asset-class-specific formula). Total row at bottom. Summary block comparing Unit-Mix total vs Inputs SaleableAreaSqft. Worksheet-only (NOT flow-through — operator plans here, manually updates Inputs). Net +200/-10, 179 tests.

### Tests
**179 export tests green** at end of arc (was 170 at start of arc, +9 across PR-B/D/E: 3 Debt Sizing + 2 Waterfall + 4 Unit Mix).

### Total XLSX workbook structure after the 7-PR arc

8 visible sheets + 1 hidden audit trail:
1. **Inputs & Assumptions** — all editable yellow input cells with named ranges (now 30+ named ranges including the new Permanent Debt Sizing + Waterfall sections)
2. **Phasing & Sales Collection** — quarterly construction + sales schedule (asset-class-aware: dev gets sales, income gets PGI/EGR/NOI). Now includes 7 detailed soft cost rows from PR-A.
3. **Quarterly Cash Flow & Debt** — quarterly net CF + debt service
4. **Dashboard** — kernel-reconciled headlines + 3 native charts (doughnut Uses + combo Trend + tornado Driver Impact)
5. **Debt Sizing** (NEW PR-B) — LTC / LTV / DCR / DY sub-limits → MIN
6. **Amortization Schedule** — quarter-by-quarter loan amort, now drives off Debt Sizing!B28
7. **Sponsor LP Waterfall** (NEW PR-D) — 3-tier pour-over, LP/GP IRRs
8. **Unit Mix** (NEW PR-E) — asset-class-aware unit breakdown
9. **Calculations** (hidden) — full audit trail of Revenue Build + Cost Build (14 rows now) + Debt Sculpting

### Roadmap status
26 gaps identified initially; the 7-PR arc closed the highest-priority ~10. The remaining 16 are lower-priority polish / specialised use cases (monthly CF detail, NNN lease modelling, multi-2D sensitivity, asset-class deep dives like ADR/RevPAR for hospitality, etc.). The workbook is now investor-grade for the core institutional case.

### Operator verification still pending
Download a fresh `.xlsx` and verify all 8 visible sheets + hidden Calculations sheet render correctly. The Dashboard headlines should still match the Reports page (kernel reconciliation from PR #259). New sheets: Debt Sizing, Sponsor LP Waterfall, Unit Mix all carry live formulas that recalculate when Inputs cells change.

---

## 2026-05-11 (very late) — Institutional-grade rebuild arc, batch 2 (PR #265 — tornado)

Continuing the institutional-grade XLSX rebuild. Single PR this batch: tornado chart on the Dashboard.

### PR shipped

- **#265 — PR-G: Tornado chart on Dashboard.** Office's tornado pattern = horizontal clustered-bar with `<c:overlap val="100"/>` and two oppositely-signed series. chartInjector extended with new `buildTornadoChartXml` builder. Two driver rows on the Dashboard at H24:M26 feed the chart:
  - **Selling Rate ±10%** — Low Δ = `=B27-D27`, High Δ = `=F27-D27`
  - **Construction Cost ±10%** — Low Δ = `=D29-D27` (worst case), High Δ = `=D25-D27` (best case)
  
  Both rows reference the existing 5×5 sensitivity grid (B25:F29). Recalc is live — edit any sensitivity-affecting input (SellRate, EscalationPct, ConstructionCostPerSqft, LandCostCr) and BOTH the heatmap AND the tornado update together.
  
  Chart anchored at cols N-T (13-19), rows 28-35 — right of the sensitivity heatmap so the analyst sees both visualisations in the same eye span. Net diff +220/-10, 170 tests passing.

### Why this batch was just one PR

PR-G was the last additive (non-restructuring) gap from the roadmap. The remaining three gaps — PR-B (construction vs permanent loan), PR-D (sponsor/LP waterfall), PR-E (unit mix) — each involve either a new sheet with substantial logic OR restructuring the existing Cash Flow row positions. Each warrants its own focused session with operator verification between them, not rapid-fire concurrent shipping.

### Status after batch 2

| PR | Theme | Status |
|---|---|---|
| PR-A #261 | Detailed soft cost breakdown | ✅ |
| PR-B | Construction vs Permanent loan (MIN of LTV/DCR/DY) | Open — biggest remaining depth |
| PR-C #263 | Amortization Schedule sheet | ✅ |
| PR-D | Sponsor / LP waterfall | Open |
| PR-E | Unit mix table | Open |
| PR-F #262 | Combo chart on Quarterly Trend | ✅ |
| PR-G #265 | Tornado on Dashboard | ✅ |

4 of 7 PRs in the rebuild arc shipped. The remaining 3 are the structural / restructuring ones.

### Operator verification still pending
Download a fresh `.xlsx` for any deal and verify:
1. Dashboard → right of the Sensitivity heatmap (cols H-M, rows 23-27) shows the new "Driver Impact on Project Margin (tornado)" data table
2. Below that, anchored at cols N-T, rows 28+, is the native tornado chart with red+green horizontal bars centred on 0 = base margin
3. The tornado recalculates when you edit any input that affects margin (sell rate, escalation, construction cost, land cost, etc.)

---

## 2026-05-11 (late night) — Institutional-grade rebuild arc, batch 1 (PRs #261, #262, #263)

Continuing from the roadmap doc (PR #260) that mapped 26 gaps vs the operator's reference pro formas (NAIOP, RE-540, RE-508). Operator authorised "do whatever goes well together" — three independent additive PRs shipped + deployed this batch:

### PRs shipped

- **#261 — PR-A: Detailed soft cost breakdown.** Inputs sheet gets a new "Detailed Soft Costs (institutional breakdown)" section with 6 named-range inputs: ArchitectFeePct, LegalFeePct, AppraisalFeePct, InsuranceConstPct, PropTaxConstPct, DeveloperOverheadPct. Defaults calibrated to Anarock / JLL Bengaluru benchmarks. Phasing sheet gets 7 new schedule rows (13-19) phasing each line item per industry convention (A&E Q1-Q4, Legal Q1-Q2, Appraisal Q1, Insurance + Property Taxes spread across construction quarters, Developer Overhead spread evenly). Calculations Cost Build expanded from 8 to 14 rows showing full institutional breakdown. Debt Sculpting block formulas updated to reference new Total at R25. +200/-25, 166 tests.

- **#262 — PR-F: Combo chart on Quarterly Trend.** chartInjector extended with new `buildComboChartXml(spec)` builder. Office's combo pattern: barChart + lineChart in one plotArea, sharing cat axis, line on secondary value axis (right side via `crosses="max"`). Dashboard's Quarterly Trend chart was a clustered-column; now shows period-contribution columns PLUS copper cumulative line. Asset-class-aware (dev: Sales+Construction+Cumulative; income: PGI+NOI+CF After Debt). +138/-23, 167 tests.

- **#263 — PR-C: Standalone Amortization Schedule sheet.** New visible sheet between Dashboard and (hidden) Calculations. Loan Terms summary block at top (Loan Amount = Total Cost × DebtLTV, Annual Rate, Term, Quarterly Periods, Effective Quarterly Rate, Quarterly Payment via PMT). 80-row amortization table with Beg Bal / Payment / Interest / Principal / End Bal. Alternate-row banding. Every formula references named ranges from Inputs sheet — full live recalc. Limitations footer calls out single-loan model (improves once PR-B ships construction-vs-permanent split) + moratorium not yet modelled. +160/-3, 168 tests.

### Tests
168 export tests green at end of batch (was 163 at start, +5: 3 soft cost + 1 combo chart + 1 amortization schedule regression tests).

### Roadmap doc updated
`docs/XLSX_INSTITUTIONAL_GRADE_ROADMAP.md` table updated to mark PR-A, PR-F, PR-C as ✅ shipped. Remaining open PRs in the arc:
- **PR-B**: Construction loan (LTC) vs Permanent loan (MIN of LTV/DCR/DY) — biggest remaining depth gap
- **PR-D**: Sponsor / LP waterfall (4-tier pour-over: pref → return of capital → catch-up → promote)
- **PR-G**: Tornado chart on Dashboard (visual parity with PPTX/DOCX)
- **PR-E**: Unit mix table (residential / hospitality)

### Why this set went well together
All three PRs are ADDITIVE — no existing formulas restructured, no row positions shifted on the Cash Flow sheet (which IRR / NPV / Dashboard references depend on), no risk to the kernel-reconciliation precondition shipped in #259. Each PR is independently verifiable:
- Soft costs (PR-A) visible as new Inputs rows + Phasing schedule + Calculations expansion
- Combo chart (PR-F) visible on Dashboard
- Amortization (PR-C) visible as a new tab

### Operator verification still pending
Download a fresh `.xlsx` for any deal and verify:
1. Inputs sheet has the new "Detailed Soft Costs" section with 6 yellow-cell inputs
2. Phasing sheet has 7 new soft cost rows (13-19) phasing each line item
3. Dashboard → Quarterly Trend chart now shows the copper cumulative LINE overlaid on the bar columns
4. New 'Amortization Schedule' tab between Dashboard and (hidden) Calculations
5. Calculations sheet → Cost Build block shows full 14-row breakdown with detailed soft cost line items

---

## 2026-05-11 (night) — Kernel reconciliation + institutional-grade rebuild roadmap (PR #259 + roadmap doc)

Operator shared the Reports-page screenshot showing **Jigani IRR 13.6%** on the frontend, then five reference institutional pro formas (NAIOP, RE-540, RE-508 + their own 10-template benchmark pack) and a brutal roast: "This is fucking basic. Forget all rules. Best pro forma possible."

Verified the critical issue first: the Reports page IRR (13.6%, kernel-stored on the deal record) didn't match what the XLSX would produce (different formula recompute). Per CLAUDE.md the deterministic financial kernel is the single source of numerics; the XLSX was operating as a SEPARATE model — headlines didn't reconcile across surfaces. Credibility-destroying regardless of polish.

### PR shipped

- **#259** Dashboard KPI tiles now use kernel-stored values from the deal record when populated. New `ctx.kernelKpis` block pulls IRR, NPV, EM, gross margin, total revenue, total cost, yield-on-cost, NOI, exit value, RLV. At write time: kernel populated → literal; kernel null → formula fallback. Returns block split into two rows: row 20 "Project IRR (kernel)" with the literal authoritative value matching the Reports page, row 21 "Project IRR (modeled)" with the live formula recompute (responds to Inputs edits). Row 22 footnote disclosure of the distinction. Net diff +120/-25, 163 export tests passing.

### Roadmap doc

Spent meaningful time reading three reference pro formas:
- **NAIOP** (2 MB, 16 sheets, Excel Solver-based, sponsor/LP waterfall, monthly + annual CF)
- **RE-540** (Scenario Summary / Permanent Debt MIN(LTV, DCR, DY) / Construction & Lease Up monthly draws / Waterfall)
- **RE-508** (3-sheet multi-project monthly CF + reversion modelling)

Captured 26 specific gaps vs current REDIP generator in `docs/XLSX_INSTITUTIONAL_GRADE_ROADMAP.md`. Top-tier institutional depth requires multi-PR work:
- PR-A: Detailed soft cost breakdown (A&E + Legal + Appraisal + Marketing + Insurance during Construction + Property Taxes during Construction + Developer Overhead + Contingency — 8 line items instead of current 2)
- PR-B: Construction loan vs Permanent loan (Permanent loan sized as MIN of LTV / DCR / Debt-Yield sub-limits)
- PR-C: Amortization schedule sheet
- PR-D: Sponsor / LP waterfall (pref + return of capital + catch-up + promote at 8/12/15% IRR hurdles)
- PR-E: Unit mix table (residential / hospitality only)
- PR-F: Combo chart (column + line cumulative on secondary axis) — extend chartInjector
- PR-G: Tornado on Dashboard (embedded image since no native tornado type)

Asset-class specific gaps: ADR/Occupancy/RevPAR for hospitality, CAM reconciliation for retail, entitlement milestones for raw land, component-level revenue for mixed-use.

### Stopped here for direction

The kernel-reconciliation fix is the credibility precondition — without it the rest of the polish was being applied to mismatched headlines. Now that the foundation is set, asking the operator which gap matters most for their target buyer persona before committing to PR-A vs PR-B vs PR-D sequentially. Each is independent and could ship in any order.

### Honest framing for the operator

The roast set a high bar ("Blackstone / CBRE / JLL / Brookfield analyst won't rebuild from scratch"). Closing the gap to that bar is multi-week work, not multi-PR-in-one-session work. Realistic interim target: close gaps #1 (soft costs) + #2 (loan split) + #4 (waterfall) + #5 (unit mix) over a focused arc — that's the institutional-core-four. Beyond that, asymptotic returns: gaps #10-#26 progressively matter less.

REDIP's value is *deterministic, audit-trail-able pro forma generation* — it saves the analyst skeleton-building hours, doesn't replace their underwriting judgement. Set buyer expectations accordingly.

---

## 2026-05-11 (evening) — XLSX model bug fixes from second Jigani roast (PRs #256–#257)

Operator shared a fresh Jigani Apartments download (post-PR #254 deploy) + a brutal roast citing specific numerical inconsistencies. Verified every claim against the actual file:

| Roast claim | Verdict |
|---|---|
| Dashboard Revenue 593 ≠ Calculations Revenue 648 | ✅ Real — two methodologies. Fixed in #256 |
| Cumulative construction cost = 3,198 Cr (actual ~266 Cr) | ✅ Real — Total column SUM-ed already-cumulative cells. Fixed in #256 |
| IRR -15% despite positive net CF + 30% gross margin | ✅ Real — front-loaded-positive CF profile from same-quarter collection. Fixed in #257 |
| Cash Flow has empty interest, zero principal | ✅ Symptom — debt never drawn because Q1-Q5 were positive. Fixed by #257 (CF profile is now conventional) |
| No charts on Dashboard | ❌ Outdated — file pre-dated PR #254 (16:00 deploy) |

### PRs shipped

- **#256** Two surgical fixes in `buildWorkbook.js`:
  1. Cumulative rows (Phasing rows 7, 12, and income-family row 21) now write `={lastQuarter}{row}` into the Total column instead of `=SUM(B:Y)`. Per-quarter rows still SUM. New `totalKind: 'final'` flag.
  2. Calculations sheet's Total revenue + Customer collected now reference the SAME Phasing Total column as the Dashboard. Both sheets read 593 Cr, not 648 vs 593. Column letter derived dynamically from `ctx.totalQuarters` via a local `colLetterLocal` helper.
- **#257** Customer collection formula switched from `=Sales(q) × CollectionPct` (same-quarter) to construction-progress-linked:
  ```
  collection_q = totalContractedSales × CollectionPct × constructionThisQuarter / totalConstruction
  ```
  Excel: `=IFERROR(SUM($B$9:$Y$9)*CollectionPct*F6/SUM($B$6:$Y$6),0)`. Each quarter's collection mirrors construction progress. CF profile flips from front-loaded-positive to conventional negative-early/positive-sustained. Jigani IRR: **-15% → +47%** annualized. Cumulative net unchanged (still +137 Cr) — only timing differs.

### Tests
161 export tests passing (was 158 before this batch, +3 regression: cumulative-row Total + revenue reconciliation + collection-formula shape).

### Deferred (acknowledged in PR bodies)
- **Sales velocity defaults** — 20%/quarter produces a 5-quarter sellout, aggressive for Indian residential (typical absorption 18-24 months = 6-8 quarters). Operator can adjust the input; defaults are a separate concern.
- **Marketing & Finance soft-cost timing in Cash Flow row 730** — currently `sales × (MarketingCostPct + FinanceCostPct)`. Marketing-as-sales is correct (brokerage on closing); finance-as-sales is approximate (actual debt interest is computed separately in row 10). Won't affect IRR materially; revisit if operator wants it cleaned up.
- **Multi-driver tornado / sensitivity tornado in XLSX** — PR #251 added it to PPTX, PR #252 to DOCX. XLSX chart-injector now exists (PR #254) and could be extended to support tornado/combo via shape primitives or stacked-bar.

### Operator verification still pending
This is the second iteration on the Jigani export. Operator should download a fresh `.xlsx` and confirm:
1. Dashboard "Project IRR (modeled)" is now POSITIVE
2. Phasing → Total column → "Cumulative construction cost" reads ~266 Cr (not 3,198 Cr)
3. Right-click any tab → Unhide → Calculations → "Total revenue" matches the Dashboard headline exactly
4. Cash Flow row 8 (Project net cash flow) shows negative early quarters then positive (was the reverse)

---

## 2026-05-11 (afternoon) — XLSX native chart objects (PR #254)

Operator shared a 10-XLSX template pack ("REDIP_India_Template_*.xlsx", openpyxl-generated) and a Grok roast comparing the templates to JLL/CBRE/Blackstone-grade deliverables. Verified the roast against the actual templates — most of the roast's complaints (no palette, no data bars, sensitivity raw grid, Calculations sheet missing) are wrong about our current generator. The ONE legitimate gap: **no native chart objects** on the XLSX Dashboard. The templates have native chart objects; ours had zero.

Root cause: ExcelJS 4.4.0 has no `addChart` API. Verified empirically — `addChart` is undefined on worksheet instances; no chart-xform module in the library source. The previous `sheet.addChart(...)` call wrapped in a silently-failing try/catch was dead code.

### PR shipped
- **#254** New `backend/src/services/exports/xlsx/v2/chartInjector.js` (~260 LOC). Post-write XML injector: takes the buffer ExcelJS just wrote + chart specs, unzips via JSZip, splices in chart XML files + drawing XML + drawing rels + worksheet drawing reference + [Content_Types].xml additions. Mirrors the openpyxl reference templates exactly (same element order, same namespaces) so files open without the "Excel found a problem with formulas" repair dialog. Two chart types in v1: doughnut + clustered-column/horizontal bar. Wired into `buildDealWorkbookV2` with try/catch fallback (if injection ever fails, operator still gets un-enhanced workbook rather than an error).

  Two charts auto-render on every workbook:
  1. **Uses Breakdown doughnut** at Dashboard!H11 — three slices for Land / Construction / Approvals in palette colours
  2. **Quarterly Trend clustered-column** below the trend table — asset-class-aware:
       - Development family → Sales (emerald) + Construction (red)
       - Income family → PGI (navy) + NOI (emerald)

### Tests
158 export tests passing (was 146, +12: 9 chartInjector unit tests + 3 buildWorkbook integration tests).

### Operator verification needed
The XML injection is novel work — Excel is the strictest validator. Local roundtrip via ExcelJS succeeds and the XML mirrors the openpyxl template structure, but real Excel hasn't been tested. Operator: open the next downloaded `.xlsx` for any deal. Dashboard sheet should show:
1. Doughnut chart top-right (Uses breakdown)
2. Clustered-column chart below the Quarterly Trend table

Both should recalc when an Inputs-sheet cell changes (try editing `SellRatePerSqft` — column heights move). If Excel pops a repair dialog or the charts are missing, share a screenshot and I'll fix the XML structure.

### Out of scope (deferred to follow-up PRs)
- **Combo chart** (column + line, cumulative on secondary axis) for Quarterly Trend. PPTX has this via pptxgenjs. XLSX combo needs lineChart + barChart sharing axes — extends chartInjector cleanly, separate PR.
- **Sensitivity bar / tornado in XLSX Dashboard**. Currently a conditional-format heatmap grid. Tornado is in PPTX (#251) + DOCX (#252).
- **Sparklines** in KPI cells. ExcelJS support is limited; could pursue via XML injection.
- **Icon-set conditional formatting** on KPI tiles (↑↓ arrows for IRR/NPV vs benchmark).

---

## 2026-05-11 — Operator's brutal-roast batch: bug fixes + chart density across PPTX / XLSX / DOCX (PRs #248–#252)

Operator downloaded the Jigani Apartments sample exports (XLSX + PPTX) and posted a long roast comparing them to CBRE / JLL / Blackstone-grade deliverables. Took it as a verification exercise — opened both files, separated real bugs from polish wishlist, shipped five themed PRs sequentially.

### PRs shipped
- **#248** _Fix_: XLSX Calculations sheet had eight off-by-one row references creating circular formulas (e.g. `Hard cost subtotal = B13+B14+B15` self-referencing B15). Excel popped a circular-reference warning on every file open and zeroed every cost figure. Plus: `formatRate(0)` was emitting "INR 0 / sqft" on the Asset Snapshot slide when the deal had no circle rate — now falls through to "–". Regression test locks the eight cell formulas in.
- **#249** _Feat_: PPTX slide 16 (Cash Flow & Sensitivity) upgraded from single-series net-cf bar to a **combo chart** (column for period net + line for cumulative on a secondary axis, asset-class-aware title). Slide 17 (Transaction Summary) got a **capital stack horizontal bar** with proportional debt/equity segments + inline percent labels + INR Cr legend.
- **#250** _Fix_: XLSX percent normalisation. Kernel stores some percentages as integer (5 for 5%) and others as decimal (0.05). Excel's `0.0%` format multiplies by 100 for display, so integer-stored values rendered as 500% AND every formula like `=Revenue * MarketingCostPct` produced 5× revenue. New `toPctDecimal()` helper applied to 24 percent inputs; defaults already-decimal pass through unchanged.
- **#251** _Feat_: PPTX slide 16's 5×5 sensitivity heatmap table replaced with a **driver-impact tornado** built from shape primitives. Slide 9's bar chart replaced with a **rate-vs-distance scatter** when comps have `distance_km` populated (with the deal's modeled rate at distance = 0 for anchoring).
- **#252** _Feat_: DOCX gets analytical visuals. New `chartSvg.service.js` (pure-JS SVG renderer, no native deps) supplies three charts now embedded in the DOCX Financials section: **capital stack donut** + **quarterly cash flow trend** (period bars + cumulative line) + **sensitivity tornado**. All ImageRun embeds with 1×1 PNG fallback.

### Tests
146 export tests green (was 132 at start of batch): +1 Calculations regression (#248), +2 combo + capital stack tests (#249), +1 percent-normalisation regression (#250), +2 tornado + scatter tests (#251), +14 DOCX chart embeds + chartSvg unit tests (#252).

### Investigated + deferred
- **Kernel-side percent fix** (`packages/financial-kernel/`). Audited — kernel uses MIXED conventions per-input (most fields integer-form with internal `/100`; a few decimal-form used raw). A blanket normalizer would break legitimate decimal-form inputs like `constLoanLTC = 0.55`. Safe fix requires per-field convention audit + stored-deal data migration + frontend coordination. The export-write-layer fix in PR #250 covers the surfaced Excel symptom; upstream cleanup deferred to a dedicated focused effort.
- **XLSX Dashboard chart objects**: ExcelJS 4.4.0 has no `addChart` API (confirmed `addChart` is undefined). Library swap (xlsx-js-style / node-xlsx — both build on SheetJS, neither writes native charts in the free version). The pure-SVG path that works for PPTX + DOCX doesn't work for XLSX because ExcelJS `addImage` doesn't accept SVG. Adding raster conversion would require `canvas` / `sharp` / `resvg-js` — explicitly avoided per project policy ("kept Vercel cold start fast"). Re-open if operator decides to take the cold-start hit.
- **Multi-driver tornado** (occupancy, debt rate, escalation, exit cap): 2-driver tornado (selling rate + construction cost) ships in #251 + #252 using the existing 2D sensitivity matrix. Going beyond 2 drivers needs the kernel to emit per-driver 1D curves.

### Operator manual actions outstanding
- Apply migration `database/migrations/20260527_export_events.sql` via Supabase SQL Editor (export-events audit ledger — exports work without it).
- Optional: `DOCX_REPORT_ENABLED=1` to expose the DOCX underwriting report to non-admin users.

### Honest framing for the operator
Roast called for CBRE / JLL / Blackstone-grade outputs. The hard correctness bugs (circular references, percent normalisation, missing-data zeros) are fixed and won't recur. The visual depth gaps the roast called out — tornado, capital stack visual, scatter, cash-flow combo — are now native chart objects in PPTX and SVG embeds in DOCX. XLSX Dashboard remains text-and-data-bar-heavy because the library doesn't support live chart objects; the analytical depth there is in the Calculations sheet + named ranges + conditional formatting, not chart visuals.

---

## 2026-05-10 (late late session) — XLSX restructure for income assets (PRs #244–#247)

Continuation of the same long day. Operator pushed back hard on the v2 workbook ("ugly, incompetent, no PGI / EGR / OpEx / NOI / CapEx / Debt Service / NPV") — fair criticism, the v2 was development-focused even for income deals. Three more PRs land tonight.

### PRs shipped
- **#244** docs handoff for the earlier batch (#237–#243).
- **#245** Asset-class-aware operating P&L — income deals (commercial_office / retail / industrial_warehousing / hospitality) now get a full PGI → Vacancy → EGR → OpEx breakdown (Property Tax / Insurance / Mgmt / Utilities / Maintenance) → NOI → CapEx Reserves → Cash Flow Before Debt → Debt Service (Interest / Principal sculpted to LoanTerm) → Cash Flow After Debt → DSCR → Reversion (NOI × 4 / ExitCapRate × (1−SellingCostPct)). Inputs sheet gets two new dedicated income-asset sections (Operating Revenue, Operating Expenses). Dashboard KPI tiles flip per family (Income: Stabilised NOI / Modeled Cap Rate / Exit Cap Rate / Min DSCR / Cash-on-Cash Y1 / Net Sale Proceeds; Development: existing tiles). **Sheet protection removed across all 5 sheets** — the popup ("trying to change is on a protected sheet") was hostile.
- **#246** Dashboard layout restructure — wider 14-column grid; asset-aware subtitle ("Operating Asset Dashboard" vs "Development Project Dashboard"); IRR / NPV / Equity Multiple cash-flow row fixed (was hardcoded to row 8 / Project Net CF for development; now uses row 11 / Total CF Including Reversion for income — was producing wrong values for commercial / retail / hospitality / industrial deals). New "Quarterly Operating Trend" table with conditional-format **data bars** (palette navy / copper / emerald / muted) — inline bar charts per cell that resize live with input changes. Asset-aware columns: Income shows PGI / EGR / NOI / CF After Debt; Development shows Sales / Construction / Net CF / Cumulative.
- **#247** JV / JDA profit waterfall — for deals with `deal_structure = jv / jda / da`, Dashboard now renders a Total Project Profit → Developer Share → Landowner Share waterfall block keyed off the JVDevPct / JVLandPct named ranges. Hidden for outright deals.

### Honest framing
- Excel chart polish is inherently weaker than PowerPoint. Tried ExcelJS chart objects, they're patchy across renderers / consumer Excel versions. Used **conditional-format data bars** instead for the Quarterly Trend (rock-solid, render identically everywhere, resize live). Sources & Uses doughnut + colour-scale heatmap remain as native chart objects.
- Reference image the operator shared was a PowerPoint dashboard with custom infographics. The XLSX is the working analyst model — it now has the right financial-modeling depth (PGI / EGR / OpEx / NOI / CapEx / Debt Service / Reversion / IRR / NPV / Sensitivity / Scenarios / JV waterfall / Audit-trail Calculations sheet) but is constrained to Excel-native primitives for visuals.

### Tests
1,348 backend tests passing (17 XLSX v2 tests, 4 new this batch).

### Operator manual actions outstanding
- Apply migration `database/migrations/20260527_export_events.sql` (export-events audit ledger — exports work without it but rows aren't logged).
- Optional: `DOCX_REPORT_ENABLED=1` to expose DOCX to non-admin users.

---

## 2026-05-10 (late session) — Exports rebuild finishes feature-complete (PRs #237–#243)

Continuation of the investor-grade exports rebuild. Picks up after PRs #225–#236 closed out earlier in the day. Seven more PRs land tonight, taking PPTX, XLSX, and DOCX to feature-complete state matching (and exceeding) the original brief.

### PRs shipped

- **#237** Mapbox → Google Maps Static API swap (operator request — `GOOGLE_MAPS_API_KEY` already set in Vercel; Maps Static API enabled in Google Cloud) + Investment Highlights density pass with numbered copper badges + Thesis Bottom Line strip (IRR/EM, Readiness, Recommendation tiles).
- **#238** Cash Flow & Sensitivity scenario tiles (Bull/Base/Bear) + **asset-class precedence fix** — root cause of why a "Commercial Retail" deal was rendering as residential everywhere. `inferAssetClass` now prefers descriptive deal names over a stale `asset_class = residential_apartments` default, with parameterised tests covering 8 asset classes.
- **#239** Drop zero-padded "01/02/03/04" everywhere — PowerPoint was wrapping the small badges vertically as stacked digits. Plain "1, 2, 3, 4" now reads cleanly.
- **#240** Density passes on three remaining text-heavy slides: Asset Snapshot (area-composition stacked bar — Land / Built / Saleable), Transaction Summary (6-step deal life-cycle path — Sourcing → Diligence → Underwriting → IC Review → Negotiation → Close, current stage highlighted), Structure & Counterparty (capital-structure visualisation — JV split bar OR outright pricing breakdown with Karnataka stamp duty + registration estimates).
- **#241** Three coherent finishing touches: new **Key Assumptions & Sources** appendix slide (18-row two-column table listing every input with explicit source attribution — "Deal record", "Underwriting input", "Property record", "Financial kernel", "Document extraction", "Platform default"); Readiness slide density pass (4-track horizontal progress visualisation: Overall / Diligence / Approvals / Documents); Disclaimer slide rebuild (was a near-empty card; now full editorial layout with AI-Assisted vs Platform Data badge cards + Hard Rules section + confidentiality language).
- **#242** XLSX v2 phase 2 — finishes the workbook to feature-complete: hidden **Calculations** sheet with revenue/cost/debt/returns audit blocks (right-click any tab → Unhide → Calculations); native Excel **IRR / NPV** functions on Dashboard; 5×5 **sensitivity heatmap** with 3-point color scale (red < 0% → amber → emerald > 30%); Bull/Base/Bear **scenario strip** with margin% and profit Cr per scenario. **v2 is now the default download** — operators get the new workbook without `?v=2`. v1 (legacy 13-sheet) still accessible via `?v=1` or `XLSX_V1_FORCE=1`.
- **#243** DOCX phase 2 — six new sections inserted between Overview and Comparables for IC-report flow: **Demographics** (population / density / age / income from `market.demographics`), **Why This Area** (AI-synthesised via `generateSection({section: 'whyThisArea'})` — already wired in narrative service, just not previously called from DOCX), **Job Growth & Micro-Market** (filters `intelligence_briefs` for job/employment/GCC/tech themes), **Social Infrastructure** (8-bucket proximity table from `infra_proximity`), **Supply & Demand Pipeline** (recent transactions + verified benchmark tables), **Better Alternatives** (top 3 verified comps ranked by rate/sqft proximity to the deal's modeled selling rate, with Δ-vs-deal %). Every section has an honest "Manual input required" empty-state — no fabrication.

### Cross-cutting fixes during this session

- **Cover artwork SVG → native shapes** (PR #236, earlier in day) — fixed PowerPoint's "found a problem with content" recovery dialog. Cover art now uses pptxgenjs primitives (rect, ellipse, triangle, line, text) per asset class. Each cover is editable in PowerPoint.
- **Mapbox 422** root-caused as long-string marker label; sanitisation drops anything that isn't a single alphanumeric or Maki icon name.
- **English-only guardrail** still rejects non-Latin scripts before any AI content reaches an export.

### Tests + build

- Backend: 96 suites, **1,342 tests passing** (+98 across the full session day, up from 1,198 at session start).
- Frontend: untouched.
- All 19+ PRs squash-merged with admin override after CI passed.

### Operator manual actions outstanding

- [ ] Apply migration `database/migrations/20260527_export_events.sql` via Supabase SQL Editor (audit ledger — exports work without it but rows aren't logged).
- [x] `GOOGLE_MAPS_API_KEY` set in Vercel + Maps Static API enabled in Google Cloud (confirmed via screenshot 2026-05-10).
- [x] XLSX v2 is now the default — no `?v=2` needed.
- [ ] Optionally set `DOCX_REPORT_ENABLED=1` to expose the DOCX underwriting report to non-admin users.

### Plain-English recap (for the user)

- **PowerPoint deck** — fully polished. Asset-class-specific cover artwork using native shapes (residential = skyline, commercial = glass tower, industrial = warehouse with truck, hospitality = hotel with portico, etc.). Every slide has informational density — no more empty bottom strips. New Key Assumptions appendix lets reviewers audit every number's source. Disclaimer slide is now actually a disclaimer.
- **Excel workbook** — feature-complete v2 is the default. 4 visible sheets + 1 hidden Calculations sheet for power users. Live IRR / NPV / Equity Multiple via Excel functions. Sensitivity heatmap and Bull/Base/Bear scenario strip on the Dashboard.
- **Word underwriting report** — 14 sections including all 6 phase-2 additions. Demographics, Why-this-area (AI-synthesised), Job Growth, Social Infrastructure, Supply & Demand, Better Alternatives. Every section either renders real data or shows "Manual input required" — no fabrication.
- **Consistency across all exports** — a "Commercial Retail" deal now correctly shows retail artwork, retail KPIs, retail benchmarks everywhere. A "Whitefield Office Tower" deal shows commercial-office. The asset-class precedence fix flows through every code path that reads `inferAssetClass`.

### What's left (intentionally deferred)

- Paywall scaffold + Razorpay/Stripe — free for BETA per operator.
- DOCX cover artwork as native shapes — `docx` library lacks the same shape primitives as pptxgenjs.

---

## 2026-05-10 — Investor-Grade Exports Rebuild (5 PRs)

End-to-end overhaul of the export pipeline. PPTX, XLSX, DOCX all upgraded; pricing model documented; all behind English-only and "no AI numbers" guardrails.

### What was worked on

The operator brief: existing exports are "complacent, ugly, boring and not of much use." Rebuild to investor-grade standard. Sophisticated palette, locked formulas, formula linkages, dynamic charts, AI-assisted prose. New paid DOCX underwriting report. **All exports in English only — non-negotiable.**

Five PRs shipped end-to-end this session:

1. **PR #225 — Foundation.** Cross-cutting modules: `shared/palette.js` (deep navy + ink + paper + copper accent + semantic emerald/red/amber), `shared/staticMap.service.js` (Mapbox Static Images API), `shared/qrImage.service.js` (QR codes), `shared/svgGauge.service.js` (pure-SVG 0–100 score gauge), `narrative/exportNarrative.service.js` (Gemini-primary, OpenAI-fallback narrative; rejects every non-Latin script before content reaches an export; no numbers ever), `utils/scoring/dealScore.js` (deterministic 0–100 with asset-class-aware benchmarks), `migrations/20260527_export_events.sql` (RLS-scoped audit ledger). 79 new tests; 1,277 backend tests green.

2. **PR #226 — PPTX upgrade.** Whole-deck palette migration to the new editorial tokens (legacy `COLORS` keys preserved as a translation layer so existing render code keeps working). Cover slide gets a 0–100 score gauge replacing the decorative ellipses + a QR code linking to the live deal in REDIP. New Pros & Cons slide (AI-augmented Gemini synthesis with deterministic fallback so it always has content). Async pre-compute step in the orchestrator; every dependency wrapped — a single failure never crashes the deck. New primitives: `addChartImage`, `addMapImage`, `addQrCode`, `addScoreGauge`, `addProsConsColumns`, `addNativeChart`. 9 PPTX tests pass (was 7).

3. **PR #227 — Pricing + status docs.** `docs/PRICING.md` captures the DOCX underwriting report's three-tier model (Standard ₹4,999, Premium ₹14,999, Enterprise ₹49,999+) with what's included, cost-to-us, margin, and when-to-recommend per tier. `docs/EXPORTS_REWRITE_STATUS.md` is the multi-PR tracker so future sessions can pick up without re-reading chat. Pure docs.

4. **PR #228 — XLSX v2 (4-sheet).** Brand-new investor-grade workbook (~800 LOC) per the operator brief. Four visible sheets — `Inputs & Assumptions`, `Phasing & Sales Collection`, `Quarterly Cash Flow & Debt`, `Dashboard`. Workbook-level **defined names** (e.g. `SellRatePerSqft`, `DebtLTV`) so cross-sheet formulas reference by name, never `$A$5`. Input zone unlocked (yellow fill, blue text, finance-convention); every output cell locked. Conditional formatting on the DSCR row (red < 1.20, amber 1.20–1.50, green > 1.50). Native ExcelJS doughnut chart on the Dashboard. Quarter count driven by the `ProjectMonths` input (clamped 4–32). Existing 13-sheet workbook retained — operator opts in to v2 by appending `?v=2` to the URL or flipping `XLSX_V2_DEFAULT=1`. 9 new tests.

5. **PR #229 — DOCX underwriting report.** Net-new paid product (~870 LOC). 8 of 16 brief sections in v1: Cover, Executive Summary (Claude IC opinion + KPIs + score), Site Information (Mapbox map when configured), Overview, Comparables, Financials, Pros & Cons (Gemini-synthesised with deterministic fallback), Overall Score (deterministic 0–100 with weight breakdown), Disclaimer (split into "AI-Assisted" vs "Platform Data" badges). Route gated behind `DOCX_REPORT_ENABLED=1`; admins always have access. New dep: `docx@9.5.1` (pinned). Header/footer with page numbers, A4-equivalent margins. 8 new tests; 1,296 backend total.

### Cross-cutting rules now enforced in code

- **English only — non-negotiable.** Narrative service rejects Devanagari, Kannada, Tamil, Telugu, Malayalam, Bengali, Gujarati, Gurmukhi, Oriya, Sinhala, Thai, Tibetan, Myanmar, Hiragana, Katakana, CJK, Hangul, Hebrew, Arabic, Syriac before content reaches an export.
- **No AI-generated numbers.** System prompt forbids specific figures. The deterministic financial kernel is the only source of numerics in any export.
- **Audit trail.** `export_events` table records every export with format, ai_used, ai_cost_usd, generation_ms, byte_size, downloaded_at.
- **Disclaimer model.** AI-Assisted vs Platform Data badges so reviewers can target their scrutiny.

### Tests + build

- **Backend**: 1,296 tests across 93 suites — all green (+98 from this batch: 79 in PR #225, 2 in PR #226, 9 in PR #228, 8 in PR #229).
- **Frontend**: untouched — no UI changes shipped this session.
- All five PRs land cleanly with CI green; PRs 225–228 squash-merged; PR 229 in flight at session-log time.

### Operator actions outstanding

- [ ] Apply migration `database/migrations/20260527_export_events.sql` via Supabase SQL Editor.
- [ ] Set `MAPBOX_TOKEN` env var in Vercel before site maps render in PPTX/DOCX.
- [ ] Set `REDIP_PUBLIC_URL` if production URL differs from `https://redip.vercel.app`.
- [ ] Verify by downloading: a deal PPTX (palette, QR, gauge, Pros & Cons), an XLSX with `?v=2` (input recalc), a DOCX as admin (all 9 sections render).
- [ ] Pick payment provider (Razorpay vs Stripe) before paywall PR starts.

### Plain-English recap (for the user)

- Downloaded **PowerPoint decks** now use a sophisticated investor-grade colour scheme. The cover page shows a 0–100 deal score and a QR code that opens the live deal in REDIP. A new Pros & Cons slide lays out the case for and against the deal in two columns.
- Downloaded **Excel workbooks** can now be downloaded in a tight 4-sheet investor-grade format (`?v=2` for now). The yellow input cells are the only ones you can edit; change a number and the rest of the workbook recalculates in real time. The Dashboard shows live KPIs and a Sources & Uses chart.
- Downloaded **Word documents** are a brand-new feature — admin-only for now, paid product later. The report runs about 8 sections including a score, KPIs, comparables, financials, AI-assisted Pros & Cons, and a clear disclaimer about which sections are AI-assisted vs platform data.
- **No fabricated numbers.** AI in this rebuild only writes prose; every figure in every export comes from the platform's deterministic financial engine.
- **English only.** Hard guardrail in code — no Hindi or Kannada output can slip through.

### What's left for follow-up sessions

- PPTX phase 2: native pptxgenjs charts on financial slides (sources/uses doughnut, cash flow bars, sensitivity heatmap, IRR tornado), site map embed, comp scatter chart, Key Assumptions appendix slide.
- XLSX phase 2: hidden Calculations audit-trail sheet, sensitivity heatmap chart on Dashboard, IRR/NPV via Excel functions.
- DOCX phase 2: 8 remaining sections (Demographics, Why This Area, Job Growth, Social Infrastructure, Supply & Demand, Better Alternatives).
- Paywall scaffold: `deal_export_purchases` table + Razorpay-or-Stripe integration + paid-record check on the DOCX endpoint.

---

## 2026-05-09 (continued ×2) — Tier-2 #14 A/B eval harness + frontend AI-panel coverage

Two parallel streams shipped together. Closes the last original-handoff item (#14) and lifts frontend coverage on the AI surfaces from "untested" to "regression-guarded."

### What was worked on

**Tier-2 #14 — GPT-5.4 vs Claude A/B eval harness.** A held-out 30-deal fixture set + a deterministic two-axis scorer + a runner CLI for operator-driven comparisons.

- **Scorer (`abEvalScoring.js`).** Pure functions, no DB, no LLM. Two dimensions:
  - **Hallucination** — extracts every numeric token from the generated text, walks the input snapshot to build the "allowed numbers" set (tolerance ±1%), flags fabricated rupees / FAR / RERA / zone codes. Severity tiers (high near magnitude unit, medium freestanding); a 25-point egregious-output bonus penalty fires once 4 high-severity fabrications stack up.
  - **Tone regression** — forbidden marketing-tell vocabulary ("groundbreaking", "leverage", "best-in-class"), markdown leakage when prose is required, emoji presence, first-/second-person voice, hedge-density ceiling, target word-count band.
  - Composite weighted 0.6 hallucination · 0.4 tone — hallucination is the harder failure mode.
- **Harness orchestrator (`abEvalHarness.service.js`).** Runs N candidate (provider, model) pairs against a fixture list, scores each pair, returns per-candidate summaries + pairwise deltas. Lazy-loaded service prompts so tests can mock without circular requires. Continues on per-fixture errors (one timeout doesn't abort the run).
- **30-deal fixture set (`tests/fixtures/ab-eval-deals.json`).** 6 micro-markets × 5 verdict labels, programmatically generated from `scripts/generate-ab-eval-fixtures.js` for reproducibility. Each row carries both a `parcel_payload` (for parcel narrative scoring) and a `deal_payload` (for export-insights scoring).
- **Operator CLI (`scripts/run-ab-eval.js`).** Cost-aware (`--confirm` required > 50 calls), prints per-fixture progress, writes a markdown report with per-candidate summaries, head-to-head deltas, and the worst-3 fixtures per candidate.

**Frontend AI-panel coverage.** Backend has 1062 tests; frontend was mostly untested on the AI surfaces. Closed that gap with 33 new tests across the 4 AI panels:

- **DealQaBox (11 tests)** — empty state suggested questions, suggested-question click fills textarea, submit calls ask with trimmed text, Cmd+Enter shortcut, streaming text paints into the live panel, Cancel button aborts the stream, history rows render with citation chips, failed-row banner, Remove button calls delete, AI-assisted disclaimer.
- **IcMemoPanel (8 tests)** — empty CTA state, cached-on-mount with Cached badge, Generate calls streamIcMemo with onText/onDone handlers, streamed deltas paint into the markdown, Cancel aborts the upstream call, Copy calls clipboard with the memo body, Download writes a .md with the deal-name filename, drift surface renders when drifts > 0.
- **ParcelNarrativeCard (8 tests)** — Generate CTA, cached narrative on mount, Generate calls mutate with both ids, skeleton on pending, error state with Try-again, Copy writes via navigator.clipboard, disclaimer rendering, drift surface.
- **RiskTab risk-brief panel (6 tests)** — gated rendering, body content, Copy, Download, disclaimer, expand/collapse.

### Tests + build

- **Backend**: 1062 tests across 76 suites — all green (+40 from this batch). New `abEvalScoring.test.js` (29 cases) and `abEvalHarness.service.test.js` (11 cases).
- **Frontend**: 251 tests across 33 files — all green (+33 from this batch).
- **Production build**: clean, 25s.

### Plain-English recap (for the user)

- The site can now compare two AI models side-by-side on the same set of deals. Run a single command and you get a markdown report showing which model lies less and which writes more like a real analyst — no more guessing if a model swap helped or hurt.
- The four AI panels on the deal page (Q&A, IC Memo, Parcel Narrative, Risk Brief) now have automated tests covering streaming, caching, and Copy/Download — so future refactors can't quietly break them.
- No operator action needed. No new env vars, no migrations.

### Operator action available (optional)

When you want to actually compare Claude vs GPT-5.4 on real fixtures:
```
node backend/scripts/run-ab-eval.js \
  --task=parcel_narrative \
  --candidates=claude:claude-sonnet-4-6,openai:gpt-5.4-mini \
  --limit=10 \
  --confirm
```
Estimated cost ~$0.24 for a 10-fixture × 2-candidate smoke run. Reports land under `backend/tests/fixtures/ab-eval-report-*.md`.

---

## 2026-05-09 (continued) — Investor tear-sheet PDF + streaming Q&A

After the Tier-2 #11 Q&A agent landed, picked the two highest-leverage follow-ups from the "beyond the original handoff" list and shipped them together as a paired ship.

### What was worked on

**Investor tear-sheet PDF.** Replaces the basic 1-page deal summary that lived inline in `export.routes.js`. New service `dealTearSheet.service.js` builds a 2-page landscape A4 PDF:

- **Page 1 — Snapshot.** Navy header, deal-name + stage / priority / asset-class / structure / RERA pills, KPI strip (IRR · Equity Multiple · Total Cost · Total Revenue), two-column cards (Property | Deal Economics), readiness ribbon (DD % · approvals % · open risks · IC recommendation).
- **Page 2 — Synthesis + Risks + Comps.** Excerpt of the latest persisted IC memo (or risk brief fallback) under an "AI-assisted, requires human review" eyebrow, severity-sorted risk register table, top comps table with verified/source columns.
- **Editorial chrome** matches the existing Market Intelligence tear-sheet (same navy/accent palette, same pdf-lib + StandardFonts, same landscape A4) so the family of REDIP PDFs reads as one product.
- Reuses `getDealExportContext()` so DD / risks / approvals / comps / AI insights all come from the same well-tested upstream payload — zero duplication of SQL.
- Forces fixed 2-decimal precision on all rupee values (no "INR 12.5 Cr" sloppiness).
- Same path `GET /exports/deals/:dealId/pdf` so existing download links keep working — strict upgrade.
- New "Tear-Sheet" button on the deal page header next to "Export Deck", `FileDown` icon.

**Streaming Q&A.** Q&A used to block on the full 6-15s Claude round-trip. Now the answer paints token-by-token while citations + drift checks land at the end:

- New service method `dealQa.streamQuestion()` mirroring the streamDealAnalysis / icMemoService.stream contract: assembles context (deterministic, no LLM yet), opens `runClaudeReasoningStream()`, on `done()` parses the streamed JSON, validates citations against retrieval set, runs the numerical verifier, persists the row.
- New SSE route `POST /api/deals/:id/qa/stream` — same headers + `req.on('close')` abort hook as the IC memo / deal-analysis streams. Cache short-circuit emits one `done` frame with the cached row, no streaming needed.
- New frontend hook `useStreamDealQa()` with a progressive JSON parser `extractStreamingAnswer(buffer)` that walks the streamed bytes, finds `"answer":"...up to current position..."`, handles `\"` `\\` `\n` `\t` `\r` `\/` and `\uXXXX` JSON escapes — so the UI never shows raw JSON to the analyst.
- `DealQaBox.jsx` rewritten to use streaming: live question header, token-by-token answer with blinking-cursor caret, Cancel button mid-stream (abort propagates to Anthropic — no wasted tokens), persisted citations and drift badges land when the stream finishes and the cached history row paints.

**Bonus fix.** `OverviewTab.test.jsx` was failing on master since PR #199 (DealQaBox needed a `QueryClientProvider` wrap that the test never provided). Wrapped the test in a fresh QueryClient + mocked `dealQaAPI` and the test now passes again.

### Tests + build

- **Backend**: 1022 tests across 74 suites — all green. Includes 12 new tests on `dealTearSheet.service.test.js` covering the helpers (safeText, fmtCr, fmtPct, fmtX, fmtArea, titleCase) and full PDF generation across populated / no-AI-artifacts / risk-brief-fallback / sourcing-stage / 404 / 400 paths. Tests parse the produced PDF binary to assert page count + magic bytes.
- **Frontend**: 218 tests across 29 files — all green. New `useDealQa.test.js` with 8 cases on the `extractStreamingAnswer` parser (pre-open / mid-stream / fully-formed / escapes / unicode / whitespace tolerance).
- **Production build**: clean, 40s, no warnings on bundle size.

### Plain-English recap (for the user)

- The Download PDF on a deal now produces a much richer **2-page investor tear-sheet** — KPIs, property, economics, AI synthesis, risks, and comps — instead of a basic 1-page summary. New "Tear-Sheet" button on the deal page makes it discoverable.
- The **Ask anything about this deal** box now answers token-by-token like ChatGPT instead of blocking for 10+ seconds. There's a Cancel button if the analyst changes their mind mid-stream — the upstream Claude call gets aborted so we don't burn tokens.
- The deal-page test suite was quietly broken for a few days. Fixed.

### PRs opened/merged today (this batch)

To be filled in once the auto-merge PR lands.

---

## 2026-05-09 — Tier-2 #11 Q&A agent + roadmap deferrals + final 4-of-4 AI artifact suite, 3 PRs

Mostly a Tier-2 day. Shipped the highest-leverage remaining capability (the narrow Deal Q&A agent), wired the 4th and final AI artifact type to the persistence + verifier suite, added markdown export buttons across all AI panels, and locked in roadmap deferrals so future sessions don't re-debate skipped items.

### What was worked on

**PR #197 — Parcel narrative wired to ai_artifacts + Copy/Download .md on AI panels.** Two complementary additions: (1) `parcel_narrative` was the only AI artifact type from migration 20260510 that wasn't persisting yet — every page-mount on the Parcel tab was burning Claude tokens regenerating the same summary. Now it persists with snapshot_hash, runs through the numerical verifier (Tier-1 #3), and the card prefers the cached version on mount with a "Cached" badge. (2) Both the IC Memo and Risk Brief panels got Copy + Download .md buttons. New helper `frontend/src/utils/downloadMarkdown.js` builds sensible filenames like `whitefield-plot-22-ic-memo-2026-05-09.md`. UTF-8 BOM-less so ₹ glyphs render correctly in Word/Google Docs. Now all four AI artifact types (deal_analysis, risk_brief, ic_memo, parcel_narrative) share the same persistence + caching + drift verifier + export infrastructure. **990/990 backend tests pass**, frontend build clean.

**PR #199 — Tier-2 #11 narrow Deal Q&A agent.** The biggest remaining capability gap from the original handoff. Until now an analyst on a deal page had six tabs of data and zero way to ask conversational questions. New service `dealQa.service.js` orchestrates: (1) deterministic context assembly — deal snapshot + open risk_flags + top 5 comps + pgvector top-K retrieval over `document_embeddings`, all parallel, RLS-scoped. (2) Claude call via `runAIWithSchema` with strict Zod-validated contract: `{ answer, citations: [{ embedding_id, excerpt, why_relevant }], confidence }`. (3) Citation post-validation — every embedding_id MUST exist in the retrieval set; hallucinated ids → row marked status='failed'. (4) Numerical verifier (Tier-1 #3) runs over the answer to catch drift. (5) Snapshot-hash short-circuit so identical re-asks return the cached answer with zero token spend. New migration `20260518_deal_qa_history.sql` with RLS, 3 indexes, 4 policies. New endpoints POST `/api/deals/:dealId/qa`, GET `/api/deals/:dealId/qa/history`, DELETE `/api/deals/:dealId/qa/:rowId`. New frontend component `DealQaBox.jsx` slotted between IcMemoPanel and Stage History on the Overview tab — input box, suggested-question chips on first use, in-flight skeleton, citation chips with click-to-expand excerpt popovers, expandable history rows, drift surface, Cmd/Ctrl+Enter shortcut. **20 unit tests** covering citation validator (hallucination detection), hydrator, snapshot hash (case/whitespace/order-insensitive), AnswerSchema, input validation, cache hit short-circuit, hallucination → 502 with persisted failed row. **1010/1010 backend tests pass.**

**PR #200 — Roadmap deferrals + session log.** Locks in user direction so future sessions don't re-relitigate:

| # | Item | State |
|---|---|---|
| Tier-1 #5 | Karnataka IGR SRO PDF extraction | DEFERRED — operator will upload sample PDF later (sample needed from `igr.karnataka.gov.in` → Revised Guidelines Value → any Bengaluru SRO) |
| Tier-1 #6-9 | Co-working / Student housing / Senior living / Data center benchmarks | SKIPPED |
| Tier-3 (handoff) | Source-identity verification for broker reports | SKIPPED |
| Tier-3 (handoff) | Fine-tune small extraction model on reviewed corpus | SKIPPED |
| Tier-3 (handoff) | Multi-agent orchestration | SKIPPED |
| Tier-3 (handoff) | WhatsApp Business API ingestion | SKIPPED |

### PRs opened/merged today (3)

| PR | Title |
|---|---|
| **[#197](https://github.com/Rachit-Jain9/REDIP/pull/197)** | feat(ai): parcel_narrative wired to ai_artifacts + Copy/Download .md on AI panels |
| **[#199](https://github.com/Rachit-Jain9/REDIP/pull/199)** | feat(ai): narrow Deal Q&A agent — pgvector + Claude + mandatory citations (Tier-2 #11) |
| **[#200](https://github.com/Rachit-Jain9/REDIP/pull/200)** | docs(session-log + deferrals): 2026-05-09 session + lock skipped items |

### Operator actions still pending
- Apply migration `20260518_deal_qa_history.sql` via Supabase SQL editor (project `niamgjbxxgmmffggumvj`). Idempotent. Until applied, the Q&A box renders but POSTs fail with `relation does not exist`.
- Tier-1 #5 SRO PDF — when ready, drop a Bengaluru SRO PDF (e.g. Sarjapur, Whitefield, Yelahanka) into chat and I wire extraction.

### What's actually pending after today's deferrals

**Original handoff items left:**
- **Tier-1 #5** — IGR SRO PDF extraction. Waiting on operator PDF download.
- **Tier-2 #14** — GPT-5.4 A/B harness on parcel narrative + export insights. Held-out 30-deal eval set with hallucination + tone-regression scoring.

**Beyond the original handoff** — opportunities surfaced as the platform matured:
- **Information architecture pass on the deal Overview tab** — KPIs + AI deal analysis + IC memo + Q&A box + financial summary + stage history + activities + notes is a lot. Could collapse into "AI Insights" sub-section or sub-tabs.
- **Investor-grade tear sheet PDF** — comprehensive single-page IC printout combining KPIs + AI memo + risk register + comps. Reuses everything we shipped.
- **Streaming Q&A** — current is sync; could match the deal_analysis / IC memo streaming pattern.
- **Frontend test coverage** — backend has 1010 tests; frontend is mostly untested. Add Vitest + RTL coverage for the AI panels and queue UI.
- **Comps queue bulk operations** — approve / reject N rows at once.
- **Cost / latency monitoring dashboard** — existing `ai_call_logs` table has the data; needs a UI surface.
- **Dashboard widget customization** — KPI tile selector for analysts.
- **Audit trail UI** — every material change to a deal is already in `audit_log`; surface it.

---

## 2026-05-08 (afternoon) — Tier-1 progress + cross-doc inconsistency detector — 11 PRs

Continuation of the same calendar day after the Tier-0 ingestion sequence (#180–#186) shipped earlier. Whole afternoon spent stacking Tier-1 items, polish, and one big new capability — a cross-document AI risk detector that's the first piece of REDIP that actually *reasons across documents* rather than just storing them.

### What was worked on

**Phase A — Validation hotfix.** First production smoke-test of the comps queue surfaced a confusing `Validation failed` toast when the analyst pressed `R` to reject a row without typing a reason. Frontend was sending `{ reason: null }` (after `.trim() || null`) and `body('reason').optional().isString()` only treats `undefined` as "skip validation" — null flowed through to `.isString()` and tripped the validator. Fix landed defense-in-depth: backend `.optional({ values: 'null' })` AND frontend now omits null fields entirely from request bodies. Same fix preemptively applied to the PATCH endpoint's `payload` and `notes` fields. 8 new regression tests cover the null-tolerance behavior so a future refactor can't silently regress it. While writing tests caught a bonus bug — fixture used `00000000-0000-0000-0000-000000000001` which `isUUID()` rejects (the version digit `1` doesn't match any valid UUID version). Fixed to a proper UUIDv4. **PR #187.**

**Phase B — Tier-0 polish: dashboard pending-review tile + queue empty-state CTA.** Closes the engagement loop on the flywheel. Dashboard now greets editor+ users with a compact "Comps review queue · N pending review" card between KPIs and charts when there's work to do (hides cleanly when idle). Queue empty-state replaces the generic "Nothing here yet" with a primary "Upload your first file" CTA on the pending_review filter. **PR #188.**

**Phase C — Tier-1 #10 (project-precise geocoding).** Up till now every Whitefield comp stacked at one (12.97, 77.75) point — PR #169's cluster pins were a workaround. Migration `20260516_comps_geocode_quality.sql` adds a `geocode_quality` column with the 6-value enum (rooftop / range_interpolated / geometric_center / approximate / locality_centroid / manual) + partial index + queue-side capture. Standalone Google API script `scripts/upgrade-comps-geocoding.mjs` walks upgradable rows with 5 km drift guard. Operator-runnable. **PR #189.**

**Phase D — Tier-1 #3 (post-hoc numerical verifier).** Closes the "system prompts forbid invention but nothing checks" gap. Migration `20260517_ai_artifacts_numerical_drifts.sql` adds `numerical_drifts JSONB` + `verified_at` columns to `ai_artifacts`. New `numericalVerifier.service.js` extracts numbers (IRR%, ₹ Cr revenue/cost, sqft/acres land area) from Claude-generated narratives via deterministic regex extractors with keyword-anchored matching, compares against the deterministic snapshot from the same DB rows that fed Claude, and flags drifts in 3 severity bands (high >10%, medium 5–10%, low 1–5%). Wired into `intelligence.service.js#streamDealAnalysis`; the SSE 'done' frame forwards drifts inline so the UI badge shows immediately after streaming completes. UI: severity-toned banner on the Overview tab with expandable per-claim diff (claimed value vs model value vs drift % vs context snippet), plus the missing "AI-assisted — requires human review" disclaimer per CLAUDE.md hard rule. 31 new unit tests. **PR #190.**

**Phase E — Geocoding bulk run + helpers (Tier-1 #10 finish).** Two helper scripts to actually upgrade the 81 production comps. First Nominatim attempt got 8 upgrades (free, no key, but limited POI coverage for Indian named developers — 14% hit rate). User then created a dedicated server-side Google Maps API key (Application restrictions = None, API = Geocoding only) and pasted it. Second pass via Google: 61 of 73 remaining upgraded. Final state: 25 rooftop · 31 geometric_center · 13 approximate · 12 drift-rejected (correctly kept at locality_centroid — Google matched same-named places > 5 km away for Devanahalli + Yelahanka projects). All 69 upgrades applied via Supabase MCP execute_sql since local `backend/.env` was still pointing at the deprecated Tokyo project. **PRs #191 (Nominatim helper) + #193 (Google helper)**.

**Phase F — UI cleanup + .env to Mumbai.** Removed the "Internal pipeline data — external inventory feeds not yet configured" amber banner from `/dashboard/intelligence` (32 LOC of dead `UnconfiguredNotice` component code deleted). Section 4 "Bengaluru Micro-Market Intelligence" was rendering an apologetic placeholder for every user (sourced from `market_notes WHERE section='micro_market'` with 0 rows in production); now hides cleanly when empty — the actual 38 verified rows of `micro_market_benchmarks` continue to power Section 7's Demand Heatmap below. `backend/.env` swapped from Tokyo (`lsbhrbvuynzqhdtzczco`, `ap-northeast-1`) to Mumbai (`niamgjbxxgmmffggumvj`, `ap-south-1`) for ~120 ms latency improvement on local dev. **PR #192.**

**Phase G — Tier-1 #4 + Tier-2 #12 (cross-document inconsistency detector + risk_brief artifact).** The biggest piece of the day. Closes the catastrophic-blind-spot gap CLAUDE.md flagged. New `inconsistencyDetector.service.js` reads the deal's Gemini extractions and runs five **pure deterministic** comparators (zero LLM in the detection path):
1. Seller / EC mismatch — Sale Deed grantor vs latest EC transaction party_1, with token-overlap name similarity that handles Indian name reorderings + middle initials
2. Consideration drift — Sale Deed vs matched EC, linked by document_number when present, by amount-similarity (5%) otherwise. Stamp-duty exposure flag.
3. FSI conflict — Sanctioned Plan fsi_proposed vs Zoning Certificate permissible_fsi. Critical when overshoot > 10%, regulatory blocker.
4. Area drift — Sale Deed vs Sanctioned Plan vs Layout Approval, all-pairs comparison with acres↔sqft normalization (43,560 multiplier).
5. RERA gap — Sanctioned plan present but no document carries a valid RERA registration. High-severity hard blocker.

Each comparator returns Findings → persisted as risk_flags with `source='ai_detector'`. Claude is invoked exactly once at the end to stitch findings into a counsel-grade markdown narrative that lands in `ai_artifacts.risk_brief` (Tier-2 #12 — was declared in the migration but had no service writing to it until now). Two endpoints: `POST /risk/ai/inconsistency-check` (idempotent — dedupes by finding title) and `GET /risk/ai/brief`. Frontend: "Run AI inconsistency check" button on RiskTab next to "Add Risk Flag", small "AI" badge on each AI-detected flag row, collapsible Risk Brief panel below the action bar with the synthesized narrative + the required "AI-assisted — requires human review" disclaimer. 31 unit tests. **PR #194.**

### PRs opened/merged today (afternoon batch — 8 production)

| PR | Title | Phase |
|---|---|---|
| **[#187](https://github.com/Rachit-Jain9/REDIP/pull/187)** | fix(comps-queue): "Validation failed" toast on reject without reason | A |
| **[#188](https://github.com/Rachit-Jain9/REDIP/pull/188)** | feat(dashboard): pending-review tile + queue empty-state CTA | B |
| **[#189](https://github.com/Rachit-Jain9/REDIP/pull/189)** | feat(comps): project-precise geocoding (Tier-1 #10) | C |
| **[#190](https://github.com/Rachit-Jain9/REDIP/pull/190)** | feat(ai-trust): post-hoc numerical verifier (Tier-1 #3) | D |
| **[#191](https://github.com/Rachit-Jain9/REDIP/pull/191)** | chore(geocoding): Nominatim fallback batch helper | E |
| **[#192](https://github.com/Rachit-Jain9/REDIP/pull/192)** | chore(intelligence): remove "Internal pipeline data" banner + Section 4 empty state | F |
| **[#193](https://github.com/Rachit-Jain9/REDIP/pull/193)** | chore(geocoding): Google batch helper + 61 comp upgrades applied | E |
| **[#194](https://github.com/Rachit-Jain9/REDIP/pull/194)** | feat(risk): cross-document inconsistency detector + risk_brief (Tier-1 #4 + Tier-2 #12) | G |

### Operator actions taken during the session
- Applied migration `20260515_comps_review_queue.sql` (Tier-0 #1 follow-up from morning) ✅
- Applied migration `20260516_comps_geocode_quality.sql` (Tier-1 #10) ✅
- Applied migration `20260517_ai_artifacts_numerical_drifts.sql` (Tier-1 #3) ✅
- Created dedicated server-side Google Maps API key in GCP (Application restrictions = None, API = Geocoding only) — billing-only, never sent to frontend ✅
- 61 production comps geocoded via Supabase MCP (~$0.40 of Google API spend) ✅

### Tier-1 progress checkpoint
| # | Item | State |
|---|---|---|
| ✅ 3 | Post-hoc numerical verifier | shipped (#190) |
| ✅ 4 | Cross-document inconsistency detector | shipped (#194) — biggest Tier-1 item |
| 5 | Karnataka IGR SRO PDF extraction | manual blocker — operator needs to download from `igr.karnataka.gov.in` |
| ✗ 6-9 | Co-working / Student housing / Senior living / Data center | skipped per user direction |
| ✅ 10 | Project-precise geocoding | shipped (#189, #191, #193) — 69/81 upgraded |

**Six of six in-scope Tier-1 items shipped.** The only remaining one is #5 which requires manual PDF acquisition.

### What's left to do next
- **Tier-1 #5** (Karnataka IGR SRO PDF extraction) — once user downloads sample PDFs from `igr.karnataka.gov.in`, we can wire Gemini extraction for the 11 guidance-value placeholders in TODO_DATA.md
- **Tier-2 items** — narrow Deal Q&A agent, IC memo drafting (#13), GPT-5.4 A/B harness on parcel narrative (#14)
- **Source-identity verification for broker reports** (Tier-3) — once the comps queue accumulates enough reviewed corpus

---

## 2026-05-08 (morning) — Tier-0 data flywheel — email ingestion pipeline scaffolded end-to-end, 4 PRs

### What was worked on

The full Tier-0 data flywheel from the 2026-05-08 strategic handoff. Until now REDIP ran on 81 hand-curated comps — a showcase, not a moat. This session builds the rail that turns forwarded broker emails and IPC quarterly PDFs into committed comps autonomously, with a human-in-the-loop reviewer to keep quality high.

The architecture spans 4 layers:

```
email → /api/ingest/email/postmark webhook → storage + queue row
queue row → cron worker (every 15 min) → Gemini extraction → pending_review
analyst → reviewer UI → edits + approve → comps[] insert + committed status
```

Shipped as 4 logically separate PRs so each one is independently reviewable + revertable. Per the handoff's explicit guidance against shipping the whole pipeline in one PR.

**PR #180 — comps_review_queue migration.** New staging table with a 7-state lifecycle (`pending_extraction → extracting → pending_review → approved/rejected → committed/failed`), 5 source taxonomies, JSONB structured_payload + reviewer_edits, partial unique on (org, raw_doc_sha256) for byte-identical-attachment dedupe, 5 purpose-built indexes (org+status queue list, org+source filter, email-thread roll-up, extraction-id worker join, dedupe lookup), 4 RLS policies. Idempotent — every operation guarded by `IF NOT EXISTS` / `DROP IF EXISTS`.

**PR #181 — Postmark inbound webhook.** Auth supports both HMAC-SHA256 (preferred) and HTTP Basic (Postmark free-tier fallback). Sender-domain heuristic auto-classifies CW/JLL/Knight Frank/Colliers/CBRE etc. as `email_ipc_report`; subject keywords (`rate`, `quote`, `comp`) classify as `email_broker_quote`; everything else as `email_other`. 25 MB attachment cap, MIME allowlist (PDF / images / Office / CSV). Body preview truncated to 8 KB before storage. SHA-256 dedupe against the queue's partial unique index — 23505 errors transparently return the existing row, never fail the webhook (Postmark would retry on non-2xx). 24 unit tests cover HMAC verification, Basic-auth, sender-domain mapping, MIME rejection, dedupe-on-23505 path, body-only fallback.

**PR #182 — Extraction worker + reviewer queue API + 2 new Gemini doctypes.** Two new prompts: `comps_rate_sheet` (broker multi-property rate sheets, one comp per row with `raw_row_text` for traceability) and `ipc_report` (JLL / CW / Knight Frank quarterly reports with `headline_kpis` + `comps[]` + `report_metadata`). CLASSIFY_PROMPT updated to disambiguate from single-property `broker_quote`. PROMPT_REGISTRY_VERSION bumped to `2026-05-15.1`. Queue service owns the lifecycle: `processQueueRow` runs Gemini with the source-mapped doctype and transitions to `pending_review`; `approveAndCommit` is transactional — maps each comp to the comps schema, inserts into the production table, records `committed_comp_ids[]` back on the queue row. Asset-class normalization is **deterministic JS** (per CLAUDE.md: never LLM for math): residential signals → `residential`, office/retail/hospitality/warehouse → `commercial`, mixed-use signals → `mixed_use`. REST API: list (status-priority sort), get, process (manual trigger), edit (save reviewer_edits without committing), approve, reject. Cron worker `/api/cron/comps-queue/process-pending` runs every 15 min via vercel.json. 28 unit tests (881 → 909 stacked count once merged sequentially). Worst-case 30-minute lag from email arrival to pending_review.

**PR #183 — Split-pane reviewer UI.** New admin route at `/dashboard/admin/comps-queue` with two pages. List view: status filter pills (Pending review, Pending extraction, Failed, Rejected, Committed), source filter chips, item rows with status icon tile / sender / subject / attachment / confidence% (color-coded ≥80 / ≥50 / <50) / status badge / received-at timestamp. Live with 60s background refresh + refetch on focus. Detail view: split-pane (440 px source preview on the left — PDF iframe / image / body-only fallback — and editable comps table on the right with grouped columns Identity / Class / Areas / Pricing / Lifecycle / Provenance). Required fields highlighted in amber when missing. Bottom action bar: Save edits / Reject (with reason modal) / Approve & commit (button shows valid-row count). Keyboard shortcuts: `Esc` back, `Cmd/Ctrl+S` save, `A` approve, `R` reject. Per-field confidence panel below the editor for low-quality flag triage. Status-specific banners for committed (links to comps page) / failed (retry button) / rejected (reason). Sidebar gets a new Inbox-icon nav link in the Admin section.

**Verification.** All 4 PRs:
- 909/909 backend tests pass when stacked (52 new + 856 baseline)
- Frontend builds clean — 26.6s, all chunks generated
- Visual check via Vite dev server: list page renders filter pills + status sort + ErrorState; detail page renders split-pane + back link + keyboard hint row + ErrorState; sidebar shows the new nav link
- Zero console errors, zero build warnings

### PRs opened today (4)

| PR | Title | Layer |
|---|---|---|
| **[#180](https://github.com/Rachit-Jain9/REDIP/pull/180)** | comps_review_queue table migration | DB |
| **[#181](https://github.com/Rachit-Jain9/REDIP/pull/181)** | Postmark inbound webhook → comps_review_queue | Backend |
| **[#182](https://github.com/Rachit-Jain9/REDIP/pull/182)** | extraction worker + reviewer queue API + new Gemini doctypes | Backend |
| **[#183](https://github.com/Rachit-Jain9/REDIP/pull/183)** | split-pane reviewer UI under /dashboard/admin/comps-queue | Frontend |

### Operator actions required to flip the flywheel on

Merge PRs #180 → #181 → #182 → #183 in order, then:

1. **Apply migration** `database/migrations/20260515_comps_review_queue.sql` via Supabase SQL editor (project `niamgjbxxgmmffggumvj`). Idempotent.
2. **Set Vercel env vars:**
   - `INGEST_WEBHOOK_HMAC_KEY` — generate via `openssl rand -hex 32`
   - `DEFAULT_INGEST_ORGANIZATION_ID = d1218877-4d3a-4fe4-8d63-914fa8ffa94b` (single-tenant org)
3. **Configure Postmark Inbound Stream** → POST URL `https://redip.vercel.app/api/ingest/email/postmark` with HMAC header `X-Webhook-Signature: sha256=<hex>`.
4. **Smoke test:** forward a JLL/CW/broker email to the inbound address. Within 15 min the cron picks it up and `/dashboard/admin/comps-queue` shows the row in `pending_review`. Click in, review, edit, approve. Verify the comps appear in `/dashboard/comps`.

### What's next (Tier 1)

Per the 2026-05-08 handoff, with the flywheel rail laid down:

1. **Post-hoc numerical verifier** — extract numbers from AI narratives, assert against deterministic snapshot, flag drifts (don't auto-correct)
2. **Cross-document inconsistency detector** — Claude pass over Gemini extractions writing to `ai_artifacts.risk_brief`
3. **Karnataka IGR SRO PDF extraction** for the 11 guidance-value placeholders in TODO_DATA.md
4. **Co-working / managed office benchmarks** + **Student housing** + **Senior living** + **Data center detailed comps** — new schemas + UI sections
5. **Project-precise geocoding** — replace locality centroids with Google Geocoding API per project name

Then Tier 2 (narrow Deal Q&A agent, risk synthesis writing to ai_artifacts, IC memo drafting, GPT-5.4 A/B harness on parcel narrative) once the flywheel has spun for a couple weeks and we have meaningful corpus growth.

---

## 2026-05-08 (Q1 2026 v0.2 + GBA Q4 2025 comprehensive load — 12 PRs landed)

### What was worked on

A heavy, multi-phase day. Three themes:

**Phase A — Q1 2026 v0.2 residential coverage (PRs #165–#167).** Closed three gaps from the deep-dive analysis of the v0.2 rate-pack and the GBA Comps Report:

1. **Section 5 chip toggle was silently broken after v0.2 landed.** The chip group on `/intelligence` Section 5 was hardcoded to match `data_type === 'listing_q1_2026'` / `'ipc_q1_2026'`, so the v0.2 sub-segments (`ipc_q1_2026_v0_2_high_end`, `ipc_q1_2026_v0_2_mid_segment`, `listing_q1_2026_v0_2`) didn't roll up. Replaced with prefix-based `layerForDataType()` + live count memo + zero-count chip suppression.
2. **GBA Report Table 3 (27 named residential apartment locality baskets) was never loaded.** Prestige Park Grove, Brigade Insignia, Embassy Lake Terraces, Sobha City, Brigade Gateway, etc. — each with rate range, average, units, launch year. Built a generator script (`scripts/build-residential-baskets-migration.mjs`) and a migration. Tagged `data_type='ipc_q1_2026_v0_2_locality_basket'`.
3. **Five residential asset classes from v0.2 had no schema to live in.** TODO_DATA.md flagged builder floor (7), plotted dev (18), land-residential-plotted (18), villa/house (13), guidance-value (11) as schema follow-up — different units (INR/sqft vs INR mn/acre vs SRO PDF placeholder). Built `residential_segmented_benchmarks` with `asset_class` enum + `unit` column, RLS-scoped, composite-unique. Loaded all 67 rows. Wired backend service + route + frontend hook + new "Section 5e" UI with asset-class chip filter and per-row data-layer badge.

Plus tear-sheet PDF integration (Section 5e renders in the export) and a bulk locality-centroid geocoding migration so the 30 named premium comps from PR #163 + 27 GBA baskets from PR #165 actually appear as map pins on the Comps page (65 Bengaluru localities mapped in one VALUES join).

**Phase B — Comps map UX + Intelligence page polish (PRs #168–#174).** User reported that the Comps page crashed on first SPA mount with "Cannot read properties of undefined (reading 'ControlPosition')" and the "Try again" button didn't work. Fixed:

- **CompsMap cold-mount race** — `google.maps.ControlPosition` was being read in a `useMemo` before the SDK had populated the `.maps` namespace. The previous guard `typeof google !== 'undefined'` was insufficient because Google's loader creates the `window.google` shell early but populates `.maps` later. Gated zoomControlOptions on both `isLoaded` AND `google?.maps?.ControlPosition`, with `isLoaded` in the deps so options backfill the moment the SDK is ready.
- **Try Again button was a no-op** — ErrorBoundary's reset handler just flipped `hasError` back to false, re-rendering the SAME children with the SAME state that caused the original throw. Now tracks a `resetKey` counter and renders children inside a Fragment keyed by it; bumping the key forces React to unmount + remount the failing subtree.
- **Cluster markers** — after the geocoding migration, 15+ Whitefield comps stacked invisibly at one centroid. Added grouping by `(lat, lng)` rounded to 4 decimals. Multi-comp groups render a count-stamped circle with dominant-data-type colour + click-to-expand list popup. Auto-syncs with table selection.
- **Cluster popup overlap** — popup repositioned above the pin (was extending downward into bottom UI). The bottom-left "Selected" inset now hides while a cluster popup is open (they were saying the same thing twice). Selected comp gets pinned to the top of the cluster list with a primary-tinted highlight.
- **Section 5e summary tiles** — Bloomberg-style tile strip above the segmented-benchmarks table. One per asset class with count + min/max range. Click to toggle filter.
- **Removed defensive UI** — the "Fresh · 4d" / "Stale · 32d" pills (345 lines deleted: StalenessBadge component + utility), the "10. Bottom Line — REDIP is correctly withholding..." card, and the "Apply migration X.sql" empty-state copy on Sections 5 and 6 (they now hide entirely when empty, like 5a–5e already did).
- **Multi-city switcher → asset-class switcher** — biggest information-architecture change of the day. The Bengaluru / Mumbai / NCR / Hyderabad pills were misleading because only Bengaluru has data; the other cities shipped empty-state disclaimers. Replaced with a 5-bucket asset-class filter (+ All): Residential / Land & Plotted / Office / Retail & Hospitality / Industrial & Warehouse. Each filter shows only the sections relevant to that asset class. Section 5e dynamically subsets its rows when residential or land filter is active. Choice persists to localStorage.

**Phase C — Comprehensive GBA Q4 2025 rate-card load (PRs #175 + #176).** User flagged that I'd loaded the v0.2 JSON (172 records) but missed the entire GBA Q4 2025 / Q1 2026 Rate Card source (`COMPS_REDIP-Claude.docx`). They were right. One migration loads 98 rows across 5 tables:

- 38 hospitality ADR cells (10 submarkets × 4 categories: luxury / upper_upscale / upscale_upper_mid / midscale_economy). Was just 2 rows.
- 10 plotted-development corridors with named representative projects (Sarjapur Rd → Purva Tranquility, Godrej Woodland; Devanahalli → Godrej Reserve, Birla Trimaya, etc.).
- 8 land-rate zones (urban core → peripheral + KIADB premium + KIADB outer).
- 12 retail mall Grade A rents (Phoenix Mall of Asia ₹250–600/sqft city's highest, Phoenix Marketcity Whitefield, Orion Mall, Mantri Square, Vega City, RMZ Galleria, M5 Ecity).
- 30 office detailed submarkets (Whitefield Grade A ₹65–140, Bellandur ₹95–150, etc.) layered alongside the 9 v0.2 IPC zones.

Then PR #176 fixed an `ON CONFLICT (..., LOWER(COALESCE(buyer, '')))` bug in the original `20260505_market_data_q1_2026_refresh.sql` — function expressions on ON CONFLICT need an expression-based unique index that didn't exist. Replaced with explicit `IF NOT EXISTS` PL/pgSQL guards (we're already inside a `DO $$` block so conditionals work freely).

### PRs opened/merged today (12)

| PR | Title | Phase |
|---|---|---|
| **[#165](https://github.com/Rachit-Jain9/REDIP/pull/165)** | residential layer toggle + 27 GBA Table 3 baskets | A |
| **[#166](https://github.com/Rachit-Jain9/REDIP/pull/166)** | residential_segmented_benchmarks — 5 missing asset classes (67 rows) | A |
| **[#167](https://github.com/Rachit-Jain9/REDIP/pull/167)** | tear-sheet Section 5e + bulk locality-centroid geocoding | A |
| **[#168](https://github.com/Rachit-Jain9/REDIP/pull/168)** | Comps cold-mount crash fix + Try Again actually retries | B |
| **[#169](https://github.com/Rachit-Jain9/REDIP/pull/169)** | cluster markers at shared centroids + Section 5e summary tiles | B |
| **[#170](https://github.com/Rachit-Jain9/REDIP/pull/170)** | cluster popup repositioned + dedupe with Selected inset | B |
| **[#171](https://github.com/Rachit-Jain9/REDIP/pull/171)** | remove Fresh/Stale freshness pills (−345 lines) | B |
| **[#172](https://github.com/Rachit-Jain9/REDIP/pull/172)** | replace multi-city switcher with 5-bucket asset-class filter | B |
| **[#173](https://github.com/Rachit-Jain9/REDIP/pull/173)** | remove Section 10 "Bottom Line" defensive disclaimer | B |
| **[#174](https://github.com/Rachit-Jain9/REDIP/pull/174)** | hide Sections 5 + 6 when empty (no migration filenames in copy) | B |
| **[#175](https://github.com/Rachit-Jain9/REDIP/pull/175)** | comprehensive GBA Q4 2025 rate-card load — 98 rows across 5 tables | C |
| **[#176](https://github.com/Rachit-Jain9/REDIP/pull/176)** | fix ON CONFLICT bug in 20260505 baseline migration | C |

### Operator actions required

Apply these migration files in order via Supabase SQL editor:

1. `database/migrations/20260505_market_data_q1_2026_refresh.sql` — original Q1 2026 baseline (50 residential micro-market rows, 9 IPC office zones + 30 detailed office submarkets, 12 high-street retail + 9 mall rows, industrial/warehouse/serviced land, hospitality citywide+airport+CBD-luxury, 18 macro KPI rows, 2 transactions). PR #176 fixed the previously-failing ON CONFLICT clause.
2. `database/migrations/20260508_residential_apartment_baskets_q1_2026.sql` — 27 INSERTs into `comps` (PR #165). Idempotent.
3. `database/migrations/20260508_residential_segmented_benchmarks_schema.sql` — CREATE TABLE + 4 indexes + 2 RLS policies (PR #166). Idempotent.
4. `database/migrations/20260508_residential_segmented_benchmarks_data.sql` — 67 INSERTs (PR #166). Idempotent.
5. `database/migrations/20260508_geocode_unmapped_comps.sql` — UPDATE 65 Bengaluru localities (PR #167). Idempotent.
6. `database/migrations/20260508_gba_rate_card_comprehensive_load.sql` — 98 INSERTs across 5 tables (PR #175). Idempotent.

Verify after applying:
- `/intelligence` page header shows "Bengaluru real estate intelligence — DATE" with asset-class pills (no city pills).
- All / Residential / Land & Plotted / Office / Retail & Hospitality / Industrial & Warehouse filters all populate appropriate sections.
- Section 5d Hospitality has 40+ rows (was 2). Segment chips for Luxury / Upper Upscale / Upscale-Upper Mid / Midscale-Economy all populate.
- Section 5e Residential by Asset Class shows summary tiles at top + filter chips.
- Section 5b Retail Format chip flips to "Mall Grade A" → Phoenix Mall of Asia, Orion, Mantri etc visible.
- `/comps` map shows cluster pins with counts at Whitefield, Hebbal, Indiranagar centroids; click expands list popup with selected comp pinned to top.

### What's left to do

1. **Karnataka IGR guidance-value SRO PDF extraction** (11 placeholder rows tagged `guidance_q1_2026_v0_2_pending`) — manual Gemini PDF extraction → fill in `value_low/high/avg`, flip `is_verified=TRUE`. Recorded in TODO_DATA.md.
2. **Co-working / managed office benchmarks** — Section 9.2 of `comps_claude_text.txt` has per-seat all-inclusive pricing (CBD ₹15K–50K, ORR/Whitefield ₹6.5K–15K, etc.). Needs new schema + table.
3. **Student housing & co-living** — Section 9.3, per-bed monthly rates by neighborhood. New schema needed.
4. **Senior living** — Section 9.4, entry capital values + monthly licence fees. New schema.
5. **Data center detailed comps** — Section 9.1 has NTT Bengaluru-4 detail (8.5 acres, 100 MW total, 67.2 MW critical IT load, ₹4,100 cr NTT cumulative Karnataka investment) plus operator list (Sify, ESDS, STT GDC, CapitaLand/Yondr, Nxtra, CtrlS, Equinix). Needs new asset table.
6. **Project-precise geocoding** — current locality-centroid migration causes Whitefield's 15+ comps to stack at one pin (mitigated by cluster markers). Future: backend script using Google Geocoding API per project name to spread markers naturally.

---

## 2026-05-07 (Evening — Comps page-state bug + Google Maps swap)

User reported two issues from a screenshot of the Comps page after clicking a map marker: the table collapsed to "No comparables found" while the page header still showed "29 verified comparables in the database," and asked explicitly to swap the leaflet map for Google Maps ("I gave you GoogleMaps API, use that").

**PR [#155](https://github.com/Rachit-Jain9/REDIP/pull/155)** — `fix(comps): close marker-click crash + swap CompsMap from leaflet to Google Maps`

P0 — page-state collision bug:
- Root cause: ambiguous use of `page` state in `CompsPage.jsx`. The same variable was used both as the API page (60-row chunks via `{ page, limit: pageSize * 4 }`) AND as the visible table page (15-row chunks via `sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize)`).
- `handleSelectComp` calculated `targetPage = floor(idx / pageSize) + 1` using the 15-row local pageSize, so clicking a marker for any comp at idx ≥ 15 set `page=2`. That triggered an API request for `page=2, limit=60` — fetching rows 61-120 from a database with only 29 rows total. Empty response collapsed `rawRows` to `[]`, every chip count fell to 0, table showed "No comparables found." But `totalCount = data.pagination.total` is set independently of which page returned data, so the header still read "29 in the database."
- Fix: decouple API request from display pagination. API now always fetches `{ page: 1, limit: 200 }` (the API's max). `page` state is purely client-side display index over `sortedRows`. Comp dataset is small (≤200 even at 5x growth from today's 29). Server-side search/scroll is the right next step beyond 200 rows, not server pagination — server pagination would also break the map view (markers come from `sortedRows`, not `visible`; paginated server responses would drop markers as the user changes display page).

Google Maps swap (Comps split-view only):
- Installed `@react-google-maps/api` ^2.20.8. Adds ~80 KB gzipped to the CompsMap chunk; lazy-loaded so the table-only path on `/dashboard/comps` doesn't pay the cost.
- Wrote a fresh `GoogleMap`-based component:
  - Theme-aware: editorial dark Map style on dark theme (no pure blacks, restrained labels, hidden POIs/transit), default Roadmap on light.
  - Custom OverlayView markers (CSS-styled dots) so palette + selected-state ping animation route through Tailwind, not Google's marker library.
  - Tooltip on selected marker uses REDIP chrome (`bg-bg-elevated`, hairline border) instead of Google's white-shadow default.
  - Three honest failure surfaces: missing API key → "Set `VITE_GOOGLE_MAPS_API_KEY`" hint; SDK load failure → "likely HTTP referrer restriction" hint with operator action; loading → shimmer skeleton.
- Wired `VITE_GOOGLE_MAPS_API_KEY` in `frontend/.env.example` with the exact set of HTTP referrer restrictions the operator needs to allow in Google Cloud Console.
- Backend `GOOGLE_MAPS_API_KEY` (Geocoding API, server-side) stays unchanged — different surface, stays behind the backend.
- Leaflet stays in the bundle for `MapPage` and the deal Parcel/Site map (unchanged in this PR).

Net diff: +342 / -160 across 5 files. New CompsMap chunk: 162.87 KB (37.36 KB gzipped) — same order as the existing leaflet chunk.

### Operator action chain

User rotated the Maps API key after this PR landed (old + replacement key values redacted 2026-05-30 — **both are committed in git history and must be treated as burned; see the 2026-05-30 security-hardening note for the required rotation**) and added it to Vercel as `GOOGLE_MAPS_API_KEY`. The frontend Maps JS won't see that until a `VITE_GOOGLE_MAPS_API_KEY` (with the same value) is also added to Vercel — Vite only exposes env vars prefixed with `VITE_` to the browser bundle. Local `frontend/.env` and `backend/.env` updated to the new key value (gitignored, not committed).

### Lessons logged

- **Decouple API and client-side concerns when client-side filter/sort/paginate are used.** A single `page` variable doing double duty for both ambient API requests and post-fetch display slicing is a guaranteed footgun; one will move and the other won't follow correctly.
- **Browser-exposed Maps keys MUST have HTTP referrer restrictions before they hit production.** Without them, anyone can lift the key from the bundle and burn through quota on the user's bill.

---

## 2026-05-07 (PM hotfix — IntelligencePage crash + theme-switch lag)

User reported the Market Intelligence page rendering "Something went wrong on this page · useEffect is not defined" + a visible lag when toggling between light and dark theme. Two root causes, both shipped together because they surfaced from the same screenshot.

**PR [#153](https://github.com/Rachit-Jain9/REDIP/pull/153)** — `fix(intelligence,theme): restore useEffect import + smooth theme switch via View Transitions`

P0 — IntelligencePage crash:
- PR #151 added a `useCityPreference` hook that calls `useEffect` for localStorage persistence, but `useEffect` was never added to the React imports on `IntelligencePage.jsx`. The page rendered the fallback error screen for ~30 minutes in production until this PR landed. One-line fix: add `useEffect` to the named imports.
- Cross-checked CompsPage.jsx — its imports already included `useEffect` from PR #149, no other regression.

Theme-switch lag:
- Root cause was a CSS rule in `index.css` applying `transition-property: background-color, border-color, color, fill, stroke` for 180ms to **every element + pseudo-element on the page, always** (`*, *::before, *::after`). Hundreds-to-thousands of simultaneous animations on each theme flip; constant paint-cost overhead during normal interaction.
- Two-strategy fix:
  1. **View Transitions API** (Chromium 111+, Safari 18+) — `document.startViewTransition` wraps the data-theme flip; browser snapshots, swaps, and cross-fades in a single compositor pass. Zero per-element animation work. Tested in dev preview: ~50ms wall-clock.
  2. **Fallback** — `html.theme-transitioning` class added for 220ms around the data-theme flip, removed via re-entrant timer. CSS rule gated on this class so the universal selector only runs during the brief switch window.
- Plus `prefers-reduced-motion` override for instant flip.
- Component-level Tailwind `transition-colors` / `transition-all` classes unaffected — those are scoped per-element and target hover/focus, not the theme variables.

Net diff: +71 / −6 across 3 files. No new dependencies. CI all 7 checks green; merged.

### Lesson logged for future sessions

- **Always run a hook-import audit when adding hooks to existing files.** A pre-commit `grep` for any of `useEffect|useState|useMemo|useCallback|useRef|useLayoutEffect|useTransition|useId` against the import line on every changed file would have caught this in 2 seconds. Adding to memory.
- **Universal `*` CSS transitions are a smell.** Anything that touches "every element on the page" should be gated behind a class that's only present during the actual transition.

---

## 2026-05-07 (PM addendum — theme-aware map, sticky chrome, chip counts, multi-city)

Follow-up session triggered by a user screenshot of the Comps page in dark theme. Four UX issues visible in the screenshot + the cheapest Tier 1 ship from the earlier roadmap (multi-city) all bundled into one PR.

**PR [#151](https://github.com/Rachit-Jain9/REDIP/pull/151)** — `feat(comps,intelligence): theme-aware map + sticky chrome + chip counts + multi-city selector`

Direct fix list driven by the screenshot:
- **Theme-aware map tiles**. CartoDB Positron stays for light theme; CartoDB Dark Matter ships when `html[data-theme="dark"]`. New `useTheme` hook subscribes to the data-theme attribute via MutationObserver so the TileLayer remounts on theme change without a page refresh. Markers also read theme to pick a contrasting selected-stroke (white on dark tiles, slate on light) so the pinned comp pops in either palette.
- **Sticky Comps page header**. The Map | Table toggle, Export CSV, and Add Comp now stay pinned at the top while scrolling through long result sets. Backdrop-blur keeps the band readable over scrolling content. Previously the toggle scrolled away (clearly visible in the user's screenshot which had scrolled past the chrome).
- **Asset-class chip counts fixed**. The "All asset classes 0" chip in the screenshot was the `allowAll` chip auto-summing `o.count || 0` across options that never received counts. Wired `projectTypeCounts` from rawRows; `DataToolbar.Chips` reduces the All chip's count automatically so the total is honest.
- **Map empty-state overlay**. When the table has rows but none have coords (or the table is empty), the map area used to render as a blank pale rectangle. Now a centered overlay explains the gap with class-aware copy ("None of these comps are geocoded — N rows in the table; add latitude/longitude to make them visible here").
- **Idle hint pill**. Bottom-center pill teaches the row↔marker gesture when nothing is pinned; vanishes once the user selects something.

Plus the Tier 1 #10 ship — multi-city activation on Intelligence:
- `CitySelector` segmented control in the page header (Bengaluru / Mumbai / NCR / Hyderabad). Persists to localStorage via `useCityPreference` hook.
- All 7 benchmark hooks now take `{ city }` instead of hardcoded 'Bengaluru'. Backend already supported `?city=X` on every endpoint, so this was pure frontend wiring.
- Section titles (Macro KPI strip, Section 5 residential, Section 6 transactions) interpolate `${city}` so labels stay correct.
- Honest amber "preview" note when a non-Bengaluru city is selected — explains that the AI Brief / Deal of Day / Bengaluru-curated micro-market notes stay anchored on Bengaluru until verified feeds + admin notes are configured for that city. No silent stale-data delivery.

Net diff: +222 / −27 across 4 files (1 new — `useTheme` hook, ~30 lines, reusable for any future asset-swap-on-theme need). No new dependencies. CI all green; merged.

### Cumulative session totals (entire 2026-05-07)

- **5 PRs merged** (#147, #148, #149, #150, #151).
- **0 new dependencies** added across the day.
- **AI telemetry coverage**: 100% (was: missing `export_insights` and `embedding`).
- **Orphan endpoints closed**: 3 (`/comps/ranked/:dealId`, `/comps/score/:dealId/:compId`, `/exports/comps`).
- **Hard-rule violations closed**: 1 (AI disclaimer on Intelligence brief).
- **New design-system primitives**: 3 (`StalenessBadge`, `useTheme`, `CompsMap`).

### Operator actions required

None for #151 — it's UI/code-only.

---

## 2026-05-07 (Comps + Intelligence subsystem polish — wire orphans, staleness, map view, AI router cleanup)

Heavy bundle session. The starting point was an honest audit (in-chat) of every place LLMs are wired and the entire Comps + Market Intelligence subsystem. Audit found three categories of gap: orphaned features (similarity scorer + CSV export endpoint + AI disclaimer), invisible AI calls (two services bypassing the telemetry router), and visual debt on the user-facing surfaces. Three PRs landed in sequence to close the highest-leverage items.

**PR [#147](https://github.com/Rachit-Jain9/REDIP/pull/147)** — `feat(comps,intelligence): wire orphaned similarity scorer + class-aware staleness badges + CSV export`

- Deal Comps tab now consumes `/comps/ranked/:dealId` (the 6-factor similarity scorer that had been wired server-side for months but never surfaced in the UI). Each row carries a composite-score pill (toned by score, sparse-data honest); a small ⓘ-button opens a popover with each weighted factor (distance / asset_class / BHK / vintage / size / amenities) drawn as an animated 0→score bar plus the rate-vs-underwriting delta. `/comps/score/:dealId/:compId` hydrates the pinned-comp drawer.
- New `frontend/src/utils/staleness.js` + `frontend/src/components/common/StalenessBadge.jsx` primitives. Per-class half-lives (residential listings 7d, IPC reports 90d, macro KPIs 60d, market transactions 30d). Stale rows pulse subtly via `motion-safe:animate-pulse` and collapse to instant on `prefers-reduced-motion`.
- Aggregate worst-case staleness summary lands in every benchmark section header on IntelligencePage (Section 5 + 5a/b/c/d + Section 6 + Macro KPI strip). Per-row staleness badges land next to source pills on the top-nav Comps page.
- The orphan `/exports/comps` CSV endpoint is now wired into the Comps page header with a date-stamped filename (`redip-comps-YYYY-MM-DD.csv`).
- Closed the only hard-rule violation in the AI surfaces audit: the daily Claude brief on IntelligencePage now carries the mandated `AI-assisted · review before relying` chip per CLAUDE.md.
- Net diff: +808 / −109 across 5 files. New StalenessBadge chunk is 1.58 KB gzipped. CI all green; merged.

**PR [#148](https://github.com/Rachit-Jain9/REDIP/pull/148)** — `chore(ai): route export.insights + embeddings through aiRouter — close telemetry bypasses`

- Two services were importing directly from `providerRegistry`, skipping `ai_call_logs`, the daily cost cap, and the routing-config table. PR closes both.
- Added `runOpenAIEmbedding` wrapper to `aiRouter.js` (it was missing). `embeddings.service.js` swapped its import target. `export.insights.service.js` now uses `task: 'export_insights'` so the cost dashboard splits this column off from `'reasoning'`, and stamps `dealId` + `organizationId` into the `attach` payload for full lineage.
- Test mock in `embeddings.service.test.js` updated to mock `aiRouter` instead of `providerRegistry` (the new module boundary).
- 100% AI telemetry coverage restored. No user-visible change. Net diff: +58 / −12 across 4 files. CI all green; merged.

**PR [#149](https://github.com/Rachit-Jain9/REDIP/pull/149)** — `feat(comps,intelligence): map view + bidirectional row↔marker select + editorial chrome polish`

- Comps page gains a Map | Table view toggle (segmented, persisted in `localStorage`). Split mode renders a 2-column grid: filterable table left, leaflet map right with `CartoDB.Positron` tiles and markers colored by `data_type` (verified emerald · listing blue · IPC violet). Sticky map column so it stays in view while the table scrolls.
- Bidirectional selection: click a row → map flies to marker (400ms leaflet ease, matches FRONTEND_GUIDELINES); click a marker → table jumps to that page + scrolls + highlights row.
- Map carries a floating legend with source-mix counts and an "ungeocoded N rows" reminder when the table contains rows the map can't plot. Selected-comp inset card mirrors the row identity.
- Map chunk lazy-loaded (`React.lazy` + Suspense) so the table-only default path doesn't pay leaflet's ~155 KB cost.
- Editorial polish addressing standing "plain and boring" feedback: type pill swapped from saturated chip-soup to neutral chrome + accent dot; table headers tightened to `text-[10px] tracking-[0.08em]` muted; rows are click-targets with primary-tint + ring-inset selection; IntelligencePage AI Brief panel rebuilt with editorial chrome (neutral surface + 1px gradient accent stripe); SectionCard headers gained icon-in-tile pattern + hover:shadow-md lift.
- Net diff: +430 / −26 across 3 files (1 new). CI green; pending merge as of session end.

### Cumulative session totals

- **3 PRs opened** (2 merged + 1 pending CI completion).
- **No new dependencies** — no framer-motion add despite richer motion (used CSS transitions); no leaflet add (already there for MapPage).
- **AI telemetry coverage**: 100% (was: missing `export_insights` and `embedding`).
- **Orphan endpoints closed**: 3 (`/comps/ranked/:dealId`, `/comps/score/:dealId/:compId`, `/exports/comps`).
- **Hard-rule violations closed**: 1 (AI disclaimer on Intelligence brief).

### What's left to do

Tier 0 (next 2-4 weeks):
1. **Broker / IPC report Gemini extraction → review queue → comps commit pipeline**. The single biggest data-moat unlock. Reuse `extraction.service.js` machinery with new `broker_quote` + `ipc_report` doctypes. Email forwarding (`ingest@redip` → Postmark webhook) is the lower-friction first surface; WhatsApp Business API needs Meta verification + DPDP consent flow (4-6 weeks).
2. **Reviewer queue UI** — split-pane source-PDF + editable structured fields, keyboard-driven approve/reject. Build before scaling ingestion (reviewer throughput is the real bottleneck).

Tier 1 (4-10 weeks):
3. **Multi-city activation** on IntelligencePage — replace hard-coded `Bengaluru` selector with a city dropdown. Schema is already multi-city-ready.
4. **Plotted-development + villas + redevelopment + mixed-use schema + UX** with class-specific metrics (plot-rate vs. saleable-rate, FSI premium, society-consent %).
5. **Post-hoc numerical verifier** — extract numbers from AI narratives, assert against deterministic snapshot, flag drift as review item.
6. **Cross-document inconsistency detector** — sale-deed seller vs. EC seller, sanctioned-plan FAR vs. layout approval, RERA project status vs. on-site approvals. Writes to `ai_artifacts.risk_brief` (the type already exists, just unwired).

Tier 2 (10-20 weeks):
7. **Narrow Deal Q&A agent** — single-tool (`searchEvidence`), human-approved before action, mandatory citation to `evidence_facts.id`. Activates the dormant tool registry safely.
8. **Risk synthesis + IC memo** writing to existing `ai_artifacts` types (`risk_brief`, `ic_memo`).
9. **PPTX/PDF tear-sheet export of Intelligence dashboard** at city scope.
10. **GPT-5.4 A/B harness** on parcel narrative + export insights with held-out 30-deal hallucination + tone-regression scoring before any wider model swap.

### Operator actions required

None for these PRs — they are all UI/code-only. The Q1 2026 benchmark migration was already applied in the prior session (2026-05-05).

---

## 2026-05-05 (Q1 2026 Comps + Market Intelligence refresh — 4-asset-class expansion)

Refreshed Comps and Market Intelligence end-to-end using verified Q1 2026 sources (99acres locality data, Cushman & Wakefield Bengaluru MarketBeat Q1 2026, JLL India Q4 2025, Knight Frank APAC Prime Office Q1 2026, Horwath HTL Hotel Market Review 2025, ICRA, Mordor Intelligence, CBRE India Market Monitor Q1 2026). Inputs: a `redip_bengaluru_micro_market_rates_v0_2_2026Q1.csv`/`.json` data pack and a long-form `COMPS_REDIP-Claude.docx` rate card.

**Migration applied** (`20260505_market_data_q1_2026_refresh.sql` — split-applied via Supabase MCP):

- **Schema**: added `source`, `source_url`, `data_type`, `qoq_change_pct`, `sro_rate_per_sqft`, `as_of_date`, `notes` to `micro_market_benchmarks`; switched its unique constraint to include `data_type`. Added `source_url` + `as_of_date` to `market_transactions`. Added `source_url`, `data_type`, `as_of_date`, `yoy_change_pct`, `sro_rate_per_sqft` to `comps`.
- **New tables**: `office_market_benchmarks`, `retail_market_benchmarks`, `industrial_market_benchmarks`, `hospitality_market_benchmarks`, `market_macro_kpis` — all org-scoped with proper as-of unique constraints.

**Data refreshed (Bengaluru only — India-first per CLAUDE.md):**

- `micro_market_benchmarks`: 8 → **38 rows** (30 × 99acres listings + 8 × Cushman & Wakefield IPC calibration). Each row carries source URL, SRO transaction rate, YoY range, anchor hub.
- `office_market_benchmarks`: 0 → **39 rows** (9 IPC zones with vacancy + stock-weighted rent + 30 submarkets with Grade A/B bare-shell ranges + YoY).
- `retail_market_benchmarks`: 0 → **21 rows** (12 high-street corridors with QoQ + YoY + 9 Grade A malls).
- `industrial_market_benchmarks`: 0 → **20 rows** (5 industrial rents + 5 warehouse rents + 10 serviced industrial land ₹mn/acre).
- `hospitality_market_benchmarks`: 0 → **13 rows** (citywide + airport ADR/Occ/RevPAR + 11 submarket × segment ADR ranges).
- `market_macro_kpis`: 0 → **18 rows** (24.1 MSF leasing, 14% prime rent growth #1 APAC, 49,252 launches, 8.1% vacancy, ₹93.6/sf/mo city Grade A, ICRA hotel ADR, Mordor 203→398 MW DC forecast, USD 5.1bn Q1 2026 capital flows, etc.).
- `market_transactions`: 28 → **29 rows** (added Q1 2026 CBRE capital flows record). Existing 28 transactions remain (Brookfield BIRET ECOWORLD ₹13,125 cr, Embassy GolfLinks ₹852 cr, Puravankara Anekal ₹4,800 cr, etc.).

**Backend (no breaking changes):**

- `intelligence.service.js`: added `getOfficeBenchmarks`, `getRetailBenchmarks`, `getIndustrialBenchmarks`, `getHospitalityBenchmarks`, `getMacroKpis`. Extended `getMicroMarketBenchmarks` with optional `dataType` filter and listing-first ordering.
- `intelligence.routes.js`: added GET `/intelligence/office-benchmarks`, `/retail-benchmarks`, `/industrial-benchmarks`, `/hospitality-benchmarks`, `/macro-kpis`.

**Frontend:**

- `IntelligencePage.jsx`: added Bengaluru Q1 2026 macro KPI strip (18 tiles, 6-up grid), expanded Section 5 residential benchmarks with `Listing/IPC/All` filter chips + source-link column + SRO column + YoY badging, and added new Sections 5a–5d for Office/Retail/Industrial/Hospitality with verified IPC data and clickable source URLs.
- `CompsPage.jsx`: added YoY column, Range column, source-link badge column with tone mapping by `data_type` (verified, listing, IPC).
- `useIntelligence.js` + `services/api.js`: added 5 new hooks/endpoints for asset-class benchmarks.

**Validation:**

- Frontend `npm run build` clean (30s). Backend `npm test` 856/856 passing.
- Spot-checked DB: top-5 by max price = MG Road CBD ₹22–50K, Indiranagar ₹18–28K (+71% YoY listings), Rajajinagar ₹18–28K, Koramangala ₹17–25K, Old Airport Rd ₹18–25K — matches the COMPS doc exactly.

**Migration file**: `database/migrations/20260505_market_data_q1_2026_refresh.sql` (471 lines, idempotent — uses `ADD COLUMN IF NOT EXISTS`, `DROP/ADD CONSTRAINT` guarded, `DO $$` block resolves first org for backfill).

**Plain-English recap:**

- The Comps page now shows YoY price change, a high–low range, and a clickable source badge (99acres, Cushman & Wakefield IPC, internal benchmark) on every row — so analysts can tell at a glance whether a number is a listing signal or a verified transaction comp.
- Market Intelligence opens with a Bengaluru Q1 2026 macro strip (24.1 MSF leasing, +14% prime rent growth, 49,252 launches, USD 5.1bn capital inflows, etc.) and adds four new sections: Commercial Office (vacancy + rent for 9 IPC zones and 30 submarkets), Retail (12 high-street corridors + 9 Grade A malls), Industrial / Warehouse / Serviced Land (rents + ₹mn/acre by submarket), and Hospitality (ADR/Occ/RevPAR by submarket × segment).
- The residential benchmark table grew from 8 generic markets to 38 with proper sources — 30 micro-markets from 99acres (with SRO transaction rates) plus 8 Cushman & Wakefield IPC calibration rows for high-end and mid-segment zones. Filter chips switch between listing-portal benchmarks and IPC ceilings.
- Why it matters: REDIP's underwriting layer can finally cross-check listing prices against IPC benchmarks and SRO transaction rates side-by-side, with traceable sources on every number — exactly the credibility bar an India-first deal-intelligence platform needs.

---

## 2026-05-05 (Mumbai migration finalized + AI model defaults bumped)

Picked up where 2026-05-04 left off. Completed the Tokyo→Mumbai cutover and refreshed AI model defaults to current frontier-tier IDs.

**What landed:**

- **Mumbai data load completed via REST script** (`backend/migrate-runner.mjs`). All public-schema tables migrated row-for-row. Storage migration (18 blobs, ~80 MB) confirmed.
- **Vercel `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_KEY` flipped to Mumbai.** Production redeployed.
- **Post-migration sequence reset** — fixed login flow which was throwing `23505 unique_violation` ("A record with this information already exists") because bigserial sequences in Mumbai stayed at 1 after explicit-id INSERTs. One `DO $$ ... pg_get_serial_sequence ... setval ... $$` block aligned ~30 sequences across `public` + `regulatory_data`. Login confirmed working post-fix.
- **Pooler credential cache discovery**: Supabase pooler held the old Tokyo password for ~10 min after rotation. Pause + restore the project flushes the cache instantly. Documented in OPERATOR_HANDBOOK.
- **AI model defaults bumped** (commit `fe7754b`):
  - Gemini: `gemini-2.5-flash` → `gemini-3-flash-preview`
  - OpenAI: `gpt-4o-mini` → `gpt-5.4`
  - Claude: `claude-sonnet-4-6` (unchanged)
  - Cost table in `aiRouter.js` got matching entries. Defaults fall through to env vars (`GEMINI_MODEL` / `OPENAI_MODEL` / `CLAUDE_MODEL`) — instant rollback without code revert.

**What's left:**

1. Smoke test on prod (open a deal, run an AI extraction, replay a deal_event signature) with the new model defaults active.
2. Backfill `properties.zone_id` for the 2 affected rows (FK-cycle workaround skipped them on initial insert).
3. Once happy, ask the assistant to delete the Tokyo project. **NOT** auto-deleted — destructive, requires explicit go-ahead.

**Plain-English recap:**

- Site is now talking to the India-hosted database (Mumbai), not Tokyo. Faster for India users; cleaner story for compliance.
- Login works again — a sneaky bug after the data move ("a record with this info already exists") was caused by counter columns not catching up. Fixed in one SQL block.
- The platform's three AI brains got a refresh: Gemini 3 Flash for document reading, GPT-5.4 for general tasks, Claude Sonnet 4.6 unchanged for deep reasoning. We can dial any of them back via a single Vercel setting if anything misbehaves — no code change needed.

---

## 2026-05-04 (Region migration — Supabase Tokyo → Mumbai, ap-northeast-1 → ap-south-1)

User asked whether Supabase region was actually Mumbai (per OPERATOR_HANDBOOK) or USA (per Privacy Policy). Investigation showed it was neither — the live project was in **Tokyo** (`ap-northeast-1`, project `lsbhrbvuynzqhdtzczco`). User chose to migrate to Mumbai before locking in any more deal data.

**What landed:**

- New Supabase project `niamgjbxxgmmffggumvj` (REDIP-Mumbai) created in `ap-south-1`. Free tier, $0/mo.
- Full schema replayed: `database/schema.sql` (foundation, 3 chunks) + 45 of 46 migration files. The 46th file (`20260403_bengaluru_comps_seed.sql`) is a pure-INSERT seed that pre-dates multitenancy — skipped on purpose because comps data comes through the Tokyo dump.
- Out-of-band `public.investor_packages` table (no migration file) reverse-engineered from Tokyo's pg_catalog and recreated on Mumbai with identical FKs, indexes, RLS policies, trigger, and `investor_packages_touch()` function.
- Schema parity verified: 43 public tables + 14 regulatory_data tables match Tokyo bit-for-bit (table list).
- `investor-package` edge function deployed to Mumbai (verbatim copy from Tokyo).
- `redip-documents` storage bucket created on Mumbai (private, matching Tokyo config).
- ~30% of public-schema rows migrated via MCP (users, organizations, members, properties, deals, deal_stage_history, financials partial, legal_documents, refresh_token_grants, etc.). Stopped because heavy JSONB columns (financials.model_params is 65 KB per row) blow past tool-output budgets.
- Wrote `scripts/migrate-tokyo-to-mumbai.mjs` — self-contained Node.js script using `pg` + `@supabase/supabase-js` (both already in `backend/package.json`). Runs idempotently against both Postgres connections, sets `session_replication_role = replica` on Mumbai during inserts so FK order doesn't matter, then re-fires the lat/lng → geom trigger on properties. Also migrates all 18 storage blobs (~80 MB) via service_role-keyed download/upload.
- Post-migration RLS audit caught the prior subagent had left RLS *disabled* on 8 tables (4 auth tables + 4 regulatory_data tables) plus a leftover `_mig_staging` table and `_mig_load` function. Fixed via migration `post_migration_rls_restore_and_cleanup`. Mumbai security advisors now clean (only known PostGIS-permanent items remain, same as Tokyo).
- Privacy Policy v2 updated: Supabase row now reads "India (South Asia, Mumbai — `ap-south-1`)" instead of "USA".
- OPERATOR_HANDBOOK §2 status table, `database/current_schema.sql` manifest comment, `docs/PARCEL_INTELLIGENCE_DECK.md` tech-stack table, and `TODO_MANUAL.md` migration history updated to point at Mumbai project ID.

**What's left (user-side, in order):**

1. Fetch both DATABASE_URLs (Supabase dashboard → each project → Settings → Database → Connection string → URI) and both service_role JWTs (Settings → API).
2. Set `TOKYO_DATABASE_URL`, `MUMBAI_DATABASE_URL`, `TOKYO_SUPABASE_KEY`, `MUMBAI_SUPABASE_KEY` env vars.
3. Run `cd backend && node ../scripts/migrate-tokyo-to-mumbai.mjs`. Should complete in 2–5 minutes; reports per-table count match.
4. Update Vercel env vars: `SUPABASE_URL` → `https://niamgjbxxgmmffggumvj.supabase.co`, `SUPABASE_KEY` (service_role) → Mumbai's service_role JWT, `DATABASE_URL` → Mumbai's connection string. Redeploy.
5. Smoke test on prod URL: log in, open a deal, verify documents list + financials render, run an AI extraction, replay a deal_event signature.
6. Once confirmed live: ask the assistant to delete the Tokyo project. **NOT** auto-deleted — destructive, requires explicit go-ahead.

**No PRs opened.** All file edits are uncommitted on the working branch — user will commit alongside the env-var flip.

---

## 2026-05-04 (Speed sprint — 8 PRs in one session: UI polish through tool registry foundation — PRs #159–#166)

User asked to ship the entire highest-value + medium-value + UI polish backlog in one shot. Eight PRs landed:

**PR #159 — UI polish (U1 + U3)**
- Migrated remaining 8 LoadingSpinner content-load usages to skeletons
  (DDTab, RiskTab, DocumentsTab, CompsTab, ActivityTab, DefaultsInspector,
  ParcelIntelligenceAdminPage). App.jsx Suspense fallback + MapCanvas tile-
  load spinner kept (right tool for those cases).
- Baked count-up animation into MetricTile primitive: when `value` is a
  finite number AND `format` is supplied, runs `useCountUp` (600ms cubic
  ease-out, prefers-reduced-motion respected). One primitive change unlocks
  count-up on every existing MetricTile site without touching call sites.

**PR #160 — `ai_routing_config` table (Tier 2.3)**
- Migration: new `ai_routing_config` table (task PK + provider/model/
  fallback). RLS admin-only writes. Seeded with 5 default tasks.
- Service: 60s in-memory cache; admin updates propagate within one window.
- aiRouter consults the runtime table when no provider is pinned.
- Admin routes: GET/PUT `/api/admin/ai-routing[/:task]`.
- Empirical OpenAI-vs-Claude A/B testing now possible with one curl PUT.

**PR #161 — OpenTelemetry-shape tracing per AI call (Tier 2.2)**
- New `lib/aiTrace.js` — withAiSpan wrapper emits structured JSON log
  lines (ai.span.start / ai.span.end with attributes). 16-hex span_id
  per OTel spec; trace_id derived from request_id. Vercel runtime parses
  these natively; future @vercel/otel migration is a one-line swap.
- Span attributes: provider, model, latency_ms, total_tokens, cost_usd,
  attempts, cache_hit, call_id. Errors include error_code + error_message.
- trace_id + span_id mirrored into ai_call_logs.metadata.

**PR #162 — MFA / TOTP via authenticator app (Phase 2 hardening)**
- Migration: users.mfa_secret/enrolled_at/recovery_codes/last_used_at +
  mfa_challenges table.
- Backend: full RFC 6238 TOTP with otplib + qrcode. 8 sha256-hashed
  recovery codes, single-use. Login flow gains a challenge step when
  enrolled. Admin disable + retention sweep purges expired challenges.
- Frontend: MfaCard on Settings (idle / enrollment / enrolled), LoginPage
  swaps to 6-digit-code form when /auth/login returns mfaRequired.
- Required before paying customers. **C1 closed.**

**PR #163 — VirtualizedList primitive (U2)**
- New design-system primitive with auto-threshold (default 100 rows):
  below threshold renders inline; above virtualizes via @tanstack/
  react-virtual. Hook always invoked (rules-of-hooks). Optional empty
  state slot. Drop-in safe.
- No call-site wiring — existing tables paginate at ~50 rows; the
  primitive is ready for the day a workspace breaks 100+ rows.

**PR #164 + #165 — pgvector flagship (Tier 4.1, end-to-end)**
- Migration: `CREATE EXTENSION vector` + `document_embeddings` table
  (1536 dim, HNSW cosine index, RLS by org).
- Backend: embeddings.service (chunk → embed → store via OpenAI
  text-embedding-3-small; cosine k-NN search). Auto-indexes on every
  document extraction (Promise.resolve fire-and-forget — embedding
  failure never blocks extraction).
- New /api/search/semantic + /api/search/reindex routes.
- Frontend: SemanticSearchPanel mounted on the deal Documents tab.
  "Find similar clauses across the corpus" works today.

**PR #166 — Tool registry foundation (Tier 3.1 starter)**
- New services/ai/tools/index.js with three starter tools: getDeal,
  searchComps, searchEvidence (all read-tier).
- Permission tiers (read | compute | draft | approval-required) +
  invokeTool dispatcher. Zod-validated inputs, structured error codes.
- Full Deal Analyst persona + agent runner remain DEFERRED behind the
  ≥50-real-deals entry criterion in AI_ROADMAP §5. Registry pattern
  itself is reusable today.

**Verification across the 8 PRs:**
- Backend test suite: 762 → 856 (+94 tests, all green across 66 suites).
- Frontend test suite: 206 → 210 green.
- Production builds clean across all 8 PRs.
- Migrations applied: 4 (verified post-apply — see OPERATOR_HANDBOOK §4).

**Status — what's left in the entire roadmap:**
- Tier 1.2 (Gemini context caching) — DEFERRED (low ROI for REDIP's current architecture)
- Tier 2.1 (Vercel AI SDK migration) — DEFERRED (refactor with no new capability; bundle with Tier 3.2 when that ships)
- Tier 3.2/3.3/3.5 (full agent runner + Deal Analyst persona + Doc Q&A persona) — DEFERRED (entry criterion: ≥50 real deals)
- Tier 4.2 (field-level PII encryption) — DEFERRED (RLS + at-rest encryption adequate)
- Tier 4.3/4.5 (Bhashini + Tesseract Kannada) — DEFERRED until Gemini Indic quality dips
- Operator-only items (lawyer review, DPAs, domain, region check) — see OPERATOR_HANDBOOK §2

**Net for the platform:** every item from the user's "highest value", "medium value", and "UI polish" pending lists is now either shipped or explicitly deferred with rationale. The platform is in launch-ready state pending the operator items.

---

## 2026-05-04 (Account closure + scheduled erasure — DPDP §8(7) closed end-to-end — PR #158)

**What was worked on in plain English:**
- Users can now close their own account from the Settings page. A bright "Close my account" card with red trim sits at the bottom; clicking opens a confirm modal that requires typing CLOSE to proceed (the standard pattern for irreversible actions). Once confirmed, the user is logged out everywhere immediately, future logins are blocked, and the platform schedules anonymization of personal data (name, email, phone, password) for 90 days later.
- The 90-day window matches what the Privacy Policy promised. Until tonight, the policy was prose only — there was no mechanism in code to track "when was this account closed" or "when should it be erased". The Daily retention sweep cron now picks up closed-and-stale accounts and anonymizes them automatically. Deal records, audit events, and AI call logs the user produced are preserved (the platform owns evidentiary records) but stripped of identifying fields.
- Logged-in sessions on closed accounts: the JWT is short-lived (15 min), and all refresh tokens are revoked at the moment of closure. So even if a closed-account user has a stale tab open, the next API call drops them.

**PRs opened/merged:**
- PR #158 — `feat(privacy): account closure + scheduled erasure (DPDP §8(7))` — squash-merged.

**Verification:**
- Backend test suite: **784 → 796** (+12 covering: idempotent close on existing account, refresh-token revocation, throws on missing user / already-erased, fail-open on revoke failure, erasure SQL shape + grace-window predicate, fallback when email_normalized column missing, retention sweep aggregates closed-account row, sweep partial-failure resilience).
- Frontend test suite: 206/206 green.
- Production builds: clean.
- Migration `20260511_account_closure.sql` applied to prod via Supabase MCP. Verified post-apply: 2 new user columns, 1 partial index.

**What's left:**
- Tier 2.3 — `ai_routing_config` table (runtime provider switching).
- Tier 2.1 — Vercel AI SDK migration.
- Tier 2.2 — OpenTelemetry tracing per AI call.
- Tier 3 — Agentic layer (deferred until Tier 2 ships).
- Tier 4 — pgvector + embeddings / PII encryption / Indic NLP.
- MFA / TOTP for paying-customer onboarding.

---

## 2026-05-04 (Language + doctype telemetry tagged at extraction time — PR #157)

**What was worked on in plain English:**
- The empty rows in the AI usage dashboard's "By Doctype × Language" table now populate. Every document extraction call tags itself with the document type (sale deed, RTC, RERA registration, etc.). Every Claude normalization call also tags the detected language (English, Kannada, Hindi, Tamil, Telugu, or "mixed"). Result: the dashboard answers "are our Kannada extractions reliable?" with a single look.
- Built a tiny script-based language detector that reads the first 4,000 characters of an extracted document and counts how many letters belong to each Unicode script. It's not a full ML language identifier — it doesn't need to be, because we're tagging metrics, not making decisions. It correctly handles mixed-script Bengaluru documents (typical land deed: half Kannada, half English) by tagging them as "mul" (mixed).
- Recommendation on the OpenAI-vs-Claude question, in writing: don't do a wholesale swap. Claude is materially better for institutional-grade analytical writing (deal memos, risk briefs); OpenAI is already wired up for embeddings and as a fallback. The next runtime-routing PR (Tier 2.3) will let you A/B test side-by-side without code changes.

**PRs opened/merged:**
- PR #157 — `feat(ai): language + doctype telemetry tagged at extraction time` — squash-merged.

**Verification:**
- Backend test suite: **773 → 784** (+11 covering: English / Hindi / Kannada / Tamil script majority detection, mixed Kannada+English → 'mul', empty / short / numeric-only / non-string → 'und', sample cap perf-safety on 100k-char input, Latin with occasional Indic word still resolves to 'en').
- Frontend production build: clean.
- No new migration; columns from PR #155 are now actively populated.

**What's left:**
- Tier 2.3 — `ai_routing_config` table (runtime provider switching for empirical OpenAI-vs-Claude comparison).
- Tier 2.1 — Vercel AI SDK migration.
- Tier 2.2 — OpenTelemetry tracing per AI call.
- Tier 3 — Agentic layer (deferred until Tier 2 ships).
- Tier 4 — pgvector + embeddings / PII encryption / Indic NLP.
- MFA / TOTP for paying-customer onboarding.
- User-data erasure cron for full DPDP §8(7) closure.

---

## 2026-05-04 (Migration verified + in-platform AI usage dashboard — PR #156)

**What was worked on in plain English:**
- The Settings page now shows the platform's own AI usage dashboard (admin / analyst / owner only). It surfaces what Anthropic and Google's billing dashboards cannot — cost broken down by task and provider, cache hit rate, prompt-cache savings, retry recovery rate, p95 latency, and per-doctype quality breakdown. All read-only; org-scoped via existing RLS so each workspace sees only its own usage.
- Pick a window: last 7 / 30 / 90 days. Switching the window re-queries; a manual refresh button is available too.
- Confirmed the operator-applied migration landed cleanly: `ai_artifacts` table exists, RLS is on with all three policies, and the new `language` / `doctype` columns on `ai_call_logs` are present.

**PRs opened/merged:**
- PR #156 — `feat(admin): in-platform AI usage dashboard on Settings page` — squash-merged.

**Verification:**
- Backend test suite: **762 → 773** (+11 covering: zero-rows summary, cache-hit-rate decimal precision, fail-open on query failure, Date object → ISO formatting, days clamp [1, 365], default 30-day window).
- Frontend production build: clean.
- Migration verified post-apply via SQL: `to_regclass('public.ai_artifacts')` returns the table, `relrowsecurity = true`, 3 RLS policies, 4 indexes, 2 new ai_call_logs columns.
- No new migration; no env-var change.

**What's left:**
- Tier 1.2 (Gemini context caching for master-plan corpus) — only Tier 1 item still scoped, but probably low-value given REDIP doesn't currently attach a single huge reference corpus to extraction calls.
- Tier 2 — Vercel AI SDK migration / OpenTelemetry / `ai_routing_config` table.
- Tier 3 — agentic layer (deferred until Tier 2 ships).
- Tier 4 — pgvector + embeddings / PII encryption / Indic NLP.
- MFA / TOTP for paying-customer onboarding.
- User-data erasure cron for full DPDP §8(7) closure.

---

## 2026-05-04 (Persisted AI Deal Analysis + log telemetry dimensions — PR #155)

**What was worked on in plain English:**
- Once an AI Deal Analysis is generated, it now sticks around. Re-opening a deal page shows the last analysis instantly instead of making the user click "Generate Analysis" again. Press "Refresh" to regenerate from scratch — that's the only way to invalidate.
- The platform tracks a fingerprint of the inputs (financials, comps, market data) that produced each analysis. If those underlying numbers change, the next fetch is a "miss" and the analysis is regenerated automatically. The cache invalidates itself on real changes — no stale memos.
- Added two more dimensions to the AI call log: `language` and `doctype`. These let future cost/quality dashboards answer questions like "what's our Kannada title-deed extraction quality this month?" with a single SQL group-by, instead of digging through JSON.

**PRs opened/merged:**
- PR #155 — `feat(ai): persist deal analysis as ai_artifacts + add language/doctype columns to ai_call_logs` — squash-merged.

**Verification:**
- Backend test suite: **745 → 762** (+17 covering: snapshot-hash determinism + key-order independence, fail-open on missing table / connection error / unknown artifact type, save/getLatest happy path).
- Frontend test suite: 206/206 green (existing OverviewTab test updated to mock the new `getCachedDealAnalysis` shape).
- Production builds: clean.

**Operator action required:**
- Apply migration `database/migrations/20260510_ai_artifacts_and_log_dimensions.sql` via Supabase SQL editor. **Until applied, the feature fails-open** — live generation still works; cached re-fetch returns null. After the migration runs, cached re-fetch unlocks and AI calls start populating language/doctype.

---

## 2026-05-04 (Streaming for AI Deal Analysis — PR #154)

**What was worked on in plain English:**
- Clicking "Generate Analysis" on a deal page used to mean waiting ~30 seconds while Claude wrote its 240-word analysis behind the scenes — the page just sat there with a spinner. Now the text starts appearing within a second and types out word-by-word as Claude writes it. Even though the underlying call still takes 30 seconds total, the user sees content on screen the whole time.
- Added a "Cancel" button. If the user clicks Cancel mid-generation, the streaming connection closes and the platform stops paying for tokens nobody will read. Without this, a Cancel just hid the text but Claude kept generating.
- The full AI cost / token / latency record still lands in the audit log when the stream finishes — caching, retries, and cost-cap all still apply. Streaming is purely a UX win, not a guardrails compromise.

**PRs opened/merged:**
- PR #154 — `feat(ai): SSE streaming for AI Deal Analysis (Tier 1.3)` — squash-merged.

**Verification:**
- Backend test suite: **741 → 745** (+4 covering streaming provider: text-event dispatch, cachePrompt wrapping, throwing-listener resilience, idempotent abort).
- Frontend test suite: 206/206 green (existing OverviewTab test updated to mock new `streamDealAnalysis` shape).
- Production builds (frontend + backend): clean.
- No migration; no env-var change.

**What's left for Tier 1:**
- 1.2 Gemini context caching for the master-plan corpus — only Tier 1 item still scoped.

**Tier 2 (next-up phase):**
- 2.1 Vercel AI SDK migration
- 2.2 OpenTelemetry tracing per AI call
- 2.3 `ai_routing_config` table — runtime-editable task→provider map

---

## 2026-05-04 (OpenAI as third provider + Zod validation at provider boundary — PR #153)

**What was worked on in plain English:**
- The platform now has three AI providers wired up, not two. Google Gemini is still the default for reading documents (it's natively multimodal — best at PDFs, images, mixed-script Indian docs). Claude is still the default for reasoning. OpenAI is now available as a third option for: emergencies if both others are down, future "find similar past clauses" semantic search, and optional comparison testing. **Nothing routinely changes** — your day-to-day Gemini and Claude calls work exactly as before.
- Added a new safety net: when an AI call is supposed to return structured data (like the document classifier), the platform now validates the response against a strict shape contract. If the AI returns malformed JSON or a missing field, the platform either re-asks the AI (one shot) or falls back to a safe default ("other" doctype, surfaces to manual review). Until tonight, a malformed response would crash with an opaque parse error.
- The document-classifier specifically now uses this safety net. A weird Gemini response no longer kills an upload — the doctype just defaults to "other" and the user picks it on the review queue.

**PRs opened/merged:**
- PR #153 — `feat(ai): OpenAI as third provider + Zod validation at provider boundary (Tier 1.4 + 1.5)` — squash-merged.

**Verification:**
- Backend test suite: **717 → 741** (+24 covering: OpenAI client lazy init, Anthropic-shape usage translation, embedding wiring with batch input + custom dimensions, Zod schema parse + validate, fence stripping, reprompt-on-failure flow, StructuredOutputError diagnostic carrying).
- Frontend production build: clean.
- No migration; no env-var change beyond the `OPENAI_API_KEY` you provisioned in Vercel.

**What's left for Tier 1:**
- 1.2 Gemini context caching for the master-plan corpus
- 1.3 Streaming for IC memo generation (SSE) — biggest user-felt latency win

**OpenAI use-cases now unlocked (not active until called):**
- Embeddings via `runOpenAIEmbedding` for the future pgvector layer (Tier 4.1)
- Reasoning via `runOpenAIReasoning` for fallback chains or A/B testing
- Cost table extended with `text-embedding-3-small` ($0.02/M) and `text-embedding-3-large` ($0.13/M) entries

---

## 2026-05-04 (AI roadmap integration + Anthropic prompt caching — PR #152)

**What was worked on in plain English:**
- The roadmap for everything AI in REDIP — what's already built, what's next, what we're deliberately NOT building, and what each tier looks like — is now a single canonical document at `docs/AI_ROADMAP.md`. External advice (e.g. ChatGPT's "use agentic AI" framework) is filtered against what REDIP already does so we don't accidentally re-build things.
- Shipped Tier 1.1 of that roadmap: Anthropic's prompt caching is now on for the five reasoning calls where the system prompt is identical across requests (extraction normalization, daily market brief, per-deal analysis, parcel verdict narrative, deal-export insights). The first call within a 5-minute window pays a 25% surcharge; every subsequent call pays 10% of the input price for the cached portion. Net: ~80% input-token cost reduction on hot reasoning paths.
- The cost ledger now records `cache_creation_input_tokens` + `cache_read_input_tokens` + a `prompt_cache_used` flag in each AI-call-log row's metadata. The future cost dashboard can split paid-vs-cached input.

**PRs opened/merged:**
- PR #152 — `feat(ai): integrate AI_ROADMAP.md + Anthropic prompt caching on stable prefixes (Tier 1.1)` — squash-merged.

**Verification:**
- Backend test suite: **707 → 717** (+10 covering: providerRegistry default-vs-cached system shape, runClaudeWithDocument cache wiring, error paths; aiRouter extractTokenUsage with/without cache_*).
- Frontend production build: clean.
- No migration; no env-var change.

**What's left for Tier 1:**
- 1.2 Gemini context caching for the master-plan corpus
- 1.3 Streaming for IC memo generation (SSE)
- 1.4 Zod validation at provider boundary

See `docs/AI_ROADMAP.md` for the full tier framework.

---

## 2026-05-04 (Consolidate AI retry at router layer — PR #151)

**What was worked on in plain English:**
- After PR #149 added retry to the AI router, the document-extraction code still had its own (older) retry loop wrapped around the same calls. That meant a Gemini failure was retried up to 9 times before falling back to Claude — wasteful and slow. Now retry happens in exactly one place (the router), with the same 3-attempt budget. Total attempts went from up-to-9-then-Claude to 3-then-Claude.
- Made the retry classifier smarter: it now also recognises Gemini's error messages even when the underlying error code got lost in translation through the SDK ("RESOURCE_EXHAUSTED", "high demand", embedded HTTP codes, etc.). The classifier still refuses to retry permanent errors (auth, validation, content policy) — even if they happen to mention something that *looks* transient.
- Net result: cleaner code (one retry path instead of two), faster recovery (the new backoff is 250ms→500ms→1s instead of 1.5s→4s), no behavior loss.

**PRs opened/merged:**
- PR #151 — `refactor(ai): consolidate retry at router layer; remove duplicate extraction loop` — squash-merged.

**Verification:**
- Backend test suite: **702 → 707** (+5 net: +16 new message-string classifier cases in aiRetry, -11 cases moved out of extractionFallback now that the retry classifier lives in one place).
- Frontend production build: clean.
- No migration; no env-var change.

**What's left:**
- Vercel AI SDK migration (S16) — larger bet.
- OpenTelemetry tracing per `routeAi` call.
- Zod validation at provider boundary for structured outputs.
- Streaming for long Claude calls (IC memo).
- pgvector for semantic search (Phase 4).

---

## 2026-05-04 (Skeleton loading migration to 7 high-traffic pages — PR #150)

**What was worked on in plain English:**
- Seven of the most-visited pages — opening a deal, the financial engine, market intelligence, comps, properties, reports, and the deal-compare view — now show a soft outline of the page that's loading instead of a single spinning circle. When real data lands, nothing jumps. The whole platform feels markedly faster on first paint, even though the underlying load times haven't changed.
- This continues PR #148's Dashboard/Deals work. Each page's skeleton is shaped like its real content — a deal page shows the back-nav + hero header + KPI strip + tab body shape; the financial engine shows the input panel + DCF summary shape — so the layout doesn't reflow when the data arrives.
- Reduced-motion users (browser setting) see a calm static placeholder. Same readability, no animation.

**PRs opened/merged:**
- PR #150 — `feat(ui): skeleton loading migration to 7 high-traffic pages` — squash-merged.

**Verification:**
- Frontend test suite: **206 tests, all green** (no new tests; pages migrated mechanically).
- Production build: clean.
- 9 LoadingSpinner usages remain (deal tabs + DefaultsInspector + MapCanvas + ParcelIntelligenceAdminPage). They migrate organically with feature work — none are page-level entry points anymore.

**What's left for Phase 2 polish:**
- Remaining 9 LoadingSpinner usages in nested components (deal tabs, financials inspector, map canvas).
- Table virtualization for review queue + comp lists when row counts cross 100.
- Count-up animation on KPI value changes is partial; widen coverage.

---

## 2026-05-04 (AI provider retry with exponential backoff — PR #149)

**What was worked on in plain English:**
- Until tonight, if Gemini sneezed (server error, rate-limit, network blip), the entire extraction failed and the user had to click "Re-extract" themselves. Now the system automatically tries again — up to three attempts, with sensible delays between them — before giving up.
- The retry policy is conservative on purpose. If the AI says "your API key is wrong" or "this content violates policy," we DON'T retry — those are real errors, retrying just burns money. We only retry on signals that clearly say "try again later" (server errors, rate limits, network drops, timeouts).
- Every successful call now records how many attempts it took. If a call recovered after a retry, that fact is logged. Over time this gives us a leading indicator of provider health: "Gemini's retry rate jumped 4× yesterday" is visible in the AI call logs without anyone having to dig.

**PRs opened/merged:**
- PR #149 — `feat(ai): provider retry with exponential backoff (5xx/429/network only)` — squash-merged.

**Verification:**
- Backend test suite: 683 → **702** (+19 covering classifier truth-table for 5xx/429/4xx/network/timeouts, exponential backoff math, jitter bounds, retry exhaustion, recovery after retry, custom classifier override, onRetry hook, hook-throws-doesn't-abort).
- Frontend production build: clean (no frontend change in this PR).
- No migration; no env-var changes (retry is on by default; pass `retry: { enabled: false }` to opt out).

**What's left for Phase 3:**
- Provider fallback chain (Gemini fails terminally → try Claude with same document). Pairs cleanly with retry: retry handles transients, fallback handles "this provider is down for the day."
- Vercel AI SDK migration (S16) — still on the table.
- OpenTelemetry tracing per `routeAi` call.
- Zod validation at provider boundary for structured outputs.
- Streaming for long Claude calls (IC memo).

---

## 2026-05-04 (Skeleton loading states — design-system primitive + Dashboard/Deals — PR #148)

**What was worked on in plain English:**
- Loading the Dashboard and the Deals list used to show a single spinning circle in the middle of the screen. Now you see a ghost outline of the page that's coming — the four KPI tiles, the two charts, the table rows — pulsing gently. When the data lands, nothing jumps. The page feels twice as fast even though it isn't.
- This is the standing FRONTEND_GUIDELINES.md rule ("skeletons not spinners for any load > 100ms") finally applied to the two highest-traffic pages. Other pages still use spinners and will be migrated in follow-up PRs as they're touched.
- The shimmer animation respects `prefers-reduced-motion` — users with that browser setting see a calm static placeholder, no animation.
- Built six reusable primitives: `Skeleton`, `SkeletonLine`, `SkeletonHeading`, `SkeletonKpi`, `SkeletonCard`, `SkeletonTableRow`, `SkeletonList`. Future loading-state work just imports the right one.

**PRs opened/merged:**
- PR #148 — `feat(ui): skeleton loading primitives + Dashboard/Deals migration` — squash-merged.

**Verification:**
- Frontend test suite: 197 → **206** (+9 covering all six skeleton variants).
- Production build: clean (no bundle-size regression beyond the new primitive file).
- Visual: confirmed both light + dark themes shimmer correctly via the theme-flip CSS.

**What's left for Phase 2 polish:**
- Remaining 33 LoadingSpinner usages across pages/components — migrate as they're touched in feature work, not in a single big-bang PR.
- Table virtualization for review queue + comp lists when row counts cross 100 (perf rule from FRONTEND_GUIDELINES).
- Count-up animation on KPI value changes is partial; widen coverage.

---

## 2026-05-04 (Daily retention sweep cron — PR #147)

**What was worked on in plain English:**
- Every night at 03:35 UTC, the platform now does its own housekeeping. Expired AI cache rows, dead refresh tokens past their forensic window, stale login-attempt records, and AI call logs older than 12 months are deleted automatically. Until tonight, those tables grew forever — the Privacy Policy promised 12-month AI-log retention but nothing actually enforced it.
- This is the code-level enforcement of the retention promises in Privacy Policy §7 and the DPDP Act 2023 §8(7) ("erase personal data once the purpose is fulfilled"). What was prose is now policy.
- A single failing query no longer aborts the whole sweep — each table is purged in its own try/catch, and the cron summary surfaces per-table errors so a quietly-failing cleanup is visible in Vercel logs.

**PRs opened/merged:**
- PR #147 — `feat(retention): daily retention sweep cron (DPDP §8(7) / Privacy Policy §7)` — squash-merged.

**Verification:**
- Backend test suite: **676 → 683** (+7 covering ai_response_cache purge, refresh-token forensic-window predicate, login-attempts lock-aware predicate, ai_call_logs retention, full-sweep aggregation, partial-failure resilience).
- Frontend production build: clean.
- No migration in this PR — leverages existing tables.

**What's left for Phase 3:**
- Vercel AI SDK migration (S16) — streaming + tool use + retries via a single SDK.
- OpenTelemetry tracing per `routeAi` call.
- Zod validation at provider boundary for structured outputs.
- Streaming for long Claude calls (IC memo).

---

## 2026-05-04 (Phase 3 starts — AI prompt versioning + response cache — PR #146)

**What was worked on in plain English:**
- Re-extracting the same document is now free and instant. Previously, hitting "Re-extract" sent the file back to Gemini at full price even if nothing had changed; now the result is cached for 90 days keyed on the document bytes + the exact prompt that produced it. First extraction still calls Gemini; every identical retry/regenerate after that is a database read.
- Every AI extraction now leaves a permanent record of the *exact prompt body* that produced it — not just "we used the title-deed prompt" but a sha256 of the literal text. Six months from now, any historical extraction can be replayed against the prompt that originally produced it. This is what makes the AI audit trail credible to investors.
- The cache invalidates itself automatically when a prompt is edited, because the cache key includes the prompt's sha256. There's a single operator dial — `PROMPT_REGISTRY_VERSION` in `extractionPrompts.js` — to bump for "I changed something."

**PRs opened/merged:**
- PR #146 — `feat(ai): prompt versioning + persistent response cache` — squash-merged. Migration `20260509_ai_response_cache.sql` applied to prod via Supabase MCP.

**Verification:**
- Backend test suite: 657 → **676** (+19 covering buildCacheKey determinism, lookup hit/miss/expired, recordHit, store insert/update/TTL, fail-open paths, purgeExpired).
- Frontend production build: clean.
- Cache integration: fail-open at every layer — a DB error on lookup or store does not block the live provider call.

**What's left for Phase 3:**
- Daily cron to call `aiResponseCache.purgeExpired()` — small follow-up; wire to `vercel.json` next to existing fx-refresh + parcel-cache-sweep crons.
- Vercel AI SDK migration (S16 from older roadmap) — gives streaming + tool use + retries via a single SDK.
- OpenTelemetry tracing per `routeAi` call.
- Zod validation at provider boundary.
- Streaming for long Claude calls (IC memo today is 20–40 s with no progress feedback).
- Generic retry on Claude reasoning calls (today only extraction retries; reasoning calls are one-shot).

---

## 2026-05-04 (Phase 2 closeout — re-acceptance modal + set-first-password — PRs #144, #145)

**What was worked on in plain English:**
- The Supabase Security Advisor was showing three "RLS Disabled" errors. Two real ones (`login_attempts`, `refresh_token_grants`) are now locked down. The third (`spatial_ref_sys`, owned by the PostGIS extension) is a known false positive — documented in the handbook so it stops being noise.
- Anyone who's been a REDIP user since before a Terms or Privacy update will now be asked to re-accept before they can use the app. Until today, the founder account was silently grandfathered against the original Privacy v1 even though Privacy v2 was live. The next time you log in, you'll see a small card: *"Updated Privacy Policy"* with a link to read the full text and a checkbox to accept. Decline is signing out.
- Anyone who signs in with **Google only** can now go to Settings → Security and add a password to their account. Without this, a Google revocation would have been a permanent lockout. Existing password users see no change at all.

**PRs opened/merged:**
- RLS hardening migration `20260504_rls_hardening` applied via Supabase MCP. Documented in OPERATOR_HANDBOOK.md §4.
- PR #144 — `feat(legal): re-acceptance modal for legal-doc version bumps` — squash-merged. Frontend-only; the backend already returned the `pending` array.
- PR #145 — `feat(auth): set-first-password flow for OAuth-only users` — squash-merged. Migration `20260508_password_set_flag.sql` applied via Supabase MCP. New endpoint `POST /api/auth/me/set-first-password`.

**Verification:**
- Backend test suite: 657 / 657 green.
- Frontend production build: clean (PR #144 + PR #145).
- Supabase Security Advisor: errors dropped from 3 → 1 (the remaining one is the PostGIS false positive).

**What's left for Phase 2:**
- Re-acceptance flow when legal docs bump version → ✅ shipped (PR #144).
- "Set first password" for OAuth-only users → ✅ shipped (PR #145).
- Cleanup PR — drop the legacy `Authorization` header path + the `data.token` response body once every active session has cycled (~4 weeks after PR #142).
- Email verification *enforcement* — currently the banner reminds; future PR can gate sensitive actions behind verified state.
- MFA / TOTP (lowest urgency for solo founder).

---

## 2026-05-04 (Refresh-token rotation + httpOnly cookies — PRs #141, #142)

**What was worked on in plain English:**
- Tokens are no longer in your browser's localStorage. New sign-ins put the access token in an httpOnly cookie that JavaScript cannot read — XSS-based session theft is no longer possible for new sessions.
- The session refreshes itself silently every 15 minutes via a path-scoped refresh cookie that only travels to one endpoint (`/api/auth/refresh`). If a captured refresh token is replayed by an attacker, the system detects the duplicate use, kills the entire session family, and forces a fresh login on both sides.
- Logout actually revokes the server-side session now. Before, "log out" just cleared local storage; the JWT stayed valid for 7 days. Now the refresh family is marked revoked immediately and any cached access token is irrelevant within 15 minutes.
- Existing localStorage sessions keep working until their original 7-day token expiry — no forced logout. Once they cycle, they get the new cookie pair.
- A consolidated **OPERATOR_HANDBOOK.md** landed earlier in the day to give a single dashboard for migrations, tier-upgrade decisions, APIs, routines, and standing recommendations. Read at session start; update at session end.

**PRs opened/merged:**
- PR #141 — `docs(handbook): single operator dashboard` — squash-merged.
- PR #142 — `feat(auth): refresh-token rotation + httpOnly cookies` — squash-merged. Migration `20260507_refresh_tokens.sql` applied to prod via Supabase MCP. Live `/api/auth/refresh` smoke-test confirmed the expected `401 NO_REFRESH_TOKEN` response when no refresh cookie is presented.

**Verification:**
- Backend test suite: 645 → 657 (+12 across refresh-token issuance, rotation happy path, reuse detection, expired/unknown/malformed token rejection, family revoke, findFamilyByToken).
- Frontend production build: clean.
- CI: every PR landed with all checks green.

**What's left for Phase 2:**
- "Set first password" flow for OAuth-only users (currently their bcrypt is intentionally unusable).
- Cleanup PR (~2 release cycles out) — drop the legacy `Authorization` header path + the `data.token` response body once every active session has cycled to cookies.
- Re-acceptance flow when legal docs bump version (existing users currently grandfathered).
- MFA / TOTP (lowest urgency for solo founder).
- Email verification *enforcement* — currently the banner reminds; future PR can require verification before sensitive actions.

---

## 2026-05-03 (continued — Email verification + Google sign-in — PRs #138, #139)

**What was worked on in plain English:**
- Every new sign-up now receives a verification email automatically. Anyone whose email isn't verified yet sees a banner across the dashboard with a one-click "Send verification email" button. The verification link works end-to-end without an email provider — in dev/preview the link surfaces in server logs; in production, set `RESEND_API_KEY` + `MAIL_FROM` to switch to real delivery.
- A "Continue with Google" button now lives on the login screen. One click signs you in if your Google identity matches an existing account, links it to your account on first use, or creates a fresh REDIP account if cold-signup is enabled (with the same Terms & Privacy gate as email/password).
- The button is hidden on any deployment where the operator has not configured `GOOGLE_OAUTH_CLIENT_ID`, so the PR was safe to merge before Google Cloud Console setup.
- Google-onboarded users skip email verification — Google guarantees the email is verified, so the dashboard banner never appears for them.
- Privacy Policy bumped to v2 disclosing Google LLC (Identity Services) as a federated-sign-in sub-processor; v1 already disclosed Google as a Gemini-API processor. The new version is committed under `docs/legal/privacy_policy_v2.md` and is ready for operator publish.

**Why these were the right next steps:**
- Email verification was the prerequisite for anything that depends on a working contact channel — grievance disclosure (DPDP §8(9) / IT Rules 3(11)), password reset, multi-tenant invitations.
- Google sign-in via raw OIDC (not Supabase Auth) was the deliberate architectural call: REDIP's `users` table stays the master, `auth.service.js` extends with one new method, and every existing investment (cold-signup gate, legal acceptance, login throttle, organization hydration, deal-events HMAC signing) reuses the current code paths. No parallel auth system, no migration of existing accounts.

**PRs opened/merged:**
- PR #138 — `feat(auth): email verification — token + mailer + /verify-email + dashboard banner` — squash-merged as `891dfc6`.
- PR #139 — `feat(auth): one-click Google sign-in via raw OIDC (no Supabase Auth dependency)` — squash-merged.

**Verification:**
- Backend test suite: 627 → 645 (+18 across email-verification token issuance / supersede / mailer success+failure / token confirmation rejection paths AND Google OAuth login / account-linking / mismatch / cold-signup paths).
- Frontend production build: clean across both PRs.
- CI: every PR landed with all checks green (Backend / Frontend / Financial kernel / Audit & migration lint / Vercel).

**Operator follow-ups still to do:**
- Apply migration `20260505_email_verification.sql` to prod (now done — confirmed by user on 2026-05-03).
- Apply migration `20260506_user_oauth.sql` to prod via Supabase.
- Optional: set `RESEND_API_KEY` + `MAIL_FROM` Vercel env vars to flip email verification to real delivery.
- Google Cloud Console → OAuth 2.0 Client ID; set `GOOGLE_OAUTH_CLIENT_ID` Vercel env to enable the Google button.
- Republish Privacy Policy v2 (`docs/legal/privacy_policy_v2.md`) via the publish-legal-doc script; existing users will be re-prompted on next protected request once the re-acceptance flow ships (Phase 2 follow-up).

**What's left for Phase 2:**
- httpOnly cookie + refresh-token rotation (highest-priority remaining item).
- "Set first password" flow for OAuth-only users (current bcrypt is intentionally unusable).
- Re-acceptance flow when legal docs bump version (existing users currently grandfathered).
- MFA / TOTP (lowest urgency for solo founder).

---

## 2026-05-03 (Phase 1 legal compliance gate + Phase 2 security hardening — PRs #127–#136)

**What was worked on in plain English:**
- Every new sign-up now records the user's acceptance of Terms of Service and Privacy Policy against a specific versioned document. This is required by India's Digital Personal Data Protection Act 2023 (§6) before the platform can legally onboard anyone other than the founder.
- The backend gained a per-account login lockout: after 5 wrong password attempts in 15 minutes, that account is locked for 15 minutes. This closes a gap where an attacker could try thousands of passwords across rotating IPs even though IP-level rate limits were already in place.
- New sign-ups and password changes now check against the HIBP "Pwned Passwords" database using a k-anonymity API (only the first 5 characters of a one-way hash are ever sent). If the password has appeared in known data breaches it is rejected with a plain-English explanation.
- The site now sends a full suite of security response headers on every request: Content Security Policy, HTTP Strict Transport Security, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and Permissions-Policy. The CSP allowlist is tight — only the specific domains the app actually talks to are permitted.
- The Leaflet map marker images (the blue pins that appear on deal parcel maps) are now served from the app itself instead of being fetched from the public npm CDN (unpkg.com). This removed the last external CDN dependency, tightened the CSP further, and means map markers still render even if the CDN is down.
- Public legal pages were added at /terms, /privacy, /cookies, and /grievance — accessible without logging in. A cookie notice banner appears on first visit and remembers the dismissal.
- A versioned legal documents table and acceptance log were added to the database. Every user record now carries timestamps for when Terms and Privacy were accepted.

**PRs opened/merged:**
- PR #127 — DB migration: `legal_documents` + `user_legal_acceptances` tables — merged
- PR #128 — Backend legal service + routes (`GET /api/legal/active`, acceptance recording in `register()`) — merged
- PR #129 — Frontend: signup acceptance checkbox, /terms /privacy /cookies /grievance pages, cookie banner, footer links — merged
- PR #130 — Legal DRAFT content + grievance officer page + breach runbook — merged
- PR #131 — DB migration: `login_attempts` table for per-account throttle — merged
- PR #132 — Backend: per-account login throttle (`enforceLoginThrottle`, `recordFailedLogin`, `clearLoginAttempts`) + HIBP password breach check — merged
- PR #133 — Backend test suite for login throttle and cold-signup gate — merged
- PR #134 — Backend: wire `isPasswordBreached` into `register()` and `updateUser()` — merged
- PR #135 — Security headers via `vercel.json`: enforcing CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy — merged
- PR #136 — Self-host Leaflet marker PNGs; remove `unpkg.com` from CSP `img-src` — merged

**Verification:**
- Backend test suite: all passing (cold-signup gate, invitation bypass, login throttle lockout, throttle clearing on success, failed-attempt recording).
- Frontend production build: clean across all PRs.
- CI: all PRs landed with all checks green (Backend / Frontend / Financial kernel / Audit & migration lint / Vercel).
- Legal docs seeded in prod via Supabase MCP (`terms_of_service v1`, `privacy_policy v1`, `cookie_policy v1`).
- `login_attempts` migration applied to prod via Supabase MCP.

**What's left:**
- **Lawyer red-line required** before onboarding user #2. The DRAFT legal docs cover every DPDP/IT-Rules-mandated section but need a qualified Indian technology/data-protection lawyer to review.
- Phase 2 remaining: refresh-token rotation + httpOnly cookies (7-day JWT is still in localStorage), email verification flow, MFA/TOTP.
- Phase 3: AI retry/fallback chain, prompt versioning, response cache.
- Phase 4: pgvector semantic search, field-level PII encryption, erasure cron.

---

## 2026-05-02 (continued — Deal-side wiring + IC export + UAV benchmark — PRs #122, #123, #124)

**What was worked on in plain English:**
- The admin Planning Intelligence terminal is now wired into the actual deal workspace. Every deal's Zoning tab carries a city-level callout rail (SDZ corridors, NGT drain buffers, heritage radii, Peripheral Ring Road) so deal teams see the planning constraints without leaving the deal.
- The IC PPTX export now includes a dedicated "Planning Context — RMP 2031" slide for every Bengaluru deal. Reviewers no longer have to hold the admin terminal in another tab while reading the deck.
- A seventh Planning Intelligence surface landed: **UAV Benchmark**. The BBMP property-tax Unit Area Value rate card pivoted into a (zone × property_use) matrix with a ratio strip, so deal teams can read in seconds that Zone F is ~35% of Zone A pricing instead of staring at a PDF.

**PRs opened/merged:**
- PR #122 — `feat(deal): wire Bengaluru planning context onto every deal's Zoning tab` — squash-merged as `a338d59`.
- PR #123 — `feat(ic-deck): add Planning Context slide to the deal export deck` — squash-merged as `ce0d843`.
- PR #124 — `feat(planning-intelligence): UAV Benchmark — BBMP rate-card pivot with ratio strip` — squash-merged as `f2e7914`.

**Verification:**
- Backend test suite: 587 → 594 (+7 across `getUavBenchmark` matrix pivot + ratios computation, IC deck planning-slide manifest insertion, defensive empty-payload behaviour).
- Frontend test suite: 164 → 184 (+20 across DealPlanningContextCard, UavBenchmarkPanel).
- Frontend production build: clean (13–44 s, no new warnings).
- CI: every PR landed with all checks green (Backend / Frontend / Financial kernel / Audit & migration lint / Vercel).
- Fixed a use-classification bug where "Non-residential" was matching the "residential" check first (substring collision); reversed order.

**What's left:**
- All originally-requested planning terminal work is done. Direct integrations (Bhoomi/Kaveri land records, automated RERA verification, EC live lookup, BBMP/BDA approval status) remain manual blockers — recorded in TODO_DATA.md / TODO_MANUAL.md and unsolvable in code without official credentials/access.

---

## 2026-05-02 (Investor-grade planning terminal — PRs #116, #117, #118, #119, #120)

**What was worked on in plain English:**
- The Master Plan admin page got a brand new lead tab — **Planning Intelligence** — with six stacked surfaces that turn the RMP 2031 PDFs from a 400-page reference document into a live, searchable terminal.
- Pick a zone, type a road width and target height, and the **Decision Strip** instantly tells you setbacks, effective FAR, and approximate buildable area — with the exact source-page on every number.
- The **Buildability Lab** lets the team stack three what-if scenarios side-by-side (zone × road × plot × height), flags the most-buildable combination with a trophy chip, and calls out the trade-off in plain English ("Scenario C unlocks +1,450 sqm vs A").
- The **Land Use Insight** tile renders the 2015 → 2031 BMA shift as a delta table (residential up 30 percentage points, agriculture down 21) and highlights SDZ corridors, NGT drain buffers, heritage zones, and the Peripheral Ring Road.
- The **District Intelligence** tile lists all 42 Bengaluru Planning Districts with 2011 Census population, area in hectares, density, and ward / village counts. Search "Whitefield" → land on PD-11 in one click. SDZs flagged.
- The **Source Explorer** is the *"prove it"* surface — pick any source on the left, see every fact extracted from it grouped by the exact page on the right. Every number REDIP shows is now one click from its source PDF page.
- The **Review Queue** audits every fact by AI confidence × review status. Right now the corpus is "all clear" — every fact is high-confidence and approved. New low-confidence uploads will surface here automatically before they can be quoted.

**PRs opened/merged:**
- PR #116 — `feat(planning-intelligence): Decision Strip + Land Use Insight panel` — squash-merged as `95ca4ec`.
- PR #117 — `feat(planning-intelligence): District Intelligence panel — 42 PDs with demographics` — squash-merged as `51ea304`.
- PR #118 — `feat(planning-intelligence): Buildability Lab — 3 scenarios stacked side-by-side` — squash-merged as `8578c0a`.
- PR #119 — `feat(planning-intelligence): Source Explorer — every fact mapped to its source page` — squash-merged as `825f709`.
- PR #120 — `feat(planning-intelligence): Review Queue — confidence audit on every extracted fact` — squash-merged as `f29059b`.

**Verification:**
- Backend test suite: 567 → 587 (+20 covering kernel parity, `normalizePdCode`, `parseDistrictNotes` regex variants, `getDistrictIntelligence`, `getSourceExplorer`, `getReviewQueue`).
- Frontend test suite: 124 → 164 (+40 across DecisionStrip, LandUseInsightPanel, DistrictIntelligencePanel, BuildabilityLab, SourceExplorerPanel, ReviewQueuePanel).
- Frontend production build: clean (~13–37 s, no new warnings).
- CI: every PR landed with all checks green (Backend / Frontend / Financial kernel / Audit & migration lint / Vercel).

**What's left:**
- Wire planning intelligence INTO the deal page itself — when a deal has a parcel with a known zone, surface its setback envelope, district demographics, and SDZ flags directly on the deal's Parcel/Site tab.
- IC-memo export — a one-page PDF that pulls the six Planning Intelligence surfaces into an investor-ready packet.
- Comp benchmarks — pair BBMP UAV rates with District demographics so a deal's transaction price gets benchmarked against its district's UAV + density.
- Direct integrations remain manual blockers (Bhoomi/Kaveri land records, automated RERA verification, etc.) — recorded in TODO_DATA.md / TODO_MANUAL.md.

---

## 2026-05-01 (Source-registry build-out arc — PRs #103, #104, #105, #106)

**What was worked on in plain English:**
- Every PR now goes through a fresh security gate: any high or critical vulnerability in backend, frontend, or the financial kernel will fail the build before it can merge. Database migration filenames are also linted automatically.
- A new server endpoint accepts a Bengaluru zone-boundary GeoJSON file and attaches the polygons to the matching reviewed zones — without ever creating zones, and with a full audit trail of every replacement.
- The Master Plan admin page got a fourth tab: **BBMP UAV** — a clean review queue for property-tax Unit Area Value rows, kept strictly separate from IGR sale guidance.
- Admins can now drop a GeoJSON file straight from the browser, on the Zone Library tab, and see results inline (received / updated / skipped / unmatched plus the first 5 reasons for any rejected feature).

**PRs opened/merged:**
- PR #103 — `ci: gate npm audit + lint migration filenames` — squash-merged as `bef49f2`.
- PR #104 — `feat(master-plan): import reviewed zone polygons from GeoJSON` — squash-merged as `63e91fa`.
- PR #105 — `feat(master-plan): add BBMP UAV admin review panel` — squash-merged as `e45c3cb`.
- PR #106 — `feat(master-plan): admin UI to import zone polygons from GeoJSON` — squash-merged as `62d1ebc`.

**Verification:**
- Backend test suite: 487 → 493 (+6 GeoJSON service tests).
- Frontend test suite: 96 → 111 (+15 across BBMP UAV panel + GeoJSON import button + corpus tab integration).
- Frontend production build: clean.
- Local lint script: `node scripts/lint-migrations.js` → 36 migrations clean.
- CI: every PR landed with all five checks green (Backend / Frontend / Financial kernel / Audit & migration lint / CI passed / Vercel).

**What's left:**
- Operator-side: upload the 12 corpus files via the new admin upload (auto-classification will fire on each), and drop a GeoJSON of Bengaluru zone polygons into the new Import button.
- OCR pass on `RMP-Provisional.pdf` once it's uploaded.
- Rule ETL from Volume 6 + `Master Plan.docx` into structured rule families (setbacks, parking, TOD, buffers, approvals).
- Planning-district ingestion from Volumes 1 / 3 / 4 / Index Map / Existing-Land-Use / Proposed-Land-Use into `regulatory_data.planning_districts`.
- Migration-history repair in Supabase (still 4 tracked vs 36 in repo) — risky DDL; do via approved migration tooling.
- Dependency audit cleanup (3 backend + 4 frontend moderate advisories — mostly require breaking-version bumps).

---

## 2026-04-30 (continued - Bengaluru RMP 2031 corpus manifest)

**What was worked on in plain English:**
- The Master Plan admin page now has a third tab — Source Corpus — that lists the 12 official Bengaluru regulatory files we expect, how each is classified, and which have been uploaded.
- When an admin uploads a known file by name, REDIP auto-applies the right classification (role, legal status, authority, processing mode, confidence). No more re-classifying every upload by hand.
- The BBMP property-tax file is hard-routed to its own area and refuses to be uploaded as IGR sale guidance — closes a longstanding mix-up risk.
- The provisional master plan PDF is forced into OCR-required mode so it cannot bypass review before extraction.

**PRs opened/merged:** PR #101 — `feat(source-registry): add Bengaluru RMP 2031 corpus manifest` — opened, CI green (Backend / Frontend / Financial kernel / CI passed / Vercel), squash-merged as 451d5df.

**Verification:**
- Backend test suite: 510 tests pass (23 new).
- Frontend test suite: 96 tests pass (8 new).
- Frontend production build: clean.
- Visual surface is auth-gated; correctness locked by tests.

**What's left:**
- Ingest the actual file bytes for the 12 expected sources via the admin upload UI (auto-classify will fire on each).
- Run OCR on RMP-Provisional.pdf so the page ledger can fill.
- Begin rule ETL from Volume 6 + Master Plan.docx now that classifications are pinned.

---

## 2026-04-30 (continued - applied source page ledger migration)

**What was worked on in plain English:**
- Turned on the new source page ledger and BBMP property-tax storage in the live database.
- The admin page that earlier said "page storage not applied yet" can now actually save reviewer notes, OCR status, and page citations against each uploaded source document.
- BBMP Unit Area Value entries are now stored in their own area, kept apart from sale-price guidance, so tax-zone numbers can never get treated as land-price numbers.
- Production stayed healthy throughout — the live site responded normally and no errors were introduced.

**PRs opened/merged:** None — this was a database-only update applied directly to the live Supabase project. No code changes.

**What's left:**
- Backfill page rows for existing uploaded source documents (currently 0 page rows).
- Apply the rest of the unrecorded April-30 migrations to bring Supabase migration history fully back in sync.

---

## 2026-04-30 (continued - source readiness contract)

### What was worked on

Master plan source documents now return a server-owned readiness status. Reviewers can tell whether a source is ready to extract, blocked for OCR or manual review, reference-only, failed, queued for review, or missing provenance details.

The extract action now follows the same readiness decision as the backend. A blocked source should no longer look safe to extract in the admin page while being rejected later by the service.

### PRs opened / merged

- PR #99 - `feat(source-registry): add server readiness contract` - opened.

### What's left

- Merge PR #99 after CI passes, then deploy to production.
- Continue the source registry roadmap by improving manual OCR/GIS review workflow clarity and provenance completeness.

---

## 2026-04-30 (Codex source-document review history)

**What was worked on in plain English:**
- Added a history view for uploaded masterplan and regulatory source files.
- Reviewers can now see who changed source metadata, when it changed, and what the previous values were.
- This makes authority status, OCR readiness, confidence, and source-role changes easier to trust before extraction output is used.

**PRs opened/merged:** PR #98 opened and merged.

**Verification:**
- Backend source-registry history test passed.
- Frontend Master Plan admin history test passed.
- Backend full test suite passed: 453 tests.
- Frontend full test suite passed: 84 tests.
- Frontend production build passed.

**What's left to do:**
- Continue toward the next source-registry step: OCR/review workflow for image-heavy files and richer source explorer behavior.
- No manual environment-variable action was needed for this task.

---

## 2026-04-30 (Codex source-registry start)

**What was worked on in plain English:**
- Read the repo Markdown rulebook, TODOs, architecture notes, and session history to align on product rules and prior work.
- Separated BBMP Unit Area Value / property-tax material from true IGR guidance-value material.
- Added a new BBMP UAV source type to intake, classification, extraction prompts, and the Master Plan source-document picker.
- Guarded ingestion so BBMP UAV/property-tax rows are kept as review evidence only and never written into the IGR guidance-value candidate table.

**PRs opened/merged:** PR #93 opened and merged.

**Verification:**
- Backend full test suite passed.
- Frontend Master Plan admin test passed.
- Frontend production build passed.

**What's left to do:**
- Continue the source-registry pass for the attached RMP/masterplan PDFs: legal status, authority metadata, OCR coverage, and source roles.
- Add OCR handling for image-only/provisional PDFs before trusting extracted rows.
- Decide whether BBMP UAV needs its own structured table later; for now it is intentionally evidence-only.

---

## 2026-04-30 (Codex source-registry metadata)

**What was worked on in plain English:**
- Shipped the first source-registry slice as draft PR #93 with a Vercel preview: BBMP Unit Area Value / property-tax PDFs are separated from true IGR guidance-value PDFs.
- Started the next source-registry slice on branch `codex/source-registry-metadata`.
- Added registry metadata for uploaded masterplan/regulatory source files: source role, legal status, authority, published date, source URL, page count, OCR readiness, text coverage, source confidence, and registry notes.
- Updated the source-document intake screen so analysts can record authority/status/OCR context before extraction.

**PRs opened/merged:** PR #93 and PR #94 opened and merged.

**Verification:**
- Backend full test suite passed: 448 tests.
- Frontend Master Plan admin test passed.
- Frontend production build passed.

**What's left to do:**
- Continue with OCR-specific handling for image-only PDFs such as provisional scans.
- Consider seeding the attached official documents into the registry with source role, legal status, authority, and OCR status.

---

## 2026-04-30 (Codex source-registry readiness)

**What was worked on in plain English:**
- Landed the source-registry metadata step and deployed it to production.
- Added a clear readiness view for masterplan source files so analysts can separate text-ready sources from OCR/image-review, manual-entry, metadata-gap, and failed sources.
- Blocked automated extraction when a source is explicitly marked as OCR-required, image-review, manual-entry, or not extractable.
- Kept provisional/image-heavy PDFs from looking equally ready until a human review or OCR pass happens.

**PRs opened/merged:** PR #94 and PR #95 opened and merged.

**Verification:**
- Backend full test suite passed: 449 tests.
- Frontend Master Plan admin test passed.
- Frontend production build passed.

**What's left to do:**
- Add an actual OCR/review workflow for image-heavy PDFs once the queue is visible.

---

## 2026-04-30 (Codex deal overview hotfix)

**What was worked on in plain English:**
- Investigated a production deal-page crash showing "id is not defined" on the overview page.
- Fixed the Full Model link so it uses the current deal identifier from the deal workspace context.
- Added a regression test to make sure the overview page can render the financial summary link without crashing.

**PRs opened/merged:** PR #96 opened and merged.

**Verification:**
- Frontend Overview tab regression test passed.
- Frontend production build passed.

**What's left to do:**
- Watch for any remaining deal-page context migration regressions.

---

## 2026-04-30 (Codex source-document review controls)

**What was worked on in plain English:**
- Added review controls for uploaded masterplan/regulatory source files so analysts can correct authority, legal status, source role, processing mode, OCR flag, text coverage, confidence, source URL, page count, and notes after upload.
- Added a source-document edit history table so registry changes are recorded instead of silently overwritten.
- Applied the additive Supabase migration for that history table and verified it exists.
- Checked the Vercel environment-variable list from the CLI; secret values stay hidden, and the dashboard badges may still need manual review in Vercel.

**PRs opened/merged:** Source-document review-controls branch in progress.

**Verification:**
- Backend full test suite passed: 451 tests.
- Frontend Master Plan admin test passed.
- Frontend production build passed.
- Supabase migration verified.

**What's left to do:**
- Push, preview, merge, and deploy this branch.
- Manually review the Vercel "Needs Attention" environment-variable badges in the dashboard if Vercel requires rotation or re-save.

---

## 2026-04-28

**What happened:**
This was a setup/housekeeping session. No feature code was written.

**What was done:**
- Created `AGENTS.md` at the project root — a rules file that Codex, Cursor, and every other AI tool can now read. Previously these rules only existed inside Claude's private memory folder, invisible to anything else.
- Updated `CLAUDE.md` with two new mandatory rules:
  1. Every PR must be explained in plain English (not just code terms)
  2. Every session must end with a log entry here in `SESSION_LOG.md`
- Created this file (`SESSION_LOG.md`) so work history is permanently stored in the repo and never lost when a chat session disappears.

**PRs merged:** None (these were direct file changes, no PR needed for housekeeping files)

**What's next:**
- The morning session from 2026-04-28 was lost before this log existed — that content is unrecoverable. Going forward it will be captured here.

**Late session — same day:**

Major doc cleanup and a UI redesign PR.

Doc cleanup (committed directly to master):
- Deleted `PHASE_MERGE_PLAN.md` and `docs/LEGACY_SHAPE_AUDIT.md` (both stale, documenting work that's already done or deleted)
- Rewrote `docs/CLEANUP_INVENTORY.md` from 100 lines to 24 — only the open cryptographic-signing gate remains
- Fixed `packages/financial-kernel/README.md` — it had stale info saying a feature flag existed that was removed weeks ago
- Stripped completed items from `TODO_MANUAL.md` (3 done items removed and renumbered) and `TODO_ARCHITECTURE.md` (2 done items removed)
- Deleted 3 redundant memory files (`feedback_approach.md`, `feedback_craftsmanship.md`, `project_redesign_plan.md`) — content was duplicated in CLAUDE.md and AGENTS.md
- Expanded CLAUDE.md and AGENTS.md with India-specific guardrails: Core Philosophy section, 4 new hard rules (AI must be labeled "AI-assisted, requires human review"; comps must show source/freshness; immutable audit trail), risk flag categories common in Indian deals, sourcing-stage tolerance, Data & Integration Strategy section, Adoption & Success Metrics section

Database cleanup:
- Deleted 4 user accounts via Supabase: 2 orphaned test accounts (`abc@gmail.com`, `ayush781007@yahoo.com` aka "Lana Rhoades"), 1 duplicate of Rachit's account (`rachitjain348@gmail.com`), and 1 unused workspace owned by Rekha Jain
- 5 real users remain: Rachit (owner of Default Workspace) + Bharath and Mourya (editors in Default Workspace) + Rahul Jose and Adit (each owns their own separate workspace)

UI redesign — PR opened, not yet merged:
- **PR #70** — Editorial overhaul of the Parcel Intelligence panel (the page that shows on every deal under Regulatory/Zoning tab)
- Replaced 8 yellow/beige "Needs verification" tiles with neutral grey tiles that show em-dash + a single small "Needs review" chip when data is missing
- Replaced single half-filled confidence bar with 4 segmented mini-bars, one per pillar (Zoning / Buildability / Guidance / K-GIS), each colored by its own score
- Replaced pastel verdict banner (amber background) with neutral chrome + 4px colored left stripe
- Fixed the broken sideways layout in Authority Verification — header now sits on top, 3-column card grid below
- Hierarchy chips (Village/Hobli/Taluk/District) in the K-GIS card use proper neutral chrome instead of pastel boxes
- VerifiedPill now uses the design-system `<Badge tone="success">` primitive instead of hand-rolled emerald
- 1 file changed, +287 / −196 lines, build green, no logic/hook/query changes (presentation only)

**Late-late session — same day, after PR #70 merged and deployed:**

Two more PRs shipped, both merged and deployed to https://redip.vercel.app.

**PR #71 — Frontend motion/polish guidelines** (merged):
- Created `docs/FRONTEND_GUIDELINES.md` — the standing rulebook for every visual change
- 13 numbered sections: motion principles, exact timing tables (120ms hover, 220ms modal open, 600ms count-up, 700ms chart draw-in), required 4-state interactions, skeleton-not-spinner rule, live data treatment, 3D/parallax used surgically, chart animation, page transitions, accessibility, performance budget, content presence, 7 feel-check questions, default tooling
- Wired into `CLAUDE.md` and `AGENTS.md` so every AI tool (Claude Code, Codex, Cursor) reads it automatically at session start
- Anti-patterns explicitly banned: gradients on hero, glow/neon, decorative emojis, auto-play, spinner-for-skeleton, saturated pastel tints, decorative parallax, bouncy spring physics on professional surfaces
- 253 lines added, no code changes. Pure docs.

**PR #72 — Master Plan panel editorial + larger interactive K-GIS map** (merged):
- First PR following the new FRONTEND_GUIDELINES rulebook
- **Master Plan Zone panel** (`MasterPlanZonePanel.jsx`):
  - Saturated `bg-primary-600` blue header replaced with neutral chrome + 4px colored left stripe (green=assigned, amber=unassigned)
  - "Assigned" success Badge appears next to zone code
  - ZoneFact tiles: em-dash + single "Needs review" chip for missing values; review status renders as proper Badge tone (success/warn) instead of plain text
  - Picker dropdown slides in 220ms decelerate, skeleton rows pulse staggered while loading
  - Save/Cancel buttons fade-up 180ms when notes are dirty
  - All buttons have full 4-state interactions (default → hover → focus-visible → active)
  - Custom rotating chevron on source-notes details element
- **K-GIS map upgrade** (`ReadOnlyPropertyMap.jsx`):
  - Default height 224px → **440px** (almost 2× bigger)
  - **Layer toggle** in top-right: Streets (OSM) ↔ Satellite (Esri imagery)
  - **Scroll-wheel zoom enabled** — was disabled before, felt dead
  - **Auto-fits to parcel geometry** with 500ms animated zoom when geometry exists
  - **Fullscreen button** bottom-right (browser Fullscreen API, no new dependency)
  - Better marker (filled blue circle, proper border) and stronger teal geometry overlay
- **Parcel panel layout restructure** (`ParcelIntelligencePanel.jsx`):
  - K-GIS card moved out of the cramped right sidebar into its own full-width row at the bottom
  - Right sidebar now reserved for confidence + flags only
- **Motion plumbing** (`index.css`):
  - 3 new keyframes: `zonepicker-slide` (220ms decelerate), `fadeInUp` (180ms ease-out), `scaleIn` (150ms ease-out)
  - Already covered by existing `prefers-reduced-motion: reduce` media query
- 4 files changed, +396 / −123 lines, build green (37s)
- No new dependencies. framer-motion considered and rejected — pure CSS keyframes sufficient.

**What's next:**
- Visually verify the live https://redip.vercel.app deal Regulatory/Zoning tab after deploy completes
- Open candidates for follow-up:
  - Build a "change member role" admin UI (currently no way to demote/promote existing teammates without direct DB updates)
  - Add a verification UI for the new authority-verification card cluster (Grok flagged that interactivity needs work)
  - Apply the same editorial treatment to other surfaces with similar issues (Comps, Risk tab, Financials KPI cards as needed)
  - Add count-up animations to KPI tiles on data refresh per FRONTEND_GUIDELINES section 5

---

## 2026-04-28 (second session — same day, continued after PRs #71/#72)

**Context:** Resumed from a prior context-compressed session. Q-now roadmap from the Command Deck plan was in-flight.

### PRs shipped this session

**T5: Red-flag rule registry + snapshot_stale rule (direct commits)**
- Extracted 10 inline red-flag predicates from `composeParcelIntelligence` into `backend/src/engines/parcelRedFlags.engine.js`. Each rule is a named object with `id`, `severity`, `label`, `description`, `predicate`, `detailFor`.
- Added 11th rule `snapshot_stale` — fires when a prior snapshot is >30 days old, silent on first load.
- Renamed `getLatestSnapshotId` → `loadLatestSnapshotMeta` (returns `{ id, generated_at }`), eliminating a redundant DB query.
- Admin widget `RedFlagRulesCard` in `ParcelIntelligenceAdminPage.jsx` — lists all 11 rules with severity Badge, collapsed to 4 rows by default.
- Full per-rule unit tests for `snapshot_stale` (7 cases), 7-fixture parity guard, updated service/verify tests.
- **P1/P2**: Replaced hand-rolled `StatusPill`/`SourceStatusBadge`/`StatusBadge` with `<Badge tone>` primitives; replaced amber warning divs with `<ErrorState tone="warn">`.

**P3 — Drop inline CSS-var color styles from LandingPage.jsx (commit ef71495)**
- Replaced all `style={{ color: 'var(--color-text-*)' }}` and `style={{ color: 'var(--color-brand-*)' }}` with Tailwind utilities (`text-content-primary`, `text-content-secondary`, `text-content-muted`, `text-premium`, `text-accent`). Net −50 lines. Build green.

**T4 — HMAC snapshot signing (commit b57653d)**
- `computeSignature` HMAC-SHA256 over `inputs_hash|output_hash|engine_version`, keyed by `PARCEL_SIGNING_SECRET`. Gracefully returns null when secret not set.
- `saveSnapshot` writes `signature` + `engine_version` columns to DB.
- `verifySnapshotSignature(snapshotId)` with `timingSafeEqual`.
- New route: `GET /api/parcel-intelligence/snapshots/:id/verify-signature`
- `ParcelIntelligencePanel.jsx`: "Signed" Badge pill appears when refresh response carries a signature.
- Migration: `database/migrations/20260428_parcel_intelligence_signature.sql`

**Manual steps still required:**
1. Apply migration to Supabase production (two nullable ADD COLUMN IF NOT EXISTS).
2. Set `PARCEL_SIGNING_SECRET` on Vercel (32+ char random string).

**What's next (Q-next):**
- T1 — What-if buildability sliders (client-side, zero new endpoints)
- T2 — Source explorer drawer (citation chip → PDF page + bounding box)
- P5/P6 — AI cost widget + confidence breakdown drilldown

---

## 2026-04-29

**Context:** Comprehensive deep-dive audit of REDIP — backend, frontend, database, migrations, deployment, AI routing, security posture. Plan filed at `~/.claude/plans/go-through-all-the-joyful-pebble.md` (5 strategic bets + 18 tactical sweeps). Two PRs shipped from the audit's first cut.

### Audit findings (highlights)

- Live Supabase advisor: 25 security lints (3 ERROR-severity), 235 performance lints (109 stacked permissive policies, 86 unused indexes, 38 unindexed FKs, 7 mutable `search_path` functions).
- Supabase migration tracking: 3 of 29 migrations registered in `schema_migrations` — preview branches and rollbacks were uncalibrated.
- CI: only `defaults-staleness.yml` (one JSON-field check) — no test gate, no lint, no security scan.
- Operational guard rails: AI calls had no cost cap, `PARCEL_SIGNING_SECRET` silently null in prod, two cron routes had drifted-twin auth helpers.
- Frontend: no count-up on KPI changes, Toast lacked `aria-live`, Recharts ticks lacked `tabular-nums`. Five components > 600 LOC. (Aria-modal already shipped, contrary to the audit's initial finding.)

### PRs shipped

**PR #74 — `feat(infra): CI gate + AI cost cap + cron-auth middleware + signing-secret hard-throw` (merged)**
- New `.github/workflows/ci.yml` runs kernel build+tests, backend tests, frontend build+tests on every PR/push to master.
- New `backend/src/lib/costGuard.js` — per-org daily AI spend cap via `AI_DAILY_COST_CAP_USD`. `aiRouter.runAI` calls `assertWithinDailyCap` before every provider request; cap-tripped attempts get logged with `status='cost_capped'`. NULL-org gets 2× cap. No-op when env unset.
- New `backend/src/middleware/cronAuth.js` — single `requireCronAuth` middleware replaces two duplicated `getCronToken` helpers in `parcelCron.routes.js` and `fx.routes.js`.
- `parcelIntelligence.service.computeSignature` now hard-throws in `NODE_ENV=production` when `PARCEL_SIGNING_SECRET` is missing — no more silently-unsigned snapshots in prod.
- Tests: 401 → 418 backend (+17 across costGuard + cronAuth). Frontend build green.

**PR #75 — `feat(ui): KPI cross-fade, count-up + reduced-motion hooks, Toast aria-live, Recharts tabular-nums` (merged)**
- New `frontend/src/hooks/useReducedMotion.js` — live `prefers-reduced-motion: reduce` subscription with OS-toggle updates, SSR-safe and Safari < 14 compatible.
- New `frontend/src/hooks/useCountUp.js` — rAF interpolation with cubic-out easing (default 600ms per FRONTEND_GUIDELINES §5). Snaps instantly under reduced-motion.
- `MetricTile` value node re-mounts on change with a 180ms `value-cross-fade` keyframe (defined in `index.css`). Collapses to no-op under reduced-motion. Every KPI tile across the app picks this up automatically.
- `Toast` — `role="alert" aria-live="assertive"` for errors, `role="status" aria-live="polite"` for everything else. Dismiss button gets accessible label + focus ring.
- `FinancialVisualizationLayer` — 13 inline `tick={{ fontSize: ... }}` props collapsed onto two module-scoped constants (`AXIS_TICK`, `AXIS_TICK_SMALL`) with `fontVariantNumeric: 'tabular-nums'` per FRONTEND_GUIDELINES §7.
- Tests: 60 → 70 frontend (+10 across the new hooks + Toast a11y).

### Required operator action (env vars on Vercel)

- `AI_DAILY_COST_CAP_USD` — daily per-org cap (suggested 50.00). Unset = no cap.
- `PARCEL_SIGNING_SECRET` — 32-char random, generated via `openssl rand -hex 32`. **Production deploy refuses to mint snapshots without it.**

### What's next

From the plan file (in priority order):
- **Bet 2 partial — RLS + advisor cleanup**: write `0030_rls_consolidation.sql`, `0031_index_hygiene.sql`, `0032_function_hardening.sql`, `0033_users_rls.sql` for the user to apply via Supabase. Targets the 235 performance lints + 3 ERROR security lints.
- **Bet 3 — decompose**: `parcelIntelligenceAdmin.service.js` (1,801 LOC), `dealPptx.service.js` (2,292 LOC), `dealXlsx.service.js` (1,520 LOC). Same for the 5 frontend components > 600 LOC. Unblocks signed exports (CLEANUP Gate 4) and interactive `MethodologyExplorer` (TODO_MANUAL #10).
- **Bet 5 remaining — reactive seam**: `useDealContext()` hook + migrate the 9 deal tabs onto a single read model. Currently each tab has its own query.

### Late session — same day, PR #76 (Bet 2 first cut)

**PR #76 — `chore(security): close 3 ERROR + 8 WARN Supabase advisor lints` (merged)**

Three new SQL migration files authored. Migrations are **not auto-applied** — operator runs them via psql. Postgres 17.6 confirmed on production. CI green (kernel + backend + frontend + Vercel preview).

- `database/migrations/20260430_users_rls_and_summary_invoker.sql` — Enable RLS on `public.users` (was OFF; PostgREST `anon` could `GET /rest/v1/users` and dump every email + password_hash). Three policies: `users_self_read` (full row, self only), `users_org_mates_read` (rows of users sharing any organization with the caller — preserves the collaboration UX), `users_self_update` (UPDATE self only). INSERT/DELETE intentionally have no policy. Recreates `public.deal_summary` `WITH (security_invoker = true)` so it honors the caller's RLS instead of the creator's.

- `database/migrations/20260430_function_search_path_lockdown.sql` — `ALTER FUNCTION ... SET search_path` on the 7 REDIP-owned functions flagged by `function_search_path_mutable`: `current_user_id`, `current_organization_id`, `update_updated_at_column`, `feature_flag_cohorts_touch`, `investor_packages_touch`, `sync_property_geom`, `regulatory_data.effective_fsi`. Closes the schema-shadow attack vector.

- `database/migrations/20260430_feature_flag_cohorts_write_policy.sql` — Drop the `feature_flag_cohorts_write` RLS policy whose USING and WITH CHECK clauses were both literally `true`. Backend writes still work via the postgres-role bypass; PostgREST writes denied. Read policy (intentional public read for landing-page beta-banner cohort lookup) preserved.

- `database/current_schema.sql` — manifest updated with a new "Phase 4 — RLS hardening" section.

**Operator action required to land the security improvement:**

```
psql "$DATABASE_URL" -f database/migrations/20260430_users_rls_and_summary_invoker.sql
psql "$DATABASE_URL" -f database/migrations/20260430_function_search_path_lockdown.sql
psql "$DATABASE_URL" -f database/migrations/20260430_feature_flag_cohorts_write_policy.sql
```

After applying, the Supabase advisor `error`-severity count drops 3 → 1 (only PostGIS-shipped `spatial_ref_sys` remains, intentionally), the 7 `function_search_path_mutable` warnings → 0, and the `rls_policy_always_true` warning on `feature_flag_cohorts` → 0.

**Deliberately deferred (per audit roadmap):** the 109 `multiple_permissive_policies`, 86 `unused_index`, and 38 `unindexed_foreign_keys` items. Each requires per-table audit and a 30-day `pg_stat_user_indexes` snapshot before `DROP INDEX` is safe.

### Operator env vars set this session

- `PARCEL_SIGNING_SECRET` — 32-byte hex generated locally, pasted into Vercel (Production + Preview).
- `CRON_SECRET` — 32-byte hex generated locally, pasted into Vercel (Production + Preview).

### PR #76 applied — verification (2026-04-29 evening)

Operator ran the three SQL files from PR #76. Verified post-apply via Supabase MCP:

- `public.users` RLS enabled, 3 policies present (`users_self_read`, `users_org_mates_read`, `users_self_update`).
- `public.deal_summary` reloptions: `security_invoker=true`.
- `feature_flag_cohorts` policy count: 1 (read only — write policy dropped).
- All 7 functions have pinned `search_path` (six at `""`, `sync_property_geom` at `"public"`, `regulatory_data.effective_fsi` at `"regulatory_data"`).

Advisor security count: **25 → 14**. ERROR-severity: **3 → 1** (only PostGIS-shipped `spatial_ref_sys`). The 7 `function_search_path_mutable` WARN lints and the `rls_policy_always_true` WARN are gone.

### PR #78 — `chore(perf): cover 38 unindexed foreign keys` (merged, awaits apply)

One new SQL migration file authored. Closes the 38 `unindexed_foreign_keys` performance lints from the audit's perf advisor.

- `database/migrations/20260430_unindexed_fk_covering_indexes.sql` — 24 indexes on `public` (every `*_by` user-tracking column plus a few document/org references), 14 on `regulatory_data` (evidence + masterplan + parcel snapshot lineage). All single-column. Built with `CREATE INDEX CONCURRENTLY IF NOT EXISTS` so writes are not blocked during apply, and the file is idempotent.
- `database/current_schema.sql` — manifest updated under Phase 4.

**Operator action required:**

```
psql "$DATABASE_URL" -f database/migrations/20260430_unindexed_fk_covering_indexes.sql
```

Or paste the file into Supabase SQL editor → Run. Do not wrap in a transaction — `CONCURRENTLY` is incompatible with explicit `BEGIN/COMMIT`.

After apply: perf advisor `unindexed_foreign_keys` count drops 38 → 0.

**Deliberately deferred:** the 109 `multiple_permissive_policies` and 86 `unused_index` lints. The first needs per-table audit (replacing stacked policies with single unions); the second needs a 30-day `pg_stat_user_indexes` snapshot before any `DROP INDEX` can be safely run.

### PR #80 — `fix(migrations): drop CONCURRENTLY so FK index migration runs in Supabase SQL editor` (merged + applied)

PR #78 used `CREATE INDEX CONCURRENTLY` which errored with `25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction block` when pasted into the Supabase SQL editor (which auto-wraps all queries in `BEGIN/COMMIT`). PR #80 swapped to plain `CREATE INDEX IF NOT EXISTS` wrapped in a single `BEGIN/COMMIT`. Applied successfully on 2026-04-29 evening. Verified: 38 indexes built, perf advisor `unindexed_foreign_keys` count 38 → 0.

Trade-off accepted: brief table-level write locks during index creation (negligible on REDIP's current sub-1k row volumes). If a table grows past ~100k rows, that one index can be dropped and rebuilt with CONCURRENTLY via psql separately.

### PR #81 — `chore(security): add policies for the 5 RLS-on-no-policy tables` (merged + applied)

Closes the 5 `rls_enabled_no_policy` advisor INFO lints. Each table had RLS turned on but no policies — meaning PostgREST anon/authenticated were silently denied via the absence of a matching policy. Backend kept working (postgres role bypasses RLS) but the *intent* of each table's access model wasn't expressed in code.

| Table | Policy added |
|---|---|
| `public.exchange_rate_fetch_log` | Explicit deny-all for anon/authenticated (internal cron log) |
| `regulatory_data.master_plan_documents` | Global-or-tenant `org_id IS NULL OR org_id = current_organization_id()` |
| `regulatory_data.master_plan_zones` | SELECT-only `USING (true)` (public reference data) |
| `regulatory_data.planning_districts` | SELECT-only `USING (true)` (public reference data) |
| `regulatory_data.zone_versions` | SELECT-only `USING (true)` (audit history) |

Applied successfully on 2026-04-30. Verified: every table now has 1 policy, `rls_enabled_no_policy` count 5 → 0.

### Final advisor state (end of session)

Security advisor count: **25 → 9**. ERROR-severity: **3 → 1**. Every one of the remaining 9 lints is PostGIS-shipped, not REDIP code:

| Lint | Count | Disposition |
|---|---|---|
| `rls_disabled_in_public` on `public.spatial_ref_sys` | 1 ERROR | PostGIS metadata table; intentionally untouched |
| `extension_in_public` on `pg_trgm`, `postgis` | 2 WARN | Extension placement; risky to move (every unqualified PostGIS call would break) |
| `anon_security_definer_function_executable` on `st_estimatedextent` (3 overloads) | 3 WARN | PostGIS-shipped function; revoking EXECUTE could break Supabase row-count estimates |
| `authenticated_security_definer_function_executable` on `st_estimatedextent` (3 overloads) | 3 WARN | Same as above |

REDIP-controlled security advisor lints: **0**. The session-long advisor cleanup theme (PRs #74, #76, #78, #80, #81) is complete for the safe, mechanical subset.

Performance advisor `unindexed_foreign_keys`: **38 → 0**. Remaining performance lints (`multiple_permissive_policies`, `unused_index`) are deferred for a future PR with proper per-table audit + 30-day usage data.

---

## 2026-04-30 (continued — Bet 3 + Bet 5 push)

### PRs shipped

**PR #83 — `refactor(extraction)`: extract 19 Gemini doctype prompts** (merged) — first Bet 3 cut. `extraction.service.js` 1,168 → 692 LOC; new `services/ai/extractionPrompts.js` holds all 19 doctype prompts + the classifier prompt. Public re-export of `GEMINI_EXTRACTION_PROMPTS` preserved.

**PR #84 — `feat(a11y)`: focus trap on the 3 modal/drawer surfaces** (merged) — new `useFocusTrap(active, opts)` hook. Wired into `CommandPalette`, `SourceExplorerDrawer`, `VerifyItemDialog`. Tab/Shift+Tab cycles within the dialog; previously-focused element restored on close. Frontend tests 60 → 70.

**PR #85 — `refactor(parcel)`: decompose parcelIntelligenceAdmin.service** (merged) — first major Bet 3 god-service split. 1,801 LOC → 6 files (4 concerns + helpers + shim) under `services/parcelIntelligence/`. Largest post-split: 545 LOC. Public API preserved via thin shim. 418 backend tests still green.

**PR #86 — `feat(deal-context)`: useDealContext scaffolding** (merged) — TODO_ARCHITECTURE Phase A foundation. New `frontend/src/hooks/useDealContext.jsx` with `<DealContextProvider>` + 6 typed selector hooks (`useDealRecord`, `useDealKpis`, `useDealRedFlags`, `useDealEvents`, `useDealDocuments`, `useDealActivities`). Each selector returns a stable ref via useMemo; provider mounted in `DealDetailPage`. 11 new vitest cases (70 → 81 frontend tests).

**PR #87 — `feat(deal-context)`: migrate OverviewTab to consume useDealContext** (merged) — pilot consumer. Drops `({ deal, id })` props, uses `useDealContext()` + `useDealRecord()`. Validates the seam end-to-end.

**PR #88 — `feat(deal-context)`: migrate 3 more tabs (Documents, Activity, Risk)** (merged) — drops `({ dealId })` props on three more bounded surfaces. 4 of 9 deal tabs on the new pattern.

**PR #89 — `feat(deal-context)`: migrate final 5 tabs (Parcel, Zoning, Financial, DD, Comps)** (merged) — TODO_ARCHITECTURE Phase A complete. All 9 deal tabs read deal/dealId from useDealContext. Auxiliary props kept where they're not deal-derived (`ParcelTab.canEdit`, `ZoningTab.setTab`). Side artifact: dropped DDTab's dead `assetClass`/`dealStructure` props.

**PR #90 — `refactor(exports)`: decompose dealPptx.service (2,292 LOC) into 5 modules** (merged) — largest god-service in the repo. New layout under `services/exports/pptx/`: `_helpers.js` (294), `contentBuilders.js` (803), `deckContext.js` (283), `primitives.js` (209), `slides.js` (918). Orchestrator shim drops to 107 LOC. Same PPTX bytes for the same input — proven by 4 dealPptx parity tests passing unchanged. Side artifact: `scripts/split-deal-pptx.py` for future decompositions (e.g. `dealXlsx.service.js` at 1,520 LOC).

**PR #91 — `test(osm-adapter)`: integration tests for the T6 OSM road-width adapter** (merged) — closes audit's S18 coverage gap. 24 new tests across `HIGHWAY_DEFAULTS` sanity, pure-function tests for `selectBestWay`/`deriveWidth`, and `fetchRoadWidth` integration tests with axios mocked. Confidence ≤ 0.55 hard cap (CLAUDE.md) regression-guarded. Backend tests 418 → 442.

### Where the audit roadmap stands at session end

| Bet | Status |
|---|---|
| 1 — CI gate + migration baseline | ✅ CI shipped (#74); baseline reconciliation deferred |
| 2 — RLS + advisor cleanup | ✅ Safe subset shipped (#76, #78, #80, #81); 109 multiple_permissive + 86 unused_index deferred |
| 3 — Decompose god-services | ✅ Three cuts shipped (#83, #85, #90). `dealXlsx.service.js` (1,520 LOC) is the only remaining target — pattern + tooling (split-deal-pptx.py) ready. |
| 4 — Observability + cost caps + AI fallback | ✅ Cost cap + signing guards + cron auth (#74); OTel tracing + retry/fallback chain deferred |
| 5 — Frontend reactive seam + a11y/motion | ✅ Motion + a11y + focus trap + useDealContext scaffolding + **9/9 tabs migrated** (Phase A complete) |

### Net counts

- **18 PRs merged across the two-day session** (#74 → #91).
- **6 operator-applied migrations** (RLS hardening, function search_path, FK index hygiene, no-policy table policies).
- **2 Vercel env vars** set (`PARCEL_SIGNING_SECRET`, `CRON_SECRET`).
- **Security advisor**: 25 → 9 lints (every remaining one is PostGIS-shipped).
- **Performance advisor `unindexed_foreign_keys`**: 38 → 0.
- **Backend tests**: 401 → **442** (+41 across costGuard, cronAuth, OSM adapter).
- **Frontend tests**: 60 → **81** (+21 across useReducedMotion, useCountUp, Toast a11y, useDealContext).

### What's left (priority for next session)

1. **`dealXlsx.service.js` decomposition** — last remaining Bet 3 god-service (1,520 LOC). Same pattern as #90, can reuse `scripts/split-deal-pptx.py` as a starting template.
2. **`multiple_permissive_policies` cleanup (109 lints)** — risky one-way door; needs per-table audit + EXPLAIN ANALYZE pre/post on hot queries.
3. **OTel tracing + AI retry/fallback chain** — Bet 4 second cut. Wraps `aiRouter.runAI` with `AbortController` timeouts + Honeycomb/Axiom export.
4. **Override history drawer** — uses `useDealEvents()` selector exposed by PR #86. Closes the audit-trail visibility gap noted in TODO_MANUAL.

---
## 2026-04-30 (continued - Source Registry PR v2)

### What was worked on

Prepared the next masterplan trust-layer step: source documents can now have page-by-page review rows for OCR status, reviewer notes, checksums, and future citation anchors. BBMP Unit Area Value entries also get their own review table so property-tax values stay separate from official sale guidance values. The admin source document view now exposes a page ledger action, prepares empty page rows, and uses skeleton loading states instead of spinners.

### PRs opened/merged

**PR #100 - `feat(source-registry): add source page ledger foundation`** - opened and merged after local verification and CI.

### What's left to do

Apply the new Supabase migration in production before page storage and BBMP UAV review rows can persist. Next product steps are OCR extraction into page rows, citation anchors, full attached-file source seeding, and reviewed rule ETL from Volume 6 and `Master Plan.docx`.

---
## 2026-05-03 (Settings IA fix + cold-signup gate)

### What was worked on

Reviewed an external critique of the REDIP Settings page IA, verified the claims against the codebase, and shipped the highest-leverage parts of the fix. The Settings page used to mash personal profile fields (name, email, phone, password) together with two big admin cards for the Master Plan zoning library and the Parcel Intelligence review queue — implying every user was supposed to curate Bengaluru RMP 2031 data from their personal profile. Cold signup also handed out Owner role automatically to anyone who found the URL.

The IA cards moved into a new role-gated **Admin** section in the sidebar (visible only to Editor and above), at clean URLs `/dashboard/admin/master-plan` and `/dashboard/admin/parcel-intelligence`. Old `settings/...` paths redirect so existing bookmarks survive. The Settings page is now strictly personal. Self-signup now requires `ALLOW_COLD_SIGNUP=true` in env — invitation-based signup is unaffected.

Deferred (correctly): a full Workspace/Team management UI and a role-mutation endpoint. Solo user for the next ~2 months, so building member-management for zero users would have been gold-plating.

### PRs opened/merged

**PR #126 — `feat(admin-ia): move data-curation pages out of Settings + gate cold signup`** — opened, awaiting merge. 7 files, +231/-65 lines. New file: `frontend/src/utils/roles.js` (frontend mirror of backend `roleSatisfies` so sidebar gating shares the priority table). Three new auth.service tests for the cold-signup gate. All 597 backend tests pass; frontend build clean.

### What's left to do

- Merge PR #126 and smoke-test on the Vercel preview.
- Set `ALLOW_COLD_SIGNUP=false` (or leave unset) in production env. Default-deny is the new behavior, but verify the env override isn't already set to true somewhere.
- When a real second user is about to be added: build the Workspace/Team page, the `PATCH /api/organizations/members/:userId/role` endpoint, and an email-verification flow for invites. Plan file at `~/.claude/plans/c-users-rachi-onedrive-uw-desktop-futur-lazy-charm.md` has the spec.
- Optional Phase 3 polish (defer until usage justifies): a Data Library landing page with stat tiles, keyboard shortcuts on the review queue, page renames.

---

## 2026-05-04 — T&C / Privacy compliance gate at signup (PRs #127-#130)

### What was worked on

Built and shipped the full Terms & Conditions / Privacy Policy acceptance gate at signup, plus four new public legal pages and a cookie notice. This closes a real compliance gap: REDIP could not legally onboard a non-solo user without an explicit consent record under the DPDP Act 2023 §6 and IT Rules 2021 Rule 3(11). Now there is a versioned legal-document table, an append-only acceptance log with IP and user-agent, public-readable Terms / Privacy / Cookie / Grievance pages, a hyperlinked checkbox on the signup form that blocks submit until ticked, and a dismissible cookie banner that auto-adapts to the active theme.

The legal text in `docs/legal/*.md` is structured around DPDP Act 2023, IT Rules 2021, the Indian Contract Act 1872, the Arbitration & Conciliation Act 1996, and CERT-In Directions April 2022 (6-hour breach reporting). Every section is marked DRAFT — a Bengaluru technology / data-protection lawyer must red-line before any non-solo user is onboarded.

### PRs opened/merged

| PR | Title | Theme |
|---|---|---|
| **[#127](https://github.com/Rachit-Jain9/REDIP/pull/127)** | `feat(legal): add legal_documents + user_legal_acceptances migration` | DB layer: versioned-document registry, append-only acceptance log, RLS, `users.terms_accepted_at` shortcut |
| **[#128](https://github.com/Rachit-Jain9/REDIP/pull/128)** | `feat(legal): legal-document service + signup acceptance integration` | Backend: `legal.service.js`, `legal.routes.js`, atomic acceptance recording inside the registration transaction, `scripts/publish-legal-doc.js` operator script. 612/612 backend tests. |
| **[#129](https://github.com/Rachit-Jain9/REDIP/pull/129)** | `feat(legal): T&C signup gate UI + public Terms/Privacy/Cookie/Grievance pages` | Frontend: `Checkbox` design-system primitive, `Markdown` renderer, `usePublicLightTheme` hook, signup card, four public pages, cookie banner, public footer. 197/197 frontend tests. |
| **#130** (this PR) | `docs(legal): drafted T&C / Privacy / Cookie content + breach runbook + retention policy + session log` | Five markdown files under `docs/legal/`. Doc-only. |

### Cumulative session totals

- **4 PRs merged** (1 migration, 1 backend, 1 frontend, 1 docs).
- **Backend tests**: 597 → **612** (+15 across `legal.service` + `auth.signup.terms`).
- **Frontend tests**: 184 → **197** (+13 across `LoginPage.terms`, `LegalDocPage`, `CookieBanner`).
- **New routes**: `/api/legal/active`, `/api/legal/:kind/:version`, `/api/legal/me`, `/api/legal/me/accept`. Public pages: `/terms`, `/privacy`, `/cookies`, `/grievance`.
- **Operator actions required**: 2 — (a) apply migration `database/migrations/20260504_legal_documents_and_acceptances.sql` via Supabase SQL editor, (b) run `node scripts/publish-legal-doc.js` three times to seed Terms / Privacy / Cookie. The frontend's submit button will stay disabled with an inline error until step (b) lands.

### What's left to do

1. **Operator: apply the migration** in Supabase SQL editor. Verify with the `pg_class` queries at the bottom of the migration file. Tell Claude when applied.
2. **Operator: seed initial legal docs** — once migration is applied, run:
   ```
   node scripts/publish-legal-doc.js terms_of_service v1 docs/legal/terms_of_service_v1.md
   node scripts/publish-legal-doc.js privacy_policy v1 docs/legal/privacy_policy_v1.md
   node scripts/publish-legal-doc.js cookie_policy v1 docs/legal/cookie_policy_v1.md
   ```
   Each is idempotent — safe to re-run. After this, `GET /api/legal/active` returns the three rows, the signup form's submit becomes enabled, and the public legal pages render the markdown bodies.
3. **Engage a Bengaluru technology / data-protection lawyer** to red-line the DRAFT skeletons and fill in the placeholders ([LEGAL ENTITY NAME], [REGISTERED ADDRESS], [GRIEVANCE OFFICER NAME], [DATE]) before any user other than the founder is onboarded. Budget: ₹40k–₹1.5L for a first-pass review.
4. **Existing-user re-acceptance flow (Phase 2)** — when a new version is published, currently-signed-in users continue to use the Platform without re-prompting. The `legal_documents.is_current` + `users.terms_accepted_at` columns already support this; needs a route guard + modal in the dashboard. Not in scope for this session.
5. **Sign DPAs with sub-processors** (Anthropic, Google, Supabase, Vercel) before the second user is onboarded. Each provider has a self-serve commercial DPA portal as of late 2025 / early 2026.

### Compliance posture after this session

- ✅ DPDP Act 2023 §6 — explicit, informed, recorded consent against a versioned notice.
- ✅ DPDP Act 2023 §11–14 — rights disclosed in Privacy Policy; grievance pathway exists.
- ✅ IT Rules 2021 Rule 3(11) — Grievance Officer page live with named officer, email, SLA.
- ✅ CERT-In Directions April 2022 §II — breach runbook documented with 6-hour reporting workflow.
- ✅ Indian Contract Act 1872 — click-wrap acceptance with audit-grade record (IP, UA, timestamp).
- ✅ Indian Arbitration & Conciliation Act 1996 — sole-arbitrator clause, Bengaluru seat, English language.
- ⏸ DPDP §16 cross-border transfers — disclosed in Privacy Policy; DPA execution with US providers pending.
- ⏸ DPDP §8(4) reasonable safeguards — bcrypt(12) + RLS + HMAC-signed audit log in place; refresh-token rotation, MFA, field-level PII encryption pending (Phase 2/4 of the security roadmap).

---

## 2026-05-10 — Audit log expansion (PR #214)

### What was worked on
Built a generic deal_audit_log so the Audit tab on every deal now shows the full lifecycle — not just financial calculations. Stage moves, archives, restores, owner changes, edits, deletions, and bulk batch actions are all captured with a clean before → after diff, the actor's name, and the time. The financial-events tab keeps its HMAC verify/replay buttons untouched. Wiring is fail-graceful — an audit insert error never blocks the underlying mutation.

### Plain-English recap
- The deal Audit tab now tells the whole story of a deal — every move, archive, owner change, and edit, not just financial recalcs.
- Bulk actions stamp every affected deal with a shared batch id so an analyst can later see "everything that moved in this one click."
- If anything breaks the audit insert (network, missing migration), the actual deal change still goes through cleanly. Investor-grade, but never in the way.

### PRs opened / merged
- PR #214 — `feat(audit): generic deal_audit_log + merged AuditTab timeline` — **merged**.

### Operator action required
Apply `database/migrations/20260524_deal_audit_log.sql` in Supabase. Idempotent. Until applied, the new wiring soft-fails and the Audit tab continues to show financial events only.

### Test counts after merge
- Backend: 1140 tests pass (no change in count; `dealAuditLog.service.test.js` adds 8 cases, two existing tests were updated for the CTE-backed bulkReassign UPDATE shape).
- Frontend: 358 tests pass (+6 new mutation-row tests on AuditTab).

### What's left to do next
1. Operator: apply `20260524_deal_audit_log.sql` and confirm.
2. Smoke: create a deal, walk it through 3 stage transitions, archive then restore, and verify all 5 mutation events appear on the Audit tab alongside any financial computations.
3. Future work: an org-wide audit feed at `/admin/audit` keyed on `bulk_id` so admins can see "everything Rachit did in this batch action," and a CSV export of the audit feed for IC packets.


## 2026-05-10 — Audit feed UX (PR #216)

### What was worked on
With the audit log itself live, this batch made the data actually useful: filter chips on the Audit tab so an analyst can focus on either feed, a one-click CSV export of the full merged history for IC packets, and a "View batch" peek on every bulk-event row that lists every other deal touched by the same one-click action.

### Plain-English recap
- Filter chips at the top of every deal's Audit tab let you flip between All / Financial / Mutations with live counts on each.
- An "Export CSV" button hands you the full audit history of the deal as a clean spreadsheet — drop it straight into an IC packet.
- When a deal was changed as part of a bulk action, a small "View batch" link on the row opens a modal listing every other deal that moved in the same click. The current deal is highlighted in the list.

### PRs opened / merged
- PR #216 — `feat(audit): filter chips, CSV export, bulk-batch peek on AuditTab` — **merged**.

### Operator action required
None. PR #214's migration was already applied; this PR ships pure UX + read-side endpoints on top of that data.

### Test counts after merge
- Backend: 1146 tests pass (+6 new in `auditFeedExport.test.js` — header banner shape, CSV escaping, bulk-batch happy path, missing-migration soft-fail, empty bulk_id short-circuit, generic DB rethrow).
- Frontend: 361 tests pass (+4 new on `AuditTab` — filter chips toggle + counts, CSV export click flow, batch-peek modal opens + populates + tags current deal).

### What's left to do next
1. Smoke (post-deploy): create a deal, run a financial calc, move 3 deals to a new stage as a bulk action; on each affected deal's Audit tab confirm the chips filter correctly, "Export CSV" downloads a valid file, and "View batch" opens a modal listing all 3 deals with the current one highlighted.
2. Future work — org-wide `/admin/audit` page that lists every mutation across the org with filters (event_type, actor, date range, bulk_id). Lets compliance reviewers ask "show me everything Rachit deleted in March" without needing to open each deal.
3. Future work — "Recent activity" widget on the Dashboard, sourced from `deal_audit_log`, so an analyst sees their last 10 actions when they sign in and can pick up where they left off.


## 2026-05-10 — Niche asset-class scaffolds (PR #219) + deferral

### What was worked on
Cross-checked the original handoff doc against current state. Tier 0 (email ingestion + review queue) and most of Tier 1/Tier 2 are already shipped. The genuinely-pending tier-1 items were the four niche asset classes (#6 co-working, #7 student housing, #8 senior living, #9 data centers) and the operator-blocked Karnataka IGR PDFs (#5).

Shipped the schema + service + route + UI scaffold for the four niche classes (PR #219). Section 5g on the Intelligence page will surface rows the moment data lands. Per CLAUDE.md "no fabrication" rule, the table is empty by design — the data flywheel populates it when the operator drops an IPC report or broker quote into the comps review queue.

Operator then paused further work on these tiered items (Tier 1 #5–#9). Recorded the deferral cleanly in `TODO_DATA.md`.

### Plain-English recap
- A new "Niche & Alternatives" filter chip is live on the Market Intelligence page covering co-working, student housing, senior living, and data centers.
- The table behind it is empty for now — it'll fill the moment any IPC report or broker quote lands for one of those classes.
- Per the operator's call, no further autonomous work on these items until they explicitly say "resume."

### PRs opened / merged
- PR #219 — `feat(intelligence): scaffold niche & alternative asset class benchmarks` — **merged**.
- (Follow-on docs PR pending) — `chore(todos): mark tier-1 #5–#9 ON HOLD per operator request`.

### Operator action required
Apply `database/migrations/20260525_niche_asset_class_benchmarks.sql` in Supabase SQL editor. Idempotent. Until applied the new endpoint soft-fails to []; Section 5g stays hidden.

### Test counts after merge
- Backend: 1151 tests pass (+7 in `nicheAssetClassBenchmarks.service.test.js`).
- Frontend: 360 tests pass.

### What's left to do next (NOT including ON HOLD items)
1. **Operator: apply `20260525_niche_asset_class_benchmarks.sql`** in Supabase.
2. Future autonomous candidates that don't touch ON-HOLD work:
   - Org-wide `/admin/audit` page sourced from `deal_audit_log` (compliance review surface).
   - "Recent activity" widget on the Dashboard for the signed-in user.
   - Workspace / Team page + invite flow for adding user #2 (DPDP-aligned).
   - Existing-user re-acceptance modal when a new legal-doc version is published.
   - Project-precise geocoding (replaces locality centroids with Google Geocoding API per project name).


## 2026-05-10 — Tier 1 #10 + Tier 2 #14 closeouts (PR #221, #222)

### What was worked on
Audited the original handoff doc against current state. Apart from the operator-paused Tier 1 #5–#9 stream, the only items still legitimately open were:
- **Tier 1 #10 — project-precise geocoding**: script existed but had no cross-locality fallback when a comp's recorded locality was wrong.
- **Tier 2 #14 — A/B harness**: CLI tool existed; no web surface, no DB persistence, no admin UI.

Closed both.

### Plain-English recap
- The geocode upgrade now has a two-stage fallback: when the precise (project + locality + city) query lands too far from where the comp says it should be, a second (project + city) query fires — accepted only when Google returns a high-precision match. Mis-recorded localities can finally get an accurate map pin.
- A new admin page at `/dashboard/admin/ab-eval` lets you A/B test models without leaving the browser. One click runs the held-out fixture set against Claude vs GPT-5.4-mini (or any other pair), shows side-by-side per-fixture scores, and persists every past run so you can see which model is winning over time.

### PRs opened / merged
- PR #221 — `feat(geocoding): two-stage cross-locality fallback (Tier 1 #10 finish)` — **merged**.
- PR #222 — `feat(ab-eval): web admin surface + persistence (Tier 2 #14 finish)` — **merged**.

### Operator action required
Apply one new migration in Supabase SQL editor:
```
database/migrations/20260526_ab_eval_runs.sql
```
Idempotent. Until applied, the new admin A/B page reads return `[]`/`null`. Triggering a run still produces an in-memory result (visible to the page once) but doesn't persist; a warn lands in server logs.

PR #221 (geocoding) needs no migration — operator runs `node ../scripts/upgrade-comps-geocoding.mjs --apply --allow-cross-locality` from `backend/` when ready to re-pin existing comps.

### Test counts after merge
- Backend: 1198 tests pass (+27 in `geocodeUpgrade.test.js`, +20 in `abEvalPersistence.service.test.js`).
- Frontend: 360 tests pass.

### What's left to do next
After this batch, the original handoff doc has only the operator-paused Tier 1 #5–#9 stream remaining. Genuinely-pending non-blocked items now:

1. **Operator action**: apply `20260526_ab_eval_runs.sql` in Supabase, then trigger a 5-fixture A/B run from the admin UI to confirm the persistence path.
2. **Operator action** (when ready): run the cross-locality geocode upgrade — `node ../scripts/upgrade-comps-geocoding.mjs --apply --allow-cross-locality` from `backend/`. The summary will list any cross-locality corrections worth manually verifying.
3. Beyond the original handoff (surfaced in earlier sessions, not blocking):
   - Org-wide `/admin/audit` page sourced from `deal_audit_log`.
   - "Recent activity" Dashboard widget for the signed-in user.
   - Workspace / Team page + invite flow for adding user #2.
   - Existing-user re-acceptance modal when a new legal-doc version publishes.


## 2026-05-12 — XLSX export integrity fixes (PR #298)

### What was worked on
Reviewed ChatGPT/Grok remarks and the three REDIP workbook exports for Pointec, Jigani, and Commercial Retail. Fixed the highest-risk workbook credibility issues: bad workbook XML/color output, broken carpet-area math when loading factor is zero, mismatched Dashboard project-cost formulas, income-asset sensitivity logic that still behaved like a development model, and chart injection targeting the wrong worksheet.

### Plain-English recap
- Excel exports should now open more reliably in spreadsheet tools.
- Jigani-style exports no longer turn zero loading factor into a broken carpet-area calculation.
- Dashboard cost numbers now point to one project-cost source instead of disagreeing across tiles and Sources & Uses.
- Income deals now show rent, occupancy, annual NOI, and yield-on-cost logic instead of apartment sale-rate/profit logic.

### PRs opened / merged
- PR #298 — `fix(exports): harden XLSX workbook integrity` — opened; CI/merge/deploy handled from the same branch after this log entry.

### Validation
- Backend: 1,501 tests passed.
- XLSX v2 focused suite: 131 tests passed.
- Generated Jigani-like, Pointec-like, and retail-like workbooks passed XML/openpyxl checks.
- Frontend build passed; frontend tests passed (360).
- Financial kernel build passed; financial kernel tests passed (410 passed, 1 skipped).
- Migration lint passed; high/critical npm audits passed.

### What's left to do
Monitor the next real REDIP export from production and compare it against the three sample cases; no manual user action is required for this patch.


## 2026-05-12 — XLSX export QA, provenance, and hard-stop gate (PR #299)

### What was worked on
Finished the remaining ChatGPT/Grok XLSX export remarks as one institutional-grade export batch. The v2 Excel export now blocks misleading downloads when core underwriting inputs are missing, adds a visible QA and Sources tab, records source/provenance comments on input cells, adds filterable source tables, preserves cached values for key formula cells, adds date-based XIRR/XNPV checks, and validates the generated XLSX package before sending it to the browser.

### Plain-English recap
- Incomplete models like Pointec can no longer download as if they are decision-ready when area, rent, or core cost inputs are missing.
- Every exported workbook now has a QA and Sources tab where reviewers can filter checks and see where key inputs came from.
- Input cells now carry source/provenance comments, and source links appear when REDIP has a usable URL.
- Date-based XIRR/XNPV checks now sit inside the cash-flow engine so returns are not limited to simple quarterly IRR/NPV rows.

### PRs opened / merged
- PR #299 — `fix(exports): add XLSX QA provenance gate` — opened from `codex/xlsx-export-qa-provenance`; CI/merge/deploy handled from the same branch after this log entry.

### Validation
- XLSX v2 focused suite: 136 tests passed.
- Full backend suite: 1,506 tests passed.

### What's left to do
No manual user action is required for this patch. The next useful check is downloading one real production workbook after deploy and confirming the QA and Sources tab reads cleanly for a complete model.


## 2026-05-13 - XLSX monthly institutional underwriting tier

### What was worked on
Continued the XLSX export remarks, skipping live paid/official feed integrations and expert legal/tax validation per instruction. Added a deeper institutional workbook tier for monthly underwriting, income lease rolls, development drawdowns, source/use reconciliation, and larger sensitivity/stress analysis across development and income deal families.

### Plain-English recap
- Exports now include a monthly cash-flow view instead of leaving reviewers with only quarterly timing.
- Development deals now show a construction drawdown with monthly S-curve funding, debt draws, and capitalized interest.
- Income deals now include a lease roll view with rent resets, WALE, and expiry concentration.
- Reviewers now get a dedicated Sources & Uses sheet, a larger sensitivity/stress sheet, and dashboard health icons/trend strips.

### PRs opened / merged
- PR #300 - `feat(exports): add monthly underwriting workbook tier` - opened from `codex/monthly-underwriting-tier`; CI/merge/deploy handled from the same branch after this log entry.

### Validation
- Backend XLSX v2 focused suite: 144 tests passed.
- XLSX chart injector suite: 11 tests passed.
- Full backend suite: 1,514 tests passed.

### What's left to do
No manual user action is required for this patch. Paid/official data feeds and expert legal/tax validation remain intentionally skipped for now.


## 2026-05-13 - XLSX monthly dashboard polish and stress removal (PR #301)

### What was worked on
Finished the Excel-focused remainder from the current remarks/screenshot thread. Removed the partial stress/Monte Carlo-style trial scaffold, kept the deterministic 7x7 sensitivity table, switched the Dashboard trend block to monthly cash-flow references, added real Excel sparklines for KPI trend cells, protected formula areas while keeping input cells editable, and deepened income monthly mechanics for retail, warehouse, and hospitality assets.

### Plain-English recap
- The workbook no longer claims partial stress-trial outputs as if they were a full Monte Carlo engine.
- Dashboard trends now show monthly movement from the monthly cash-flow sheet.
- KPI tiles now carry real Excel sparklines instead of text bars.
- Income exports now show clearer CAM recovery, hospitality RevPAR, leasing commission, tenant downtime, and NOI buildup lines.

### PRs opened / merged
- PR #301 - `feat(exports): finish XLSX monthly dashboard polish` - opened from `codex/xlsx-monthly-dashboard-polish`; CI/merge/deploy handled from the same branch after this log entry.

### Validation
- XLSX v2 focused suite: 146 tests passed.
- XLSX chart/sparkline injector suite: 14 tests passed.
- Full backend suite: 1,519 tests passed.
- Frontend production build passed.

### What's left to do
No manual user action is required for this patch. True Monte Carlo remains intentionally skipped per operator instruction.


## 2026-05-14 - Pointec XLSX export unblock

### What was worked on
Fixed the Pointec export blocker where REDIP was treating the saved hospitality assumptions as missing industrial rent, area, and cost inputs. The exporter now respects a deliberate non-residential asset-class selection and converts hospitality assumptions into the generic workbook inputs needed for Excel formulas.

### Plain-English recap
- Pointec can now export because its saved hotel-style assumptions are recognized instead of being rejected as missing warehouse-style inputs.
- Corporate-looking deal names no longer override a deliberate hospitality selection.
- The workbook now uses rooms, nightly rate, occupancy, and cost per room to fill the Excel inputs it needs.

### PRs opened / merged
- None in this session.

### Validation
- Asset-class utility focused suite: 25 tests passed.
- XLSX v2 focused suite: 147 tests passed.
- Generated a real Pointec-shaped workbook from stored data and confirmed it opened with 13 sheets.

### What's left to do
Deploy this patch, then download the production Pointec workbook once to confirm the browser download path is clear.


## 2026-05-14 - Hospitality XLSX financial-engine pro forma

### What was worked on
Rebuilt the hotel XLSX export around the same hospitality assumptions and USALI operating model used by the Financial Engine screen. The workbook now exposes hotel-specific defaults when the user did not enter a value, and links those assumptions through operating revenue, expenses, NOI, sources and uses, debt sizing, dashboard, and waterfall tabs.

### Plain-English recap
- Hotel exports now include a dedicated hotel pro forma tab with linked occupancy, nightly-rate, revenue, expense, NOI, budget, and financing lines.
- Blank hotel inputs now fall back to the REDIP financial engine defaults and show that source in Inputs & Assumptions.
- Cash Flow, Sources & Uses, Dashboard, Debt Sizing, and Waterfall now reconcile to the same hotel model instead of a generic office-style template.
- This matters because an investor can trace the workbook from assumptions to returns without seeing conflicting calculation paths.

### PRs opened / merged
- PR #303 - `fix(exports): link hospitality XLSX to financial engine` - opened from `codex/investor-grade-xlsx-engine-proforma`; CI passed, with squash-merge and deployment handled after this log entry.

### Validation
- XLSX v2 focused suite: 148 tests passed.
- Asset-class utility focused suite: 25 tests passed.
- Generated a Pointec-shaped hospitality workbook locally and confirmed the Cash Flow Engine and Sources & Uses formulas link into the USALI Pro Forma sheet.

### What's left to do
Squash-merge PR #303, deploy it, then download the production Pointec workbook once to confirm the export path is clean.


## 2026-05-14 - Financial model integrity audit

### What was worked on
Aligned XLSX pro forma exports with the deterministic Financial Engine assumptions and defaults. The export now keeps saved effective dates, resolves the kernel's default naming aliases, converts loading factor correctly between engine and workbook conventions, uses income-asset defaults for blank rent/vacancy/cap-rate assumptions, and reconciles plotted-development saleable area with gross-land development cost.

### Plain-English recap
- Workbooks now use the same saved assumptions and fallback defaults as the Financial Engine.
- Blank default-backed fields now show their source instead of quietly becoming generic workbook numbers.
- Dates, loading factor, rent, vacancy, cap rate, debt, GST, and plotted-development costs now trace more clearly from inputs to formulas.
- This matters because the Excel model is less likely to disagree with REDIP's own underwriting screen.

### PRs opened / merged
- PR #304 - `fix(exports): align XLSX pro formas with financial engine` - opened from `codex/financial-model-integrity-audit`.

### Validation
- Financial kernel build passed.
- Financial kernel input-schema suite: 17 tests passed.
- XLSX v2 focused suite: 152 tests passed.
- Financial kernel all-asset smoke suite: 10 tests passed.
- Asset-class utility focused suite: 25 tests passed.
- Legacy deal XLSX service suite: 3 tests passed.

### What's left to do
Wait for PR #304 CI, then merge and deploy once checks pass.


## 2026-05-14 - Editable slim XLSX workbooks

### What was worked on
Made REDIP XLSX exports open as editable workbooks and reduced the number of worksheet tabs. QA and source details now sit inside Inputs & Assumptions, Sources & Uses stays on the Dashboard, Sponsor / LP Waterfall sits inside the debt sheet, and extra standalone detail sheets are no longer emitted.

### Plain-English recap
- Excel exports no longer show a sheet-protection warning when users edit cells.
- Normal deal workbooks now stay to 6 worksheets, while hospitality workbooks stay to 7 because they keep the hotel pro forma.
- QA/source tracking is still included, but it is merged into Inputs & Assumptions instead of appearing as its own tab.
- This matters because the exported model is easier for investors and operators to audit without losing important traceability.

### PRs opened / merged
- PR #305 - `fix(exports): simplify XLSX workbook structure` - opened from `codex/unprotected-slim-xlsx-workbooks`.

### Validation
- XLSX v2 focused suite: 149 tests passed.
- Asset-class utility focused suite: 25 tests passed.
- Legacy deal XLSX service suite: 3 tests passed.
- Financial kernel all-asset smoke suite: 10 tests passed.

### What's left to do
Wait for PR #305 CI, then merge and deploy once checks pass.


## 2026-05-14 - Debt phases and investor waterfall modeling

### What was worked on
Upgraded the XLSX export so the debt schedule and sponsor/LP waterfall model the remaining investor-grade pieces. The workbook now has construction-to-permanent debt assumptions, construction draws, capitalized construction interest, conversion/refi timing, permanent-loan moratorium timing, and a quarterly LP/GP waterfall with preferred return, return of capital, sponsor catch-up, and hurdle-ladder promote splits.

### Plain-English recap
- Excel exports now show construction debt and permanent debt as separate financing stages.
- The waterfall now distributes cash across quarterly dates instead of treating the deal as one final payout.
- LP preferred return, LP capital return, sponsor catch-up, and higher promote tiers are now linked formulas.
- This matters because the workbook is more credible for investor review and easier to audit.

### PRs opened / merged
- PR #306 - `fix(exports): model debt phases and waterfall tiers` - opened from `codex/debt-waterfall-modeling-upgrade`.

### Validation
- XLSX v2 focused suite: 150 tests passed.

### What's left to do
Wait for PR #306 CI, then merge and deploy once checks pass.


## 2026-05-14 - Monthly cash flow circular-reference fix

### What was worked on
Fixed the XLSX export formula bug that made the Monthly Cash Flow total column include itself in its own SUM range. This caused Excel to warn about circular references, especially in long hospitality workbooks such as Pointec.

### Plain-English recap
- Monthly Cash Flow totals now sum only the real monthly columns.
- Final-balance rows now point to the last real month, not the Total column.
- The same guard was applied to the older construction drawdown builder.
- This matters because Excel should open the exported workbook without circular-reference warnings.

### PRs opened / merged
- Pending PR from `codex/fix-xlsx-circular-references`.

### Validation
- XLSX v2 focused suite: 151 tests passed.

### What's left to do
Open the PR, wait for CI, merge, deploy, then re-download Pointec once to confirm Excel opens cleanly.


## 2026-05-15 - Pointec workbook Excel repair fix

### What was worked on
Fixed the XLSX export issue that made Microsoft Excel repair the Pointec workbook and remove the Inputs & Assumptions sheet. The workbook generator now writes the Inputs sheet in the order Excel expects when the sheet contains notes, source links, and filterable QA/source tables.

### Plain-English recap
- Pointec exports should now open without Excel asking to repair the file.
- Inputs & Assumptions should stay intact with the assumptions, notes, links, and QA/source details visible.
- A repaired local copy was created on the Desktop for the already-downloaded Pointec workbook.
- This matters because users can trust the exported model to keep its assumptions and audit trail.

### PRs opened / merged
- PR #307 - `fix(exports): remove monthly cash flow circular refs` - merged and deployed.
- PR #308 - `fix(xlsx): prevent inputs sheet repair in Excel` - opened, merged, and deployed.

### Validation
- XLSX v2 focused suite: 152 tests passed.
- PR #308 CI passed on backend, frontend, financial kernel, and audit/migration lint.
- Production Vercel deployment completed for commit `549df84`.
- Repaired Pointec workbook validated with all 7 expected worksheets intact.

### What's left to do
Re-download Pointec from production and open it in Excel once as a final user-facing smoke check.


## 2026-05-15 - Cash Flow Engine display recalculation fix

### What was worked on
Fixed the XLSX export behavior that could make formula-heavy worksheets such as Cash Flow Engine appear blank until Excel recalculated the workbook. New exports now force Microsoft Excel to rebuild formulas on open and remove stale calculation-chain metadata.

### Plain-English recap
- Cash Flow Engine should now show calculated values when a fresh export opens.
- The workbook still keeps formulas and links so users can edit assumptions and rerun sensitivities.
- A recalculated local copy of the Pointec workbook was created on the Desktop.
- This matters because users should not see a blank-looking engine sheet when the model data is present.

### PRs opened / merged
- PR #310 - `fix(xlsx): force cash flow recalculation on open` - opened, merged, and deployed.

### Validation
- XLSX v2 focused suite: 153 tests passed.
- PR #310 CI passed on backend, frontend, financial kernel, and audit/migration lint.
- Production Vercel deployment completed for commit `bbc48b5`.
- Local recalculated Pointec workbook had cached display values for all Cash Flow Engine formula cells.

### What's left to do
Re-download Pointec from production and open it in Excel to confirm the Cash Flow Engine displays values immediately.


## 2026-05-20 - Compliance, security & data-governance: plan + Phase 0/1 kickoff

### What was worked on
Read three external research documents (an India proptech legal research pack, a data-use & security strategy, and a Karnataka/Bengaluru legal-privacy-compliance pack) word for word, then audited the actual REDIP codebase against every recommendation in them. Finding: the codebase already implements most of what the documents proposed building (Postgres RLS multi-tenancy, MFA, Google OAuth, full httpOnly-cookie auth, versioned legal documents with auditable acceptance, HMAC-signed audit trail, scheduled DPDP erasure, daily retention cron, strong security headers + CSP). Produced one unified, verified compliance / security / data-governance / architecture plan — operator-approved — that closes only the genuine gaps and is oriented to passing an institutional investor's security & privacy diligence. Began executing it.

### Plain-English recap
- REDIP now refuses to start in production if a critical security setting is missing or left as a placeholder — it fails safe instead of running insecurely.
- The secret that keeps you signed in is no longer kept anywhere a malicious browser script could read it; it lives only in a protected cookie.
- There is now a clear, honest security & privacy document that answers the questionnaire funds and banks send during diligence.
- Why it matters: these are the first concrete steps toward REDIP passing an institutional investor's security review.

### PRs opened / merged
- PR #436 - `chore(config): fail-closed boot-time env validation + refresh .env.example (PR-NX80)` - opened; awaiting operator merge.
- PR #437 - `fix(auth): stop persisting the access token in browser storage (PR-NX81)` - opened; awaiting operator merge.
- PR #438 - `docs: add security & privacy overview for diligence (PR-NX82)` - opened; awaiting operator merge.

### Validation
- PR #436: full backend suite 2079 tests / 123 suites pass; new validateEnv test covers 6 cases.
- PR #437: full backend suite 2079 tests pass; full frontend suite 630 tests / 64 files pass; production build clean.
- PR #438: docs-only; no code paths affected.
- Live login smoke check (DevTools storage shows no token) is listed as a manual step in PR #437 — it needs a running stack + a test account.

### What's left to do
- Operator: merge PR #436, #437, #438 (each merge publishes to the live site); merge PR #436 first.
- Operator: rotate the Supabase database password flagged in the data-use document; set up and monitor the security@redip.in mailbox.
- Next sessions, per the approved plan file: Phase 1.2 (AI-prompt PII redaction + prompt-injection guard), Phase 1.3 (security_events incident-register table), Phase 2 (enterprise-diligence pack — granular consent, Privacy Centre, DPA, RoPA, breach runbook), Phase 3 (anonymized-benchmark-layer foundation), Phase 4 (broader architecture — One Brain DealContext, ontology adoption).


## 2026-05-20 - Security hardening: Phase 0 + Phase 1 completed

### What was worked on
Continued the operator-approved compliance & security plan. Merged the four
Phase-0/1 pull requests opened earlier the same day (#436 boot-time env
validation, #437 httpOnly-only session token, #438 security overview, #439
session log). Did a focused technical review — confirmed the codebase is
mature and clean (zero FIXME/HACK markers, the "One Brain" unified deal
endpoint already shipped, AI layer mature) — then shipped the final two
Phase-1 items.

PR #440 — a `security_events` incident register: a new table + service that
records security-relevant events (account lockouts, AI cost-cap breaches,
suspected breaches, vendor incidents) with severity, status, and the
CERT-In / DPDP reporting clocks. Fail-open and migration-tolerant.

PR #441 — Aadhaar/PAN redaction in the document-extraction pipeline:
extracted text and fields are scrubbed of PAN and spaced-Aadhaar numbers
before they are stored, indexed for search, or sent to the second AI pass.
Deliberately precise — khata / survey / company names are never masked.

With these, Phase 0 and Phase 1 of the approved plan are complete.

### Plain-English recap
- REDIP now has a dedicated place to log and track security incidents, with the legal reporting deadlines attached to each one.
- Identity numbers (PAN, Aadhaar) in uploaded documents are now automatically blanked out of everything REDIP stores and processes after it reads the document.
- The earlier safety work — fail-safe startup, the secure login token, and the investor security document — is live on the site.
- Why it matters: the platform's whole Phase-0/1 security baseline is now shipped, which is the groundwork an institutional investor's security review expects.

### PRs opened / merged
- PR #436, #437, #438, #439 — merged.
- PR #440 - `feat(security): security_events incident register table + service (PR-NX84)` - opened, CI green, merged.
- PR #441 - `feat(ai): redact Aadhaar/PAN in the document-extraction pipeline (PR-NX85)` - opened, CI green, merged.

### Validation
- Full backend suite green at every step (2079 -> 2091 -> 2092 tests, 124 suites).
- All CI checks passed on #440 and #441 (backend, frontend, financial kernel, audit/migration lint, Vercel deploy).

### What's left to do
- Operator: apply migration `database/migrations/20260605_security_events.sql` in the Supabase SQL editor. The deployed code is safe without it (the service is migration-tolerant); the table just needs to exist before incidents can be recorded.
- Operator: rotate the Supabase database password noted earlier; set up and monitor the security@redip.in mailbox.
- Next: Phase 2 of the plan — granular consent (`user_consents`), the Privacy Centre (see / export / delete-my-data), the DPA + Acceptable Use legal documents (needs counsel review), the public subprocessor page, the RoPA, and operationalizing the breach runbook.


## 2026-05-20 - AI outage fixes + Phase 2 (consent + diligence pack) + Phase 3.1

### What was worked on

Two threads in one session.

**Thread 1 — the AI provider outage.** The AI Provider Health widget was
all-red. A code-level investigation found three genuine, separate bugs (not
expired keys):

- PR #443 / #444 area — AI API keys were read from environment variables
  without trimming, so a trailing newline on a stored key produced a
  `401 invalid x-api-key` on every call. Fixed by trimming keys at the
  provider boundary and adding a boot-time key-format check that warns on
  whitespace or a wrong provider prefix. (Migration `20260606` also widened
  the `ai_call_logs` status constraint so `cache_hit` / `cost_capped` rows
  stop being rejected, and corrected the health-page success-rate maths.)
- PR #445 — `providerRegistry.js` never exported the raw client getters
  (`getGeminiClient` / `getOpenAIClient` / `getAnthropicClient`), so the
  export narrative + market-context cascades threw "client unavailable" for
  Gemini and OpenAI on every call. Fixed by adding the getters to the
  module's exports.
- PR #446 — a DOCX export produced a corrupt file because the site-map
  image was added without an image type, writing a `.undefined` media part.
  Fixed by setting `type: 'png'`.

All four AI/export fixes were merged; migration `20260606` was applied by
the operator.

**Thread 2 — Phase 2 + Phase 3.1 of the compliance plan.**

- PR #447 (PR-NX91) — granular per-purpose consent, backend foundation. A
  new append-only `user_consents` ledger (migration `20260607`), a
  `consent.service.js` (record / withdraw / read current state / history,
  with graceful degradation until the table is migrated), and a
  `/api/consent` route. Four purposes: product improvement, anonymized
  benchmarking, marketing, AI processing. A withdrawal is a new row, never
  an update, so consent history is fully auditable. 20 new unit tests.
  This satisfies DPDP §6 "specific" consent and is the prerequisite for the
  Phase 3 benchmark layer. CI green; awaiting operator merge.

- PR #448 (PR-NX92) — the diligence documentation pack + the data model.
  New: a Record of Processing Activities (`docs/legal/ropa.md`), a Backup &
  Disaster Recovery posture (`docs/legal/backup_and_dr.md`), and a
  five-layer data-governance model (`docs/DATA_GOVERNANCE.md`) that maps
  every table to a sensitivity layer and defines the cross-tenant boundary
  rules for the benchmark feature. Reconciled: the Data Retention Policy
  (it claimed erasure was "manual / Phase 4" — it is in fact a live daily
  cron) and the breach runbook (now opens a `security_events` row and
  references the DR procedure). `SECURITY.md` §16 roadmap refreshed.
  Documentation only; CI green; awaiting operator merge.

- PR #449 (PR-NX93) — this session-log entry.

### Plain-English recap
- The AI features are fixed — the all-red health widget was three real code bugs (untrimmed keys, missing internal wiring, a bad image export), not expired API keys; all three are fixed and live.
- The platform can now remember a user's separate yes/no choices for things like marketing or sharing anonymized data — with a full, tamper-proof history — once the matching database update is applied.
- The written evidence an enterprise investor's security team asks for now exists: a data-processing map, a disaster-recovery plan, an honest retention policy, and the rulebook for keeping one customer's deal data separate from another's.
- Why it matters: this clears the AI outage and delivers the bulk of the enterprise-diligence groundwork that institutional investors expect before they commit.

### PRs opened / merged
- PR #443, #444, #445, #446 — AI outage + DOCX export fixes — opened, CI green, merged.
- PR #447 - `feat(consent): DPDP §6 per-purpose consent ledger (PR-NX91)` - opened, CI green (127 suites / 2134 tests), awaiting operator merge.
- PR #448 - `docs(compliance): diligence pack + five-layer data model (PR-NX92)` - opened, CI green, awaiting operator merge.
- PR #449 - `docs: session log for the AI-fix + Phase 2/3.1 session (PR-NX93)` - this entry.

### Validation
- Full backend suite green: 127 suites / 2134 tests (includes 20 new consent tests).
- `consent.routes.js` smoke-loaded cleanly; `server.js` route mount verified by the suite's app-mounting tests.
- All CI checks passed on #447 and #448 (backend, frontend, financial kernel, audit/migration lint, Vercel deploy).
- PR #448 is documentation only — no code paths touched; every factual claim cross-checked against `retentionSweep.service.js`, `accountClosure.service.js`, `vercel.json`, and the migration set.

### What's left to do
- Operator: merge PR #447, then apply migration `database/migrations/20260607_user_consents.sql` in the Supabase SQL editor (the deployed code is migration-tolerant, but the table must exist before consent can be recorded). Then merge PR #448 and #449.
- Operator: confirm the Supabase plan tier / PITR status and record it in `backup_and_dr.md`; run one backup restore drill; fill the Incident Lead / Legal Liaison names and drill date in the breach runbook before external launch.
- Operator: set up and monitor the `security@redip.in` mailbox; engage Indian legal counsel for the DPA + Acceptable Use documents (Phase 2.3 is blocked on counsel — those texts must not be authored unilaterally).
- Next: Phase 2.2 — the Privacy Centre (see / download / correct my data, consent management UI), which depends on PR #447 being merged. Phase 2.3 — DPA / AUP (counsel) + the public subprocessor page. Phase 3.2 / 3.3 — the org-level "do not benchmark" switch and the `included_in_aggregate` eligibility flag, deliberately deferred per the plan until a real benchmark query exists. Phase 4 — broader architecture.


## 2026-05-20 - Phase 2.2 — Privacy Centre shipped

### What was worked on

Built and shipped the Privacy Centre — Phase 2.2 of the compliance plan, and
the user-facing surface for the granular-consent backend (PR-NX91). After a
deep review of the frontend (routing, the Settings page, the design system,
the existing grievance page) and the relevant backend schemas, the feature was
built as one well-integrated vertical slice.

PR #450 (PR-NX94):
- Backend — a new DSAR (Data Subject Access Request) service implementing the
  DPDP §11 right of access: a page overview (profile, workspaces, legal
  acceptances, active sessions) and a full machine-readable personal-data
  export. The export is identity-gated — password accounts must re-enter their
  password so a stolen session cannot one-click exfiltrate the file; OAuth-only
  accounts are verified by the session. New `/api/privacy` routes, rate-limited.
  No schema change — the service is pure read aggregation.
- Frontend — a new Privacy Centre page at `/dashboard/privacy`: see your data,
  per-purpose consent switches (wired live to the consent ledger), legal
  agreements accepted, active sign-ins, a password-confirmed data download, a
  link to the Grievance Officer, and account closure (reused). Reachable from a
  new "Privacy & your data" card in Settings.
- 16 new tests (11 backend DSAR, 5 frontend page).

### Plain-English recap
- There is now a "Privacy & your data" screen where a user can see exactly what REDIP knows about them, download a copy as a file, and individually switch things like marketing email or anonymised benchmarking on or off.
- It is reachable from Settings, and it covers the rights — see, download, consent, complain, delete — that India's data-protection law gives every user.
- Why it matters: it turns the consent engine shipped earlier into something a user (and an enterprise security reviewer) can actually see and use.

### PRs opened / merged
- PR #450 - `feat(privacy): Privacy Centre — DPDP §11 data access, export & consent UI (PR-NX94)` - opened, CI green, merged.
- PR #451 - `docs: session log for the Privacy Centre session (PR-NX95)` - this entry.

### Validation
- Backend: 128 suites / 2145 tests green. Frontend: 65 files / 635 tests green. Frontend production build clean.
- All CI checks passed on #450 (backend, frontend, financial kernel, audit/migration lint, Vercel deploy).

### What's left to do
- Phase 2.3 — publish the DPA + Acceptable Use legal documents (blocked on Indian legal counsel — must not be authored unilaterally) and the public subprocessor page (deferred to land alongside the counsel-reviewed legal docs).
- Phase 3.2 / 3.3 — the org-level "do not benchmark" switch and the `included_in_aggregate` eligibility flag, deliberately deferred per the plan until a real benchmark query exists.
- Phase 4 — broader architecture (ontology adoption across deal forms; porting the verified-comps validators to fire at financial-input time).
- Operator: confirm the Supabase backup tier and run a restore drill; fill the breach-runbook names; set up the `security@redip.in` mailbox; engage counsel for the DPA / AUP.


## 2026-05-20 - Phase 5 added to the plan + Phase 5.1 (learning loop) shipped

### What was worked on

Extended the plan with a new **Phase 5 — The Learning Loop**: a measured
"data flywheel" where REDIP improves from the documents it processes and the
corrections users make. The operator's framing ("auto-learning, reinforcement
learning, auto-adaptive") was translated into the honest, deliverable version —
operationalised feedback loops with hard guardrails (learning never touches the
deterministic kernel; nothing auto-applies; all data use is consent-gated). The
operator approved capturing usage signal (consent-gated), building REDIP's own
small ML comp-ranker, and deferring the market-understanding payoff.

Then shipped the first working slice — PR #452 (PR-NX96):
- A new `improvement_signals` table (Layer-5 telemetry, migration `20260608`)
  and `learningSignals.service.js`. When a reviewer corrects an AI document
  extraction, REDIP now records — per field — whether it was corrected. The
  capture is values-free (field names only, never values), consent-gated (the
  reviewer's `product_improvement` consent decides whether the row is
  attributed), and fire-and-forget (it can never break the correction flow).
- An extraction-accuracy aggregate + `GET /api/admin/extraction-quality`, and
  an operator-only `ExtractionQualityWidget` on the admin AI-usage page that
  shows the running accuracy and the weakest fields.
- 12 new tests (8 backend, 4 frontend).

### Plain-English recap
- REDIP now keeps score of how accurately it reads documents — every time someone reviews and corrects an AI extraction, it records which fields it got right and wrong (field names only, never the actual values).
- An operator-only screen shows the running accuracy and which fields are weakest — the shortlist for improving the AI.
- Why it matters: this is the first real "REDIP gets better the more it's used" loop — everyday review work now feeds measurable quality improvement.

### PRs opened / merged
- PR #452 - `feat(learning): extraction-review signal capture + accuracy widget (PR-NX96)` - opened, CI green, merged.
- PR #453 - `docs: session log for the learning-loop session (PR-NX97)` - this entry.

### Validation
- Backend: 129 suites / 2153 tests green. Frontend: 66 files / 639 tests green. Frontend production build clean.
- All CI checks passed on #452.

### What's left to do
- Operator: apply migration `database/migrations/20260608_improvement_signals.sql` in the Supabase SQL editor (the code is migration-tolerant — signal capture is a silent no-op and the widget shows a "being set up" message until the table exists).
- Phase 5.3 — the comp-similarity ML ranker (operator-approved), and promoting the A/B eval harness to a standing quality system (Phase 5.2 full).
- Phase 2.3 — DPA / AUP (counsel) + the public subprocessor page.
- Phase 4 — broader architecture (ontology adoption; verified-comps validators at input time).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel for the DPA / AUP.


## 2026-05-20 - Public sub-processor page + comp-ranker review

### What was worked on

Reviewed the comp-similarity scorer ahead of the operator-approved Phase 5.3
"comp-ranking ML model". `backend/src/utils/compSimilarity.js` is already a
sound, deterministic, explainable 6-factor scorer (distance, asset class, BHK,
vintage, size band, amenities), surfaced in the deal Comps tab. A trained ML
ranker was **deferred** — premature (no relevance training data yet) and a
regression in the explainability the underwriting domain (and CLAUDE.md)
require. The honest version waits for real relevance signal.

Shipped instead the buildable half of Phase 2.3 — PR #454 (PR-NX98):
- A public `/subprocessors` page listing the third-party services REDIP uses
  (Supabase, Vercel, Anthropic, OpenAI, Google, Resend), the data each handles,
  and where it runs, with a data-residency note. Linked from the public footer.
  Mirrors the other public legal pages.
- `SECURITY.md` §16 reconciled — granular consent + self-service data
  access/export → "In place" (Privacy Centre), sub-processor page → "In place",
  DPA → "Planned — pending legal counsel".
- 3 component tests.

### Plain-English recap
- There's now a public page that openly lists every outside company REDIP uses to run the platform, what each does, and which country it operates in.
- It's linked from the footer on the public pages.
- Why it matters: enterprise security reviewers expect this transparency, and it's now a finished page rather than a checklist promise.

### PRs opened / merged
- PR #454 - `feat(legal): publish the public sub-processor disclosure page (PR-NX98)` - opened, CI green, merged.
- PR #455 - `docs: session log for the sub-processor-page session (PR-NX99)` - this entry.

### Validation
- Frontend: 67 files / 642 tests green. Production build clean. Backend untouched.
- All CI checks passed on #454.

### What's left to do
- Phase 5.3 — the comp-ranking model: deferred until there is real comp-relevance training signal; the existing deterministic scorer stands.
- Phase 5.2 (full) — promote the A/B eval harness to a standing quality system.
- Phase 4.2 — ontology adoption across deal forms.
- Phase 2.3 — the DPA + Acceptable Use legal documents (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel for the DPA / AUP.


## 2026-05-20 - Plan rewrite + Workstream B (the Deal Risk Radar) shipped

### What was worked on

The plan was reorganised from a linear phase list into the **product plan**,
structured around seven outcome workstreams (Provenance Spine, Risk Sentinel,
Data Network, Adaptive Face, Spatial Canvas, Foundations, Compliance Close-out)
with the trust-engine thesis up front. WhatsApp intake was marked deferred per
the operator; the comp-ranker ML model stays deferred (the existing
deterministic scorer is sound).

Then shipped the first slice of **Workstream B — the Risk Sentinel** — PR #456
(PR-NX100), the **Deal Risk Radar**:
- A new `riskRadar.service.js` + `GET /deals/:dealId/risk/radar` — a
  deterministic, no-AI synthesis across five failure modes (Title & Ownership,
  Approvals & Regulatory, Financial, Physical & Technical, Market & Demand).
  For each it computes a posture — flagged / cleared / **unverified** — from
  the deal's own risk flags, due-diligence items, and approvals, with
  explainable signals. "Unverified" is a first-class state: a check nobody has
  run is surfaced as loudly as a confirmed risk. No schema change.
- A new `RiskRadarPanel` pinned to the top of the Risk tab — a calm pre-mortem
  board.
- 14 new tests (11 backend, 3 frontend).

### Plain-English recap
- The Risk tab now opens with a "Risk Radar" — a standing checklist of what most often sinks a deal in India: title, approvals, money, the site, the market.
- For each, it says plainly whether it is cleared, flagged as a problem, or simply not checked yet.
- Why it matters: REDIP now warns about the *unchecked* things — the blind spots that cause expensive surprises — not just the risks someone already wrote down.

### PRs opened / merged
- PR #456 - `feat(risk): Deal Risk Radar — standing per-failure-mode pre-mortem (PR-NX100)` - opened, CI green, merged.
- PR #457 - `docs: session log for the Risk Radar session (PR-NX101)` - this entry.

### Validation
- Backend: 130 suites / 2164 tests green. Frontend: 68 files / 645 tests green. Production build clean.
- All CI checks passed on #456. No migration — the radar is pure read synthesis.

### What's left to do
- Workstream B continued — surface a compact radar on the deal Overview tab; B4 promoter track-record scoring.
- Workstream A — the Provenance Spine (claims model, confidence bands, IC memo as an audited view).
- Workstream F — schema baseline squash, theme-token unification, ontology adoption.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-20 - Workstream B continued — Risk Radar on the deal front page

### What was worked on

Continued Workstream B (the Risk Sentinel). The full Risk Radar shipped on the
Risk tab in PR-NX100; this slice puts the sentinel where it belongs — on the
deal's front page.

PR #458 (PR-NX102):
- A new `RiskRadarStrip` — a compact, one-glance per-failure-mode posture strip
  (Title / Approvals / Financial / Physical / Market, each cleared /
  not-verified / flagged), pinned to the Overview tab below the Deal Pulse
  ribbon. The whole strip links through to the full radar on the Risk tab.
- Reuses the `/risk/radar` read from PR-NX100 — no new backend, no migration.
- Stays quiet on the front page if the radar can't load. 3 component tests.

### Plain-English recap
- A deal's front page now shows a small "Risk Radar" line — five quick verdicts on what most often sinks a deal (title, approvals, money, the site, the market): cleared, flagged, or not checked yet.
- Clicking it opens the full breakdown on the Risk tab.
- Why it matters: the deal team sees the warning the moment they open a deal, instead of going to look for it — which is the whole point of a sentinel.

### PRs opened / merged
- PR #458 - `feat(risk): surface a compact Risk Radar on the deal Overview (PR-NX102)` - opened, CI green, merged.
- PR #459 - `docs: session log for the Overview Risk Radar session (PR-NX103)` - this entry.

### Validation
- Frontend: 69 files / 648 tests green. Production build clean. Backend untouched.
- All CI checks passed on #458. No migration.

### What's left to do
- Workstream B — B4 promoter track-record scoring (a structured, scored field; needs a small data-model decision).
- Workstream A — the Provenance Spine (claims model, confidence bands, IC memo as an audited view) — the large, high-leverage piece; needs careful multi-session work.
- Workstream F — schema baseline squash, theme-token unification, ontology adoption.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-20 - Workstream B (B4) — promoter track record shipped

### What was worked on

Finished Workstream B with B4 — promoter / builder track record. Promoter
execution risk is a named catastrophic Indian-RE failure mode the deal model
had no home for; this gives it one and wires it into the Risk Radar.

PR #460 (PR-NX104):
- New migration `20260609` — `deal_promoter_profiles`, one row per deal: the
  analyst's verified findings on the promoter (identity, delivery history,
  RERA standing), with verified_by / verified_at provenance.
- New `promoterProfile.service.js` — get / full-document upsert + a
  deterministic execution posture (cleared / unverified / flagged) from the
  delivery rate, RERA registration, and complaint count. No AI; migration-
  tolerant.
- New `/deals/:dealId/promoter` routes. The Risk Radar gains a sixth failure
  mode — Promoter & Execution — fed by that posture.
- New `PromoterProfileCard` on the Risk tab (view + edit); the Overview radar
  strip shows the Promoter chip too.
- 17 new tests (13 backend, 4 frontend).

### Plain-English recap
- REDIP can now record and judge a builder's track record — projects delivered on time vs. late, RERA registration, complaints — and give a plain verdict.
- "Promoter & Execution" is now the sixth item on the deal's Risk Radar.
- Why it matters: a promoter who chronically delivers late is one of the biggest, most predictable ways an Indian real-estate deal goes wrong — and until now REDIP had nowhere to even write that down.

### PRs opened / merged
- PR #460 - `feat(risk): promoter track-record profile + 6th Risk Radar mode (PR-NX104)` - opened, CI green, merged.
- PR #461 - `docs: session log for the promoter track-record session (PR-NX105)` - this entry.

### Validation
- Backend: 131 suites / 2178 tests green. Frontend: 70 files / 652 tests green. Production build clean.
- All CI checks passed on #460.

### What's left to do
- Operator: apply migration `database/migrations/20260609_deal_promoter_profiles.sql` in the Supabase SQL editor (the code is migration-tolerant — the promoter card shows "not verified" until the table exists).
- Workstream A — the Provenance Spine (claims model, confidence bands, IC memo as an audited view) — the large, high-leverage piece; needs careful multi-session work.
- Workstream F — schema baseline squash, theme-token unification, ontology adoption.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-20 - Workstream A (Provenance Spine) — Model Confidence

### What was worked on

Opened Workstream A — the Provenance Spine — with its safest first slice: a
read-side Model Confidence summary. No engine change, no kernel change, no new
database table; the classification is deterministic and stores nothing.

PR #462 (PR-NX106):
- New `modelConfidence.service.js` — reads a saved model's persisted input set
  (`model_params.inputs`, exactly what the analyst's form submitted) and
  classifies each material input as either deal-set (a deal-specific fact, or
  an assumption moved off the benchmark) or default (still on REDIP's cited
  benchmark). An assumption is credited as deal-set only when it provably
  departs from the kernel's `getDefaultMeta` citation — conservative by
  design, so the panel under-claims rather than over-claims confidence.
- New `GET /financials/:dealId/model-confidence` route; never errors for a
  missing model or uncatalogued class — the panel just hides.
- New `ModelConfidencePanel` on the Financials page — headline %, proportion
  bar, band chip (Well-grounded / Mixed basis / Assumption-led) and an
  expandable per-input breakdown showing each input's basis + benchmark
  source. States plainly it is not a document-verification check.
- 17 new tests (10 backend, 7 frontend).

### Plain-English recap
- After you calculate a financial model, REDIP now shows a "Model Confidence" card — one number telling you how much of the model is set for this specific deal versus still running on REDIP's standard benchmark assumptions.
- Open the breakdown to see every key input tagged deal-specific or benchmark-default, and which benchmark each default came from.
- Why it matters: a model built mostly on placeholder assumptions used to look exactly as solid as one built on verified deal facts. Now the team sees the difference instantly — and knows which assumptions to nail down before IC.

### PRs opened / merged
- PR #462 - `feat(financials): Model Confidence summary — deal-set vs benchmark inputs (PR-NX106)` - opened, CI green, awaiting operator merge.
- PR #463 - `docs: session log for the Model Confidence session (PR-NX107)` - this entry.

### Validation
- Backend: 132 suites / 2188 tests green. Frontend: 71 files / 659 tests green. Production build clean.
- All CI checks passed on #462. No migration — read-side only.

### What's left to do
- Operator: merge PR #462 to publish the Model Confidence panel.
- Workstream A continued — the deeper provenance work: confidence bands on IRR/NPV (the in-kernel change, a careful follow-up) and the claim graph / IC memo as an audited view.
- Workstream F — schema baseline squash, theme-token unification, ontology adoption.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: apply migration `20260609_deal_promoter_profiles.sql`; Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-20 - Workstream A (Provenance Spine) — Confidence Range

### What was worked on

Slice 2 of Workstream A, the natural follow-up to the Model Confidence panel.
Model Confidence reports how many inputs are set for the deal vs. on benchmark
defaults; Confidence Range answers what that uncertainty does to the headline
numbers.

PR #464 (PR-NX108):
- New `confidenceRange.service.js` — for each headline KPI (IRR, NPV, equity
  multiple) it reports a deterministic range: the kernel re-run with every
  still-unverified assumption swept across its cited benchmark band. Only
  unverified assumptions widen the range; an input the analyst set for the
  deal is trusted and contributes nothing — so verifying inputs visibly
  tightens the band.
- No engine change. It re-runs the existing deterministic kernel with
  perturbed inputs — the same mechanism financial.service already uses for
  sensitivity / scenarios / the provenance graph. Every range endpoint is a
  real, reproducible kernel run, never a fabricated probability interval.
- Per-input drivers ranked by impact ("verify this assumption next"), each
  citing its benchmark source.
- New `GET /financials/:dealId/confidence-range` route; soft-fails to
  { available: false } for a missing model or uncatalogued class.
- The Model Confidence material-input catalogue is now a shared export so the
  two Provenance-Spine panels classify inputs identically.
- New `ConfidenceRangePanel` on the Financials page, directly below Model
  Confidence — range bars per KPI, an expandable driver breakdown, an honest
  footnote (the range is not a probability forecast).
- 14 new tests (7 backend, 7 frontend).

### Plain-English recap
- The Financials page now shows a "Confidence Range" card under Model Confidence: for IRR, NPV and equity multiple it shows a range, not just a single number — how far the headline figure could move because of assumptions nobody has verified.
- Expand it to see which assumptions are responsible, biggest first, each with the benchmark it came from — a ready-made "go check these" list.
- Why it matters: "IRR 18.4%" hides how solid or shaky it is. This turns it into an honest range, and ties it to the work of verifying inputs — verify an assumption and the range shrinks.

### PRs opened / merged
- PR #464 - `feat(financials): Confidence Range — KPI bands from unverified assumptions (PR-NX108)` - opened, CI green, merged.
- PR #465 - `docs: session log for the Confidence Range session (PR-NX109)` - this entry.

### Validation
- Backend: 133 suites / 2195 tests green. Frontend: 72 files / 666 tests green. Production build clean.
- All CI checks passed on #464. No migration — read-side only.

### What's left to do
- Workstream A continued — the claim graph / IC memo as a fully traceable audited view; optionally thread the confidence range into the KPI tiles themselves.
- Workstream C — relevance-signal capture + the standing extraction-quality system (cheap, compounding).
- Workstream F — schema baseline squash, theme-token unification, ontology adoption.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-20 - Workstream A (Provenance Spine) — Model Trust integration

### What was worked on

Cross-module integration. The two Provenance-Spine signals shipped earlier —
Model Confidence (PR-NX106) and Confidence Range (PR-NX108) — lived only on
the DCF Underwriting page, the model builder's surface. The person reviewing
a deal works on the deal Overview and Financial tab, which carried no trust
signal. This closes that gap.

PR #466 (PR-NX110):
- New `ModelTrustSummary` — a compact strip that fuses both signals into one
  glance: the confidence headline (% of inputs set for the deal + band) and
  the headline-KPI ranges (IRR / NPV / equity multiple), with a link through
  to the full breakdown.
- Pure display — reuses the existing model-confidence + confidence-range
  endpoints. No new backend, no schema change. Self-hides when the deal has
  no financial model or the class is uncatalogued.
- Wired into the deal Overview (beside the Financial Summary card) and the
  deal Financial tab (above the Returns card).
- 6 new frontend tests; OverviewTab test stubs the new component.

### Plain-English recap
- The deal Overview and the deal's Financial tab now show a "Model Trust" strip: at a glance, how much of the financial model is built on facts entered for this deal, and the range the headline numbers could move within.
- It links straight to the full confidence breakdown on the underwriting page.
- Why it matters: the "how much can I trust this model" signal used to be visible only to the analyst building the model. Now it travels with the deal — whoever opens it to review or sign off sees it immediately.

### PRs opened / merged
- PR #466 - `feat(deal): carry the Model Trust verdict into the deal workspace (PR-NX110)` - opened, CI green, merged.
- PR #467 - `docs: session log for the Model Trust integration session (PR-NX111)` - this entry.

### Validation
- Frontend: 73 files / 672 tests green. Production build clean. Backend untouched.
- All CI checks passed on #466. No migration — frontend-only.

### What's left to do
- Workstream A continued — the claim graph / IC memo as a fully traceable audited view; optionally thread the confidence range into the KPI tiles themselves.
- Workstream C — relevance-signal capture + the standing extraction-quality system (cheap, compounding).
- Workstream F — schema baseline squash, theme-token unification, ontology adoption.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-21 - Workstream C1 — comp-reliance capture (the data-network seed)

### What was worked on

Opened Workstream C — the Data Network — with its explicit "start now" item:
capture which verified comparables an analyst actually relies on when
underwriting a deal. This ships the capture, not a learned ranker (C5 stays
deferred — it needs exactly this data first).

PR #468 (PR-NX112):
- New migration `20260610` — a `deal_comp_reliance` table (durable state,
  one row per relied-on comp, deal-scoped RLS, the dd_items/risk_flags
  pattern), and the `improvement_signals` signal_type CHECK widened to also
  accept `comp_reliance`.
- New `compReliance.service.js` — list the relied-on comps for a deal; toggle
  one comp (org-scoped, deal + comp visibility checked). Migration-tolerant.
- `learningSignals.service.js` gains `recordCompRelianceSignal` — every
  toggle appends a values-free Layer-5 signal carrying the deterministic
  scorer's verdict (similarity score, rank, rate delta) at the moment of
  reliance. Consent-gated, fire-and-forget.
- `GET /comps/:dealId/reliance` + `PUT /comps/:dealId/reliance/:compId`.
- A per-comp "Relied on" star in the deal Comps tab's ranked table.
- 12 new tests (8 backend, 4 frontend).

### Plain-English recap
- On a deal's Market / Comps tab, the ranked-comparables table now has a "Relied on" star — the analyst clicks it on the comps they actually used to justify the deal's pricing, and the stars persist.
- It is a useful record in its own right (which comps a deal's underwriting rests on), and quietly every star teaches REDIP.
- Why it matters: this is the first turn of the network-learning flywheel — the ground truth that, over time, lets REDIP rank comparables the way the firm's own analysts do.

### PRs opened / merged
- PR #468 - `feat(comps): capture which comps an analyst relies on per deal (PR-NX112)` - opened, CI green, merged.
- PR #469 - `docs: session log for the comp-reliance session (PR-NX113)` - this entry.

### Validation
- Backend: 134 suites / 2203 tests green. Frontend: 74 files / 676 tests green. Production build clean.
- All CI checks passed on #468.

### What's left to do
- Operator: apply migration `database/migrations/20260610_deal_comp_reliance.sql` in the Supabase SQL editor (the code is migration-tolerant — the "Relied on" star is inert until the table exists).
- Workstream A continued — the claim graph / IC memo as a fully traceable audited view; optionally thread the confidence range into the KPI tiles themselves.
- Workstream C continued — a standing extraction-quality system; later, the learned comp-ranker once enough reliance data accrues.
- Workstream F — schema baseline squash, theme-token unification, ontology adoption.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.
- Minor: a pre-existing flaky jsdom `scrollIntoView` warning in BengaluruStreetLookupPanel's test (non-blocking — all tests pass, run exits 0).


## 2026-05-21 - IC memo trust enrichment + CI de-flake

### What was worked on

Two pieces in one session: the IC memo became aware of the trust layer, and a
flaky frontend CI failure was fixed at the root.

PR #470 (PR-NX114) — IC memo trust enrichment:
- The IC memo is REDIP's decision artifact, yet it was generated with no
  awareness of the trust layer built across Workstreams A, B and C.
- New `buildVerificationContext(dealId)` composes a deterministic trust block
  — model confidence, the confidence range, the Risk Radar posture (flagged /
  unverified failure modes), the promoter posture, the count of analyst-relied
  comps. Carried into the memo payload as `verification`; each signal wrapped
  so a hiccup never breaks generation.
- The system prompt now makes the memo state the verification posture in the
  Executive Summary and withhold a clean "Recommend approval" when the model
  is assumption-led or a Risk Radar category is flagged / unverified.
- 3 new backend tests.

PR #472 (PR-NX116) — CI de-flake + this log entry:
- jsdom does not implement `Element.prototype.scrollIntoView`; a component
  calling it inside a requestAnimationFrame threw an uncaught error that
  landed non-deterministically and intermittently failed the whole frontend
  CI run even though every test passed. Added a no-op shim to the vitest
  setup — the standard fix. The full suite now runs clean.

### Plain-English recap
- The generated IC memo is now honest about what has and hasn't been verified — it states the verification posture up front and cannot gloss over flagged or unverified risk in its recommendation.
- A flaky test failure that could randomly block any change has been fixed at the root, so the build pipeline is reliable again.

### PRs opened / merged
- PR #470 - `feat(ic-memo): feed the deterministic trust posture into the IC memo (PR-NX114)` - opened, CI green, merged.
- PR #472 - `fix(test): shim scrollIntoView to de-flake the frontend CI run (PR-NX116)` - this entry.

### Validation
- Backend: 134 suites / 2206 tests green. Frontend: 74 files / 676 tests green; full vitest run now exits clean with no unhandled errors. Production build clean.

### What's left to do
- Operator: apply migration `database/migrations/20260610_deal_comp_reliance.sql` if not yet done (the "Relied on" star is inert until then).
- Workstream A continued — the IC memo as a fully click-through-to-source audited view (the larger A3 rearchitecture); optionally thread the confidence range into the KPI tiles.
- Workstream C continued — a standing extraction-quality system; later, the learned comp-ranker once enough reliance data accrues.
- Workstream F — schema baseline squash, theme-token unification, ontology adoption.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-21 - Workstream A3 — the IC memo Evidence Ledger

### What was worked on

Delivered A3 — the IC memo's numbers traced to their evidence. The memo's
prose is AI-authored and carries the "requires human review" disclaimer; its
numbers must not, and now they don't.

PR #473 (PR-NX117):
- New `icEvidence.service.js` builds the deterministic claim layer beneath
  the memo — every material figure with an honest, typed, traceable source.
  Pure composer over engines REDIP already runs deterministically: the
  financial kernel (KPIs + cost/revenue), Model Confidence (each input,
  analyst-set vs. cited benchmark), the Risk Radar (risk / diligence /
  approval counts), the comp-reliance log, and the deal record. No AI — a
  figure with no honest source is simply not asserted.
- `GET /intelligence/ic-memo/:dealId/evidence` — soft-fails to
  { available: false }.
- New `IcMemoEvidence` panel inside the IC memo surface: a collapsible
  "Evidence & Sources" ledger, each number click-to-expand to its source
  detail, grouped by category, with a per-source-type summary. States
  plainly that every figure is deterministic — the AI narrative is only the
  interpretive layer on top.
- 12 new tests (6 backend, 6 frontend).

### Plain-English recap
- The IC memo now has an "Evidence & Sources" panel: every number behind the deal — IRR, NPV, costs, each assumption, the risk counts, the comps relied on — tagged with where it came from, click-to-expand for how it was produced.
- Why it matters: an IC can challenge any figure and get a straight, instant answer. The memo's numbers are an auditable ledger; the AI is confined to the narrative. The Provenance Spine now reaches the decision artifact.

### PRs opened / merged
- PR #473 - `feat(ic-memo): an Evidence Ledger — every IC-memo number traced to its source (PR-NX117)` - opened, CI green, merged.
- PR #474 - `docs: session log for the IC memo Evidence Ledger session (PR-NX118)` - this entry.

### Validation
- Backend: 135 suites / 2212 tests green. Frontend: 75 files / 682 tests green; run exits 0. Production build clean.
- All CI checks passed on #473. No migration — read-side only.

### What's left to do
- Operator: apply migration `database/migrations/20260610_deal_comp_reliance.sql` if not yet done.
- Workstream A — Provenance Spine substantially complete (model confidence, confidence range, model-trust integration, IC-memo verification, the Evidence Ledger). A possible further step: a deal-wide "show provenance" toggle, or threading the confidence range into the KPI tiles.
- Workstream C continued — a standing extraction-quality system; later, the learned comp-ranker once enough reliance data accrues.
- Workstream F — schema baseline squash, theme-token unification, ontology adoption.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-21 - Provenance Spine hardening — input-default drift fixed

### What was worked on

A correctness pass that hardens the accuracy of the entire Provenance Spine.
An audit found the financial form's default seeds had drifted from the
kernel's cited benchmark registry across five asset classes — 11 values — so
the form was pre-filling numbers the kernel does not endorse.

PR #475 (PR-NX119):
- The drift mattered because Model Confidence, Confidence Range and the
  Evidence Ledger all classify an input by comparing its value to the kernel
  registry. A non-registry pre-fill, left untouched, was being mistaken for a
  deliberate analyst choice — the trust signals over-stated how much of a
  model was genuinely deal-set.
- `fieldDefs.js` — 11 seeds synced to the kernel's effective default
  (residential marketing cost; plotted project duration; retail opex +
  discount rate; industrial rent escalation, vacancy + discount rate;
  hospitality F&B revenue, other revenue, GOP margin, EBITDA margin). The
  kernel registry is the cited authority; the form follows it.
- New contract test `fieldDefsDefaults.contract.test.js` — asserts every
  comparable seed equals the live kernel registry, permanently preventing
  this class of drift. Deliberate exclusions documented inline.
- `defaults.ts` — corrected the discount-rate description, which falsely
  claimed commercial/retail overrides that do not exist.
- No kernel values changed; existing saved models untouched.

### Plain-English recap
- A handful of numbers the financial form auto-fills were quietly out of step with REDIP's own benchmark library — now aligned.
- This makes the Model Confidence and Evidence readouts honest: a field left on its default is correctly shown as a benchmark default, not as something the analyst chose.
- A permanent automated check now guarantees these can never silently drift apart again.

### PRs opened / merged
- PR #475 - `fix(financials): reconcile form default seeds with the kernel benchmark registry (PR-NX119)` - opened, CI green, merged.
- PR #476 - `docs: session log for the input-default drift fix (PR-NX120)` - this entry.

### Validation
- Backend: 135 suites / 2212 tests green. Frontend: 76 files / 683 tests green; run exits 0. Kernel + frontend builds clean.
- All CI checks passed on #475.

### What's left to do
- Operator: apply migration `database/migrations/20260610_deal_comp_reliance.sql` if not yet done.
- Workstream A — Provenance Spine substantially complete and now accuracy-hardened. Optional polish: a deal-wide "show provenance" toggle; threading the confidence range into the KPI tiles; extracting shared trust-panel primitives (A4).
- Workstream C continued — a standing extraction-quality system; later, the learned comp-ranker once enough reliance data accrues.
- Workstream F — schema baseline squash, theme-token unification, ontology adoption.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-21 - Workstream F (foundations) — migration-lint tenant-isolation guard

### What was worked on

The foundations/hygiene pass began with the migration lint. A deep review
showed the two biggest F items are not safe to do autonomously — F1 (squash
78+ migrations into a baseline) cannot be verified without an operator-run
DB rebuild, and F2 (delete the dark-mode `!important` safety net) would need
every legacy `bg-white`/`bg-gray-*` component migrated first or dark mode
breaks app-wide. So this block did the genuinely safe, high-value F3.

PR #477 (PR-NX121):
- The CI migration lint checked filenames / empty files / CONCURRENTLY but
  not the convention that matters most — every tenant-scoped table must
  carry row-level security. A table with an organization_id column and no
  RLS is a cross-org data leak.
- `scripts/lint-migrations.js` now enforces, corpus-wide: any table CREATEd
  with an organization_id/org_id column must have ENABLE ROW LEVEL SECURITY
  somewhere; a documented RLS_EXEMPT allowlist (6 entries) covers the
  market-intelligence + regulatory_data reference tables deliberately
  isolated by service-layer org-filtering. Plus a CREATE TABLE idempotency
  rule, and SQL-comment stripping so prose can never read as a statement.
- A full audit of all 83 migrations came back clean — 37 org-scoped tables,
  31 RLS-protected, 6 documented-exempt. No real gap; the lint now
  permanently prevents one.
- Script refactored for testability; new test — 12 cases incl. a standing
  assertion the live corpus passes.

### Plain-English recap
- Added an automated safety check to the build pipeline: the worst multi-tenant bug — one customer seeing another's data — is now impossible to merge. A future database change that adds a customer-scoped table without the isolation rule fails the build with an explanation.
- An audit of all 83 existing database changes confirmed they are already correct — this locks in a good state.

### PRs opened / merged
- PR #477 - `chore(db): enforce tenant-isolation + idempotency in the migration lint (PR-NX121)` - opened, CI green, merged.
- PR #478 - `docs: session log for the migration-lint hardening (PR-NX122)` - this entry.

### Validation
- Backend: 136 suites / 2224 tests green. The lint exits 0 over all 83 migrations.
- All CI checks passed on #477.

### What's left to do
- Operator: apply migration `database/migrations/20260610_deal_comp_reliance.sql` if not yet done.
- Workstream F — F3 done; F5 already shipped (PR-NX52). F1 (schema squash) and F2 (theme-token / dark-mode-hack removal) genuinely need operator involvement — F1 needs an operator-run DB-rebuild verification, F2 needs visual QA across light + dark mode. F4 (ontology adoption — deal forms reading asset classes from `@redip/real-estate-ontology`) is a clean focused next step.
- Workstream A — Provenance Spine complete and accuracy-hardened; optional polish remains.
- Workstream C continued — a standing extraction-quality system; later, the learned comp-ranker.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-21 - Workstream F (foundations) — asset-class taxonomy contract

### What was worked on

Continued the foundations pass with F4 — the asset-class taxonomy. A review
found it is declared independently in THREE places: `backend/.../assetClasses.js`,
`frontend/.../assetClasses.js` (byte-identical to the backend file), and the
canonical `real-estate-ontology` v1.json. All three agree on the 10-key set
today — but nothing prevented them drifting.

PR #479 (PR-NX123):
- Considered making the deal forms import the ontology directly (true
  single-source-of-truth) — rejected: the ontology's labels are descriptive
  ("Hospitality (hotel)", "Raw Land (entitlement pipeline)") and
  family-ordered; adopting them would clutter and reorder the dropdown — a
  UX downgrade.
- Instead locked the existing good state with a contract test, the same
  proven pattern as the kernel-defaults drift fix (PR-NX119). New
  `assetClasses.contract.test.js` asserts: backend ≡ frontend
  ASSET_CLASS_CONFIG byte-for-byte; the key set matches the ontology; every
  financialModelClass resolves to a kernel-supported class.
- No source change needed — the three were already in sync; the test makes
  it impossible for them not to be.
- Noted but not fixed: the kernel calls raw land `land_parcel` while the app
  (and ontology) call it `raw_land` — a naming inconsistency whose fix is a
  data migration on `deals.asset_class`, an operator-decision out of scope.

### Plain-English recap
- The list of property types REDIP handles is written in three separate files for technical reasons; today they match, but a future edit to one could quietly desync deal forms, the server, and the master taxonomy.
- Added an automated check that fails the build the instant the three diverge — so they can't.

### PRs opened / merged
- PR #479 - `test(foundations): lock the asset-class taxonomy across its three sources (PR-NX123)` - opened, CI green, merged.
- PR #480 - `docs: session log for the asset-class taxonomy contract (PR-NX124)` - this entry.

### Validation
- Frontend: 77 files / 687 tests green; run exits 0; build clean.
- All CI checks passed on #479.

### What's left to do
- Operator: apply migration `database/migrations/20260610_deal_comp_reliance.sql` if not yet done.
- Workstream F — F3, F4, F5 done. F1 (schema squash) needs an operator-run DB-rebuild verification; F2 (dark-mode-hack removal) needs visual QA across light + dark mode — both genuinely need operator involvement.
- Workstream A — Provenance Spine complete and accuracy-hardened; optional polish remains.
- Workstream C continued — a standing extraction-quality system; later, the learned comp-ranker.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-21 - Workstream C — the standing extraction-quality system

### What was worked on

Workstream C of the product plan (the data network) — the document-extraction
counterpart to the comp-reliance capture (PR-NX112). A deep review found the
Phase-5.1 extraction-review seed (PR-NX96) had wired its signal capture into
`applyCorrections` — an endpoint no frontend surface calls — so in practice it
captured nothing. The live extraction-review surface is the apply-extractions
auto-fill modal; this session moved capture there and built the full standing
system.

PR #481 (PR-NX125):
- New migration `20260611_extraction_field_verdicts.sql` — a durable,
  values-free ledger holding one current verdict (accepted / overridden) per
  (extraction, canonical field), org-scoped with RLS FORCE. Widens the
  `improvement_signals` signal-type CHECK to add `extraction_field_verdict`.
- `extractionVerdicts.service.js` — `recordVerdictsForApply()` classifies each
  applied field by coerce-comparing the AI's raw value against the applied
  value through the ontology (so a unit reformat is not mistaken for an
  override); upserts the ledger and appends a Layer-5 learning signal.
  Fire-and-forget, migration-tolerant, never throws. `getExtractionAccuracy()`
  is the read-model.
- `learningSignals.service.js` — added `recordExtractionVerdictSignals()`
  (batched, values-free, consent-gated); removed the superseded
  `recordExtractionReviewSignals` / `getExtractionAccuracy` seed and its dead
  `applyCorrections` wiring.
- The apply-extractions service fires verdict capture as a post-commit Phase 4;
  `/api/admin/extraction-quality` now serves the verdict ledger.
- The auto-fill modal's proposed-value cell became an inline-editable input —
  operators can correct a wrong extraction in place and apply in one step.
  Editing a row auto-selects it; a reset returns it to the AI value. That edit
  path is what makes the "overridden" verdict capturable.

### Plain-English recap
- When you auto-fill a deal from a document, every AI-suggested value is now an editable box — if the AI misread something, you fix it right there and apply in one step, instead of being stuck ticking or unticking a wrong value.
- REDIP now keeps an honest score of how accurate its document-reading is — which fields it gets right and which it gets wrong — on the operator-only AI screen. It records only field names and a kept-or-corrected flag, never the actual document values.
- It matters because this is the document half of "REDIP gets sharper every time it's used" — everyday review work becomes a real signal for improving extraction.

### PRs opened / merged
- PR #481 - `feat(learning): standing extraction-quality system — per-field accept/override verdicts (PR-NX125)` - opened, awaiting CI + operator merge. This session-log entry ships in the same PR.

### Validation
- Backend: 137 suites / 2243 tests green. Frontend: 77 files / 691 tests green; run exits 0; production build clean.
- `node scripts/lint-migrations.js` — 84 migrations clean (39 org-scoped, 33 RLS-protected).
- The editable modal is auth-gated (needs a logged-in user on a deal with extracted, ontology-mapped documents) — covered by 18 component tests, not browser-verified.

### What's left to do
- Operator: apply migrations `database/migrations/20260610_deal_comp_reliance.sql` and `database/migrations/20260611_extraction_field_verdicts.sql` if not yet done.
- Operator: merge PR #481 (production deploy) once CI is green.
- Workstream C continued — the standing A/B eval / golden-set quality harness (C3 full); the org-level "do not benchmark" switch (C2); the learned comp-ranker stays deferred until reliance + verdict data accrue.
- Workstream F — F1 (schema squash) and F2 (dark-mode-hack removal) genuinely need operator involvement.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-21 - Workstream C2 — org-level benchmark-contribution consent

### What was worked on

Workstream C2 of the product plan — the Data Network's consent foundation.
`docs/DATA_GOVERNANCE.md` §3 specifies that no deal data enters the planned
anonymized cross-tenant benchmark layer unless BOTH gate conditions hold: the
contributing user has granted `anonymized_benchmarking` consent, AND the owning
organization has not engaged an org-level "do not benchmark" opt-out. The
per-user half shipped with the consent ledger (20260607); this session built
the org-level half and the gate that combines them.

A deep review settled the model: the per-user `anonymized_benchmarking` consent
already exists, so C2 is specifically the org-level authority on top — an
organization is the data fiduciary that owns its deal data, so whether that
data joins a shared pool is an org decision that sits above any analyst's. The
DATA_GOVERNANCE doc had already specified the exact two-condition gate.

PR #482 (PR-NX126):
- New migration `20260612_organization_consents.sql` — an append-only org-level
  data-governance ledger, the same shape and posture as `user_consents`
  (org-scoped RLS, no write policy, newest row per (org, purpose) wins). Sole
  purpose today: `benchmark_opt_out`.
- `organizationConsent.service.js` — recordOrgConsent / getOrgConsentState /
  isBenchmarkingOptedOut / getOrgConsentHistory. Append-only, migration-tolerant.
- `benchmarkEligibility.service.js` — the deterministic gate. evaluateEligibility
  combines the per-user consent and the org opt-out into one
  included_in_aggregate verdict with reasons; computed live (retroactive
  withdrawal); fails closed.
- `/api/organization` routes — GET benchmark-setting (any member) + PUT
  (owner/admin only); mounted in server.js.
- A Market-benchmark-contribution card in the owner/admin section of the
  Settings page — the opt-out toggle, dual-consent copy, the caller's own
  eligibility, last-changed provenance.
- `docs/DATA_GOVERNANCE.md` Layer 4 status updated — the consent gate is now
  built end to end.

Also this session, earlier: shipped + merged PR #481 (PR-NX125, the standing
extraction-quality system) — see the entry above; production deploy succeeded.
Declined F1 (the migration squash) with a written rationale — it cannot be
proven safe without a fresh database this machine cannot host, and it is
housekeeping with disaster-recovery downside and no user benefit; recommended
deferring it until a real second environment exists.

### Plain-English recap
- An organisation's owner or admin now has a clear switch in Settings to opt the whole organisation out of ever contributing its data to market benchmarks.
- One server-side gate decides eligibility, combining that org switch with each user's own consent — and nothing is shared today; no benchmark feature is live yet.
- It matters because consent is now asked and recorded before any data could ever be collected — the only correct order.

### PRs opened / merged
- PR #481 - `feat(learning): standing extraction-quality system (PR-NX125)` - merged; production deploy green.
- PR #482 - `feat(governance): org-level benchmark-contribution consent + the Layer-4 eligibility gate (PR-NX126)` - opened, awaiting CI + operator merge. This session-log entry ships in the same PR.

### Validation
- Backend: 139 suites / 2262 tests green. Frontend: 78 files / 700 tests green; run exits 0; production build clean.
- `node scripts/lint-migrations.js` — 85 migrations clean (39 org-scoped, 33 RLS-protected).
- The Settings card is auth-gated (needs a logged-in owner/admin) — covered by 9 component tests, not browser-verified.

### What's left to do
- Operator: apply migration `database/migrations/20260612_organization_consents.sql`.
- Operator: merge PR #482 once CI is green.
- Workstream C continued — the standing A/B eval / golden-set quality harness (C3 full); C4 (benchmark statistics) and C5 (learned comp-ranker) stay deferred until real data accrues.
- Workstream F — F1 (schema squash) and F2 (dark-mode-hack removal) genuinely need operator involvement.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-21 - Workstream C3 — the standing AI-quality monitor

### What was worked on

Workstream C3 — promoting the on-demand A/B eval harness (Tier-2 #14) into a
standing quality system that continuously signals whether REDIP's production
AI quality is holding.

A deep review corrected an earlier wrong conclusion (recorded in the C2 entry
above) that C3 was "blocked on operator-curated golden fixtures / fabrication".
The harness's scorer (`abEvalScoring.js`) is fully deterministic JS —
hallucination = facts not present in the input snapshot; tone = regex voice
checks — and the 30 fixtures are synthetic eval *inputs*, not invented facts
shown to users. The harness is the right foundation; the genuine gap was the
monitoring lens.

PR #483 (PR-NX127):
- `runEval` now accepts a single candidate — a one-config "baseline" run, not
  only two-plus for an A/B comparison.
- `abEvalPersistence.service.js` — a shared run-and-persist core;
  `runBaselineAndPersist` (scores the current production reasoning config);
  `getQualityTrendByTask` — the read-model aggregating baseline runs per task
  into a score series, the latest score, the trailing-average baseline, the
  delta, and a regression flag. No migration — baselines are told apart from
  A/B runs by a single-element `candidate_ids`.
- `/api/admin/ab-eval` — GET quality-trend + POST baseline, admin-gated.
- A "Standing quality" panel atop the admin A/B page — per task: the latest
  score, the trend delta, a regression flag, a one-click Run-baseline trigger.

No fabrication, no LLM judge, no autonomous spend — a baseline is operator-
triggered (~$0.12 for the 10-fixture default); automatic scheduling is a
deliberate cost decision left to the operator (a daily cron is a small
vercel.json addition once a cadence is chosen).

### Plain-English recap
- REDIP's tool for comparing two AI models head-to-head is now also a continuous quality gauge — an operator clicks "Run baseline" and REDIP scores its current AI against a fixed set of test deals, then tracks that score over time.
- If quality slips below the recent average, the page flags a "regression" — catching the AI getting worse before a customer ever notices.
- It matters because it makes AI quality a measured, monitored number, not a hope.

### PRs opened / merged
- PR #483 - `feat(ai-quality): promote the A/B eval harness into a standing quality monitor (PR-NX127)` - opened, CI green, awaiting operator merge. No migration. (This session-log entry ships in the C2 PR #482, not #483, so the two feature PRs stay conflict-free in any merge order.)

### Validation
- Backend: 137 suites / 2250 tests green. Frontend: 78 files / 697 tests green; run exits 0; production build clean.
- `node scripts/lint-migrations.js` — 84 migrations clean (no migration added).
- The admin quality panel is auth-gated (admin-only) — covered by 6 component tests, not browser-verified.

### What's left to do
- Operator: merge PR #482 (org benchmark consent — apply migration `20260612` first) and PR #483 (standing quality monitor — no migration), in any order; both CI-green.
- Workstream C — C1, the extraction-quality system, C2 and C3 are all shipped. C4 (benchmark statistics) and C5 (learned comp-ranker) stay deferred until real contributing data accrues. Optional C3 follow-up: a daily cron to run baselines automatically (a recurring-cost decision, ~₹300/month).
- Workstream F — F1 (schema squash) and F2 (dark-mode-hack removal) genuinely need operator involvement.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-22 - Workstream C3 — auto-scheduled quality baseline

### What was worked on

The standing AI-quality monitor (PR-NX127) tracked quality from baseline
runs, but a baseline only ran when an operator clicked the button. This adds
the automatic daily trigger so the trend accrues a fresh point on its own.

PR-NX128:
- `abEvalPersistence.service.js` — `runScheduledBaselines()`: resolves the
  organisation to attribute the run to (the oldest org — the eval measures
  REDIP's own AI, not tenant data), then runs a baseline for each monitored
  task. Fail-soft per task; never throws.
- `/api/cron/quality-baseline/daily` in `parcelCron.routes.js`, cron-secret-
  gated by the shared `requireCronAuth` — the same posture as the four
  existing crons.
- `vercel.json` — a crons entry at 04:15 UTC daily.

Cost: 2 tasks × 1 candidate × 10 fixtures ≈ 20 AI calls/day, within the
existing daily AI cost cap. The fixture count matches the operator-triggered
baseline so scheduled and manual runs stay comparable on the trend.

### Plain-English recap
- REDIP's AI-quality gauge now checks itself automatically once a day, instead of only when someone clicks "Run baseline".
- Every morning it scores the current AI against the test deals and adds a point to the trend — so a quality slip surfaces on its own.

### PRs opened / merged
- PR-NX128 - `feat(ai-quality): auto-schedule the daily quality baseline` - opened, CI-verified, merged.

### Validation
- Backend: 139 suites / 2272 tests green. No migration; no frontend change.

### What's left to do
- Workstream D1 — the stage-adaptive deal workspace — in progress this block.
- Workstream E — the spatial canvas (E1 layered cadastral map, E2 3D massing).
- Workstream F — F1 (schema squash) and F2 (dark-mode-hack removal) need operator involvement.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-22 - Workstream D1 — the live stage playbook

### What was worked on

Workstream D1 of the product plan — the adaptive face. A review found the
deal workspace was already ~60% adaptive (the Deal Pulse ribbon, the Risk
Radar strip, and a per-stage hint list all key off `deal.stage`). The
genuine gap: the stage playbook was a static, hardcoded list of advice
strings (`STAGE_NEXT_STEPS`) that never reflected what was actually done on
the deal. This closes that gap surgically.

PR-NX129:
- `frontend/src/utils/dealPlaybook.js` — a pure, deterministic module.
  `STAGE_PLAYBOOK` defines the priority steps for each of the 11 deal
  stages; `buildPlaybook(deal)` evaluates every step done/pending purely
  from the deal's own state — plain deal fields plus the `readiness_summary`
  rollup that already powers the Pulse ribbon. No AI — the playbook is a
  stage-aware presentation over already-synthesised data.
- `OverviewTab.jsx` — the static `STAGE_NEXT_STEPS` is removed; the "Stage
  Playbook" card now renders the live checklist: a progress bar, a
  done/pending icon per step, and a contextual detail ("60% complete",
  "2 unresolved"). Backend-provided custom next-step groups still render
  beneath, unchanged.

### Plain-English recap
- The deal page used to show the same generic to-do list for every deal at a given stage. Now it's a live checklist — REDIP checks what the deal actually has (a linked parcel, uploaded documents, a financial model, resolved risks) and ticks each step off, with a progress bar.
- At a glance you see exactly what's done and what's left for this deal's stage — the workspace genuinely guides the work instead of listing generic advice.

### PRs opened / merged
- PR-NX129 - `feat(deal): D1 — the live stage playbook` - opened, CI-verified, merged.

### Validation
- Frontend: 80 files / 715 tests green; run exits 0; production build clean. Frontend-only — no migration, no backend change.
- New: 8 `buildPlaybook` unit cases + an `OverviewTab` render check.
- The deal workspace is auth-gated — covered by the component tests, not browser-verified.

### What's left to do
- Workstream E — the spatial canvas: E1 a layered cadastral map (extends the existing `MapCanvas`), E2 3D buildability massing (from-scratch 3D — a heavyweight that warrants its own dedicated build).
- Workstream F — F1 (schema squash) and F2 (dark-mode-hack removal) need operator involvement.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-22 - Workstream E2 — the buildability massing diagram

### What was worked on

Workstream E of the product plan — the spatial canvas. This ships E2: an
axonometric massing diagram of the legal buildable envelope, rendered on
the Parcel Intelligence card beside the buildability numbers. It answers
"what can I legally build here" *spatially* — the plot, the ground-coverage
footprint inset within it, and that footprint extruded to the floor count
the FAR forces.

**Approach decision.** The prior session log pencilled E2 in as "from-
scratch 3D — a heavyweight." A real 3D engine (three.js, ~600 kB) was
weighed and rejected: it would dwarf the largest current bundle, fight the
deterministic-kernel rule (camera state, lighting and lazy GPU init are all
non-deterministic), and resist DOCX/PPTX export. A pure-SVG axonometric
projection delivers the same spatial read with zero new dependency, exact
proportions, instant render, and an exportable vector. That is the better
build, not the quicker one.

PR-NX130:
- `frontend/src/utils/buildabilityMassing.js` — `buildMassingModel({values,
  landAreaSqft})`, a pure deterministic module. Turns the verified
  buildability numbers (ground coverage, FAR, max buildable area) into the
  spatial quantities a massing needs: the footprint, the floor count the
  FAR spreads over it, the setback ratio. Returns null when there is no
  honest footprint to draw (no plot area or no coverage rule). Coverage is
  capped at 100%, the floor count floors at 1. No AI.
- `frontend/src/components/deal/BuildabilityMassing.jsx` — the SVG canvas.
  A 30° isometric projection of the 8 envelope corners, bbox-fitted to the
  viewBox so any G+N tower stays legible. Three shaded faces give the
  axonometric read; floor-delineation lines mark the storeys; a floor-count
  label and a legend sit alongside. An honest caption states the plot is a
  representative square (REDIP holds the parcel's area, not its surveyed
  shape) so the schematic is never mistaken for a site plan. `role="img"`
  with a descriptive aria-label.
- `BuildabilitySummary.jsx` — renders `<BuildabilityMassing>` below the
  buildability tiles, on the full card only (self-hidden on the compact
  embed and whenever the model has nothing honest to draw).

### Plain-English recap
- The parcel page now draws a small 3D-style picture of what can legally be built on the plot — the building's footprint and how many floors the rules allow — right next to the buildability numbers.
- It's generated straight from the verified zoning figures, so the shape is exact; a plain caption notes the plot is drawn as a representative square because REDIP knows the land's area, not its surveyed outline.
- It turns a column of numbers into something you can see at a glance.

### PRs opened / merged
- PR-NX130 - `feat(deal): E — buildability massing diagram` - opened, CI-verified, merged.

### Validation
- Frontend: 82 files / 721 tests green; production build clean (8.2s). Frontend-only — no migration, no backend change.
- New: 4 `buildMassingModel` unit cases + 2 `BuildabilityMassing` render checks.

### What's left to do
- Workstream E1 — a layered cadastral map as a co-equal canvas (extends the existing `MapCanvas`).
- Workstream F — F1 (schema squash) and F2 (dark-mode-hack removal) need operator involvement.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-22 - Workstream E1 — the layered cadastral canvas

### What was worked on

Workstream E of the product plan — the spatial canvas. This ships E1: the
deal map promoted from a pin-with-mystery-buttons into a genuine layered
cadastral canvas with one honest layer legend.

**The gaps it closes.** The shared deal map (`ReadOnlyPropertyMap`) could
already draw three layers — basemap, the K-GIS cadastral parcel polygon,
the RMP zoning overlay — but they were scattered, unlabelled corner
toggles with no legend: a teal outline was an unexplained shape. And the
deal Parcel tab never even passed the cadastral polygon, so the same
parcel showed its boundary on the Zoning tab but only a bare pin on the
Parcel tab.

**Approach decision.** A fourth map component was rejected — the repo
already has four map surfaces and the hygiene rules favour a progressive
refactor over more parallel UI. Instead the shared `ReadOnlyPropertyMap`
was upgraded in place, so every consumer (Parcel tab, Zoning tab's K-GIS
card, the Property detail page) inherits the canvas.

PR-NX131:
- `frontend/src/utils/cadastralLayers.js` — `buildCadastralLayers()`, a
  pure deterministic descriptor of the four layers (basemap, cadastral
  boundary, RMP zoning, parcel pin): each with a label, a swatch matching
  exactly what the map paints, a status, and an honest provenance line.
  The honesty rule lives here — a boundary is "K-GIS atlas" only when a
  real polygon exists, and plainly "Not available" when it does not.
- `frontend/src/components/maps/CadastralLayerPanel.jsx` — a collapsible
  layer-control panel that renders that descriptor as a single legend:
  swatches, status badges, provenance, the basemap selector and the
  zoning switch, all in one place.
- `ReadOnlyPropertyMap.jsx` — the scattered basemap and zoning toggles
  are replaced by the one panel; a `geocodeStatus` prop now feeds the
  pin's trust line. Move-pin and fullscreen stay as actions.
- `ParcelTab.jsx` — pulls the K-GIS polygon via `useParcelIntelligence`
  and passes it to the map, so the Parcel tab finally draws the cadastral
  boundary. The section is reframed "Cadastral canvas" — a co-equal half
  of the parcel story beside the Site Information grid.

### Plain-English recap
- The map on a deal's Parcel page is now a proper layered map, not just a dot. It draws the actual surveyed parcel outline (when available), the zoning, and the satellite or street view — and a small "Map layers" panel lists every layer and says where each one's data comes from.
- The parcel outline now shows on the Parcel page too, not only the Zoning page — so the two pages finally agree.
- Every layer is labelled honestly: the outline is called the official cadastral boundary only when it genuinely is one; otherwise it plainly says none is available.

### PRs opened / merged
- PR-NX131 - `feat(deal): E1 — the layered cadastral canvas` - opened, CI-verified, merged.

### Validation
- Frontend: 84 files / 735 tests green; production build clean (7.8s). Frontend-only — no migration, no backend change.
- New: 8 `buildCadastralLayers` unit cases + 6 `CadastralLayerPanel` render checks. `ReadOnlyPropertyMap` had no prior tests; the panel it now hosts is covered.

### What's left to do
- Workstream F — F1 (schema squash) and F2 (dark-mode-hack removal) need operator involvement.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-22 - Workstream F2 — repair the dark-mode-hack residue on the portfolio map

### What was worked on

Workstream F (foundations), the concrete slice of F2 (theme-token
unification): the portfolio map (`MapCanvas`) carried four malformed
Tailwind classes left behind by an earlier dark-mode find-replace. They
were not merely untidy — they were silently broken:

- `bg-white/70/80` on the map loading overlay — a double opacity modifier
  matches no Tailwind rule, so the overlay rendered with **no backdrop at
  all**: the spinner and "Loading map intelligence…" text floated over a
  fully-visible, still-interactive map.
- `ring-black/5/95` on three floating panels — likewise malformed, so the
  subtle panel ring never drew.

PR-NX132:
- `MapCanvas.jsx` — the loading overlay is now `bg-bg-primary/70
  backdrop-blur-sm`: a real theme-token scrim that dims and blurs the map
  behind the spinner and adapts to light/dark like the rest of the app.
  The three floating panels move to `bg-bg-elevated/95` with a valid
  `ring-black/5 dark:ring-white/10` — the dark-mode-aware ring the code
  always intended.

A repo-wide scan confirmed these four were the only malformed-class
residue of the dark-mode hack; the broader theme-token unification
(hardcoded-hex sweep) remains a deliberate, separate effort.

### Plain-English recap
- The map's "loading…" screen was broken — the dimming layer behind the spinner never showed, so the map stayed fully visible and clickable while it loaded. It now dims and softly blurs correctly.
- A few floating info panels on the map were missing their thin outline; that is fixed too.
- Both light and dark mode now render the map's overlays correctly.

### PRs opened / merged
- PR-NX132 - `fix(map): repair the dark-mode-hack residue on the portfolio map` - opened, CI-verified, merged.

### Validation
- Frontend: 84 files / 735 tests green; production build clean (6.8s). Frontend-only — no migration, no backend change. A repo-wide scan confirms no malformed Tailwind opacity classes remain.

### What's left to do
- Workstream F — F1 (the migration schema-baseline squash) needs the operator: it is a database operation only Rachit can apply. The broader theme-token unification (hardcoded-hex sweep) and ontology adoption remain.
- Phase 2.3 — DPA + Acceptable Use docs (blocked on Indian legal counsel).
- Operator follow-ups still open: Supabase backup tier + restore drill; breach-runbook names; `security@redip.in` mailbox; engage counsel.


## 2026-05-22 - Operator checklist + ontology adoption plan

### What was worked on

Two documentation deliverables that turn loose pending items into concrete,
actionable artifacts.

**`TODO_OPERATOR.md`** — a plain-English checklist of the manual actions only
the operator can do. `TODO_MANUAL.md` is an engineering-detail file (psql
commands, migration paths); the operator is a non-technical reader and needs a
jargon-free, step-by-step list. The two files now cross-reference each other.
The checklist covers, in priority order: (1) turn on Supabase database backups
— the org may be on the Free plan with no automatic backups, the highest-risk
gap; (2) engage Indian legal counsel for the DPA + Acceptable Use Policy; (3)
supply the Incident Lead / Legal Liaison names for the breach runbook; (4) set
up the `security@redip.in` mailbox; (5) the eventual migration schema-baseline
squash. Each item carries why it matters, numbered steps, the exact dashboard
link, and what to reply when done.

**`docs/ONTOLOGY_ADOPTION.md`** — a sequenced plan for finishing
`@redip/real-estate-ontology` adoption. A review found the backend already
adopts the ontology (the extraction → deal write path) but the frontend keeps
parallel hand-maintained taxonomy copies. Asset classes are safe — a contract
test locks all three sources. Deal structures genuinely **diverge**: the
frontend + the Postgres enum carry an 8-key list, the ontology a tidier 4-key
one. Closing that gap is a *product decision* (which taxonomy is canonical),
not a code change — the plan documents the decision, recommends keeping the
live 8-key list and versioning the ontology to `v2.json` to match, and
sequences the rest (frontend becomes a true ontology consumer; per-taxonomy
contract tests; the `ParcelTab` zoning `<select>` is missing 6 valid zones).

### Plain-English recap
- There is now one file, `TODO_OPERATOR.md`, listing every task that needs you personally — plain English, exact links, click-by-click steps. Most urgent: turning on database backups.
- A second file plans how to finish unifying REDIP's real-estate "dictionary" (asset classes, deal structures, zoning). One decision is needed from you — see below.

### Operator decision required
- **Deal-structure taxonomy:** REDIP's live 8-category list vs. a tidier 4-category one in the shared dictionary. Recommendation in `docs/ONTOLOGY_ADOPTION.md`: keep the 8-category list (it's what every existing deal uses). Confirm and the rest can proceed.

### PRs opened / merged
- PR-NX133 - `docs: operator checklist + ontology adoption plan` - opened, CI-verified, merged.

### Validation
- Docs-only — no code, no migration, no test or build impact.

### What's left to do
- Theme-token unification — the financials proforma tables render light in the default dark theme; migration in progress this block.
- Ontology adoption Phases 1–4 — gated on the operator's deal-structure decision (Phase 2) but Phases 1/3 can ship anytime.
- Operator follow-ups now tracked in `TODO_OPERATOR.md`.


## 2026-05-22 - Theme-token migration — the Quarterly Proforma panel

### What was worked on

Theme-token unification (the F2 follow-on). REDIP's default theme is dark
("8-hour underwriting sessions"); light is "report mode". The financial
charts were themed earlier (PR-NX71), but the **proforma tables were never
migrated** — `QuarterlyProformaPanel` was built entirely on a hardcoded
`stone`/`amber`/`emerald`/`rose` editorial palette, so on the default dark
FinancialsPage it rendered as a **white card with dark text** beside its
already-dark sibling charts.

PR-NX134 — `QuarterlyProformaPanel.jsx` migrated to the semantic token
system:
- Neutrals → tokens: `bg-white` → `bg-bg-elevated`, `stone-50/100` →
  `bg-bg-secondary` / `bg-surface`, `border-stone-*` → `border-hairline*`,
  `text-stone-*` → `text-content-*`. Safe by construction — the light-theme
  token values mirror the slate scale, so light mode is near-identical and
  dark mode becomes correct.
- Data-signal text → the purpose-built flipping tokens: sources →
  `text-data-positive`, uses → `text-data-negative`, equity-at-risk →
  `text-premium`. These read correctly in both themes (dark-mode
  emerald-800/rose-800 text would have been near-invisible).
- Tint fills → the pre-built soft tokens (`bg-pos-soft`, `bg-neg-soft`,
  `bg-premium-soft`) which carry their own alpha and theme-flip.
- The subtotal rows' sticky label cell moved to an **opaque** token
  (`bg-bg-secondary`) — a translucent soft tint would have let the
  scrolling figures bleed through the frozen first column.

**Approach note.** A blind re-theme of a core financial surface is risky,
so the migration was kept mechanical and token-faithful — every choice
maps to an existing, purpose-built token, no invented colours. The
FinancialsPage is auth-gated and needs a deal with financial data, so this
was build- + test-verified, not browser-verified; a live visual pass is
recommended. The sibling `HospitalityProformaSection` and the remaining
financials files follow the identical proven mapping and are the next slice.

### Plain-English recap
- A key financial table — the quarter-by-quarter "sources and uses" proforma — used to show up as a bright white box on REDIP's dark screens. It now matches the rest of the app in both dark and light mode.
- The red/green money figures stay clearly readable in dark mode, where the old dark-on-dark colours had washed out.

### PRs opened / merged
- PR-NX134 - `fix(financials): theme-token migration for the Quarterly Proforma panel` - opened, CI-verified, merged.

### Validation
- Frontend: 84 files / 735 tests green; production build clean. Frontend-only — no migration, no backend change.
- Build-verified (every token class compiles) and test-verified. Not browser-verified — the FinancialsPage is auth-gated and needs deal data; a live visual pass is recommended.

### What's left to do
- Theme-token unification — `HospitalityProformaSection` + the remaining financials files, same proven mapping.
- Ontology adoption Phases 1–4 — gated on the operator's deal-structure decision (Phase 2).
- Operator follow-ups tracked in `TODO_OPERATOR.md`.


## 2026-05-22 - Ontology Phase 2 — deal-structure reconciliation

### What was worked on

Workstream F, ontology adoption Phase 2 — executed on the operator's
2026-05-22 decision to keep the live **8-key** deal-structure taxonomy as
canonical (over the ontology's tidier 4-key one).

`deal_structure` was the one taxonomy that genuinely diverged:
`@redip/real-estate-ontology` v1.json carried 4 keys (`outright_purchase`,
`jda_revenue_share`, `jda_area_share`, `development_management`) while the
production system — the `deals.deal_structure` column, the
`domain.js DEAL_STRUCTURES` validator enum, and the frontend deal form —
all use 8 (`outright`, `jv`, `jda`, `revenue_share`, `area_share`,
`profit_share`, `ground_lease`, `hybrid`). A review confirmed the
ontology's `deal_structure` accessor is consumed by nothing in production
(only the ontology's own test), so the section was corrected in place — no
`v2.json` ceremony needed.

PR-NX135:
- `packages/real-estate-ontology/src/v1.json` — `deal_structure` rewritten
  to the canonical 8 keys, each with a label and an India-context note;
  `ontology_version` bumped 1.0.0 → 1.1.0; `last_reviewed` refreshed.
- `packages/real-estate-ontology/tests/ontology.test.js` — the
  deal-structure assertion updated to the 8 keys (+ a per-entry shape
  check); the version assertion updated to 1.1.0.
- `frontend/src/utils/__tests__/dealStructures.contract.test.js` — NEW.
  Mirrors `assetClasses.contract.test.js`: locks the frontend
  `DEAL_STRUCTURE_CONFIG` ↔ backend `domain.js DEAL_STRUCTURES` ↔ ontology
  `deal_structure` key sets. The three sources can no longer silently
  drift — a divergence fails CI with a precise diff.
- `frontend/src/utils/dealStructures.js` — the stale "Future PR will
  reconcile this" comment replaced with the contract-test reference.

### Plain-English recap
- REDIP's shared "dictionary" now agrees with the live product on the eight ways a deal can be structured — the one place the dictionary was out of date is fixed.
- A new automatic check makes it impossible for those eight categories to drift apart again across the three places they're written down.

### PRs opened / merged
- PR-NX135 - `fix(ontology): reconcile the deal-structure taxonomy to the 8-key list` - opened, CI-verified, merged.

### Validation
- Frontend: 85 files / 738 tests green (+3 — the new contract test). Backend: 139 suites / 2272 tests green. Ontology package: 52 tests green. Production build clean. No migration.

### What's left to do
- Ontology adoption Phases 3–4 — route zoning / ownership / exit-strategy through the ontology + per-taxonomy contract tests (zoning Phase 3 also fixes the `ParcelTab` create-form missing 6 valid zones).
- Theme-token unification — `HospitalityProformaSection` + the remaining financials files.
- Operator follow-ups tracked in `TODO_OPERATOR.md`.


## 2026-05-22 - Ontology Phase 3 — zoning reconciliation

### What was worked on

Workstream F, ontology adoption Phase 3. The plan (`docs/ONTOLOGY_ADOPTION.md`)
flagged zoning as a "small, fixable gap — the create-parcel form is missing 6
valid zones." Verifying that against the actual schema **reversed the finding**:

- `database/schema.sql` defines `zoning_type` as a **5-value** enum
  (`residential`, `commercial`, `mixed_use`, `industrial`, `agricultural`).
- `domain.js ZONING_TYPES` carries the same 5, and `property.routes.js`
  validates `zoning` against it. The `ParcelTab` create-form `<select>`
  offered exactly those 5 — it was already correct.
- The **ontology** was the outlier: its `zoning.values` listed **11** — the
  five real ones plus six RMP master-plan zone codes (`institutional`,
  `public_semi_public`, `open_space`, `transportation`, `utilities`,
  `unknown`) that the `properties.zoning` enum does not accept. Had the form
  been "fixed" to offer all 11, picking one of the six would have failed the
  DB write.

So the form was correct and the ontology was wrong. Phase 3 corrects the
ontology and locks the taxonomy.

PR-NX136:
- `packages/real-estate-ontology/src/v1.json` — `zoning` corrected to the real
  5-value enum; its description rewritten to state plainly that the detailed
  RMP zones live separately in `master_plan_zones`. `ontology_version` bumped
  1.1.0 → 1.2.0.
- `packages/real-estate-ontology/tests/ontology.test.js` — the zoning test now
  asserts the exact 5-value set (was a loose `toContain` check mislabelled
  "11"); the version assertion updated to 1.2.0.
- `frontend/src/utils/zoning.js` — NEW. `ZONING_CONFIG` (5 `{value,label}`
  entries), the shared frontend source, mirroring `assetClasses.js` /
  `dealStructures.js`.
- `frontend/src/components/deal/ParcelTab.jsx` — the create-parcel form's
  zoning `<select>` now renders from `ZONING_CONFIG` instead of 5 hardcoded
  `<option>`s.
- `frontend/src/utils/__tests__/zoning.contract.test.js` — NEW. Locks the
  frontend `ZONING_CONFIG` ↔ backend `domain.js ZONING_TYPES` ↔ ontology
  `zoning.values`.
- `docs/ONTOLOGY_ADOPTION.md` — the incorrect "missing 6 zones" claim
  corrected; Phases 2 and 3 marked shipped.

Ownership type and exit strategy were audited: neither is surfaced as a
frontend picker (ownership is a free-text column; exit strategy has no
frontend list), so there is nothing to route — the ontology keeps them as
reference taxonomies.

### Plain-English recap
- A check of the actual database showed an earlier note was wrong: the create-parcel form's five zoning choices were already correct — it was REDIP's shared "dictionary" that wrongly listed eleven. The dictionary is now fixed to match the database.
- All three places zoning is written down are now locked together by an automatic check, so they can no longer drift apart.

### PRs opened / merged
- PR-NX136 - `fix(ontology): reconcile the zoning taxonomy to the real 5-value enum` - opened, CI-verified, merged.

### Validation
- Frontend: 86 files / 741 tests green (+3 — the new zoning contract test). Backend: 139 suites / 2272 tests green. Ontology package: 52 tests green. Production build clean. No migration.

### What's left to do
- Ontology adoption — Phase 4 (single-source the extraction field map) remains, deferred.
- Theme-token unification — `HospitalityProformaSection` + the remaining financials files.
- Operator follow-ups tracked in `TODO_OPERATOR.md`.


## 2026-05-22 - Theme-token migration — the Hospitality proforma

### What was worked on

Theme-token unification, continuing PR-NX134 (the Quarterly Proforma). The
sibling `HospitalityProformaSection` — the USALI hotel proforma (10-year
P&L, sources & uses, capital stack, LP/GP waterfall) — was the last large
financials surface still on a hardcoded `stone` / `white` editorial
palette, so on the default dark FinancialsPage it rendered as white cards
with light-grey borders.

PR-NX137 — `HospitalityProformaSection.jsx` migrated to the semantic token
system, the same proven mapping as NX134:
- Neutrals → tokens: `bg-white` → `bg-bg-elevated`; `stone-*` →
  `bg-surface` / `border-hairline` / `text-content-*`.
- Recharts chrome → CSS vars: the NOI-evolution and waterfall charts' grid
  and axis colours (`#f3f4f6`, `#6b7280`, `#374151`) now use
  `var(--color-border-primary)` / `var(--color-text-muted)` so they flip
  with the theme (the PR-NX71 pattern). Chart *series* colours stay fixed —
  a deliberate, theme-agnostic palette.
- Light-tint gradient cards: the capital-stack columns and the refinance
  card used `from-X-50 to-white` — a light patch on a dark page — now the
  soft theme tokens (`bg-neg-soft`, `bg-accent-soft`). The two saturated
  LP/GP summary cards keep their gradients: white text on a saturated fill
  reads correctly in both themes.
- Data-signal text → flipping tokens: source amounts and the LP/GP
  waterfall figures used dark `rose-900` / `indigo-700` shades that would
  be near-invisible dark-on-dark; now `text-data-positive` /
  `text-data-negative` / `text-accent`.
- The USALI P&L table's highlighted EBITDA / NOI rows now carry the soft
  tint on the row and an opaque `bg-bg-elevated` on the frozen first
  column — a translucent tint would have let the scrolling figures bleed
  through the sticky cell.

### Plain-English recap
- The hotel financial proforma — the USALI P&L, sources & uses, capital stack and LP/GP waterfall — used to render as bright white cards on REDIP's dark workspace. It now matches the rest of the app in both dark and light mode.
- The red/green money figures and the chart gridlines stay correctly legible in dark mode, where the old colours had washed out.

### PRs opened / merged
- PR-NX137 - `fix(financials): theme-token migration for the Hospitality proforma` - opened, CI-verified, merged.

### Validation
- Frontend: 86 files / 741 tests green; production build clean. Frontend-only — no migration, no backend change.
- Build- and test-verified. Not browser-verified — the FinancialsPage is auth-gated and the hospitality proforma needs a hospitality-class deal with financial data; a live visual pass is recommended.

### What's left to do
- Theme-token unification — both financials proforma tables are now done; the remaining hardcoded-neutral files are smaller (`ReferenceMenu`, `MethodologyExplorer`, `DefaultsInspector`); the public/legal pages stay intentionally light.
- Ontology adoption — Phase 4 (single-source the extraction field map) remains, deferred.
- Operator follow-ups tracked in `TODO_OPERATOR.md`.


## 2026-05-22 - Financials theme cleanup finished + ontology Phase 4 closed

### What was worked on

The last of the Workstream-F theme-token cleanup, plus closing ontology
adoption Phase 4.

**Theme cleanup.** The three remaining financials files with hardcoded
neutral classes were migrated to the semantic token system:
- `ReferenceMenu.jsx` — a small all-`stone` file; every neutral → token
  (`bg-bg-elevated`, `border-hairline*`, `text-content-*`).
- `DefaultsInspector.jsx` — the `bg-white` panel / card surfaces →
  `bg-bg-elevated`; the slide-over already used tokens internally.
- `MethodologyExplorer.jsx` — the ~12 `bg-white` card surfaces →
  `bg-bg-elevated`. This is a 1,100-line decoration-heavy "methodology
  playbook" panel; the structural card backgrounds are migrated, while the
  deliberately colourful saturated-gradient callouts (white text on a
  saturated fill — correct in both themes) are intentionally left as-is.
- A stray `text-stone-400` in `KPIStatCard.jsx` was swept up too, so the
  financials folder now carries no hardcoded neutral Tailwind classes.

**Ontology Phase 4 — verified already done.** Phase 4 of
`docs/ONTOLOGY_ADOPTION.md` was "single-source the extraction field map".
An audit found the auto-fill UI (`AutoFillFromDocumentsModal`) already
reads it straight from the ontology (`ontologyV1.extraction_field_map`),
the backend reads the same `v1.json`, and no frontend mirror exists — one
source, zero drift surface. No code change was needed; the doc is updated
to mark Phase 4 — and the whole adoption plan — complete.

### Plain-English recap
- The last few financial reference panels (the methodology guide, the defaults sheet, the reference menu) used to show white cards on REDIP's dark workspace. They now match the theme.
- The financials section of the app is now fully theme-consistent.
- A check confirmed REDIP's document-extraction "dictionary" was already single-sourced — no fix was needed there.

### PRs opened / merged
- PR-NX138 - `fix(financials): theme-token cleanup for the last reference panels` - opened, CI-verified, merged.

### Validation
- Frontend: 86 files / 741 tests green; production build clean. Frontend-only — no migration, no backend change.
- Build- and test-verified. Not browser-verified — these are auth-gated financials panels; a live visual pass is recommended.

### What's left to do
- Workstream F theme-token unification is complete for the financials module. The public / legal pages stay intentionally light (they force the light theme).
- Ontology adoption — all four phases complete.
- Operator follow-ups tracked in `TODO_OPERATOR.md`.


## 2026-05-22 - Systemic audit + landing page rebuild (Phase 1)

### What was worked on

A full first-principles audit of the REDIP ecosystem (product intent,
frontend, backend, database, infrastructure, UX), followed by the first
execution phase from the resulting roadmap.

Audit: three parallel deep-dives (backend, frontend, database) plus a
first-hand read of the frontend core. Verdict - REDIP is a mature product
with strong bones (deterministic kernel, deal-centric model, RLS, audit
trail, AI routing, design-token system); the work ahead is consolidation,
polish, and a few high-leverage additions, not a rewrite. A ten-phase
roadmap was produced, sequenced by leverage: (1) landing page,
(2) design system, (3) retire the dark-mode CSS override hack,
(4) deal-workspace polish, (5) decompose frontend god-files,
(6) module integration, (7) provenance + risk moat, (8) onboarding,
plus database/infra hygiene.

Phase 1 - landing page rebuild (PR #495): LandingPage.jsx rebuilt around
a faithful, on-brand product preview - a deal cockpit (underwriting KPIs,
quarterly cash-flow chart, deal risk radar, evidence trail) rendered in
REDIP's own design language. The page previously described REDIP in prose
with no product visible. Also: full hover/focus-visible/active states on
every CTA; static inline colour/border styles replaced with semantic
tokens. Illustrative sample figures only, no fabricated facts.

### Plain-English recap
- The home page now shows the actual product (a realistic picture of a
  deal screen) instead of only describing it in words.
- Every button on the page reacts properly to mouse and keyboard.
- Works in dark mode, light mode, and on a phone.

### PRs opened / merged
- PR #495 - feat(landing): rebuild the landing page around a product
  preview - opened; CI frontend check + Vercel deploy green. Not merged
  (operator authorises production deploys).

### Validation
- Frontend build clean (11s). Frontend tests: 741/741 pass.
- Verified in browser: dark + light themes, desktop + mobile, no console errors.

### What's left to do
- Roadmap Phases 2-10 (tracked): design-system primitives, retire the
  dark-mode CSS hack, deal-workspace polish, decompose god-files, module
  integration, provenance + risk moat, onboarding, database/infra hygiene.
- Next up: Phase 2 - expand the design system (Button, Modal, Tabs,
  Field, Tooltip primitives).

## 2026-05-23 - Design system, deal-workspace polish, login page

### What was worked on

Three execution phases on top of the 2026-05-22 audit roadmap, each
shipped as its own reviewed, CI-verified PR and merged to master.

Design system (PR #496). Five accessible primitives added to
frontend/src/design-system/: Button (variants / sizes / loading / icon
slots / `as` polymorphism), Modal (portalled dialog - focus trap,
Escape + overlay close, scroll-lock, animated, reduced-motion aware),
Tabs (roving-tabindex keyboard nav), Field + Input/Select/Textarea
(label + helper/error layout that auto-wires accessibility), Tooltip
(CSS-only hover/focus). Checkbox added to the barrel. The .btn / .input
CSS classes stay for back-compat. 35 new tests.

Deal-workspace polish (PR #497). DealDetailPage rebuilt on the new
primitives: the three export buttons collapse into one ExportMenu
dropdown (a new self-contained component that owns the export calls,
busy state and toasts); the hand-rolled tab bar becomes <Tabs>; the
Edit and Delete pop-ups route through <Modal>; the Edit form uses
<Field>/<Input>/<Select>/<Textarea>; header / Share / Edit / Delete and
the stage-transition buttons use <Button>. The dead "Notifications"
bell was removed from the app Header (no notifications system exists).

Login & sign-up page (PR #498). LoginPage brought onto the design
system: the old copper #c2410c accent + raw stone palette replaced with
semantic tokens (blue accent + amber premium dot, matching the landing
page); the form uses Field / Input / Checkbox / Button; the password
field gets a show/hide toggle via a new `trailing` slot on the Input
primitive. PublicFooter tokenised too. All auth logic (login, register,
Google, MFA, legal gate) unchanged.

### Plain-English recap
- REDIP now has a proper shared kit of UI building blocks - buttons,
  pop-ups, tabs, form fields - so screens look and behave consistently.
- The deal page is cleaner: one tidy Export menu instead of six header
  buttons, smoother pop-ups, and a dead bell icon removed.
- The sign-in / sign-up page now matches the landing page's look - same
  blue accent, same polish - instead of an off-brand orange.

### PRs opened / merged
- PR #496 - feat(design-system): add Button, Modal, Tabs, Field and
  Tooltip primitives - merged, deployed.
- PR #497 - feat(deal): polish the deal workspace with the design-system
  primitives - merged, deployed.
- PR #498 - feat(auth): bring the login & sign-up page onto the design
  system - merged, deployed.

### Validation
- Full frontend suite green throughout (741 -> 781 tests as new tests
  landed). Production build clean on every PR. Landing and login pages
  browser-verified (desktop + mobile, no console errors); the deal
  workspace is auth-gated, verified by build + tests + the separately-
  tested primitives.

### What's left to do
- Roadmap phases not yet started: retire the dark-mode CSS override
  hack; decompose the remaining React-page god-files (IntelligencePage,
  MasterPlanAdminPage, DealsPage, MethodologyExplorer); deepen
  cross-module integration; the Provenance Spine + Risk Radar moat;
  role-aware onboarding; database / infra hygiene.
- The api.js god-file was assessed and deliberately left as-is: long
  but cleanly sectioned and genuinely maintainable, so decomposing it
  is low-value churn.

## 2026-05-23 - Smart empty states + role-aware onboarding

### What was worked on

Roadmap phase 8 from the systemic-audit roadmap — onboarding and smart
empty states — shipped as three PRs.

Smart empty states (PR #500). The shared EmptyState component was a bare
12-line placeholder; it is now a proper primitive — a soft icon chip,
sm/md size variants (sm for cards and widgets, md for full-width list
pages), an optional secondary action, and a gentle reduced-motion-safe
entrance. The six ad-hoc empty states across the dashboard widgets
(pipeline, cities, recent activity, top deals by IRR, AI cost, audit
trail) — each previously a different hand-rolled layout — now route
through it, so every "no data yet" surface is consistent, explains what
will populate it, and carries a one-click path to get started.

Role-aware first-run onboarding (PR #501). A workspace with zero deals
now opens to a calm Getting Started panel instead of a grid of empty
widgets. It greets the user by first name and lays out role-aware first
moves — editors and above are pointed at creating a deal, viewers get a
read-first framing, admins/owners also get a workspace-setup step. Every
step links to a real, shipped page. The panel is dismissible (the choice
persists in localStorage) and disappears on its own once the first deal
exists. Detection uses the dashboard's stats.total_deals, which counts
archived deals too, so it only fires for a genuinely fresh workspace.

Deal-workspace empty states (PR #502). The eight ad-hoc empty states
across the deal tabs — Audit, Activity, Financial, Documents, DD
checklist, Approvals, Risk and ranked Comps — were each a different
inline layout; all now route through the shared EmptyState primitive.
Copy preserved verbatim; the Financial tab keeps its "Build Financial
Model" call to action.

### Plain-English recap
- Every "nothing here yet" box across the app — on the dashboard and
  inside every deal tab — now looks the same: a calm icon, a clear
  title, a sentence saying what fills it, and (where it helps) a button
  to the next step.
- A brand-new account opens with a short welcome that greets the user
  and lays out the right first steps for their role, instead of a
  screen of blank cards.

### PRs opened / merged
- PR #500 - feat(frontend): unify empty states on a shared EmptyState
  primitive - merged, deployed.
- PR #501 - feat(dashboard): add a role-aware first-run onboarding
  panel - merged, deployed.
- PR #502 - feat(deal): unify the deal-workspace empty states on the
  EmptyState primitive - merged, deployed.

### Validation
- Frontend build clean on every PR. Frontend test suite green
  throughout (781 -> 795 tests as 14 new tests landed: 8 for the
  upgraded EmptyState, 6 for GettingStarted). The dashboard and deal
  workspace are auth-gated; verified by build + the full test suite +
  the separately-tested primitives. Browser verification of the
  auth-gated surfaces was not possible this session — the Chrome
  extension was not connected.

### What's left to do
- Retire the dark-mode CSS override hack — an incremental theme-token
  migration; ~120 legacy Tailwind class uses across ~37 files still
  feed the index.css override block. Best done as small per-area PRs
  with eyes-on dark/light checks, the way the financials theme cleanup
  was done.
- Decompose the remaining React-page god-files (IntelligencePage,
  MasterPlanAdminPage, DealsPage, MethodologyExplorer).
- Deepen cross-module reactivity; finish the Provenance Spine + Risk
  Radar moat; database / infra hygiene.

## 2026-05-23 - Browser verification + dark-mode cleanup batch 1

### What was worked on

Claude-in-Chrome browser control was reconnected (after several failed
attempts across sessions) and used to verify the auth-gated app on the
live deployment: the dashboard, deals list and deal workspace all render
correctly in dark mode, and the deal-tab empty states resolve through
the shared EmptyState primitive as intended.

Dark-mode override-hack retirement — batch 1 (PR #504). Nine
deal-workspace and financials-panel components were migrated off the
hardcoded `bg-white` class to the semantic `bg-bg-elevated` token.
`bg-white` resolves — via the index.css override block — to
`--color-bg-elevated` in dark mode and to white in light mode;
`bg-bg-elevated` resolves to exactly those, so the change is
pixel-identical in both themes. Verified eyes-on on the live deal
workspace after deploy.

### Plain-English recap
- The live app was checked in a real browser — dashboard, deals and
  deal pages all look right in dark mode after this session's changes.
- Nine deal and financials panels were moved onto the proper colour
  system. Invisible to users; a first step in removing an old styling
  shortcut so the app's theming gets simpler and less fragile.

### PRs opened / merged
- PR #504 - refactor(theme): migrate deal & financials panels off the
  bg-white class - merged, deployed.

### Validation
- Build clean; 795/795 frontend tests pass. Deal workspace eyes-on
  verified in dark mode on production after the deploy.

### What's left to do
- Dark-mode override-hack retirement is in progress: 9 files done;
  ~20+ more `bg-white` call sites remain before the `.bg-white`
  override rule can be deleted, then ~9 further override rules
  (bg-gray-*, text-gray-*, borders, gradient washes) follow. A
  multi-PR effort, batch by batch — the verified flow is now proven.
- Decompose the React-page god-files; deepen cross-module reactivity;
  Provenance Spine + Risk Radar moat; database / infra hygiene.

## 2026-05-23 — Checkbox click-fix, open sign-up, product tour, admin lockdown, shared market intelligence

### What was worked on

Long working session driven by operator feedback on the live preview.
Six PRs shipped end-to-end (branch → CI green → operator-authorized
merge to master):

1. **Checkbox click-fix (PR #506).** The terms-acceptance and remember-me
   checkboxes on the login/sign-up forms wouldn't toggle when clicked on
   the visual square. The SVG check icon inside the styled span was
   eating the click — `document.elementFromPoint` returned the SVG path
   instead of the underlying input. Fix: `pointer-events-none` on the
   visual span so the click falls through to the real checkbox.
2. **Open sign-up (PR #507).** Removed the `ALLOW_COLD_SIGNUP` invite
   gate from `auth.service.js`. Anyone with a valid email + password
   (or Google OAuth) can now register a workspace.
3. **Product tour for new users (PR #508).** Welcome modal (3-pane
   intro: what REDIP is, who it's for, what you do here) + 9-step
   coachmark tour over the sidebar (Dashboard, Deals, Map, Market
   Intelligence, Comps, Reports, Settings, Admin, Help). Dismissal
   persists in localStorage; replay card on Settings.
4. **Admin lockdown (PR #509).** AI Provider Health, AI Usage / Cost,
   Provider Routing Studio, A/B Eval, Master-Plan Admin, Comps Review
   Queue, Parcel Intelligence Admin — six surfaces that were
   role-gated (`owner`/`admin`) and therefore visible to every workspace
   owner — are now gated on `isPlatformAdmin(user)` via a new
   `RequirePlatformAdmin` route guard + an email-allowlist util
   (`PLATFORM_ADMIN_EMAILS` env / fallback to founding email). The
   Admin sidebar group is hidden for non-platform-admins.
5. **Deal-workspace tour (PR #510).** Extended the coachmark tour into
   the 10 deal-workspace tabs (Overview, Parcel, Documents, DD,
   Approvals, Financial, Risk, Activity, Audit, Market). Steps fire
   when the relevant tab activates so the highlighted card is always
   on screen.
6. **Shared market intelligence (PRs #511 + #512).** New accounts were
   landing on an empty Market Intelligence + Comps page because both
   datasets are stored per-org. Introduced `backend/src/utils/platformOrg.js`
   which resolves the platform admin's `default_organization_id` (lazy
   + cached). Comps service (PR #511) and intelligence service —
   `getNotesMap`, `buildBrief`, `buildDealAnalysisInput` (PR #512) —
   now read `(organization_id = current_organization_id() OR
   organization_id = $platformOrgId)`, so every workspace sees the
   platform admin's curated verified-Bengaluru rows alongside its own.
   When the caller IS the platform admin, the OR collapses and rows
   don't double-count. PR #512 also moved the Market Intelligence Notes
   editor + AI cost / health widgets on Settings under
   `isPlatformAdmin(user)` — the role-gate fix #509 missed on Settings.

### PRs opened / merged

- PR #506 — fix(auth): make terms / remember-me checkboxes clickable — merged
- PR #507 — feat(auth): remove the invite-only sign-up gate — merged
- PR #508 — feat(onboarding): product tour for new users — merged
- PR #509 — fix(auth): gate the Admin sidebar group on platform admin — merged
- PR #510 — feat(onboarding): extend the tour into deal-workspace tabs — merged
- PR #511 — feat(comps): platform admin's verified comps visible to every workspace — merged
- PR #512 — fix(intel): gate AI surfaces to platform admin + share market intelligence — merged

### Plain-English recap

- Anyone can now sign up — no invite needed. New accounts get a
  guided 3-step welcome then a tooltip tour around the sidebar and the
  deal-workspace tabs explaining what each section is for.
- The two checkboxes on the login / sign-up forms (terms and
  remember-me) now actually toggle when clicked.
- AI cost dashboards, provider health, market-notes editing, and the
  whole Admin section are now operator-only — no longer visible to
  every workspace owner.
- New accounts now land on a Market Intelligence page that already has
  Bengaluru benchmarks, transactions, and comps populated — the curated
  verified data is shared from the operator's workspace, not stuck
  inside it.

### Validation

- Backend: 140 suites / 2276 tests green on every PR.
- Frontend: clean Vite build on every PR.
- Vercel previews verified eyes-on by operator before each merge
  (login form click test; non-admin Settings cannot see AI cards;
  fresh workspace shows shared Bengaluru benchmarks).

### What's left to do

- Dark-mode override-hack retirement (in progress, ~20 `bg-white` call
  sites remain; ~9 further override rules after that).
- Decompose React-page god-files; deepen cross-module reactivity;
  Provenance Spine + Risk Radar moat; database / infra hygiene.

## 2026-05-23 (continued) — Risk Radar + Provenance Spine moat-completion sprint

### What was worked on

Operator authorised a continuation work block: "Do the next pending
tasks, phase, steps or tiers. Do multiple tasks, phase, steps or tiers.
Whichever goes well together and is of the highest priority and is
best for website." Eleven more PRs shipped end-to-end (branch → CI green
→ operator-authorised merge to master), all driving at the two
in-progress moat items: cross-module reactivity, and the Provenance
Spine + Risk Radar.

**Risk Radar — workstreams A, B closed out.**

1. **Portfolio Risk Radar (PR #514).** New `portfolioRiskRadar.service.js`
   rolls the per-deal radar up to the workspace zoom level: per-failure-
   mode counts (Title & Ownership, Approvals, Promoter, Financial,
   Physical, Market) of how many deals are flagged / unverified /
   cleared, total open critical + high flags across the portfolio, a
   ranked top-5 deals-at-risk list, and a recently-flagged feed.
   Surfaces on the dashboard as `PortfolioRiskRadarWidget.jsx`.
2. **Cross-module reactivity (PR #515).** Centralized the
   `['deal-posture', dealId]` query-key family and added a
   `useInvalidateDealPosture(dealId)` helper that mutations on DD,
   risk, approvals, and documents all call. Replaces the previous
   per-hook `queryClient.invalidateQueries(['deal-workspace', dealId])`
   sprinkles that drift apart. New `dealPostureQueries.test.js` pins
   the contract.
3. **Smart widget reconciler (PR #516).** Dashboard's `GettingStarted`
   panel + the per-step checklists now read from a single source of
   truth: the live workspace cache. When the user creates a deal, the
   first-run state collapses without a refresh. Replayable from
   Settings.
4. **Per-deal overdue DD auto-escalation (PR #517).** The per-deal
   Risk Radar now treats a required, still-open DD item whose due
   date has passed as flagged — same posture as an open critical
   flag. New `mapPostureFromDueDate` in `riskRadar.service.js`; tests
   pin every transition.
5. **Portfolio overdue rollup (PR #518).** Mirrors #517 at the
   workspace zoom level. The dashboard stat strip gained a new
   "Overdue DD" tile, failure-mode rows gained "*n* overdue" badges,
   and the top-deals-at-risk list ranks deals by score-including-
   overdue so a deal with three weeks of missed diligence ranks
   above a deal with one open high flag.

**Provenance Spine — the visible surface.**

6. **EvidenceBadge (PR #519).** New reusable inline pill that
   surfaces every workflow row's proof trail. Drops onto DD items,
   approvals, and risk flags. Hover/click → lazy-fetches
   `/api/evidence-links/:ownerKind/:ownerId`, renders the bucket pill
   (**Verified** / **Inferred** / **Unverified**) + list of linked
   evidence with title, authority, page number, section,
   confidence %, who linked it, when. Empty state for "nothing
   linked yet". Tests cover lazy-fetch, bucket pill rendering, page
   + confidence + attribution, empty state, manual-verification
   labelling, cross-open cache.
7. **EvidenceBadge on the Comps tab (PR #520).** Same chip on every
   comp row's project-name cell — so comp prices can be tied back to
   the listing screenshot, broker quote, or registry entry that
   anchors them.
8. **Manage Evidence modal (PR #521).** Completes the write half.
   The chip pop-over now carries a **Manage evidence** footer that
   opens a modal with: a list of every currently-linked piece of
   evidence (with detach), and an attach form supporting three link
   kinds — Document (dropdown of deal docs + page + section + notes),
   Manual verification (notes + confidence), External URL (URL +
   notes + confidence). React Query invalidates the chip's cache
   on every mutation so the bucket pill updates instantly.
9. **Tour copy mentions the chip (PR #522).** DD, Risk, and Comps
   tour steps now point new users at the small Evidence pill so it
   isn't easy to miss.
10. **Plain-English audit copy (PR #523).** The deal Activity
    timeline writes a row for every EVIDENCE_LINKED event (via the
    eventBus sink in `dealEvents.service.js`). The description used
    to read "Evidence linked (document → dd_item)" — accurate but
    engineer-y. Now reads as a sentence: "Linked a document to a
    DD item", "Linked a manual verification to a risk flag", etc.
    Backed by a new test file (`dealEvents.evidence.test.js`).

### PRs opened / merged

- PR #514 — feat(risk-radar): portfolio-level rollup on the dashboard — merged
- PR #515 — feat(reactivity): centralize cross-module deal-posture invalidation — merged
- PR #516 — feat(onboarding): smart widget reconciler + replayable Getting Started — merged
- PR #517 — feat(risk-radar): auto-escalate overdue required DD items to flagged — merged
- PR #518 — feat(risk-radar): roll up overdue DD counts into the Portfolio Risk Radar — merged
- PR #519 — feat(provenance): surface "where does this come from?" on DD items, approvals, risk flags — merged
- PR #520 — feat(provenance): extend the evidence badge to the deal Comps tab — merged
- PR #521 — feat(provenance): "Manage evidence" modal — merged
- PR #522 — docs(tour): mention the Evidence chip in the deal-tab tour copy — merged
- PR #523 — feat(audit): plain-English copy for evidence-linked rows on the deal timeline — merged

### Plain-English recap

- **Risk Radar at the portfolio zoom.** Open the dashboard and you
  immediately see how many live deals are flagged vs. cleared, the
  open critical + high counts across every deal, and a ranked top-5
  list of "deals you should look at before IC." Missed-deadline
  diligence items count toward that ranking now too.
- **Evidence on every DD item, approval, risk flag, and comp.** A
  small pill on each row. Hover → see the source documents and page
  numbers that back the item. Click "Manage evidence" → attach a new
  source (a deal document, a manual verification you logged, or an
  external link).
- **The deal Activity timeline reads like a story.** Old: "Evidence
  linked (document → dd_item)". New: "Linked a document to a DD item".
- **Modules stay in sync.** Resolving a DD item now updates the deal's
  risk score and the dashboard's portfolio rollup in the same tick,
  without a page refresh.

### Validation

- Backend: 142 suites / 2302 tests green on every PR.
- Frontend: 100 test files / 837 tests green on every PR; clean Vite
  builds.
- Vercel previews live on each PR's preview URL.

### What's left to do

- Dark-mode override-hack retirement (in progress; ~20 `bg-white`
  call sites remain).
- Decompose the React-page god-files (DealsPage, MasterPlanAdminPage,
  IntelligencePage).
- Database / infra hygiene (consolidate 85+ migrations, schema audit).

## 2026-05-23 (late) — "What needs my attention?" — Today's Attention + deal urgency + Cmd-K discoverability

### What was worked on

Third continuation work block. Goal stated by the operator:
*"Do multiple tasks…whichever goes well together and is of the highest
priority and is best for website."* From a first-principles review,
the biggest remaining UX gap was that the dashboard's aggregate
counters told users *how many* items needed action — but not
*which ones*. Three focused PRs answer that, end to end:

11. **Today's Attention panel (PR #525).** New backend
    `attention.service.js` returns five disjoint signals across the
    live portfolio (overdue required DD, approvals expiring within
    30 days, risk flags from the last 7 days, deals with no activity
    in 14+ days, last 10 audit-log rows). New
    `GET /api/dashboard/attention` route. New `AttentionPanel.jsx`
    dashboard widget renders each section as a clickable row — each
    row links straight to the right deal-tab. "All caught up" empty
    state when no signal fires. 14 backend tests + 7 frontend tests.

12. **Inline urgency signals on the Deals list (PR #526).** The same
    signals, now per-deal, on every card in the Deals list. Backend
    `dealSelect` gains two correlated subqueries — `overdue_dd_count`
    and `new_risk_flag_count`. Frontend `UrgencyStrip` renders up to
    three pills per deal (overdue DD red, new risks amber, "Nd quiet"
    grey when no activity in 14+ days). Clean deals render no strip.
    8 frontend tests pin the pluralisation, threshold boundary, and
    fallback-to-`updated_at` semantics.

13. **Cmd-K discoverability + recent deals (PR #527).** The Cmd-K
    palette has been mounted at the Layout level for months — most
    users never knew. Three small wires fix that:
    - Header search input becomes a **button styled like an input**
      that opens the palette on click. Visible "⌘K" / "Ctrl K" kbd
      badge on the right makes the keyboard shortcut self-explanatory.
    - Palette listens for a custom `redip:cmdk-open` event so the
      header button (and any future caller) can open it without
      simulating a keystroke.
    - `DealDetailPage` calls `recordRecentDeal(deal)` on every load,
      so the palette's "Recent deals" list actually populates instead
      of staying eternally empty.
    - New "Create new deal" quick action at the top of the palette;
      deep-links to `/dashboard/deals?new=1`; `DealsPage` opens its
      create modal on the param and strips it from the URL.

### PRs opened / merged

- PR #525 — feat(dashboard): Today's Attention panel — merged
- PR #526 — feat(deals): inline urgency signals on each deal card — merged
- PR #527 — feat(navigation): make Cmd-K discoverable + track recent deals — merged

### Plain-English recap

- New dashboard panel: **"What needs your attention"** — sits right
  under the KPI strip. Shows specific items, not aggregates: "Title
  search on Whitefield Land — 22 days overdue", click → opens that
  deal's DD tab. If nothing's urgent, it says "All caught up."
- Each card on the Deals page now carries up to three small pills:
  red **"3 overdue DD"**, amber **"2 new risks"**, grey **"21d quiet"**.
  Clean deals stay clean.
- The search bar at the top of every page is now the quick-jump
  palette. Click it (or press ⌘K / Ctrl K) → type a deal name to
  jump. Recent deals show up automatically. New "Create new deal"
  shortcut at the top of the palette.

### Validation

- Backend: 143 suites / 2316 tests green.
- Frontend: 102 test files / 852 tests green; clean Vite builds.
- Vercel preview verified per PR.

### What's left to do

- Dark-mode override-hack retirement (in progress; ~20 `bg-white`
  call sites remain).
- Decompose the React-page god-files (DealsPage, MasterPlanAdminPage,
  IntelligencePage).
- Database / infra hygiene (consolidate 85+ migrations).

## 2026-05-23 (night) — Portfolio Risk Radar hotfix + Universal Intelligence + audit polish

### What was worked on

Three coordinated PRs after the operator reported the Portfolio Risk
Radar widget hitting its error state on production, plus a fourth
continuation block of polish:

29. **Portfolio Risk Radar hotfix (PR #529).** Operator screenshot
    showed the radar tile rendering "Couldn't load the portfolio risk
    radar — your data is safe." Root cause candidate: five fan-out
    queries cast the live-stage filter as `$1::text[]` while every
    other working query in the codebase against `deals.stage` (a
    `deal_stage` enum) casts as `$1::deal_stage[]`. Postgres'
    implicit text→enum cast inside `ANY()` has been historically
    fragile on Supabase. Aligned all five casts to the enum. Also
    wrapped each query in a `safeRows()` helper so a single broken
    read can't blank the whole tile — same defence-in-depth pattern
    the Attention service uses. 2 new failure-isolation tests pin the
    contract.

30. **Universal Intelligence (PR #530).** Operator asked for sections
    5a–5d, 6, 7, the macro indicators, and market signals to be
    visible to every account out of the box, with AI Brief / Deal of
    the Day / Key Developments staying per-account. Also asked to
    retire the generic "8. Demand Slowdown Indicators" and "9.
    Strategic Takeaways" sections.

    PR #512 had plumbed the platform-org union into the brief's
    three feeder queries + Comps. The other nine Intelligence-page
    readers were never updated, so a brand-new account saw empty
    cards. New `buildOrgScope()` helper threads the union through
    every benchmark / transaction / macro-KPI reader:
    `getMacroKpis`, `getMarketTransactions`,
    `getMicroMarketBenchmarks`, `getOffice/Retail/Industrial/
    Hospitality/Residential/Niche Benchmarks`. The OR collapses
    cleanly when the caller IS the platform admin (no double-
    counting) and falls back to the plain current-org check when
    the platform admin lookup returns null.

    Slowdown + Strategic sections retired from:
      • IntelligencePage JSX (the two SectionCards)
      • Brief payload (no more `demandSlowdownIndicators` /
        `strategicTakeaways` fields)
      • Claude system prompt — brief now produces 3 sections (Deal
        of the Day, Market Signals, Risk Signals)
      • Admin Notes editor — only Micro-Market Intelligence editable
      • `saveMarketNotes` rejects 'slowdown' and 'strategic'
      • `getMarketNotes` ignores legacy rows in those sections

    13 new tests on `intelligence.platformOrgUnion.test.js` pin the
    union semantics on every reader + the retired-note contract.

31. **AttentionPanel stale-deal fix + dark-mode batch 3 + Getting
    Started CTA (PR #531).** Three-in-one cleanup:
      • One-line fix: stale-deal rows in Today's Attention were
        rendering the stage label as the row title instead of the
        deal name. Now passes `deal_name={null}` + `deal_stage={
        it.stage}` so the secondary chip shows the proper stage
        badge with the deal name as the title.
      • Dark-mode CSS override hack retirement — batch 3. Migrated
        24 `bg-white` call sites → `bg-bg-elevated` across 12
        in-app components (Attention, Settings, Deals list, Deal
        Compare, Comps modal, Intelligence, Financials, etc.).
        Total now 114 → 89 occurrences left.
      • Getting Started "New deal" CTA deep-links to
        `/dashboard/deals?new=1` (same trigger Cmd-K uses) so the
        first click on the welcome panel opens the create-deal
        form instead of an empty deals list.

32. **Audit timeline date grouping (PR #532).** The deal Audit tab
    rendered a flat newest-first list of every event. On long-lived
    deals the operator had to mentally bucket "what happened today
    vs last week" from individual relative timestamps. Two pure
    helpers (`dateBucketLabel`, `groupEventsByDate`) bucket the
    list into Today / Yesterday / Earlier this week / DD MMM /
    DD MMM YYYY sections. Eyebrow headers between groups. Each row
    still carries its own relative + absolute timestamp; the bucket
    label is purely cosmetic scaffolding. 5 new tests.

### PRs opened / merged

- PR #529 — fix(risk-radar): portfolio rollup no longer 500s — merged
- PR #530 — feat(intelligence): universal market data + retire Slowdown/Strategic — merged
- PR #531 — fix(dashboard): stale-deal naming + dark-mode batch 3 + Getting Started CTA — merged
- PR #532 — feat(audit): group the deal audit timeline by date — merged

### Plain-English recap

- **Portfolio Risk Radar tile no longer errors.** The dashboard's
  rollup card was 500-ing for the operator; root cause was a SQL
  cast inconsistency on Supabase. Aligned to the enum the rest of
  the codebase uses and added per-query failure isolation so even
  a future bad query in there can't blank the whole tile.
- **Every new account now sees the curated Market Intelligence page
  in full.** Office / Retail / Industrial / Hospitality / Residential
  / Niche benchmarks, market transactions, macro indicators, and
  the Demand Heatmap — all share the platform admin's curated rows.
  AI Brief / Deal of the Day / Key Developments stay per-account.
- **Two filler sections retired**: "Demand Slowdown Indicators" and
  "Strategic Takeaways" produced generic copy that didn't earn the
  page real estate. Removed from the page, the brief, the AI prompt,
  and the admin Notes editor.
- **Stale-deal row on Today's Attention now reads correctly**: deal
  name as the title, stage as a small chip below.
- **Getting Started CTA** now drops users directly into the
  create-deal form on first click.
- **Audit tab** now groups events under Today / Yesterday / Earlier
  this week / DD MMM headers — much easier to scan a busy deal.

### Validation

- Backend: 144 suites / 2331 tests pass.
- Frontend: 102 files / 858 tests pass; clean Vite builds.
- Vercel preview verified per PR.

### What's left to do

- Dark-mode override-hack retirement (~56 in-app `bg-white` call
  sites left after batch 3, plus a handful of override rules to
  consolidate; ~28 on public legal pages stay as-is intentionally).
- Decompose the React-page god-files (DealsPage, MasterPlanAdminPage,
  IntelligencePage).
- Database / infra hygiene (consolidate 85+ migrations).

## 2026-05-24 (morning) — Hover-prefetch + dark-mode batch 4

### What was worked on

Two focused PRs on the "smooth, fast, optimized" axis:

33. **Hover-prefetch deal workspace (PR #534).** The deal-detail page
    fires one bundled `useDealWorkspace(id)` read on mount — a
    200–500ms round-trip joining deal + financials + scenarios +
    provenance + DD/risk/audit/documents/activities/waterfall. A
    user's mouse cursor sits on a deal-list card hundreds of ms
    before they click. New imperative hook
    `usePrefetchDealWorkspace()` wires that hover window into a
    `prefetchQuery` against the shared cache key, so the click
    resolves instantly. Surfaces: Deals list cards (`onMouseEnter`
    + `onFocus`), AttentionPanel signal rows (every overdue / risk /
    expiring / stale row passes its `deal_id`), Cmd-K palette rows
    (mouse hover + arrow-key highlight both prefetch). Cache-check
    guards against thrash on a fast cursor sweep. 4 new unit tests
    pin the contract (no-op for null, fires once for fresh, skips
    when cached, populates shared cache key).

34. **Dark-mode hack retirement — batch 4 (PR #535).** Migrated 29
    more `bg-white` call sites → `bg-bg-elevated` across 5 in-app
    files: AuditTimelineView, FinancialVisualizationLayer,
    MasterPlanAdminPage, ParcelIntelligenceAdminPage, ReportsPage.
    Transparency variants (`bg-white/N`) over gradient headers
    intentionally left alone — they're not affected by the override.
    Cumulative progress across batches 1–4: 114 → ~60 occurrences;
    in-app surface now ~75% migrated.

### PRs opened / merged

- PR #534 — perf(navigation): hover-prefetch deal workspace + AttentionPanel + Cmd-K — merged
- PR #535 — chore(theme): dark-mode hack retirement — batch 4 — merged

### Plain-English recap

- **Deals open instantly.** Hovering any deal card on the Deals list,
  any row on Today's Attention, or any deal in the Cmd-K palette
  starts loading the deal page in the background. By the time you
  actually click, the page renders without a spinner.
- **More styling-debt cleanup.** 29 more components moved off an
  old dark-mode CSS hack. Invisible to users.

### Validation

- Frontend: 103 files / 862 tests pass (4 new on the prefetch hook).
- Clean Vite build.

### What's left to do

- Dark-mode override-hack retirement (~30 in-app sites left across
  MapPage + a long tail; ~28 on public/legal pages stay as-is).
- Decompose the React-page god-files (DealsPage, MasterPlanAdminPage,
  IntelligencePage).
- Database / infra hygiene (consolidate 85+ migrations).

## 2026-05-24 (live-browser audit) — landing CTA + stage label fixes

### What was worked on

Operator gave Claude in Chrome access. First real end-to-end audit of
production by clicking through the site as a user would. Dashboard,
Deals list, Deal detail, DD tab, Audit tab, Market Intelligence,
Cmd-K palette, login page, landing page — all walked through with
real screenshots.

**What was verified working live on production:**
- Today's Attention panel: stale-deal rows correctly show deal name
  with stage chip below (PR #531 fix is live).
- Portfolio Risk Radar: 5 live deals, failure-mode rollup correct,
  Top Deals At Risk ranks them properly, no 500 errors (PR #529 fix
  is live).
- DD tab: Evidence chips on every row, transitions from generic
  "Evidence" → "Unverified" pill once data loads (PRs #519/#521).
- Audit tab: date-grouped timeline with "Earlier this week" / "29 Apr"
  / "27 Apr" eyebrow headers (PR #532 is live).
- Cmd-K palette: opens via Ctrl+K, lists Create new deal, page
  jumps, deal search (PR #527).
- Market Intelligence: full set of 18 macro indicators visible
  including Office vacancy, retail rents, etc. (PR #530 universal
  data).
- Header search-bar with ⌘K hint is visible (PR #527 discoverability).
- Hover-prefetch fires (Network tab confirmed; PR #534).

**Real bugs found + fixed in PR #537:**

35. **Landing CTA was stale.** "Request access" copy in three places
    on the landing page implied invite-only sign-up, even though
    PR #507 removed that gate weeks ago. Confusing for any
    first-time visitor. Changed copy to "Get started" + made the
    button deep-link to `/login?mode=register` so the create-account
    form opens directly instead of the sign-in form with a small
    "Don't have an account? Register" toggle to find. LoginPage
    initializes `isRegister` from the new `mode` / `register` query
    param.

36. **Stage label "Investor-Grade Review" was overflowing badges.**
    Spotted on the Deals list (card stage chip wrapped awkwardly)
    and the dashboard pipeline chart (x-axis squeezed). Changed
    `STAGE_CONFIG.ic_review.label` → "IC Review" (what deal teams
    actually call it; Investment Committee Review). Propagates
    cleanly because every consumer reads through the same map.
    The separate dashboard KPI "Investor-Grade" (count of
    IC-ready deals) keeps its name — different concept.

**Findings discarded after verification:**
- "OR" divider with no Google button visible on first load — was a
  timing artifact; Google button renders ~2s later.
- `/register` returning 404 — that's a direct-URL hit; the actual
  flow toggles `isRegister` state on the login page via a button.
  Fixed downstream by the new `?mode=register` deep-link anyway.

### PRs opened / merged

- PR #537 — fix(landing+stages): "Get started" CTA + IC Review label — merged

### Plain-English recap

- **Landing page now says "Get started"** instead of "Request access".
  Clicking takes you straight to the sign-up form (not the sign-in
  form). Anyone can sign up — the invite-only era was over weeks ago
  but the copy was lying.
- **The pipeline stage that was awkwardly labelled "Investor-Grade
  Review"** is now just **"IC Review"** — shorter, fits in badges
  properly, and that's what deal teams call it anyway.

### Validation

- Frontend: 103 files / 862 tests pass; clean Vite build.
- Live preview verified the issues exist on master before the fix.

### What's left to do

- Dark-mode override-hack retirement (~30 in-app sites left).
- Decompose React-page god-files.
- Database / infra hygiene.

## 2026-05-25 — operator-screenshot bugfixes + live-browser audit pass 2

### What was worked on

Operator delivered three concrete bug reports with screenshots:

1. **Display Currency picker removed end-to-end.** The optional
   USD/EUR/GBP/AED/AUD/CAD/JPY/SGD conversion layer (Settings card +
   live FX rates table + 8 conversion paths through formatCrores) was
   never used and cluttered the pricing surface. Removed:
   - Frontend: `useCurrencyPref` hook deleted, Layout subscriber
     removed, SettingsPage Display Currency card + state + handlers
     + rates table (~120 lines), format.js foreign-currency branch
     (formatCrores now just returns `₹{x} Cr`).
   - Backend: fx.routes + fx.service + fx.service.test deleted,
     server.js mounts removed.
   - Database: new migration `20260613_drop_exchange_rates.sql`
     drops `exchange_rates` + `exchange_rate_fetch_log` tables
     (operator ran it on prod immediately after merge — confirmed
     "Success. No rows returned").
   - One-shot browser-side cleanup of legacy `pref_currencyCode` /
     `pref_fx_rate` localStorage keys so existing users don't carry
     orphan values forever.

2. **"Show Getting Started again" + "Replay deal-workspace tour"
   buttons fixed.** Both flipped a store flag but gave the operator
   zero visible feedback.
   - Getting Started: new `gettingStartedForceShown` flag (in-memory
     only) lets the dashboard render the panel even when
     `total_deals > 0`. Replay flips it on; dismiss flips it off.
   - Deal-workspace tour: the button now navigates to the operator's
     most recent active deal so the tour actually starts. Empty
     workspace gets a friendly toast.
   - Welcome tour: also navigates for visible feedback.
   - Every handler toasts what's about to happen.

3. **Auto-fill banner stops re-offering already-applied fields.**
   `extraction.service.buildFieldMap` was rolling up every canonical
   field regardless of whether it had been pushed to the deal already.
   Now `getDealExtractions` reads `correction_history`, computes
   `applied_canonical_fields` per extraction, and `buildFieldMap`
   skips any field already applied via that extraction. After Apply
   the "N ready" count drops by N; once everything is applied the
   `AutoFillReadyCard` returns null and the banner vanishes.

A live-browser audit pass following the merge caught two more polish
items:

4. **Settings page Notes editor still showed Demand Slowdown +
   Strategic Takeaways textareas** — PR #530 retired those sections
   from the Intelligence page but the SETTINGS page has its own
   separate Notes editor, never updated. Operators could type into
   voids. Dropped both from the editor; backend already rejected
   writes to those keys.
5. **AI Usage cost figures said "$3.03" without saying which $**.
   After currency removal everything else reads in INR but AI costs
   stay USD (providers bill in USD; converting introduces FX noise).
   KPI label is now "Total Spend (USD)" and the two table headers
   gained "(USD)" so every figure carries its currency.

A second sweep also found:
6. **Comps page flashed "0 verified comparables" for ~1 second**
   on first paint before snapping to the real total (81). The
   description was rendered unconditionally with `${totalCount}`
   which defaults to 0. Now reads "Loading the comparables database…"
   until the query resolves.

### PRs opened / merged

- PR #539 — fix(operator-screenshots): currency removal + onboarding replay + auto-fill banner state — merged
- PR #540 — fix(settings): retire Slowdown + Strategic Notes editor + label AI cost as USD — merged
- PR #541 — fix(comps): hide "0 verified comparables" flash during initial load — merged

### Plain-English recap

- **Display Currency is gone.** Every price across the app reads
  in ₹ Crores. One less knob to misread.
- **The two onboarding buttons that did nothing now actually work**
  — they take you straight to the page where the replayed UI
  appears and toast what's about to happen.
- **Auto-fill stops re-offering fields you already applied.** After
  Apply N, the banner drops by N or disappears.
- **Settings → Market Intelligence Notes** now shows just the one
  Bengaluru observations box. The two empty boxes that did nothing
  are gone.
- **AI cost figures clearly say (USD)** so you can't mistake the
  dollar amounts for INR.
- **Comparables page** no longer flashes "0 verified" before the
  data loads — it says "Loading the comparables database…" until
  the count is real.

### Validation

- Backend: 143 suites / 2329 tests pass.
- Frontend: 103 files / 862 tests pass; clean Vite build.
- Each PR CI-green; operator-confirmed Supabase migration ran clean.

### What's left to do

- Dark-mode override-hack retirement (~30 in-app sites left).
- Decompose React-page god-files (DealsPage, IntelligencePage,
  MasterPlanAdminPage).
- Database / infra hygiene (consolidate 85+ migrations).

## 2026-05-25 (afternoon, pass 3) — RMP zoning column + AI footer hygiene

### What was worked on

Yesterday's PR #543 fixed the **infinite-spinner state-machine bug** on
the RMP zoning toggle (the loading flag could never clear because of a
deps-array race). That fix actually exposed a deeper bug: the
toggle now resolves quickly, but to an **UNAVAILABLE** state with the
backend returning "Invalid field name in request." — a Postgres
42703 (undefined_column) error. Root cause: the SQL was selecting
`z.planning_zone` directly, but `master_plan_zones` has no such
column — planning context lives in `planning_districts` joined via
`planning_district_id`. Fixed by following the same join pattern the
rest of `masterplan.service.js` uses (ZONE_SELECT).

A second click-through finding: the Documents tab Cross-Document
Analysis card was leaking raw upstream provider error JSON into its
attribution footer:

    auto-failover: Claude 404 404 {"type":"error","error":{...},"request_id":"..."}
    — auto-failover succeeded on openai

That violates the AI-disclosure policy in CLAUDE.md (operator-facing
surfaces stay clean of provider noise). New util
`formatFallbackReason(raw)` extracts only the meaningful tail —
"auto-failover succeeded on <provider>" — and collapses long
JSON-laden strings to a generic "auto-failover engaged". Provider
names are restricted to a known safe set so future router changes
can't surface unsanctioned vendors. Applied to all three call sites:
DocumentInsightsPanel, RiskNarrativePanel, SensitivityNarrativePanel.

### PRs opened / merged

- PR #544 — fix: RMP zoning column rename + strip provider-error JSON from AI footers — merged

### Plain-English recap

- **The RMP zoning toggle now actually works.** Yesterday I fixed the
  infinite spinner — that revealed the real bug (a missing column in
  the SQL). Today the zones either load and draw on the map, or fail
  gracefully — no more "Invalid field name in request" error.
- **AI footers no longer leak raw error JSON.** What used to read
  like "auto-failover: Claude 404 404 {...JSON blob...} — succeeded
  on openai" now just says "auto-failover succeeded on openai".
  Clean, no provider error noise.

### Validation

- Backend: 143 suites / 2329 tests pass
- Frontend: 104 files / 868 tests pass (6 new on formatFallbackReason)
- Clean Vite build

### What's left to do

- Dark-mode override-hack retirement (~30 in-app sites left).
- Decompose React-page god-files (DealsPage, IntelligencePage,
  MasterPlanAdminPage).
- Database / infra hygiene (consolidate 85+ migrations).

## 2026-05-25 (engineering work block) — Tasks #4 + #10 + #6 done together

### What was worked on

Three formally-tracked engineering tasks shipped in one focused block.

**Task #4 — Retire dark-mode CSS override hack (DONE).**
Migrated the last 17 in-app legacy-Tailwind utilities to semantic
design tokens, then deleted the entire pre-theme override safety net
from index.css (~70 lines of `!important` rules). PR #546.

The override block lived under `html[data-theme='dark']` and re-mapped
`bg-white`, `bg-gray-*`, `bg-slate-*`, `bg-paper-*`,
`border-gray-*`, `border-slate-*`, `border-line`, `divide-gray-*`,
and `text-gray-/slate-/ink-{300..900}` to the semantic tokens. The
final audit found exactly three legacy classes still in JSX files —
all on a single line of PortfolioRiskRadarWidget.SEVERITY_TONE.low.
After migrating that one line, the override block was orphaned and
could be deleted cleanly.

Kept what's still in use: tinted info-panel utilities (bg-rose-50,
bg-amber-50, bg-sky-50, bg-indigo-50, bg-violet-50 + border-*-200
partners) and gradient washes (from/to-{indigo,sky,amber,violet,
emerald,rose}-50). Those still need dark-mode adjustment.

**Task #10 — RLS coverage audit + 6 missing-RLS tables (DONE).**
PR #547.

Wrote a new static auditor (`scripts/audit_rls.py`) that scans every
migration file for CREATE TABLE, ENABLE ROW LEVEL SECURITY, and
CREATE POLICY statements. First run flagged a real security gap:
**six org-scoped tables were created with an `organization_id` /
`org_id` column but never had RLS enabled** — meaning the application's
WHERE clause was the only barrier preventing cross-org row leakage.

Tables affected:
  - public.market_macro_kpis
  - public.office_market_benchmarks
  - public.retail_market_benchmarks
  - public.industrial_market_benchmarks
  - public.hospitality_market_benchmarks
  - regulatory_data.master_plan_documents

Migration `20260613_rls_coverage_market_data_and_master_plan_docs.sql`
enables RLS + adds the standard policy quad on each (universal SELECT
matching the platform-admin-union pattern from PR #530; own-org-only
INSERT/UPDATE/DELETE). Matches the existing pattern on
micro_market_benchmarks and market_transactions.

The audit script is wired into the `Audit & migration lint` CI job —
new tables landing without RLS will fail the build. docs/RLS_AUDIT.md
documents the audit's snapshot, the two RLS policy patterns used
across the schema, and the checklist for adding a new org-scoped
table.

Operator action required: apply the migration in Supabase SQL editor
(deep-link in the PR body).

**Task #6 — DealsPage decomposition (PARTIAL — DealCard extracted).**
PR #548.

DealsPage.jsx had grown to 1,458 lines. The bottom 287 were a single
big-state DealCard component (menu / share / delete-confirm state,
data hooks, action handlers, modal sub-tree) — totally self-contained,
just lived in the wrong file. Moved to a dedicated
`components/deals/DealCard.jsx` (~327 lines). DealsPage.jsx drops to
**1,162 lines** and now reads as a single concern: filters / bulk
actions / pagination / new-deal modal / the grid that renders the
extracted DealCard for each row.

Next on Task #6: IntelligencePage (~2,000 lines) and
MasterPlanAdminPage are the remaining god-files. Will handle in
follow-up PRs.

### PRs opened / merged

- PR #546 — refactor(theme): retire the dark-mode legacy override block — merged
- PR #547 — fix(security): close 6 org-scoped tables missing RLS + add static audit to CI — awaiting operator merge + Supabase migration apply
- PR #548 — refactor(deals): extract DealCard from DealsPage.jsx — awaiting operator merge

### Plain-English recap

- **Theme code is cleaner.** ~70 lines of `!important` legacy CSS
  hacks deleted. Nothing visible changes — both light and dark mode
  render identically to before.
- **Real security gap closed.** Six tables holding your platform-
  curated market data (Bengaluru macro KPIs, office / retail /
  industrial / hospitality benchmarks, master plan docs) now have
  database-level write protection — even if a future app-side filter
  bug forgets to add the org check, the DB itself refuses cross-org
  writes. A new automatic check on every PR catches future tables
  that skip this step.
- **Deals page is easier to maintain.** The 287-line per-card render
  logic moved to its own file. Changing card behaviour no longer
  means scrolling past 1,000 lines of list-level state.

### Validation

- python3 scripts/audit_rls.py → 0 missing-RLS findings (down from 6)
- backend: 143 suites / 2329 tests pass
- frontend: 104 files / 868 tests pass; clean Vite build

### What's left to do

- Task #6 continuation: decompose IntelligencePage.jsx (~2k lines)
  and MasterPlanAdminPage.jsx.
- Operator applies the RLS migration in Supabase + merges #547.

## 2026-05-25 (evening, work block 2) — IntelligencePage decomposition + AI Usage copy fix

### What was worked on

Two pieces in this block:

**Task #6 (continued) — IntelligencePage decomposition. PR #550.**

The Intelligence page was a ~2,000-line god-file. Extracted every big
logical unit into focused component files:

  components/intelligence/
    AdminNotesPanel.jsx                (167 lines) — operator notes editor
    MacroKpiTile.jsx                   (48 lines)  — single macro-strip tile
    AssetClassBenchmarkTables.jsx      (497 lines) — Office / Retail /
                                                     Industrial / Hospitality
    SegmentedBenchmarkTables.jsx       (418 lines) — Residential Segmented
                                                     + Niche asset class
  utils/
    intelligenceTableHelpers.js        (35 lines)  — buildClusterOptions,
                                                     matchesSearch (shared)

  IntelligencePage.jsx: 1,964 → 940 lines (-52.1%)

Zero behaviour change. Same 868 tests pass after each commit.

**Live-audit pass 4 — Comps, Map, Reports, admin pages. PR #551.**

Clicked through Comps (81 verified entries, filters working), Map
(7 visible properties, 6 deals, 1 city), Reports/Exports (pipeline
table working), Master Plan admin (Zone Library with 8+ approved
zones), Parcel Intelligence Operations (28 items pending review,
schema 0-missing), Comps Review Queue (empty state working), A/B
Evaluations (parcel verdict 100/100, export deck 99/100).

**One real bug found:** the AI Usage admin page rendered

    ERRORS 233
    No retry recoveries needed

The "No retry recoveries needed" copy was misleading — with 233
errors the platform did NOT decide recovery wasn't needed, it just
never happened. Fix branches the sub-label on errors>0 first:

    errors > 0       → "{recovered} of {errors} recovered via retry"
    cost_capped > 0  → "{cost_capped} cost-capped"
    else             → "No retry recoveries needed"

Two regression tests guard the copy.

### PRs opened / merged

- PR #550 — refactor(intelligence): decompose IntelligencePage 1,964 → 940 lines — awaiting operator merge
- PR #551 — fix(admin/ai-usage): show recovery ratio when errors > 0 — awaiting operator merge

### Plain-English recap

- The Intelligence page file is now 52% smaller — easier to navigate and
  modify. The page renders identically; pure structural cleanup.
- The AI Usage dashboard now shows recovery accurately. "0 of 233
  recovered via retry" instead of the misleading "No retry recoveries
  needed" — tells the truth when the recovery rate is low.

### Validation

- 104 frontend test files / 870 tests pass (was 868; +2 new for AI Usage)
- Clean Vite build (350 kB index gzip — unchanged from master)

### What's left to do

- Decompose MasterPlanAdminPage.jsx (next-largest god-file).
- Continue Task #10 work if any further DB hygiene surfaces.

## 2026-05-28 (10h block) — Deal-page audit cleanup + ontology drift guard

### What was worked on

Single-session response to a screenshot audit of the deal page. The
operator listed five concerns across five images on the Overview +
Zoning tabs; this block addresses every one and adds the strategic-
review's remaining ontology-adoption gap.

**Lane A — coordinate alias bug (PR #631).**

`dealWorkspace.service.js:292`, `:426`, and
`dealStructureRecommender.service.js:389` read `deal.property_lat` /
`deal.property_lng` off the deal record, but `dealSelect` in
`deal.service.js` was aliasing `p.lat` / `p.lng` as bare `lat` / `lng`.
The names never matched, so the gate always returned the
`no_parcel_coordinates` empty state — even for deals with a fully
geocoded property. Three panels (Micro-Market Briefing, Best Use
Simulator, market-posture sub-score of the Deal-Structure Recommender)
plus IC-readiness comps-proximity were silently broken on every deal
in production for weeks.

Fix: additive `p.lat AS property_lat, p.lng AS property_lng` aliases.
Legacy `lat` / `lng` retained for the five frontend consumers
(ParcelTab, MapPage, CompsTab, mapConfig, SiteWeatherCard) that read
`deal.lat` directly — same column, two names, no breaking change.
Two regression tests pin the contract in `dealWorkspace.service.test.js`.

**Lane B — Deal-Structure Recommender rationale rewrite (PR #632).**

The recommender's 8 cards used to share three near-identical rationale
lines: the structure one-liner, "neutral market posture" (when no
micro-market data), and a generic "unverified promoter × X
compatibility" template. That last line was the same on every row of
every deal where the promoter wasn't seeded — which made the whole
recommender feel templated even though the underlying scorer was
real.

Replaced the template with a posture × structure × score-tier
callout ("Cleared promoter — clean fit with outright", "Flagged
promoter — outright offers no protection; high exposure", etc.).
Rewrote the rationale composer to lead with the structure description,
surface the strongest score driver for THIS row (market posture if
informative; otherwise the more distinctive of capital efficiency
vs execution complexity by midpoint distance), then close with the
promoter callout. Score arithmetic, verdict thresholds, closed verb
dictionary, and hard floor for invalid pairs are unchanged. 7 new
tests pin the new composition; a sweep proves the old generic
template can't reappear on any structure × posture combination.

**Lane C — retire What-if buildability + Executive narrative (PR #633).**

Two surfaces on the Zoning tab that did not earn their complexity:

  - WhatIfBuildability — slider tool that, in practice, rendered "No
    reviewed residential FAR rule matches this combination" for most
    deals (the seeded bands cover a narrower envelope than the
    typical deal's plot/road combo). Genuine sensitivities live in
    the Financial Model.

  - ParcelNarrativeCard ("Executive narrative") — on-demand Claude
    rephraser that turned the deterministic verdict snapshot into a
    2-paragraph prose summary. CLAUDE.md (operator override
    2026-05-19) is explicit that the customer-facing surface should
    NOT lean on AI as a marketing concept; the deterministic
    VerdictBanner above it already says "Proceed With Caution — 70%
    confidence — 2 medium, 2 low flags" in one glance.

Full removal — frontend cards, frontend hooks
(`useGenerateParcelNarrative`, `useCachedParcelNarrative`), frontend
API methods, backend service (`parcelNarrative.service.js`), backend
routes (POST + GET `/properties/:id/parcel-intelligence/narrative`),
`parcel_narrative` from `aiArtifacts SUPPORTED_ARTIFACT_TYPES`,
`parcel_narrative` from the A/B eval harness `TASKS` registry +
persistence `TREND_TASKS` + validation + admin route defaults + CLI
defaults, regenerated `ab-eval-deals.json` fixtures without
`parcel_payload`. Net deletion: ~3,200 lines + one less Claude call
per deal-page view.

**Lane D — auto-fill CTA inside Buildable envelope (PR #634).**

The "Buildability needs verification" empty state on the Overview
tab's Buildable envelope was truthful but inert — the operator had
no way to know what to do next without already understanding the
extraction workflow. The auto-fill workflow that solves this lived
buried in the Documents tab.

Two affordances threaded directly into the card's empty state:

  - When pending extractions exist for any of the eight buildability
    fields (land_area_sqft, land_area_acres, road_width_m,
    road_width_mtrs, permissible_fsi, existing_fsi, frontage_mtrs,
    depth_mtrs) — render an "Auto-fill N fields from documents"
    button that opens the same modal mounted from the Documents-tab
    header. The number is computed from the field_map roll-up.
  - When no buildability extractions are pending — render an "Upload
    a sanctioned plan or RTC" button that hops to the Documents tab
    via the existing setSearchParams tab switcher. Hidden when the
    panel is mounted standalone on PropertyDetailPage (no setTab
    handler).

The amber warning above the CTA also gained a structured 3-bullet
checklist naming exactly what's needed — master-plan zone, land
area in sqft, road width in metres — the literal inputs the FAR
matrix indexes on.

**Lane E — compress Zoning tab layout (PR #635).**

ParcelIntelligencePanel was a wall of fully-expanded cards. The
information-dense head (verdict banner + 8 metric tiles + red flags)
was buried beneath ~1,200px of disclosure surface most operators
rarely need on first paint.

Wrapped three secondary sections in CollapsibleCard (default-
collapsed, localStorage-persisted per section):

  - parcel-intel-evidence-buckets (Verified / Inferred / Needs review
    tabs — switcher moved into the meta slot so changing tabs
    doesn't require expanding the section first)
  - parcel-intel-kgis-map (440px Leaflet map — only hydrates on
    operator open, measurable first-paint win)
  - parcel-intel-authority-verification (6+ deep links)

Plus stabilised a pre-existing flaky test
(`usePrefetchDealWorkspace`) — wrapped the cache-key assertion in
`waitFor` so React Query's microtask cache flush has time to land
before the synchronous read.

**Lane F — derive DEAL_STRUCTURES from the ontology (PR #636).**

Strategic Review §VI Priority 1 flagged drift risk between the four
places encoding deal-structure / asset-class taxonomies. Workstream
F (frontend, earlier) had already locked frontend ↔ backend ↔
ontology via contract tests. The remaining backend gap was
`domain.js DEAL_STRUCTURES` — a hardcoded 8-string array next to the
ontology's `deal_structure.values`. Replaced with
`getDealStructureKeys()` from the ontology package. Strictly stronger
than a parity test — the constant cannot drift because it IS the
ontology. Added `tests/ontology.parity.test.js` to lock the remaining
drift surfaces (assetClasses.js rich config + dealStructureMatrix.js
backend mirror — 5 assertions).

### PRs opened / merged

All six landed on master in this block. Operator-approved batch merge
with explicit "Pls merge+push+commit+deploy" authorization.

- PR #631 — fix(workspace): expose property_lat/property_lng on the
  deal record — merged
- PR #632 — feat(recommender): rewrite rationale composition to
  surface deal-specific drivers — merged
- PR #633 — chore(deal): retire What-if buildability + Executive
  narrative — merged
- PR #634 — feat(deal): surface auto-fill CTA inside Buildable
  envelope card — merged
- PR #635 — feat(deal): compress Zoning tab — disclose K-GIS map /
  evidence buckets / authority links — merged
- PR #636 — refactor(domain): derive DEAL_STRUCTURES from the
  ontology + add parity guard — merged

### Plain-English recap (operator)

- **The "Add coordinates" empty state is gone on geocoded deals.**
  Three panels that were silently broken on every deal — Micro-Market
  Briefing, Best Use Simulator, the market-aware part of the Deal
  Structure scoring — now light up automatically the moment a deal
  has a linked geocoded property.
- **Each Recommender row now reads distinctly.** The "unverified
  promoter × X compatibility" template is gone; each of the 8
  structures gets a posture- and score-aware callout that explains
  why IT scored where it did on THIS deal.
- **The Zoning tab is roughly half as tall on first paint.** The
  verdict banner + 8 metric tiles + red flags remain prominent; the
  K-GIS map, evidence buckets, and authority links collapse by default
  and remember the operator's choice across sessions.
- **The Buildable envelope warning is now actionable.** When the
  card needs FSI / road width / area, it offers either an
  "Auto-fill N fields from documents" button (when REDIP has already
  extracted them) or an "Upload a sanctioned plan or RTC" button —
  no more dead-end "Buildability needs verification" copy.
- **The What-if slider and Executive narrative cards are gone**, per
  your audit. ~3,200 lines deleted; one fewer Claude call per
  page view.
- **Adding a deal structure now takes one file edit instead of
  three.** The backend constant is derived from the canonical
  ontology, with a CI test that catches future drift on the
  assetClasses + dealStructureMatrix mirrors.

### Validation

- Backend: 168 suites / 2932 tests pass on each PR
- Frontend: 121 files / 1034 tests pass on each PR
- Frontend Vite build: clean on each PR (~11s, ~350KB index gzip)
- CI: 7/7 checks green on every PR
- Vercel production deploy: success on each merge

Live in-browser verification skipped — `redip.vercel.app` requires
operator login and per privacy rules the agent cannot authenticate on
the operator's behalf. Vercel deploy success + green CI is the
strongest non-manual proof available.

### What's left to do

- Operator-side TODOs unchanged from TODO_OPERATOR.md (backups,
  lawyer for DPA + AUP, two incident-runbook names, security@
  mailbox, eventual schema squash).
- Strategic Review §VI items completed in this block — Priority 1
  closed (ontology drift guard); Priority 2 (live market-benchmark
  warnings) was already shipped via PR-NX52 + PR-NX56 (2026-05-19);
  Priority 3 (One Brain / DealContext Phase A) is partially shipped
  via the `/api/deals/:id/workspace` endpoint + DealContextProvider —
  remaining work is migrating individual tabs to the shared context
  (incremental, lower-leverage than this block's lanes).
- Decompose MasterPlanAdminPage.jsx (Task #6 continuation) when
  another maintainability sweep is queued.

## 2026-05-29 (10h block) — live-audit hardening (PRs #640-#643)

### What was worked on

First block with authenticated in-browser access (operator signed into
Chrome), so for the first time the work was driven by a LIVE audit of
the deployed product rather than code reading alone. That immediately
surfaced bugs every prior session — and the whole test suite — had
missed.

**Deploy-race diagnosis (process learning, no code change).** The prior
block's batch-merge of #638 then #639 in quick succession caused an
out-of-order Vercel deploy: #639's build finished first (14:30), then
#638's slower build finished at 14:43 and OVERWROTE production with the
older commit. Net effect: production served #638 (Stage History removal
live) but NOT #639 (audit chip reverted to the old full card).
Self-healed once this block's PRs merged production back to the true
master tip. Mitigation recorded: merge one PR → wait for its deploy →
merge the next.

**Lane O (CRITICAL) — Zoning tab crash, PR #642.** Opening any
Bengaluru deal's Regulatory/Zoning tab hard-crashed into the
ErrorBoundary with React #310 (rendered more hooks than the previous
render). Root cause: `DealStreetLookupCard` called its `spreadAnalysis`
useMemo AFTER three early returns, so the loading render ran one fewer
hook than the loaded render. Reproduced on every Bengaluru deal — the
Zoning tab had effectively been DOWN in prod. Fix: hoist all hooks
above the early returns. Pre-existing (NOT from #635). Existing tests
missed it because each mounts with a FIXED query state; added a
loading→loaded lifecycle regression test that throws #310 on old code.

**Lane P — "undefined" in planning-context callouts, PR #643.** The
"Bengaluru planning context" rail printed literal "undefined" ("P
undefinedm · S undefinedm · T undefinedm", "undefinedm corridor ·
undefined"). The per-tile gates only checked the callout ROW existed,
not its sub-fields. Fix: per-callout `*Has` flags + every interpolation
guarded (→ "—"); hollow rows skip their tile and fall back to the
honest empty state. 2 regression tests.

**Lane L — deal-breaker count contradiction, PR #641.** Deal Pulse said
"5 deal-breakers" while the Recommendation card said "6 unresolved
deal-breaker items" on the same page. The recommendation extractor
matched severity 'critical' (a RISK severity, never a DD severity),
skipped `is_required`, and used a non-DD status set. Fixed to mirror
`dealReadiness.service` exactly. Now both say 5. 5 parity tests.

**Lane M — ask price "₹0.00 Cr", PR #641.** An unset ask price rendered
"₹0.00 Cr" (implying free land) because the pg driver returns NUMERIC
as the string "0.00", which is truthy. New `formatCroresOrDash` treats
null/0/non-positive as "—". Applied to OverviewTab (ask + negotiated)
+ DealCard. 7 tests.

**Lane K — workspace query dedupe, PR #640.** `getDealWorkspace` fetched
the promoter profile twice and approvals twice, and inlined the
document-flatten loop twice. Hoisted all three into the top-level
Promise.all / single-source values — 2 fewer DB round-trips per deal
page load.

**Lane N — dashboard "Avg IRR 0.5%": verified NOT a bug.** The
`AVG(f.irr_pct)` SQL is correct; 0.5% honestly reflects a portfolio of
early-stage deals with low modeled IRR. Left unchanged (changing it
would be fabrication).

### PRs opened / merged

All four merged to master, sequentially (one deploy at a time, to avoid
repeating the deploy race), each re-verified live after its deploy.

- PR #640 — perf(workspace): dedupe promoter + approvals fetches — merged
- PR #641 — fix(deal): consistent deal-breaker count + honest ask-price — merged
- PR #642 — fix(deal): stop Zoning tab crashing (React #310) — merged
- PR #643 — fix(deal): stop "undefined" in planning-context callouts — merged

### Plain-English recap (operator)

- **The Regulatory / Zoning tab works again.** It was crashing to a
  "Something went wrong" page on every Bengaluru deal; it now opens
  normally.
- **No more "undefined" on the page.** The Bengaluru planning-context
  box used to print "undefined" where numbers were missing; it now
  shows real values, a clean "—", or a tidy "not ingested yet" note.
- **The deal-breaker count agrees with itself.** The pulse strip and
  the recommendation card now show the same number (was 5 vs 6).
- **Unset prices show "—" instead of "₹0.00 Cr"**, so a deal with no
  price entered no longer looks like free land.
- **Deal pages load a touch faster** — two redundant database lookups
  per page were removed.

### Validation

- Backend: 169 suites / 2942 tests pass (+5 deal-breaker parity tests)
- Frontend: 121 files / 1037 tests pass (+ regressions for the crash,
  the undefined callouts, and the price formatter)
- Clean Vite build on every PR; CI 7/7 green on each
- LIVE re-verified after deploy (operator's authenticated session):
  Zoning tab renders, no "undefined", deal-breaker counts match (5 = 5),
  ask price shows "—", audit chip restored in the Financial footer

### What's left to do

- One transient "Failed to load deal details" appeared once during
  rapid tab-switching and cleared on reload — looks like a serverless
  cold-start/timeout, not a regression (same endpoint loaded fine
  before and after). Worth a backend cold-start look if it recurs.
- Operator-side TODOs unchanged (TODO_OPERATOR.md): DB backups, lawyer
  for DPA + AUP, two incident-runbook names, security@ mailbox.
- MasterPlanAdminPage.jsx decomposition still queued (maintainability).

## 2026-05-29 (10h block) — multi-agent audit + fix sweep (PRs #645-#650)

### What was worked on

Operator opted into multi-agent orchestration ("workflow"). Ran a
Workflow that fanned out 8 audit dimensions across the codebase, then
adversarially verified every reported finding with a second agent
(29 subagents total). It returned 18 confirmed issues (3 high, 10
medium, 5 low) — including a SECOND React #310 crash of the exact
class fixed last block, an IRR units bug, and an in-app-vs-export
recommendation parity gap. Triaged into 5 focused PRs, each with
tests, merged one-at-a-time.

**PR #645 (A) — two more React #310 crashes (HIGH).** The audit's
hooks dimension found `TerminalValuePanel` (FinancialVisualizationLayer)
and `QuarterlyProformaPanel` both calling a `useMemo` after an early
return — same crash class as the Zoning tab last block. For income-like
deals / deals with an empty-then-populated proforma, the panel
re-renders with a changed hook count → React #310 crashes the
Financials surface. Hoisted both useMemos above the guards. Swept all
of frontend/src for the pattern — these were the last two real ones
(remaining grep hits are helper-return-then-next-component false
positives). Loading→loaded regression tests added.

**PR #646 (B) — recommendation engine correctness (HIGH).** Three
related defects making the LIVE deal page weaker/wronger than the
export: (1) dealWorkspace fed the engine the raw DB row as
`financial.summary` (no `.kpis`) and no `comps` slice, so every
financial + market signal returned null in-app while the DOCX/PPTX
export showed them — fixed by attaching `summary.kpis` (from
model_params) + `comps.entries`; (2) extractIrrVsHurdle treated the
kernel's percent-form IRR (14.0) as a fraction, printing "1400%" /
"138400 bps" and never firing irr-below-hurdle — fixed by /100; (3)
approvals dual-source (cross-org-shared deals showed zero approvals in
K-RERA/IC) — collapsed to the single deal.approval_items source.

**PR #647 (C) — truthful display (MED).** Dashboard "Avg IRR" coerced
null→0 and rendered a fake red "0.0% · Below bench" on a fresh org —
now shows "—". Map "Nearby Comp Benchmarks" panel guarded the wrong
object (`nearbyBenchmarks?.found` vs `nearbyBenchmarksResponse?.found`)
so it was DEAD for every property — one-line fix restores it.

**PR #648 (D) — UI plumbing (MED).** PageHeader silently dropped `sub`
+ `right`/`action` props, so four admin pages had no subtitle and the
A/B Eval header Refresh never rendered — added the aliases. Dead
`keepPreviousData: true` (removed in React Query v5) in 4 hooks →
`placeholderData: keepPreviousData` (stops list-skeleton flash).
Light-theme muted text #94A3B8 (~2.5:1, fails WCAG AA) → #5B6B7F.

**PR #649 (E) — frontend quality (MED/LOW).** Stabilised the flaky
usePrefetchDealWorkspace test (gcTime:0 → Infinity; it was blocking
CI on unrelated PRs, incl. this block's PR-B). Debounced the deals
list search (250ms; was firing a request + skeleton flash per
keystroke). Labelled the risk edit/delete icon buttons (aria-label +
focus-visible).

### PRs opened / merged

All merged to master, each re-verified green on CI:
- #645 fix(financials): two more React #310 crashes — merged
- #646 fix(recommendation): in-app financial+market signals + IRR units — merged
- #647 fix(display): honest dashboard Avg IRR + Map benchmarks panel — merged
- #648 fix(ui): PageHeader aliases + keepPreviousData + AA muted text — merged
- #649 fix(fe): flaky test + deals search debounce + risk button a11y — merged

### Plain-English recap (operator)

- **Two more pages that could crash now don't.** The Financials page had
  two hidden crashes (same kind as the Zoning one) that hit on certain
  income deals / after recalculating — both fixed.
- **The live deal page now shows the same financial + market
  recommendations the exported report does.** They were silently missing
  in-app. And no number ever reads "1400%" again.
- **The dashboard tells the truth on a fresh account** — "Avg IRR · —"
  instead of a fake red "0.0% · Below bench".
- **The map's nearby-comps panel works** — it was showing "no comps" for
  every property due to a one-word bug.
- **Admin pages show their descriptions again**, the A/B Eval refresh
  button is back, light-mode grey text is readable, and the deals search
  no longer flickers as you type.

### Validation

- Backend: 169 suites / 2943 tests pass (full suite; one transient flake
  on first run passed on re-run + was root-caused & fixed in #649)
- Frontend: ~1040 tests pass; clean Vite build on every PR
- New regression tests: 2 crash lifecycle tests, IRR-unit + workspace-shape
  tests, KpiStripWidget honesty, PageHeader aliases, flaky-test stabilised

### What's left to do (documented, deliberately deferred — not rushed)

- **New-Deal + Add-Comparable modal a11y** — swap onto the Modal
  design-system primitive (role=dialog / aria-modal / Escape / focus-
  trap). Larger change on two key flows; deserves its own PR + live check.
- Comps "All" filter-chip count (LOW); Micro-Market Briefing freshness
  date (LOW — needs data-plumbing verification).
- Operator-side TODOs unchanged (backups, DPA/AUP lawyer, runbook names,
  security@ mailbox).
