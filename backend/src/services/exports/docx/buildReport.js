'use strict';

/**
 * DOCX underwriting report builder.
 *
 * Produces an investor-grade Word document for a single deal. Paid product
 * (see docs/PRICING.md) — generator first, paywall scaffold lands in a
 * follow-up PR. Until then the route is gated behind the
 * `DOCX_REPORT_ENABLED` env flag (admins bypass via role check upstream).
 *
 * Sections shipped in this v1 (8 of 16 in the operator brief):
 *   1. Cover               — title, asset class, locality, generated-on, disclaimer banner
 *   2. Executive Summary   — IC opinion (Claude) + headline KPIs + composite score
 *   3. Site Information    — address, area, FSI; site map (Google Maps) when available
 *   4. Overview            — deal type, structure, stage
 *   5. Comparables         — top 5 verified comps with rate / units / developer
 *   6. Financials          — full KPI table; cost / revenue / margin
 *   7. Pros & Cons         — AI-augmented two-column synthesis
 *   8. Overall Score       — 0–100 with weight breakdown
 *   9. Disclaimer          — "AI-Assisted" vs "Platform Data" badges, CLAUDE.md hard rules
 *
 * Sections deferred to follow-up PRs (require data-orchestration work):
 *   Demographics, Why This Area, Job Growth, Social Infrastructure,
 *   Supply & Demand Pipeline, Better Alternatives.
 *
 * Hard rules (CLAUDE.md):
 *   - English only — `lang: 'en-IN'` set on every Document; narrative
 *     service rejects non-Latin scripts before content reaches this builder.
 *   - No fabricated facts — every section either renders structured data or
 *     a "Manual input required" placeholder. AI prose synthesises only.
 *   - No AI numeric output — numbers come from the deterministic kernel.
 *   - Disclaimer split — "AI-Assisted" sections (executive summary, pros &
 *     cons) labelled distinctly from "Platform Data" sections (financials,
 *     comps, score).
 */

const docx = require('docx');
const palette = require('../shared/palette');
const { computeDealScore } = require('../../../utils/scoring/dealScore');
const { renderSiteMap } = require('../shared/googleMapsStaticMap.service');
const { generateSection } = require('../narrative/exportNarrative.service');

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  ImageRun, Header, Footer, PageNumber,
  ShadingType, LevelFormat,
} = docx;

const FONT = palette.FONTS.body;

const HEX = (token) => palette.docx(token);

// Standard borders for tables — hairline grey on every edge.
const TABLE_BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: HEX('hairline') },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: HEX('hairline') },
  left:   { style: BorderStyle.SINGLE, size: 4, color: HEX('hairline') },
  right:  { style: BorderStyle.SINGLE, size: 4, color: HEX('hairline') },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: HEX('hairline') },
  insideVertical:   { style: BorderStyle.SINGLE, size: 4, color: HEX('hairline') },
};

// ─────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : null;
};
const firstNumber = (...values) => {
  for (const v of values) {
    const parsed = num(v);
    if (parsed !== null) return parsed;
  }
  return null;
};
const firstText = (...values) => {
  for (const v of values) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
};

const formatNumber = (value, decimals = 0) => {
  const parsed = num(value);
  if (parsed === null) return '–';
  return parsed.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
};
const formatCrores = (value, decimals = 2) => {
  const parsed = num(value);
  if (parsed === null) return '–';
  return `INR ${formatNumber(parsed, decimals)} Cr`;
};
const formatPct = (value, decimals = 1) => {
  const parsed = num(value);
  if (parsed === null) return '–';
  return `${formatNumber(parsed, decimals)}%`;
};
const formatArea = (value) => {
  const parsed = num(value);
  if (parsed === null) return '–';
  return `${formatNumber(parsed, 0)} sqft`;
};
const formatRate = (value) => {
  const parsed = num(value);
  if (parsed === null) return '–';
  return `INR ${formatNumber(parsed, 0)} / sqft`;
};
const formatDate = (value) => {
  if (!value) return '–';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

// ─────────────────────────────────────────────────────────────────────────
// Paragraph + table helpers
// ─────────────────────────────────────────────────────────────────────────

const text = (content, opts = {}) =>
  new TextRun({
    text: content == null ? '' : String(content),
    font: FONT,
    size: opts.size || 22, // half-points; 22 = 11pt
    bold: !!opts.bold,
    italics: !!opts.italic,
    color: opts.color || HEX('ink'),
  });

const para = (runs, opts = {}) =>
  new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    alignment: opts.alignment || AlignmentType.LEFT,
    spacing: opts.spacing || { before: 80, after: 80 },
    pageBreakBefore: !!opts.pageBreakBefore,
    heading: opts.heading,
  });

