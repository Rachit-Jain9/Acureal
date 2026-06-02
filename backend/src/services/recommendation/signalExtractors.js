'use strict';

/**
 * Recommendation Engine — Layer 1: signal extractors.
 *
 * Given a dealWorkspace payload (the synthesised read-model that already
 * composes deal + financials + comps + DD + approvals + risk + documents)
 * these pure functions emit **named signals** — typed observations that the
 * rule engine (Layer 2) composes into recommendation candidates.
 *
 * Hard rule (CLAUDE.md): every value is read from the kernel / deterministic
 * code. No AI here. Signals carry their own evidence references so any
 * downstream card can click back to source.
 *
 * Each signal is `{ kind, value, evidence, meta }`:
 *   • kind     — stable string identifier (used by recommendationRules.js)
 *   • value    — primitive or small object the rule predicate reads
 *   • evidence — array of `{ ref, label }` pointers the UI uses for the
 *                click-through provenance chain. Refs follow the
 *                `<source>:<id>` convention so the frontend can route them
 *                to the right detail surface.
 *   • meta     — extra fields (counts, deviations) the template may
 *                interpolate.
 *
 * Extractors return `null` when the relevant inputs are missing — the rule
 * engine treats `null` as "signal not available", and any rule that needs
 * the signal silently skips. This is the grace-degradation model — a deal
 * without comps still produces recommendations on the kernel side; a deal
 * without financials still produces recommendations on the comps side.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — pluck values from the workspace payload defensively.
// ─────────────────────────────────────────────────────────────────────────────

const getKpis = (ws) => ws?.financial?.summary?.kpis || ws?.financial?.summary || null;
const getDeal = (ws) => ws?.deal || null;
const getComps = (ws) => {
  const entries = ws?.comps?.entries || ws?.market?.comps || null;
  if (!Array.isArray(entries)) return entries;
  // The price-vs-comp signal labels its median "Verified-comp median", so it
  // must be computed from verified comps only (CLAUDE.md: never present
  // unverified market data as authoritative). is_verified defaults TRUE, so
  // only an explicit false (a comp still in the review queue) is excluded.
  return entries.filter((c) => c && c.is_verified !== false);
};
const getDocuments = (ws) => ws?.documents?.documents || ws?.documents || null;
const getApprovals = (ws) => ws?.approvals || ws?.deal?.approval_items || [];
const getDdItems = (ws) => ws?.dd?.items || ws?.deal?.dd_items || [];
const getRiskFlags = (ws) => ws?.risk?.flags || ws?.deal?.risk_flags || [];
const getPromoter = (ws) => ws?.deal?.promoter_profile || ws?.promoter || null;

// Convert numeric strings on a kpis-like object to plain numbers without
// breaking when the field is already a number or null.
const numField = (obj, key) => {
  if (!obj) return null;
  return num(obj[key]);
};

// ─────────────────────────────────────────────────────────────────────────────
// Financial signal extractors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Land cost as a share of project GDV (gross development value / revenue).
 * Recommendation thresholds: ≥30% yellow, ≥40% red.
 */
const extractLandCostShareOfGdv = (ws) => {
  const kpis = getKpis(ws);
  const deal = getDeal(ws);
  if (!kpis && !deal) return null;
  const landCr = numField(kpis, 'landCr') ?? numField(deal, 'land_ask_price_cr') ?? numField(deal, 'negotiated_price_cr');
  const revenueCr = numField(kpis, 'revenue') ?? numField(kpis, 'totalRevenueCr') ?? numField(kpis, 'gdv_cr');
  if (landCr == null || revenueCr == null || revenueCr <= 0) return null;
  const value = landCr / revenueCr;
  return {
    kind: 'land_cost_share_of_gdv',
    value,
    evidence: [
      { ref: 'kernel:landCr', label: `Land cost ₹${landCr.toFixed(2)} Cr` },
      { ref: 'kernel:revenue', label: `GDV ₹${revenueCr.toFixed(2)} Cr` },
    ],
    meta: { landCr, revenueCr, ratio_pct: Math.round(value * 1000) / 10 },
  };
};

/**
 * IRR vs hurdle (default hurdle 16% if not specified; readable from deal.hurdle_irr_pct).
 */
