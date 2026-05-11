'use strict';

/**
 * Pure-JS SVG chart renderer for export deliverables (DOCX primarily).
 *
 * Why SVG, not PNG: SVG embeds natively in DOCX (via `ImageRun({ type: 'svg' })`
 * with a minimal PNG fallback) and PPTX (via `addImage({ data: 'data:image/svg+xml;base64,...' })`),
 * without pulling in `canvas` / `chartjs-node-canvas` / `sharp` / `resvg-js`
 * native dependencies. The trade-off: no live recalc — the SVG snapshot is
 * baked into the file. The deterministic kernel's numbers drove every pixel.
 *
 * Three chart types covered here:
 *   - Capital stack donut         debt vs equity proportion
 *   - Quarterly cash flow trend   period bars + cumulative line
 *   - Sensitivity tornado          driver-impact bars centred on base IRR
 *
 * Each returns an SVG string with viewBox dimensions; callers embed via
 * Buffer.from(svg, 'utf8').
 *
 * Hard rules (CLAUDE.md):
 *   - English only — palette literals + Arabic numerals only; no localisation
 *   - Tabular numbers — every numeric `<text>` carries
 *     `font-variant-numeric: tabular-nums` so columns line up
 *   - Palette tokens — every colour comes through palette.shared/palette
 */

const palette = require('./palette');

const { RAW } = palette;

const FONT_STACK = 'Calibri, Arial, sans-serif';

