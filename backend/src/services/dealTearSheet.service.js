'use strict';

/**
 * Investor Tear Sheet PDF builder.
 *
 * Single comprehensive PDF for a deal — replaces the basic 1-page
 * deal summary at /exports/deals/:dealId/pdf. Combines on a 2-page
 * landscape A4:
 *
 *   Page 1 — Cover + Snapshot
 *     • Navy header bar (REDIP / Investor Tear Sheet / deal name)
 *     • Stage / priority / asset-class / structure pills
 *     • KPI strip (4-up): IRR, Equity Multiple, Total Cost, Total Revenue
 *     • Two columns:
 *         left — Property card (name, address, area, zoning, RERA, owner)
 *         right — Deal Economics card (land cost, total cost, revenue,
 *                 gross margin, residual land value, ask vs negotiated)
 *     • Readiness ribbon (DD %, approvals %, risks count, IC recommendation)
 *
 *   Page 2 — Synthesis + Risks + Comps
 *     • AI Synthesis excerpt (latest ic_memo or risk_brief artifact, abridged)
 *         — clearly labeled "AI-assisted — requires human review"
 *     • Risk register table (open flags, severity-sorted)
 *     • Top 5 nearby comps (rate/sqft, source, verified flag)
 *     • Disclaimer + page footer
 *
 * Why pdf-lib (vs puppeteer/headless Chrome): same rationale as
 * intelligenceExport.service.js — slim bundle, no Vercel cold-start
 * penalty for spinning Chrome, and matches the editorial chrome the
 * Market Intelligence tear-sheet uses so the family of PDFs reads as
 * one product.
 *
 * Why landscape A4: matches Market Intelligence tear-sheet for
 * consistency, and the wider canvas lets us run two columns (property
 * | economics) on page 1 without cramping type below the 8pt floor.
 *
 * What's intentionally NOT in this PDF:
 *   • Full IC memo (use the IC memo .md export — analyst can sign off
 *     on the full memo separately).
 *   • Charts. pdf-lib has no SVG import; charts as paths are a
 *     follow-up. Tables convey the same info for an IC-level snapshot.
 *   • Sensitivity grids — moves the page count past 2 and isn't what a
 *     tear-sheet is for.
 */

// pdf-lib (~365ms to load) is accessed through the lazy shim so this module —
// which is boot-reachable via the export routes — never forces the library
// onto the serverless cold-start path. See lib/lazyPdfLib.js.
const { pdfLib, rgb, lazyByFactory, A4_LANDSCAPE } = require('../lib/lazyPdfLib');
const { getDealExportContext } = require('./dealExport.service');
const aiArtifacts = require('./aiArtifacts.service');
const log = require('../lib/logger').child({ module: 'dealTearSheet' });

// ── Constants ──────────────────────────────────────────────────────────────

// Landscape A4. Same physical paper as the Market Intelligence tear-sheet.
const PAGE_LANDSCAPE = A4_LANDSCAPE; // [width, height] in PDF points
const MARGIN_X = 40;
const MARGIN_BOTTOM = 36;
const HEADER_HEIGHT = 56;

// Editorial palette — identical to intelligenceExport so the two PDFs
// look like one product family. Lazy (Proxy) so the module-scope palette
// doesn't force pdf-lib onto the cold-start path; call sites unchanged.
const COLORS = lazyByFactory(({ rgb: liveRgb }) => ({
  navy:     liveRgb(0.06, 0.13, 0.27),
  accent:   liveRgb(0.15, 0.39, 0.92),
  slate900: liveRgb(0.12, 0.16, 0.22),
  slate700: liveRgb(0.27, 0.33, 0.4),
  slate500: liveRgb(0.45, 0.5, 0.58),
  slate300: liveRgb(0.74, 0.78, 0.83),
  slate200: liveRgb(0.89, 0.91, 0.94),
  slate100: liveRgb(0.96, 0.97, 0.98),
  white:    liveRgb(1, 1, 1),
  green:    liveRgb(0.09, 0.64, 0.37),
  amber:    liveRgb(0.85, 0.52, 0.07),
  red:      liveRgb(0.86, 0.19, 0.19),
}));

// ── Pure formatters ────────────────────────────────────────────────────────

