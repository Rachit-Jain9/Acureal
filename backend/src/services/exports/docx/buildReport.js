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
    const rows = [
      demo.population_total      != null ? labelValueRow('Population (micro-market)', formatNumber(demo.population_total)) : null,
      demo.population_density    != null ? labelValueRow('Population density',         `${formatNumber(demo.population_density)} / sq km`) : null,
      demo.median_age            != null ? labelValueRow('Median age',                 `${formatNumber(demo.median_age, 1)} years`) : null,
      demo.median_household_inr  != null ? labelValueRow('Median household income',    `INR ${formatNumber(demo.median_household_inr, 1)} L / yr`) : null,
      demo.income_tier           != null ? labelValueRow('Income tier',                String(demo.income_tier)) : null,
      demo.literacy_pct          != null ? labelValueRow('Literacy',                   `${formatNumber(demo.literacy_pct, 1)}%`) : null,
      demo.working_population_pct != null ? labelValueRow('Working population',        `${formatNumber(demo.working_population_pct, 1)}%`) : null,
    ].filter(Boolean);
    children.push(buildLabelValueTable(rows));
  } else {
    children.push(bodyPara(
      'Demographic data is not yet available for this micro-market. Manual input required — populate population, income tier, age mix, and literacy on the deal\'s market record before this section can render.',
      { italic: true, color: HEX('mutedHigh') },
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
  const [prosCons, whyThisArea, siteSection] = await Promise.all([
    prosConsPromise,
    whyThisAreaPromise,
    buildSiteInformation(ctx),
  ]);
  ctx.prosCons = prosCons;
  ctx.whyThisArea = whyThisArea;

  const documentChildren = [
    ...buildCover(ctx),
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
