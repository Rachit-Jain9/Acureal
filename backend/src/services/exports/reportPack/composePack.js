'use strict';

/**
 * composePack — pure, deterministic composer for the audience report packs.
 *
 * Input:  the deal workspace payload (getDealWorkspace) + an audience key.
 * Output: a normalized PACK MODEL { audience, meta, sections[] } that the
 *         renderer (buildReportPackDocx) draws with zero further logic.
 *
 * No DB, no kernel, no AI. Every number is read from the kernel-computed
 * workspace slices; nothing is recomputed here beyond display formatting.
 *
 * Honesty rules baked in:
 *   - Legal-four lanes (title / encumbrance / RERA registration / statutory
 *     approvals) are emitted as documentary STATUS / FLAG blocks only — never a
 *     narrated conclusion.
 *   - Market figures carry source + freshness + confidence, or a truthful
 *     "no verified feed" note.
 *   - Sections render an honest empty-state note when data is missing; a
 *     section composer returns [] ONLY when the section is not applicable to
 *     the deal (then it is omitted entirely).
 *   - Units follow the kernel: LTV/LTC are ratios (0–1), DSCR is a ratio (×),
 *     irr_pct / gross_margin_pct / yield_on_cost_pct are percents,
 *     equity_multiple is a multiple, *_cr are crore amounts.
 */

const K = require('../docx/packKit');
const { getAudience } = require('../../../constants/reportPackCatalog');

const { EMDASH, C } = K;

// ─── workspace accessors ─────────────────────────────────────────────────────

const finSummary = (ws) => (ws && ws.financial && ws.financial.summary) || null;

const baseCapitalScenario = (ws) => {
  const scenarios = (ws && ws.capital_stack_optimizer && ws.capital_stack_optimizer.scenarios) || [];
  return scenarios.find((s) => s && s.scenario === 'base') || scenarios[0] || null;
};

const scenarioKpis = (ws, key) => {
  const sc = ws && ws.financial && ws.financial.scenarios;
  return (sc && sc[key] && sc[key].kpis) || null;
};

// ─── Chart spec builders (pure — no SVG here; the renderer generates it) ────
// Each returns a chart block or null when there isn't enough data to draw
// honestly. The renderer's CHART_RENDERERS dispatches by `chart` kind.

// Debt vs equity from the base capital-stack scenario; equity falls back to
// total cost − debt when amounts_cr.equity isn't on the scenario row.
const capitalStackDonutBlock = (ws) => {
  const base = baseCapitalScenario(ws);
  if (!base) return null;
  const debtCr = K.num(base.debt_cr);
  let equityCr = base.amounts_cr ? K.num(base.amounts_cr.equity) : null;
  if (equityCr == null) {
    const total = K.num(base.total_cost_cr);
    if (total != null && debtCr != null) equityCr = Math.max(0, total - debtCr);
  }
  if ((debtCr == null || debtCr <= 0) && (equityCr == null || equityCr <= 0)) return null;
  return { type: 'chart', chart: 'capital_stack_donut', data: { debtCr, equityCr }, caption: 'Debt vs equity in the base capital stack (INR Cr).' };
};

// Quarterly cashflow trend — period net columns + cumulative line. The kernel
// emits cash_flows.quarterly[].net but NOT cumulative; we add it as a running
// sum (same approach as dealExport.normalizeCashFlowRows). Falls back to
// yearly when quarterly is absent. Returns null when < 2 periods (renderer
// would draw an empty-state SVG; better to omit the block entirely).
const cashflowTrendBlock = (ws) => {
  const s = finSummary(ws);
  const cf = s && s.cash_flows;
  let raw = (cf && Array.isArray(cf.quarterly) && cf.quarterly.length >= 2) ? cf.quarterly
    : (cf && Array.isArray(cf.yearly) && cf.yearly.length >= 2) ? cf.yearly
    : null;
  if (!raw) return null;
  let cumulative = 0;
  const rows = raw.map((r, i) => {
    const net = K.num(r && (r.net != null ? r.net : r)) || 0;
    cumulative += net;
    return {
      label: r && r.label ? String(r.label) : `P${i + 1}`,
      net,
      cumulative: K.num(r && r.cumulative) != null ? K.num(r.cumulative) : cumulative,
    };
  });
  if (rows.length < 2) return null;
  return {
    type: 'chart', chart: 'cashflow_trend',
    data: { rows, title: 'Period Net Cash Flow & Cumulative (INR Cr)' },
    caption: 'Period net cash flow (columns) and the cumulative position (line). Kernel-driven; no model-generated figures.',
  };
};