const safeText = (value) =>
  String(value ?? '—')
    .replace(/₹/g, 'INR ')
    .replace(/—/g, '-')
    .replace(/–/g, '-')
    .replace(/×/g, 'x')
    .replace(/[^\x20-\x7E\n]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim() || '-';

const fmtNum = (value, decimals = 0) => {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
};

// Force fixed precision (vs maxFractionDigits) so investor-grade numbers
// always read as tabular ("INR 12.50 Cr", never "INR 12.5 Cr"). Uses
// en-IN grouping (lakh/crore comma style) to match the rest of the app.
const fmtFixed = (value, decimals) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};
const fmtCr  = (v) => { const f = fmtFixed(v, 2); return f == null ? '-' : `INR ${f} Cr`; };
const fmtPct = (v) => { const f = fmtFixed(v, 1); return f == null ? '-' : `${f}%`; };
const fmtX   = (v) => { const f = fmtFixed(v, 2); return f == null ? '-' : `${f}x`; };
const fmtArea = (sqft) => {
  if (sqft == null) return '-';
  const n = Number(sqft);
  if (!Number.isFinite(n)) return '-';
  if (n >= 43560) return `${(n / 43560).toFixed(2)} ac (${fmtNum(n, 0)} sqft)`;
  return `${fmtNum(n, 0)} sqft`;
};

const titleCase = (s) =>
  String(s || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());

// ── Drawing helpers ────────────────────────────────────────────────────────

const drawHeader = (page, fonts, { title, subtitle }) => {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: height - HEADER_HEIGHT, width, height: HEADER_HEIGHT, color: COLORS.navy });
  page.drawText('REDIP', {
    x: MARGIN_X, y: height - 32, size: 18, font: fonts.bold, color: COLORS.white,
  });
  page.drawText(safeText(title), {
    x: MARGIN_X + 92, y: height - 28, size: 13, font: fonts.bold, color: COLORS.white,
  });
  if (subtitle) {
    page.drawText(safeText(subtitle), {
      x: MARGIN_X + 92, y: height - 44, size: 8, font: fonts.regular, color: rgb(0.76, 0.84, 0.95),
    });
  }
};

const drawFooter = (page, fonts, { generatedBy, pageNum, pageTotal }) => {
  const { width } = page.getSize();
  page.drawText(
    `REDIP Investor Tear-Sheet  -  generated by ${safeText(generatedBy)} on ${new Date().toISOString().slice(0, 10)}  -  AI-assisted, requires human review`,
    { x: MARGIN_X, y: 16, size: 7, font: fonts.regular, color: COLORS.slate500 },
  );
  page.drawText(`Page ${pageNum} of ${pageTotal}`, {
    x: width - MARGIN_X - 60, y: 16, size: 7, font: fonts.regular, color: COLORS.slate500,
  });
};

const drawSectionHeader = (page, fonts, { x, y, eyebrow, title, sub }) => {
  if (eyebrow) {
    page.drawText(safeText(eyebrow).toUpperCase(), {
      x, y, size: 7, font: fonts.bold, color: COLORS.slate500,
    });
  }
  page.drawText(safeText(title), {
    x, y: y - 16, size: 13, font: fonts.bold, color: COLORS.slate900,
  });
  if (sub) {
    page.drawText(safeText(sub), {
      x, y: y - 30, size: 8.5, font: fonts.regular, color: COLORS.slate700,
    });
    return y - 44;
  }
  return y - 30;
};

// Stage/priority/asset-class chips on the cover page.
const drawPills = (page, fonts, { x, y, items }) => {
  let cx = x;
  for (const pill of items) {
    if (!pill?.label) continue;
    const text = safeText(pill.label).toUpperCase();
    const textW = fonts.bold.widthOfTextAtSize(text, 7.5);
    const padX = 6;
    const w = textW + padX * 2;
    const h = 14;
    page.drawRectangle({
      x: cx, y: y - h, width: w, height: h,
      color: pill.fill || COLORS.slate100,
      borderColor: pill.border || COLORS.slate200, borderWidth: 0.5,
    });
    page.drawText(text, {
      x: cx + padX, y: y - h + 4, size: 7.5, font: fonts.bold, color: pill.color || COLORS.slate700,
    });
    cx += w + 6;
  }
  return y - 14;
};

