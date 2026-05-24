'use strict';

const axios = require('axios');
const crypto = require('crypto');
const { query } = require('../config/database');
const { getDownloadUrl } = require('../config/storage');
const { getProviderAvailability } = require('./ai/providerRegistry');
// Use the telemetry-instrumented router rather than calling the SDK directly so
// every extraction lands in ai_call_logs with cost / latency / lineage.
const { runGeminiInline, runClaudeReasoning, runClaudeWithDocument } = require('./ai/aiRouter');
const responseCache = require('./ai/aiResponseCache');
const evidenceIngestionService = require('./evidenceIngestion.service');
const {
  toPlainObject,
  mergeStructuredFields,
} = require('../utils/extractionFields');
// Per-doctype Gemini prompts live in their own module so tuning is a
// one-file diff. Keep `GEMINI_EXTRACTION_PROMPTS` re-exported below to
// preserve the existing public API surface.
const {
  GEMINI_EXTRACTION_PROMPTS,
  CLASSIFY_PROMPT,
  CLASSIFY_PROMPT_VERSION,
  CLASSIFY_RESPONSE_SCHEMA,
  getExtractionPromptVersion,
} = require('./ai/extractionPrompts');
const { tryParseAndValidate } = require('./ai/aiRouter');
const { detectLanguage } = require('./ai/languageDetect');
const { redactText, redactFields } = require('./ai/promptRedaction');
const embeddingsService = require('./embeddings.service');
const log = require('../lib/logger').child({ module: 'extraction' });

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
// Claude normalization is a quality-improvement pass over Gemini's output.
// Tighter than the original 12s — if Claude can't normalize in 5s, the
// Gemini output is already good enough for review, so we skip rather than
// blocking the whole extraction. Tabular-rule documents (Volume 6 Zoning,
// FAR tables, BBMP UAV) come back from Gemini already well-structured;
// running them through Claude rarely changes the output but doubles the
// latency, so we skip Claude entirely for those types.
const CLAUDE_NORMALIZATION_TIMEOUT_MS = 5000;
const CLAUDE_NORMALIZATION_SKIP_DOC_TYPES = new Set([
  'rmp_table',
  'far_table',
  'bbmp_uav_pdf',
  'guidance_value_report',
]);
let documentsDocTypeColumnAvailable = null;

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

  // Hash the raw bytes once so the response cache can key on the file
  // identity without re-buffering. The hash travels with the upload through
  // the rest of extraction; identical re-uploads of the same file (which is
  // common for retry / regenerate flows) produce the same cache key and
  // skip the provider entirely.
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    base64: buffer.toString('base64'),
    mimeType: contentType.split(';')[0].trim(),
    sizeBytes: buffer.length,
    sha256,
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

async function callGemini(prompt, base64Data, mimeType, attach = {}, options = {}) {
  return runGeminiInline({
    task: 'document_extraction',
    attach,
    prompt,
    base64Data,
    mimeType,
    metadata: options.metadata,
    cache: options.cache,
  });
}