const sectionHeading = (titleText, opts = {}) =>
  new Paragraph({
    children: [
      new TextRun({
        text: titleText,
        font: palette.FONTS.display,
        size: 28, // 14pt
        bold: true,
        color: HEX('inkDeep'),
      }),
    ],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 160 },
    pageBreakBefore: !!opts.pageBreakBefore,
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 4, color: HEX('accent'), space: 4 },
    },
  });

const eyebrow = (txt) =>
  new Paragraph({
    children: [
      new TextRun({
        text: txt.toUpperCase(),
        font: FONT,
        size: 16, // 8pt
        bold: true,
        color: HEX('mutedHigh'),
        characterSpacing: 60,
      }),
    ],
    spacing: { before: 0, after: 80 },
  });

const bodyPara = (content, opts = {}) =>
  new Paragraph({
    children: [
      new TextRun({
        text: content == null ? '–' : String(content),
        font: FONT,
        size: 22, // 11pt
        color: opts.color || HEX('ink'),
        italics: !!opts.italic,
        bold: !!opts.bold,
      }),
    ],
    spacing: { before: 60, after: 60 },
    alignment: opts.alignment || AlignmentType.LEFT,
  });

const labelValueRow = (label, value, opts = {}) => {
  const cellPad = { top: 80, bottom: 80, left: 120, right: 120 };
  const labelCell = new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({
          text: label,
          font: FONT,
          size: 20, // 10pt
          color: HEX('mutedHigh'),
          bold: false,
        })],
      }),
    ],
    width: { size: 35, type: WidthType.PERCENTAGE },
    margins: cellPad,
    shading: { type: ShadingType.CLEAR, fill: HEX('paperSubtle') },
  });
  const valueCell = new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({
          text: value == null ? '–' : String(value),
          font: FONT,
          size: 22, // 11pt
          color: HEX('ink'),
          bold: opts.bold !== false,
        })],
      }),
    ],
    width: { size: 65, type: WidthType.PERCENTAGE },
    margins: cellPad,
  });
  return new TableRow({ children: [labelCell, valueCell] });
};

const buildLabelValueTable = (rows) =>
  new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDER,
  });

const buildHeaderTableRow = (cells) =>
  new TableRow({
    tableHeader: true,
    children: cells.map((label) =>
      new TableCell({
        children: [
          new Paragraph({
            children: [new TextRun({
              text: label,
              font: FONT,
              size: 18, // 9pt
              bold: true,
              color: HEX('paperElevated'),
            })],
          }),
        ],
        shading: { type: ShadingType.CLEAR, fill: HEX('inkDeep') },
        margins: { top: 100, bottom: 100, left: 120, right: 120 },
      }),
    ),
  });

const buildBodyTableRow = (cells, opts = {}) =>
  new TableRow({
    children: cells.map((value) =>
      new TableCell({
        children: [
          new Paragraph({
            children: [new TextRun({
              text: value == null ? '–' : String(value),
              font: FONT,
              size: 20, // 10pt
              color: HEX('ink'),
            })],
          }),
        ],
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        shading: opts.alt ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
      }),
    ),
  });

const aiBadge = () =>
  new Paragraph({
    children: [
      new TextRun({
        text: ' AI-ASSISTED ',
        font: FONT,
        size: 16, // 8pt
        bold: true,
        color: HEX('paperElevated'),
        shading: { type: ShadingType.CLEAR, fill: HEX('accent') },
      }),
      new TextRun({ text: '   Verify against source data before decisions.', font: FONT, size: 16, color: HEX('mutedHigh'), italics: true }),
    ],
    spacing: { before: 60, after: 60 },
  });

