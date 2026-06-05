'use strict';

/**
 * buildReportPackDocx — the single DOCX renderer for the audience-tailored
 * report packs (lender / investor / buyer).
 *
 * It is driven entirely by a NORMALIZED PACK MODEL produced by
 * `services/exports/reportPack/composePack.js` (pure, deterministic). One
 * renderer, every audience: the audience differences live in the model (which
 * sections, which framing, which blocks), never in this file. Adding a fourth
 * audience changes the catalog + composer, not the renderer.
 *
 * Pack model shape:
 *   {
 *     audience: 'lender',
 *     meta: { brandName, docTitle, eyebrowText, title, subtitle, metaLines[], generatedLabel, footerText },
 *     sections: [ { id, title, lead, blocks: [ block, ... ] } ],
 *   }
 *
 * Block types: paragraph | note | kpiGrid | table | keyValue | statusList |
 *              flagList | callouts | sourceNote.
 *
 * Pure presentation — no DB, no kernel, no AI.
 */

const K = require('./packKit');
const {
  renderCapitalStackDonutSvg,
  renderCashFlowTrendSvg,
  renderTornadoSvg,
  FALLBACK_PNG_BUFFER,
} = require('../shared/chartSvg.service');

const {
  Paragraph, TextRun, Table, TableRow, AlignmentType, WidthType, ShadingType,
  C, FONT, EMDASH, text, para, sectionHeading, lead, note, cell, cellText,
  fullWidthTable, tableBorders, STATUS_DISPLAY, SEVERITY_DISPLAY,
  coverPage, buildDocShell, toBuffer,
} = K;

const { ImageRun } = K.docx;

// Chart kind → (data) → svg string. The composer emits pure chart SPECs
// (kind + data); the SVG is produced here, in the presentation layer. Each
// generator is the shared, kernel-driven renderer already used by the main
// underwriting report — same numbers, same look-and-feel.
//
// Per-kind default dimensions (aspect ratios match what the SVG service
// produces internally so the document never looks cramped). The block spec
// may override via `width` / `height`.
const CHART_RENDERERS = Object.freeze({
  capital_stack_donut: {
    fn: (d) => renderCapitalStackDonutSvg({ debtCr: d.debtCr, equityCr: d.equityCr }),
    width: 440, height: 250,
  },
  cashflow_trend: {
    fn: (d) => renderCashFlowTrendSvg({ rows: d.rows, title: d.title }),
    width: 620, height: 280,
  },
  sensitivity_tornado: {
    fn: (d) => renderTornadoSvg({ drivers: d.drivers, baseIrr: d.baseIrr, title: d.title }),
    width: 620, height: 260,
  },
});

const toneColor = (tone) => {
  switch (tone) {
    case 'positive': return C.positive;
    case 'negative': return C.negative;
    case 'warning':  return C.warning;
    case 'accent':   return C.accent;
    case 'muted':    return C.mutedHigh;
    default:         return C.ink;
  }
};

const statusPill = (status) => {
  const sd = STATUS_DISPLAY[status] || { label: status ? String(status) : EMDASH, color: C.mutedHigh };
  return para(sd.label, { size: 18, bold: true, color: sd.color });
};

// ─── Block renderers — each returns an array of docx elements ───────────────

const renderParagraph = (b) => [para(b.text, { size: 20, color: toneColor(b.tone) })];

const renderNote = (b) => [note(b.text)];

const renderSourceNote = (b) => {
  if (!b.source && !b.freshness) {
    return [note(b.emptyText || 'No verified feed available — manual input required.', { color: C.warning })];
  }
  const bits = [];
  if (b.source) bits.push(`Source: ${b.source}`);
  if (b.freshness) bits.push(`As of ${b.freshness}`);
  if (b.confidence) bits.push(`Confidence: ${b.confidence}`);
  return [note(bits.join('  ·  '))];
};

