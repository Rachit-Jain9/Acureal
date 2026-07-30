'use strict';

/**
 * IC Readiness Pack — DOCX exporter (Phase 3 / Pillar 5).
 *
 * Companion to buildReraReadiness.js. Generates a focused Word document
 * the deal team hands to the IC committee for pre-IC review. Same
 * disciplined ~5-section structure:
 *
 *   1. Cover            — deal name + asset class + readiness score +
 *                         the CLAUDE.md disclaimer banner
 *   2. Executive Summary — per-bucket completeness table + headline counts
 *   3. Per-bucket sections — items with status + evidence + next step
 *   4. Top Gaps         — missing / pending items sorted by severity
 *   5. Disclaimer       — closing scope page restating organisation-aid
 *                         scope (NOT an IC approval)
 *   6. Footer on every page — "Pre-IC organisation aid · NOT an IC
 *                              approval verdict"
 *
 * Pure: input is the readiness slice already composed server-side. No DB
 * round-trips, no kernel calls, no AI.
 */

const docx = require('docx');

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  Footer, PageNumber, ShadingType,
} = docx;

const FONT = 'Inter';

const COLORS = Object.freeze({
  ink:        '111827',
  ink_muted:  '6B7280',
  hairline:   'E5E7EB',
  green:      '047857',
  sky:        '0369A1',
  amber:      'B45309',
  red:        'B91C1C',
  navy:       '1E3A8A',
  bg_subtle:  'F9FAFB',
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
  ic_ready:  'IC-ready',
  pre_ic:    'Pre-IC',
  diligence: 'Diligence-stage',
  early:     'Early',
});

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

// ─── DOCX primitives (same as buildReraReadiness.js) ────────────────────────

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

const hairlineBorder = { style: BorderStyle.SINGLE, size: 4, color: COLORS.hairline };
const tableBorders = {
  top: hairlineBorder, bottom: hairlineBorder,
  left: hairlineBorder, right: hairlineBorder,
  insideHorizontal: hairlineBorder, insideVertical: hairlineBorder,
};

const cell = (children, { shading = null, width = null } = {}) => {
  const opts = { children: Array.isArray(children) ? children : [children] };
  if (shading) opts.shading = { type: ShadingType.CLEAR, color: 'auto', fill: shading };
  if (width) opts.width = { size: width, type: WidthType.PERCENTAGE };
  return new TableCell(opts);
};

const cellText = (str, opts = {}) => cell(para(str, opts));

// ─── Cover page ────────────────────────────────────────────────────────────

