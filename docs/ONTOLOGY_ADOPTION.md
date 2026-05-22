# Ontology Adoption Plan — Workstream F

_Status: Phase 1 confirmed; Phases 2–3 SHIPPED (2026-05-22 — PRs NX135, NX136);
Phase 4 deferred. Operationalises Strategic Review §VI ("reconcile the
taxonomies")._

## TL;DR

`@redip/real-estate-ontology` (package, `v1.0.0`) is REDIP's canonical taxonomy —
asset classes, deal structures, exit strategies, zoning, ownership types, area /
pricing units, the extraction field map, and confidence bands. The **backend
already adopts it** for the extraction → deal write path. The **frontend does
not** — it keeps parallel hand-maintained copies. Asset classes are safe (a
contract test locks all three sources together). The other taxonomies are not,
and **deal structures genuinely diverge** — that gap needs one product decision
before code can close it.

This document is the plan. It is deliberately not yet implemented: forcing the
divergent taxonomies to agree without the decision below would either break the
deal-create validator or silently change a Postgres enum.

## Current state

### Adopted (backend)

The ontology is `require`d and used in the extraction pipeline:

- `backend/src/routes/deal.routes.js` — `apply-extractions` validates every
  `canonical_field` via `ontology.getExtractionField()` and coerces values via
  `ontology.validateAndCoerce()` (acres → sqft, ₹ → ₹Cr).
- `backend/src/services/dealApplyExtractions.service.js`,
  `extractionVerdicts.service.js`, `dealExport.service.js`,
  `exports/docx/buildReport.js` — all consume the ontology for field metadata
  and the ontology version stamp.

### Not adopted (frontend)

The frontend declares its own taxonomy copies and does **not** import the
ontology package at runtime:

| Taxonomy | Frontend source | Ontology source | Drift guard |
|---|---|---|---|
| Asset class | `frontend/src/utils/assetClasses.js` (10 keys) | `asset_class.values` (10 keys) | ✅ `assetClasses.contract.test.js` — locks FE ↔ BE ↔ ontology |
| Deal structure | `frontend/src/utils/dealStructures.js` (8 keys) | `deal_structure.values` (8 keys) | ✅ `dealStructures.contract.test.js` — locks FE ↔ BE ↔ ontology (Phase 2) |
| Zoning | `frontend/src/utils/zoning.js` (5 keys) | `zoning.values` (5 keys) | ✅ `zoning.contract.test.js` — locks FE ↔ BE ↔ ontology (Phase 3) |
| Ownership type | no frontend `<select>` found (free-text / backend-only) | `ownership_type.values` (6 keys) | n/a |
| Exit strategy | not surfaced as a frontend constant | `exit_strategy.by_family` (family-conditional) | n/a |

The ontology package **does resolve by name from frontend code** —
`assetClasses.contract.test.js` already does `import ontology from
'@redip/real-estate-ontology'` under Vitest. Whether the production **Vite
build** resolves the same specifier is unverified and is a Phase 1 check.

## The divergences in detail

### 1. Deal structures — a real taxonomy conflict (needs a decision)

- **Frontend `DEAL_STRUCTURE_CONFIG`** (8): `outright`, `jv`, `jda`,
  `revenue_share`, `area_share`, `profit_share`, `ground_lease`, `hybrid`.
- **Backend DB enum** — `domain.js` `DEAL_STRUCTURES` — is the **same 8 keys**,
  and the deal-create validator enforces `body('dealStructure').isIn(DEAL_STRUCTURES)`.
- **Ontology `deal_structure.values`** (4): `outright_purchase`,
  `jda_revenue_share`, `jda_area_share`, `development_management`.

These are not a label mismatch — they are different *concepts at different
granularity*. The product/operator-facing 8-key list (`jv` separate from `jda`,
`profit_share` separate from `revenue_share`) is what every live deal already
uses. The ontology's 4-key list is a tidier analytical grouping.

`dealStructures.js` itself records this as deferred work ("Strategic Review
§VI top-1 … migrate this file to read from the ontology package directly").

**This is a product decision and cannot be made unilaterally** — see below.

### 2. Zoning — the ontology was the inaccurate source (RESOLVED in Phase 3)

An earlier draft of this plan claimed the create-parcel form was "missing 6
valid zones". Verification against `database/schema.sql` showed the opposite:
the Postgres `zoning_type` enum has exactly **5** values (`residential`,
`commercial`, `mixed_use`, `industrial`, `agricultural`); `domain.js`
`ZONING_TYPES` and the form already matched it; and the **ontology** was the
outlier — it carried 11 RMP master-plan zone codes that the `properties.zoning`
/ `deals.zoning` enum does not accept (a write of `institutional` etc. would
fail). Phase 3 corrected the ontology down to the real 5 and contract-tested
all three sources. The detailed RMP 2031 zones live separately in
`master_plan_zones`.

## The product decision required

> **For Rachit:** Which deal-structure taxonomy is canonical — REDIP's existing
> **8-key** list (what every live deal uses, what the database enforces), or the
> ontology's tidier **4-key** list?
>
> **Recommendation: keep the 8-key list as canonical.** It is already in
> production, in the database enum, and in the deal-create flow; the 4-key list
> has no live data behind it. Adoption then means **bumping the ontology to
> `v2.json`** so its `deal_structure` matches the 8-key reality — a versioned,
> additive change, no database migration, no deal-data risk.
>
> The alternative (migrate the DB enum down to 4 keys) would require remapping
> every existing deal's structure and a Postgres enum migration — high risk for
> no product gain. Not recommended.

Once decided, Phase 2 below can proceed.

## Phased adoption plan

Each phase is independently shippable and ordered by risk (lowest first).

### Phase 1 — make the frontend a true ontology consumer _(low risk)_

- Confirm `@redip/real-estate-ontology` resolves in the **Vite production
  build** (it already resolves under Vitest). If not, add a Vite `resolve.alias`
  or a workspace dependency entry.
- No behaviour change yet — this phase only proves the wiring.

### Phase 2 — reconcile + adopt deal structures — ✅ SHIPPED (PR-NX135)

- Per the decision: bump the ontology to `v2.json` with the 8-key
  `deal_structure`, add a `getDealStructuresV2()` loader (the package versioning
  contract — old callers stay on v1).
- Repoint `frontend/src/utils/dealStructures.js` to derive from the ontology.
- Add `dealStructures.contract.test.js` — the `assetClasses` pattern — locking
  FE ↔ `domain.js` ↔ ontology so the taxonomy can never silently drift again.

### Phase 3 — route the remaining taxonomies through the ontology — ✅ SHIPPED (PR-NX136)

- Zoning: corrected the ontology's `zoning` list (11 → the real 5-value
  `zoning_type` enum); the `ParcelTab` create-form `<select>` now renders from
  a shared `frontend/src/utils/zoning.js` config; `zoning.contract.test.js`
  locks FE ↔ BE ↔ ontology.
- Ownership type, exit strategy: audited — neither is surfaced as a frontend
  picker (ownership is a free-text column; exit strategy has no frontend
  list), so there is nothing to route. The ontology keeps them as reference
  taxonomies.

### Phase 4 — single-source the extraction field map _(deferred)_

- The frontend `ProvenanceChip` / auto-fill UI references extraction-field
  metadata. Once Phase 1 lands, these can read `ontology.getExtractionField()`
  directly instead of any local mirror.

## Risks & sequencing rationale

- The ontology underpins **deterministic unit conversions** (acres → sqft,
  ₹ → ₹Cr) that feed the financial kernel. CLAUDE.md forbids LLM math here and
  the kernel must stay deterministic — so ontology changes are treated as
  kernel-adjacent: versioned (`v1.json` → `v2.json`, never edited in place),
  contract-tested, and shipped one taxonomy at a time.
- Phases 1 and 3 carry no data risk and can ship immediately.
- Phase 2 is gated **only** on the operator's deal-structure decision — not on
  engineering capacity.
