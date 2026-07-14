'use strict';

// Deal Registers service — org scoping, soft delete, audit trail, whitelist
// enforcement, summary-recompute invariant, and graceful pre-migration
// degradation (42P01 → null/empty, never a crash).

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock('../src/services/dealAuditLog.service', () => ({ recordAudit: jest.fn() }));

const { query, transaction } = require('../src/config/database');
const dealAuditLog = require('../src/services/dealAuditLog.service');
const rentRollService = require('../src/services/rentRoll.service');

// SQL router: match statements by pattern so tests don't depend on the exact
// internal call order (ensureRegister → insert → recompute is an
// implementation detail; the routed responses are the contract).
const makeRouter = (routes) => jest.fn(async (sql) => {
  for (const [pattern, result] of routes) {
    if (pattern.test(sql)) return typeof result === 'function' ? result() : result;
  }
  return { rows: [] };
});

const REGISTER = {
  id: 7,
  deal_id: 'd1',
  register_family: 'lease_income',
  status: 'draft',
  as_of_date: '2026-07-14',
  total_leasable_area_sqft: 100000,
  settings: {},
  summary: {},
  updated_at: '2026-07-14T00:00:00Z',
};

const LEASE = {
  id: 42, deal_id: 'd1', register_id: 7, status: 'occupied',
  rent_basis: 'per_sqft_month', chargeable_area_sqft: 1000, base_rent_rate: 100,
  record_label: 'U-101', tenant_name: 'Acme', deleted_at: null,
};

const clientWith = (routes) => ({ query: makeRouter(routes) });

beforeEach(() => {
  jest.clearAllMocks();
  transaction.mockImplementation(async (cb) => cb(clientWith([])));
});

