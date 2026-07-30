'use strict';

/**
 * Market Intelligence tear-sheet PDF builder.
 *
 * Single-shot, multi-page PDF that snapshots the current Q1 2026 (or
 * whatever's seeded) Market Intelligence dashboard for a given city.
 *
 * Why pdf-lib (vs. puppeteer / headless Chrome): the deal PDF export
 * already lives on pdf-lib + StandardFonts. Reusing the same toolkit
 * keeps the bundle slim, avoids serverless cold-start penalties from
 * spinning up Chrome on Vercel, and matches the editorial chrome the
 * deal export uses so the two outputs feel like one product.
 *
 * Why landscape A4 (vs. portrait): the residential and office benchmark
 * tables have 6-8 numeric columns. Portrait would either truncate
 * columns or shrink type below the 8pt readability floor. Landscape
 * keeps the editorial typography bar.
 *
 * What's intentionally NOT in this PDF:
 *   - Charts. Rendering charts inside pdf-lib requires building paths
 *     manually (no SVG-import). Editorial tables convey the same info
 *     without the visual liability. Charts are a follow-up.
 *   - The daily Claude brief. Brief is regenerated on every visit; the
 *     tear-sheet is a "data-only" snapshot. Including the brief would
 *     bake AI-synthesized text into a printable artifact, which is the
 *     opposite of what investors want from a tear-sheet (they want the
 *     primary numbers, not a paragraph).
 *   - Admin notes (slowdown / strategic). Same reason as the brief —
 *     the tear-sheet is a verified-data snapshot, not editorial.
 */

// pdf-lib (~365ms to load) is accessed through the lazy shim so this module —
// boot-reachable via the intelligence routes — never forces the library onto
// the serverless cold-start path. See lib/lazyPdfLib.js.
const { pdfLib, rgb, lazyByFactory, A4_LANDSCAPE } = require('../lib/lazyPdfLib');
const intelligenceService = require('./intelligence.service');

// ── Constants ──────────────────────────────────────────────────────────────

// Landscape A4 — same physical paper as the deal PDF, oriented for tables.
const PAGE_LANDSCAPE = A4_LANDSCAPE; // [width, height] in PDF points
const MARGIN_X = 40;
const MARGIN_TOP = 80;   // Below the navy header bar
const MARGIN_BOTTOM = 36; // Above the footer
const HEADER_HEIGHT = 56;

// Lazy (Proxy) palette — module-scope colors without forcing pdf-lib onto the
// cold-start path; call sites unchanged.
const COLORS = lazyByFactory(({ rgb: liveRgb }) => ({
  navy:     liveRgb(0.06, 0.13, 0.27),
  accent:   liveRgb(0.15, 0.39, 0.92),
  slate900: liveRgb(0.12, 0.16, 0.22),
  slate700: liveRgb(0.27, 0.33, 0.4),
  slate500: liveRgb(0.45, 0.5, 0.58),
  slate200: liveRgb(0.89, 0.91, 0.94),
  slate100: liveRgb(0.96, 0.97, 0.98),
  white:    liveRgb(1, 1, 1),
  green:    liveRgb(0.09, 0.64, 0.37),
  amber:    liveRgb(0.85, 0.52, 0.07),
  red:      liveRgb(0.86, 0.19, 0.19),
}));