// Sensitivity tornado — drivers extracted from the kernel's IRR grid by
// taking the centre row/column for the base IRR and the edges for the
// selling-rate / construction-cost ranges. Mirrors the canonical adapter in
// buildReport.js so the chart numbers match the underwriting report's. Asset-
// class neutral labels (the grid axes themselves are class-specific; the
// driver labels we render stay generic).
const sensitivityTornadoBlock = (ws) => {
  const s = finSummary(ws);
  const m = s && s.sensitivity_matrix;
  if (!m || !Array.isArray(m.irrGrid) || m.irrGrid.length < 3) return null;
  if (!Array.isArray(m.sellingRates) || m.sellingRates.length < 3) return null;
  if (!Array.isArray(m.constructionCosts) || m.constructionCosts.length < 3) return null;
  const midRow = Math.floor(m.constructionCosts.length / 2);
  const midCol = Math.floor(m.sellingRates.length / 2);
  const baseIrr = K.num(m.irrGrid[midRow] && m.irrGrid[midRow][midCol]);
  const sellRow = m.irrGrid[midRow] || [];
  const sellLow = K.num(sellRow[0]);
  const sellHigh = K.num(sellRow[sellRow.length - 1]);
  const costLow = K.num(m.irrGrid[m.irrGrid.length - 1] && m.irrGrid[m.irrGrid.length - 1][midCol]);
  const costHigh = K.num(m.irrGrid[0] && m.irrGrid[0][midCol]);
  const drivers = [];
  if (baseIrr != null && sellLow != null && sellHigh != null) {
    drivers.push({
      label: 'Selling Rate',
      subLabel: `${K.formatNumber(m.sellingRates[0])} → ${K.formatNumber(m.sellingRates[m.sellingRates.length - 1])} /sqft`,
      low: sellLow, high: sellHigh,
    });
  }
  if (baseIrr != null && costLow != null && costHigh != null) {
    drivers.push({
      label: 'Construction Cost',
      subLabel: `${K.formatNumber(m.constructionCosts[m.constructionCosts.length - 1])} → ${K.formatNumber(m.constructionCosts[0])} /sqft`,
      low: costLow, high: costHigh,
    });
  }
  if (drivers.length === 0 || baseIrr == null) return null;
  return {
    type: 'chart', chart: 'sensitivity_tornado',
    data: { drivers, baseIrr, title: 'Sensitivity — IRR Range by Driver' },
    caption: 'Which inputs move IRR the most. Driver ranges read straight off the kernel\'s sensitivity grid.',
  };
};

const reraSlice = (ws) => (ws && ws.karnataka_rera_readiness) || null;

const approvalStatus = (a) => {
  if (a.is_validated) return 'verified';
  if (a.is_uploaded) return 'uploaded';
  if (a.is_available) return 'available';
  return 'pending';
};

// ─── Section composers — each (workspace, audience) → block[] ───────────────
// Return [] to OMIT the section (not applicable); return a note block to show
// the section with an honest empty state.

const sectionCreditSummary = (ws) => {
  const s = finSummary(ws);
  const base = baseCapitalScenario(ws);
  if (!s && !base) {
    return [{ type: 'note', text: 'Financial model not yet run — run the kernel to populate credit metrics.' }];
  }
  const items = [
    { label: 'Project cost', value: K.formatCr(s && s.total_cost_cr) },
    { label: 'Gross revenue', value: K.formatCr(s && s.total_revenue_cr) },
    { label: 'Gross margin', value: K.formatPct(s && (s.gross_margin_pct ?? (s.kpis && s.kpis.grossMarginPct))) },
  ];
  if (base) {
    const cov = base.covenants || {};
    items.push({ label: 'Debt quantum (base)', value: K.formatCr(base.debt_cr) });
    items.push({
      label: 'LTV (base)',
      value: cov.ltv ? K.formatRatioPct(cov.ltv.value) : EMDASH,
      tone: cov.ltv ? (cov.ltv.passes ? 'positive' : 'negative') : null,
    });
    items.push({
      label: 'DSCR (base)',
      value: cov.dscr ? K.formatX(cov.dscr.value) : EMDASH,
      tone: cov.dscr ? (cov.dscr.passes ? 'positive' : 'negative') : null,
    });
  }
  const blocks = [{ type: 'kpiGrid', items }];
  if (!base) blocks.push({ type: 'note', text: 'Leverage covenants populate once the capital-stack model has run.' });
  return blocks;
};

