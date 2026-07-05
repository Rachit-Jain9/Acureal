jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../src/config/database');
const {
  resolveStatutoryPlan,
  logJurisdictionResolution,
} = require('../src/services/regulatory/resolveStatutoryPlan');

// Mirrors the row shape returned by loadAuthoritiesWithOperativePlan's SQL.
const REGISTRY_ROWS = [
  {
    authority_id: 'auth-bda',
    authority_code: 'BDA',
    authority_name: 'Bangalore Development Authority',
    authority_kind: 'lpa',
    authority_status: 'active',
    status_note: 'BDA transition note',
    taluk_aliases: ['bangalore north', 'bangalore south', 'bengaluru', 'bangalore'],
    plan_id: 'plan-rmp2015',
    plan_code: 'RMP_2015',
    plan_name: 'Revised Master Plan 2015 — Volume III (Zoning of Land Use and Regulations)',
    plan_legal_status: 'operative',
    plan_version_label: 'base-2007',
    plan_notes: null,
  },
  {
    authority_id: 'auth-anekal',
    authority_code: 'ANEKAL_PA',
    authority_name: 'Anekal Planning Authority',
    authority_kind: 'lpa',
    authority_status: 'active',
    status_note: 'Anekal LPA under BMRDA',
    taluk_aliases: ['anekal'],
    plan_id: 'plan-anekal',
    plan_code: 'ANEKAL_LPA_MP_2031',
    plan_name: 'Anekal Local Planning Area — Master Plan 2031 (BMRDA)',
    plan_legal_status: 'operative',
    plan_version_label: 'base-2014',
    plan_notes: null,
  },
  {
    authority_id: 'auth-biaapa',
    authority_code: 'BIAAPA',
    authority_name: 'Bengaluru International Airport Area Planning Authority',
    authority_kind: 'lpa',
    authority_status: 'active',
    status_note: 'BIAAPA airport belt under BMRDA',
    taluk_aliases: ['devanahalli'],
    plan_id: 'plan-biaapa',
    plan_code: 'BIAAPA_MP_2021',
    plan_name: 'BIAAPA Master Plan 2021 — Zoning of Land Use and Regulations',
    plan_legal_status: 'operative',
    plan_version_label: 'base-2009',
    plan_notes: null,
  },
  {
    authority_id: 'auth-hoskote',
    authority_code: 'HOSKOTE_PA',
    authority_name: 'Hoskote Planning Authority',
    authority_kind: 'lpa',
    authority_status: 'active',
    status_note: 'Hoskote LPA under BMRDA',
    taluk_aliases: ['hoskote'],
    plan_id: 'plan-hoskote',
    plan_code: 'HOSKOTE_LPA_MP_2031',
    plan_name: 'Hoskote LPA Master Plan 2031 (Provisional)',
    plan_legal_status: 'operative',
    plan_version_label: 'provisional-2031',
    plan_notes: null,
  },
];

