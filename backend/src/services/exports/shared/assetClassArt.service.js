'use strict';

/**
 * Asset-class cover artwork.
 *
 * Renders an editorial silhouette illustration for each supported asset
 * class — multi-story tower for residential, warehouse for industrial,
 * glass tower for commercial office, etc. — as an SVG string + base64
 * data URI. No external image hosting, no copyright concerns, no native
 * dependencies.
 *
 * Designs are deliberately simple: filled silhouettes in palette `inkDeep`
 * with copper accent details and `paper` window patterns. Recognizable
 * at the cover-slide size (~5×2.5 inches) without being cartoonish.
 *
 * Consumed by `dealPptx.service.js` precompute step → cover slide.
 *
 * Hard rules:
 *   - Pure text-mode SVG (no embedded raster, no external font dependency).
 *   - viewBox `0 0 1200 600` for every asset class so the cover layout
 *     can position once and swap art in.
 *   - Palette tokens via `shared/palette.js` — no hex literals.
 */

const { RAW } = require('./palette');

const C = {
  ink:        `#${RAW.inkDeep}`,
  body:       `#${RAW.ink}`,
  accent:     `#${RAW.accent}`,
  paper:      `#${RAW.paper}`,
  paperSoft:  `#${RAW.paperSubtle}`,
  muted:      `#${RAW.mutedHigh}`,
  hairline:   `#${RAW.hairline}`,
};

const VIEW_W = 1200;
const VIEW_H = 600;