const sectionCovenantPosture = (ws) => {
  const base = baseCapitalScenario(ws);
  if (!base || !base.covenants) {
    return [{ type: 'note', text: 'Capital-stack scenarios unavailable — run the financial model to compute leverage covenants.' }];
  }
  const cov = base.covenants;
  const rows = [];
  if (cov.ltv) rows.push([
    'Loan-to-value (LTV)', K.formatRatioPct(cov.ltv.value), `≤ ${K.formatRatioPct(cov.ltv.threshold)}`,
    { text: cov.ltv.passes ? 'Within covenant' : 'Breach', tone: cov.ltv.passes ? 'positive' : 'negative', bold: true },
  ]);
  if (cov.ltc) rows.push([
    'Loan-to-cost (LTC)', K.formatRatioPct(cov.ltc.value), `≤ ${K.formatRatioPct(cov.ltc.threshold)}`,
    { text: cov.ltc.passes ? 'Within covenant' : 'Breach', tone: cov.ltc.passes ? 'positive' : 'negative', bold: true },
  ]);
  if (cov.dscr) rows.push([
    'Debt-service coverage (DSCR)', K.formatX(cov.dscr.value), `≥ ${K.formatX(cov.dscr.threshold)}`,
    { text: cov.dscr.passes ? 'Within covenant' : 'Breach', tone: cov.dscr.passes ? 'positive' : 'negative', bold: true },
  ]);
  if (rows.length === 0) {
    return [{ type: 'note', text: 'Covenant inputs not yet available — provide gross sales value and debt assumptions in the model.' }];
  }
  const blocks = [{
    type: 'table',
    columns: [{ header: 'Metric', width: 40 }, { header: 'Value', width: 18 }, { header: 'Covenant', width: 20 }, { header: 'Status', width: 22 }],
    rows,
  }];
  const ctx = [];
  if (base.mix && base.mix.equity_pct != null) ctx.push({ label: 'Equity share', value: K.formatPct(base.mix.equity_pct) });
  if (base.blended_cost_of_capital_pct != null) ctx.push({ label: 'Blended cost of capital', value: K.formatPct(base.blended_cost_of_capital_pct) });
  if (base.debt_cr != null) ctx.push({ label: 'Total debt (base)', value: K.formatCr(base.debt_cr) });
  if (ctx.length) blocks.push({ type: 'kpiGrid', items: ctx });
  blocks.push({ type: 'note', text: 'Covenants reflect the base capital-stack scenario against conventional asset-class thresholds; each institution sets its own floors.' });
  const donut = capitalStackDonutBlock(ws);
  if (donut) blocks.unshift(donut);
  return blocks;
};

const sectionDownsideStress = (ws) => {
  const base = scenarioKpis(ws, 'base');
  const bear = scenarioKpis(ws, 'bear');
  if (!base && !bear) {
    return [{ type: 'note', text: 'Scenario analysis appears once the financial model has run.' }];
  }
  const cellFor = (kpis, key, fmt, tone) => (kpis && kpis[key] != null ? { text: fmt(kpis[key]), tone } : { text: EMDASH });
  const rows = [
    ['IRR', cellFor(base, 'irr', K.formatPct), cellFor(bear, 'irr', K.formatPct, 'warning')],
    ['Equity multiple', cellFor(base, 'equityMultiple', K.formatX), cellFor(bear, 'equityMultiple', K.formatX, 'warning')],
    ['Gross margin', cellFor(base, 'grossMarginPct', K.formatPct), cellFor(bear, 'grossMarginPct', K.formatPct, 'warning')],
    ['NPV', cellFor(base, 'npv', K.formatCr), cellFor(bear, 'npv', K.formatCr, 'warning')],
  ];
  return [
    {
      type: 'table',
      columns: [{ header: 'Metric', width: 34 }, { header: 'Base case', width: 33 }, { header: 'Bear case', width: 33 }],
      rows,
    },
    { type: 'note', text: 'Bear case applies the kernel\'s standard stress: revenue −12%, cost +10%, timeline +20%. Base is the underwritten case.' },
  ];
};

