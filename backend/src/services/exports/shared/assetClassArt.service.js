'use strict';

/**
 * Asset-class cover artwork — atmospheric magazine-cover SVGs.
 *
 * Renders a full-bleed editorial illustration for each supported asset
 * class. Goal: residential = golden-hour skyline; industrial = dusty
 * dusk over a warehouse; commercial = cool morning steel-and-glass;
 * hospitality = warm hotel-at-night; etc. — so the deck cover is
 * visually rich and asset-class-specific without ever leaning on
 * stock photography (no copyright surface, no external hosting).
 *
 * Each renderer produces SVG with:
 *   - linearGradient sky (warm sunset / cool dawn / dusty dusk per class)
 *   - layered depth: background skyline → midground silhouettes →
 *     foreground building hero → ground line + foreground props
 *   - window glow (lit interior rectangles, sometimes flickering pattern)
 *   - per-class palette accent (amber, copper, teal, plum, ochre)
 *   - subtle vignette / atmospheric haze
 *
 * No native dependencies, no external image fetching. Pure XML strings
 * embedded in pptx via base64 data URI.
 *
 * viewBox 1000×1200 (portrait, 0.83:1) to match the cover's full-bleed
 * right panel (~6.68" × 7.5").
 */

const { RAW } = require('./palette');

const VIEW_W = 1000;
const VIEW_H = 1200;

// Centralised colour vocabulary used across all asset-class art. Only
// hex literals appear here so palette.js stays the single source of
// truth for downstream code.
const C = {
  inkDeep:    `#${RAW.inkDeep}`,
  ink:        `#${RAW.ink}`,
  paper:      `#${RAW.paper}`,
  paperSoft:  `#${RAW.paperSubtle}`,
  accent:     `#${RAW.accent}`,
  accentSoft: `#${RAW.accentSoft}`,
  positive:   `#${RAW.dataPositive}`,
  negative:   `#${RAW.dataNegative}`,
  warning:    `#${RAW.dataWarning}`,
  muted:      `#${RAW.mutedHigh}`,
  hairline:   `#${RAW.hairline}`,
};

// ────────────────────────────────────────────────────────────────────────
// Shared atmospheric background blocks
// ────────────────────────────────────────────────────────────────────────

/**
 * Build a sky/atmosphere `<defs>` block keyed by mood name. Every
 * renderer uses one of these to set the tonal register of the cover.
 */
const skyDefs = (id, stops) => `
  <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
    ${stops.map(([offset, color, opacity]) => `<stop offset="${offset}" stop-color="${color}" stop-opacity="${opacity != null ? opacity : 1}"/>`).join('')}
  </linearGradient>`;

const SKY_PRESETS = {
  goldenHour: [
    ['0%',   '#1B2842'],   // pre-dusk navy at zenith
    ['35%',  '#A86B3D'],   // copper haze
    ['65%',  '#E0A56F'],   // warm amber band
    ['90%',  '#F2D2A1'],   // sun-kissed horizon
    ['100%', '#F2D2A1'],
  ],
  dawn: [
    ['0%',   '#7B9DB8'],   // soft blue
    ['45%',  '#D4B499'],   // warm peach
    ['80%',  '#F2DDC3'],   // pale gold
    ['100%', '#F8EDD9'],
  ],
  twilight: [
    ['0%',   '#0E1B2C'],   // deep navy
    ['45%',  '#3F4664'],   // dusk plum
    ['80%',  '#A87B59'],   // copper flare
    ['100%', '#D9A878'],
  ],
  cleanMorning: [
    ['0%',   '#9CB4C9'],   // pale steel sky
    ['55%',  '#D8E2EC'],
    ['100%', '#F1F4F7'],
  ],
  warmEvening: [
    ['0%',   '#241936'],   // deep purple-night
    ['40%',  '#5B324A'],   // mulberry
    ['70%',  '#A85F4A'],
    ['100%', '#D58A5C'],
  ],
  industrialDusk: [
    ['0%',   '#2A2C3A'],
    ['45%',  '#796B5A'],   // dusty ochre
    ['80%',  '#C29770'],
    ['100%', '#E2B98E'],
  ],
  retailNight: [
    ['0%',   '#0E1B2C'],
    ['55%',  '#1F2D45'],
    ['100%', '#2F3A55'],
  ],
  goldenLand: [
    ['0%',   '#8FA9C0'],   // soft blue sky
    ['50%',  '#E5C99A'],
    ['80%',  '#C49A60'],   // sun-warmed grass
    ['100%', '#9C7647'],
  ],
};

const buildSkyRect = (gradientId, h = 720) =>
  `<rect x="0" y="0" width="${VIEW_W}" height="${h}" fill="url(#${gradientId})"/>`;

/**
 * Distant skyline silhouette — ~10 staggered rectangles in deep navy.
 * Adds depth behind the foreground hero.
 */
const distantSkyline = (yBase, color = C.inkDeep, opacity = 0.85) => {
  const heights = [40, 80, 60, 110, 70, 90, 50, 120, 75, 95, 55];
  let x = -20;
  return heights.map((h) => {
    const w = 80 + (h % 20);
    const rect = `<rect x="${x}" y="${yBase - h}" width="${w}" height="${h}" fill="${color}" opacity="${opacity}"/>`;
    x += w - 10;
    return rect;
  }).join('');
};

const distantTreeline = (yBase, color = C.muted, opacity = 0.55) => {
  const points = [];
  for (let x = 0; x <= VIEW_W; x += 18) {
    const r = 14 + (x * 7) % 12;
    points.push(`<circle cx="${x}" cy="${yBase}" r="${r}" fill="${color}" opacity="${opacity}"/>`);
  }
  return points.join('');
};

/**
 * Ground gradient strip beneath the buildings.
 */
const buildGroundGradient = (id, top, bottom) => `
  <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${top}"/>
    <stop offset="100%" stop-color="${bottom}"/>
  </linearGradient>`;

/**
 * Atmospheric haze band — soft horizontal band overlay to soften the
 * transition between buildings and sky.
 */
const hazeBand = (y, h, color, opacity = 0.35) =>
  `<rect x="0" y="${y}" width="${VIEW_W}" height="${h}" fill="${color}" opacity="${opacity}"/>`;

/**
 * Vignette overlay (dark corners) for cinematic feel. Subtle.
 */
const vignette = () => `
  <radialGradient id="vignette" cx="50%" cy="55%" r="75%">
    <stop offset="60%" stop-color="#000" stop-opacity="0"/>
    <stop offset="100%" stop-color="#000" stop-opacity="0.45"/>
  </radialGradient>
  `;

/**
 * Ambient noise / texture — fine dot pattern at low opacity. Adds
 * paper-grain feel that lifts the SVG above flat geometric.
 */
