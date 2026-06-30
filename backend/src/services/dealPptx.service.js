'use strict';

/**
 * Deal PPTX export — orchestrator + re-export shim.
 *
 * The original 2,292-LOC file was decomposed during the Bet 3 refactor
 * (2026-04-30) into five concern-bounded modules under
 * `services/exports/pptx/`:
 *
 *   - `_helpers.js`         — pure formatters, COLORS/FONT constants,
 *                             label maps, predicates.
 *   - `contentBuilders.js`  — every `buildXxxRows` / `buildXxxCommentary`
 *                             that shapes data for a slide.
 *   - `deckContext.js`      — `buildSlideManifest` + `buildDeckContext`,
 *                             the entry point that fans out to all the
 *                             content builders.
 *   - `primitives.js`       — pptxgenjs primitives (`addTopHeader`,
 *                             `addCard`, `addKpiCard`, `addBulletList`,
 *                             `addTable`, `addSectionDivider`).
 *   - `slides.js`           — every `renderXxx` slide renderer.
 *
 * This file holds only the orchestrator: `renderSlide` (the big switch
 * over `slideDef.key`) and `buildDealDeckPptx` (the entry the export route
 * calls). Public API surface — `buildDealDeckPptx` + the `__testables`
 * bundle — is unchanged so existing routes + tests don't change.
 */

const PptxGenJS = require('pptxgenjs');

const { buildSlideManifest, buildDeckContext } = require('./exports/pptx/deckContext');
const { addTopHeader, addSectionDivider } = require('./exports/pptx/primitives');
const {
  renderCover,
  renderBriefing,
  renderContents,
  renderDecisionFrame,
  renderExecutiveSummary,
  renderInvestmentHighlights,
  renderStructure,
  renderMarketPositioning,
  renderLocationContext,
  renderPlanningContext,
  renderAssetSnapshot,
  renderSiteYield,
  renderReadiness,
  renderFinancialOverview,
  renderCashFlowSensitivity,
  renderTransactionSummary,
  renderRisksMitigants,
  renderNextSteps,
  renderProsCons,
  renderKeyAssumptions,
  renderDisclaimer,
  // PR-NX54 (2026-05-19) — 3 new AI narrative slides (cross-product
  // parity with DOCX PR-NX43 / NX44 / NX45)
  renderRiskNarrative,
  renderSensitivityNarrative,
  renderDocumentInsights,
} = require('./exports/pptx/slides');
// PR-NX18 (2026-05-16): the asset-class × structure × exit-strategy aware
// briefing service is shared across all three export formats (XLSX, DOCX,
// PPTX). Each format renders the same `briefing` object in its own visual
// style — XLSX as a sheet, DOCX as a section, PPTX as slide 2. Cross-product
// consistency: an IC reviewer downloading any of the 3 sees identical
// headline language for the same deal.
const { generateDealBriefing } = require('./exports/xlsx/v2/dealBriefing.service');
const {
  buildExecutiveSummaryPoints,
  buildInvestmentHighlights,
} = require('./exports/pptx/contentBuilders');
const { computeDealScore } = require('../utils/scoring/dealScore');
const { renderScoreGaugeDataUri } = require('./exports/shared/svgGauge.service');
const { renderSiteMapDetailed, isGoogleMapsEnabled } = require('./exports/shared/googleMapsStaticMap.service');
const { renderAssetClassArt } = require('./exports/shared/assetClassArt.service');
const { generateSection } = require('./exports/narrative/exportNarrative.service');

// Format helpers (lightweight — primary formatters live in pptx/_helpers.js).
const fmtPct = (v, d = 1) => (v == null || Number.isNaN(Number(v)) ? null : `${Number(v).toFixed(d)}%`);
const fmtCr = (v) => (v == null || Number.isNaN(Number(v)) ? null : `INR ${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })} Cr`);
const fmtArea = (v) => (v == null || Number.isNaN(Number(v)) ? null : `${Number(v).toLocaleString('en-IN')} sqft`);
const fmtRate = (v) => (v == null || Number.isNaN(Number(v)) ? null : `INR ${Number(v).toLocaleString('en-IN')} / sqft`);

/**
 * Build a section-specific right-panel preview for the divider slide.
 * Each section returns a heading + 2–4 label/value tiles drawn from
 * already-computed deck context. Where data is missing we just send
 * fewer tiles (don't fabricate).
 */
