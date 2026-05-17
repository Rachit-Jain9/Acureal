# Exports rewrite — status tracker

_Source plan: `~/.claude/plans/lets-work-on-exports-harmonic-backus.md`._
_Last updated: 2026-05-17 (DOCX institutional-grade bundle PR-NX35 / 36 / 37 lands risk register, DD status, approvals tracker, provenance/source register, ToC, methodology appendix). Update at the bottom of each session._

This file tracks the multi-PR investor-grade exports rebuild so future
sessions can pick up where the last left off without re-reading the chat.

---

## Status table — all major work complete

| PR | Scope | State |
|---|---|---|
| #225 | Foundation: palette, Mapbox client, QR, SVG gauge, Gemini narrative, deal score, export-events migration | ✅ MERGED |
| #226 | PPTX: editorial palette swap + cover QR + cover score gauge + Pros & Cons slide | ✅ MERGED |
| #227 | docs/PRICING.md + initial status tracker | ✅ MERGED |
| #228 | XLSX v2: 4-sheet investor-grade workbook (Inputs / Phasing / Cash Flow / Dashboard) opt-in via `?v=2` | ✅ MERGED |
| #229 | DOCX v1: 8-section underwriting report behind `DOCX_REPORT_ENABLED` flag | ✅ MERGED |
| #231 | PPTX polish r1: kill cover QR + divider blob; fix bullet alignment; content-rich dividers | ✅ MERGED |
| #232 | PPTX charts + Mapbox site map; Sources & Uses doughnut on Financial Overview | ✅ MERGED |
| #233 | Market Positioning density: comp table + Deal-vs-Market 3-tile panel | ✅ MERGED |
| #234 | Risks slide density: severity histogram + by-category breakdown | ✅ MERGED |
| #235 | Decision Frame slide + Contents redesign + cover artwork (per asset class) | ✅ MERGED |
| #236 | PPT corruption fix (SVG → native shapes for cover artwork) | ✅ MERGED |
| #237 | **Mapbox → Google Maps swap** + Investment Highlights density | ✅ MERGED |
| #238 | Cash Flow & Sensitivity scenario tiles + **asset-class precedence fix** (deal name beats stale residential default) | ✅ MERGED |
| #239 | Drop zero-padded "01/02/03/04" — plain "1/2/3/4" everywhere | ✅ MERGED |
| #240 | Asset Snapshot + Transaction Summary + Structure & Counterparty density | ✅ MERGED |
| #241 | Key Assumptions appendix + Readiness density + Disclaimer rebuild | ✅ MERGED |
| #242 | **XLSX v2 phase 2**: hidden Calculations sheet + IRR/NPV functions + sensitivity heatmap + Bull/Base/Bear scenarios; v2 is now the default | ✅ MERGED |
| #243 | **DOCX phase 2**: Demographics + Why-this-area + Job Growth + Social Infra + Supply & Demand + Better Alternatives sections | ✅ MERGED |
| #244 | docs: status tracker + session log handoff for the late 2026-05-10 batch | ✅ MERGED |
| #245 | **XLSX asset-class restructure**: full Operating P&L for income deals (PGI / Vacancy / EGR / OpEx breakdown / NOI / CapEx / Debt Service / Reversion) + sheet-protection popups removed | ✅ MERGED |
| #246 | **XLSX Dashboard restructure**: 14-column grid, asset-aware Quarterly Trend table with conditional-format data bars, IRR/NPV cash-flow row fixed for income deals | ✅ MERGED |
| #247 | **XLSX JV / JDA profit waterfall** on Dashboard (Total Profit → Developer Share → Landowner Share) | ✅ MERGED |
| #248 | **Fix**: XLSX Calculations sheet circular refs (8 off-by-one row references) + Circle Rate "0" displays as "–" in PPTX/DOCX when missing | ✅ MERGED |
| #249 | **Feat**: PPTX cash flow combo chart (column + line) on slide 16 + capital stack horizontal bar on slide 17 | ✅ MERGED |
| #250 | **Fix**: XLSX percent-input normalisation (`toPctDecimal`) — kernel-stored integer-percent (5 for 5%) now converted to decimal (0.05) for `0.0%` cells. 24 percent inputs covered | ✅ MERGED |
| #251 | **Feat**: PPTX sensitivity tornado on slide 16 (replaces 5×5 heatmap table) + rate-vs-distance scatter on slide 9 | ✅ MERGED |
| #252 | **Feat**: DOCX SVG chart embeds — capital stack donut + quarterly cash flow trend + sensitivity tornado in the Financials section (pure-SVG, no native deps) | ✅ MERGED |
| #253 | docs: 2026-05-11 batch handoff (PRs #248–#252 docs handoff) | ✅ MERGED |
| #254 | **Feat**: XLSX native chart objects on Dashboard — new `chartInjector.js` splices doughnut + clustered-column XML into the ExcelJS-written buffer (ExcelJS 4.4.0 has no `addChart`). Asset-class-aware series labels (Sales/Construction vs PGI/NOI). Mirrors the operator's reference-template-pack chart structure | ✅ MERGED |
| #255 | docs: PR #254 handoff | ✅ MERGED |
| #256 | **Fix**: Phasing cumulative-row Total column bug (was producing 3,198 Cr triangular sum where actual cumulative is 266 Cr) + Dashboard Revenue / Calculations Revenue reconciliation (was 593 vs 648, different methodologies — now share source of truth) | ✅ MERGED |
| #257 | **Fix**: Customer collection now follows construction progress (RERA-milestone-linked), not same-quarter as sale. Operator's "IRR -15% despite positive net cash flow" complaint — fixed. Jigani IRR went from -15% to +47% (with conventional negative-early / positive-sustained CF profile) | ✅ MERGED |
| #258 | docs: handoff for PRs #256 + #257 | ✅ MERGED |
| #259 | **Fix**: Dashboard headline KPIs (Total Revenue, IRR, NPV, EM, Gross Margin) now display kernel-stored values from the deal record when populated — reconciles with the Reports page in the frontend (operator's roast showed Jigani IRR 13.6% on the page vs different number in the XLSX → unacceptable inconsistency). Modeled (sensitivity-run) figures preserved as a secondary row | ✅ MERGED |
| #260 | docs: XLSX_INSTITUTIONAL_GRADE_ROADMAP.md capturing 26 gaps vs the operator's reference pro formas | ✅ MERGED |
| #261 | **PR-A** institutional-grade rebuild: detailed soft cost breakdown — 6 new line items (A&E / Legal / Appraisal / Insurance during Construction / Property Taxes during Construction / Developer Overhead) on Inputs sheet + Phasing schedule rows 13-19 + expanded Calculations Cost Build (8 soft cost rows, total at R25) | ✅ MERGED |
| #262 | **PR-F** institutional-grade rebuild: combo chart on Quarterly Trend — chartInjector extended with `buildComboChartXml` (barChart + lineChart in one plotArea, secondary value axis on right). Dashboard's Quarterly Trend chart now shows period contribution columns PLUS copper cumulative line. Asset-class-aware (dev: Sales+Construction+Cumulative; income: PGI+NOI+CF After Debt) | ✅ MERGED |
| #263 | **PR-C** institutional-grade rebuild: standalone Amortization Schedule sheet — quarter-by-quarter table with Beginning Balance / Payment / Interest / Principal / Ending Balance + Loan Terms summary at the top. Live formulas drive 80 amortization rows (= 20-year cap), all referencing named ranges from the Inputs sheet | ✅ MERGED |
| #264 | docs: handoff for PRs #261-#263 (institutional-grade rebuild batch 1) | ✅ MERGED |
| #265 | **PR-G** institutional-grade rebuild: tornado chart on Dashboard — native Office horizontal bar with `overlap=100` and two oppositely-signed series. New driver-impact data table at H24:M26 feeds the chart with low-case + high-case deltas computed live from the 5×5 sensitivity grid. Visual parity with PPTX (#251) + DOCX (#252) tornadoes | ✅ MERGED |
| #266 | docs: handoff for PR #265 (tornado on Dashboard) | ✅ MERGED |
| #267 | **PR-B** institutional-grade rebuild: Permanent Debt Sizing sheet — computes lender-approved loan as MIN of four sub-limits (LTC / LTV / DCR / DY). Asset-class-aware: income uses MIN of all four with stabilised NOI, development uses LTC only. Amortization Schedule's Loan Amount now references Debt Sizing!B28 | ✅ MERGED |
| #268 | **PR-D** institutional-grade rebuild: Sponsor / LP Waterfall sheet — 3-tier pour-over (LP pref + return of capital → promote split). 5 new named ranges (LPEquityPct, GPEquityPct, PrefReturnRate, PromoteLPPct, PromoteGPPct). Computes LP IRR, GP IRR, equity multiples via single-exit approximation | ✅ MERGED |
| #269 | **PR-E** institutional-grade rebuild: Unit Mix sheet — asset-class-aware unit-by-unit breakdown (residential = Studio/1BHK/2BHK/3BHK/4BHK; hospitality = key types; plotted = plot sizes; commercial/retail/industrial = floor types; mixed-use/raw-land = empty-state). Worksheet-only — operator plans the mix here, manually updates SaleableAreaSqft on Inputs to flow through. **CLOSES THE 7-PR ARC** | ✅ MERGED |