const grainPattern = () => `
  <pattern id="grain" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
    <circle cx="3"  cy="14" r="0.7" fill="${C.paper}" opacity="0.18"/>
    <circle cx="38" cy="6"  r="0.7" fill="${C.paper}" opacity="0.18"/>
    <circle cx="62" cy="33" r="0.7" fill="${C.paper}" opacity="0.18"/>
    <circle cx="22" cy="55" r="0.7" fill="${C.paper}" opacity="0.18"/>
    <circle cx="74" cy="71" r="0.7" fill="${C.paper}" opacity="0.18"/>
    <circle cx="11" cy="78" r="0.7" fill="${C.paper}" opacity="0.18"/>
  </pattern>`;

const escapeAlt = (s) => String(s || '').replace(/[<>"']/g, '');

const wrapSvg = ({ inner, defs = '', alt }) => [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${escapeAlt(alt || 'Asset class illustration')}">`,
    `<defs>${grainPattern()}${vignette()}${defs}</defs>`,
    inner,
    // Vignette overlay last so it sits on top.
    `<rect x="0" y="0" width="${VIEW_W}" height="${VIEW_H}" fill="url(#vignette)"/>`,
    `<rect x="0" y="0" width="${VIEW_W}" height="${VIEW_H}" fill="url(#grain)"/>`,
  `</svg>`,
].join('');

/**
 * Builder for an apartment / hotel / mixed-use tower with depth + lit
 * windows. Returns the SVG fragment.
 *
 * @param {Object} opts
 * @param {number} opts.x          tower left edge
 * @param {number} opts.yBase      ground line
 * @param {number} opts.w          tower width
 * @param {number} opts.h          tower height
 * @param {number} opts.cols       window columns
 * @param {number} opts.rows       window rows
 * @param {string} opts.bodyColor  primary fill
 * @param {string} opts.glowColor  lit-window colour
 * @param {string} opts.darkColor  unlit-window colour
 * @param {number} opts.litRatio   approx fraction of windows lit (0–1)
 * @param {string} opts.crownColor copper accent strip at the top
 */
const drawTower = ({ x, yBase, w, h, cols, rows, bodyColor, glowColor, darkColor, litRatio = 0.45, crownColor = C.accent }) => {
  const padX = 14;
  const padY = 22;
  const cellW = (w - padX * 2) / cols;
  const cellH = (h - padY * 2) / rows;
  const winW = cellW * 0.62;
  const winH = cellH * 0.55;
  let frag = '';
  // Body
  frag += `<rect x="${x}" y="${yBase - h}" width="${w}" height="${h}" fill="${bodyColor}"/>`;
  // Crown strip
  if (crownColor) frag += `<rect x="${x}" y="${yBase - h}" width="${w}" height="14" fill="${crownColor}"/>`;
  // Windows — pseudo-random lit pattern keyed off (x*r + c) for stability.
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const wx = x + padX + c * cellW + (cellW - winW) / 2;
      const wy = yBase - h + padY + r * cellH + (cellH - winH) / 2;
      // Stable PRNG-ish from coordinates so windows are consistent across renders.
      const seed = (Math.sin(x * 13 + r * 31 + c * 7) + 1) / 2;
      const lit = seed < litRatio;
      const fill = lit ? glowColor : darkColor;
      frag += `<rect x="${wx}" y="${wy}" width="${winW}" height="${winH}" fill="${fill}" opacity="${lit ? 0.95 : 0.55}"/>`;
      if (lit) {
        // Soft halo to suggest interior glow.
        frag += `<rect x="${wx - 1.5}" y="${wy - 1.5}" width="${winW + 3}" height="${winH + 3}" fill="${glowColor}" opacity="0.18"/>`;
      }
    }
  }
  return frag;
};

const drawTreeSilhouette = (cx, yBase, scale = 1, color = C.inkDeep) => {
  const r = 50 * scale;
  const trunkH = 60 * scale;
  const trunkW = 12 * scale;
  return [
    `<circle cx="${cx}" cy="${yBase - trunkH}" r="${r}" fill="${color}" opacity="0.85"/>`,
    `<rect x="${cx - trunkW / 2}" y="${yBase - trunkH}" width="${trunkW}" height="${trunkH}" fill="${color}" opacity="0.95"/>`,
  ].join('');
};

const drawLamppost = (x, yBase, scale = 1, color = C.inkDeep) => {
  return [
    `<rect x="${x - 3 * scale}" y="${yBase - 220 * scale}" width="${6 * scale}" height="${220 * scale}" fill="${color}"/>`,
    `<rect x="${x - 25 * scale}" y="${yBase - 230 * scale}" width="${50 * scale}" height="${10 * scale}" fill="${color}"/>`,
    `<circle cx="${x - 18 * scale}" cy="${yBase - 220 * scale}" r="${5 * scale}" fill="${C.warning}"/>`,
    `<circle cx="${x - 18 * scale}" cy="${yBase - 220 * scale}" r="${10 * scale}" fill="${C.warning}" opacity="0.35"/>`,
  ].join('');
};

// ────────────────────────────────────────────────────────────────────────
// Per-class illustrations
// ────────────────────────────────────────────────────────────────────────

const residentialApartments = () => {
  const yGround = 1080;
  const skyId = 'sky-residential';
  const groundId = 'ground-residential';
  return wrapSvg({
    alt: 'Residential apartment skyline at golden hour',
    defs: skyDefs(skyId, SKY_PRESETS.goldenHour) + buildGroundGradient(groundId, '#1F2933', '#0E1B2C'),
    inner: [
      // Sky
      buildSkyRect(skyId, yGround),
      // Distant warm haze near horizon
      hazeBand(yGround - 220, 240, '#F2D2A1', 0.22),
      // Ground
      `<rect x="0" y="${yGround}" width="${VIEW_W}" height="${VIEW_H - yGround}" fill="url(#${groundId})"/>`,
      // Distant skyline
      distantSkyline(yGround - 100, '#0E1B2C', 0.7),
      // Background tower (set back, dimmer)
      drawTower({
        x: 90, yBase: yGround, w: 180, h: 540,
        cols: 4, rows: 14,
        bodyColor: '#1A2438',
        glowColor: '#F2D2A1',
        darkColor: '#0E1B2C',
        litRatio: 0.30,
        crownColor: C.accent,
      }),
      // Foreground hero tower (centre)
      drawTower({
        x: 320, yBase: yGround, w: 280, h: 720,
        cols: 5, rows: 18,
        bodyColor: '#0E1B2C',
        glowColor: '#FFD089',
        darkColor: '#1F2933',
        litRatio: 0.42,
        crownColor: C.accent,
      }),
      // Side tower (right-of-centre, mid-height)
      drawTower({
        x: 660, yBase: yGround, w: 200, h: 600,
        cols: 4, rows: 15,
        bodyColor: '#16263F',
        glowColor: '#F4B26E',
        darkColor: '#0E1B2C',
        litRatio: 0.36,
        crownColor: C.accent,
      }),
      // Foreground tree silhouettes
      drawTreeSilhouette(40, yGround, 1.0, '#0E1B2C'),
      drawTreeSilhouette(940, yGround, 0.9, '#0E1B2C'),
      // Lamppost
      drawLamppost(180, yGround, 0.9, '#0E1B2C'),
      // Ground line
      `<rect x="0" y="${yGround}" width="${VIEW_W}" height="3" fill="${C.muted}" opacity="0.55"/>`,
      // Subtle reflection on ground
      `<rect x="320" y="${yGround}" width="280" height="80" fill="#FFD089" opacity="0.10"/>`,
    ].join(''),
  });
};