const sectionSecurityTitle = (ws) => {
  const rera = reraSlice(ws);
  const titleBucket = ((rera && rera.buckets) || []).find((b) => b && b.id === 'title_ownership');
  const blocks = [];
  if (titleBucket && (titleBucket.items || []).length) {
    blocks.push({
      type: 'statusList',
      items: titleBucket.items.map((it) => ({
        label: it.label,
        status: (it.evidence && it.evidence.status) || 'missing',
        detail: (it.evidence && it.evidence.evidence_label) || it.recommended_action || '',
      })),
    });
  } else {
    blocks.push({ type: 'note', text: 'No structured title inventory is available for this deal yet — title is tracked in the deal\'s documents and DD checklist.' });
  }
  blocks.push({
    type: 'note',
    text: 'Title status reflects documents on file only — it is not a legal opinion. Confirm the chain of title, encumbrances and pending litigation independently with an advocate.',
    color: C.warning,
  });
  return blocks;
};

const sectionStatutoryApprovals = (ws) => {
  const approvals = (ws && ws.approvals) || [];
  if (!approvals.length) {
    return [{ type: 'note', text: 'No approvals tracked yet — seed the approvals checklist on the deal.' }];
  }
  const items = approvals.map((a) => ({
    label: a.name || String(a.approval_type || '').replace(/_/g, ' '),
    status: approvalStatus(a),
    detail: [a.reference_number, a.expiry_date ? `expires ${K.formatDate(a.expiry_date)}` : null].filter(Boolean).join('  ·  '),
  }));
  return [
    { type: 'statusList', items },
    { type: 'note', text: 'Status reflects evidence maturity recorded on the deal, not a confirmation of statutory validity.' },
  ];
};

const sectionReraRegistration = (ws) => {
  const rera = reraSlice(ws);
  if (!rera || !rera.applicable) return []; // not applicable → omit the section
  const deal = (ws && ws.deal) || {};
  const overall = rera.overall || {};
  const blocks = [{
    type: 'keyValue',
    rows: [
      ['Applicability', rera.applicability && rera.applicability.status ? String(rera.applicability.status).replace(/_/g, ' ') : 'In scope'],
      ['Milestone', rera.milestone && rera.milestone.phase ? String(rera.milestone.phase).replace(/_/g, ' ') : EMDASH],
      ['Registration number', deal.rera_number || 'Not on file'],
      ['Filing readiness', overall.completeness_pct != null ? `${overall.completeness_pct}%  ·  ${String(overall.readiness_tier || '').replace(/_/g, ' ')}` : EMDASH],
    ],
  }];
  const blockers = (overall.blockers || []).map((b) => ({ severity: 'critical', title: b.item_label, detail: 'Fatal blocker — required before filing' }));
  blocks.push({ type: 'flagList', items: blockers, emptyText: 'No fatal blockers — the filing inventory is progressing.' });
  blocks.push({
    type: 'note',
    text: 'RERA posture is an organisation aid. It is never a statement that the project is, or will be, RERA-registered or compliant.',
    color: C.warning,
  });
  return blocks;
};

const sectionRiskRegister = (ws) => {
  const flags = ((ws && ws.risk && ws.risk.flags) || []).filter(
    (f) => (f.status === 'open' || f.status === 'flagged') && (f.severity === 'critical' || f.severity === 'high'),
  );
  const items = flags.map((f) => ({ severity: f.severity, title: f.title || f.category || 'Risk', detail: f.mitigation || f.description || '' }));
  return [{ type: 'flagList', items, emptyText: 'No open critical or high risk flags on the deal.' }];
};