✅ Done · 🟡 Partial / open · 🔴 Not started · ⏸ On hold

**Status by format** (updated 2026-05-17):

- **PPTX** ✅ feature-complete + cross-product AI briefing (PR-NX18): editorial palette, asset-class cover artwork, score gauge, Decision Frame, content-rich dividers, density on every slide, Pros & Cons, Key Assumptions appendix, Disclaimer rebuild, Google Maps embed, AI-Assisted Briefing slide.
- **XLSX** ✅ feature-complete + India localization I1–I16 + market-benchmark validators (PR-NX28 dev-side, PR-NX33 income-side DSCR / YoC) + cross-product AI briefing tab (PR-NX12) + auto-fill apply-extractions endpoint (PR-NX25) + chart fault tolerance (PR-NX24): 4 visible sheets + hidden Calculations sheet, named ranges, locked formulas, native IRR/NPV/sensitivity, Bull/Base/Bear scenarios, native chart objects (doughnut + clustered-column + combo + tornado), full India-localized cost lines (GST + Stamp Duty + Registration + RERA escrow + JDA structures + BBMP UAV property tax + Carpet/SBA loading factor + Lender ecosystem + Taxation block + Khata A/B + Premium FSI + Karnataka approvals + milestone escalation + asset-class-specific deep models for hospitality / retail / plotted / mixed-use / raw-land).
- **DOCX** ✅ **20 sections structurally complete** as of 2026-05-17 (PR-NX35/36/37):
  1. Cover · 2. Table of Contents · 3. AI-Assisted Briefing (PR-NX18) · 4. Executive Summary · 5. Site Information · 6. Overview · 7. Demographics · 8. Why This Area · 9. Job Growth & Micro-Market · 10. Social Infrastructure · 11. Supply & Demand Pipeline · 12. Comparable Transactions · 13. Better Alternatives · 14. Financials & KPIs · **15. Risk Register (PR-NX35)** · **16. Due Diligence Status (PR-NX35)** · **17. Approvals Tracker (PR-NX35)** · **18. Provenance & Source Register (PR-NX36)** · 19. Pros & Cons · 20. Overall Score · **21. Methodology & Assumptions (PR-NX37)** · 22. Disclaimer. AI-assisted vs Platform Data badges. SVG chart embeds (capital stack + cash flow trend + sensitivity tornado). `DOCX_REPORT_ENABLED=1` flipped in production 2026-05-17 — visible to all users.
