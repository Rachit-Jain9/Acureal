'use strict';

/**
 * Per-asset-class cover artwork rendered with pptxgenjs **native shape
 * primitives** (rect, ellipse, line, polygon). No SVG embedding — every
 * shape is a first-class PowerPoint object, fully editable, and there
 * is no risk of the deck triggering PowerPoint's "found a problem with
 * content" recovery dialog from a fragile SVG image embed.
 *
 * Each renderer paints one composition into a bounding box (x, y, w, h)
 * sized in inches. Compositions vary per asset class:
 *
 *   - residential_apartments: warm-sky skyline, central tower + flanks,
 *     window grid with a few lit windows, foreground trees.
 *   - villas: low warm sky, detached house with pitched roof, garden
 *     fence, side trees.
 *   - plotted_development: cream paper background, master-plan grid
 *     with roads + plot squares, "PHASE 1" callout.
 *   - commercial_office: pale morning sky, glass-and-steel tower with
 *     mullion stripes, copper lobby, plaza pedestrians.
 *   - retail: twilight sky, storefront row with awnings, copper
 *     signage band, warm lit display windows.
 *   - industrial_warehousing: dusty dusk sky, low warehouse with
 *     saw-tooth roof, truck dock doors, foreground truck silhouette.
 *   - hospitality: deep evening sky, hotel with portico entrance and
 *     balcony grid mostly lit, signage band.
 *   - mixed_use: twilight sky, tower with retail base + apartment
 *     window grid above.
 *   - raw_land: warm horizon, dashed plot boundary with corner pegs,
 *     sign post + compass rose.
 *   - redevelopment: dawn sky, existing aged building (left) +
 *     under-construction tower (right) + simple crane silhouette.
 *
 * All colour values come from the deck's COLORS palette (palette tokens
 * via shared/palette.js). No hex literals appear here except the small
 * set of mood variants used purely for atmospheric tonality.
 */

const { COLORS } = require('./_helpers');

const FONT = 'Calibri';

// Atmospheric tonality variants used only for sky / ground gradients.
// Documented inline so it's clear which tokens are palette-scoped vs
// scene-specific atmospheric variants.
const MOOD = {
  // Residential — golden hour
  residentialSkyTop:    '1B2842',  // pre-dusk navy
  residentialSkyMid:    'A86B3D',  // copper haze
  residentialSkyHaze:   'F2D2A1',  // warm horizon
  // Villas — dawn
  villasSkyTop:         '7B9DB8',
  villasSkyMid:         'D4B499',
  villasSkyHaze:        'F2DDC3',
  // Commercial — clean morning
  commercialSkyTop:     '9CB4C9',
  commercialSkyMid:     'D8E2EC',
  // Retail — twilight night
  retailSkyTop:         '0E1B2C',
  retailSkyMid:         '1F2D45',
  // Industrial — dusty dusk
  industrialSkyTop:     '2A2C3A',
  industrialSkyMid:     '796B5A',
  industrialSkyHaze:    'C29770',
  // Hospitality — warm evening
  hospitalitySkyTop:    '241936',
  hospitalitySkyMid:    '5B324A',
  // Mixed-use — twilight
  mixedSkyTop:          '0E1B2C',
  mixedSkyMid:          '3F4664',
  // Raw land — golden land
  landSkyTop:           '8FA9C0',
  landSkyMid:           'E5C99A',
  landGround:           '9C7647',
  // Redevelopment — dawn
  redevSkyTop:          '7B9DB8',
  redevSkyMid:          'D4B499',
  // Window glow palette
  warmGlow:             'FFD089',
  // Truck / lit floor
  litFloor:             'F4B26E',
};

/**
 * Helper — fill a horizontal stack of three colour bands inside a rect
 * to simulate a sky gradient using pptxgenjs primitives. Each band is a
 * rect with no border. Adequately approximates a gradient at the cover
 * size; a true pptxgenjs gradient fill exists but is patchy across
 * client renderers.
 */
const drawSkyBands = (pptx, slide, { x, y, w, h, top, mid, bottom }) => {
  const h1 = h * 0.42;
  const h2 = h * 0.32;
  const h3 = h - h1 - h2;
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w, h: h1, fill: { color: top }, line: { color: top, pt: 0 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x, y: y + h1, w, h: h2, fill: { color: mid }, line: { color: mid, pt: 0 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x, y: y + h1 + h2, w, h: h3, fill: { color: bottom }, line: { color: bottom, pt: 0 },
  });
};