const sectionRepaymentExit = (ws) => {
  const s = finSummary(ws);
  if (!s) return [{ type: 'note', text: 'Exit and coverage metrics appear once the financial model has run.' }];
  const items = [
    { label: 'Exit value', value: K.formatCr(s.exit_value_cr) },
    { label: 'Yield on cost', value: K.formatPct(s.yield_on_cost_pct) },
    { label: 'Stabilised NOI', value: K.formatCr(s.noi_cr ?? s.stabilized_noi_cr) },
    { label: 'Project duration', value: s.project_duration_months != null ? `${K.formatNumber(s.project_duration_months)} months` : EMDASH },
  ];
  return [{ type: 'kpiGrid', items }];
};

const sectionClosing = (ws, audience) => [{ type: 'paragraph', text: audience.disclaimer, tone: 'muted' }];

// ── Investor sections ───────────────────────────────────────────────────────

const sectionReturnsSummary = (ws) => {
  const s = finSummary(ws);
  const base = scenarioKpis(ws, 'base');
  if (!s && !base) return [{ type: 'note', text: 'Returns appear once the financial model has run.' }];
  const items = [
    { label: 'Project IRR', value: K.formatPct((s && s.irr_pct) ?? (base && base.irr)) },
    { label: 'Equity multiple', value: K.formatX((s && s.equity_multiple) ?? (base && base.equityMultiple)) },
    { label: 'NPV', value: K.formatCr((s && s.npv_cr) ?? (base && base.npv)) },
    { label: 'Gross margin', value: K.formatPct((s && s.gross_margin_pct) ?? (base && base.grossMarginPct)) },
    { label: 'Project cost', value: K.formatCr(s && s.total_cost_cr) },
    { label: 'Duration', value: s && s.project_duration_months != null ? `${K.formatNumber(s.project_duration_months)} months` : EMDASH },
  ];
  const blocks = [{ type: 'kpiGrid', items }];
  // Cinematic SVG: the cashflow trend behind those headline numbers. Pure
  // kernel output; null when the kernel hasn't produced period rows yet.
  const cashflow = cashflowTrendBlock(ws);
  if (cashflow) blocks.push(cashflow);
  return blocks;
};

const sectionScenarios = (ws) => {
  const base = scenarioKpis(ws, 'base');
  const bull = scenarioKpis(ws, 'bull');
  const bear = scenarioKpis(ws, 'bear');
  if (!base && !bull && !bear) return [{ type: 'note', text: 'Scenario analysis appears once the financial model has run.' }];
  const c = (k, key, fmt, tone) => (k && k[key] != null ? { text: fmt(k[key]), tone } : { text: EMDASH });
  const rows = [
    ['IRR', c(bear, 'irr', K.formatPct, 'warning'), c(base, 'irr', K.formatPct), c(bull, 'irr', K.formatPct, 'positive')],
    ['Equity multiple', c(bear, 'equityMultiple', K.formatX, 'warning'), c(base, 'equityMultiple', K.formatX), c(bull, 'equityMultiple', K.formatX, 'positive')],
    ['Gross margin', c(bear, 'grossMarginPct', K.formatPct, 'warning'), c(base, 'grossMarginPct', K.formatPct), c(bull, 'grossMarginPct', K.formatPct, 'positive')],
    ['NPV', c(bear, 'npv', K.formatCr, 'warning'), c(base, 'npv', K.formatCr), c(bull, 'npv', K.formatCr, 'positive')],
  ];
  const blocks = [
    { type: 'table', columns: [{ header: 'Metric', width: 28 }, { header: 'Bear', width: 24 }, { header: 'Base', width: 24 }, { header: 'Bull', width: 24 }], rows },
    { type: 'note', text: 'Bull / bear apply the kernel\'s standard sensitivities to revenue, cost and timeline. Modelled estimates, not guarantees.' },
  ];
  // Cinematic SVG: which inputs move IRR the most — from the kernel's own
  // sensitivity grid. Null when the grid isn't dense enough for an honest read.
  const tornado = sensitivityTornadoBlock(ws);
  if (tornado) blocks.push(tornado);
  return blocks;
};

