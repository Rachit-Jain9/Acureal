'use strict';

/**
 * pptxgenjs render primitives — slide-level building blocks shared across
 * every renderXxx function. Sets defaults, draws the top header, builds
 * cards / KPI tiles / bullet lists / tables, paints section dividers.
 *
 * Extracted from the original dealPptx.service.js as part of the Bet 3
 * god-service decomposition.
 */

const { COLORS, FONT, truncate, formatDate } = require('./_helpers');

const setSlideDefaults = (slide) => {
  slide.background = { color: COLORS.paper };
};

const addTopHeader = (pptx, slide, context, title, pageNumber, totalSlides, subtitle = '') => {
  setSlideDefaults(slide);
  slide.addText(context.brandName, {
    x: 0.45, y: 0.28, w: 1.4, h: 0.18,
    fontFace: FONT, fontSize: 8, bold: true, color: COLORS.plum, charSpace: 1.5,
  });
  slide.addText(title, {
    x: 0.45, y: 0.52, w: 8.6, h: 0.4,
    fontFace: FONT, fontSize: 22, bold: true, color: COLORS.charcoal,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 8.85, y: 0.3, w: 3.95, h: 0.2,
      fontFace: FONT, fontSize: 8, color: COLORS.muted, align: 'right',
    });
  }
  slide.addText(`${pageNumber} / ${totalSlides}`, {
    x: 12.1, y: 0.58, w: 0.7, h: 0.16,
    fontFace: FONT, fontSize: 8, color: COLORS.plum, align: 'right',
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.45, y: 0.98, w: 12.35, h: 0,
    line: { color: COLORS.sandDeep, pt: 1 },
  });
  slide.addText(`Generated ${formatDate(context.generatedAt)} | ${context.brandName}`, {
    x: 0.45, y: 7.05, w: 4.6, h: 0.14,
    fontFace: FONT, fontSize: 7, color: COLORS.muted,
  });
};

const addCard = (pptx, slide, config) => {
  slide.addShape(pptx.ShapeType.rect, {
    x: config.x,
    y: config.y,
    w: config.w,
    h: config.h,
    fill: { color: config.fill || COLORS.white },
    line: { color: config.line || COLORS.line, pt: 0.8 },
  });
  if (config.bandColor) {
    slide.addShape(pptx.ShapeType.rect, {
      x: config.x,
      y: config.y,
      w: config.w,
      h: 0.08,
      fill: { color: config.bandColor },
      line: { color: config.bandColor, pt: 0.1 },
    });
  }
};

const addKpiCard = (pptx, slide, { x, y, w, h, label, value, tone = COLORS.plum, note = '' }) => {
  addCard(pptx, slide, { x, y, w, h, bandColor: tone });
  slide.addText(value || 'N/A', {
    x: x + 0.16, y: y + 0.26, w: w - 0.32, h: 0.34,
    fontFace: FONT, fontSize: 16, bold: true, color: COLORS.charcoal, align: 'center', fit: 'shrink',
  });
  slide.addText(label, {
    x: x + 0.16, y: y + h - 0.34, w: w - 0.32, h: 0.16,
    fontFace: FONT, fontSize: 8, color: COLORS.muted, align: 'center',
  });
  if (note) {
    slide.addText(note, {
      x: x + 0.16, y: y + 0.64, w: w - 0.32, h: 0.16,
      fontFace: FONT, fontSize: 7, color: COLORS.muted, align: 'center', fit: 'shrink',
    });
  }
};

const addBulletList = (slide, items, { x, y, w, h, fontSize = 11, color = COLORS.charcoal, bulletColor = COLORS.plum }) => {
  const totalItems = items.length || 1;
  const rowHeight = h / totalItems;
  items.forEach((item, index) => {
    const top = y + index * rowHeight;
    slide.addShape('ellipse', {
      x,
      y: top + 0.05,
      w: 0.12,
      h: 0.12,
      fill: { color: bulletColor },
      line: { color: bulletColor, pt: 0.1 },
    });
    slide.addText(item, {
      x: x + 0.22,
      y: top,
      w: w - 0.22,
      h: Math.max(0.28, rowHeight - 0.04),
      fontFace: FONT,
      fontSize,
      color,
      fit: 'shrink',
      valign: 'mid',
      margin: 0,
    });
  });
};