// ── Pure formatters ────────────────────────────────────────────────────────
// `safeText` strips non-printable characters that pdf-lib can't render with
// the standard Helvetica fonts (₹ glyph, em-dashes, etc.) so we never
// generate a corrupted PDF on a curly quote.
const safeText = (value) =>
  String(value ?? '—')
    .replace(/₹/g, 'INR ')
    .replace(/—/g, '-')
    .replace(/–/g, '-')
    .replace(/[^\x20-\x7E\n]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim() || '-';

const fmtNum = (value, decimals = 0) => {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
};
const fmtRate = (v) => (v == null ? '-' : `INR ${fmtNum(v, 0)}/sqft`);
const fmtPct  = (v) => (v == null ? '-' : `${fmtNum(v, 1)}%`);
const fmtINR  = (v) => (v == null ? '-' : `INR ${fmtNum(v, 0)}`);
const fmtCr   = (v) => (v == null ? '-' : `INR ${fmtNum(v, 0)} Cr`);

// Format a quantum (mn) as Cr — matches the IntelligencePage formatter so
// values in the PDF tie out to what the user sees on screen.
const fmtQuantum = (mn) => {
  if (mn == null) return '-';
  const cr = Number(mn) / 10; // quantum_inr_mn is INR millions; 1 Cr = 10 mn
  return cr >= 1000 ? `INR ${(cr / 1000).toFixed(2)} TCr` : `INR ${cr.toFixed(0)} Cr`;
};

// ── Drawing helpers ────────────────────────────────────────────────────────

// Draw the navy top bar with Acureal branding and a city/date subtitle. Mirrors
// the deal PDF chrome so both exports read as one product family.
const drawHeader = (page, fonts, { title, subtitle }) => {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: height - HEADER_HEIGHT, width, height: HEADER_HEIGHT, color: COLORS.navy });
  page.drawText('Acureal', {
    x: MARGIN_X, y: height - 32, size: 18, font: fonts.bold, color: COLORS.white,
  });
  page.drawText(safeText(title), {
    x: MARGIN_X + 92, y: height - 28, size: 13, font: fonts.bold, color: COLORS.white,
  });
  page.drawText(safeText(subtitle), {
    x: MARGIN_X + 92, y: height - 44, size: 8, font: fonts.regular, color: rgb(0.76, 0.84, 0.95),
  });
};

const drawFooter = (page, fonts, { generatedBy, pageNum, pageTotal }) => {
  const { width } = page.getSize();
  page.drawText(`Acureal Market Intelligence Tear-Sheet  -  generated by ${safeText(generatedBy)} on ${new Date().toISOString().slice(0, 10)}`, {
    x: MARGIN_X, y: 16, size: 7, font: fonts.regular, color: COLORS.slate500,
  });
  page.drawText(`Page ${pageNum} of ${pageTotal}`, {
    x: width - MARGIN_X - 60, y: 16, size: 7, font: fonts.regular, color: COLORS.slate500,
  });
};

// Section header: small uppercase eyebrow above a tight display title.
// Returns the y-coord below the header where the next content should start.
const drawSectionHeader = (page, fonts, { x, y, eyebrow, title, sub }) => {
  if (eyebrow) {
    page.drawText(safeText(eyebrow).toUpperCase(), {
      x, y, size: 7, font: fonts.bold, color: COLORS.slate500,
    });
  }
  page.drawText(safeText(title), {
    x, y: y - 16, size: 14, font: fonts.bold, color: COLORS.slate900,
  });
  if (sub) {
    page.drawText(safeText(sub), {
      x, y: y - 30, size: 9, font: fonts.regular, color: COLORS.slate700,
    });
    return y - 46;
  }
  return y - 32;
};

// Source citation line — italic-lookalike (smaller + lighter) so it doesn't
// compete with the data above. pdf-lib StandardFonts has no italic Helvetica
// without embedding a custom font, so we lean on weight + color to signal
// secondary content.
const drawSourceLine = (page, fonts, { x, y, width, text }) => {
  const lines = wrapText(text, fonts.regular, 7.5, width);
  lines.forEach((line, i) => {
    page.drawText(safeText(line), {
      x, y: y - i * 10, size: 7.5, font: fonts.regular, color: COLORS.slate500,
    });
  });
  return y - lines.length * 10;
};

// Word-wrap that respects max line count. Same logic as the deal-PDF's
// drawWrappedText helper — kept local so this service has zero coupling
// to export.routes.js internals.
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