const wrapSvg = (innerXml, alt) => {
  const safeAlt = String(alt || 'Asset class illustration').replace(/[<>"']/g, '');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" role="img" aria-label="${safeAlt}">`,
      `<rect width="${VIEW_W}" height="${VIEW_H}" fill="${C.paper}"/>`,
      // Subtle blueprint grid for the editorial / architectural feel.
      `<g stroke="${C.hairline}" stroke-width="1" opacity="0.35">`,
        Array.from({ length: 7 }, (_, i) => `<line x1="${i * 200}" y1="0" x2="${i * 200}" y2="${VIEW_H}"/>`).join(''),
        Array.from({ length: 4 }, (_, i) => `<line x1="0" y1="${i * 150}" x2="${VIEW_W}" y2="${i * 150}"/>`).join(''),
      `</g>`,
      // Ground line
      `<line x1="0" y1="${VIEW_H - 40}" x2="${VIEW_W}" y2="${VIEW_H - 40}" stroke="${C.muted}" stroke-width="2"/>`,
      innerXml,
    `</svg>`,
  ].join('');
};

// ─── Per-class illustrations ────────────────────────────────────────────────

const residentialApartments = () => {
  // Central tall tower (10 floors × 4 windows) flanked by two shorter towers.
  const groundY = VIEW_H - 40;
  const centralX = 480;
  const centralW = 240;
  const centralH = 460;
  const flankW = 160;
  const flankH = 320;

  const buildWindowGrid = (x, y, w, h, cols, rows) => {
    const padX = 12;
    const padY = 18;
    const cellW = (w - padX * 2) / cols;
    const cellH = (h - padY * 2) / rows;
    const winW = cellW * 0.55;
    const winH = cellH * 0.55;
    let out = '';
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const wx = x + padX + c * cellW + (cellW - winW) / 2;
        const wy = y + padY + r * cellH + (cellH - winH) / 2;
        out += `<rect x="${wx}" y="${wy}" width="${winW}" height="${winH}" fill="${C.paper}" opacity="0.95"/>`;
      }
    }
    return out;
  };

  return wrapSvg([
    // Left flanking tower
    `<rect x="${centralX - 30 - flankW}" y="${groundY - flankH}" width="${flankW}" height="${flankH}" fill="${C.body}" />`,
    buildWindowGrid(centralX - 30 - flankW, groundY - flankH, flankW, flankH, 3, 8),
    // Central tower body
    `<rect x="${centralX}" y="${groundY - centralH}" width="${centralW}" height="${centralH}" fill="${C.ink}" />`,
    // Central tower window grid
    buildWindowGrid(centralX, groundY - centralH, centralW, centralH, 4, 11),
    // Central tower copper accent strip (rooftop crown)
    `<rect x="${centralX}" y="${groundY - centralH}" width="${centralW}" height="14" fill="${C.accent}"/>`,
    // Right flanking tower (slightly different height)
    `<rect x="${centralX + centralW + 30}" y="${groundY - flankH + 30}" width="${flankW}" height="${flankH - 30}" fill="${C.body}" />`,
    buildWindowGrid(centralX + centralW + 30, groundY - flankH + 30, flankW, flankH - 30, 3, 7),
    // Foreground tree silhouettes
    `<circle cx="160" cy="${groundY - 50}" r="38" fill="${C.muted}" opacity="0.5"/>`,
    `<rect x="155" y="${groundY - 50}" width="10" height="50" fill="${C.muted}" opacity="0.7"/>`,
    `<circle cx="1060" cy="${groundY - 40}" r="28" fill="${C.muted}" opacity="0.5"/>`,
    `<rect x="1056" y="${groundY - 40}" width="8" height="40" fill="${C.muted}" opacity="0.7"/>`,
  ].join(''), 'Residential apartment tower silhouette');
};

const villas = () => {
  const groundY = VIEW_H - 40;
  // Single detached house with pitched roof, garden boundary.
  return wrapSvg([
    // Body
    `<rect x="380" y="${groundY - 240}" width="440" height="240" fill="${C.ink}"/>`,
    // Pitched roof (triangle)
    `<polygon points="370,${groundY - 240} 600,${groundY - 360} 830,${groundY - 240}" fill="${C.body}"/>`,
    // Roof accent ridge
    `<polygon points="370,${groundY - 240} 600,${groundY - 360} 830,${groundY - 240} 820,${groundY - 232} 600,${groundY - 348} 380,${groundY - 232}" fill="${C.accent}" opacity="0.9"/>`,
    // Door
    `<rect x="570" y="${groundY - 130}" width="60" height="130" fill="${C.accent}"/>`,
    // Windows
    `<rect x="430" y="${groundY - 180}" width="80" height="80" fill="${C.paper}"/>`,
    `<rect x="700" y="${groundY - 180}" width="80" height="80" fill="${C.paper}"/>`,
    // Window crossbars
    `<line x1="430" y1="${groundY - 140}" x2="510" y2="${groundY - 140}" stroke="${C.ink}" stroke-width="3"/>`,
    `<line x1="470" y1="${groundY - 180}" x2="470" y2="${groundY - 100}" stroke="${C.ink}" stroke-width="3"/>`,
    `<line x1="700" y1="${groundY - 140}" x2="780" y2="${groundY - 140}" stroke="${C.ink}" stroke-width="3"/>`,
    `<line x1="740" y1="${groundY - 180}" x2="740" y2="${groundY - 100}" stroke="${C.ink}" stroke-width="3"/>`,
    // Garden fence outline
    Array.from({ length: 9 }, (_, i) => {
      const x = 220 + i * 18;
      return `<rect x="${x}" y="${groundY - 70}" width="6" height="70" fill="${C.muted}"/>`;
    }).join(''),
    Array.from({ length: 9 }, (_, i) => {
      const x = 870 + i * 18;
      return `<rect x="${x}" y="${groundY - 70}" width="6" height="70" fill="${C.muted}"/>`;
    }).join(''),
    // Trees
    `<circle cx="120" cy="${groundY - 70}" r="50" fill="${C.muted}" opacity="0.5"/>`,
    `<rect x="115" y="${groundY - 70}" width="10" height="70" fill="${C.muted}" opacity="0.7"/>`,
    `<circle cx="1080" cy="${groundY - 80}" r="55" fill="${C.muted}" opacity="0.5"/>`,
    `<rect x="1075" y="${groundY - 80}" width="10" height="80" fill="${C.muted}" opacity="0.7"/>`,
  ].join(''), 'Detached villa silhouette');
};

const plottedDevelopment = () => {
  const groundY = VIEW_H - 40;
  // Top-down style isometric grid of plots with road network. Stylised.
  // Pseudo top-down — flat layout shown from a slight angle.
  return wrapSvg([
    // Master plot boundary
    `<rect x="120" y="120" width="960" height="400" fill="${C.paperSoft}" stroke="${C.ink}" stroke-width="3"/>`,
    // Road network (cross + perimeter)
    `<line x1="120" y1="320" x2="1080" y2="320" stroke="${C.muted}" stroke-width="14" opacity="0.7"/>`,
    `<line x1="600" y1="120" x2="600" y2="520" stroke="${C.muted}" stroke-width="14" opacity="0.7"/>`,
    // Plot grid lines
    Array.from({ length: 4 }, (_, i) => `<line x1="${240 + i * 120}" y1="120" x2="${240 + i * 120}" y2="320" stroke="${C.hairline}" stroke-width="1.5"/>`).join(''),
    Array.from({ length: 4 }, (_, i) => `<line x1="${600 + i * 120}" y1="320" x2="${600 + i * 120}" y2="520" stroke="${C.hairline}" stroke-width="1.5"/>`).join(''),
    Array.from({ length: 1 }, () => `<line x1="120" y1="220" x2="600" y2="220" stroke="${C.hairline}" stroke-width="1.5"/>`).join(''),
    `<line x1="600" y1="420" x2="1080" y2="420" stroke="${C.hairline}" stroke-width="1.5"/>`,
    // Sample house silhouettes on a few plots
    [[170, 140], [290, 140], [410, 140], [530, 140], [170, 240], [290, 240], [410, 240], [530, 240], [650, 340], [770, 340], [890, 340], [1010, 340], [650, 440], [770, 440]].map(([x, y]) => {
      const rectX = x + 12;
      const rectY = y + 30;
      return `<rect x="${rectX}" y="${rectY}" width="60" height="40" fill="${C.ink}"/>` +
             `<polygon points="${rectX},${rectY} ${rectX + 30},${rectY - 20} ${rectX + 60},${rectY}" fill="${C.body}"/>`;
    }).join(''),
    // Master-plan label
    `<rect x="900" y="150" width="160" height="50" fill="${C.accent}" opacity="0.9"/>`,
    `<text x="980" y="180" font-family="Calibri, Arial, sans-serif" font-weight="700" font-size="20" fill="${C.paper}" text-anchor="middle">PHASE 1</text>`,
  ].join(''), 'Plotted development master-plan layout');
};

const commercialOffice = () => {
  const groundY = VIEW_H - 40;
  // Tall glass-and-steel office tower with mirrored facade pattern.
  const towerX = 380;
  const towerW = 440;
  const towerH = 510;
  return wrapSvg([
    // Lobby/podium
    `<rect x="${towerX - 60}" y="${groundY - 80}" width="${towerW + 120}" height="80" fill="${C.body}"/>`,
    // Tower body
    `<rect x="${towerX}" y="${groundY - towerH}" width="${towerW}" height="${towerH}" fill="${C.ink}"/>`,
    // Vertical mullion stripes (glass facade)
    Array.from({ length: 9 }, (_, i) => `<line x1="${towerX + 20 + i * 50}" y1="${groundY - towerH + 30}" x2="${towerX + 20 + i * 50}" y2="${groundY - 100}" stroke="${C.paper}" stroke-width="2" opacity="0.55"/>`).join(''),
    // Horizontal floor lines (every ~50 px ≈ floor height)
    Array.from({ length: 11 }, (_, i) => `<line x1="${towerX}" y1="${groundY - towerH + 30 + i * 45}" x2="${towerX + towerW}" y2="${groundY - towerH + 30 + i * 45}" stroke="${C.paper}" stroke-width="1.4" opacity="0.4"/>`).join(''),
    // Crown / setback
    `<rect x="${towerX + 40}" y="${groundY - towerH - 30}" width="${towerW - 80}" height="30" fill="${C.body}"/>`,
    `<rect x="${towerX + 40}" y="${groundY - towerH - 36}" width="${towerW - 80}" height="6" fill="${C.accent}"/>`,
    // Lobby entrance (copper)
    `<rect x="${towerX + towerW / 2 - 50}" y="${groundY - 70}" width="100" height="70" fill="${C.accent}"/>`,
    `<rect x="${towerX + towerW / 2 - 50}" y="${groundY - 70}" width="100" height="6" fill="${C.paper}" opacity="0.7"/>`,
    // Flanking shorter mid-rise (left)
    `<rect x="160" y="${groundY - 240}" width="180" height="240" fill="${C.body}"/>`,
    Array.from({ length: 5 }, (_, i) => `<line x1="${175 + i * 35}" y1="${groundY - 220}" x2="${175 + i * 35}" y2="${groundY - 30}" stroke="${C.paper}" stroke-width="1.6" opacity="0.4"/>`).join(''),
    // Right neighbour
    `<rect x="860" y="${groundY - 200}" width="160" height="200" fill="${C.body}"/>`,
    Array.from({ length: 4 }, (_, i) => `<line x1="${875 + i * 35}" y1="${groundY - 180}" x2="${875 + i * 35}" y2="${groundY - 30}" stroke="${C.paper}" stroke-width="1.6" opacity="0.4"/>`).join(''),
  ].join(''), 'Commercial office tower silhouette');
};

const retail = () => {
  const groundY = VIEW_H - 40;
  // Storefront row with awnings and signage band.
  return wrapSvg([
    // Building body
    `<rect x="100" y="${groundY - 360}" width="1000" height="360" fill="${C.ink}"/>`,
    // Signage band
    `<rect x="100" y="${groundY - 360}" width="1000" height="60" fill="${C.accent}"/>`,
    // Storefront divisions (5 shops)
    Array.from({ length: 5 }, (_, i) => {
      const sx = 130 + i * 195;
      return [
        // Display window
        `<rect x="${sx}" y="${groundY - 220}" width="155" height="180" fill="${C.paper}"/>`,
        // Window crossbar
        `<line x1="${sx}" y1="${groundY - 130}" x2="${sx + 155}" y2="${groundY - 130}" stroke="${C.ink}" stroke-width="2"/>`,
        // Awning
        `<polygon points="${sx - 8},${groundY - 240} ${sx + 163},${groundY - 240} ${sx + 145},${groundY - 220} ${sx + 10},${groundY - 220}" fill="${C.body}"/>`,
        // Awning stripe
        Array.from({ length: 4 }, (_, k) => `<line x1="${sx + k * 38}" y1="${groundY - 240}" x2="${sx + 8 + k * 38}" y2="${groundY - 220}" stroke="${C.accent}" stroke-width="2"/>`).join(''),
        // Door
        `<rect x="${sx + 60}" y="${groundY - 100}" width="35" height="60" fill="${C.body}"/>`,
      ].join('');
    }).join(''),
    // Floor (above the display windows) — second-storey accent
    `<rect x="100" y="${groundY - 290}" width="1000" height="6" fill="${C.accent}" opacity="0.7"/>`,
    // Pedestrian silhouettes (foreground)
    `<circle cx="240" cy="${groundY - 30}" r="10" fill="${C.muted}"/>`,
    `<rect x="234" y="${groundY - 18}" width="12" height="20" fill="${C.muted}"/>`,
    `<circle cx="900" cy="${groundY - 30}" r="10" fill="${C.muted}"/>`,
    `<rect x="894" y="${groundY - 18}" width="12" height="20" fill="${C.muted}"/>`,
  ].join(''), 'Retail high-street silhouette');
};

const industrialWarehousing = () => {
  const groundY = VIEW_H - 40;
  // Long warehouse with saw-tooth roof, truck dock doors.
  return wrapSvg([
    // Main warehouse body
    `<rect x="120" y="${groundY - 280}" width="900" height="280" fill="${C.ink}"/>`,
    // Saw-tooth roof — 6 peaks
    Array.from({ length: 6 }, (_, i) => {
      const sx = 120 + i * 150;
      return `<polygon points="${sx},${groundY - 280} ${sx + 75},${groundY - 360} ${sx + 150},${groundY - 280}" fill="${C.body}"/>`;
    }).join(''),
    // Saw-tooth glazing strips (north-facing skylights)
    Array.from({ length: 6 }, (_, i) => {
      const sx = 120 + i * 150;
      return `<polygon points="${sx + 75},${groundY - 360} ${sx + 110},${groundY - 320} ${sx + 75},${groundY - 320}" fill="${C.paper}" opacity="0.85"/>`;
    }).join(''),
    // Top accent strip (parapet)
    `<rect x="120" y="${groundY - 280}" width="900" height="10" fill="${C.accent}"/>`,
    // Truck dock doors (5 doors)
    Array.from({ length: 5 }, (_, i) => {
      const sx = 200 + i * 160;
      return [
        `<rect x="${sx}" y="${groundY - 160}" width="120" height="160" fill="${C.body}"/>`,
        // Roller-shutter horizontal lines
        Array.from({ length: 8 }, (_, k) => `<line x1="${sx + 5}" y1="${groundY - 150 + k * 18}" x2="${sx + 115}" y2="${groundY - 150 + k * 18}" stroke="${C.muted}" stroke-width="1.4" opacity="0.7"/>`).join(''),
      ].join('');
    }).join(''),
    // Truck silhouette in foreground
    `<rect x="950" y="${groundY - 110}" width="180" height="60" fill="${C.body}"/>`,
    `<rect x="1010" y="${groundY - 140}" width="100" height="40" fill="${C.body}"/>`,
    `<circle cx="985" cy="${groundY - 50}" r="18" fill="${C.muted}"/>`,
    `<circle cx="1095" cy="${groundY - 50}" r="18" fill="${C.muted}"/>`,
    `<rect x="1015" y="${groundY - 130}" width="40" height="20" fill="${C.paper}" opacity="0.85"/>`,
  ].join(''), 'Grade-A warehouse silhouette');
};

const hospitality = () => {
  const groundY = VIEW_H - 40;
  // Mid-rise hotel with portico entrance + balconies.
  const hotelX = 320;
  const hotelW = 560;
  const hotelH = 400;
  return wrapSvg([
    // Portico (projecting entrance canopy)
    `<rect x="${hotelX + hotelW / 2 - 90}" y="${groundY - 90}" width="180" height="14" fill="${C.accent}"/>`,
    Array.from({ length: 4 }, (_, i) => {
      const cx = hotelX + hotelW / 2 - 80 + i * 50;
      return `<rect x="${cx}" y="${groundY - 90}" width="6" height="90" fill="${C.body}"/>`;
    }).join(''),
    // Hotel body
    `<rect x="${hotelX}" y="${groundY - hotelH}" width="${hotelW}" height="${hotelH}" fill="${C.ink}"/>`,
    // Top crown / pent
    `<rect x="${hotelX + 40}" y="${groundY - hotelH - 24}" width="${hotelW - 80}" height="24" fill="${C.body}"/>`,
    `<rect x="${hotelX + 40}" y="${groundY - hotelH - 30}" width="${hotelW - 80}" height="6" fill="${C.accent}"/>`,
    // Balcony grid (8 floors × 7 windows)
    Array.from({ length: 8 }, (_, r) => {
      return Array.from({ length: 7 }, (_, c) => {
        const wx = hotelX + 30 + c * 76;
        const wy = groundY - hotelH + 30 + r * 44;
        // Window
        return `<rect x="${wx}" y="${wy}" width="56" height="28" fill="${C.paper}" opacity="0.92"/>` +
               // Balcony rail
               `<rect x="${wx - 4}" y="${wy + 28}" width="64" height="4" fill="${C.accent}"/>`;
      }).join('');
    }).join(''),
    // Sign band on the body
    `<rect x="${hotelX}" y="${groundY - 120}" width="${hotelW}" height="30" fill="${C.accent}"/>`,
    `<text x="${hotelX + hotelW / 2}" y="${groundY - 99}" font-family="Calibri, Arial, sans-serif" font-weight="700" font-size="22" fill="${C.paper}" text-anchor="middle">HOTEL</text>`,
    // Foreground tree
    `<circle cx="180" cy="${groundY - 60}" r="42" fill="${C.muted}" opacity="0.5"/>`,
    `<rect x="174" y="${groundY - 60}" width="12" height="60" fill="${C.muted}" opacity="0.7"/>`,
  ].join(''), 'Hospitality hotel silhouette');
};

const mixedUse = () => {
  const groundY = VIEW_H - 40;
  // Tower with retail base + apartments above.
  const towerX = 400;
  const towerW = 400;
  const towerH = 480;
  return wrapSvg([
    // Tower body
    `<rect x="${towerX}" y="${groundY - towerH}" width="${towerW}" height="${towerH}" fill="${C.ink}"/>`,
    // Retail base — copper signage band
    `<rect x="${towerX - 40}" y="${groundY - 140}" width="${towerW + 80}" height="140" fill="${C.body}"/>`,
    `<rect x="${towerX - 40}" y="${groundY - 140}" width="${towerW + 80}" height="36" fill="${C.accent}"/>`,
    // Storefront windows (3 large panes)
    Array.from({ length: 3 }, (_, i) => {
      const sx = towerX - 25 + i * 156;
      return `<rect x="${sx}" y="${groundY - 90}" width="135" height="80" fill="${C.paper}" opacity="0.92"/>`;
    }).join(''),
    // Apartment window grid above (7 floors × 5 windows)
    Array.from({ length: 7 }, (_, r) => {
      return Array.from({ length: 5 }, (_, c) => {
        const wx = towerX + 28 + c * 75;
        const wy = groundY - towerH + 60 + r * 44;
        return `<rect x="${wx}" y="${wy}" width="48" height="28" fill="${C.paper}" opacity="0.9"/>`;
      }).join('');
    }).join(''),
    // Crown
    `<rect x="${towerX + 50}" y="${groundY - towerH - 24}" width="${towerW - 100}" height="24" fill="${C.body}"/>`,
    `<rect x="${towerX + 50}" y="${groundY - towerH - 30}" width="${towerW - 100}" height="6" fill="${C.accent}"/>`,
    // Adjacent retail block
    `<rect x="100" y="${groundY - 180}" width="240" height="180" fill="${C.body}"/>`,
    `<rect x="100" y="${groundY - 180}" width="240" height="22" fill="${C.accent}"/>`,
    `<rect x="118" y="${groundY - 130}" width="200" height="100" fill="${C.paper}" opacity="0.92"/>`,
    // Right plaza tree
    `<circle cx="900" cy="${groundY - 60}" r="38" fill="${C.muted}" opacity="0.5"/>`,
    `<rect x="894" y="${groundY - 60}" width="12" height="60" fill="${C.muted}" opacity="0.7"/>`,
  ].join(''), 'Mixed-use tower silhouette');
};

const rawLand = () => {
  const groundY = VIEW_H - 40;
  // Empty plot with surveyor markers, boundary lines, distant treeline.
  return wrapSvg([
    // Horizon — distant tree-line band
    `<rect x="0" y="${groundY - 90}" width="${VIEW_W}" height="50" fill="${C.muted}" opacity="0.32"/>`,
    Array.from({ length: 30 }, (_, i) => `<circle cx="${i * 40 + 20}" cy="${groundY - 90}" r="20" fill="${C.muted}" opacity="0.45"/>`).join(''),
    // Plot boundary (dashed survey rectangle)
    `<rect x="200" y="200" width="800" height="320" fill="none" stroke="${C.ink}" stroke-width="3" stroke-dasharray="14,8"/>`,
    // Corner survey pegs
    [[200, 200], [1000, 200], [200, 520], [1000, 520]].map(([cx, cy]) => `<rect x="${cx - 8}" y="${cy - 8}" width="16" height="16" fill="${C.accent}"/>`).join(''),
    // Internal boundary tags
    `<rect x="400" y="${groundY - 80}" width="36" height="60" fill="${C.body}"/>`,
    `<polygon points="400,${groundY - 80} 436,${groundY - 80} 418,${groundY - 100}" fill="${C.accent}"/>`,
    `<rect x="780" y="${groundY - 100}" width="36" height="80" fill="${C.body}"/>`,
    `<polygon points="780,${groundY - 100} 816,${groundY - 100} 798,${groundY - 120}" fill="${C.accent}"/>`,
    // Compass / north arrow
    `<polygon points="1080,140 1100,180 1090,170 1080,200 1070,170 1060,180" fill="${C.ink}"/>`,
    `<text x="1080" y="125" font-family="Calibri, Arial, sans-serif" font-weight="700" font-size="20" fill="${C.muted}" text-anchor="middle">N</text>`,
    // "RAW LAND" floating label
    `<rect x="500" y="320" width="200" height="44" fill="${C.accent}" opacity="0.95"/>`,
    `<text x="600" y="350" font-family="Calibri, Arial, sans-serif" font-weight="700" font-size="22" fill="${C.paper}" text-anchor="middle">FOR DEVELOPMENT</text>`,
  ].join(''), 'Raw land plot survey diagram');
};

const redevelopment = () => {
  const groundY = VIEW_H - 40;
  // Existing aged building + construction crane lifting new mass.
  return wrapSvg([
    // Existing low-rise (left) — visibly older
    `<rect x="120" y="${groundY - 280}" width="320" height="280" fill="${C.body}"/>`,
    Array.from({ length: 6 }, (_, r) => Array.from({ length: 4 }, (_, c) => {
      const wx = 140 + c * 75;
      const wy = groundY - 270 + r * 42;
      return `<rect x="${wx}" y="${wy}" width="50" height="22" fill="${C.paper}" opacity="0.6"/>`;
    }).join('')).join(''),
    // Demolition / scaffolding overlay
    Array.from({ length: 7 }, (_, i) => `<line x1="120" y1="${groundY - 270 + i * 38}" x2="440" y2="${groundY - 270 + i * 38}" stroke="${C.accent}" stroke-width="1.5" opacity="0.6"/>`).join(''),
    // New tower under construction (right)
    `<rect x="540" y="${groundY - 360}" width="280" height="360" fill="${C.ink}"/>`,
    Array.from({ length: 9 }, (_, r) => Array.from({ length: 4 }, (_, c) => {
      const wx = 562 + c * 65;
      const wy = groundY - 350 + r * 38;
      return `<rect x="${wx}" y="${wy}" width="44" height="22" fill="${C.paper}" opacity="0.85"/>`;
    }).join('')).join(''),
    // Top floors still bare structure
    `<rect x="540" y="${groundY - 460}" width="280" height="100" fill="${C.body}" opacity="0.6"/>`,
    Array.from({ length: 4 }, (_, i) => `<line x1="540" y1="${groundY - 450 + i * 25}" x2="820" y2="${groundY - 450 + i * 25}" stroke="${C.accent}" stroke-width="2" opacity="0.7"/>`).join(''),
    // Construction crane (vertical mast + horizontal jib)
    `<rect x="888" y="${groundY - 520}" width="14" height="520" fill="${C.ink}"/>`,
    `<rect x="900" y="${groundY - 520}" width="220" height="14" fill="${C.ink}"/>`,
    `<rect x="820" y="${groundY - 520}" width="68" height="14" fill="${C.ink}"/>`,
    // Crane cabin
    `<rect x="880" y="${groundY - 500}" width="28" height="28" fill="${C.accent}"/>`,
    // Suspended cable + load
    `<line x1="1080" y1="${groundY - 506}" x2="1080" y2="${groundY - 280}" stroke="${C.ink}" stroke-width="2"/>`,
    `<rect x="1056" y="${groundY - 290}" width="48" height="36" fill="${C.body}"/>`,
  ].join(''), 'Redevelopment with construction crane');
};

// ─── Asset class lookup ─────────────────────────────────────────────────────

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