describe('rentRoll.service — kind/family guards', () => {
  test('unknown kind is a 400, before any SQL', async () => {
    await expect(rentRollService.createRecord('d1', 'penthouse', {}, 'u1'))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });

  test('kind outside the register family is a 400', async () => {
    transaction.mockImplementation(async (cb) => cb(clientWith([
      [/SELECT \* FROM deal_registers/i, { rows: [REGISTER] }], // lease_income family
    ])));
    await expect(rentRollService.createRecord('d1', 'hotel_contract', {}, 'u1'))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('family registry covers all 10 asset classes', () => {
    const classes = Object.keys(rentRollService.REGISTER_FAMILY_BY_ASSET_CLASS);
    expect(classes).toHaveLength(10);
    expect(rentRollService.resolveFamily('plotted_development')).toBe('sales_collections');
    expect(rentRollService.resolveFamily('hospitality')).toBe('hotel_operating');
    expect(rentRollService.resolveFamily('redevelopment')).toBe('redevelopment');
    expect(rentRollService.resolveFamily('raw_land')).toBe('lease_income');
  });
});

describe('rentRoll.service — createRecord', () => {
  const runCreate = async (data) => {
    const client = clientWith([
      [/SELECT \* FROM deal_registers/i, { rows: [REGISTER] }],
      [/INSERT INTO lease_records/i, { rows: [{ ...LEASE, ...data }] }],
      [/SELECT \* FROM lease_records/i, { rows: [{ ...LEASE, ...data }] }],
      [/UPDATE deal_registers/i, { rows: [REGISTER] }],
    ]);
    transaction.mockImplementation(async (cb) => cb(client));
    const record = await rentRollService.createRecord('d1', 'lease', data, 'u1');
    return { record, client };
  };

  test('inserts, recomputes the parent summary in the SAME transaction, audits', async () => {
    const { client } = await runCreate({ tenant_name: 'Acme', base_rent_rate: 100 });

    const sqls = client.query.mock.calls.map(([sql]) => sql);
    expect(sqls.some((s) => /INSERT INTO lease_records/i.test(s))).toBe(true);
    // The invariant every cache/staleness consumer relies on:
    expect(sqls.some((s) => /UPDATE deal_registers\s+SET summary = \$2, updated_at = NOW\(\)/i.test(s))).toBe(true);

    const audit = dealAuditLog.recordAudit.mock.calls[0][0];
    expect(audit.eventType).toBe('register_record_created');
    expect(audit.dealId).toBe('d1');
    expect(audit.actorId).toBe('u1');
    expect(audit.metadata.kind).toBe('lease');
  });

  test('non-whitelisted fields never reach the SQL', async () => {
    const { client } = await runCreate({
      tenant_name: 'Acme',
      organization_id: 'attacker-org',   // must be dropped
      deleted_at: '2026-01-01',          // must be dropped
      evil_column: 'DROP TABLE deals',   // must be dropped
    });
    const insertSql = client.query.mock.calls.map(([sql]) => sql)
      .find((s) => /INSERT INTO lease_records/i.test(s));
    expect(insertSql).not.toMatch(/organization_id/);
    expect(insertSql).not.toMatch(/evil_column/);
    expect(insertSql).not.toMatch(/deleted_at/);
  });

  test('JSONB arrays (rent_steps) are stringified, not passed as JS arrays', async () => {
    const steps = [{ from_date: '2028-07-01', rate: 120 }];
    const { client } = await runCreate({ tenant_name: 'Acme', rent_steps: steps });
    const insertCall = client.query.mock.calls
      .find(([sql]) => /INSERT INTO lease_records/i.test(sql));
    const stepsParam = insertCall[1].find((v) => typeof v === 'string' && v.includes('from_date'));
    expect(stepsParam).toBe(JSON.stringify(steps));
  });

  test('summary recompute carries metrics + counts + data hash', async () => {
    const { client } = await runCreate({ base_rent_rate: 100 });
    const updateCall = client.query.mock.calls
      .find(([sql]) => /UPDATE deal_registers/i.test(sql));
    const summary = JSON.parse(updateCall[1][1]);
    expect(summary.metricsVersion).toBeTruthy();
    expect(summary.recordCounts).toEqual({ lease: 1 });
    expect(summary.dataHash).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.metrics.occupancy).toBeDefined();
  });
});

describe('rentRoll.service — updateRecord / deleteRecord', () => {
  test('update scopes by org + deal + live, snapshots before-state, audits', async () => {
    const client = clientWith([
      [/SELECT \* FROM deal_registers/i, { rows: [REGISTER] }],
      [/SELECT \* FROM lease_records\s+WHERE id/i, { rows: [LEASE] }],
      [/UPDATE lease_records/i, { rows: [{ ...LEASE, status: 'notice_served' }] }],
      [/SELECT \* FROM lease_records/i, { rows: [LEASE] }],
      [/UPDATE deal_registers/i, { rows: [REGISTER] }],
    ]);
    transaction.mockImplementation(async (cb) => cb(client));

    const record = await rentRollService.updateRecord('d1', 'lease', 42, { status: 'notice_served' }, 'u1');
    expect(record.status).toBe('notice_served');

    const updateSql = client.query.mock.calls.map(([sql]) => sql)
      .find((s) => /UPDATE lease_records/i.test(s));
    expect(updateSql).toMatch(/organization_id = current_organization_id\(\)/);
    expect(updateSql).toMatch(/deleted_at IS NULL/);

    const audit = dealAuditLog.recordAudit.mock.calls[0][0];
    expect(audit.eventType).toBe('register_record_updated');
    expect(audit.before).toEqual({ status: 'occupied' });
  });

  test('update of a missing record is a 404', async () => {
    transaction.mockImplementation(async (cb) => cb(clientWith([
      [/SELECT \* FROM deal_registers/i, { rows: [REGISTER] }],
      [/SELECT \* FROM lease_records\s+WHERE id/i, { rows: [] }],
    ])));
    await expect(rentRollService.updateRecord('d1', 'lease', 999, { status: 'vacant' }, 'u1'))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('delete is a soft delete (UPDATE, never DELETE) and audits', async () => {
    const client = clientWith([
      [/SELECT \* FROM deal_registers/i, { rows: [REGISTER] }],
      [/UPDATE lease_records\s+SET deleted_at = NOW\(\)/i, { rows: [LEASE] }],
      [/SELECT \* FROM lease_records/i, { rows: [] }],
      [/UPDATE deal_registers/i, { rows: [REGISTER] }],
    ]);
    transaction.mockImplementation(async (cb) => cb(client));

    const deleted = await rentRollService.deleteRecord('d1', 'lease', 42, 'u1');
    expect(deleted.id).toBe(42);
    const sqls = client.query.mock.calls.map(([sql]) => sql);
    expect(sqls.some((s) => /DELETE FROM lease_records/i.test(s))).toBe(false);
    expect(dealAuditLog.recordAudit.mock.calls[0][0].eventType).toBe('register_record_deleted');
  });
});

describe('rentRoll.service — bulkUpsertRecords', () => {
  test('N rows insert in one transaction with ONE audit event', async () => {
    let inserts = 0;
    const client = clientWith([
      [/SELECT \* FROM deal_registers/i, { rows: [REGISTER] }],
      [/coalesce\(max\(position\)/i, { rows: [{ max_pos: 3 }] }],
      [/INSERT INTO lease_records/i, () => { inserts += 1; return { rows: [{ ...LEASE, id: 100 + inserts }] }; }],
      [/SELECT \* FROM lease_records/i, { rows: [] }],
      [/UPDATE deal_registers/i, { rows: [REGISTER] }],
    ]);
    transaction.mockImplementation(async (cb) => cb(client));

    const rows = [
      { tenant_name: 'A', base_rent_rate: 100 },
      { tenant_name: 'B', base_rent_rate: 110 },
      { tenant_name: 'C', base_rent_rate: 120 },
    ];
    const inserted = await rentRollService.bulkUpsertRecords('d1', 'lease', rows, {
      source: 'import', userId: 'u1',
    });
    expect(inserted).toHaveLength(3);
    expect(inserts).toBe(3);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(dealAuditLog.recordAudit).toHaveBeenCalledTimes(1);
    const audit = dealAuditLog.recordAudit.mock.calls[0][0];
    expect(audit.eventType).toBe('register_bulk_imported');
    expect(audit.after).toMatchObject({ kind: 'lease', row_count: 3, source: 'import' });
  });

  test('empty rows array is a 400', async () => {
    await expect(rentRollService.bulkUpsertRecords('d1', 'lease', [], {}))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('rentRoll.service — settings + lazy register creation', () => {
  test('updateSettings creates the register on first write (race-safe upsert)', async () => {
    const client = clientWith([
      [/SELECT \* FROM deal_registers/i, { rows: [] }],
      [/SELECT id, asset_class FROM deals/i, { rows: [{ id: 'd1', asset_class: 'commercial_office' }] }],
      [/INSERT INTO deal_registers/i, { rows: [REGISTER] }],
      [/SELECT \* FROM lease_records/i, { rows: [] }],
      [/UPDATE deal_registers/i, { rows: [REGISTER] }],
    ]);
    transaction.mockImplementation(async (cb) => cb(client));

    await rentRollService.updateSettings('d1', { as_of_date: '2026-07-14' }, 'u1');
    const insertSql = client.query.mock.calls.map(([sql]) => sql)
      .find((s) => /INSERT INTO deal_registers/i.test(s));
    expect(insertSql).toMatch(/ON CONFLICT \(deal_id\) WHERE deleted_at IS NULL DO NOTHING/i);
    expect(dealAuditLog.recordAudit.mock.calls[0][0].eventType).toBe('register_settings_updated');
  });

  test('unknown deal is a 404 (org-scoped lookup found nothing)', async () => {
    transaction.mockImplementation(async (cb) => cb(clientWith([
      [/SELECT \* FROM deal_registers/i, { rows: [] }],
      [/SELECT id, asset_class FROM deals/i, { rows: [] }],
    ])));
    await expect(rentRollService.updateSettings('d-nope', {}, 'u1'))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('rentRoll.service — snapshots', () => {
  test('createSnapshot freezes rows + metrics with a content hash, audits', async () => {
    const client = clientWith([
      [/SELECT \* FROM deal_registers/i, { rows: [REGISTER] }],
      [/SELECT \* FROM lease_records/i, { rows: [LEASE] }],
      [/INSERT INTO register_snapshots/i, {
        rows: [{ id: 5, register_id: 7, deal_id: 'd1', data_hash: 'h', trigger: 'manual' }],
      }],
    ]);
    transaction.mockImplementation(async (cb) => cb(client));

    const snap = await rentRollService.createSnapshot('d1', { trigger: 'manual' }, 'u1');
    expect(snap.id).toBe(5);

    const insertCall = client.query.mock.calls
      .find(([sql]) => /INSERT INTO register_snapshots/i.test(sql));
    const records = JSON.parse(insertCall[1][5]);
    expect(records.lease).toHaveLength(1);
    const metrics = JSON.parse(insertCall[1][6]);
    expect(metrics.occupancy).toBeDefined();
    expect(insertCall[1][8]).toMatch(/^[0-9a-f]{64}$/); // data_hash param
    expect(dealAuditLog.recordAudit.mock.calls[0][0].eventType).toBe('register_snapshot_created');
  });
});

describe('rentRoll.service — read slices + pre-migration degradation', () => {
  test('getRegister returns the empty state when no register exists', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await rentRollService.getRegister('d1')).toEqual({ register: null, records: {} });
  });

  test('42P01 (migration not applied) degrades to unavailable, never throws', async () => {
    const err = Object.assign(new Error('relation "deal_registers" does not exist'), { code: '42P01' });
    query.mockRejectedValueOnce(err);
    expect(await rentRollService.getRegister('d1')).toEqual({ register: null, records: {}, unavailable: true });

    query.mockRejectedValueOnce(err);
    expect(await rentRollService.getWorkspaceSlice('d1')).toBeNull();

    query.mockRejectedValueOnce(err);
    expect(await rentRollService.getExportSlice('d1')).toBeNull();

    query.mockRejectedValueOnce(err);
    expect(await rentRollService.listSnapshots('d1')).toEqual([]);
  });

  test('getExportSlice recomputes metrics from live rows and runs the validator', async () => {
    query
      .mockResolvedValueOnce({ rows: [REGISTER] })  // register
      .mockResolvedValueOnce({ rows: [LEASE] });    // lease rows
    const slice = await rentRollService.getExportSlice('d1', { baseRentPerSqftMonth: 40 });
    expect(slice.family).toBe('lease_income');
    expect(slice.metrics.revenue.inPlaceRentPerSqftMonth).toBe(100);
    // in-place ₹100 vs model ₹40 → drift warning fires
    expect(slice.warnings.some((w) => w.code === 'model_rent_drift')).toBe(true);
    expect(slice.dataHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('getWorkspaceSlice is summary-only (no record rows)', async () => {
    query.mockResolvedValueOnce({ rows: [REGISTER] });
    const slice = await rentRollService.getWorkspaceSlice('d1');
    expect(slice.family).toBe('lease_income');
    expect(slice.records).toBeUndefined();
    expect(slice.summary).toEqual({});
  });
});

describe('audit event registry', () => {
  test('all six register event types are registered in dealAuditLog', () => {
    const real = jest.requireActual('../src/services/dealAuditLog.service');
    // recordAudit validates against SUPPORTED_EVENT_TYPES internally; the
    // service module doesn't export the set, so assert via the source contract:
    const src = require('fs').readFileSync(
      require.resolve('../src/services/dealAuditLog.service'), 'utf8',
    );
    for (const type of [
      'register_settings_updated', 'register_record_created', 'register_record_updated',
      'register_record_deleted', 'register_bulk_imported', 'register_snapshot_created',
    ]) {
      expect(src).toContain(`'${type}'`);
    }
    expect(real).toBeDefined();
  });
});