const platformBadge = () =>
  new Paragraph({
    children: [
      new TextRun({
        text: ' PLATFORM DATA ',
        font: FONT,
        size: 16,
        bold: true,
        color: HEX('paperElevated'),
        shading: { type: ShadingType.CLEAR, fill: HEX('mutedHigh') },
      }),
      new TextRun({ text: '   Auto-extracted from REDIP records and the deterministic financial kernel.', font: FONT, size: 16, color: HEX('mutedHigh'), italics: true }),
    ],
    spacing: { before: 60, after: 60 },
  });

const blank = () => new Paragraph({ children: [new TextRun({ text: '' })], spacing: { before: 40, after: 40 } });

// ─────────────────────────────────────────────────────────────────────────
// Section builders
// ─────────────────────────────────────────────────────────────────────────

const buildCover = (ctx) => {
  const children = [];

  children.push(eyebrow(`${ctx.brandName} | Underwriting Report`));
  children.push(new Paragraph({
    children: [new TextRun({
      text: ctx.dealTitle,
      font: palette.FONTS.display,
      size: 56, // 28pt
      bold: true,
      color: HEX('inkDeep'),
    })],
    spacing: { before: 240, after: 240 },
  }));
  children.push(bodyPara(`${ctx.assetClassLabel} | ${ctx.dealTypeLabel}`, { bold: true, color: HEX('accent') }));
  children.push(bodyPara(ctx.locationLine || 'Location not provided'));
  children.push(blank());
  children.push(bodyPara(`Generated: ${formatDate(ctx.generatedAt)}`, { color: HEX('mutedHigh'), italic: true }));
  children.push(blank());
  children.push(blank());

  // Disclaimer banner — distinct from in-text badges so reviewers cannot
  // miss it on the first page.
  children.push(new Paragraph({
    children: [
      new TextRun({
        text: ' AI-ASSISTED DRAFT — REQUIRES HUMAN REVIEW ',
        font: FONT,
        size: 22, // 11pt
        bold: true,
        color: HEX('paperElevated'),
        shading: { type: ShadingType.CLEAR, fill: HEX('inkDeep') },
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: 360, after: 240 },
  }));
  children.push(bodyPara(
    'This report combines deterministic platform data (financials, KPIs, comps, scoring) with AI-assisted narrative (interpretation paragraphs, pros & cons synthesis). Every AI-Assisted section is labelled. No section contains AI-generated numerical figures — all numbers come from the platform\'s deterministic financial kernel. Verify all interpretations and recommendations against your source documents before any investment decision.',
    { color: HEX('mutedHigh'), italic: true },
  ));

  return children;
};

const buildExecutiveSummary = (ctx) => {
  const children = [];
  children.push(sectionHeading('Executive Summary', { pageBreakBefore: true }));
  children.push(aiBadge());

  const ic = ctx.icOpinion || ctx.exportContext?.ai;
  if (ic && ic.ic_opinion) {
    children.push(bodyPara(ic.ic_opinion));
    if (ic.confidence) {
      children.push(bodyPara(`Confidence: ${ic.confidence}`, { italic: true, color: HEX('mutedHigh') }));
    }
  } else {
    children.push(bodyPara(
      'AI-generated investor-grade opinion is not available for this deal. Please rely on the structured KPIs and risk register below for decision support.',
      { italic: true, color: HEX('mutedHigh') },
    ));
  }

  children.push(blank());
  children.push(eyebrow('Headline KPIs'));
  children.push(platformBadge());

  const rows = [
    labelValueRow('IRR (project)',    formatPct(ctx.irr, 1)),
    labelValueRow('Equity multiple',  ctx.equityMultiple != null ? `${ctx.equityMultiple.toFixed(2)}x` : '–'),
    labelValueRow('NPV',              formatCrores(ctx.npv, 2)),
    labelValueRow('Gross margin',     formatPct(ctx.grossMargin, 1)),
    labelValueRow('Yield on cost',    formatPct(ctx.yieldOnCost, 2)),
    labelValueRow('Total project cost', formatCrores(ctx.totalCost, 2)),
    labelValueRow('Total revenue',    formatCrores(ctx.totalRevenue, 2)),
    labelValueRow('Composite score',  `${ctx.dealScore.score} / 100 — ${ctx.dealScore.band.replace(/_/g, ' ')}`),
  ];
  children.push(buildLabelValueTable(rows));
  return children;
};

const buildSiteInformation = async (ctx) => {
  const children = [];
  children.push(sectionHeading('Site Information', { pageBreakBefore: true }));
  children.push(platformBadge());

  const rows = [
    labelValueRow('Property name', firstText(ctx.deal.property_name, ctx.deal.name)),
    labelValueRow('Address',       firstText(ctx.deal.property_address, ctx.locationLine)),
    labelValueRow('Locality',      firstText(ctx.deal.locality, ctx.deal.city)),
    labelValueRow('City / State',  [ctx.deal.city, ctx.deal.state].filter(Boolean).join(', ') || '–'),
    labelValueRow('Land area',     formatArea(ctx.landAreaSqft)),
    labelValueRow('Saleable area', formatArea(ctx.saleableAreaSqft)),
    labelValueRow('FSI',           ctx.fsi != null ? `${ctx.fsi}` : '–'),
    labelValueRow('Coordinates',   ctx.coordinates || 'Not geocoded'),
  ];
  children.push(buildLabelValueTable(rows));

  // Site map — only when Google Maps is configured AND we have lat/lng.
  if (ctx.coords) {
    try {
      const mapBuffer = await renderSiteMap({ lat: ctx.coords.lat, lng: ctx.coords.lng, zoom: 15 });
      if (mapBuffer) {
        children.push(blank());
        children.push(eyebrow('Site map'));
        children.push(new Paragraph({
          children: [new ImageRun({
            data: mapBuffer,
            transformation: { width: 540, height: 304 },
            altText: { title: 'Site map', description: `Site location at ${ctx.locationLine}`, name: 'site-map' },
          })],
          alignment: AlignmentType.LEFT,
          spacing: { before: 120, after: 120 },
        }));
        children.push(bodyPara('Source: Google Maps Static API.', { italic: true, color: HEX('mutedHigh') }));
      } else {
        children.push(bodyPara('Site map unavailable — GOOGLE_MAPS_API_KEY not configured or coordinates unresolved.', { italic: true, color: HEX('mutedHigh') }));
      }
    } catch {
      // never throw on map render failure
      children.push(bodyPara('Site map could not be rendered.', { italic: true, color: HEX('mutedHigh') }));
    }
  } else {
    children.push(bodyPara('Site map unavailable — no coordinates on the deal record.', { italic: true, color: HEX('mutedHigh') }));
  }

  return children;
};

const buildOverview = (ctx) => {
  const children = [];
  children.push(sectionHeading('Overview'));
  children.push(platformBadge());

  const rows = [
    labelValueRow('Deal type',       ctx.dealTypeLabel),
    labelValueRow('Deal structure',  ctx.dealStructureLabel),
    labelValueRow('Stage',           ctx.stageLabel),
    labelValueRow('Sponsor / owner', firstText(ctx.deal.owner_name, ctx.deal.sponsor_name) || '–'),
    labelValueRow('Negotiated price',formatCrores(ctx.deal.negotiated_price_cr, 2)),
    labelValueRow('Land ask price',  formatCrores(ctx.deal.land_ask_price_cr, 2)),
    labelValueRow('Investment thesis', firstText(ctx.deal.investment_thesis) || '–'),
  ];
  children.push(buildLabelValueTable(rows));
  return children;
};

const buildComparables = (ctx) => {
  const children = [];
  children.push(sectionHeading('Comparable Transactions'));
  children.push(platformBadge());

  const comps = (ctx.exportContext?.market?.exportComps || []).slice(0, 8);
  if (comps.length === 0) {
    children.push(bodyPara(
      'No verified comparable transactions are available for this micro-market at the time of generation. Manual input required.',
      { italic: true, color: HEX('mutedHigh') },
    ));
    return children;
  }

  const headerRow = buildHeaderTableRow(['Project', 'Developer', 'Type', 'Units', 'Rate / sqft', 'Verified']);
  const bodyRows = comps.map((c, idx) => buildBodyTableRow([
    firstText(c.project_name) || '–',
    firstText(c.developer) || '–',
    firstText(c.project_type, c.bhk_config) || '–',
    c.total_units != null ? String(c.total_units) : '–',
    c.rate_per_sqft != null ? formatRate(c.rate_per_sqft) : '–',
    c.is_verified === false ? 'No' : 'Yes',
  ], { alt: idx % 2 === 1 }));

  children.push(new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDER,
  }));
  return children;
};