const buildDividerRightPanel = (kind, context) => {
  const cards = [];
  if (kind === 'opportunity') {
    if (context.irr != null)             cards.push({ label: 'Project IRR',      value: fmtPct(context.irr, 1) });
    if (context.equityMultiple != null)  cards.push({ label: 'Equity multiple',  value: `${Number(context.equityMultiple).toFixed(2)}x` });
    if (context.npv != null)             cards.push({ label: 'NPV',              value: fmtCr(context.npv) });
    if (context.grossMargin != null)     cards.push({ label: 'Gross margin',     value: fmtPct(context.grossMargin, 1) });
    return {
      heading: 'What you will see in this section',
      cards,
      note: cards.length ? 'Live KPIs synthesised from the underwriting model.' : null,
    };
  }
  if (kind === 'market') {
    const cityCount = (context.cityBenchmarks || []).length;
    const compCount = (context.compRows || []).length;
    if (cityCount)                        cards.push({ label: 'City benchmarks',  value: String(cityCount), hint: 'verified rates / yields' });
    if (compCount)                        cards.push({ label: 'Verified comps',   value: String(compCount) });
    if (context.benchmarkMedianRate != null) cards.push({ label: 'Median rate',   value: fmtRate(context.benchmarkMedianRate) });
    if (context.priceGapPct != null)      cards.push({ label: 'Price-gap vs market', value: fmtPct(context.priceGapPct, 1) });
    return {
      heading: 'Market context for this site',
      cards,
      note: cards.length ? null : 'Market intelligence will populate as verified data lands.',
    };
  }
  if (kind === 'asset') {
    if (context.saleableAreaSqft != null) cards.push({ label: 'Saleable area',    value: fmtArea(context.saleableAreaSqft) });
    if (context.landAreaSqft != null)     cards.push({ label: 'Land area',        value: fmtArea(context.landAreaSqft) });
    if (context.modelSellRate != null)    cards.push({ label: 'Sell rate',        value: fmtRate(context.modelSellRate) });
    if (context.readiness?.readiness_pct != null) cards.push({ label: 'Readiness', value: `${context.readiness.readiness_pct}%`, hint: 'execution prep' });
    return {
      heading: 'Asset & site at a glance',
      cards,
      note: null,
    };
  }
  if (kind === 'financial') {
    if (context.totalCost != null)        cards.push({ label: 'Total project cost', value: fmtCr(context.totalCost) });
    if (context.totalRevenue != null)     cards.push({ label: 'Total revenue',      value: fmtCr(context.totalRevenue) });
    if (context.irr != null)              cards.push({ label: 'IRR',                value: fmtPct(context.irr, 1) });
    if (context.equityMultiple != null)   cards.push({ label: 'Equity multiple',    value: `${Number(context.equityMultiple).toFixed(2)}x` });
    return {
      heading: 'Financial summary preview',
      cards,
      note: 'Detailed cash flow, sensitivity, and capital stack follow.',
    };
  }
  return { heading: 'Section preview', cards: [], note: null };
};

const renderSlide = (pptx, slide, context, slideDef, pageNumber, totalSlides) => {
  switch (slideDef.key) {
    case 'cover': renderCover(pptx, slide, context, totalSlides); return;
    case 'briefing': renderBriefing(pptx, slide, context, pageNumber, totalSlides); return;
    case 'contents': renderContents(pptx, slide, context, pageNumber, totalSlides); return;
    case 'decisionFrame': renderDecisionFrame(pptx, slide, context, pageNumber, totalSlides); return;
    case 'dividerOpportunity': addSectionDivider(pptx, slide, context, 'The Opportunity', `${context.assetClassLabel} | ${context.dealTypeLabel}`, pageNumber, totalSlides, { rightPanel: buildDividerRightPanel('opportunity', context) }); return;
    case 'executiveSummary': renderExecutiveSummary(pptx, slide, context, pageNumber, totalSlides); return;
    case 'investmentHighlights': renderInvestmentHighlights(pptx, slide, context, pageNumber, totalSlides); return;
    case 'structure': renderStructure(pptx, slide, context, pageNumber, totalSlides); return;
    case 'dividerMarket': addSectionDivider(pptx, slide, context, 'Market / Micro-Market', `${context.deal.city || 'City'} | verified market context`, pageNumber, totalSlides, { rightPanel: buildDividerRightPanel('market', context) }); return;
    case 'marketPositioning': renderMarketPositioning(pptx, slide, context, pageNumber, totalSlides); return;
    case 'locationContext': renderLocationContext(pptx, slide, context, pageNumber, totalSlides); return;
    case 'planningContext': renderPlanningContext(pptx, slide, context, pageNumber, totalSlides); return;
    case 'dividerAsset': addSectionDivider(pptx, slide, context, 'About the Asset', `${context.assetClassLabel} | site, title, and delivery context`, pageNumber, totalSlides, { rightPanel: buildDividerRightPanel('asset', context) }); return;
    case 'assetSnapshot': renderAssetSnapshot(pptx, slide, context, pageNumber, totalSlides); return;
    case 'siteYield': renderSiteYield(pptx, slide, context, pageNumber, totalSlides); return;
    case 'readiness': renderReadiness(pptx, slide, context, pageNumber, totalSlides); return;
    case 'dividerFinancial': addSectionDivider(pptx, slide, context, 'Financial Summary', `${context.assetClassLabel} | current underwriting outputs`, pageNumber, totalSlides, { rightPanel: buildDividerRightPanel('financial', context) }); return;
    case 'financialOverview': renderFinancialOverview(pptx, slide, context, pageNumber, totalSlides); return;
    case 'cashFlowSensitivity': renderCashFlowSensitivity(pptx, slide, context, pageNumber, totalSlides); return;
    // PR-NX54 (2026-05-19) — 3 new AI narrative slides
    case 'sensitivityNarrative': renderSensitivityNarrative(pptx, slide, context, pageNumber, totalSlides); return;
    case 'transactionSummary': renderTransactionSummary(pptx, slide, context, pageNumber, totalSlides); return;
    case 'risksMitigants': renderRisksMitigants(pptx, slide, context, pageNumber, totalSlides); return;
    case 'riskNarrative': renderRiskNarrative(pptx, slide, context, pageNumber, totalSlides); return;
    case 'documentInsights': renderDocumentInsights(pptx, slide, context, pageNumber, totalSlides); return;
    case 'prosCons': renderProsCons(pptx, slide, context, pageNumber, totalSlides); return;
    case 'nextSteps': renderNextSteps(pptx, slide, context, pageNumber, totalSlides); return;
    case 'keyAssumptions': renderKeyAssumptions(pptx, slide, context, pageNumber, totalSlides); return;
    case 'disclaimer': renderDisclaimer(pptx, slide, context, pageNumber, totalSlides); return;
    default: addTopHeader(pptx, slide, context, slideDef.title, pageNumber, totalSlides);
  }
};

