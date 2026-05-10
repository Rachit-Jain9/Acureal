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

  for (let idx = 0; idx < 11; idx += 1) {
    slide.addShape(pptx.ShapeType.line, {
      x: 6.95 + idx * 0.55,
      y: 0.6,
      w: 0,
      h: 6.05,
      line: { color: idx % 2 === 0 ? COLORS.cloud : COLORS.line, pt: 0.4 },
    });
  }
  for (let idx = 0; idx < 8; idx += 1) {
    slide.addShape(pptx.ShapeType.line, {
      x: 6.75,
      y: 0.85 + idx * 0.78,
      w: 5.8,
      h: 0,
      line: { color: idx % 2 === 0 ? COLORS.cloud : COLORS.line, pt: 0.4 },
    });
  }
  // Score gauge replaces the decorative ellipse pair when a precomputed
  // gauge is available (PR2 onwards). Falls back to the legacy decorative
  // ellipses for back-compat with deck contexts that haven't been
  // pre-enriched yet (e.g. unit tests that drive buildDeckContext directly).
  if (context.precomputed?.scoreGaugeDataUri) {
    addScoreGauge(slide, {
      x: 8.7, y: 1.55, w: 3.7, h: 2.6,
      dataUri: context.precomputed.scoreGaugeDataUri,
      alt: 'Composite deal score (0-100)',
    });
  } else {
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 9.15, y: 2.0, w: 2.55, h: 2.55,
      fill: { color: 'F6EFE6', transparency: 68 },
      line: { color: COLORS.sandDeep, pt: 1.3, transparency: 25 },
    });
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 9.93, y: 2.78, w: 0.98, h: 0.98,
      fill: { color: COLORS.plum },
      line: { color: COLORS.plum, pt: 0.2 },
    });
  }

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

