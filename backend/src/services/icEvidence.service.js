'use strict';

/**
 * IC Memo Evidence Ledger — Workstream A (Provenance Spine), A3.
 *
 * The IC memo's prose is AI-authored and carries the standard "requires human
 * review" disclaimer. Its NUMBERS must not. This service builds the
 * deterministic claim layer beneath the memo: every material figure the IC
 * decision rests on, enumerated with an honest, typed, traceable source.
 *
 * It is a pure composer over engines Acureal already runs deterministically:
 *   - the financial kernel        → the headline KPIs and cost/revenue lines
 *   - Model Confidence            → each key input, classified analyst-set
 *                                   vs. on a cited Acureal benchmark
 *   - the Risk Radar              → the open-risk / diligence / approval counts
 *   - the comp-reliance ledger    → the comparables the analyst relied on
 *   - the deal record             → the site & price facts
 *
 * No AI, no fabrication: every claim names where its value genuinely came
 * from. A figure with no honest source is simply not asserted.
 *
 * Read-side, deterministic, migration-tolerant — never throws for an expected
 * gap; the panel hides itself.
 */

const { query } = require('../config/database');
const financialService = require('./financial.service');
const modelConfidenceService = require('./modelConfidence.service');
const riskRadarService = require('./riskRadar.service');
const compRelianceService = require('./compReliance.service');

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const round = (v, dp = 2) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

// Source-type catalogue. `traced` is true for every type — the whole point of
// the ledger is that each material number HAS an honest, specific origin.
const SOURCE = {
  kernel: (detail) => ({
    type: 'kernel',
    label: 'Acureal deterministic kernel',
    detail,
  }),
  analyst: (detail) => ({
    type: 'analyst',
    label: 'Set for this deal',
    detail: detail || 'Entered by the analyst for this deal.',
  }),
  benchmark: (detail) => ({
    type: 'benchmark',
    label: 'Acureal benchmark',
    detail: detail || 'Running on a cited Acureal benchmark default.',
  }),
  deterministic: (detail) => ({
    type: 'deterministic',
    label: 'Deal records',
    detail,
  }),
  feed: (detail) => ({
    type: 'feed',
    label: 'Verified comps feed',
    detail,
  }),
  dealRecord: (detail) => ({
    type: 'deal-record',
    label: 'Deal record',
    detail: detail || 'Maintained on the deal by the team.',
  }),
};

const claim = (key, label, value, unit, source) => ({
  key,
  label,
  value,
  unit,
  source,
  traced: true,
});

// Pick a display unit for a Model-Confidence input key so the UI can format it.
const unitForInputKey = (key) => {
  if (/Pct$/.test(key) || key === 'loadingFactor') return 'pct';
  if (/PerSqft$/.test(key)) return 'inr_per_sqft';
  if (/PerKey$/.test(key)) return 'inr';
  if (key === 'landCostCr') return 'inr_cr';
  if (/Sqft$/.test(key)) return 'sqft';
  if (key === 'keys' || /Years$/.test(key)) return 'count';
  return null;
};