// KPI grid — `perRow` cells per row, each a stacked value/label/caption tile.
const renderKpiGrid = (b) => {
  const items = b.items || [];
  if (items.length === 0) return [note(b.emptyText || 'Not available yet.', { color: C.warning })];
  const perRow = b.perRow || 3;
  const rows = [];
  for (let i = 0; i < items.length; i += perRow) {
    const slice = items.slice(i, i + perRow);
    const cells = slice.map((it) => cell([
      para(it.value == null ? EMDASH : String(it.value), { size: 30, bold: true, color: toneColor(it.tone) }),
      para(String(it.label || '').toUpperCase(), { size: 15, color: C.mutedHigh, bold: true, characterSpacing: 40 }),
      ...(it.caption ? [para(it.caption, { size: 15, color: C.mutedLow })] : []),
    ], { width: Math.floor(100 / perRow) }));
    // pad the final row so all tiles are equal width
    while (cells.length < perRow) cells.push(cell(para('', { size: 30 }), { width: Math.floor(100 / perRow) }));
    rows.push(new TableRow({ children: cells }));
  }
  return [fullWidthTable(rows)];
};

const headerCell = (label, width) =>
  cell(para(label, { bold: true, color: C.mutedHigh, size: 17 }), { shading: C.paperSubtle, width });

const renderTable = (b) => {
  const columns = b.columns || [];
  const out = [];
  const headerRow = new TableRow({
    tableHeader: true,
    children: columns.map((col) => headerCell(col.header, col.width)),
  });
  const bodyRows = (b.rows || []).map((row) => new TableRow({
    children: row.map((c) => {
      const v = (c && typeof c === 'object') ? c : { text: c };
      return cellText(v.text == null ? EMDASH : String(v.text), {
        size: 19, bold: !!v.bold, color: toneColor(v.tone),
      });
    }),
  }));
  out.push(fullWidthTable([headerRow, ...bodyRows]));
  if (b.note) out.push(note(b.note));
  return out;
};

const renderKeyValue = (b) => {
  const rows = (b.rows || []).map(([label, value]) => new TableRow({
    children: [
      cell(para(label, { bold: true, color: C.mutedHigh, size: 19 }), { width: 40, shading: C.paperSubtle }),
      cellText(value == null ? EMDASH : String(value), { size: 19, width: 60 }),
    ],
  }));
  if (rows.length === 0) return [];
  return [fullWidthTable(rows)];
};

const renderStatusList = (b) => {
  const items = b.items || [];
  if (items.length === 0) return [note(b.emptyText || 'No items on file yet.', { color: C.warning })];
  const rows = [new TableRow({
    tableHeader: true,
    children: [headerCell('Item', 50), headerCell('Status', 22), headerCell('Detail', 28)],
  })];
  for (const it of items) {
    rows.push(new TableRow({
      children: [
        cellText(it.label, { size: 19 }),
        cell(statusPill(it.status)),
        cellText(it.detail || EMDASH, { size: 17, color: C.mutedHigh }),
      ],
    }));
  }
  return [fullWidthTable(rows)];
};

const renderFlagList = (b) => {
  const items = b.items || [];
  if (items.length === 0) {
    return [note(b.emptyText || 'No flags raised.', { color: C.positive })];
  }
  const rows = [new TableRow({
    tableHeader: true,
    children: [headerCell('Severity', 16), headerCell('Item', 40), headerCell('Detail', 44)],
  })];
  for (const it of items) {
    const sd = SEVERITY_DISPLAY[it.severity] || SEVERITY_DISPLAY.low;
    rows.push(new TableRow({
      children: [
        cellText(sd.label, { size: 18, bold: true, color: sd.color }),
        cellText(it.title, { size: 19, bold: true }),
        cellText(it.detail || EMDASH, { size: 17, color: C.mutedHigh }),
      ],
    }));
  }
  return [fullWidthTable(rows)];
};

