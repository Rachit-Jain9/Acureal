# REDIP Session Log

Running history of every working session. Read this to understand what was built, what changed, and what's next — even if the chat session is gone.

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
