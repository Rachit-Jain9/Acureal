'use strict';

/**
 * Karnataka RERA Readiness Pack — DOCX exporter (Phase 3 / Pillar 4).
 *
 * Generates a focused Word document the operator hands to their CA /
 * architect / lawyer. Not the full investor-report machinery — a
 * disciplined ~5-section pack:
 *
 *   1. Cover            — deal name + asset class + readiness score + the
 *                         CLAUDE.md disclaimer (NOT a legal verdict)
 *   2. Executive Summary — per-bucket completeness table + headline counts
 *   3. Per-bucket sections — items with status + evidence source + the
 *                            recommended next action if missing
 *   4. Top Gaps         — missing / pending items sorted by severity with
 *                         recommended actions
 *   5. Disclaimer       — footer on every page restating the organisation-
 *                         aid scope per CLAUDE.md hard rule
 *
 * Pure: input is the readiness slice already composed server-side. No DB
 * round-trips, no kernel calls, no AI. Reproducible byte-for-byte from
 * the same input (modulo `generatedAt`).
 */

const docx = require('docx');

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  Footer, Header, PageNumber, ShadingType,
} = docx;

const FONT = 'Inter';

// Hex colors used throughout. Subdued institutional palette.
const COLORS = Object.freeze({
  ink:        '111827', // primary text
  ink_muted:  '6B7280', // secondary text
  hairline:   'E5E7EB', // table borders
  green:      '047857', // verified
  sky:        '0369A1', // uploaded
  amber:      'B45309', // available / pending
  red:        'B91C1C', // missing / critical
  navy:       '1E3A8A', // headings
  bg_subtle:  'F9FAFB', // table header band
});

const STATUS_DISPLAY = Object.freeze({
  verified:  { label: 'Verified',  color: COLORS.green },
  uploaded:  { label: 'Uploaded',  color: COLORS.sky },
  available: { label: 'Available', color: COLORS.amber },
  pending:   { label: 'Pending',   color: COLORS.amber },
  missing:   { label: 'Missing',   color: COLORS.red },
});

const SEVERITY_DISPLAY = Object.freeze({
  critical: { label: 'Critical', color: COLORS.red },
  high:     { label: 'High',     color: COLORS.red },
  medium:   { label: 'Medium',   color: COLORS.amber },
  low:      { label: 'Low',      color: COLORS.ink_muted },
});

const READINESS_TIER_DISPLAY = Object.freeze({
  filing_ready: 'Filing-ready',
  mostly_ready: 'Mostly ready',
  partial:      'Partial',
  early:        'Early',
});

const ASSET_CLASS_LABEL = Object.freeze({
  residential_apartments: 'Residential Apartments',
  plotted_development:    'Plotted Development',
  villas:                 'Villas',
  mixed_use:              'Mixed-Use',
  redevelopment:          'Redevelopment',
});

// ─────────────────────────────────────────────────────────────────────────────
//  Pure DOCX building blocks
// ─────────────────────────────────────────────────────────────────────────────

const text = (str, opts = {}) =>
  new TextRun({ text: str || '', font: FONT, color: COLORS.ink, ...opts });

const para = (str, opts = {}) => {
  const { runs, spacing, alignment, ...rest } = opts;
  return new Paragraph({
    children: runs || [text(str, rest)],
    spacing: spacing || { before: 60, after: 60 },
    alignment,
  });
};

const heading = (str, level = HeadingLevel.HEADING_2) =>
  new Paragraph({
    heading: level,
    spacing: { before: 240, after: 120 },
    children: [text(str, { bold: true, color: COLORS.navy, size: 26 })],
  });

const subheading = (str) =>
  new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [text(str, { bold: true, color: COLORS.navy, size: 22 })],
  });

const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = {
  top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
  insideHorizontal: noBorder, insideVertical: noBorder,
};

const hairlineBorder = { style: BorderStyle.SINGLE, size: 4, color: COLORS.hairline };
const tableBorders = {
  top: hairlineBorder, bottom: hairlineBorder,
  left: hairlineBorder, right: hairlineBorder,
  insideHorizontal: hairlineBorder, insideVertical: hairlineBorder,
};

const cell = (children, { shading = null, width = null, alignment = null } = {}) => {
  const opts = { children: Array.isArray(children) ? children : [children] };
  if (shading) opts.shading = { type: ShadingType.CLEAR, color: 'auto', fill: shading };
  if (width) opts.width = { size: width, type: WidthType.PERCENTAGE };
  if (alignment) opts.verticalAlign = alignment;
  return new TableCell(opts);
};

