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
