'use strict';

// calculateAndSave — atomic + fail-closed financial save (correctness audit
// #13/#14). The scenarios write, the financials UPSERT, and the immutable
// HMAC-signed audit record must all commit or roll back together, on ONE
// connection — a calc that cannot be audited must not silently persist.

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock('../src/engines/kernel.service', () => ({
  computeFullFinancials: jest.fn(() => ({
    kpis: {}, costs: {}, areas: {}, revenue: {}, capitalStack: {}, proforma: {},
    inputs: { x: 1 }, _legacy: {}, engineVersion: 'kernel-v2', cashFlows: [], sensitivityMatrix: null,
  })),
  computeScenarios: jest.fn(() => ({ base: { kpis: {}, revenue: {} } })),
}));
jest.mock('../src/services/audit.service', () => ({
  recordEvent: jest.fn(),
  flattenOutputsForAudit: jest.fn(() => ({ ok: true })),
}));
jest.mock('../src/services/dealAuditLog.service', () => ({ recordAudit: jest.fn() }));

const { query, transaction } = require('../src/config/database');
const auditService = require('../src/services/audit.service');
const financialService = require('../src/services/financial.service');

// Fake transaction: invoke the callback with a client whose .query runs the
// given impl, and let a thrown callback propagate — exactly what the real
// transaction() does after it ROLLBACKs and rethrows.
const installTxn = (clientQueryImpl) => {
  transaction.mockImplementation(async (cb) => cb({ query: jest.fn(clientQueryImpl) }));
};

const OK_DEAL = { rows: [{ id: 'd1', is_archived: false, stage: 'diligence' }] };

beforeEach(() => jest.clearAllMocks());

describe('financial.calculateAndSave — atomic + fail-closed (#13/#14)', () => {
  test('happy path: scenarios + financials UPSERT + audit all run inside ONE transaction, audit gets the exec', async () => {
    query.mockResolvedValueOnce(OK_DEAL); // deal lookup (outside the txn)
    const seen = [];
    installTxn((text) => {
      seen.push(text);
      if (/SELECT id FROM financials/i.test(text)) return Promise.resolve({ rows: [] }); // → INSERT path
      if (/INSERT INTO financials\b/i.test(text)) return Promise.resolve({ rows: [{ id: 'f1' }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await financialService.calculateAndSave('d1', { assetClass: 'commercial_office' }, { actorId: 'u1' });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(seen.some((t) => /INSERT INTO financial_scenarios/i.test(t))).toBe(true);
    expect(seen.some((t) => /INSERT INTO financials\b/i.test(t))).toBe(true);
    expect(auditService.recordEvent).toHaveBeenCalledTimes(1);
    // the audit write was threaded the transaction executor (2nd positional arg)
    expect(typeof auditService.recordEvent.mock.calls[0][1]).toBe('function');
    expect(res).toMatchObject({ id: 'f1' });
  });

  test('fail-closed: an audit (recordEvent) failure propagates so the transaction rolls the whole save back', async () => {
    query.mockResolvedValueOnce(OK_DEAL);
    auditService.recordEvent.mockRejectedValueOnce(new Error('HMAC key missing'));
    installTxn((text) => (/SELECT id FROM financials/i.test(text)
      ? Promise.resolve({ rows: [] })
      : Promise.resolve({ rows: [{ id: 'f1' }] })));

    await expect(
      financialService.calculateAndSave('d1', { assetClass: 'commercial_office' }, { actorId: 'u1' }),
    ).rejects.toThrow(/HMAC key missing/);
  });

  test('overflow regression: an astronomic kernel IRR persists as NULL in the column params, raw in model_params', async () => {
    // Plotted-development shape: front-loaded sales vs tiny month-0 outflow
    // annualises to an IRR no NUMERIC column holds. Pre-fix this INSERT threw
    // Postgres 22003 "numeric field overflow" and the Calculate 500'd.
    const { computeFullFinancials } = require('../src/engines/kernel.service');
    computeFullFinancials.mockReturnValueOnce({
      kpis: { irr: 1.6e9, equityMultiple: 42.5, npv: 512.3 },
      costs: {}, areas: {}, revenue: {}, capitalStack: {}, proforma: {},
      inputs: { x: 1 }, _legacy: {}, engineVersion: 'kernel-v2', cashFlows: [], sensitivityMatrix: null,
    });
    query.mockResolvedValueOnce(OK_DEAL);
    let insertParams = null;
    installTxn((text, params) => {
      if (/SELECT id FROM financials/i.test(text)) return Promise.resolve({ rows: [] });
      if (/INSERT INTO financials\b/i.test(text)) {
        insertParams = params;
        return Promise.resolve({ rows: [{ id: 'f1' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await financialService.calculateAndSave('d1', { assetClass: 'plotted_development' }, {});

    expect(insertParams).not.toBeNull();
    // Param $29 (index 28) is irr_pct — the un-storable value must be NULL.
    expect(insertParams[28]).toBeNull();
    // Param $31 (index 30) is equity_multiple — 42.5 fits and passes through.
    expect(insertParams[30]).toBe(42.5);
    // Param $28 (index 27) is npv_cr — fits.
    expect(insertParams[27]).toBe(512.3);
    // The raw IRR is preserved in model_params (param $2) and in the response.
    expect(JSON.parse(insertParams[1]).kpis.irr).toBe(1.6e9);
    expect(res.computed.kpis.irr).toBe(1.6e9);
  });

  test('atomic: a scenarios-write failure aborts before the financials row is written', async () => {
    query.mockResolvedValueOnce(OK_DEAL);
    const seen = [];
    installTxn((text) => {
      seen.push(text);
      if (/INSERT INTO financial_scenarios/i.test(text)) return Promise.reject(new Error('scenarios boom'));
      return Promise.resolve({ rows: [] });
    });

    await expect(
      financialService.calculateAndSave('d1', { assetClass: 'commercial_office' }, {}),
    ).rejects.toThrow(/scenarios boom/);
    expect(seen.some((t) => /INSERT INTO financials\b|UPDATE financials/i.test(t))).toBe(false);
    expect(auditService.recordEvent).not.toHaveBeenCalled();
  });
});
