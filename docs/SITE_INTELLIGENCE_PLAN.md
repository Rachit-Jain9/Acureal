# Site Intelligence — architecture & roadmap

Status as of 2026-06-29. The **Crawl** tier shipped (PRs #902, #903, #904). This doc is the canonical reference for what exists and what's next — extend it, don't rebuild.

## Thesis

Turn a parcel + regulatory envelope into an **investable development programme**, deterministically, inside the deal — then push it into underwriting. Not "AI floor plans" (Maket); closer to TestFit / Forma / Archistar with a capital-markets layer. The pattern every serious incumbent actually uses is a **deterministic parametric solver, not an LLM** — which maps exactly onto REDIP's "no LLM for math" hard rule. AI may only **propose** the editable assumptions and **explain** the result.

## What shipped (Crawl)

| Piece | Where | Notes |
|---|---|---|
| Site-yield engine | `backend/src/utils/siteYield.js` + `frontend/src/utils/siteYield.js` (parity-tested) | Pure deterministic. Envelope + assumptions → realized GFA, binding constraint, area schedule, unit/key/plot counts, parking. Emits `programme` + `buildability` for the underwriting bridge. |
| Underwriting bridge fix | `frontend/src/utils/programmeToInputs.js` | Switch now uses canonical asset-class vocabulary; branches align to the engine's families. |
| Site Intelligence tab | `frontend/src/components/deal/SiteIntelligenceTab.jsx` | New deal tab between Parcel and Zoning. Live generate-then-edit cockpit; one-click Apply to Financials. |
| AI cost-leak guard | `backend/src/services/ai/aiRouter.js` (`isModelPriced`, `cost_unpriced`) | Unknown-model spend can no longer silently bypass the daily cap. |

### Engine contract (load-bearing)
- Emit **drivers** (`effective_fsi`, `avg unit size`, `leasable`, `keys`) — the financial kernel derives GFA from FSI itself (`packages/financial-kernel/src/assets/residential.ts:87`). Never feed a pre-computed GFA into the kernel, or one deal carries two disagreeing GFA numbers.
- `programmeToInputs.js` is the live consumer (ZoningTab "Apply to underwriting" intent + FinancialsPage prefill). Complete its producer; don't bypass it.
- Every ratio (loading, efficiency, parking norm, unit mix, plot size, saleable-land %) is an overridable screening default, tagged `default` vs `assumption`, never asserted as statutory fact. Parking norms flagged "verify against RMP 2015".

### Architecture decision
Used the **mirrored-JS-util + parity-test** pattern (`parcelBuildability.js`, `buildEnvelope.js`), NOT a new `packages/site-yield-engine` TS package. Rationale: lighter, zero new build/publish wiring, lets the frontend compute live for the cinematic recompute loop, and matches the codebase idiom. Revisit only if the engine needs type-level isolation or backend-only consumers multiply.

## Roadmap — Walk

The honest file-capability model is **store → preview → parse → underwrite**, shown per file in the UI (a DWG that's only stored must not look validated).

1. **Universal ingestion (native, in-request, under a hard size ceiling):** CSV/TSV (`papaparse`), JSON/GeoJSON (`@turf/turf`), KML/KMZ (`@tmcw/togeojson` + `jszip` + XXE-safe `@xmldom/xmldom`), small Shapefile (`shpjs`). Magic-byte validation where a signature exists; CSV validated structurally; zip-bomb + XXE guards.
2. **Schema:** `file_assets` (format, checksum, `capability_status`, `parse_status`), `extraction_jobs` (durable queue drained by a Vercel cron at `/api/jobs/drain` — serverless-safe, no long-lived worker), `parcel_geometries` (PostGIS `geometry(MultiPolygon,4326)` + GiST), `site_plans` / `plan_options` / `area_schedule_lines` / `field_citations`. All org-scoped + FORCE RLS.
3. **Boundary capture:** draw a polygon on the Leaflet map / upload (.kml/.geojson/.shp/.dxf); reconcile typed area vs geometry area with an honest delta chip; CRS stored 4326, transformed to a metric projection (UTM 43N) for any setback/area math — never metre offsets on raw lat/lng. Clipper for mitered setbacks (turf's negative buffer is round-joined).
4. **Extraction excellence (eval harness FIRST):** 50–100 labelled Bengaluru docs + field-level precision/recall on the `abEvalHarness.service.js` spine; then bbox grounding (`field_citations`), native provider structured output (Gemini `responseSchema` / OpenAI `json_schema`), scoped real-confidence (replace fill-rate; multi-pass only on legal-four + high-stakes numerics), page-aware ingestion for long deed bundles, result cache by file hash.
5. **AI cost:** pin live provider prices into `DEFAULT_COSTS_PER_M_TOKENS` (operator-confirmed from consoles); Batch API for non-interactive jobs (~50% off); confidence-gated cheap-first cascade (gated by the harness); widen prompt/context caching to static catalogs.
6. **Tab v2:** interactive Konva massing (assume from the start for plotted/villa — hundreds of lots break SVG hit-testing), scenario compare, AI propose/explain layer.

## Roadmap — Run

- Managed CAD/BIM via **Autodesk APS Model Derivative** (DWG/RVT/SKP → async only; server-side WASM DWG is a serverless trap; `libredwg-web` client-side preview only; IFC OOMs a 1 GB function → async-offload only). DPDP-2023 redaction + short-TTL single-use signed URLs before any third-party egress.
- **Tier-gating** (Base/Pro/Enterprise): native GIS + site-yield v1 for all; DXF/XER Pro+; DWG/RVT/SKP conversion paid credits; per-org cost attribution prerequisite.
- Optional lazy Three.js 3D massing (operator-signed bundle); optional Docling/Document AI layout pre-pass only if the eval proves Gemini insufficient on Kannada-scan tables.

## Hard-rule guardrails (apply to every phase)
Deterministic-only math; legal-four (title / encumbrance / RERA status / statutory approval) stay extraction-aid with human-verify, never AI conclusions; verified-data-only for comps/market; immutable audit trail; quiet AI disclosure on customer exports; never fake a feed; lighter/faster/less-cluttered — prefer deletion over addition.

## Deliberately skipped
Floor-plan generation; deck.gl; MapLibre migration (deferred); framer-motion; new asset classes outside `constants/assetClasses.js`; broad multi-pass on every field; enterprise IDP contracts up front; self-hosted Indic OCR; fail-closed cost routing (future opt-in).
