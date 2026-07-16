'use strict';

/**
 * Slide renderers. Each renderXxx takes (pptx, slide, context,
 * pageNumber, totalSlides) and paints one slide's content using the
 * primitives. Pure presentation — all data shaping happened upstream in
 * contentBuilders + deckContext.
 *
 * Extracted from the original dealPptx.service.js as part of the Bet 3
 * god-service decomposition.
 */

const {
  COLORS,
  FONT,
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
  resolveStatusText,
  dedupeByTitle,
  hasStructureMismatch,
  isIncomeAsset,
  isLandLedAsset,
  isStructuredDeal,
  midpoint,
  filterRows,
} = require('./_helpers');
const {
  setSlideDefaults,
  addTopHeader,
  addCard,
  addKpiCard,
  addBulletList,
  addTable,
  addSectionDivider,
  addScoreGauge,
  addProsConsColumns,
} = require('./primitives');
const { drawAssetClassCover } = require('./coverArtwork');
const { deriveCompProvenance, formatAbsoluteDate } = require('../../../utils/compProvenance');

const renderCover = (pptx, slide, context, totalSlides) => {
  setSlideDefaults(slide);
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 13.33, h: 7.5,
    fill: { color: COLORS.paper },
    line: { color: COLORS.paper, pt: 0.1 },
  });

  slide.addShape(pptx.ShapeType.rect, {
    x: 0.55, y: 0.65, w: 5.8, h: 5.45,
    fill: { color: COLORS.sand },
    line: { color: COLORS.sandDeep, pt: 0.2 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.55, y: 0.65, w: 0.28, h: 5.45,
    fill: { color: COLORS.plum },
    line: { color: COLORS.plum, pt: 0.1 },
  });

  // Right half — full-bleed atmospheric asset-class artwork drawn with
  // pptxgenjs **native shape primitives** (rect, ellipse, triangle, line,
  // text). No SVG image embedding — every element is a first-class
  // PowerPoint object, fully editable, and the deck cannot trigger
  // PowerPoint's "found a problem with content" recovery dialog from a
  // fragile SVG embed. Per-class composition (residential skyline, hotel
  // at evening, warehouse at dusk, raw-land plot diagram, etc.).
  drawAssetClassCover(pptx, slide, context.assetClass, {
    x: 6.65, y: 0, w: 6.68, h: 7.5,
  });
  // Asset-class eyebrow tag overlaid on the artwork (top-right).
  slide.addShape(pptx.ShapeType.rect, {
    x: 8.65, y: 0.45, w: 4.4, h: 0.42,
    fill: { color: COLORS.plum, transparency: 8 },
    line: { color: COLORS.plum, pt: 0.1 },
  });
  slide.addText(context.assetClassLabel.toUpperCase(), {
    x: 8.85, y: 0.5, w: 4.0, h: 0.32,
    fontFace: FONT, fontSize: 10, bold: true, color: 'FFFFFF', charSpace: 2.2, valign: 'mid',
  });

  slide.addText(context.brandName, {
    x: 0.98, y: 0.95, w: 1.8, h: 0.18,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.plum, charSpace: 1.8,
  });
  slide.addText(context.dealTitle, {
    x: 0.98, y: 1.55, w: 4.95, h: 1.22,
    fontFace: FONT, fontSize: 28, bold: true, color: COLORS.charcoal, fit: 'shrink',
  });
  slide.addText(`${context.assetClassLabel} | ${context.dealTypeLabel}`, {
    x: 0.98, y: 3.0, w: 4.7, h: 0.22,
    fontFace: FONT, fontSize: 11, color: COLORS.plum, bold: true,
  });
  slide.addText(context.locationLine, {
    x: 0.98, y: 3.28, w: 4.8, h: 0.3,
    fontFace: FONT, fontSize: 12, color: COLORS.charcoal,
  });
  slide.addText(`Generated ${formatDate(context.generatedAt)}`, {
    x: 0.98, y: 5.62, w: 2.2, h: 0.16,
    fontFace: FONT, fontSize: 8, color: COLORS.muted,
  });

  const coverCards = [
    { label: context.isIncome ? 'NOI / Base Rent' : 'IRR', value: context.isIncome ? (formatCrores(context.noi) || formatRent(context.baseRent)) : formatPct(context.irr), tone: COLORS.plum },
    { label: context.isIncome ? 'Exit Value' : 'NPV', value: context.isIncome ? formatCrores(context.exitValue) : formatCrores(context.npv), tone: COLORS.plum },
    { label: context.isIncome ? 'Yield / Exit Cap' : 'Revenue / Value', value: context.isIncome ? (formatPct(context.yieldOnCost) || formatPct(context.inputs.exitCapRate, 2)) : formatCrores(firstNumber(context.totalRevenue, context.exitValue)), tone: COLORS.sandDeep },
    { label: 'Execution Readiness', value: context.readiness.readiness_pct != null ? `${context.readiness.readiness_pct}%` : 'N/A', tone: COLORS.sandDeep },
  ];

  coverCards.forEach((card, index) => {
    addKpiCard(pptx, slide, {
      x: 0.98 + index * 1.36,
      y: 4.18,
      w: 1.22,
      h: 1.18,
      label: card.label,
      value: card.value || 'N/A',
      tone: card.tone,
    });
  });

  slide.addText(`${totalSlides} editable slides | Internal investment material`, {
    x: 10.0, y: 6.72, w: 2.7, h: 0.16,
    fontFace: FONT, fontSize: 8, color: COLORS.muted, align: 'right',
  });
};

// ──────────────────────────────────────────────────────────────────────
// PR-NX18 (2026-05-16) — AI-Assisted Briefing slide (cross-product parity)
// ──────────────────────────────────────────────────────────────────────
//
// Mirrors the XLSX Executive Briefing tab (PR-NX7 / PR-NX12) and the
// DOCX AI-Assisted Briefing section. Same asset-class × deal-structure
// × exit-strategy aware narrative — so an IC reviewer reading the PPTX,
// DOCX, or XLSX for the same deal sees identical headline language.
//
// Sourced from `context.briefing` which is pre-computed in
// `precomputeDeckAssets` via the shared `generateDealBriefing()` service.
// The shared service handles AI-first → templated-fallback so the slide
// always renders even if Claude is rate-limited / unconfigured.
//
// Mandatory CLAUDE.md disclosure: every AI-synthesized narrative carries
// "AI-Assisted — REQUIRES HUMAN REVIEW" in a prominent amber banner.
const renderBriefing = (pptx, slide, context, pageNumber, totalSlides) => {
  // PR-NX74 (2026-05-19) — slide renamed from "AI-Assisted Briefing" to
  // "Executive Briefing" per operator policy (PPTX must not surface AI
  // usage anywhere). The mandatory amber disclosure banner that used to
  // sit below the header — `⚠ AI-Assisted Briefing (synthesis: gpt-5.4)
  // — REQUIRES HUMAN REVIEW...` — is removed entirely.
  addTopHeader(pptx, slide, context, 'Executive Briefing', pageNumber, totalSlides, `${context.assetClassLabel} | ${context.dealStructureLabel} | ${context.locationLine}`);

  const briefing = context.precomputed?.briefing || null;

  // Returns summary (one-liner — directly under the disclosure)
  slide.addText('Modeled Returns', {
    x: 0.5, y: 1.62, w: 6.0, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });
  slide.addText(briefing?.summary || 'Returns pending kernel computation — fill in inputs and refresh the deal.', {
    x: 0.5, y: 1.85, w: 12.33, h: 0.45,
    fontFace: FONT, fontSize: 14, bold: true, color: COLORS.charcoal, fit: 'shrink',
  });

  // Key Points — 4 asset-class-aware bullets in a 2×2 card grid
  slide.addText('Key Points', {
    x: 0.5, y: 2.45, w: 6.0, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });

  const bullets = Array.isArray(briefing?.bullets) ? briefing.bullets : [
    `${context.assetClassLabel} deal in ${context.locationLine}.`,
    'Operating economics pending — populate the Inputs sheet to refresh.',
    'Capital structure + exit pending.',
    'India context pending.',
  ];
  // Pad to 4 bullets so the grid always renders evenly
  while (bullets.length < 4) bullets.push('');

  const cardLayout = [
    { x: 0.5, y: 2.72, w: 6.10, h: 1.55, label: 'Overview' },
    { x: 6.73, y: 2.72, w: 6.10, h: 1.55, label: 'Economics' },
    { x: 0.5, y: 4.35, w: 6.10, h: 1.55, label: 'Capital + Exit' },
    { x: 6.73, y: 4.35, w: 6.10, h: 1.55, label: 'India Context' },
  ];

  cardLayout.forEach((card, idx) => {
    slide.addShape(pptx.ShapeType.rect, {
      x: card.x, y: card.y, w: card.w, h: card.h,
      fill: { color: COLORS.paper },
      line: { color: COLORS.hairline || 'D7DDE5', pt: 0.5 },
    });
    // Eyebrow label (top-left)
    slide.addText(card.label.toUpperCase(), {
      x: card.x + 0.18, y: card.y + 0.14, w: card.w - 0.36, h: 0.22,
      fontFace: FONT, fontSize: 8, bold: true, color: COLORS.plum, charSpace: 2.0,
    });
    // Bullet text
    slide.addText(bullets[idx] || '', {
      x: card.x + 0.18, y: card.y + 0.40, w: card.w - 0.36, h: card.h - 0.55,
      fontFace: FONT, fontSize: 11, color: COLORS.charcoal, valign: 'top',
      paraSpaceBefore: 0, paraSpaceAfter: 0,
    });
  });

  // Risk Note — crimson-fill callout at the bottom
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 6.00, w: 12.33, h: 0.65,
    fill: { color: COLORS.crimson || 'B23A48' },
    line: { color: COLORS.crimson || 'B23A48', pt: 0.1 },
  });
  slide.addText('RISK NOTE', {
    x: 0.65, y: 6.06, w: 1.4, h: 0.20,
    fontFace: FONT, fontSize: 9, bold: true, color: 'FFFFFF', charSpace: 2.0,
  });
  slide.addText(briefing?.riskNote || 'Review all kernel-stored values against source documents before IC.', {
    x: 0.65, y: 6.28, w: 12.0, h: 0.32,
    fontFace: FONT, fontSize: 11, color: 'FFFFFF', valign: 'mid',
  });

  // PR-NX74 (2026-05-19) — footer simplified per operator policy.
  // Was: `Generated ${date} · Synthesis: ${provider} · Per-deal snapshot
  // cached · auto-failover: ${rawErrorJSON}` which leaked the model id +
  // raw provider error JSON. Now just a quiet generation date.
  slide.addText(`Generated ${formatDate(context.generatedAt)}`, {
    x: 0.5, y: 6.78, w: 12.33, h: 0.18,
    fontFace: FONT, fontSize: 8, italic: true, color: COLORS.muted,
  });
};

/**
 * Contents slide — pure table-of-contents with slide numbers.
 *
 * Renders as a 2-column ToC. Each top-level section (the divider
 * keys + their grouped slides) gets a heading and the working slides
 * underneath are listed with their resolved slide number. Non-divider
 * stand-alone slides (Cover, Contents, Disclaimer, etc.) skip the
 * group heading and render in a "Open & Close" section at top.
 *
 * Decision Frame + Composite Score moved to its own slide (renderDecisionFrame).
 */
const renderContents = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Contents', pageNumber, totalSlides, `${context.assetClassLabel} | ${context.locationLine}`);

  // Build a structured outline by walking the slide manifest. Keys that
  // start with 'divider' open a new section; everything inside is listed.
  const sections = [];
  let current = null;
  context.slideManifest.forEach((slideDef, index) => {
    const slideNumber = index + 1;
    if (slideDef.key.startsWith('divider')) {
      current = { title: slideDef.title, startSlide: slideNumber + 1, items: [] };
      sections.push(current);
      return;
    }
    if (slideDef.key === 'cover' || slideDef.key === 'contents') return;
    if (!current) {
      current = { title: 'Open & Decision Frame', startSlide: slideNumber, items: [] };
      sections.push(current);
    }
    current.items.push({ title: slideDef.title, slideNumber });
  });

  // Two-column layout: A (left) and B (right). Distribute sections so
  // both columns are roughly equal. Each section title + its items.
  // Compute total row count per column to balance.
  const rowCount = (s) => 1 + s.items.length; // 1 for the section header
  const totalRows = sections.reduce((acc, s) => acc + rowCount(s), 0);
  const target = totalRows / 2;
  let leftRows = 0;
  const splitIdx = sections.findIndex((s, i) => {
    leftRows += rowCount(s);
    return leftRows >= target;
  });
  const leftSections = sections.slice(0, splitIdx + 1);
  const rightSections = sections.slice(splitIdx + 1);

  // Card frame for the whole ToC
  addCard(pptx, slide, { x: 0.55, y: 1.25, w: 12.23, h: 5.55, bandColor: COLORS.plum, fill: COLORS.white });

  const renderColumn = (cols, x, w) => {
    let y = 1.5;
    cols.forEach((section, sIdx) => {
      // Section heading row
      slide.addText(section.title.toUpperCase(), {
        x, y, w: w * 0.75, h: 0.26,
        fontFace: FONT, fontSize: 10, bold: true, color: COLORS.plum, charSpace: 1.4,
      });
      slide.addText(`p${section.startSlide}`, {
        x: x + w * 0.78, y, w: w * 0.2, h: 0.26,
        fontFace: FONT, fontSize: 10, bold: true, color: COLORS.plumSoft, align: 'right',
      });
      // Hairline below heading
      slide.addShape(pptx.ShapeType.line, {
        x, y: y + 0.28, w, h: 0,
        line: { color: COLORS.line, pt: 0.6 },
      });
      y += 0.36;
      // Items
      section.items.forEach((item) => {
        slide.addText(item.title, {
          x: x + 0.1, y, w: w * 0.78, h: 0.24,
          fontFace: FONT, fontSize: 9.5, color: COLORS.charcoal, fit: 'shrink',
        });
        slide.addText(String(item.slideNumber).padStart(2, '0'), {
          x: x + w * 0.82, y, w: w * 0.16, h: 0.24,
          fontFace: FONT, fontSize: 9.5, bold: true, color: COLORS.muted, align: 'right',
        });
        y += 0.32;
      });
      // Section gap
      if (sIdx < cols.length - 1) y += 0.16;
    });
  };

  renderColumn(leftSections, 0.85, 5.7);
  renderColumn(rightSections, 7.0, 5.7);
};

/**
 * Decision Frame & Composite Score slide.
 *
 * New slide that sits between Contents and the first divider. Splits
 * into two halves: live decision-frame bullets on the left (the read
 * the operator sees BEFORE diving in), composite score gauge + weight
 * breakdown on the right. Replaces the cramped right-card on the old
 * Contents slide.
 */
const renderDecisionFrame = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Decision Frame & Composite Score', pageNumber, totalSlides, `${context.stageLabel} | how to read this deck`);

  // ── Left half — Decision Frame card
  addCard(pptx, slide, { x: 0.55, y: 1.25, w: 6.05, h: 5.55, bandColor: COLORS.plum, fill: COLORS.white });
  slide.addText('CURRENT DECISION FRAME', {
    x: 0.85, y: 1.45, w: 5.6, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });
  addBulletList(slide, [
    `${context.dealTypeLabel} opportunity in ${context.locationLine}.`,
    context.recommendations?.label
      ? `Current underwriting call: ${context.recommendations.label}.`
      : 'Current underwriting call is not yet stored.',
    context.readiness?.readiness_pct != null
      ? context.approvalSummary?.required
        ? `Readiness stands at ${context.readiness.readiness_pct}%, with ${context.approvalSummary.validated || 0}/${context.approvalSummary.required || 0} required approvals validated.`
        : `Readiness stands at ${context.readiness.readiness_pct}%, and required approvals have not yet been fully tagged in REDIP.`
      : 'Readiness inputs are not yet complete.',
    context.structureMismatch
      ? 'Commercial form needs confirmation because the stored deal type and structure do not align.'
      : `Deck covers ${totalSlides} slides across opportunity, market, asset, and transaction considerations.`,
  ], {
    x: 0.85, y: 1.85, w: 5.55, h: 4.7,
    fontSize: 11,
    bulletColor: COLORS.plumSoft,
    lineH: 0.6,
  });

  // ── Right half — Composite Score panel
  addCard(pptx, slide, { x: 6.85, y: 1.25, w: 5.93, h: 5.55, bandColor: COLORS.plumSoft, fill: COLORS.white });
  slide.addText('COMPOSITE SCORE', {
    x: 7.15, y: 1.45, w: 5.55, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });

  const dealScore = context.precomputed?.dealScore;
  if (dealScore && context.precomputed?.scoreGaugeDataUri) {
    // Gauge — left side of the right panel
    slide.addImage({
      x: 6.95, y: 1.65, w: 3.0, h: 2.2,
      data: context.precomputed.scoreGaugeDataUri,
      altText: 'Composite score gauge',
    });
    // Score numeric + band beside the gauge
    slide.addText(`${dealScore.score} / 100`, {
      x: 9.95, y: 1.85, w: 2.7, h: 0.5,
      fontFace: FONT, fontSize: 22, bold: true, color: COLORS.plum, valign: 'top',
    });
    slide.addText((dealScore.band || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), {
      x: 9.95, y: 2.4, w: 2.7, h: 0.32,
      fontFace: FONT, fontSize: 11, bold: true, color: COLORS.plumSoft,
    });
    if (dealScore.benchmark?.assetClass) {
      slide.addText(`Benchmarked against ${context.assetClassLabel}.`, {
        x: 9.95, y: 2.78, w: 2.7, h: 0.7,
        fontFace: FONT, fontSize: 8.5, italic: true, color: COLORS.muted, fit: 'shrink',
      });
    }

    // Hairline + "Weight Breakdown" eyebrow
    slide.addShape(pptx.ShapeType.line, {
      x: 7.15, y: 4.0, w: 5.55, h: 0,
      line: { color: COLORS.line, pt: 0.6 },
    });
    slide.addText('WEIGHT BREAKDOWN', {
      x: 7.15, y: 4.12, w: 5.55, h: 0.22,
      fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
    });

    // Mini-table rendering breakdown rows
    const breakdown = (dealScore.breakdown || []).slice(0, 6);
    breakdown.forEach((row, idx) => {
      const rowY = 4.42 + idx * 0.36;
      // Component name
      slide.addText(row.component || '–', {
        x: 7.15, y: rowY, w: 3.6, h: 0.32,
        fontFace: FONT, fontSize: 9, color: COLORS.charcoal, valign: 'mid',
      });
      // Awarded / max bar
      const ratio = row.max > 0 ? row.awarded / row.max : 0;
      const barTotalW = 1.0;
      const barFillW = Math.max(0.04, ratio * barTotalW);
      slide.addShape(pptx.ShapeType.rect, {
        x: 10.85, y: rowY + 0.09, w: barTotalW, h: 0.14,
        fill: { color: COLORS.line },
        line: { color: COLORS.line, pt: 0.1 },
      });
      slide.addShape(pptx.ShapeType.rect, {
        x: 10.85, y: rowY + 0.09, w: barFillW, h: 0.14,
        fill: { color: ratio >= 0.7 ? COLORS.green : ratio >= 0.4 ? COLORS.amber : COLORS.red },
        line: { color: ratio >= 0.7 ? COLORS.green : ratio >= 0.4 ? COLORS.amber : COLORS.red, pt: 0.1 },
      });
      // Awarded / max numeric
      slide.addText(`${row.awarded} / ${row.max}`, {
        x: 11.95, y: rowY, w: 0.78, h: 0.32,
        fontFace: FONT, fontSize: 9, bold: true, color: COLORS.charcoal, align: 'right', valign: 'mid',
      });
    });

    // Disclaimer footer
    slide.addText('Composite score is a deterministic synthesis of structured deal data only. Not an investment recommendation.', {
      x: 7.15, y: 6.5, w: 5.55, h: 0.32,
      fontFace: FONT, fontSize: 7.5, italic: true, color: COLORS.muted, valign: 'top',
    });
  } else {
    slide.addText('Composite score unavailable for this deal.', {
      x: 7.15, y: 3.5, w: 5.55, h: 0.4,
      fontFace: FONT, fontSize: 11, italic: true, color: COLORS.muted, align: 'center',
    });
  }
};