const villas = () => {
  const yGround = 1080;
  const skyId = 'sky-villas';
  const groundId = 'ground-villas';
  return wrapSvg({
    alt: 'Detached villa at dawn',
    defs: skyDefs(skyId, SKY_PRESETS.dawn) + buildGroundGradient(groundId, '#3D5A4F', '#23362E'),
    inner: [
      buildSkyRect(skyId, yGround),
      hazeBand(yGround - 200, 220, '#F2DDC3', 0.30),
      `<rect x="0" y="${yGround}" width="${VIEW_W}" height="${VIEW_H - yGround}" fill="url(#${groundId})"/>`,
      // Distant treeline
      distantTreeline(yGround - 120, '#1F2D32', 0.7),
      // Foreground villa
      // Body
      `<rect x="280" y="${yGround - 380}" width="440" height="380" fill="#0E1B2C"/>`,
      // Pitched roof
      `<polygon points="270,${yGround - 380} 500,${yGround - 540} 730,${yGround - 380}" fill="#1F2933"/>`,
      // Roof copper trim
      `<polygon points="270,${yGround - 380} 500,${yGround - 540} 730,${yGround - 380} 720,${yGround - 372} 500,${yGround - 528} 280,${yGround - 372}" fill="${C.accent}" opacity="0.88"/>`,
      // Door — warm glow visible
      `<rect x="465" y="${yGround - 200}" width="70" height="200" fill="#321F12"/>`,
      `<rect x="465" y="${yGround - 200}" width="70" height="6" fill="#F4B26E" opacity="0.6"/>`,
      // Windows lit (each entry: [x_left, height-from-ground, width, height])
      [[330, 280, 90, 80], [600, 280, 90, 80], [330, 160, 90, 110], [600, 160, 90, 110]].map(([wx, wy, ww, wh]) => [
        `<rect x="${wx}" y="${yGround - wy - wh}" width="${ww}" height="${wh}" fill="#FFD089" opacity="0.95"/>`,
        // Glow halo
        `<rect x="${wx - 4}" y="${yGround - wy - wh - 4}" width="${ww + 8}" height="${wh + 8}" fill="#FFD089" opacity="0.18"/>`,
        // Window crossbars
        `<line x1="${wx + ww / 2}" y1="${yGround - wy - wh}" x2="${wx + ww / 2}" y2="${yGround - wy}" stroke="#0E1B2C" stroke-width="3"/>`,
        `<line x1="${wx}" y1="${yGround - wy - wh / 2}" x2="${wx + ww}" y2="${yGround - wy - wh / 2}" stroke="#0E1B2C" stroke-width="3"/>`,
      ].join('')).join(''),
      // Garden fence
      Array.from({ length: 14 }, (_, i) => {
        const fx = 30 + i * 18;
        return `<rect x="${fx}" y="${yGround - 80}" width="6" height="80" fill="#0E1B2C"/>`;
      }).join(''),
      Array.from({ length: 14 }, (_, i) => {
        const fx = 730 + i * 18;
        return `<rect x="${fx}" y="${yGround - 80}" width="6" height="80" fill="#0E1B2C"/>`;
      }).join(''),
      // Foreground tree
      drawTreeSilhouette(120, yGround, 1.4, '#0E1B2C'),
      drawTreeSilhouette(880, yGround, 1.2, '#0E1B2C'),
      // Path to door
      `<polygon points="450,${yGround} 550,${yGround} 525,${yGround - 80} 475,${yGround - 80}" fill="#1F2933" opacity="0.75"/>`,
      `<rect x="0" y="${yGround}" width="${VIEW_W}" height="3" fill="${C.muted}" opacity="0.45"/>`,
    ].join(''),
  });
};

const plottedDevelopment = () => {
  // Aerial / isometric master-plan diagram on warm-paper background.
  const skyId = 'sky-plotted';
  return wrapSvg({
    alt: 'Plotted development master plan from above',
    defs: skyDefs(skyId, [
      ['0%',   '#F4EFE7'],
      ['100%', '#E5D9C3'],
    ]),
    inner: [
      buildSkyRect(skyId, VIEW_H),
      // Sun
      `<circle cx="850" cy="200" r="80" fill="#F4B26E" opacity="0.85"/>`,
      `<circle cx="850" cy="200" r="120" fill="#F4B26E" opacity="0.18"/>`,
      // Master plot boundary — dashed
      `<rect x="100" y="320" width="800" height="700" fill="#FBF9F6" stroke="#0E1B2C" stroke-width="4" stroke-dasharray="14,8"/>`,
      // Roads (cross + perimeter)
      `<line x1="100" y1="670" x2="900" y2="670" stroke="#3F4664" stroke-width="22" opacity="0.85"/>`,
      `<line x1="500" y1="320" x2="500" y2="1020" stroke="#3F4664" stroke-width="22" opacity="0.85"/>`,
      // Road centre lines (dashed white)
      `<line x1="100" y1="670" x2="900" y2="670" stroke="${C.paper}" stroke-width="2" stroke-dasharray="14,12" opacity="0.7"/>`,
      `<line x1="500" y1="320" x2="500" y2="1020" stroke="${C.paper}" stroke-width="2" stroke-dasharray="14,12" opacity="0.7"/>`,
      // Plot grid lines
      Array.from({ length: 3 }, (_, i) => `<line x1="${200 + i * 100}" y1="320" x2="${200 + i * 100}" y2="670" stroke="${C.hairline}" stroke-width="2"/>`).join(''),
      Array.from({ length: 3 }, (_, i) => `<line x1="${600 + i * 100}" y1="670" x2="${600 + i * 100}" y2="1020" stroke="${C.hairline}" stroke-width="2"/>`).join(''),
      `<line x1="100" y1="495" x2="500" y2="495" stroke="${C.hairline}" stroke-width="2"/>`,
      `<line x1="500" y1="845" x2="900" y2="845" stroke="${C.hairline}" stroke-width="2"/>`,
      // Plot fills (alternating tones for a quilt feel)
      [[120, 340, 80, 140, '#E5D9C3'], [220, 340, 80, 140, '#D8C5AF'], [320, 340, 80, 140, '#E5D9C3'], [420, 340, 80, 140, '#D8C5AF'],
       [120, 510, 80, 140, '#D8C5AF'], [220, 510, 80, 140, '#E5D9C3'], [320, 510, 80, 140, '#D8C5AF'], [420, 510, 80, 140, '#E5D9C3'],
       [520, 690, 80, 140, '#E5D9C3'], [620, 690, 80, 140, '#D8C5AF'], [720, 690, 80, 140, '#E5D9C3'], [820, 690, 80, 140, '#D8C5AF'],
       [520, 860, 80, 140, '#D8C5AF'], [620, 860, 80, 140, '#E5D9C3'], [720, 860, 80, 140, '#D8C5AF'], [820, 860, 80, 140, '#E5D9C3']]
        .map(([px, py, pw, ph, fill]) => `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="${fill}" opacity="0.85"/>`).join(''),
      // Sample house silhouettes on a few plots
      [[160, 380], [260, 380], [360, 380], [460, 380], [160, 550], [260, 550], [560, 730], [660, 730], [760, 730], [560, 900], [760, 900]]
        .map(([px, py]) => {
          const rectX = px;
          const rectY = py;
          return `<rect x="${rectX}" y="${rectY + 30}" width="60" height="40" fill="#0E1B2C"/>` +
                 `<polygon points="${rectX},${rectY + 30} ${rectX + 30},${rectY + 5} ${rectX + 60},${rectY + 30}" fill="#1F2933"/>`;
        }).join(''),
      // Phase callout
      `<rect x="640" y="370" width="220" height="72" fill="${C.inkDeep}" opacity="0.94"/>`,
      `<rect x="640" y="370" width="220" height="6" fill="${C.accent}"/>`,
      `<text x="750" y="408" font-family="Calibri, Arial, sans-serif" font-weight="700" font-size="22" fill="${C.paper}" text-anchor="middle">PHASE 1</text>`,
      `<text x="750" y="430" font-family="Calibri, Arial, sans-serif" font-weight="500" font-size="13" fill="${C.paper}" text-anchor="middle" opacity="0.75">MASTER PLAN</text>`,
      // Compass rose
      `<circle cx="180" cy="970" r="42" fill="${C.paper}" stroke="${C.inkDeep}" stroke-width="2"/>`,
      `<polygon points="180,935 192,975 180,965 168,975" fill="${C.inkDeep}"/>`,
      `<text x="180" y="930" font-family="Calibri, Arial, sans-serif" font-weight="700" font-size="14" fill="${C.inkDeep}" text-anchor="middle">N</text>`,
    ].join(''),
  });
};

