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

/**
 * Render a bullet list inside a bounded rect.
 *
 * Each item gets a fixed-ish row anchored to the TOP of its slot, so the
 * bullet marker and the first line of text align horizontally. Earlier
 * revision used `valign: 'mid'` which produced a "bullet at top, text
 * floating at bottom" look on cards with few items (the row stretched to
 * fill the card). Caller still controls the bounding `h`; if items don't
 * fill it, the empty space is at the bottom — the way bullet lists read
 * everywhere else.
 *
 * `gap` (optional, default 0.06") gives small breathing room between
 * items. `lineH` (optional) overrides the per-row height; when omitted
 * we use a sensible default scaled from the font size and capped so a
 * single-item list doesn't stretch into one massive empty row.
 */
const addBulletList = (slide, items, { x, y, w, h, fontSize = 11, color = COLORS.charcoal, bulletColor = COLORS.plum, gap = 0.06, lineH }) => {
  const totalItems = items.length || 1;
  // Scale from font size — typical line-height ratio ~1.4, plus a touch
  // for two-line items. Capped at 0.9" so a 3" tall card with one item
  // doesn't end up with a single 3" tall row.
  const desired = lineH != null ? lineH : Math.max(0.32, Math.min(0.9, (fontSize / 72) * 1.6 * 2));
  const rowHeight = Math.min(desired, h / totalItems);
  items.forEach((item, index) => {
    const top = y + index * rowHeight;
    // Bullet baseline-aligned with first line of text — small offset down
    // from the row top so it sits with the cap-height of the type.
    slide.addShape('ellipse', {
      x,
      y: top + (fontSize / 72) * 0.45,
      w: 0.11,
      h: 0.11,
      fill: { color: bulletColor },
      line: { color: bulletColor, pt: 0.1 },
    });
    slide.addText(item, {
      x: x + 0.22,
      y: top,
      w: w - 0.22,
      h: Math.max(0.28, rowHeight - gap),
      fontFace: FONT,
      fontSize,
      color,
      fit: 'shrink',
      valign: 'top',
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

/**
 * Section divider — typographic "chapter break" with a content-rich
 * right-panel preview of what's coming. No decorative ellipses or
 * orphan shapes. The right panel shows up to four label/value tiles
 * passed via `rightPanel.cards` so each divider previews real content
 * for that section instead of acting as filler.
 *
 * `eyebrow` (optional) — small uppercase label above the title (e.g.
 *   "Section 02"). Falls back to a numeric "0X / 0Y" when omitted.
 * `rightPanel` (optional) — `{ heading: string, cards: [{label, value, hint}], note: string }`.
 *   Heading appears above the tile grid; note appears beneath it.
 */
const addSectionDivider = (pptx, slide, context, title, subtitle, pageNumber, totalSlides, options = {}) => {
  setSlideDefaults(slide);
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 13.33, h: 7.5,
    fill: { color: COLORS.paper },
    line: { color: COLORS.paper, pt: 0.1 },
  });

  // ── Left half — typography panel ────────────────────────────────────────
  // Solid accent rule down the left edge instead of a sand fill behind the
  // title. Cleaner, less template-y; lets the warm paper background carry
  // the slide. Width 6.0" leaves the right panel plenty of room.
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 1.4, w: 0.08, h: 4.2,
    fill: { color: COLORS.plum },
    line: { color: COLORS.plum, pt: 0.1 },
  });

  // Plain digits — no zero-padding. "01 / 17" reads as a code; "1 / 17"
  // reads as page-of-pages, which is what the eyebrow is for.
  const sectionNumber = options.eyebrow
    || `${options.sectionIndex || pageNumber} / ${totalSlides}`;
  slide.addText(sectionNumber, {
    x: 0.78, y: 1.45, w: 5.5, h: 0.22,
    fontFace: FONT, fontSize: 10, bold: true, color: COLORS.plumSoft, charSpace: 2.4,
  });
  slide.addText(title, {
    x: 0.78, y: 1.85, w: 5.4, h: 1.6,
    fontFace: FONT, fontSize: 38, bold: true, color: COLORS.charcoal, fit: 'shrink',
  });
  slide.addText(subtitle, {
    x: 0.78, y: 3.55, w: 5.4, h: 0.64,
    fontFace: FONT, fontSize: 12, color: COLORS.muted, fit: 'shrink',
  });
  // Hairline separator under subtitle
  slide.addShape(pptx.ShapeType.line, {
    x: 0.78, y: 4.4, w: 1.2, h: 0,
    line: { color: COLORS.plumSoft, pt: 1.5 },
  });
  slide.addText(context.locationLine || `${context.brandName} · institutional opportunity`, {
    x: 0.78, y: 4.55, w: 5.4, h: 0.26,
    fontFace: FONT, fontSize: 9, color: COLORS.plum, bold: true, charSpace: 1.0,
  });

  // ── Right half — content preview panel ──────────────────────────────────
  // White card with a copper top band; up to 4 label/value tiles rendered
  // inside. Makes every divider an information-bearing slide instead of
  // pure decoration.
  const panelX = 7.05;
  const panelY = 1.4;
  const panelW = 5.78;
  const panelH = 5.55;
  slide.addShape(pptx.ShapeType.rect, {
    x: panelX, y: panelY, w: panelW, h: panelH,
    fill: { color: COLORS.white },
    line: { color: COLORS.line, pt: 0.6 },
  });
  // Copper band at top of the card
  slide.addShape(pptx.ShapeType.rect, {
    x: panelX, y: panelY, w: panelW, h: 0.06,
    fill: { color: COLORS.plumSoft },
    line: { color: COLORS.plumSoft, pt: 0.1 },
  });

  const rightPanel = options.rightPanel || {};
  const heading = rightPanel.heading || 'Section preview';
  slide.addText(heading.toUpperCase(), {
    x: panelX + 0.32, y: panelY + 0.32, w: panelW - 0.64, h: 0.22,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.muted, charSpace: 1.6,
  });

  const cards = Array.isArray(rightPanel.cards) ? rightPanel.cards.slice(0, 4) : [];
  if (cards.length === 0) {
    slide.addText(
      rightPanel.note || `What follows: a structured walkthrough of ${title.toLowerCase()} grounded in the verified data on this deal.`,
      {
        x: panelX + 0.32, y: panelY + 0.7, w: panelW - 0.64, h: panelH - 1.2,
        fontFace: FONT, fontSize: 13, color: COLORS.charcoal, valign: 'top', fit: 'shrink',
      },
    );
  } else {
    // 2x2 grid of tiles when 3-4 cards, single column when 1-2.
    const cols = cards.length >= 3 ? 2 : 1;
    const rows = Math.ceil(cards.length / cols);
    const tileGapX = 0.18;
    const tileGapY = 0.18;
    const gridX = panelX + 0.32;
    const gridY = panelY + 0.7;
    const gridW = panelW - 0.64;
    const gridH = panelH - 1.4;
    const tileW = (gridW - (cols - 1) * tileGapX) / cols;
    const tileH = (gridH - (rows - 1) * tileGapY) / rows;

    cards.forEach((card, idx) => {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      const tx = gridX + c * (tileW + tileGapX);
      const ty = gridY + r * (tileH + tileGapY);
      // Tile chrome — paper fill, hairline border, narrow accent band on left
      slide.addShape(pptx.ShapeType.rect, {
        x: tx, y: ty, w: tileW, h: tileH,
        fill: { color: COLORS.mist },
        line: { color: COLORS.line, pt: 0.5 },
      });
      slide.addShape(pptx.ShapeType.rect, {
        x: tx, y: ty, w: 0.06, h: tileH,
        fill: { color: idx % 2 === 0 ? COLORS.plum : COLORS.plumSoft },
        line: { color: idx % 2 === 0 ? COLORS.plum : COLORS.plumSoft, pt: 0.1 },
      });
      // Eyebrow label
      slide.addText((card.label || '').toUpperCase(), {
        x: tx + 0.22, y: ty + 0.18, w: tileW - 0.32, h: 0.22,
        fontFace: FONT, fontSize: 8, bold: true, color: COLORS.muted, charSpace: 1.4,
      });
      // Value — large
      slide.addText(card.value || '–', {
        x: tx + 0.22, y: ty + 0.44, w: tileW - 0.32, h: tileH * 0.42,
        fontFace: FONT, fontSize: 18, bold: true, color: COLORS.charcoal, fit: 'shrink', valign: 'top',
      });
      // Hint
      if (card.hint) {
        slide.addText(card.hint, {
          x: tx + 0.22, y: ty + tileH - 0.46, w: tileW - 0.32, h: 0.36,
          fontFace: FONT, fontSize: 8, color: COLORS.muted, valign: 'top', fit: 'shrink',
        });
      }
    });
  }

  if (rightPanel.note && cards.length > 0) {
    slide.addText(rightPanel.note, {
      x: panelX + 0.32, y: panelY + panelH - 0.5, w: panelW - 0.64, h: 0.32,
      fontFace: FONT, fontSize: 9, italic: true, color: COLORS.muted, valign: 'top',
    });
  }

  // Page indicator (subtle, bottom-right)
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