const renderExecutiveSummary = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Executive Summary', pageNumber, totalSlides, `${context.stageLabel} | ${context.locationLine}`);

  addCard(pptx, slide, { x: 0.55, y: 1.25, w: 7.08, h: 5.55, bandColor: COLORS.plum });
  slide.addText('Investment Facts', {
    x: 0.82, y: 1.47, w: 2.0, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  addBulletList(slide, context.executivePoints, {
    x: 0.82,
    y: 1.9,
    w: 6.4,
    h: 3.9,
    fontSize: 10.5,
  });

  addCard(pptx, slide, { x: 7.9, y: 1.25, w: 4.88, h: 3.65, bandColor: COLORS.sandDeep });
  const cards = [
    { label: context.isIncome ? 'NOI / Base Rent' : 'IRR', value: context.isIncome ? (formatCrores(context.noi) || formatRent(context.baseRent)) : formatPct(context.irr), tone: COLORS.plum },
    { label: context.isIncome ? 'Exit Value' : 'NPV', value: context.isIncome ? formatCrores(context.exitValue) : formatCrores(context.npv), tone: COLORS.plum },
    { label: context.isIncome ? 'Yield / Exit Cap' : 'Margin', value: context.isIncome ? (formatPct(context.yieldOnCost) || formatPct(context.inputs.exitCapRate, 2)) : formatPct(context.grossMargin), tone: COLORS.sandDeep },
    { label: 'Ask / Marker', value: formatCrores(context.commercialMarker), tone: COLORS.sandDeep },
    { label: 'Readiness', value: context.readiness.readiness_pct != null ? `${context.readiness.readiness_pct}%` : 'N/A', tone: COLORS.plumSoft },
    { label: 'Open Risks', value: String(Math.max(num(context.exportContext?.risks?.summary?.total) || 0, context.riskRows.length || 0)), tone: COLORS.plumSoft },
  ];
  cards.forEach((card, index) => {
    addKpiCard(pptx, slide, {
      x: 8.18 + (index % 2) * 2.26,
      y: 1.62 + Math.floor(index / 2) * 0.96,
      w: 1.98,
      h: 0.82,
      label: card.label,
      value: card.value || 'N/A',
      tone: card.tone,
    });
  });

  addCard(pptx, slide, { x: 7.9, y: 5.1, w: 4.88, h: 1.7, bandColor: context.recommendations.tone === 'negative' ? COLORS.red : context.recommendations.tone === 'caution' ? COLORS.amber : COLORS.green });
  slide.addText('Current Recommendation', {
    x: 8.18, y: 5.34, w: 2.1, h: 0.16,
    fontFace: FONT, fontSize: 10, bold: true, color: COLORS.charcoal,
  });
  slide.addText((context.recommendations.label || 'Proceed With Conditions').toUpperCase(), {
    x: 8.18, y: 5.65, w: 4.2, h: 0.24,
    fontFace: FONT, fontSize: 16, bold: true, color: context.recommendations.tone === 'negative' ? COLORS.red : context.recommendations.tone === 'caution' ? COLORS.amber : COLORS.green,
  });
  slide.addText(context.recommendations.reason || 'Current recommendation is based on the stored underwriting and diligence stack.', {
    x: 8.18, y: 6.02, w: 4.18, h: 0.42,
    fontFace: FONT, fontSize: 8.5, color: COLORS.charcoal, fit: 'shrink',
  });
};

const renderInvestmentHighlights = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Key Investment Highlights', pageNumber, totalSlides, `${context.assetClassLabel} | ${context.locationLine}`);

  const cards = context.highlightCards.length
    ? context.highlightCards
    : [{ title: 'Deal context', detail: 'Stored REDIP data is currently limited, so the highlight set will expand as approvals, comps, and underwriting inputs are added.' }];

  // 2×2 grid — taller cards (1.55") with numbered badges in copper, hairline
  // separator under the title, larger body type. Replaces the previous
  // dense-but-flat 1.42" cards.
  cards.slice(0, 4).forEach((card, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 0.55 + col * 6.18;
    const y = 1.32 + row * 1.78;
    addCard(pptx, slide, {
      x,
      y,
      w: 5.95,
      h: 1.55,
      bandColor: row % 2 === 0 ? COLORS.plum : COLORS.sandDeep,
      fill: row % 2 === 0 ? COLORS.white : COLORS.mist,
    });
    // Numbered badge (top-left) — copper square with single white digit.
    // No zero-padding — "01/02/03/04" wraps vertically in the small
    // badge and reads as separate digits stacked. Plain 1/2/3/4 is
    // unambiguous.
    slide.addShape(pptx.ShapeType.rect, {
      x: x + 0.22, y: y + 0.22, w: 0.36, h: 0.36,
      fill: { color: COLORS.plumSoft }, line: { color: COLORS.plumSoft, pt: 0 },
    });
    slide.addText(String(index + 1), {
      x: x + 0.22, y: y + 0.22, w: 0.36, h: 0.36,
      fontFace: FONT, fontSize: 16, bold: true, color: COLORS.white,
      align: 'center', valign: 'mid',
    });
    // Title (right of badge)
    slide.addText(card.title, {
      x: x + 0.70, y: y + 0.22, w: 5.0, h: 0.36,
      fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal, valign: 'mid',
    });
    // Hairline separator beneath title
    slide.addShape(pptx.ShapeType.line, {
      x: x + 0.22, y: y + 0.66, w: 5.5, h: 0,
      line: { color: COLORS.line, pt: 0.6 },
    });
    // Detail body
    slide.addText(card.detail, {
      x: x + 0.22, y: y + 0.74, w: 5.5, h: 0.74,
      fontFace: FONT, fontSize: 9.5, color: COLORS.charcoal, fit: 'shrink', valign: 'top',
    });
  });

  // Bottom strip — Thesis Bottom Line (fills the previously empty
  // y 4.95 → 6.65 zone). Three tiles surfacing the most-decisive
  // headline numbers + one-line reading of the recommendation tone.
  addCard(pptx, slide, {
    x: 0.55, y: 4.98, w: 12.23, h: 1.62,
    bandColor: COLORS.plumSoft, fill: COLORS.white,
  });
  slide.addText('THESIS BOTTOM LINE', {
    x: 0.78, y: 5.12, w: 4.0, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });

  const tone = context.recommendations?.tone || 'neutral';
  const recoColor = tone === 'negative' ? COLORS.red : tone === 'caution' ? COLORS.amber : COLORS.green;
  const irrText = formatPct(context.irr) || '–';
  const emText = context.equityMultiple != null ? `${formatNumber(context.equityMultiple, 2)}x` : '–';
  const readinessText = context.readiness?.readiness_pct != null
    ? `${context.readiness.readiness_pct}%`
    : '–';
  const tiles = [
    { eyebrow: 'PROJECT IRR / EM',     value: `${irrText}  ·  ${emText}`, color: COLORS.charcoal, accent: COLORS.plum },
    { eyebrow: 'EXECUTION READINESS',  value: readinessText,              color: COLORS.charcoal, accent: COLORS.plum },
    { eyebrow: 'CURRENT RECOMMENDATION', value: (context.recommendations?.label || 'Review').toUpperCase(), color: recoColor, accent: recoColor },
  ];
  tiles.forEach((tile, idx) => {
    const tx = 0.78 + idx * 4.05;
    const ty = 5.40;
    slide.addShape(pptx.ShapeType.rect, {
      x: tx, y: ty, w: 3.85, h: 1.10,
      fill: { color: COLORS.mist }, line: { color: COLORS.line, pt: 0.5 },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: tx, y: ty, w: 0.06, h: 1.10,
      fill: { color: tile.accent }, line: { color: tile.accent, pt: 0 },
    });
    slide.addText(tile.eyebrow, {
      x: tx + 0.20, y: ty + 0.14, w: 3.5, h: 0.22,
      fontFace: FONT, fontSize: 8, bold: true, color: COLORS.muted, charSpace: 1.4,
    });
    slide.addText(tile.value, {
      x: tx + 0.20, y: ty + 0.40, w: 3.5, h: 0.62,
      fontFace: FONT, fontSize: 22, bold: true, color: tile.color, valign: 'top', fit: 'shrink',
    });
  });
};