// Resilient extraction: try Gemini once, then fall back to Claude with the
// same PDF/image if the Gemini call fails. Retry of the Gemini call on
// transient errors is handled inside `aiRouter.runGeminiInline` (see
// `aiRetry.isRetriableProviderError` for the classifier) — by the time
// runGeminiInline throws here, Gemini has already been retried 3× with
// exponential backoff and we know it's permanently down for this request.
//
// Returns { rawText, provider, fallbackReason } so the caller can record
// which engine produced the output.
//
// Both the Gemini path and the Claude fallback share the same response-cache
// key (built from prompt_sha256 + file sha256 + mime type) — a hit on EITHER
// path serves the response immediately. The cache is opt-in: callers must
// pass `cache` so we never accidentally cache calls whose inputs are not
// fully reconstructable.
async function callExtractionWithFallback({ prompt, base64Data, mimeType, attach = {}, cache = null, metadata = null }) {
  let geminiError = null;
  try {
    const rawText = await callGemini(prompt, base64Data, mimeType, attach, { cache, metadata });
    return { rawText, provider: 'gemini', fallbackReason: null };
  } catch (error) {
    geminiError = error;
  }

  // Gemini exhausted (router-level retries already happened) — try Claude
  // with the document directly.
  if (getProviderAvailability().claude) {
    try {
      const rawText = await runClaudeWithDocument({
        task: 'document_extraction',
        attach,
        prompt,
        base64Data,
        mimeType,
        systemPrompt: 'You extract structured JSON for Indian real-estate regulatory documents. Return ONLY valid JSON matching the schema in the prompt. Do not invent facts; if unknown, set the field to null.',
        metadata: metadata ? { ...metadata, fallback_from: 'gemini' } : { fallback_from: 'gemini' },
        cache,
      });
      return {
        rawText,
        provider: 'claude_fallback',
        fallbackReason: geminiError?.message || 'Gemini call failed',
      };
    } catch (claudeError) {
      const combined = new Error(
        `Gemini failed (${geminiError?.message || 'unknown'}); Claude fallback also failed (${claudeError.message || 'unknown'}).`,
      );
      combined.cause = claudeError;
      throw combined;
    }
  }

  throw geminiError || new Error('Gemini extraction failed and Claude fallback is not configured.');
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

async function normalizeStructuredFieldsWithClaude({ docType, rawText, structuredFields, language = null }) {
  // Function name retained for backward compatibility — the call inside now
  // routes via `runClaudeReasoning` (routing-aware) so it dispatches to
  // OpenAI when the env says openai. Renaming the function would touch 4+
  // call sites; the internal logic is what matters.
  if (!structuredFields || !getProviderAvailability().gpt_compatible) {
    return null;
  }
  // Skip the LLM-normalization pass for doc types where Gemini already
  // returns clean tabular structure. The marginal quality lift isn't worth
  // the extra hop.
  if (docType && CLAUDE_NORMALIZATION_SKIP_DOC_TYPES.has(docType)) {
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
      // The systemPrompt is identical across normalization calls for the
      // same doc_type; opt into Anthropic's ephemeral prompt cache so the
      // 2nd+ normalization within 5 minutes pays 0.1× the input cost on
      // the cached portion.
      cachePrompt: true,
      payload: {
        doc_type: docType,
        extracted_json: structuredFields,
        raw_extraction_text: rawText,
      },
      maxTokens: 1600,
      metadata: {
        stage: 'extraction_normalization',
        doc_type: docType,
        // Mirror to the dedicated columns so the AI usage dashboard's
        // doctype × language breakdown populates for normalization calls.
        doctype: docType,
        ...(language && language !== 'und' ? { language } : {}),
      },
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
  const prompt = buildClassifyPrompt(options);
  const fileSha256 = options.fileSha256 || null;

  // The classify prompt is itself versioned; cache hits are keyed by the
  // SAME prompt sha + file bytes, so a re-upload of the same file sees an
  // instant doctype answer instead of a Gemini round-trip.
  const cache = fileSha256
    ? {
        promptVersion: CLASSIFY_PROMPT_VERSION.version,
        promptSha256: CLASSIFY_PROMPT_VERSION.sha256,
        inputSha256: responseCache.hashInputMaterial([prompt, fileSha256, mimeType]),
        // Cache ONLY the parsed { doc_type, confidence, reason } object so
        // we don't reconstruct from the SDK envelope on hit.
        responseToCache: undefined, // default = full result text
      }
    : null;

  const responseText = await runGeminiInline({
    task: 'document_classification',
    attach: options.attach,
    prompt,
    base64Data,
    mimeType,
    metadata: {
      prompt_kind: 'classify',
      prompt_version: CLASSIFY_PROMPT_VERSION.version,
      prompt_sha256: CLASSIFY_PROMPT_VERSION.sha256,
    },
    cache,
  });

  // Validate against the Zod schema. Fail-open to 'other' so a malformed
  // Gemini response never blocks the upload — the user can manually pick
  // the doctype on the review queue. The validation outcome is logged so
  // we can track parse-failure rates per prompt version.
  const validation = tryParseAndValidate(responseText, CLASSIFY_RESPONSE_SCHEMA);
  if (!validation.ok) {
    log.warn('classify_response_invalid', {
      reason: validation.reason,
      prompt_version: CLASSIFY_PROMPT_VERSION.version,
    });
    return 'other';
  }
  return validation.value.doc_type || 'other';
}

async function classifyDocument(fileUrl, fileName, mimeType, options = {}) {
  const effectiveMime = inferMimeType(fileName, mimeType);
  const { base64, sha256 } = await fetchFileAsBase64(fileUrl);
  return classifyDocumentContent(base64, effectiveMime, {
    ...options,
    fileName,
    fileSha256: sha256,
  });
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

async function extractStoredFileFields({
  fileUrl,
  fileName,
  mimeType,
  dealId = null,
  documentId = null,
  userId = null,
  options = {},
} = {}) {
  if (!fileUrl) {
    throw new Error('Stored file URL is required for extraction.');
  }

  const effectiveMime = inferMimeType(fileName, mimeType);
  const { base64, sha256: fileSha256 } = await fetchFileAsBase64(fileUrl);

  const aiAttach = options.attach || {
    documentId: documentId || null,
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
        fileSha256,
      });
    }
  } catch {
    docType = 'other';
  }
  docType = normalizeRequestedDocType(docType) || 'other';

  const prompt = buildExtractionPrompt(docType, {
    fileName,
    context: options.context,
  });
  const promptInfo = getExtractionPromptVersion(docType);
  const extractionCache = {
    promptVersion: promptInfo.version,
    promptSha256: promptInfo.sha256,
    inputSha256: responseCache.hashInputMaterial([prompt, fileSha256, effectiveMime]),
  };
  const extractionMetadata = {
    prompt_kind: docType,
    prompt_version: promptInfo.version,
    prompt_sha256: promptInfo.sha256,
    // doctype rides into the dedicated `ai_call_logs.doctype` column
    // (PR #155) so the AI usage dashboard's "By Doctype" breakdown
    // populates without metadata-JSON unpacking.
    doctype: docType,
  };
  const extraction = await callExtractionWithFallback({
    prompt,
    base64Data: base64,
    mimeType: effectiveMime,
    attach: aiAttach,
    cache: extractionCache,
    metadata: extractionMetadata,
  });
  // Redact Aadhaar / PAN before the extracted text or fields reach the
  // Claude normalization pass, the OpenAI embedding index, or storage.
  // The raw file already went to Gemini (unavoidable to read it at all);
  // this is the defense-in-depth step CLAUDE.md mandates for everything
  // downstream of extraction.
  const { text: rawText, count: rawRedactionCount } = redactText(extraction.rawText || '');
  if (rawRedactionCount > 0) {
    log.info('pii_redacted_raw_text', { doc_type: docType, redactions: rawRedactionCount });
  }

  // Best-effort language detection on the extracted text. This populates
  // the `ai_call_logs.language` column on the NEXT call (Claude
  // normalization), not the extraction call itself — by then we have a
  // representative text sample to read script blocks from. Errors here
  // never block the extraction.
  let detectedLanguage = null;
  try {
    detectedLanguage = detectLanguage(rawText || '');
  } catch (err) {
    log.warn('language_detect_failed', { error: err.message, doc_type: docType });
  }

  // Best-effort: index the extracted text into pgvector so the document
  // becomes semantic-search-able. Fire-and-forget — embedding failures
  // never block the extraction return. The service swallows errors and
  // logs them; we don't even await the result on the hot path.
  if (rawText && options.organizationId && options.documentId) {
    Promise.resolve()
      .then(() => embeddingsService.indexDocumentText({
        organizationId: options.organizationId,
        documentId: options.documentId,
        text: rawText,
        sourceKind: 'document_chunk',
        metadata: {
          doc_type: docType,
          language: detectedLanguage,
          extraction_at: new Date().toISOString(),
        },
      }))
      .catch((err) => log.warn('embedding_pipeline_dispatch_failed', { error: err.message }));
  }

  let structuredFields = null;
  let parseError = null;
  try {
    structuredFields = toPlainObject(parseJsonResponse(rawText));
  } catch (e) {
    parseError = `JSON parse failed: ${e.message}`;
  }

  // Catch identity numbers that survived the free-text pass — a bare
  // Aadhaar under an `aadhaar`-named field has no PAN/spacing pattern to
  // match, so it is masked here by field key.
  if (structuredFields) {
    const { fields, count: fieldRedactionCount } = redactFields(structuredFields);
    structuredFields = fields;
    if (fieldRedactionCount > 0) {
      log.info('pii_redacted_fields', { doc_type: docType, redactions: fieldRedactionCount });
    }
  }

  // Surface the fallback path in extraction_error so reviewers can see why a
  // result came from Claude rather than Gemini. parseError still wins if the
  // JSON itself was malformed.
  if (!parseError && extraction.provider === 'claude_fallback') {
    parseError = `Note: extracted via Claude fallback after Gemini failed (${extraction.fallbackReason || 'transient error'}).`;
  }

  if (structuredFields) {
    try {
      structuredFields = pickBestStructuredFields(
        structuredFields,
        toPlainObject(await normalizeStructuredFieldsWithClaude({
          docType,
          rawText,
          structuredFields,
          language: detectedLanguage,
        }))
      );
    } catch (normalizationError) {
      parseError = parseError
        ? `${parseError}; Claude normalization skipped: ${normalizationError.message}`
        : `Claude normalization skipped: ${normalizationError.message}`;
    }
  }

  return {
    docType,
    rawText,
    structuredFields,
    confidenceScores: structuredFields ? computeConfidenceScores(structuredFields) : {},
    parseError,
    effectiveMime,
  };
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
    const {
      docType,
      rawText,
      structuredFields,
      confidenceScores,
      parseError,
    } = await extractStoredFileFields({
      fileUrl,
      fileName,
      mimeType,
      dealId,
      documentId,
      userId,
      options,
    });

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
            de.correction_history,
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
    // Read the correction-history entries the apply pipeline writes
    // (`type: 'applied_to_deal'`) and pull out the canonical_field
    // names already pushed to the deal/property. The frontend's
    // "N fields ready to auto-fill" banner subtracts these so the
    // count drops every time the operator presses Apply — instead of
    // keeping the same proposals on offer indefinitely.
    const history = Array.isArray(row.correction_history) ? row.correction_history : [];
    const appliedCanonicalFields = new Set();
    for (const entry of history) {
      if (!entry || entry.type !== 'applied_to_deal') continue;
      if (entry.deal_id && entry.deal_id !== dealId) continue;
      const fieldsList = Array.isArray(entry.applied_fields) ? entry.applied_fields : [];
      for (const f of fieldsList) {
        if (f?.canonical_field) appliedCanonicalFields.add(f.canonical_field);
      }
    }
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
      applied_canonical_fields: Array.from(appliedCanonicalFields),
    };
  });

  // Also roll up a "field map" keyed by canonical buildability/underwriting
  // keys → best source, so the frontend can hang a provenance badge next to
  // the matching input without re-scanning structured_fields client-side.
  // Already-applied fields are excluded — buildFieldMap respects each
  // extraction's `applied_canonical_fields` list.
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
    // Per-extraction set of canonical fields already pushed to the deal.
    // If a canonical field has been applied via THIS extraction, it
    // should no longer appear in the "ready to auto-fill" surface.
    const appliedHere = new Set(ext.applied_canonical_fields || []);
    for (const [canonical, candidates] of Object.entries(FIELD_MAP_RULES)) {
      if (appliedHere.has(canonical)) continue;
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
  extractStoredFileFields,
  callExtractionWithFallback,
  getExtractionByDocument,
  getDealExtractions,
  applyCorrections,
  GEMINI_EXTRACTION_PROMPTS,
};
