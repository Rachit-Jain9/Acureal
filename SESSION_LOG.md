# REDIP Session Log

Running history of every working session. Read this to understand what was built, what changed, and what's next — even if the chat session is gone.

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

User rotated the Maps API key after this PR landed (old key `AIzaSyB37FP62rUZr9ah1SmkYFA7ucj2W-o6O6Y` → new key `AIzaSyCu5PmVe0kHoFg4n8JHSTV9OI25bIOnwpk`) and added it to Vercel as `GOOGLE_MAPS_API_KEY`. The frontend Maps JS won't see that until a `VITE_GOOGLE_MAPS_API_KEY` (with the same value) is also added to Vercel — Vite only exposes env vars prefixed with `VITE_` to the browser bundle. Local `frontend/.env` and `backend/.env` updated to the new key value (gitignored, not committed).

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