const renderStructure = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Structure & Counterparty', pageNumber, totalSlides, `${context.dealStructureLabel} | ${context.stageLabel}`);

  addCard(pptx, slide, { x: 0.55, y: 1.3, w: 6.1, h: 5.3, bandColor: COLORS.plum });
  slide.addText('Counterparty & Ownership', {
    x: 0.82, y: 1.52, w: 2.6, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  context.counterpartyRows.slice(0, 9).forEach((row, index) => {
    const y = 1.92 + index * 0.44;
    slide.addText(row.label, {
      x: 0.82, y, w: 1.8, h: 0.16,
      fontFace: FONT, fontSize: 8.5, color: COLORS.muted,
    });
    slide.addText(row.value, {
      x: 2.72, y: y - 0.01, w: 3.5, h: 0.2,
      fontFace: FONT, fontSize: 9, bold: true, color: COLORS.charcoal, fit: 'shrink',
    });
  });

  addCard(pptx, slide, { x: 6.95, y: 1.3, w: 5.83, h: 2.15, bandColor: COLORS.sandDeep, fill: COLORS.mist });
  slide.addText('Commercial Markers', {
    x: 7.22, y: 1.52, w: 2.2, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  addBulletList(slide, [
    context.askPrice !== null
      ? `Recorded ask or entry marker: ${formatCrores(context.askPrice)}.`
      : context.entryValue !== null
        ? `Recorded entry value marker: ${formatCrores(context.entryValue)}.`
        : 'Entry pricing has not yet been recorded.',
    context.negotiatedPrice !== null ? `Negotiation marker currently sits at ${formatCrores(context.negotiatedPrice)}.` : 'Negotiated pricing is not yet stored.',
    context.structureMismatch
      ? `Stored deal type (${context.dealTypeLabel}) and structure (${context.dealStructureLabel}) do not currently align and should be reconciled.`
      : isStructuredDeal(context.deal.deal_structure)
      ? 'Structure requires partner-level economics and downside protections to be locked before close.'
      : 'Structure currently reads as a direct purchase, which simplifies execution if diligence clears.',
  ], {
    x: 7.22,
    y: 1.93,
    w: 5.05,
    h: 1.1,
    fontSize: 9.6,
    bulletColor: COLORS.sandDeep,
  });

  // ─── Right-side bottom: Capital Structure / JV Split visualisation
  // Was: y 3.55 → 6.5 on the right column (~3" of empty canvas).
  // Now: a visual breakdown of the deal structure — bar segmentation
  // for JV/JDA splits, pricing waterfall for outright, lease terms for
  // lease deals. Honest empty-state when not enough data.
  addCard(pptx, slide, {
    x: 6.95, y: 3.65, w: 5.83, h: 2.95,
    bandColor: COLORS.plumSoft, fill: COLORS.white,
  });
  slide.addText('CAPITAL STRUCTURE', {
    x: 7.22, y: 3.78, w: 4.0, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });

  const dealStructure = String(context.deal.deal_structure || '').toLowerCase();
  const developerPct = num(context.deal.jv_split_developer_pct);
  const landownerPct = num(context.deal.jv_split_landowner_pct);
  const isJvSplit = (dealStructure === 'jv' || dealStructure === 'jda' || dealStructure === 'da')
    && developerPct != null && landownerPct != null;

  if (isJvSplit) {
    // Split bar — Developer (left) vs Landowner (right).
    slide.addText(`${context.dealStructureLabel} | Profit / Area Split`, {
      x: 7.22, y: 4.05, w: 5.3, h: 0.22,
      fontFace: FONT, fontSize: 10, color: COLORS.charcoal,
    });

    const total = developerPct + landownerPct || 100;
    const barX = 7.22;
    const barY = 4.45;
    const barW = 5.3;
    const barH = 0.42;
    const devW = (developerPct / total) * barW;

    // Background
    slide.addShape(pptx.ShapeType.rect, {
      x: barX, y: barY, w: barW, h: barH,
      fill: { color: COLORS.mist }, line: { color: COLORS.line, pt: 0.5 },
    });
    // Developer segment
    slide.addShape(pptx.ShapeType.rect, {
      x: barX, y: barY, w: devW, h: barH,
      fill: { color: COLORS.plum }, line: { color: COLORS.plum, pt: 0 },
    });
    // Landowner segment
    slide.addShape(pptx.ShapeType.rect, {
      x: barX + devW, y: barY, w: barW - devW, h: barH,
      fill: { color: COLORS.plumSoft }, line: { color: COLORS.plumSoft, pt: 0 },
    });
    // Labels in segments
    slide.addText(`Developer ${developerPct.toFixed(0)}%`, {
      x: barX + 0.08, y: barY, w: devW - 0.16, h: barH,
      fontFace: FONT, fontSize: 10, bold: true, color: COLORS.white,
      valign: 'mid', fit: 'shrink',
    });
    slide.addText(`Landowner ${landownerPct.toFixed(0)}%`, {
      x: barX + devW + 0.08, y: barY, w: barW - devW - 0.16, h: barH,
      fontFace: FONT, fontSize: 10, bold: true, color: COLORS.white,
      valign: 'mid', fit: 'shrink',
    });
    // Sub-bullets — anchored on what the split means
    slide.addText(
      `Profit / area split is the central commercial term for ${context.dealStructureLabel}. ` +
      `Lock downside protections (return cap, hurdle, force-majeure, dispute resolution) before close.`,
      {
        x: 7.22, y: 5.05, w: 5.3, h: 1.4,
        fontFace: FONT, fontSize: 10, italic: true, color: COLORS.charcoal,
        valign: 'top', fit: 'shrink',
      },
    );
  } else if (dealStructure === 'outright' || dealStructure === 'acquisition') {
    // Outright pricing breakdown — a small "Total acquisition cost" tile
    // with stamp duty + registration estimates added.
    const base = num(firstNumber(context.negotiatedPrice, context.askPrice, context.entryValue));
    if (base != null) {
      const stampDuty = base * 0.05; // standard 5% in Karnataka
      const registration = base * 0.01;
      const allIn = base + stampDuty + registration;
      const tiles = [
        { label: 'BASE PRICE',     value: formatCrores(base, 2) || '–',     accent: COLORS.plum },
        { label: 'STAMP DUTY (5%)', value: formatCrores(stampDuty, 2) || '–', accent: COLORS.plumSoft },
        { label: 'REGISTRATION (1%)', value: formatCrores(registration, 2) || '–', accent: COLORS.plumSoft },
        { label: 'ALL-IN ACQUISITION', value: formatCrores(allIn, 2) || '–', accent: COLORS.green },
      ];
      const tileW = (5.3 - 0.30) / 2;
      const tileH = 0.95;
      tiles.forEach((tile, idx) => {
        const tx = 7.22 + (idx % 2) * (tileW + 0.10);
        const ty = 4.10 + Math.floor(idx / 2) * (tileH + 0.10);
        slide.addShape(pptx.ShapeType.rect, {
          x: tx, y: ty, w: tileW, h: tileH,
          fill: { color: COLORS.mist }, line: { color: COLORS.line, pt: 0.5 },
        });
        slide.addShape(pptx.ShapeType.rect, {
          x: tx, y: ty, w: 0.06, h: tileH,
          fill: { color: tile.accent }, line: { color: tile.accent, pt: 0 },
        });
        slide.addText(tile.label, {
          x: tx + 0.18, y: ty + 0.10, w: tileW - 0.30, h: 0.20,
          fontFace: FONT, fontSize: 7.5, bold: true, color: COLORS.muted, charSpace: 1.4,
        });
        slide.addText(tile.value, {
          x: tx + 0.18, y: ty + 0.32, w: tileW - 0.30, h: 0.55,
          fontFace: FONT, fontSize: 16, bold: true, color: COLORS.charcoal,
          valign: 'top', fit: 'shrink',
        });
      });
      slide.addText(
        'Estimated stamp duty / registration applied at standard Karnataka rates. Verify against state-specific schedule before close.',
        {
          x: 7.22, y: 6.20, w: 5.3, h: 0.4,
          fontFace: FONT, fontSize: 8, italic: true, color: COLORS.muted, valign: 'top', fit: 'shrink',
        },
      );
    } else {
      slide.addText(
        'No base pricing recorded yet. Populate negotiated / ask / entry value on the deal record to surface the all-in acquisition cost (base + stamp duty + registration).',
        {
          x: 7.22, y: 4.30, w: 5.3, h: 1.6,
          fontFace: FONT, fontSize: 11, italic: true, color: COLORS.muted, align: 'center', valign: 'mid', fit: 'shrink',
        },
      );
    }
  } else {
    // Generic empty-state — structure type doesn't match a known split
    slide.addText(
      'Structure detail will populate once deal_structure and split fields are completed on the deal record.',
      {
        x: 7.22, y: 4.40, w: 5.3, h: 1.6,
        fontFace: FONT, fontSize: 11, italic: true, color: COLORS.muted, align: 'center', valign: 'mid', fit: 'shrink',
      },
    );
  }
};

const renderMarketPositioning = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, context.cityBenchmarks.length ? 'City Benchmarking' : 'Market Positioning', pageNumber, totalSlides, `${context.deal.city || 'City'} | verified pricing context`);

  const benchmarkSeries = context.cityBenchmarks.length
    ? context.cityBenchmarks.map((row) => ({
        label: truncate(row.micro_market, 22),
        value: midpoint(row.avg_price_min_per_sqft, row.avg_price_max_per_sqft),
      })).filter((row) => row.value !== null)
    : context.compRows.map((row) => ({
        label: truncate(row.project_name || row.locality || 'Comparable', 22),
        value: num(row.rate_per_sqft),
      })).filter((row) => row.value !== null);

  // Prefer a rate-vs-distance scatter when the comp service has attached
  // distance_km (i.e., we ran a nearby-coordinate query, not the city-wide
  // fallback). The scatter shows where each comp sits relative to the
  // site, with the deal's modeled rate plotted at distance = 0 for visual
  // anchoring. Falls back to the bar chart of mid-point pricing when only
  // city-level benchmarks are available.
  const compsWithDistance = (context.compRows || [])
    .map((c) => ({
      label: truncate(c.project_name || c.locality || 'Comparable', 22),
      rate: num(c.rate_per_sqft),
      distance: num(c.distance_km),
    }))
    .filter((c) => c.rate != null && c.distance != null);

  if (compsWithDistance.length >= 2 && context.modelSellRate != null) {
    // Sort by distance for cleaner scatter rendering
    compsWithDistance.sort((a, b) => a.distance - b.distance);
    const compDistances = compsWithDistance.map((c) => c.distance);
    const compRates = compsWithDistance.map((c) => c.rate);

    slide.addChart(
      pptx.ChartType.scatter,
      [
        { name: 'Distance (km)', values: [0, ...compDistances] },
        // Deal sits at distance 0 — first Y. Empty for the rest of the
        // deal-marker series; the comp series fills in the rest.
        { name: 'Deal (modeled)', values: [num(context.modelSellRate), ...compDistances.map(() => null)] },
        { name: 'Verified comps', values: [null, ...compRates] },
      ],
      {
        x: 0.55, y: 1.3, w: 6.2, h: 3.85,
        chartColors: [COLORS.sandDeep, COLORS.plum],
        lineSize: 0,
        lineDataSymbol: 'circle',
        lineDataSymbolSize: 12,
        lineDataSymbolLineSize: 0,
        showValue: false,
        showLegend: true,
        legendPos: 'b',
        legendFontSize: 8,
        legendColor: COLORS.muted,
        catAxisLabelFontSize: 8,
        valAxisLabelFontSize: 8,
        catAxisTitle: 'Distance from site (km)',
        catAxisTitleFontSize: 9,
        catAxisTitleColor: COLORS.muted,
        showCatAxisTitle: true,
        valAxisTitle: 'INR / sqft',
        valAxisTitleFontSize: 9,
        valAxisTitleColor: COLORS.muted,
        showValAxisTitle: true,
        valGridLine: { style: 'none' },
        title: 'Verified Comps — Rate vs Distance',
        titleFontFace: FONT,
        titleFontSize: 10,
        titleColor: COLORS.charcoal,
        showTitle: true,
      }
    );
  } else if (benchmarkSeries.length >= 2) {
    slide.addChart(pptx.ChartType.bar, [{
      name: 'Verified market context',
      labels: benchmarkSeries.map((row) => row.label),
      values: benchmarkSeries.map((row) => row.value),
    }], {
      x: 0.55, y: 1.3, w: 6.2, h: 3.85,
      barDir: 'bar',
      chartColors: [COLORS.plum, COLORS.sandDeep, COLORS.blue, COLORS.green, COLORS.amber],
      showValue: true,
      dataLabelFontSize: 8,
      catAxisLabelFontSize: 8,
      valAxisLabelFontSize: 8,
      legendPos: 'none',
      title: context.cityBenchmarks.length ? 'Verified Benchmark Nodes (mid-point pricing)' : 'Verified Comparable Rates',
      titleFontFace: FONT,
      titleFontSize: 10,
    });
  } else {
    addCard(pptx, slide, { x: 0.55, y: 1.3, w: 6.2, h: 3.85, bandColor: COLORS.plum });
    slide.addText('Verified market pricing context is still limited for this deal.', {
      x: 0.9, y: 2.8, w: 5.5, h: 0.34,
      fontFace: FONT, fontSize: 12, italic: true, color: COLORS.charcoal, align: 'center',
    });
  }

  // ── Bottom-left strip: comparable transactions summary table.
  // Was empty space below the chart (y 5.25–7.0) — now packed with the
  // top 4 verified comps so the deck reads as dense, not sparse.
  const compsForTable = (context.compRows || []).filter((c) => num(c.rate_per_sqft) != null).slice(0, 4);
  if (compsForTable.length > 0) {
    addCard(pptx, slide, {
      x: 0.55, y: 5.35, w: 6.2, h: 1.65,
      bandColor: COLORS.plumSoft,
      fill: COLORS.white,
    });
    slide.addText('TOP COMPARABLES', {
      x: 0.78, y: 5.5, w: 5.6, h: 0.2,
      fontFace: FONT, fontSize: 8, bold: true, color: COLORS.muted, charSpace: 1.6,
    });
    const headerCell = (t) => ({ text: t, options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum }, fontSize: 8 } });
    const compTableRows = [
      [headerCell('Project'), headerCell('Developer'), headerCell('Rate / sqft'), headerCell('Source'), headerCell('Verified')],
      ...compsForTable.map((c, idx) => {
        const prov = deriveCompProvenance(c);
        const rowFill = { color: idx % 2 === 0 ? COLORS.white : COLORS.mist };
        return [
          { text: truncate(c.project_name || '–', 20), options: { fontSize: 8, fill: rowFill } },
          { text: truncate(c.developer || '–', 15), options: { fontSize: 8, fill: rowFill } },
          { text: formatRate(c.rate_per_sqft) || '–', options: { fontSize: 8, fill: rowFill, bold: true } },
          { text: truncate(prov.sourceTypeLabel, 13), options: { fontSize: 7.5, fill: rowFill, color: COLORS.muted } },
          // Honest: only an explicit is_verified===true earns "Yes"/green; null/false → muted "No".
          { text: prov.verified ? 'Yes' : 'No', options: { fontSize: 8, fill: rowFill, color: prov.verified ? COLORS.green : COLORS.muted } },
        ];
      }),
    ];
    addTable(slide, compTableRows, {
      x: 0.78,
      y: 5.78,
      w: 5.8,
      colW: [1.65, 1.25, 1.05, 1.15, 0.7],
      rowH: 0.27,
      fontSize: 8,
    });
  }

  // ── Right column: read-through bullets + "Deal vs market" tile + per-comp distribution.
  addCard(pptx, slide, { x: 6.95, y: 1.3, w: 5.83, h: 5.7, bandColor: COLORS.sandDeep, fill: COLORS.white });
  slide.addText('Market Read-Through', {
    x: 7.22, y: 1.54, w: 2.8, h: 0.22,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  addBulletList(slide, context.marketObservations, {
    x: 7.22,
    y: 1.95,
    w: 5.3,
    h: 1.5,
    fontSize: 9.5,
    bulletColor: COLORS.sandDeep,
    lineH: 0.5,
  });

  // Hairline separator
  slide.addShape(pptx.ShapeType.line, {
    x: 7.22, y: 3.65, w: 5.3, h: 0,
    line: { color: COLORS.line, pt: 0.6 },
  });

  // Deal vs market tile — reference rate, model rate, delta.
  slide.addText('DEAL vs MARKET', {
    x: 7.22, y: 3.78, w: 5.3, h: 0.2,
    fontFace: FONT, fontSize: 8, bold: true, color: COLORS.muted, charSpace: 1.6,
  });
  const benchmark = num(context.benchmarkMedianRate);
  const modelRate = num(context.modelSellRate);
  const hasBoth = benchmark != null && modelRate != null;
  const deltaPct = hasBoth ? ((modelRate - benchmark) / benchmark) * 100 : null;
  const deltaColor = deltaPct == null ? COLORS.muted : (deltaPct > 5 ? COLORS.green : (deltaPct < -5 ? COLORS.red : COLORS.amber));
  // Three mini-tiles
  const tiles = [
    { label: 'Benchmark median', value: benchmark != null ? formatRate(benchmark) : '–', color: COLORS.charcoal },
    { label: 'Deal sell rate', value: modelRate != null ? formatRate(modelRate) : '–', color: COLORS.charcoal },
    { label: 'Delta vs median', value: deltaPct == null ? '–' : `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`, color: deltaColor },
  ];
  tiles.forEach((tile, idx) => {
    const tx = 7.22 + idx * 1.78;
    const ty = 4.05;
    slide.addShape(pptx.ShapeType.rect, {
      x: tx, y: ty, w: 1.65, h: 0.95,
      fill: { color: COLORS.mist },
      line: { color: COLORS.line, pt: 0.5 },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: tx, y: ty, w: 0.06, h: 0.95,
      fill: { color: idx === 2 ? deltaColor : COLORS.plum },
      line: { color: idx === 2 ? deltaColor : COLORS.plum, pt: 0.1 },
    });
    slide.addText(tile.label.toUpperCase(), {
      x: tx + 0.18, y: ty + 0.08, w: 1.45, h: 0.18,
      fontFace: FONT, fontSize: 7, bold: true, color: COLORS.muted, charSpace: 1.2,
    });
    slide.addText(tile.value, {
      x: tx + 0.18, y: ty + 0.32, w: 1.45, h: 0.5,
      fontFace: FONT, fontSize: 13, bold: true, color: tile.color, valign: 'top', fit: 'shrink',
    });
  });

  // Bottom note — verified count.
  // Honest verified count: only an explicit is_verified===true (null/false are NOT verified).
  const verifiedCount = (context.compRows || []).filter((c) => c.is_verified === true).length;
  const totalCompRows = (context.compRows || []).length;
  const asOfDates = (context.compRows || []).map((c) => c.as_of_date).filter(Boolean).sort();
  const latestAsOf = asOfDates.length ? formatAbsoluteDate(asOfDates[asOfDates.length - 1]) : null;
  if (totalCompRows > 0) {
    slide.addText(
      `${verifiedCount} of ${totalCompRows} comparable rate references are verified.${latestAsOf ? ` Market data as of ${latestAsOf}.` : ''} Unverified rows surfaced for context only.`,
      {
        x: 7.22, y: 5.35, w: 5.3, h: 0.5,
        fontFace: FONT, fontSize: 8.5, italic: true, color: COLORS.muted, valign: 'top',
      },
    );
  } else if (!hasBoth) {
    slide.addText(
      'Comparable rate context is still limited for this micro-market. Populate verified comps to surface a sharper position.',
      {
        x: 7.22, y: 5.35, w: 5.3, h: 0.5,
        fontFace: FONT, fontSize: 8.5, italic: true, color: COLORS.muted, valign: 'top',
      },
    );
  }
};

const renderLocationContext = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Location & Site Context', pageNumber, totalSlides, `${context.locationLine}`);

  // ── Left half — site map (Mapbox PNG when MAPBOX_TOKEN is configured)
  // or a graceful "map unavailable" placeholder otherwise. No more fake
  // site-pin diagram on a grid.
  const mapBuffer = context.precomputed?.siteMapBuffer;
  if (mapBuffer) {
    // Card framing with copper top accent so the image feels intentional.
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.55, y: 1.25, w: 5.7, h: 5.55,
      fill: { color: COLORS.white },
      line: { color: COLORS.line, pt: 0.6 },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.55, y: 1.25, w: 5.7, h: 0.06,
      fill: { color: COLORS.plum },
      line: { color: COLORS.plum, pt: 0.1 },
    });
    slide.addText('SITE MAP', {
      x: 0.75, y: 1.42, w: 5.3, h: 0.22,
      fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
    });
    // Embed the map.
    const mapDataUri = `data:image/png;base64,${mapBuffer.toString('base64')}`;
    slide.addImage({
      x: 0.7, y: 1.78, w: 5.4, h: 4.5,
      data: mapDataUri,
      sizing: { type: 'cover', w: 5.4, h: 4.5 },
      altText: `Site map at ${context.locationLine || 'project location'}`,
    });
    // Caption with coords + source attribution.
    slide.addText(context.coordinates || 'Coordinates not provided', {
      x: 0.7, y: 6.32, w: 3.6, h: 0.22,
      fontFace: FONT, fontSize: 9, bold: true, color: COLORS.charcoal,
    });
    slide.addText('Source: Google Maps Static API', {
      x: 4.0, y: 6.32, w: 2.15, h: 0.22,
      fontFace: FONT, fontSize: 8, italic: true, color: COLORS.muted, align: 'right',
    });
  } else {
    // Fallback when map isn't available — typographic placeholder, no
    // fake-pin diagram. Honest about why the map is missing.
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.55, y: 1.25, w: 5.7, h: 5.55,
      fill: { color: COLORS.mist },
      line: { color: COLORS.line, pt: 0.6 },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.55, y: 1.25, w: 5.7, h: 0.06,
      fill: { color: COLORS.plum },
      line: { color: COLORS.plum, pt: 0.1 },
    });
    slide.addText('SITE MAP', {
      x: 0.75, y: 1.42, w: 5.3, h: 0.22,
      fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
    });
    // Read structured status from precompute so we can show the actual
    // reason rather than a generic "not configured" message that lies
    // when the real cause was a 401 / 403 / 429 from Mapbox.
    const status = context.precomputed?.siteMapStatus;
    const detail = context.precomputed?.siteMapError;
    let headline;
    let body;
    if (status === 'no_coords' || !context.coordinates) {
      headline = 'No coordinates on this deal record';
      body = 'Geocode the property (Property → Edit → Address) to enable the site map on future exports.';
    } else if (status === 'no_token') {
      headline = 'Google Maps API key not configured';
      body = 'Set GOOGLE_MAPS_API_KEY in the Vercel environment variables (Production + Preview), enable Maps Static API in your Google Cloud project, then redeploy.';
    } else if (status === 'fetch_failed') {
      headline = 'Map render failed';
      body = detail || 'Google Maps call failed. Check Vercel logs for [googleMapsStaticMap.renderSiteMap] entries.';
    } else {
      headline = 'Site map unavailable';
      body = detail || 'Map could not be rendered for this deal.';
    }
    slide.addText(headline, {
      x: 0.85, y: 2.95, w: 5.1, h: 0.36,
      fontFace: FONT, fontSize: 13, bold: true, color: COLORS.charcoal, align: 'center', valign: 'mid', fit: 'shrink',
    });
    slide.addText(body, {
      x: 0.85, y: 3.45, w: 5.1, h: 1.4,
      fontFace: FONT, fontSize: 10, italic: true, color: COLORS.muted, align: 'center', valign: 'top', fit: 'shrink',
    });
    if (context.coordinates) {
      slide.addText(context.coordinates, {
        x: 0.85, y: 4.95, w: 5.1, h: 0.22,
        fontFace: FONT, fontSize: 9, bold: true, color: COLORS.charcoal, align: 'center',
      });
    }
  }

  // ── Right half — known site facts (unchanged, just denser type)
  addCard(pptx, slide, { x: 6.55, y: 1.25, w: 6.23, h: 5.55, bandColor: COLORS.sandDeep });
  slide.addText('Known Site Facts', {
    x: 6.82, y: 1.48, w: 2.4, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  context.locationRows.slice(0, 9).forEach((row, index) => {
    const y = 1.95 + index * 0.49;
    slide.addText(row.label, {
      x: 6.82, y, w: 1.7, h: 0.16,
      fontFace: FONT, fontSize: 8.5, color: COLORS.muted,
    });
    slide.addText(row.value, {
      x: 8.6, y: y - 0.01, w: 3.95, h: 0.2,
      fontFace: FONT, fontSize: 9, bold: true, color: COLORS.charcoal, fit: 'shrink',
    });
  });
};

const renderAssetSnapshot = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Asset Snapshot', pageNumber, totalSlides, `${context.assetClassLabel} | ${context.locationLine}`);

  const topCards = [
    { label: 'Land Area', value: formatArea(context.landAreaSqft) || 'N/A', tone: COLORS.plum },
    { label: context.isIncome ? 'Leasable Area' : 'Gross Area', value: context.isIncome ? formatArea(context.leasableAreaSqft) || 'N/A' : formatArea(context.grossAreaSqft) || 'N/A', tone: COLORS.plum },
    { label: context.isIncome ? 'Base Rent' : 'Saleable Area', value: context.isIncome ? formatRent(context.baseRent) || 'N/A' : formatArea(context.saleableAreaSqft) || 'N/A', tone: COLORS.sandDeep },
    { label: 'Circle / Pricing', value: formatRate(firstNumber(context.deal.circle_rate_per_sqft, context.modelSellRate)) || 'N/A', tone: COLORS.sandDeep },
  ];
  topCards.forEach((card, index) => {
    addKpiCard(pptx, slide, {
      x: 0.55 + index * 3.06,
      y: 1.25,
      w: 2.82,
      h: 1.05,
      label: card.label,
      value: card.value,
      tone: card.tone,
    });
  });

  const leftRows = [
    [
      { text: 'Asset Facts', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
      { text: 'Value', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
    ],
    ...context.assetDetailRows.slice(0, 8).map((row, index) => [
      { text: row.label, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.5 } },
      { text: row.value, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.5 } },
    ]),
  ];
  addTable(slide, leftRows, {
    x: 0.55,
    y: 2.6,
    w: 6.2,
    colW: [2.0, 4.2],
    rowH: 0.4,
  });

  const rightRows = [
    [
      { text: 'Project Facts', options: { bold: true, color: COLORS.white, fill: { color: COLORS.sandDeep } } },
      { text: 'Value', options: { bold: true, color: COLORS.white, fill: { color: COLORS.sandDeep } } },
    ],
    ...context.projectRows.slice(0, 8).map((row, index) => [
      { text: row.label, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.5 } },
      { text: row.value, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.5 } },
    ]),
  ];
  addTable(slide, rightRows, {
    x: 6.92,
    y: 2.6,
    w: 5.86,
    colW: [1.95, 3.91],
    rowH: 0.4,
  });

  // ─── Bottom strip — Area Composition visual ───────────────────────────
  // Was: ~1.2" of empty canvas below the two tables (y 5.85 → 7.0).
  // Now: a horizontal stacked bar showing Land vs Built vs Saleable
  // proportions, plus three small tiles giving the absolute sqft.
  const landSqft = num(context.landAreaSqft);
  const builtSqft = num(context.grossAreaSqft);
  const saleableSqft = num(context.saleableAreaSqft);
  const haveAnyArea = [landSqft, builtSqft, saleableSqft].some((v) => v != null && v > 0);

  addCard(pptx, slide, {
    x: 0.55, y: 5.95, w: 12.23, h: 1.0,
    bandColor: COLORS.plumSoft, fill: COLORS.white,
  });
  slide.addText('AREA COMPOSITION', {
    x: 0.78, y: 6.05, w: 4.0, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });

  if (haveAnyArea) {
    const total = (landSqft || 0) + (builtSqft || 0) + (saleableSqft || 0);
    const segments = [
      { label: 'Land', sqft: landSqft, color: COLORS.plum, textColor: COLORS.white },
      { label: 'Built / Gross', sqft: builtSqft, color: COLORS.plumSoft, textColor: COLORS.white },
      { label: 'Saleable', sqft: saleableSqft, color: COLORS.green, textColor: COLORS.white },
    ].filter((s) => s.sqft != null && s.sqft > 0);

    const barX = 0.78;
    const barY = 6.32;
    const barW = 11.7;
    const barH = 0.34;

    // Background frame
    slide.addShape(pptx.ShapeType.rect, {
      x: barX, y: barY, w: barW, h: barH,
      fill: { color: COLORS.mist }, line: { color: COLORS.line, pt: 0.5 },
    });

    let cursor = barX;
    segments.forEach((seg) => {
      const segW = (seg.sqft / total) * barW;
      slide.addShape(pptx.ShapeType.rect, {
        x: cursor, y: barY, w: segW, h: barH,
        fill: { color: seg.color }, line: { color: seg.color, pt: 0 },
      });
      // Inline label only if segment is wide enough to read
      if (segW > 1.3) {
        slide.addText(`${seg.label}  ${formatArea(seg.sqft)}`, {
          x: cursor + 0.10, y: barY, w: segW - 0.20, h: barH,
          fontFace: FONT, fontSize: 9, bold: true, color: seg.textColor,
          valign: 'mid', fit: 'shrink',
        });
      }
      cursor += segW;
    });

    // Below-bar legend — small tiles for narrow segments where the
    // inline label couldn't fit.
    const narrowSegs = segments.filter((s) => (s.sqft / total) * barW <= 1.3);
    if (narrowSegs.length > 0) {
      narrowSegs.forEach((seg, idx) => {
        const lx = 0.78 + idx * 3.0;
        slide.addShape(pptx.ShapeType.rect, {
          x: lx, y: 6.72, w: 0.14, h: 0.14,
          fill: { color: seg.color }, line: { color: seg.color, pt: 0 },
        });
        slide.addText(`${seg.label}: ${formatArea(seg.sqft)}`, {
          x: lx + 0.20, y: 6.68, w: 2.5, h: 0.22,
          fontFace: FONT, fontSize: 8.5, color: COLORS.charcoal, fit: 'shrink',
        });
      });
    }
  } else {
    slide.addText('Land / built / saleable area not yet populated. Add the missing fields on the deal record to see the area-composition bar.', {
      x: 0.78, y: 6.32, w: 11.7, h: 0.5,
      fontFace: FONT, fontSize: 11, italic: true, color: COLORS.muted, align: 'center', valign: 'mid', fit: 'shrink',
    });
  }
};

