'use strict';

const crypto = require('crypto');
const { z } = require('zod');
const { IMPORT_COLUMNS_BY_KIND } = require('../../constants/rentRollImportColumns');

/**
 * Gemini extraction + classification prompts, keyed by `doc_type`.
 *
 * Why this lives in its own file:
 *   - `extraction.service.js` was 1,168 LOC; ~460 of those were prompt
 *     strings. Pulling them out leaves the orchestrator at a tractable
 *     size and makes prompt tuning a one-file diff (clean PR review,
 *     simple A/B branches, easy to grep for "what does the title-deed
 *     prompt look like today").
 *   - Per CLAUDE.md AI routing: Gemini does extraction, never math. These
 *     are extraction prompts only — no calculation, no inference beyond
 *     "what does the document literally say." When in doubt, every prompt
 *     instructs `Return ONLY the JSON. No commentary.` so the consumer
 *     parses cleanly.
 *
 * Adding a new doc_type:
 *   1. Add a key here with the JSON shape you want back.
 *   2. Add the same key to `CLASSIFY_PROMPT` so the classifier knows it
 *      exists.
 *   3. If the doctype needs custom post-processing, wire it in
 *      `evidenceIngestion.service.js`. If it's a simple field grab, the
 *      generic path through `extraction.service.js::extractDocument` is
 *      enough.
 *   4. Bump `PROMPT_REGISTRY_VERSION` below to `YYYY-MM-DD.<n>`.
 *
 * Versioning:
 *   - `PROMPT_REGISTRY_VERSION` is bumped manually whenever ANY prompt in
 *     this file changes. The version + per-prompt sha256 ride into
 *     `ai_call_logs.metadata` so an extraction can always be replayed
 *     against the prompt that produced it. They also key the response
 *     cache so a prompt change naturally invalidates prior cached
 *     extractions.
 *   - Hashes are computed once at module load via `sha256`.
 *
 * The `KNOWN_DOC_TYPES` set is built from `Object.keys(GEMINI_EXTRACTION_PROMPTS)`
 * by the consumer; don't duplicate that list here.
 */

// Bump whenever any prompt body or CLASSIFY_PROMPT changes. The format is
// YYYY-MM-DD.<seq>; the seq lets us bump twice in one day if needed.
const PROMPT_REGISTRY_VERSION = '2026-07-16.2';

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Multilingual reading contract, appended to EVERY extraction prompt.
 *
 * Karnataka land records are routinely Kannada-only (RTC/Pahani, mutation
 * extracts, older sale deeds), Hindi appears on central-government and
 * bank paperwork, and most deal packs mix scripts inside a single page.
 * Gemini reads all three natively, but nothing in the prompts ever SAID what
 * to do with them: field values came back in whatever script the document
 * used, so downstream matching, comps, and exports saw mixed-script values.
 *
 * The contract: read every script; return field VALUES in English; keep the
 * original script alongside for proper nouns (never silently replace a name
 * with a transliteration — the reviewer must be able to check it against the
 * document); never translate identifiers. Extraction only — no legal reading
 * of any kind, matching the AI carve-out on the legal four.
 */
const MULTILINGUAL_RULES = `

LANGUAGE HANDLING (applies to every field above):
- This document may be in Kannada, Hindi, English, or any mix of them, including handwritten or stamped text. Read ALL scripts present. Never skip a section because it is not in English.
- Return field VALUES in English. Transliterate proper nouns (person names, village names, taluk, hobli, district) to Latin script.
- For any proper noun or free-text value you transliterated or translated, also return the ORIGINAL text exactly as printed, in the same object, under the same key with the suffix "_original" (e.g. "owner_name": "Ramesh Kumar", "owner_name_original": "ರಮೇಶ್ ಕುಮಾರ್"). If the value was already in English, omit the _original key.
- NEVER translate or transliterate identifiers: survey numbers, khata numbers, document/registration numbers, PIDs, RERA numbers, dates, and amounts stay exactly as printed. Convert Kannada/Devanagari NUMERALS to Western Arabic digits (೧೨೩ → 123, १२३ → 123).
- Add "detected_languages": ["kn"|"hi"|"en", ...] listing every language you actually saw in the document.
- If a passage is illegible or you cannot read the script confidently, set the affected field to null and say so in the verification/notes field. Do not guess.`;