const buildFinancials = (ctx) => {
  const children = [];
  children.push(sectionHeading('Financials & KPIs'));
  children.push(platformBadge());

  const rows = [
    labelValueRow('Total cost',         formatCrores(ctx.totalCost, 2)),
    labelValueRow('Total revenue',      formatCrores(ctx.totalRevenue, 2)),
    labelValueRow('Gross profit',       ctx.totalRevenue != null && ctx.totalCost != null ? formatCrores(ctx.totalRevenue - ctx.totalCost, 2) : '–'),
    labelValueRow('Gross margin',       formatPct(ctx.grossMargin, 1)),
    labelValueRow('IRR (project)',      formatPct(ctx.irr, 1)),
    labelValueRow('NPV',                formatCrores(ctx.npv, 2)),
    labelValueRow('Equity multiple',    ctx.equityMultiple != null ? `${ctx.equityMultiple.toFixed(2)}x` : '–'),
    labelValueRow('Yield on cost',      formatPct(ctx.yieldOnCost, 2)),
    labelValueRow('NOI',                formatCrores(ctx.noi, 2)),
    labelValueRow('Exit value',         formatCrores(ctx.exitValue, 2)),
    labelValueRow('Residual land value',formatCrores(ctx.residualLandValue, 2)),
  ];
  children.push(buildLabelValueTable(rows));
  return children;
};

