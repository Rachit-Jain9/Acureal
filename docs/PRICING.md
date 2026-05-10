# REDIP Export Pricing — Decisions, Tiers, Rationale

_Last reviewed: 2026-05-10. Review when DOCX generator ships, when first paid
download lands, and at every quarter end. Owner: Rachit._

This file exists so we don't lose the pricing model between sessions. Every
number here is a **provisional anchor**, not a published list price. We
revise after the first 10 paid DOCX downloads ship and we have actual
willingness-to-pay signal.

---

## Free tier (acquisition funnel — never charged)

| Format | Why free |
|---|---|
| **PPTX** investor deck | Live deal teams need to share quickly; gating creates friction |
| **XLSX** four-sheet workbook | The financial model is the working artifact — gating it kills usage |
| **CSV** deals export | Operational data; no premium content |
| **CSV** comps export | Operational data; no premium content |
| **PDF** tear-sheet (existing) | Lightweight summary; never the deliverable an investor pays for |

The free tier is the funnel. Most users never hit the paid surface. That
is fine — adoption is the leading indicator.

---

## Paid tier — DOCX Underwriting Report

The DOCX is the only paid product for now. Three-tier structure, all in
INR.

### Tier 1 — Standard

- **Price**: ₹4,999 per deal per report
- **What's included**:
  - All 16 sections of the underwriting report (cover, exec summary, site
    info, overview, demographics, why-this-area, job growth, social infra,
    supply/demand, comps, financials, KPIs, pros/cons, score, alternatives,
    disclaimer)
  - Mapbox site map + comps map + infrastructure map (when data present)
  - Charts: cost stack, revenue stack, sources/uses doughnut, IRR tornado
  - Composite score (0–100 deterministic) with weights breakdown
  - AI-assisted prose (Why this area, Pros & Cons, demographic synthesis)
    — clearly labelled "AI-Assisted"
  - Claude IC opinion (proceed / conditions / pass)
- **Marked**: "AI-assisted draft — requires human review" prominently on
  cover and footer of every page
- **Generation time**: < 30 s typical
- **Cost to us**: ~$0.10 in AI calls + Mapbox tile (~$0.001) + storage
  (negligible) → ~₹10 hard cost. Margin ~99% pre-support.
- **Refund policy**: full refund within 24h if generation fails or report
  is materially incomplete (i.e. > 3 sections show "Manual input required")

### Tier 2 — Premium

- **Price**: ₹14,999 per deal per report
- **What's included**:
  - Everything in Standard
  - REDIP-curated comp set: a REDIP analyst hand-picks the 8–10 most
    relevant verified comps for this exact micro-market and asset class
    (replaces auto-selected comps)
  - Analyst risk overlay: a senior analyst reads the auto-generated risk
    register and adds 2–3 hand-written risk paragraphs with specific
    mitigation steps
  - One-week turnaround (vs. instant for Standard)
- **Cost to us**: ~₹600 analyst time (~30 min @ ₹1,200/hr) + AI cost.
  Margin ~95%.
- **When to recommend**: deal size > ₹50 Cr, or asset class outside our
  core comp coverage (e.g. hospitality, redevelopment), or sponsor
  explicitly asks for analyst-vetted output

### Tier 3 — Enterprise

- **Price**: ₹49,999+ per deal per report (custom)
- **What's included**:
  - Everything in Premium
  - On-ground DD verification by REDIP field team (Bengaluru only for
    MVP): site visit, anchor tenant interviews, comp vetting in person,
    title verification cross-check at Bhoomi / Kaveri portal
  - 2–3 week turnaround
- **Cost to us**: ~₹15,000 field team + travel + ₹600 analyst.
  Margin ~70%.
- **When to recommend**: deal size > ₹200 Cr; first transaction in a new
  micro-market for the sponsor; or a fund's IC explicitly requires
  third-party verification

---

## Pricing rationale

### Why ₹4,999 for Standard?

- **Comparable bench**: independent boutique advisor reports for similar
  Bengaluru CRE deals run ₹50K–₹2L. We are not selling that — we are
  selling a **sophisticated draft** the user can iterate on. Pricing at
  10% of advisor cost signals "draft" without giving it away.
- **Psychological anchor**: ₹4,999 sits below the ₹5,000 mental
  threshold (same trick as ₹999 vs ₹1,000). Internal expensing under
  ₹5,000 is usually self-approved at the analyst level in Indian PE /
  family offices, which keeps friction low.
- **Margin**: ~99% gross. Even at 10% conversion of free users we cover
  AI costs many times over.
- **Test signal**: if conversion < 1% at this price, we are **not
  underpriced** — we have a product problem (the report isn't useful
  enough). Don't drop price; fix the report first.

### Why three tiers?

The standard / premium / enterprise structure mirrors how the buyers
actually consume this. Self-serve analyst → wants the cheap fast version.
IC member → wants analyst-vetted depth. Fund → wants an audit trail with
on-ground verification. One price doesn't cover all three.

### Annual subscription model

**Deferred until Q3 2026.** Open question: do power users want unlimited
DOCX downloads at ₹49,999/year (~10 reports/yr break-even)? Need actual
download data first. Revisit after 30 paid downloads land.

### Promotions / discounts

- **First-deal free** for new orgs: yes, on Standard tier only. Cap one
  per org-id.
- **Bulk discount** at > 10 reports/quarter: yes, sliding scale to
  ₹2,999 each. Negotiate per account.
- **Refer-a-fund**: 50% off the next report for both referrer and
  referee. Cap once per pair.

---

## Operational notes

- Currency: INR only at MVP. USD pricing for international users
  deferred — REDIP is Bengaluru-first per CLAUDE.md.
- GST: 18% added at checkout for Indian buyers. Display price excludes
  GST (industry convention).
- Payment provider: TBD (Razorpay vs Stripe). Razorpay is the obvious
  default for the Indian market; Stripe makes sense if we expand
  international. Decision deferred until first paid download is in
  reach.
- Receipts: emailed on successful payment, with a PDF copy of the
  generated DOCX attached.
- Failure handling: if generation fails after payment, automatic refund
  within 24 h triggered by the export-events audit log (failed row →
  refund webhook).

---

## What this file is NOT

- Not a published price list — that lives on the marketing site once
  prices are validated.
- Not a contract — the actual T&Cs live in the legal/terms doc.
- Not load-bearing in code — pricing logic is read from a config or
  database when paywall scaffold lands; this file is the source-of-truth
  for the human decision.

When paywall infrastructure ships (planned PR follow-up after the DOCX
generator), it reads from a `pricing_config` table seeded from this file.
Changes to prices touch the table, not this file. This file documents
the **why**.
