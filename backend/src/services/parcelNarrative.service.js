'use strict';

/**
 * Claude-generated parcel verdict narrative.
 *
 * CLAUDE.md hard rules respected:
 *   - Never use LLMs for math, rule decisions, or core underwriting calculations.
 *     This service ONLY summarises the deterministic snapshot — the verdict
 *     label, confidence pct, red flags, and bucket counts are computed by
 *     pure JS in parcelIntelligence.service.js. We pass them in and ask
 *     Claude to phrase them for an analyst.
 *   - Every AI-synthesized narrative carries an "AI-assisted — requires
 *     human review" label. The narrative endpoint returns a `disclaimer`
 *     field that the UI MUST render visibly.
 *   - Claude never invents zone codes, FAR values, guidance numbers, or
 *     citations. The system prompt restricts its scope to rephrasing the
 *     payload it receives.
 */

const { runAI } = require('./ai/aiRouter');
const { getProviderAvailability } = require('./ai/providerRegistry');
const { getParcelIntelligence } = require('./parcelIntelligence.service');
const { createError } = require('../middleware/errorHandler');

const SYSTEM_PROMPT = `
You are a senior real-estate underwriting analyst at a Bengaluru private equity fund.
You are summarising a deterministic Parcel Intelligence snapshot for an Investment
Committee briefing. The snapshot's facts (zone, FAR, guidance value, red flags,
confidence) are produced by deterministic Indian-regulation engines and are NOT
to be questioned, recalculated, or amended.

Your job is ONLY to phrase what the snapshot says into a 2-paragraph executive
narrative for the deal team. Strict constraints:

1. NEVER invent zone codes, FAR values, guidance numbers, dates, owners, areas,
   or citations. If a value is missing in the payload, write "—" or "not yet
   captured" — never guess.
2. Never make legal claims about title, RERA, or zoning compliance.
3. Use Indian English, plain investor-grade language. No code identifiers.
4. ~110 words total. Two paragraphs. The first names the verified ground truth
   and the headline buildability. The second names the red flags and the next
   verification steps in priority order.
5. Begin with the deal/locality context. End with one specific next action.
6. Do not output markdown headings, bullet lists, or code fences. Plain prose only.
7. Do not append disclaimers — the UI adds them.
`.trim();

const buildPayload = (intelligence) => {
  const verdict = intelligence?.verdict || {};
  const confidence = intelligence?.confidence || {};
  const flags = intelligence?.red_flags || [];
  const buckets = intelligence?.buckets || {};
  const buildability = intelligence?.buildability?.values || {};
  const guidance = intelligence?.guidance_value?.selected || null;
  const kgis = intelligence?.kgis || {};
  const inputs = intelligence?.inputs || {};
  const osm = intelligence?.osm_road || {};

  return {
    parcel: {
      name: inputs.name || null,
      address: inputs.address || null,
      city: inputs.city || null,
      land_area_sqft: inputs.land_area_sqft || null,
      road_width_mtrs: inputs.road_width_mtrs || null,
    },
    verdict: {
      label: verdict.label,
      summary: verdict.summary,
      confidence_pct: verdict.confidence_pct,
      counts: verdict.counts,
    },
    confidence: {
      overall: confidence.overall,
      zoning: confidence.zoning,
      buildability: confidence.buildability,
      guidance: confidence.guidance,
      kgis: confidence.kgis,
    },
    zoning: {
      zone_code: intelligence?.zoning?.zone_code,
      zone_name: intelligence?.zoning?.zone_name,
      planning_zone: intelligence?.zoning?.planning_zone,
      plan_version: intelligence?.zoning?.plan_version,
      plan_status: intelligence?.zoning?.plan_status,
    },
    buildability: {
      status: intelligence?.buildability?.status,
      max_far: buildability.max_far ?? null,
      base_far: buildability.base_far ?? null,
      max_buildable_area_sqft: buildability.max_buildable_area_sqft ?? null,
      ground_coverage_pct: buildability.ground_coverage_pct ?? null,
      setback_input_status: buildability.setback_input_status ?? null,
    },
    guidance_value: guidance ? {
      locality: guidance.locality,
      road_name: guidance.road_name,
      value_inr_per_sqft: guidance.value_inr_per_sqft,
    } : null,
    kgis_hierarchy: kgis.hierarchy || null,
    osm_inferred_road: osm.status === 'matched' ? {
      width_m: osm.inferred_width_m,
      highway: osm.inferred_highway,
      derivation_method: osm.derivation_method,
    } : null,
    red_flags: flags.map((f) => ({ severity: f.severity, label: f.label, detail: f.detail })),
    bucket_counts: {
      verified: (buckets.verified || []).length,
      inferred: (buckets.inferred || []).length,
      needs_verification: (buckets.needs_verification || []).length,
    },
  };
};

const generateNarrative = async ({ propertyId, userId = null, dealId = null }) => {
  if (!propertyId) {
    throw createError('propertyId is required.', 400);
  }

  if (!getProviderAvailability().claude) {
    throw createError('Claude is not configured. Set ANTHROPIC_API_KEY to enable parcel narrative generation.', 503);
  }

  const intelligence = await getParcelIntelligence(propertyId, userId);
  if (!intelligence) {
    throw createError('No parcel intelligence snapshot available.', 404);
  }

  const payload = buildPayload(intelligence);

  const { result, callId, latencyMs, cost, tokens } = await runAI({
    task: 'reasoning',
    provider: 'claude',
    attach: {
      userId,
      dealId,
      // We don't have an evidence_source_id here — narrative is a deal-scoped
      // synthesis, not a per-source extraction.
    },
    metadata: {
      kind: 'parcel_verdict_narrative',
      property_id: propertyId,
      verdict_label: payload.verdict?.label,
      confidence_pct: payload.verdict?.confidence_pct,
    },
    run: async ({ providers, model }) => {
      const message = await providers.runClaudeReasoning({
        systemPrompt: SYSTEM_PROMPT,
        payload,
        model,
        maxTokens: 500,
      });
      return { result: message, raw: { usage: null } };
    },
  });

  return {
    property_id: propertyId,
    snapshot_id: intelligence.snapshot_id,
    narrative: result?.trim() || '',
    disclaimer: 'AI-assisted — requires human review. Generated by Claude from the deterministic snapshot. Numbers, citations, and red flags are computed by REDIP engines, not the language model.',
    generated_at: new Date().toISOString(),
    telemetry: {
      ai_call_id: callId,
      latency_ms: latencyMs,
      cost_usd: cost,
      total_tokens: tokens?.totalTokens,
    },
  };
};

module.exports = {
  generateNarrative,
};
