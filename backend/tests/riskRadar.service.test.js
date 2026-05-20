'use strict';

/**
 * Unit tests for riskRadar.service.js — the Deal Risk Radar (Workstream B).
 * Pins the deterministic posture model: cleared / unverified / flagged, with
 * "unverified" as a first-class state.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const { query } = require('../src/config/database');
const riskRadar = require('../src/services/riskRadar.service');

const DEAL_ID = 'deal-1';

// Configure the three reads by inspecting the SQL.
const wire = ({ risk = [], dd = [], approvals = [] } = {}) => {
  query.mockImplementation((sql) => {
    if (/FROM risk_flags/.test(sql)) return Promise.resolve({ rows: risk });
    if (/FROM dd_items/.test(sql)) return Promise.resolve({ rows: dd });
    if (/FROM approval_items/.test(sql)) return Promise.resolve({ rows: approvals });
    return Promise.resolve({ rows: [] });
  });
};

const cat = (radar, key) => radar.categories.find((c) => c.key === key);

beforeEach(() => jest.clearAllMocks());

describe('category mapping', () => {
  test('maps the controlled risk-flag vocabulary to radar keys', () => {
    expect(riskRadar.mapRiskCategory('title')).toBe('title_ownership');
    expect(riskRadar.mapRiskCategory('legal')).toBe('title_ownership');
    expect(riskRadar.mapRiskCategory('regulatory')).toBe('approvals_regulatory');
    expect(riskRadar.mapRiskCategory('zoning')).toBe('approvals_regulatory');
    expect(riskRadar.mapRiskCategory('financial')).toBe('financial');
    expect(riskRadar.mapRiskCategory('physical')).toBe('physical_technical');
    expect(riskRadar.mapRiskCategory('market')).toBe('market');
  });

  test('falls back by keyword for free-text categories', () => {
    expect(riskRadar.mapRiskCategory('Encumbrance dispute')).toBe('title_ownership');
    expect(riskRadar.mapRiskCategory('something unknown')).toBe('physical_technical');
  });
});

describe('getRiskRadar', () => {
  test('a brand-new deal returns five unverified categories', async () => {
    wire({});
    const radar = await riskRadar.getRiskRadar(DEAL_ID);
    expect(radar.categories).toHaveLength(5);
    expect(radar.categories.every((c) => c.posture === 'unverified')).toBe(true);
    expect(radar.overall_posture).toBe('unverified');
  });

  test('an open critical risk flag flags its category and the overall posture', async () => {
    wire({ risk: [{ category: 'title', severity: 'critical', status: 'open' }] });
    const radar = await riskRadar.getRiskRadar(DEAL_ID);
    const title = cat(radar, 'title_ownership');
    expect(title.posture).toBe('flagged');
    expect(title.flags.total).toBe(1);
    expect(title.flags.critical).toBe(1);
    expect(title.signals.some((s) => /critical/.test(s.text))).toBe(true);
    expect(radar.overall_posture).toBe('flagged');
  });

  test('a resolved flag is not counted open but still marks the mode assessed', async () => {
    wire({ risk: [{ category: 'market', severity: 'high', status: 'resolved' }] });
    const radar = await riskRadar.getRiskRadar(DEAL_ID);
    const market = cat(radar, 'market');
    expect(market.flags.total).toBe(0);
    expect(market.flags.ever).toBe(1);
    // Assessed (a flag was logged) + no open work + no problem → cleared.
    expect(market.posture).toBe('cleared');
  });

  test('completed required diligence clears a category', async () => {
    wire({
      dd: [
        { category: 'title_ownership', status: 'completed', is_required: true },
        { category: 'seller_validity', status: 'completed', is_required: true },
      ],
    });
    const title = cat(await riskRadar.getRiskRadar(DEAL_ID), 'title_ownership');
    expect(title.posture).toBe('cleared');
    expect(title.diligence.completed).toBe(2);
  });

  test('pending required diligence leaves a category unverified with a signal', async () => {
    wire({
      dd: [
        { category: 'title_ownership', status: 'completed', is_required: true },
        { category: 'title_ownership', status: 'pending', is_required: true },
      ],
    });
    const title = cat(await riskRadar.getRiskRadar(DEAL_ID), 'title_ownership');
    expect(title.posture).toBe('unverified');
    expect(title.diligence.required_open).toBe(1);
    expect(title.signals.some((s) => /1 of 2 required diligence/.test(s.text))).toBe(true);
  });

  test('a flagged diligence item flags the category', async () => {
    wire({ dd: [{ category: 'financial_commercial', status: 'flagged', is_required: true }] });
    expect(cat(await riskRadar.getRiskRadar(DEAL_ID), 'financial').posture).toBe('flagged');
  });

  test('an unvalidated required approval leaves Approvals unverified', async () => {
    wire({
      approvals: [{ is_required: true, is_validated: false, status: 'pending', expiry_date: null }],
    });
    const ap = cat(await riskRadar.getRiskRadar(DEAL_ID), 'approvals_regulatory');
    expect(ap.posture).toBe('unverified');
    expect(ap.approvals.required_pending).toBe(1);
  });

  test('an expired required approval flags Approvals', async () => {
    wire({
      approvals: [
        { is_required: true, is_validated: true, status: 'approved', expiry_date: '2020-01-01' },
      ],
    });
    const ap = cat(await riskRadar.getRiskRadar(DEAL_ID), 'approvals_regulatory');
    expect(ap.posture).toBe('flagged');
    expect(ap.approvals.expired_required).toBe(1);
  });

  test('all required approvals validated clears Approvals', async () => {
    wire({
      approvals: [
        { is_required: true, is_validated: true, status: 'approved', expiry_date: '2030-01-01' },
      ],
    });
    expect(cat(await riskRadar.getRiskRadar(DEAL_ID), 'approvals_regulatory').posture).toBe(
      'cleared'
    );
  });
});
