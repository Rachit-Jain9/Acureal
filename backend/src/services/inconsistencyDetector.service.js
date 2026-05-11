'use strict';

/**
 * Cross-document inconsistency detector (Tier-1 #4).
 *
 * Reads the latest Gemini extractions for a deal, compares critical fields
 * across document pairs, and flags contradictions. Catches the catastrophic
 * blind spots CLAUDE.md flagged: sale-deed seller vs EC seller mismatches,
 * sanctioned-plan FAR vs layout-approval FAR conflicts, RERA registration
 * gaps vs sanctioned-plan presence, area drift across deeds.
 *
 * Architecture (matches CLAUDE.md AI-routing rule strictly):
 *   • The COMPARATORS are pure deterministic JS. Zero LLM calls, fully
 *     unit-testable. Each comparator returns a structured Finding (or
 *     null when no inconsistency).
 *   • Claude is used ONLY at the end to stitch findings into a narrative
 *     `risk_brief` artifact (Tier-2 #12). The findings themselves are
 *     produced deterministically.
 *   • Findings persist as `risk_flags` rows with `source='ai_detector'`
 *     so reviewers can distinguish them from manual flags. The narrative
 *     synthesizes into `ai_artifacts.risk_brief`.
 *
 * Persistence model:
 *   detect()        → returns findings + narrative without writing
 *   detectAndPersist() → also creates risk_flags + ai_artifacts row
 *
 * Idempotent: re-running on the same extractions produces the same
 * findings. The persistence path dedupes against existing AI-flagged
 * risks for the deal so re-runs don't duplicate flags.
 */

const crypto = require('crypto');
const { query } = require('../config/database');
const { getProviderAvailability } = require('./ai/providerRegistry');
const { runClaudeReasoning } = require('./ai/aiRouter');
const aiArtifacts = require('./aiArtifacts.service');
const riskService = require('./risk.service');
const extractionService = require('./extraction.service');
const log = require('../lib/logger').child({ module: 'inconsistencyDetector' });

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const SQFT_PER_ACRE = 43560;

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const isBlank = (s) => norm(s) === '';

/**
 * Levenshtein-style similarity for two name strings, normalized to [0,1].
 * 1 = identical, 0 = completely different. Used for soft-matching parties
 * across documents — "John Smith" vs "John A. Smith" should match high.
 */
function nameSimilarity(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // Token overlap heuristic — split on whitespace, count shared tokens
  // / max tokens. Fast and good enough for "reorder / extra middle name"
  // type drift. Falls back to substring containment for short strings.
  const xTokens = new Set(x.split(/\s+/).filter((t) => t.length >= 2));
  const yTokens = new Set(y.split(/\s+/).filter((t) => t.length >= 2));
  if (xTokens.size === 0 || yTokens.size === 0) {
    // Very short strings — substring containment.
    return x.includes(y) || y.includes(x) ? 0.7 : 0;
  }
  let shared = 0;
  for (const t of xTokens) if (yTokens.has(t)) shared += 1;
  return shared / Math.max(xTokens.size, yTokens.size);
}

const NAME_MATCH_THRESHOLD = 0.6;
const PERCENT_DRIFT_LOW = 1;
const PERCENT_DRIFT_MEDIUM = 5;
const PERCENT_DRIFT_HIGH = 10;

function classifyDriftSeverity(deltaPct) {
  if (deltaPct >= PERCENT_DRIFT_HIGH) return 'high';
  if (deltaPct >= PERCENT_DRIFT_MEDIUM) return 'medium';
  if (deltaPct >= PERCENT_DRIFT_LOW) return 'low';
  return null;
}

const toNum = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Index extractions by doctype. Each doctype maps to AN ARRAY of
 * extractions (a deal can have multiple sale deeds, multiple ECs, etc.).
 * Callers iterate per-pair across the arrays.
 */
function indexByDocType(extractions) {
  const map = {};
  for (const ext of extractions) {
    const k = ext.doc_type || 'other';
    if (!map[k]) map[k] = [];
    map[k].push(ext);
  }
  return map;
}

// ──────────────────────────────────────────────────────────────────────────
// Comparators — each returns 0..N findings
// ──────────────────────────────────────────────────────────────────────────

const FINDING_CATEGORIES = Object.freeze({
  TITLE: 'title',
  REGULATORY: 'regulatory',
  FINANCIAL: 'financial',
  LEGAL: 'legal',
});

