'use strict';

const axios = require('axios');
const { query } = require('../config/database');
const { getDownloadUrl } = require('../config/storage');
const { getProviderAvailability } = require('./ai/providerRegistry');
// Use the telemetry-instrumented router rather than calling the SDK directly so
// every extraction lands in ai_call_logs with cost / latency / lineage.
const { runGeminiInline, runClaudeReasoning } = require('./ai/aiRouter');
const evidenceIngestionService = require('./evidenceIngestion.service');
const {
  toPlainObject,
  mergeStructuredFields,
} = require('../utils/extractionFields');

// ──────────────────────────────────────────────────────────────────────────────
// Gemini client (lazy init so tests don't crash without API key)
// ──────────────────────────────────────────────────────────────────────────────

const MAX_UPLOAD_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 50;
const MAX_EXTRACTION_FILE_SIZE_MB = Math.max(
  1,
  Math.min(
    parseInt(process.env.DOCUMENT_EXTRACTION_MAX_FILE_SIZE_MB, 10) || MAX_UPLOAD_FILE_SIZE_MB,
    MAX_UPLOAD_FILE_SIZE_MB,
  ),
);
const MAX_FILE_BYTES = MAX_EXTRACTION_FILE_SIZE_MB * 1024 * 1024;
const CLAUDE_NORMALIZATION_TIMEOUT_MS = 12000;
let documentsDocTypeColumnAvailable = null;

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
  "plan_version": "",
  "table_number": "",
  "source_page": null,
  "source_section": "",
  "rules": [
    {
      "zone_code": "",
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
zoning_certificate, e_khata, rmp_table, kgis_extract, other

Return ONLY a JSON object: { "doc_type": "<type>", "confidence": <0-1>, "reason": "<brief reason>" }
No other text.`;

const KNOWN_DOC_TYPES = new Set(Object.keys(GEMINI_EXTRACTION_PROMPTS));

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
    throw new Error(
      `File size ${buffer.length} bytes exceeds the AI extraction limit of ${MAX_EXTRACTION_FILE_SIZE_MB} MB`
    );
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

function cleanContextValue(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function compactContext(context = {}) {
  const entries = Object.entries(context)
    .map(([key, value]) => [key, cleanContextValue(value)])
    .filter(([, value]) => value);
  return Object.fromEntries(entries);
}

function buildContextBlock({ fileName, context } = {}) {
  const lines = [];
  const cleanFileName = cleanContextValue(fileName);
  const compacted = compactContext(context);

  if (cleanFileName) {
    lines.push(`File name: ${cleanFileName}`);
  }

  if (Object.keys(compacted).length > 0) {
    lines.push(`Deal/property context: ${JSON.stringify(compacted)}`);
  }

  if (!lines.length) return '';

  return `

Context for matching only:
${lines.join('\n')}

Use the context only to choose between facts explicitly present in the document, such as the matching village, survey number, deal name, address, khata number, or locality. Do not fill any field from context unless the same fact is visible in the document. If the document has multiple rows and none explicitly matches the context, return null or empty values and add a verification note.`;
}

function buildClassifyPrompt(options = {}) {
  return `${CLASSIFY_PROMPT}${buildContextBlock(options)}`;
}

function buildExtractionPrompt(docType, options = {}) {
  const basePrompt = GEMINI_EXTRACTION_PROMPTS[docType] || GEMINI_EXTRACTION_PROMPTS.other;
  return `${basePrompt}${buildContextBlock(options)}`;
}

function normalizeRequestedDocType(docType) {
  const normalized = cleanContextValue(docType);
  return normalized && KNOWN_DOC_TYPES.has(normalized) ? normalized : null;
}

async function callGemini(prompt, base64Data, mimeType, attach = {}) {
  return runGeminiInline({
    task: 'document_extraction',
    attach,
    prompt,
    base64Data,
    mimeType,
  });
}

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);

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

function pickBestStructuredFields(primaryFields, secondaryFields) {
  if (!secondaryFields) return primaryFields;
  if (!primaryFields) return secondaryFields;

  const primaryScore = computeConfidenceScores(primaryFields)._overall || 0;
  const secondaryScore = computeConfidenceScores(secondaryFields)._overall || 0;
  return secondaryScore > primaryScore ? secondaryFields : primaryFields;
}

async function normalizeStructuredFieldsWithClaude({ docType, rawText, structuredFields }) {
  if (!structuredFields || !getProviderAvailability().claude) {
    return null;
  }

  const systemPrompt = `You validate structured extraction output for Indian real-estate documents.

STRICT RULES:
- Return ONLY valid JSON.
- Preserve the exact shape of the provided extracted_json object.
- Do not invent facts, numbers, dates, parties, or clauses.
- If a field is not explicitly supported by the source extraction, keep the current value or set it to null / empty.
- Normalize obvious formatting only: dates, number strings, whitespace, duplicated array values.
- Be conservative. Prefer missing over guessed.`;

  const normalized = await withTimeout(
    runClaudeReasoning({
      task: 'document_extraction',
      systemPrompt,
      payload: {
        doc_type: docType,
        extracted_json: structuredFields,
        raw_extraction_text: rawText,
      },
      maxTokens: 1600,
      metadata: { stage: 'extraction_normalization', doc_type: docType },
    }),
    CLAUDE_NORMALIZATION_TIMEOUT_MS,
    'Claude extraction normalization'
  );

  return parseJsonResponse(normalized);
}

// ──────────────────────────────────────────────────────────────────────────────
// Core functions
// ──────────────────────────────────────────────────────────────────────────────

async function classifyDocumentContent(base64Data, mimeType, options = {}) {
  const responseText = await runGeminiInline({
    task: 'document_classification',
    attach: options.attach,
    prompt: buildClassifyPrompt(options),
    base64Data,
    mimeType,
  });
  const parsed = parseJsonResponse(responseText);
  return parsed.doc_type || 'other';
}

async function classifyDocument(fileUrl, fileName, mimeType, options = {}) {
  const effectiveMime = inferMimeType(fileName, mimeType);
  const { base64 } = await fetchFileAsBase64(fileUrl);
  return classifyDocumentContent(base64, effectiveMime, { ...options, fileName });
}

async function canStoreDocumentDocType() {
  if (documentsDocTypeColumnAvailable !== null) {
    return documentsDocTypeColumnAvailable;
  }

  const result = await query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'documents'
         AND column_name = 'doc_type'
     ) AS exists`
  );

  documentsDocTypeColumnAvailable = Boolean(result.rows[0]?.exists);
  return documentsDocTypeColumnAvailable;
}

