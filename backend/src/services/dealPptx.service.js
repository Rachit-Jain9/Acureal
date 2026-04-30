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
  renderAssetSnapshot,
  renderReadiness,
  renderFinancialOverview,
  renderCashFlowSensitivity,
  renderTransactionSummary,
  renderRisksMitigants,
  renderNextSteps,
  renderDisclaimer,
} = require('./exports/pptx/slides');
const {
  buildExecutiveSummaryPoints,
  buildInvestmentHighlights,
} = require('./exports/pptx/contentBuilders');

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
    case 'dividerAsset': addSectionDivider(pptx, slide, context, 'About the Asset', `${context.assetClassLabel} | site, title, and delivery context`, pageNumber, totalSlides); return;
    case 'assetSnapshot': renderAssetSnapshot(pptx, slide, context, pageNumber, totalSlides); return;
    case 'readiness': renderReadiness(pptx, slide, context, pageNumber, totalSlides); return;
    case 'dividerFinancial': addSectionDivider(pptx, slide, context, 'Financial Summary', `${context.assetClassLabel} | current underwriting outputs`, pageNumber, totalSlides); return;
    case 'financialOverview': renderFinancialOverview(pptx, slide, context, pageNumber, totalSlides); return;
    case 'cashFlowSensitivity': renderCashFlowSensitivity(pptx, slide, context, pageNumber, totalSlides); return;
    case 'transactionSummary': renderTransactionSummary(pptx, slide, context, pageNumber, totalSlides); return;
    case 'risksMitigants': renderRisksMitigants(pptx, slide, context, pageNumber, totalSlides); return;
    case 'nextSteps': renderNextSteps(pptx, slide, context, pageNumber, totalSlides); return;
    case 'disclaimer': renderDisclaimer(pptx, slide, context, pageNumber, totalSlides); return;
    default: addTopHeader(pptx, slide, context, slideDef.title, pageNumber, totalSlides);
  }
};

const buildDealDeckPptx = async (exportContext, options = {}) => {
  const pptx = new PptxGenJS();
  const context = buildDeckContext(exportContext, options);

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
  },
};