- **Document ingestion** ✅ end-to-end (PR-NX25 ontology + apply-extractions backend, PR-NX26 modal frontend, PR-NX30 Overview discoverability card, PR-NX31 AuditTab event rendering): upload sale deed / EC / khata extract → Gemini extracts → operator reviews + approves → deal + property populated with full audit trail surfaced on Overview, Documents, and Audit tabs.
- **Paywall** ⏸ deferred per operator ("free for BETA testing").

✅ Done · 🟡 Partial / open · 🔴 Not started · ⏸ On hold

---

## Operator manual actions outstanding

- [x] ~~Apply migration `database/migrations/20260527_export_events.sql`~~ — applied 2026-05-17.
- [x] ~~Set `MAPBOX_TOKEN`~~ — replaced with Google Maps Static API.
  `GOOGLE_MAPS_API_KEY` is set in Vercel and **Maps Static API** is
  enabled in the Google Cloud project (operator confirmed via screenshot
  2026-05-10).
- [x] ~~Set `REDIP_PUBLIC_URL`~~ — cover QR removed per operator
  feedback; env var no longer used.
- [x] ~~Make XLSX v2 default~~ — flipped in PR #242. Operator can opt
  back to v1 via `?v=1` or `XLSX_V1_FORCE=1`.
- [x] ~~Flip `DOCX_REPORT_ENABLED=1` in Vercel~~ — done 2026-05-17; the
  DOCX underwriting report is now visible to all users.
