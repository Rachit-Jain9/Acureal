'use strict';

/**
 * AI Market-Context Synthesis service (PR-NX67).
 *
 * Generates Claude-authored prose for the FIVE market-context sections of the
 * deal export report when REDIP doesn't have structured verified payload data:
 *
 *   1. whyThisArea            — locality narrative (anchor + demand drivers + risks)
 *   2. demographics           — micro-market population / income / age / literacy
 *   3. jobGrowth              — employment trends, GCCs, tech-park expansions
 *   4. socialInfrastructure   — schools, hospitals, retail, transit, airport
 *   5. supplyDemandPipeline   — competing supply + launch pipeline + absorption
 *
 * RELATIONSHIP TO exportNarrative.service.js:
 *   - exportNarrative.service.js is the STRICT generator. It synthesises ONLY
 *     from explicitly-supplied payload fields. If a field is missing it says
 *     "data not available" — no general-knowledge invention. That's correct
 *     when REDIP has verified data (sale deeds, ingested comps, structured
 *     intelligence briefs) — those are the source of truth.
 *
 *   - aiMarketContext.service.js (this file) is the AUGMENT generator. It is
 *     called as a SECOND-CHANCE FALLBACK when the strict generator returned
 *     `available: false` because no payload data existed. It uses Claude's
 *     general knowledge of Indian / Bengaluru micro-markets to produce a
 *     specific, asset-class-aware narrative — clearly labelled as
 *     general-knowledge synthesis (NOT from a verified REDIP source) so the
 *     IC reader knows to independently verify before acting.
 *
 * HARD RULES (per CLAUDE.md):
 *   - English only. The English-only regex from exportNarrative.service is
 *     re-applied here for defense-in-depth.
 *   - No numeric figures invented (no specific INR/sqft, no specific km
 *     distances, no specific occupancy percentages). LLM may name FACTS
 *     (e.g. "Whitefield has Phoenix Marketcity") but never quote a number
 *     it doesn't have a payload-derived source for.
 *   - No buy/pass recommendation. Synthesis only.
 *   - Mandatory AI-assisted disclaimer baked into every returned envelope
 *     AND the renderer is required to display it prominently.
 *   - Never throws. Every error path returns { available: false, reason }.
 *
 * ROUTING:
 *   - Claude Sonnet 4.6 primary (best at India-specific market knowledge,
 *     least likely to confabulate specifics).
 *   - OpenAI GPT-5.4 fallback (when Claude is down or rate-limited).
 *   - Gemini NOT in this cascade — Gemini is for extraction, not for
 *     india-specific market synthesis.
 *
 * CACHE:
 *   - Same aiRouter cache the strict generator uses — keyed on (deal +
 *     section + payload + prompt). 90-day TTL. Cache hits skip provider.
 *
 * COST CONTROL:
 *   - Each section is ~400-700 output tokens. Bounded by maxTokens=800.
 *   - Per-section call is gated by AI_MARKET_CONTEXT_ENABLED env flag.
 *     Defaults to true; flip to false to disable the augment layer
 *     globally (existing strict layer still runs).
 */

const crypto = require('crypto');
const { runAI } = require('./ai/aiRouter');
const { getProviderAvailability } = require('./ai/providerRegistry');

const SECTION_TIMEOUT_MS = 15000;
const SYSTEM_PROMPT_VERSION = '2026-05-19.v1';