const escapeXml = (str) => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const num = (value) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatNumberIN = (value, decimals = 0) => {
  const parsed = num(value);
  if (parsed === null) return '–';
  return parsed.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

// ─── Capital Stack donut ─────────────────────────────────────────────────
// Debt + Equity proportional arc segments with a hollow centre showing
// total. Two slices, labelled on the chart edge with INR Cr values.
const renderCapitalStackDonutSvg = ({ debtCr, equityCr, width = 480, height = 280 } = {}) => {
  const debt = num(debtCr);
  const equity = num(equityCr);
  if ((debt == null || debt <= 0) && (equity == null || equity <= 0)) {
    // Empty state — typographic note instead of a misleading 100% slice.
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Capital stack data not available.">`,
        `<rect width="${width}" height="${height}" fill="#${RAW.paper}" />`,
        `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" `,
          `font-family="${FONT_STACK}" font-style="italic" font-size="14" fill="#${RAW.mutedHigh}">`,
          `Debt / equity split will populate once the kernel records capital stack values.`,
        `</text>`,
      `</svg>`,
    ].join('');
  }

  const safeDebt = Math.max(0, debt || 0);
  const safeEquity = Math.max(0, equity || 0);
  const total = safeDebt + safeEquity;
  const debtFrac = total > 0 ? safeDebt / total : 0;
  const debtPct = debtFrac * 100;
  const equityPct = 100 - debtPct;

  // Donut geometry — anchored to the left two-thirds; right third hosts
  // legend + total. Drawn as two arcs starting from 12 o'clock (top).
  const cx = width * 0.32;
  const cy = height / 2;
  const rOuter = Math.min(width * 0.30, height * 0.42);
  const rInner = rOuter * 0.62;

  const polar = (angleDeg, r) => {
    const rad = (angleDeg - 90) * (Math.PI / 180);
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };

  const debtEndAngle = debtFrac * 360;
  const equityEndAngle = 360;

  const arcPath = (startA, endA) => {
    const [ox0, oy0] = polar(startA, rOuter);
    const [ox1, oy1] = polar(endA, rOuter);
    const [ix0, iy0] = polar(endA, rInner);
    const [ix1, iy1] = polar(startA, rInner);
    const largeArc = (endA - startA) > 180 ? 1 : 0;
    return [
      `M ${ox0.toFixed(2)} ${oy0.toFixed(2)}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${ox1.toFixed(2)} ${oy1.toFixed(2)}`,
      `L ${ix0.toFixed(2)} ${iy0.toFixed(2)}`,
      `A ${rInner} ${rInner} 0 ${largeArc} 0 ${ix1.toFixed(2)} ${iy1.toFixed(2)}`,
      'Z',
    ].join(' ');
  };

  const debtColour = `#${RAW.inkDeep}`;
  const equityColour = `#${RAW.accent}`;
  const inkColour = `#${RAW.inkDeep}`;
  const muted = `#${RAW.mutedHigh}`;
  const paper = `#${RAW.paper}`;

  const legendX = cx + rOuter + 38;
  const legendY1 = cy - 38;
  const legendY2 = cy + 6;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Capital stack: debt ${debtPct.toFixed(0)}%, equity ${equityPct.toFixed(0)}%.">`,
      `<rect width="${width}" height="${height}" fill="${paper}" />`,
      debtFrac > 0
        ? `<path d="${arcPath(0, debtEndAngle)}" fill="${debtColour}" stroke="${paper}" stroke-width="2" />`
        : '',
      debtFrac < 1
        ? `<path d="${arcPath(debtEndAngle, equityEndAngle)}" fill="${equityColour}" stroke="${paper}" stroke-width="2" />`
        : '',
      // Centre — total
      `<text x="${cx.toFixed(2)}" y="${(cy - 4).toFixed(2)}" text-anchor="middle" `,
        `font-family="${FONT_STACK}" font-weight="700" font-size="22" fill="${inkColour}" `,
        `style="font-variant-numeric: tabular-nums;">INR ${formatNumberIN(total, 0)}</text>`,
      `<text x="${cx.toFixed(2)}" y="${(cy + 14).toFixed(2)}" text-anchor="middle" `,
        `font-family="${FONT_STACK}" font-size="10" fill="${muted}">Cr · total stack</text>`,

      // Legend — Debt
      `<rect x="${legendX}" y="${legendY1 - 10}" width="14" height="14" fill="${debtColour}" />`,
      `<text x="${legendX + 22}" y="${legendY1}" font-family="${FONT_STACK}" font-weight="700" font-size="13" fill="${inkColour}" `,
        `style="font-variant-numeric: tabular-nums;">Debt  ${debtPct.toFixed(0)}%</text>`,
      `<text x="${legendX + 22}" y="${legendY1 + 16}" font-family="${FONT_STACK}" font-size="11" fill="${muted}" `,
        `style="font-variant-numeric: tabular-nums;">INR ${formatNumberIN(safeDebt, 0)} Cr</text>`,

      // Legend — Equity
      `<rect x="${legendX}" y="${legendY2 - 10}" width="14" height="14" fill="${equityColour}" />`,
      `<text x="${legendX + 22}" y="${legendY2}" font-family="${FONT_STACK}" font-weight="700" font-size="13" fill="${inkColour}" `,
        `style="font-variant-numeric: tabular-nums;">Equity  ${equityPct.toFixed(0)}%</text>`,
      `<text x="${legendX + 22}" y="${legendY2 + 16}" font-family="${FONT_STACK}" font-size="11" fill="${muted}" `,
        `style="font-variant-numeric: tabular-nums;">INR ${formatNumberIN(safeEquity, 0)} Cr</text>`,
    `</svg>`,
  ].join('');
};

