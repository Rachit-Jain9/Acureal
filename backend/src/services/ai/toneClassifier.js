'use strict';

/**
 * Diagnostic-tone classifier — second-line defence for the AI Deal Doctor.
 *
 * The Deal Doctor's narrator emits short findings; the JSON schema enforces
 * verb + length bounds, but cannot detect tone drift inside well-formed JSON.
 * This classifier catches:
 *
 *   • Theatrical language     — "this deal is dead", "your numbers are
 *                                dreaming", "the strategy is a fantasy"
 *   • Slander-grade claims    — addressing the promoter's competence
 *                                or intent, not just their track record
 *   • Absolute legal verdicts — "title is clear", "RERA-compliant",
 *                                "approval will be granted"
 *   • Hedge-padding           — "may possibly potentially perhaps need
 *                                to be considered for re-examination"
 *
 * Two implementations:
 *
 *   1. **Local regex-based** (fast, free, never fails). Catches the high-
 *      frequency patterns. Used in production unless the operator explicitly
 *      opts into the second tier.
 *
 *   2. **Gemini-Flash classifier** (slower, AI-quality, costs ~$0.0001/call).
 *      Used as a second pass when `TONE_CLASSIFIER_USE_AI=true`. Honours
 *      the AI router's cost cap + cache. Falls open on any failure.
 *
 * Both return `true` for "tone OK" and `false` for "rejected — fall back to
 * deterministic template".
 */

const log = require('../../lib/logger').child({ module: 'ai.tone-classifier' });

// ─────────────────────────────────────────────────────────────────────────────
// Theatrical / slander / hedge phrases — fast regex pass
// ─────────────────────────────────────────────────────────────────────────────

const THEATRICAL_PATTERNS = [
  /\b(this deal is dead|deal is dead|deal seems dead)\b/i,
  /\bnumbers are (dreaming|fantasy|nonsense|made[\s-]?up|fake)\b/i,
  /\b(velocity|absorption|price)\b[^.]{0,60}\bfake\b/i,
  /\b(strategy|plan|model) (is|seems) (?:a |an |pure )?(fantasy|fiction|nonsense|joke|absurd|insane|crazy)\b/i,
  /\b(joke|insane|absurd|crazy)\b[^.]{0,30}\b(deal|underwriting|model)\b/i,
  /\b(?:deal|underwriting|model|strategy|plan|absorption|velocity|pricing) (?:is|seems|are|looks?) (?:a |an |pure |utterly |completely )?(?:joke|insane|absurd|crazy|nonsense|fantasy|fiction)\b/i,
  /\bmust be (?:utterly |completely )?(fixed|rebuilt) (?:now|immediately)\b/i,
  /\b(walk away|do not (?:do this|touch this))\b/i,
];