const SYSTEM_PROMPT = `You are a senior real-estate analyst at an India-first private equity firm. You write disciplined investor-grade English prose for the market-context sections of an underwriting export.

YOUR ROLE:
You are called only when REDIP's structured payload has no verified data for the requested section. Your job is to use your general knowledge of the named Indian city + named locality + named asset class to produce a SPECIFIC, ASSET-CLASS-AWARE narrative. The IC reader has been told this content is AI-generated from general knowledge (NOT from a verified REDIP source) and is expected to independently verify before acting.

ABSOLUTE RULES:
- Output strict JSON only. No markdown fences, no preamble, no trailing prose.
- ENGLISH ONLY. Never use Hindi, Kannada, Tamil, or any regional language. Locality names like "Whitefield" / "Hebbal" / "Jigani" stay as English place names. Never transliterate.
- NEVER quote specific numbers you do not have a source for. No specific "₹15,000/sqft", no specific "22 km from airport", no specific "85% occupancy". You may speak QUALITATIVELY: "premium pricing tier", "strong tech-park proximity", "high vacancy in Q1". Numbers in the export come from the deterministic kernel, not from you.
- You MAY name specific facts that are widely known and stable: e.g. "Whitefield houses ITPL / EPIP and has Phoenix Marketcity mall". You may name well-established schools / hospitals / metro stations / tech parks / arterial roads. Do not name specific recent project launches or recent transactions — those need verified-data sources.
- NEVER recommend buy / pass. Synthesis only. Interpretation belongs to the human reader.
- If you genuinely do not have specific knowledge of the requested micro-market (e.g. an unfamiliar tier-3 locality), say so plainly via the "data_quality" field — better to be honest than hallucinate.
- Be concise. Investor-grade tone: factual, balanced, alert to risk, no marketing language.
- Tailor the depth + emphasis to the asset_class. Residential cares about owner-occupier profile + social infra + school catchment. Commercial cares about workforce demographics + Grade-A office vacancy + GCC density. Hospitality cares about traveller mix + corporate demand + leisure draw. Plotted cares about future appreciation drivers + conversion timeline.
- Indian deal conventions: INR Crore, sqft, FSI. Bengaluru / India context.

Section-specific schemas are provided in the user message. Match the schema exactly.`;

const SECTION_SCHEMAS = {
  whyThisArea: {
    description:
      'Synthesise WHY this micro-market deserves investor attention for THIS asset class. ' +
      '3 paragraphs maximum: (1) anchor — what defines the locality, (2) demand drivers ' +
      'specific to the asset class, (3) risk overlay — what to watch.',
    schema: {
      paragraphs: 'string[] — 2 to 3 paragraphs, each 50-100 words',
      summary: 'string — 1 sentence (≤30 words) summarising the locality\'s investment thesis for this asset class',
      data_quality: 'string — "specific" if you have detailed knowledge of this micro-market, "general" if you only know city-level patterns, "unknown" if neither',
    },
    instructions:
      'Use your general knowledge of the named locality. Name specific stable facts (tech parks, malls, metro stations, hospitals, schools) that you know exist there. Do NOT quote distances or prices. Tie everything back to the asset_class.',
  },

  demographics: {
    description:
      'Translate general knowledge of the micro-market\'s population character into a 1-paragraph narrative an IC member can scan in 15 seconds.',
    schema: {
      paragraph: 'string — 1 paragraph, 70-130 words',
      data_quality: 'string — "specific" / "general" / "unknown" per above',
    },
    instructions:
      'Cover the FOUR dimensions an IC asks about: (1) workforce profile + income tier (e.g. "skews young IT professional, upper-middle-income"), (2) language / community mix qualitatively, (3) housing demand character (owner-occupier vs investor vs short-stay), (4) catchment for adjacent malls / schools / hospitals. NO specific numbers — qualitative only. Tailor to asset_class: residential cares about household profile, commercial cares about workforce density, hospitality cares about traveller mix.',
  },

  jobGrowth: {
    description:
      'Synthesise the employment + economic-growth context for this micro-market. ' +
      'What employs people here? Which sectors are growing? Where are corporates expanding?',
    schema: {
      paragraphs: 'string[] — 1 or 2 paragraphs, each 60-110 words',
      bullets: 'string[] — 3 to 5 bullets naming the specific economic anchors (tech park, GCC cluster, manufacturing belt, logistics hub). Each bullet 8-18 words.',
      data_quality: 'string — "specific" / "general" / "unknown" per above',
    },
    instructions:
      'Name specific known anchors (e.g. "ITPL / EPIP in Whitefield", "Manyata Embassy Business Park in Hebbal", "Aerospace SEZ in Devanahalli"). Use general framing for sector trends ("GCC expansion accelerating", "logistics absorption rising post-NLP"). Do NOT quote specific employment figures or GCC counts. Tie to asset_class: residential cares about catchment workforce size + commute patterns, commercial cares about anchor tenants + tech-park vacancy direction.',
  },

  socialInfrastructure: {
    description:
      'Catalogue the social infrastructure that supports this micro-market. ' +
      'Schools, hospitals, retail, transit — what\'s NEARBY, qualitatively.',
    schema: {
      buckets: 'object — keys: schools, hospitals, retail, transit, airport, expressway. Each value is an object with: { presence: "strong" / "adequate" / "thin" / "unknown", named_examples: string[] (1-3 well-known examples or empty array if unknown), notes: string (1 sentence on quality / accessibility) }',
      data_quality: 'string — "specific" / "general" / "unknown" per above',
    },
    instructions:
      'Use your general knowledge of well-known schools / hospitals / metro stations / malls in the named locality. Examples acceptable: "Inventure Academy", "Manipal Hospital", "Phoenix Marketcity", "Whitefield metro station (Purple Line)", "NH-44", "Kempegowda Intl Airport". If you don\'t know a specific named example for a bucket, return an empty array for named_examples and say so in notes. Do NOT quote distances. Tailor depth to asset_class: residential weights schools / hospitals more, hospitality weights airport / corporate hubs.',
  },

  supplyDemandPipeline: {
    description:
      'Qualitative read on the supply and demand pipeline for this micro-market + asset class. ' +
      'What\'s the launch pipeline like? Is absorption matching supply? Where is pricing power?',
    schema: {
      paragraphs: 'string[] — 1 or 2 paragraphs, each 60-100 words',
      caution: 'string — 1 sentence flagging the biggest pipeline risk (e.g. "Heavy launch pipeline in the ₹1.5-2 Cr resi band could compress absorption."). 20-40 words.',
      data_quality: 'string — "specific" / "general" / "unknown" per above',
    },
    instructions:
      'Speak qualitatively about the supply backdrop ("active launch corridor", "supply-constrained luxury band", "saturating Grade-B office stock"). Do NOT quote specific upcoming projects or specific absorption percentages — those need verified-data sources. Tie to asset_class.',
  },
};

