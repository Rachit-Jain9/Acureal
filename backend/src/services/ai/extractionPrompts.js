'use strict';

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
 *
 * The `KNOWN_DOC_TYPES` set is built from `Object.keys(GEMINI_EXTRACTION_PROMPTS)`
 * by the consumer; don't duplicate that list here.
 */

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

const CLASSIFY_PROMPT = `You are a legal document classifier specialised in Indian real estate documents.
Classify the document into exactly ONE of these types:
title_deed, mother_deed, sale_deed, ec, rtc_pahani, mutation, conversion_certificate,
khata, layout_approval, sanctioned_plan, jda_jv, broker_quote, guidance_value_report,
igr_guidance_pdf, zoning_certificate, e_khata, rmp_table, kgis_extract, other

Pick "igr_guidance_pdf" only when the document is an Inspector General of Registration tabular PDF
listing many localities with per-sqft or per-acre guidance values. Use "guidance_value_report" for
single-property valuation reports.

Return ONLY a JSON object: { "doc_type": "<type>", "confidence": <0-1>, "reason": "<brief reason>" }
No other text.`;

module.exports = {
  GEMINI_EXTRACTION_PROMPTS,
  CLASSIFY_PROMPT,
};
