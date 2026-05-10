# Exports rewrite — status tracker

_Source plan: `~/.claude/plans/lets-work-on-exports-harmonic-backus.md`._
_Last updated: 2026-05-10. Update at the bottom of each session._

This file tracks the multi-PR investor-grade exports rebuild so future
sessions can pick up where the last left off without re-reading the chat.

---

## Status table

| PR | Scope | State |
|---|---|---|
| #225 | Foundation: palette, Mapbox client, QR, SVG gauge, Gemini narrative, deal score, export-events migration | ✅ MERGED 2026-05-10 |
| #226 | PPTX: editorial palette swap + cover QR + cover score gauge + Pros & Cons slide | 🟡 OPEN — awaiting CI |
| TBD  | PPTX phase 2: native pptxgenjs charts on financial slides (sources/uses, cash flow bars, sensitivity heatmap, IRR tornado, cost / revenue stacks); comp scatter chart on Market Positioning; site map embed via Mapbox; Key Assumptions & Sources appendix slide | 🔴 NOT STARTED |
| TBD  | XLSX rewrite: 4 visible sheets (Inputs & Assumptions, Construction Phasing & Sales Collection, Quarterly Cash Flow & Debt, Dashboard) + 1 hidden Calculations sheet; named ranges, locked formulas, native Excel charts on Dashboard, conditional formatting on DSCR/IRR/margin, project-duration-driven quarter count | 🔴 NOT STARTED |
| TBD  | DOCX underwriting report (paid product, generator first, paywall later): 16 sections per the brief; gated behind `DOCX_REPORT_ENABLED` feature flag; admin override; never throws; English-only enforced | 🔴 NOT STARTED |
| TBD  | Pricing doc + paywall scaffold: ✅ `docs/PRICING.md` shipped this PR · `deal_export_purchases` table migration · DOCX endpoint paid-record check · payment provider integration deferred until operator picks Razorpay vs Stripe | 🟡 PARTIAL — pricing doc landed |

✅ Done · 🟡 Partial / open · 🔴 Not started · ⏸ On hold

---

## Operator manual actions outstanding

- [ ] Apply migration `database/migrations/20260527_export_events.sql` via
  Supabase SQL Editor on Mumbai.
- [ ] Set `MAPBOX_TOKEN` env var in Vercel before the PPTX phase-2 PR ships
  (otherwise `staticMap` calls bail gracefully and maps are skipped).
- [ ] Set `REDIP_PUBLIC_URL` env var in Vercel if it differs from
  `https://redip.vercel.app` (this is what the cover QR encodes).
- [ ] Decide payment provider (Razorpay vs Stripe) before paywall PR
  starts. Razorpay is the obvious default for the Indian market.

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

- Subscription / recurring billing model (Q3 revisit)
- Custom logo / tone toggle per-org (feature creep)
- Live "linked-data refresh" PPTX (impossible without external deps; the
  cover QR + REDIP link covers the live-state need)
- International deals / multi-currency (REDIP is Bengaluru-first)
- Server-side chart rasterisation via `chartjs-node-canvas` (avoided to
  keep Vercel cold start fast; native pptxgenjs / ExcelJS charts are
  used instead)