/**
 * Pre-compute the async-fetch dependencies that can't run inside the sync
 * render loop: QR data URI, score gauge SVG, AI Pros & Cons synthesis.
 *
 * Every step is wrapped so a single failure never crashes the deck. If
 * Gemini is down or unconfigured, prosCons renders deterministically.
 * If `options.publicUrl` isn't supplied, the QR is omitted.
 */
const precomputeDeckAssets = async (exportContext, baseContext, options) => {
  const dealId = exportContext?.deal?.id || null;
  const orgId = exportContext?.deal?.organization_id || null;

  // Risk-count rollup for deal-score input.
  const riskSummary = exportContext?.risks?.summary || {};
  const ddSummary = exportContext?.dd?.summary || exportContext?.diligence?.summary || {};
  const ddTotal = Number(ddSummary.total_required) || Number(ddSummary.total) || 0;
  const ddDone = Number(ddSummary.completed_required) || Number(ddSummary.completed) || 0;
  const ddCompletionPct = ddTotal > 0 ? Math.round((ddDone / ddTotal) * 100) : null;

  const scoreInput = {
    assetClass: baseContext.assetClass,
    irrPct: baseContext.irr,
    equityMultiple: baseContext.equityMultiple,
    grossMarginPct: baseContext.grossMargin,
    ddCompletionPct,
    riskCounts: {
      critical: Number(riskSummary.critical) || 0,
      high: Number(riskSummary.high) || 0,
      medium: Number(riskSummary.medium) || 0,
      low: Number(riskSummary.low) || 0,
    },
    financialModelPresent: !!baseContext.hasFinancialModel,
  };
  const dealScore = computeDealScore(scoreInput);

  // Run AI narrative + Mapbox site-map fetch + AI Briefing in parallel.
  // Each wrapped so a single failure never crashes the deck — each returns
  // a fallback shape.
  const lat = Number(exportContext?.deal?.property_lat);
  const lng = Number(exportContext?.deal?.property_lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

  // PR-NX18 (2026-05-16): adapter that reshapes deck context → briefing
  // service input. The briefing service was written for XLSX which has
  // its own ctx shape (ctx.kernelKpis.*); PPTX has the flat shape (ctx.irr,
  // ctx.noi, etc.). This adapter wraps the flat shape so the same shared
  // service produces the same asset-class × structure × exit-strategy
  // aware narrative — XLSX, PPTX, and DOCX share verbatim language.
  const briefingCtx = {
    deal: exportContext?.deal || {},
    property: exportContext?.property || exportContext?.deal?.property || {},
    inputs: baseContext.inputs || {},
    assetClass: baseContext.assetClass,
    dealFamily: baseContext.isIncome ? 'income' : 'development',
    projectMonths: Number(exportContext?.deal?.project_duration_months)
      || Number(baseContext.inputs?.projectDurationMonths)
      || 36,
    kernelKpis: {
      irr: baseContext.irr,
      npv: baseContext.npv,
      equityMultiple: baseContext.equityMultiple,
      noi: baseContext.noi,
      grossMargin: baseContext.grossMargin,
      yieldOnCost: baseContext.yieldOnCost,
      totalRevenue: baseContext.totalRevenue,
      totalCost: baseContext.totalCost,
      exitValue: baseContext.exitValue,
      residualLandValue: baseContext.residualLandValue,
    },
  };

  const [prosCons, siteMapResult, briefing] = await Promise.all([
    generateSection({
      section: 'prosCons',
      payload: {
        kpis: {
          irrPct: baseContext.irr,
          npvCr: baseContext.npv,
          equityMultiple: baseContext.equityMultiple,
          grossMarginPct: baseContext.grossMargin,
          totalCostCr: baseContext.totalCost,
          totalRevenueCr: baseContext.totalRevenue,
        },
        dd_progress: { completionPct: ddCompletionPct, openDealBreakers: Number(ddSummary.open_deal_breakers) || 0 },
        approvals: baseContext.approvalSummary,
        risk_flags: baseContext.exportContext?.risks?.items?.slice(0, 5) || [],
        comp_positioning: {
          benchmarkMedianRate: baseContext.benchmarkMedianRate,
          modelSellRate: baseContext.modelSellRate,
        },
        asset_class: baseContext.assetClass,
        deal_type: baseContext.dealTypeLabel,
        locality: baseContext.locationLine,
      },
      dealId,
      organizationId: orgId,
    }).catch(() => ({ available: false, pros: [], cons: [], reason: 'Narrative call failed' })),
    hasCoords
      ? renderSiteMapDetailed({ lat, lng, zoom: 15, label: baseContext.locationLine || 'Site' })
          .catch((err) => ({ buffer: null, status: 'fetch_failed', error: err?.message || 'Map render threw', httpStatus: null }))
      : Promise.resolve({ buffer: null, status: 'no_coords', error: 'No coordinates on the deal record.', httpStatus: null }),
    // PR-NX18: AI Briefing — always returns a valid briefing object
    // (templated fallback when AI is unavailable).
    generateDealBriefing(briefingCtx)
      .catch(() => null),
  ]);
  const siteMapBuffer = siteMapResult?.buffer || null;
  const siteMapStatus = siteMapResult?.status || (hasCoords ? (isGoogleMapsEnabled() ? 'fetch_failed' : 'no_token') : 'no_coords');
  const siteMapError = siteMapResult?.error || null;
  const siteMapHttpStatus = siteMapResult?.httpStatus || null;

  const scoreGaugeDataUri = renderScoreGaugeDataUri({
    score: dealScore.score,
    subline: dealScore.benchmark.assetClass
      ? `Composite — ${baseContext.assetClassLabel}`
      : 'Composite — generic benchmark',
  });

  // Asset-class artwork for the cover. Pure SVG; never throws.
  let assetArtDataUri = null;
  try {
    const art = renderAssetClassArt(baseContext.assetClass);
    assetArtDataUri = art.dataUri;
  } catch {
    assetArtDataUri = null;
  }

  return {
    scoreGaugeDataUri,
    dealScore,
    prosCons,
    siteMapBuffer,
    siteMapStatus,
    siteMapError,
    siteMapHttpStatus,
    assetArtDataUri,
    briefing, // PR-NX18: asset-class-aware AI briefing for the briefing slide
  };
};

const buildDealDeckPptx = async (exportContext, options = {}) => {
  const pptx = new PptxGenJS();
  const context = buildDeckContext(exportContext, options);

  // Async pre-fetch — never throws; each step has its own fallback.
  context.precomputed = await precomputeDeckAssets(exportContext, context, options);

  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = options.userName || 'REDIP';
  pptx.company = options.brandName || 'REDIP';
  pptx.subject = `${context.assetClassLabel} investment deck`;
  pptx.title = `${context.dealTitle} | ${context.assetClassLabel}`;
  pptx.lang = 'en-IN';

  const totalSlides = context.slideManifest.length;
  context.slideManifest.forEach((slideDef, index) => {
    const slide = pptx.addSlide();
    renderSlide(pptx, slide, context, slideDef, index + 1, totalSlides);
  });

  return pptx.write({ outputType: 'nodebuffer' });
};

module.exports = {
  buildDealDeckPptx,
  __testables: {
    buildDeckContext,
    buildSlideManifest,
    buildExecutiveSummaryPoints,
    buildInvestmentHighlights,
    precomputeDeckAssets,
  },
};