// Deterministic recommendation/diagnostic cards — verb + headline + detail.
// The closed verb dictionary is enforced upstream (composer reads kernel cards).
const renderCallouts = (b) => {
  const items = b.items || [];
  if (items.length === 0) return [note(b.emptyText || 'No call-outs.', { color: C.mutedHigh })];
  const rows = items.map((it) => new TableRow({
    children: [cell([
      new Paragraph({
        spacing: { before: 60, after: 30 },
        children: [
          text(`${it.verb || 'Note'}`, { bold: true, color: C.accent, size: 19 }),
          text(`   ${it.headline || ''}`, { bold: true, color: C.inkDeep, size: 19 }),
        ],
      }),
      ...(it.detail ? [para(it.detail, { size: 18, color: C.mutedHigh })] : []),
    ], { shading: C.paperSubtle })],
  }));
  return [fullWidthTable(rows)];
};

// Chart block — embed a kernel-driven SVG via ImageRun (with the shared 1×1
// PNG fallback for viewers without SVG support). Returns [] when the chart
// kind is unknown or the generator yields nothing — never throws into the doc.
// Per-kind default dimensions live in CHART_RENDERERS; the block may override.
const renderChart = (b) => {
  const descriptor = CHART_RENDERERS[b && b.chart];
  if (!descriptor) return [];
  let svg;
  try { svg = descriptor.fn(b.data || {}); } catch { return []; }
  if (!svg) return [];
  const width = b.width || descriptor.width;
  const height = b.height || descriptor.height;
  const out = [new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: b.caption ? 20 : 120 },
    children: [new ImageRun({
      type: 'svg',
      data: Buffer.from(svg, 'utf8'),
      fallback: { type: 'png', data: FALLBACK_PNG_BUFFER },
      transformation: { width, height },
    })],
  })];
  if (b.caption) {
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 120 },
      children: [text(b.caption, { size: 16, color: C.mutedLow, italics: true })],
    }));
  }
  return out;
};

const RENDERERS = {
  paragraph: renderParagraph,
  note: renderNote,
  sourceNote: renderSourceNote,
  kpiGrid: renderKpiGrid,
  table: renderTable,
  keyValue: renderKeyValue,
  statusList: renderStatusList,
  flagList: renderFlagList,
  callouts: renderCallouts,
  chart: renderChart,
};

const renderBlock = (block) => {
  const fn = RENDERERS[block && block.type];
  if (!fn) return [];
  try {
    return fn(block);
  } catch {
    return [];
  }
};

const renderSection = (section) => {
  const out = [sectionHeading(section.title)];
  if (section.lead) out.push(lead(section.lead));
  for (const block of section.blocks || []) {
    out.push(...renderBlock(block));
  }
  return out;
};

// ─── Public entry ──────────────────────────────────────────────────────────

const buildReportPackDocx = async (packModel, { brandName = 'REDIP', userName = null, generatedAt = null } = {}) => {
  if (!packModel || !packModel.meta) {
    throw new Error('buildReportPackDocx: a normalized pack model is required.');
  }
  const meta = packModel.meta;
  const dealTitle = meta.title || 'Deal';
  const docTitle = meta.docTitle || 'Report Pack';

  const generated = new Date(generatedAt || meta.generatedAtLabelSource || Date.now());
  const generatedLabel = `Generated ${generated.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
    + (userName ? `  ·  Prepared by ${userName}` : '');

  const children = [
    ...coverPage({
      brandName,
      eyebrowText: meta.eyebrowText,
      title: dealTitle,
      subtitle: meta.subtitle,
      metaLines: meta.metaLines || [],
      generatedLabel,
    }),
  ];

  const sections = packModel.sections || [];
  if (sections.length === 0) {
    children.push(sectionHeading('Not enough data yet'));
    children.push(para(
      'This deal has not yet generated enough signals for the pack. Add the parcel, run the financial model, '
      + 'and seed the DD / approvals checklists, then re-download.',
      { size: 22 },
    ));
  } else {
    for (const section of sections) {
      children.push(...renderSection(section));
    }
  }

  const doc = buildDocShell({
    children,
    brandName,
    dealTitle,
    docTitle,
    footerText: meta.footerText,
  });
  return toBuffer(doc);
};

module.exports = { buildReportPackDocx, renderBlock, toneColor, CHART_RENDERERS };
