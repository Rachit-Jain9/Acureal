'use strict';

/**
 * Unit tests for promoterProfile.service.js — B4, the promoter / builder
 * track-record service. Pins the deterministic execution posture and the
 * full-document, sanitising upsert.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/karnatakaReraTracker.service', () => ({
  findPromoterCandidates: jest.fn(),
  getPromoterStats: jest.fn(),
}));

const { query } = require('../src/config/database');
const karnatakaRera = require('../src/services/karnatakaReraTracker.service');
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

// ─────────────────────────────────────────────────────────────────────────────
//  K-RERA cross-link (Phase 1 / Pillar 6)
// ─────────────────────────────────────────────────────────────────────────────

describe('findReraCandidates', () => {
  test('returns empty array when promoter name is too short', async () => {
    expect(await promoterProfile.findReraCandidates('')).toEqual([]);
    expect(await promoterProfile.findReraCandidates('A')).toEqual([]);
    expect(karnatakaRera.findPromoterCandidates).not.toHaveBeenCalled();
  });

  test('delegates to karnatakaRera for valid names', async () => {
    karnatakaRera.findPromoterCandidates.mockResolvedValueOnce([
      { promoter_name: 'Prestige Estates Projects Limited', sim_score: 0.92 },
    ]);
    const out = await promoterProfile.findReraCandidates('Prestige');
    expect(out).toHaveLength(1);
    expect(out[0].sim_score).toBe(0.92);
    expect(karnatakaRera.findPromoterCandidates).toHaveBeenCalledWith('Prestige', {
      limit: 5,
      minSimilarity: 0.35,
    });
  });
});

describe('linkReraPromoter', () => {
  test('rejects when no profile exists for the deal', async () => {
    // UPDATE returns 0 rows when the deal has no profile in the caller's org.
    query.mockResolvedValueOnce({ rows: [] });
    await expect(
      promoterProfile.linkReraPromoter(DEAL_ID, 'Prestige Estates Projects Limited', 'u1', 0.92)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('updates the profile and records confidence + provenance', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          deal_id: DEAL_ID,
          promoter_name: 'Prestige',
          linked_rera_promoter_name: 'Prestige Estates Projects Limited',
          linked_rera_match_confidence: 0.92,
        },
      ],
    });
    const out = await promoterProfile.linkReraPromoter(
      DEAL_ID,
      '  Prestige Estates Projects Limited  ',
      'u1',
      0.92
    );
    expect(out.linked_rera_promoter_name).toBe('Prestige Estates Projects Limited');
    const call = query.mock.calls[0];
    // params: [cleanName, conf, userId, dealId]
    expect(call[1][0]).toBe('Prestige Estates Projects Limited'); // trimmed
    expect(call[1][1]).toBe(0.92);
    expect(call[1][2]).toBe('u1');
    expect(call[1][3]).toBe(DEAL_ID);
  });

  test('rejects when reraPromoterName is empty', async () => {
    await expect(
      promoterProfile.linkReraPromoter(DEAL_ID, '', 'u1', null)
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      promoterProfile.linkReraPromoter(DEAL_ID, '   ', 'u1', null)
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  test('clamps invalid match confidence to null', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await promoterProfile.linkReraPromoter(DEAL_ID, 'Prestige', 'u1', 1.5);
    expect(query.mock.calls[0][1][1]).toBeNull();
  });

  test('returns 503 when the link columns are not yet migrated', async () => {
    query.mockRejectedValueOnce(
      Object.assign(new Error('column "linked_rera_promoter_name" does not exist'), {
        code: '42703',
      })
    );
    await expect(
      promoterProfile.linkReraPromoter(DEAL_ID, 'Prestige Estates Projects Limited', 'u1', 0.92)
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('unlinkReraPromoter', () => {
  test('clears all four link columns and returns the updated row', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          deal_id: DEAL_ID,
          promoter_name: 'Prestige',
          linked_rera_promoter_name: null,
          linked_rera_match_confidence: null,
        },
      ],
    });
    const out = await promoterProfile.unlinkReraPromoter(DEAL_ID);
    expect(out.linked_rera_promoter_name).toBeNull();
    // The SQL should set all four columns to NULL.
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/linked_rera_promoter_name\s*=\s*NULL/);
    expect(sql).toMatch(/linked_rera_match_confidence\s*=\s*NULL/);
    expect(sql).toMatch(/linked_rera_at\s*=\s*NULL/);
    expect(sql).toMatch(/linked_rera_by\s*=\s*NULL/);
  });

  test('returns 404 when no profile exists for the deal', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(promoterProfile.unlinkReraPromoter(DEAL_ID)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('getReraCrossCheck', () => {
  test('returns empty shape when profile has no promoter_name', async () => {
    const out = await promoterProfile.getReraCrossCheck(null);
    expect(out).toEqual({ candidates: [], linked: null, stats: null });
    expect(karnatakaRera.findPromoterCandidates).not.toHaveBeenCalled();
  });

  test('returns linked stats + no candidates when a link exists', async () => {
    karnatakaRera.getPromoterStats.mockResolvedValueOnce({
      promoter_name: 'Prestige Estates Projects Limited',
      total_projects: 12,
      completed_projects: 7,
    });
    const out = await promoterProfile.getReraCrossCheck({
      promoter_name: 'Prestige',
      linked_rera_promoter_name: 'Prestige Estates Projects Limited',
      linked_rera_match_confidence: 0.92,
      linked_rera_at: '2026-05-20T10:00:00Z',
    });
    expect(out.linked.promoter_name).toBe('Prestige Estates Projects Limited');
    expect(out.linked.match_confidence).toBe(0.92);
    expect(out.stats.total_projects).toBe(12);
    expect(out.candidates).toEqual([]);
    // Did NOT re-fetch fuzzy candidates because the link is settled.
    expect(karnatakaRera.findPromoterCandidates).not.toHaveBeenCalled();
  });

  test('surfaces candidates + null link when no link exists', async () => {
    karnatakaRera.findPromoterCandidates.mockResolvedValueOnce([
      { promoter_name: 'Prestige Estates Projects Limited', sim_score: 0.92 },
      { promoter_name: 'Prestige Builders Pvt Ltd', sim_score: 0.71 },
    ]);
    const out = await promoterProfile.getReraCrossCheck({
      promoter_name: 'Prestige',
      linked_rera_promoter_name: null,
    });
    expect(out.linked).toBeNull();
    expect(out.stats).toBeNull();
    expect(out.candidates).toHaveLength(2);
    expect(karnatakaRera.getPromoterStats).not.toHaveBeenCalled();
  });
});

describe('getProfileWithAssessment — composed read model', () => {
  test('composes profile + assessment + rera into a single payload', async () => {
    // First DB call: getProfile
    query.mockResolvedValueOnce({
      rows: [
        {
          deal_id: DEAL_ID,
          promoter_name: 'Prestige',
          linked_rera_promoter_name: 'Prestige Estates Projects Limited',
          linked_rera_match_confidence: 0.92,
          linked_rera_at: '2026-05-20T10:00:00Z',
        },
      ],
    });
    karnatakaRera.getPromoterStats.mockResolvedValueOnce({
      promoter_name: 'Prestige Estates Projects Limited',
      total_projects: 12,
    });
    const out = await promoterProfile.getProfileWithAssessment(DEAL_ID);
    expect(out.profile.promoter_name).toBe('Prestige');
    expect(out.assessment).toBeDefined();
    expect(out.rera.linked.promoter_name).toBe('Prestige Estates Projects Limited');
    expect(out.rera.stats.total_projects).toBe(12);
  });
});
