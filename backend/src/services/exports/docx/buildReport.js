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
// PR-NX18 (2026-05-16): asset-class × deal-structure × exit-strategy aware
// briefing — shared across XLSX, DOCX, PPTX. Same service, same narrative
// for the same deal, regardless of which format an IC reviewer downloads.
const { generateDealBriefing } = require('../xlsx/v2/dealBriefing.service');
const {
  renderCapitalStackDonutSvg,
  renderCashFlowTrendSvg,
  renderTornadoSvg,
  FALLBACK_PNG_BUFFER,
} = require('../shared/chartSvg.service');

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
  if (parsed === null || parsed === 0) return '–';
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

// ──────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────
// PR-NX37 (2026-05-17) — Table of Contents (static, deterministic)
// ─────────────────────────────────────────────────────────────────────
//
// Word's native TableOfContents requires the reader to press F9 / "Update
// Field" before the entries populate. That's an awful UX for an LP / IC
// reviewer who opens the file in Google Docs preview or Word Online and
// sees an empty TOC instead of the section list.
//
// Instead we render a deterministic static ToC that lists every section
// in the order the orchestrator assembles them. No bookmarks, no field
// updates — just an institutional convention of "here's what's in this
// document." Numbered for quick reference: "see section 11 for the risk
// register."
//
// Position: right after Cover, before AI-Assisted Briefing. The reviewer
// sees the full report shape before reading any single section.

const SECTION_ORDER = [
  'AI-Assisted Briefing',
  'Executive Summary',
  'Site Information',
  'Overview',
  'Demographics',
  'Why This Area',
  'Job Growth & Micro-Market',
  'Social Infrastructure',
  'Supply & Demand Pipeline',
  'Comparable Transactions',
  'Better Alternatives in this Micro-Market',
  'Financials & KPIs',
  'Risk Register',
  'Due Diligence Status',
  'Approvals Tracker',
  'Provenance & Source Register',
  'Document-Derived Insights', // PR-NX45 (2026-05-18)
  'Pros & Cons',
  'Overall Score',
  'Methodology & Assumptions',
  'Disclaimer',
];

const buildTableOfContents = (ctx) => {
  const children = [];
  children.push(sectionHeading('Table of Contents', { pageBreakBefore: true }));
  children.push(bodyPara(
    'Every section in this underwriting report, in the order they appear. Sections marked AI-Assisted carry interpretation generated by large language models from structured payload data — never numerical figures. Verify each interpretation against the underlying data.',
    { italic: true, color: HEX('mutedHigh') },
  ));

  const aiSectionsSet = new Set([
    'AI-Assisted Briefing',
    'Executive Summary',
    'Why This Area',
    'Pros & Cons',
  ]);

  SECTION_ORDER.forEach((label, idx) => {
    const isAi = aiSectionsSet.has(label);
    const numText = String(idx + 1).padStart(2, ' ');
    children.push(new Paragraph({
      spacing: { before: 60, after: 60 },
      children: [
        new TextRun({
          text: `${numText}.  `,
          font: FONT, size: 20, color: HEX('mutedHigh'),
        }),
        new TextRun({
          text: label,
          font: FONT, size: 22, color: HEX('ink'),
        }),
        new TextRun({
          text: isAi ? '   · AI-Assisted' : '   · Platform Data',
          font: FONT, size: 16, italics: true,
          color: isAi ? HEX('accent') : HEX('mutedHigh'),
        }),
      ],
    }));
  });

  children.push(bodyPara(
    `Generated by ${ctx.brandName} on ${formatDate(ctx.generatedAt)} from REDIP deal data. All numerical figures are computed by the deterministic TypeScript financial kernel — no AI numerics.`,
    { italic: true, color: HEX('mutedHigh'), size: 16 },
  ));
  return children;
};

