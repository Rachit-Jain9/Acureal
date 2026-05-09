# TODO_DATA — External Data Sources Required

Data sources that REDIP would benefit from but cannot fabricate or assume availability of.

## Status legend
- BLOCKED: No usable API or open dataset exists
- MANUAL: Can be entered manually or via document upload
- PARTIAL: Some data available via OSM or open sources
- READY: Architecture exists, needs configuration

---

## Geospatial / Parcel Data

### Lake, drain, and rajakaluve buffers (Bengaluru)
- Status: BLOCKED (no public API)
- Source needed: BWSSB, BBMP GIS, Lakes Authority of Karnataka
- Workaround: Manual overlay upload as GeoJSON; spatial check via Turf.js once uploaded
- Architecture: ZoningRuleSet with buffer geometry, Turf.js intersection engine
- Also needed: heritage, ecology, airport-height, and road-widening overlay datasets — same approach

### BBMP/BDA master plan zones (Bengaluru)
- Status: MANUAL
- Source: BBMP/BDA website (PDFs + scanned maps), Revised Master Plan 2031
- Workaround: Upload PDFs → Gemini extraction → structured rules in zoning_rule_sets table
- Architecture: Ready
- Requirements: upload versioned documents only; separate live/gazetted rules from draft or consultation; record authority metadata, effective dates, and source-document references for every rule set; keep approximate outputs clearly labeled until parcel geometries are verified

### Parcel polygons (survey-level geometry)
- Status: BLOCKED
- Source needed: Karnataka Survey & Settlement Dept, Dishaank portal
- Workaround: User-uploaded GeoJSON or manual coordinate input
- Note: Never fabricate parcel boundaries

### Road network and widths
- Status: PARTIAL (OSM has reasonable road data)
- Source: OpenStreetMap via Overpass API
- Architecture: GeocodeService + Overpass adapter (not yet built)

---

## Title, Registry, and Legal

### Encumbrance Certificate (EC) live lookup
- Status: BLOCKED
- Source: Kaveri Online Services (Karnataka registry)
- Workaround: PDF upload → Gemini extraction
- Note: Kaveri does not have a public API. Do not imply live registry connectivity until a lawful, stable source is available.

### RTC / Pahani live fetch
- Status: BLOCKED
- Source: Bhoomi portal (Karnataka)
- Workaround: PDF/screenshot upload → Gemini extraction

### Property mutation records
- Status: BLOCKED
- Source: BBMP / Sub-Registrar
- Workaround: Document upload and extraction

---

## Market / Comps Data

### Transaction-level price data
- Status: BLOCKED (no free API)
- Source: Karnataka IGR, property registration data
- Workaround: Manual comps entry, broker quote uploads, report uploads
- Architecture: Comps table with confidence weighting (ready)

### Rental market data (Bengaluru)
- Status: MANUAL
- Source: JLL, Knight Frank, CBRE, PropEquity (paid reports)
- Workaround: Upload broker/IPC reports → Gemini extraction into comps

### REIT / Listed entity disclosures
- Status: MANUAL
- Source: Exchange filings, SEBI disclosures
- Workaround: Manual entry or PDF upload

### Market intelligence / comps refresh
- Refresh Bengaluru comps with real transaction evidence, broker evidence, and dated report extracts.
- Add weighting inputs for confidence, recency, and source quality.
- Keep internal seeded benchmarks under explicit provenance notes.

### Asset classes from Q1 2026 v0.2 rate-pack — schema + data RESOLVED
- Status: RESOLVED — schema (`residential_segmented_benchmarks`) and data (67 rows) shipped in PR #166.
- Source: REDIP-COMPS folder (`redip_bengaluru_micro_market_rates_v0_2_2026Q1.json`); MagicBricks / Housing.com listings + IGR Karnataka.
- Five asset classes loaded:
  - **Builder floor apartments** (7 rows) — capital-value benchmarks per micro-market.
  - **Plotted development / residential plot** (18 rows) — plot asking value INR/sqft per micro-market.
  - **Land - residential plotted** (18 rows) — derived land value INR mn/acre via `INR/sqyd / 9 * 43,560 / 1,000,000`.
  - **Residential house / villa** (13 rows) — independent house asking capital value per micro-market.
  - **Guidance value / circle rate** (11 rows) — placeholder SRO rows pending IGR Karnataka PDF extraction.
- Schema chosen: consolidated table with `asset_class`, `metric`, `unit`, `value_low/high/avg` columns. RLS-scoped to organization; composite unique key on (org, city, micro_market, asset_class, metric, data_type) for idempotent re-runs.
- UI: Section 5e on `/intelligence` renders the table with asset-class chip filter and per-row data-layer badge — honoring the methodology rule that listing / IPC / guidance / internal layers must be visually distinct, not silently blended.

### Pending: Karnataka IGR guidance-value SRO PDF extraction
- Status: DEFERRED — operator (Rachit) confirmed 2026-05-09 they'll upload sample PDFs later. Until then, placeholder rows continue in `residential_segmented_benchmarks` for 11 Bengaluru SROs (Devanahalli, Gandhinagar, Hebbal, Hoskote, Indiranagar, Jayanagar, KR Puram, Mahadevapura, Malleshwaram, Varthur, Yelahanka) tagged `guidance_q1_2026_v0_2_pending`.
- Source needed: Karnataka IGR Revised Guidance Value PDF table per SRO.
  - Path: `https://igr.karnataka.gov.in/english` → top nav → **Revised Guidelines Value** → district selector (Bengaluru Urban / Bengaluru Rural) → SRO list → click any SRO for PDF download.
  - **Note**: this is the IGR registration/stamp-duty rate — distinct from BBMP UAV property-tax PDFs (which extraction prompt `bbmp_uav_pdf` already handles separately).
- Workaround on receipt: Drop the PDF in chat → existing `igr_guidance_pdf` Gemini doctype (`backend/src/services/ai/extractionPrompts.js`) handles extraction → results populate the 11 placeholder rows above + flip to `is_verified=TRUE`.
- Note: Do NOT infer guidance value from listing prices — they're legally distinct floors set by the state. Methodology footnote in TODO is explicit.
- **Once one Bengaluru SRO PDF lands, the rest is mechanical** — the same extractor handles every SRO; only the file changes. Cost ~$0.05 per SRO via Gemini.

---

## Regulatory / Approval Status

### RERA registration verification (Karnataka)
- Status: BLOCKED
- Source: K-RERA portal (rera.karnataka.gov.in)
- Workaround: Manual RERA number entry + document upload
- Note: K-RERA has no stable public API. Do not present auto-verified RERA status until a compliant retrieval path exists.

### BBMP/BDA building plan approval status
- Status: BLOCKED
- Workaround: Upload approval letters + extraction

### Khata / Revenue records
- Status: BLOCKED (Bhoomi, BBMP portals)
- Workaround: Upload relevant documents

---

## Notes
- All data gaps above are handled via the document upload + Gemini extraction pipeline
- No government data is fabricated anywhere in the codebase
- New data sources can be added via adapter pattern in `backend/src/services/ai/`
- Review retention policy for uploaded title, identity, and transaction documents before expanding shared access