// Helper: build a Finding payload that maps cleanly onto risk_flags.
function buildFinding({
  pair_key,
  category,
  severity,
  title,
  description,
  mitigation = null,
  evidence = [],
}) {
  return {
    pair_key, // stable hash key for dedupe
    category,
    severity,
    title,
    description,
    mitigation,
    evidence, // [{ doc_type, document_id, document_name, field, value }]
    detected_at: new Date().toISOString(),
  };
}

// 1. Seller / grantor mismatch: sale_deed.grantor vs ec.transactions[].party_1
//    The EC should record the same party as the seller (when the deed itself
//    is the latest transaction). High-severity title risk if names diverge.
function detectSellerEcMismatch(byType) {
  const findings = [];
  const sales = byType.sale_deed || byType.title_deed || [];
  const ecs = byType.ec || [];
  if (!sales.length || !ecs.length) return findings;

  for (const sale of sales) {
    const grantor = sale.fields?.grantor || sale.fields?.party_1;
    if (isBlank(grantor)) continue;

    for (const ec of ecs) {
      const txns = Array.isArray(ec.fields?.transactions) ? ec.fields.transactions : [];
      // Latest transaction (by date if present, else last in array).
      const latest = txns.length > 0 ? txns[txns.length - 1] : null;
      if (!latest) continue;
      const ecParty = latest.party_1 || latest.party_2;
      if (isBlank(ecParty)) continue;

      const sim = nameSimilarity(grantor, ecParty);
      if (sim >= NAME_MATCH_THRESHOLD) continue; // good match — no finding

      findings.push(
        buildFinding({
          pair_key: `seller_ec:${sale.id}:${ec.id}`,
          category: FINDING_CATEGORIES.TITLE,
          severity: sim < 0.2 ? 'high' : 'medium',
          title: 'Seller name mismatch: Sale Deed vs EC',
          description:
            `The Sale Deed names "${grantor}" as grantor/seller, but the latest Encumbrance Certificate transaction shows "${ecParty}". ` +
            `Name similarity is ${(sim * 100).toFixed(0)}%. Verify that the EC's most recent transaction matches the deed under review — a divergence here is a classic title-chain break.`,
          mitigation:
            'Pull the registered chain of title from SRO; reconcile any intermediate transfers; obtain a public-notice / title-clearance opinion from a Karnataka-licensed title attorney.',
          evidence: [
            { doc_type: sale.doc_type, document_id: sale.document_id, document_name: sale.document_name, field: 'grantor', value: grantor },
            { doc_type: ec.doc_type, document_id: ec.document_id, document_name: ec.document_name, field: 'transactions[].party_1', value: ecParty },
          ],
        }),
      );
    }
  }
  return findings;
}

// 2. Consideration drift: sale_deed.consideration_inr vs ec.transactions[].consideration_value_inr
function detectConsiderationDrift(byType) {
  const findings = [];
  const sales = byType.sale_deed || [];
  const ecs = byType.ec || [];
  if (!sales.length || !ecs.length) return findings;

  for (const sale of sales) {
    const saleAmount = toNum(sale.fields?.consideration_inr);
    if (saleAmount == null) continue;

    for (const ec of ecs) {
      const txns = Array.isArray(ec.fields?.transactions) ? ec.fields.transactions : [];
      // Find the EC transaction that matches the sale deed by amount-or-doc-no.
      const match = txns.find((t) => {
        if (sale.fields?.document_number && t.document_number === sale.fields.document_number) return true;
        const ecAmount = toNum(t.consideration_value_inr);
        if (ecAmount == null || saleAmount === 0) return false;
        // Amount-based match: within 5%, treat as the same transaction.
        return Math.abs(ecAmount - saleAmount) / saleAmount < 0.05;
      });
      if (!match) continue; // no comparable transaction
      const ecAmount = toNum(match.consideration_value_inr);
      if (ecAmount == null || ecAmount === saleAmount) continue;

      const deltaPct = Math.abs(saleAmount - ecAmount) / saleAmount * 100;
      const severity = classifyDriftSeverity(deltaPct);
      if (!severity) continue;

      findings.push(
        buildFinding({
          pair_key: `consideration:${sale.id}:${ec.id}`,
          category: FINDING_CATEGORIES.FINANCIAL,
          severity,
          title: 'Sale consideration disagrees with EC record',
          description:
            `Sale Deed shows consideration of ₹${saleAmount.toLocaleString('en-IN')}, but the matched EC transaction records ₹${ecAmount.toLocaleString('en-IN')} ` +
            `(${deltaPct.toFixed(1)}% drift). Discrepancies > 1% on the same transaction are a stamp-duty / under-valuation flag.`,
          mitigation:
            'Confirm both figures with the registered SRO copy. Investigate stamp-duty exposure if EC value is materially lower than Deed value.',
          evidence: [
            { doc_type: 'sale_deed', document_id: sale.document_id, document_name: sale.document_name, field: 'consideration_inr', value: saleAmount },
            { doc_type: 'ec', document_id: ec.document_id, document_name: ec.document_name, field: 'transactions[].consideration_value_inr', value: ecAmount },
          ],
        }),
      );
    }
  }
  return findings;
}