// ── Table primitive ───────────────────────────────────────────────────────
//
// Editorial table renderer. Auto-paginates: when a row would render below
// `MARGIN_BOTTOM`, the function breaks the table, returns the last y-coord
// + a pageBreak signal, and the caller starts a new page before continuing.
//
// Each column is `{ label, key, width, align, format? }`.
//   - `width` is in points; columns auto-distribute across the available
//     row width.
//   - `align` is 'left' | 'right' | 'center'.
//   - `format(value, row)` optionally transforms the cell value before
//     rendering.
//
// Returns `{ y, finished }`. `finished=false` signals the caller to start a
// new page and call again with `rows.slice(rowsRendered)`.
const drawTable = (page, fonts, { x, y, width, columns, rows, options = {} }) => {
  const headerHeight = options.headerHeight || 22;
  const rowHeight    = options.rowHeight    || 18;
  const headerSize   = 8;
  const cellSize     = 8.5;

  // Header row — slate100 fill, uppercase bold labels.
  page.drawRectangle({ x, y: y - headerHeight, width, height: headerHeight, color: COLORS.slate100 });
  let cx = x + 6;
  for (const col of columns) {
    const labelW = fonts.bold.widthOfTextAtSize(col.label.toUpperCase(), headerSize);
    let textX = cx;
    if (col.align === 'right')  textX = cx + col.width - labelW - 6;
    if (col.align === 'center') textX = cx + (col.width - labelW) / 2;
    page.drawText(safeText(col.label).toUpperCase(), {
      x: textX, y: y - headerHeight + 8, size: headerSize, font: fonts.bold, color: COLORS.slate700,
    });
    cx += col.width;
  }

  // Data rows — alternating tints make multi-column tables scannable.
  let cy = y - headerHeight;
  let rendered = 0;
  for (const row of rows) {
    if (cy - rowHeight < MARGIN_BOTTOM) {
      // No more vertical room — bail and let the caller paginate.
      return { y: cy, rowsRendered: rendered, finished: false };
    }
    if (rendered % 2 === 1) {
      page.drawRectangle({ x, y: cy - rowHeight, width, height: rowHeight, color: COLORS.slate100 });
    }
    cx = x + 6;
    for (const col of columns) {
      const raw = col.format ? col.format(row[col.key], row) : row[col.key];
      const text = safeText(raw);
      const textW = fonts.regular.widthOfTextAtSize(text, cellSize);
      let textX = cx;
      if (col.align === 'right')  textX = cx + col.width - textW - 6;
      if (col.align === 'center') textX = cx + (col.width - textW) / 2;
      // Truncate left-aligned long text with an ellipsis if it would overflow.
      let display = text;
      if (col.align !== 'right' && col.align !== 'center' && textW > col.width - 12) {
        // Binary search the longest prefix that fits.
        let lo = 0, hi = text.length;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (fonts.regular.widthOfTextAtSize(text.slice(0, mid) + '…', cellSize) <= col.width - 12) lo = mid;
          else hi = mid - 1;
        }
        display = text.slice(0, lo) + '…';
      }
      page.drawText(display, {
        x: textX, y: cy - rowHeight + 6, size: cellSize, font: fonts.regular, color: COLORS.slate900,
      });
      cx += col.width;
    }
    cy -= rowHeight;
    rendered += 1;
  }
  return { y: cy, rowsRendered: rendered, finished: true };
};

// Distribute total table width across columns by their relative weight.
const sizeColumns = (columns, totalWidth) => {
  const weightSum = columns.reduce((s, c) => s + (c.weight || 1), 0);
  return columns.map((c) => ({ ...c, width: Math.floor(totalWidth * (c.weight || 1) / weightSum) }));
};

// ── Macro KPI grid — small tiles, 4-up across the page ────────────────────

const drawMacroGrid = (page, fonts, { x, y, width, kpis }) => {
  if (!kpis?.length) return y;
  const cols = 4;
  const gap = 8;
  const tileW = Math.floor((width - gap * (cols - 1)) / cols);
  const tileH = 56;
  let cx = x, cy = y;
  for (let i = 0; i < kpis.length; i += 1) {
    const k = kpis[i];
    page.drawRectangle({
      x: cx, y: cy - tileH, width: tileW, height: tileH,
      color: COLORS.white,
      borderColor: COLORS.slate200, borderWidth: 0.5,
    });
    page.drawText(safeText(k.metric_label || k.metric_key).toUpperCase(), {
      x: cx + 8, y: cy - 14, size: 6.5, font: fonts.bold, color: COLORS.slate500,
    });
    const valueText = k.value_text || (k.value_numeric != null ? `${fmtNum(k.value_numeric, 1)}${k.unit ? ' ' + k.unit : ''}` : '-');
    page.drawText(safeText(valueText), {
      x: cx + 8, y: cy - 32, size: 13, font: fonts.bold, color: COLORS.slate900,
    });
    if (k.yoy_change_pct != null) {
      const isUp = Number(k.yoy_change_pct) >= 0;
      const tone = isUp ? COLORS.green : COLORS.red;
      page.drawText(`${isUp ? '+' : ''}${fmtNum(k.yoy_change_pct, 1)}% YoY`, {
        x: cx + 8, y: cy - 47, size: 7, font: fonts.bold, color: tone,
      });
    }
    cx += tileW + gap;
    if ((i + 1) % cols === 0) {
      cx = x;
      cy -= tileH + gap;
    }
  }
  // Land on the row below the last tile so the caller continues there.
  const rowsUsed = Math.ceil(kpis.length / cols);
  return y - rowsUsed * (tileH + gap) + gap;
};

