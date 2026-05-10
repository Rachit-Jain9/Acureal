# Exports rewrite — status tracker

_Source plan: `~/.claude/plans/lets-work-on-exports-harmonic-backus.md`._
_Last updated: 2026-05-10 (late session). Update at the bottom of each session._

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

✅ Done · 🟡 Partial / open · 🔴 Not started · ⏸ On hold

**Status by format**:
- **PPTX** ✅ feature-complete: editorial palette, asset-class cover artwork, score gauge, Decision Frame, content-rich dividers, density on every slide, Pros & Cons, Key Assumptions appendix, Disclaimer rebuild, Google Maps embed.
- **XLSX** ✅ feature-complete: 4 visible sheets + hidden Calculations sheet, named ranges, locked formulas, conditional formatting on DSCR/IRR/margin, native IRR/NPV functions, sensitivity heatmap, Bull/Base/Bear scenarios, sources/uses doughnut. v2 is now the default.
- **DOCX** ✅ feature-complete: ~14 sections including all 6 phase-2 sections (Demographics, Why-this-area, Job Growth, Social Infra, Supply & Demand, Better Alternatives). AI-assisted vs Platform Data badges. Behind `DOCX_REPORT_ENABLED` flag.
- **Paywall** ⏸ deferred per operator ("free for BETA testing").

✅ Done · 🟡 Partial / open · 🔴 Not started · ⏸ On hold

---

## Operator manual actions outstanding

- [ ] Apply migration `database/migrations/20260527_export_events.sql` via
  Supabase SQL Editor on Mumbai.
- [x] ~~Set `MAPBOX_TOKEN`~~ — replaced with Google Maps Static API.
  `GOOGLE_MAPS_API_KEY` is set in Vercel and **Maps Static API** is
  enabled in the Google Cloud project (operator confirmed via screenshot
  2026-05-10).
- [x] ~~Set `REDIP_PUBLIC_URL`~~ — cover QR removed per operator
  feedback; env var no longer used.
- [x] ~~Make XLSX v2 default~~ — flipped in PR #242. Operator can opt
  back to v1 via `?v=1` or `XLSX_V1_FORCE=1`.
- [ ] Operator can flip `DOCX_REPORT_ENABLED=1` in Vercel to expose the
  underwriting report to all users (currently admin-only).
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
  used instead)
- DOCX cover artwork as native shapes (the docx library lacks the same
  shape primitives as pptxgenjs; current DOCX cover is editorial
  typography + score-gauge would require a different image-generation
  path. Low-priority — DOCX is a written report, not a presentation).