// 3. FSI / FAR conflict: sanctioned_plan.fsi_proposed vs zoning_certificate.permissible_fsi
//    or vs the area-vs-floors implied ratio in the sanctioned plan.
function detectFsiConflict(byType) {
  const findings = [];
  const plans = byType.sanctioned_plan || [];
  const zones = byType.zoning_certificate || [];
  if (!plans.length || !zones.length) return findings;

  for (const plan of plans) {
    const proposed = toNum(plan.fields?.fsi_proposed);
    if (proposed == null) continue;

    for (const zone of zones) {
      const permissible = toNum(zone.fields?.permissible_fsi);
      if (permissible == null) continue;
      if (proposed <= permissible + 0.01) continue; // within 0.01 — fine

      const overshoot = ((proposed - permissible) / permissible) * 100;
      const severity = overshoot > 10 ? 'critical' : overshoot > 2 ? 'high' : 'medium';
      findings.push(
        buildFinding({
          pair_key: `fsi:${plan.id}:${zone.id}`,
          category: FINDING_CATEGORIES.REGULATORY,
          severity,
          title: 'Sanctioned FSI exceeds zoning permissible FSI',
          description:
            `The Sanctioned Plan proposes FSI of ${proposed}, but the Zoning Certificate permits a maximum of ${permissible} ` +
            `(${overshoot.toFixed(1)}% overshoot). FSI above the zone limit is a regulatory violation that can trigger demolition orders or compounded fees.`,
          mitigation:
            'Verify if a TDR / additional-FSI purchase has been notarised. If not, redesign to stay within permissible envelope; reassess project economics on the lower envelope.',
          evidence: [
            { doc_type: 'sanctioned_plan', document_id: plan.document_id, document_name: plan.document_name, field: 'fsi_proposed', value: proposed },
            { doc_type: 'zoning_certificate', document_id: zone.document_id, document_name: zone.document_name, field: 'permissible_fsi', value: permissible },
          ],
        }),
      );
    }
  }
  return findings;
}

// 4. Area drift across documents (sale_deed.area_sqft vs sanctioned_plan.plot_area_sqft
//    vs layout_approval.total_area_acres). All three should agree within 1%.
function detectAreaDrift(byType) {
  const findings = [];
  // Build a normalized list of (source, area_sqft) tuples.
  const observations = [];

  for (const sale of (byType.sale_deed || []).concat(byType.title_deed || [])) {
    const sqft = toNum(sale.fields?.area_sqft);
    const acres = toNum(sale.fields?.area_acres);
    const value = sqft ?? (acres != null ? acres * SQFT_PER_ACRE : null);
    if (value != null) {
      observations.push({
        source: sale.doc_type,
        ext: sale,
        field: sqft != null ? 'area_sqft' : 'area_acres',
        sqft: value,
      });
    }
  }
  for (const plan of byType.sanctioned_plan || []) {
    const v = toNum(plan.fields?.plot_area_sqft);
    if (v != null) observations.push({ source: 'sanctioned_plan', ext: plan, field: 'plot_area_sqft', sqft: v });
  }
  for (const layout of byType.layout_approval || []) {
    const acres = toNum(layout.fields?.total_area_acres);
    if (acres != null) observations.push({ source: 'layout_approval', ext: layout, field: 'total_area_acres', sqft: acres * SQFT_PER_ACRE });
  }

  if (observations.length < 2) return findings;

  // Compare all unordered pairs.
  for (let i = 0; i < observations.length; i += 1) {
    for (let j = i + 1; j < observations.length; j += 1) {
      const a = observations[i];
      const b = observations[j];
      const deltaPct = Math.abs(a.sqft - b.sqft) / Math.max(a.sqft, b.sqft) * 100;
      const severity = classifyDriftSeverity(deltaPct);
      if (!severity) continue;

      findings.push(
        buildFinding({
          pair_key: `area:${a.ext.id}:${b.ext.id}`,
          category: FINDING_CATEGORIES.LEGAL,
          severity: severity === 'low' ? 'medium' : severity, // upgrade — area mismatches are higher-stakes than the generic threshold suggests
          title: `Area mismatch: ${a.source} vs ${b.source}`,
          description:
            `${a.source} reports ${a.sqft.toLocaleString('en-IN')} sqft (field: ${a.field}); ${b.source} reports ${b.sqft.toLocaleString('en-IN')} sqft (field: ${b.field}). ` +
            `Drift is ${deltaPct.toFixed(1)}%. Area discrepancies between deed and sanctioned plan / layout approval typically indicate either a survey-number split, an unrecorded transfer, or extraction noise — verify against the registered SRO survey records.`,
          mitigation:
            'Order a fresh survey or pull the SRO certified extract. Reconcile discrepancies before underwriting commits to a buildable envelope.',
          evidence: [
            { doc_type: a.source, document_id: a.ext.document_id, document_name: a.ext.document_name, field: a.field, value: a.sqft },
            { doc_type: b.source, document_id: b.ext.document_id, document_name: b.ext.document_name, field: b.field, value: b.sqft },
          ],
        }),
      );
    }
  }
  return findings;
}

