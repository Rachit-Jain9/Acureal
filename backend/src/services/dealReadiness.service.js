'use strict';

const RISK_WEIGHTS = {
  critical: 30,
  high: 15,
  medium: 5,
  low: 1,
};

const READY_STATUSES = new Set(['completed', 'not_applicable']);
const APPROVAL_READY_STATUSES = new Set(['validated', 'approved']);
const OPEN_RISK_STATUSES = new Set(['open', 'flagged']);
const STRUCTURED_DEAL_TYPES = new Set(['jv', 'jda', 'revenue_share', 'area_share', 'profit_share', 'hybrid']);

const uniquePush = (list, value) => {
  if (value && !list.includes(value)) {
    list.push(value);
  }
};

const getDocCount = (documentCategoryCounts, category) =>
  Number(documentCategoryCounts?.[category] || 0);

const buildReadinessSummary = ({
  ddItems = [],
  approvals = [],
  riskFlags = [],
  financials = null,
  documentCount = 0,
}) => {
  const requiredDD = ddItems.filter((item) => item.is_required);
  const completedDD = requiredDD.filter((item) => READY_STATUSES.has(item.status));
  const flaggedDD = requiredDD.filter((item) => item.status === 'flagged');
  const pendingDealBreakers = requiredDD.filter(
    (item) => item.severity === 'deal_breaker' && !READY_STATUSES.has(item.status),
  );
  const pendingBuildabilityBlockers = requiredDD.filter(
    (item) => item.severity === 'buildability_blocker' && !READY_STATUSES.has(item.status),
  );

  const requiredApprovals = approvals.filter((item) => item.is_required);
  const validatedApprovals = requiredApprovals.filter(
    (item) => item.is_validated || APPROVAL_READY_STATUSES.has(item.status),
  );
  const pendingApprovals = requiredApprovals.filter(
    (item) => !(item.is_validated || APPROVAL_READY_STATUSES.has(item.status)),
  );

  const openRisks = riskFlags.filter((flag) => OPEN_RISK_STATUSES.has(flag.status));
  const criticalOrHighRisks = openRisks.filter((flag) => ['critical', 'high'].includes(flag.severity));
  const rawRiskScore = openRisks.reduce(
    (sum, flag) => sum + (RISK_WEIGHTS[flag.severity] || 0),
    0,
  );
  const riskScore = Math.min(rawRiskScore, 100);

  const ddCompletionPct = requiredDD.length
    ? Math.round((completedDD.length / requiredDD.length) * 100)
    : 0;
  const approvalCompletionPct = requiredApprovals.length
    ? Math.round((validatedApprovals.length / requiredApprovals.length) * 100)
    : 0;
  const documentSignalPct = documentCount >= 6 ? 100 : documentCount >= 3 ? 70 : documentCount > 0 ? 35 : 0;

  const readinessPct = Math.round(
    (ddCompletionPct * 0.45)
      + (approvalCompletionPct * 0.25)
      + ((100 - riskScore) * 0.2)
      + (documentSignalPct * 0.1),
  );

  let status = 'not_ready';
  if (
    pendingDealBreakers.length === 0
    && pendingBuildabilityBlockers.length <= 1
    && criticalOrHighRisks.length === 0
    && readinessPct >= 75
  ) {
    status = 'ic_ready';
  } else if (readinessPct >= 45) {
    status = 'work_in_progress';
  }

  return {
    status,
    readiness_pct: readinessPct,
    dd_completion_pct: ddCompletionPct,
    approval_completion_pct: approvalCompletionPct,
    risk_score: riskScore,
    document_count: documentCount,
    required_dd_count: requiredDD.length,
    completed_dd_count: completedDD.length,
    flagged_dd_count: flaggedDD.length,
    pending_required_dd_count: requiredDD.length - completedDD.length,
    pending_deal_breakers: pendingDealBreakers.length,
    pending_buildability_blockers: pendingBuildabilityBlockers.length,
    required_approval_count: requiredApprovals.length,
    validated_approval_count: validatedApprovals.length,
    pending_required_approvals: pendingApprovals.length,
    open_risk_count: openRisks.length,
    critical_or_high_risk_count: criticalOrHighRisks.length,
  };
};