/** Append the multilingual contract to a prompt body. */
const withMultilingualRules = (body) => `${body}${MULTILINGUAL_RULES}`;

const GEMINI_EXTRACTION_PROMPTS = {
  title_deed: `You are a legal document extraction assistant specialised in Indian real estate.
Extract all key information from this Title Deed / Registered Sale Deed.
Return a JSON object with:
{
  "grantor": "name of seller / transferor",
  "grantee": "name of buyer / transferee",
  "property_description": "full property description as in deed",
  "survey_numbers": ["list of survey/plot numbers"],
  "area_sqft": null,
  "area_acres": null,
  "locality": "",
  "taluk": "",
  "district": "",
  "state": "",
  "consideration_inr": null,
  "registration_date": "YYYY-MM-DD or null",
  "document_number": "",
  "sub_registrar_office": "",
  "encumbrances_mentioned": [],
  "conditions_covenants": []
}
Return ONLY the JSON. No commentary.`,

  mother_deed: `You are a legal document extraction assistant specialised in Indian real estate.
Extract all key information from this Mother Deed / Parent Deed.
Return a JSON object with:
{
  "original_owner": "",
  "chain_of_title": [{"grantor": "", "grantee": "", "date": "", "document_number": ""}],
  "property_description": "",
  "survey_numbers": [],
  "area_sqft": null,
  "area_acres": null,
  "locality": "",
  "taluk": "",
  "district": "",
  "registration_date": "YYYY-MM-DD or null"
}
Return ONLY the JSON. No commentary.`,

  sale_deed: `You are a legal document extraction assistant specialised in Indian real estate.
Extract all key information from this Sale Deed.
Return a JSON object with:
{
  "grantor": "",
  "grantee": "",
  "property_description": "",
  "survey_numbers": [],
  "area_sqft": null,
  "area_acres": null,
  "locality": "",
  "taluk": "",
  "district": "",
  "state": "",
  "consideration_inr": null,
  "stamp_duty_inr": null,
  "registration_fee_inr": null,
  "registration_date": "YYYY-MM-DD or null",
  "document_number": "",
  "sub_registrar_office": "",
  "witnesses": [],
  "encumbrances_mentioned": []
}
Return ONLY the JSON. No commentary.`,

  ec: `You are a legal document extraction assistant specialised in Indian real estate.
Extract all information from this Encumbrance Certificate (EC).
Return a JSON object with:
{
  "property_details": {
    "address": "",
    "survey_number": "",
    "taluk": "",
    "district": ""
  },
  "period_from": "YYYY-MM-DD or null",
  "period_to": "YYYY-MM-DD or null",
  "nil_encumbrance": false,
  "transactions": [
    {
      "serial_number": "",
      "date": "YYYY-MM-DD or null",
      "document_number": "",
      "nature_of_instrument": "",
      "party_1": "",
      "party_2": "",
      "consideration_value_inr": null,
      "charge_description": ""
    }
  ],
  "outstanding_liabilities": []
}
Return ONLY the JSON. No commentary.`,

  rtc_pahani: `You are a legal document extraction assistant specialised in Indian real estate.
Extract all information from this RTC / Pahani (Record of Rights, Tenancy and Crops).
Return a JSON object with:
{
  "survey_number": "",
  "hissa_number": "",
  "total_area_acres": null,
  "village": "",
  "hobli": "",
  "taluk": "",
  "district": "",
  "owner_name": "",
  "owner_address": "",
  "nature_of_land": "",
  "water_source": "",
  "soil_type": "",
  "current_occupant": "",
  "crop_details": [],
  "encumbrances": [],
  "remarks": ""
}
Return ONLY the JSON. No commentary.`,

  mutation: `You are a legal document extraction assistant specialised in Indian real estate.
Extract all information from this Mutation Register / Patta Transfer document.
Return a JSON object with:
{
  "mutation_number": "",
  "previous_owner": "",
  "new_owner": "",
  "reason_for_mutation": "",
  "survey_number": "",
  "area_acres": null,
  "village": "",
  "taluk": "",
  "district": "",
  "mutation_date": "YYYY-MM-DD or null",
  "order_by": ""
}
Return ONLY the JSON. No commentary.`,

  conversion_certificate: `You are a legal document extraction assistant specialised in Indian real estate.
Extract all information from this Conversion Certificate (DC Conversion / Section 95 Conversion).
Return a JSON object with:
{
  "order_number": "",
  "order_date": "YYYY-MM-DD or null",
  "applicant_name": "",
  "survey_numbers": [],
  "total_area_acres": null,
  "village": "",
  "taluk": "",
  "district": "",
  "converted_from": "e.g. agricultural",
  "converted_to": "e.g. residential/commercial",
  "conditions": [],
  "issuing_authority": "",
  "valid_until": "YYYY-MM-DD or null"
}
Return ONLY the JSON. No commentary.`,

  khata: `You are a legal document extraction assistant specialised in Indian real estate.
Extract all information from this Khata Certificate and/or Khata Extract.
Return a JSON object with:
{
  "khata_number": "",
  "pid_number": "",
  "owner_name": "",
  "owner_address": "",
  "property_address": "",
  "site_area_sqft": null,
  "built_up_area_sqft": null,
  "ward_number": "",
  "zone": "",
  "municipal_body": "",
  "issue_date": "YYYY-MM-DD or null",
  "property_tax_assessment_year": "",
  "annual_property_tax_inr": null
}
Return ONLY the JSON. No commentary.`,

  layout_approval: `You are a legal document extraction assistant specialised in Indian real estate.
Extract all information from this Layout Plan Approval document.
Return a JSON object with:
{
  "approval_number": "",
  "approval_date": "YYYY-MM-DD or null",
  "applicant_name": "",
  "layout_name": "",
  "survey_numbers": [],
  "total_area_acres": null,
  "number_of_plots": null,
  "road_area_sqft": null,
  "park_area_sqft": null,
  "ca_site_area_sqft": null,
  "village": "",
  "taluk": "",
  "district": "",
  "issuing_authority": "",
  "conditions": [],
  "validity": ""
}
Return ONLY the JSON. No commentary.`,

  sanctioned_plan: `You are a legal document extraction assistant specialised in Indian real estate.
Extract all information from this Sanctioned / Approved Building Plan.
Return a JSON object with:
{
  "plan_number": "",
  "sanction_date": "YYYY-MM-DD or null",
  "applicant_name": "",
  "property_address": "",
  "plot_area_sqft": null,
  "number_of_floors": null,
  "total_built_up_area_sqft": null,
  "ground_floor_area_sqft": null,
  "setback_front_ft": null,
  "setback_rear_ft": null,
  "setback_side1_ft": null,
  "setback_side2_ft": null,
  "fsi_permissible": null,
  "fsi_proposed": null,
  "usage_type": "",
  "issuing_authority": "",
  "conditions": [],
  "validity": ""
}
Return ONLY the JSON. No commentary.`,

  jda_jv: `You are a legal document extraction assistant specialised in Indian real estate.
Extract key commercial terms from this Joint Development Agreement or Joint Venture Agreement.
Return a JSON object with:
{
  "party_landowner": "",
  "party_developer": "",
  "execution_date": "YYYY-MM-DD or null",
  "property_description": "",
  "survey_numbers": [],
  "total_land_area_acres": null,
  "total_land_area_sqft": null,
  "development_type": "",
  "total_proposed_area_sqft": null,
  "developer_share_percent": null,
  "landowner_share_percent": null,
  "revenue_sharing_terms": "",
  "area_sharing_terms": "",
  "project_completion_months": null,
  "rera_registration_responsibility": "",
  "key_obligations_developer": [],
  "key_obligations_landowner": [],
  "termination_clauses": [],
  "dispute_resolution": ""
}
Return ONLY the JSON. No commentary.`,

  broker_quote: `You are a document extraction assistant specialised in Indian real estate.
Extract key information from this Broker Quote / Property Offer Letter.
Return a JSON object with:
{
  "broker_name": "",
  "broker_firm": "",
  "broker_contact": "",
  "property_address": "",
  "survey_numbers": [],
  "total_area_acres": null,
  "total_area_sqft": null,
  "asking_price_total_cr": null,
  "asking_price_per_sqft": null,
  "asking_price_per_acre": null,
  "proposed_use": "",
  "seller_name": "",
  "quote_date": "YYYY-MM-DD or null",
  "validity_days": null,
  "key_highlights": [],
  "approvals_available": [],
  "brokerage_percent": null
}
Return ONLY the JSON. No commentary.`,

  guidance_value_report: `You are a regulatory document extraction assistant for Karnataka real estate guidance values.
Extract only explicit official/vendor guidance-value facts. Do not infer missing values.
Return a JSON object with:
{
  "state": "Karnataka",
  "district": "",
  "sro_name": "",
  "locality": "",
  "road_name": "",
  "land_use_type": "",
  "guidance_value_per_sqft": null,
  "guidance_value_per_acre": null,
  "unit": "",
  "effective_from": "YYYY-MM-DD or null",
  "effective_to": "YYYY-MM-DD or null",
  "source_page": null,
  "source_section": "",
  "verification_notes": [],
  "needs_human_review": true
}
Return ONLY the JSON. No commentary.`,

  igr_guidance_pdf: `You are a regulatory document extraction assistant for Karnataka IGR guidance-value PDFs.
These PDFs contain a header (district, SRO, effective dates) and a table listing many localities/roads with per-sqft or per-acre guidance values.
Extract every visible row faithfully. Never invent missing rows or values. If a value is shown only as a range, return both ends in raw_text and skip the structured row.
Return a JSON object with:
{
  "issuing_authority": "Inspector General of Registration, Karnataka",
  "state": "Karnataka",
  "district": "",
  "sro_name": "",
  "land_use_type": "",
  "effective_from": "YYYY-MM-DD or null",
  "effective_to": "YYYY-MM-DD or null",
  "source_page": null,
  "source_section": "",
  "rows": [
    {
      "locality": "",
      "road_name": "",
      "land_use_type": "",
      "value": null,
      "unit_type": "sqft|acre|gunta",
      "source_page": null,
      "source_section": "",
      "confidence": 0.0
    }
  ],
  "raw_text": "<paste full extracted text from each table page; the parser uses this as a fallback for rows you missed>",
  "verification_notes": [],
  "needs_human_review": true
}
Return ONLY the JSON. No commentary.`,

  bbmp_uav_pdf: `You are a regulatory document extraction assistant for BBMP Unit Area Value (UAV) property-tax zone classification PDFs.
These PDFs are for municipal property-tax zone classification. They are NOT Karnataka IGR sale/registration guidance values.
Extract only explicit BBMP UAV / property-tax facts and visible table rows. Never convert these rows into market prices or sale guidance values.
Return a JSON object with:
{
  "issuing_authority": "Bruhat Bengaluru Mahanagara Palike",
  "city": "Bengaluru",
  "document_title": "",
  "assessment_year": "",
  "tax_year": "",
  "source_page": null,
  "source_section": "",
  "uav_zone_codes": [],
  "rows": [
    {
      "zone_code": "",
      "ward_number": "",
      "ward_name": "",
      "road_name": "",
      "area_or_locality": "",
      "property_tax_category": "",
      "unit_area_value": null,
      "unit": "",
      "source_page": null,
      "source_section": "",
      "confidence": 0.0
    }
  ],
  "raw_text": "<paste visible table text for reviewer traceability>",
  "verification_notes": [],
  "needs_human_review": true
}
Return ONLY the JSON. No commentary.`,

  zoning_certificate: `You are a regulatory document extraction assistant for Indian real estate zoning.
Extract only stated zoning/buildability facts from the certificate. Do not calculate or infer FAR.
Return a JSON object with:
{
  "issuing_authority": "",
  "certificate_number": "",
  "certificate_date": "YYYY-MM-DD or null",
  "property_address": "",
  "survey_numbers": [],
  "zone_code": "",
  "zoning_classification": "",
  "planning_zone": "",
  "land_use_category": "",
  "road_width_m": null,
  "permissible_fsi": null,
  "conditions": [],
  "source_page": null,
  "needs_human_review": true
}
Return ONLY the JSON. No commentary.`,

  e_khata: `You are a municipal property document extraction assistant for Karnataka e-Khata / e-Aasthi documents.
Extract only stated municipal property facts.
Return a JSON object with:
{
  "khata_number": "",
  "pid_number": "",
  "property_address": "",
  "owner_name": "",
  "municipal_body": "",
  "ward_number": "",
  "site_area_sqft": null,
  "built_up_area_sqft": null,
  "property_type": "",
  "assessment_year": "",
  "issue_date": "YYYY-MM-DD or null",
  "source_page": null,
  "needs_human_review": true
}
Return ONLY the JSON. No commentary.`,

  rmp_table: `You are a planning-regulation table extraction assistant for Bengaluru RMP documents.
Extract table values exactly as printed. Do not fill blanks and do not invent formulas.
Return a JSON object with:
{
  "city": "Bengaluru",
  "plan_version": "",
  "table_number": "",
  "source_page": null,
  "source_section": "",
  "planning_districts": [
    {
      "pd_code": "",
      "pd_name": "",
      "source_page": null,
      "source_section": ""
    }
  ],
  "zones": [
    {
      "zone_code": "",
      "zone_name": "",
      "planning_district_code": "",
      "permissible_fsi_base": null,
      "permissible_fsi_max": null,
      "fsi_road_width_rules": [{"road_width_m": null, "fsi": null}],
      "ground_coverage_pct": null,
      "building_height_max_m": null,
      "road_width_min_m": null,
      "permissible_uses": [],
      "prohibited_uses": [],
      "source_page": null,
      "source_section": "",
      "notes": ""
    }
  ],
  "rules": [
    {
      "zone_code": "",
      "zone_name": "",
      "planning_zone": "",
      "land_use_family": "",
      "plot_area_min_sqm": null,
      "plot_area_max_sqm": null,
      "road_width_min_m": null,
      "road_width_max_m": null,
      "base_far": null,
      "additional_far": null,
      "max_far": null,
      "ground_coverage_pct": null,
      "front_setback_m": null
    }
  ],
  "needs_human_review": true
}
Return ONLY the JSON. No commentary.`,

  comps_rate_sheet: `You are a real-estate market data extraction assistant for Indian brokers' rate sheets, comp lists, and multi-property quotes.
Extract every project / unit row visible in the document. One row → one comp object. Do not invent rows.
Return a JSON object with:
{
  "report_metadata": {
    "publisher": "name of broker firm or person",
    "publisher_email": "",
    "publisher_phone": "",
    "as_of_date": "YYYY-MM-DD or null (when the rates are stated as effective)",
    "publication_date": "YYYY-MM-DD or null",
    "city": "",
    "micro_market": "",
    "currency": "INR",
    "notes": ""
  },
  "comps": [
    {
      "project_name": "",
      "developer": "",
      "city": "",
      "locality": "",
      "micro_market": "",
      "asset_class": "residential|office|retail|hospitality|industrial|warehouse|land|mixed_use",
      "project_type_raw": "free-text as written, eg apartment, villa, plotted, retail mall, warehouse",
      "transaction_type": "sale|lease|preleased|under_construction|ready_to_move|null",
      "bhk_config": "",
      "carpet_area_sqft": null,
      "super_builtup_area_sqft": null,
      "land_area_acres": null,
      "rate_per_sqft": null,
      "rate_per_sqft_min": null,
      "rate_per_sqft_max": null,
      "rate_per_acre_cr": null,
      "total_price_cr": null,
      "total_units": null,
      "launch_year": null,
      "possession_year": null,
      "rera_number": "",
      "amenities": [],
      "highlights": [],
      "raw_row_text": "the exact source row text as it appears in the document"
    }
  ],
  "verification_notes": [],
  "needs_human_review": true
}

Rules:
- ONE comp object per project / row in the source. If the same project has 2BHK and 3BHK lines, output 2 comp objects.
- Never invent a rate. If only "ranges from X to Y" is given, set rate_per_sqft=null, rate_per_sqft_min=X, rate_per_sqft_max=Y.
- Never invent a city / locality if not stated. Leave blank.
- For Indian brokers, asking prices are usually per square foot (₹/sqft) for residential and per acre (₹ Cr/acre) for land. Match the unit explicitly.
- When the document gives "₹X Cr for Y sqft", compute neither — leave total_price_cr=X, super_builtup_area_sqft=Y, rate_per_sqft=null. The downstream deterministic engine handles math.
- Always include raw_row_text so a reviewer can verify your structured row against the source.
Return ONLY the JSON. No commentary.`,

  ipc_report: `You are a real-estate market data extraction assistant for International Property Consultant (IPC) quarterly market reports — JLL, Cushman & Wakefield, Knight Frank, Colliers, CBRE, Savills, Anarock, etc.
These reports cover a city + sub-market + asset class for a specific quarter and contain headline indicators plus a transactions / deals table or a project pricing matrix.
Extract every visible row in the data tables. Faithfully record the report metadata.
Return a JSON object with:
{
  "report_metadata": {
    "publisher": "JLL|CW|Cushman & Wakefield|Knight Frank|Colliers|CBRE|Savills|Anarock|other",
    "title": "",
    "city": "",
    "submarket": "",
    "asset_class": "residential|office|retail|hospitality|industrial|warehouse|mixed_use|land",
    "period_start": "YYYY-MM-DD or null",
    "period_end": "YYYY-MM-DD or null",
    "publication_date": "YYYY-MM-DD or null",
    "report_url": "",
    "notes": ""
  },
  "headline_kpis": [
    {
      "label": "stock|new supply|absorption|net absorption|vacancy|weighted avg rent|capital value|IRR|cap rate",
      "value": null,
      "unit": "",
      "period": "",
      "source_page": null
    }
  ],
  "comps": [
    {
      "project_name": "",
      "developer": "",
      "city": "",
      "locality": "",
      "submarket": "",
      "asset_class": "",
      "project_type_raw": "",
      "transaction_type": "sale|lease|preleased|investment|null",
      "tenant_or_buyer": "",
      "carpet_area_sqft": null,
      "super_builtup_area_sqft": null,
      "land_area_acres": null,
      "rate_per_sqft": null,
      "rate_per_sqft_currency": "INR",
      "monthly_rent_per_sqft": null,
      "deal_value_cr": null,
      "cap_rate_pct": null,
      "lease_tenure_years": null,
      "transaction_date": "YYYY-MM-DD or null",
      "rera_number": "",
      "raw_row_text": "the exact source row text"
    }
  ],
  "verification_notes": [],
  "needs_human_review": true
}

Rules:
- IPC reports are usually visually structured — preserve the table fidelity.
- Some IPC reports are quarterly aggregates (no individual transactions). In that case leave "comps" as [] and put indicators in headline_kpis.
- Never project a future quarter's value. Only extract what the document explicitly shows.
- For weighted-average rent or vacancy, include a headline_kpis row, not a comps row.
- When the same project appears multiple quarters in the same report, emit each appearance as a separate comp object with the matching transaction_date.
- Always include raw_row_text so reviewers can verify against the source.
Return ONLY the JSON. No commentary.`,

  kgis_extract: `You are a GIS reference extraction assistant.
Extract only the K-GIS administrative/survey facts visible in the document or JSON extract.
Return a JSON object with:
{
  "district": "",
  "taluk": "",
  "hobli": "",
  "village": "",
  "village_code": "",
  "survey_numbers": [],
  "geometry_reference": "",
  "coordinate_system": "",
  "source_page": null,
  "reference_only": true,
  "needs_human_review": true
}
Return ONLY the JSON. No commentary.`,

  other: `You are a document extraction assistant specialised in Indian real estate.
Extract all key information from this document.
Identify the document type, parties involved, property details, dates, financial figures, and any significant clauses.
Return a JSON object with:
{
  "identified_document_type": "",
  "parties": [{"name": "", "role": ""}],
  "property_details": {
    "address": "",
    "survey_numbers": [],
    "area": ""
  },
  "key_dates": [{"label": "", "date": ""}],
  "financial_figures": [{"label": "", "value": ""}],
  "key_clauses": [],
  "summary": ""
}
Return ONLY the JSON. No commentary.`,
};