const commercialOffice = () => {
  const yGround = 1080;
  const skyId = 'sky-commercial';
  const groundId = 'ground-commercial';
  return wrapSvg({
    alt: 'Commercial office tower at clean morning',
    defs: skyDefs(skyId, SKY_PRESETS.cleanMorning) + buildGroundGradient(groundId, '#3F4664', '#1F2933'),
    inner: [
      buildSkyRect(skyId, yGround),
      hazeBand(yGround - 240, 240, '#D8E2EC', 0.55),
      `<rect x="0" y="${yGround}" width="${VIEW_W}" height="${VIEW_H - yGround}" fill="url(#${groundId})"/>`,
      // Distant skyline
      distantSkyline(yGround - 80, '#3F4664', 0.55),
      // Hero tower — glass-and-steel with reflective stripes
      // Body
      `<rect x="320" y="${yGround - 800}" width="380" height="800" fill="#1F2933"/>`,
      // Glass facade (vertical mullions + reflective stripes)
      Array.from({ length: 7 }, (_, i) => `<line x1="${340 + i * 50}" y1="${yGround - 760}" x2="${340 + i * 50}" y2="${yGround - 80}" stroke="${C.paper}" stroke-width="2.5" opacity="0.55"/>`).join(''),
      // Horizontal floor lines
      Array.from({ length: 18 }, (_, i) => `<line x1="320" y1="${yGround - 760 + i * 38}" x2="700" y2="${yGround - 760 + i * 38}" stroke="${C.paper}" stroke-width="1.4" opacity="0.30"/>`).join(''),
      // Reflective gleam overlay on glass
      `<rect x="380" y="${yGround - 760}" width="60" height="680" fill="${C.paper}" opacity="0.18"/>`,
      `<rect x="540" y="${yGround - 720}" width="40" height="600" fill="${C.paper}" opacity="0.12"/>`,
      // Crown setback
      `<rect x="360" y="${yGround - 830}" width="300" height="32" fill="#0E1B2C"/>`,
      `<rect x="360" y="${yGround - 838}" width="300" height="6" fill="${C.accent}"/>`,
      // Lobby — copper entrance
      `<rect x="280" y="${yGround - 80}" width="460" height="80" fill="#0E1B2C"/>`,
      `<rect x="460" y="${yGround - 70}" width="100" height="70" fill="${C.accent}"/>`,
      `<rect x="460" y="${yGround - 70}" width="100" height="6" fill="${C.paper}" opacity="0.7"/>`,
      // Adjacent buildings
      `<rect x="80" y="${yGround - 380}" width="200" height="380" fill="#1F2933"/>`,
      Array.from({ length: 5 }, (_, i) => `<line x1="${100 + i * 35}" y1="${yGround - 360}" x2="${100 + i * 35}" y2="${yGround - 30}" stroke="${C.paper}" stroke-width="1.6" opacity="0.45"/>`).join(''),
      `<rect x="80" y="${yGround - 384}" width="200" height="6" fill="${C.accent}" opacity="0.6"/>`,
      `<rect x="740" y="${yGround - 320}" width="180" height="320" fill="#1F2933"/>`,
      Array.from({ length: 4 }, (_, i) => `<line x1="${760 + i * 35}" y1="${yGround - 300}" x2="${760 + i * 35}" y2="${yGround - 30}" stroke="${C.paper}" stroke-width="1.6" opacity="0.45"/>`).join(''),
      // Plaza details
      `<rect x="0" y="${yGround}" width="${VIEW_W}" height="3" fill="${C.muted}" opacity="0.5"/>`,
      // Tiny pedestrian + vehicle silhouettes for scale
      `<circle cx="200" cy="${yGround - 28}" r="8" fill="${C.inkDeep}"/>`,
      `<rect x="195" y="${yGround - 18}" width="10" height="18" fill="${C.inkDeep}"/>`,
      `<rect x="820" y="${yGround - 30}" width="50" height="20" fill="${C.inkDeep}"/>`,
      `<circle cx="828" cy="${yGround - 8}" r="6" fill="${C.muted}"/>`,
      `<circle cx="862" cy="${yGround - 8}" r="6" fill="${C.muted}"/>`,
    ].join(''),
  });
};

