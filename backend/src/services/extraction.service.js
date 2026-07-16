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
const { parseDocumentToText } = require('./ai/documentTextExtractor');
const {
  formatFor,
  extractionTierFor,
  unsupportedExtractionMessage,
  FALLBACK_MIME,
} = require('../constants/documentFormats');
const { assessExtractionFields } = require('../utils/extractionFieldQuality');
const { redactText, redactFields } = require('./ai/promptRedaction');
const embeddingsService = require('./embeddings.service');
const { EVENTS, publish } = require('../lib/eventBus');
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
let documentsDocTypeColumnAvailable = null;
let fieldQualityColumnAvailable = null;
// Same feature-detect cache for document_extractions.extraction_started_at —
// lets the pipeline run whether or not the reaper migration has been applied
// yet, so a code deploy that lands before the DB update never breaks
// extraction inserts.
let extractionStartedAtColumnAvailable = null;

const KNOWN_DOC_TYPES = new Set(Object.keys(GEMINI_EXTRACTION_PROMPTS));

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

async function fetchFileBuffer(fileUrl) {
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
    buffer,
    mimeType: contentType.split(';')[0].trim(),
    sizeBytes: buffer.length,
    sha256,
  };
}

async function fetchFileAsBase64(fileUrl) {
  const { buffer, mimeType, sizeBytes, sha256 } = await fetchFileBuffer(fileUrl);
  return { base64: buffer.toString('base64'), mimeType, sizeBytes, sha256 };
}

/**
 * Server-derived MIME, keyed off the extension via the shared format registry.
 *
 * Fails CLOSED (application/octet-stream) for unknown types. The old version
 * defaulted unknown extensions to 'application/pdf', so any new format
 * silently reached Gemini mislabelled as a PDF and failed there with an
 * opaque provider error. A client-supplied type is only trusted when the
 * registry has nothing to say — the browser PUTs straight to storage and can
 * claim any type it likes.
 */
