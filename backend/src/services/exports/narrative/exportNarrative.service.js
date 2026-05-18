'use strict';

/**
 * Export-narrative generator.
 *
 * Produces investor-grade English prose for the new PPTX/DOCX exports.
 * Sections supported:
 *   - whyThisArea               (job growth, infra proximity, demographic snapshot)
 *   - prosCons                  (deterministic-then-AI two-column synthesis)
 *   - cashflowLevers            (qualitative levers; NEVER returns numbers)
 *   - demographicsSynthesis     (translates raw demographic stats into narrative)
 *
 * Hard rules (per CLAUDE.md):
 *   - English ONLY. No Kannada / Hindi / regional-language outputs ever.
 *   - No fabricated facts. AI synthesises text from already-computed structured
 *     payload data; sources[] cites which fields informed each block.
 *   - No AI numeric output. The model is instructed to refer to numbers
 *     symbolically ("strong IRR", "thin DSCR cushion") rather than emit
 *     specific figures, since exports already render the deterministic numbers
 *     elsewhere.
 *   - Never throws. Every error path returns { available: false, reason }.
 *
 * Routing:
 *   - Primary: Gemini (`gemini-3-flash-preview`) via aiRouter — cheap, fast.
 *   - Fallback: OpenAI (`gpt-5.4`) — automatic on Gemini failure if the
 *     OPENAI key is set.
 *   - Claude is NOT used here; it remains owned by `export.insights.service.js`
 *     for the long-form IC opinion only.
 *
 * Caching:
 *   - aiRouter response cache keyed by (deal_id + section + payload sha256 +
 *     prompt sha256). 90-day TTL. Cache hits skip the provider call entirely.
 */

const crypto = require('crypto');
const { runAI } = require('../../ai/aiRouter');
const { getProviderAvailability } = require('../../ai/providerRegistry');

const SECTION_TIMEOUT_MS = 12000;

const SYSTEM_PROMPT_VERSION = '2026-05-10.v1';
const SYSTEM_PROMPT = `You are a senior real-estate analyst at an India-focused private equity firm. You write disciplined investor-grade English prose for export reports.

ABSOLUTE RULES:
- Output strict JSON only. No markdown fences, no preamble, no trailing prose.
- ENGLISH ONLY. Never use Hindi, Kannada, Tamil, or any regional language. Never transliterate. Locality names like "Whitefield" or "Hebbal" are English place names and stay as-is.
- Reference only the facts provided in the payload. Never invent rates, comp prices, approval status, RERA registration, demographics, infrastructure, or anything not present in the payload. If a fact is missing, say so plainly ("demographic data not available") rather than inferring.
- Never emit specific numerical figures (no "₹15,000/sqft", no "22% IRR", no "12 km from airport"). Refer to numbers qualitatively ("premium pricing band", "strong IRR", "moderate distance"). The export renders the actual numbers elsewhere.
- Never recommend a specific buy / pass action. Synthesis only — interpretation belongs to the human reader.
- Be concise. Investor-grade tone: factual, balanced, alert to risk, no marketing language.
- Indian deal conventions: INR Crore, sqft, FSI. Bengaluru / India context.

Section-specific schemas are provided in the user message. Match the schema exactly.`;

const SECTION_SCHEMAS = {
  whyThisArea: {
    description:
      'Synthesise why the deal location is worth attention. 3 paragraphs maximum: ' +
      '(1) anchor — what defines this micro-market, (2) demand drivers — jobs / infrastructure / lifestyle from the payload, (3) risk overlay — what to watch.',
    schema: {
      paragraphs: 'string[] — 2 to 3 paragraphs, each 40-90 words',
      summary: 'string — 1-sentence summary',
    },
    instructions:
      'Use only the locality, infra_proximity, intelligence_briefs, and demographics from the payload. ' +
      'If demographics or briefs are missing, lead with what IS provided and explicitly note the gap.',
  },
  prosCons: {
    description:
      'Two parallel columns: pros (reasons to pursue) and cons (reasons to be cautious). Anchored ONLY in the deterministic facts present in the payload (KPIs, DD progress, approval gaps, risk flags, comp positioning).',
    schema: {
      pros: 'string[] — 3 to 5 items, each 8-18 words',
      cons: 'string[] — 3 to 5 items, each 8-18 words',
    },
    instructions:
      'No filler. Every pro/con must trace to a payload field. ' +
      'Format each item as a complete short sentence — not a fragment.',
  },
  cashflowLevers: {
    description:
      'Qualitative levers the operator could pull to improve cash deployment, IRR, or peak-equity exposure. Strictly QUALITATIVE — no numeric estimates of impact.',
    schema: {
      levers: 'string[] — 3 to 5 items, each 12-24 words. Each lever names the action and the cash-flow dimension it affects.',
    },
    instructions:
      'Examples of valid framings: "Tighten construction phasing to defer peak equity", "Layer in mezzanine debt to lift project IRR". ' +
      'NEVER quote a specific delta percentage. NEVER suggest illegal or non-compliant moves (no off-the-books cash, no tax evasion).',
  },
  demographicsSynthesis: {
    description:
      'Translate raw demographic stats into a 1-2 paragraph narrative that an IC member can scan in 15 seconds.',
    schema: {
      paragraph: 'string — 1 paragraph, 50-100 words',
    },
    instructions:
      'If population, income tier, or age mix are missing, return paragraph: "Demographic data is not available for this micro-market. Manual input required."',
  },
};