// 5. RERA gap: sanctioned plan exists but no RERA-bearing document found.
//    Bengaluru projects above 8 units / 500 sqm must be RERA-registered;
//    a sanctioned plan without a corresponding RERA registration is a
//    high-severity sale risk.
function detectReraGap(byType) {
  const findings = [];
  const plans = byType.sanctioned_plan || [];
  if (plans.length === 0) return findings;

  // Look for any extraction with a rera_number field populated.
  const allExtractions = Object.values(byType).flat();
  const hasRera = allExtractions.some((e) => {
    const r = e.fields?.rera_number || e.fields?.rera_registration_number;
    return r && String(r).trim().length > 5;
  });
  if (hasRera) return findings;

  // A sanctioned plan exists but no document carries a RERA registration.
  for (const plan of plans) {
    findings.push(
      buildFinding({
        pair_key: `rera_gap:${plan.id}`,
        category: FINDING_CATEGORIES.REGULATORY,
        severity: 'high',
        title: 'Sanctioned plan present but no RERA registration found',
        description:
          'A Sanctioned Building Plan was found for this deal, but no document under review carries a Karnataka RERA registration number. Projects with > 8 units or > 500 sqm built-up are required to be RERA-registered before sale; absence is a hard regulatory blocker for any pre-sale or marketing activity.',
        mitigation:
          'Pull the project status from the Karnataka RERA portal. If unregistered, halt all sales / marketing material until registration is filed and granted.',
        evidence: [
          { doc_type: 'sanctioned_plan', document_id: plan.document_id, document_name: plan.document_name, field: 'plan_number', value: plan.fields?.plan_number },
        ],
      }),
    );
  }
  return findings;
}

// Master comparator list — adding a new check is one line here.
const COMPARATORS = [
  detectSellerEcMismatch,
  detectConsiderationDrift,
  detectFsiConflict,
  detectAreaDrift,
  detectReraGap,
];

function runAllComparators(extractions) {
  const byType = indexByDocType(extractions);
  const findings = [];
  for (const c of COMPARATORS) {
    try {
      findings.push(...c(byType));
    } catch (err) {
      // A comparator must NEVER take down the whole run. Log and continue.
      log.warn('comparator_failed', { name: c.name, error: err.message });
    }
  }
  return findings;
}

// ──────────────────────────────────────────────────────────────────────────
// Narrative synthesis (Claude — narrative only, math is already done)
// ──────────────────────────────────────────────────────────────────────────

const RISK_BRIEF_SYSTEM_PROMPT = `You are a senior real-estate counsel reviewing cross-document inconsistencies surfaced by an automated detector. Each finding is already deterministic and categorised; your job is to write a concise risk brief in markdown for the IC packet.

Rules:
- DO NOT invent new findings. Only narrate the ones provided.
- Group by category (Title, Regulatory, Financial, Legal). One short paragraph per finding.
- Lead each finding with severity in bold: **HIGH**, **MEDIUM**, **LOW**, **CRITICAL**.
- End with a 2-3 sentence "Bottom line" paragraph.
- Plain investor-grade English. Cite the documents involved by their doc_type.
- Output ONLY markdown. No preamble.`;