const drawGroundStrip = (pptx, slide, { x, y, w, h, color, accentLine }) => {
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w, h, fill: { color }, line: { color, pt: 0 },
  });
  if (accentLine) {
    slide.addShape(pptx.ShapeType.line, {
      x, y, w, h: 0,
      line: { color: accentLine, pt: 1 },
    });
  }
};

/**
 * Helper — draw a tower body + window grid. Returns nothing; mutates the
 * slide. Windows use lit/dim variation based on a stable PRNG keyed
 * off coordinates.
 */
const drawTower = (pptx, slide, { x, y, w, h, cols, rows, body, lit, dim, litRatio = 0.4, crown }) => {
  // Body
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w, h,
    fill: { color: body },
    line: { color: body, pt: 0 },
  });
  // Crown strip
  if (crown) {
    slide.addShape(pptx.ShapeType.rect, {
      x, y, w, h: 0.04,
      fill: { color: crown }, line: { color: crown, pt: 0 },
    });
  }
  // Window grid
  const padX = 0.08;
  const padY = 0.12;
  const cellW = (w - padX * 2) / cols;
  const cellH = (h - padY * 2) / rows;
  const winW = cellW * 0.6;
  const winH = cellH * 0.55;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const wx = x + padX + c * cellW + (cellW - winW) / 2;
      const wy = y + padY + r * cellH + (cellH - winH) / 2;
      const seed = (Math.sin(x * 13 + r * 31 + c * 7) + 1) / 2;
      const isLit = seed < litRatio;
      slide.addShape(pptx.ShapeType.rect, {
        x: wx, y: wy, w: winW, h: winH,
        fill: { color: isLit ? lit : dim, transparency: isLit ? 5 : 45 },
        line: { color: isLit ? lit : dim, pt: 0 },
      });
    }
  }
};