const retail = () => {
  const yGround = 1080;
  const skyId = 'sky-retail';
  const groundId = 'ground-retail';
  return wrapSvg({
    alt: 'Retail high-street under twilight',
    defs: skyDefs(skyId, SKY_PRESETS.retailNight) + buildGroundGradient(groundId, '#1F2933', '#0E1B2C'),
    inner: [
      buildSkyRect(skyId, yGround),
      `<rect x="0" y="${yGround}" width="${VIEW_W}" height="${VIEW_H - yGround}" fill="url(#${groundId})"/>`,
      // Stars
      Array.from({ length: 22 }, (_, i) => {
        const sx = (i * 47 + 13) % VIEW_W;
        const sy = ((i * 31) % 240) + 40;
        return `<circle cx="${sx}" cy="${sy}" r="1.6" fill="${C.paper}" opacity="${0.35 + ((i * 7) % 50) / 100}"/>`;
      }).join(''),
      // Distant skyline
      distantSkyline(yGround - 60, '#0E1B2C', 0.65),
      // Storefront row body
      `<rect x="60" y="${yGround - 600}" width="880" height="600" fill="#0E1B2C"/>`,
      // Signage band — copper with glow
      `<rect x="60" y="${yGround - 600}" width="880" height="100" fill="${C.accent}"/>`,
      `<rect x="60" y="${yGround - 600}" width="880" height="100" fill="${C.accent}" opacity="0.4" filter="url(#glow)"/>`,
      // Upper storey horizontal accent
      `<rect x="60" y="${yGround - 480}" width="880" height="6" fill="${C.accent}" opacity="0.7"/>`,
      // Storefront divisions (5 shops)
      Array.from({ length: 5 }, (_, i) => {
        const sx = 90 + i * 172;
        return [
          // Display window — warm interior glow
          `<rect x="${sx}" y="${yGround - 300}" width="146" height="240" fill="#FFD089" opacity="0.88"/>`,
          // Glow halo
          `<rect x="${sx - 6}" y="${yGround - 306}" width="158" height="252" fill="#FFD089" opacity="0.20"/>`,
          // Window crossbar
          `<line x1="${sx}" y1="${yGround - 180}" x2="${sx + 146}" y2="${yGround - 180}" stroke="#0E1B2C" stroke-width="3"/>`,
          // Awning
          `<polygon points="${sx - 8},${yGround - 320} ${sx + 154},${yGround - 320} ${sx + 138},${yGround - 300} ${sx + 8},${yGround - 300}" fill="#1F2933"/>`,
          // Awning stripes
          Array.from({ length: 4 }, (_, k) => `<line x1="${sx + k * 38}" y1="${yGround - 320}" x2="${sx + 8 + k * 38}" y2="${yGround - 300}" stroke="${C.accent}" stroke-width="2.5"/>`).join(''),
          // Shop sign
          `<rect x="${sx + 14}" y="${yGround - 580}" width="118" height="50" fill="#1F2933" stroke="${C.accent}" stroke-width="1.5"/>`,
          `<text x="${sx + 73}" y="${yGround - 547}" font-family="Calibri, Arial, sans-serif" font-weight="700" font-size="13" fill="${C.accent}" text-anchor="middle" opacity="0.9">SHOP ${String.fromCharCode(65 + i)}</text>`,
          // Door
          `<rect x="${sx + 53}" y="${yGround - 130}" width="40" height="70} fill="#0E1B2C"/>`.replace('70}', '70'),
          `<rect x="${sx + 53}" y="${yGround - 130}" width="40" height="70" fill="#0E1B2C"/>`,
        ].join('');
      }).join(''),
      // Pedestrian silhouettes
      `<circle cx="220" cy="${yGround - 30}" r="11" fill="#0E1B2C"/>`,
      `<rect x="213" y="${yGround - 17}" width="14" height="22" fill="#0E1B2C"/>`,
      `<circle cx="780" cy="${yGround - 30}" r="11" fill="#0E1B2C"/>`,
      `<rect x="773" y="${yGround - 17}" width="14" height="22" fill="#0E1B2C"/>`,
      `<circle cx="500" cy="${yGround - 30}" r="11" fill="#0E1B2C"/>`,
      `<rect x="493" y="${yGround - 17}" width="14" height="22" fill="#0E1B2C"/>`,
      // Ground reflection of warm shop glow
      `<rect x="60" y="${yGround}" width="880" height="40" fill="#FFD089" opacity="0.08"/>`,
      `<rect x="0" y="${yGround}" width="${VIEW_W}" height="3" fill="${C.muted}" opacity="0.45"/>`,
    ].join(''),
  });
};

const industrialWarehousing = () => {
  const yGround = 1080;
  const skyId = 'sky-industrial';
  const groundId = 'ground-industrial';
  return wrapSvg({
    alt: 'Grade-A warehouse at industrial dusk',
    defs: skyDefs(skyId, SKY_PRESETS.industrialDusk) + buildGroundGradient(groundId, '#3D352A', '#1F1813'),
    inner: [
      buildSkyRect(skyId, yGround),
      hazeBand(yGround - 220, 220, '#C29770', 0.30),
      `<rect x="0" y="${yGround}" width="${VIEW_W}" height="${VIEW_H - yGround}" fill="url(#${groundId})"/>`,
      // Distant industrial silhouette
      distantSkyline(yGround - 80, '#1F2933', 0.55),
      // Smoke stacks in distance
      `<rect x="850" y="${yGround - 240}" width="14" height="160" fill="#1F2933" opacity="0.7"/>`,
      `<circle cx="857" cy="${yGround - 250}" r="40" fill="#796B5A" opacity="0.45"/>`,
      `<circle cx="887" cy="${yGround - 280}" r="50" fill="#796B5A" opacity="0.30"/>`,
      // Main warehouse body
      `<rect x="100" y="${yGround - 420}" width="780" height="420" fill="#0E1B2C"/>`,
      // Saw-tooth roof — 5 peaks
      Array.from({ length: 5 }, (_, i) => {
        const sx = 100 + i * 156;
        return `<polygon points="${sx},${yGround - 420} ${sx + 78},${yGround - 540} ${sx + 156},${yGround - 420}" fill="#1F2933"/>`;
      }).join(''),
      // Saw-tooth glazing strips with warm interior glow
      Array.from({ length: 5 }, (_, i) => {
        const sx = 100 + i * 156;
        return `<polygon points="${sx + 78},${yGround - 540} ${sx + 110},${yGround - 480} ${sx + 78},${yGround - 480}" fill="#F4B26E" opacity="0.85"/>` +
               `<polygon points="${sx + 78},${yGround - 540} ${sx + 110},${yGround - 480} ${sx + 78},${yGround - 480}" fill="#F4B26E" opacity="0.30"/>`;
      }).join(''),
      // Top accent strip (parapet)
      `<rect x="100" y="${yGround - 420}" width="780" height="14" fill="${C.accent}"/>`,
      // Floodlights (corner mounted)
      `<rect x="80" y="${yGround - 460}" width="14" height="80" fill="#1F2933"/>`,
      `<polygon points="94,${yGround - 460} 220,${yGround - 380} 94,${yGround - 380}" fill="#FFD089" opacity="0.18"/>`,
      `<rect x="886" y="${yGround - 460}" width="14" height="80" fill="#1F2933"/>`,
      `<polygon points="886,${yGround - 460} 760,${yGround - 380} 886,${yGround - 380}" fill="#FFD089" opacity="0.18"/>`,
      // Truck dock doors (5 doors with warm interior light)
      Array.from({ length: 5 }, (_, i) => {
        const sx = 170 + i * 140;
        return [
          `<rect x="${sx}" y="${yGround - 220}" width="100" height="220" fill="#1F2933"/>`,
          // Roller-shutter horizontal lines
          Array.from({ length: 9 }, (_, k) => `<line x1="${sx + 4}" y1="${yGround - 200 + k * 22}" x2="${sx + 96}" y2="${yGround - 200 + k * 22}" stroke="${C.muted}" stroke-width="1.4" opacity="0.7"/>`).join(''),
          // Faint warm glow at the bottom slot
          `<rect x="${sx}" y="${yGround - 16}" width="100" height="16" fill="#FFD089" opacity="0.40"/>`,
        ].join('');
      }).join(''),
      // Truck silhouette in foreground
      `<rect x="690" y="${yGround - 130}" width="220" height="80" fill="#1F2933"/>`,
      `<rect x="760" y="${yGround - 170}" width="120" height="50" fill="#1F2933"/>`,
      `<circle cx="725" cy="${yGround - 50}" r="22" fill="#0E1B2C"/>`,
      `<circle cx="725" cy="${yGround - 50}" r="14" fill="#3F4664"/>`,
      `<circle cx="870" cy="${yGround - 50}" r="22" fill="#0E1B2C"/>`,
      `<circle cx="870" cy="${yGround - 50}" r="14" fill="#3F4664"/>`,
      `<rect x="765" y="${yGround - 158}" width="48" height="28" fill="#FFD089" opacity="0.85"/>`,
      // Headlights (warm cones)
      `<polygon points="690,${yGround - 90} 600,${yGround - 30} 690,${yGround - 30}" fill="#FFD089" opacity="0.22"/>`,
      `<rect x="0" y="${yGround}" width="${VIEW_W}" height="3" fill="${C.muted}" opacity="0.45"/>`,
    ].join(''),
  });
};