const deriveNextSteps = ({
  deal,
  ddItems = [],
  approvals = [],
  riskFlags = [],
  financials = null,
  documentCount = 0,
  documentCategoryCounts = {},
  readinessSummary = null,
}) => {
  const summary = readinessSummary || buildReadinessSummary({
    ddItems,
    approvals,
    riskFlags,
    financials,
    documentCount,
  });

  const groups = {
    'Immediate DD Actions': [],
    'Legal Actions': [],
    'Regulatory Actions': [],
    'Technical / Site Actions': [],
    'Commercial / Negotiation Actions': [],
    'Financing / Investor Actions': [],
    'Approval / Certification Actions': [],
    'Reporting / Export Actions': [],
  };

  const openRisks = riskFlags.filter((flag) => OPEN_RISK_STATUSES.has(flag.status));
  const pendingRequiredDD = ddItems.filter((item) => item.is_required && !READY_STATUSES.has(item.status));
  const titleGaps = pendingRequiredDD.filter((item) => item.category === 'title_ownership');
  const zoningGaps = pendingRequiredDD.filter(
    (item) => item.category === 'land_classification' || item.category === 'project_specific',
  );
  const legalRisk = openRisks.find((flag) => ['title', 'legal'].includes(flag.category));
  const zoningRisk = openRisks.find((flag) => ['zoning', 'regulatory'].includes(flag.category));
  const physicalRisk = openRisks.find((flag) => flag.category === 'physical');

  if (documentCount === 0) {
    uniquePush(
      groups['Immediate DD Actions'],
      'Upload the first set of title, revenue, and commercial documents so extraction and diligence can begin.',
    );
  }

  if (getDocCount(documentCategoryCounts, 'legal') === 0) {
    uniquePush(
      groups['Legal Actions'],
      'Request core title documents, EC, mutation records, and any active encumbrance evidence from the seller side.',
    );
  }

  if (titleGaps.length > 0 || legalRisk) {
    uniquePush(
      groups['Legal Actions'],
      `Resolve ${titleGaps.length || 1} title or ownership diligence gap${titleGaps.length === 1 ? '' : 's'} before term-sheet hardening.`,
    );
  }

  if (summary.pending_deal_breakers > 0) {
    uniquePush(
      groups['Immediate DD Actions'],
      `${summary.pending_deal_breakers} deal-breaker DD item${summary.pending_deal_breakers === 1 ? '' : 's'} remain open and should be escalated first.`,
    );
  }

  if (zoningGaps.length > 0 || zoningRisk || !deal?.zoning || !deal?.permissible_fsi) {
    uniquePush(
      groups['Regulatory Actions'],
      'Confirm live zoning, permissible use, and FSI/FAR from authority-backed documents before relying on buildability assumptions.',
    );
  }

  const conversionApproval = approvals.find((item) => item.approval_type === 'conversion');
  if (conversionApproval && !(conversionApproval.is_validated || APPROVAL_READY_STATUSES.has(conversionApproval.status))) {
    uniquePush(
      groups['Regulatory Actions'],
      'Validate land conversion status before advancing final underwriting or negotiation.',
    );
  }

  const pendingRequiredApprovals = approvals.filter(
    (item) => item.is_required && !(item.is_validated || APPROVAL_READY_STATUSES.has(item.status)),
  );
  if (pendingRequiredApprovals.length > 0) {
    uniquePush(
      groups['Approval / Certification Actions'],
      `${pendingRequiredApprovals.length} required approval item${pendingRequiredApprovals.length === 1 ? '' : 's'} still need validation or document support.`,
    );
  }

  if (deal?.rera_number) {
    const reraApproval = approvals.find((item) => item.approval_type === 'rera');
    if (!reraApproval || !(reraApproval.is_validated || APPROVAL_READY_STATUSES.has(reraApproval.status))) {
      uniquePush(
        groups['Approval / Certification Actions'],
        'Match the stored RERA number against supporting registration documents and validity dates.',
      );
    }
  }

  if (!deal?.geocode_status || deal.geocode_status === 'pending') {
    uniquePush(
      groups['Technical / Site Actions'],
      'Confirm the site location, geocode the parcel, and verify that the mapped site matches the sourced opportunity.',
    );
  }

  if (!deal?.road_width_mtrs || physicalRisk) {
    uniquePush(
      groups['Technical / Site Actions'],
      'Verify road access, frontage, and physical constraints on-ground before locking buildability assumptions.',
    );
  }

  if (STRUCTURED_DEAL_TYPES.has(deal?.deal_structure)) {
    uniquePush(
      groups['Commercial / Negotiation Actions'],
      'Prepare the structure-specific economics pack covering partner obligations, commercial splits, and downside protections.',
    );
  }

  if (!financials) {
    uniquePush(
      groups['Financing / Investor Actions'],
      'Complete the baseline underwriting model so price, cost, and return discussions are grounded in deterministic numbers.',
    );
  } else if (financials.irr_pct == null || financials.total_revenue_cr == null || financials.total_cost_cr == null) {
    uniquePush(
      groups['Financing / Investor Actions'],
      'Refresh the financial model inputs so IRR, total cost, and total revenue are fully populated before IC circulation.',
    );
  }

  if (summary.critical_or_high_risk_count > 0) {
    uniquePush(
      groups['Financing / Investor Actions'],
      'Re-run downside scenarios after resolving critical/high risk flags to quantify underwriting impact.',
    );
  }

  if (deal?.stage === 'ic_review' || deal?.stage === 'negotiation' || summary.readiness_pct >= 60) {
    uniquePush(
      groups['Reporting / Export Actions'],
      'Generate an updated IC-ready summary with risks, approvals, and current headline economics before the next decision meeting.',
    );
  }

  if (summary.readiness_pct < 45) {
    uniquePush(
      groups['Immediate DD Actions'],
      'Bring the deal to minimum diligence readiness before pushing it deeper into negotiation or committee workflow.',
    );
  }

  return Object.entries(groups)
    .map(([group, items]) => ({ group, items }))
    .filter((entry) => entry.items.length > 0);
};

module.exports = {
  buildReadinessSummary,
  deriveNextSteps,
};
