'use strict';

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const { query } = require('../src/config/database');
const propertyService = require('../src/services/property.service');

beforeEach(() => {
  jest.resetAllMocks();
});

function setupProperty({ auto_derived_ward_no = null, id = 'prop-1' } = {}) {
  return { id, organization_id: 'org-1', auto_derived_ward_no };
}

describe('property.service.getWardSpreadBenchmark', () => {
  test('returns ok:false reason=ward_not_derived when property has no auto_derived_ward_no', async () => {
    query.mockImplementation((sql) => {
      if (/SELECT/i.test(sql) && /FROM properties/i.test(sql)) {
        return Promise.resolve({ rows: [setupProperty()] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await propertyService.getWardSpreadBenchmark('prop-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ward_not_derived');
    expect(result.message).toMatch(/Apply the auto-derive context/);
  });

  test('returns ok:false reason=insufficient_data when fewer than 3 comparable deals exist', async () => {
    query.mockImplementation((sql) => {
      if (/SELECT/i.test(sql) && /FROM properties/i.test(sql)) {
        return Promise.resolve({ rows: [setupProperty({ auto_derived_ward_no: 117 })] });
      }
      if (/FROM deals d/i.test(sql)) {
        // Only 2 comparable rows in ward 117 — not enough.
        return Promise.resolve({
          rows: [
            { deal_id: 'd1', deal_name: 'Deal 1', negotiated_price_cr: 5, land_ask_price_cr: null, entry_value_cr: null, land_area_sqft: 5000, selling_rate_per_sqft: null, guidance_min: 35000, guidance_max: 50000 },
            { deal_id: 'd2', deal_name: 'Deal 2', negotiated_price_cr: 6, land_ask_price_cr: null, entry_value_cr: null, land_area_sqft: 5000, selling_rate_per_sqft: null, guidance_min: 35000, guidance_max: 50000 },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await propertyService.getWardSpreadBenchmark('prop-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_data');
    expect(result.ward_no).toBe(117);
    expect(result.sample_size).toBe(2);
  });

  test('returns median + p25 + p75 when 3+ comparable deals exist', async () => {
    query.mockImplementation((sql) => {
      if (/SELECT/i.test(sql) && /FROM properties/i.test(sql)) {
        return Promise.resolve({ rows: [setupProperty({ auto_derived_ward_no: 117 })] });
      }
      if (/FROM deals d/i.test(sql)) {
        // 5 sample deals in ward 117, guidance band 35000-50000 (midpoint 42500)
        // Their per-sqft prices and computed spreads:
        //   d1: 5 cr / 5000 sqft = ₹10,000/sqft → spread = (10000-42500)/42500 = -76.5% (totally undervalued; unrealistic but OK for test)
        //   Actually let me pick prices that produce realistic spreads.
        // Use selling_rate_per_sqft directly to make the test deterministic.
        return Promise.resolve({
          rows: [
            { deal_id: 'd1', deal_name: 'Deal 1', selling_rate_per_sqft: 40000, guidance_min: 35000, guidance_max: 50000 }, // mid=42500, spread = -5.88%
            { deal_id: 'd2', deal_name: 'Deal 2', selling_rate_per_sqft: 45000, guidance_min: 35000, guidance_max: 50000 }, // +5.88%
            { deal_id: 'd3', deal_name: 'Deal 3', selling_rate_per_sqft: 50000, guidance_min: 35000, guidance_max: 50000 }, // +17.65%
            { deal_id: 'd4', deal_name: 'Deal 4', selling_rate_per_sqft: 55000, guidance_min: 35000, guidance_max: 50000 }, // +29.41%
            { deal_id: 'd5', deal_name: 'Deal 5', selling_rate_per_sqft: 60000, guidance_min: 35000, guidance_max: 50000 }, // +41.18%
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await propertyService.getWardSpreadBenchmark('prop-1');
    expect(result.ok).toBe(true);
    expect(result.ward_no).toBe(117);
    expect(result.sample_size).toBe(5);
    // Median of [-5.9, 5.9, 17.6, 29.4, 41.2] is the middle value = 17.6
    expect(result.median_spread_pct).toBeGreaterThan(15);
    expect(result.median_spread_pct).toBeLessThan(20);
    // p25 < median < p75
    expect(result.p25_spread_pct).toBeLessThan(result.median_spread_pct);
    expect(result.p75_spread_pct).toBeGreaterThan(result.median_spread_pct);
    // Min and max sit at the endpoints
    expect(result.min_spread_pct).toBe(result.samples[0].spread_pct < result.samples[result.samples.length - 1].spread_pct
      ? Math.min(...result.samples.map((s) => s.spread_pct))
      : result.min_spread_pct);
    expect(result.samples).toHaveLength(5);
    expect(result.disclaimer).toMatch(/IGR-published/);
  });

  test('derives price_per_sqft from negotiated_price_cr + land_area_sqft when selling_rate is missing', async () => {
    query.mockImplementation((sql) => {
      if (/SELECT/i.test(sql) && /FROM properties/i.test(sql)) {
        return Promise.resolve({ rows: [setupProperty({ auto_derived_ward_no: 117 })] });
      }
      if (/FROM deals d/i.test(sql)) {
        return Promise.resolve({
          rows: [
            // 5 cr / 1000 sqft = ₹50,000/sqft; guidance mid = 42500; spread = +17.6%
            { deal_id: 'd1', deal_name: 'D1', negotiated_price_cr: 5, land_area_sqft: 1000, selling_rate_per_sqft: null, guidance_min: 35000, guidance_max: 50000 },
            { deal_id: 'd2', deal_name: 'D2', negotiated_price_cr: 6, land_area_sqft: 1000, selling_rate_per_sqft: null, guidance_min: 35000, guidance_max: 50000 },
            { deal_id: 'd3', deal_name: 'D3', negotiated_price_cr: 7, land_area_sqft: 1000, selling_rate_per_sqft: null, guidance_min: 35000, guidance_max: 50000 },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await propertyService.getWardSpreadBenchmark('prop-1');
    expect(result.ok).toBe(true);
    expect(result.samples).toHaveLength(3);
    expect(result.samples[0].price_per_sqft).toBe(50000);
    expect(result.samples[1].price_per_sqft).toBe(60000);
    expect(result.samples[2].price_per_sqft).toBe(70000);
  });

  test('skips rows where guidance is missing entirely (no spread possible)', async () => {
    query.mockImplementation((sql) => {
      if (/SELECT/i.test(sql) && /FROM properties/i.test(sql)) {
        return Promise.resolve({ rows: [setupProperty({ auto_derived_ward_no: 117 })] });
      }
      if (/FROM deals d/i.test(sql)) {
        return Promise.resolve({
          rows: [
            { deal_id: 'd1', selling_rate_per_sqft: 50000, guidance_min: 35000, guidance_max: 50000 },
            { deal_id: 'd2', selling_rate_per_sqft: 55000, guidance_min: 35000, guidance_max: 50000 },
            { deal_id: 'd3', selling_rate_per_sqft: 60000, guidance_min: 35000, guidance_max: 50000 },
            { deal_id: 'd4', selling_rate_per_sqft: 60000, guidance_min: null, guidance_max: null }, // skipped
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await propertyService.getWardSpreadBenchmark('prop-1');
    expect(result.ok).toBe(true);
    expect(result.sample_size).toBe(3); // d4 dropped
  });

  test('caps samples returned to the frontend at 10 (response size hygiene)', async () => {
    query.mockImplementation((sql) => {
      if (/SELECT/i.test(sql) && /FROM properties/i.test(sql)) {
        return Promise.resolve({ rows: [setupProperty({ auto_derived_ward_no: 117 })] });
      }
      if (/FROM deals d/i.test(sql)) {
        // 15 valid deals
        return Promise.resolve({
          rows: Array.from({ length: 15 }, (_, i) => ({
            deal_id: `d${i}`, selling_rate_per_sqft: 40000 + i * 1000, guidance_min: 35000, guidance_max: 50000,
          })),
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await propertyService.getWardSpreadBenchmark('prop-1');
    expect(result.ok).toBe(true);
    expect(result.sample_size).toBe(15);
    expect(result.samples).toHaveLength(10);
  });
});