const renderReadiness = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, context.isIncome ? 'Diligence & Operating Readiness' : 'Development Readiness', pageNumber, totalSlides, `${context.stageLabel} | execution preparedness`);

  const readinessCards = [
    { label: 'Readiness', value: context.readiness.readiness_pct != null ? `${context.readiness.readiness_pct}%` : 'N/A', tone: COLORS.plum },
    { label: 'DD Complete', value: context.readiness.dd_completion_pct != null ? `${context.readiness.dd_completion_pct}%` : 'N/A', tone: COLORS.plumSoft },
    { label: 'Approvals', value: context.approvalSummary.required ? `${context.approvalSummary.validated}/${context.approvalSummary.required}` : 'N/A', tone: COLORS.sandDeep },
    { label: 'Linked Docs', value: String(context.documentSummary.total || 0), tone: COLORS.sandDeep },
  ];
  readinessCards.forEach((card, index) => {
    addKpiCard(pptx, slide, {
      x: 0.55 + index * 3.06,
      y: 1.25,
      w: 2.82,
      h: 1.0,
      label: card.label,
      value: card.value,
      tone: card.tone,
    });
  });

  const approvalTableRows = context.approvalRows.length
    ? [
        [
          { text: 'Approval', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
          { text: 'Status', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
          { text: 'Authority / Note', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
        ],
        ...context.approvalRows.slice(0, 5).map((row, index) => [
          { text: row.name, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2 } },
          { text: row.status, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2, bold: true, color: row.status === 'Validated' ? COLORS.green : row.status === 'Issue' ? COLORS.red : COLORS.amber, align: 'center' } },
          { text: [row.authority, row.note].filter(Boolean).join(' | ') || 'Not recorded', options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2 } },
        ]),
      ]
    : null;

  const diligenceTableRows = context.diligenceRows.length
    ? [
        [
          { text: 'Open Item', options: { bold: true, color: COLORS.white, fill: { color: COLORS.sandDeep } } },
          { text: 'Severity', options: { bold: true, color: COLORS.white, fill: { color: COLORS.sandDeep } } },
          { text: 'Status / Note', options: { bold: true, color: COLORS.white, fill: { color: COLORS.sandDeep } } },
        ],
        ...context.diligenceRows.slice(0, 5).map((row, index) => [
          { text: row.item, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2 } },
          { text: row.severity, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2, bold: true, color: pickSeverityColor(String(row.severity || '').toLowerCase()), align: 'center' } },
          { text: [row.status, row.note].filter(Boolean).join(' | ') || 'Open item', options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2 } },
        ]),
      ]
    : null;

  if (approvalTableRows) {
    addTable(slide, approvalTableRows, {
      x: 0.55,
      y: 2.55,
      w: 6.15,
      colW: [2.2, 1.0, 2.95],
      rowH: 0.46,
    });
  } else {
    addCard(pptx, slide, { x: 0.55, y: 2.55, w: 6.15, h: 3.6, bandColor: COLORS.plum, fill: COLORS.white });
    slide.addText('Approval tracker has not yet been populated for this deal.', {
      x: 0.9, y: 4.05, w: 5.4, h: 0.28,
      fontFace: FONT, fontSize: 11, italic: true, color: COLORS.charcoal, align: 'center',
    });
  }

  if (diligenceTableRows) {
    addTable(slide, diligenceTableRows, {
      x: 6.92,
      y: 2.55,
      w: 5.86,
      colW: [2.35, 1.0, 2.51],
      rowH: 0.46,
    });
  } else {
    addCard(pptx, slide, { x: 6.92, y: 2.55, w: 5.86, h: 3.6, bandColor: COLORS.sandDeep, fill: COLORS.white });
    slide.addText('No open diligence items are currently linked in REDIP.', {
      x: 7.25, y: 4.05, w: 5.15, h: 0.28,
      fontFace: FONT, fontSize: 11, italic: true, color: COLORS.charcoal, align: 'center',
    });
  }

  // ─── Bottom strip — Readiness composition (4 progress bars) ────────────
  // Was: ~2" of empty canvas below the two tables (y 4.85 → 7.0).
  // Now: a horizontal four-track progress strip showing the four major
  // readiness pillars with their % completion. Reviewer scans the slide
  // and immediately sees which track is the bottleneck.
  addCard(pptx, slide, {
    x: 0.55, y: 5.05, w: 12.23, h: 1.95,
    bandColor: COLORS.plumSoft, fill: COLORS.white,
  });
  slide.addText('READINESS COMPOSITION', {
    x: 0.78, y: 5.18, w: 4.5, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });
  slide.addText('Each track must clear before commitment — bottleneck reads at a glance.', {
    x: 6.0, y: 5.18, w: 6.6, h: 0.22,
    fontFace: FONT, fontSize: 8.5, italic: true, color: COLORS.muted, align: 'right',
  });

  // Compute the four track percentages from existing context.
  const approvalsPct = context.approvalSummary?.required
    ? Math.round((Number(context.approvalSummary.validated) || 0) / Number(context.approvalSummary.required) * 100)
    : null;
  const ddPct = num(context.readiness?.dd_completion_pct);
  const docsTotal = Number(context.documentSummary?.total) || 0;
  const docsAvailable = Number(context.documentSummary?.available) || Number(context.documentSummary?.availableCount) || 0;
  const docsPct = docsTotal > 0 ? Math.round(docsAvailable / docsTotal * 100) : null;
  const overallPct = num(context.readiness?.readiness_pct);

  const tracks = [
    { label: 'Overall Readiness', pct: overallPct, accent: COLORS.plum },
    { label: 'Diligence',         pct: ddPct,      accent: COLORS.plumSoft },
    { label: 'Approvals',         pct: approvalsPct, accent: COLORS.green },
    { label: 'Documents',         pct: docsPct,    accent: COLORS.amber },
  ];

  const trackY = 5.50;
  const trackH = 0.32;
  const trackW = 11.7;
  const labelW = 2.2;
  const barX = 0.78 + labelW;
  const barTotalW = trackW - labelW - 0.6;

  tracks.forEach((track, idx) => {
    const ty = trackY + idx * 0.36;
    // Track label
    slide.addText(track.label, {
      x: 0.78, y: ty, w: labelW - 0.15, h: trackH,
      fontFace: FONT, fontSize: 9.5, bold: true, color: COLORS.charcoal,
      valign: 'mid', fit: 'shrink',
    });
    // Bar background
    slide.addShape(pptx.ShapeType.rect, {
      x: barX, y: ty + 0.06, w: barTotalW, h: trackH - 0.12,
      fill: { color: COLORS.mist }, line: { color: COLORS.line, pt: 0.5 },
    });
    // Bar fill
    if (track.pct != null) {
      const fillW = Math.max(0.04, (track.pct / 100) * barTotalW);
      slide.addShape(pptx.ShapeType.rect, {
        x: barX, y: ty + 0.06, w: fillW, h: trackH - 0.12,
        fill: { color: track.accent }, line: { color: track.accent, pt: 0 },
      });
    }
    // Percentage text on the right
    slide.addText(track.pct != null ? `${track.pct}%` : '–', {
      x: barX + barTotalW + 0.10, y: ty, w: 0.50, h: trackH,
      fontFace: FONT, fontSize: 10, bold: true,
      color: track.pct == null ? COLORS.muted : track.accent,
      valign: 'mid', align: 'right',
    });
  });
};

const renderFinancialOverview = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, context.isIncome ? 'Operating Economics' : 'Development Economics', pageNumber, totalSlides, `${context.assetClassLabel} | stored underwriting outputs`);

  const cards = context.isIncome
    ? [
        { label: 'NOI / Base Rent', value: formatCrores(context.noi) || formatRent(context.baseRent) || 'N/A', tone: COLORS.plum },
        { label: 'Yield / Exit Cap', value: formatPct(context.yieldOnCost) || formatPct(context.inputs.exitCapRate, 2) || 'N/A', tone: COLORS.plumSoft },
        { label: 'Exit Value', value: formatCrores(context.exitValue) || 'N/A', tone: COLORS.sandDeep },
        { label: 'DSCR / IRR', value: context.deal.dscr != null ? `${formatNumber(context.deal.dscr, 2)}x` : formatPct(context.irr) || 'N/A', tone: COLORS.sandDeep },
      ]
    : [
        { label: 'Total Cost', value: formatCrores(context.totalCost) || 'N/A', tone: COLORS.plum },
        { label: 'Revenue / Value', value: formatCrores(firstNumber(context.totalRevenue, context.exitValue)) || 'N/A', tone: COLORS.plumSoft },
        { label: 'IRR', value: formatPct(context.irr) || 'N/A', tone: COLORS.sandDeep },
        { label: 'Gross Margin', value: formatPct(context.grossMargin) || 'N/A', tone: COLORS.sandDeep },
      ];

  cards.forEach((card, index) => {
    addKpiCard(pptx, slide, {
      x: 0.55 + index * 3.06,
      y: 1.25,
      w: 2.82,
      h: 1.0,
      label: card.label,
      value: card.value,
      tone: card.tone,
    });
  });

  const tableRows = [
    [
      { text: 'Line Item', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
      { text: 'Current Stored Value', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
    ],
    ...context.financialRows.slice(0, 6).map((row, index) => [
      { text: row.label, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.4 } },
      { text: row.value, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.4 } },
    ]),
  ];
  addTable(slide, tableRows, {
    x: 0.55,
    y: 2.55,
    w: 6.2,
    colW: [2.3, 3.9],
    rowH: 0.44,
  });

  // Sources & Uses native chart panel — replaces the old text-only
  // commentary card. Native pptxgenjs chart, fully editable in PowerPoint
  // (right-click → Edit Data). Shows the cost stack as a doughnut so the
  // viewer sees at a glance how the project cost is composed.
  addCard(pptx, slide, {
    x: 6.95,
    y: 2.55,
    w: 5.83,
    h: 3.85,
    bandColor: COLORS.plum,
    fill: COLORS.white,
  });
  slide.addText('SOURCES & USES (USES BREAKDOWN)', {
    x: 7.22, y: 2.74, w: 5.45, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });

  // Compute cost components from the underwriting inputs. Pure numeric;
  // skip slices where the component is missing rather than fabricate.
  const inp = context.inputs || {};
  const usesComponents = [];
  const landCost = num(firstNumber(inp.landCostCr, context.deal?.land_cost_cr, context.deal?.negotiated_price_cr));
  const constructionCost = (num(inp.constructionCostPerSqft) != null && num(context.saleableAreaSqft) != null)
    ? (Number(inp.constructionCostPerSqft) * Number(context.saleableAreaSqft)) / 10_000_000
    : null;
  const approvalCost = num(firstNumber(inp.approvalCostCr, context.deal?.approval_cost_cr));
  const marketingCost = (num(context.totalRevenue) != null && num(inp.marketingCostPct) != null)
    ? Number(context.totalRevenue) * Number(inp.marketingCostPct) : null;
  const financeCost = (num(context.totalRevenue) != null && num(inp.financeCostPct) != null)
    ? Number(context.totalRevenue) * Number(inp.financeCostPct) : null;
  if (landCost != null && landCost > 0)         usesComponents.push({ label: 'Land', value: landCost });
  if (constructionCost != null && constructionCost > 0) usesComponents.push({ label: 'Construction', value: constructionCost });
  if (approvalCost != null && approvalCost > 0) usesComponents.push({ label: 'Approvals & fees', value: approvalCost });
  if (marketingCost != null && marketingCost > 0) usesComponents.push({ label: 'Marketing & sales', value: marketingCost });
  if (financeCost != null && financeCost > 0)   usesComponents.push({ label: 'Finance / treasury', value: financeCost });

  if (usesComponents.length >= 2) {
    slide.addChart(pptx.ChartType.doughnut, [{
      name: 'Uses (INR Cr)',
      labels: usesComponents.map((c) => c.label),
      values: usesComponents.map((c) => Number(c.value.toFixed(2))),
    }], {
      x: 7.05, y: 3.0, w: 5.6, h: 3.25,
      chartColors: [COLORS.plum, COLORS.plumSoft, COLORS.sandDeep, COLORS.green, COLORS.amber],
      showLegend: true,
      legendPos: 'r',
      legendFontSize: 9,
      legendColor: COLORS.charcoal,
      showValue: true,
      dataLabelColor: COLORS.charcoal,
      dataLabelFontSize: 8,
      dataLabelFormatCode: '#,##0.0',
      dataLabelPosition: 'outEnd',
      holeSize: 60,
      showTitle: false,
      border: { pt: 0, color: COLORS.line },
    });
    slide.addText('Editable in PowerPoint: right-click chart → Edit Data.', {
      x: 7.22, y: 6.15, w: 5.4, h: 0.22,
      fontFace: FONT, fontSize: 8, italic: true, color: COLORS.muted,
    });
  } else if (num(context.totalCost) != null) {
    // Single-component degenerate case — show the total as a tile.
    slide.addText(formatCrores(context.totalCost) || 'N/A', {
      x: 7.22, y: 3.4, w: 5.4, h: 0.8,
      fontFace: FONT, fontSize: 32, bold: true, color: COLORS.plum, align: 'center',
    });
    slide.addText('Total project cost', {
      x: 7.22, y: 4.3, w: 5.4, h: 0.22,
      fontFace: FONT, fontSize: 10, color: COLORS.muted, align: 'center',
    });
    slide.addText('Cost component breakdown not available — populate land / construction / approval inputs to render the doughnut.', {
      x: 7.22, y: 5.1, w: 5.4, h: 0.8,
      fontFace: FONT, fontSize: 9, italic: true, color: COLORS.muted, align: 'center', valign: 'top',
    });
  } else {
    slide.addText('Cost data unavailable — populate the underwriting inputs to render this chart.', {
      x: 7.22, y: 4.0, w: 5.4, h: 0.6,
      fontFace: FONT, fontSize: 11, italic: true, color: COLORS.muted, align: 'center', valign: 'mid',
    });
  }

  // Underwriting read-through — moved to a compact footer strip below
  // the table + chart so the commentary doesn't crowd the chart.
  if (Array.isArray(context.financialCommentary) && context.financialCommentary.length > 0) {
    addCard(pptx, slide, {
      x: 0.55, y: 6.5, w: 12.23, h: 0.65,
      bandColor: COLORS.sandDeep,
      fill: COLORS.mist,
    });
    slide.addText('READ-THROUGH', {
      x: 0.78, y: 6.6, w: 1.7, h: 0.2,
      fontFace: FONT, fontSize: 8, bold: true, color: COLORS.muted, charSpace: 1.6,
    });
    slide.addText(context.financialCommentary.slice(0, 2).join('  ·  '), {
      x: 2.5, y: 6.58, w: 10.15, h: 0.5,
      fontFace: FONT, fontSize: 9.5, color: COLORS.charcoal, valign: 'top', fit: 'shrink',
    });
  }
};

const getHeatFill = (value) => {
  const numeric = num(value);
  if (numeric === null) return COLORS.white;
  if (numeric >= 20) return 'DCEBDD';
  if (numeric >= 15) return 'F4EAD1';
  return 'F5DCDC';
};