const renderContents = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Contents', pageNumber, totalSlides, `${context.assetClassLabel} | ${context.locationLine}`);

  addCard(pptx, slide, { x: 0.55, y: 1.3, w: 6.05, h: 5.2, bandColor: COLORS.plum });
  slide.addText('Deck Architecture', {
    x: 0.78, y: 1.52, w: 2.3, h: 0.2,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });

  const groups = [];
  let currentGroup = null;
  context.slideManifest.forEach((slideDef) => {
    if (slideDef.key.startsWith('divider')) {
      currentGroup = { title: slideDef.title, items: [] };
      groups.push(currentGroup);
      return;
    }
    if (!currentGroup) {
      currentGroup = { title: 'Deck Overview', items: [] };
      groups.push(currentGroup);
    }
    if (slideDef.key !== 'cover' && slideDef.key !== 'contents' && slideDef.key !== 'disclaimer') {
      currentGroup.items.push(slideDef.title);
    }
  });

  groups.slice(0, 4).forEach((group, index) => {
    const y = 1.95 + index * 1.17;
    slide.addText(group.title, {
      x: 0.82, y, w: 2.0, h: 0.18,
      fontFace: FONT, fontSize: 10, bold: true, color: COLORS.plum,
    });
    slide.addText(group.items.slice(0, 3).join(' | '), {
      x: 2.1, y: y - 0.01, w: 4.1, h: 0.28,
      fontFace: FONT, fontSize: 9, color: COLORS.charcoal, fit: 'shrink',
    });
  });

  addCard(pptx, slide, {
    x: 6.95,
    y: 1.3,
    w: 5.83,
    h: 5.2,
    bandColor: COLORS.sandDeep,
    fill: COLORS.white,
  });
  slide.addText('Current Decision Frame', {
    x: 7.22, y: 1.52, w: 2.6, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  addBulletList(slide, [
    `${context.dealTypeLabel} opportunity in ${context.locationLine}.`,
    context.recommendations?.label
      ? `Current underwriting call: ${context.recommendations.label}.`
      : 'Current underwriting call is not yet stored.',
    context.readiness.readiness_pct != null
      ? context.approvalSummary.required
        ? `Readiness stands at ${context.readiness.readiness_pct}%, with ${context.approvalSummary.validated || 0}/${context.approvalSummary.required || 0} required approvals validated.`
        : `Readiness stands at ${context.readiness.readiness_pct}%, and required approvals have not yet been fully tagged in REDIP.`
      : 'Readiness inputs are not yet complete.',
    context.structureMismatch
      ? 'Commercial form needs confirmation because the stored deal type and structure do not align.'
      : `Deck covers ${totalSlides - 2} working slides across opportunity, market, asset, and transaction considerations.`,
  ], {
    x: 7.22,
    y: 1.95,
    w: 5.0,
    h: 2.25,
    fontSize: 9.5,
    bulletColor: COLORS.sandDeep,
  });
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

  cards.forEach((card, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 0.55 + col * 6.18;
    const y = 1.32 + row * 1.72;
    addCard(pptx, slide, {
      x,
      y,
      w: 5.95,
      h: 1.42,
      bandColor: row % 2 === 0 ? COLORS.plum : COLORS.sandDeep,
      fill: row % 2 === 0 ? COLORS.white : COLORS.mist,
    });
    slide.addText(card.title, {
      x: x + 0.22, y: y + 0.22, w: 5.2, h: 0.18,
      fontFace: FONT, fontSize: 11, bold: true, color: COLORS.charcoal,
    });
    slide.addText(card.detail, {
      x: x + 0.22, y: y + 0.52, w: 5.35, h: 0.58,
      fontFace: FONT, fontSize: 9.5, color: COLORS.charcoal, fit: 'shrink',
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

  if (benchmarkSeries.length >= 2) {
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

  addCard(pptx, slide, { x: 6.95, y: 1.3, w: 5.83, h: 5.2, bandColor: COLORS.sandDeep, fill: COLORS.white });
  slide.addText('Market Read-Through', {
    x: 7.22, y: 1.54, w: 2.4, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  addBulletList(slide, context.marketObservations, {
    x: 7.22,
    y: 1.95,
    w: 5.0,
    h: 1.3,
    fontSize: 9.5,
    bulletColor: COLORS.sandDeep,
  });
};

const renderLocationContext = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(pptx, slide, context, 'Location & Site Context', pageNumber, totalSlides, `${context.locationLine}`);

  addCard(pptx, slide, { x: 0.55, y: 1.25, w: 5.7, h: 5.55, bandColor: COLORS.plum, fill: COLORS.mist });
  for (let idx = 0; idx < 7; idx += 1) {
    slide.addShape(pptx.ShapeType.line, {
      x: 0.95 + idx * 0.7,
      y: 1.65,
      w: 0,
      h: 4.5,
      line: { color: COLORS.line, pt: 0.4 },
    });
  }
  for (let idx = 0; idx < 6; idx += 1) {
    slide.addShape(pptx.ShapeType.line, {
      x: 0.88,
      y: 1.9 + idx * 0.72,
      w: 4.95,
      h: 0,
      line: { color: COLORS.line, pt: 0.4 },
    });
  }
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 2.42, y: 2.68, w: 1.7, h: 1.7,
    fill: { color: 'F5EBE2', transparency: 30 },
    line: { color: COLORS.sandDeep, pt: 1.1 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 2.97, y: 3.23, w: 0.6, h: 0.6,
    fill: { color: COLORS.plum },
    line: { color: COLORS.plum, pt: 0.2 },
  });
  slide.addText('Site Pin', {
    x: 2.73, y: 4.6, w: 1.15, h: 0.16,
    fontFace: FONT, fontSize: 8, bold: true, color: COLORS.plum, align: 'center',
  });
  slide.addText(context.coordinates || 'Coordinates not provided', {
    x: 1.1, y: 5.3, w: 4.55, h: 0.24,
    fontFace: FONT, fontSize: 9, color: COLORS.charcoal, align: 'center',
  });

  addCard(pptx, slide, { x: 6.55, y: 1.25, w: 6.23, h: 5.55, bandColor: COLORS.sandDeep });
  slide.addText('Known Site Facts', {
    x: 6.82, y: 1.48, w: 2.4, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  context.locationRows.slice(0, 8).forEach((row, index) => {
    const y = 1.9 + index * 0.49;
    slide.addText(row.label, {
      x: 6.82, y, w: 1.6, h: 0.16,
      fontFace: FONT, fontSize: 8.5, color: COLORS.muted,
    });
    slide.addText(row.value, {
      x: 8.6, y: y - 0.01, w: 3.8, h: 0.2,
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

  addCard(pptx, slide, {
    x: 6.95,
    y: 2.55,
    w: 5.83,
    h: 3.6,
    bandColor: COLORS.sandDeep,
    fill: COLORS.white,
  });
  slide.addText('Underwriting Read-Through', {
    x: 7.22, y: 2.78, w: 2.8, h: 0.18,
    fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
  });
  addBulletList(slide, context.financialCommentary, {
    x: 7.22,
    y: 3.18,
    w: 5.05,
    h: 2.35,
    fontSize: 9.4,
    bulletColor: COLORS.sandDeep,
  });
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
    slide.addChart(pptx.ChartType.bar, [{
      name: 'Net cash flow',
      labels: context.cashRows.map((row, index) => truncate(row.label || `P${index + 1}`, 12)),
      values: context.cashRows.map((row) => num(row.net) || 0),
    }], {
      x: 0.55, y: 1.3, w: 6.4, h: 3.55,
      barDir: 'col',
      chartColors: [COLORS.plum],
      showValue: true,
      dataLabelFontSize: 8,
      catAxisLabelFontSize: 8,
      valAxisLabelFontSize: 8,
      legendPos: 'none',
      title: 'Modeled Net Cash Flow',
      titleFontFace: FONT,
      titleFontSize: 10,
    });
  }

  const hasSensitivity = Array.isArray(context.sensitivityMatrix?.irrGrid) && context.sensitivityMatrix.irrGrid.length > 0;
  if (hasSensitivity) {
    const sensitivityRows = [
      [
        { text: 'Cost \\ Price', options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum } } },
        ...context.sensitivityMatrix.sellingRates.slice(0, 5).map((value) => ({
          text: formatNumber(value, 0) || 'N/A',
          options: { bold: true, color: COLORS.white, fill: { color: COLORS.plum }, align: 'center', fontSize: 7.5 },
        })),
      ],
      ...context.sensitivityMatrix.irrGrid.slice(0, 5).map((row, rowIndex) => [
        { text: formatNumber(context.sensitivityMatrix.constructionCosts[rowIndex], 0) || 'N/A', options: { bold: true, fill: { color: COLORS.mist }, fontSize: 7.5 } },
        ...row.slice(0, 5).map((value) => ({
          text: value != null ? `${formatNumber(value, 1)}%` : 'N/A',
          options: { align: 'center', fill: { color: getHeatFill(value) }, fontSize: 7.5 },
        })),
      ]),
    ];
    addTable(slide, sensitivityRows, {
      x: 7.2,
      y: 1.3,
      w: 5.58,
      colW: [1.3, 0.86, 0.86, 0.86, 0.86, 0.84],
      rowH: 0.42,
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
    h: 2.1,
    fontSize: 9.4,
    bulletColor: context.recommendations.tone === 'negative' ? COLORS.red : COLORS.sandDeep,
  });
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
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.8, y: 1.05, w: 11.73, h: 5.35,
    fill: { color: COLORS.mist },
    line: { color: COLORS.sandDeep, pt: 1 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.8, y: 1.05, w: 0.26, h: 5.35,
    fill: { color: COLORS.plum },
    line: { color: COLORS.plum, pt: 0.1 },
  });
  slide.addText('Disclaimer', {
    x: 1.28, y: 1.62, w: 2.4, h: 0.28,
    fontFace: FONT, fontSize: 24, bold: true, color: COLORS.charcoal,
  });
  slide.addText(`${context.brandName} | Generated for ${context.generatedFor} | ${formatDate(context.generatedAt)} | ${pageNumber} / ${totalSlides}`, {
    x: 1.28, y: 5.82, w: 10.5, h: 0.16,
    fontFace: FONT, fontSize: 8, color: COLORS.muted, align: 'center',
  });
};


// Planning Context slide — surfaces RMP 2031 city-level callouts (SDZ
// corridors, NGT drain buffers, heritage zones, Peripheral Ring Road)
// inside the IC deck so reviewers see the planning constraints without
// having to flip to the admin terminal. Layout:
//   - Top half: 2-column commentary card (narrative bullets)
//   - Bottom half: 4-up callout grid, one tile per RMP fact category
const renderPlanningContext = (pptx, slide, context, pageNumber, totalSlides) => {
  addTopHeader(
    pptx, slide, context,
    'Planning Context — RMP 2031',
    pageNumber, totalSlides,
    `${context.deal.city || 'Bengaluru'} | verified land-use facts`,
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
    slide.addText('No verified RMP 2031 callouts ingested yet.', {
      x: 0.85, y: 3.55, w: 11.6, h: 0.3,
      fontFace: FONT, fontSize: 12, bold: true, color: COLORS.charcoal,
    });
    slide.addText('Once the Existing Land Use 2015 + Proposed Land Use 2031 maps and Volume 4 PDR have been ingested, this slide auto-populates with SDZ corridors, NGT drain buffers, heritage radii, and the Peripheral Ring Road alignment — every one page-cited and reviewer-approved.', {
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
  const aiUsed = prosCons.available && (aiPros.length || aiCons.length);
  slide.addText(
    aiUsed
      ? 'AI-assisted synthesis from stored deal data. Deterministic items fill any remaining slots. Verify all interpretations.'
      : 'Deterministic synthesis from stored deal data. AI commentary unavailable for this run.',
    {
      x: 0.85, y: 6.4, w: 11.65, h: 0.32,
      fontFace: FONT, fontSize: 8, italic: true, color: COLORS.muted,
    },
  );
};

module.exports = {
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
};