// PR-NX18 (2026-05-16) — AI-Assisted Briefing section (cross-product parity)
// ──────────────────────────────────────────────────────────────────────
//
// Mirrors the XLSX Executive Briefing tab (PR-NX7 / PR-NX12) and the
// PPTX briefing slide. Same asset-class × deal-structure × exit-strategy
// aware narrative — so an IC reviewer reading the DOCX, XLSX, or PPTX
// for the same deal sees identical headline language.
//
// Per CLAUDE.md hard rule: prominent "AI-Assisted — REQUIRES HUMAN
// REVIEW" banner. Mandatory amber/inkDeep disclosure header.
const buildBriefingSection = (ctx) => {
  const children = [];
  const briefing = ctx.briefing || null;
  // PR-NX21 (2026-05-16): briefing source can be 'ai-assisted-claude',
  // 'ai-assisted-openai', or 'templated'. The startsWith check covers
  // both AI paths; specific provider surfaces via `briefing.provider`.
  const isAiAssisted = typeof briefing?.source === 'string' && briefing.source.startsWith('ai-assisted');
  const providerLabel = isAiAssisted ? (briefing.provider || 'Claude Sonnet 4.6') : 'deterministic templated fallback';

  children.push(sectionHeading('AI-Assisted Briefing', { pageBreakBefore: true }));

  // Mandatory disclosure banner (amber background; mirrors XLSX briefing)
  children.push(new Paragraph({
    children: [
      new TextRun({
        text: isAiAssisted
          ? ` ⚠ AI-Assisted Briefing (synthesis: ${providerLabel}) — REQUIRES HUMAN REVIEW `
          : ' ⚠ AI-Assisted Briefing (synthesis: deterministic templated fallback) — REQUIRES HUMAN REVIEW ',
        font: FONT,
        size: 22, // 11pt
        bold: true,
        color: HEX('paperElevated'),
        shading: { type: ShadingType.CLEAR, fill: HEX('dataWarning') || 'C97B0E' },
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
  }));

  children.push(bodyPara(
    isAiAssisted
      ? 'All numbers sourced from REDIP\'s deterministic financial kernel + Inputs sheet (no fabrication). Verify against source documents (sale deed, RERA registration, encumbrance certificate, BBMP plan sanction) before any IC decision.'
      : 'AI path unavailable; narrative generated from kernel KPIs + Inputs by deterministic template. Verify against source documents before any IC decision.',
    { italic: true, color: HEX('mutedHigh') },
  ));

  children.push(blank());

  // Modeled Returns summary (one-liner)
  children.push(eyebrow('Modeled Returns'));
  children.push(bodyPara(
    briefing?.summary || 'Returns pending kernel computation — fill in inputs and refresh the deal.',
    { bold: true, color: HEX('inkDeep') },
  ));

  children.push(blank());

  // Key Points — 4 asset-class-aware bullets
  children.push(eyebrow('Key Points'));
  const bullets = Array.isArray(briefing?.bullets) ? briefing.bullets : [];
  if (bullets.length === 0) {
    children.push(bodyPara(
      'Briefing bullets pending. Populate the Inputs sheet and refresh the deal to generate.',
      { italic: true, color: HEX('mutedHigh') },
    ));
  } else {
    bullets.forEach((bullet) => {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: '•  ', font: FONT, size: 22, bold: true, color: HEX('accent') }),
          new TextRun({ text: String(bullet || ''), font: FONT, size: 22, color: HEX('ink') }),
        ],
        spacing: { before: 80, after: 80 },
        indent: { left: 200 },
      }));
    });
  }

  children.push(blank());

  // Risk Note — full-width crimson banner with the asset-class-specific risk
  if (briefing?.riskNote) {
    children.push(eyebrow('Risk Note'));
    children.push(new Paragraph({
      children: [
        new TextRun({
          text: ` ${briefing.riskNote} `,
          font: FONT,
          size: 22,
          bold: true,
          color: HEX('paperElevated'),
          shading: { type: ShadingType.CLEAR, fill: HEX('dataNegative') || 'B23A48' },
        }),
      ],
      spacing: { before: 120, after: 120 },
    }));
  }

  children.push(blank());

  // Generation metadata footer
  // PR-NX21: surface auto-failover state. If the SECONDARY provider rescued
  // the briefing (primary failed → alternate succeeded), include the WHY
  // so operators know to investigate the primary key/quota.
  const failoverNote = briefing?.fallbackReason
    ? ` · auto-failover: ${briefing.fallbackReason}`
    : '';
  children.push(bodyPara(
    `Generated: ${formatDate(ctx.generatedAt)} · Synthesis: ${providerLabel} · Per-deal snapshot cached${failoverNote}. This briefing mirrors the AI-assisted Executive Briefing tab in the XLSX export and the AI-Assisted Briefing slide in the PPTX deck — all three reuse the same shared service for cross-product consistency.`,
    { italic: true, color: HEX('mutedLow'), color2: HEX('mutedHigh') },
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
    // PR-NX40 (2026-05-18): combine confidence + provider + auto-failover
    // diagnostic into a single attribution line so the reader knows which
    // model produced the opinion AND when a fallback rescued the call.
    const attribution = [];
    if (ic.confidence) attribution.push(`Confidence: ${ic.confidence}`);
    if (ic.provider)   attribution.push(`Synthesis: ${ic.provider}`);
    if (ic.fallbackReason) attribution.push(`auto-failover: ${ic.fallbackReason}`);
    if (attribution.length) {
      children.push(bodyPara(attribution.join(' · '), { italic: true, color: HEX('mutedHigh') }));
    }
  } else {
    // PR-NX40 (2026-05-18): surface the WHY when both providers failed
    // so the operator knows whether it's a key issue, rate-limit, or
    // outage — instead of a silent "not available" with no diagnostic.
    const reason = ic?.reason ? ` (cause: ${ic.reason})` : '';
    children.push(bodyPara(
      `AI-generated investor-grade opinion is not available for this deal${reason}. Please rely on the structured KPIs and risk register below for decision support.`,
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

// ─── Phase-2 sections ────────────────────────────────────────────────
// Six additional sections promised in the original rewrite plan. They
// surface real data when present and fall back to honest "manual input
// required" empty states per CLAUDE.md when data isn't yet populated —
// no fabrication, no placeholder filler.

const buildDemographics = (ctx) => {
  const children = [];
  children.push(sectionHeading('Demographics'));
  children.push(platformBadge());

  const demo = ctx.exportContext?.market?.demographics
    || ctx.exportContext?.demographics
    || {};
  const populated = Object.keys(demo).some((k) => demo[k] != null && demo[k] !== '');

  if (populated) {
    // PR-NX41 (2026-05-18): when a Bengaluru deal has auto_derived_pd_code
    // populated, dealExport.service.fetchDealDemographics joins through to
    // BBMP RMP-2031 + Census 2011 facts. Surface the PD identity line at
    // the top of the section so the reader sees WHICH planning district
    // these facts describe, then the demographic rows.
    if (demo.pd_name || demo.pd_code) {
      const pdLabel = [demo.pd_name, demo.pd_code ? `(${demo.pd_code})` : null]
        .filter(Boolean)
        .join(' ');
      children.push(bodyPara(
        `Planning District: ${pdLabel}${demo.city ? ` · ${demo.city}` : ''}`,
        { italic: true, color: HEX('mutedHigh') },
      ));
    }

    const rows = [
      // Census-shape fields (existing renderer keys, kept for forward-compat)
      demo.population_total      != null ? labelValueRow('Population (2011 census)',   formatNumber(demo.population_total)) : null,
      demo.population_density    != null ? labelValueRow('Population density',         `${formatNumber(demo.population_density)} / sq km`) : null,
      // PR-NX41 (2026-05-18) — PD-specific extras (BBMP RMP-2031 facts)
      demo.area_ha               != null ? labelValueRow('Planning District area',    `${formatNumber(demo.area_ha, 1)} hectares (${formatNumber(demo.area_ha / 100, 2)} km²)`) : null,
      demo.wards_in_pd           != null ? labelValueRow('BBMP wards in PD',          formatNumber(demo.wards_in_pd)) : null,
      demo.villages_count        != null ? labelValueRow('Revenue villages',          formatNumber(demo.villages_count)) : null,
      // Census fields not present in RMP data (rendered when manually populated)
      demo.median_age            != null ? labelValueRow('Median age',                 `${formatNumber(demo.median_age, 1)} years`) : null,
      demo.median_household_inr  != null ? labelValueRow('Median household income',    `INR ${formatNumber(demo.median_household_inr, 1)} L / yr`) : null,
      demo.income_tier           != null ? labelValueRow('Income tier',                String(demo.income_tier)) : null,
      demo.literacy_pct          != null ? labelValueRow('Literacy',                   `${formatNumber(demo.literacy_pct, 1)}%`) : null,
      demo.working_population_pct != null ? labelValueRow('Working population',        `${formatNumber(demo.working_population_pct, 1)}%`) : null,
    ].filter(Boolean);
    children.push(buildLabelValueTable(rows));

    // PR-NX41 (2026-05-18) — render the optional notes field (e.g.,
    // "Eastern BMA growth corridor, mixed industrial-residential") as a
    // single italic line below the table.
    if (demo.notes) {
      children.push(bodyPara(demo.notes, { italic: true, color: HEX('mutedHigh') }));
    }

    // Provenance line — operator can verify which dataset the figures came from.
    if (demo.source) {
      children.push(bodyPara(
        `Source: ${demo.source}${demo.vintage ? ` · ${demo.vintage}` : ''}`,
        { italic: true, color: HEX('mutedLow') },
      ));
    }
  } else {
    children.push(bodyPara(
      'Demographic data is not yet available for this micro-market. Manual input required — populate population, income tier, age mix, and literacy on the deal\'s market record before this section can render.',
      { italic: true, color: HEX('mutedHigh') },
    ));
    children.push(bodyPara(
      // PR-NX41 (2026-05-18) — actionable hint for Bengaluru deals
      'Bengaluru deals: open the Parcel tab → click "Derive parcel context" → Apply → re-download the report. The Planning District code unlocks BBMP RMP-2031 + Census 2011 facts.',
      { italic: true, color: HEX('mutedLow') },
    ));
  }
  return children;
};

const buildWhyThisArea = (ctx) => {
  const children = [];
  children.push(sectionHeading('Why This Area'));
  children.push(aiBadge());

  const wta = ctx.whyThisArea || { available: false };
  if (wta.available && Array.isArray(wta.paragraphs) && wta.paragraphs.length > 0) {
    wta.paragraphs.forEach((p) => {
      if (p && String(p).trim()) children.push(bodyPara(p));
    });
    if (wta.summary) {
      children.push(blank());
      children.push(bodyPara(`Summary: ${wta.summary}`, { bold: true, color: HEX('accent') }));
    }
    if (Array.isArray(wta.sources) && wta.sources.length > 0) {
      children.push(bodyPara(
        `Synthesised from: ${wta.sources.join(', ')}.`,
        { italic: true, color: HEX('mutedHigh') },
      ));
    }
  } else {
    children.push(bodyPara(
      'AI-assisted synthesis of why this micro-market matters could not be generated for this deal. ' +
      'Populate locality, infrastructure proximity, and intelligence briefs on the deal record to enable this section.',
      { italic: true, color: HEX('mutedHigh') },
    ));
  }
  return children;
};

const buildJobGrowth = (ctx) => {
  const children = [];
  children.push(sectionHeading('Job Growth & Micro-Market'));
  children.push(platformBadge());

  const briefs = ctx.exportContext?.market?.intelligence_briefs
    || ctx.exportContext?.intelligence_briefs
    || [];
  const jobGrowthBriefs = (Array.isArray(briefs) ? briefs : [])
    .filter((b) => /job|employment|hiring|gcc|tech|workforce|economic/i.test(String(b.theme || b.title || b.summary || '')))
    .slice(0, 4);

  if (jobGrowthBriefs.length > 0) {
    children.push(bodyPara(`${jobGrowthBriefs.length} verified intelligence brief${jobGrowthBriefs.length > 1 ? 's' : ''} relevant to job growth and micro-market employment context:`));
    children.push(blank());
    jobGrowthBriefs.forEach((brief, idx) => {
      const title = firstText(brief.title, brief.theme) || `Brief ${idx + 1}`;
      const summary = firstText(brief.summary, brief.detail) || '';
      const dateStr = brief.published_at || brief.date ? formatDate(brief.published_at || brief.date) : null;
      children.push(bodyPara(title, { bold: true }));
      if (summary) children.push(bodyPara(summary));
      if (dateStr) children.push(bodyPara(`Dated: ${dateStr}`, { italic: true, color: HEX('mutedHigh') }));
      children.push(blank());
    });
  } else {
    children.push(bodyPara(
      'No verified intelligence briefs on micro-market job growth are linked to this deal yet. Manual input required — populate Market Intelligence with relevant briefs (GCC announcements, tech-park expansions, employment-area trends) to surface this section.',
      { italic: true, color: HEX('mutedHigh') },
    ));
  }
  return children;
};

const buildSocialInfrastructure = (ctx) => {
  const children = [];
  children.push(sectionHeading('Social Infrastructure'));
  children.push(platformBadge());

  const infra = ctx.exportContext?.infra_proximity
    || ctx.exportContext?.market?.infra_proximity
    || ctx.exportContext?.deal?.infra_proximity
    || {};

  // Buckets we report on, with the keys we look for in the source object.
  const buckets = [
    { label: 'Schools / education',    keys: ['schools', 'school', 'education'] },
    { label: 'Hospitals / healthcare', keys: ['hospitals', 'hospital', 'healthcare'] },
    { label: 'Retail / malls',         keys: ['retail', 'malls', 'mall', 'shopping'] },
    { label: 'Office / business parks', keys: ['offices', 'office', 'business_park', 'tech_park'] },
    { label: 'Metro / transit',        keys: ['metro', 'transit', 'rail', 'station'] },
    { label: 'Expressway / highway',   keys: ['highway', 'expressway', 'arterial'] },
    { label: 'Airport',                keys: ['airport'] },
    { label: 'Port',                   keys: ['port', 'seaport'] },
  ];

  const findBucket = (keys) => {
    for (const k of keys) {
      if (infra[k] != null) return infra[k];
    }
    return null;
  };

  const populatedRows = buckets.map((b) => {
    const value = findBucket(b.keys);
    if (value == null) return null;
    // Value can be a string ("2.3 km, 5 schools") or an object ({ count, nearest_km })
    if (typeof value === 'string' || typeof value === 'number') {
      return { label: b.label, value: String(value) };
    }
    if (typeof value === 'object') {
      const parts = [];
      if (value.count != null) parts.push(`${value.count} within radius`);
      if (value.nearest_km != null) parts.push(`nearest ${formatNumber(value.nearest_km, 1)} km`);
      if (value.note) parts.push(value.note);
      return { label: b.label, value: parts.join(' · ') || '–' };
    }
    return null;
  }).filter(Boolean);

  if (populatedRows.length > 0) {
    const headerRow = buildHeaderTableRow(['Category', 'Distance / Count']);
    const bodyRows = populatedRows.map((r, idx) => buildBodyTableRow([r.label, r.value], { alt: idx % 2 === 1 }));
    children.push(new Table({
      rows: [headerRow, ...bodyRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDER,
    }));
  } else {
    children.push(bodyPara(
      'Social infrastructure proximity has not been ingested for this deal yet. Manual input required — populate the Property record with distances to nearby schools, hospitals, retail, transit, airport, and expressway.',
      { italic: true, color: HEX('mutedHigh') },
    ));
  }
  return children;
};

const buildSupplyDemand = (ctx) => {
  const children = [];
  children.push(sectionHeading('Supply & Demand Pipeline'));
  children.push(platformBadge());

  const txns = ctx.exportContext?.market?.market_transactions
    || ctx.exportContext?.market_transactions
    || [];
  const benches = ctx.exportContext?.market?.micro_market_benchmarks
    || ctx.exportContext?.market?.cityBenchmarks
    || [];

  const recentTxns = (Array.isArray(txns) ? txns : []).slice(0, 5);
  const recentBenches = (Array.isArray(benches) ? benches : []).slice(0, 5);

  if (recentTxns.length === 0 && recentBenches.length === 0) {
    children.push(bodyPara(
      'No verified market transactions or micro-market benchmarks are linked to this deal yet. Manual input required — ingest recent transactions and benchmark medians from your verified comp source to enable this section.',
      { italic: true, color: HEX('mutedHigh') },
    ));
    return children;
  }

  if (recentTxns.length > 0) {
    children.push(bodyPara('Recent transactions in the micro-market:', { bold: true }));
    const headerRow = buildHeaderTableRow(['Project / Property', 'Type', 'Date', 'Rate / sqft']);
    const bodyRows = recentTxns.map((t, idx) => buildBodyTableRow([
      firstText(t.project_name, t.property_name) || '–',
      firstText(t.transaction_type, t.deal_type, t.asset_class) || '–',
      t.transaction_date ? formatDate(t.transaction_date) : '–',
      t.rate_per_sqft != null ? formatRate(t.rate_per_sqft) : '–',
    ], { alt: idx % 2 === 1 }));
    children.push(new Table({
      rows: [headerRow, ...bodyRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDER,
    }));
    children.push(blank());
  }

  if (recentBenches.length > 0) {
    children.push(bodyPara('Verified micro-market benchmarks:', { bold: true }));
    const headerRow = buildHeaderTableRow(['Micro-market', 'Median rate', 'Source']);
    const bodyRows = recentBenches.map((b, idx) => buildBodyTableRow([
      firstText(b.micro_market, b.locality, b.metric_display_name) || '–',
      b.value_numeric != null ? `${formatRate(b.value_numeric)}${b.unit ? ` (${b.unit})` : ''}`
        : (b.median_rate_per_sqft != null ? formatRate(b.median_rate_per_sqft) : '–'),
      firstText(b.source_name, b.source) || '–',
    ], { alt: idx % 2 === 1 }));
    children.push(new Table({
      rows: [headerRow, ...bodyRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDER,
    }));
  }

  return children;
};

const buildBetterAlternatives = (ctx) => {
  const children = [];
  children.push(sectionHeading('Better Alternatives in this Micro-Market'));
  children.push(platformBadge());

  // Use the verified comp set as the alternatives universe — sorted by
  // rate/sqft proximity to the deal's modeled sell rate (closer = more
  // comparable). Top 3 surface here; honest empty-state when none.
  const comps = (ctx.exportContext?.market?.exportComps || [])
    .filter((c) => c.is_verified !== false && c.rate_per_sqft != null);

  if (comps.length === 0) {
    children.push(bodyPara(
      'No verified peer alternatives are currently linked to this deal. Manual input required — populate the comp set with verified transactions in the same micro-market.',
      { italic: true, color: HEX('mutedHigh') },
    ));
    return children;
  }

  const dealRate = ctx.modelSellRate || ctx.deal?.selling_rate_per_sqft;
  const sorted = [...comps].sort((a, b) => {
    if (dealRate == null) return 0;
    return Math.abs(a.rate_per_sqft - dealRate) - Math.abs(b.rate_per_sqft - dealRate);
  });
  const top3 = sorted.slice(0, 3);

  children.push(bodyPara(
    'Three closest verified peers ranked by rate-per-sqft proximity to this deal\'s modeled pricing. ' +
    'These are alternatives the same buyer could have considered — surface them for context, not as a recommendation.',
    { italic: true, color: HEX('mutedHigh') },
  ));
  children.push(blank());

  const headerRow = buildHeaderTableRow(['Project', 'Developer', 'Type', 'Units', 'Rate / sqft', 'Δ vs deal']);
  const bodyRows = top3.map((c, idx) => {
    const delta = (dealRate != null && c.rate_per_sqft != null)
      ? `${c.rate_per_sqft > dealRate ? '+' : ''}${formatNumber((c.rate_per_sqft - dealRate) / dealRate * 100, 1)}%`
      : '–';
    return buildBodyTableRow([
      firstText(c.project_name) || '–',
      firstText(c.developer) || '–',
      firstText(c.project_type, c.bhk_config) || '–',
      c.total_units != null ? String(c.total_units) : '–',
      formatRate(c.rate_per_sqft),
      delta,
    ], { alt: idx % 2 === 1 });
  });
  children.push(new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDER,
  }));
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

// Embed an SVG string as an inline image. Wraps the SVG in an ImageRun
// with a 1×1 transparent PNG fallback so viewers without SVG support
// (older Word, Google Docs preview) still render the rest of the doc
// without erroring. SVG → buffer-string conversion is intentional — the
// docx library wants a Buffer for `data`, and converting to base64 first
// would inflate size by 33%.
const embedSvgChart = (svgString, { width = 600, height = 280 } = {}) => new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 160, after: 160 },
  children: [new ImageRun({
    type: 'svg',
    data: Buffer.from(svgString, 'utf8'),
    fallback: { type: 'png', data: FALLBACK_PNG_BUFFER },
    transformation: { width, height },
  })],
});

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

  // ── Capital stack donut ────────────────────────────────────────────────
  // Was: capital stack lived only inside the KPI row "Capital stack debt X /
  // equity Y" — invisible at a glance. Donut shows debt vs equity proportion
  // with INR Cr legend. Pure-SVG render embedded via docx ImageRun (no
  // canvas / sharp dependency); minimal 1×1 PNG fallback covers viewers
  // without SVG support.
  const capStack = ctx.capitalStack;
  if (capStack && (num(capStack.debtCr) > 0 || num(capStack.equityCr) > 0)) {
    children.push(blank());
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 40 },
      children: [new TextRun({
        text: 'CAPITAL STACK',
        font: FONT, size: 18, bold: true, color: HEX('mutedHigh'),
        characterSpacing: 32,
      })],
    }));
    children.push(embedSvgChart(
      renderCapitalStackDonutSvg({ debtCr: capStack.debtCr, equityCr: capStack.equityCr }),
      { width: 480, height: 220 },
    ));
  }

  // ── Quarterly cash flow trend ──────────────────────────────────────────
  // Period net (columns) + cumulative (line) on independent scales.
  // Asset-class branching: NOI for income deals, Net CF for development.
  const cashRows = Array.isArray(ctx.cashRows) ? ctx.cashRows : [];
  if (cashRows.length >= 2) {
    const isIncomeAsset = ['commercial_office', 'retail', 'industrial_warehousing', 'hospitality']
      .includes(String(ctx.assetClass || '').toLowerCase());
    children.push(blank());
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 40 },
      children: [new TextRun({
        text: isIncomeAsset ? 'PERIOD NOI & CUMULATIVE' : 'PERIOD NET CASH FLOW & CUMULATIVE',
        font: FONT, size: 18, bold: true, color: HEX('mutedHigh'),
        characterSpacing: 32,
      })],
    }));
    children.push(embedSvgChart(
      renderCashFlowTrendSvg({
        rows: cashRows,
        title: isIncomeAsset ? 'Period NOI & Cumulative (INR Cr)' : 'Period Net Cash Flow & Cumulative (INR Cr)',
      }),
      { width: 620, height: 280 },
    ));
  }

  // ── Sensitivity tornado ─────────────────────────────────────────────────
  // Drivers ranked by absolute IRR range. Same data + math as the slide-16
  // tornado in the PPTX — surfaced here as an SVG embed so the DOCX report
  // gets the same analytical depth.
  //
  // PR-NX44 (2026-05-18) — Sensitivity narrative renders BEFORE the
  // tornado so the IC reader sees "which inputs matter most + by how
  // much + which stress tests" first, then the visual backing the claim.
  const sensitivityNarrative = ctx.exportContext?.sensitivityNarrative || null;
  if (sensitivityNarrative?.available
      && (sensitivityNarrative.driver_decomposition_paragraph || sensitivityNarrative.stress_test_paragraph)) {
    children.push(blank());
    children.push(aiBadge());
    if (sensitivityNarrative.dominant_driver) {
      children.push(eyebrow(`Sensitivity analysis · Dominant driver: ${sensitivityNarrative.dominant_driver}`));
    } else {
      children.push(eyebrow('Sensitivity analysis'));
    }
    if (sensitivityNarrative.driver_decomposition_paragraph) {
      children.push(bodyPara(sensitivityNarrative.driver_decomposition_paragraph));
    }
    if (sensitivityNarrative.stress_test_paragraph) {
      children.push(blank());
      children.push(eyebrow('Recommended stress tests'));
      children.push(bodyPara(sensitivityNarrative.stress_test_paragraph));
    }
    // Attribution line.
    const attribution = [];
    if (sensitivityNarrative.confidence) attribution.push(`Confidence: ${sensitivityNarrative.confidence}`);
    if (sensitivityNarrative.provider) attribution.push(`Synthesis: ${sensitivityNarrative.provider}`);
    if (sensitivityNarrative.fallbackReason) attribution.push(`auto-failover: ${sensitivityNarrative.fallbackReason}`);
    if (attribution.length) {
      children.push(bodyPara(attribution.join(' · '), { italic: true, color: HEX('mutedHigh') }));
    }
  }

  const matrix = ctx.sensitivityMatrix;
  if (matrix && Array.isArray(matrix.irrGrid) && matrix.irrGrid.length >= 3
      && Array.isArray(matrix.sellingRates) && matrix.sellingRates.length >= 3
      && Array.isArray(matrix.constructionCosts) && matrix.constructionCosts.length >= 3) {
    const midRow = Math.floor(matrix.constructionCosts.length / 2);
    const midCol = Math.floor(matrix.sellingRates.length / 2);
    const baseIrr = num(matrix.irrGrid[midRow]?.[midCol]);
    const sellRow = matrix.irrGrid[midRow] || [];
    const sellLow = num(sellRow[0]);
    const sellHigh = num(sellRow[sellRow.length - 1]);
    const costLow = num(matrix.irrGrid[matrix.irrGrid.length - 1]?.[midCol]);
    const costHigh = num(matrix.irrGrid[0]?.[midCol]);

    const drivers = [];
    if (baseIrr != null && sellLow != null && sellHigh != null) {
      drivers.push({
        label: 'Selling Rate',
        subLabel: `${formatNumber(matrix.sellingRates[0], 0)} → ${formatNumber(matrix.sellingRates[matrix.sellingRates.length - 1], 0)} /sqft`,
        low: sellLow, high: sellHigh,
      });
    }
    if (baseIrr != null && costLow != null && costHigh != null) {
      drivers.push({
        label: 'Construction Cost',
        subLabel: `${formatNumber(matrix.constructionCosts[matrix.constructionCosts.length - 1], 0)} → ${formatNumber(matrix.constructionCosts[0], 0)} /sqft`,
        low: costLow, high: costHigh,
      });
    }
    if (drivers.length > 0 && baseIrr != null) {
      children.push(blank());
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 80, after: 40 },
        children: [new TextRun({
          text: 'SENSITIVITY — IRR RANGE BY DRIVER',
          font: FONT, size: 18, bold: true, color: HEX('mutedHigh'),
          characterSpacing: 32,
        })],
      }));
      children.push(embedSvgChart(
        renderTornadoSvg({ drivers, baseIrr }),
        { width: 620, height: 260 },
      ));
    }
  }

  return children;
};

