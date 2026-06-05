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

const SECTION_COMPOSERS = Object.freeze({
  credit_summary: sectionCreditSummary,
  covenant_posture: sectionCovenantPosture,
  downside_stress: sectionDownsideStress,
  security_title: sectionSecurityTitle,
  statutory_approvals: sectionStatutoryApprovals,
  rera_registration: sectionReraRegistration,
  risk_register: sectionRiskRegister,
  repayment_exit: sectionRepaymentExit,
  closing: sectionClosing,
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
};