const SECTION_KEYS = Object.keys(SECTION_SCHEMAS);

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

// English-only sanity check — same script-blacklist regex as exportNarrative
// for defence-in-depth.
const NON_LATIN_RE = new RegExp(
  '['
    + '\\u0590-\\u05FF' + '\\u0600-\\u06FF' + '\\u0700-\\u074F'
    + '\\u0900-\\u097F' + '\\u0980-\\u09FF' + '\\u0A00-\\u0A7F'
    + '\\u0A80-\\u0AFF' + '\\u0B00-\\u0B7F' + '\\u0B80-\\u0BFF'
    + '\\u0C00-\\u0C7F' + '\\u0C80-\\u0CFF' + '\\u0D00-\\u0D7F'
    + '\\u0D80-\\u0DFF' + '\\u0E00-\\u0E7F' + '\\u0F00-\\u0FFF'
    + '\\u1000-\\u109F' + '\\u3040-\\u309F' + '\\u30A0-\\u30FF'
    + '\\u4E00-\\u9FFF' + '\\uAC00-\\uD7AF'
    + ']',
);
const isEnglishOnly = (value) => {
  if (value == null) return true;
  if (typeof value === 'string') return !NON_LATIN_RE.test(value);
  if (Array.isArray(value)) return value.every(isEnglishOnly);
  if (typeof value === 'object') return Object.values(value).every(isEnglishOnly);
  return true;
};

const unavailable = (reason) => ({
  available: false,
  reason,
  paragraphs: null,
  paragraph: null,
  bullets: null,
  buckets: null,
  summary: null,
  caution: null,
  dataQuality: null,
  confidence: null,
  provider: null,
  fallbackReason: null,
  disclaimer:
    'AI market-context synthesis unavailable. Section uses structured data only or shows the manual-input placeholder.',
});