const num = (v) => (v != null && !Number.isNaN(Number(v)) ? Number(v) : null);

const stripFences = (text) => {
  if (typeof text !== 'string') return text;
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
};

const parseJson = (raw) => {
  if (!raw) return null;
  try {
    return JSON.parse(stripFences(raw));
  } catch {
    const match = String(raw).match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

const sha256 = (value) =>
  crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex');

// English-only sanity check. If we somehow get back content with Devanagari /
// Kannada / Tamil / Telugu / Malayalam / Bengali / Gujarati / Gurmukhi /
// Oriya / Sinhala / Thai / Tibetan / Burmese / Arabic / Han / Hangul / Hiragana /
// Katakana, drop it and surface the failure rather than ship non-English
// text into an export. The ranges below cover every major non-Latin script
// likely to appear in an Indian or Asian context.
const NON_LATIN_RE = new RegExp(
  '[' +
    '\\u0590-\\u05FF' + // Hebrew
    '\\u0600-\\u06FF' + // Arabic
    '\\u0700-\\u074F' + // Syriac
    '\\u0900-\\u097F' + // Devanagari
    '\\u0980-\\u09FF' + // Bengali
    '\\u0A00-\\u0A7F' + // Gurmukhi
    '\\u0A80-\\u0AFF' + // Gujarati
    '\\u0B00-\\u0B7F' + // Oriya
    '\\u0B80-\\u0BFF' + // Tamil
    '\\u0C00-\\u0C7F' + // Telugu
    '\\u0C80-\\u0CFF' + // Kannada
    '\\u0D00-\\u0D7F' + // Malayalam
    '\\u0D80-\\u0DFF' + // Sinhala
    '\\u0E00-\\u0E7F' + // Thai
    '\\u0F00-\\u0FFF' + // Tibetan
    '\\u1000-\\u109F' + // Myanmar
    '\\u3040-\\u309F' + // Hiragana
    '\\u30A0-\\u30FF' + // Katakana
    '\\u4E00-\\u9FFF' + // CJK Unified Ideographs
    '\\uAC00-\\uD7AF' + // Hangul
  ']',
);
const isEnglishOnly = (value) => {
  if (value == null) return true;
  if (typeof value === 'string') return !NON_LATIN_RE.test(value);
  if (Array.isArray(value)) return value.every(isEnglishOnly);
  if (typeof value === 'object') return Object.values(value).every(isEnglishOnly);
  return true;
};

const SOURCE_FIELDS = {
  whyThisArea: ['locality', 'city', 'infra_proximity', 'intelligence_briefs', 'demographics'],
  prosCons: ['kpis', 'dd_progress', 'approvals', 'risk_flags', 'comp_positioning'],
  cashflowLevers: ['kpis', 'capital_stack', 'project_duration', 'sales_velocity'],
  demographicsSynthesis: ['demographics'],
};

const collectSources = (section, payload) => {
  const fields = SOURCE_FIELDS[section] || [];
  return fields.filter((field) => {
    const value = payload?.[field];
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  });
};

const inferConfidence = (section, payload) => {
  const sources = collectSources(section, payload);
  if (sources.length === 0) return 'low';
  if (sources.length >= 3) return 'high';
  return 'medium';
};

const unavailable = (reason) => ({
  available: false,
  reason,
  text: null,
  paragraphs: null,
  pros: null,
  cons: null,
  levers: null,
  paragraph: null,
  confidence: null,
  sources: [],
  disclaimer:
    'AI-assisted narrative could not be generated. Section omitted from export.',
});

const callGemini = async ({ prompt, dealId, organizationId, cacheArgs }) => {
  return runAI({
    task: 'export_narrative',
    provider: 'gemini',
    attach: { dealId, organizationId },
    metadata: { prompt_version: SYSTEM_PROMPT_VERSION },
    cache: cacheArgs,
    run: async ({ providers, model }) => {
      const client = providers.getGeminiClient
        ? providers.getGeminiClient()
        : null;
      // Use the SDK directly so we can issue a text-only generation. The
      // existing `runGeminiInline` helper requires base64Data which we don't
      // have here.
      if (!client) throw new Error('Gemini client unavailable');
      const generative = client.getGenerativeModel({ model });
      const result = await generative.generateContent([
        { text: SYSTEM_PROMPT },
        { text: prompt },
      ]);
      return result.response.text();
    },
  }).then((envelope) => envelope.result);
};

const callOpenAI = async ({ prompt, dealId, organizationId, cacheArgs }) => {
  return runAI({
    task: 'export_narrative',
    provider: 'openai',
    attach: { dealId, organizationId },
    metadata: { prompt_version: SYSTEM_PROMPT_VERSION, fallback: 'openai' },
    cache: cacheArgs,
    run: async ({ providers, model }) => {
      const client = providers.getOpenAIClient
        ? providers.getOpenAIClient()
        : null;
      if (!client) throw new Error('OpenAI client unavailable');
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
      });
      return completion.choices?.[0]?.message?.content || '';
    },
  }).then((envelope) => envelope.result);
};