const drawTreeSilhouette = (pptx, slide, cx, yBase, radius = 0.18, color = COLORS.plum) => {
  const trunkH = radius * 0.6;
  slide.addShape(pptx.ShapeType.ellipse, {
    x: cx - radius, y: yBase - radius * 2 - trunkH, w: radius * 2, h: radius * 2,
    fill: { color }, line: { color, pt: 0 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: cx - 0.04, y: yBase - trunkH, w: 0.08, h: trunkH,
    fill: { color }, line: { color, pt: 0 },
  });
};

// ─── Per-class scene composers ──────────────────────────────────────────────

const residentialApartments = (pptx, slide, { x, y, w, h }) => {
  const skyH = h * 0.62;
  const groundY = y + skyH;
  // Sky
  drawSkyBands(pptx, slide, {
    x, y, w, h: skyH,
    top: MOOD.residentialSkyTop,
    mid: MOOD.residentialSkyMid,
    bottom: MOOD.residentialSkyHaze,
  });
  // Ground
  drawGroundStrip(pptx, slide, {
    x, y: groundY, w, h: h - skyH, color: COLORS.plum, accentLine: COLORS.muted,
  });
  // Hero central tower
  const heroX = x + w * 0.35;
  const heroW = w * 0.30;
  const heroH = h * 0.62;
  drawTower(pptx, slide, {
    x: heroX, y: groundY - heroH, w: heroW, h: heroH,
    cols: 5, rows: 14,
    body: COLORS.plum,
    lit: MOOD.warmGlow, dim: COLORS.charcoal,
    litRatio: 0.42, crown: COLORS.plumSoft,
  });
  // Left flanking tower
  const flankW = w * 0.18;
  drawTower(pptx, slide, {
    x: heroX - flankW - 0.08, y: groundY - heroH * 0.65, w: flankW, h: heroH * 0.65,
    cols: 3, rows: 10,
    body: COLORS.charcoal,
    lit: MOOD.warmGlow, dim: COLORS.plum,
    litRatio: 0.30, crown: COLORS.plumSoft,
  });
  // Right flanking tower (slightly shorter)
  drawTower(pptx, slide, {
    x: heroX + heroW + 0.08, y: groundY - heroH * 0.78, w: flankW, h: heroH * 0.78,
    cols: 3, rows: 11,
    body: COLORS.charcoal,
    lit: MOOD.warmGlow, dim: COLORS.plum,
    litRatio: 0.36, crown: COLORS.plumSoft,
  });
  // Foreground trees
  drawTreeSilhouette(pptx, slide, x + 0.3, groundY, 0.20, COLORS.plum);
  drawTreeSilhouette(pptx, slide, x + w - 0.3, groundY, 0.18, COLORS.plum);
};

const villas = (pptx, slide, { x, y, w, h }) => {
  const skyH = h * 0.55;
  const groundY = y + skyH;
  drawSkyBands(pptx, slide, {
    x, y, w, h: skyH,
    top: MOOD.villasSkyTop, mid: MOOD.villasSkyMid, bottom: MOOD.villasSkyHaze,
  });
  drawGroundStrip(pptx, slide, {
    x, y: groundY, w, h: h - skyH, color: '23362E', accentLine: COLORS.muted,
  });
  // Villa body
  const houseX = x + w * 0.25;
  const houseW = w * 0.50;
  const houseH = h * 0.32;
  slide.addShape(pptx.ShapeType.rect, {
    x: houseX, y: groundY - houseH, w: houseW, h: houseH,
    fill: { color: COLORS.plum }, line: { color: COLORS.plum, pt: 0 },
  });
  // Pitched roof — triangle isosceles
  slide.addShape(pptx.ShapeType.triangle, {
    x: houseX - 0.05, y: groundY - houseH - h * 0.18,
    w: houseW + 0.1, h: h * 0.18,
    fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
  });
  // Roof copper trim
  slide.addShape(pptx.ShapeType.rect, {
    x: houseX - 0.05, y: groundY - houseH - 0.04,
    w: houseW + 0.1, h: 0.04,
    fill: { color: COLORS.plumSoft }, line: { color: COLORS.plumSoft, pt: 0 },
  });
  // Door
  slide.addShape(pptx.ShapeType.rect, {
    x: houseX + houseW / 2 - 0.12, y: groundY - houseH * 0.6, w: 0.24, h: houseH * 0.6,
    fill: { color: COLORS.plumSoft }, line: { color: COLORS.plumSoft, pt: 0 },
  });
  // Windows (2)
  [0.18, houseW - 0.42].forEach((dx) => {
    slide.addShape(pptx.ShapeType.rect, {
      x: houseX + dx, y: groundY - houseH * 0.75, w: 0.24, h: houseH * 0.4,
      fill: { color: MOOD.warmGlow, transparency: 5 }, line: { color: MOOD.warmGlow, pt: 0 },
    });
  });
  // Garden fence (10 posts left, 10 right)
  for (let i = 0; i < 10; i += 1) {
    slide.addShape(pptx.ShapeType.rect, {
      x: x + 0.1 + i * 0.06, y: groundY - 0.16, w: 0.02, h: 0.16,
      fill: { color: COLORS.plum }, line: { color: COLORS.plum, pt: 0 },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: x + w - 0.7 + i * 0.06, y: groundY - 0.16, w: 0.02, h: 0.16,
      fill: { color: COLORS.plum }, line: { color: COLORS.plum, pt: 0 },
    });
  }
  // Trees
  drawTreeSilhouette(pptx, slide, x + 0.5, groundY, 0.22, COLORS.plum);
  drawTreeSilhouette(pptx, slide, x + w - 0.5, groundY, 0.22, COLORS.plum);
};

const commercialOffice = (pptx, slide, { x, y, w, h }) => {
  const skyH = h * 0.60;
  const groundY = y + skyH;
  drawSkyBands(pptx, slide, {
    x, y, w, h: skyH,
    top: MOOD.commercialSkyTop, mid: MOOD.commercialSkyMid, bottom: COLORS.paper,
  });
  drawGroundStrip(pptx, slide, {
    x, y: groundY, w, h: h - skyH, color: COLORS.charcoal, accentLine: COLORS.muted,
  });
  // Hero glass tower
  const heroX = x + w * 0.30;
  const heroW = w * 0.35;
  const heroH = h * 0.78;
  slide.addShape(pptx.ShapeType.rect, {
    x: heroX, y: groundY - heroH, w: heroW, h: heroH,
    fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
  });
  // Vertical mullion stripes
  for (let i = 1; i < 7; i += 1) {
    slide.addShape(pptx.ShapeType.line, {
      x: heroX + (heroW / 7) * i, y: groundY - heroH + 0.1,
      w: 0, h: heroH - 0.2,
      line: { color: COLORS.paper, pt: 1, transparency: 60 },
    });
  }
  // Horizontal floor lines
  for (let i = 1; i < 14; i += 1) {
    slide.addShape(pptx.ShapeType.line, {
      x: heroX + 0.04, y: groundY - heroH + (heroH / 14) * i,
      w: heroW - 0.08, h: 0,
      line: { color: COLORS.paper, pt: 0.6, transparency: 75 },
    });
  }
  // Crown setback
  slide.addShape(pptx.ShapeType.rect, {
    x: heroX + 0.08, y: groundY - heroH - 0.06, w: heroW - 0.16, h: 0.06,
    fill: { color: COLORS.plumSoft }, line: { color: COLORS.plumSoft, pt: 0 },
  });
  // Lobby (copper entrance)
  slide.addShape(pptx.ShapeType.rect, {
    x: heroX + heroW / 2 - 0.18, y: groundY - 0.3, w: 0.36, h: 0.3,
    fill: { color: COLORS.plumSoft }, line: { color: COLORS.plumSoft, pt: 0 },
  });
  // Adjacent shorter buildings
  const adjW = w * 0.16;
  slide.addShape(pptx.ShapeType.rect, {
    x: x + 0.2, y: groundY - heroH * 0.45, w: adjW, h: heroH * 0.45,
    fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: heroX + heroW + 0.1, y: groundY - heroH * 0.40, w: adjW, h: heroH * 0.40,
    fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
  });
};

const retail = (pptx, slide, { x, y, w, h }) => {
  const skyH = h * 0.45;
  const groundY = y + skyH;
  drawSkyBands(pptx, slide, {
    x, y, w, h: skyH,
    top: MOOD.retailSkyTop, mid: MOOD.retailSkyMid, bottom: MOOD.retailSkyMid,
  });
  drawGroundStrip(pptx, slide, {
    x, y: groundY, w, h: h - skyH, color: COLORS.plum, accentLine: COLORS.muted,
  });
  // Storefront row body
  const rowY = groundY - h * 0.50;
  slide.addShape(pptx.ShapeType.rect, {
    x: x + 0.1, y: rowY, w: w - 0.2, h: h * 0.50,
    fill: { color: COLORS.plum }, line: { color: COLORS.plum, pt: 0 },
  });
  // Signage band — copper
  slide.addShape(pptx.ShapeType.rect, {
    x: x + 0.1, y: rowY, w: w - 0.2, h: 0.20,
    fill: { color: COLORS.plumSoft }, line: { color: COLORS.plumSoft, pt: 0 },
  });
  // Display windows (5 shops with warm glow)
  const shopW = (w - 0.4) / 5;
  for (let i = 0; i < 5; i += 1) {
    const sx = x + 0.2 + i * shopW;
    slide.addShape(pptx.ShapeType.rect, {
      x: sx + 0.04, y: groundY - h * 0.28, w: shopW - 0.08, h: h * 0.18,
      fill: { color: MOOD.warmGlow, transparency: 8 }, line: { color: MOOD.warmGlow, pt: 0 },
    });
    // Awning triangle
    slide.addShape(pptx.ShapeType.triangle, {
      x: sx + 0.04, y: groundY - h * 0.32, w: shopW - 0.08, h: 0.06,
      fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
    });
    // Door
    slide.addShape(pptx.ShapeType.rect, {
      x: sx + shopW / 2 - 0.05, y: groundY - h * 0.10, w: 0.10, h: h * 0.10,
      fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
    });
  }
};

const industrialWarehousing = (pptx, slide, { x, y, w, h }) => {
  const skyH = h * 0.55;
  const groundY = y + skyH;
  drawSkyBands(pptx, slide, {
    x, y, w, h: skyH,
    top: MOOD.industrialSkyTop, mid: MOOD.industrialSkyMid, bottom: MOOD.industrialSkyHaze,
  });
  drawGroundStrip(pptx, slide, {
    x, y: groundY, w, h: h - skyH, color: '1F1813', accentLine: COLORS.muted,
  });
  // Warehouse body
  const warehouseW = w * 0.78;
  const warehouseH = h * 0.32;
  const warehouseX = x + (w - warehouseW) / 2;
  slide.addShape(pptx.ShapeType.rect, {
    x: warehouseX, y: groundY - warehouseH, w: warehouseW, h: warehouseH,
    fill: { color: COLORS.plum }, line: { color: COLORS.plum, pt: 0 },
  });
  // Saw-tooth roof — 5 triangle peaks
  const peakW = warehouseW / 5;
  for (let i = 0; i < 5; i += 1) {
    slide.addShape(pptx.ShapeType.triangle, {
      x: warehouseX + i * peakW, y: groundY - warehouseH - 0.2,
      w: peakW, h: 0.2,
      fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
    });
    // Skylight glow on each peak
    slide.addShape(pptx.ShapeType.rect, {
      x: warehouseX + i * peakW + peakW * 0.5, y: groundY - warehouseH - 0.06,
      w: peakW * 0.3, h: 0.06,
      fill: { color: MOOD.litFloor, transparency: 20 }, line: { color: MOOD.litFloor, pt: 0 },
    });
  }
  // Top accent strip (parapet)
  slide.addShape(pptx.ShapeType.rect, {
    x: warehouseX, y: groundY - warehouseH - 0.04, w: warehouseW, h: 0.04,
    fill: { color: COLORS.plumSoft }, line: { color: COLORS.plumSoft, pt: 0 },
  });
  // Truck dock doors (5)
  const doorW = warehouseW / 6;
  for (let i = 0; i < 5; i += 1) {
    slide.addShape(pptx.ShapeType.rect, {
      x: warehouseX + doorW * 0.5 + i * doorW, y: groundY - warehouseH * 0.55,
      w: doorW * 0.85, h: warehouseH * 0.55,
      fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
    });
  }
  // Truck silhouette
  slide.addShape(pptx.ShapeType.rect, {
    x: warehouseX + warehouseW - 0.6, y: groundY - 0.36, w: 0.6, h: 0.20,
    fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: warehouseX + warehouseW - 0.32, y: groundY - 0.48, w: 0.32, h: 0.12,
    fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: warehouseX + warehouseW - 0.55, y: groundY - 0.20, w: 0.10, h: 0.10,
    fill: { color: COLORS.muted }, line: { color: COLORS.muted, pt: 0 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: warehouseX + warehouseW - 0.18, y: groundY - 0.20, w: 0.10, h: 0.10,
    fill: { color: COLORS.muted }, line: { color: COLORS.muted, pt: 0 },
  });
  // Headlight glow
  slide.addShape(pptx.ShapeType.rect, {
    x: warehouseX + warehouseW - 0.30, y: groundY - 0.46, w: 0.18, h: 0.08,
    fill: { color: MOOD.warmGlow, transparency: 15 }, line: { color: MOOD.warmGlow, pt: 0 },
  });
};

const hospitality = (pptx, slide, { x, y, w, h }) => {
  const skyH = h * 0.45;
  const groundY = y + skyH;
  drawSkyBands(pptx, slide, {
    x, y, w, h: skyH,
    top: MOOD.hospitalitySkyTop, mid: MOOD.hospitalitySkyMid, bottom: MOOD.industrialSkyHaze,
  });
  drawGroundStrip(pptx, slide, {
    x, y: groundY, w, h: h - skyH, color: '170E0E', accentLine: COLORS.muted,
  });
  // Hotel body
  const hotelW = w * 0.55;
  const hotelH = h * 0.55;
  const hotelX = x + (w - hotelW) / 2;
  drawTower(pptx, slide, {
    x: hotelX, y: groundY - hotelH, w: hotelW, h: hotelH,
    cols: 7, rows: 10,
    body: COLORS.plum,
    lit: MOOD.warmGlow, dim: COLORS.charcoal,
    litRatio: 0.65, crown: COLORS.plumSoft,
  });
  // Sign band
  slide.addShape(pptx.ShapeType.rect, {
    x: hotelX, y: groundY - 0.30, w: hotelW, h: 0.10,
    fill: { color: COLORS.plumSoft }, line: { color: COLORS.plumSoft, pt: 0 },
  });
  slide.addText('HOTEL', {
    x: hotelX, y: groundY - 0.30, w: hotelW, h: 0.10,
    fontFace: FONT, fontSize: 11, bold: true, color: COLORS.paper,
    align: 'center', valign: 'mid', charSpace: 3,
  });
  // Portico entrance
  slide.addShape(pptx.ShapeType.rect, {
    x: hotelX + hotelW / 2 - 0.18, y: groundY - 0.18, w: 0.36, h: 0.05,
    fill: { color: COLORS.plumSoft }, line: { color: COLORS.plumSoft, pt: 0 },
  });
  // Portico columns (4)
  for (let i = 0; i < 4; i += 1) {
    slide.addShape(pptx.ShapeType.rect, {
      x: hotelX + hotelW / 2 - 0.15 + i * 0.10, y: groundY - 0.18,
      w: 0.02, h: 0.18,
      fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
    });
  }
};

const mixedUse = (pptx, slide, { x, y, w, h }) => {
  const skyH = h * 0.50;
  const groundY = y + skyH;
  drawSkyBands(pptx, slide, {
    x, y, w, h: skyH,
    top: MOOD.mixedSkyTop, mid: MOOD.mixedSkyMid, bottom: MOOD.industrialSkyHaze,
  });
  drawGroundStrip(pptx, slide, {
    x, y: groundY, w, h: h - skyH, color: COLORS.plum, accentLine: COLORS.muted,
  });
  // Apartment tower body
  const towerX = x + w * 0.30;
  const towerW = w * 0.40;
  const towerH = h * 0.55;
  drawTower(pptx, slide, {
    x: towerX, y: groundY - towerH - 0.30, w: towerW, h: towerH,
    cols: 6, rows: 12,
    body: COLORS.plum,
    lit: MOOD.warmGlow, dim: COLORS.charcoal,
    litRatio: 0.55, crown: COLORS.plumSoft,
  });
  // Retail base — wider
  const retailX = towerX - 0.12;
  const retailW = towerW + 0.24;
  slide.addShape(pptx.ShapeType.rect, {
    x: retailX, y: groundY - 0.30, w: retailW, h: 0.30,
    fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
  });
  // Signage band on retail
  slide.addShape(pptx.ShapeType.rect, {
    x: retailX, y: groundY - 0.30, w: retailW, h: 0.08,
    fill: { color: COLORS.plumSoft }, line: { color: COLORS.plumSoft, pt: 0 },
  });
  // Storefront windows (3)
  for (let i = 0; i < 3; i += 1) {
    slide.addShape(pptx.ShapeType.rect, {
      x: retailX + 0.05 + i * (retailW / 3), y: groundY - 0.18,
      w: retailW / 3 - 0.10, h: 0.16,
      fill: { color: MOOD.warmGlow, transparency: 8 }, line: { color: MOOD.warmGlow, pt: 0 },
    });
  }
  // Adjacent low-rise (left)
  slide.addShape(pptx.ShapeType.rect, {
    x: x + 0.1, y: groundY - 0.42, w: w * 0.18, h: 0.42,
    fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
  });
};

const plottedDevelopment = (pptx, slide, { x, y, w, h }) => {
  // Top-down master-plan look — paper background.
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w, h,
    fill: { color: COLORS.paper }, line: { color: COLORS.paper, pt: 0 },
  });
  // Sun
  slide.addShape(pptx.ShapeType.ellipse, {
    x: x + w * 0.78, y: y + h * 0.10, w: 0.5, h: 0.5,
    fill: { color: MOOD.warmGlow, transparency: 10 }, line: { color: MOOD.warmGlow, pt: 0 },
  });
  // Master plot boundary — dashed
  const plotX = x + w * 0.10;
  const plotY = y + h * 0.25;
  const plotW = w * 0.80;
  const plotH = h * 0.60;
  slide.addShape(pptx.ShapeType.rect, {
    x: plotX, y: plotY, w: plotW, h: plotH,
    fill: { color: COLORS.sand }, line: { color: COLORS.plum, pt: 1.5, dashType: 'dash' },
  });
  // Roads (cross + perimeter) — dark muted
  slide.addShape(pptx.ShapeType.rect, {
    x: plotX, y: plotY + plotH / 2 - 0.06, w: plotW, h: 0.12,
    fill: { color: COLORS.muted }, line: { color: COLORS.muted, pt: 0 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: plotX + plotW / 2 - 0.06, y: plotY, w: 0.12, h: plotH,
    fill: { color: COLORS.muted }, line: { color: COLORS.muted, pt: 0 },
  });
  // Sample house silhouettes on a few plots
  const houseSpots = [
    [plotX + 0.15, plotY + 0.10], [plotX + 0.55, plotY + 0.10], [plotX + 0.95, plotY + 0.10],
    [plotX + 0.15, plotY + 0.40], [plotX + 0.55, plotY + 0.40], [plotX + 0.95, plotY + 0.40],
    [plotX + 1.55, plotY + 0.65], [plotX + 1.95, plotY + 0.65], [plotX + 2.35, plotY + 0.65],
    [plotX + 1.55, plotY + 0.95], [plotX + 1.95, plotY + 0.95], [plotX + 2.35, plotY + 0.95],
  ];
  houseSpots.forEach(([hx, hy]) => {
    if (hx + 0.3 > plotX + plotW || hy + 0.2 > plotY + plotH) return;
    slide.addShape(pptx.ShapeType.rect, {
      x: hx, y: hy + 0.1, w: 0.3, h: 0.18,
      fill: { color: COLORS.plum }, line: { color: COLORS.plum, pt: 0 },
    });
    slide.addShape(pptx.ShapeType.triangle, {
      x: hx, y: hy, w: 0.3, h: 0.10,
      fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
    });
  });
  // Phase callout
  slide.addShape(pptx.ShapeType.rect, {
    x: plotX + plotW - 1.2, y: plotY + 0.18, w: 1.0, h: 0.4,
    fill: { color: COLORS.plum }, line: { color: COLORS.plum, pt: 0 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: plotX + plotW - 1.2, y: plotY + 0.18, w: 1.0, h: 0.04,
    fill: { color: COLORS.plumSoft }, line: { color: COLORS.plumSoft, pt: 0 },
  });
  slide.addText('PHASE 1', {
    x: plotX + plotW - 1.2, y: plotY + 0.22, w: 1.0, h: 0.36,
    fontFace: FONT, fontSize: 14, bold: true, color: COLORS.paper, align: 'center', valign: 'mid', charSpace: 1.6,
  });
};

const rawLand = (pptx, slide, { x, y, w, h }) => {
  const skyH = h * 0.45;
  const groundY = y + skyH;
  drawSkyBands(pptx, slide, {
    x, y, w, h: skyH,
    top: MOOD.landSkyTop, mid: MOOD.landSkyMid, bottom: MOOD.industrialSkyHaze,
  });
  // Sun
  slide.addShape(pptx.ShapeType.ellipse, {
    x: x + w * 0.70, y: y + h * 0.15, w: 0.6, h: 0.6,
    fill: { color: 'F4D389', transparency: 10 }, line: { color: 'F4D389', pt: 0 },
  });
  // Distant mountain layer (using triangle)
  slide.addShape(pptx.ShapeType.triangle, {
    x: x + w * 0.2, y: groundY - 0.6, w: w * 0.6, h: 0.6,
    fill: { color: COLORS.charcoal, transparency: 40 }, line: { color: COLORS.charcoal, pt: 0 },
  });
  // Ground (warm)
  drawGroundStrip(pptx, slide, {
    x, y: groundY, w, h: h - skyH, color: MOOD.landGround, accentLine: COLORS.muted,
  });
  // Plot boundary — dashed
  slide.addShape(pptx.ShapeType.rect, {
    x: x + 0.3, y: groundY + 0.2, w: w - 0.6, h: h - skyH - 0.4,
    fill: { color: '9C7647', transparency: 35 },
    line: { color: COLORS.plum, pt: 1.5, dashType: 'dash' },
  });
  // Corner pegs
  [[x + 0.3, groundY + 0.2], [x + w - 0.4, groundY + 0.2], [x + 0.3, y + h - 0.3], [x + w - 0.4, y + h - 0.3]]
    .forEach(([cx, cy]) => {
      slide.addShape(pptx.ShapeType.rect, {
        x: cx - 0.05, y: cy - 0.05, w: 0.1, h: 0.1,
        fill: { color: COLORS.plumSoft }, line: { color: COLORS.plumSoft, pt: 0 },
      });
    });
  // Sign post
  slide.addShape(pptx.ShapeType.rect, {
    x: x + w / 2 - 0.5, y: groundY + (h - skyH) * 0.45, w: 1.0, h: 0.5,
    fill: { color: COLORS.plum }, line: { color: COLORS.plum, pt: 0 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: x + w / 2 - 0.5, y: groundY + (h - skyH) * 0.45, w: 1.0, h: 0.05,
    fill: { color: COLORS.plumSoft }, line: { color: COLORS.plumSoft, pt: 0 },
  });
  slide.addText('FOR\nDEVELOPMENT', {
    x: x + w / 2 - 0.5, y: groundY + (h - skyH) * 0.46, w: 1.0, h: 0.46,
    fontFace: FONT, fontSize: 9, bold: true, color: COLORS.paper, align: 'center', valign: 'mid',
  });
};

const redevelopment = (pptx, slide, { x, y, w, h }) => {
  const skyH = h * 0.55;
  const groundY = y + skyH;
  drawSkyBands(pptx, slide, {
    x, y, w, h: skyH,
    top: MOOD.redevSkyTop, mid: MOOD.redevSkyMid, bottom: MOOD.villasSkyHaze,
  });
  drawGroundStrip(pptx, slide, {
    x, y: groundY, w, h: h - skyH, color: COLORS.charcoal, accentLine: COLORS.muted,
  });
  // Existing aged building (left)
  const existX = x + w * 0.10;
  const existW = w * 0.30;
  const existH = h * 0.42;
  slide.addShape(pptx.ShapeType.rect, {
    x: existX, y: groundY - existH, w: existW, h: existH,
    fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
  });
  // Scaffolding overlay (horizontal lines)
  for (let i = 1; i < 8; i += 1) {
    slide.addShape(pptx.ShapeType.line, {
      x: existX, y: groundY - existH + (existH / 8) * i,
      w: existW, h: 0,
      line: { color: COLORS.plumSoft, pt: 0.6, transparency: 35 },
    });
  }
  // New tower under construction (right)
  const newX = x + w * 0.50;
  const newW = w * 0.30;
  const newH = h * 0.65;
  drawTower(pptx, slide, {
    x: newX, y: groundY - newH, w: newW, h: newH,
    cols: 4, rows: 12,
    body: COLORS.plum,
    lit: MOOD.warmGlow, dim: COLORS.charcoal,
    litRatio: 0.18, crown: '',
  });
  // Top floors bare structure
  slide.addShape(pptx.ShapeType.rect, {
    x: newX, y: groundY - newH - 0.2, w: newW, h: 0.2,
    fill: { color: COLORS.charcoal, transparency: 30 }, line: { color: COLORS.charcoal, pt: 0 },
  });
  // Crane (vertical mast)
  const craneX = x + w * 0.85;
  slide.addShape(pptx.ShapeType.rect, {
    x: craneX, y: y + 0.05, w: 0.04, h: groundY - y - 0.05,
    fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
  });
  // Crane jib (horizontal arm)
  slide.addShape(pptx.ShapeType.rect, {
    x: craneX - w * 0.18, y: y + 0.05, w: w * 0.20, h: 0.04,
    fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
  });
  // Crane cabin
  slide.addShape(pptx.ShapeType.rect, {
    x: craneX - 0.08, y: y + 0.10, w: 0.10, h: 0.10,
    fill: { color: COLORS.plumSoft }, line: { color: COLORS.plumSoft, pt: 0 },
  });
  // Suspended load
  slide.addShape(pptx.ShapeType.line, {
    x: craneX - w * 0.10, y: y + 0.05, w: 0, h: groundY - y - 1.5,
    line: { color: COLORS.charcoal, pt: 1 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: craneX - w * 0.10 - 0.08, y: groundY - 1.7, w: 0.18, h: 0.12,
    fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
  });
  // Hoarding at front
  slide.addShape(pptx.ShapeType.rect, {
    x, y: groundY - 0.10, w, h: 0.10,
    fill: { color: COLORS.charcoal }, line: { color: COLORS.charcoal, pt: 0 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x, y: groundY - 0.10, w, h: 0.02,
    fill: { color: COLORS.plumSoft }, line: { color: COLORS.plumSoft, pt: 0 },
  });
};

// ─── Lookup ─────────────────────────────────────────────────────────────────

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
 * Draw the asset-class cover artwork into the given bounding box using
 * pptxgenjs native shape primitives. Falls back to residential when the
 * class is unknown so the cover always has a meaningful visual.
 *
 * @param {Object} pptx     PptxGenJS instance
 * @param {Object} slide    PptxGenJS slide instance
 * @param {string} assetClass
 * @param {Object} bbox     { x, y, w, h } in inches
 */
const drawAssetClassCover = (pptx, slide, assetClass, bbox) => {
  const renderer = RENDERERS[assetClass] || residentialApartments;
  try {
    renderer(pptx, slide, bbox);
  } catch (err) {
    // Never let a draw failure crash the whole deck. Fall back to a
    // simple placeholder so the cover still renders.
    // eslint-disable-next-line no-console
    console.warn('[coverArtwork] renderer failed for', assetClass, err.message);
    slide.addShape(pptx.ShapeType.rect, {
      x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h,
      fill: { color: COLORS.mist }, line: { color: COLORS.line, pt: 0.6 },
    });
  }
};

module.exports = {
  drawAssetClassCover,
  RENDERERS,
};