const cellText = (str, opts = {}) => cell(para(str, opts));

// ─────────────────────────────────────────────────────────────────────────────
//  Cover page
// ─────────────────────────────────────────────────────────────────────────────

const buildCoverPage = ({ readiness, deal, generatedAt, brandName, userName }) => {
  const tier = readiness?.overall?.readiness_tier || 'early';
  const tierLabel = READINESS_TIER_DISPLAY[tier] || tier;
  const pct = readiness?.overall?.completeness_pct ?? 0;
  const assetLabel = ASSET_CLASS_LABEL[readiness?.asset_class] || readiness?.asset_class || '—';
  const generated = new Date(generatedAt || Date.now()).toLocaleString('en-IN', {
    dateStyle: 'long', timeStyle: 'short',
  });

  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 1200, after: 80 },
      children: [text(brandName || 'REDIP', { bold: true, color: COLORS.navy, size: 40 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 480 },
      children: [text('Karnataka RERA Readiness Pack', { color: COLORS.ink_muted, size: 22 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [text(deal?.name || readiness?.deal_name || 'Deal', { bold: true, size: 36 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [text(assetLabel, { color: COLORS.ink_muted, size: 22 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 80 },
      children: [text(`${pct}/100`, { bold: true, size: 64, color: COLORS.navy })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 480 },
      children: [text(`Readiness: ${tierLabel}`, { color: COLORS.ink_muted, size: 22 })],
    }),
    // Disclaimer banner — CLAUDE.md hard rule. Surfaced large + early so
    // no downstream reader can miss it.
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top:    { style: BorderStyle.SINGLE, size: 8, color: COLORS.amber },
        bottom: { style: BorderStyle.SINGLE, size: 8, color: COLORS.amber },
        left:   { style: BorderStyle.SINGLE, size: 8, color: COLORS.amber },
        right:  { style: BorderStyle.SINGLE, size: 8, color: COLORS.amber },
        insideHorizontal: noBorder,
        insideVertical: noBorder,
      },
      rows: [
        new TableRow({
          children: [
            cell(
              [
                new Paragraph({
                  spacing: { before: 120, after: 60 },
                  children: [text('Important', { bold: true, color: COLORS.amber, size: 22 })],
                }),
                new Paragraph({
                  spacing: { before: 0, after: 120 },
                  children: [
                    text(
                      readiness?.disclaimer ||
                      'This document is an organisation aid for the deal team and their CA / architect / lawyer. ' +
                      'It does NOT represent a Karnataka RERA compliance verdict — only an inventory of the documents ' +
                      'and fields required for K-RERA project registration. The statutory determination of RERA ' +
                      'compliance rests with the human professional.',
                      { color: COLORS.ink, size: 20 },
                    ),
                  ],
                }),
              ],
              { shading: 'FEF3C7' }, // amber-100
            ),
          ],
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 800, after: 0 },
      children: [text(`Generated ${generated}`, { color: COLORS.ink_muted, size: 18 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 20, after: 0 },
      children: [text(userName ? `Prepared by ${userName}` : '', { color: COLORS.ink_muted, size: 18 })],
    }),
    // Page break out of cover
    new Paragraph({ children: [new TextRun({ text: '', break: 1 })], pageBreakBefore: false }),
    new Paragraph({ children: [new TextRun({ text: '', break: 1, font: FONT })], pageBreakBefore: true }),
  ];
};

// ─────────────────────────────────────────────────────────────────────────────
//  Executive summary — bucket completeness table
// ─────────────────────────────────────────────────────────────────────────────

const buildExecutiveSummary = (readiness) => {
  const buckets = readiness?.buckets || [];
  const overall = readiness?.overall || {};
  const byStatus = overall.by_status || {};
  const totalItems = overall.total_items || 0;

  // Headline counts row
  const headline = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders,
    rows: [
      new TableRow({
        children: [
          cellText('Total items',  { bold: true, color: COLORS.ink_muted, size: 18 }),
          cellText('Verified',     { bold: true, color: COLORS.green,     size: 18 }),
          cellText('Uploaded',     { bold: true, color: COLORS.sky,       size: 18 }),
          cellText('Available',    { bold: true, color: COLORS.amber,     size: 18 }),
          cellText('Pending',      { bold: true, color: COLORS.amber,     size: 18 }),
          cellText('Missing',      { bold: true, color: COLORS.red,       size: 18 }),
        ],
      }),
      new TableRow({
        children: [
          cellText(String(totalItems),         { size: 24, bold: true }),
          cellText(String(byStatus.verified || 0),  { size: 24, bold: true, color: COLORS.green }),
          cellText(String(byStatus.uploaded || 0),  { size: 24, bold: true, color: COLORS.sky }),
          cellText(String(byStatus.available || 0), { size: 24, bold: true, color: COLORS.amber }),
          cellText(String(byStatus.pending || 0),   { size: 24, bold: true, color: COLORS.amber }),
          cellText(String(byStatus.missing || 0),   { size: 24, bold: true, color: COLORS.red }),
        ],
      }),
    ],
  });

  // Bucket completeness table
  const bucketRows = [
    new TableRow({
      tableHeader: true,
      children: [
        cell(para('Bucket',         { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle }),
        cell(para('Items',          { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle }),
        cell(para('Completeness',   { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle }),
        cell(para('Status',         { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle }),
      ],
    }),
  ];
  for (const b of buckets) {
    const statusLabel = b.bucket_status === 'complete'
      ? 'Complete'
      : b.bucket_status === 'partial' ? 'Partial' : 'Missing';
    const statusColor = b.bucket_status === 'complete' ? COLORS.green
      : b.bucket_status === 'partial' ? COLORS.amber : COLORS.red;
    bucketRows.push(new TableRow({
      children: [
        cellText(b.label, { size: 20 }),
        cellText(String(b.total_items), { size: 20 }),
        cellText(`${b.completeness_pct}%`, { size: 20, bold: true }),
        cellText(statusLabel, { size: 20, bold: true, color: statusColor }),
      ],
    }));
  }

  return [
    heading('Executive Summary'),
    para('Headline inventory state across all readiness items:', { size: 20, color: COLORS.ink_muted }),
    headline,
    para('', { size: 4 }),
    para('Per-bucket completeness:', { size: 20, color: COLORS.ink_muted }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: tableBorders,
      rows: bucketRows,
    }),
  ];
};

// ─────────────────────────────────────────────────────────────────────────────
//  Per-bucket sections — item table per bucket
// ─────────────────────────────────────────────────────────────────────────────

const buildBucketSection = (bucket) => {
  const blocks = [];
  blocks.push(subheading(`${bucket.label} — ${bucket.completeness_pct}% complete`));
  blocks.push(para(bucket.description, { size: 20, color: COLORS.ink_muted }));

  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        cell(para('Item',         { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle, width: 45 }),
        cell(para('Status',       { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle, width: 15 }),
        cell(para('Evidence',     { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle, width: 20 }),
        cell(para('Next step',    { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle, width: 20 }),
      ],
    }),
  ];

  for (const item of bucket.items) {
    const ev = item.evidence || {};
    const sd = STATUS_DISPLAY[ev.status] || STATUS_DISPLAY.missing;
    const evidenceText = ev.evidence_label
      ? `${ev.source ? ev.source.replace(/_/g, ' ') : ''}${ev.evidence_label ? `: ${ev.evidence_label}` : ''}`.trim()
      : '—';
    const nextStep = item.recommended_action || '—';

    rows.push(new TableRow({
      children: [
        cell([
          para(item.label, { size: 20, bold: true }),
          para(item.description, { size: 18, color: COLORS.ink_muted }),
        ]),
        cellText(sd.label, { size: 20, bold: true, color: sd.color }),
        cellText(evidenceText, { size: 18, color: COLORS.ink_muted }),
        cellText(nextStep, { size: 18, color: COLORS.ink_muted }),
      ],
    }));
  }

  blocks.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders,
    rows,
  }));

  return blocks;
};

// ─────────────────────────────────────────────────────────────────────────────
//  Top Gaps section — missing / pending items sorted by severity
// ─────────────────────────────────────────────────────────────────────────────

const buildTopGapsSection = (gaps) => {
  if (!gaps || gaps.length === 0) {
    return [
      heading('Top Gaps'),
      para('No outstanding gaps — every required item has evidence on file.', {
        size: 20, color: COLORS.green,
      }),
    ];
  }

  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        cell(para('Severity',      { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle, width: 12 }),
        cell(para('Item',          { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle, width: 35 }),
        cell(para('Bucket',        { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle, width: 20 }),
        cell(para('Recommended action', { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle, width: 33 }),
      ],
    }),
  ];

  for (const gap of gaps) {
    const sd = SEVERITY_DISPLAY[gap.severity] || SEVERITY_DISPLAY.low;
    rows.push(new TableRow({
      children: [
        cellText(sd.label, { size: 20, bold: true, color: sd.color }),
        cellText(gap.item_label || '', { size: 20 }),
        cellText(gap.bucket_label || '', { size: 18, color: COLORS.ink_muted }),
        cellText(gap.recommended_action || '—', { size: 18, color: COLORS.ink_muted }),
      ],
    }));
  }

  return [
    heading('Top Gaps'),
    para('Outstanding readiness items sorted by severity. Each row carries a recommended next step the operator can act on.', {
      size: 20, color: COLORS.ink_muted,
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: tableBorders,
      rows,
    }),
  ];
};

// ─────────────────────────────────────────────────────────────────────────────
//  Closing disclaimer page
// ─────────────────────────────────────────────────────────────────────────────

const buildDisclaimerSection = (readiness) => {
  return [
    heading('Scope & Disclaimer'),
    para(
      readiness?.disclaimer ||
      'This document is an organisation aid for the deal team and their CA / architect / lawyer. ' +
      'It does NOT represent a Karnataka RERA compliance verdict — only an inventory of the documents ' +
      'and fields required for K-RERA project registration. The statutory determination of RERA ' +
      'compliance rests with the human professional.',
      { size: 20 },
    ),
    para(
      'Source-of-truth references: Karnataka Real Estate (Regulation and Development) Act 2016 + ' +
      'Karnataka Real Estate (Regulation and Development) Rules 2017. Item lists are operator-known ' +
      'typical filings; verify against the latest K-RERA portal guidance (rera.karnataka.gov.in) ' +
      'before submission.',
      { size: 18, color: COLORS.ink_muted },
    ),
  ];
};

// ─────────────────────────────────────────────────────────────────────────────
//  Public entry — assemble the full document
// ─────────────────────────────────────────────────────────────────────────────

const buildReraReadinessDocx = async (readiness, { brandName = 'REDIP', userName = null, generatedAt = null } = {}) => {
  if (!readiness) throw new Error('buildReraReadinessDocx: readiness payload is required.');

  // Not-applicable path: short document explaining why no pack is generated.
  if (readiness.applicable === false) {
    const doc = new Document({
      creator: brandName,
      title: 'K-RERA Readiness — Not Applicable',
      styles: { default: { document: { run: { font: FONT } } } },
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 800, after: 120 },
            children: [text(brandName, { bold: true, color: COLORS.navy, size: 36 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 360 },
            children: [text('K-RERA Readiness Pack', { color: COLORS.ink_muted, size: 22 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [text(readiness.deal_name || 'Deal', { bold: true, size: 30 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 480 },
            children: [text('Not applicable', { bold: true, color: COLORS.amber, size: 24 })],
          }),
          para(
            readiness.reason_if_not ||
            'Project-level K-RERA registration is not required for this asset class.',
            { size: 22, color: COLORS.ink, alignment: AlignmentType.CENTER },
          ),
        ],
      }],
    });
    return Packer.toBuffer(doc);
  }

  // Applicable path — full pack
  const children = [
    ...buildCoverPage({ readiness, deal: { name: readiness.deal_name }, generatedAt, brandName, userName }),
    ...buildExecutiveSummary(readiness),
  ];
  for (const bucket of readiness.buckets || []) {
    children.push(...buildBucketSection(bucket));
  }
  children.push(...buildTopGapsSection(readiness.gaps || []));
  children.push(...buildDisclaimerSection(readiness));

  // Document-level footer — every page restates the organisation-aid scope.
  const footerText =
    'K-RERA Readiness Pack · Organisation aid · NOT a RERA compliance verdict · ' +
    'See last page for full scope notes.';

  const doc = new Document({
    creator: brandName,
    title: `K-RERA Readiness — ${readiness.deal_name || 'Deal'}`,
    description: 'Karnataka RERA Readiness Pack — organisation aid for the operator\'s CA / architect / lawyer.',
    styles: { default: { document: { run: { font: FONT } } } },
    sections: [{
      properties: {},
      children,
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 60, after: 0 },
              children: [
                text(footerText, { size: 14, color: COLORS.ink_muted, italics: true }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 0, after: 0 },
              children: [
                text('Page ', { size: 14, color: COLORS.ink_muted }),
                new TextRun({ children: [PageNumber.CURRENT], size: 14, color: COLORS.ink_muted, font: FONT }),
                text(' of ', { size: 14, color: COLORS.ink_muted }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: COLORS.ink_muted, font: FONT }),
              ],
            }),
          ],
        }),
      },
    }],
  });

  return Packer.toBuffer(doc);
};

module.exports = {
  buildReraReadinessDocx,
  // Exported for tests
  STATUS_DISPLAY,
  SEVERITY_DISPLAY,
  READINESS_TIER_DISPLAY,
  ASSET_CLASS_LABEL,
  COLORS,
};
