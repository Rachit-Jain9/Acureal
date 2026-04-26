jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../src/config/database');
const guidanceService = require('../src/services/guidance.service');

describe('guidance.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('adds locality and road exact-match boosts to guidance ranking query', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'guidance-1',
        org_id: 'org-1',
        locality: 'Sampangere',
        road_name: 'Lakkur Road',
        land_use_type: 'residential',
        value_inr_per_sqft: 1200,
        unit_type: 'sqft',
        match_score: 0.82,
        review_status: 'approved',
      }],
    });

    const result = await guidanceService.findGuidanceMatches({
      address: 'Shriram Chirping Ridge, Sampangere Village, Lakkur Hobli',
      city: 'Malur',
      state: 'Karnataka',
      property_type: 'land',
    });

    expect(result.status).toBe('matched');
    expect(result.selected.locality).toBe('Sampangere');
    expect(query.mock.calls[0][0]).toContain('LOWER(COALESCE(gv.locality');
    expect(query.mock.calls[0][0]).toContain('LOWER(gv.road_name)');
    expect(query.mock.calls[0][1][3]).toBe('shriram chirping ridge, sampangere village, lakkur hobli malur karnataka');
  });

  test('returns needs-input when there is no searchable property context', async () => {
    const result = await guidanceService.findGuidanceMatches({});

    expect(result.status).toBe('needs_input');
    expect(query).not.toHaveBeenCalled();
  });
});