const renderCashFlowSensitivity = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Cash Flow & Sensitivity', pageNumber, totalSlides, `${context.assetClassLabel} | phasing and scenario range`);

  if (context.cashRows.length >= 2) {
    // Combo chart: column for period net + line for cumulative.
    // Single-series bar buried the two facts that matter to a reader —
    // is the period contribution positive, and where does cumulative
    // turn the corner. Showing both at once is the standard analyst
    // read (CBRE / JLL underwriting decks). Asset-class branching only
    // affects the series label / chart title — the math is identical
    // either way (the kernel already produces the right `net` and
    // `cumulative` fields per asset family).
    const periodLabels = context.cashRows.map((row, idx) => truncate(row.label || `P${idx + 1}`, 12));
    const periodNets = context.cashRows.map((row) => num(row.net) || 0);
    const cumulativeNets = context.cashRows.map((row) => num(row.cumulative) || 0);
    const periodSeriesName = context.isIncome ? 'Period NOI' : 'Period net';
    const chartTitle = context.isIncome
      ? 'Period NOI & Cumulative'
      : 'Period Net Cash Flow & Cumulative';

    slide.addChart(
      [
        {
          type: pptx.ChartType.bar,
          data: [{ name: periodSeriesName, labels: periodLabels, values: periodNets }],
          options: { barDir: 'col', chartColors: [COLORS.plum] },
        },
        {
          type: pptx.ChartType.line,
          data: [{ name: 'Cumulative', labels: periodLabels, values: cumulativeNets }],
          options: {
            chartColors: [COLORS.green],
            secondaryValAxis: true,
            secondaryCatAxis: true,
            lineSize: 2,
            lineDataSymbol: 'circle',
            lineDataSymbolSize: 5,
          },
        },
      ],
      {
        x: 0.55, y: 1.3, w: 6.4, h: 3.55,
        catAxisLabelFontSize: 8,
        valAxisLabelFontSize: 8,
        valAxes: [
          { valAxisLabelFontSize: 8, valGridLine: { style: 'none' } },
          { valAxisLabelFontSize: 8, valGridLine: { style: 'none' }, valAxisCrossesAt: 'autoZero' },
        ],
        catAxes: [
          { catAxisLabelFontSize: 8 },
          { catAxisHidden: true },
        ],
        showLegend: true,
        legendPos: 'b',
        legendFontSize: 8,
        legendColor: COLORS.muted,
        title: chartTitle,
        showTitle: true,
        titleFontFace: FONT,
        titleFontSize: 10,
        titleColor: COLORS.charcoal,
      }
    );
  }

  // ─── Sensitivity tornado (replaces the old 5×5 heatmap table) ─────────
  // Was: a 5×5 numeric table heat-tinted by IRR — informative but reads as
  // a spreadsheet, not a chart. Operator's brutal-roast asked for a
  // tornado: drivers ranked by impact, centred on base IRR, low/high deltas
  // visible at a glance. Built from shape primitives because pptxgenjs has
  // no native tornado type.
  const hasSensitivity = Array.isArray(context.sensitivityMatrix?.irrGrid)
    && context.sensitivityMatrix.irrGrid.length >= 3
    && Array.isArray(context.sensitivityMatrix.sellingRates)
    && context.sensitivityMatrix.sellingRates.length >= 3
    && Array.isArray(context.sensitivityMatrix.constructionCosts)
    && context.sensitivityMatrix.constructionCosts.length >= 3;
  if (hasSensitivity) {
    const grid = context.sensitivityMatrix.irrGrid;
    const sellRates = context.sensitivityMatrix.sellingRates;
    const constCosts = context.sensitivityMatrix.constructionCosts;
    const mid = (arr) => Math.floor(arr.length / 2);
    const sellMid = mid(sellRates);
    const costMid = mid(constCosts);
    const baseIrr = num(grid[costMid]?.[sellMid]);

    // Driver 1: selling rate (vary column, hold row=middle construction cost).
    // Low column → low selling rate → lower IRR (negative delta).
    const sellRow = grid[costMid] || [];
    const sellLowIrr = num(sellRow[0]);
    const sellHighIrr = num(sellRow[sellRow.length - 1]);

    // Driver 2: construction cost (vary row, hold column=middle selling rate).
    // Low row → low construction cost → higher IRR (positive delta).
    // High row → high construction cost → lower IRR (negative delta).
    const costLowIrr = num(grid[grid.length - 1]?.[sellMid]); // high-cost case
    const costHighIrr = num(grid[0]?.[sellMid]);              // low-cost case

    const drivers = [];
    if (baseIrr != null && sellLowIrr != null && sellHighIrr != null) {
      drivers.push({
        label: 'Selling Rate',
        low: sellLowIrr,
        high: sellHighIrr,
        lowLabel: `${formatNumber(sellRates[0], 0)} / sqft`,
        highLabel: `${formatNumber(sellRates[sellRates.length - 1], 0)} / sqft`,
      });
    }
    if (baseIrr != null && costLowIrr != null && costHighIrr != null) {
      drivers.push({
        label: 'Construction Cost',
        // Construction cost: low cost → high IRR, high cost → low IRR.
        // Show as (worst IRR ... best IRR) so the bar reads consistently.
        low: costLowIrr,     // worst-case IRR (under high construction cost)
        high: costHighIrr,   // best-case IRR (under low construction cost)
        lowLabel: `${formatNumber(constCosts[constCosts.length - 1], 0)} / sqft`,
        highLabel: `${formatNumber(constCosts[0], 0)} / sqft`,
      });
    }

    if (drivers.length >= 1 && baseIrr != null) {
      // Sort by absolute range so the most impactful driver renders on top.
      drivers.sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));

      // Compute the symmetric scale so both drivers share an x-axis range.
      const allDeltas = drivers.flatMap((d) => [d.low - baseIrr, d.high - baseIrr]);
      const maxAbs = Math.max(0.5, ...allDeltas.map((v) => Math.abs(v)));

      // Layout
      const panelX = 7.2;
      const panelY = 1.3;
      const panelW = 5.58;
      const eyebrowY = panelY;
      const baseLabelY = panelY + 0.26;
      const rowsTop = panelY + 0.62;
      const rowH = 0.72;

      slide.addText('SENSITIVITY — IRR RANGE BY DRIVER', {
        x: panelX, y: eyebrowY, w: panelW, h: 0.20,
        fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
      });
      slide.addText(`Base IRR ${formatNumber(baseIrr, 1)}%  ·  variables held independent`, {
        x: panelX, y: baseLabelY, w: panelW, h: 0.18,
        fontFace: FONT, fontSize: 8.5, italic: true, color: COLORS.muted,
      });

      // Bar geometry
      const labelW = 1.50;
      const barAreaX = panelX + labelW + 0.10;
      const barAreaW = panelW - labelW - 0.10;
      const centerX = barAreaX + barAreaW / 2;

      // Centre tick (base IRR axis)
      slide.addShape(pptx.ShapeType.line, {
        x: centerX, y: rowsTop, w: 0, h: rowH * drivers.length + 0.15,
        line: { color: COLORS.muted, pt: 1, dashType: 'dash' },
      });
      slide.addText(`${formatNumber(baseIrr, 1)}%`, {
        x: centerX - 0.30, y: rowsTop + rowH * drivers.length + 0.05, w: 0.60, h: 0.20,
        fontFace: FONT, fontSize: 8, bold: true, color: COLORS.muted, align: 'center',
      });

      drivers.forEach((driver, idx) => {
        const rowY = rowsTop + idx * rowH;
        const lowDelta = driver.low - baseIrr;  // typically negative
        const highDelta = driver.high - baseIrr; // typically positive
        const halfW = barAreaW / 2;
        const lowW = (Math.abs(lowDelta) / maxAbs) * halfW;
        const highW = (Math.abs(highDelta) / maxAbs) * halfW;
        const barH = 0.36;
        const barY = rowY + 0.06;

        // Driver label
        slide.addText(driver.label, {
          x: panelX, y: rowY + 0.04, w: labelW, h: 0.22,
          fontFace: FONT, fontSize: 10, bold: true, color: COLORS.charcoal, valign: 'top',
        });
        slide.addText(`${driver.lowLabel} → ${driver.highLabel}`, {
          x: panelX, y: rowY + 0.28, w: labelW, h: 0.18,
          fontFace: FONT, fontSize: 7.5, italic: true, color: COLORS.muted, valign: 'top',
        });

        // Low-side bar (extends LEFT from centre — typically red for worse-IRR)
        if (lowDelta < 0 && lowW > 0.02) {
          slide.addShape(pptx.ShapeType.rect, {
            x: centerX - lowW, y: barY, w: lowW, h: barH,
            fill: { color: COLORS.red }, line: { color: COLORS.red, pt: 0 },
          });
          slide.addText(`${formatNumber(driver.low, 1)}%`, {
            x: centerX - lowW - 0.55, y: barY, w: 0.55, h: barH,
            fontFace: FONT, fontSize: 8.5, bold: true, color: COLORS.charcoal,
            align: 'right', valign: 'mid',
          });
        }
        // High-side bar (extends RIGHT from centre — green for better-IRR)
        if (highDelta > 0 && highW > 0.02) {
          slide.addShape(pptx.ShapeType.rect, {
            x: centerX, y: barY, w: highW, h: barH,
            fill: { color: COLORS.green }, line: { color: COLORS.green, pt: 0 },
          });
          slide.addText(`${formatNumber(driver.high, 1)}%`, {
            x: centerX + highW, y: barY, w: 0.55, h: barH,
            fontFace: FONT, fontSize: 8.5, bold: true, color: COLORS.charcoal,
            align: 'left', valign: 'mid',
          });
        }
      });
    }
  }

  // ─── Bottom strip — Scenario comparison (Base / Bull / Bear) ─────────
  // Was: ~1.8" of empty canvas below the chart + heatmap.
  // Now: three semantic-coloured cards showing each scenario's IRR / EM
  // / NPV side by side. Pulled directly from context.scenarioRows so
  // every value traces to the deterministic financial kernel.
  const scenarioRows = Array.isArray(context.scenarioRows) ? context.scenarioRows : [];
  if (scenarioRows.length > 0) {
    addCard(pptx, slide, {
      x: 0.55, y: 5.05, w: 12.23, h: 1.85,
      bandColor: COLORS.plumSoft, fill: COLORS.white,
    });
    slide.addText('SCENARIO COMPARISON', {
      x: 0.78, y: 5.18, w: 4.0, h: 0.22,
      fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
    });
    slide.addText('Modeled Base / Bull / Bear cases — same kernel, different sensitivities.', {
      x: 4.5, y: 5.18, w: 8.1, h: 0.22,
      fontFace: FONT, fontSize: 8.5, italic: true, color: COLORS.muted, align: 'right',
    });

    // Order: bull, base, bear — bull on the left as the upside, bear on
    // the right as the downside. Base in the centre as the anchor.
    const orderedLabels = ['bull', 'base', 'bear'];
    const tilesData = orderedLabels.map((key) => {
      const row = scenarioRows.find((s) => String(s.label || '').toLowerCase().includes(key));
      return row ? {
        title: key === 'bull' ? 'BULL CASE' : key === 'bear' ? 'BEAR CASE' : 'BASE CASE',
        irr: row.irr,
        npv: row.npv,
        multiple: row.multiple,
        accent: key === 'bull' ? COLORS.green : key === 'bear' ? COLORS.red : COLORS.plumSoft,
        valueColor: key === 'bull' ? COLORS.green : key === 'bear' ? COLORS.red : COLORS.charcoal,
      } : null;
    }).filter(Boolean);

    // Fall back to whatever scenarios exist if not all three are populated.
    const tiles = tilesData.length > 0 ? tilesData : scenarioRows.slice(0, 3).map((row) => ({
      title: (row.label || 'Scenario').toUpperCase(),
      irr: row.irr,
      npv: row.npv,
      multiple: row.multiple,
      accent: COLORS.plum,
      valueColor: COLORS.charcoal,
    }));

    const tileW = (12.23 - 0.46 - (tiles.length - 1) * 0.20) / Math.max(tiles.length, 1);
    tiles.forEach((tile, idx) => {
      const tx = 0.78 + idx * (tileW + 0.20);
      const ty = 5.50;
      const th = 1.30;
      slide.addShape(pptx.ShapeType.rect, {
        x: tx, y: ty, w: tileW, h: th,
        fill: { color: COLORS.mist }, line: { color: COLORS.line, pt: 0.5 },
      });
      slide.addShape(pptx.ShapeType.rect, {
        x: tx, y: ty, w: 0.06, h: th,
        fill: { color: tile.accent }, line: { color: tile.accent, pt: 0 },
      });
      // Eyebrow
      slide.addText(tile.title, {
        x: tx + 0.20, y: ty + 0.14, w: tileW - 0.40, h: 0.22,
        fontFace: FONT, fontSize: 9, bold: true, color: tile.accent, charSpace: 1.6,
      });
      // Big IRR
      slide.addText(tile.irr || '–', {
        x: tx + 0.20, y: ty + 0.42, w: tileW - 0.40, h: 0.50,
        fontFace: FONT, fontSize: 26, bold: true, color: tile.valueColor, valign: 'top', fit: 'shrink',
      });
      slide.addText('IRR', {
        x: tx + 0.20, y: ty + 0.94, w: tileW - 0.40, h: 0.16,
        fontFace: FONT, fontSize: 8, color: COLORS.muted, charSpace: 1.4,
      });
      // EM + NPV row at bottom
      slide.addText(`${tile.multiple || '–'}   ·   NPV ${tile.npv || '–'}`, {
        x: tx + 0.20, y: ty + 1.10, w: tileW - 0.40, h: 0.18,
        fontFace: FONT, fontSize: 9, bold: true, color: COLORS.charcoal, fit: 'shrink',
      });
    });
  } else {
    // Soft empty-state — when no scenarios are computed yet, surface a
    // typographic note instead of leaving the bottom strip blank.
    addCard(pptx, slide, {
      x: 0.55, y: 5.05, w: 12.23, h: 1.85,
      bandColor: COLORS.muted, fill: COLORS.white,
    });
    slide.addText('SCENARIO COMPARISON', {
      x: 0.78, y: 5.18, w: 4.0, h: 0.22,
      fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
    });
    slide.addText('Run the financial kernel with Base / Bull / Bear sensitivity overrides on the Financial Engine tab in REDIP to populate this panel.', {
      x: 0.78, y: 5.7, w: 11.7, h: 0.6,
      fontFace: FONT, fontSize: 11, italic: true, color: COLORS.muted, align: 'center', valign: 'mid', fit: 'shrink',
    });
  }
};

