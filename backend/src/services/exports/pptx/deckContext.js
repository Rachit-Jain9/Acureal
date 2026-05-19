'use strict';

/**
 * Deck context builder. Composes deal + financials + market data into a
 * normalized `context` object plus a `slideManifest` array that the
 * orchestrator iterates over.
 *
 * Extracted from the original dealPptx.service.js as part of the Bet 3
 * god-service decomposition.
 */

const { inferAssetClass } = require('../../../utils/assetClass');
const {
  COLORS,
  STAGE_LABELS,
  PRIORITY_LABELS,
  num,
  firstNumber,
  positiveNumber,
  firstText,
  humanize,
  formatNumber,
  formatCrores,
  formatPct,
  formatArea,
  formatRate,
  formatRent,
  formatDate,
  truncate,
  pickSeverityColor,
  dedupeByTitle,
  severityRank,
  hasStructureMismatch,
  getAssetClassLabel,
  getDealTypeLabel,
  getDealStructureLabel,
  isIncomeAsset,
  isLandLedAsset,
  isStructuredDeal,
  midpoint,
  filterRows,
} = require('./_helpers');
const {
  buildDerivedRiskRows,
  buildFinancialRows,
  buildFinancialCommentary,
  buildTransactionCommentary,
  buildExecutiveSummaryPoints,
  buildInvestmentHighlights,
  buildMarketObservations,
  buildAssetNarrative,
  buildCounterpartyRows,
  buildLocationRows,
  buildAssetDetailRows,
  buildProjectRows,
  buildApprovalRows,
  buildDiligenceRows,
  buildTransactionRows,
  buildRiskRows,
  buildNextStepGroups,
  buildPlanningRows,
  buildPlanningCommentary,
} = require('./contentBuilders');

const buildSlideManifest = (context) => {
  // PR-NX18 (2026-05-16): AI-Assisted Briefing slide is the 2nd slide
  // (right after Cover). Mirrors the XLSX Executive Briefing tab being
  // the 1st sheet — IC reviewer reads the AI synthesis FIRST, then dives
  // into the structured content. Pre-NX18 this slide existed only in
  // XLSX; PPTX + DOCX had no asset-class-aware briefing.
  const slides = [
    { key: 'cover', title: context.dealTitle },
    { key: 'briefing', title: 'Executive Briefing' }, // PR-NX74 (2026-05-19) — renamed; PPTX must not surface AI usage per operator policy.
    { key: 'contents', title: 'Contents' },
    { key: 'decisionFrame', title: 'Decision Frame & Composite Score' },
    { key: 'dividerOpportunity', title: 'The Opportunity' },
    { key: 'executiveSummary', title: 'Executive Summary' },
    { key: 'investmentHighlights', title: 'Key Investment Highlights' },
  ];

  if (context.showStructureSlide) {
    slides.push({ key: 'structure', title: 'Structure & Counterparty' });
  }

  slides.push(
    { key: 'dividerMarket', title: 'Market / Micro-Market' },
    { key: 'marketPositioning', title: context.cityBenchmarks.length ? 'City Benchmarking' : 'Market Positioning' },
    { key: 'locationContext', title: 'Location & Site Context' },
  );

  if (context.hasPlanningContext) {
    slides.push({ key: 'planningContext', title: 'Planning Context — RMP 2031' });
  }

  slides.push(
    { key: 'dividerAsset', title: 'About the Asset' },
    { key: 'assetSnapshot', title: 'Asset Snapshot' },
  );

  if (context.showReadinessSlide) {
    slides.push({
      key: 'readiness',
      title: context.isIncome ? 'Diligence & Operating Readiness' : 'Development Readiness',
    });
  }

  if (context.hasFinancialModel) {
    slides.push(
      { key: 'dividerFinancial', title: 'Financial Summary' },
      { key: 'financialOverview', title: context.isIncome ? 'Operating Economics' : 'Development Economics' },
    );

    if (context.hasCashFlowSlide) {
      slides.push({ key: 'cashFlowSensitivity', title: 'Cash Flow & Sensitivity' });
    }

    // PR-NX54 (2026-05-19): AI sensitivity narrative slide right after the
    // cashFlowSensitivity tornado. Reader sees driver decomposition +
    // recommended stress tests after the visual that backs the claim.
    // Mirrors DOCX PR-NX44.
    slides.push({ key: 'sensitivityNarrative', title: 'Sensitivity Analysis · Narrative' });
  }

  slides.push(
    { key: 'transactionSummary', title: 'Transaction Summary' },
    { key: 'risksMitigants', title: 'Risks & Mitigants' },
    // PR-NX54 (2026-05-19): AI risk profile synthesis slide right after the
    // structured Risks & Mitigants slide. Mirrors DOCX PR-NX43.
    { key: 'riskNarrative', title: 'Risk Profile Synthesis' },
    // PR-NX54 (2026-05-19): NEW Document-Derived Insights slide — Claude
    // cross-document analysis + 0-5 inconsistency findings from the
    // extracted document set. Mirrors DOCX PR-NX45.
    { key: 'documentInsights', title: 'Document-Derived Insights' },
    { key: 'prosCons', title: 'Pros & Cons' },
    { key: 'nextSteps', title: 'Next Steps' },
    { key: 'keyAssumptions', title: 'Key Assumptions & Sources' },
    { key: 'disclaimer', title: 'Disclaimer' },
  );

  return slides;
};

