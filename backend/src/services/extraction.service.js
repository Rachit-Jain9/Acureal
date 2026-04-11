'use strict';

const axios = require('axios');
const { query } = require('../config/database');
const { getDownloadUrl } = require('../config/storage');
const { runGeminiInline } = require('./ai/providerRegistry');

// ──────────────────────────────────────────────────────────────────────────────
// Gemini client (lazy init so tests don't crash without API key)
// ──────────────────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// ──────────────────────────────────────────────────────────────────────────────
// Extraction prompts keyed by doc_type
// ──────────────────────────────────────────────────────────────────────────────

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
khata, layout_approval, sanctioned_plan, jda_jv, broker_quote, other

Return ONLY a JSON object: { "doc_type": "<type>", "confidence": <0-1>, "reason": "<brief reason>" }
No other text.`;

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

async function fetchFileAsBase64(fileUrl) {
  const downloadUrl = await getDownloadUrl(fileUrl, 3600);
  const response = await axios.get(downloadUrl, {
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: MAX_FILE_BYTES,
  });

  const contentType = response.headers['content-type'] || 'application/octet-stream';
  const buffer = Buffer.from(response.data);

  if (buffer.length > MAX_FILE_BYTES) {
    throw new Error(`File size ${buffer.length} bytes exceeds 10 MB limit`);
  }

  return {
    base64: buffer.toString('base64'),
    mimeType: contentType.split(';')[0].trim(),
    sizeBytes: buffer.length,
  };
}

function inferMimeType(fileName, providedMimeType) {
  if (providedMimeType && providedMimeType !== 'application/octet-stream') {
    return providedMimeType;
  }
  const ext = (fileName || '').split('.').pop().toLowerCase();
  const map = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    webp: 'image/webp',
  };
  return map[ext] || 'application/pdf';
}

async function callGemini(prompt, base64Data, mimeType) {
  return runGeminiInline({
    prompt,
    base64Data,
    mimeType,
  });
}

function parseJsonResponse(text) {
  // Strip markdown code fences if present
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  return JSON.parse(cleaned);
}

function computeConfidenceScores(structuredFields) {
  // Produce a flat map of field -> 0|1 based on whether value is non-null/non-empty
  if (!structuredFields || typeof structuredFields !== 'object') {
    return {};
  }

  const scores = {};
  for (const [key, value] of Object.entries(structuredFields)) {
    if (Array.isArray(value)) {
      scores[key] = value.length > 0 ? 1 : 0;
    } else if (value !== null && value !== undefined && value !== '') {
      scores[key] = 1;
    } else {
      scores[key] = 0;
    }
  }

  const filled = Object.values(scores).filter(Boolean).length;
  const total = Object.keys(scores).length || 1;
  scores._overall = parseFloat((filled / total).toFixed(2));

  return scores;
}

// ──────────────────────────────────────────────────────────────────────────────
// Core functions
// ──────────────────────────────────────────────────────────────────────────────

async function classifyDocument(fileUrl, fileName, mimeType) {
  const effectiveMime = inferMimeType(fileName, mimeType);
  const { base64 } = await fetchFileAsBase64(fileUrl);
  const responseText = await callGemini(CLASSIFY_PROMPT, base64, effectiveMime);

  const parsed = parseJsonResponse(responseText);
  return parsed.doc_type || 'other';
}

async function extractDocument(documentId, fileUrl, fileName, mimeType, dealId = null) {
  // Create extraction record in 'processing' state
  const insertResult = await query(
    `INSERT INTO document_extractions
       (document_id, deal_id, extraction_status, provider)
     VALUES ($1, $2, 'processing', 'gemini')
     RETURNING *`,
    [documentId, dealId || null],
  );
  const extraction = insertResult.rows[0];
  const extractionId = extraction.id;

  try {
    const effectiveMime = inferMimeType(fileName, mimeType);
    const { base64, sizeBytes } = await fetchFileAsBase64(fileUrl);

    // Step 1: classify
    let docType;
    try {
      docType = await classifyDocument(fileUrl, fileName, effectiveMime);
    } catch {
      docType = 'other';
    }

    // Step 2: extract using typed prompt
    const prompt = GEMINI_EXTRACTION_PROMPTS[docType] || GEMINI_EXTRACTION_PROMPTS.other;
    const rawText = await callGemini(prompt, base64, effectiveMime);

    // Step 3: parse structured output
    let structuredFields = null;
    let parseError = null;
    try {
      structuredFields = parseJsonResponse(rawText);
    } catch (e) {
      parseError = `JSON parse failed: ${e.message}`;
    }

    const confidenceScores = structuredFields ? computeConfidenceScores(structuredFields) : {};

    // Step 4: persist result
    const updateResult = await query(
      `UPDATE document_extractions
       SET doc_type          = $1,
           extraction_status = $2,
           raw_extraction    = $3,
           structured_fields = $4,
           confidence_scores = $5,
           pages_processed   = $6,
           error_message     = $7,
           extracted_at      = NOW(),
           updated_at        = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        docType,
        parseError ? 'partial' : 'completed',
        JSON.stringify({ raw_text: rawText }),
        structuredFields ? JSON.stringify(structuredFields) : null,
        JSON.stringify(confidenceScores),
        null, // pages_processed not available from inline extraction
        parseError,
        extractionId,
      ],
    );

    return updateResult.rows[0];

    // Also update document table with doc_type if column exists
    try {
      await query(
        `UPDATE documents SET doc_type = $1, updated_at = NOW() WHERE id = $2`,
        [docType, documentId],
      );
    } catch {
      // column may not exist yet — non-fatal
    }

    return updateResult.rows[0];
  } catch (err) {
    // Mark extraction as failed
    const failResult = await query(
      `UPDATE document_extractions
       SET extraction_status = 'failed',
           error_message     = $1,
           updated_at        = NOW()
       WHERE id = $2
       RETURNING *`,
      [err.message, extractionId],
    );
    return failResult.rows[0];
  }
}

async function getExtractionByDocument(documentId) {
  const result = await query(
    `SELECT * FROM document_extractions
     WHERE document_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [documentId],
  );
  return result.rows[0] || null;
}

async function applyCorrections(extractionId, corrections, userId) {
  // Append to correction history
  const existing = await query(
    `SELECT human_corrections, correction_history FROM document_extractions WHERE id = $1`,
    [extractionId],
  );

  if (!existing.rows[0]) {
    return null;
  }

  const historyEntry = {
    corrected_by: userId || null,
    corrected_at: new Date().toISOString(),
    corrections,
  };

  const result = await query(
    `UPDATE document_extractions
     SET human_corrections    = $1,
         correction_history   = correction_history || $2::jsonb,
         reviewed_by          = $3,
         reviewed_at          = NOW(),
         updated_at           = NOW()
     WHERE id = $4
     RETURNING *`,
    [
      JSON.stringify(corrections),
      JSON.stringify([historyEntry]),
      userId || null,
      extractionId,
    ],
  );

  return result.rows[0] || null;
}

module.exports = {
  classifyDocument,
  extractDocument,
  getExtractionByDocument,
  applyCorrections,
  GEMINI_EXTRACTION_PROMPTS,
};