const sectionCapitalStack = (ws) => {
  const scn = (ws && ws.capital_stack_optimizer && ws.capital_stack_optimizer.scenarios) || [];
  if (!scn.length) return [{ type: 'note', text: 'Capital-stack scenarios appear once the financial model has run.' }];
  const rows = scn.map((s) => [
    s.label || String(s.scenario || '').replace(/_/g, ' '),
    s.mix && s.mix.equity_pct != null ? K.formatPct(s.mix.equity_pct) : EMDASH,
    s.debt_cr != null ? K.formatCr(s.debt_cr) : EMDASH,
    s.blended_cost_of_capital_pct != null ? K.formatPct(s.blended_cost_of_capital_pct) : EMDASH,
    { text: s.verdict || (s.band ? `${s.band} fit` : EMDASH), tone: s.band === 'high' ? 'positive' : s.band === 'low' ? 'warning' : null },
  ]);
  const blocks = [
    { type: 'table', columns: [{ header: 'Scenario', width: 22 }, { header: 'Equity', width: 16 }, { header: 'Debt', width: 22 }, { header: 'Blended cost', width: 20 }, { header: 'Fit', width: 20 }], rows },
    { type: 'note', text: 'Deterministic financing scenarios scored against asset-class covenant norms. The base case anchors the returns above.' },
  ];
  // Cinematic SVG: debt vs equity in the base capital stack.
  const donut = capitalStackDonutBlock(ws);
  if (donut) blocks.unshift(donut);
  return blocks;
};

const humanizeMetric = (k) => String(k || '')
  .replace(/_/g, ' ')
  .replace(/\bper sqft inr\b/i, '(INR/sqft)')
  .replace(/\binr\b/i, '(INR)')
  .replace(/\bpct\b/i, '%')
  .trim();

const sectionMarketContext = (ws) => {
  const mm = (ws && ws.micro_market) || {};
  const benchmarks = mm.benchmarks || [];
  const blocks = [];
  if (benchmarks.length) {
    const rows = benchmarks.slice(0, 6).map((b) => [
      humanizeMetric(b.metric_kind),
      b.p25 != null ? K.formatNumber(b.p25) : EMDASH,
      b.p50 != null ? K.formatNumber(b.p50) : EMDASH,
      b.p75 != null ? K.formatNumber(b.p75) : EMDASH,
      b.source_ref ? `${b.source_ref}${b.n_observations ? ` (n=${b.n_observations})` : ''}` : EMDASH,
    ]);
    blocks.push({ type: 'table', columns: [{ header: 'Metric', width: 30 }, { header: 'P25', width: 14 }, { header: 'Median', width: 16 }, { header: 'P75', width: 14 }, { header: 'Source', width: 26 }], rows });
    const freshest = benchmarks.map((b) => b.last_verified_at).filter(Boolean).sort().slice(-1)[0];
    const confidences = [...new Set(benchmarks.map((b) => b.confidence).filter(Boolean))].join(' / ');
    blocks.push({ type: 'sourceNote', source: 'Verified market benchmarks', freshness: freshest ? K.formatDate(freshest) : null, confidence: confidences || null });
  } else {
    blocks.push({ type: 'sourceNote' }); // → "No verified feed available"
  }
  const comps = ((ws && ws.comps && ws.comps.entries) || []).filter((c) => c.is_verified !== false);
  blocks.push({
    type: 'note',
    text: comps.length
      ? `${comps.length} verified comparable transaction${comps.length === 1 ? '' : 's'} within 5 km on file.`
      : 'No verified comparables on file within 5 km yet.',
  });
  const bestUse = ((ws && ws.best_use && ws.best_use.scores) || [])[0];
  if (bestUse) {
    blocks.push({ type: 'note', text: `Best-use suitability: ${K.assetClassLabel(bestUse.asset_class)} — score ${bestUse.score}/100${bestUse.label ? ` (${bestUse.label})` : ''}.` });
  }
  return blocks;
};

const POSTURE_LABEL = { cleared: 'Cleared', unverified: 'Unverified', flagged: 'Flagged' };

