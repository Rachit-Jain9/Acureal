'use strict';

/**
 * Pure-SVG score gauge renderer.
 *
 * Produces a 0-100 semicircle gauge as an SVG string. No native dependencies
 * (no canvas, no Chromium). Caller embeds via:
 *
 *   - PPTX: `pptx.addImage({ data: 'data:image/svg+xml;base64,...' })`
 *   - DOCX: convert SVG buffer via the docx library's ImageRun with type 'svg'
 *
 * Visual: thick arc, accent-colour sweep proportional to score, large
 * tabular-num readout in the centre, semantic colour band beneath
 * (red < 40, amber 40–60, emerald > 60). Uses palette tokens.
 */

const { RAW } = require('./palette');

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 360;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const colorForScore = (score) => {
  if (score >= 70) return `#${RAW.dataPositive}`;
  if (score >= 50) return `#${RAW.accent}`;
  if (score >= 35) return `#${RAW.dataWarning}`;
  return `#${RAW.dataNegative}`;
};

const labelForScore = (score) => {
  if (score >= 80) return 'Strong';
  if (score >= 65) return 'Above benchmark';
  if (score >= 50) return 'In line';
  if (score >= 35) return 'Below benchmark';
  return 'Weak';
};

/**
 * Build an SVG string for a 0-100 score gauge.
 *
 * @param {Object}  args
 * @param {number}  args.score    0–100
 * @param {string=} args.label    Override the auto-generated band label
 * @param {string=} args.subline  Caption beneath the score (e.g. "Composite vs benchmark")
 * @param {number=} args.width    Default 600
 * @param {number=} args.height   Default 360
 */
const renderScoreGaugeSvg = ({
  score,
  label,
  subline,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
} = {}) => {
  const safeScore = clamp(Math.round(Number(score) || 0), 0, 100);
  const cx = width / 2;
  const cy = height * 0.78;
  const radius = Math.min(width * 0.42, height * 0.62);
  const strokeWidth = Math.max(16, Math.round(radius * 0.13));
  const fillColor = colorForScore(safeScore);
  const trackColor = `#${RAW.hairline}`;
  const inkDeep = `#${RAW.inkDeep}`;
  const muted = `#${RAW.mutedHigh}`;
  const bandLabel = label || labelForScore(safeScore);

  // Arc geometry — semicircle from 180° (left) to 0° (right).
  const startX = cx - radius;
  const startY = cy;
  const endX   = cx + radius;
  const endY   = cy;

  // Sweep arc end-point — interpolated by score.
  const angle = Math.PI - (safeScore / 100) * Math.PI; // π → 0
  const sweepX = cx + radius * Math.cos(angle);
  const sweepY = cy - radius * Math.sin(angle);
  const largeArc = safeScore > 50 ? 1 : 0;

  const numberY = cy - radius * 0.10;
  const labelY  = cy + radius * 0.18;
  const subY    = cy + radius * 0.36;
  const numberFontSize = Math.round(radius * 0.62);
  const labelFontSize  = Math.round(radius * 0.18);
  const subFontSize    = Math.round(radius * 0.13);

  const safeSub = subline ? String(subline).slice(0, 80) : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Score ${safeScore} of 100. ${bandLabel}.">`,
      `<rect width="${width}" height="${height}" fill="#${RAW.paper}" />`,
      // Track
      `<path d="M ${startX} ${startY} A ${radius} ${radius} 0 0 1 ${endX} ${endY}" `,
        `fill="none" stroke="${trackColor}" stroke-width="${strokeWidth}" stroke-linecap="round" />`,
      // Score sweep
      `<path d="M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${sweepX} ${sweepY}" `,
        `fill="none" stroke="${fillColor}" stroke-width="${strokeWidth}" stroke-linecap="round" />`,
      // Score numeric
      `<text x="${cx}" y="${numberY}" text-anchor="middle" `,
        `font-family="Calibri, Arial, sans-serif" font-weight="700" `,
        `font-size="${numberFontSize}" fill="${inkDeep}" `,
        `style="font-variant-numeric: tabular-nums;">${safeScore}</text>`,
      // Score-of label (small, right of number)
      `<text x="${cx}" y="${numberY + Math.round(numberFontSize * 0.22)}" text-anchor="middle" `,
        `font-family="Calibri, Arial, sans-serif" font-weight="500" `,
        `font-size="${Math.round(numberFontSize * 0.28)}" fill="${muted}">/ 100</text>`,
      // Band label
      `<text x="${cx}" y="${labelY}" text-anchor="middle" `,
        `font-family="Calibri, Arial, sans-serif" font-weight="600" `,
        `font-size="${labelFontSize}" fill="${fillColor}">${escapeXml(bandLabel)}</text>`,
      // Caption
      safeSub
        ? `<text x="${cx}" y="${subY}" text-anchor="middle" `
          + `font-family="Calibri, Arial, sans-serif" font-weight="400" `
          + `font-size="${subFontSize}" fill="${muted}">${escapeXml(safeSub)}</text>`
        : '',
    `</svg>`,
  ].join('');
};

const escapeXml = (str) => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

/**
 * SVG string → data URI (base64). Convenient for pptxgenjs `addImage`.
 */
const renderScoreGaugeDataUri = (args) => {
  const svg = renderScoreGaugeSvg(args);
  const base64 = Buffer.from(svg, 'utf8').toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
};

module.exports = {
  renderScoreGaugeSvg,
  renderScoreGaugeDataUri,
  // Exposed for tests.
  __internal: { colorForScore, labelForScore },
};