// Rent roll — a REPEATING lease/tenancy schedule (income deals). The field set
// is DERIVED from the shared register import catalog (constants/
// rentRollImportColumns.js) so every extracted key maps 1:1 onto the register's
// lease columns — the same catalog drives the download template and the
// deterministic importer, so template / import / extraction can never disagree
// on a field name. Multi-row like the EC prompt's transactions[]; the register
// bridge normalises + review-gates the result (verified:false), never silent.
const buildRentRollExtractionPrompt = () => {
  const fieldLines = IMPORT_COLUMNS_BY_KIND.lease.map((c) => {
    const type = c.type === 'number' ? 'number or null'
      : c.type === 'date' ? '"YYYY-MM-DD" or null'
        : c.type === 'select' ? `one of [${c.options.join(', ')}] or null`
          : 'string or null';
    return `    "${c.key}": ${type},   // ${c.header}`;
  }).join('\n');
  return `You are a rent-roll extraction assistant specialised in Indian commercial real-estate leases.
This document is a RENT ROLL / lease schedule / tenancy statement / rent register. Extract EVERY lease or tenancy row.
Return a JSON object exactly of the form: { "records": [ ...one object per lease... ] }
Each record object has these fields (fill a field ONLY if it is visible in the document; otherwise null):
{
${fieldLines}
}
Rules:
- One record per lease/tenant row. Never merge two tenants, never invent a row, never split one lease into several.
- Areas in sqft (convert if the document uses sq.m, sq.yd, or acres). Money in whole rupees, digits only — no symbols, no commas, no "Cr"/"L".
- "rent_basis" is "per_sqft_month" unless the document clearly bills per unit or per acre.
- Dates strictly as YYYY-MM-DD.
- Do not compute or infer anything the document does not state (no derived totals, no assumed escalations).
Return ONLY the JSON object. No commentary, no markdown fences.`;
};