/** Returns / capital claims from the saved financial model. */
const financialClaims = (fin) => {
  const mp = fin.model_params || {};
  const kpis = mp.kpis || {};
  const costs = mp.costs || {};
  const revenue = mp.revenue || {};
  const engineVersion = mp.engineVersion || fin.engine_version || 'kernel-v2';
  const computedAt = mp.computedAt || fin.updated_at || null;
  const when = computedAt
    ? new Date(computedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;
  const kernelDetail = `Computed by Acureal's deterministic financial kernel (${engineVersion})`
    + `${when ? ` on ${when}` : ''} from the deal's saved model inputs. Every kernel run is `
    + 'HMAC-signed and replayable from those inputs — see the model’s audit trail.';

  const returns = [];
  const capital = [];
  const add = (bucket, key, label, value, unit) => {
    const v = round(num(value), unit === 'pct' || unit === 'x' ? 2 : 2);
    if (v === null) return;
    bucket.push(claim(key, label, v, unit, SOURCE.kernel(kernelDetail)));
  };

  add(returns, 'irr', 'Project IRR', kpis.irr ?? fin.irr_pct, 'pct');
  add(returns, 'npv', 'NPV', kpis.npv ?? fin.npv_cr, 'inr_cr');
  add(returns, 'equityMultiple', 'Equity multiple', kpis.equityMultiple ?? fin.equity_multiple, 'x');
  add(returns, 'grossMargin', 'Gross margin', kpis.grossMarginPct ?? fin.gross_margin_pct, 'pct');
  add(returns, 'rlv', 'Residual land value', kpis.rlv ?? fin.residual_land_value_cr, 'inr_cr');

  add(capital, 'totalCost', 'Total project cost', costs.total ?? fin.total_cost_cr, 'inr_cr');
  add(capital, 'landCost', 'Land cost', costs.land ?? fin.land_cost_cr, 'inr_cr');
  add(capital, 'construction', 'Construction cost', costs.construction ?? fin.total_construction_cost_cr, 'inr_cr');
  add(capital, 'totalRevenue', 'Total revenue', revenue.totalRevenueCr ?? fin.total_revenue_cr, 'inr_cr');

  return { returns, capital, engineVersion, computedAt };
};

/** Key-assumption claims, reusing the Model Confidence classification. */
const assumptionClaims = (confidence) => {
  if (!confidence || !confidence.available || !Array.isArray(confidence.inputs)) return [];
  return confidence.inputs.map((inp) => {
    const source =
      inp.status === 'deal-set'
        ? SOURCE.analyst(inp.basis)
        : SOURCE.benchmark(
            inp.benchmarkSource
              ? `On Acureal's cited benchmark — ${inp.benchmarkSource}.`
              : inp.basis,
          );
    return claim(inp.key, inp.label, num(inp.value), unitForInputKey(inp.key), source);
  });
};

/** Risk / diligence / approval claims from the deterministic Risk Radar. */
const riskClaims = (radar) => {
  if (!radar || !Array.isArray(radar.categories)) return [];
  let openFlags = 0;
  let reqDdOpen = 0;
  let approvalsPending = 0;
  for (const c of radar.categories) {
    openFlags += c.flags?.total || 0;
    reqDdOpen += c.diligence?.required_open || 0;
    if (c.approvals) approvalsPending += c.approvals.required_pending || 0;
  }
  const det = SOURCE.deterministic(
    "Counted directly from the deal's risk register, diligence tracker and approvals list.",
  );
  return [
    claim('openRiskFlags', 'Open risk flags', openFlags, 'count', det),
    claim('requiredDdOpen', 'Required diligence still open', reqDdOpen, 'count', det),
    claim('approvalsPending', 'Approvals not yet validated', approvalsPending, 'count', det),
  ];
};

/**
 * Build the evidence ledger for a deal. Never throws for an expected gap —
 * returns `{ available: false }` only when the deal itself cannot be read.
 */
const getEvidenceLedger = async (dealId) => {
  // Deal facts — the org-scoped gate doubles as the visibility check.
  let dealRow;
  try {
    const r = await query(
      `SELECT d.name, d.stage, d.asset_class,
              d.land_ask_price_cr, d.negotiated_price_cr,
              p.land_area_sqft
         FROM deals d
         LEFT JOIN properties p ON d.property_id = p.id
        WHERE d.id = $1 AND d.organization_id = current_organization_id()
        LIMIT 1`,
      [dealId],
    );
    dealRow = r.rows[0] || null;
  } catch (err) {
    dealRow = null;
  }
  if (!dealRow) {
    return { available: false, reason: 'deal not found' };
  }

  // Financial model + the trust engines — each isolated so one gap never
  // sinks the whole ledger.
  const [fin, confidence, radar, reliedComps] = await Promise.all([
    financialService.getFinancials(dealId).catch(() => null),
    modelConfidenceService.getModelConfidence(dealId).catch(() => null),
    riskRadarService.getRiskRadar(dealId).catch(() => null),
    compRelianceService.listReliedCompIds(dealId).catch(() => []),
  ]);

  const groups = [];
  let engineVersion = null;
  let computedAt = null;

  if (fin) {
    const f = financialClaims(fin);
    engineVersion = f.engineVersion;
    computedAt = f.computedAt;
    if (f.returns.length) groups.push({ category: 'Returns', claims: f.returns });
    if (f.capital.length) groups.push({ category: 'Capital & cost', claims: f.capital });
  }

  const assumptions = assumptionClaims(confidence);
  if (assumptions.length) groups.push({ category: 'Key assumptions', claims: assumptions });

  const risk = riskClaims(radar);
  if (risk.length) groups.push({ category: 'Risk & diligence', claims: risk });

  groups.push({
    category: 'Market',
    claims: [
      claim(
        'reliedComps',
        'Comparables relied on',
        Array.isArray(reliedComps) ? reliedComps.length : 0,
        'count',
        SOURCE.feed(
          'Verified comparables in the Acureal comps database that the analyst '
          + 'explicitly marked as relied-on for this deal.',
        ),
      ),
    ],
  });

  // Deal facts — site & price.
  const facts = [];
  const landSqft = num(dealRow.land_area_sqft);
  if (landSqft !== null) {
    facts.push(claim('landArea', 'Land area', landSqft, 'sqft', SOURCE.dealRecord()));
  }
  const ask = num(dealRow.land_ask_price_cr);
  if (ask !== null) {
    facts.push(claim('askPrice', 'Ask price', ask, 'inr_cr', SOURCE.dealRecord()));
  }
  const negotiated = num(dealRow.negotiated_price_cr);
  if (negotiated !== null) {
    facts.push(
      claim('negotiatedPrice', 'Negotiated price', negotiated, 'inr_cr', SOURCE.dealRecord()),
    );
  }
  if (facts.length) groups.push({ category: 'Site & deal facts', claims: facts });

  // Summary — total claims and the count per source type. Every claim is
  // traced, so `traced === total` by construction; the breakdown shows how.
  const allClaims = groups.flatMap((g) => g.claims);
  const byType = {};
  for (const c of allClaims) {
    byType[c.source.type] = (byType[c.source.type] || 0) + 1;
  }

  return {
    available: true,
    dealId,
    dealName: dealRow.name,
    engineVersion,
    computedAt,
    groups,
    summary: {
      total: allClaims.length,
      traced: allClaims.length,
      byType,
    },
    generatedAt: new Date().toISOString(),
  };
};

module.exports = {
  getEvidenceLedger,
  // Exported for unit tests.
  _internal: { financialClaims, assumptionClaims, riskClaims, unitForInputKey },
};