const buildProsCons = (ctx) => {
  const children = [];
  children.push(sectionHeading('Pros & Cons'));
  children.push(aiBadge());

  const prosCons = ctx.prosCons || {};
  const pros = Array.isArray(prosCons.pros) ? prosCons.pros : [];
  const cons = Array.isArray(prosCons.cons) ? prosCons.cons : [];

  if (pros.length === 0 && cons.length === 0) {
    children.push(bodyPara(
      'AI-assisted Pros & Cons synthesis is not available for this deal. Please refer to the structured KPIs, risk register, and DD log for decision support.',
      { italic: true, color: HEX('mutedHigh') },
    ));
    return children;
  }

  // Two-column table — Pros left, Cons right.
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: 'Pros', font: FONT, size: 22, bold: true, color: HEX('paperElevated') })] })],
        shading: { type: ShadingType.CLEAR, fill: HEX('dataPositive') },
        margins: { top: 100, bottom: 100, left: 120, right: 120 },
        width: { size: 50, type: WidthType.PERCENTAGE },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: 'Cons', font: FONT, size: 22, bold: true, color: HEX('paperElevated') })] })],
        shading: { type: ShadingType.CLEAR, fill: HEX('dataNegative') },
        margins: { top: 100, bottom: 100, left: 120, right: 120 },
        width: { size: 50, type: WidthType.PERCENTAGE },
      }),
    ],
  });

  const rowCount = Math.max(pros.length, cons.length);
  const bodyRows = [];
  for (let i = 0; i < rowCount; i += 1) {
    bodyRows.push(new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: pros[i] ? `+ ${pros[i]}` : '', font: FONT, size: 20, color: HEX('ink') })] })],
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          width: { size: 50, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: cons[i] ? `− ${cons[i]}` : '', font: FONT, size: 20, color: HEX('ink') })] })],
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          width: { size: 50, type: WidthType.PERCENTAGE },
        }),
      ],
    }));
  }

  children.push(new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDER,
  }));
  return children;
};

