'use strict';

/**
 * Recommendation Engine — Layer 3: the constrained AI narrator.
 *
 * Layered ON TOP of the deterministic engine. The narrator NEVER invents a
 * recommendation — it only rephrases the deterministic candidate's headline
 * + detail, preserving the verb, topic, evidence, severity, and the
 * underlying signal kinds. The candidate set the user ultimately sees is
 * exactly the one the rule engine produced; only the prose may differ.
 *
 * Hard guarantees:
 *   • Verbs are enforced at the JSON-schema layer (Zod enum). The model
 *     cannot return a verb outside the closed dictionary even if its prompt
 *     drifts.
 *   • Legal-carve-out cards (`ai_narratable: false`) bypass the narrator
 *     entirely at the orchestrator (`index.js`). This file never sees them.
 *   • Per-card narration failure does not cascade — the deterministic
 *     template falls through and the panel still renders the card.
 *   • A feature flag (`RECOMMENDATION_NARRATOR_ENABLED`) lets the operator
 *     disable narration in production without a code revert if the AI router
 *     misbehaves; default is `enabled` so the platform ships with the
 *     better copy.
 *
 * Output shape (per card) — strictly validated:
 *   { verb: <one of allowed>, headline: string ≤200, detail: string ≤350 }
 */

const crypto = require('crypto');
const { z } = require('zod');
const aiRouter = require('../ai/aiRouter');
const log = require('../../lib/logger').child({ module: 'recommendation.narrator' });
const { RECOMMENDATION_VERBS } = require('./recommendationRules');

// The system instruction is identical across providers — hoist it so the
// response-cache key can hash it and the two provider branches stay in lock-step.
const SCHEMA_SYSTEM_PROMPT =
  'You return only strict JSON matching the requested schema. No commentary, no markdown fences.';

// Bump this whenever the narration prompt template OR the output schema changes.
// It folds into the hashed cache descriptor below, so a bump cleanly invalidates
// every previously-cached narration (otherwise a schema tweak could leave stale
// cached responses failing re-validation until they happen to be overwritten).
const NARRATOR_PROMPT_VERSION = 'rec-narrator-v1';

const sha256 = (value) =>
  crypto
    .createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value ?? {}), 'utf8')
    .digest('hex');

// ─────────────────────────────────────────────────────────────────────────────
// JSON schema — the model's response is rejected and reprompted (once) if it
// doesn't match. This is the defensibility line.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_VERBS = z.enum(['Recommend', 'Consider', 'Re-examine', 'Flag', 'Stress-test']);

// Forbidden absolute verbs we want the model to NEVER produce. The schema
// enforces this implicitly (the enum doesn't include them), but we also flag
// them at the orchestrator layer below for an extra defensive check on the
// `headline` text — even if the model returns a valid verb but inserts an
// absolute verb mid-sentence ("you should buy this deal"), we reject the
// narration and fall back to the deterministic template.
const FORBIDDEN_PHRASES = [
  /\b(you should|highly recommend|do not buy|do not invest|definitely|certainly)\b/i,
  /\bguarantee[ds]?\b/i,
  /\b(title is (?:clear|good|fine))\b/i,
  /\bRERA[\s-]?(?:compliant|approved|valid)\b/i,
];

const narrationSchema = z.object({
  verb: ALLOWED_VERBS,
  headline: z.string().min(20).max(220),
  detail: z.string().min(20).max(380),
});

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builder
// ─────────────────────────────────────────────────────────────────────────────