// ─────────────────────────────────────────────────────────────────────
// PR-NX35 (2026-05-17) — Risk Register / DD Status / Approvals Tracker
// ─────────────────────────────────────────────────────────────────────
//
// Three new platform-data sections that an institutional IC reviewer
// expects to see in any underwriting report. Pre-NX35 the DOCX had
// rich market-context + financials + AI-synthesised Pros & Cons but no
// dedicated surface for the operator-curated risk register, the DD
// checklist progress, or the Karnataka approval tracker — all of which
// are first-class signals for "is this deal ready for IC?"
//
// All three sections:
//   - Use platformBadge() (not AI-synthesised — these are DB-backed
//     operator-curated facts; CLAUDE.md hard rule).
//   - Render an honest empty-state line when the operator hasn't
//     populated the underlying table yet.
//   - Sit right after Financials & KPIs and before Pros & Cons so the
//     reviewer reads the structured facts before the AI-synthesised
//     interpretation.
//
// Severity / status colour coding follows palette tokens:
//   - dataNegative for critical / blocker / overdue / issue
//   - dataWarning  for high / flagged / in_progress
//   - dataPositive for completed / validated / mitigated / resolved
//   - mutedHigh    for low / secondary / pending / not_applicable

const RISK_SEVERITY_RANK = { critical: 1, high: 2, medium: 3, low: 4 };
const RISK_STATUS_RANK = { open: 1, flagged: 2, mitigated: 3, resolved: 4 };
const DD_SEVERITY_RANK = { deal_breaker: 1, buildability_blocker: 2, commercial_blocker: 3, secondary: 4 };
const DD_STATUS_RANK = { pending: 1, in_progress: 2, flagged: 3, completed: 4, not_applicable: 5 };
const APPROVAL_STATUS_RANK = { issue: 1, in_progress: 2, pending: 3, validated: 4 };