const hospitality = () => {
  const yGround = 1080;
  const skyId = 'sky-hospitality';
  const groundId = 'ground-hospitality';
  return wrapSvg({
    alt: 'Hotel facade at warm evening',
    defs: skyDefs(skyId, SKY_PRESETS.warmEvening) + buildGroundGradient(groundId, '#2F1F1F', '#170E0E'),
    inner: [
      buildSkyRect(skyId, yGround),
      hazeBand(yGround - 200, 200, '#D58A5C', 0.30),
      `<rect x="0" y="${yGround}" width="${VIEW_W}" height="${VIEW_H - yGround}" fill="url(#${groundId})"/>`,
      // Distant skyline
      distantSkyline(yGround - 90, '#0E1B2C', 0.7),
      // Hotel body
      `<rect x="220" y="${yGround - 700}" width="560" height="700" fill="#0E1B2C"/>`,
      // Crown / penthouse with copper top
      `<rect x="260" y="${yGround - 730}" width="480" height="32" fill="#1F2933"/>`,
      `<rect x="260" y="${yGround - 738}" width="480" height="6" fill="${C.accent}"/>`,
      // Sign band — illuminated copper
      `<rect x="220" y="${yGround - 200}" width="560" height="40" fill="${C.accent}"/>`,
      `<rect x="200" y="${yGround - 210}" width="600" height="60" fill="${C.accent}" opacity="0.20"/>`,
      `<text x="500" y="${yGround - 172}" font-family="Calibri, Arial, sans-serif" font-weight="700" font-size="26" fill="${C.paper}" text-anchor="middle" letter-spacing="3">HOTEL</text>`,
      // Balcony grid (10 floors × 7 windows) — most lit
      Array.from({ length: 10 }, (_, r) => Array.from({ length: 7 }, (_, c) => {
        const wx = 250 + c * 75;
        const wy = yGround - 700 + 30 + r * 47;
        const seed = (Math.sin(r * 13 + c * 31) + 1) / 2;
        const lit = seed < 0.65;
        return [
          `<rect x="${wx}" y="${wy}" width="56" height="32" fill="${lit ? '#FFD089' : '#1F2933'}" opacity="${lit ? 0.95 : 0.55}"/>`,
          lit ? `<rect x="${wx - 2}" y="${wy - 2}" width="60" height="36" fill="#FFD089" opacity="0.22"/>` : '',
          `<rect x="${wx - 4}" y="${wy + 32}" width="64" height="3" fill="${C.accent}" opacity="0.85"/>`,
        ].join('');
      }).join('')).join(''),
      // Portico entrance — projecting canopy
      `<rect x="430" y="${yGround - 110}" width="140" height="14" fill="${C.accent}"/>`,
      `<rect x="430" y="${yGround - 96}" width="140" height="6" fill="${C.accent}" opacity="0.5"/>`,
      // Portico columns
      Array.from({ length: 4 }, (_, i) => {
        const cx = 440 + i * 40;
        return `<rect x="${cx}" y="${yGround - 110}" width="6" height="110" fill="#1F2933"/>`;
      }).join(''),
      // Driveway lights (lamppost)
      drawLamppost(150, yGround, 0.85, '#0E1B2C'),
      drawLamppost(870, yGround, 0.85, '#0E1B2C'),
      // Foreground tree
      drawTreeSilhouette(70, yGround, 1.0, '#0E1B2C'),
      drawTreeSilhouette(940, yGround, 1.0, '#0E1B2C'),
      // Driveway warm reflection
      `<rect x="430" y="${yGround}" width="140" height="60" fill="#FFD089" opacity="0.15"/>`,
      `<rect x="0" y="${yGround}" width="${VIEW_W}" height="3" fill="${C.muted}" opacity="0.45"/>`,
    ].join(''),
  });
};