const extractIrrVsHurdle = (ws) => {
  const kpis = getKpis(ws);
  const deal = getDeal(ws);
  if (!kpis) return null;
  // The kernel emits IRR in PERCENT form (14.0 = 14% p.a.; see
  // packages/financial-kernel kpis.ts irrAnnualPct, and the frontend
  // format.js note "Kernel returns IRR already in percent form"). The hurdle
  // + gap math below is fraction-based (default hurdle 0.16), and the
  // value/evidence/meta blocks re-multiply by 100 for display — so normalise
  // the percent IRR to a fraction ONCE here. Reading it as a raw fraction
  // (the prior bug) made `gap` ~100x off: irr-below-hurdle could never fire
  // and cards/exports printed nonsense like "Base-case IRR 1400.0%" /
  // "138400 bps".
  const irrPct = numField(kpis, 'irr');
  if (irrPct == null) return null;
  const irr = irrPct / 100;
  const hurdle = numField(deal, 'hurdle_irr_pct') ?? 0.16;
  const gap = irr - hurdle;
  return {
    kind: 'irr_vs_hurdle',
    value: { irr, hurdle, gap, gap_bps: Math.round(gap * 10000) },
    evidence: [{ ref: 'kernel:irr', label: `Base-case IRR ${(irr * 100).toFixed(1)}%` }],
    meta: {
      irr_pct: Math.round(irr * 1000) / 10,
      hurdle_pct: Math.round(hurdle * 1000) / 10,
      gap_bps: Math.round(gap * 10000),
    },
  };
};

/**
 * Equity multiple vs target (default target 1.8×).
 */
const extractEquityMultipleVsTarget = (ws) => {
  const kpis = getKpis(ws);
  const deal = getDeal(ws);
  if (!kpis) return null;
  const em = numField(kpis, 'equityMultiple');
  if (em == null) return null;
  const target = numField(deal, 'target_equity_multiple') ?? 1.8;
  return {
    kind: 'equity_multiple_vs_target',
    value: { em, target, gap: em - target },
    evidence: [{ ref: 'kernel:equityMultiple', label: `Equity multiple ${em.toFixed(2)}×` }],
    meta: { em, target },
  };
};

/**
 * DSCR breach detection — looks for the first month DSCR < 1.0 in the
 * monthly debt-service schedule (when present).
 */