// ─── Quarterly cash flow trend ────────────────────────────────────────────
// Columns for period net + a cumulative line on a secondary scale.
// Negative columns render in dataNegative; positive in inkDeep. Line
// crossing zero is the deal's turn-positive moment — the cumulative axis
// is the analyst's primary read.
const renderCashFlowTrendSvg = ({ rows, width = 720, height = 320, title = 'Quarterly Cash Flow & Cumulative' } = {}) => {
  const cleanRows = Array.isArray(rows)
    ? rows.map((r) => ({
        label: String(r.label || ''),
        net: num(r.net) ?? 0,
        cumulative: num(r.cumulative) ?? 0,
      }))
    : [];

  if (cleanRows.length < 2) {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cash flow data not available.">`,
        `<rect width="${width}" height="${height}" fill="#${RAW.paper}" />`,
        `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" `,
          `font-family="${FONT_STACK}" font-style="italic" font-size="14" fill="#${RAW.mutedHigh}">`,
          `Cash flow trend will populate once quarterly projections are recorded.`,
        `</text>`,
      `</svg>`,
    ].join('');
  }

  // Plot area
  const margin = { top: 44, right: 60, bottom: 50, left: 60 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  // Scales — net columns share the LEFT axis; cumulative the RIGHT.
  const netMin = Math.min(0, ...cleanRows.map((r) => r.net));
  const netMax = Math.max(0, ...cleanRows.map((r) => r.net));
  const cumMin = Math.min(0, ...cleanRows.map((r) => r.cumulative));
  const cumMax = Math.max(0, ...cleanRows.map((r) => r.cumulative));
  const netRange = (netMax - netMin) || 1;
  const cumRange = (cumMax - cumMin) || 1;
  const colW = plotW / cleanRows.length;
  const barW = Math.max(4, colW * 0.55);

  const yNet = (v) => margin.top + plotH - ((v - netMin) / netRange) * plotH;
  const yCum = (v) => margin.top + plotH - ((v - cumMin) / cumRange) * plotH;
  const yZeroNet = yNet(0);

  const inkDeep = `#${RAW.inkDeep}`;
  const accent = `#${RAW.accent}`;
  const positive = `#${RAW.dataPositive}`;
  const negative = `#${RAW.dataNegative}`;
  const muted = `#${RAW.mutedHigh}`;
  const hairline = `#${RAW.hairline}`;
  const paper = `#${RAW.paper}`;

  // Cumulative line path
  const pathPts = cleanRows.map((r, i) => {
    const x = margin.left + i * colW + colW / 2;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${yCum(r.cumulative).toFixed(2)}`;
  }).join(' ');

  // Y-axis label ticks — 4 evenly-spaced ticks on each axis
  const yTicks = (min, max, side) => {
    const ticks = [];
    for (let i = 0; i <= 3; i += 1) {
      const v = min + (max - min) * (i / 3);
      const y = side === 'left' ? yNet(v) : yCum(v);
      ticks.push({ v, y });
    }
    return ticks;
  };

  const labelStride = Math.max(1, Math.ceil(cleanRows.length / 8));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">`,
      `<rect width="${width}" height="${height}" fill="${paper}" />`,
      // Title
      `<text x="${margin.left}" y="22" font-family="${FONT_STACK}" font-weight="700" font-size="13" fill="${inkDeep}">${escapeXml(title)}</text>`,

      // Zero baseline on the left axis
      `<line x1="${margin.left}" y1="${yZeroNet.toFixed(2)}" x2="${(margin.left + plotW).toFixed(2)}" y2="${yZeroNet.toFixed(2)}" stroke="${muted}" stroke-width="0.6" stroke-dasharray="4 3" />`,

      // Left-axis tick labels (net)
      yTicks(netMin, netMax, 'left').map((t) =>
        `<text x="${margin.left - 6}" y="${(t.y + 4).toFixed(2)}" text-anchor="end" font-family="${FONT_STACK}" font-size="9" fill="${muted}" style="font-variant-numeric: tabular-nums;">${formatNumberIN(t.v, 0)}</text>`
      ).join(''),
      // Right-axis tick labels (cumulative)
      yTicks(cumMin, cumMax, 'right').map((t) =>
        `<text x="${(margin.left + plotW + 6).toFixed(2)}" y="${(t.y + 4).toFixed(2)}" text-anchor="start" font-family="${FONT_STACK}" font-size="9" fill="${muted}" style="font-variant-numeric: tabular-nums;">${formatNumberIN(t.v, 0)}</text>`
      ).join(''),

      // Net columns
      cleanRows.map((r, i) => {
        const x = margin.left + i * colW + (colW - barW) / 2;
        const top = yNet(Math.max(r.net, 0));
        const bottom = yNet(Math.min(r.net, 0));
        const h = bottom - top;
        const colour = r.net >= 0 ? inkDeep : negative;
        return `<rect x="${x.toFixed(2)}" y="${top.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" fill="${colour}" />`;
      }).join(''),

      // Cumulative line
      `<path d="${pathPts}" fill="none" stroke="${positive}" stroke-width="2.5" />`,

      // Cumulative dots
      cleanRows.map((r, i) => {
        const x = margin.left + i * colW + colW / 2;
        const y = yCum(r.cumulative);
        return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.5" fill="${positive}" stroke="${paper}" stroke-width="1.5" />`;
      }).join(''),

      // X-axis labels (every Nth)
      cleanRows.map((r, i) => {
        if (i % labelStride !== 0) return '';
        const x = margin.left + i * colW + colW / 2;
        return `<text x="${x.toFixed(2)}" y="${(margin.top + plotH + 18).toFixed(2)}" text-anchor="middle" font-family="${FONT_STACK}" font-size="9" fill="${muted}">${escapeXml(r.label)}</text>`;
      }).join(''),

      // Axis legends
      `<text x="${margin.left - 6}" y="${(margin.top - 8).toFixed(2)}" text-anchor="end" font-family="${FONT_STACK}" font-size="9" fill="${inkDeep}">Period (INR Cr)</text>`,
      `<text x="${(margin.left + plotW + 6).toFixed(2)}" y="${(margin.top - 8).toFixed(2)}" text-anchor="start" font-family="${FONT_STACK}" font-size="9" fill="${positive}">Cumulative (INR Cr)</text>`,
    `</svg>`,
  ].join('');
};

// ─── Sensitivity tornado ──────────────────────────────────────────────────
// Drivers ranked by absolute IRR range. Low-case extends LEFT from base
// IRR (red), high-case extends RIGHT (green). Numeric IRR labels at tips.
const renderTornadoSvg = ({ drivers, baseIrr, width = 640, height = 280, title = 'Sensitivity — IRR Range by Driver' } = {}) => {
  const baseValue = num(baseIrr);
  const validDrivers = Array.isArray(drivers)
    ? drivers.filter((d) => num(d.low) != null && num(d.high) != null)
    : [];

  if (baseValue == null || validDrivers.length === 0) {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Sensitivity data not available.">`,
        `<rect width="${width}" height="${height}" fill="#${RAW.paper}" />`,
        `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" `,
          `font-family="${FONT_STACK}" font-style="italic" font-size="14" fill="#${RAW.mutedHigh}">`,
          `Sensitivity will populate once the kernel produces a driver matrix.`,
        `</text>`,
      `</svg>`,
    ].join('');
  }

  // Sort by total range descending
  const sorted = [...validDrivers].sort((a, b) =>
    Math.abs(b.high - b.low) - Math.abs(a.high - a.low)
  );

  // Symmetric scale around base
  const allDeltas = sorted.flatMap((d) => [d.low - baseValue, d.high - baseValue]);
  const maxAbs = Math.max(0.5, ...allDeltas.map(Math.abs));

  const margin = { top: 56, right: 70, bottom: 30, left: 200 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const halfW = plotW / 2;
  const centerX = margin.left + halfW;
  const rowH = plotH / Math.max(sorted.length, 1);
  const barH = Math.min(28, rowH * 0.5);

  const inkDeep = `#${RAW.inkDeep}`;
  const positive = `#${RAW.dataPositive}`;
  const negative = `#${RAW.dataNegative}`;
  const muted = `#${RAW.mutedHigh}`;
  const paper = `#${RAW.paper}`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">`,
      `<rect width="${width}" height="${height}" fill="${paper}" />`,
      `<text x="${margin.left - 6}" y="22" text-anchor="end" font-family="${FONT_STACK}" font-weight="700" font-size="13" fill="${inkDeep}">${escapeXml(title)}</text>`,
      `<text x="${margin.left - 6}" y="40" text-anchor="end" font-family="${FONT_STACK}" font-style="italic" font-size="10" fill="${muted}" style="font-variant-numeric: tabular-nums;">Base IRR ${formatNumberIN(baseValue, 1)}%</text>`,

      // Centre tick line
      `<line x1="${centerX}" y1="${margin.top}" x2="${centerX}" y2="${(margin.top + rowH * sorted.length + 4).toFixed(2)}" stroke="${muted}" stroke-width="1" stroke-dasharray="3 3" />`,
      `<text x="${centerX}" y="${(margin.top + rowH * sorted.length + 20).toFixed(2)}" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="10" fill="${muted}" style="font-variant-numeric: tabular-nums;">${formatNumberIN(baseValue, 1)}%</text>`,

      sorted.map((driver, idx) => {
        const rowY = margin.top + idx * rowH;
        const lowDelta = driver.low - baseValue;
        const highDelta = driver.high - baseValue;
        const lowW = (Math.abs(lowDelta) / maxAbs) * halfW;
        const highW = (Math.abs(highDelta) / maxAbs) * halfW;
        const barY = rowY + (rowH - barH) / 2;

        const labelParts = [
          `<text x="${margin.left - 12}" y="${(rowY + rowH / 2 - 4).toFixed(2)}" text-anchor="end" font-family="${FONT_STACK}" font-weight="700" font-size="11" fill="${inkDeep}">${escapeXml(driver.label || '')}</text>`,
          driver.subLabel
            ? `<text x="${margin.left - 12}" y="${(rowY + rowH / 2 + 10).toFixed(2)}" text-anchor="end" font-family="${FONT_STACK}" font-style="italic" font-size="9" fill="${muted}">${escapeXml(driver.subLabel)}</text>`
            : '',
        ];

        const bars = [];
        if (lowDelta < 0 && lowW > 1) {
          bars.push(`<rect x="${(centerX - lowW).toFixed(2)}" y="${barY.toFixed(2)}" width="${lowW.toFixed(2)}" height="${barH}" fill="${negative}" />`);
          bars.push(`<text x="${(centerX - lowW - 4).toFixed(2)}" y="${(barY + barH / 2 + 4).toFixed(2)}" text-anchor="end" font-family="${FONT_STACK}" font-weight="700" font-size="10" fill="${inkDeep}" style="font-variant-numeric: tabular-nums;">${formatNumberIN(driver.low, 1)}%</text>`);
        }
        if (highDelta > 0 && highW > 1) {
          bars.push(`<rect x="${centerX}" y="${barY.toFixed(2)}" width="${highW.toFixed(2)}" height="${barH}" fill="${positive}" />`);
          bars.push(`<text x="${(centerX + highW + 4).toFixed(2)}" y="${(barY + barH / 2 + 4).toFixed(2)}" text-anchor="start" font-family="${FONT_STACK}" font-weight="700" font-size="10" fill="${inkDeep}" style="font-variant-numeric: tabular-nums;">${formatNumberIN(driver.high, 1)}%</text>`);
        }

        return labelParts.join('') + bars.join('');
      }).join(''),
    `</svg>`,
  ].join('');
};

// Minimal 1x1 transparent PNG buffer — used as the `fallback` for docx
// SVG ImageRun. Viewers that don't support SVG show this 1×1 transparent
// pixel; everyone else renders the SVG natively.
const FALLBACK_PNG_BUFFER = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0c0c000000000050001a0e2bb1c0000000049454e44ae426082',
  'hex',
);

module.exports = {
  renderCapitalStackDonutSvg,
  renderCashFlowTrendSvg,
  renderTornadoSvg,
  FALLBACK_PNG_BUFFER,
  __internal: { escapeXml, num, formatNumberIN, FONT_STACK },
};