const labelFromCode = (code) => String(code || '–')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

const severityColor = (severity) => {
  const s = String(severity || '').toLowerCase();
  if (s === 'critical' || s === 'deal_breaker' || s === 'issue') return HEX('dataNegative');
  if (s === 'high' || s === 'buildability_blocker' || s === 'flagged' || s === 'in_progress') return HEX('dataWarning');
  if (s === 'medium' || s === 'commercial_blocker') return HEX('mutedHigh');
  if (s === 'completed' || s === 'validated' || s === 'mitigated' || s === 'resolved') return HEX('dataPositive');
  return HEX('mutedHigh');
};

const buildRiskRegister = (ctx) => {
  const children = [];
  children.push(sectionHeading('Risk Register', { pageBreakBefore: true }));
  children.push(platformBadge());

  const summary = ctx.exportContext?.risks?.summary || {};
  const items = Array.isArray(ctx.exportContext?.risks?.items) ? ctx.exportContext.risks.items : [];
  // PR-NX43 (2026-05-18) — AI-synthesized 2-paragraph narrative covering
  // the deal's overall risk profile + critical-spotlight callout. Null
  // when no risks are logged OR when both Claude and OpenAI failed.
  const narrative = ctx.exportContext?.risks?.narrative || null;

  // Honest empty-state.
  if (items.length === 0) {
    children.push(bodyPara(
      'No risks have been logged for this deal yet. Manual input required — populate the Risk tab on the deal page before this section becomes IC-ready.',
      { italic: true, color: HEX('mutedHigh') },
    ));
    return children;
  }

  // Summary line — uses the existing risk_summary aggregation shape
  // (critical / high / medium / low). Fail-soft on missing fields.
  const total = Number(summary.total || items.length);
  const critical = Number(summary.critical || 0);
  const high = Number(summary.high || 0);
  const medium = Number(summary.medium || 0);
  const low = Number(summary.low || 0);
  const summaryParts = [];
  if (critical > 0) summaryParts.push(`${critical} critical`);
  if (high > 0) summaryParts.push(`${high} high`);
  if (medium > 0) summaryParts.push(`${medium} medium`);
  if (low > 0) summaryParts.push(`${low} low`);
  const summaryText = summaryParts.length
    ? `${total} risk${total === 1 ? '' : 's'} logged — ${summaryParts.join(', ')}.`
    : `${total} risk${total === 1 ? '' : 's'} logged.`;
  children.push(bodyPara(summaryText));

  // PR-NX43 (2026-05-18) — render the 2-paragraph AI synthesis BETWEEN
  // the structured summary line and the table so the IC reader sees
  // the "what does this mean?" before the "what specifically?". An
  // amber AI badge prefaces the narrative per CLAUDE.md disclosure rule.
  if (narrative?.available && (narrative.summary_paragraph || narrative.critical_spotlight_paragraph)) {
    children.push(blank());
    children.push(aiBadge());
    if (narrative.summary_paragraph) {
      children.push(eyebrow('Risk profile synthesis'));
      children.push(bodyPara(narrative.summary_paragraph));
    }
    if (narrative.critical_spotlight_paragraph) {
      children.push(blank());
      children.push(eyebrow('Critical / high-severity spotlight'));
      children.push(bodyPara(narrative.critical_spotlight_paragraph));
    }
    // Attribution line: confidence + provider + auto-failover diagnostic.
    const attribution = [];
    if (narrative.confidence) attribution.push(`Confidence: ${narrative.confidence}`);
    if (narrative.provider) attribution.push(`Synthesis: ${narrative.provider}`);
    if (narrative.fallbackReason) attribution.push(`auto-failover: ${narrative.fallbackReason}`);
    if (attribution.length) {
      children.push(bodyPara(attribution.join(' · '), { italic: true, color: HEX('mutedHigh') }));
    }
    children.push(blank());
    children.push(eyebrow('Logged risk items')); // separator before the structured table
  }

  // Sort: severity ASC (critical first), then status (open first)
  const sorted = [...items].sort((a, b) => {
    const sevA = RISK_SEVERITY_RANK[String(a.severity || '').toLowerCase()] || 99;
    const sevB = RISK_SEVERITY_RANK[String(b.severity || '').toLowerCase()] || 99;
    if (sevA !== sevB) return sevA - sevB;
    const stA = RISK_STATUS_RANK[String(a.status || '').toLowerCase()] || 99;
    const stB = RISK_STATUS_RANK[String(b.status || '').toLowerCase()] || 99;
    return stA - stB;
  });

  const headerRow = buildHeaderTableRow(['Severity', 'Category', 'Title', 'Status', 'Mitigation', 'Owner']);
  const bodyRows = sorted.map((r, idx) => {
    // Severity cell uses tone-coloured bold text for at-a-glance scan
    const severityRun = new TextRun({
      text: labelFromCode(r.severity),
      font: FONT, size: 18, bold: true,
      color: severityColor(r.severity),
    });
    return new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [severityRun] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
        ...[
          labelFromCode(r.category),
          firstText(r.title) || '–',
          labelFromCode(r.status),
          firstText(r.mitigation) || '–',
          firstText(r.created_by_name) || (r.created_by ? 'Assigned' : 'System'),
        ].map((value) => new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: String(value), font: FONT, size: 18, color: HEX('ink') })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        })),
      ],
    });
  });

  children.push(new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDER,
  }));
  return children;
};