// PR-NX42 (2026-05-18) — tertiary fallback: Claude Sonnet 4.6.
//
// Pre-NX42 the cascade was Gemini → OpenAI → unavailable. The Jigani
// DOCX export silently rendered the "AI-assisted Pros & Cons synthesis
// is not available" placeholder because both Gemini and OpenAI were
// momentarily unreachable. Claude — wired everywhere else in the AI
// stack — was not in the cascade. NX42 adds it.
//
// runClaudeReasoning is the same primitive used by dealBriefing.service
// and export.insights.service so behavior is consistent. We extract the
// inner text via the envelope's `.result` accessor.
const callClaude = async ({ prompt, dealId, organizationId, cacheArgs }) => {
  return runAI({
    task: 'export_narrative',
    provider: 'claude',
    attach: { dealId, organizationId },
    metadata: { prompt_version: SYSTEM_PROMPT_VERSION, fallback: 'claude' },
    cache: cacheArgs,
    run: async ({ providers, model }) => {
      // Use the Claude reasoning primitive directly — same shape as the
      // dealBriefing service so cost-cap + ai_call_logs telemetry works.
      return providers.runClaudeReasoning({
        systemPrompt: SYSTEM_PROMPT,
        payload: prompt,
        // Pros & Cons typically needs ~600 tokens; bump to 900 for
        // headroom on retail / hospitality with complex CAM / USALI deals.
        maxTokens: 900,
        model,
      });
    },
  }).then((envelope) => envelope.result);
};

const buildUserPrompt = (section, payload) => {
  const schema = SECTION_SCHEMAS[section];
  if (!schema) {
    throw new Error(`exportNarrative: unknown section "${section}"`);
  }
  return [
    `Section: ${section}`,
    `Description: ${schema.description}`,
    `Output schema: ${JSON.stringify(schema.schema)}`,
    `Instructions: ${schema.instructions}`,
    `Payload: ${JSON.stringify(payload, null, 2)}`,
  ].join('\n\n');
};

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);