const renderTransactionSummary = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Transaction Summary', pageNumber, totalSlides, `${context.dealTypeLabel} | ${context.dealStructureLabel}`);

  const tableRows = [
    [
      { text: 'Commercial Term', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
      { text: 'Current Stored Value', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
    ],
    ...context.transactionRows.slice(0, 12).map((row, index) => [
      { text: row.label, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.5 } },
      { text: row.value, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.5 } },
    ]),
  ];
  addTable(slide, tableRows, {
    x: 0.55,
    y: 1.3,
    w: 6.35,
    colW: [2.25, 4.1],
    rowH: 0.39,
  });

  addCard(pptx, slide, {
    x: 7.15,
    y: 1.3,
    w: 5.63,
    h: 5.3,
    bandColor: context.recommendations.tone === 'negative' ? COLORS.red : context.recommendations.tone === 'caution' ? COLORS.amber : COLORS.green,
    fill: COLORS.white,
  });
  slide.addText('Transaction Read-Through', {
    x: 7.42, y: 1.54, w: 2.8, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  addBulletList(slide, context.transactionCommentary, {
    x: 7.42,
    y: 1.98,
    w: 4.95,
    h: 1.45,
    fontSize: 9.4,
    bulletColor: context.recommendations.tone === 'negative' ? COLORS.red : COLORS.sandDeep,
  });

  // ─── Capital stack (debt / equity split) ──────────────────────────────
  // Was: capital stack appeared only as a comma-separated text row inside
  // the commercial-terms table on the left ("debt 110 Cr | equity 331 Cr")
  // — a reader couldn't see the split proportion at a glance. Now: a
  // horizontal stacked bar in the right panel showing debt vs equity
  // share (segment width ∝ INR Cr value) with both absolute and pct
  // labels. Empty-state when the model hasn't recorded a stack.
  const debtCr = num(context.capitalStack?.debtCr);
  const equityCr = num(context.capitalStack?.equityCr);
  const stackTotal = (debtCr != null && debtCr > 0 ? debtCr : 0) + (equityCr != null && equityCr > 0 ? equityCr : 0);
  slide.addText('CAPITAL STACK', {
    x: 7.42, y: 3.50, w: 4.95, h: 0.20,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });
  if (stackTotal > 0) {
    const debtFrac = (debtCr != null && debtCr > 0 ? debtCr : 0) / stackTotal;
    const debtPct = debtFrac * 100;
    const equityPct = 100 - debtPct;
    const barX = 7.42;
    const barY = 3.78;
    const barW = 4.95;
    const barH = 0.40;
    const debtW = debtFrac * barW;

    slide.addShape(pptx.ShapeType.rect, {
      x: barX, y: barY, w: barW, h: barH,
      fill: { color: COLORS.mist }, line: { color: COLORS.line, pt: 0.5 },
    });
    if (debtW > 0) {
      slide.addShape(pptx.ShapeType.rect, {
        x: barX, y: barY, w: debtW, h: barH,
        fill: { color: COLORS.plum }, line: { color: COLORS.plum, pt: 0 },
      });
    }
    if (debtW < barW) {
      slide.addShape(pptx.ShapeType.rect, {
        x: barX + debtW, y: barY, w: barW - debtW, h: barH,
        fill: { color: COLORS.sandDeep }, line: { color: COLORS.sandDeep, pt: 0 },
      });
    }
    // Inline labels — only render if the segment is wide enough to read.
    if (debtFrac >= 0.18) {
      slide.addText(`Debt ${debtPct.toFixed(0)}%`, {
        x: barX + 0.08, y: barY, w: debtW - 0.16, h: barH,
        fontFace: FONT, fontSize: 10, bold: true, color: COLORS.white,
        valign: 'mid', fit: 'shrink',
      });
    }
    if (debtFrac <= 0.82) {
      slide.addText(`Equity ${equityPct.toFixed(0)}%`, {
        x: barX + debtW + 0.08, y: barY, w: barW - debtW - 0.16, h: barH,
        fontFace: FONT, fontSize: 10, bold: true, color: COLORS.white,
        valign: 'mid', fit: 'shrink',
      });
    }
    // Sub-line — absolute INR Cr values with palette dots so the legend
    // still reads on a low-contrast print-out.
    slide.addText(
      [
        { text: '● ', options: { color: COLORS.plum, fontSize: 9 } },
        { text: `Debt ${formatCrores(debtCr) || '–'}`, options: { color: COLORS.charcoal, fontSize: 9 } },
        { text: '   ●  ', options: { color: COLORS.sandDeep, fontSize: 9 } },
        { text: `Equity ${formatCrores(equityCr) || '–'}`, options: { color: COLORS.charcoal, fontSize: 9 } },
      ],
      { x: barX, y: barY + barH + 0.04, w: barW, h: 0.20, fontFace: FONT, valign: 'mid' }
    );
  } else {
    slide.addText(
      'Debt / equity split will populate once the kernel records capital stack values for this deal.',
      {
        x: 7.42, y: 3.78, w: 4.95, h: 0.62,
        fontFace: FONT, fontSize: 9, italic: true, color: COLORS.muted,
        valign: 'top', fit: 'shrink',
      },
    );
  }

  addKpiCard(pptx, slide, {
    x: 7.42,
    y: 4.58,
    w: 2.25,
    h: 1.12,
    label: 'Recommendation',
    value: (context.recommendations.label || 'Review').toUpperCase(),
    tone: context.recommendations.tone === 'negative' ? COLORS.red : context.recommendations.tone === 'caution' ? COLORS.amber : COLORS.green,
  });
  addKpiCard(pptx, slide, {
    x: 10.0,
    y: 4.58,
    w: 2.25,
    h: 1.12,
    label: 'Revenue Less Cost',
    value: context.valueGapCr != null ? formatCrores(context.valueGapCr) || 'N/A' : 'N/A',
    tone: context.valueGapCr != null && context.valueGapCr < 0 ? COLORS.red : COLORS.green,
  });

  // ─── Bottom strip — Transaction Milestone Path ────────────────────────
  // Was: ~1.3" of empty canvas (y 5.7 → 7.0).
  // Now: a 5-step milestone bar showing where the deal sits in the
  // life-cycle — Sourcing → DD → IC → Negotiation → Close. Current
  // stage highlighted; past stages copper-filled; future stages muted.
  const stageOrder = [
    { key: 'sourcing',          label: 'Sourcing' },
    { key: 'screening',         label: 'Screening' },
    { key: 'site_visit',        label: 'Site Visit' },
    { key: 'due_diligence',     label: 'Diligence' },
    { key: 'underwriting',      label: 'Underwriting' },
    { key: 'ic_review',         label: 'IC Review' },
    { key: 'negotiation',       label: 'Negotiation' },
    { key: 'loi',               label: 'LOI' },
    { key: 'active',            label: 'Active' },
    { key: 'closed',            label: 'Closed' },
  ];
  const compactPath = ['Sourcing', 'Diligence', 'Underwriting', 'IC Review', 'Negotiation', 'Close'];
  const currentStageRaw = String(context.deal.stage || '').toLowerCase();
  const currentStageOrderIdx = stageOrder.findIndex((s) => s.key === currentStageRaw);
  // Map the full stage list onto the 6-step compact path.
  const stageToCompact = (orderIdx) => {
    if (orderIdx < 0) return -1;
    if (orderIdx <= 1) return 0;       // sourcing/screening → Sourcing
    if (orderIdx === 2 || orderIdx === 3) return 1; // site_visit/dd → Diligence
    if (orderIdx === 4) return 2;      // underwriting → Underwriting
    if (orderIdx === 5) return 3;      // ic_review → IC Review
    if (orderIdx === 6 || orderIdx === 7) return 4; // negotiation/loi → Negotiation
    if (orderIdx === 8 || orderIdx === 9) return 5; // active/closed → Close
    return -1;
  };
  const currentCompactIdx = stageToCompact(currentStageOrderIdx);

  addCard(pptx, slide, {
    x: 0.55, y: 5.85, w: 12.23, h: 1.05,
    bandColor: COLORS.plumSoft, fill: COLORS.white,
  });
  slide.addText('DEAL LIFE-CYCLE PATH', {
    x: 0.78, y: 5.96, w: 4.0, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });
  slide.addText(currentCompactIdx >= 0 ? `Currently at: ${compactPath[currentCompactIdx]}` : 'Stage not yet set on the deal record', {
    x: 4.5, y: 5.96, w: 8.1, h: 0.22,
    fontFace: FONT, fontSize: 8.5, italic: true, color: COLORS.muted, align: 'right',
  });

  // 6 step pills — past = copper, current = navy bold, future = muted
  const stepW = (12.23 - 0.46 - 5 * 0.08) / 6;
  const stepY = 6.30;
  const stepH = 0.42;
  compactPath.forEach((stepLabel, idx) => {
    const sx = 0.78 + idx * (stepW + 0.08);
    const isPast = currentCompactIdx >= 0 && idx < currentCompactIdx;
    const isCurrent = currentCompactIdx === idx;
    const fill = isCurrent ? COLORS.plum : isPast ? COLORS.plumSoft : COLORS.mist;
    const textColor = isCurrent || isPast ? COLORS.white : COLORS.muted;
    slide.addShape(pptx.ShapeType.rect, {
      x: sx, y: stepY, w: stepW, h: stepH,
      fill: { color: fill }, line: { color: fill, pt: 0 },
    });
    // Connector arrow tail (chevron) — small triangle on the right edge
    // for past/current steps. Skipped on the last step.
    if (idx < compactPath.length - 1) {
      slide.addShape(pptx.ShapeType.triangle, {
        x: sx + stepW - 0.02, y: stepY + stepH * 0.20, w: 0.10, h: stepH * 0.60,
        fill: { color: fill }, line: { color: fill, pt: 0 }, rotate: 90,
      });
    }
    slide.addText(stepLabel, {
      x: sx, y: stepY, w: stepW, h: stepH,
      fontFace: FONT, fontSize: 9.5, bold: isCurrent, color: textColor,
      align: 'center', valign: 'mid', fit: 'shrink',
    });
  });
};

const renderRisksMitigants = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Risks & Mitigants', pageNumber, totalSlides, `${context.stageLabel} | current live issue stack`);

  const riskRows = context.riskRows.length
    ? context.riskRows
    : [{ severity: 'Low', title: 'No open risks recorded', detail: 'The live risk register does not currently contain any open or flagged items.', fill: COLORS.green }];

  const tableRows = [
    [
      { text: 'Severity', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
      { text: 'Risk', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
      { text: 'Current Mitigant / Read-Through', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
    ],
    ...riskRows.slice(0, 5).map((row, index) => [
      { text: row.severity, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2, color: row.fill, bold: true, align: 'center' } },
      { text: row.title, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2 } },
      { text: row.detail, options: { fill: { color: index % 2 === 0 ? COLORS.white : COLORS.mist }, fontSize: 8.2 } },
    ]),
  ];
  addTable(slide, tableRows, {
    x: 0.55,
    y: 1.3,
    w: 8.1,
    colW: [1.1, 2.4, 4.6],
    rowH: 0.44,
  });

  // Severity distribution + category breakdown — fills the previously
  // empty 3.5" of space below the table (y 3.7 to 6.5).
  const allRiskItems = context.exportContext?.risks?.items || [];
  const summary = context.exportContext?.risks?.summary || {};
  const severityCounts = {
    Critical: Number(summary.critical) || allRiskItems.filter((r) => /critical|deal_breaker/i.test(String(r.severity || ''))).length,
    High:     Number(summary.high)     || allRiskItems.filter((r) => /^high$|buildability/i.test(String(r.severity || ''))).length,
    Medium:   Number(summary.medium)   || allRiskItems.filter((r) => /medium/i.test(String(r.severity || ''))).length,
    Low:      Number(summary.low)      || allRiskItems.filter((r) => /low/i.test(String(r.severity || ''))).length,
  };
  const totalRisks = severityCounts.Critical + severityCounts.High + severityCounts.Medium + severityCounts.Low;

  // Card frame for the bottom-left density block
  addCard(pptx, slide, {
    x: 0.55, y: 3.85, w: 8.1, h: 3.05,
    bandColor: COLORS.plumSoft,
    fill: COLORS.white,
  });
  slide.addText('SEVERITY DISTRIBUTION', {
    x: 0.78, y: 4.0, w: 4.0, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });

  // Severity histogram (native pptxgenjs bar chart). Always rendered;
  // when there are no risks, all four bars are zero and the chart still
  // tells a story ("0 across the board").
  slide.addChart(pptx.ChartType.bar, [{
    name: 'Open risks',
    labels: ['Critical', 'High', 'Medium', 'Low'],
    values: [severityCounts.Critical, severityCounts.High, severityCounts.Medium, severityCounts.Low],
  }], {
    x: 0.65, y: 4.3, w: 3.9, h: 2.5,
    barDir: 'col',
    chartColors: [COLORS.red, COLORS.amber, COLORS.plumSoft, COLORS.muted],
    showValue: true,
    dataLabelFontSize: 9,
    dataLabelColor: COLORS.charcoal,
    catAxisLabelFontSize: 9,
    valAxisLabelFontSize: 8,
    valAxisHidden: true,
    legendPos: 'none',
    showTitle: false,
    barGapWidthPct: 60,
    chartColorsOpacity: 90,
  });

  // Right column inside the bottom card — risk by category breakdown
  const categoryCounts = {};
  allRiskItems.forEach((r) => {
    const cat = String(r.category || 'other').toLowerCase();
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });
  const sortedCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  slide.addText('BY CATEGORY', {
    x: 4.85, y: 4.0, w: 3.6, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });

  if (sortedCategories.length > 0) {
    sortedCategories.forEach(([cat, count], idx) => {
      const rowY = 4.3 + idx * 0.45;
      // Category label
      slide.addText(cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), {
        x: 4.85, y: rowY, w: 2.4, h: 0.32,
        fontFace: FONT, fontSize: 10, bold: true, color: COLORS.charcoal, valign: 'mid',
      });
      // Bar visualisation — width relative to max count
      const maxCount = sortedCategories[0][1];
      const barW = Math.max(0.2, (count / maxCount) * 1.2);
      slide.addShape(pptx.ShapeType.rect, {
        x: 7.25, y: rowY + 0.06, w: barW, h: 0.20,
        fill: { color: COLORS.plum },
        line: { color: COLORS.plum, pt: 0.1 },
      });
      // Count value
      slide.addText(String(count), {
        x: 7.25 + barW + 0.08, y: rowY + 0.04, w: 0.4, h: 0.24,
        fontFace: FONT, fontSize: 10, bold: true, color: COLORS.plum, valign: 'mid',
      });
    });
  } else {
    slide.addText('No risk categories captured for this deal yet.', {
      x: 4.85, y: 4.4, w: 3.6, h: 0.4,
      fontFace: FONT, fontSize: 10, italic: true, color: COLORS.muted, valign: 'top',
    });
  }

  // Footer line — total risks
  slide.addText(
    totalRisks > 0
      ? `${totalRisks} open risk${totalRisks === 1 ? '' : 's'} on the live register. Resolve criticals before commitment.`
      : 'No open risks captured on the live register at the time of generation.',
    {
      x: 0.78, y: 6.55, w: 7.7, h: 0.32,
      fontFace: FONT, fontSize: 8.5, italic: true, color: COLORS.muted, valign: 'top',
    },
  );

  addCard(pptx, slide, {
    x: 8.95,
    y: 1.3,
    w: 3.83,
    h: 5.2,
    bandColor: context.recommendations.tone === 'negative' ? COLORS.red : context.recommendations.tone === 'caution' ? COLORS.amber : COLORS.green,
    fill: COLORS.white,
  });
  slide.addText('Decision Overlay', {
    x: 9.22, y: 1.54, w: 2.2, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  slide.addText((context.recommendations.label || 'Review').toUpperCase(), {
    x: 9.22, y: 1.95, w: 3.1, h: 0.28,
    fontFace: FONT, fontSize: 16, bold: true, color: context.recommendations.tone === 'negative' ? COLORS.red : context.recommendations.tone === 'caution' ? COLORS.amber : COLORS.green,
  });
  slide.addText(context.recommendations.reason || 'Recommendation will update as risk and underwriting fields are refreshed.', {
    x: 9.22, y: 2.38, w: 3.05, h: 0.7,
    fontFace: FONT, fontSize: 8.7, color: COLORS.charcoal, fit: 'shrink',
  });
  addBulletList(slide, riskRows.slice(0, 3).map((row) => `${row.title}: ${row.detail}`), {
    x: 9.22,
    y: 3.32,
    w: 3.0,
    h: 2.4,
    fontSize: 8.6,
    bulletColor: context.recommendations.tone === 'negative' ? COLORS.red : COLORS.sandDeep,
  });
};

const renderNextSteps = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Next Steps', pageNumber, totalSlides, `${context.stageLabel} | action list from live readiness state`);

  const groups = context.nextStepGroups.length
    ? context.nextStepGroups
    : [{ group: 'Immediate Actions', items: ['Populate approvals, documents, and underwriting fields to unlock a fuller Investor-Grade deck.'] }];

  // Pad to 3 cards so the slide layout doesn't leave one or two columns
  // dangling. Empty pads render a "no items captured yet" state.
  const padded = groups.slice(0, 3);
  while (padded.length < 3) {
    padded.push({ group: padded.length === 0 ? 'Immediate Actions' : (padded.length === 1 ? 'Legal Actions' : 'Regulatory Actions'), items: [] });
  }

  padded.forEach((group, index) => {
    const x = 0.55 + index * 4.12;
    const cardY = 1.32;
    const cardH = 5.3;
    addCard(pptx, slide, {
      x,
      y: cardY,
      w: 3.84,
      h: cardH,
      bandColor: index === 0 ? COLORS.plum : index === 1 ? COLORS.sandDeep : COLORS.plumSoft,
      fill: index === 1 ? COLORS.mist : COLORS.white,
    });

    // Group eyebrow + heading
    slide.addText(`Track ${String.fromCharCode(65 + index)}`, {
      x: x + 0.24, y: cardY + 0.20, w: 3.1, h: 0.18,
      fontFace: FONT, fontSize: 8, bold: true, color: COLORS.muted, charSpace: 1.6,
    });
    slide.addText(group.group, {
      x: x + 0.24, y: cardY + 0.42, w: 3.4, h: 0.32,
      fontFace: FONT, fontSize: 14, bold: true, color: COLORS.charcoal, fit: 'shrink',
    });
    // Hairline separator under the title
    slide.addShape(pptx.ShapeType.line, {
      x: x + 0.24, y: cardY + 0.85, w: 0.7, h: 0,
      line: { color: index === 0 ? COLORS.plum : index === 1 ? COLORS.sandDeep : COLORS.plumSoft, pt: 1.5 },
    });

    // Items list — bullets aligned with text, top-anchored, fixed line
    // height so a single-bullet card no longer floats text to the middle.
    if (group.items && group.items.length > 0) {
      addBulletList(slide, group.items, {
        x: x + 0.24,
        y: cardY + 1.05,
        w: 3.4,
        h: cardH - 1.2,
        fontSize: 10,
        bulletColor: index === 1 ? COLORS.sandDeep : COLORS.plum,
        lineH: 0.62,
      });
    } else {
      slide.addText('No actions captured yet for this track.', {
        x: x + 0.24, y: cardY + 1.05, w: 3.4, h: 0.6,
        fontFace: FONT, fontSize: 9.5, italic: true, color: COLORS.muted, valign: 'top',
      });
    }

    // Footer note — what this track means
    const trackHints = [
      'Diligence + financial-model preparation needed before IC.',
      'Title / EC / mutation evidence requested from the seller side.',
      'Approvals, conversions, and statutory clearances to validate.',
    ];
    slide.addText(trackHints[index] || '', {
      x: x + 0.24, y: cardY + cardH - 0.55, w: 3.4, h: 0.4,
      fontFace: FONT, fontSize: 8.5, italic: true, color: COLORS.muted, valign: 'top', fit: 'shrink',
    });
  });
};

const renderDisclaimer = (pptx, slide, context, pageNumber, totalSlides) => {
  setSlideDefaults(slide);
  // Frame
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.55, y: 0.55, w: 12.23, h: 6.35,
    fill: { color: COLORS.white },
    line: { color: COLORS.line, pt: 0.6 },
  });
  // Copper accent left rule
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.55, y: 0.55, w: 0.10, h: 6.35,
    fill: { color: COLORS.plum },
    line: { color: COLORS.plum, pt: 0 },
  });

  // Heading
  slide.addText('REDIP — INTERNAL INVESTMENT MATERIAL', {
    x: 0.85, y: 0.78, w: 11.7, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.8,
  });
  slide.addText('Disclaimer', {
    x: 0.85, y: 1.05, w: 11.7, h: 0.46,
    fontFace: FONT, fontSize: 28, bold: true, color: COLORS.charcoal,
  });
  // Hairline under title
  slide.addShape(pptx.ShapeType.line, {
    x: 0.85, y: 1.62, w: 1.4, h: 0,
    line: { color: COLORS.plumSoft, pt: 1.5 },
  });

  // Lead paragraph
  slide.addText(
    'This deck is generated by REDIP from stored deal data and verified market sources. ' +
    'It is intended for internal investment review and is not a recommendation to buy, sell, or otherwise transact in any property or security.',
    {
      x: 0.85, y: 1.78, w: 11.7, h: 0.7,
      fontFace: FONT, fontSize: 11, color: COLORS.charcoal, valign: 'top', fit: 'shrink',
    },
  );

  // PR-NX74 (2026-05-19) — operator policy: PPTX must not surface AI usage
  // anywhere. The two-column "AI-Assisted vs Platform Data" badge row
  // (with the loud "Sections labelled AI-Assisted contain interpretation
  // generated by large language models..." prose) is removed entirely.
  // Replaced with a single full-width grounding paragraph that frames the
  // deck without naming AI.
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.85, y: 2.65, w: 11.93, h: 1.85,
    fill: { color: COLORS.mist }, line: { color: COLORS.line, pt: 0.5 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.85, y: 2.65, w: 0.06, h: 1.85,
    fill: { color: COLORS.plum }, line: { color: COLORS.plum, pt: 0 },
  });
  slide.addText(
    'Every figure in this deck — KPIs, financials, comparables, composite score, sensitivity grids — is sourced from REDIP records and computed by the deterministic financial kernel. Treat them as faithful representations of the data captured in REDIP at generation time, not as warranted facts. Independent verification against source documents is required before any investment decision.',
    {
      x: 1.10, y: 2.85, w: 11.6, h: 1.50,
      fontFace: FONT, fontSize: 10.5, color: COLORS.charcoal, valign: 'top', fit: 'shrink',
    },
  );

  // Hard rules section — PR-NX74 trimmed the "AI-assisted prose carries
  // ... notice" bullet per operator policy.
  slide.addText('HARD RULES', {
    x: 0.85, y: 4.65, w: 4.0, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });
  addBulletList(slide, [
    'REDIP does not warrant zoning, legal title, RERA registration, encumbrance status, or approval status. Independent verification through Karnataka land-records (Bhoomi / Kaveri portal) and Karnataka RERA is required before any investment decision.',
    'Comparables carry per-row source and verification status; only rows marked Verified have been confirmed in REDIP — treat all others as context. Confirm freshness and applicability against external sources before relying on the comp set.',
    'This deck is confidential and prepared for internal review only.',
  ], {
    x: 0.85, y: 4.92, w: 11.7, h: 1.55,
    fontSize: 9.2,
    bulletColor: COLORS.plum,
    lineH: 0.36,
  });

  // Footer
  slide.addText(`Generated by ${context.brandName} on ${formatDate(context.generatedAt)} for ${context.generatedFor}.`, {
    x: 0.85, y: 6.55, w: 11.7, h: 0.20,
    fontFace: FONT, fontSize: 8, italic: true, color: COLORS.muted, align: 'center',
  });
  slide.addText(`${pageNumber} / ${totalSlides}`, {
    x: 12.10, y: 7.05, w: 0.7, h: 0.16,
    fontFace: FONT, fontSize: 8, color: COLORS.plum, align: 'right',
  });
};