const addTable = (slide, rows, options) => {
  slide.addTable(rows, {
    fontFace: FONT,
    fontSize: options.fontSize || 9,
    color: COLORS.charcoal,
    border: { type: 'solid', color: COLORS.line, pt: 0.6 },
    fill: COLORS.white,
    x: options.x,
    y: options.y,
    w: options.w,
    h: options.h,
    rowH: options.rowH,
    colW: options.colW,
    margin: options.margin || 0.06,
    valign: 'mid',
  });
};

const addSectionDivider = (pptx, slide, context, title, subtitle, pageNumber, totalSlides) => {
  setSlideDefaults(slide);
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 13.33, h: 7.5,
    fill: { color: COLORS.paper },
    line: { color: COLORS.paper, pt: 0.1 },
  });

  for (let idx = 0; idx < 8; idx += 1) {
    slide.addShape(pptx.ShapeType.line, {
      x: 7 + (idx * 0.72),
      y: 0.55,
      w: 0,
      h: 6.2,
      line: { color: idx % 2 === 0 ? COLORS.cloud : COLORS.line, pt: 0.4 },
    });
  }

  for (let idx = 0; idx < 7; idx += 1) {
    slide.addShape(pptx.ShapeType.line, {
      x: 6.9,
      y: 0.8 + (idx * 0.8),
      w: 5.8,
      h: 0,
      line: { color: idx % 2 === 0 ? COLORS.cloud : COLORS.line, pt: 0.4 },
    });
  }

  slide.addShape(pptx.ShapeType.ellipse, {
    x: 9.3, y: 2.1, w: 2.1, h: 2.1,
    fill: { color: 'F6EFE6', transparency: 65 },
    line: { color: COLORS.sandDeep, pt: 1.2, transparency: 25 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 9.8, y: 2.6, w: 1.1, h: 1.1,
    fill: { color: COLORS.plum, transparency: 10 },
    line: { color: COLORS.plum, pt: 0.8 },
  });

  slide.addShape(pptx.ShapeType.rect, {
    x: 0.8, y: 1.45, w: 4.9, h: 3.55,
    fill: { color: COLORS.sand },
    line: { color: COLORS.sandDeep, pt: 0.1 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.8, y: 1.45, w: 0.22, h: 3.55,
    fill: { color: COLORS.plum },
    line: { color: COLORS.plum, pt: 0.1 },
  });
  slide.addText(title, {
    x: 1.2, y: 2.05, w: 4.1, h: 0.82,
    fontFace: FONT, fontSize: 26, bold: true, color: COLORS.charcoal, fit: 'shrink',
  });
  slide.addText(subtitle, {
    x: 1.2, y: 3.22, w: 4.0, h: 0.56,
    fontFace: FONT, fontSize: 11, color: COLORS.charcoal, fit: 'shrink',
  });
  slide.addText(context.locationLine, {
    x: 1.2, y: 4.32, w: 4.1, h: 0.22,
    fontFace: FONT, fontSize: 8, color: COLORS.plum, bold: true, charSpace: 0.8,
  });
  slide.addText(`${pageNumber} / ${totalSlides}`, {
    x: 12.1, y: 7.05, w: 0.7, h: 0.16,
    fontFace: FONT, fontSize: 8, color: COLORS.plum, align: 'right',
  });
};


/**
 * Embed a PNG / JPG / SVG-data-URI image (e.g. Mapbox static map, score
 * gauge, QR code, server-rendered chart). Caller has already produced the
 * buffer or data URI; this wrapper handles the framing card + alt text.
 *
 * Pass `data` as a `data:image/...;base64,...` URI OR `path` as an absolute
 * file path. pptxgenjs prefers `data` for our use case (we have buffers,
 * not files on disk).
 */
const addChartImage = (slide, { x, y, w, h, data, path, alt = 'Chart', framed = true }) => {
  if (!data && !path) return;
  if (framed) {
    slide.addShape('rect', {
      x, y, w, h,
      fill: { color: COLORS.white },
      line: { color: COLORS.line, pt: 0.6 },
    });
  }
  slide.addImage({
    x: x + (framed ? 0.08 : 0),
    y: y + (framed ? 0.08 : 0),
    w: w - (framed ? 0.16 : 0),
    h: h - (framed ? 0.16 : 0),
    data,
    path,
    altText: alt,
    sizing: { type: 'contain', w: w - (framed ? 0.16 : 0), h: h - (framed ? 0.16 : 0) },
  });
};

const addMapImage = (slide, { x, y, w, h, buffer, alt = 'Site map' }) => {
  if (!buffer) return;
  const data = `data:image/png;base64,${buffer.toString('base64')}`;
  addChartImage(slide, { x, y, w, h, data, alt, framed: true });
};

const addQrCode = (slide, { x, y, size, dataUri, alt = 'Live deal QR code' }) => {
  if (!dataUri) return;
  slide.addImage({ x, y, w: size, h: size, data: dataUri, altText: alt });
};

const addScoreGauge = (slide, { x, y, w, h, dataUri, alt = 'Composite score gauge' }) => {
  if (!dataUri) return;
  // No frame around the gauge — its own SVG already includes the background.
  slide.addImage({ x, y, w, h, data: dataUri, altText: alt });
};

/**
 * Two-column Pros / Cons block.
 *
 *   ✓ pro one             ✗ con one
 *   ✓ pro two             ✗ con two
 *   …                     …
 *
 * Bullets use ASCII tick / cross — no decorative emojis (CLAUDE.md rule).
 */
const addProsConsColumns = (slide, { x, y, w, h, pros = [], cons = [] }) => {
  const colGap = 0.36;
  const colW = (w - colGap) / 2;
  const headerH = 0.32;
  const palette = require('../shared/palette');
  const positive = palette.pptx('dataPositive');
  const negative = palette.pptx('dataNegative');

  slide.addText('Pros', {
    x, y, w: colW, h: headerH,
    fontFace: FONT, fontSize: 11, bold: true, color: positive,
    charSpace: 1.2,
  });
  slide.addText('Cons', {
    x: x + colW + colGap, y, w: colW, h: headerH,
    fontFace: FONT, fontSize: 11, bold: true, color: negative,
    charSpace: 1.2,
  });

  const listY = y + headerH;
  const listH = h - headerH;
  const renderColumn = (items, marker, markerColor, colX) => {
    if (!items.length) {
      slide.addText('Not enough data to populate this column.', {
        x: colX, y: listY, w: colW, h: listH,
        fontFace: FONT, fontSize: 9, italic: true, color: COLORS.muted,
      });
      return;
    }
    const rowH = Math.max(0.34, Math.min(0.52, listH / Math.max(items.length, 1)));
    items.forEach((item, idx) => {
      const top = listY + idx * rowH;
      slide.addText(marker, {
        x: colX, y: top + 0.04, w: 0.22, h: rowH - 0.08,
        fontFace: FONT, fontSize: 12, bold: true, color: markerColor, align: 'left',
      });
      slide.addText(item, {
        x: colX + 0.24, y: top, w: colW - 0.24, h: rowH,
        fontFace: FONT, fontSize: 10, color: COLORS.charcoal,
        valign: 'mid', fit: 'shrink', margin: 0.02,
      });
    });
  };

  renderColumn(pros, '+', positive, x);
  renderColumn(cons, '−', negative, x + colW + colGap);
};

/**
 * Native pptxgenjs chart wrapper. Caller passes a pre-built spec
 * `{ type, data, opts }`. We add a framing card + the chart object.
 *
 * Use this for charts the viewer should be able to edit in PowerPoint —
 * cash-flow bars, sensitivity heatmap, sources/uses doughnut. For richer
 * but read-only visuals (tornado, scatter), use `addChartImage` with a
 * pre-rendered SVG/PNG.
 */
const addNativeChart = (pptx, slide, { x, y, w, h, type, data, opts = {} }) => {
  if (!type || !Array.isArray(data) || data.length === 0) return;
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w, h,
    fill: { color: COLORS.white },
    line: { color: COLORS.line, pt: 0.6 },
  });
  slide.addChart(type, data, {
    x: x + 0.16,
    y: y + 0.16,
    w: w - 0.32,
    h: h - 0.32,
    showLegend: true,
    legendPos: 'b',
    legendFontSize: 8,
    legendColor: COLORS.muted,
    chartColors: [COLORS.plum, COLORS.green, COLORS.amber, COLORS.blue, COLORS.plumSoft],
    catAxisLabelColor: COLORS.muted,
    catAxisLabelFontSize: 8,
    valAxisLabelColor: COLORS.muted,
    valAxisLabelFontSize: 8,
    border: { pt: 0, color: COLORS.line },
    plotArea: { fill: { color: COLORS.white } },
    showTitle: false,
    ...opts,
  });
};

module.exports = {
  setSlideDefaults,
  addTopHeader,
  addCard,
  addKpiCard,
  addBulletList,
  addTable,
  addSectionDivider,
  addChartImage,
  addMapImage,
  addQrCode,
  addScoreGauge,
  addProsConsColumns,
  addNativeChart,
};