describe('resolveStatutoryPlan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    query.mockResolvedValue({ rows: REGISTRY_ROWS });
  });

  test('routes an Anekal taluk to the Anekal Planning Authority + Anekal LPA MP 2031', async () => {
    const res = await resolveStatutoryPlan({ taluk: 'Anekal', village: 'Jigani' });
    expect(res.resolved).toBe(true);
    expect(res.authority.code).toBe('ANEKAL_PA');
    expect(res.plan.code).toBe('ANEKAL_LPA_MP_2031');
    expect(res.method).toBe('taluk_alias');
    expect(res.confidence).toBeGreaterThanOrEqual(0.85);
    expect(res.needs_authority_confirmation).toBe(false);
  });

  test('routes a Devanahalli taluk to BIAAPA + BIAAPA MP 2021 (airport belt)', async () => {
    const res = await resolveStatutoryPlan({ taluk: 'Devanahalli' });
    expect(res.resolved).toBe(true);
    expect(res.authority.code).toBe('BIAAPA');
    expect(res.plan.code).toBe('BIAAPA_MP_2021');
    expect(res.method).toBe('taluk_alias');
    expect(res.confidence).toBeGreaterThanOrEqual(0.85);
    expect(res.needs_authority_confirmation).toBe(false);
  });

  test('routes a Hoskote taluk to Hoskote PA + Hoskote LPA MP 2031 (east belt)', async () => {
    const res = await resolveStatutoryPlan({ taluk: 'Hoskote' });
    expect(res.resolved).toBe(true);
    expect(res.authority.code).toBe('HOSKOTE_PA');
    expect(res.plan.code).toBe('HOSKOTE_LPA_MP_2031');
    expect(res.method).toBe('taluk_alias');
    expect(res.confidence).toBeGreaterThanOrEqual(0.85);
  });

  test('routes a BDA taluk to BDA + RMP 2015', async () => {
    const res = await resolveStatutoryPlan({ taluk: 'Bangalore South' });
    expect(res.authority.code).toBe('BDA');
    expect(res.plan.code).toBe('RMP_2015');
    expect(res.method).toBe('taluk_alias');
  });

  test('matching is case-insensitive and trims whitespace', async () => {
    const res = await resolveStatutoryPlan({ taluk: '  ANEKAL  ' });
    expect(res.authority.code).toBe('ANEKAL_PA');
  });

  test('falls back to a village-alias match when taluk is absent', async () => {
    const res = await resolveStatutoryPlan({ taluk: null, village: 'Anekal' });
    expect(res.authority.code).toBe('ANEKAL_PA');
    expect(res.method).toBe('village_alias');
    expect(res.confidence).toBeLessThan(0.85);
  });

  test('an unknown taluk defaults to BDA but flags needs_authority_confirmation', async () => {
    const res = await resolveStatutoryPlan({ taluk: 'Hosakote' });
    expect(res.authority.code).toBe('BDA');
    expect(res.method).toBe('default_bda');
    expect(res.needs_authority_confirmation).toBe(true);
    expect(res.confidence).toBeLessThan(0.5);
    expect(res.alternates.map((a) => a.code)).toContain('ANEKAL_PA');
  });

  test('no hierarchy at all defaults to BDA with the lowest confidence + confirmation flag', async () => {
    const res = await resolveStatutoryPlan({});
    expect(res.authority.code).toBe('BDA');
    expect(res.method).toBe('default_bda');
    expect(res.needs_authority_confirmation).toBe(true);
    expect(res.confidence).toBeLessThanOrEqual(0.3);
  });

  test('a specific LPA beats the BDA default if both alias-match the same taluk', async () => {
    // Defensive: even if BDA aliases erroneously included 'anekal', the specific
    // Anekal authority must win.
    query.mockResolvedValue({
      rows: [
        { ...REGISTRY_ROWS[0], taluk_aliases: ['anekal', 'bengaluru'] },
        REGISTRY_ROWS[1],
      ],
    });
    const res = await resolveStatutoryPlan({ taluk: 'Anekal' });
    expect(res.authority.code).toBe('ANEKAL_PA');
  });

  test('degrades honestly when the registry tables are absent (query throws)', async () => {
    query.mockRejectedValue(new Error('relation "regulatory_data.planning_authorities" does not exist'));
    const res = await resolveStatutoryPlan({ taluk: 'Anekal' });
    expect(res.resolved).toBe(false);
    expect(res.method).toBe('unresolved');
    expect(res.plan).toBeNull();
  });

  test('degrades honestly when the registry is empty', async () => {
    query.mockResolvedValue({ rows: [] });
    const res = await resolveStatutoryPlan({ taluk: 'Anekal' });
    expect(res.resolved).toBe(false);
  });

  test('an authority with no operative plan flags confirmation rather than asserting', async () => {
    query.mockResolvedValue({
      rows: [{ ...REGISTRY_ROWS[1], plan_id: null, plan_code: null, plan_name: null, plan_legal_status: null }],
    });
    const res = await resolveStatutoryPlan({ taluk: 'Anekal' });
    expect(res.authority.code).toBe('ANEKAL_PA');
    expect(res.plan).toBeNull();
    expect(res.needs_authority_confirmation).toBe(true);
  });
});

describe('logJurisdictionResolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('writes an audit row for a resolved jurisdiction and returns its id', async () => {
    query.mockResolvedValue({ rows: [{ id: 'log-1' }] });
    const id = await logJurisdictionResolution({
      propertyId: 'prop-1',
      inputs: { taluk: 'Anekal', village: 'Jigani', lat: 12.78, lng: 77.66, city: 'Bengaluru' },
      resolution: {
        resolved: true,
        authority: { id: 'auth-anekal', code: 'ANEKAL_PA' },
        plan: { id: 'plan-anekal', code: 'ANEKAL_LPA_MP_2031' },
        method: 'taluk_alias',
        confidence: 0.9,
        basis: 'K-GIS taluk = Anekal → Anekal Planning Authority',
        needs_authority_confirmation: false,
        alternates: [{ code: 'BDA', name: 'Bangalore Development Authority' }],
      },
      userId: 'user-1',
    });
    expect(id).toBe('log-1');
    expect(query.mock.calls[0][0]).toContain('INSERT INTO regulatory_data.jurisdiction_resolution_log');
  });

  test('does not write (and returns null) for an unresolved jurisdiction', async () => {
    const id = await logJurisdictionResolution({
      propertyId: 'prop-1',
      resolution: { resolved: false },
    });
    expect(id).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  test('never throws — a failed insert returns null', async () => {
    query.mockRejectedValue(new Error('rls violation'));
    const id = await logJurisdictionResolution({
      propertyId: 'prop-1',
      resolution: { resolved: true, authority: { id: 'a' }, plan: { id: 'p' }, method: 'default_bda', confidence: 0.3, basis: 'x', needs_authority_confirmation: true, alternates: [] },
    });
    expect(id).toBeNull();
  });
});