const generateSection = async ({
  section,
  payload = {},
  dealId = null,
  organizationId = null,
} = {}) => {
  if (!SECTION_SCHEMAS[section]) {
    return unavailable(`Unknown section "${section}"`);
  }

  const availability = getProviderAvailability();
  // PR-NX42 (2026-05-18) — Claude is now in the cascade. Allow the call
  // to proceed as long as ANY one provider is configured.
  if (!availability.gemini && !availability.gpt_compatible && !availability.claude) {
    return unavailable('No narrative provider configured (Gemini, OpenAI, and Claude keys all missing)');
  }

  const prompt = buildUserPrompt(section, payload);
  const cacheArgs = {
    enabled: true,
    inputSha256: sha256({ section, payload, dealId }),
    promptSha256: sha256({ system: SYSTEM_PROMPT, user: prompt }),
    promptVersion: SYSTEM_PROMPT_VERSION,
    ttlSeconds: 90 * 24 * 3600,
  };

  let raw = null;
  // PR-NX42 (2026-05-18) — collect EVERY tier's error so the operator
  // sees the full diagnostic when all three providers are down.
  const errors = [];
  let providerUsed = null;

  if (availability.gemini) {
    try {
      raw = await withTimeout(
        callGemini({ prompt, dealId, organizationId, cacheArgs }),
        SECTION_TIMEOUT_MS,
        'Gemini narrative call',
      );
      if (raw) providerUsed = 'gemini';
    } catch (err) {
      errors.push(`Gemini: ${err.message}`);
      raw = null;
    }
  } else {
    errors.push('Gemini not configured');
  }

  if (!raw && availability.gpt_compatible) {
    try {
      raw = await withTimeout(
        callOpenAI({ prompt, dealId, organizationId, cacheArgs }),
        SECTION_TIMEOUT_MS,
        'OpenAI narrative call',
      );
      if (raw) providerUsed = 'openai';
    } catch (err) {
      errors.push(`OpenAI: ${err.message}`);
      raw = null;
    }
  } else if (!raw) {
    errors.push('OpenAI not configured');
  }

  // PR-NX42 (2026-05-18) — tertiary Claude fallback. Closes the silent-
  // outage gap from the Jigani DOCX where both Gemini and OpenAI were
  // momentarily unreachable and the Pros & Cons section fell through to
  // placeholder text. Claude is now the resilience layer the rest of the
  // AI stack already uses.
  if (!raw && availability.claude) {
    try {
      raw = await withTimeout(
        callClaude({ prompt, dealId, organizationId, cacheArgs }),
        SECTION_TIMEOUT_MS,
        'Claude narrative call',
      );
      if (raw) providerUsed = 'claude';
    } catch (err) {
      errors.push(`Claude: ${err.message}`);
      raw = null;
    }
  } else if (!raw) {
    errors.push('Claude not configured');
  }

  if (!raw) {
    // All available providers failed — surface the full diagnostic so
    // the operator knows whether it's keys, rate-limits, or outage.
    return unavailable(`All providers failed: ${errors.join('; ')}`);
  }

  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== 'object') {
    return unavailable('Model returned unparseable content');
  }

  if (!isEnglishOnly(parsed)) {
    return unavailable('Model returned non-English content; rejected per English-only rule');
  }

  const sources = collectSources(section, payload);
  const confidence = inferConfidence(section, payload);
  const disclaimer = 'AI-assisted synthesis. Verify all interpretations against source data before decisions.';

  // Section-specific shape coercion. Always returns the canonical envelope
  // even when the model returned an unexpected key set — better to render
  // an empty section than crash the export.
  //
  // PR-NX42 (2026-05-18) — `provider` (gemini/openai/claude) lets DOCX /
  // PPTX surface "Synthesis: claude · auto-failover: Gemini timed out;
  // OpenAI 429..." in the footer so the operator knows which model
  // produced the content and whether a fallback rescued the call.
  const fallbackReason = errors.length > 0
    ? `${errors.join('; ')} — auto-failover succeeded on ${providerUsed}`
    : null;

  const base = {
    available: true,
    section,
    confidence,
    sources,
    disclaimer,
    rawProvider: raw,
    provider: providerUsed,
    fallbackReason,
  };

  if (section === 'whyThisArea') {
    const paragraphs = Array.isArray(parsed.paragraphs)
      ? parsed.paragraphs.filter((p) => typeof p === 'string').slice(0, 3).map((s) => s.trim())
      : [];
    return {
      ...base,
      paragraphs,
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : null,
      text: paragraphs.join('\n\n'),
    };
  }
  if (section === 'prosCons') {
    const trim = (s) => (typeof s === 'string' ? s.trim() : '');
    const pros = Array.isArray(parsed.pros) ? parsed.pros.map(trim).filter(Boolean).slice(0, 5) : [];
    const cons = Array.isArray(parsed.cons) ? parsed.cons.map(trim).filter(Boolean).slice(0, 5) : [];
    return { ...base, pros, cons, text: null };
  }
  if (section === 'cashflowLevers') {
    const levers = Array.isArray(parsed.levers)
      ? parsed.levers.filter((s) => typeof s === 'string').map((s) => s.trim()).slice(0, 5)
      : [];
    return { ...base, levers, text: null };
  }
  if (section === 'demographicsSynthesis') {
    return {
      ...base,
      paragraph: typeof parsed.paragraph === 'string' ? parsed.paragraph.trim() : null,
      text: typeof parsed.paragraph === 'string' ? parsed.paragraph.trim() : null,
    };
  }
  return { ...base, raw: parsed };
};

module.exports = {
  generateSection,
  // Internal exports for tests and advanced consumers.
  SECTION_SCHEMAS,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_VERSION,
  __internal: {
    parseJson,
    isEnglishOnly,
    collectSources,
    inferConfidence,
    buildUserPrompt,
  },
};