GEMINI_EXTRACTION_PROMPTS.rent_roll = buildRentRollExtractionPrompt();

// Every doctype gets the multilingual contract — a Kannada RTC and an English
// term sheet flow through the same prompt registry, so the rules belong on all
// of them rather than on a hand-picked subset that would drift. Applied before
// PROMPT_VERSIONS is computed, so each prompt's sha256 covers the appended
// block and the response cache invalidates prior single-language extractions.
for (const kind of Object.keys(GEMINI_EXTRACTION_PROMPTS)) {
  GEMINI_EXTRACTION_PROMPTS[kind] = withMultilingualRules(GEMINI_EXTRACTION_PROMPTS[kind]);
}

const CLASSIFY_PROMPT = `You are a legal document classifier specialised in Indian real estate documents.
The document may be in Kannada, Hindi, English, or a mix of them — read every script present and classify on the document's SUBSTANCE, not its language. A Kannada RTC/Pahani is "rtc_pahani", not "other".
Classify the document into exactly ONE of these types:
title_deed, mother_deed, sale_deed, ec, rtc_pahani, mutation, conversion_certificate,
khata, layout_approval, sanctioned_plan, jda_jv, broker_quote, comps_rate_sheet,
ipc_report, guidance_value_report, igr_guidance_pdf, bbmp_uav_pdf, zoning_certificate,
e_khata, rmp_table, kgis_extract, rent_roll, other

Pick "comps_rate_sheet" when the document is a broker's multi-property rate sheet, comp list,
or a market-pricing email with several projects/units (each row a project or unit). Pick
"broker_quote" only when the document is a single-property offer letter or quote.

Pick "ipc_report" when the document is an International Property Consultant quarterly
or annual market report (JLL, Cushman & Wakefield, Knight Frank, Colliers, CBRE, Savills,
Anarock, etc.) covering a city + sub-market + asset class.

Pick "igr_guidance_pdf" only when the document is an Inspector General of Registration tabular PDF
listing many localities with per-sqft or per-acre guidance values. Use "guidance_value_report" for
single-property valuation reports.
Pick "bbmp_uav_pdf" when the document is BBMP Unit Area Value, UAV, property-tax zone classification,
or ward/street property-tax area value material. Do not classify BBMP UAV/property-tax PDFs as IGR guidance.

Pick "rent_roll" when the document is a RENT ROLL / lease schedule / tenancy statement / rent register —
a table with multiple leases or tenants, each row carrying tenant/unit, area, rent, and lease dates.

Return ONLY a JSON object: { "doc_type": "<type>", "confidence": <0-1>, "reason": "<brief reason>" }
No other text.`;