- [ ] Payment provider — operator confirmed "free for BETA testing" so
  paywall PR is deferred indefinitely. Re-open this row when paid plans
  go live.

---

## Cross-cutting rules already enforced in code

- **English only** — `exportNarrative.service.js` rejects Devanagari,
  Kannada, Tamil, Telugu, Malayalam, Bengali, Gujarati, Gurmukhi, Oriya,
  Sinhala, Thai, Tibetan, Myanmar, Hiragana, Katakana, CJK, Hangul,
  Hebrew, Arabic, Syriac before content reaches an export.
- **No AI numeric output** — the narrative system prompt explicitly
  forbids specific figures. The deterministic financial kernel is the
  only source of numerics in any export.
- **Audit trail** — the `export_events` table records every export with
  format, ai_used, ai_cost_usd, generation_ms, byte_size, downloaded_at.
- **Palette consistency** — `shared/palette.js` is the single source of
  truth. No hex literals in `exports/**` (lint rule pending).
- **Disclaimer** — every AI-assisted block carries an explicit disclaimer
  pill / banner / cell-comment depending on the format.

---

## What's deferred (not in scope for any open PR)

- Paywall scaffold + payment provider integration (free for BETA per operator)
- Subscription / recurring billing model (Q3 revisit)
- Custom logo / tone toggle per-org (feature creep)
- Live "linked-data refresh" PPTX (impossible without external deps)
- International deals / multi-currency (REDIP is Bengaluru-first)
- Server-side chart rasterisation via `chartjs-node-canvas` (avoided to
  keep Vercel cold start fast; native pptxgenjs / ExcelJS charts are
  used instead). PR #252 added pure-SVG charts via `chartSvg.service.js`
  that work for PPTX + DOCX without any native deps; XLSX chart embeds
  would still need raster conversion (ExcelJS doesn't accept SVG via
  addImage) — re-open if operator decides to take the cold-start hit.
- DOCX cover artwork as native shapes (the docx library lacks the same
  shape primitives as pptxgenjs; current DOCX cover is editorial
  typography + score-gauge would require a different image-generation
  path. Low-priority — DOCX is a written report, not a presentation).
- **Kernel-side percent normalisation in `financial.service.js` and
  `packages/financial-kernel/`.** Investigated 2026-05-11 — kernel uses
  MIXED conventions per-input: most percent fields are integer-form
  (e.g. `marketingCostPct = 5` for 5%, kernel does `/100` internally),
  but some are decimal-form (`constLoanLTC = 0.55`, kernel uses raw).
  A blanket normalizer would break decimal-form fields; per-field
  convention audit + migration of mis-stored deal data + frontend
  coordination required. The export-write-layer fix in PR #250 already
  covers the surfaced symptom (Excel `0.0%` cells render as 5% not
  500% even when kernel hands us 5). Re-open when operator wants the
  full upstream cleanup.
- **Multi-driver tornado** (occupancy, debt rate, escalation, exit
  cap). PR #251 + #252 ship a 2-driver tornado (selling rate +
  construction cost) extracted from the existing 2D sensitivity matrix.
  A 1D sensitivity per individual driver would let the tornado span
  5+ drivers — needs kernel work to emit per-driver curves.