function inferMimeType(fileName, providedMimeType) {
  const registryMime = formatFor(fileName)?.mime;
  if (registryMime) return registryMime;
  if (providedMimeType && providedMimeType !== 'application/octet-stream') {
    return providedMimeType;
  }
  return FALLBACK_MIME;
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
const EXTRACTION_SYSTEM_PROMPT = 'You extract structured JSON for Indian real-estate regulatory documents. Return ONLY valid JSON matching the schema in the prompt. Do not invent facts; if unknown, set the field to null.';

async function callExtractionWithFallback({ prompt, base64Data, mimeType, attach = {}, cache = null, metadata = null }) {
  let geminiError = null;
  try {
    const rawText = await callGemini(prompt, base64Data, mimeType, attach, { cache, metadata });
    return { rawText, provider: 'gemini', fallbackReason: null };
  } catch (error) {
    geminiError = error;
  }

  // Gemini exhausted (router-level retries already happened) — try Claude.
  if (getProviderAvailability().claude) {
    try {
      const fallbackMetadata = metadata ? { ...metadata, fallback_from: 'gemini' } : { fallback_from: 'gemini' };
      // Two shapes reach this fallback. A 'native'-tier file (PDF / image)
      // travels as base64 and needs Claude's document content-block API. A
      // 'parseable'-tier file was already transcribed to text upstream and is
      // carried INSIDE the prompt — runClaudeWithDocument would reject it
      // (non-PDF/image), so the text case routes to the reasoning entry point.
      const rawText = base64Data
        ? await runClaudeWithDocument({
          task: 'document_extraction',
          attach,
          prompt,
          base64Data,
          mimeType,
          systemPrompt: EXTRACTION_SYSTEM_PROMPT,
          metadata: fallbackMetadata,
          cache,
        })
        : await runClaudeReasoning({
          task: 'document_extraction',
          attach,
          prompt,
          systemPrompt: EXTRACTION_SYSTEM_PROMPT,
          metadata: fallbackMetadata,
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

function parseJsonResponse(text) {
  // Strip markdown code fences if present
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  return JSON.parse(cleaned);
}

// ─── REMOVED 2026-07-16: `computeConfidenceScores` ────────────────────────────
//
// It scored a field 1.0 for being non-empty and 0 for being null, then stored
// that fill-rate in `confidence_scores` — where the review UI rendered it as
// "High · 100% confidence" and PRE-TICKED the row for one-click application to
// the deal record. It measured presence, never correctness: a hallucinated
// owner name and a perfectly-read one both scored 1.0. Because a field only
// enters the field map when non-empty, the only surviving variance was
// FIELD_MAP_RULES' alias `boost` — so the "confidence" an operator read
// actually encoded WHICH ALIAS SPELLING MATCHED, and 39 of 40 candidates
// landed in the HIGH band. Ownership and parcel identity (`owner_name`,
// `survey_number`, `khata_number`, `pid`) — CLAUDE.md's legal-four title lane,
// which is "extraction aid only, with human verification prompts" — arrived
// pre-approved for bulk apply.
//
// Replaced by `utils/extractionFieldQuality.assessExtractionFields`, which
// invents no probability and judges each field only by rules REDIP can execute
// and explain: grounding against the document's own text, schema shape, and
// the legal-four lane cap. See that module's header for the full rationale.

// True when an extraction holds at least one non-empty extracted field.
// A 'completed' extraction that fails this is "no data" — processed cleanly
// but with nothing extractable — which the UI must distinguish from a failed
// extraction. Underscore-prefixed bookkeeping keys never count as data.
function hasExtractedValue(fields) {
  if (!fields || typeof fields !== 'object') return false;
  return Object.entries(fields).some(([key, value]) => {
    if (key.startsWith('_')) return false;
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined && value !== '';
  });
}

// ─── REMOVED 2026-07-16: the second-AI "normalization" pass ───────────────────
//
// `normalizeStructuredFieldsWithClaude` + `pickBestStructuredFields` used to
// run here: a second LLM call re-wrote Gemini's extraction to "normalize
// obvious formatting only", and whichever of the two outputs scored higher on
// `computeConfidenceScores._overall` won. Both are deleted. The reasons are
// worth keeping, because they are the reasons not to reintroduce it:
//
//  1. IT NEVER RAN. Production telemetry (ai_call_logs, stage=
//     'extraction_normalization') across its whole life: every call succeeded
//     at the provider, but the FASTEST was 5,988 ms — against a 5,000 ms
//     deadline. Median ~17 s; two calls took 205 s and 602 s. It timed out on
//     100% of calls, so REDIP paid ~$0.011–0.016 per document for a result it
//     always discarded, and spent 5 s of every extraction waiting for it.
//
//  2. IT WAS THE WRONG TOOL. Its entire mandate — normalise dates, number
//     strings, whitespace — is deterministic transformation. CLAUDE.md:
//     "Never use LLMs for deterministic math, rule-engine decisions..."
//     `06.02.2024` → `2024-02-06` is testable code, not a probabilistic call.
//
//  3. ITS SELECTION RULE INVERTED SAFETY. `pickBestStructuredFields` kept
//     whichever output had MORE non-empty fields (see the note on
//     computeConfidenceScores' removal). That literally rewards a model for
//     filling boxes: a conservative 12-verified-field answer loses to a
//     15-field answer whose extra 3 were inferred. On title diligence that is
//     a fact-invention path, and the prompt saying "do not invent" is prose,
//     not architecture. It survived only because the pass never completed.
//
// Formatting consistency is a real need and is being addressed the right way:
// deterministic, versioned, per-field normalizers that keep the raw value
// immutable. Extraction output is now persisted EXACTLY as the provider
// returned it.

// ──────────────────────────────────────────────────────────────────────────────
// Core functions
// ──────────────────────────────────────────────────────────────────────────────

async function classifyDocumentContent(base64Data, mimeType, options = {}) {
  // 'parseable'-tier documents arrive already transcribed to text: there are
  // no bytes any provider can read, so the text rides in the prompt and no
  // inline attachment is sent (runGeminiInline handles a text-only call).
  const documentText = options.documentText || null;
  const prompt = documentText
    ? `${buildClassifyPrompt(options)}\n\n--- DOCUMENT CONTENT (transcribed by REDIP) ---\n${documentText}`
    : buildClassifyPrompt(options);
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

// Feature-detect document_extractions.extraction_started_at (added by the
// reaper migration). Cached for the warm-instance lifetime; a cold start
// after the migration applies picks up the new column. Fail-closed to false
// so a detection error just means we omit the column on insert.
async function canStoreExtractionStartedAt() {
  if (extractionStartedAtColumnAvailable !== null) {
    return extractionStartedAtColumnAvailable;
  }
  try {
    const result = await query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'document_extractions'
           AND column_name = 'extraction_started_at'
       ) AS exists`
    );
    extractionStartedAtColumnAvailable = Boolean(result.rows[0]?.exists);
  } catch {
    extractionStartedAtColumnAvailable = false;
  }
  return extractionStartedAtColumnAvailable;
}

// Feature-detect document_extractions.field_quality (added by migration
// 20260728). Holds the per-field verification assessment — the WHY behind each
// score, which the review UI shows in place of a bare percentage. Same
// pre-migration-safe pattern as the two detects above: absent column → the
// column is simply omitted and the UI degrades to score-only (still honest,
// just less explanatory).
async function canStoreFieldQuality() {
  if (fieldQualityColumnAvailable !== null) {
    return fieldQualityColumnAvailable;
  }
  try {
    const result = await query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'document_extractions'
           AND column_name = 'field_quality'
       ) AS exists`
    );
    fieldQualityColumnAvailable = Boolean(result.rows[0]?.exists);
  } catch {
    fieldQualityColumnAvailable = false;
  }
  return fieldQualityColumnAvailable;
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
  const tier = extractionTierFor({ fileName, fileType: effectiveMime });

  // Fail CLOSED on formats REDIP genuinely cannot read (CAD, BIM, SketchUp,
  // Primavera, shapefiles, legacy binary Office). These upload and store
  // fine; refusing here — with the same sentence the UI shows — is the honest
  // alternative to shipping them to a provider that would garble or reject
  // them and calling the result an extraction.
  if (tier === 'stored_only') {
    const err = new Error(unsupportedExtractionMessage(fileName));
    err.statusCode = 422;
    throw err;
  }

  const { buffer, sha256: fileSha256 } = await fetchFileBuffer(fileUrl);

  // Two shapes from here on:
  //  • native    → base64 bytes ride to the provider (PDF / image), as before.
  //  • parseable → REDIP transcribes the file to text deterministically and
  //                the TEXT rides in the prompt. Same prompts, same review
  //                path; the model never sees bytes it cannot decode.
  let base64 = null;
  let documentText = null;
  let parsedMeta = null;
  if (tier === 'parseable') {
    const parsed = await parseDocumentToText(buffer, fileName);
    documentText = parsed.text;
    parsedMeta = { kind: parsed.kind, ...parsed.meta };
  } else {
    base64 = buffer.toString('base64');
  }

  // Cache identity: the file's bytes for a native read; the PARSED TEXT's
  // hash for a parseable one, so improving a parser naturally invalidates
  // prior cached extractions of the same file.
  const contentSha256 = documentText
    ? crypto.createHash('sha256').update(documentText, 'utf8').digest('hex')
    : fileSha256;

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
        fileSha256: contentSha256,
        documentText,
      });
    }
  } catch {
    docType = 'other';
  }
  docType = normalizeRequestedDocType(docType) || 'other';

  const basePrompt = buildExtractionPrompt(docType, {
    fileName,
    context: options.context,
  });
  const prompt = documentText
    ? `${basePrompt}\n\n--- DOCUMENT CONTENT (transcribed by REDIP from the uploaded ${formatFor(fileName)?.label || 'file'}) ---\n${documentText}`
    : basePrompt;
  const promptInfo = getExtractionPromptVersion(docType);
  const extractionCache = {
    promptVersion: promptInfo.version,
    promptSha256: promptInfo.sha256,
    inputSha256: responseCache.hashInputMaterial([prompt, contentSha256, effectiveMime]),
  };
  const extractionMetadata = {
    prompt_kind: docType,
    prompt_version: promptInfo.version,
    prompt_sha256: promptInfo.sha256,
    // doctype rides into the dedicated `ai_call_logs.doctype` column
    // (PR #155) so the AI usage dashboard's "By Doctype" breakdown
    // populates without metadata-JSON unpacking.
    doctype: docType,
    source_tier: tier,
    ...(parsedMeta ? { parsed_kind: parsedMeta.kind } : {}),
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

  // Best-effort language detection. Populates `ai_call_logs.language` on the
  // NEXT call (Claude normalization) and — since 2026-07-16 — the
  // `document_extractions.language_detected` column the Documents tab reads,
  // which no code path had ever written. For a parseable document the
  // transcribed source text is the better sample than the model's JSON reply
  // (the reply is mostly English keys); for a native PDF/image the reply is
  // all we have. Errors here never block the extraction.
  let detectedLanguage = null;
  try {
    detectedLanguage = detectLanguage(documentText || rawText || '');
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

  // ── Notes vs errors ────────────────────────────────────────────────────────
  // `parseError` means the DATA is incomplete — it degrades the row to
  // 'partial', which tells the reviewer "some fields may be missing".
  // `notes` are provenance/diagnostic context about HOW a complete extraction
  // was produced. Conflating the two (as this code did until 2026-07-16)
  // stamped "partially extracted — some fields may be missing" on extractions
  // that were entirely complete, which is exactly the kind of untrue label
  // CLAUDE.md forbids: it trains reviewers to distrust good extractions.
  const notes = [];

  if (extraction.provider === 'claude_fallback') {
    // Gemini was down and Claude read the document instead. The output is a
    // FULL extraction — worth recording, never a data-quality warning.
    notes.push(`Extracted via Claude fallback after Gemini failed (${extraction.fallbackReason || 'transient error'}).`);
  }

  // `structuredFields` is now exactly what the provider returned — no second
  // model rewrites it (see the removal note above). The quality signal below
  // is computed from it by DETERMINISTIC rules only.
  //
  // `documentText` is the verbatim transcription of a 'parseable'-tier file
  // (spreadsheet / doc / deck / CSV / KML). When present it lets us GROUND an
  // extracted value — prove it literally appears in the document — which is
  // the only non-probabilistic way to tell a real read from a fluent guess.
  // Native scans (PDF / image) have no separate source text, so grounding
  // reports "unknown" there rather than pretending.
  const fieldQuality = assessExtractionFields(structuredFields, {
    docType,
    sourceText: documentText,
  });

  return {
    docType,
    rawText,
    structuredFields,
    confidenceScores: fieldQuality.scores,
    fieldQuality: fieldQuality.assessments,
    parseError,
    notes,
    effectiveMime,
    detectedLanguage,
    sourceTier: tier,
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
  // Refuse unreadable formats BEFORE creating the extraction row: a CAD or
  // Primavera file is not a failed extraction, it is a file REDIP was never
  // able to read, and a 'failed' row would put a red error chip on a document
  // that is behaving exactly as documented. The message is the same sentence
  // the Documents tab shows on the disabled extract affordance.
  if (extractionTierFor({ fileName, fileType: inferMimeType(fileName, mimeType) }) === 'stored_only') {
    const err = new Error(unsupportedExtractionMessage(fileName));
    err.statusCode = 422;
    throw err;
  }

  const providerLabel = getProviderAvailability().claude ? 'gemini_claude' : 'gemini';
  // Create extraction record in 'processing' state. extraction_started_at is
  // stamped here so the stuck-extraction reaper can reliably tell which
  // 'processing' rows have outlived the Vercel function timeout (see
  // reapStuckExtractions below). Feature-detected so the code is safe to
  // deploy before the reaper migration lands.
  const hasStartedAt = await canStoreExtractionStartedAt();
  const insertResult = await query(
    hasStartedAt
      ? `INSERT INTO document_extractions
           (document_id, deal_id, extraction_status, provider, extraction_started_at)
         VALUES ($1, $2, 'processing', $3, NOW())
         RETURNING *`
      : `INSERT INTO document_extractions
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
      fieldQuality,
      parseError,
      notes,
      detectedLanguage,
    } = await extractStoredFileFields({
      fileUrl,
      fileName,
      mimeType,
      dealId,
      documentId,
      userId,
      options,
    });

    // Step 4: persist result. language_detected finally gets written here —
    // getDealExtractions has always SELECTed it and the UI has always been
    // ready to show it, but no code path populated the column (so every
    // Kannada/Hindi document read as "unknown language").
    //
    // field_quality carries the per-field verification assessment (the WHY
    // behind each score). Feature-detected so this code is safe to deploy
    // before migration 20260728 lands: without the column the scores still
    // persist honestly, only the per-field reason is unavailable.
    const storeFieldQuality = await canStoreFieldQuality();
    const persistParams = [
      docType,
      // ONLY a genuine data problem degrades the status. Provenance notes
      // (Claude fallback used) describe a COMPLETE extraction and must not
      // surface as "some fields may be missing" — see the notes-vs-errors
      // block in extractStoredFileFields.
      parseError ? 'partial' : 'completed',
      JSON.stringify({ raw_text: rawText }),
      structuredFields ? JSON.stringify(structuredFields) : null,
      JSON.stringify(confidenceScores),
      null, // pages_processed not available from inline extraction
      // error_message carries the real error when there is one, else the
      // notes (kept for diagnostics; no UI treats a 'completed' row's
      // message as a failure).
      parseError || (notes && notes.length ? notes.join(' ') : null),
      detectedLanguage && detectedLanguage !== 'und' ? detectedLanguage : null,
    ];
    if (storeFieldQuality) persistParams.push(JSON.stringify(fieldQuality || {}));
    persistParams.push(extractionId);

    const updateResult = await query(
      `UPDATE document_extractions
       SET doc_type          = $1,
           extraction_status = $2,
           raw_extraction    = $3,
           structured_fields = $4,
           confidence_scores = $5,
           pages_processed   = $6,
           error_message     = $7,
           language_detected = $8,
           ${storeFieldQuality ? 'field_quality     = $9,' : ''}
           extracted_at      = NOW(),
           updated_at        = NOW()
       WHERE id = $${storeFieldQuality ? 10 : 9}
       RETURNING *`,
      persistParams,
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

    // P1-PR4 (2026-05-26) — publish DOCUMENT_EXTRACTED so downstream sinks
    // can react. The cross-document inconsistency-detector sink subscribes
    // and auto-runs detectAndPersist on every new extraction; the audit
    // sink in dealEvents.service captures the activity trail. Both are
    // fire-and-forget — extractDocument's contract is unchanged.
    try {
      publish(EVENTS.DOCUMENT_EXTRACTED, {
        documentId,
        documentName: fileName || null,
        dealId: dealId || null,
        extractionId,
        docType,
        status: parseError ? 'partial' : 'completed',
        userId: userId || null,
      });
    } catch {
      // Event-bus publish should never throw, but defensive guard means a
      // subscriber misconfiguration doesn't break the extraction.
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
  // Org-scope guard: the app connects as a BYPASSRLS role, so the table's
  // RLS policy does NOT protect this path — the explicit org filter is the
  // only cross-tenant guard. current_organization_id() is set per request
  // (config/database.js#applyRequestContext).
  const result = await query(
    `SELECT * FROM document_extractions
     WHERE document_id = $1
       AND organization_id = current_organization_id()
     ORDER BY created_at DESC
     LIMIT 1`,
    [documentId],
  );
  return result.rows[0] || null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Stuck-extraction reaper
// ──────────────────────────────────────────────────────────────────────────────
//
// Deal-document extraction runs synchronously inside the
// POST /documents/:id/extract request, which Vercel caps at maxDuration
// (300s in production). If the function is killed mid-run (timeout, OOM,
// redeploy) the catch block in extractDocument never executes, so the row is
// orphaned in 'processing' forever — invisible to getDealExtractions and
// un-retryable from the UI.
//
// This reaper flips stale 'processing' rows to 'failed' with a clear,
// retry-oriented message so the operator can see the failure and re-run
// extraction. The threshold sits comfortably above maxDuration so a
// legitimately in-flight extraction is never reaped. It runs at the start of
// getDealExtractions — a cheap, idempotent, org-scoped UPDATE (almost always
// zero rows, backed by idx_document_extractions_processing). No separate cron
// is needed, matching the master_plan_documents reaper pattern.
const EXTRACTION_STUCK_THRESHOLD_MS = 6 * 60 * 1000; // 6 min > 300s Vercel maxDuration

async function reapStuckExtractions(dealId = null) {
  try {
    const params = [EXTRACTION_STUCK_THRESHOLD_MS];
    let dealClause = '';
    if (dealId) {
      params.push(dealId);
      dealClause = `AND deal_id = $${params.length}`;
    }
    // Two-clause WHERE handles both modern and legacy stuck rows:
    //  - rows created after this migration have extraction_started_at and are
    //    reaped once they exceed the threshold.
    //  - rows that were already stuck before the migration have
    //    extraction_started_at = NULL; they're reaped via created_at with a
    //    longer 15-minute floor so a row that is legitimately on its first
    //    (long) run is never eaten.
    const result = await query(
      `UPDATE document_extractions
          SET extraction_status = 'failed',
              error_message = 'Extraction timed out before completion (the processing function was interrupted). Re-run extraction to retry.',
              updated_at = NOW()
        WHERE extraction_status = 'processing'
          AND organization_id = current_organization_id()
          ${dealClause}
          AND (
            (extraction_started_at IS NOT NULL
              AND extraction_started_at < NOW() - ($1::bigint || ' milliseconds')::interval)
            OR
            (extraction_started_at IS NULL
              AND created_at < NOW() - INTERVAL '15 minutes')
          )`,
      params,
    );
    if (result.rowCount > 0) {
      log.warn('extraction_reaped_stuck', { deal_id: dealId || null, count: result.rowCount });
    }
    return result.rowCount || 0;
  } catch (err) {
    // Reaper failures are intentionally swallowed — the read path must not
    // break if the cleanup write fails. The next read retries.
    log.warn('extraction_reaper_failed', { error: err.message });
    return 0;
  }
}

// Latest failed / stuck-'processing' extraction per document for a deal.
// Powers the "N documents failed extraction — retry" surface. Org-scoped:
// the app connects as a BYPASSRLS role, so the explicit organization_id
// filter is the only cross-tenant guard (current_organization_id() is set
// per request in config/database.js#applyRequestContext).
async function getDealExtractionFailures(dealId) {
  const result = await query(
    `SELECT DISTINCT ON (de.document_id)
            de.id,
            de.document_id,
            de.doc_type,
            de.extraction_status,
            de.error_message,
            de.extracted_at,
            de.updated_at,
            d.name AS document_name
       FROM document_extractions de
       JOIN documents d ON d.id = de.document_id
      WHERE de.deal_id = $1
        AND de.organization_id = current_organization_id()
        AND d.deleted_at IS NULL
        AND de.extraction_status IN ('failed','processing')
      ORDER BY de.document_id, de.created_at DESC`,
    [dealId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    document_id: row.document_id,
    document_name: row.document_name,
    doc_type: row.doc_type,
    status: row.extraction_status, // 'failed' | 'processing'
    error_message: row.error_message || null,
    extracted_at: row.extracted_at || null,
    updated_at: row.updated_at || null,
  }));
}

// Deal-scoped roll-up for UI provenance badges. Returns the latest extraction
// per document (so corrections win over stale AI passes). The `extractions`
// array carries documents in a usable state (completed/partial/reviewed);
// `failures` carries documents whose latest attempt failed or is stuck so the
// UI can prompt a retry; `coverage` is the at-a-glance status breakdown.
// Callers that need raw history should read document_extractions directly.
async function getDealExtractions(dealId) {
  // Sweep this deal's orphaned 'processing' rows to 'failed' before reading so
  // they surface in `failures` instead of silently vanishing. Best-effort.
  await reapStuckExtractions(dealId);

  // field_quality is feature-detected: SELECTing a column that does not exist
  // yet would 42703 the whole read, so the projection adapts. Pre-migration
  // the UI simply has no per-field reason to show.
  const hasFieldQuality = await canStoreFieldQuality();

  const result = await query(
    `SELECT DISTINCT ON (de.document_id)
            de.id,
            de.document_id,
            de.doc_type,
            de.extraction_status,
            de.structured_fields,
            de.confidence_scores,
            ${hasFieldQuality ? 'de.field_quality,' : ''}
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
        AND d.deleted_at IS NULL
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
      // Per-field verification assessment ({status, reason, lane, grounded,
      // schemaValid}) — the WHY the review UI shows instead of a bare
      // percentage. Empty object pre-migration.
      field_quality: row.field_quality || {},
      has_corrections: Object.keys(corrections).length > 0,
      applied_canonical_fields: Array.from(appliedCanonicalFields),
      // "no data" vs "has data": a completed extraction with no non-empty
      // field was processed fine but had nothing extractable — the UI shows
      // "no fields found" instead of implying something is still pending.
      has_data: hasExtractedValue(fields),
    };
  });

  // Also roll up a "field map" keyed by canonical buildability/underwriting
  // keys → best source, so the frontend can hang a provenance badge next to
  // the matching input without re-scanning structured_fields client-side.
  // Already-applied fields are excluded — buildFieldMap respects each
  // extraction's `applied_canonical_fields` list.
  const fieldMap = buildFieldMap(extractions);

  // Documents whose latest attempt failed or is genuinely still processing —
  // but only those with NO usable extraction, so a document that failed once
  // and then succeeded on retry doesn't keep nagging the operator.
  const usableDocIds = new Set(extractions.map((e) => e.document_id));
  const failures = (await getDealExtractionFailures(dealId)).filter(
    (f) => !usableDocIds.has(f.document_id),
  );

  // At-a-glance coverage so the UI can say "6 extracted · 1 no data · 1 failed"
  // without re-deriving it client-side.
  const withData = extractions.filter((e) => e.has_data).length;
  const coverage = {
    with_data: withData,
    no_data: extractions.length - withData,
    failed: failures.filter((f) => f.status === 'failed').length,
    processing: failures.filter((f) => f.status === 'processing').length,
  };

  return {
    count: extractions.length,
    extractions,
    field_map: fieldMap,
    failures,
    coverage,
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
        // `boost` expresses alias PREFERENCE (an exact `owner_name` beats a
        // `seller_name` alias), so it still ranks competing candidates. It is
        // deliberately NOT allowed to lift a field across a band boundary:
        // before 2026-07-16 confidence was always 1.0, so `effective` WAS the
        // boost, and 39 of 40 aliases scored ≥0.80 — the alias table alone
        // decided what got pre-ticked. The verification signal decides the
        // band now; the boost only breaks ties within it.
        const effective = confidence * boost;
        const assessment = ext.field_quality?.[sourceKey] || null;
        const existing = map[canonical];
        if (!existing || effective > existing.confidence) {
          map[canonical] = {
            value,
            raw_key: sourceKey,
            confidence: effective,
            // The band the UI must honour, computed from the deterministic
            // verification status alone — never from the alias boost.
            signal_score: confidence,
            signal: assessment && {
              status: assessment.status,
              reason: assessment.reason,
              lane: assessment.lane || null,
              grounded: assessment.grounded ?? null,
            },
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
  // Org-scope guard (BYPASSRLS app role — see getExtractionByDocument).
  const existing = await query(
    `SELECT human_corrections, correction_history FROM document_extractions
      WHERE id = $1 AND organization_id = current_organization_id()`,
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
     WHERE id = $4 AND organization_id = current_organization_id()
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
  getDealExtractionFailures,
  reapStuckExtractions,
  applyCorrections,
  GEMINI_EXTRACTION_PROMPTS,
  // Exported for tests — notably the legal-four CI guard, which asserts every
  // canonical auto-fill destination has a deliberately reviewed lane.
  __internal: { FIELD_MAP_RULES, buildFieldMap },
};