// ── Section-by-section payload → drawing pipeline ──────────────────────────

const buildDeck = async (pdfDoc, fonts, payload, opts) => {
  const { city, generatedBy } = opts;
  const today = new Date().toISOString().slice(0, 10);

  // First pass: lay everything out, paginating as we run out of room. We
  // count pages as we go and write footers in a second pass once we know
  // the total. (pdf-lib lets us mutate any page after it's added.)
  const sections = [];

  // Open a new page and return { page, contentTop, contentBottom }.
  const startPage = (title, subtitle) => {
    const page = pdfDoc.addPage(PAGE_LANDSCAPE);
    drawHeader(page, fonts, { title, subtitle });
    return {
      page,
      contentTop: page.getSize().height - HEADER_HEIGHT - 18,
      contentRight: page.getSize().width - MARGIN_X,
      contentWidth: page.getSize().width - MARGIN_X * 2,
    };
  };

  // ─── Page: cover + macro KPI grid ──────────────────────────────────────
  {
    const { page, contentTop, contentWidth } = startPage(
      'Market Intelligence Tear-Sheet',
      `${city} - generated ${today}`,
    );
    let y = contentTop;
    y = drawSectionHeader(page, fonts, {
      x: MARGIN_X, y, eyebrow: `${city} - Q1 2026`,
      title: 'Verified Macro Indicators',
      sub: `${(payload.macroKpis || []).length} metrics across office, residential, industrial, hospitality, capital markets`,
    });
    y = drawMacroGrid(page, fonts, { x: MARGIN_X, y, width: contentWidth, kpis: payload.macroKpis || [] });
    sections.push(page);
  }

  // ─── Helper: render a benchmark table with auto-pagination ──────────────
  const renderBenchmarkSection = ({ headerTitle, headerSub, headerEyebrow, columnsDef, rows, sourceText }) => {
    if (!rows?.length) return;
    let remaining = rows;
    let firstPage = true;
    while (remaining.length > 0) {
      const { page, contentTop, contentWidth } = startPage(
        firstPage ? headerTitle : `${headerTitle} (cont.)`,
        `${city} - ${today}`,
      );
      let y = contentTop;
      if (firstPage) {
        y = drawSectionHeader(page, fonts, {
          x: MARGIN_X, y, eyebrow: headerEyebrow, title: headerTitle, sub: headerSub,
        });
      } else {
        y -= 8;
      }
      const sized = sizeColumns(columnsDef, contentWidth);
      const result = drawTable(page, fonts, {
        x: MARGIN_X, y, width: contentWidth,
        columns: sized, rows: remaining,
      });
      remaining = remaining.slice(result.rowsRendered);
      // Source line at the bottom of the LAST page of this section.
      if (remaining.length === 0 && sourceText) {
        drawSourceLine(page, fonts, {
          x: MARGIN_X, y: result.y - 14, width: contentWidth, text: sourceText,
        });
      }
      sections.push(page);
      firstPage = false;
    }
  };

  // ─── Section 5 — Residential micro-market benchmarks ───────────────────
  renderBenchmarkSection({
    headerEyebrow: 'Section 5',
    headerTitle: 'Residential Micro-Market Benchmarks',
    headerSub: `${city} Q1 2026 - listing prices and IPC ceiling rates by micro-market`,
    columnsDef: [
      { key: 'micro_market',        label: 'Micro-Market', weight: 2.4, align: 'left' },
      { key: 'avg_price_min_per_sqft', label: 'Min INR/sqft', weight: 1.2, align: 'right', format: (v) => fmtNum(v, 0) },
      { key: 'avg_price_max_per_sqft', label: 'Max INR/sqft', weight: 1.2, align: 'right', format: (v) => fmtNum(v, 0) },
      { key: 'yoy_growth_min_pct',  label: 'YoY Min', weight: 1, align: 'right', format: fmtPct },
      { key: 'yoy_growth_max_pct',  label: 'YoY Max', weight: 1, align: 'right', format: fmtPct },
      { key: 'data_type',           label: 'Source Type', weight: 1.4, align: 'left',
        format: (v) => (v === 'ipc_q1_2026' ? 'IPC' : v === 'listing_q1_2026' ? 'Listing' : 'Internal') },
      { key: 'as_of_date',          label: 'As Of', weight: 1.2, align: 'left',
        format: (v) => (v ? String(v).slice(0, 10) : '-') },
    ],
    rows: payload.residentialBenchmarks || [],
    sourceText: 'Sources: 99acres locality data; Cushman & Wakefield Bengaluru MarketBeat Q1 2026.',
  });

  // ─── Section 5a — Office ────────────────────────────────────────────────
  renderBenchmarkSection({
    headerEyebrow: 'Section 5a',
    headerTitle: 'Commercial Office - Vacancy + Rent',
    headerSub: `${city} Q1 2026 - IPC zones and Grade-A submarket benchmarks`,
    columnsDef: [
      { key: 'submarket',   label: 'Submarket', weight: 2.4, align: 'left' },
      { key: 'cluster',     label: 'Cluster',   weight: 1.6, align: 'left' },
      { key: 'level_type',  label: 'Level',     weight: 1, align: 'left',
        format: (v) => (v === 'ipc_zone' ? 'IPC' : 'Submarket') },
      { key: 'vacancy_pct', label: 'Vacancy', weight: 1, align: 'right', format: fmtPct },
      { key: 'stock_weighted_rent_psf_month', label: 'Rent INR/psf/mo', weight: 1.5, align: 'right', format: (v) => fmtNum(v, 0) },
      { key: 'grade_a_rent_low_psf_month',  label: 'Grade-A Low', weight: 1.2, align: 'right', format: (v) => fmtNum(v, 0) },
      { key: 'grade_a_rent_high_psf_month', label: 'Grade-A High', weight: 1.2, align: 'right', format: (v) => fmtNum(v, 0) },
      { key: 'yoy_change_pct', label: 'YoY', weight: 0.9, align: 'right', format: fmtPct },
    ],
    rows: payload.officeBenchmarks || [],
    sourceText: 'Sources: Cushman & Wakefield Bengaluru Office Q1 2026; JLL India Office Dynamics Q4 2025; Knight Frank APAC Prime Office Q1 2026.',
  });

  // ─── Section 5b — Retail ────────────────────────────────────────────────
  renderBenchmarkSection({
    headerEyebrow: 'Section 5b',
    headerTitle: 'Retail - High-Street + Mall Grade-A',
    headerSub: `${city} Q1 2026 - rent corridors by format`,
    columnsDef: [
      { key: 'corridor', label: 'Corridor', weight: 2.6, align: 'left' },
      { key: 'cluster',  label: 'Cluster',  weight: 1.4, align: 'left' },
      { key: 'format',   label: 'Format',   weight: 1.2, align: 'left',
        format: (v) => (v === 'high_street' ? 'High-Street' : v === 'mall_grade_a' ? 'Mall A' : v) },
      { key: 'rent_low_psf_month',  label: 'Rent Low INR/psf/mo',  weight: 1.5, align: 'right', format: (v) => fmtNum(v, 0) },
      { key: 'rent_high_psf_month', label: 'Rent High INR/psf/mo', weight: 1.5, align: 'right', format: (v) => fmtNum(v, 0) },
      { key: 'rent_avg_psf_month',  label: 'Avg', weight: 1, align: 'right', format: (v) => fmtNum(v, 0) },
      { key: 'yoy_change_pct',      label: 'YoY', weight: 1, align: 'right', format: fmtPct },
    ],
    rows: payload.retailBenchmarks || [],
    sourceText: 'Sources: Cushman & Wakefield Bengaluru Retail Q1 2026; JLL Retail India.',
  });

  // ─── Section 5c — Industrial / Warehouse / Serviced Land ────────────────
  renderBenchmarkSection({
    headerEyebrow: 'Section 5c',
    headerTitle: 'Industrial / Warehouse / Serviced Land',
    headerSub: `${city} H2 2025 - rent and land-value bands by segment`,
    columnsDef: [
      { key: 'submarket', label: 'Submarket', weight: 2.2, align: 'left' },
      { key: 'cluster',   label: 'Cluster',   weight: 1.4, align: 'left' },
      { key: 'segment',   label: 'Segment',   weight: 1.2, align: 'left',
        format: (v) => (v === 'industrial' ? 'Industrial' : v === 'warehouse' ? 'Warehouse' : v === 'serviced_land' ? 'Serviced Land' : v) },
      { key: 'rent_low_psf_month',  label: 'Rent Low INR/psf/mo',  weight: 1.5, align: 'right', format: (v) => fmtNum(v, 0) },
      { key: 'rent_high_psf_month', label: 'Rent High INR/psf/mo', weight: 1.5, align: 'right', format: (v) => fmtNum(v, 0) },
      { key: 'land_value_low_inr_mn_per_acre',  label: 'Land Low INR mn/ac',  weight: 1.6, align: 'right', format: (v) => fmtNum(v, 0) },
      { key: 'land_value_high_inr_mn_per_acre', label: 'Land High INR mn/ac', weight: 1.6, align: 'right', format: (v) => fmtNum(v, 0) },
    ],
    rows: payload.industrialBenchmarks || [],
    sourceText: 'Sources: CBRE I&L; Mordor Intelligence; JLL Industrial India.',
  });

  // ─── Section 5d — Hospitality ───────────────────────────────────────────
  renderBenchmarkSection({
    headerEyebrow: 'Section 5d',
    headerTitle: 'Hospitality - ADR / Occupancy / RevPAR',
    headerSub: `${city} 2025 - segment benchmarks (luxury / upper-upscale / midscale)`,
    columnsDef: [
      { key: 'submarket', label: 'Submarket', weight: 2, align: 'left' },
      { key: 'cluster',   label: 'Cluster',   weight: 1.4, align: 'left' },
      { key: 'segment',   label: 'Segment',   weight: 1.6, align: 'left',
        format: (v) => v ? v.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) : '-' },
      { key: 'adr_low_inr',  label: 'ADR Low INR',  weight: 1.5, align: 'right', format: (v) => fmtNum(v, 0) },
      { key: 'adr_high_inr', label: 'ADR High INR', weight: 1.5, align: 'right', format: (v) => fmtNum(v, 0) },
      { key: 'occupancy_pct', label: 'Occ %', weight: 1, align: 'right', format: fmtPct },
      { key: 'revpar_inr',   label: 'RevPAR INR', weight: 1.4, align: 'right', format: (v) => fmtNum(v, 0) },
    ],
    rows: payload.hospitalityBenchmarks || [],
    sourceText: 'Sources: Horwath HTL India Hotel Market Review 2025; ICRA FY25-26 hospitality outlook.',
  });

  // ─── Section 5e — Residential by Asset Class (segmented benchmarks) ─────
  // Builder floor / Plotted dev / Land plotted / Villa / Guidance value.
  // These rows ride the same shape as the rest (micro-market × value × source)
  // so they slot into the same renderBenchmarkSection pattern. Unit varies per
  // asset_class (INR/sqft vs INR mn/acre vs PDF placeholder), so the value
  // column carries explicit units in the formatter rather than a header label.
  const ASSET_CLASS_PDF_LABEL = {
    builder_floor:            'Builder floor',
    plotted_development:      'Plotted dev',
    land_residential_plotted: 'Land (plotted)',
    villa_house:              'Villa / house',
    guidance_value:           'Guidance value',
  };
  renderBenchmarkSection({
    headerEyebrow: 'Section 5e',
    headerTitle: 'Residential by Asset Class - Builder / Plotted / Land / Villa / Guidance',
    headerSub: `${city} Q1 2026 - listing-portal benchmarks + SRO guidance placeholders`,
    columnsDef: [
      { key: 'asset_class',  label: 'Asset class', weight: 1.4, align: 'left',
        format: (v) => ASSET_CLASS_PDF_LABEL[v] || v },
      { key: 'micro_market', label: 'Micro-market', weight: 1.8, align: 'left' },
      { key: 'metric',       label: 'Metric',       weight: 2.4, align: 'left' },
      { key: 'value_avg',    label: 'Value',        weight: 1.6, align: 'right',
        format: (v, row) => {
          if (row?.asset_class === 'guidance_value') return 'SRO PDF pending';
          if (v == null) return '-';
          const isAcre = row?.unit?.toLowerCase().includes('acre');
          return isAcre
            ? `INR ${fmtNum(v, 1)} mn/ac`
            : `INR ${fmtNum(v, 0)}/sqft`;
        }
      },
      { key: 'data_type',    label: 'Layer',        weight: 1.6, align: 'left',
        format: (v) => {
          if (v === 'listing_q1_2026_v0_2')          return 'Listing Q1 2026';
          if (v === 'listing_q1_2026_v0_2_derived')  return 'Listing - Derived';
          if (v === 'guidance_q1_2026_v0_2_pending') return 'Guidance - SRO pending';
          return v || '-';
        }
      },
    ],
    rows: payload.residentialSegmentedBenchmarks || [],
    sourceText: 'Sources: MagicBricks / Housing.com asking-price benchmarks (NOT transaction-verified); Karnataka IGR for guidance-value SRO placeholders. Land values derived from plot INR/sqyd via standard sqyd-to-acre conversion.',
  });

  // ─── Section 6 — Market Transactions ────────────────────────────────────
  renderBenchmarkSection({
    headerEyebrow: 'Section 6',
    headerTitle: 'Market Transaction Flow',
    headerSub: `${city} (FY2025-FY2027) - land deals, equity investments, debt`,
    columnsDef: [
      { key: 'fiscal_year', label: 'FY',      weight: 0.6, align: 'left' },
      { key: 'quarter',     label: 'Qtr',     weight: 0.5, align: 'left' },
      { key: 'deal_type',   label: 'Type',    weight: 1.2, align: 'left' },
      { key: 'buyer',       label: 'Buyer',   weight: 2.2, align: 'left' },
      { key: 'seller',      label: 'Seller',  weight: 2.0, align: 'left' },
      { key: 'locality',    label: 'Locality', weight: 1.6, align: 'left' },
      { key: 'quantum_inr_mn', label: 'Quantum', weight: 1.2, align: 'right', format: fmtQuantum },
      { key: 'land_size_acres', label: 'Acres', weight: 0.8, align: 'right', format: (v) => fmtNum(v, 1) },
    ],
    rows: payload.transactions || [],
    sourceText: 'Sources: company press releases; SEBI/exchange filings; broker IPC trackers.',
  });

  // ── Footer pass — now that all pages exist, stamp page numbers ──────────
  const pageTotal = sections.length;
  sections.forEach((page, i) => {
    drawFooter(page, fonts, { generatedBy, pageNum: i + 1, pageTotal });
  });
};