const buildDDStatus = (ctx) => {
  const children = [];
  children.push(sectionHeading('Due Diligence Status'));
  children.push(platformBadge());

  const summary = ctx.exportContext?.dd?.summary || {};
  const items = Array.isArray(ctx.exportContext?.dd?.items) ? ctx.exportContext.dd.items : [];

  if (items.length === 0) {
    children.push(bodyPara(
      'No DD checklist has been seeded for this deal yet. Manual input required — apply the asset-class template from the deal\'s DD tab before this section becomes IC-ready.',
      { italic: true, color: HEX('mutedHigh') },
    ));
    return children;
  }

  // Summary — surfaces deal-breaker progress, the IC-critical KPI.
  const totalRequired = Number(summary.total_required || 0);
  const completedRequired = Number(summary.completed_required || summary.completed_count || 0);
  const flagged = Number(summary.flagged_count || items.filter((i) => i.status === 'flagged').length);
  const dealBreakersTotal = Number(summary.deal_breakers_total || items.filter((i) => i.severity === 'deal_breaker').length);
  const dealBreakersDone = Number(summary.deal_breakers_done || items.filter((i) => i.severity === 'deal_breaker' && i.status === 'completed').length);
  const dealBreakersPending = Math.max(0, dealBreakersTotal - dealBreakersDone);

  const parts = [];
  if (totalRequired > 0) parts.push(`${completedRequired} of ${totalRequired} required items completed`);
  if (dealBreakersPending > 0) parts.push(`${dealBreakersPending} deal-breaker${dealBreakersPending === 1 ? '' : 's'} open`);
  if (flagged > 0) parts.push(`${flagged} flagged`);
  const summaryText = parts.length
    ? `${parts.join('; ')}.`
    : `${items.length} item${items.length === 1 ? '' : 's'} tracked.`;
  children.push(bodyPara(summaryText));

  // Sort: status ASC (pending → flagged → completed), then severity
  // (deal_breaker first within each status bucket)
  const sorted = [...items].sort((a, b) => {
    const stA = DD_STATUS_RANK[String(a.status || '').toLowerCase()] || 99;
    const stB = DD_STATUS_RANK[String(b.status || '').toLowerCase()] || 99;
    if (stA !== stB) return stA - stB;
    const sevA = DD_SEVERITY_RANK[String(a.severity || '').toLowerCase()] || 99;
    const sevB = DD_SEVERITY_RANK[String(b.severity || '').toLowerCase()] || 99;
    return sevA - sevB;
  });

  const headerRow = buildHeaderTableRow(['Category', 'Item', 'Severity', 'Status', 'Notes']);
  const bodyRows = sorted.map((d, idx) => {
    const severityRun = new TextRun({
      text: labelFromCode(d.severity),
      font: FONT, size: 18, bold: true,
      color: severityColor(d.severity),
    });
    const statusRun = new TextRun({
      text: labelFromCode(d.status),
      font: FONT, size: 18, bold: true,
      color: severityColor(d.status),
    });
    return new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: labelFromCode(d.category), font: FONT, size: 18, color: HEX('ink') })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: firstText(d.item_name) || firstText(d.title) || '–', font: FONT, size: 18, color: HEX('ink') })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [severityRun] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [statusRun] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: firstText(d.notes) || '–', font: FONT, size: 18, color: HEX('mutedHigh') })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
      ],
    });
  });

  children.push(new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDER,
  }));
  return children;
};

const buildApprovalsTracker = (ctx) => {
  const children = [];
  children.push(sectionHeading('Approvals Tracker'));
  children.push(platformBadge());

  const summary = ctx.exportContext?.approvals?.summary || {};
  const items = Array.isArray(ctx.exportContext?.approvals?.items) ? ctx.exportContext.approvals.items : [];

  if (items.length === 0) {
    children.push(bodyPara(
      'No approvals have been seeded for this deal yet. Manual input required — apply the Karnataka template from the deal\'s Approvals tab (CDP/Zoning, DC Conversion, Khata, Sanctioned Building Plan, BCC, Fire NOC, BWSSB Water + Sewage, BESCOM Power, RERA, Environment Clearance).',
      { italic: true, color: HEX('mutedHigh') },
    ));
    return children;
  }

  // Summary — Karnataka-approval-aware progress line
  const total = items.length;
  const required = items.filter((a) => a.is_required !== false).length;
  const validated = items.filter((a) => a.is_validated === true || String(a.status || '').toLowerCase() === 'validated').length;
  const inProgress = items.filter((a) => String(a.status || '').toLowerCase() === 'in_progress').length;
  const issue = items.filter((a) => String(a.status || '').toLowerCase() === 'issue').length;
  const parts = [
    `${required} required of ${total} tracked`,
    `${validated} validated`,
    inProgress > 0 ? `${inProgress} in progress` : null,
    issue > 0 ? `${issue} with issue` : null,
  ].filter(Boolean);
  children.push(bodyPara(`${parts.join('; ')}.`));

  // Sort: status (issue first → in_progress → pending → validated), then alphabetical by name
  const sorted = [...items].sort((a, b) => {
    const stA = APPROVAL_STATUS_RANK[String(a.status || '').toLowerCase()] || 99;
    const stB = APPROVAL_STATUS_RANK[String(b.status || '').toLowerCase()] || 99;
    if (stA !== stB) return stA - stB;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  const headerRow = buildHeaderTableRow(['Approval', 'Required', 'Status', 'Reference #', 'Authority', 'Expiry', 'Next Action']);
  const bodyRows = sorted.map((a, idx) => {
    const statusRun = new TextRun({
      text: labelFromCode(a.status),
      font: FONT, size: 18, bold: true,
      color: severityColor(a.status),
    });
    const requiredText = a.is_required === false ? 'Optional' : 'Required';
    const requiredColor = a.is_required === false ? HEX('mutedHigh') : HEX('ink');
    return new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: firstText(a.name) || labelFromCode(a.approval_type) || '–', font: FONT, size: 18, color: HEX('ink') })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: requiredText, font: FONT, size: 18, color: requiredColor })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [statusRun] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: firstText(a.reference_number) || '–', font: FONT, size: 18, color: HEX('mutedHigh') })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: firstText(a.issuing_authority) || '–', font: FONT, size: 18, color: HEX('mutedHigh') })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: a.expiry_date ? formatDate(a.expiry_date) : '–', font: FONT, size: 18, color: HEX('mutedHigh') })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: firstText(a.next_action) || '–', font: FONT, size: 18, color: HEX('ink') })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
      ],
    });
  });

  children.push(new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDER,
  }));
  return children;
};