// 4-up KPI tile grid — same shape as intelligenceExport but uses the deal
// snapshot for inputs.
const drawKpiStrip = (page, fonts, { x, y, width, kpis }) => {
  if (!kpis?.length) return y;
  const cols = Math.min(kpis.length, 4);
  const gap = 8;
  const tileW = Math.floor((width - gap * (cols - 1)) / cols);
  const tileH = 60;
  let cx = x;
  for (let i = 0; i < kpis.length && i < cols; i += 1) {
    const k = kpis[i];
    page.drawRectangle({
      x: cx, y: y - tileH, width: tileW, height: tileH,
      color: COLORS.white,
      borderColor: COLORS.slate200, borderWidth: 0.5,
    });
    page.drawText(safeText(k.label).toUpperCase(), {
      x: cx + 10, y: y - 14, size: 6.5, font: fonts.bold, color: COLORS.slate500,
    });
    page.drawText(safeText(k.value), {
      x: cx + 10, y: y - 34, size: 14, font: fonts.bold, color: COLORS.slate900,
    });
    if (k.sub) {
      page.drawText(safeText(k.sub), {
        x: cx + 10, y: y - 50, size: 7, font: fonts.regular, color: COLORS.slate500,
      });
    }
    cx += tileW + gap;
  }
  return y - tileH;
};

// Two-column key/value card (used for property + economics on cover page).
const drawKvCard = (page, fonts, { x, y, width, height, title, rows }) => {
  page.drawRectangle({
    x, y: y - height, width, height,
    color: COLORS.white,
    borderColor: COLORS.slate200, borderWidth: 0.5,
  });
  page.drawText(safeText(title).toUpperCase(), {
    x: x + 12, y: y - 16, size: 7, font: fonts.bold, color: COLORS.accent,
  });
  let cy = y - 32;
  const labelW = 110;
  const lineH = 14;
  for (const row of rows) {
    if (!row) continue;
    if (cy - lineH < y - height + 10) break; // don't overflow card
    page.drawText(safeText(row.label), {
      x: x + 12, y: cy, size: 8, font: fonts.bold, color: COLORS.slate700,
    });
    const valueText = safeText(row.value);
    // Truncate value if it'd overflow the card.
    let display = valueText;
    const maxW = width - 12 - labelW - 12;
    if (fonts.regular.widthOfTextAtSize(display, 9) > maxW) {
      let lo = 0; let hi = display.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (fonts.regular.widthOfTextAtSize(display.slice(0, mid) + '…', 9) <= maxW) lo = mid;
        else hi = mid - 1;
      }
      display = display.slice(0, lo) + '…';
    }
    page.drawText(display, {
      x: x + 12 + labelW, y: cy, size: 9, font: fonts.regular, color: COLORS.slate900,
    });
    cy -= lineH;
  }
  return y - height;
};

// Readiness ribbon below the cards — DD %, approvals %, open risks count,
// IC recommendation.
const drawReadinessRibbon = (page, fonts, { x, y, width, ddPct, approvalsPct, openRisks, recommendation }) => {
  const h = 52;
  page.drawRectangle({
    x, y: y - h, width, height: h,
    color: COLORS.slate100,
    borderColor: COLORS.slate200, borderWidth: 0.5,
  });
  const cells = [
    { label: 'DD COMPLETION',   value: `${fmtNum(ddPct, 0)}%`, tone: ddPct >= 80 ? COLORS.green : ddPct >= 50 ? COLORS.amber : COLORS.red },
    { label: 'APPROVALS',       value: `${fmtNum(approvalsPct, 0)}%`, tone: approvalsPct >= 80 ? COLORS.green : approvalsPct >= 50 ? COLORS.amber : COLORS.red },
    { label: 'OPEN RISK FLAGS', value: `${openRisks}`, tone: openRisks === 0 ? COLORS.green : openRisks <= 3 ? COLORS.amber : COLORS.red },
    { label: 'IC RECOMMENDATION', value: recommendation || 'Pending', tone: COLORS.slate900 },
  ];
  const cellW = width / cells.length;
  cells.forEach((c, i) => {
    page.drawText(c.label, {
      x: x + cellW * i + 14, y: y - 18, size: 6.5, font: fonts.bold, color: COLORS.slate500,
    });
    page.drawText(safeText(c.value), {
      x: x + cellW * i + 14, y: y - 38, size: 14, font: fonts.bold, color: c.tone,
    });
    if (i > 0) {
      page.drawLine({
        start: { x: x + cellW * i, y: y - 8 },
        end:   { x: x + cellW * i, y: y - h + 8 },
        thickness: 0.5, color: COLORS.slate200,
      });
    }
  });
  return y - h;
};