const buildDeckContext = (exportContext, options = {}) => {
  const deal = exportContext.deal || {};
  const model = deal.model_params || {};
  const inputs = model.inputs || {};
  const modelKpis = model.kpis || {};
  const modelAreas = model.areas || {};
  const modelCosts = model.costs || {};
  const modelRevenue = model.revenue || {};
  const capitalStack = model.capitalStack || {};
  const scenarios = model.scenarios || {};
  const assetClass = inferAssetClass({ deal, inputs });
  const landAreaSqft = firstNumber(deal.land_area_sqft, deal.plot_area_sqft, modelAreas.grossBuiltUp);
  const grossAreaSqft = firstNumber(deal.gross_area_sqft, modelAreas.grossBuiltUp);
  const saleableAreaSqft = firstNumber(deal.saleable_area_sqft, modelAreas.saleable);
  const carpetAreaSqft = firstNumber(deal.carpet_area_sqft, modelAreas.carpet);
  const leasableAreaSqft = firstNumber(modelAreas.leasable, deal.saleable_area_sqft);
  const benchmarkMedianRate = firstNumber(exportContext.market?.benchmarks?.median_rate_per_sqft);
  const modelSellRate = firstNumber(deal.selling_rate_per_sqft, inputs.sellingRatePerSqft);
  const baseRent = firstNumber(inputs.baseRentPerSqftMonth);
  const noi = firstNumber(deal.noi_cr, deal.stabilized_noi_cr, modelKpis.noi, modelRevenue.stabilizedNOI);
  const exitValue = firstNumber(deal.exit_value_cr, modelKpis.exitValue, modelRevenue.exitValue, deal.total_revenue_cr);
  const entryValue = firstNumber(deal.entry_value_cr, modelKpis.entryValue);
  const yieldOnCost = firstNumber(deal.yield_on_cost_pct, modelKpis.yieldOnCost);
  const irr = firstNumber(deal.irr_pct, modelKpis.irr);
  const npv = firstNumber(deal.npv_cr, modelKpis.npv);
  const equityMultiple = firstNumber(deal.equity_multiple, modelKpis.equityMultiple);
  const grossMargin = firstNumber(deal.gross_margin_pct, modelKpis.grossMarginPct);
  const residualLandValue = firstNumber(deal.residual_land_value_cr, modelKpis.rlv);
  const totalCost = firstNumber(deal.total_cost_cr, modelCosts.total);
  const totalRevenue = firstNumber(deal.total_revenue_cr, modelRevenue.totalRevenueCr);
  const negotiatedPrice = positiveNumber(deal.negotiated_price_cr);
  const askPrice = positiveNumber(deal.land_ask_price_cr);
  const commercialMarker = firstNumber(negotiatedPrice, askPrice, entryValue);
  const priceGapPct = num(exportContext.market?.pricingGapPct);
  const readiness = exportContext.readiness || {};
  const approvalSummary = exportContext.approvals?.summary || {};
  const documentSummary = exportContext.documents?.summary || {};
  const recommendations = exportContext.risks?.recommendation || {};
  const cityBenchmarks = Array.isArray(exportContext.market?.cityBenchmarks)
    ? exportContext.market.cityBenchmarks.slice(0, 5)
    : [];
  const compRows = Array.isArray(exportContext.market?.exportComps)
    ? exportContext.market.exportComps.slice(0, 5)
    : [];
  const cashRows = exportContext.cashFlows?.yearly?.length
    ? exportContext.cashFlows.yearly.slice(0, 8)
    : Array.isArray(exportContext.cashFlows?.quarterly)
      ? exportContext.cashFlows.quarterly.slice(0, 8)
      : [];
  const sensitivityMatrix = exportContext.sensitivity || {};
  const scenarioRows = ['base', 'bull', 'bear']
    .map((key) => scenarios[key])
    .filter(Boolean)
    .map((scenario) => ({
      label: scenario.label,
      irr: formatPct(scenario.kpis?.irr, 1) || 'N/A',
      npv: formatCrores(scenario.kpis?.npv, 2) || 'N/A',
      multiple: scenario.kpis?.equityMultiple != null ? `${formatNumber(scenario.kpis.equityMultiple, 2)}x` : 'N/A',
    }));

  const context = {
    brandName: options.brandName || 'REDIP',
    generatedAt: options.generatedAt || exportContext.generatedAt || new Date().toISOString(),
    generatedFor: options.userName || 'REDIP user',
    exportContext,
    deal,
    model,
    inputs,
    modelKpis,
    modelAreas,
    modelCosts,
    modelRevenue,
    capitalStack,
    scenarios,
    assetClass,
    assetClassLabel: getAssetClassLabel(assetClass),
    isIncome: isIncomeAsset(assetClass),
    isLandLed: isLandLedAsset(assetClass),
    dealTypeLabel: getDealTypeLabel(deal.deal_type),
    dealStructureLabel: getDealStructureLabel(deal.deal_structure),
    stageLabel: STAGE_LABELS[deal.stage] || humanize(deal.stage) || 'Stage not provided',
    priorityLabel: PRIORITY_LABELS[deal.priority] || humanize(deal.priority),
    propertyTitle: firstText(deal.property_name, deal.name) || 'Institutional Real Estate Opportunity',
    dealTitle: firstText(deal.name, deal.property_name) || 'Institutional Opportunity',
    locationLine: firstText([deal.city, deal.state].filter(Boolean).join(', '), deal.property_address, deal.city) || 'Location not provided',
    addressLine: firstText(deal.property_address, [deal.city, deal.state].filter(Boolean).join(', ')),
    coordinates:
      num(deal.property_lat) !== null && num(deal.property_lng) !== null
        ? `${num(deal.property_lat).toFixed(6)}, ${num(deal.property_lng).toFixed(6)}`
        : null,
    landAreaSqft,
    grossAreaSqft,
    saleableAreaSqft,
    carpetAreaSqft,
    leasableAreaSqft,
    benchmarkMedianRate,
    modelSellRate,
    baseRent,
    noi,
    exitValue,
    entryValue,
    yieldOnCost,
    irr,
    npv,
    equityMultiple,
    grossMargin,
    residualLandValue,
    totalCost,
    totalRevenue,
    valueGapCr: totalRevenue !== null && totalCost !== null ? totalRevenue - totalCost : null,
    askPrice,
    negotiatedPrice,
    commercialMarker,
    priceGapPct,
    readiness,
    approvalSummary,
    documentSummary,
    recommendations,
    cityBenchmarks,
    compRows,
    cashRows,
    sensitivityMatrix,
    scenarioRows,
    hasFinancialModel: !!(totalCost !== null || totalRevenue !== null || irr !== null || noi !== null),
    hasCashFlowSlide:
      cashRows.length >= 2
      || Array.isArray(sensitivityMatrix?.irrGrid) && sensitivityMatrix.irrGrid.length > 0
      || scenarioRows.length > 0,
    structureMismatch: hasStructureMismatch(deal),
    showStructureSlide:
      [
        deal.owner_name,
        deal.ownership_type,
        deal.land_ask_price_cr,
        deal.negotiated_price_cr,
        deal.deal_structure,
        deal.jv_split_developer_pct,
        deal.jv_split_landowner_pct,
      ].filter((value) => value !== null && value !== undefined && value !== '').length >= 3,
    showReadinessSlide:
      (exportContext.approvals?.items?.length || 0) > 0
      || (exportContext.dd?.items?.length || 0) > 0
      || (exportContext.documents?.items?.length || 0) > 0
      || (exportContext.risks?.items?.length || 0) > 0,
  };

  context.riskRows = buildRiskRows(context, exportContext);
  context.executivePoints = buildExecutiveSummaryPoints(context, exportContext);
  context.highlightCards = buildInvestmentHighlights(context, exportContext);
  context.marketObservations = buildMarketObservations(context, exportContext);
  context.assetNarrative = buildAssetNarrative(context, exportContext);
  context.counterpartyRows = buildCounterpartyRows(context);
  context.locationRows = buildLocationRows(context);
  context.assetDetailRows = buildAssetDetailRows(context);
  context.projectRows = buildProjectRows(context);
  context.approvalRows = buildApprovalRows(exportContext);
  context.diligenceRows = buildDiligenceRows(exportContext);
  context.financialRows = buildFinancialRows(context);
  context.financialCommentary = buildFinancialCommentary(context);
  context.transactionRows = buildTransactionRows(context, exportContext);
  context.transactionCommentary = buildTransactionCommentary(context);
  context.nextStepGroups = buildNextStepGroups(exportContext);
  context.planningRows = buildPlanningRows(exportContext);
  context.planningCommentary = buildPlanningCommentary(exportContext);
  context.hasPlanningContext = (Array.isArray(context.planningRows) && context.planningRows.length > 0)
    || Boolean(exportContext?.planning?.zone);
  context.slideManifest = buildSlideManifest(context);

  return context;
};


module.exports = {
  buildSlideManifest,
  buildDeckContext,
};