// Planning Context slide — surfaces RMP 2031 city-level callouts (SDZ
// corridors, NGT drain buffers, heritage zones, Peripheral Ring Road)
// inside the IC deck so reviewers see the draft planning constraints without
// having to flip to the admin terminal. RMP 2031's provisional approval was
// withdrawn in July 2020 — these are descriptive reference only, NOT an
// operative regulatory source (the operative plan is RMP 2015). The slide must
// label them as such and never imply they are authoritative. Layout:
//   - Top half: 2-column commentary card (narrative bullets)
//   - Bottom half: 4-up callout grid, one tile per RMP fact category
const renderPlanningContext = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(
    pptx, slide, context,
    'Planning Context — RMP 2031 (Reference Only)',
    pageNumber, totalSlides,
    `${context.deal.city || 'Bengaluru'} | withdrawn draft — descriptive reference, not operative`,
  );

  // Commentary card (top, full width)
  addCard(pptx, slide, { x: 0.55, y: 1.25, w: 12.23, h: 1.8, bandColor: COLORS.plum, fill: COLORS.mist });
  slide.addText('Why this matters', {
    x: 0.85, y: 1.45, w: 5, h: 0.22,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  const commentary = Array.isArray(context.planningCommentary) ? context.planningCommentary : [];
  commentary.slice(0, 3).forEach((line, idx) => {
    slide.addText(line, {
      x: 0.85, y: 1.78 + idx * 0.36, w: 11.6, h: 0.32,
      fontFace: FONT, fontSize: 9.5, color: COLORS.charcoal, fit: 'shrink',
    });
  });

  // Callout grid (bottom, 4 columns × 1 row)
  const rows = Array.isArray(context.planningRows) ? context.planningRows : [];
  if (rows.length === 0) {
    addCard(pptx, slide, { x: 0.55, y: 3.25, w: 12.23, h: 3.4, bandColor: COLORS.sandDeep, fill: COLORS.white });
    slide.addText('No RMP 2031 reference callouts ingested yet.', {
      x: 0.85, y: 3.55, w: 11.6, h: 0.3,
      fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
    });
    slide.addText('RMP 2031’s provisional approval was withdrawn in July 2020 — it is descriptive reference only, not an operative regulatory source (the operative plan is RMP 2015). Once its reference maps and Volume 4 PDR are ingested, this slide surfaces the draft SDZ corridors, NGT drain buffers, heritage radii, and Peripheral Ring Road alignment — each page-cited and to be verified against primary records before quoting in IC.', {
      x: 0.85, y: 3.95, w: 11.6, h: 1.5,
      fontFace: FONT, fontSize: 10, color: COLORS.muted, fit: 'shrink',
    });
    return;
  }

  const cardWidth = 2.95;
  const cardGap = 0.13;
  rows.slice(0, 4).forEach((row, idx) => {
    const x = 0.55 + idx * (cardWidth + cardGap);
    const y = 3.25;
    addCard(pptx, slide, {
      x, y, w: cardWidth, h: 3.4,
      bandColor: idx % 2 === 0 ? COLORS.plum : COLORS.sandDeep,
      fill: idx % 2 === 0 ? COLORS.white : COLORS.mist,
    });
    slide.addText(row.label, {
      x: x + 0.22, y: y + 0.25, w: cardWidth - 0.4, h: 0.22,
      fontFace: FONT, fontSize: 10, bold: true, color: COLORS.muted,
    });
    slide.addText(row.value, {
      x: x + 0.22, y: y + 0.6, w: cardWidth - 0.4, h: 1.4,
      fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal, valign: 'top', fit: 'shrink',
    });
    if (row.hint) {
      slide.addText(row.hint, {
        x: x + 0.22, y: y + 2.2, w: cardWidth - 0.4, h: 1.0,
        fontFace: FONT, fontSize: 8.5, color: COLORS.muted, valign: 'top', fit: 'shrink',
      });
    }
  });
};


const SITE_YIELD_BINDING_LABEL = {
  far: 'FAR / FSI',
  coverage_height: 'Coverage × height',
  plot_subdivision: 'Plot subdivision',
};

/**
 * Site Yield & Massing slide. The deterministic site-yield programme (recomputed
 * server-side from the saved Yield Studio study, or screening defaults from the
 * parcel): headline KPI cards + an area schedule + the unit mix, with the
 * binding constraint. Platform data — no AI mention (operator policy); the
 * deck-wide disclaimer slide covers it. Auto-skipped when no programme.
 */
const renderSiteYield = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(
    pptx, slide, context,
    'Site Yield & Massing',
    pageNumber, totalSlides,
    `${context.assetClassLabel} | deterministic screening programme`,
  );
  const sy = context.siteYield;
  if (!sy || !sy.computed || !sy.computed.ok) {
    addCard(pptx, slide, { x: 0.55, y: 1.4, w: 12.23, h: 1.1, bandColor: COLORS.sandDeep, fill: COLORS.white });
    slide.addText('No site-yield programme available yet — enter a plot area and FSI in Yield Studio.', {
      x: 0.85, y: 1.7, w: 11.6, h: 0.4, fontFace: FONT, fontSize: 12, color: COLORS.charcoal,
    });
    return;
  }

  const c = sy.computed;
  const e = c.envelope || {};
  const a = c.areaSchedule || {};
  const t = c.totals || {};
  // Em-dash for missing (design bar: never 'N/A'), and null/'' guarded FIRST —
  // Number(null) === 0, so the naive isFinite check rendered a fabricated '0'.
  const intl = (n) => (n == null || n === '' || !Number.isFinite(Number(n)) ? '–' : Math.round(Number(n)).toLocaleString('en-IN'));

  if (sy.mode === 'screening_defaults') {
    slide.addText('Screening estimate from the parcel’s land area and FSI — no saved study yet.', {
      x: 0.55, y: 1.18, w: 12.23, h: 0.26, fontFace: FONT, fontSize: 9.5, italic: true, color: COLORS.muted,
    });
  }

  // Headline KPI cards (4-up). Missing values render the em-dash (design bar:
  // never 'N/A' on customer surfaces).
  const kpis = [{ label: 'Realized GFA', value: e.realized_gfa_sqft != null ? `${intl(e.realized_gfa_sqft)} sqft` : '–' }];
  if (t.units != null) kpis.push({ label: 'Units', value: intl(t.units) });
  else if (t.keys != null) kpis.push({ label: 'Keys', value: intl(t.keys) });
  else if (t.plots != null) kpis.push({ label: t.villas != null ? 'Villas' : 'Plots', value: intl(t.villas != null ? t.villas : t.plots) });
  else if (a.leasable_sqft != null) kpis.push({ label: 'Leasable', value: `${intl(a.leasable_sqft)} sqft` });
  kpis.push({ label: 'Parking (ECS)', value: c.parking && c.parking.required_ecs != null ? intl(c.parking.required_ecs) : '–' });
  kpis.push({ label: 'Binding constraint', value: SITE_YIELD_BINDING_LABEL[c.bindingConstraint] || c.bindingConstraint || '—' });

  const cardW = 2.95;
  const gap = 0.13;
  kpis.slice(0, 4).forEach((k, i) => addKpiCard(pptx, slide, {
    x: 0.55 + i * (cardW + gap), y: 1.6, w: cardW, h: 1.35,
    label: k.label, value: k.value, tone: i % 2 === 0 ? COLORS.plum : COLORS.sandDeep,
  }));

  // Area schedule (label / value).
  const headerCell = (text) => ({ text, options: { bold: true, fill: COLORS.mist, color: COLORS.charcoal } });
  const schedRows = [[headerCell('Metric'), headerCell('Value')]];
  const pushRow = (label, value) => { if (value != null && value !== '') schedRows.push([label, String(value)]); };
  pushRow('Effective FSI', e.effective_fsi != null ? String(e.effective_fsi) : null);
  pushRow('Floors', e.floors != null ? String(e.floors) : null);
  if (a.saleable_sqft != null) pushRow('Saleable (SBA)', `${intl(a.saleable_sqft)} sqft`);
  if (a.leasable_sqft != null) pushRow('Leasable', `${intl(a.leasable_sqft)} sqft`);
  if (a.net_saleable_sqft != null) pushRow('Net saleable', `${intl(a.net_saleable_sqft)} sqft`);
  if (a.carpet_sqft != null) pushRow('Carpet pool', `${intl(a.carpet_sqft)} sqft`);
  if (a.saleable_plot_area_sqft != null) pushRow('Saleable plot area', `${intl(a.saleable_plot_area_sqft)} sqft`);
  if (c.parking && c.parking.norm) pushRow('Parking norm', c.parking.norm);
  if (sy.boundary) pushRow('Boundary', `${sy.boundary.source}${sy.boundary.area_sqft != null ? ` · ${intl(sy.boundary.area_sqft)} sqft` : ''}`);

  const hasUnitMix = Array.isArray(c.unitMix) && c.unitMix.length > 0;
  if (schedRows.length > 1) {
    addTable(slide, schedRows, { x: 0.55, y: 3.3, w: hasUnitMix ? 6.0 : 12.23, colW: hasUnitMix ? [2.6, 3.4] : [4.0, 8.23], fontSize: 9.5, rowH: 0.32 });
  }

  // Unit mix (residential).
  if (hasUnitMix) {
    const mixRows = [[headerCell('Type'), headerCell('Units'), headerCell('Carpet (sqft)')]];
    c.unitMix.forEach((u) => mixRows.push([u.label || u.key, intl(u.count), intl(u.carpet_total_sqft)]));
    addTable(slide, mixRows, { x: 6.85, y: 3.3, w: 5.93, colW: [2.43, 1.5, 2.0], fontSize: 9.5, rowH: 0.32 });
  }

  if (Number(c.unrealizedFarPct) > 0) {
    slide.addText(`${c.unrealizedFarPct}% of permitted FAR unrealised at this height — coverage × floors caps the build.`, {
      x: 0.55, y: 6.55, w: 12.23, h: 0.26, fontFace: FONT, fontSize: 9, color: COLORS.muted, fit: 'shrink',
    });
  }
  if (c.disclaimer) {
    slide.addText(c.disclaimer, {
      x: 0.55, y: 6.84, w: 12.23, h: 0.5, fontFace: FONT, fontSize: 7.5, italic: true, color: COLORS.muted, fit: 'shrink',
    });
  }
};


// ── Deal Register slide (rent-roll program) ─────────────────────────────────
// Family-adaptive: a 4-up committed-KPI row + a top-N records table, from the
// server-recomputed register slice. Renders only when the deck manifest gates
// it in (deal has a register with records). Deterministic — no AI wording; the
// date-only footer comes from addTopHeader. Register money aggregates arrive in
// absolute ₹ → divide by 1e7 for the ₹-crore formatters.
const LEASE_STATUS_PPTX = { vacant: 'Vacant', loi: 'LOI', committed: 'Committed', occupied: 'Occupied', notice_served: 'Notice served', expired: 'Expired / MTM' };
const SALE_STATUS_PPTX = { unsold: 'Unsold', booked: 'Booked', sold: 'Sold', registered: 'Registered', cancelled: 'Cancelled' };
const OCC_STATUS_PPTX = { in_place: 'In place', vacated: 'Vacated', disputed: 'Disputed' };
const rrCrPptx = (v) => (v == null ? '–' : (formatCrores(Number(v) / 1e7) || '–'));
const rrRupeePptx = (v) => (v == null || !Number.isFinite(Number(v)) ? '–' : `INR ${formatNumber(v)}`);

const RENT_ROLL_SLIDE = {
  lease_income: (slice) => {
    const m = slice.metrics || {};
    const occ = m.occupancy || {}; const wale = m.wale || {}; const rev = m.revenue || {}; const mtm = m.mtm || {};
    const rows = ((slice.records && slice.records.lease) || []).slice(0, 6);
    return {
      kpis: [
        { label: 'Committed occupancy', value: formatPct(occ.committedPct) || '–' },
        { label: 'WALE to expiry', value: wale.toExpiryRentYears == null ? '–' : `${Number(wale.toExpiryRentYears).toFixed(1)} yr` },
        { label: 'Accrual NOI', value: rrCrPptx(rev.accrualNOI) },
        { label: 'In-place vs market', value: formatPct(mtm.portfolioPct) || '–' },
      ],
      headers: ['Tenant / Occupier', 'Status', 'Area (sqft)', 'Base rate', 'Expiry'],
      colW: [3.9, 1.9, 2.14, 1.9, 2.4],
      rows: rows.map((r) => [
        firstText(r.tenant_name, r.record_label) || '–',
        LEASE_STATUS_PPTX[r.status] || r.status || '–',
        formatNumber(r.chargeable_area_sqft) || '–',
        formatNumber(r.base_rent_rate, 2) || '–',
        r.lease_expiry ? String(r.lease_expiry).slice(0, 10) : '–',
      ]),
    };
  },
  sales_collections: (slice) => {
    const m = slice.metrics || {};
    const area = m.area || {}; const coll = m.collections || {};
    const rows = ((slice.records && slice.records.sale) || []).slice(0, 6);
    return {
      kpis: [
        { label: 'Sell-through (area)', value: formatPct(area.sellThroughByAreaPct) || '–' },
        { label: 'Sold GDV', value: rrCrPptx(coll.soldGDV) },
        { label: 'Collection efficiency', value: formatPct(coll.collectionEfficiencyPct) || '–' },
        { label: 'Overdue', value: rrCrPptx(coll.overdue) },
      ],
      headers: ['Plot / Unit', 'Status', 'Area (sqft)', 'Base ₹/sqft', 'Agreement'],
      colW: [3.0, 2.0, 2.14, 2.2, 2.9],
      rows: rows.map((r) => [
        firstText(r.record_label) || '–',
        SALE_STATUS_PPTX[r.status] || r.status || '–',
        formatNumber(r.area_sqft) || '–',
        formatNumber(r.base_price_per_sqft) || '–',
        rrCrPptx(r.agreement_value),
      ]),
    };
  },
  hotel_operating: (slice) => {
    const m = slice.metrics || {};
    const op = m.operating || {};
    const series = (Array.isArray(op.series) ? op.series : []).slice(-6);
    return {
      kpis: [
        { label: 'TTM occupancy', value: formatPct(op.ttmOccupancyPct) || '–' },
        { label: 'TTM ADR', value: rrRupeePptx(op.ttmAdr) },
        { label: 'TTM RevPAR', value: rrRupeePptx(op.ttmRevpar) },
        { label: 'TTM owner NOI', value: rrCrPptx(op.ttmOwnerNoi) },
      ],
      headers: ['Month', 'Occupancy', 'ADR', 'RevPAR', 'Owner NOI'],
      colW: [2.5, 2.4, 2.4, 2.4, 2.53],
      rows: series.map((s) => [
        s.month || '–',
        formatPct(s.occupancyPct) || '–',
        rrRupeePptx(s.adr),
        rrRupeePptx(s.revpar),
        rrRupeePptx(s.ownerNoi),
      ]),
    };
  },
  redevelopment: (slice) => {
    const m = slice.metrics || {};
    const occ = m.occupant || {};
    const vac = occ.vacancy || {}; const ent = occ.entitlement || {}; const obl = occ.obligations || {}; const risk = occ.risk || {};
    const rows = ((slice.records && slice.records.occupant) || []).slice(0, 6);
    return {
      kpis: [
        { label: 'Vacation progress', value: formatPct(vac.vacatedByCountPct) || '–' },
        { label: 'Free rehab area', value: ent.rehabEntitlementSqft == null ? '–' : `${formatNumber(ent.rehabEntitlementSqft)} sqft` },
        { label: 'Rehousing obligation', value: rrCrPptx(obl.totalRehousingObligation) },
        { label: 'At-risk occupiers', value: risk.atRiskUnits == null ? '–' : String(risk.atRiskUnits) },
      ],
      headers: ['Unit / Ref', 'Occupant', 'Status', 'Existing (sqft)', 'Transit ₹/mo'],
      colW: [2.4, 3.0, 1.9, 2.4, 2.53],
      rows: rows.map((r) => [
        firstText(r.record_label) || '–',
        firstText(r.occupant_name) || '–',
        OCC_STATUS_PPTX[r.status] || r.status || '–',
        formatNumber(r.existing_carpet_area_sqft) || '–',
        formatNumber(r.transit_rent_monthly) || '–',
      ]),
    };
  },
};

const renderRentRoll = (pptx, slide, context, pageNumber, totalSlides) => {
  const slice = context.rentRoll;
  addTopHeader(
    pptx, slide, context,
    context.rentRollTitle || 'Deal Register',
    pageNumber, totalSlides,
    `Deal register as of ${(slice && slice.asOfDate) || 'n/a'} | gross figures, pre ownership share`,
  );
  if (!slice || !slice.family || !RENT_ROLL_SLIDE[slice.family]) return;
  const data = RENT_ROLL_SLIDE[slice.family](slice);

  const cardW = 2.95;
  const gap = 0.13;
  data.kpis.slice(0, 4).forEach((k, i) => addKpiCard(pptx, slide, {
    x: 0.55 + i * (cardW + gap), y: 1.6, w: cardW, h: 1.35,
    label: k.label, value: k.value, tone: i % 2 === 0 ? COLORS.plum : COLORS.sandDeep,
  }));

  if (data.rows && data.rows.length) {
    const headerCell = (t) => ({ text: t, options: { bold: true, fill: COLORS.mist, color: COLORS.charcoal } });
    const tableRows = [data.headers.map(headerCell), ...data.rows];
    addTable(slide, tableRows, { x: 0.55, y: 3.35, w: 12.23, colW: data.colW, fontSize: 9.5, rowH: 0.34 });
  } else {
    slide.addText('No individual records to list — the committed metrics above summarise the register.', {
      x: 0.55, y: 3.5, w: 12.23, h: 0.4, fontFace: FONT, fontSize: 11, color: COLORS.muted,
    });
  }

  slide.addText(
    'Committed metrics from the deterministic deal register; the full roll with live formulas is in the Excel workbook.',
    { x: 0.55, y: 6.9, w: 12.23, h: 0.3, fontFace: FONT, fontSize: 8, italic: true, color: COLORS.muted, fit: 'shrink' },
  );
};


/**
 * Pros & Cons slide. Two-column layout, deterministic-then-AI synthesis.
 * Renders even when prosCons narrative is unavailable — falls back to
 * a deterministic pros/cons set computed from the deal payload so the
 * slide still ships value.
 */
const renderProsCons = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Pros & Cons', pageNumber, totalSlides, `${context.assetClassLabel} | ${context.dealTypeLabel}`);

  const prosCons = context.precomputed?.prosCons || {};
  const aiPros = Array.isArray(prosCons.pros) ? prosCons.pros : [];
  const aiCons = Array.isArray(prosCons.cons) ? prosCons.cons : [];

  // Deterministic fallback — anchored in payload data so we always have at
  // least 2 items per column. Order matters: AI synthesis comes first,
  // determinist seed only fills the gaps.
  const determinedPros = [];
  const determinedCons = [];
  if (context.irr != null) {
    if (context.irr >= 20) determinedPros.push(`Project IRR of ${context.irr.toFixed(1)}% sits in the strong band for ${context.assetClassLabel.toLowerCase()}.`);
    else if (context.irr < 14) determinedCons.push(`Project IRR of ${context.irr.toFixed(1)}% is below benchmark for ${context.assetClassLabel.toLowerCase()}.`);
  }
  if (context.equityMultiple != null) {
    if (context.equityMultiple >= 1.8) determinedPros.push(`Equity multiple of ${context.equityMultiple.toFixed(2)}x is healthy for the asset class.`);
    else if (context.equityMultiple < 1.4) determinedCons.push(`Equity multiple of ${context.equityMultiple.toFixed(2)}x is thin.`);
  }
  if (context.grossMargin != null) {
    if (context.grossMargin >= 25) determinedPros.push(`Gross margin of ${context.grossMargin.toFixed(1)}% gives meaningful cushion against cost overruns.`);
    else if (context.grossMargin < 15) determinedCons.push(`Gross margin of ${context.grossMargin.toFixed(1)}% leaves little buffer for execution slip.`);
  }
  if (context.readiness?.readiness_pct != null) {
    if (context.readiness.readiness_pct >= 75) determinedPros.push(`Execution readiness at ${context.readiness.readiness_pct}% — most prep work already done.`);
    else if (context.readiness.readiness_pct < 35) determinedCons.push(`Execution readiness at ${context.readiness.readiness_pct}% — significant prep still pending.`);
  }
  const riskSummary = context.exportContext?.risks?.summary || {};
  if ((Number(riskSummary.critical) || 0) > 0) {
    determinedCons.push(`${riskSummary.critical} critical risk${riskSummary.critical > 1 ? 's' : ''} flagged in the register — must clear before commitment.`);
  }
  if ((Number(context.approvalSummary?.validated) || 0) > 0 && (Number(context.approvalSummary?.required) || 0) > 0) {
    const ratio = context.approvalSummary.validated / context.approvalSummary.required;
    if (ratio >= 0.8) determinedPros.push(`${context.approvalSummary.validated} of ${context.approvalSummary.required} required approvals validated.`);
    else if (ratio < 0.4) determinedCons.push(`Only ${context.approvalSummary.validated} of ${context.approvalSummary.required} required approvals validated so far.`);
  }

  // Merge: AI synthesis first, deterministic seed fills any remaining slots up to 5.
  const mergeUnique = (primary, secondary, cap = 5) => {
    const out = [];
    const seen = new Set();
    [...primary, ...secondary].forEach((item) => {
      const text = String(item || '').trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key) || out.length >= cap) return;
      seen.add(key);
      out.push(text);
    });
    return out;
  };
  const pros = mergeUnique(aiPros, determinedPros);
  const cons = mergeUnique(aiCons, determinedCons);

  addCard(pptx, slide, { x: 0.55, y: 1.3, w: 12.23, h: 5.5, bandColor: COLORS.plum, fill: COLORS.white });
  addProsConsColumns(slide, {
    x: 0.85, y: 1.6, w: 11.65, h: 4.7,
    pros, cons,
  });

  // Source / disclaimer line
  slide.addText(
    'Synthesised from stored deal data. Verify all interpretations against source documents before reliance.',
    {
      x: 0.85, y: 6.4, w: 11.65, h: 0.32,
      fontFace: FONT, fontSize: 8, italic: true, color: COLORS.muted,
    },
  );
};

/**
 * Key Assumptions & Sources appendix slide.
 *
 * Lists the inputs that drove the deck's KPIs/score/sensitivity, with
 * an explicit source label per row so the IC reader can audit "where
 * did this number come from?" without flipping into the platform.
 *
 * Sources collapse to a small vocabulary so the cell stays readable:
 *   - Deal record           — saved on the deal row in REDIP
 *   - Underwriting input    — stored in deal.model_params.inputs
 *   - Property record       — extracted from the parcel / property doc
 *   - Financial kernel      — computed by the deterministic engine
 *   - Platform default      — falls back when neither operator nor
 *                             extractor populated the field
 */
