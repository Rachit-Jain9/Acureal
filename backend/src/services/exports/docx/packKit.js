'use strict';

/**
 * packKit — shared DOCX primitives for the audience-tailored report packs
 * (lender / investor / buyer).
 *
 * The existing focused builders (buildReraReadiness / buildIcReadiness) inline
 * their own primitives. Rather than refactor those (regression risk), this is a
 * NEW shared kit the report-pack renderer builds on. It reuses the canonical
 * editorial palette (`exports/shared/palette.js`) so every artifact reads as
 * one product, and a body font (Calibri) that renders without substitution on
 * Indian corporate machines.
 *
 * Pure presentation. No DB, no kernel, no AI. The renderer
 * (buildReportPackDocx) maps a normalized pack model to DOCX using these.
 */

const docx = require('docx');
const palette = require('../shared/palette');

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  Header, Footer, PageNumber,
} = docx;

const FONT = palette.FONTS.body; // 'Calibri'

// docx-hex tokens (no leading '#') from the shared palette.
const C = Object.freeze({
  inkDeep:        palette.docx('inkDeep'),
  ink:            palette.docx('ink'),
  paperSubtle:    palette.docx('paperSubtle'),
  accent:         palette.docx('accent'),
  positive:       palette.docx('dataPositive'),
  negative:       palette.docx('dataNegative'),
  warning:        palette.docx('dataWarning'),
  mutedHigh:      palette.docx('mutedHigh'),
  mutedLow:       palette.docx('mutedLow'),
  hairline:       palette.docx('hairline'),
  hairlineStrong: palette.docx('hairlineStrong'),
});

// ─── Formatters (null-safe → en-dash) ───────────────────────────────────────

const EMDASH = '—';

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const formatNumber = (value, decimals = 0) => {
  const n = num(value);
  if (n === null) return EMDASH;
  return n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
};

const formatCr = (value, decimals = 2) => {
  const n = num(value);
  if (n === null) return EMDASH;
  return `INR ${formatNumber(n, decimals)} Cr`;
};

const formatPct = (value, decimals = 1) => {
  const n = num(value);
  if (n === null) return EMDASH;
  return `${formatNumber(n, decimals)}%`;
};

// Accepts a ratio (decimal). 0.18 → "18.0%". Pass-through for already-percent values is the caller's job.
const formatRatioPct = (value, decimals = 1) => {
  const n = num(value);
  if (n === null) return EMDASH;
  return `${formatNumber(n * 100, decimals)}%`;
};

const formatX = (value, decimals = 2) => {
  const n = num(value);
  if (n === null) return EMDASH;
  return `${formatNumber(n, decimals)}x`;
};

const formatRate = (value) => {
  const n = num(value);
  if (n === null || n === 0) return EMDASH;
  return `INR ${formatNumber(n, 0)} / sqft`;
};

const formatArea = (value) => {
  const n = num(value);
  if (n === null) return EMDASH;
  return `${formatNumber(n, 0)} sqft`;
};

const formatDate = (value) => {
  if (!value) return EMDASH;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return EMDASH;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const ASSET_CLASS_LABEL = Object.freeze({
  residential_apartments: 'Residential Apartments',
  plotted_development:    'Plotted Development',
  villas:                 'Villas',
  mixed_use:              'Mixed-Use',
  redevelopment:          'Redevelopment',
  commercial_office:      'Commercial Office',
  retail:                 'Retail',
  industrial_warehousing: 'Industrial / Warehousing',
  hospitality:            'Hospitality',
  raw_land:               'Raw Land',
});

const assetClassLabel = (ac) => ASSET_CLASS_LABEL[ac] || (ac ? String(ac).replace(/_/g, ' ') : 'Deal');

// Evidence status → label + colour (matches the cockpit 5-tier model + sign-off states).
const STATUS_DISPLAY = Object.freeze({
  verified:    { label: 'Verified',    color: C.positive },
  uploaded:    { label: 'Uploaded',    color: C.accent },
  available:   { label: 'Available',   color: C.warning },
  pending:     { label: 'Pending',     color: C.warning },
  missing:     { label: 'Missing',     color: C.negative },
  signed:      { label: 'Signed',      color: C.positive },
  requested:   { label: 'Requested',   color: C.warning },
  not_started: { label: 'Not started', color: C.mutedHigh },
  rejected:    { label: 'Rejected',    color: C.negative },
  expired:     { label: 'Expired',     color: C.negative },
  pass:        { label: 'Within covenant', color: C.positive },
  fail:        { label: 'Breach',      color: C.negative },
});

const SEVERITY_DISPLAY = Object.freeze({
  critical: { label: 'Critical', color: C.negative },
  high:     { label: 'High',     color: C.negative },
  medium:   { label: 'Medium',   color: C.warning },
  low:      { label: 'Low',      color: C.mutedHigh },
  info:     { label: 'Info',     color: C.mutedHigh },
});

// ─── docx primitives ─────────────────────────────────────────────────────────

const text = (str, opts = {}) =>
  new TextRun({ text: str == null ? '' : String(str), font: FONT, color: C.ink, ...opts });

const para = (str, opts = {}) => {
  const { runs, spacing, alignment, ...rest } = opts;
  return new Paragraph({
    children: runs || [text(str, rest)],
    spacing: spacing || { before: 60, after: 60 },
    alignment,
  });
};

// Section title — 13pt bold ink with a copper underline rule.
const sectionHeading = (str) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 320, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.accent, space: 4 } },
    children: [text(str, { bold: true, color: C.inkDeep, size: 26 })],
  });

const eyebrow = (str) =>
  new Paragraph({
    spacing: { before: 0, after: 60 },
    children: [text(String(str || '').toUpperCase(), {
      bold: true, color: C.accent, size: 16, characterSpacing: 60,
    })],
  });