const callClaude = async ({ prompt, dealId, organizationId, cacheArgs }) => runAI({
  task: 'ai_market_context',
  provider: 'claude',
  attach: { dealId, organizationId },
  metadata: { prompt_version: SYSTEM_PROMPT_VERSION, tier: 'augment' },
  cache: cacheArgs,
  run: async ({ providers, model }) => providers.runClaudeReasoning({
    systemPrompt: SYSTEM_PROMPT,
    payload: prompt,
    maxTokens: 800,
    model,
  }),
}).then((envelope) => envelope.result);

const callOpenAI = async ({ prompt, dealId, organizationId, cacheArgs }) => runAI({
  task: 'ai_market_context',
  provider: 'openai',
  attach: { dealId, organizationId },
  metadata: { prompt_version: SYSTEM_PROMPT_VERSION, tier: 'augment', fallback: 'openai' },
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
      max_tokens: 800,
    });
    return completion.choices?.[0]?.message?.content || '';
  },
}).then((envelope) => envelope.result);

const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
]);

const buildUserPrompt = (section, payload) => {
  const schema = SECTION_SCHEMAS[section];
  if (!schema) throw new Error(`aiMarketContext: unknown section "${section}"`);
  return [
    `Section: ${section}`,
    `Description: ${schema.description}`,
    `Output schema (return JSON matching this shape exactly): ${JSON.stringify(schema.schema)}`,
    `Instructions: ${schema.instructions}`,
    `Context payload: ${JSON.stringify(payload, null, 2)}`,
  ].join('\n\n');
};

const inferConfidence = (parsed) => {
  const dq = String(parsed?.data_quality || '').toLowerCase();
  if (dq === 'specific') return 'medium'; // never "high" — augment is always second-source
  if (dq === 'general') return 'low';
  if (dq === 'unknown') return 'low';
  return 'low';
};