const buildOverallScore = (ctx) => {
  const children = [];
  children.push(sectionHeading('Overall Score'));
  children.push(platformBadge());

  children.push(new Paragraph({
    children: [new TextRun({
      text: `${ctx.dealScore.score} / 100`,
      font: palette.FONTS.display,
      size: 96, // 48pt
      bold: true,
      color: HEX('inkDeep'),
    })],
    spacing: { before: 120, after: 60 },
  }));
  children.push(bodyPara(
    `Band: ${ctx.dealScore.band.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`,
    { bold: true, color: HEX('accent') },
  ));
  if (ctx.dealScore.benchmark.assetClass) {
    children.push(bodyPara(
      `Benchmarked against ${ctx.assetClassLabel} (IRR target ${ctx.dealScore.benchmark.irrTarget}%, EM target ${ctx.dealScore.benchmark.emTarget}x).`,
      { italic: true, color: HEX('mutedHigh') },
    ));
  }

  children.push(blank());
  children.push(eyebrow('Weight breakdown'));

  const headerRow = buildHeaderTableRow(['Component', 'Awarded', 'Max', 'Reason']);
  const bodyRows = ctx.dealScore.breakdown.map((row, idx) => buildBodyTableRow([
    row.component,
    String(row.awarded),
    String(row.max),
    row.reason,
  ], { alt: idx % 2 === 1 }));

  children.push(new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDER,
  }));
  return children;
};

const buildDisclaimer = (ctx) => {
  const children = [];
  children.push(sectionHeading('Disclaimer', { pageBreakBefore: true }));

  children.push(bodyPara(
    'This report is an AI-assisted draft generated by REDIP from stored deal data and verified market sources. It is intended for internal investment review and is not a recommendation to buy, sell, or otherwise transact in any property or security.',
  ));
  children.push(blank());
  children.push(eyebrow('AI-Assisted vs Platform Data'));
  children.push(bodyPara(
    'Sections labelled "AI-Assisted" (Executive Summary IC opinion, Pros & Cons synthesis) contain interpretation generated by large language models from structured payload data. AI never generates specific numerical figures in this report; all numbers come from the platform\'s deterministic financial kernel. Verify every interpretation against the underlying data before relying on it.',
  ));
  children.push(blank());
  children.push(bodyPara(
    'Sections labelled "Platform Data" (Site Information, Comparables, Financials, Overall Score) are auto-extracted from REDIP records and the deterministic engine. Treat them as faithful representations of the data captured in REDIP at generation time, not as warranted facts.',
  ));
  children.push(blank());
  children.push(eyebrow('Hard rules'));
  children.push(bodyPara(
    '• REDIP does not warrant zoning, legal title, RERA registration, encumbrance status, approval status, or any other regulatory fact in this document. Where the data is missing or unverifiable, the report explicitly says so. Independent verification through Karnataka land-records (Bhoomi / Kaveri portal) and Karnataka RERA is required before any investment decision.',
  ));
  children.push(bodyPara(
    '• Comparables are limited to those verified in REDIP. Market intelligence is current as of the generation date shown on the cover; confirm freshness against external sources.',
  ));
  children.push(bodyPara(
    '• This report is confidential and prepared for internal use only.',
  ));
  children.push(blank());
  children.push(bodyPara(
    `Generated by ${ctx.brandName} on ${formatDate(ctx.generatedAt)}.`,
    { italic: true, color: HEX('mutedHigh') },
  ));
  return children;
};

// ─────────────────────────────────────────────────────────────────────────
// Context builder + entry point
// ─────────────────────────────────────────────────────────────────────────