const sectionPromoter = (ws) => {
  const p = ws && ws.promoter;
  if (!p) return [{ type: 'note', text: 'Promoter track record not yet recorded on the deal.' }];
  const a = p.assessment || {};
  const postureLabel = POSTURE_LABEL[a.posture] || 'Unverified';
  const postureTone = a.posture === 'cleared' ? 'positive' : a.posture === 'flagged' ? 'negative' : 'warning';
  const rows = [
    ['Promoter', p.promoter_name || EMDASH],
    ['Projects delivered', (p.delivered_on_time != null || p.delivered_delayed != null)
      ? `${p.delivered_on_time || 0} on time, ${p.delivered_delayed || 0} delayed` : EMDASH],
    ['Years active', p.years_active != null ? String(p.years_active) : EMDASH],
    ['RERA registered', p.rera_registered === true ? 'Yes' : p.rera_registered === false ? 'No' : EMDASH],
  ];
  const blocks = [
    { type: 'keyValue', rows },
    { type: 'paragraph', text: `Execution posture: ${postureLabel}.`, tone: postureTone },
  ];
  for (const sig of (a.signals || [])) {
    const color = sig.tone === 'negative' ? C.negative : sig.tone === 'warn' ? C.warning : C.positive;
    blocks.push({ type: 'note', text: `•  ${sig.text}`, color });
  }
  return blocks;
};

const sectionIcReadiness = (ws) => {
  const ic = ws && ws.ic_readiness;
  if (!ic || !ic.overall) return [{ type: 'note', text: 'IC readiness appears once the deal\'s workspace has enough signals.' }];
  const o = ic.overall;
  const blocks = [{
    type: 'kpiGrid',
    items: [
      { label: 'IC readiness', value: o.completeness_pct != null ? `${o.completeness_pct}/100` : EMDASH },
      { label: 'Tier', value: String(o.readiness_tier || '').replace(/_/g, ' ') || EMDASH },
      { label: 'Items verified', value: o.by_status ? `${o.by_status.verified || 0} of ${o.total_items || 0}` : EMDASH },
    ],
  }];
  const buckets = ic.buckets || [];
  if (buckets.length) {
    const rows = buckets.map((b) => [
      b.label,
      `${b.completeness_pct}%`,
      { text: b.bucket_status === 'complete' ? 'Complete' : b.bucket_status === 'partial' ? 'Partial' : 'Missing', tone: b.bucket_status === 'complete' ? 'positive' : b.bucket_status === 'partial' ? 'warning' : 'negative' },
    ]);
    blocks.push({ type: 'table', columns: [{ header: 'Bucket', width: 50 }, { header: 'Complete', width: 25 }, { header: 'Status', width: 25 }], rows });
  }
  blocks.push({ type: 'note', text: 'IC readiness is an organisation aid for the deal team\'s pre-IC preparation — not an IC approval.' });
  return blocks;
};

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

const sectionRecommendations = (ws) => {
  // Non-legal deterministic call-outs only. ai_narratable === false marks the
  // legal-four lanes, which must never be AI-narrated — those stay as status.
  const recs = ((ws && ws.recommendations && ws.recommendations.recommendations) || [])
    .filter((r) => r && r.ai_narratable !== false);
  if (!recs.length) return [{ type: 'note', text: 'No deterministic call-outs surfaced for this deal yet.' }];
  const top = recs
    .slice()
    .sort((x, y) => (SEV_RANK[x.severity_base] ?? 9) - (SEV_RANK[y.severity_base] ?? 9))
    .slice(0, 6);
  const items = top.map((r) => ({ verb: r.verb, headline: r.headline || r.topic_label, detail: r.detail || '' }));
  return [
    { type: 'callouts', items },
    { type: 'note', text: 'Call-outs are composed deterministically from kernel signals; verbs follow REDIP\'s fixed dictionary. Statutory matters are excluded here and shown as documentary status only.' },
  ];
};

// ── Buyer sections ──────────────────────────────────────────────────────────

const sectionProjectOverview = (ws) => {
  const deal = (ws && ws.deal) || {};
  const p = ws && ws.promoter;
  const rows = [
    ['Project', deal.name || EMDASH],
    ['Type', K.assetClassLabel(deal.asset_class)],
    ['Location', [deal.city, deal.state].filter(Boolean).join(', ') || deal.parcel_address || deal.property_address || EMDASH],
    ['Developer / promoter', (p && p.promoter_name) || EMDASH],
    ['RERA registration', deal.rera_number || 'Not on file'],
  ];
  const completion = deal.rera_inputs && deal.rera_inputs.completion_date;
  if (completion) rows.push(['Declared completion', K.formatDate(completion)]);
  if (deal.land_area_sqft) rows.push(['Land extent', K.formatArea(deal.land_area_sqft)]);
  return [{ type: 'keyValue', rows }];
};