const SLANDER_PATTERNS = [
  /\b(?:promoter|developer|sponsor|landowner) (?:is|appears|seems) (?:incompetent|dishonest|fraudulent|unreliable|untrustworthy|reckless|lying|deceptive)\b/i,
  /\b(?:promoter|developer|sponsor|landowner)\b[^.]{0,40}\b(?:can'?t be trusted|cannot be trusted|will fail|always fails)\b/i,
];

const LEGAL_VERDICT_PATTERNS = [
  /\btitle is (?:clear|good|fine|fully clean|unencumbered)\b/i,
  /\bRERA[\s-]?(?:compliant|approved|valid|certified)\b/i,
  /\b(?:approval|sanction) (?:will be|is) (?:granted|approved|certain)\b/i,
  /\b(?:guarantee[ds]?|warrant[ds]?)\b[^.]{0,50}\b(?:returns|outcome|approval|title|RERA|profit)\b/i,
];

const HEDGE_PILE_PATTERNS = [
  /\b(may|might|could|possibly|perhaps|potentially)\b[^.]{0,15}\b(may|might|could|possibly|perhaps|potentially)\b[^.]{0,15}\b(may|might|could|possibly|perhaps|potentially)\b/i,
];

const ALL_PATTERNS = [
  ...THEATRICAL_PATTERNS,
  ...SLANDER_PATTERNS,
  ...LEGAL_VERDICT_PATTERNS,
  ...HEDGE_PILE_PATTERNS,
];

/**
 * Local fast-path classifier. Returns `{ ok, reason }` where ok=true means
 * the prose passes the tone bar. `reason` is null on pass, or the matched
 * pattern category on reject.
 */
const classifyLocal = (text) => {
  if (typeof text !== 'string' || text.length === 0) return { ok: true, reason: null };

  for (const pattern of THEATRICAL_PATTERNS) {
    if (pattern.test(text)) return { ok: false, reason: 'theatrical' };
  }
  for (const pattern of SLANDER_PATTERNS) {
    if (pattern.test(text)) return { ok: false, reason: 'slander' };
  }
  for (const pattern of LEGAL_VERDICT_PATTERNS) {
    if (pattern.test(text)) return { ok: false, reason: 'legal_verdict' };
  }
  for (const pattern of HEDGE_PILE_PATTERNS) {
    if (pattern.test(text)) return { ok: false, reason: 'hedge_pile' };
  }
  return { ok: true, reason: null };
};

// ─────────────────────────────────────────────────────────────────────────────
// AI second-pass classifier (optional)
// ─────────────────────────────────────────────────────────────────────────────

const buildClassifierPrompt = (text) => `You are a tone classifier for an institutional real-estate diagnostic platform.

Score the following diagnostic finding on whether its tone is acceptable.

ACCEPTABLE tone is:
  • Institutional, analytical, sharp, diagnostic.
  • Quantitative observations only ("28 units/quarter is 2.15× the comp median").
  • Specific, evidence-backed, neutral.

UNACCEPTABLE tone is:
  • Theatrical, slang, gimmicky ("this deal is dead", "your numbers are dreaming").
  • Slander-grade about the promoter's competence or intent.
  • Absolute legal verdicts ("title is clear", "RERA-compliant", "approval will be granted").
  • Hedge piles (stacking "may possibly potentially perhaps").

Return STRICT JSON:
{
  "ok": true | false,
  "reason": "acceptable" | "theatrical" | "slander" | "legal_verdict" | "hedge_pile" | "other"
}

Finding:
"""
${text}
"""`;

/**
 * AI second-pass classifier. Disabled by default; opted into via
 * `TONE_CLASSIFIER_USE_AI=true`. Uses Gemini-Flash for cost; falls back to
 * the local classifier's result on any failure.
 */
const classifyWithAI = async (text) => {
  if (process.env.TONE_CLASSIFIER_USE_AI !== 'true') {
    return classifyLocal(text);
  }
  // Late-require so test files that mock aiRouter aren't double-mocked.
  // eslint-disable-next-line global-require
  const aiRouter = require('./aiRouter');
  try {
    const { result } = await aiRouter.runAI({
      task: 'tone_classification',
      provider: 'gemini',
      metadata: { kind: 'deal_doctor_tone' },
      run: async ({ providers, model }) =>
        providers.runGeminiInline({ prompt: buildClassifierPrompt(text), model }),
    });
    const raw = typeof result === 'string' ? result : result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return classifyLocal(text);
    const parsed = JSON.parse(raw.replace(/```(?:json)?\s*|\s*```/g, ''));
    if (typeof parsed?.ok === 'boolean') {
      return { ok: parsed.ok, reason: parsed.reason || (parsed.ok ? null : 'other') };
    }
  } catch (err) {
    log.warn('tone_classifier_ai_failed_fail_open', { error: err.message });
  }
  return classifyLocal(text);
};

/**
 * Combined classifier. Local first (fast / free / never fails). If local
 * passes AND the AI second pass is opted in via env, run the AI pass too.
 *
 * Returns a promise resolving to `{ ok, reason, layer }` where `layer` is
 * 'local' or 'ai' depending on which gate decided.
 */
const classify = async (text) => {
  const local = classifyLocal(text);
  if (!local.ok) return { ...local, layer: 'local' };
  if (process.env.TONE_CLASSIFIER_USE_AI !== 'true') return { ...local, layer: 'local' };
  const ai = await classifyWithAI(text);
  return { ...ai, layer: 'ai' };
};

/**
 * Convenience predicate for the narrator: returns a boolean. True = accept.
 *
 * Concatenates the finding + why_it_matters lines before classifying so a
 * single classifier call covers both. Cheaper than two passes.
 */
const isAcceptable = async (narration) => {
  if (!narration) return false;
  const combined = [narration.finding, narration.why_it_matters].filter(Boolean).join(' ');
  if (!combined) return false;
  const result = await classify(combined);
  return result.ok;
};

module.exports = {
  classify,
  classifyLocal,
  classifyWithAI,
  isAcceptable,
  // Exported for tests.
  THEATRICAL_PATTERNS,
  SLANDER_PATTERNS,
  LEGAL_VERDICT_PATTERNS,
  HEDGE_PILE_PATTERNS,
  buildClassifierPrompt,
};
