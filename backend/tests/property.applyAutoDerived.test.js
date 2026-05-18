'use strict';

// Mocked unit tests for property.service.applyAutoDerivedContext.
// We mock the DB query layer so the service's SQL generation is
// exercised without touching Postgres.

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../src/config/database');
const propertyService = require('../src/services/property.service');

const stubProperty = {
  id: 'prop-uuid-1',
  organization_id: 'org-1',
  name: 'Test Property',
  city: 'Bengaluru',
};

beforeEach(() => {
  jest.resetAllMocks();
  // Default: getPropertyById returns the stub; the UPDATE returns the
  // updated row. The service issues these in sequence.
  query.mockImplementation((sql) => {
    if (/SELECT/i.test(sql) && /FROM properties/i.test(sql)) {
      return Promise.resolve({ rows: [stubProperty] });
    }
    if (/UPDATE properties/i.test(sql)) {
      return Promise.resolve({ rows: [{ ...stubProperty, auto_derived_at: new Date().toISOString() }] });
    }
    return Promise.resolve({ rows: [] });
  });
});

describe('property.service.applyAutoDerivedContext', () => {
  test('writes coordinates to BOTH lat/lng (editable) and auto_derived_lat/lng', async () => {
    await propertyService.applyAutoDerivedContext(
      'prop-uuid-1',
      { picks: { coordinates: { lat: 12.97, lng: 77.6 } } },
      'user-1',
    );

    const updateCall = query.mock.calls.find(([sql]) => /UPDATE properties/.test(sql));
    expect(updateCall).toBeDefined();
    const [sql, params] = updateCall;
    expect(sql).toMatch(/auto_derived_lat = /);
    expect(sql).toMatch(/auto_derived_lng = /);
    expect(sql).toMatch(/lat = /);
    expect(sql).toMatch(/lng = /);
    expect(params).toContain(12.97);
    expect(params).toContain(77.6);
  });

  test('writes BBMP zone + guidance bandwidth to auto_derived_* columns', async () => {
    await propertyService.applyAutoDerivedContext(
      'prop-uuid-1',
      {
        picks: {
          bbmp_zone: {
            zone_code: 'A',
            guidance_value_band_min_inr: 35000,
            guidance_value_band_max_inr: 50000,
          },
        },
      },
      'user-1',
    );

    const updateCall = query.mock.calls.find(([sql]) => /UPDATE properties/.test(sql));
    const [sql, params] = updateCall;
    expect(sql).toMatch(/auto_derived_zone_code = /);
    expect(sql).toMatch(/auto_derived_guidance_min_inr = /);
    expect(sql).toMatch(/auto_derived_guidance_max_inr = /);
    expect(params).toContain('A');
    expect(params).toContain(35000);
    expect(params).toContain(50000);
  });

  test('writes ward, PD code+name, taluk, village when picked', async () => {
    await propertyService.applyAutoDerivedContext(
      'prop-uuid-1',
      {
        picks: {
          ward: { ward_no: 117 },
          planning_district: { pd_code: 'PD-01', pd_name: 'Central Business District' },
          kgis_hierarchy: { taluk: 'Bangalore South', village: 'Begur' },
        },
      },
      'user-1',
    );

    const updateCall = query.mock.calls.find(([sql]) => /UPDATE properties/.test(sql));
    const [sql, params] = updateCall;
    expect(sql).toMatch(/auto_derived_ward_no = /);
    expect(sql).toMatch(/auto_derived_pd_code = /);
    expect(sql).toMatch(/auto_derived_pd_name = /);
    expect(sql).toMatch(/auto_derived_taluk = /);
    expect(sql).toMatch(/auto_derived_village = /);
    expect(params).toContain(117);
    expect(params).toContain('PD-01');
    expect(params).toContain('Central Business District');
    expect(params).toContain('Bangalore South');
    expect(params).toContain('Begur');
  });

  test('always writes auto_derived_at and auto_derived_by', async () => {
    await propertyService.applyAutoDerivedContext(
      'prop-uuid-1',
      { picks: {} },
      'user-1',
    );

    const updateCall = query.mock.calls.find(([sql]) => /UPDATE properties/.test(sql));
    const [sql, params] = updateCall;
    expect(sql).toMatch(/auto_derived_at = NOW\(\)/);
    expect(sql).toMatch(/auto_derived_by = /);
    expect(params).toContain('user-1');
  });

  test('persists a slimmed derivedSource as JSONB when provided', async () => {
    const source = {
      coordinates: { lat: 12.97, lng: 77.6, source: 'google' },
      bbmpJurisdiction: { withinBbmp: true },
      bbmpZone: { zone_code: 'A' },
      planningDistrict: { pd_code: 'PD-01' },
      kgis: { hierarchy: { taluk: 'X' }, status: 'matched', confidence: 0.65 },
      applicableWarnings: [
        { kind: 'Heritage', fact_type: 'heritage', fact_key: 'heritage_zones', severity: 'high', item_count: 12 },
      ],
      derivedAt: '2026-05-18T00:00:00Z',
      elapsedMs: 1500,
    };
    await propertyService.applyAutoDerivedContext(
      'prop-uuid-1',
      { picks: { coordinates: { lat: 12.97, lng: 77.6 } }, derivedSource: source },
      'user-1',
    );

    const updateCall = query.mock.calls.find(([sql]) => /UPDATE properties/.test(sql));
    const [sql, params] = updateCall;
    expect(sql).toMatch(/auto_derived_source = /);
    // The JSONB column is stringified once before push.
    const sourceParam = params.find((p) => typeof p === 'string' && p.includes('"bbmpJurisdiction"'));
    expect(sourceParam).toBeDefined();
    const parsed = JSON.parse(sourceParam);
    expect(parsed.bbmpJurisdiction.withinBbmp).toBe(true);
    expect(parsed.applicableWarnings).toHaveLength(1);
  });

  test('throws 404 when the property does not exist', async () => {
    // getPropertyById returns no rows.
    query.mockImplementation((sql) => {
      if (/SELECT/i.test(sql) && /FROM properties/i.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(
      propertyService.applyAutoDerivedContext('missing', { picks: {} }, 'user-1'),
    ).rejects.toMatchObject({ message: expect.stringMatching(/not found/i) });
  });

  test('does not set lat/lng on properties row when coordinates lat is null', async () => {
    await propertyService.applyAutoDerivedContext(
      'prop-uuid-1',
      { picks: { coordinates: { lat: null, lng: null } } },
      'user-1',
    );

    const updateCall = query.mock.calls.find(([sql]) => /UPDATE properties/.test(sql));
    const [sql] = updateCall;
    // auto_derived_lat/lng still get set (to null), but the editable
    // lat/lng columns must NOT be touched.
    expect(sql).toMatch(/auto_derived_lat = /);
    // Just `lat = $N` (not in a CASE clause from elsewhere)
    expect(sql).not.toMatch(/(?<!auto_derived_)lat = /);
  });
});
