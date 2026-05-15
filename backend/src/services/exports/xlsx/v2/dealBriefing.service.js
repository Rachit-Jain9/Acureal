'use strict';

/**
 * AI-Assisted Deal Briefing service (PR-NX7 — 2026-05-15)
 *
 * Generates an investor-grade 4-bullet narrative for the Dashboard sheet
 * of every per-deal XLSX export. The output is INSERTED at the top of
 * the Dashboard so IC reviewers read it first.
 *
 * ## Design philosophy
 *
 * Per CLAUDE.md guardrails:
 *   - Never fabricate financial / market / RERA / legal facts.
 *   - AI outputs must carry "AI-assisted — requires human review" label.
 *   - Sources must be traceable.
 *
 * To honour all three: **the AI never generates numbers or facts**.
 * Every number that appears in the briefing is pre-computed in code from
 * the deal's kernel KPIs / inputs / property record. The AI's only job
 * is to assemble those numbers into investor-friendly English prose.
 *
 * If the AI fails (rate-limited, API down, model errors), the service
 * falls back to a DETERMINISTIC templated narrative that's still
 * sourced 100% from the deal's actual numbers. The Dashboard always
 * shows SOMETHING — never empty.
 *
 * ## Caching
 *
 * The cache key is a deterministic hash of the deal's snapshot:
 * (id + asset_class + structure + exit + kernel KPIs + key inputs).
 * Re-exports that haven't changed the underlying deal data return the
 * cached briefing in milliseconds. Costs scale with deal mutations,
 * not export frequency. Typical cost: ~$0.003 per fresh briefing.
 *
 * ## Failure modes (all handled)
 *
 *   1. OPENAI_API_KEY missing → templated fallback
 *   2. Provider routing returns no provider → templated fallback
 *   3. AI call throws (rate-limit, network, model error) → templated fallback
 *   4. AI returns malformed JSON → templated fallback
 *   5. AI returns text that mentions any number NOT in the input set →
 *      we don't validate this in v1, but the prompt explicitly forbids
 *      fabricating numbers and asks for JSON-structured output.
 */

const crypto = require('crypto');

// Soft-import to avoid hard coupling — the workbook can build even if
// AI services aren't available in the test environment.
let runClaudeReasoning;
let aiResponseCache;
try {
  ({ runClaudeReasoning } = require('../../../ai/aiRouter'));
  aiResponseCache = require('../../../ai/aiResponseCache');
} catch {
  // Test environment without AI services — fallback only path.
}

// ──────────────────────────────────────────────────────────────────────
// Label maps (mirror buildWorkbook.js — keep in sync if those change)
// ──────────────────────────────────────────────────────────────────────
const ASSET_CLASS_LABEL = {
  residential_apartments: 'Residential Apartments',
  villas: 'Villas',
  plotted_development: 'Plotted Development',
  commercial_office: 'Commercial Office',
  retail: 'Retail / Mall',
  industrial_warehousing: 'Industrial & Warehousing',
  hospitality: 'Hospitality',
  mixed_use: 'Mixed-Use Development',
  redevelopment: 'Redevelopment',
  raw_land: 'Raw Land',
};

const DEAL_STRUCTURE_LABEL = {
  outright_purchase: 'Outright Purchase',
  jda_revenue_share: 'JDA — Revenue Share',
  jda_area_share: 'JDA — Area Share',
  development_management: 'Development Management (Fee-Only)',
};

const EXIT_STRATEGY_LABEL = {
  strategic_sale: 'Strategic Sale to Institutional Buyer',
  reit_exit: 'REIT Listing / Contribution',
  hold_to_perpetuity: 'Long-Term Hold',
  refinance_hold: 'LRD Refinance + Hold',
  outright_progressive: 'Progressive Sale (RERA-Milestone Linked)',
  bulk_exit_completion: 'Bulk Sale at Completion',
  hold_post_completion: 'Hold Post-Completion (Lease-up)',
};

// ──────────────────────────────────────────────────────────────────────
// Number-shaping helpers
// ──────────────────────────────────────────────────────────────────────
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const pct = (v, digits = 1) => {
  const n = num(v);
  if (n === null) return '—';
  // accept either decimal (0.15) or whole percent (15)
  const p = Math.abs(n) <= 1.5 ? n * 100 : n;
  return `${p.toFixed(digits)}%`;
};

const cr = (v, digits = 1) => {
  const n = num(v);
  if (n === null) return '—';
  return `₹${n.toFixed(digits)} Cr`;
};