// Word-wrap helper.
const wrapText = (text, font, size, maxWidth, maxLines = Infinity) => {
  const words = safeText(text).split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
};

// AI synthesis block — strips markdown noise from the latest IC memo /
// risk brief and renders the first ~10 wrapped lines under a clearly
// labeled "AI-assisted" eyebrow.
const drawSynthesisBlock = (page, fonts, { x, y, width, sourceLabel, body }) => {
  if (!body) return y;
  const stripped = body
    .replace(/^#{1,6}\s+/gm, '')   // markdown headings
    .replace(/^[*\-]\s+/gm, '• ')  // bullets
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/\*(.+?)\*/g, '$1')   // italic
    .replace(/`([^`]+)`/g, '$1')   // inline code
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const paragraphs = stripped.split(/\n\n/).slice(0, 3);
  let cy = y;
  const lineH = 12;
  const maxLines = 14; // generous — two paragraphs of body
  let used = 0;

  for (const para of paragraphs) {
    if (used >= maxLines) break;
    const lines = wrapText(para.replace(/\n/g, ' '), fonts.regular, 9, width, maxLines - used);
    for (const line of lines) {
      page.drawText(line, {
        x, y: cy, size: 9, font: fonts.regular, color: COLORS.slate900,
      });
      cy -= lineH;
      used += 1;
      if (used >= maxLines) break;
    }
    if (used < maxLines) cy -= 4;
  }
  // Source label
  if (sourceLabel) {
    page.drawText(safeText(sourceLabel), {
      x, y: cy - 4, size: 7, font: fonts.regular, color: COLORS.slate500,
    });
    cy -= 14;
  }
  return cy;
};

// Risk register table — severity / category / title (truncated).
const drawRiskTable = (page, fonts, { x, y, width, rows }) => {
  if (!rows?.length) {
    page.drawText('No open risk flags. Review or seed risks before IC.', {
      x, y: y - 4, size: 9, font: fonts.regular, color: COLORS.slate700,
    });
    return y - 18;
  }
  const cols = [
    { label: 'Severity', weight: 0.9, align: 'left',
      format: (v) => titleCase(v) },
    { label: 'Category', weight: 1.4, align: 'left',
      format: (v) => titleCase(v).replace(/^Approval Regulatory$/, 'Regulatory') },
    { label: 'Title',    weight: 4.2, align: 'left' },
    { label: 'Status',   weight: 1.0, align: 'left',
      format: (v) => titleCase(v) },
  ];
  return drawSimpleTable(page, fonts, {
    x, y, width,
    columns: cols,
    rows: rows.slice(0, 8).map((r) => ({
      severity: r.severity, category: r.category, title: r.title, status: r.status,
    })),
    severityColumn: 0,
  });
};

// Comps table — project / locality / rate / source.
const drawCompsTable = (page, fonts, { x, y, width, rows }) => {
  if (!rows?.length) {
    page.drawText('No comparable transactions on file for this locality.', {
      x, y: y - 4, size: 9, font: fonts.regular, color: COLORS.slate700,
    });
    return y - 18;
  }
  const cols = [
    { label: 'Project',  weight: 2.4, align: 'left' },
    { label: 'Locality', weight: 2.0, align: 'left' },
    { label: 'Rate INR/sqft', weight: 1.6, align: 'right',
      format: (v) => (v ? fmtNum(v, 0) : '-') },
    { label: 'Source',   weight: 1.4, align: 'left',
      format: (v) => titleCase(v) },
    { label: 'Verified', weight: 0.8, align: 'left',
      format: (v) => (v ? 'Yes' : 'No') },
  ];
  return drawSimpleTable(page, fonts, {
    x, y, width,
    columns: cols,
    rows: rows.slice(0, 6).map((r) => ({
      project: r.project_name || r.project || '-',
      locality: r.locality || r.micro_market || '-',
      rate: r.rate_per_sqft,
      source: r.source || r.source_type || 'manual',
      verified: r.is_verified,
    })),
  });
};

// Lighter table primitive than intelligenceExport's — single-page, no
// pagination since we know the row counts are bounded (8 risks, 6 comps).
const drawSimpleTable = (page, fonts, { x, y, width, columns, rows, severityColumn = -1 }) => {
  const weightSum = columns.reduce((s, c) => s + (c.weight || 1), 0);
  const sized = columns.map((c) => ({ ...c, width: Math.floor(width * (c.weight || 1) / weightSum) }));
  const headerHeight = 20;
  const rowHeight = 16;

  // Header row
  page.drawRectangle({ x, y: y - headerHeight, width, height: headerHeight, color: COLORS.slate100 });
  let cx = x + 6;
  for (const col of sized) {
    const label = safeText(col.label).toUpperCase();
    const labelW = fonts.bold.widthOfTextAtSize(label, 7.5);
    let textX = cx;
    if (col.align === 'right') textX = cx + col.width - labelW - 6;
    page.drawText(label, {
      x: textX, y: y - headerHeight + 7, size: 7.5, font: fonts.bold, color: COLORS.slate700,
    });
    cx += col.width;
  }

  let cy = y - headerHeight;
  rows.forEach((row, rowIdx) => {
    if (rowIdx % 2 === 1) {
      page.drawRectangle({ x, y: cy - rowHeight, width, height: rowHeight, color: COLORS.slate100 });
    }
    cx = x + 6;
    sized.forEach((col, colIdx) => {
      const key = String(col.label).toLowerCase().split(' ')[0]; // 'severity', 'category', 'title', 'status'
      const raw = row[key];
      const text = safeText(col.format ? col.format(raw, row) : raw);
      const cellSize = 8.5;
      const textW = fonts.regular.widthOfTextAtSize(text, cellSize);

      // Severity column — color the text by tone.
      let color = COLORS.slate900;
      let font = fonts.regular;
      if (severityColumn === colIdx) {
        const sev = String(raw || '').toLowerCase();
        if (sev === 'critical') color = COLORS.red;
        else if (sev === 'high') color = COLORS.amber;
        else if (sev === 'medium') color = COLORS.slate700;
        font = fonts.bold;
      }

      let display = text;
      const maxW = col.width - 12;
      if (col.align !== 'right' && textW > maxW) {
        let lo = 0; let hi = text.length;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (fonts.regular.widthOfTextAtSize(text.slice(0, mid) + '…', cellSize) <= maxW) lo = mid;
          else hi = mid - 1;
        }
        display = text.slice(0, lo) + '…';
      }
      let textX = cx;
      if (col.align === 'right') {
        const dispW = font.widthOfTextAtSize(display, cellSize);
        textX = cx + col.width - dispW - 6;
      }
      page.drawText(display, { x: textX, y: cy - rowHeight + 5, size: cellSize, font, color });
      cx += col.width;
    });
    cy -= rowHeight;
  });
  return cy;
};

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Pull the latest persisted ic_memo + risk_brief artifacts so the tear
 * sheet can echo the AI synthesis the analyst already validated. Best-
 * effort: a missing/empty artifact just means the synthesis section
 * shows a "regenerate to populate" hint.
 */
const fetchAiSynthesis = async (dealId) => {
  // ic_memo first (richer); fall back to risk_brief; both come back as
  // markdown strings. Both fail-open if the artifact table doesn't exist.
  const [icMemo, riskBrief] = await Promise.all([
    aiArtifacts.getLatestArtifact({ dealId, artifactType: 'ic_memo' }).catch(() => null),
    aiArtifacts.getLatestArtifact({ dealId, artifactType: 'risk_brief' }).catch(() => null),
  ]);
  if (icMemo?.content_md) {
    return { body: icMemo.content_md, sourceLabel: `Source: latest IC memo draft (generated ${(icMemo.generated_at || '').slice(0, 10)})` };
  }
  if (riskBrief?.content_md) {
    return { body: riskBrief.content_md, sourceLabel: `Source: latest risk brief (generated ${(riskBrief.generated_at || '').slice(0, 10)})` };
  }
  return { body: null, sourceLabel: null };
};

/**
 * Build the comprehensive tear-sheet PDF as a Buffer.
 */
async function buildDealTearSheet({ dealId, generatedBy = 'REDIP user' } = {}) {
  if (!dealId) throw Object.assign(new Error('dealId is required.'), { statusCode: 400 });

  const ctx = await getDealExportContext(dealId);
  if (!ctx) {
    throw Object.assign(new Error('Deal not found.'), { statusCode: 404 });
  }

  const { deal, dd, risks, market, approvals, readiness } = ctx;
  const synthesis = await fetchAiSynthesis(dealId).catch((err) => {
    log.warn('tear_sheet_synthesis_fetch_failed', { dealId, error: err.message });
    return { body: null, sourceLabel: null };
  });

  const { PDFDocument, StandardFonts } = pdfLib(); // lazy — first PDF build pays the load
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };

  const today = new Date().toISOString().slice(0, 10);
  const subtitle = [deal.city, deal.state].filter(Boolean).join(', ') || 'India';

  // ── Page 1 — Cover + Snapshot ──────────────────────────────────────────
  const page1 = pdfDoc.addPage(PAGE_LANDSCAPE);
  drawHeader(page1, fonts, {
    title: `Investor Tear-Sheet  -  ${deal.name || 'Unnamed Deal'}`,
    subtitle: `${subtitle} | generated ${today}`,
  });
  const { width: pw, height: ph } = page1.getSize();
  const contentW = pw - MARGIN_X * 2;
  let y = ph - HEADER_HEIGHT - 22;

  // Pills row — stage, priority, asset class, structure
  y = drawPills(page1, fonts, {
    x: MARGIN_X, y,
    items: [
      { label: titleCase(deal.stage), fill: COLORS.slate100, color: COLORS.slate900 },
      { label: `${titleCase(deal.priority)} Priority`,
        fill: deal.priority === 'high' ? rgb(0.99, 0.93, 0.85) : COLORS.slate100,
        color: deal.priority === 'high' ? COLORS.amber : COLORS.slate700 },
      { label: titleCase(deal.asset_class || 'Unspecified asset class'),
        fill: COLORS.slate100, color: COLORS.slate700 },
      { label: titleCase(deal.deal_structure || deal.deal_type || 'Outright'),
        fill: COLORS.slate100, color: COLORS.slate700 },
      deal.rera_number ? { label: `RERA ${deal.rera_number}`, fill: rgb(0.91, 0.95, 0.99), color: COLORS.accent } : null,
    ].filter(Boolean),
  });

  // KPI strip
  y -= 18;
  y = drawKpiStrip(page1, fonts, {
    x: MARGIN_X, y, width: contentW,
    kpis: [
      { label: 'IRR',           value: deal.irr_pct != null ? fmtPct(deal.irr_pct) : '-',
        sub: deal.discount_rate_pct != null ? `Hurdle: ${fmtPct(deal.discount_rate_pct)}` : null },
      { label: 'Equity Multiple', value: fmtX(deal.equity_multiple),
        sub: deal.npv_cr != null ? `NPV ${fmtCr(deal.npv_cr)}` : null },
      { label: 'Total Cost',    value: fmtCr(deal.total_cost_cr),
        sub: deal.land_cost_cr != null ? `Land ${fmtCr(deal.land_cost_cr)}` : null },
      { label: 'Total Revenue', value: fmtCr(deal.total_revenue_cr),
        sub: deal.gross_margin_pct != null ? `Gross margin ${fmtPct(deal.gross_margin_pct)}` : null },
    ],
  });

  // Two-column cards row (property | economics)
  y -= 18;
  const cardGap = 16;
  const cardW = (contentW - cardGap) / 2;
  const cardH = 168;

  // Property card
  drawKvCard(page1, fonts, {
    x: MARGIN_X, y, width: cardW, height: cardH,
    title: 'Property',
    rows: [
      { label: 'Name',     value: deal.property_name || deal.name },
      { label: 'Address',  value: deal.property_address },
      { label: 'City',     value: [deal.city, deal.state].filter(Boolean).join(', ') },
      { label: 'Land Area', value: fmtArea(deal.land_area_sqft || (deal.land_area_acres ? deal.land_area_acres * 43560 : null)) },
      { label: 'Zoning',   value: deal.zoning },
      { label: 'Permissible FSI', value: deal.permissible_fsi },
      { label: 'Owner',    value: deal.owner_name },
      { label: 'Survey No.', value: deal.survey_number },
      { label: 'Encumbrance', value: deal.encumbrance_status ? titleCase(deal.encumbrance_status) : 'Unknown' },
    ],
  });

  // Economics card
  drawKvCard(page1, fonts, {
    x: MARGIN_X + cardW + cardGap, y, width: cardW, height: cardH,
    title: 'Deal Economics',
    rows: [
      { label: 'Ask Price',       value: fmtCr(deal.land_ask_price_cr) },
      { label: 'Negotiated',      value: fmtCr(deal.negotiated_price_cr) },
      { label: 'Land Cost',       value: fmtCr(deal.land_cost_cr) },
      { label: 'Construction',    value: fmtCr(deal.construction_cost_cr) },
      { label: 'Total Cost',      value: fmtCr(deal.total_cost_cr) },
      { label: 'Total Revenue',   value: fmtCr(deal.total_revenue_cr) },
      { label: 'Gross Profit',    value: fmtCr(deal.gross_profit_cr) },
      { label: 'Residual Land Value', value: fmtCr(deal.residual_land_value_cr) },
      { label: 'Saleable Area',   value: fmtArea(deal.saleable_area_sqft) },
    ],
  });
  y -= cardH;

  // Readiness ribbon
  y -= 14;
  drawReadinessRibbon(page1, fonts, {
    x: MARGIN_X, y, width: contentW,
    ddPct: dd?.summary?.completion_pct || 0,
    approvalsPct: approvals?.summary?.required
      ? Math.round((approvals.summary.validated / approvals.summary.required) * 100)
      : 0,
    openRisks: (risks?.summary?.critical || 0) + (risks?.summary?.high || 0)
      + (risks?.summary?.medium || 0) + (risks?.summary?.low || 0),
    recommendation: titleCase(risks?.recommendation?.recommendation || readiness?.label || 'Pending'),
  });

  // ── Page 2 — Synthesis + Risks + Comps ─────────────────────────────────
  const page2 = pdfDoc.addPage(PAGE_LANDSCAPE);
  drawHeader(page2, fonts, {
    title: `${deal.name || 'Deal'}  -  Synthesis, Risks, Comps`,
    subtitle: `${subtitle} | generated ${today}`,
  });
  let y2 = ph - HEADER_HEIGHT - 22;

  // AI Synthesis block
  y2 = drawSectionHeader(page2, fonts, {
    x: MARGIN_X, y: y2,
    eyebrow: 'AI-assisted, requires human review',
    title: 'AI Synthesis',
    sub: synthesis.body
      ? 'Excerpted from the latest persisted draft. Open the deal in REDIP for the full memo.'
      : 'No persisted IC memo or risk brief on file. Generate one from the deal Risk / Overview tabs to populate this section.',
  });

  if (synthesis.body) {
    y2 = drawSynthesisBlock(page2, fonts, {
      x: MARGIN_X, y: y2 - 4, width: contentW,
      sourceLabel: synthesis.sourceLabel,
      body: synthesis.body,
    });
  } else {
    y2 -= 18;
  }

  // Risk register
  y2 -= 14;
  y2 = drawSectionHeader(page2, fonts, {
    x: MARGIN_X, y: y2,
    eyebrow: `${(risks?.items || []).length} open flag${(risks?.items || []).length === 1 ? '' : 's'}`,
    title: 'Risk Register',
    sub: 'Open risks sorted by severity. Critical / high block IC.',
  });
  y2 = drawRiskTable(page2, fonts, {
    x: MARGIN_X, y: y2 - 4, width: contentW,
    rows: risks?.items || [],
  });

  // Comps
  y2 -= 14;
  y2 = drawSectionHeader(page2, fonts, {
    x: MARGIN_X, y: y2,
    eyebrow: market?.exportComps?.length ? `${market.exportComps.length} comps on file` : 'No comps on file',
    title: 'Top Comparable Transactions',
    sub: market?.benchmarks?.median_rate_per_sqft != null
      ? `Median INR ${fmtNum(market.benchmarks.median_rate_per_sqft, 0)}/sqft across ${market.benchmarks.count} verified comps in this submarket.`
      : 'Verified comps required before underwriting commits to a benchmark rate.',
  });
  y2 = drawCompsTable(page2, fonts, {
    x: MARGIN_X, y: y2 - 4, width: contentW,
    rows: market?.exportComps || [],
  });

  // Footers
  drawFooter(page1, fonts, { generatedBy, pageNum: 1, pageTotal: 2 });
  drawFooter(page2, fonts, { generatedBy, pageNum: 2, pageTotal: 2 });

  const bytes = await pdfDoc.save();
  return {
    bytes: Buffer.from(bytes),
    fileName: `redip-${(deal.name || 'deal').replace(/[^a-z0-9_-]/gi, '_').toLowerCase().slice(0, 60)}-tear-sheet-${today}.pdf`,
    dealName: deal.name || 'Deal',
  };
}

module.exports = {
  buildDealTearSheet,
  // Internal helpers exported for tests.
  _internal: {
    safeText,
    fmtCr,
    fmtPct,
    fmtX,
    fmtArea,
    titleCase,
  },
};
