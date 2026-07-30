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
const { resolveCustomerIcOpinion } = require('../../export.insights.service');
const { deriveCompProvenance, formatProvenanceLine } = require('../../../utils/compProvenance');
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
  TabStopType, TabStopPosition,
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

// PR-NX74 (2026-05-19) — `aiBadge()` was rendering a loud yellow
// "AI-ASSISTED · Verify against source data before decisions." pill
// above every model-touched section. Operator removed it per
// 2026-05-19 directive: the single cover-page disclaimer is now the
// only place this report calls out model usage. The function now
// returns a blank-paragraph spacer so existing call sites that push
// it into `children` continue to render valid DOCX without a
// conditional rewrite.
const aiBadge = () => new Paragraph({
  children: [new TextRun({ text: '' })],
  spacing: { before: 20, after: 20 },
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
      new TextRun({ text: '   Auto-extracted from Acureal records and the deterministic financial kernel.', font: FONT, size: 16, color: HEX('mutedHigh'), italics: true }),
    ],
    spacing: { before: 60, after: 60 },
  });

const blank = () => new Paragraph({ children: [new TextRun({ text: '' })], spacing: { before: 40, after: 40 } });

// AI-disclosure policy (operator override 2026-05-19, reaffirmed by the
// 2026-06-23 credibility audit): customer-facing exports must NOT surface
// AI-as-marketing or quota/upsell copy. When the AI augment layer is bypassed
// for ANY reason (quota, unauthenticated, check_failed), the section falls
// through to the neutral "manual input required / no verified feed" placeholder
// below — quota/upsell status stays in the operator-only in-app UI. Kept as a
// no-op (not deleted) so the five call sites — and any future operator-only
// variant — remain structurally intact.
const augmentQuotaCallout = () => null;

// Market-intelligence provenance line for the AI general-knowledge augment paths
// (demographics / whyThisArea / jobGrowth fallbacks). CLAUDE.md hard rule: never
// expose unverified market intelligence as authoritative — always surface source,
// freshness, and confidence. The cover-page disclaimer covers model-assisted
// synthesis report-wide (operator policy: no per-section AI banners or provider
// names), so this line carries only the DATA caveat — unverified source +
// confidence — without naming AI or a provider. Returns null for the structured/
// verified paths (which cite their real sources).
const augmentProvenanceLine = (augment) => {
  if (!augment || !augment.available) return null;
  const conf = typeof augment.confidence === 'string' && augment.confidence
    ? ` Confidence: ${augment.confidence.charAt(0).toUpperCase()}${augment.confidence.slice(1)}.`
    : '';
  return bodyPara(
    'Unverified market context — general-area estimate, not a verified Acureal feed. '
    + `Verify named facts, distances, and trends against primary sources before any IC decision.${conf}`,
    { italic: true, color: HEX('mutedHigh') },
  );
};

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
  // Computation reference — makes the cover's "figures come from the
  // deterministic kernel" claim checkable against this deal's append-only
  // computation log. Deliberately narrow: the signed outputs hash covers the
  // returns / cost / revenue / area figures, NOT the cash-flow schedule or
  // sensitivity matrix, so the copy says exactly that and no more. Omitted
  // entirely when the deal has never been calculated.
  if (ctx.computationRef?.ref) {
    children.push(bodyPara(
      `Kernel computation: ${ctx.computationRef.ref}`,
      { color: HEX('mutedHigh'), italic: true },
    ));
  }
  children.push(blank());
  children.push(blank());

  // PR-NX74 (2026-05-19) — Cover-page disclaimer, simplified per operator
  // 2026-05-19: "In the .docx underwriting report just write like a
  // disclaimer at the first page in a very small font (Arial, size 7
  // probably), that AI is being used and whatever you feel is appropriate.
  // Rest all the exports don't mention AI is being used or anything."
  //
  // This REPLACES the prior loud "AI-ASSISTED DRAFT — REQUIRES HUMAN REVIEW"
  // banner + the full disclosure paragraph. We now emit ONE quiet line at
  // the bottom of the cover in 7pt italic muted type. Per-section AI
  // attribution / provider names / auto-failover diagnostics are stripped
  // elsewhere in this PR.
  children.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 480, after: 60 },
    children: [
      new TextRun({
        text:
          'Portions of this report are drafted with model-assisted synthesis from Acureal\'s structured deal data. '
          + 'All numerical figures originate from the deterministic underwriting kernel — no figures are model-generated. '
          + 'Independent verification against primary source documents (sale deeds, RERA registration, '
          + 'encumbrance certificates, planning approvals) is required before any investment-committee decision.',
        font: FONT,
        size: 14, // 7pt
        italics: true,
        color: HEX('mutedLow'),
      }),
    ],
  }));

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

// PR-NX74 (2026-05-19) — section heading was "AI-Assisted Briefing".
// Renamed to "Executive Briefing" per operator policy (no per-section
// AI labels; the cover-page disclaimer covers it).
const SECTION_ORDER = [
  'Executive Briefing',
  'Executive Summary',
  'Site Information',
  'Overview',
  'Site Yield & Massing',
  'Demographics',
  'Why This Area',
  'Job Growth & Micro-Market',
  'Social Infrastructure',
  'Supply & Demand Pipeline',
  'Comparable Transactions',
  'Better Alternatives in this Micro-Market',
  'Financials & KPIs',
  'Deal Register',
  'Risk Register',
  'Due Diligence Status',
  'Approvals Tracker',
  'Provenance & Source Register',
  'Document-Derived Insights',
  'Pros & Cons',
  'Overall Score',
  'Methodology & Assumptions',
  'Disclaimer',
];