// Framing sentence under a heading — deterministic, audience-specific copy.
const lead = (str) =>
  new Paragraph({
    spacing: { before: 0, after: 140 },
    children: [text(str, { color: C.mutedHigh, size: 20, italics: true })],
  });

const note = (str, opts = {}) =>
  new Paragraph({
    spacing: { before: 80, after: 80 },
    children: [text(str, { color: opts.color || C.mutedHigh, size: 17, italics: opts.italics !== false })],
  });

const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const hairlineBorder = { style: BorderStyle.SINGLE, size: 4, color: C.hairline };
const tableBorders = {
  top: hairlineBorder, bottom: hairlineBorder, left: hairlineBorder, right: hairlineBorder,
  insideHorizontal: hairlineBorder, insideVertical: hairlineBorder,
};

const cell = (children, { shading = null, width = null, columnSpan = null } = {}) => {
  const opts = {
    children: Array.isArray(children) ? children : [children],
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
  };
  if (shading) opts.shading = { type: ShadingType.CLEAR, color: 'auto', fill: shading };
  if (width) opts.width = { size: width, type: WidthType.PERCENTAGE };
  if (columnSpan) opts.columnSpan = columnSpan;
  return new TableCell(opts);
};

const cellText = (str, opts = {}) => cell(para(str, opts));

const fullWidthTable = (rows) =>
  new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: tableBorders, rows });

// ─── Cover page ────────────────────────────────────────────────────────────

// The single quiet AI-disclosure line (CLAUDE.md operator override 2026-05-19):
// 7pt italic muted, cover only. No per-section banners, no provider names.
const AI_DISCLAIMER =
  'Portions of this pack are drafted with model-assisted synthesis from REDIP\'s structured deal data. '
  + 'All numerical figures originate from the deterministic underwriting kernel — no figures are model-generated. '
  + 'Statutory matters (title, encumbrance, RERA registration, and approvals) are presented as factual status only, '
  + 'never as a legal conclusion. Independent verification against primary source documents is required before any decision.';

const aiDisclaimerParagraph = () =>
  new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 480, after: 60 },
    children: [text(AI_DISCLAIMER, { size: 14, italics: true, color: C.mutedLow })],
  });

const coverPage = ({ brandName, eyebrowText, title, subtitle, metaLines = [], generatedLabel }) => {
  const children = [
    new Paragraph({
      spacing: { before: 1000, after: 80 },
      children: [text(brandName || 'REDIP', { bold: true, color: C.accent, size: 28, characterSpacing: 40 })],
    }),
    eyebrow(eyebrowText || 'Deal Briefing'),
    new Paragraph({
      spacing: { before: 120, after: 120 },
      children: [text(title || 'Deal', { bold: true, color: C.inkDeep, size: 52 })],
    }),
  ];
  if (subtitle) {
    children.push(new Paragraph({
      spacing: { after: 200 },
      children: [text(subtitle, { color: C.mutedHigh, size: 24 })],
    }));
  }
  for (const m of metaLines) {
    children.push(new Paragraph({
      spacing: { before: 20, after: 20 },
      children: [text(m, { color: C.mutedHigh, size: 20 })],
    }));
  }
  if (generatedLabel) {
    children.push(new Paragraph({
      spacing: { before: 200, after: 0 },
      children: [text(generatedLabel, { color: C.mutedLow, size: 18 })],
    }));
  }
  children.push(aiDisclaimerParagraph());
  children.push(new Paragraph({ children: [new TextRun({ text: '', break: 1, font: FONT })], pageBreakBefore: true }));
  return children;
};

// ─── Document shell (margins + header + footer with page numbers) ───────────

const buildDocShell = ({ children, brandName = 'REDIP', dealTitle = 'Deal', docTitle = 'Report Pack', footerText }) => {
  const doc = new Document({
    creator: brandName,
    title: `${docTitle} — ${dealTitle}`,
    description: `${docTitle} generated by ${brandName}.`,
    styles: { default: { document: { run: { font: FONT, size: 22, color: C.ink } } } },
    sections: [{
      properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [text(`${brandName}   |   ${dealTitle}`, { size: 16, color: C.mutedHigh, italics: true })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER, spacing: { before: 40, after: 0 },
              children: [text(footerText || `${docTitle} · Organisation aid`, { size: 14, color: C.mutedLow, italics: true })],
            }),
            new Paragraph({
              alignment: AlignmentType.RIGHT, spacing: { before: 0, after: 0 },
              children: [
                text('Page ', { size: 14, color: C.mutedLow }),
                new TextRun({ children: [PageNumber.CURRENT], size: 14, color: C.mutedLow, font: FONT }),
                text(' of ', { size: 14, color: C.mutedLow }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: C.mutedLow, font: FONT }),
              ],
            }),
          ],
        }),
      },
      children,
    }],
  });
  return doc;
};

const toBuffer = async (doc) => {
  const buffer = await Packer.toBuffer(doc);
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
};

module.exports = {
  // raw docx re-exports the renderer needs
  docx, Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, WidthType, BorderStyle, ShadingType,
  // tokens + font
  C, FONT, EMDASH,
  // formatters
  num, formatNumber, formatCr, formatPct, formatRatioPct, formatX, formatRate, formatArea, formatDate,
  assetClassLabel, ASSET_CLASS_LABEL,
  // display maps
  STATUS_DISPLAY, SEVERITY_DISPLAY,
  // primitives
  text, para, sectionHeading, eyebrow, lead, note,
  cell, cellText, fullWidthTable, tableBorders, noBorder,
  // page assembly
  coverPage, aiDisclaimerParagraph, AI_DISCLAIMER, buildDocShell, toBuffer,
};