// ── Public entry point ─────────────────────────────────────────────────────

const buildIntelligenceTearSheet = async ({ city = 'Bengaluru', generatedBy = 'Unknown user' } = {}) => {
  // Pull all sections in parallel — every benchmark hook is a small Postgres
  // read, no need to serialise.
  const [
    macroKpis, residentialBenchmarks, officeBenchmarks, retailBenchmarks,
    industrialBenchmarks, hospitalityBenchmarks, residentialSegmentedBenchmarks, transactions,
  ] = await Promise.all([
    intelligenceService.getMacroKpis({ city }),
    intelligenceService.getMicroMarketBenchmarks({ city }),
    intelligenceService.getOfficeBenchmarks({ city }),
    intelligenceService.getRetailBenchmarks({ city }),
    intelligenceService.getIndustrialBenchmarks({ city }),
    intelligenceService.getHospitalityBenchmarks({ city }),
    intelligenceService.getResidentialSegmentedBenchmarks({ city }),
    intelligenceService.getMarketTransactions({ city }),
  ]);

  const { PDFDocument, StandardFonts } = pdfLib(); // lazy — first PDF build pays the load
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold:    await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };
  pdfDoc.setTitle(`Acureal Market Intelligence Tear-Sheet - ${city}`);
  pdfDoc.setAuthor('Acureal');
  pdfDoc.setSubject(`${city} verified market benchmarks - generated ${new Date().toISOString()}`);
  pdfDoc.setProducer('Acureal intelligenceExport.service');

  await buildDeck(pdfDoc, fonts, {
    macroKpis, residentialBenchmarks, officeBenchmarks, retailBenchmarks,
    industrialBenchmarks, hospitalityBenchmarks, residentialSegmentedBenchmarks, transactions,
  }, { city, generatedBy });

  return {
    bytes: await pdfDoc.save(),
    filename: `acureal-${city.toLowerCase()}-market-tearsheet-${new Date().toISOString().slice(0, 10)}.pdf`,
    sectionCounts: {
      macro_kpis:               macroKpis.length,
      residential:              residentialBenchmarks.length,
      office:                   officeBenchmarks.length,
      retail:                   retailBenchmarks.length,
      industrial:               industrialBenchmarks.length,
      hospitality:              hospitalityBenchmarks.length,
      residential_segmented:    residentialSegmentedBenchmarks.length,
      transactions:             transactions.length,
    },
  };
};

module.exports = {
  buildIntelligenceTearSheet,
};