const mixedUse = () => {
  const yGround = 1080;
  const skyId = 'sky-mixeduse';
  const groundId = 'ground-mixeduse';
  return wrapSvg({
    alt: 'Mixed-use tower at evening',
    defs: skyDefs(skyId, SKY_PRESETS.twilight) + buildGroundGradient(groundId, '#1F2933', '#0E1B2C'),
    inner: [
      buildSkyRect(skyId, yGround),
      hazeBand(yGround - 220, 240, '#A87B59', 0.28),
      `<rect x="0" y="${yGround}" width="${VIEW_W}" height="${VIEW_H - yGround}" fill="url(#${groundId})"/>`,
      // Distant skyline
      distantSkyline(yGround - 80, '#0E1B2C', 0.65),
      // Hero tower (apartments above + retail below)
      // Apartment portion
      drawTower({
        x: 320, yBase: yGround - 220, w: 360, h: 700,
        cols: 6, rows: 16,
        bodyColor: '#0E1B2C',
        glowColor: '#FFD089',
        darkColor: '#1F2933',
        litRatio: 0.55,
        crownColor: C.accent,
      }),
      // Retail base — wider, copper signage
      `<rect x="270" y="${yGround - 220}" width="460" height="220" fill="#1F2933"/>`,
      `<rect x="270" y="${yGround - 220}" width="460" height="56" fill="${C.accent}"/>`,
      `<rect x="250" y="${yGround - 230}" width="500" height="76" fill="${C.accent}" opacity="0.18"/>`,
      // Storefront windows (3 large panes) with warm glow
      Array.from({ length: 3 }, (_, i) => {
        const sx = 290 + i * 144;
        return [
          `<rect x="${sx}" y="${yGround - 140}" width="120" height="120" fill="#FFD089" opacity="0.85"/>`,
          `<rect x="${sx - 4}" y="${yGround - 144}" width="128" height="128" fill="#FFD089" opacity="0.20"/>`,
        ].join('');
      }).join(''),
      // Adjacent low-rise on the left (more retail / community)
      `<rect x="60" y="${yGround - 280}" width="200" height="280" fill="#1F2933"/>`,
      `<rect x="60" y="${yGround - 280}" width="200" height="40" fill="${C.accent}"/>`,
      `<rect x="80" y="${yGround - 200}" width="160" height="120" fill="#FFD089" opacity="0.85"/>`,
      `<rect x="76" y="${yGround - 204}" width="168" height="128" fill="#FFD089" opacity="0.20"/>`,
      // Right-side mid-rise
      `<rect x="740" y="${yGround - 380}" width="200" height="380" fill="#0E1B2C"/>`,
      Array.from({ length: 6 }, (_, r) => Array.from({ length: 4 }, (_, c) => {
        const wx = 760 + c * 38;
        const wy = yGround - 360 + r * 50;
        const lit = (r + c) % 2 === 0;
        return `<rect x="${wx}" y="${wy}" width="28" height="32" fill="${lit ? '#FFD089' : '#1F2933'}" opacity="${lit ? 0.92 : 0.6}"/>`;
      }).join('')).join(''),
      // Plaza street lamps
      drawLamppost(130, yGround, 0.75, '#0E1B2C'),
      drawLamppost(870, yGround, 0.75, '#0E1B2C'),
      // Pedestrians
      `<circle cx="450" cy="${yGround - 28}" r="10" fill="#0E1B2C"/>`,
      `<rect x="444" y="${yGround - 18}" width="12" height="20" fill="#0E1B2C"/>`,
      `<circle cx="540" cy="${yGround - 28}" r="10" fill="#0E1B2C"/>`,
      `<rect x="534" y="${yGround - 18}" width="12" height="20" fill="#0E1B2C"/>`,
      // Street reflection
      `<rect x="270" y="${yGround}" width="460" height="40" fill="#FFD089" opacity="0.10"/>`,
      `<rect x="0" y="${yGround}" width="${VIEW_W}" height="3" fill="${C.muted}" opacity="0.5"/>`,
    ].join(''),
  });
};

const rawLand = () => {
  const yGround = 850;
  const skyId = 'sky-rawland';
  const groundId = 'ground-rawland';
  return wrapSvg({
    alt: 'Raw land at golden hour',
    defs: skyDefs(skyId, SKY_PRESETS.goldenLand) + buildGroundGradient(groundId, '#9C7647', '#5A4326'),
    inner: [
      buildSkyRect(skyId, yGround),
      // Sun
      `<circle cx="780" cy="280" r="80" fill="#F4D389"/>`,
      `<circle cx="780" cy="280" r="130" fill="#F4D389" opacity="0.30"/>`,
      `<circle cx="780" cy="280" r="180" fill="#F4D389" opacity="0.15"/>`,
      // Distant mountains
      `<polygon points="0,${yGround} 200,${yGround - 120} 380,${yGround - 60} 540,${yGround - 140} 720,${yGround - 80} 900,${yGround - 110} 1000,${yGround - 50} 1000,${yGround}" fill="#1F2933" opacity="0.55"/>`,
      `<polygon points="0,${yGround} 140,${yGround - 60} 280,${yGround - 90} 420,${yGround - 50} 580,${yGround - 80} 740,${yGround - 40} 900,${yGround - 70} 1000,${yGround - 30} 1000,${yGround}" fill="#3F4664" opacity="0.45"/>`,
      // Treeline at horizon
      distantTreeline(yGround - 30, '#1F2933', 0.60),
      // Ground / land
      `<rect x="0" y="${yGround}" width="${VIEW_W}" height="${VIEW_H - yGround}" fill="url(#${groundId})"/>`,
      // Plot boundary — dashed survey rectangle laid out in perspective
      `<polygon points="120,${yGround + 60} 880,${yGround + 60} 940,${VIEW_H - 60} 60,${VIEW_H - 60}" fill="#9C7647" opacity="0.7" stroke="#0E1B2C" stroke-width="3" stroke-dasharray="14,8"/>`,
      // Corner survey pegs
      [[120, yGround + 60], [880, yGround + 60], [60, VIEW_H - 60], [940, VIEW_H - 60]].map(([cx, cy]) => `<rect x="${cx - 10}" y="${cy - 10}" width="20" height="20" fill="${C.accent}"/>`).join(''),
      // Tall grass tufts
      Array.from({ length: 18 }, (_, i) => {
        const gx = 80 + i * 50;
        return `<line x1="${gx}" y1="${yGround + 50}" x2="${gx + 2}" y2="${yGround + 30}" stroke="#1F2933" stroke-width="1.4" opacity="0.6"/>` +
               `<line x1="${gx + 4}" y1="${yGround + 50}" x2="${gx + 7}" y2="${yGround + 28}" stroke="#1F2933" stroke-width="1.4" opacity="0.6"/>`;
      }).join(''),
      // Foreground sign post — "FOR DEVELOPMENT"
      `<rect x="430" y="${yGround + 130}" width="140" height="80" fill="${C.inkDeep}"/>`,
      `<rect x="430" y="${yGround + 130}" width="140" height="6" fill="${C.accent}"/>`,
      `<text x="500" y="${yGround + 162}" font-family="Calibri, Arial, sans-serif" font-weight="700" font-size="14" fill="${C.paper}" text-anchor="middle">FOR</text>`,
      `<text x="500" y="${yGround + 184}" font-family="Calibri, Arial, sans-serif" font-weight="700" font-size="14" fill="${C.paper}" text-anchor="middle">DEVELOPMENT</text>`,
      `<rect x="495" y="${yGround + 210}" width="10" height="80" fill="#0E1B2C"/>`,
      // Compass / N arrow
      `<circle cx="900" cy="${yGround + 130}" r="38" fill="${C.paper}" stroke="${C.inkDeep}" stroke-width="2"/>`,
      `<polygon points="900,${yGround + 100} 912,${yGround + 138} 900,${yGround + 128} 888,${yGround + 138}" fill="${C.inkDeep}"/>`,
      `<text x="900" y="${yGround + 96}" font-family="Calibri, Arial, sans-serif" font-weight="700" font-size="14" fill="${C.inkDeep}" text-anchor="middle">N</text>`,
    ].join(''),
  });
};