const buildTableOfContents = (ctx) => {
  const children = [];
  children.push(sectionHeading('Table of Contents', { pageBreakBefore: true }));
  // PR-NX74 (2026-05-19) — descriptor stripped of AI-vs-Platform-Data
  // bifurcation copy per operator policy. The cover-page disclaimer is
  // the only place this report calls out model-assisted synthesis.
  children.push(bodyPara(
    'Every section in this underwriting report, in the order they appear.',
    { italic: true, color: HEX('mutedHigh') },
  ));

  SECTION_ORDER.forEach((label, idx) => {
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
      ],
    }));
  });

  // PR-NX74 (2026-05-19) — simplified footer (no "no AI numerics" callout
  // since the cover-page disclaimer is the canonical reference).
  children.push(bodyPara(
    `Generated by ${ctx.brandName} on ${formatDate(ctx.generatedAt)}.`,
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
// PR-NX74 (2026-05-19) — operator policy override: no per-section AI
// disclosure banner, no provider name, no auto-failover trace, no
// cross-product reconciliation copy. The single cover-page disclaimer
// covers AI usage for the whole report. Section is just a clean
// "Executive Briefing" now.
const buildBriefingSection = (ctx) => {
  const children = [];
  const briefing = ctx.briefing || null;

  children.push(sectionHeading('Executive Briefing', { pageBreakBefore: true }));

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

  // PR-NX74 (2026-05-19) — Generation footer simplified per operator
  // policy. Was: `Generated: ${date} · Synthesis: ${provider} · ... ·
  // auto-failover: ${rawErrorJSON}. This briefing mirrors the AI-assisted
  // Executive Briefing tab in the XLSX export and the AI-Assisted Briefing
  // slide in the PPTX deck — all three reuse the same shared service for
  // cross-product consistency.` — which (a) leaked the model id, (b)
  // pasted raw provider error JSON into the report on auto-failover, and
  // (c) shipped internal cross-product reconciliation copy customers
  // shouldn't see. All stripped. Just a clean generation date now.
  children.push(blank());
  children.push(bodyPara(
    `Generated: ${formatDate(ctx.generatedAt)}`,
    { italic: true, color: HEX('mutedHigh') },
  ));

  return children;
};

const buildExecutiveSummary = (ctx) => {
  const children = [];
  children.push(sectionHeading('Executive Summary', { pageBreakBefore: true }));
  children.push(aiBadge());

  const ic = ctx.icOpinion || ctx.exportContext?.ai;
  // Audit #9/#21 (2026-06-25): low-confidence opinions are WITHHELD from the
  // customer report (gate, not label) — see resolveCustomerIcOpinion. The
  // deterministic KPIs below carry the report.
  const icDisplay = resolveCustomerIcOpinion(ic);
  if (icDisplay.mode === 'render') {
    children.push(bodyPara(icDisplay.text));
    // PR-NX40 (2026-05-18): confidence attribution so the reader knows the
    // grounding strength of the opinion shown (only medium/high reach here).
    const attribution = [];
    if (icDisplay.confidence) attribution.push(`Confidence: ${icDisplay.confidence}`);
    if (attribution.length) {
      children.push(bodyPara(attribution.join(' · '), { italic: true, color: HEX('mutedHigh') }));
    }
  } else if (icDisplay.mode === 'withheld') {
    // Low confidence: do NOT print the hedged stance (it reads as authoritative).
    // State plainly that no rated opinion was warranted and point to the numbers.
    children.push(bodyPara(
      'A confidence-rated investment opinion was withheld from this report: the available verified inputs were insufficient to support one to an institutional standard. The deterministic KPIs and risk register below stand on their own; the full working model is available in the deal workspace.',
      { italic: true, color: HEX('mutedHigh') },
    ));
  } else {
    // The raw failure reason (provider names, HTTP statuses, env-var hints)
    // is operator diagnostics — it lives in logs and the admin AI-usage
    // dashboard, never in the customer document. The disclosure policy also
    // bars AI mentions in body prose (the cover disclaimer is the report's
    // single model-assistance mention), so the copy stays neutral.
    children.push(bodyPara(
      'A synthesized investment opinion is not available for this export run. Please rely on the structured KPIs and risk register below for decision support.',
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
            // `type` is mandatory — without it the docx library writes the
            // media part as `<hash>.undefined` with no [Content_Types].xml
            // entry, producing a file Word must "repair" on open. The site
            // map always comes back from the Google Static Maps API as PNG.
            type: 'png',
            data: mapBuffer,
            transformation: { width: 540, height: 304 },
            altText: { title: 'Site map', description: `Site location at ${ctx.locationLine}`, name: 'site-map' },
          })],
          alignment: AlignmentType.LEFT,
          spacing: { before: 120, after: 120 },
        }));
        children.push(bodyPara('Source: Google Maps Static API.', { italic: true, color: HEX('mutedHigh') }));
      } else {
        // Env-var names are operator diagnostics — logs only, never the
        // customer document.
        children.push(bodyPara('Site map unavailable for this export run.', { italic: true, color: HEX('mutedHigh') }));
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

const SITE_YIELD_BINDING_LABEL = {
  far: 'FAR / FSI',
  coverage_height: 'Ground coverage × height',
  plot_subdivision: 'Plot subdivision',
};

// Site Yield & Massing — the deterministic site-yield programme (units / keys /
// plots, area schedule, parking, binding constraint) recomputed server-side
// from the saved Yield Studio study (or screening defaults from the parcel).
// Platform data (the deterministic kernel), never AI. Auto-hidden when no
// programme is available (ctx.siteYield null).
const buildSiteYield = (ctx) => {
  const sy = ctx.siteYield;
  if (!sy || !sy.computed || !sy.computed.ok) return [];
  const c = sy.computed;
  const e = c.envelope || {};
  const a = c.areaSchedule || {};
  const t = c.totals || {};
  // null/'' guarded FIRST — Number(null) === 0, so the naive isFinite check
  // rendered a fabricated '0' instead of the em-dash.
  const intl = (n) => (n == null || n === '' || !Number.isFinite(Number(n)) ? '–' : Math.round(Number(n)).toLocaleString('en-IN'));

  const children = [];
  children.push(sectionHeading('Site Yield & Massing', { pageBreakBefore: true }));
  children.push(platformBadge());
  if (sy.mode === 'screening_defaults') {
    children.push(bodyPara(
      'Screening estimate from the parcel’s land area and FSI — no saved study yet. Open Yield Studio to refine the assumptions.',
      { italic: true, color: HEX('mutedHigh') },
    ));
  }

  const rows = [];
  if (e.realized_gfa_sqft != null) rows.push(labelValueRow('Realized GFA', formatArea(e.realized_gfa_sqft)));
  if (e.effective_fsi != null) rows.push(labelValueRow('Effective FSI', String(e.effective_fsi)));
  if (e.floors != null) rows.push(labelValueRow('Floors', String(e.floors)));
  rows.push(labelValueRow('Binding constraint', SITE_YIELD_BINDING_LABEL[c.bindingConstraint] || c.bindingConstraint || '–'));
  if (t.units != null) rows.push(labelValueRow('Units', intl(t.units)));
  if (t.keys != null) rows.push(labelValueRow('Keys', intl(t.keys)));
  if (t.plots != null) rows.push(labelValueRow(t.villas != null ? 'Villas' : 'Plots', intl(t.villas != null ? t.villas : t.plots)));
  if (a.saleable_sqft != null) rows.push(labelValueRow('Saleable (SBA)', formatArea(a.saleable_sqft)));
  if (a.leasable_sqft != null) rows.push(labelValueRow('Leasable', formatArea(a.leasable_sqft)));
  if (a.net_saleable_sqft != null) rows.push(labelValueRow('Net saleable', formatArea(a.net_saleable_sqft)));
  // Carpet pool + parking norm: keep the DOCX row set in lockstep with the
  // PPTX slide and XLSX sheet so all three formats tell the same story.
  if (a.carpet_sqft != null) rows.push(labelValueRow('Carpet pool', formatArea(a.carpet_sqft)));
  if (a.saleable_plot_area_sqft != null) rows.push(labelValueRow('Saleable plot area', formatArea(a.saleable_plot_area_sqft)));
  if (c.parking && c.parking.required_ecs != null) rows.push(labelValueRow('Parking (ECS)', intl(c.parking.required_ecs)));
  if (c.parking && c.parking.norm) rows.push(labelValueRow('Parking norm', String(c.parking.norm)));
  if (rows.length) children.push(buildLabelValueTable(rows));

  if (Array.isArray(c.unitMix) && c.unitMix.length) {
    children.push(blank());
    children.push(eyebrow('Unit mix'));
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDER,
      rows: [
        buildHeaderTableRow(['Type', 'Units', 'Carpet (sqft)']),
        ...c.unitMix.map((u, i) => buildBodyTableRow(
          [u.label || u.key, intl(u.count), intl(u.carpet_total_sqft)],
          { alt: i % 2 === 1 },
        )),
      ],
    }));
  }

  if (Number(c.unrealizedFarPct) > 0) {
    children.push(bodyPara(
      `${c.unrealizedFarPct}% of permitted FAR is unrealised at this height — ground coverage × floors caps the build.`,
      { color: HEX('mutedHigh') },
    ));
  }
  if (sy.boundary) {
    children.push(bodyPara(
      `Parcel boundary: ${sy.boundary.source}${sy.boundary.area_sqft != null ? ` · ${formatArea(sy.boundary.area_sqft)}` : ''} · ${sy.boundary.review_status || 'pending'} (verify against a registered survey).`,
      { italic: true, color: HEX('mutedHigh') },
    ));
  }
  if (c.disclaimer) children.push(bodyPara(c.disclaimer, { italic: true, color: HEX('mutedHigh') }));
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
    // BBMP Planning-District tables + Census 2011 facts. Surface the PD line at
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
      // PR-NX41 (2026-05-18) — PD-specific extras (BBMP Planning-District facts)
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
    // PR-NX67 + NX69 (2026-05-19) — augment fallback or quota callout.
    // When Acureal has no structured Census/BBMP row, fall back to Claude's
    // general-knowledge synthesis (NX67); if the user has exhausted their
    // BETA free quota, surface a "Premium AI · Quota Exceeded" message
    // (NX69) instead of the generic placeholder.
    const augment = ctx.exportContext?.market?.aiAugment?.demographics;
    const quotaCallout = augmentQuotaCallout(augment);
    if (quotaCallout) {
      children.push(...quotaCallout);
      return children;
    }
    if (augment?.available && augment.paragraph) {
      children.push(bodyPara(augment.paragraph));
      const prov = augmentProvenanceLine(augment);
      if (prov) children.push(prov);
      } else {
      children.push(bodyPara(
        'Demographic data is not yet available for this micro-market. Manual input required — populate population, income tier, age mix, and literacy on the deal\'s market record before this section can render.',
        { italic: true, color: HEX('mutedHigh') },
      ));
      children.push(bodyPara(
        // PR-NX41 (2026-05-18) — actionable hint for Bengaluru deals
        'Bengaluru deals: open the Parcel tab → click "Derive parcel context" → Apply → re-download the report. The Planning District code unlocks the BBMP Planning-District demographics + Census 2011 facts.',
        { italic: true, color: HEX('mutedLow') },
      ));
    }
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
    return children;
  }

  // PR-NX67 + NX69 (2026-05-19) — augment fallback or quota callout.
  const augment = ctx.exportContext?.market?.aiAugment?.whyThisArea;
  const quotaCallout = augmentQuotaCallout(augment);
  if (quotaCallout) {
    children.push(...quotaCallout);
    return children;
  }
  if (augment?.available && Array.isArray(augment.paragraphs) && augment.paragraphs.length > 0) {
      augment.paragraphs.forEach((p) => { if (p && String(p).trim()) children.push(bodyPara(p)); });
    if (augment.summary) {
      children.push(blank());
      children.push(bodyPara(`Summary: ${augment.summary}`, { bold: true, color: HEX('accent') }));
    }
      const prov = augmentProvenanceLine(augment);
      if (prov) children.push(prov);
      return children;
  }

  children.push(bodyPara(
    'Market context synthesis for this micro-market is not available. ' +
    'Populate locality, infrastructure proximity, and intelligence briefs on the deal record to enable this section.',
    { italic: true, color: HEX('mutedHigh') },
  ));
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
    // PR-NX67 + NX69 (2026-05-19) — augment fallback or quota callout.
    const augment = ctx.exportContext?.market?.aiAugment?.jobGrowth;
    const quotaCallout = augmentQuotaCallout(augment);
    if (quotaCallout) {
      children.push(...quotaCallout);
      return children;
    }
    if (augment?.available && ((Array.isArray(augment.paragraphs) && augment.paragraphs.length > 0)
        || (Array.isArray(augment.bullets) && augment.bullets.length > 0))) {
      (augment.paragraphs || []).forEach((p) => {
        if (p && String(p).trim()) children.push(bodyPara(p));
      });
      if (Array.isArray(augment.bullets) && augment.bullets.length > 0) {
        children.push(blank());
        children.push(bodyPara('Key economic anchors:', { bold: true }));
        augment.bullets.forEach((b) => {
          if (b && String(b).trim()) children.push(bodyPara(`•  ${b}`));
        });
      }
      const prov = augmentProvenanceLine(augment);
      if (prov) children.push(prov);
      } else {
      children.push(bodyPara(
        'No verified intelligence briefs on micro-market job growth are linked to this deal yet. Manual input required — populate Market Intelligence with relevant briefs (GCC announcements, tech-park expansions, employment-area trends) to surface this section.',
        { italic: true, color: HEX('mutedHigh') },
      ));
    }
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
    // PR-NX67 + NX69 (2026-05-19) — augment fallback or quota callout.
    const augment = ctx.exportContext?.market?.aiAugment?.socialInfrastructure;
    const quotaCallout = augmentQuotaCallout(augment);
    if (quotaCallout) {
      children.push(...quotaCallout);
      return children;
    }
    if (augment?.available && augment.buckets && typeof augment.buckets === 'object') {
      const augLabels = {
        schools:     'Schools / education',
        hospitals:   'Hospitals / healthcare',
        retail:      'Retail / malls',
        transit:     'Metro / transit',
        airport:     'Airport',
        expressway:  'Expressway / highway',
      };
      const presenceTag = {
        strong:    'Strong',
        adequate:  'Adequate',
        thin:      'Thin',
        unknown:   '—',
      };
      const augRows = Object.entries(augLabels).map(([k, label]) => {
        const bucket = augment.buckets[k];
        if (!bucket || bucket.presence === 'unknown') return null;
        const examples = Array.isArray(bucket.named_examples) && bucket.named_examples.length > 0
          ? bucket.named_examples.join(', ')
          : '';
        const note = bucket.notes || '';
        const value = [presenceTag[bucket.presence] || bucket.presence, examples, note]
          .filter(Boolean)
          .join(' · ');
        return { label, value };
      }).filter(Boolean);
      if (augRows.length > 0) {
        const headerRow = buildHeaderTableRow(['Category', 'Presence · Named examples · Notes']);
        const bodyRows = augRows.map((r, idx) => buildBodyTableRow([r.label, r.value], { alt: idx % 2 === 1 }));
        children.push(new Table({
          rows: [headerRow, ...bodyRows],
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: TABLE_BORDER,
        }));
      } else {
        children.push(bodyPara(
          `AI could not identify named social-infrastructure anchors for this locality. ${augment.dataQuality === 'unknown' ? 'Locality is outside AI training depth.' : ''}`,
          { italic: true, color: HEX('mutedHigh') },
        ));
      }
      } else {
      children.push(bodyPara(
        'Social infrastructure proximity has not been ingested for this deal yet. Manual input required — populate the Property record with distances to nearby schools, hospitals, retail, transit, airport, and expressway.',
        { italic: true, color: HEX('mutedHigh') },
      ));
    }
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
    // PR-NX67 + NX69 (2026-05-19) — augment fallback or quota callout.
    const augment = ctx.exportContext?.market?.aiAugment?.supplyDemandPipeline;
    const quotaCallout = augmentQuotaCallout(augment);
    if (quotaCallout) {
      children.push(...quotaCallout);
      return children;
    }
    if (augment?.available && Array.isArray(augment.paragraphs) && augment.paragraphs.length > 0) {
      augment.paragraphs.forEach((p) => { if (p && String(p).trim()) children.push(bodyPara(p)); });
      if (augment.caution) {
        children.push(blank());
        children.push(bodyPara(`Caution: ${augment.caution}`, { bold: true, color: HEX('dataWarning') }));
      }
      return children;
    }
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
    'Three closest peers ranked by rate-per-sqft proximity to this deal\'s modeled pricing. ' +
    'These are alternatives the same buyer could have considered — surface them for context, not as a recommendation. ' +
    'Source and verification status are shown per row; confirm freshness against external sources.',
    { italic: true, color: HEX('mutedHigh') },
  ));
  children.push(blank());

  const headerRow = buildHeaderTableRow(['Project', 'Developer', 'Type', 'Rate / sqft', 'Δ vs deal', 'Source · status']);
  const bodyRows = top3.map((c, idx) => {
    const delta = (dealRate != null && c.rate_per_sqft != null)
      ? `${c.rate_per_sqft > dealRate ? '+' : ''}${formatNumber((c.rate_per_sqft - dealRate) / dealRate * 100, 1)}%`
      : '–';
    const prov = deriveCompProvenance(c);
    return buildBodyTableRow([
      firstText(c.project_name) || '–',
      firstText(c.developer) || '–',
      firstText(c.project_type, c.bhk_config) || '–',
      formatRate(c.rate_per_sqft),
      delta,
      `${prov.sourceTypeLabel} · ${prov.verifiedLabel}`,
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
      'No comparable transactions are available for this micro-market at the time of generation. Manual input required.',
      { italic: true, color: HEX('mutedHigh') },
    ));
    return children;
  }

  // Per-row provenance replaces the old bare "Verified Yes/No" (which read a null
  // flag as "Yes"). Each row now carries source-type · verified status · the
  // honest "as of <date>" freshness — the CLAUDE.md hard rule for comps.
  const headerRow = buildHeaderTableRow(['Project', 'Developer', 'Type', 'Units', 'Rate / sqft', 'Source · status · freshness']);
  const bodyRows = comps.map((c, idx) => buildBodyTableRow([
    firstText(c.project_name) || '–',
    firstText(c.developer) || '–',
    firstText(c.project_type, c.bhk_config) || '–',
    c.total_units != null ? String(c.total_units) : '–',
    c.rate_per_sqft != null ? formatRate(c.rate_per_sqft) : '–',
    formatProvenanceLine(c),
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

// ─────────────────────────────────────────────────────────────────────────
// Deal Register (rent roll / sales & collections / operating roll / occupants)
// ─────────────────────────────────────────────────────────────────────────
// Deterministic income evidence from the deal register — rentRoll.service
// getExportSlice recomputes the metrics from live rows at export time. Summary
// grade: the committed headline block + a truncated records table; the full
// register with live formulas is the XLSX workbook. PLATFORM DATA, never AI.

const REGISTER_DOC_TITLE = {
  lease_income: 'Rent Roll',
  sales_collections: 'Sales & Collections',
  hotel_operating: 'Operating Roll',
  redevelopment: 'Occupants & Sales',
};
const LEASE_STATUS_DOC = { vacant: 'Vacant', loi: 'LOI', committed: 'Committed', occupied: 'Occupied', notice_served: 'Notice served', expired: 'Expired / MTM' };
const SALE_STATUS_DOC = { unsold: 'Unsold', booked: 'Booked', sold: 'Sold', registered: 'Registered', cancelled: 'Cancelled' };
const OCC_STATUS_DOC = { in_place: 'In place', vacated: 'Vacated', disputed: 'Disputed' };
const RISK_DOC = { low: 'Low', medium: 'Medium', high: 'High' };
const CONTRACT_TYPE_DOC = { hma: 'HMA', franchise: 'Franchise', master_lease: 'Master lease', revenue_share: 'Revenue share', other: 'Other' };
const REGISTER_DOC_CAP = 15;

const registerCountRecords = (records = {}) =>
  Object.values(records || {}).reduce((n, rows) => n + (Array.isArray(rows) ? rows.length : 0), 0);

// Register money aggregates arrive in absolute ₹; show ₹ Cr for headline
// figures, raw ₹ for per-record consideration.
const rrCr = (v) => { const n = num(v); return n === null ? '–' : formatCrores(n / 1e7, 2); };
const rrRupees = (v) => { const n = num(v); return n === null ? '–' : `INR ${formatNumber(n)}`; };
const rrText = (v) => (v == null || String(v).trim() === '' ? '–' : String(v));

const registerTable = (headers, bodyRows) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: TABLE_BORDER,
  rows: [buildHeaderTableRow(headers), ...bodyRows],
});

const registerTruncNote = (children, shown, total) => {
  if (total > shown) {
    children.push(bodyPara(
      `Showing ${shown} of ${total} record(s) — the full register with live formulas is in the Excel workbook.`,
      { italic: true, color: HEX('mutedHigh') },
    ));
  }
};

const appendLeaseRegisterDoc = (children, slice) => {
  const m = slice.metrics || {};
  const occ = m.occupancy || {};
  const wale = m.wale || {};
  const rev = m.revenue || {};
  const mtm = m.mtm || {};
  const counts = m.counts || {};
  children.push(buildLabelValueTable([
    labelValueRow('Committed occupancy', formatPct(occ.committedPct)),
    labelValueRow('Physical occupancy', formatPct(occ.physicalPct)),
    labelValueRow('Leasable area', formatArea(occ.denominatorSqft)),
    labelValueRow('WALE to expiry (rent-weighted)', wale.toExpiryRentYears == null ? '–' : `${formatNumber(wale.toExpiryRentYears, 1)} yr`),
    labelValueRow('In-place vs market (MTM)', formatPct(mtm.portfolioPct)),
    labelValueRow('In-place rent', rev.inPlaceRentPerSqftMonth == null ? '–' : `INR ${formatNumber(rev.inPlaceRentPerSqftMonth, 2)} / sqft / mo`),
    labelValueRow('Contracted annual gross', rrCr(rev.contractedAnnualGross)),
    labelValueRow('Accrual NOI', rrCr(rev.accrualNOI)),
    labelValueRow('Coverage', `${counts.contracted || 0} contracted · ${counts.vacant || 0} vacant · ${counts.loi || 0} LOI`),
  ]));
  const rows = (slice.records && slice.records.lease) || [];
  const shown = rows.slice(0, REGISTER_DOC_CAP);
  children.push(blank());
  children.push(registerTable(
    ['Unit / Ref', 'Tenant / Occupier', 'Status', 'Area (sqft)', 'Base rate', 'Expiry', 'Market rate'],
    shown.map((r, i) => buildBodyTableRow([
      rrText(r.record_label), rrText(r.tenant_name), LEASE_STATUS_DOC[r.status] || rrText(r.status),
      formatNumber(r.chargeable_area_sqft), formatNumber(r.base_rent_rate, 2),
      formatDate(r.lease_expiry), formatNumber(r.market_rent_rate, 2),
    ], { alt: i % 2 === 1 })),
  ));
  registerTruncNote(children, shown.length, rows.length);
};

const appendSalesRegisterDoc = (children, slice) => {
  const m = slice.metrics || {};
  const inv = m.inventory || {};
  const area = m.area || {};
  const coll = m.collections || {};
  const unsold = m.unsold || {};
  const pricing = m.pricing || {};
  children.push(buildLabelValueTable([
    labelValueRow('Units (active)', formatNumber(inv.totalUnits)),
    labelValueRow('Sold units', formatNumber(inv.soldUnits)),
    labelValueRow('Sell-through (by area)', formatPct(area.sellThroughByAreaPct)),
    labelValueRow('Sold GDV', rrCr(coll.soldGDV)),
    labelValueRow('Collected', rrCr(coll.collected)),
    labelValueRow('Collection efficiency', formatPct(coll.collectionEfficiencyPct)),
    labelValueRow('Overdue', rrCr(coll.overdue)),
    labelValueRow('Avg sold rate', pricing.avgSoldRealizationPerSqft == null ? '–' : `INR ${formatNumber(pricing.avgSoldRealizationPerSqft)} / sqft`),
    labelValueRow('Unsold GDV (market)', rrCr(unsold.unsoldGDV)),
  ]));
  const rows = (slice.records && slice.records.sale) || [];
  const shown = rows.slice(0, REGISTER_DOC_CAP);
  children.push(blank());
  children.push(registerTable(
    ['Plot / Unit', 'Block / Phase', 'Status', 'Area (sqft)', 'Base ₹/sqft', 'Agreement', 'Collected'],
    shown.map((r, i) => buildBodyTableRow([
      rrText(r.record_label), rrText(r.block_phase), SALE_STATUS_DOC[r.status] || rrText(r.status),
      formatNumber(r.area_sqft), formatNumber(r.base_price_per_sqft), rrRupees(r.agreement_value), rrRupees(r.amount_collected),
    ], { alt: i % 2 === 1 })),
  ));
  registerTruncNote(children, shown.length, rows.length);
};

const appendHotelRegisterDoc = (children, slice) => {
  const m = slice.metrics || {};
  const keys = m.keys || {};
  const contract = m.contract || {};
  const op = m.operating || {};
  const contractText = contract.primaryType
    ? `${CONTRACT_TYPE_DOC[contract.primaryType] || contract.primaryType}${contract.operator ? ` · ${contract.operator}` : ''}${contract.brand ? ` (${contract.brand})` : ''}`
    : 'None recorded';
  children.push(buildLabelValueTable([
    labelValueRow('Total keys', formatNumber(keys.totalKeys)),
    labelValueRow('Available keys (net OOO)', formatNumber(keys.availableKeys, 1)),
    labelValueRow('Governing contract', contractText),
    labelValueRow('TTM occupancy', formatPct(op.ttmOccupancyPct)),
    labelValueRow('TTM ADR', op.ttmAdr == null ? '–' : `INR ${formatNumber(op.ttmAdr)}`),
    labelValueRow('TTM RevPAR', op.ttmRevpar == null ? '–' : `INR ${formatNumber(op.ttmRevpar)}`),
    labelValueRow('TTM GOP margin', formatPct(op.ttmGopMarginPct)),
    labelValueRow('TTM total revenue', rrCr(op.ttmTotalRevenue)),
    labelValueRow('TTM owner NOI', rrCr(op.ttmOwnerNoi)),
  ]));
  const series = Array.isArray(op.series) ? op.series : [];
  const shown = series.slice(-REGISTER_DOC_CAP);
  if (shown.length) {
    children.push(blank());
    children.push(eyebrow('Operating history — actual monthly P&L'));
    children.push(registerTable(
      ['Month', 'Occupancy', 'ADR', 'RevPAR', 'Total revenue', 'GOP', 'Owner NOI'],
      shown.map((s, i) => buildBodyTableRow([
        rrText(s.month), formatPct(s.occupancyPct),
        s.adr == null ? '–' : `INR ${formatNumber(s.adr)}`,
        s.revpar == null ? '–' : `INR ${formatNumber(s.revpar)}`,
        rrRupees(s.totalRevenue), rrRupees(s.gop), rrRupees(s.ownerNoi),
      ], { alt: i % 2 === 1 })),
    ));
    registerTruncNote(children, shown.length, series.length);
  }
};

const appendOccupantRegisterDoc = (children, slice) => {
  const m = slice.metrics || {};
  const occ = m.occupant || {};
  const sale = m.sale || {};
  const vac = occ.vacancy || {};
  const ent = occ.entitlement || {};
  const obl = occ.obligations || {};
  const risk = occ.risk || {};
  children.push(buildLabelValueTable([
    labelValueRow('Vacation progress (by count)', formatPct(vac.vacatedByCountPct)),
    labelValueRow('Vacation progress (by area)', formatPct(vac.vacatedByAreaPct)),
    labelValueRow('Existing carpet', formatArea(ent.existingCarpetSqft)),
    labelValueRow('Free rehab area', formatArea(ent.rehabEntitlementSqft)),
    labelValueRow('Area uplift over existing', formatPct(ent.avgUpliftPct)),
    labelValueRow('Current transit run-rate', obl.currentMonthlyTransitRent == null ? '–' : `INR ${formatNumber(obl.currentMonthlyTransitRent)} / mo`),
    labelValueRow('Transit remaining', rrCr(obl.transitRentRemaining)),
    labelValueRow('One-time obligations', rrCr(obl.oneTimeTotal)),
    labelValueRow('Total rehousing obligation', rrCr(obl.totalRehousingObligation)),
    labelValueRow('At-risk occupiers', `${risk.atRiskUnits || 0} (${risk.highRiskUnits || 0} high doc-risk · ${risk.disputedUnits || 0} disputed)`),
  ]));
  const occupants = (slice.records && slice.records.occupant) || [];
  const shownOcc = occupants.slice(0, REGISTER_DOC_CAP);
  children.push(blank());
  children.push(eyebrow('Existing occupiers & rehousing obligations'));
  children.push(registerTable(
    ['Unit / Ref', 'Occupant', 'Status', 'Existing (sqft)', 'Rehab (sqft)', 'Transit ₹/mo', 'Doc risk'],
    shownOcc.map((r, i) => buildBodyTableRow([
      rrText(r.record_label), rrText(r.occupant_name), OCC_STATUS_DOC[r.status] || rrText(r.status),
      formatNumber(r.existing_carpet_area_sqft), formatNumber(r.rehab_entitlement_sqft),
      formatNumber(r.transit_rent_monthly), RISK_DOC[r.documentation_risk] || '–',
    ], { alt: i % 2 === 1 })),
  ));
  registerTruncNote(children, shownOcc.length, occupants.length);
  // Free-sale one-liner (the sales register already renders in full for plotted deals).
  const freeSale = (slice.records && slice.records.sale) || [];
  if (freeSale.length) {
    const si = sale.inventory || {};
    const sc = sale.collections || {};
    children.push(blank());
    children.push(bodyPara(
      `Free sale: ${si.soldUnits || 0}/${si.totalUnits || 0} units sold · sold GDV ${rrCr(sc.soldGDV)} · collection ${formatPct(sc.collectionEfficiencyPct)}.`,
      { color: HEX('mutedHigh') },
    ));
  }
};

const buildRentRoll = (ctx) => {
  const children = [sectionHeading('Deal Register'), platformBadge()];
  const slice = ctx.exportContext && ctx.exportContext.rentRoll;
  if (!slice || !slice.family || registerCountRecords(slice.records) === 0) {
    children.push(bodyPara(
      'No register has been created for this deal yet. The rent roll / sales & collections / operating roll / occupant register is captured in the deal workspace and appears here once records are added.',
      { italic: true, color: HEX('mutedHigh') },
    ));
    return children;
  }
  children.push(eyebrow(`${REGISTER_DOC_TITLE[slice.family] || 'Deal Register'} · as of ${formatDate(slice.asOfDate)} · figures are gross (pre ownership share)`));

  if (slice.family === 'lease_income') appendLeaseRegisterDoc(children, slice);
  else if (slice.family === 'sales_collections') appendSalesRegisterDoc(children, slice);
  else if (slice.family === 'hotel_operating') appendHotelRegisterDoc(children, slice);
  else if (slice.family === 'redevelopment') appendOccupantRegisterDoc(children, slice);

  const warnings = Array.isArray(slice.warnings) ? slice.warnings : [];
  if (warnings.length) {
    children.push(blank());
    children.push(eyebrow('Register consistency'));
    warnings.slice(0, 5).forEach((w) => children.push(bodyPara(`• ${w.message}`, { color: HEX('dataWarning') })));
  }
  return children;
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
        // AI-disclosure policy: customer exports never name providers — the
        // single cover disclaimer covers model-assisted synthesis for the
        // whole report. Field count + status is the useful part.
        extractionCell = `${ex.field_count} field${ex.field_count === 1 ? '' : 's'} extracted`;
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

        // Extraction date only — provider names never appear in customer
        // exports (AI-disclosure policy; the cover disclaimer is the single
        // model-assistance mention for the whole report).
        if (ext.extracted_at) {
          children.push(bodyPara(`Extracted ${formatDate(ext.extracted_at)}`, { italic: true, color: HEX('mutedLow') }));
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

// PR-B (2026-05-25) — Recommendation Engine section. Surfaces the engine's
// candidate cards as an IC-ready action list: verb, headline, severity tier,
// evidence-link count. Renders before Pros & Cons because actions sit logically
// upstream of descriptive synthesis. Empty state degrades cleanly.
const SEVERITY_LABEL = { 5: 'Critical', 4: 'High', 3: 'Medium', 2: 'Low', 1: 'Informational' };
const severityHexForCard = (sev) => {
  const n = Number(sev);
  if (n >= 5) return HEX('dataNegative');
  if (n >= 4) return HEX('premium');
  if (n >= 3) return HEX('dataNeutral');
  return HEX('mutedHigh');
};

const buildRecommendations = (ctx) => {
  const children = [];
  children.push(sectionHeading('Recommendations', { pageBreakBefore: true }));
  children.push(platformBadge());

  const slice = ctx.exportContext?.recommendations || null;
  const cards = Array.isArray(slice?.recommendations) ? slice.recommendations : [];

  if (cards.length === 0) {
    children.push(bodyPara(
      'No recommendations to report. Either the deal does not yet carry the inputs the engine evaluates (financials, comps, approvals, DD items), or every evaluated band is within acceptable thresholds.',
      { italic: true, color: HEX('mutedHigh') },
    ));
    return children;
  }

  // Lead paragraph — uses the same summariser the deal-list chip uses.
  const summary = slice?.summary || {};
  const headlineParts = [];
  if (summary.by_severity?.critical) headlineParts.push(`${summary.by_severity.critical} critical`);
  if (summary.by_severity?.high) headlineParts.push(`${summary.by_severity.high} high`);
  if (summary.by_severity?.medium) headlineParts.push(`${summary.by_severity.medium} medium`);
  if (summary.by_severity?.low) headlineParts.push(`${summary.by_severity.low} low`);
  const headlineLine = headlineParts.length
    ? `${cards.length} recommendation${cards.length === 1 ? '' : 's'} generated — ${headlineParts.join(', ')}.`
    : `${cards.length} recommendation${cards.length === 1 ? '' : 's'} generated.`;
  children.push(bodyPara(headlineLine));

  // Each card as: verb · topic · severity, then headline + detail, then
  // evidence count. We rank by severity descending so the IC reader leads
  // with the critical items.
  const sorted = [...cards].sort(
    (a, b) => (Number(b.severity) || 0) - (Number(a.severity) || 0),
  );

  for (const card of sorted) {
    children.push(blank());
    // Top line: verb, topic_label, severity tier — all on one row using
    // tab stops so the severity sits flush right.
    const sevLabel = SEVERITY_LABEL[Number(card.severity)] || 'Informational';
    children.push(new Paragraph({
      children: [
        new TextRun({
          text: card.verb || 'Recommend',
          font: FONT, size: 22, bold: true,
          color: HEX('ink'),
        }),
        new TextRun({
          text: `   ${card.topic_label || ''}`,
          font: FONT, size: 20, color: HEX('mutedHigh'), italics: true,
        }),
        new TextRun({
          text: `\t${sevLabel}`,
          font: FONT, size: 18, bold: true,
          color: severityHexForCard(card.severity),
        }),
      ],
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      spacing: { before: 80, after: 40 },
    }));

    // Headline + detail.
    children.push(bodyPara(card.headline || '', { spacing: { after: 40 } }));
    if (card.detail) {
      children.push(bodyPara(card.detail, {
        italic: true, color: HEX('mutedHigh'), spacing: { after: 40 },
      }));
    }

    // Evidence footnote.
    const evidenceCount = Array.isArray(card.evidence) ? card.evidence.length : 0;
    const evidenceLabels = Array.isArray(card.evidence)
      ? card.evidence.map((e) => e.label || e.ref || '').filter(Boolean)
      : [];
    if (evidenceCount > 0) {
      const tail = evidenceLabels.length <= 3
        ? evidenceLabels.join(' · ')
        : `${evidenceLabels.slice(0, 3).join(' · ')} · +${evidenceLabels.length - 3} more`;
      children.push(bodyPara(
        `Evidence (${evidenceCount}): ${tail}`,
        { font: FONT, color: HEX('mutedHigh'), size: 16 },
      ));
    }
  }

  return children;
};

// PR-B (2026-05-25) — AI Deal Doctor section. Diagnostic findings grouped by
// theme (Underwriting / Market & comps / Execution & data / Legal carve-out).
// Empty state degrades cleanly.
const buildDealDoctor = (ctx) => {
  const children = [];
  children.push(sectionHeading('Deal Doctor — Diagnostic Findings', { pageBreakBefore: true }));
  children.push(platformBadge());

  const slice = ctx.exportContext?.deal_doctor || null;
  const groups = Array.isArray(slice?.groups) ? slice.groups : [];
  const totalFindings = Number(slice?.finding_count) || 0;

  if (totalFindings === 0 || groups.length === 0) {
    children.push(bodyPara(
      'No diagnostic findings. Either the deal looks clean against current benchmarks, or there is not yet enough data on file to evaluate.',
      { italic: true, color: HEX('mutedHigh') },
    ));
    return children;
  }

  children.push(bodyPara(
    `${totalFindings} finding${totalFindings === 1 ? '' : 's'} across ${groups.length} diagnostic theme${groups.length === 1 ? '' : 's'}.`,
  ));

  for (const group of groups) {
    children.push(blank());
    children.push(eyebrow(group.label || group.key || 'Findings'));

    const findings = Array.isArray(group.findings) ? group.findings : [];
    const sorted = [...findings].sort((a, b) => (Number(b.severity) || 0) - (Number(a.severity) || 0));

    for (const f of sorted) {
      const sevLabel = SEVERITY_LABEL[Number(f.severity)] || 'Informational';
      children.push(new Paragraph({
        children: [
          new TextRun({
            text: f.verb || 'Diverges',
            font: FONT, size: 20, bold: true, color: HEX('ink'),
          }),
          new TextRun({
            text: `\t${sevLabel}`,
            font: FONT, size: 18, bold: true,
            color: severityHexForCard(f.severity),
          }),
        ],
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        spacing: { before: 60, after: 30 },
      }));
      children.push(bodyPara(f.finding || '', { spacing: { after: 30 } }));
      if (f.why_it_matters) {
        children.push(bodyPara(`Why it matters — ${f.why_it_matters}`, {
          italic: true, color: HEX('mutedHigh'), spacing: { after: 40 },
        }));
      }
    }
  }

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
      'Pros & Cons synthesis is not available for this deal. Please refer to the structured KPIs, risk register, and DD log for decision support.',
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
  // PR-NX74 (2026-05-19) — copy revised to drop the "no AI numerics" /
  // "AI restricted to interpretation paragraphs" framing per operator
  // policy (the report should not lean on AI as a marketing concept).
  // The technical guarantee remains the same: the deterministic kernel
  // produces every number. The cover-page disclaimer covers AI usage.
  children.push(eyebrow('How numbers in this report were computed'));
  children.push(bodyPara(
    `${ctx.brandName}'s deterministic TypeScript financial kernel (packages/financial-kernel) computed every numeric figure in this report. The kernel runs asset-class-specific models (residential RERA escrow, hospitality USALI, commercial NOI build, plotted absorption, mixed-use component blend, raw-land entitlement pipeline) parameterised by the operator's inputs listed below.`,
  ));
  children.push(bodyPara(
    `The same kernel + the same inputs drive every Acureal export format. Reviewers comparing different formats will see identical figures to the last decimal.`,
    { italic: true, color: HEX('mutedHigh') },
  ));
  children.push(bodyPara(
    `Indian operating reality: GST tiers (5% residential / 12% commercial / 0% plotted), Karnataka stamp duty + registration (7.6% acquisition — registration doubled to 2% in Aug 2025), RERA 70/30 escrow on customer collections, BBMP UAV property tax method (area-driven, not revenue), Khata A/B exit haircuts, JDA revenue-share / area-share accounting, Indian lender ecosystem (Repo / MCLR benchmarks + India-specific spreads) are all encoded directly in the kernel — see XLSX_INSTITUTIONAL_GRADE_ROADMAP.md for the full India-localization map.`,
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

  // PR-NX74 (2026-05-19) — simplified disclaimer copy. Removed the
  // "AI-assisted draft" framing + the "AI-Assisted vs Platform Data"
  // bifurcation block. The cover-page small disclaimer (Arial 7pt) is
  // the single canonical reference to model-assisted synthesis.
  children.push(bodyPara(
    'This report is generated by Acureal from stored deal data and verified market sources. It is intended for internal investment review and is not a recommendation to buy, sell, or otherwise transact in any property or security.',
  ));
  children.push(blank());
  children.push(bodyPara(
    'All numerical figures originate from Acureal\'s deterministic financial kernel applied to the operator-entered inputs. Interpretive paragraphs are synthesised from the same structured data. Treat every value as a faithful representation of what was captured in Acureal at generation time — not as a warranted fact. Verify every figure and interpretation against the underlying source documents before relying on it.',
  ));
  children.push(blank());
  children.push(eyebrow('Hard rules'));
  children.push(bodyPara(
    '• Acureal does not warrant zoning, legal title, RERA registration, encumbrance status, approval status, or any other regulatory fact in this document. Where the data is missing or unverifiable, the report explicitly says so. Independent verification through Karnataka land-records (Bhoomi / Kaveri portal) and Karnataka RERA is required before any investment decision.',
  ));
  children.push(bodyPara(
    '• Comparables carry per-row source, verification status, and freshness. Only rows marked Verified have been confirmed in Acureal; treat all others as context. Market intelligence is current as of the generation date shown on the cover; confirm freshness against external sources.',
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
    brandName: options.brandName || 'Acureal',
    generatedAt: options.generatedAt || exportContext.generatedAt || new Date().toISOString(),
    // Latest committed kernel computation. This view-model is an explicit
    // allowlist — a field absent here is silently dropped from every section,
    // so the reference must be threaded through deliberately.
    computationRef: exportContext.computationRef || null,
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
    ...buildSiteYield(ctx),
    ...buildDemographics(ctx),
    ...buildWhyThisArea(ctx),
    ...buildJobGrowth(ctx),
    ...buildSocialInfrastructure(ctx),
    ...buildSupplyDemand(ctx),
    ...buildComparables(ctx),
    ...buildBetterAlternatives(ctx),
    ...buildFinancials(ctx),
    // Deal register (rent roll / sales / operating roll / occupants) — the
    // contracted-income evidence under the model, right after Financials.
    ...buildRentRoll(ctx),
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
    // PR-B (2026-05-25) — Recommendation Engine + AI Deal Doctor sections.
    // Sit after Document-Derived Insights and BEFORE Pros & Cons because
    // actions (Recommendations) + diagnoses (Deal Doctor) are upstream of
    // descriptive synthesis. Both empty-state cleanly when the engine
    // has not yet produced cards for this deal.
    ...buildRecommendations(ctx),
    ...buildDealDoctor(ctx),
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
                // PR-NX74 (2026-05-19) — removed "AI-Assisted Draft" suffix.
                text: `${ctx.brandName}   |   ${ctx.dealTitle}`,
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
    // Deal register (rent-roll program) — PR-10
    buildRentRoll,
    registerCountRecords,
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
