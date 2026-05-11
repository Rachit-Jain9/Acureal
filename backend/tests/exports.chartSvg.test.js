'use strict';

const {
  renderCapitalStackDonutSvg,
  renderCashFlowTrendSvg,
  renderTornadoSvg,
  FALLBACK_PNG_BUFFER,
} = require('../src/services/exports/shared/chartSvg.service');

describe('services/exports/shared/chartSvg', () => {
  describe('renderCapitalStackDonutSvg', () => {
    test('renders an SVG with debt + equity slices when both > 0', () => {
      const svg = renderCapitalStackDonutSvg({ debtCr: 110, equityCr: 331 });
      expect(svg).toMatch(/^<svg /);
      expect(svg).toMatch(/<\/svg>$/);
      // Two arc paths (debt + equity)
      const arcCount = (svg.match(/<path /g) || []).length;
      expect(arcCount).toBeGreaterThanOrEqual(2);
      // Debt is ~25%, equity ~75%
      expect(svg).toMatch(/Debt\s+25%/);
      expect(svg).toMatch(/Equity\s+75%/);
      // Total in donut centre
      expect(svg).toMatch(/INR 441/);
    });

    test('renders empty-state SVG when both inputs are 0 / null', () => {
      const svg = renderCapitalStackDonutSvg({ debtCr: 0, equityCr: 0 });
      expect(svg).toMatch(/^<svg /);
      expect(svg).toMatch(/will populate/);
    });

    test('renders 100% debt when equity is 0', () => {
      const svg = renderCapitalStackDonutSvg({ debtCr: 200, equityCr: 0 });
      expect(svg).toMatch(/Debt\s+100%/);
      expect(svg).toMatch(/Equity\s+0%/);
    });
  });

  describe('renderCashFlowTrendSvg', () => {
    test('renders column bars + cumulative line when at least 2 rows', () => {
      const svg = renderCashFlowTrendSvg({
        rows: [
          { label: 'Q1', net: -50, cumulative: -50 },
          { label: 'Q2', net: 30, cumulative: -20 },
          { label: 'Q3', net: 60, cumulative: 40 },
        ],
      });
      expect(svg).toMatch(/^<svg /);
      // Column rects for net + circles for cumulative dots
      const rectCount = (svg.match(/<rect /g) || []).length;
      expect(rectCount).toBeGreaterThanOrEqual(4); // 1 background + 3 columns
      const circleCount = (svg.match(/<circle /g) || []).length;
      expect(circleCount).toBe(3); // one per row
      // Cumulative line path
      expect(svg).toMatch(/<path d="M /);
    });

    test('renders empty-state when fewer than 2 rows', () => {
      const svg = renderCashFlowTrendSvg({ rows: [{ label: 'Q1', net: 10, cumulative: 10 }] });
      expect(svg).toMatch(/will populate/);
    });

    test('uses the title argument verbatim', () => {
      const svg = renderCashFlowTrendSvg({
        rows: [{ label: 'Q1', net: 10, cumulative: 10 }, { label: 'Q2', net: 20, cumulative: 30 }],
        title: 'Custom Title',
      });
      expect(svg).toMatch(/Custom Title/);
    });
  });

  describe('renderTornadoSvg', () => {
    test('renders bars + base IRR axis when drivers + base provided', () => {
      const svg = renderTornadoSvg({
        baseIrr: 14.3,
        drivers: [
          { label: 'Selling Rate', low: 12.7, high: 16.0 },
          { label: 'Construction Cost', low: 12.8, high: 15.9 },
        ],
      });
      expect(svg).toMatch(/^<svg /);
      // Driver labels rendered
      expect(svg).toMatch(/Selling Rate/);
      expect(svg).toMatch(/Construction Cost/);
      // Base IRR rendered
      expect(svg).toMatch(/Base IRR 14\.3%/);
      // At least 4 driver bars (2 drivers × low+high)
      const rectCount = (svg.match(/<rect /g) || []).length;
      expect(rectCount).toBeGreaterThanOrEqual(4);
    });

    test('drivers sorted by absolute IRR range (biggest first)', () => {
      // Driver A range = 20 (10..30), Driver B range = 4 (12..16)
      const svg = renderTornadoSvg({
        baseIrr: 20,
        drivers: [
          { label: 'Small Driver', low: 18, high: 22 },
          { label: 'Big Driver', low: 10, high: 30 },
        ],
      });
      // Big Driver should appear first (higher Y position in SVG = earlier in source)
      const bigIdx = svg.indexOf('Big Driver');
      const smallIdx = svg.indexOf('Small Driver');
      expect(bigIdx).toBeLessThan(smallIdx);
    });

    test('renders empty-state when no valid drivers', () => {
      const svg = renderTornadoSvg({ baseIrr: 15, drivers: [] });
      expect(svg).toMatch(/will populate/);
    });

    test('renders empty-state when base IRR is null', () => {
      const svg = renderTornadoSvg({
        baseIrr: null,
        drivers: [{ label: 'X', low: 1, high: 2 }],
      });
      expect(svg).toMatch(/will populate/);
    });
  });

  describe('FALLBACK_PNG_BUFFER', () => {
    test('is a valid PNG buffer (signature 89 50 4E 47)', () => {
      expect(Buffer.isBuffer(FALLBACK_PNG_BUFFER)).toBe(true);
      expect(FALLBACK_PNG_BUFFER.slice(0, 4).toString('hex')).toBe('89504e47');
    });
  });
});