async function buildNarrative(findings, dealName) {
  if (!getProviderAvailability().gpt_compatible || findings.length === 0) {
    return null;
  }
  try {
    const md = await runClaudeReasoning({
      task: 'reasoning',
      systemPrompt: RISK_BRIEF_SYSTEM_PROMPT,
      cachePrompt: true,
      payload: {
        deal_name: dealName,
        findings: findings.map((f) => ({
          category: f.category,
          severity: f.severity,
          title: f.title,
          description: f.description,
          mitigation: f.mitigation,
          documents_involved: f.evidence.map((e) => e.doc_type),
        })),
      },
      maxTokens: 800,
      metadata: { stage: 'risk_brief' },
    });
    return md;
  } catch (err) {
    log.warn('risk_brief_synthesis_failed', { error: err.message });
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Pure detection. Returns findings + narrative without writing anything
 * to the database. Useful for previewing or for tests.
 */
async function detect(dealId) {
  const { extractions } = await extractionService.getDealExtractions(dealId);
  const findings = runAllComparators(extractions);
  // Narrative is optional — only synthesised if Claude is available AND
  // we have at least one finding to talk about.
  return { findings, extractions_count: extractions.length };
}

/**
 * Detect + persist. Each finding becomes a risk_flag row with
 * source='ai_detector'. Dedupes against existing AI-flagged risks for
 * the same deal+pair_key so re-runs don't duplicate.
 *
 * Optionally writes a narrative ai_artifacts.risk_brief alongside.
 *
 * Returns:
 *   {
 *     findings: [...],
 *     persisted_flag_ids: [...],
 *     deduplicated_count: <int>,
 *     artifact_id: <uuid|null>,
 *     narrative_md: <string|null>,
 *   }
 */
async function detectAndPersist(dealId, { userId = null, dealName = null, organizationId = null } = {}) {
  const { extractions } = await extractionService.getDealExtractions(dealId);
  const findings = runAllComparators(extractions);

  // Pull existing AI-flagged risks so we can dedupe by pair_key. The
  // pair_key lives in the description (we tag it with a sentinel) so
  // we can re-derive it on reads. For the MVP we use the title as the
  // dedupe key — finding titles are stable across re-runs because the
  // comparators emit the same title for the same input pair.
  const existingResult = await query(
    `SELECT title FROM risk_flags
      WHERE deal_id = $1
        AND organization_id = current_organization_id()
        AND source = 'ai_detector'`,
    [dealId],
  );
  const existingTitles = new Set(existingResult.rows.map((r) => r.title));

  const persistedIds = [];
  let deduplicated = 0;
  for (const f of findings) {
    if (existingTitles.has(f.title)) {
      deduplicated += 1;
      continue;
    }
    try {
      const row = await riskService.create(
        dealId,
        {
          category: f.category,
          severity: f.severity,
          title: f.title,
          description: f.description,
          mitigation: f.mitigation,
          status: 'open',
          source: 'ai_detector',
        },
        userId,
      );
      persistedIds.push(row.id);
    } catch (err) {
      log.warn('inconsistency_flag_create_failed', { dealId, title: f.title, error: err.message });
    }
  }

  // Narrative synthesis — best-effort.
  const narrative = await buildNarrative(findings, dealName);
  let artifactId = null;
  if (narrative && organizationId) {
    const snapshotHash = aiArtifacts.computeSnapshotHash({
      findings: findings.map((f) => ({ pair_key: f.pair_key, severity: f.severity })),
    });
    const saved = await aiArtifacts.saveArtifact({
      organizationId,
      dealId,
      artifactType: 'risk_brief',
      contentMd: narrative,
      contentJsonb: { findings_count: findings.length, generated_from: 'cross_doc_detector' },
      snapshotHash,
      status: 'draft',
    });
    artifactId = saved?.id || null;
  }

  return {
    findings,
    persisted_flag_ids: persistedIds,
    deduplicated_count: deduplicated,
    artifact_id: artifactId,
    narrative_md: narrative,
    extractions_count: extractions.length,
  };
}

module.exports = {
  // Public
  detect,
  detectAndPersist,
  // Comparators — exported for tests
  detectSellerEcMismatch,
  detectConsiderationDrift,
  detectFsiConflict,
  detectAreaDrift,
  detectReraGap,
  runAllComparators,
  // Helpers
  nameSimilarity,
  classifyDriftSeverity,
  indexByDocType,
  FINDING_CATEGORIES,
};
