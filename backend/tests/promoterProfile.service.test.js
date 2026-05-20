'use strict';

/**
 * Unit tests for promoterProfile.service.js — B4, the promoter / builder
 * track-record service. Pins the deterministic execution posture and the
 * full-document, sanitising upsert.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const { query } = require('../src/config/database');
const promoterProfile = require('../src/services/promoterProfile.service');

const DEAL_ID = 'deal-1';

beforeEach(() => jest.clearAllMocks());

describe('assessPromoter', () => {
  test('an absent profile is unverified', () => {
    const a = promoterProfile.assessPromoter(null);
    expect(a.posture).toBe('unverified');
    expect(a.summary.recorded).toBe(false);
  });

  test('a name with no delivery history is unverified', () => {
    const a = promoterProfile.assessPromoter({ promoter_name: 'Acme Builders' });
    expect(a.posture).toBe('unverified');
    expect(a.signals.some((s) => /delivery history not yet filled in/.test(s.text))).toBe(true);
  });

  test('RERA complaints on record flag the promoter', () => {
    const a = promoterProfile.assessPromoter({
      promoter_name: 'Acme',
      delivered_on_time: 9,
      delivered_delayed: 1,
      rera_complaints: 2,
    });
    expect(a.posture).toBe('flagged');
    expect(a.signals.some((s) => /RERA complaint/.test(s.text))).toBe(true);
  });

  test('a weak delivery record flags the promoter', () => {
    const a = promoterProfile.assessPromoter({
      promoter_name: 'Acme',
      delivered_on_time: 4,
      delivered_delayed: 6,
    });
    expect(a.posture).toBe('flagged');
    expect(a.signals.some((s) => /Weak delivery/.test(s.text))).toBe(true);
  });

  test('a mixed delivery record is unverified', () => {
    const a = promoterProfile.assessPromoter({
      promoter_name: 'Acme',
      delivered_on_time: 7,
      delivered_delayed: 3,
      rera_registered: true,
    });
    expect(a.posture).toBe('unverified');
    expect(a.signals.some((s) => /Mixed delivery/.test(s.text))).toBe(true);
  });

  test('a strong, RERA-registered, complaint-free record is cleared', () => {
    const a = promoterProfile.assessPromoter({
      promoter_name: 'Acme',
      delivered_on_time: 9,
      delivered_delayed: 1,
      rera_registered: true,
      rera_complaints: 0,
      total_projects: 12,
    });
    expect(a.posture).toBe('cleared');
    expect(a.summary.on_time_pct).toBe(90);
  });

  test('not RERA-registered keeps an otherwise-clean record unverified', () => {
    const a = promoterProfile.assessPromoter({
      promoter_name: 'Acme',
      delivered_on_time: 9,
      delivered_delayed: 1,
      rera_registered: false,
    });
    expect(a.posture).toBe('unverified');
    expect(a.signals.some((s) => /not RERA-registered/.test(s.text))).toBe(true);
  });
});

describe('getProfile', () => {
  test('returns the row when present', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 1, deal_id: DEAL_ID, promoter_name: 'Acme' }],
    });
    const p = await promoterProfile.getProfile(DEAL_ID);
    expect(p.promoter_name).toBe('Acme');
  });

  test('degrades to null when the table is not yet migrated', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('no table'), { code: '42P01' }));
    await expect(promoterProfile.getProfile(DEAL_ID)).resolves.toBeNull();
  });
});

describe('getPromoterRadarCategory', () => {
  test('returns a radar-shaped category', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const cat = await promoterProfile.getPromoterRadarCategory(DEAL_ID);
    expect(cat.key).toBe('promoter_execution');
    expect(cat.label).toBe('Promoter & Execution');
    expect(cat.posture).toBe('unverified');
    expect(Array.isArray(cat.signals)).toBe(true);
  });
});

describe('upsertProfile', () => {
  test('rejects when the deal is not in the caller organisation', async () => {
    query.mockImplementation((sql) => {
      if (/FROM public\.deals/.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    await expect(
      promoterProfile.upsertProfile(DEAL_ID, { promoter_name: 'Acme' }, 'u1')
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('upserts and sanitises invalid input', async () => {
    query.mockImplementation((sql) => {
      if (/FROM public\.deals/.test(sql)) return Promise.resolve({ rows: [{ ok: 1 }] });
      if (/INSERT INTO public\.deal_promoter_profiles/.test(sql)) {
        return Promise.resolve({
          rows: [{ id: 1, deal_id: DEAL_ID, promoter_name: 'Acme' }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const row = await promoterProfile.upsertProfile(
      DEAL_ID,
      { promoter_name: '  Acme  ', entity_type: 'bogus', years_active: -5, total_projects: 12 },
      'u1'
    );
    expect(row.promoter_name).toBe('Acme');
    const insertCall = query.mock.calls.find((c) => /INSERT INTO/.test(c[0]));
    const params = insertCall[1];
    // params: [dealId, promoter_name, entity_type, years_active, total_projects, ...]
    expect(params[1]).toBe('Acme'); // trimmed
    expect(params[2]).toBeNull(); // invalid entity_type → null
    expect(params[3]).toBeNull(); // negative years_active → null
    expect(params[4]).toBe(12); // valid count kept
  });

  test('surfaces a 503 when the table is not yet migrated', async () => {
    query.mockImplementation((sql) => {
      if (/FROM public\.deals/.test(sql)) return Promise.resolve({ rows: [{ ok: 1 }] });
      if (/INSERT INTO public\.deal_promoter_profiles/.test(sql)) {
        return Promise.reject(Object.assign(new Error('no table'), { code: '42P01' }));
      }
      return Promise.resolve({ rows: [] });
    });
    await expect(
      promoterProfile.upsertProfile(DEAL_ID, { promoter_name: 'Acme' }, 'u1')
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});