// ─────────────────────────────────────────────────────────────────────
// PR-NX36 (2026-05-17) — Provenance / Source Register
// ─────────────────────────────────────────────────────────────────────
//
// Institutional underwriting reports carry a traceable audit story:
// every input value links to a source document, and every auto-applied
// field links to the extraction event that produced it. This section
// surfaces both: an uploaded-document inventory (with per-document
// extraction status) and a chronological audit of auto-fill events.
//
// Pre-NX36 the only way to see this was the in-app Audit tab (PR-NX31).
// The DOCX is what gets emailed to an LP / IC reviewer who never logs
// in — they need the same provenance story on the page.

const buildProvenance = (ctx) => {
  const children = [];
  children.push(sectionHeading('Provenance & Source Register'));
  children.push(platformBadge());

  const documents = Array.isArray(ctx.exportContext?.documents?.items)
    ? ctx.exportContext.documents.items
    : [];
  const extractionStatus = Array.isArray(ctx.exportContext?.provenance?.extractionStatus)
    ? ctx.exportContext.provenance.extractionStatus
    : [];
  const autoFillEvents = Array.isArray(ctx.exportContext?.provenance?.autoFillEvents)
    ? ctx.exportContext.provenance.autoFillEvents
    : [];

  // If nothing at all is on file, render a single empty-state.
  if (documents.length === 0 && autoFillEvents.length === 0) {
    children.push(bodyPara(
      'No source documents or auto-fill events recorded for this deal yet. Manual input required — upload source documents (sale deed, EC, khata extract, sanctioned plan, RERA certificate) via the deal\'s Documents tab to seed the provenance trail.',
      { italic: true, color: HEX('mutedHigh') },
    ));
    return children;
  }

  // ── Uploaded documents subsection ────────────────────────────────
  children.push(eyebrow('Uploaded source documents'));
  if (documents.length === 0) {
    children.push(bodyPara('No documents uploaded for this deal yet.', { italic: true, color: HEX('mutedHigh') }));
  } else {
    // Build a per-document extraction-status lookup so we can show
    // "X fields extracted" against each document row.
    const extractionByDocId = new Map();
    for (const ex of extractionStatus) {
      if (ex.document_id) extractionByDocId.set(ex.document_id, ex);
    }

    const headerRow = buildHeaderTableRow(['Document', 'Category', 'Type', 'Uploaded', 'Extraction']);
    const bodyRows = documents.slice(0, 30).map((d, idx) => {
      const ex = extractionByDocId.get(d.id);
      let extractionCell;
      if (!ex) {
        extractionCell = '—';
      } else if (ex.extraction_status === 'error') {
        extractionCell = 'Failed';
      } else if (ex.extraction_status === 'pending') {
        extractionCell = 'Pending';
      } else if (ex.field_count > 0) {
        extractionCell = `${ex.field_count} field${ex.field_count === 1 ? '' : 's'} · ${ex.provider || 'unknown'}`;
      } else {
        extractionCell = labelFromCode(ex.extraction_status);
      }
      const extractionColor = ex?.extraction_status === 'error'
        ? HEX('dataNegative')
        : ex?.field_count > 0
          ? HEX('dataPositive')
          : HEX('mutedHigh');

      return new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: firstText(d.name) || '–', font: FONT, size: 18, color: HEX('ink') })] })],
            shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: labelFromCode(d.doc_category || 'other'), font: FONT, size: 18, color: HEX('mutedHigh') })] })],
            shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: firstText(d.file_type) || '–', font: FONT, size: 16, color: HEX('mutedHigh') })] })],
            shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: d.created_at ? formatDate(d.created_at) : '–', font: FONT, size: 18, color: HEX('mutedHigh') })] })],
            shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: extractionCell, font: FONT, size: 18, bold: ex?.field_count > 0, color: extractionColor })] })],
            shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
          }),
        ],
      });
    });
    children.push(new Table({
      rows: [headerRow, ...bodyRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDER,
    }));
    if (documents.length > 30) {
      children.push(bodyPara(
        `Showing first 30 of ${documents.length} documents. Full inventory is on the deal's Documents tab.`,
        { italic: true, color: HEX('mutedHigh'), size: 16 },
      ));
    }
  }

  // ── Auto-fill events subsection ─────────────────────────────────
  children.push(eyebrow('Auto-fill events (extracted → applied)'));
  if (autoFillEvents.length === 0) {
    children.push(bodyPara(
      'No auto-fill events have been applied to this deal. Operator can review extracted fields via the "Auto-fill from documents" surface on the Overview tab.',
      { italic: true, color: HEX('mutedHigh') },
    ));
  } else {
    const headerRow = buildHeaderTableRow(['Applied', 'Fields', 'Target', 'Source Extractions', 'Ontology']);
    const bodyRows = autoFillEvents.slice(0, 30).map((e, idx) => new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: e.applied_at ? formatDate(e.applied_at) : '–', font: FONT, size: 18, color: HEX('mutedHigh') })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({
            text: e.applied_fields_count != null
              ? `${e.applied_fields_count} field${e.applied_fields_count === 1 ? '' : 's'}`
              : `${e.changed_fields.length || 0} field${e.changed_fields.length === 1 ? '' : 's'}`,
            font: FONT, size: 18, bold: true, color: HEX('dataPositive'),
          })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({
            text: e.target_table === 'deals'
              ? 'Deal record'
              : e.target_table === 'properties'
                ? 'Linked property'
                : labelFromCode(e.target_table || 'unknown'),
            font: FONT, size: 18, color: HEX('ink'),
          })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({
            text: e.source_extraction_ids.length > 0
              ? `${e.source_extraction_ids.length} extraction${e.source_extraction_ids.length === 1 ? '' : 's'}`
              : '–',
            font: FONT, size: 18, color: HEX('mutedHigh'),
          })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({
            text: e.ontology_version ? `v${e.ontology_version}` : '–',
            font: FONT, size: 16, color: HEX('mutedHigh'),
          })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
      ],
    }));
    children.push(new Table({
      rows: [headerRow, ...bodyRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDER,
    }));
    if (autoFillEvents.length > 30) {
      children.push(bodyPara(
        `Showing first 30 of ${autoFillEvents.length} auto-fill events. Full timeline is on the deal's Audit tab.`,
        { italic: true, color: HEX('mutedHigh'), size: 16 },
      ));
    }
  }

  return children;
};

// ═══════════════════════════════════════════════════════════════════════
// PR-NX45 (2026-05-18) — Document-Derived Insights section
// ═══════════════════════════════════════════════════════════════════════
//
// Sits between Provenance & Source Register and Pros & Cons. Renders:
//   1. Per-doctype fact summary: groups extracted fields by sale_deed,
//      ec, khata_extract, rera, etc. — surfaces the actual VALUES so the
//      IC reviewer doesn't have to dig into the source documents.
//   2. AI-synthesized 1-paragraph cross-document summary (what does the
//      document set tell us about this deal?).
//   3. 0-5 inconsistency findings: critical/high/medium/low — each with
//      title, severity tone, description naming the contradicting docs,
//      and a recommended next step.
//
// Auto-hidden entirely when no completed extractions exist (no empty-
// state clutter for deals that haven't run doc-ingest yet).