async function updateDocumentDocType(documentId, docType) {
  if (!(await canStoreDocumentDocType())) {
    return;
  }

  await query(
    `UPDATE documents SET doc_type = $1, updated_at = NOW() WHERE id = $2`,
    [docType, documentId],
  );
}

async function extractDocument(
  documentId,
  fileUrl,
  fileName,
  mimeType,
  dealId = null,
  userId = null,
  options = {}
) {
  const providerLabel = getProviderAvailability().claude ? 'gemini_claude' : 'gemini';
  // Create extraction record in 'processing' state
  const insertResult = await query(
    `INSERT INTO document_extractions
       (document_id, deal_id, extraction_status, provider)
     VALUES ($1, $2, 'processing', $3)
     RETURNING *`,
    [documentId, dealId || null, providerLabel],
  );
  const extraction = insertResult.rows[0];
  const extractionId = extraction.id;

  try {
    const effectiveMime = inferMimeType(fileName, mimeType);
    const { base64 } = await fetchFileAsBase64(fileUrl);

    // Step 1: classify
    const aiAttach = {
      documentId,
      dealId: dealId || null,
      userId: userId || null,
    };

    let docType = normalizeRequestedDocType(options.docType || options.requestedDocType);
    try {
      if (!docType) {
        docType = await classifyDocumentContent(base64, effectiveMime, {
          fileName,
          context: options.context,
          attach: aiAttach,
        });
      }
    } catch {
      docType = 'other';
    }
    docType = normalizeRequestedDocType(docType) || 'other';

    // Step 2: extract using typed prompt
    const prompt = buildExtractionPrompt(docType, {
      fileName,
      context: options.context,
    });
    const rawText = await callGemini(prompt, base64, effectiveMime, {
      ...aiAttach,
      // metadata gets surfaced in ai_call_logs.metadata for downstream cost
      // attribution and lineage queries.
    });

    // Step 3: parse structured output
    let structuredFields = null;
    let parseError = null;
    try {
      structuredFields = toPlainObject(parseJsonResponse(rawText));
    } catch (e) {
      parseError = `JSON parse failed: ${e.message}`;
    }

    if (structuredFields) {
      try {
        structuredFields = pickBestStructuredFields(
          structuredFields,
          toPlainObject(await normalizeStructuredFieldsWithClaude({
            docType,
            rawText,
            structuredFields,
          }))
        );
      } catch (normalizationError) {
        parseError = parseError
          ? `${parseError}; Claude normalization skipped: ${normalizationError.message}`
          : `Claude normalization skipped: ${normalizationError.message}`;
      }
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

    // Also update document table with doc_type if column exists
    await updateDocumentDocType(documentId, docType);

    const updatedExtraction = updateResult.rows[0];
    try {
      updatedExtraction.evidence_ingestion = await evidenceIngestionService.ingestExtraction(
        updatedExtraction.id,
        userId,
      );
    } catch (ingestionError) {
      updatedExtraction.evidence_ingestion = {
        skipped: true,
        reason: 'ingestion_failed',
        message: ingestionError.message,
      };
    }

    return updatedExtraction;
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

// Deal-scoped roll-up for UI provenance badges. Returns only the latest
// extraction per document (so corrections win over stale AI passes), and only
// extractions currently in a completed state. Callers that need raw history
// should read document_extractions directly.
async function getDealExtractions(dealId) {
  const result = await query(
    `SELECT DISTINCT ON (de.document_id)
            de.id,
            de.document_id,
            de.doc_type,
            de.extraction_status,
            de.structured_fields,
            de.confidence_scores,
            de.human_corrections,
            de.language_detected,
            de.extracted_at,
            de.reviewed_at,
            d.name AS document_name,
            d.file_url
       FROM document_extractions de
       JOIN documents d ON d.id = de.document_id
      WHERE de.deal_id = $1
        AND de.extraction_status IN ('completed','partial','reviewed')
      ORDER BY de.document_id, de.created_at DESC`,
    [dealId],
  );

  const extractions = result.rows.map((row) => {
    const corrections = toPlainObject(row.human_corrections || {});
    const fields = mergeStructuredFields(row.structured_fields || {}, corrections);
    return {
      id: row.id,
      document_id: row.document_id,
      document_name: row.document_name,
      file_url: row.file_url,
      doc_type: row.doc_type,
      status: row.extraction_status,
      language_detected: row.language_detected,
      extracted_at: row.extracted_at,
      reviewed_at: row.reviewed_at,
      fields,
      confidence: row.confidence_scores || {},
      has_corrections: Object.keys(corrections).length > 0,
    };
  });

  // Also roll up a "field map" keyed by canonical buildability/underwriting
  // keys → best source, so the frontend can hang a provenance badge next to
  // the matching input without re-scanning structured_fields client-side.
  const fieldMap = buildFieldMap(extractions);

  return {
    count: extractions.length,
    extractions,
    field_map: fieldMap,
  };
}

// Canonical field key → list of (source_key, boost) pairs to search in the
// extraction's structured_fields. Keep this conservative — only fields the
// deterministic buildability engine actually consumes, and only where Gemini
// prompts have a stable output shape.
const FIELD_MAP_RULES = {
  land_area_sqft: [
    ['land_area_sqft', 1.0],
    ['area_sqft', 0.98],
    ['total_area_sqft', 0.98],
    ['total_land_area_sqft', 0.98],
    ['plot_area_sqft', 0.98],
    ['site_area_sqft', 0.95],
  ],
  land_area_acres: [
    ['land_area_acres', 1.0],
    ['area_acres', 0.98],
    ['total_area_acres', 0.98],
    ['total_land_area_acres', 0.98],
    ['plot_area_acres', 0.98],
  ],
  road_width_m: [
    ['road_width_m', 1.0],
    ['abutting_road_width_m', 0.95],
    ['road_width_ft', 0.7], // lower boost — needs unit conversion
  ],
  survey_number: [
    ['survey_number', 1.0],
    ['survey_numbers', 0.95],
    ['survey_no', 1.0],
    ['sy_no', 0.95],
  ],
  pid: [
    ['pid_number', 1.0],
    ['pid', 1.0],
  ],
  khata_number: [
    ['khata_number', 1.0],
    ['khata_no', 1.0],
  ],
  owner_name: [
    ['owner_name', 1.0],
    ['seller_name', 0.9],
    ['vendor_name', 0.9],
  ],
  consideration_inr: [
    ['consideration_inr', 1.0],
    ['sale_price_inr', 0.95],
    ['total_consideration_inr', 1.0],
  ],
  circle_rate_per_sqft: [
    ['circle_rate_per_sqft', 1.0],
    ['guidance_value_per_sqft', 0.95],
    ['value_inr_per_sqft', 0.95],
  ],
  zone_code: [
    ['zone_code', 1.0],
    ['zoning_classification', 0.95],
  ],
  planning_zone: [
    ['planning_zone', 1.0],
  ],
  guidance_locality: [
    ['locality', 1.0],
  ],
  guidance_road_name: [
    ['road_name', 1.0],
  ],
  sro_name: [
    ['sro_name', 1.0],
    ['sub_registrar_office', 0.9],
  ],
  fsi: [
    ['permissible_fsi', 1.0],
    ['fsi', 0.9],
  ],
};

function buildFieldMap(extractions) {
  const map = {};
  for (const ext of extractions) {
    for (const [canonical, candidates] of Object.entries(FIELD_MAP_RULES)) {
      for (const [sourceKey, boost] of candidates) {
        const value = ext.fields?.[sourceKey];
        if (value == null || value === '') continue;
        const confidence = Number(ext.confidence?.[sourceKey] ?? 0);
        const effective = confidence * boost;
        const existing = map[canonical];
        if (!existing || effective > existing.confidence) {
          map[canonical] = {
            value,
            raw_key: sourceKey,
            confidence: effective,
            from_corrections: ext.has_corrections && ext.fields?.[sourceKey] !== undefined,
            document_id: ext.document_id,
            document_name: ext.document_name,
            doc_type: ext.doc_type,
            extraction_id: ext.id,
          };
        }
        break; // first match in this extraction's candidate list wins
      }
    }
  }
  return map;
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

  const updated = result.rows[0] || null;
  if (!updated) {
    return null;
  }

  try {
    updated.evidence_ingestion = await evidenceIngestionService.ingestExtraction(
      extractionId,
      userId,
    );
  } catch (ingestionError) {
    updated.evidence_ingestion = {
      skipped: true,
      reason: 'ingestion_failed',
      message: ingestionError.message,
    };
  }

  return updated;
}

module.exports = {
  classifyDocument,
  extractDocument,
  getExtractionByDocument,
  getDealExtractions,
  applyCorrections,
  GEMINI_EXTRACTION_PROMPTS,
};