const buildPrompt = (card, ctx) => {
  const deal = ctx?.workspace?.deal || {};
  const assetClass = deal.asset_class || '(unspecified)';
  const dealStructure = deal.deal_structure || '(unspecified)';
  const stage = deal.stage || '(unspecified)';
  const evidenceLines = (card.evidence || [])
    .map((e, i) => `  ${i + 1}. ${e.label}${e.ref ? ` [ref:${e.ref}]` : ''}`)
    .join('\n');

  return `You are Acureal — an India-first, Bengaluru-priority deal intelligence platform.

Rephrase the following recommendation card so the prose is sharper, more
institutional, and easier for a senior deal professional to act on. You may
NOT change the verb, the topic, or the evidence; you may NOT add new
quantitative claims; you may NOT use absolute verbs ("buy", "reject",
"clear", "guarantee", "definitely"). You may NOT assert legal conclusions
about title, RERA, encumbrance, or statutory approvals.

Tone: institutional / analytical / sharp / diagnostic. Never theatrical.
Never slander-grade about the promoter. Bloomberg / Stripe / Linear voice,
never McKinsey-deck.

If the deterministic copy is already excellent and you can't materially
improve it, return it verbatim.

Deal context:
- Asset class:    ${assetClass}
- Deal structure: ${dealStructure}
- Stage:          ${stage}

Card to rephrase:
- Verb:     ${card.verb}
- Topic:    ${card.topic_label} (${card.topic})
- Severity: ${card.severity}/5
- Headline: ${card.headline}
- Detail:   ${card.detail || '(no detail line)'}
- Evidence:
${evidenceLines}

Return STRICT JSON matching this schema:
{
  "verb":     one of "Recommend" | "Consider" | "Re-examine" | "Flag" | "Stress-test",
  "headline": rephrased headline, ≤220 chars,
  "detail":   rephrased detail, ≤380 chars
}

Do not include any commentary outside the JSON.`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Forbidden-phrase guard — runs on the model's text output after schema
// validation. Returns true when the text contains any forbidden phrase.
// ─────────────────────────────────────────────────────────────────────────────

const containsForbiddenPhrase = (text) => {
  if (typeof text !== 'string') return false;
  return FORBIDDEN_PHRASES.some((re) => re.test(text));
};

// ─────────────────────────────────────────────────────────────────────────────
// Single-card narrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rephrase one recommendation candidate. Returns the new `{ headline, detail }`
 * pair on success; returns `null` on any failure, in which case the
 * orchestrator falls back to the deterministic template.
 *
 * The verb the model returns MUST match the candidate's verb — if not, the
 * narration is rejected. This protects against the model "switching" a
 * `Re-examine` to a `Recommend` mid-narration.
 */
const narrateCard = async (card, ctx = {}) => {
  if (!card || !card.ai_narratable) return null;
  if (process.env.RECOMMENDATION_NARRATOR_ENABLED === 'false') return null;

  const prompt = buildPrompt(card, ctx);
  const attach = ctx?.attach || {};

  // Response-cache descriptor. Narration is a pure function of the card content
  // + deal context — all of it is already encoded in `prompt` — so the same
  // card on an unchanged deal viewed again is a cache hit: no SDK round-trip,
  // no token spend, no reprompt, no call-log churn. This is what takes AI off
  // the hot deal-workspace read path for the common case (revisiting a deal,
  // hovering the deals list, re-opening Overview). Mirrors the proven pattern
  // in aiMarketContext.service.js. inputSha256 content-addresses the full input;
  // the version folds in so prompt/schema bumps invalidate cleanly.
  const cache = {
    inputSha256: sha256({ prompt, v: NARRATOR_PROMPT_VERSION }),
    promptSha256: sha256({ system: SCHEMA_SYSTEM_PROMPT, v: NARRATOR_PROMPT_VERSION }),
    promptVersion: NARRATOR_PROMPT_VERSION,
  };

  try {
    const { result } = await aiRouter.runAIWithSchema({
      task: 'recommendation_narration',
      schema: narrationSchema,
      attach,
      cache,
      metadata: {
        rule_id: card.id,
        topic: card.topic,
        verb: card.verb,
        severity: card.severity,
      },
      // Re-prompt once on schema validation failure (the router already
      // implements this — `repromptOnFailure: true` is the default).
      run: async ({ providers, provider, model }) => {
        if (provider === 'openai') {
          return providers.runOpenAIReasoning({
            systemPrompt: SCHEMA_SYSTEM_PROMPT,
            payload: prompt,
            model,
            // Narration is cheap and bounded — keep the cap tight so a runaway
            // generation can't burn the daily budget.
            maxTokens: 600,
          });
        }
        if (provider === 'claude') {
          return providers.runClaudeReasoning({
            systemPrompt: SCHEMA_SYSTEM_PROMPT,
            payload: prompt,
            model,
            maxTokens: 600,
          });
        }
        // Gemini path. Unlike the OpenAI/Claude legs there is no separate
        // system-prompt channel on this helper, so the schema instructions
        // are prepended to the prompt — without them the model returns free
        // prose that fails schema validation on every call.
        return providers.runGeminiInline({
          prompt: `${SCHEMA_SYSTEM_PROMPT}\n\n${prompt}`,
          model,
        });
      },
    });

    // Defence-in-depth: the schema's enum already blocks bad verbs, but
    // we still reject if the model returned a verb that doesn't match the
    // card's verb (it must not switch verbs).
    if (result.verb !== card.verb) {
      log.warn('narrator_verb_mismatch', {
        rule_id: card.id,
        requested_verb: card.verb,
        returned_verb: result.verb,
      });
      return null;
    }

    // Defence-in-depth: scan the prose for forbidden absolute phrases. A
    // model that wrote "I highly recommend you buy this deal" still passes
    // the schema (the verb enum + char length are fine) but violates the
    // tone bar. Reject and fall through to the deterministic template.
    if (containsForbiddenPhrase(result.headline) || containsForbiddenPhrase(result.detail)) {
      log.warn('narrator_forbidden_phrase', {
        rule_id: card.id,
        headline: result.headline.slice(0, 120),
      });
      return null;
    }

    return {
      headline: result.headline,
      detail: result.detail,
    };
  } catch (err) {
    log.warn('narrator_failed', { rule_id: card.id, error: err.message });
    return null;
  }
};

module.exports = {
  narrateCard,
  // Exported for tests.
  narrationSchema,
  FORBIDDEN_PHRASES,
  containsForbiddenPhrase,
  buildPrompt,
  RECOMMENDATION_VERBS,
};