const buildCoverPage = ({ readiness, generatedAt, brandName, userName }) => {
  const tier = readiness?.overall?.readiness_tier || 'early';
  const tierLabel = READINESS_TIER_DISPLAY[tier] || tier;
  const pct = readiness?.overall?.completeness_pct ?? 0;
  const assetLabel = ASSET_CLASS_LABEL[readiness?.asset_class] || readiness?.asset_class || 'Deal';
  const generated = new Date(generatedAt || Date.now()).toLocaleString('en-IN', {
    dateStyle: 'long', timeStyle: 'short',
  });

  return [
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 1200, after: 80 },
      children: [text(brandName || 'Acureal', { bold: true, color: COLORS.navy, size: 40 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 480 },
      children: [text('IC Readiness Pack', { color: COLORS.ink_muted, size: 22 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 80 },
      children: [text(readiness?.deal_name || 'Deal', { bold: true, size: 36 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 360 },
      children: [text(assetLabel, { color: COLORS.ink_muted, size: 22 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 240, after: 80 },
      children: [text(`${pct}/100`, { bold: true, size: 64, color: COLORS.navy })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 480 },
      children: [text(`Readiness: ${tierLabel}`, { color: COLORS.ink_muted, size: 22 })],
    }),
    // Disclaimer banner
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top:    { style: BorderStyle.SINGLE, size: 8, color: COLORS.amber },
        bottom: { style: BorderStyle.SINGLE, size: 8, color: COLORS.amber },
        left:   { style: BorderStyle.SINGLE, size: 8, color: COLORS.amber },
        right:  { style: BorderStyle.SINGLE, size: 8, color: COLORS.amber },
        insideHorizontal: noBorder, insideVertical: noBorder,
      },
      rows: [
        new TableRow({
          children: [cell(
            [
              new Paragraph({
                spacing: { before: 120, after: 60 },
                children: [text('Important', { bold: true, color: COLORS.amber, size: 22 })],
              }),
              new Paragraph({
                spacing: { before: 0, after: 120 },
                children: [text(
                  readiness?.disclaimer ||
                  'This document is an organisation aid for the deal team\'s pre-IC ' +
                  'preparation. It does NOT represent an Investment Committee approval — only ' +
                  'an inventory of items an IC reviewer typically expects. The investment ' +
                  'decision rests with the IC; this surface is for the deal team\'s readiness check.',
                  { color: COLORS.ink, size: 20 },
                )],
              }),
            ],
            { shading: 'FEF3C7' },
          )],
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 800, after: 0 },
      children: [text(`Generated ${generated}`, { color: COLORS.ink_muted, size: 18 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 20, after: 0 },
      children: [text(userName ? `Prepared by ${userName}` : '', { color: COLORS.ink_muted, size: 18 })],
    }),
    new Paragraph({ children: [new TextRun({ text: '', break: 1, font: FONT })], pageBreakBefore: true }),
  ];
};

// ─── Executive Summary ─────────────────────────────────────────────────────

const buildExecutiveSummary = (readiness) => {
  const buckets = readiness?.buckets || [];
  const overall = readiness?.overall || {};
  const byStatus = overall.by_status || {};
  const totalItems = overall.total_items || 0;

  const headline = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders,
    rows: [
      new TableRow({
        children: [
          cellText('Total items', { bold: true, color: COLORS.ink_muted, size: 18 }),
          cellText('Verified', { bold: true, color: COLORS.green, size: 18 }),
          cellText('Uploaded', { bold: true, color: COLORS.sky, size: 18 }),
          cellText('Available', { bold: true, color: COLORS.amber, size: 18 }),
          cellText('Pending', { bold: true, color: COLORS.amber, size: 18 }),
          cellText('Missing', { bold: true, color: COLORS.red, size: 18 }),
        ],
      }),
      new TableRow({
        children: [
          cellText(String(totalItems), { size: 24, bold: true }),
          cellText(String(byStatus.verified || 0), { size: 24, bold: true, color: COLORS.green }),
          cellText(String(byStatus.uploaded || 0), { size: 24, bold: true, color: COLORS.sky }),
          cellText(String(byStatus.available || 0), { size: 24, bold: true, color: COLORS.amber }),
          cellText(String(byStatus.pending || 0), { size: 24, bold: true, color: COLORS.amber }),
          cellText(String(byStatus.missing || 0), { size: 24, bold: true, color: COLORS.red }),
        ],
      }),
    ],
  });

  const bucketRows = [
    new TableRow({
      tableHeader: true,
      children: [
        cell(para('Bucket', { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle }),
        cell(para('Items', { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle }),
        cell(para('Completeness', { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle }),
        cell(para('Status', { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle }),
      ],
    }),
  ];
  for (const b of buckets) {
    const statusLabel = b.bucket_status === 'complete' ? 'Complete'
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
    para('Headline IC-readiness state across all 30 readiness items:', { size: 20, color: COLORS.ink_muted }),
    headline,
    para('', { size: 4 }),
    para('Per-bucket completeness:', { size: 20, color: COLORS.ink_muted }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: tableBorders, rows: bucketRows }),
  ];
};

// ─── Per-bucket sections ───────────────────────────────────────────────────

const buildBucketSection = (bucket) => {
  const blocks = [
    subheading(`${bucket.label} — ${bucket.completeness_pct}% complete`),
    para(bucket.description, { size: 20, color: COLORS.ink_muted }),
  ];

  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        cell(para('Item', { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle, width: 45 }),
        cell(para('Status', { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle, width: 15 }),
        cell(para('Evidence', { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle, width: 20 }),
        cell(para('Next step', { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle, width: 20 }),
      ],
    }),
  ];

  for (const item of bucket.items) {
    const ev = item.evidence || {};
    const sd = STATUS_DISPLAY[ev.status] || STATUS_DISPLAY.missing;
    const evidenceText = ev.evidence_label
      ? `${ev.source ? ev.source.replace(/_/g, ' ') + ': ' : ''}${ev.evidence_label}`.trim()
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

  blocks.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: tableBorders, rows }));
  return blocks;
};

// ─── Top Gaps ──────────────────────────────────────────────────────────────

const buildTopGapsSection = (gaps) => {
  if (!gaps || gaps.length === 0) {
    return [
      heading('Top Gaps'),
      para('No outstanding gaps — every IC-readiness item has evidence on file.', {
        size: 20, color: COLORS.green,
      }),
    ];
  }

  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        cell(para('Severity', { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle, width: 12 }),
        cell(para('Item', { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle, width: 35 }),
        cell(para('Bucket', { bold: true, color: COLORS.ink_muted, size: 18 }), { shading: COLORS.bg_subtle, width: 20 }),
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
    para('Outstanding IC-readiness items sorted by severity. Each row carries a recommended next step the deal team can act on before IC.', {
      size: 20, color: COLORS.ink_muted,
    }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: tableBorders, rows }),
  ];
};

// ─── Closing disclaimer ────────────────────────────────────────────────────

const buildDisclaimerSection = (readiness) => [
  heading('Scope & Disclaimer'),
  para(
    readiness?.disclaimer ||
    'This document is an organisation aid for the deal team\'s pre-IC preparation. ' +
    'It does NOT represent an Investment Committee approval — only an inventory of items ' +
    'an IC reviewer typically expects. The investment decision rests with the IC; this ' +
    'surface is for the deal team\'s readiness check.',
    { size: 20 },
  ),
  para(
    'IC-readiness items are operator-known typical expectations for an Indian real estate ' +
    'IC review. The score is composed deterministically from the deal\'s already-loaded ' +
    'workspace surfaces — kernel output, DD checklist, approvals, market intelligence, ' +
    'promoter track record, Risk Radar, Deal Doctor, and documents.',
    { size: 18, color: COLORS.ink_muted },
  ),
];

// ─── Public entry ──────────────────────────────────────────────────────────

const buildIcReadinessDocx = async (readiness, { brandName = 'Acureal', userName = null, generatedAt = null } = {}) => {
  if (!readiness) throw new Error('buildIcReadinessDocx: readiness payload is required.');

  if (!readiness.overall || (readiness.buckets || []).length === 0) {
    // Workspace empty / readiness composer didn't run — short document
    const doc = new Document({
      creator: brandName,
      title: 'IC Readiness — Not Available',
      styles: { default: { document: { run: { font: FONT } } } },
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER, spacing: { before: 800, after: 120 },
            children: [text(brandName, { bold: true, color: COLORS.navy, size: 36 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER, spacing: { after: 360 },
            children: [text('IC Readiness Pack', { color: COLORS.ink_muted, size: 22 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER, spacing: { after: 200 },
            children: [text(readiness.deal_name || 'Deal', { bold: true, size: 30 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER, spacing: { before: 240, after: 480 },
            children: [text('Not enough data yet', { bold: true, color: COLORS.amber, size: 24 })],
          }),
          para(
            'The workspace has not yet generated enough signals for the IC Readiness Pack. ' +
            'Add the parcel coordinates, run the financial model, and seed the DD / approvals ' +
            'checklists, then re-download.',
            { size: 22, alignment: AlignmentType.CENTER },
          ),
        ],
      }],
    });
    return Packer.toBuffer(doc);
  }

  const children = [
    ...buildCoverPage({ readiness, generatedAt, brandName, userName }),
    ...buildExecutiveSummary(readiness),
  ];
  for (const bucket of readiness.buckets || []) {
    children.push(...buildBucketSection(bucket));
  }
  children.push(...buildTopGapsSection(readiness.gaps || []));
  children.push(...buildDisclaimerSection(readiness));

  const footerText =
    'IC Readiness Pack · Organisation aid · NOT an IC approval verdict · ' +
    'See last page for full scope notes.';

  const doc = new Document({
    creator: brandName,
    title: `IC Readiness — ${readiness.deal_name || 'Deal'}`,
    description: 'IC Readiness Pack — organisation aid for the deal team\'s pre-IC preparation.',
    styles: { default: { document: { run: { font: FONT } } } },
    sections: [{
      properties: {},
      children,
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER, spacing: { before: 60, after: 0 },
              children: [text(footerText, { size: 14, color: COLORS.ink_muted, italics: true })],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 },
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
  buildIcReadinessDocx,
  STATUS_DISPLAY,
  SEVERITY_DISPLAY,
  READINESS_TIER_DISPLAY,
  ASSET_CLASS_LABEL,
  COLORS,
};
