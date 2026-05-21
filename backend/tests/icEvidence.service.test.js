'use strict';

/**
 * Tests for icEvidence.service — the IC memo Evidence Ledger (Workstream A3).
 *
 * The database layer and the four composed engines are mocked; the service is
 * a pure composer, so the tests assert the claim shapes and source typing.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/financial.service', () => ({ getFinancials: jest.fn() }));
jest.mock('../src/services/modelConfidence.service', () => ({ getModelConfidence: jest.fn() }));
jest.mock('../src/services/riskRadar.service', () => ({ getRiskRadar: jest.fn() }));
jest.mock('../src/services/compReliance.service', () => ({ listReliedCompIds: jest.fn() }));

const { query } = require('../src/config/database');
const financialService = require('../src/services/financial.service');
const modelConfidenceService = require('../src/services/modelConfidence.service');
const riskRadarService = require('../src/services/riskRadar.service');
const compRelianceService = require('../src/services/compReliance.service');
const icEvidence = require('../src/services/icEvidence.service');

const { _internal } = icEvidence;

const DEAL_ROW = {
  name: 'Whitefield Plot 22',
  stage: 'underwriting',
  asset_class: 'residential_apartments',
  land_ask_price_cr: 50,
  negotiated_price_cr: 45,
  land_area_sqft: 60000,
};

const FIN_ROW = {
  model_params: {
    engineVersion: 'kernel-v2',
    computedAt: '2026-05-20T10:00:00Z',
    kpis: { irr: 18.4, npv: 24.1, equityMultiple: 1.85, grossMarginPct: 22, rlv: 30 },
    costs: { total: 180, land: 25, construction: 110 },
    revenue: { totalRevenueCr: 245 },
  },
};

const CONFIDENCE = {
  available: true,
  inputs: [
    { key: 'plotAreaSqft', label: 'Plot area', status: 'deal-set', value: 50000, basis: 'Entered for this deal' },
    {
      key: 'discountRatePct',
      label: 'Discount rate',
      status: 'default',
      value: 14,
      benchmarkSource: 'REDIP WACC model',
      basis: 'On the REDIP benchmark default — REDIP WACC model',
    },
  ],
};

const RADAR = {
  overall_posture: 'flagged',
  categories: [
    { flags: { total: 2 }, diligence: { required_open: 3 }, approvals: null },
    { flags: { total: 0 }, diligence: { required_open: 1 }, approvals: { required_pending: 2 } },
  ],
};

beforeEach(() => {
  query.mockReset();
  financialService.getFinancials.mockReset();
  modelConfidenceService.getModelConfidence.mockReset();
  riskRadarService.getRiskRadar.mockReset();
  compRelianceService.listReliedCompIds.mockReset();
});

describe('getEvidenceLedger', () => {
  it('returns unavailable when the deal cannot be read', async () => {
    query.mockResolvedValue({ rows: [] });
    const r = await icEvidence.getEvidenceLedger('missing');
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/deal not found/i);
  });

  it('composes a full, fully-traced ledger from every engine', async () => {
    query.mockResolvedValue({ rows: [DEAL_ROW] });
    financialService.getFinancials.mockResolvedValue(FIN_ROW);
    modelConfidenceService.getModelConfidence.mockResolvedValue(CONFIDENCE);
    riskRadarService.getRiskRadar.mockResolvedValue(RADAR);
    compRelianceService.listReliedCompIds.mockResolvedValue(['c1', 'c2', 'c3']);

    const r = await icEvidence.getEvidenceLedger('deal-1');

    expect(r.available).toBe(true);
    const cats = r.groups.map((g) => g.category);
    expect(cats).toEqual(
      expect.arrayContaining([
        'Returns',
        'Capital & cost',
        'Key assumptions',
        'Risk & diligence',
        'Market',
        'Site & deal facts',
      ]),
    );

    // Every claim is traced — that is the ledger's whole promise.
    const all = r.groups.flatMap((g) => g.claims);
    expect(all.every((c) => c.traced === true)).toBe(true);
    expect(r.summary.total).toBe(all.length);
    expect(r.summary.traced).toBe(all.length);

    // Returns are kernel-sourced.
    const returns = r.groups.find((g) => g.category === 'Returns');
    const irr = returns.claims.find((c) => c.key === 'irr');
    expect(irr.value).toBe(18.4);
    expect(irr.unit).toBe('pct');
    expect(irr.source.type).toBe('kernel');

    // Key assumptions reuse the Model Confidence classification.
    const assumptions = r.groups.find((g) => g.category === 'Key assumptions');
    expect(assumptions.claims.find((c) => c.key === 'plotAreaSqft').source.type).toBe('analyst');
    const discount = assumptions.claims.find((c) => c.key === 'discountRatePct');
    expect(discount.source.type).toBe('benchmark');
    expect(discount.source.detail).toMatch(/REDIP WACC model/);

    // Risk counts sum across radar categories.
    const risk = r.groups.find((g) => g.category === 'Risk & diligence');
    expect(risk.claims.find((c) => c.key === 'openRiskFlags').value).toBe(2);
    expect(risk.claims.find((c) => c.key === 'requiredDdOpen').value).toBe(4);
    expect(risk.claims.find((c) => c.key === 'approvalsPending').value).toBe(2);

    // Market reflects the relied-on comps.
    const market = r.groups.find((g) => g.category === 'Market');
    expect(market.claims[0].value).toBe(3);
    expect(market.claims[0].source.type).toBe('feed');

    expect(r.summary.byType.kernel).toBeGreaterThan(0);
    expect(r.summary.byType.analyst).toBe(1);
    expect(r.summary.byType.benchmark).toBe(1);
  });

  it('still builds a ledger when the deal has no financial model', async () => {
    query.mockResolvedValue({ rows: [DEAL_ROW] });
    financialService.getFinancials.mockRejectedValue(
      Object.assign(new Error('Financials not found'), { statusCode: 404 }),
    );
    modelConfidenceService.getModelConfidence.mockResolvedValue({ available: false });
    riskRadarService.getRiskRadar.mockResolvedValue(RADAR);
    compRelianceService.listReliedCompIds.mockResolvedValue([]);

    const r = await icEvidence.getEvidenceLedger('deal-2');

    expect(r.available).toBe(true);
    const cats = r.groups.map((g) => g.category);
    expect(cats).not.toContain('Returns');
    expect(cats).toContain('Risk & diligence');
    expect(cats).toContain('Site & deal facts');
  });
});

describe('_internal helpers', () => {
  it('unitForInputKey maps input keys to display units', () => {
    expect(_internal.unitForInputKey('discountRatePct')).toBe('pct');
    expect(_internal.unitForInputKey('constructionCostPerSqft')).toBe('inr_per_sqft');
    expect(_internal.unitForInputKey('landCostCr')).toBe('inr_cr');
    expect(_internal.unitForInputKey('plotAreaSqft')).toBe('sqft');
    expect(_internal.unitForInputKey('keys')).toBe('count');
    expect(_internal.unitForInputKey('fsi')).toBeNull();
  });

  it('riskClaims sums counts across every radar category', () => {
    const claims = _internal.riskClaims(RADAR);
    expect(claims.find((c) => c.key === 'requiredDdOpen').value).toBe(4);
    expect(claims.every((c) => c.source.type === 'deterministic')).toBe(true);
  });

  it('financialClaims tags every figure kernel-sourced', () => {
    const f = _internal.financialClaims(FIN_ROW);
    expect(f.returns.length).toBeGreaterThan(0);
    expect(f.capital.length).toBeGreaterThan(0);
    expect([...f.returns, ...f.capital].every((c) => c.source.type === 'kernel')).toBe(true);
    expect(f.engineVersion).toBe('kernel-v2');
  });
});
