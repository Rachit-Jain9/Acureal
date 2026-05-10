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
  renderContents,
  renderExecutiveSummary,
  renderInvestmentHighlights,
  renderStructure,
  renderMarketPositioning,
  renderLocationContext,
  renderPlanningContext,
  renderAssetSnapshot,
  renderReadiness,
  renderFinancialOverview,
  renderCashFlowSensitivity,
  renderTransactionSummary,
  renderRisksMitigants,
  renderNextSteps,
  renderProsCons,
  renderDisclaimer,
} = require('./exports/pptx/slides');
const {
  buildExecutiveSummaryPoints,
  buildInvestmentHighlights,
} = require('./exports/pptx/contentBuilders');
const { computeDealScore } = require('../utils/scoring/dealScore');
const { renderQrDataUri } = require('./exports/shared/qrImage.service');
const { renderScoreGaugeDataUri } = require('./exports/shared/svgGauge.service');
const { generateSection } = require('./exports/narrative/exportNarrative.service');

const renderSlide = (pptx, slide, context, slideDef, pageNumber, totalSlides) => {
  switch (slideDef.key) {
    case 'cover': renderCover(pptx, slide, context, totalSlides); return;
    case 'contents': renderContents(pptx, slide, context, pageNumber, totalSlides); return;
    case 'dividerOpportunity': addSectionDivider(pptx, slide, context, 'The Opportunity', `${context.assetClassLabel} | ${context.dealTypeLabel}`, pageNumber, totalSlides); return;
    case 'executiveSummary': renderExecutiveSummary(pptx, slide, context, pageNumber, totalSlides); return;
    case 'investmentHighlights': renderInvestmentHighlights(pptx, slide, context, pageNumber, totalSlides); return;
    case 'structure': renderStructure(pptx, slide, context, pageNumber, totalSlides); return;
    case 'dividerMarket': addSectionDivider(pptx, slide, context, 'Market / Micro-Market', `${context.deal.city || 'City'} | verified market context`, pageNumber, totalSlides); return;
    case 'marketPositioning': renderMarketPositioning(pptx, slide, context, pageNumber, totalSlides); return;
    case 'locationContext': renderLocationContext(pptx, slide, context, pageNumber, totalSlides); return;
    case 'planningContext': renderPlanningContext(pptx, slide, context, pageNumber, totalSlides); return;
    case 'dividerAsset': addSectionDivider(pptx, slide, context, 'About the Asset', `${context.assetClassLabel} | site, title, and delivery context`, pageNumber, totalSlides); return;
    case 'assetSnapshot': renderAssetSnapshot(pptx, slide, context, pageNumber, totalSlides); return;
    case 'readiness': renderReadiness(pptx, slide, context, pageNumber, totalSlides); return;
    case 'dividerFinancial': addSectionDivider(pptx, slide, context, 'Financial Summary', `${context.assetClassLabel} | current underwriting outputs`, pageNumber, totalSlides); return;
    case 'financialOverview': renderFinancialOverview(pptx, slide, context, pageNumber, totalSlides); return;
    case 'cashFlowSensitivity': renderCashFlowSensitivity(pptx, slide, context, pageNumber, totalSlides); return;
    case 'transactionSummary': renderTransactionSummary(pptx, slide, context, pageNumber, totalSlides); return;
    case 'risksMitigants': renderRisksMitigants(pptx, slide, context, pageNumber, totalSlides); return;
    case 'prosCons': renderProsCons(pptx, slide, context, pageNumber, totalSlides); return;
    case 'nextSteps': renderNextSteps(pptx, slide, context, pageNumber, totalSlides); return;
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
  const baseUrl = options.publicUrl || process.env.REDIP_PUBLIC_URL || 'https://redip.vercel.app';
  const liveDealUrl = dealId ? `${baseUrl.replace(/\/$/, '')}/deals/${dealId}` : null;

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

  // Run async tasks in parallel — QR generation is local-fast, gauge is
  // pure synchronous (we wrap it for shape consistency), prosCons is the
  // potentially-slow remote call.
  const [qrDataUri, prosCons] = await Promise.all([
    liveDealUrl
      ? renderQrDataUri(liveDealUrl, { dark: '#0E1B2C', light: '#FBF9F6' }).catch(() => null)
      : Promise.resolve(null),
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
  ]);

  const scoreGaugeDataUri = renderScoreGaugeDataUri({
    score: dealScore.score,
    subline: dealScore.benchmark.assetClass
      ? `Composite — ${baseContext.assetClassLabel}`
      : 'Composite — generic benchmark',
  });

  return {
    qrDataUri,
    scoreGaugeDataUri,
    dealScore,
    prosCons,
    liveDealUrl,
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
