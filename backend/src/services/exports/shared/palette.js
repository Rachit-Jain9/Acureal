'use strict';

/**
 * Single source of truth for the editorial export palette.
 *
 * Used across PPTX, XLSX, and DOCX builders so every artifact reads as one
 * coherent product. No raw hex literals should appear anywhere in
 * `backend/src/services/exports/**` once builders adopt this module — every
 * colour reference goes through a named token below.
 *
 * Format conventions per consumer:
 *   - PPTX (pptxgenjs)   : hex without `#` (e.g. '0E1B2C')      → use `pptx(token)`
 *   - XLSX (ExcelJS)     : ARGB with FF prefix (e.g. 'FF0E1B2C')→ use `xlsx(token)`
 *   - DOCX (docx lib)    : hex without `#`                       → use `docx(token)`
 *   - HTML/SVG           : hex with `#`                          → use `css(token)`
 */

// Editorial palette — Bloomberg / Stripe / Linear register, not AI-SaaS.
// Deep navy + ink for primary structure, warm paper for surfaces, copper for
// the single accent, semantic emerald/red/amber for data positivity/negativity.
const RAW = Object.freeze({
  // Brand & structure
  inkDeep:        '0E1B2C', // hero numbers, cover background, slide dividers
  ink:            '1F2933', // primary body text, table headers
  paper:          'FBF9F6', // page surfaces, slide backgrounds
  paperElevated:  'FFFFFF', // elevated cards, KPI tiles
  paperSubtle:    'F4EFE7', // hover/inset surfaces, alt-row striping

  // Single accent — copper
  accent:         'B5793C', // links, decorative dividers, score gauge sweep
  accentSoft:     'E7C9A1', // accent-on-paper backgrounds

  // Semantic data colours — only on numbers, deltas, status pills
  dataPositive:   '0F7B5A', // emerald — IRR up, margin up, DSCR healthy
  dataNegative:   'B23A48', // red — IRR down, DSCR breach, risk critical
  dataWarning:    'C97B0E', // amber — DSCR thin, DD blocked, risk high

  // Neutral chrome
  mutedHigh:      '52606D', // labels, captions
  mutedLow:       '9AA5B1', // disabled labels, deep secondary text
  hairline:       'D7DDE5', // table borders, divider rules
  hairlineStrong: 'B7C0CC', // emphasized borders, table header underline

  // Excel finance conventions (kept for the Inputs sheet)
  inputFill:      'FFF2CC', // pale yellow input zone
  inputText:      '0000FF', // standard finance input-blue text
  formulaText:    '008000', // standard finance formula-green text
});

// Unknown-token guard: a typo'd token would otherwise interpolate `undefined`
// into colour strings ('#undefined' / 'FFundefined'), which ExcelJS/pptxgenjs
// silently accept and then produce corrupt or black artifacts. Fail soft to
// the neutral label colour and log loudly so the typo is caught in review.
const resolve = (token) => {
  const hex = RAW[token];
  if (!hex) {
    console.warn(`[palette] unknown token "${token}" — falling back to mutedHigh`);
    return RAW.mutedHigh;
  }
  return hex;
};

const css  = (token) => `#${resolve(token)}`;
const pptx = (token) => resolve(token);
const docx = (token) => resolve(token);
const xlsx = (token) => `FF${resolve(token)}`;

// Severity → semantic-data-token map. Consumers (risk renderers, DSCR cells,
// IRR deltas) call `severityColor('critical', 'pptx')` etc.
const SEVERITY_TOKEN = Object.freeze({
  critical: 'dataNegative',
  high:     'dataNegative',
  medium:   'dataWarning',
  low:      'mutedHigh',
  info:     'mutedHigh',
});

const severityColor = (severity, format = 'pptx') => {
  const token = SEVERITY_TOKEN[String(severity || '').toLowerCase()] || 'mutedHigh';
  if (format === 'css')  return css(token);
  if (format === 'xlsx') return xlsx(token);
  if (format === 'docx') return docx(token);
  return pptx(token);
};

// Numeric-delta colour: positive → emerald, negative → red, zero → muted.
const deltaColor = (delta, format = 'pptx') => {
  let token = 'mutedHigh';
  if (typeof delta === 'number' && Number.isFinite(delta)) {
    if (delta > 0) token = 'dataPositive';
    else if (delta < 0) token = 'dataNegative';
  }
  if (format === 'css')  return css(token);
  if (format === 'xlsx') return xlsx(token);
  if (format === 'docx') return docx(token);
  return pptx(token);
};

// Typography defaults — consumers may override locally but defaults here
// keep deck/sheet/doc consistent. Calibri / Arial fallbacks stay close to the
// installed fonts on Indian corporate machines so text renders without
// substitution surprises.
const FONTS = Object.freeze({
  display:  'Calibri',
  body:     'Calibri',
  mono:     'Consolas',
});

// Whole-deck typography sizes (pptxgenjs uses points).
const TYPE_SCALE = Object.freeze({
  hero:        44, // cover headline only
  h1:          28, // section titles
  h2:          20, // slide titles
  h3:          14, // sub-section labels
  body:        11, // paragraph copy
  caption:      9, // captions, footers, source notes
  eyebrow:      8, // uppercase metadata above titles
  kpiNumber:   32, // headline KPI numerics
  kpiLabel:    10, // KPI label rows
});

module.exports = {
  RAW,
  FONTS,
  TYPE_SCALE,
  css,
  pptx,
  docx,
  xlsx,
  severityColor,
  deltaColor,
};