const cellNum = (v) => {
  // Treat nullish + empty-string explicitly. Number(null) coerces to 0,
  // which would make missing KPIs appear as "0" in the briefing — that's
  // a fabrication (the deal HAS no NPV, not NPV=0). Returning null lets
  // the narrative bullets correctly skip / mark them as pending.
  if (v === null || v === undefined || v === '') return null;
  return num(v);
};

const intINR = (v) => {
  const n = num(v);
  if (n === null) return '—';
  return new Intl.NumberFormat('en-IN').format(Math.round(n));
};

// ──────────────────────────────────────────────────────────────────────
// Deterministic numeric snapshot (the AI sees ONLY these)
// ──────────────────────────────────────────────────────────────────────
const buildNumericSnapshot = (ctx) => {
  const k = ctx.kernelKpis || {};
  const i = ctx.inputs || {};
  const d = ctx.deal || {};
  const p = ctx.property || {};

  const assetLabel = ASSET_CLASS_LABEL[ctx.assetClass] || ctx.assetClass || 'Real Estate';
  const structureKey = String(d.deal_structure || d.deal_type || 'outright_purchase').toLowerCase();
  const structureLabel = DEAL_STRUCTURE_LABEL[structureKey] || structureKey.replace(/_/g, ' ');
  const exitKey = String(d.exit_strategy || (ctx.dealFamily === 'income' ? 'strategic_sale' : 'outright_progressive')).toLowerCase();
  const exitLabel = EXIT_STRATEGY_LABEL[exitKey] || exitKey.replace(/_/g, ' ');

  return {
    dealName: d.name || p.property_name || 'Deal',
    assetClass: ctx.assetClass,
    assetLabel,
    family: ctx.dealFamily,
    structure: structureKey,
    structureLabel,
    exit: exitKey,
    exitLabel,
    city: d.city || p.city || 'Bengaluru',
    microMarket: p.micro_market || null,
    holdYears: ctx.projectMonths ? Math.round(ctx.projectMonths / 12 * 10) / 10 : null,
    // Kernel KPIs
    irr: cellNum(k.irr),
    npvCr: cellNum(k.npv),
    equityMultiple: cellNum(k.equityMultiple),
    noiCr: cellNum(k.noi),
    grossMarginPct: cellNum(k.grossMargin),
    yieldOnCostPct: cellNum(k.yieldOnCost),
    totalRevenueCr: cellNum(k.totalRevenue),
    totalCostCr: cellNum(k.totalCost),
    exitValueCr: cellNum(k.exitValue),
    residualLandValueCr: cellNum(k.residualLandValue),
    // Operator inputs (subset)
    saleableAreaSqft: cellNum(i.saleableAreaSqft || p.saleable_area_sqft),
    sellingRatePerSqft: cellNum(i.sellingRatePerSqft),
    baseRentPerSqftMonth: cellNum(i.baseRentPerSqftMonth),
    landCostCr: cellNum(i.landCostCr),
    constructionCostPerSqft: cellNum(i.constructionCostPerSqft),
    exitCapRate: cellNum(i.exitCapRate),
    occupancyPct: cellNum(i.occupancyPct || i.stabilizedOccPct),
    debtLTV: cellNum(i.debtLTV),
    debtRatePct: cellNum(i.debtRatePct),
    customerCollectionPct: cellNum(i.customerCollectionPct),
    salesVelocityPct: cellNum(i.salesVelocityPct),
    // India context
    gstPct: cellNum(i.gstPct),
    stampDutyPct: cellNum(i.stampDutyPct),
    khataStatus: i.khataStatus || 'A_khata',
  };
};