const redevelopment = () => {
  const yGround = 1080;
  const skyId = 'sky-redev';
  const groundId = 'ground-redev';
  return wrapSvg({
    alt: 'Redevelopment site with construction crane',
    defs: skyDefs(skyId, SKY_PRESETS.dawn) + buildGroundGradient(groundId, '#3F4664', '#1F2933'),
    inner: [
      buildSkyRect(skyId, yGround),
      hazeBand(yGround - 200, 220, '#D4B499', 0.40),
      `<rect x="0" y="${yGround}" width="${VIEW_W}" height="${VIEW_H - yGround}" fill="url(#${groundId})"/>`,
      // Distant skyline
      distantSkyline(yGround - 70, '#3F4664', 0.55),
      // Existing aged building (left)
      `<rect x="80" y="${yGround - 460}" width="280" height="460" fill="#1F2933"/>`,
      // Existing building windows (mostly dark — vacated)
      Array.from({ length: 9 }, (_, r) => Array.from({ length: 4 }, (_, c) => {
        const wx = 100 + c * 70;
        const wy = yGround - 440 + r * 48;
        return `<rect x="${wx}" y="${wy}" width="50" height="30" fill="${C.paper}" opacity="0.40"/>`;
      }).join('')).join(''),
      // Scaffolding overlay on existing building
      Array.from({ length: 10 }, (_, i) => `<line x1="80" y1="${yGround - 440 + i * 46}" x2="360" y2="${yGround - 440 + i * 46}" stroke="${C.accent}" stroke-width="1.6" opacity="0.55"/>`).join(''),
      Array.from({ length: 4 }, (_, i) => `<line x1="${80 + i * 90}" y1="${yGround - 460}" x2="${80 + i * 90}" y2="${yGround}" stroke="${C.accent}" stroke-width="1.6" opacity="0.55"/>`).join(''),
      // New tower under construction (centre-right) — taller, mid-completion
      drawTower({
        x: 460, yBase: yGround, w: 280, h: 700,
        cols: 5, rows: 16,
        bodyColor: '#0E1B2C',
        glowColor: '#FFD089',
        darkColor: '#1F2933',
        litRatio: 0.20, // mostly under construction
        crownColor: '',
      }),
      // Top floors still bare structure
      `<rect x="460" y="${yGround - 800}" width="280" height="120" fill="#1F2933" opacity="0.55"/>`,
      Array.from({ length: 5 }, (_, i) => `<line x1="460" y1="${yGround - 790 + i * 25}" x2="740" y2="${yGround - 790 + i * 25}" stroke="${C.accent}" stroke-width="2" opacity="0.7"/>`).join(''),
      // Rebar / structure marks
      Array.from({ length: 6 }, (_, i) => `<line x1="${460 + i * 47}" y1="${yGround - 800}" x2="${460 + i * 47}" y2="${yGround - 680}" stroke="${C.accent}" stroke-width="1.4" opacity="0.6"/>`).join(''),
      // Construction crane
      `<rect x="800" y="${yGround - 1000}" width="14" height="1000" fill="#1F2933"/>`,
      // Crane lattice — diagonal cross-bracing
      Array.from({ length: 8 }, (_, i) => {
        const top = yGround - 1000 + i * 120;
        return `<line x1="800" y1="${top}" x2="814" y2="${top + 60}" stroke="#1F2933" stroke-width="1.4"/>` +
               `<line x1="814" y1="${top}" x2="800" y2="${top + 60}" stroke="#1F2933" stroke-width="1.4"/>`;
      }).join(''),
      // Jib (horizontal arm)
      `<rect x="814" y="${yGround - 1000}" width="180" height="14" fill="#1F2933"/>`,
      `<rect x="700" y="${yGround - 1000}" width="100" height="14" fill="#1F2933"/>`,
      // Cabin
      `<rect x="788" y="${yGround - 980}" width="30" height="30" fill="${C.accent}"/>`,
      // Counter-jib
      `<polygon points="700,${yGround - 1000} 720,${yGround - 1014} 800,${yGround - 1014} 800,${yGround - 1000}" fill="#1F2933"/>`,
      // Cable + load
      `<line x1="950" y1="${yGround - 986}" x2="950" y2="${yGround - 660}" stroke="#1F2933" stroke-width="2"/>`,
      `<rect x="918" y="${yGround - 670}" width="64" height="48" fill="#1F2933"/>`,
      `<rect x="918" y="${yGround - 672}" width="64" height="6" fill="${C.accent}"/>`,
      // Foreground hoarding
      `<rect x="0" y="${yGround - 60}" width="${VIEW_W}" height="60" fill="#1F2933"/>`,
      `<rect x="0" y="${yGround - 60}" width="${VIEW_W}" height="6" fill="${C.accent}"/>`,
      Array.from({ length: 12 }, (_, i) => `<line x1="${i * 84}" y1="${yGround - 60}" x2="${i * 84 + 30}" y2="${yGround}" stroke="${C.accent}" stroke-width="2" opacity="0.6"/>`).join(''),
    ].join(''),
  });
};

// ────────────────────────────────────────────────────────────────────────
// Asset class lookup
// ────────────────────────────────────────────────────────────────────────

const RENDERERS = {
  residential_apartments: residentialApartments,
  villas,
  plotted_development: plottedDevelopment,
  commercial_office: commercialOffice,
  retail,
  industrial_warehousing: industrialWarehousing,
  hospitality,
  mixed_use: mixedUse,
  raw_land: rawLand,
  redevelopment,
};

/**
 * Render an asset-class artwork SVG string. Falls back to the residential
 * apartment silhouette when the class is unrecognised so the cover still
 * gets a meaningful visual rather than a blank panel.
 *
 * @param {string} assetClass — one of the keys above.
 * @returns {{svg: string, dataUri: string, label: string}}
 */
const renderAssetClassArt = (assetClass) => {
  const renderer = RENDERERS[assetClass] || residentialApartments;
  const svg = renderer();
  const base64 = Buffer.from(svg, 'utf8').toString('base64');
  return {
    svg,
    dataUri: `data:image/svg+xml;base64,${base64}`,
    label: String(assetClass || 'unknown').replace(/_/g, ' '),
  };
};

module.exports = {
  renderAssetClassArt,
  RENDERERS,
};