const renderKeyAssumptions = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Key Assumptions & Sources', pageNumber, totalSlides, 'Input trace | every figure in this deck is auditable to a source field');

  const inp = context.inputs || {};

  const fmt = (v, formatter) => {
    if (v == null || v === '') return null;
    return formatter ? formatter(v) : String(v);
  };
  const SRC = {
    deal: 'Deal record',
    input: 'Underwriting input',
    property: 'Property record',
    kernel: 'Financial kernel',
    fallback: 'Platform default',
    extracted: 'Document extraction',
  };

  // Row builder — keeps the table compact even when a value is missing
  // (still shows the label and the source so reviewers know where to
  // populate it).
  const row = (assumption, value, source) => ({
    assumption,
    value: value == null || value === '' ? '— not yet populated —' : value,
    source: value == null || value === '' ? `${source} · pending` : source,
    pending: value == null || value === '',
  });

  // Build the assumption table — grouped categories, but rendered as one
  // table so the visual treatment is consistent.
  const rows = [
    // ── General
    row('Asset class',          fmt(context.assetClassLabel), SRC.deal),
    row('Deal type / structure', `${context.dealTypeLabel} · ${context.dealStructureLabel}`, SRC.deal),
    row('Locality',             fmt(context.locationLine),     SRC.deal),
    row('Saleable area',        fmt(context.saleableAreaSqft, formatArea), SRC.property),
    row('Land area',            fmt(context.landAreaSqft,     formatArea), SRC.property),
    row('FSI / FAR',            fmt(num(firstNumber(context.deal.fsi, inp.fsi))), SRC.property),
    // ── Pricing & Revenue
    row('Selling rate / sqft',  fmt(context.modelSellRate, formatRate),    SRC.input),
    row('Pricing escalation',   fmt(num(firstNumber(inp.pricingEscalationPct, inp.rentEscalationPct)), (v) => formatPct(v * (Math.abs(v) > 1 ? 1 : 100), 1)), SRC.input),
    row('Sales velocity',       fmt(num(inp.salesVelocityPct), (v) => formatPct(v * (Math.abs(v) > 1 ? 1 : 100), 1)), SRC.input),
    // ── Cost Structure
    row('Land cost',            fmt(num(firstNumber(inp.landCostCr, context.deal.land_cost_cr)), formatCrores), SRC.input),
    row('Construction / sqft',  fmt(num(firstNumber(inp.constructionCostPerSqft, context.deal.construction_cost_per_sqft)), formatRate), SRC.input),
    row('Approval & fees',      fmt(num(firstNumber(inp.approvalCostCr, context.deal.approval_cost_cr)), formatCrores), SRC.input),
    // ── Capital & Returns
    row('Debt LTV',             fmt(num(firstNumber(inp.debtLTV, inp.debtPct)), (v) => formatPct(v * (Math.abs(v) > 1 ? 1 : 100), 1)), SRC.input),
    row('Interest rate',        fmt(num(firstNumber(inp.debtRatePct, inp.interestRatePct)), (v) => formatPct(v * (Math.abs(v) > 1 ? 1 : 100), 2)), SRC.input),
    row('Discount rate',        fmt(num(firstNumber(inp.discountRatePct, context.deal.discount_rate_pct)), (v) => formatPct(v * (Math.abs(v) > 1 ? 1 : 100), 2)), SRC.input),
    row('Project IRR',          fmt(context.irr, (v) => formatPct(v, 1)),  SRC.kernel),
    row('Equity multiple',      fmt(context.equityMultiple, (v) => `${formatNumber(v, 2)}x`), SRC.kernel),
  ];

  // Two-column layout. Each column shows ~9 rows so the slide stays
  // breathable; we cap to 18 rows total which we already have.
  const halfPoint = Math.ceil(rows.length / 2);
  const leftRows = rows.slice(0, halfPoint);
  const rightRows = rows.slice(halfPoint);

  const buildTable = (data, x) => {
    const tableRows = [
      [
        { text: 'Assumption', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum }, fontSize: 8.5 } },
        { text: 'Value',      options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum }, fontSize: 8.5 } },
        { text: 'Source',     options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum }, fontSize: 8.5 } },
      ],
      ...data.map((r, idx) => [
        { text: r.assumption, options: {
          fontSize: 8.5, fill: { color: idx % 2 === 0 ? COLORS.white : COLORS.mist },
          color: COLORS.charcoal, bold: true,
        } },
        { text: String(r.value),  options: {
          fontSize: 8.5, fill: { color: idx % 2 === 0 ? COLORS.white : COLORS.mist },
          color: r.pending ? COLORS.muted : COLORS.charcoal,
          italic: r.pending,
        } },
        { text: r.source, options: {
          fontSize: 8, fill: { color: idx % 2 === 0 ? COLORS.white : COLORS.mist },
          color: r.pending ? COLORS.amber : COLORS.muted, italic: true,
        } },
      ]),
    ];
    addTable(slide, tableRows, {
      x, y: 1.30, w: 6.10,
      colW: [2.05, 2.20, 1.85],
      rowH: 0.36,
    });
  };

  buildTable(leftRows, 0.55);
  buildTable(rightRows, 6.78);

  // Footer — provenance promise. Worded WITHOUT mentioning AI: the PPTX
  // disclosure policy is zero AI mentions anywhere on customer slides, and a
  // defensive "AI is not used…" sentence is itself an AI mention.
  addCard(pptx, slide, {
    x: 0.55, y: 6.50, w: 12.23, h: 0.45,
    bandColor: COLORS.plumSoft, fill: COLORS.mist,
  });
  slide.addText(
    'Every value in this appendix is sourced from the deterministic platform — deal record, property record, underwriting inputs, or the financial kernel.',
    {
      x: 0.78, y: 6.55, w: 11.7, h: 0.36,
      fontFace: FONT, fontSize: 9, italic: true, color: COLORS.charcoal, valign: 'top', fit: 'shrink',
    },
  );
};

// ═══════════════════════════════════════════════════════════════════════
// PR-NX54 (2026-05-19) — 3 new AI narrative slides
// ═══════════════════════════════════════════════════════════════════════
//
// Cross-product parity with DOCX PR-NX43 / NX44 / NX45. The same
// services that synthesize those DOCX sections (generateRiskNarrative,
// generateSensitivityNarrative, generateDocumentInsights) already
// populate `exportContext.risks.narrative`, `exportContext.sensitivityNarrative`,
// `exportContext.documents.insights` via dealExport.service.
//
// These 3 PPTX slides read directly from `context.exportContext` and
// render with the same disclosure pattern as renderBriefing — amber
// disclosure banner at the top, content in card grid, provenance
// footer with provider + confidence + auto-failover diagnostic.
//
// Each slide auto-falls-back to a templated "not available" panel when
// the narrative envelope is `available: false` (rare — only when ALL
// providers in the cascade fail), so the deck never breaks regardless
// of AI provider state.

// PR-NX74 (2026-05-19) — operator policy: PPTX must NOT mention AI usage
// anywhere. Replaces the prior amber "⚠ AI-Assisted Synthesis (provider:
// gpt-5.4...) — REQUIRES HUMAN REVIEW" banner with a no-op. Existing call
// sites stay in place; the function just renders nothing. Same treatment
// for the attribution footer (was leaking model name + raw provider error
// JSON on auto-failover paths).
const renderAiDisclosureBanner = (_pptx, _slide, _providerLabel, _fallbackReason) => {
  // No-op. The deck does not surface AI usage per operator policy.
};

const renderAttributionFooter = (slide, _narrative, generatedAt) => {
  // PR-NX74: keep only the generation date as a quiet footer. No provider
  // name, no confidence label, no auto-failover JSON.
  slide.addText(`Generated ${formatDate(generatedAt)}`, {
    x: 0.5, y: 6.78, w: 12.33, h: 0.18,
    fontFace: FONT, fontSize: 8, italic: true, color: COLORS.muted,
  });
};

// Helper: render an "unavailable" panel when the narrative didn't fire.
// The raw `reason` is DELIBERATELY not rendered: it carries provider names,
// HTTP statuses, and env-var hints (e.g. "Claude 429 …", "need
// ANTHROPIC_API_KEY") — operator diagnostics that belong in logs and the
// admin AI-usage dashboard, never on a customer slide (the PPTX policy is
// zero AI/provider mentions anywhere).
const renderUnavailablePanel = (slide, slideTitle, _reason) => {
  slide.addText('Synthesis Unavailable', {
    x: 0.5, y: 2.0, w: 12.33, h: 0.4,
    fontFace: FONT, fontSize: 18, bold: true, color: COLORS.muted, align: 'center',
  });
  slide.addText(
    `The ${slideTitle} could not be generated for this export run. The structured tables on the adjacent slide remain authoritative.`,
    {
      x: 1.5, y: 2.6, w: 10.33, h: 1.0,
      fontFace: FONT, fontSize: 11, italic: true, color: COLORS.muted, align: 'center', valign: 'top',
    },
  );
};

/**
 * PR-NX54: Risk Profile Synthesis slide — Claude-synthesized 2-paragraph
 * narrative (summary + critical spotlight) above the structured risks
 * already shown on the Risks & Mitigants slide.
 *
 * Mirrors the DOCX Risk Register narrative section (PR-NX43).
 * Always-available — when narrative is null we render the unavailable
 * panel so the deck never breaks.
 */
const renderRiskNarrative = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(
    pptx, slide, context,
    'Risk Profile Synthesis',
    pageNumber, totalSlides,
    `${context.assetClassLabel} | Interpretation of the risk register`,
  );

  const narrative = context.exportContext?.risks?.narrative || null;
  const providerLabel = narrative?.provider || null;
  renderAiDisclosureBanner(pptx, slide, providerLabel, narrative?.fallbackReason);

  if (!narrative || narrative.available === false) {
    renderUnavailablePanel(slide, 'risk profile synthesis', narrative?.reason);
    renderAttributionFooter(slide, narrative, context.generatedAt);
    return;
  }

  // Two-card grid: Summary paragraph (top) + Critical-spotlight (bottom)
  const summary = narrative.summary_paragraph || 'No summary paragraph synthesized.';
  const spotlight = narrative.critical_spotlight_paragraph || 'No critical/high-severity risks logged.';

  // Summary card
  slide.addText('SUMMARY', {
    x: 0.5, y: 1.65, w: 6.0, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 1.92, w: 12.33, h: 1.95,
    fill: { color: COLORS.paper },
    line: { color: COLORS.hairline || 'D7DDE5', pt: 0.5 },
  });
  slide.addText(summary, {
    x: 0.70, y: 2.02, w: 11.93, h: 1.75,
    fontFace: FONT, fontSize: 12, color: COLORS.charcoal, valign: 'top',
    paraSpaceBefore: 0, paraSpaceAfter: 0,
  });

  // Critical-spotlight card
  slide.addText('CRITICAL / HIGH-SEVERITY SPOTLIGHT', {
    x: 0.5, y: 4.02, w: 12.0, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 4.30, w: 12.33, h: 2.3,
    fill: { color: COLORS.paper },
    line: { color: COLORS.crimson || 'B23A48', pt: 1.5 },
  });
  slide.addText(spotlight, {
    x: 0.70, y: 4.40, w: 11.93, h: 2.10,
    fontFace: FONT, fontSize: 12, color: COLORS.charcoal, valign: 'top',
    paraSpaceBefore: 0, paraSpaceAfter: 0,
  });

  renderAttributionFooter(slide, narrative, context.generatedAt);
};

/**
 * PR-NX54: Sensitivity Analysis Narrative slide — OpenAI-synthesized
 * 2-paragraph driver decomposition + recommended stress tests, above
 * the cash-flow / sensitivity tornado already shown.
 *
 * Mirrors the DOCX Sensitivity narrative section (PR-NX44).
 */
const renderSensitivityNarrative = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(
    pptx, slide, context,
    'Sensitivity Analysis · Narrative',
    pageNumber, totalSlides,
    `${context.assetClassLabel} | Driver decomposition + recommended stress tests`,
  );

  const narrative = context.exportContext?.sensitivityNarrative || null;
  const providerLabel = narrative?.provider || null;
  renderAiDisclosureBanner(pptx, slide, providerLabel, narrative?.fallbackReason);

  if (!narrative || narrative.available === false) {
    renderUnavailablePanel(slide, 'sensitivity narrative', narrative?.reason);
    renderAttributionFooter(slide, narrative, context.generatedAt);
    return;
  }

  // Dominant driver eyebrow (large, top of card area)
  if (narrative.dominant_driver) {
    slide.addText(`DOMINANT DRIVER: ${String(narrative.dominant_driver).toUpperCase()}`, {
      x: 0.5, y: 1.65, w: 12.33, h: 0.30,
      fontFace: FONT, fontSize: 11, bold: true, color: COLORS.plum || '6F1F4D', charSpace: 1.5,
    });
  }

  const decomp = narrative.driver_decomposition_paragraph || 'No driver decomposition synthesized.';
  const stress = narrative.stress_test_paragraph || 'No stress-test recommendations synthesized.';

  // Decomposition card
  slide.addText('DRIVER DECOMPOSITION', {
    x: 0.5, y: 2.05, w: 12.0, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 2.32, w: 12.33, h: 1.95,
    fill: { color: COLORS.paper },
    line: { color: COLORS.hairline || 'D7DDE5', pt: 0.5 },
  });
  slide.addText(decomp, {
    x: 0.70, y: 2.42, w: 11.93, h: 1.75,
    fontFace: FONT, fontSize: 12, color: COLORS.charcoal, valign: 'top',
    paraSpaceBefore: 0, paraSpaceAfter: 0,
  });

  // Recommended stress tests card
  slide.addText('RECOMMENDED STRESS TESTS', {
    x: 0.5, y: 4.42, w: 12.0, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 4.70, w: 12.33, h: 1.95,
    fill: { color: COLORS.paper },
    line: { color: COLORS.amber || 'C97B0E', pt: 1.0 },
  });
  slide.addText(stress, {
    x: 0.70, y: 4.80, w: 11.93, h: 1.75,
    fontFace: FONT, fontSize: 12, color: COLORS.charcoal, valign: 'top',
    paraSpaceBefore: 0, paraSpaceAfter: 0,
  });

  renderAttributionFooter(slide, narrative, context.generatedAt);
};

/**
 * PR-NX54: Document-Derived Insights slide — Claude-synthesized
 * summary paragraph + 0-5 cross-document inconsistency findings,
 * each with severity-coloured tag + description + recommendation.
 *
 * Mirrors the DOCX Document-Derived Insights section (PR-NX45).
 */
const FINDING_SEVERITY_COLOR = {
  critical: COLORS.crimson || 'B23A48',
  high:     COLORS.amber || 'C97B0E',
  medium:   COLORS.muted || '6B7280',
  low:      COLORS.muted || '6B7280',
};

const renderDocumentInsights = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(
    pptx, slide, context,
    'Document-Derived Insights',
    pageNumber, totalSlides,
    `${context.assetClassLabel} | Cross-document analysis + inconsistency findings`,
  );

  const insights = context.exportContext?.documents?.insights || null;
  const providerLabel = insights?.provider || null;
  renderAiDisclosureBanner(pptx, slide, providerLabel, insights?.fallbackReason);

  if (!insights || insights.available === false) {
    renderUnavailablePanel(slide, 'document-derived insights', insights?.reason);
    renderAttributionFooter(slide, insights, context.generatedAt);
    return;
  }

  // Summary paragraph (top card)
  const summary = insights.summary_paragraph || 'No summary paragraph synthesized.';
  slide.addText('CROSS-DOCUMENT SUMMARY', {
    x: 0.5, y: 1.65, w: 12.0, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 1.92, w: 12.33, h: 1.4,
    fill: { color: COLORS.paper },
    line: { color: COLORS.hairline || 'D7DDE5', pt: 0.5 },
  });
  slide.addText(summary, {
    x: 0.70, y: 2.02, w: 11.93, h: 1.20,
    fontFace: FONT, fontSize: 12, color: COLORS.charcoal, valign: 'top',
    paraSpaceBefore: 0, paraSpaceAfter: 0,
  });

  // Findings (bottom — list of up to 4 severity-coloured cards)
  const findings = Array.isArray(insights.findings) ? insights.findings : [];
  const sortedFindings = [...findings].sort((a, b) => {
    const rankA = { critical: 1, high: 2, medium: 3, low: 4 }[a.severity] || 99;
    const rankB = { critical: 1, high: 2, medium: 3, low: 4 }[b.severity] || 99;
    return rankA - rankB;
  });

  slide.addText(`INCONSISTENCY FINDINGS (${sortedFindings.length})`, {
    x: 0.5, y: 3.45, w: 12.0, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });

  if (sortedFindings.length === 0) {
    // Positive-signal panel
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.5, y: 3.75, w: 12.33, h: 0.6,
      fill: { color: 'ECFDF5' },
      line: { color: '047857', pt: 0.5 },
    });
    slide.addText('✓  No inconsistencies detected across the extracted document set — a positive signal.', {
      x: 0.70, y: 3.82, w: 11.93, h: 0.46,
      fontFace: FONT, fontSize: 11, italic: true, color: '047857', valign: 'mid',
    });
  } else {
    // Up to 4 finding cards, stacked vertically
    const visible = sortedFindings.slice(0, 4);
    const cardHeight = (6.55 - 3.75) / visible.length - 0.10;
    visible.forEach((finding, idx) => {
      const yOffset = 3.75 + idx * (cardHeight + 0.10);
      const sevColor = FINDING_SEVERITY_COLOR[finding.severity] || COLORS.muted;
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.5, y: yOffset, w: 12.33, h: cardHeight,
        fill: { color: COLORS.paper },
        line: { color: sevColor, pt: 1.0 },
      });
      // Severity tag + title (single text line)
      slide.addText([
        { text: `[${String(finding.severity || 'medium').toUpperCase()}]  `, options: { color: sevColor, bold: true, fontSize: 11, fontFace: FONT } },
        { text: finding.title || '(untitled)', options: { color: COLORS.charcoal, bold: true, fontSize: 11, fontFace: FONT } },
      ], {
        x: 0.70, y: yOffset + 0.10, w: 11.93, h: 0.28,
      });
      // Description + recommendation (single combined text)
      const body = [
        finding.description || '',
        finding.recommendation ? `Recommended: ${finding.recommendation}` : '',
      ].filter(Boolean).join('  ');
      slide.addText(body, {
        x: 0.70, y: yOffset + 0.38, w: 11.93, h: cardHeight - 0.48,
        fontFace: FONT, fontSize: 9, color: COLORS.muted, valign: 'top', fit: 'shrink',
      });
    });
  }

  renderAttributionFooter(slide, insights, context.generatedAt);
};

module.exports = {
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
  renderRentRoll,
  renderReadiness,
  renderFinancialOverview,
  renderCashFlowSensitivity,
  renderTransactionSummary,
  renderRisksMitigants,
  renderNextSteps,
  renderProsCons,
  renderKeyAssumptions,
  renderDisclaimer,
  // PR-NX54 (2026-05-19) — 3 new AI narrative slides
  renderRiskNarrative,
  renderSensitivityNarrative,
  renderDocumentInsights,
};