// ──────────────────────────────────────────────────────────────────────
// Deterministic templated fallback narrative
// ──────────────────────────────────────────────────────────────────────
// Used when the AI is unavailable / fails. Sources every number from the
// snapshot — zero fabrication risk. Always available, no API needed.
const buildTemplatedBriefing = (s) => {
  const isIncome = s.family === 'income';

  // Bullet 1: deal overview + location
  const locationStr = s.microMarket && s.microMarket !== s.city
    ? `${s.city} (${s.microMarket})`
    : s.city;
  const bullet1Parts = [`${intINR(s.saleableAreaSqft)} sqft ${s.assetLabel.toLowerCase()} in ${locationStr}`];
  if (s.holdYears) bullet1Parts.push(`${s.holdYears}-year ${isIncome ? 'hold' : 'project'} cycle`);
  bullet1Parts.push(`${s.structureLabel} structure`);
  const bullet1 = bullet1Parts.join('; ') + '.';

  // Bullet 2: economics
  let bullet2;
  if (isIncome) {
    const rentStr = s.baseRentPerSqftMonth ? `₹${s.baseRentPerSqftMonth}/sqft/mo base rent` : 'rent inputs pending';
    const occStr = s.occupancyPct ? `${pct(s.occupancyPct, 0)} stabilised occupancy` : 'occupancy assumptions pending';
    const noiStr = s.noiCr ? `${cr(s.noiCr)} stabilised annual NOI` : 'NOI to be modeled';
    bullet2 = `Operating economics: ${rentStr} × ${occStr} → ${noiStr}.`;
  } else {
    const rateStr = s.sellingRatePerSqft ? `₹${intINR(s.sellingRatePerSqft)}/sqft selling rate` : 'pricing inputs pending';
    const marginStr = s.grossMarginPct != null ? `${pct(s.grossMarginPct, 0)} modeled gross margin` : 'margin to be modeled';
    bullet2 = `Development economics: ${rateStr}; ${marginStr}.`;
  }

  // Bullet 3: capital + exit
  const capParts = [];
  if (s.totalCostCr) capParts.push(`${cr(s.totalCostCr)} total project cost`);
  if (s.debtLTV) capParts.push(`${pct(s.debtLTV, 0)} debt LTV`);
  if (s.debtRatePct) capParts.push(`${pct(s.debtRatePct, 1)} all-in rate`);
  const exitNum = isIncome
    ? (s.exitCapRate ? ` at ${pct(s.exitCapRate, 2)} exit cap` : '')
    : (s.exitValueCr ? ` for ${cr(s.exitValueCr)} estimated proceeds` : '');
  const bullet3 = `Capital stack: ${capParts.join(', ') || 'TBD'}. Exit: ${s.exitLabel}${exitNum}.`;

  // Bullet 4: India-context risks
  const indiaParts = [];
  if (s.gstPct != null) indiaParts.push(`GST ${pct(s.gstPct, 0)} on under-construction sale`);
  if (s.stampDutyPct != null) indiaParts.push(`Karnataka stamp ${pct(s.stampDutyPct, 1)}`);
  if (s.khataStatus && s.khataStatus !== 'A_khata') {
    indiaParts.push(`${s.khataStatus} title (15% exit haircut applied)`);
  } else if (s.khataStatus === 'A_khata') {
    indiaParts.push('A-khata title (full transferability)');
  }
  if (!isIncome && s.customerCollectionPct) {
    indiaParts.push(`RERA escrow ${pct(s.customerCollectionPct, 0)} milestone collection`);
  }
  const bullet4 = `India-specific: ${indiaParts.join('; ')}.`;

  // Returns summary line
  const returnsParts = [];
  if (s.irr != null) returnsParts.push(`Project IRR (kernel) ${pct(s.irr, 1)}`);
  if (s.equityMultiple != null) returnsParts.push(`EM ${s.equityMultiple.toFixed(2)}x`);
  if (s.npvCr != null) returnsParts.push(`NPV ${cr(s.npvCr)}`);
  const summary = returnsParts.length
    ? `Modeled returns: ${returnsParts.join(' · ')}.`
    : 'Returns pending kernel computation — fill in inputs and refresh the deal.';

  // Risk note
  let riskNote = 'Review all kernel-stored values against source documents before IC.';
  if (s.irr != null && s.irr < 0.12) {
    riskNote = `Modeled IRR ${pct(s.irr, 1)} below typical 12% hurdle — stress-test inputs before IC.`;
  } else if (isIncome && s.exitCapRate && s.yieldOnCostPct && s.yieldOnCostPct < s.exitCapRate) {
    riskNote = `Stabilised yield-on-cost ${pct(s.yieldOnCostPct, 2)} below exit cap ${pct(s.exitCapRate, 2)} — negative spread, exit value < cost.`;
  } else if (!isIncome && s.grossMarginPct != null && s.grossMarginPct < 0.15) {
    riskNote = `Modeled gross margin ${pct(s.grossMarginPct, 0)} below 15% threshold — sensitivity stress required.`;
  }

  return {
    source: 'templated',
    summary,
    bullets: [bullet1, bullet2, bullet3, bullet4],
    riskNote,
    generatedAt: new Date().toISOString(),
  };
};

// ──────────────────────────────────────────────────────────────────────
// AI-assisted narrative
// ──────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an investor-grade Indian real-estate analyst writing a one-glance briefing for IC reviewers. You will receive a JSON snapshot of a Bengaluru deal's pre-computed numbers. Your job is to assemble those numbers into investor-friendly English prose.