const generateSection = async ({
  section,
  payload = {},
  dealId = null,
  organizationId = null,
} = {}) => {
  if (process.env.AI_MARKET_CONTEXT_ENABLED === 'false') {
    return unavailable('AI_MARKET_CONTEXT_ENABLED=false — augment layer disabled by env flag');
  }
  if (!SECTION_SCHEMAS[section]) {
    return unavailable(`Unknown section "${section}"`);
  }
  if (!payload.locality && !payload.city && !payload.property_name) {
    return unavailable('No locality / city / property name in payload — cannot generate without place anchor');
  }

  const availability = getProviderAvailability();
  if (!availability.claude && !availability.gpt_compatible) {
    return unavailable('Neither Claude nor OpenAI configured for the market-context augment layer');
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
  const errors = [];
  let providerUsed = null;

  if (availability.claude) {
    try {
      raw = await withTimeout(
        callClaude({ prompt, dealId, organizationId, cacheArgs }),
        SECTION_TIMEOUT_MS,
        'Claude market-context call',
      );
      if (raw) providerUsed = 'claude';
    } catch (err) {
      errors.push(`Claude: ${err.message}`);
      raw = null;
    }
  } else {
    errors.push('Claude not configured');
  }

  if (!raw && availability.gpt_compatible) {
    try {
      raw = await withTimeout(
        callOpenAI({ prompt, dealId, organizationId, cacheArgs }),
        SECTION_TIMEOUT_MS,
        'OpenAI market-context call',
      );
      if (raw) providerUsed = 'openai';
    } catch (err) {
      errors.push(`OpenAI: ${err.message}`);
      raw = null;
    }
  } else if (!raw) {
    errors.push('OpenAI not configured');
  }

  if (!raw) {
    return unavailable(`All providers failed: ${errors.join('; ')}`);
  }

  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== 'object') {
    return unavailable('Model returned unparseable content');
  }
  if (!isEnglishOnly(parsed)) {
    return unavailable('Model returned non-English content; rejected per English-only rule');
  }

  const fallbackReason = errors.length > 0
    ? `${errors.join('; ')} — auto-failover succeeded on ${providerUsed}`
    : null;

  const base = {
    available: true,
    section,
    tier: 'augment',
    confidence: inferConfidence(parsed),
    dataQuality: parsed.data_quality || 'unknown',
    provider: providerUsed,
    fallbackReason,
    disclaimer:
      'AI-GENERATED FROM GENERAL KNOWLEDGE (not a verified REDIP source). Verify every named fact, distance, and trend against primary sources before any IC decision.',
  };

  const trim = (s) => (typeof s === 'string' ? s.trim() : '');

  if (section === 'whyThisArea') {
    const paragraphs = Array.isArray(parsed.paragraphs)
      ? parsed.paragraphs.map(trim).filter(Boolean).slice(0, 3)
      : [];
    return {
      ...base,
      paragraphs,
      summary: trim(parsed.summary) || null,
    };
  }

  if (section === 'demographics') {
    return {
      ...base,
      paragraph: trim(parsed.paragraph) || null,
    };
  }

  if (section === 'jobGrowth') {
    const paragraphs = Array.isArray(parsed.paragraphs)
      ? parsed.paragraphs.map(trim).filter(Boolean).slice(0, 2)
      : [];
    const bullets = Array.isArray(parsed.bullets)
      ? parsed.bullets.map(trim).filter(Boolean).slice(0, 5)
      : [];
    return { ...base, paragraphs, bullets };
  }

  if (section === 'socialInfrastructure') {
    const allowedKeys = ['schools', 'hospitals', 'retail', 'transit', 'airport', 'expressway'];
    const rawBuckets = (parsed.buckets && typeof parsed.buckets === 'object') ? parsed.buckets : {};
    const buckets = {};
    allowedKeys.forEach((k) => {
      const v = rawBuckets[k];
      if (!v || typeof v !== 'object') {
        buckets[k] = { presence: 'unknown', named_examples: [], notes: '' };
        return;
      }
      const presence = ['strong', 'adequate', 'thin', 'unknown'].includes(String(v.presence || '').toLowerCase())
        ? String(v.presence).toLowerCase()
        : 'unknown';
      const namedExamples = Array.isArray(v.named_examples)
        ? v.named_examples.map(trim).filter(Boolean).slice(0, 3)
        : [];
      buckets[k] = { presence, named_examples: namedExamples, notes: trim(v.notes) };
    });
    return { ...base, buckets };
  }

  if (section === 'supplyDemandPipeline') {
    const paragraphs = Array.isArray(parsed.paragraphs)
      ? parsed.paragraphs.map(trim).filter(Boolean).slice(0, 2)
      : [];
    return {
      ...base,
      paragraphs,
      caution: trim(parsed.caution) || null,
    };
  }

  return { ...base, raw: parsed };
};

/**
 * Generate all 5 market-context sections in parallel for a deal. Returns
 * a flat envelope keyed by section name. Each section is independent — a
 * failure in one does NOT short-circuit the others.
 *
 * Caller-supplied `payload` is shared across all sections and should contain
 * at minimum:
 *   - locality   (string — e.g. "Jigani" / "Whitefield")
 *   - city       (string — e.g. "Bengaluru")
 *   - asset_class (string — e.g. "residential_apartments")
 *
 * Optional but recommended:
 *   - property_name, micro_market, zoning, deal_type
 */
const generateAllSections = async ({
  payload = {}, dealId = null, organizationId = null,
} = {}) => {
  const enriched = {
    locality: payload.locality || payload.micro_market || null,
    city: payload.city || null,
    asset_class: payload.asset_class || null,
    property_name: payload.property_name || null,
    micro_market: payload.micro_market || null,
    zoning: payload.zoning || null,
    deal_type: payload.deal_type || null,
  };
  const results = await Promise.all(SECTION_KEYS.map((section) => (
    generateSection({ section, payload: enriched, dealId, organizationId })
      .catch((err) => unavailable(`Generator threw: ${err.message}`))
  )));
  const out = {};
  SECTION_KEYS.forEach((section, i) => { out[section] = results[i]; });
  return out;
};

module.exports = {
  generateSection,
  generateAllSections,
  SECTION_KEYS,
  SECTION_SCHEMAS,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_VERSION,
  __internal: {
    parseJson,
    isEnglishOnly,
    inferConfidence,
    buildUserPrompt,
  },
};