const ASSET_CLASS_LABELS = {
  residential_apartments: 'Residential Apartments',
  plotted_development: 'Plotted Development',
  villas: 'Villas',
  commercial_office: 'Commercial Office',
  retail: 'Retail',
  industrial_warehousing: 'Industrial & Warehousing',
  hospitality: 'Hospitality',
  mixed_use: 'Mixed Use',
  raw_land: 'Raw Land',
  redevelopment: 'Redevelopment',
};
const DEAL_TYPE_LABELS = {
  acquisition: 'Acquisition', jv: 'Joint Venture', da: 'Development Agreement', outright: 'Outright',
  jda: 'Joint Development Agreement', debt: 'Debt Raise', lease: 'Lease Yield',
};
const DEAL_STRUCTURE_LABELS = {
  outright: 'Outright Purchase', jv: 'Joint Venture', jda: 'Joint Development Agreement',
  revenue_share: 'Revenue Share', area_share: 'Area Share', profit_share: 'Profit Share',
  ground_lease: 'Ground Lease', hybrid: 'Hybrid Structure',
};
const STAGE_LABELS = {
  sourced: 'Sourced', screening: 'Screening', site_visit: 'Site Visit', loi: 'LOI',
  due_diligence: 'Due Diligence', underwriting: 'Underwriting', ic_review: 'IC Review',
  negotiation: 'Negotiation', active: 'Active', closed: 'Closed', dead: 'Dead',
};

const buildReportContext = (exportContext = {}, options = {}) => {
  const deal = exportContext.deal || {};
  const property = exportContext.property || {};
  const model = deal.model_params || {};
  const inputs = model.inputs || {};
  const modelKpis = model.kpis || {};

  const irr = firstNumber(deal.irr_pct, modelKpis.irr);
  const equityMultiple = firstNumber(deal.equity_multiple, modelKpis.equityMultiple);
  const npv = firstNumber(deal.npv_cr, modelKpis.npv);
  const grossMargin = firstNumber(deal.gross_margin_pct, modelKpis.grossMarginPct);
  const totalCost = firstNumber(deal.total_cost_cr, modelKpis.totalCost);
  const totalRevenue = firstNumber(deal.total_revenue_cr, modelKpis.totalRevenue);
  const yieldOnCost = firstNumber(deal.yield_on_cost_pct, modelKpis.yieldOnCost);
  const noi = firstNumber(deal.noi_cr, deal.stabilized_noi_cr, modelKpis.noi);
  const exitValue = firstNumber(deal.exit_value_cr, modelKpis.exitValue);
  const residualLandValue = firstNumber(deal.residual_land_value_cr, modelKpis.rlv);

  const landAreaSqft = firstNumber(property.land_area_sqft, deal.land_area_sqft);
  const saleableAreaSqft = firstNumber(property.saleable_area_sqft, deal.saleable_area_sqft);
  const fsi = firstNumber(property.existing_fsi, inputs.fsi);

  const lat = num(deal.property_lat) ?? num(property.coordinates?.latitude);
  const lng = num(deal.property_lng) ?? num(property.coordinates?.longitude);
  const coords = lat != null && lng != null ? { lat, lng } : null;

  const assetClass = deal.asset_class || 'residential_apartments';

  const riskSummary = exportContext.risks?.summary || {};
  const ddSummary = exportContext.dd?.summary || exportContext.diligence?.summary || {};
  const ddTotal = num(ddSummary.total_required) || num(ddSummary.total) || 0;
  const ddDone = num(ddSummary.completed_required) || num(ddSummary.completed) || 0;
  const ddCompletionPct = ddTotal > 0 ? Math.round((ddDone / ddTotal) * 100) : null;

  const dealScore = computeDealScore({
    assetClass,
    irrPct: irr,
    equityMultiple,
    grossMarginPct: grossMargin,
    ddCompletionPct,
    riskCounts: {
      critical: num(riskSummary.critical) || 0,
      high: num(riskSummary.high) || 0,
      medium: num(riskSummary.medium) || 0,
      low: num(riskSummary.low) || 0,
    },
    financialModelPresent: !!(totalCost != null || totalRevenue != null || irr != null),
  });

  return {
    exportContext,
    deal,
    property,
    inputs,
    irr, equityMultiple, npv, grossMargin, totalCost, totalRevenue,
    yieldOnCost, noi, exitValue, residualLandValue,
    landAreaSqft, saleableAreaSqft, fsi,
    coords,
    coordinates: coords ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : null,
    assetClass,
    assetClassLabel: ASSET_CLASS_LABELS[assetClass] || assetClass,
    dealTypeLabel: DEAL_TYPE_LABELS[deal.deal_type] || deal.deal_type || 'Acquisition',
    dealStructureLabel: DEAL_STRUCTURE_LABELS[deal.deal_structure] || deal.deal_structure || '–',
    stageLabel: STAGE_LABELS[deal.stage] || deal.stage || '–',
    dealTitle: firstText(deal.name, property.property_name) || 'Underwriting Report',
    locationLine: firstText([deal.city, deal.state].filter(Boolean).join(', '), deal.property_address, deal.city) || 'Location not provided',
    icOpinion: exportContext.ai || null,
    dealScore,
    brandName: options.brandName || 'REDIP',
    generatedAt: options.generatedAt || exportContext.generatedAt || new Date().toISOString(),
  };
};