const DOC_INSIGHTS_SEVERITY_RANK = { critical: 1, high: 2, medium: 3, low: 4 };
const DOC_INSIGHTS_SEVERITY_COLOR = {
  critical: 'dataNegative',
  high: 'dataWarning',
  medium: 'mutedHigh',
  low: 'mutedLow',
};

const buildDocumentInsights = (ctx) => {
  const completedExtractions = Array.isArray(ctx.exportContext?.documents?.completedExtractions)
    ? ctx.exportContext.documents.completedExtractions
    : [];
  const insights = ctx.exportContext?.documents?.insights || null;

  // No-op early-exit when there's nothing to render.
  if (completedExtractions.length === 0 && !insights?.available) {
    return [];
  }

  const children = [];
  children.push(sectionHeading('Document-Derived Insights', { pageBreakBefore: true }));
  children.push(platformBadge());

  // ─── Per-doctype extracted facts ────────────────────────────────────
  if (completedExtractions.length > 0) {
    children.push(bodyPara(
      `${completedExtractions.length} document extraction${completedExtractions.length === 1 ? '' : 's'} surfaced — facts grouped by document type below.`,
    ));
    children.push(blank());

    // Group by doc_type. Each group renders as: doctype eyebrow +
    // key-value table of the extracted fields.
    const byType = new Map();
    for (const ext of completedExtractions) {
      const docType = String(ext.doc_type || 'unknown');
      if (!byType.has(docType)) byType.set(docType, []);
      byType.get(docType).push(ext);
    }

    for (const [docType, extractions] of byType) {
      const humanType = humanizeDocType(docType);
      children.push(eyebrow(`${humanType} (${extractions.length})`));

      // For each extraction in this group, render its top fields (capped
      // at 8 per extraction to avoid runaway-table syndrome).
      for (const ext of extractions) {
        const fields = ext.structured_fields || {};
        const fieldEntries = Object.entries(fields)
          .filter(([_k, v]) => v != null && v !== '')
          .slice(0, 8);

        if (fieldEntries.length === 0) {
          continue;
        }

        const rows = fieldEntries.map(([key, value]) => labelValueRow(
          humanizeFieldKey(key),
          formatExtractedValue(value),
        ));
        children.push(buildLabelValueTable(rows));

        // Provider attribution
        const providerLabel = ext.provider
          ? `Extracted by ${ext.provider}${ext.extracted_at ? ` · ${formatDate(ext.extracted_at)}` : ''}`
          : null;
        if (providerLabel) {
          children.push(bodyPara(providerLabel, { italic: true, color: HEX('mutedLow') }));
        }
        children.push(blank());
      }
    }
  }

  // ─── AI-synthesized cross-document analysis ────────────────────────
  if (insights?.available) {
    children.push(blank());
    children.push(aiBadge());
    children.push(eyebrow('Cross-document analysis'));

    if (insights.summary_paragraph) {
      children.push(bodyPara(insights.summary_paragraph));
    }

    // Findings — render each as title + severity-coloured chip + body
    if (Array.isArray(insights.findings) && insights.findings.length > 0) {
      children.push(blank());
      children.push(eyebrow(`Inconsistency findings (${insights.findings.length})`));
      const sortedFindings = [...insights.findings].sort((a, b) => {
        const sevA = DOC_INSIGHTS_SEVERITY_RANK[a.severity] || 99;
        const sevB = DOC_INSIGHTS_SEVERITY_RANK[b.severity] || 99;
        return sevA - sevB;
      });
      for (const finding of sortedFindings) {
        const colorToken = DOC_INSIGHTS_SEVERITY_COLOR[finding.severity] || 'mutedHigh';
        // Severity-tinted title line
        children.push(new Paragraph({
          spacing: { before: 100, after: 40 },
          children: [
            new TextRun({
              text: `[${String(finding.severity || 'medium').toUpperCase()}] `,
              font: FONT, size: 20, bold: true, color: HEX(colorToken),
            }),
            new TextRun({
              text: finding.title || '(untitled)',
              font: FONT, size: 20, bold: true, color: HEX('ink'),
            }),
          ],
        }));
        if (finding.description) {
          children.push(bodyPara(finding.description));
        }
        if (finding.recommendation) {
          children.push(bodyPara(
            `Recommended: ${finding.recommendation}`,
            { italic: true, color: HEX('mutedHigh') },
          ));
        }
      }
    } else {
      children.push(bodyPara(
        'No inconsistencies detected across the extracted document set. (This is a positive signal — the documents on file corroborate one another.)',
        { italic: true, color: HEX('mutedHigh') },
      ));
    }

    // Attribution line
    const attribution = [];
    if (insights.confidence) attribution.push(`Confidence: ${insights.confidence}`);
    if (insights.provider) attribution.push(`Synthesis: ${insights.provider}`);
    if (insights.fallbackReason) attribution.push(`auto-failover: ${insights.fallbackReason}`);
    if (attribution.length) {
      children.push(blank());
      children.push(bodyPara(attribution.join(' · '), { italic: true, color: HEX('mutedHigh') }));
    }
  }

  return children;
};

// Helpers for the new section ── humanize doctype + field keys for the
// table labels (e.g., "sale_deed" → "Sale Deed", "owner_name" → "Owner Name").
const humanizeDocType = (docType) => String(docType || 'unknown')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