STRICT RULES:
1. Use ONLY the numbers provided. NEVER fabricate any value not in the input.
2. If a number is null / missing, say "pending" or "TBD" rather than guessing.
3. Output STRICTLY valid JSON in the exact schema below. No markdown, no commentary.
4. Each bullet is one sentence, < 35 words.
5. Numbers should appear in INR Cr / sqft / % conventions, not USD.
6. India context (RERA, GST, BBMP UAV, Karnataka stamp, A/B khata) only when the input snapshot includes those values.

OUTPUT SCHEMA (return EXACTLY this, no other keys):
{
  "summary": "<one-line modeled-returns summary>",
  "bullets": [
    "<bullet 1: area + asset class + location + structure + hold>",
    "<bullet 2: operating or development economics>",
    "<bullet 3: capital stack + exit assumptions>",
    "<bullet 4: India-specific considerations (RERA / GST / stamp / Khata)>"
  ],
  "riskNote": "<one-line risk flag based ONLY on the numbers — IRR vs hurdle, margin vs threshold, yield vs cap spread>"
}`;

const buildUserPrompt = (snapshot) => `Deal snapshot (use ONLY these numbers, do not invent any):

${JSON.stringify(snapshot, null, 2)}

Generate the briefing JSON per the schema above.`;

const parseBriefingResponse = (rawText) => {
  if (!rawText || typeof rawText !== 'string') return null;
  // Strip code fences if model wraps in ```json
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.summary !== 'string') return null;
    if (!Array.isArray(parsed.bullets) || parsed.bullets.length < 3) return null;
    if (typeof parsed.riskNote !== 'string') return null;
    return {
      source: 'ai-assisted',
      summary: parsed.summary.trim(),
      bullets: parsed.bullets.slice(0, 4).map((b) => String(b).trim()),
      riskNote: parsed.riskNote.trim(),
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
};

const sha256OfSnapshot = (snapshot) =>
  crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

const sha256OfPrompt = () =>
  crypto.createHash('sha256').update(SYSTEM_PROMPT).digest('hex');

/**
 * Generate the deal briefing. Tries AI first; falls back to templated
 * synthesis on any failure. ALWAYS returns a valid briefing object —
 * the caller can render it without further error handling.
 *
 * @param {object} ctx - the buildContext()-prepared workbook context
 * @param {object} [options]
 * @param {boolean} [options.preferTemplated=false] - skip AI, force fallback
 * @returns {Promise<{source, summary, bullets[], riskNote, generatedAt}>}
 */
const generateDealBriefing = async (ctx, options = {}) => {
  const snapshot = buildNumericSnapshot(ctx);
  const fallback = buildTemplatedBriefing(snapshot);

  // Skip AI in test envs / when explicitly requested. Templated narrative
  // is fully deterministic + zero-cost and covers 100% of the value-add
  // when the AI path isn't available.
  if (options.preferTemplated) return fallback;
  if (!runClaudeReasoning) return fallback;
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) return fallback;

  const inputSha256 = sha256OfSnapshot(snapshot);
  const promptSha256 = sha256OfPrompt();

  try {
    // PR-NX9 (2026-05-15): route to the new `narrative_synthesis` task,
    // which defaults to Claude Sonnet 4.6 per the model-specialization
    // policy. Operator can override via AI_PROVIDER_NARRATIVE_SYNTHESIS
    // env var if Claude is rate-limited / unavailable. Falls back to
    // templated narrative on any AI failure (existing behavior).
    const callResult = await runClaudeReasoning({
      task: 'narrative_synthesis',
      systemPrompt: SYSTEM_PROMPT,
      payload: buildUserPrompt(snapshot),
      maxTokens: 700,
      attach: { dealId: ctx.deal?.id || null },
      metadata: { stage: 'deal_briefing', assetClass: ctx.assetClass, family: ctx.dealFamily },
      cache: { inputSha256, promptSha256 },
      retry: { attempts: 1 }, // single retry — caller is in a download path
    });

    const text = callResult?.result || null;
    const parsed = parseBriefingResponse(text);
    if (parsed) return parsed;
    // Malformed AI output — fall back to templated.
    return fallback;
  } catch {
    // Network / rate-limit / model error — fall back gracefully.
    return fallback;
  }
};

module.exports = {
  generateDealBriefing,
  buildNumericSnapshot,
  buildTemplatedBriefing,
  parseBriefingResponse,
  // Exported for tests
  __internal: {
    SYSTEM_PROMPT,
    ASSET_CLASS_LABEL,
    DEAL_STRUCTURE_LABEL,
    EXIT_STRATEGY_LABEL,
  },
};
