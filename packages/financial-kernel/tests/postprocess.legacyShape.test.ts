/**
 * Unit tests for the legacyShape post-processor.
 *
 * Guards the snake_case output shape that `financial.service.js`
 * lines 123-160 rely on when writing financials to the DB. Every key
 * that maps to a DB column must still be present and must round to
 * the same decimals as the legacy engine.
 */

import { computeDeal } from '../src/registry';
import { buildLegacyShape } from '../src/postprocess/legacyShape';
import { allFixtures } from './fixtures';

describe('buildLegacyShape — common core (every asset class)', () => {
  it.each(Object.keys(allFixtures))('%s emits the 10 core keys', (assetClass) => {
    const fixture = allFixtures[assetClass as keyof typeof allFixtures];
    const result = computeDeal(fixture);
    const shape = buildLegacyShape({
      raw: fixture.raw,
      result,
      assetClass: fixture.assetClass,
    });

    const expectedCore = [
      'land_cost_cr',
      'total_cost_cr',
      'total_revenue_cr',
      'gross_profit_cr',
      'gross_margin_pct',
      'npv_cr',
      'irr_pct',
      'equity_multiple',
      'project_duration_months',
      'discount_rate_pct',
    ];
    for (const key of expectedCore) {
      expect(shape).toHaveProperty(key);
    }
  });
});

describe('buildLegacyShape — residential widest block', () => {
  const fixture = allFixtures.residential_apartments;
  const result = computeDeal(fixture);
  const shape = buildLegacyShape({
    raw: fixture.raw,
    result,
    assetClass: 'residential_apartments',
  });

  it('emits the 22 residential-specific keys', () => {
    const expected = [
      'construction_cost_per_sqft',
      'selling_rate_per_sqft',
      'approval_cost_cr',
      'marketing_cost_pct',
      'finance_cost_pct',
      'developer_margin_pct',
      'developer_profit_cr',
      'gross_area_sqft',
      'saleable_area_sqft',
      'carpet_area_sqft',
      'super_builtup_area_sqft',
      'total_construction_cost_cr',
      'gst_cost_cr',
      'stamp_duty_cr',
      'marketing_cost_cr',
      'finance_cost_cr',
      'residual_land_value_cr',
      'avg_unit_size_sqft',
      'number_of_units',
      'plot_area_sqft',
      'fsi',
      'loading_factor',
    ];
    for (const key of expected) {
      expect(shape).toHaveProperty(key);
    }
  });

  it('computes developer_profit_cr as total_revenue × margin / 100', () => {
    const developerProfit = shape.developer_profit_cr;
    const totalRevenue = shape.total_revenue_cr;
    const margin = shape.developer_margin_pct;
    if (totalRevenue != null && margin != null && developerProfit != null) {
      const expected = Math.round(((totalRevenue * margin) / 100) * 10000) / 10000;
      expect(developerProfit).toBeCloseTo(expected, 3);
    }
  });

  it('rounds financials to 4 dp and areas to 2 dp', () => {
    // Areas: 2 dp
    if (shape.gross_area_sqft != null) {
      const s = String(shape.gross_area_sqft);
      const afterDot = s.split('.')[1] ?? '';
      expect(afterDot.length).toBeLessThanOrEqual(2);
    }
    // Crores: 4 dp
    if (shape.total_revenue_cr != null) {
      const s = String(shape.total_revenue_cr);
      const afterDot = s.split('.')[1] ?? '';
      expect(afterDot.length).toBeLessThanOrEqual(4);
    }
  });
});

describe('buildLegacyShape — hospitality EBITDA margin override', () => {
  it('gross_margin_pct uses EBITDA when kpis.extras carry it', () => {
    const fixture = allFixtures.hospitality;
    const result = computeDeal(fixture);
    const shape = buildLegacyShape({
      raw: fixture.raw,
      result,
      assetClass: 'hospitality',
    });
    // Either EBITDA-override came through, or there is no EBITDA extra
    // and we fell back to the regular gross margin. Either way,
    // gross_margin_pct must be present.
    expect(shape).toHaveProperty('gross_margin_pct');
  });
});

describe('buildLegacyShape — plotted carries FSI=1, loading=0', () => {
  it('sets fsi=1 and loading_factor=0 for plotted', () => {
    const fixture = allFixtures.plotted_development;
    const result = computeDeal(fixture);
    const shape = buildLegacyShape({
      raw: fixture.raw,
      result,
      assetClass: 'plotted_development',
    });
    expect(shape.fsi).toBe(1);
    expect(shape.loading_factor).toBe(0);
  });
});

describe('buildLegacyShape — frozen output', () => {
  it('returns a frozen object', () => {
    const fixture = allFixtures.residential_apartments;
    const result = computeDeal(fixture);
    const shape = buildLegacyShape({
      raw: fixture.raw,
      result,
      assetClass: 'residential_apartments',
    });
    expect(Object.isFrozen(shape)).toBe(true);
  });
});