const buildDealReportDocx = async (exportContext = {}, options = {}) => {
  const ctx = buildReportContext(exportContext, options);

  // Prefetch AI Pros & Cons in parallel with section assembly. Never throws.
  const prosConsPromise = generateSection({
    section: 'prosCons',
    payload: {
      kpis: { irrPct: ctx.irr, npvCr: ctx.npv, equityMultiple: ctx.equityMultiple, grossMarginPct: ctx.grossMargin, totalCostCr: ctx.totalCost, totalRevenueCr: ctx.totalRevenue },
      asset_class: ctx.assetClass,
      deal_type: ctx.dealTypeLabel,
      locality: ctx.locationLine,
      risk_flags: (exportContext.risks?.items || []).slice(0, 5),
      approvals: exportContext.approvals?.summary,
    },
    dealId: ctx.deal.id || null,
    organizationId: ctx.deal.organization_id || null,
  }).catch(() => ({ available: false, pros: [], cons: [], reason: 'narrative call failed' }));

  // Build site info section (async — Google Maps call). Never throws.
  const [prosCons, siteSection] = await Promise.all([
    prosConsPromise,
    buildSiteInformation(ctx),
  ]);
  ctx.prosCons = prosCons;

  const documentChildren = [
    ...buildCover(ctx),
    ...buildExecutiveSummary(ctx),
    ...siteSection,
    ...buildOverview(ctx),
    ...buildComparables(ctx),
    ...buildFinancials(ctx),
    ...buildProsCons(ctx),
    ...buildOverallScore(ctx),
    ...buildDisclaimer(ctx),
  ];

  const doc = new Document({
    creator: options.userName || ctx.brandName,
    company: ctx.brandName,
    title: `${ctx.dealTitle} | Underwriting Report`,
    description: `${ctx.assetClassLabel} | ${ctx.dealTypeLabel} — generated ${formatDate(ctx.generatedAt)}`,
    styles: {
      default: {
        document: { run: { font: FONT, size: 22, color: HEX('ink') } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }, // ~0.75"
          },
        },
        headers: {
          default: new Header({
            children: [new Paragraph({
              children: [new TextRun({
                text: `${ctx.brandName}   |   ${ctx.dealTitle}   |   AI-Assisted Draft`,
                font: FONT, size: 16, color: HEX('mutedHigh'), italics: true,
              })],
              alignment: AlignmentType.RIGHT,
            })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              children: [
                new TextRun({ text: `Page `, font: FONT, size: 16, color: HEX('mutedHigh') }),
                new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: HEX('mutedHigh') }),
                new TextRun({ text: ` of `, font: FONT, size: 16, color: HEX('mutedHigh') }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: HEX('mutedHigh') }),
              ],
              alignment: AlignmentType.RIGHT,
            })],
          }),
        },
        children: documentChildren,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
};

module.exports = {
  buildDealReportDocx,
  // Internal exports for tests.
  __internal: {
    buildReportContext,
    formatNumber,
    formatCrores,
    formatPct,
    formatArea,
    formatRate,
    ASSET_CLASS_LABELS,
    DEAL_TYPE_LABELS,
    DEAL_STRUCTURE_LABELS,
    STAGE_LABELS,
  },
};