const sectionProfessionalSignoffs = (ws) => {
  // Derived from the K-RERA cockpit: items whose evidence source is a signed
  // professional sign-off. Avoids any workspace plumbing — reuses existing data.
  const buckets = (reraSlice(ws) && reraSlice(ws).buckets) || [];
  const signed = [];
  for (const b of buckets) {
    for (const it of (b.items || [])) {
      if (it.evidence && it.evidence.source === 'signoff') {
        signed.push({ label: it.label, status: 'signed', detail: it.evidence.evidence_label || '' });
      }
    }
  }
  if (!signed.length) {
    return [{
      type: 'note',
      text: 'No professional sign-offs are recorded against this project\'s certificates yet. Ask the developer which certificates — advocate, CA, architect, engineer, structural engineer, banker — have been signed off.',
    }];
  }
  return [
    { type: 'statusList', items: signed },
    { type: 'note', text: 'A signed certificate means a qualified professional has attested it. Confirm the originals with the developer before any payment.' },
  ];
};

const SECTION_COMPOSERS = Object.freeze({
  // lender
  credit_summary: sectionCreditSummary,
  covenant_posture: sectionCovenantPosture,
  downside_stress: sectionDownsideStress,
  security_title: sectionSecurityTitle,
  statutory_approvals: sectionStatutoryApprovals,
  rera_registration: sectionReraRegistration,
  risk_register: sectionRiskRegister,
  repayment_exit: sectionRepaymentExit,
  closing: sectionClosing,
  // investor
  returns_summary: sectionReturnsSummary,
  scenarios: sectionScenarios,
  capital_stack: sectionCapitalStack,
  market_context: sectionMarketContext,
  promoter: sectionPromoter,
  ic_readiness: sectionIcReadiness,
  recommendations: sectionRecommendations,
  // buyer
  project_overview: sectionProjectOverview,
  professional_signoffs: sectionProfessionalSignoffs,
});

// ─── Public: compose the normalized pack model ──────────────────────────────

const composePack = (workspace, audienceKey) => {
  const audience = getAudience(audienceKey);
  if (!audience) throw new Error(`composePack: unknown audience "${audienceKey}".`);
  const ws = workspace || {};
  const deal = ws.deal || {};

  const locationBits = [deal.city, deal.state].filter(Boolean).join(', ');
  const subtitle = [K.assetClassLabel(deal.asset_class), locationBits].filter(Boolean).join('  ·  ');
  const metaLines = [];
  const address = deal.parcel_address || deal.property_address;
  if (address) metaLines.push(address);
  if (deal.stage) metaLines.push(`Stage: ${String(deal.stage).replace(/_/g, ' ')}`);

  const meta = {
    brandName: 'REDIP',
    docTitle: audience.docTitle,
    eyebrowText: audience.eyebrowText,
    title: deal.name || 'Deal',
    subtitle,
    metaLines,
    footerText: audience.footer,
  };

  const sections = [];
  for (const s of audience.sections) {
    const composer = SECTION_COMPOSERS[s.id];
    if (!composer) continue;
    let blocks;
    try {
      blocks = composer(ws, audience);
    } catch {
      blocks = null;
    }
    if (!blocks || blocks.length === 0) continue; // omit not-applicable / failed sections
    sections.push({ id: s.id, title: s.title, lead: s.lead, blocks });
  }

  return { audience: audience.key, meta, sections };
};

module.exports = {
  composePack,
  SECTION_COMPOSERS,
  // accessors exported for unit tests
  finSummary,
  baseCapitalScenario,
  scenarioKpis,
  approvalStatus,
  // chart spec builders (pure) — exported so tests can pin their behaviour
  capitalStackDonutBlock,
  cashflowTrendBlock,
  sensitivityTornadoBlock,
};