const extractDscrBreach = (ws) => {
  const schedule = ws?.financial?.summary?.debt?.dscrMonthly || ws?.financial?.graph?.dscrMonthly;
  if (!Array.isArray(schedule) || schedule.length === 0) return null;
  let firstBreachMonth = null;
  let firstBreachValue = null;
  for (let i = 0; i < schedule.length; i += 1) {
    const dscr = num(schedule[i]?.dscr ?? schedule[i]);
    if (dscr != null && dscr < 1.0) {
      firstBreachMonth = i + 1;
      firstBreachValue = dscr;
      break;
    }
  }
  if (firstBreachMonth == null) return null;
  return {
    kind: 'dscr_breach_month',
    value: { month: firstBreachMonth, value: firstBreachValue },
    evidence: [{ ref: 'kernel:dscrMonthly', label: `Month ${firstBreachMonth} DSCR ${firstBreachValue.toFixed(2)}` }],
    meta: { month: firstBreachMonth, dscr: firstBreachValue },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Market / comps signal extractors
// ─────────────────────────────────────────────────────────────────────────────

const median = (arr) => {
  const sorted = arr.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Sale-price assumption vs verified-comp median (₹/sf). Yellow ≥10% deviation,
 * red ≥20%.
 */
const extractPriceVsCompBand = (ws) => {
  const deal = getDeal(ws);
  const comps = getComps(ws);
  if (!deal || !Array.isArray(comps) || comps.length < 3) return null;
  const assumed = numField(deal, 'sales_price_per_sqft') ?? numField(deal, 'expected_sale_price_per_sqft');
  if (assumed == null) return null;
  const compPrices = comps.map((c) => num(c?.price_per_sqft ?? c?.rate_per_sqft)).filter((n) => n != null);
  if (compPrices.length < 3) return null;
  const compMedian = median(compPrices);
  if (compMedian == null || compMedian <= 0) return null;
  const deviation = (assumed - compMedian) / compMedian;
  return {
    kind: 'price_vs_comp_band',
    value: { assumed, comp_median: compMedian, deviation_pct: deviation, n_comps: compPrices.length },
    evidence: [
      { ref: 'deal:sales_price_per_sqft', label: `Assumption ₹${Math.round(assumed)}/sf` },
      { ref: 'comps:median', label: `Verified-comp median ₹${Math.round(compMedian)}/sf (n=${compPrices.length})` },
    ],
    meta: {
      assumed: Math.round(assumed),
      comp_median: Math.round(compMedian),
      deviation_pct: Math.round(deviation * 1000) / 10,
      n_comps: compPrices.length,
    },
  };
};

/**
 * Quarterly sales velocity vs comp median. ≥1.5× → yellow, ≥2.0× → red.
 */
const extractAbsorptionVsCompBand = (ws) => {
  const deal = getDeal(ws);
  const comps = getComps(ws);
  if (!deal || !Array.isArray(comps) || comps.length < 3) return null;
  const assumed = numField(deal, 'absorption_units_per_quarter') ?? numField(deal, 'sales_velocity_per_quarter');
  if (assumed == null || assumed <= 0) return null;
  const compAbsorptions = comps.map((c) => num(c?.absorption_units_per_quarter ?? c?.velocity_per_quarter)).filter((n) => n != null && n > 0);
  if (compAbsorptions.length < 3) return null;
  const compMedian = median(compAbsorptions);
  if (compMedian == null || compMedian <= 0) return null;
  const multiple = assumed / compMedian;
  return {
    kind: 'absorption_vs_comp_band',
    value: { assumed, comp_median: compMedian, multiple, n_comps: compAbsorptions.length },
    evidence: [
      { ref: 'deal:absorption_units_per_quarter', label: `Assumption ${assumed} units/quarter` },
      { ref: 'comps:absorption_median', label: `Verified-comp median ${compMedian.toFixed(1)} units/quarter (n=${compAbsorptions.length})` },
    ],
    meta: { assumed, comp_median: compMedian, multiple, n_comps: compAbsorptions.length },
  };
};

/**
 * Cap-rate assumption vs comp band (for income assets). Outside the band → flag.
 */
const extractCapRateVsCompBand = (ws) => {
  const deal = getDeal(ws);
  const comps = getComps(ws);
  if (!deal || !Array.isArray(comps) || comps.length < 3) return null;
  const assumed = numField(deal, 'exit_cap_rate_pct');
  if (assumed == null) return null;
  const compCaps = comps.map((c) => num(c?.cap_rate_pct ?? c?.implied_cap_rate)).filter((n) => n != null);
  if (compCaps.length < 3) return null;
  const sorted = compCaps.slice().sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.25)];
  const hi = sorted[Math.floor(sorted.length * 0.75)];
  if (assumed >= lo && assumed <= hi) return null;
  return {
    kind: 'cap_rate_vs_comp_band',
    value: { assumed, band_lo: lo, band_hi: hi, n_comps: compCaps.length },
    evidence: [
      { ref: 'deal:exit_cap_rate_pct', label: `Exit cap ${assumed.toFixed(2)}%` },
      { ref: 'comps:cap_rate_band', label: `Comp band ${lo.toFixed(2)}–${hi.toFixed(2)}% (n=${compCaps.length})` },
    ],
    meta: { assumed, band_lo: lo, band_hi: hi, n_comps: compCaps.length, direction: assumed < lo ? 'below' : 'above' },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Document / extraction signal extractors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracted area vs user-entered saleable area mismatch (>5% deviation).
 */
const extractSaleableAreaMismatch = (ws) => {
  const deal = getDeal(ws);
  if (!deal) return null;
  const inputArea = numField(deal, 'saleable_sqft') ?? numField(deal, 'built_up_sqft');
  const extractedArea = numField(deal, 'extracted_saleable_sqft') ?? numField(deal, 'doc_saleable_sqft');
  if (inputArea == null || extractedArea == null || inputArea <= 0) return null;
  const deviation = Math.abs(extractedArea - inputArea) / inputArea;
  if (deviation < 0.05) return null;
  return {
    kind: 'extracted_area_mismatch',
    value: { input: inputArea, extracted: extractedArea, deviation_pct: deviation },
    evidence: [
      { ref: 'deal:saleable_sqft', label: `Your input ${Math.round(inputArea).toLocaleString()} sf` },
      { ref: 'doc:area_statement', label: `Extracted ${Math.round(extractedArea).toLocaleString()} sf` },
    ],
    meta: {
      input: Math.round(inputArea),
      extracted: Math.round(extractedArea),
      deviation_pct: Math.round(deviation * 1000) / 10,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Approval / RERA signal extractors
// ─────────────────────────────────────────────────────────────────────────────

const REGULATED_RESIDENTIAL_CLASSES = new Set([
  'residential_apartments',
  'plotted_development',
  'villas',
  'mixed_use',
  'redevelopment',
]);

const extractReraRegistrationMissing = (ws) => {
  const deal = getDeal(ws);
  if (!deal) return null;
  if (!REGULATED_RESIDENTIAL_CLASSES.has(deal.asset_class)) return null;
  const approvals = getApprovals(ws);
  const reraEntry = approvals.find((a) => /rera/i.test(a?.approval_type || a?.name || ''));
  if (!reraEntry) {
    return {
      kind: 'rera_registration_missing',
      value: { reason: 'no_entry' },
      evidence: [{ ref: 'approvals:list', label: 'No RERA approval item on file' }],
      meta: { reason: 'no_entry' },
    };
  }
  if (reraEntry.is_validated === true || /validated|approved/i.test(reraEntry.status || '')) return null;
  return {
    kind: 'rera_registration_missing',
    value: { reason: 'not_validated', status: reraEntry.status },
    evidence: [{ ref: `approval:${reraEntry.id || 'rera'}`, label: `RERA status: ${reraEntry.status || 'pending'}` }],
    meta: { reason: 'not_validated', status: reraEntry.status || 'pending' },
  };
};

const extractApprovalGapCount = (ws) => {
  const approvals = getApprovals(ws);
  if (!Array.isArray(approvals) || approvals.length === 0) return null;
  const requiredOpen = approvals.filter(
    (a) => a?.is_required !== false && a?.is_validated !== true && !/validated|approved/i.test(a?.status || ''),
  ).length;
  const requiredTotal = approvals.filter((a) => a?.is_required !== false).length;
  if (requiredTotal === 0) return null;
  return {
    kind: 'approval_gap_count',
    value: { required_open: requiredOpen, required_total: requiredTotal },
    evidence: [{ ref: 'approvals:list', label: `${requiredOpen} of ${requiredTotal} required approvals still open` }],
    meta: { required_open: requiredOpen, required_total: requiredTotal },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// DD signal extractors
// ─────────────────────────────────────────────────────────────────────────────

const extractOverdueDdCount = (ws) => {
  const items = getDdItems(ws);
  if (!Array.isArray(items) || items.length === 0) return null;
  const now = Date.now();
  const overdue = items.filter((d) => {
    if (d?.is_required === false) return false;
    const status = String(d?.status || '').toLowerCase();
    if (!['pending', 'in_progress'].includes(status)) return false;
    if (!d?.due_date) return false;
    return new Date(d.due_date).getTime() < now;
  });
  if (overdue.length === 0) return null;
  return {
    kind: 'overdue_dd_count',
    value: { count: overdue.length },
    evidence: [{ ref: 'dd:overdue', label: `${overdue.length} required diligence item${overdue.length === 1 ? '' : 's'} overdue` }],
    meta: { count: overdue.length },
  };
};

// Statuses that count a DD item as "done" — mirrors READY_STATUSES in
// dealReadiness.service.js so the Recommendation card and the Deal Pulse
// ribbon never show two different counts for the same concept.
const DD_READY_STATUSES = new Set(['completed', 'not_applicable']);

const extractDealBreakerDdCount = (ws) => {
  const items = getDdItems(ws);
  if (!Array.isArray(items) || items.length === 0) return null;
  // Count EXACTLY what dealReadiness.service.buildReadinessSummary counts as
  // `pending_deal_breakers`: required + deal_breaker severity + not in a
  // ready status. Previously this extractor (a) also matched severity
  // 'critical' — which is a RISK severity, never a DD severity (see
  // DD_SEVERITIES in constants/domain.js), so it silently over-counted on
  // any deal whose data carried a stray critical-tagged DD row; (b) skipped
  // the is_required filter; and (c) used a non-DD status set
  // {completed,resolved,cleared}. The result was the Deal Pulse showing "5
  // deal-breakers" while this card said "6 unresolved deal-breaker items" on
  // the same page. Aligning the predicate makes the two numbers agree.
  const dealBreakers = items.filter((d) => {
    if (!d?.is_required) return false;
    if (d?.severity !== 'deal_breaker') return false;
    return !DD_READY_STATUSES.has(String(d?.status || '').toLowerCase());
  });
  if (dealBreakers.length === 0) return null;
  return {
    kind: 'deal_breaker_dd_count',
    value: { count: dealBreakers.length },
    evidence: [{ ref: 'dd:deal_breakers', label: `${dealBreakers.length} unresolved deal-breaker diligence item${dealBreakers.length === 1 ? '' : 's'}` }],
    meta: { count: dealBreakers.length },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Promoter signal extractors
// ─────────────────────────────────────────────────────────────────────────────

const extractPromoterDeliverySlippage = (ws) => {
  const promoter = getPromoter(ws);
  if (!promoter) return null;
  const avgDelay = num(promoter?.avg_delivery_delay_months);
  if (avgDelay == null) return null;
  return {
    kind: 'promoter_delivery_slippage',
    value: { avg_delay_months: avgDelay },
    evidence: [{ ref: 'promoter:profile', label: `Promoter avg delivery delay ${avgDelay} months` }],
    meta: { avg_delay_months: avgDelay },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Open risk-flags signal extractor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cross-document inconsistencies from the inconsistencyDetector.service.
 * The detector persists findings as risk_flags with `source = 'ai_detector'`;
 * this extractor surfaces them as a single grouped signal the Deal Doctor
 * can convert into `Inconsistent`-verb findings. P1-PR4 / Workstream B3:
 * promotes the buried detector to a deal-heartbeat surface.
 */
const extractCrossDocInconsistencies = (ws) => {
  const flags = getRiskFlags(ws);
  if (!Array.isArray(flags) || flags.length === 0) return null;
  const detector = flags.filter(
    (f) => String(f?.source || '').toLowerCase() === 'ai_detector' &&
      ['open', 'flagged'].includes(String(f?.status || '').toLowerCase()),
  );
  if (detector.length === 0) return null;
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of detector) {
    const sev = String(f.severity || 'medium').toLowerCase();
    if (bySeverity[sev] !== undefined) bySeverity[sev] += 1;
  }
  // Top-3 finding titles for the Deal Doctor narration.
  const topFindings = detector
    .slice()
    .sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
    })
    .slice(0, 3)
    .map((f) => ({ title: f.title, severity: f.severity, category: f.category }));
  return {
    kind: 'cross_document_inconsistencies',
    value: { total: detector.length, by_severity: bySeverity, top_findings: topFindings },
    evidence: [
      { ref: 'risk:flags', label: `${detector.length} cross-document inconsistenc${detector.length === 1 ? 'y' : 'ies'} flagged by AI detector` },
    ],
    meta: {
      total: detector.length,
      critical: bySeverity.critical,
      high: bySeverity.high,
      medium: bySeverity.medium,
      low: bySeverity.low,
      top_titles: topFindings.map((f) => f.title),
    },
  };
};

const extractOpenRiskFlagsCount = (ws) => {
  const flags = getRiskFlags(ws);
  if (!Array.isArray(flags) || flags.length === 0) return null;
  const open = flags.filter((f) => {
    const status = String(f?.status || '').toLowerCase();
    return status === 'open' || status === 'flagged';
  });
  if (open.length === 0) return null;
  const criticalCount = open.filter((f) => /critical|deal_breaker/i.test(f?.severity || '')).length;
  return {
    kind: 'open_risk_flags',
    value: { total: open.length, critical: criticalCount },
    evidence: [{ ref: 'risk:flags', label: `${open.length} open risk flag${open.length === 1 ? '' : 's'}` }],
    meta: { total: open.length, critical: criticalCount },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator — run every extractor, drop nulls, return ordered list.
// ─────────────────────────────────────────────────────────────────────────────

const EXTRACTORS = [
  extractLandCostShareOfGdv,
  extractIrrVsHurdle,
  extractEquityMultipleVsTarget,
  extractDscrBreach,
  extractPriceVsCompBand,
  extractAbsorptionVsCompBand,
  extractCapRateVsCompBand,
  extractSaleableAreaMismatch,
  extractReraRegistrationMissing,
  extractApprovalGapCount,
  extractOverdueDdCount,
  extractDealBreakerDdCount,
  extractPromoterDeliverySlippage,
  extractCrossDocInconsistencies,
  extractOpenRiskFlagsCount,
];

const extractAllSignals = (workspace) => {
  if (!workspace) return [];
  const out = [];
  for (const fn of EXTRACTORS) {
    try {
      const signal = fn(workspace);
      if (signal) out.push(signal);
    } catch (err) {
      // A malformed slice must never break the recommendation pipeline.
      // Production logs would capture this; tests assert on the absence
      // of any extractor crash via the comprehensive-payload fixture.
      // eslint-disable-next-line no-console
      console.warn(`[signalExtractors] ${fn.name} threw: ${err.message}`);
    }
  }
  return out;
};

module.exports = {
  // Individual extractors — exported for unit tests + targeted use.
  extractLandCostShareOfGdv,
  extractIrrVsHurdle,
  extractEquityMultipleVsTarget,
  extractDscrBreach,
  extractPriceVsCompBand,
  extractAbsorptionVsCompBand,
  extractCapRateVsCompBand,
  extractSaleableAreaMismatch,
  extractReraRegistrationMissing,
  extractApprovalGapCount,
  extractOverdueDdCount,
  extractDealBreakerDdCount,
  extractPromoterDeliverySlippage,
  extractCrossDocInconsistencies,
  extractOpenRiskFlagsCount,
  // Orchestrator.
  EXTRACTORS,
  extractAllSignals,
  // Helpers (exported for tests).
  median,
  REGULATED_RESIDENTIAL_CLASSES,
};