const humanizeFieldKey = (key) => String(key || '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

// Format a structured-field value for display. Objects/arrays serialize
// to JSON; numbers stay as numbers; strings trim + truncate at 200 chars.
const formatExtractedValue = (value) => {
  if (value == null) return '–';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
  }
  // Objects / arrays — compact JSON, capped length
  try {
    const json = JSON.stringify(value);
    return json.length > 200 ? `${json.slice(0, 200)}…` : json;
  } catch {
    return String(value).slice(0, 200);
  }
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

// ─────────────────────────────────────────────────────────────────────
// PR-NX37 (2026-05-17) — Methodology & Assumptions appendix
// ─────────────────────────────────────────────────────────────────────
//
// Institutional underwriting reports carry a methodology disclosure
// + a complete table of every numeric assumption used. Without it,
// the reviewer has to take the KPIs on faith. With it, they can
// re-derive the model offline.
//
// Pulls from:
//   - ctx.exportContext.assumptions — array of {key, label, value}
//     built by dealExport.service.buildDynamicAssumptions() from
//     model_params.inputs. Every input the kernel consumed.
//   - Hard-coded methodology paragraph that names the kernel + the
//     "no AI numerics" rule.
//
// Position: AFTER Overall Score, BEFORE Disclaimer. The closing
// appendix before the legal block.

const buildMethodologyAndAssumptions = (ctx) => {
  const children = [];
  children.push(sectionHeading('Methodology & Assumptions', { pageBreakBefore: true }));
  children.push(platformBadge());

  // Methodology block — explains HOW the numbers were computed.
  children.push(eyebrow('How numbers in this report were computed'));
  children.push(bodyPara(
    `${ctx.brandName}'s deterministic TypeScript financial kernel (packages/financial-kernel) computed every numeric figure in this report. The kernel runs asset-class-specific models (residential RERA escrow, hospitality USALI, commercial NOI build, plotted absorption, mixed-use component blend, raw-land entitlement pipeline) parameterised by the operator's inputs listed below. No large language model ever produces a number in this report — AI is restricted to interpretation paragraphs (clearly labelled "AI-Assisted").`,
  ));
  children.push(bodyPara(
    `Cross-product consistency: the same kernel + the same inputs drive the XLSX export, the PPTX deck, and this DOCX. Reviewers comparing all three formats will see identical KPIs to the last decimal.`,
    { italic: true, color: HEX('mutedHigh') },
  ));
  children.push(bodyPara(
    `Indian operating reality: GST tiers (5% residential / 12% commercial / 0% plotted), Karnataka stamp duty + registration (6.6% acquisition), RERA 70/30 escrow on customer collections, BBMP UAV property tax method (area-driven, not revenue), Khata A/B exit haircuts, JDA revenue-share / area-share accounting, Indian lender ecosystem (Repo / MCLR benchmarks + India-specific spreads) are all encoded directly in the kernel — see XLSX_INSTITUTIONAL_GRADE_ROADMAP.md for the full India-localization map.`,
  ));

  // Assumptions table — every input the kernel consumed
  const assumptions = Array.isArray(ctx.exportContext?.assumptions) ? ctx.exportContext.assumptions : [];
  children.push(eyebrow(`Operator inputs (${assumptions.length} entries)`));

  if (assumptions.length === 0) {
    children.push(bodyPara(
      'No model inputs are recorded on this deal yet. The financial section above shows the deterministic kernel\'s output for a deal with default assumptions only. Manual input required — populate the Inputs tab on the deal\'s Financials page before this section becomes IC-grade.',
      { italic: true, color: HEX('mutedHigh') },
    ));
    return children;
  }

  // Sort alphabetically by label for predictable order.
  const sorted = [...assumptions].sort((a, b) =>
    String(a.label || a.key || '').localeCompare(String(b.label || b.key || '')));

  // Render as a 3-column table: Key / Label / Value. Truncate at 80
  // rows to keep the page count sane — a model with > 80 inputs is
  // unusual; if encountered, surface the truncation note.
  const headerRow = buildHeaderTableRow(['Input', 'Label', 'Value']);
  const bodyRows = sorted.slice(0, 80).map((a, idx) => {
    const valueText = a.value === null || a.value === undefined || a.value === ''
      ? '–'
      : typeof a.value === 'boolean'
        ? (a.value ? 'Yes' : 'No')
        : typeof a.value === 'number'
          ? String(a.value)
          : String(a.value);
    return new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: a.key || '–', font: FONT, size: 16, color: HEX('mutedHigh') })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 60, bottom: 60, left: 120, right: 120 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: a.label || a.key || '–', font: FONT, size: 18, color: HEX('ink') })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 60, bottom: 60, left: 120, right: 120 },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: valueText, font: FONT, size: 18, color: HEX('ink') })] })],
          shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: HEX('paperSubtle') } : undefined,
          margins: { top: 60, bottom: 60, left: 120, right: 120 },
        }),
      ],
    });
  });
  children.push(new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDER,
  }));

  if (assumptions.length > 80) {
    children.push(bodyPara(
      `Showing first 80 of ${assumptions.length} operator inputs. The full input set is editable on the Inputs tab and exported in the XLSX workbook.`,
      { italic: true, color: HEX('mutedHigh'), size: 16 },
    ));
  }

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
  const modelSellRate = firstNumber(deal.selling_rate_per_sqft, inputs.sellingRatePerSqft);

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

  // Pull the inputs the new SVG-chart embeds need. capitalStack is on
  // model_params (kernel attaches it). cashRows / sensitivityMatrix come
  // straight from the exportContext payload (dealExport.service.js
  // already attaches them for the PPTX path; we just route them through
  // for the DOCX path too).
  const capitalStack = model.capitalStack || {};
  const cashRows = Array.isArray(exportContext.cashFlows?.quarterly) && exportContext.cashFlows.quarterly.length
    ? exportContext.cashFlows.quarterly
    : Array.isArray(exportContext.cashFlows?.yearly)
      ? exportContext.cashFlows.yearly
      : [];
  const sensitivityMatrix = exportContext.sensitivity || null;

  return {
    exportContext,
    deal,
    property,
    inputs,
    irr, equityMultiple, npv, grossMargin, totalCost, totalRevenue,
    yieldOnCost, noi, exitValue, residualLandValue,
    landAreaSqft, saleableAreaSqft, fsi, modelSellRate,
    coords,
    coordinates: coords ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : null,
    assetClass,
    assetClassLabel: ASSET_CLASS_LABELS[assetClass] || assetClass,
    capitalStack,
    cashRows,
    sensitivityMatrix,
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

  // Prefetch async sections (AI Pros & Cons, Why This Area, site map)
  // in parallel with section assembly. Each .catch()es so a single
  // failure never crashes the report.
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

  const whyThisAreaPromise = generateSection({
    section: 'whyThisArea',
    payload: {
      locality: ctx.locationLine,
      city: ctx.deal.city || null,
      asset_class: ctx.assetClass,
      infra_proximity: exportContext?.infra_proximity
        || exportContext?.market?.infra_proximity
        || exportContext?.deal?.infra_proximity
        || null,
      intelligence_briefs: exportContext?.market?.intelligence_briefs
        || exportContext?.intelligence_briefs
        || [],
      demographics: exportContext?.market?.demographics
        || exportContext?.demographics
        || null,
    },
    dealId: ctx.deal.id || null,
    organizationId: ctx.deal.organization_id || null,
  }).catch(() => ({ available: false, paragraphs: [], reason: 'narrative call failed' }));

  // Build site info section (async — Google Maps call). Never throws.
  // PR-NX18 (2026-05-16): adapter that reshapes DOCX ctx → briefing
  // service input. The briefing service was written for XLSX which has
  // `ctx.kernelKpis.*`; DOCX has flat `ctx.irr` etc. This wrapper bridges
  // the shapes so the SAME shared service produces the SAME asset-class
  // × structure × exit-strategy aware narrative across XLSX, DOCX, PPTX.
  const incomeFamily = ['commercial_office', 'retail', 'industrial_warehousing', 'hospitality'];
  const briefingCtx = {
    deal: ctx.deal,
    property: ctx.property,
    inputs: ctx.inputs,
    assetClass: ctx.assetClass,
    dealFamily: incomeFamily.includes(ctx.assetClass) ? 'income' : 'development',
    projectMonths: Number(ctx.deal?.project_duration_months)
      || Number(ctx.inputs?.projectDurationMonths)
      || 36,
    kernelKpis: {
      irr: ctx.irr,
      npv: ctx.npv,
      equityMultiple: ctx.equityMultiple,
      noi: ctx.noi,
      grossMargin: ctx.grossMargin,
      yieldOnCost: ctx.yieldOnCost,
      totalRevenue: ctx.totalRevenue,
      totalCost: ctx.totalCost,
      exitValue: ctx.exitValue,
      residualLandValue: ctx.residualLandValue,
    },
  };
  const briefingPromise = generateDealBriefing(briefingCtx).catch(() => null);

  const [prosCons, whyThisArea, siteSection, briefing] = await Promise.all([
    prosConsPromise,
    whyThisAreaPromise,
    buildSiteInformation(ctx),
    briefingPromise,
  ]);
  ctx.prosCons = prosCons;
  ctx.whyThisArea = whyThisArea;
  ctx.briefing = briefing; // PR-NX18: consumed by buildBriefingSection

  const documentChildren = [
    ...buildCover(ctx),
    // PR-NX37 (2026-05-17): Table of Contents — right after Cover, so
    // the reviewer sees the full document shape before any content. Static
    // (no F9-update-fields required to render).
    ...buildTableOfContents(ctx),
    ...buildBriefingSection(ctx), // PR-NX18 — AI-Assisted Briefing
    ...buildExecutiveSummary(ctx),
    ...siteSection,
    ...buildOverview(ctx),
    ...buildDemographics(ctx),
    ...buildWhyThisArea(ctx),
    ...buildJobGrowth(ctx),
    ...buildSocialInfrastructure(ctx),
    ...buildSupplyDemand(ctx),
    ...buildComparables(ctx),
    ...buildBetterAlternatives(ctx),
    ...buildFinancials(ctx),
    // PR-NX35 (2026-05-17): IC-grade platform-data sections between
    // Financials and Pros & Cons — operator-curated facts (risks /
    // DD progress / approval tracker) come BEFORE the AI synthesis
    // so the reviewer reads the structured truth before the narrative.
    ...buildRiskRegister(ctx),
    ...buildDDStatus(ctx),
    ...buildApprovalsTracker(ctx),
    // PR-NX36 (2026-05-17): Provenance / Source Register — uploaded
    // documents + auto-fill audit trail. Belongs between the platform-
    // data sections (risks/DD/approvals) and the AI-synthesised Pros
    // & Cons because it ANSWERS "what's the platform's source for the
    // facts above?" before the reviewer reads the AI's interpretation.
    ...buildProvenance(ctx),
    // PR-NX45 (2026-05-18) — NEW SECTION: Document-Derived Insights.
    // Surfaces extracted facts per doctype + AI-detected cross-document
    // inconsistencies. Sits between Provenance (which lists "what was
    // applied when from which document") and Pros & Cons (the AI
    // synthesis section). Auto-hidden when no completed extractions
    // exist — zero clutter for deals without doc-ingest.
    ...buildDocumentInsights(ctx),
    ...buildProsCons(ctx),
    ...buildOverallScore(ctx),
    // PR-NX37 (2026-05-17): Methodology & Assumptions appendix — the
    // closing audit-grade block before the Disclaimer. Names the kernel
    // + lists every input the model consumed.
    ...buildMethodologyAndAssumptions(ctx),
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
    // PR-NX35 (2026-05-17) — Risk / DD / Approvals sections
    buildRiskRegister,
    buildDDStatus,
    buildApprovalsTracker,
    labelFromCode,
    severityColor,
    // PR-NX36 (2026-05-17) — Provenance section
    buildProvenance,
    // PR-NX37 (2026-05-17) — Table of Contents + Methodology appendix
    buildTableOfContents,
    buildMethodologyAndAssumptions,
    SECTION_ORDER,
  },
};