// Per-prompt version + hash, computed once at module load. The version is
// shared across all extraction prompts (single registry version); the hash
// is per-prompt so an unchanged doctype's cached extractions remain valid
// when a different doctype's prompt is tuned.
const PROMPT_VERSIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(GEMINI_EXTRACTION_PROMPTS).map(([kind, body]) => [
      kind,
      { version: PROMPT_REGISTRY_VERSION, sha256: sha256(body) },
    ]),
  ),
);

const CLASSIFY_PROMPT_VERSION = Object.freeze({
  version: PROMPT_REGISTRY_VERSION,
  sha256: sha256(CLASSIFY_PROMPT),
});

// Zod schema for the classify response. The CLASSIFY_PROMPT contract
// promises `{ doc_type, confidence, reason }`; this schema enforces it at
// the consumer boundary so a malformed Gemini response (markdown fence,
// missing field, wrong type) becomes a structured failure with a clear
// path back to "classify as 'other' and let a human review".
//
// `doc_type` is a free string here (we don't enum-constrain at the schema
// level so a future doctype addition doesn't break the validator before the
// prompt is updated). `confidence` is clamped to [0, 1] when present.
// `reason` is optional — Gemini sometimes omits it on high-confidence calls.
// `passthrough()` so any future fields don't fail validation.
const CLASSIFY_RESPONSE_SCHEMA = z.object({
  doc_type: z.string().min(1),
  confidence: z.coerce.number().min(0).max(1).optional(),
  reason: z.string().optional(),
}).passthrough();

// Lookup helper. Falls back to the `other` doctype's hash for unknown kinds
// so we never crash on a misclassified upload — the cache will simply miss
// (still safe) and the call still happens.
const getExtractionPromptVersion = (kind) =>
  PROMPT_VERSIONS[kind] || PROMPT_VERSIONS.other || { version: PROMPT_REGISTRY_VERSION, sha256: null };

module.exports = {
  GEMINI_EXTRACTION_PROMPTS,
  CLASSIFY_PROMPT,
  PROMPT_REGISTRY_VERSION,
  PROMPT_VERSIONS,
  CLASSIFY_PROMPT_VERSION,
  CLASSIFY_RESPONSE_SCHEMA,
  MULTILINGUAL_RULES,
  getExtractionPromptVersion,
};
