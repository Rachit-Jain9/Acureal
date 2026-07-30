'use strict';

// Deterministic deal-register IMPORTER (rent-roll program, PR-11b).
// Round-trips a template through fill → parse and pins the value mapping, the
// hidden-meta validation (family / version), and the security posture (values
// only, enum-validate-or-drop, byte cap). The template generator + this parser
// are exact inverses, so these guard both.

const ExcelJS = require('exceljs');
const {
  buildTemplateWorkbook, META_SHEET, LEGACY_META_SHEET, HEADER_ROW,
} = require('../src/services/rentRollTemplate.service');
const rentRollService = require('../src/services/rentRoll.service');
const { parseTemplateBuffer, commitImport, __internal } = require('../src/services/rentRollImport.service');
const { IMPORT_COLUMNS_BY_KIND } = require('../src/constants/rentRollImportColumns');

// Fill a family's template with rows, keyed by DB field → return the buffer.
const fillTemplate = async (family, sheetName, kind, rows) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildTemplateWorkbook(family));
  const sheet = wb.getWorksheet(sheetName);
  const cols = IMPORT_COLUMNS_BY_KIND[kind];
  const keyToCol = new Map(cols.map((c, i) => [c.key, i + 1]));
  rows.forEach((rec, ri) => {
    const excelRow = sheet.getRow(HEADER_ROW + 1 + ri);
    Object.entries(rec).forEach(([key, value]) => {
      const ci = keyToCol.get(key);
      if (ci) excelRow.getCell(ci).value = value;
    });
  });
  return wb.xlsx.writeBuffer().then((b) => (Buffer.isBuffer(b) ? b : Buffer.from(b)));
};

describe('rentRollImport — round-trip parse', () => {
  test('a filled lease template parses back to DB-field records', async () => {
    const buf = await fillTemplate('lease_income', 'Rent Roll', 'lease', [
      { record_label: 'A-101', tenant_name: 'Anchor Tech Ltd', status: 'occupied', rent_basis: 'per_sqft_month', chargeable_area_sqft: 40000, base_rent_rate: 100, lease_expiry: '2031-03-31', collection_pct: 98 },
      { record_label: 'A-201', tenant_name: 'Mid Corp', status: 'committed', chargeable_area_sqft: 20000, base_rent_rate: 110 },
    ]);
    const out = await parseTemplateBuffer(buf, { expectedFamily: 'lease_income' });
    expect(out.family).toBe('lease_income');
    expect(out.totalRows).toBe(2);
    const rows = out.kinds.lease.rows;
    expect(rows[0]).toMatchObject({ record_label: 'A-101', tenant_name: 'Anchor Tech Ltd', status: 'occupied', chargeable_area_sqft: 40000, base_rent_rate: 100, lease_expiry: '2031-03-31', collection_pct: 98 });
    expect(rows[1]).toMatchObject({ record_label: 'A-201', tenant_name: 'Mid Corp', status: 'committed', base_rent_rate: 110 });
    expect(out.warnings).toEqual([]);
  });

  test('redevelopment parses BOTH occupant and free-sale sheets', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildTemplateWorkbook('redevelopment'));
    const occ = wb.getWorksheet('Occupants');
    occ.getRow(HEADER_ROW + 1).getCell(1).value = 'Flat 101';
    occ.getRow(HEADER_ROW + 1).getCell(IMPORT_COLUMNS_BY_KIND.occupant.findIndex((c) => c.key === 'status') + 1).value = 'vacated';
    const sale = wb.getWorksheet('Sales & Collections');
    sale.getRow(HEADER_ROW + 1).getCell(1).value = 'FS-1';
    const buf = await wb.xlsx.writeBuffer().then((b) => Buffer.from(b));
    const out = await parseTemplateBuffer(buf, { expectedFamily: 'redevelopment' });
    expect(out.kinds.occupant.rows[0]).toMatchObject({ record_label: 'Flat 101', status: 'vacated' });
    expect(out.kinds.sale.rows[0]).toMatchObject({ record_label: 'FS-1' });
    expect(out.totalRows).toBe(2);
  });

  test('empty rows are skipped; the record-only-if-something-present rule holds', async () => {
    const buf = await fillTemplate('lease_income', 'Rent Roll', 'lease', [
      {}, { record_label: 'B-1', base_rent_rate: 50 }, {},
    ]);
    const out = await parseTemplateBuffer(buf, { expectedFamily: 'lease_income' });
    expect(out.totalRows).toBe(1);
    expect(out.kinds.lease.rows[0].record_label).toBe('B-1');
  });
});

describe('rentRollImport — validation + security', () => {
  // The Acureal rename moved the hidden contract sheet from `redip_meta` to
  // `acureal_meta`. A template a user downloaded BEFORE the rename must still
  // import — otherwise the rebrand silently invalidates work already in
  // progress, which reads as data loss.
  test('still imports a template stamped with the pre-rename meta sheet', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildTemplateWorkbook('lease_income'));
    const meta = wb.getWorksheet(META_SHEET);
    expect(meta).toBeTruthy();
    meta.name = LEGACY_META_SHEET; // exactly what an older download carries
    wb.getWorksheet('Rent Roll').getRow(HEADER_ROW + 1).getCell(1).value = 'LEGACY-1';
    const buf = await wb.xlsx.writeBuffer().then((b) => Buffer.from(b));

    const out = await parseTemplateBuffer(buf, { expectedFamily: 'lease_income' });
    expect(out.family).toBe('lease_income');
    expect(out.kinds.lease.rows[0].record_label).toBe('LEGACY-1');
  });

  test('rejects a non-template file (no hidden meta sheet) with a readable reason', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').getCell('A1').value = 'hello';
    const buf = await wb.xlsx.writeBuffer().then((b) => Buffer.from(b));
    await expect(parseTemplateBuffer(buf)).rejects.toThrow(/not an Acureal register template/i);
  });

  test('rejects a wrong-family template for this deal', async () => {
    const buf = await buildTemplateWorkbook('lease_income');
    await expect(parseTemplateBuffer(Buffer.from(await buf), { expectedFamily: 'hotel_operating' }))
      .rejects.toThrow(/template.*but this deal's register/i);
  });

  test('rejects a mismatched major template version', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildTemplateWorkbook('lease_income'));
    wb.getWorksheet(META_SHEET).getCell('B2').value = '9.9.9';
    const buf = await wb.xlsx.writeBuffer().then((b) => Buffer.from(b));
    await expect(parseTemplateBuffer(buf, { expectedFamily: 'lease_income' })).rejects.toThrow(/version/i);
  });

  test('an invalid dropdown value is dropped with a warning, never committed', async () => {
    const buf = await fillTemplate('lease_income', 'Rent Roll', 'lease', [
      { record_label: 'A-1', status: 'not_a_status', base_rent_rate: 100 },
    ]);
    const out = await parseTemplateBuffer(buf, { expectedFamily: 'lease_income' });
    expect(out.kinds.lease.rows[0].status).toBeUndefined(); // dropped
    expect(out.kinds.lease.rows[0].record_label).toBe('A-1'); // rest kept
    expect(out.warnings.some((w) => /not one of/i.test(w.message))).toBe(true);
  });

  test('a formula cell is ignored (values only) with a warning', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildTemplateWorkbook('lease_income'));
    const sheet = wb.getWorksheet('Rent Roll');
    const rateIdx = IMPORT_COLUMNS_BY_KIND.lease.findIndex((c) => c.key === 'base_rent_rate') + 1;
    sheet.getRow(HEADER_ROW + 1).getCell(1).value = 'A-1';
    sheet.getRow(HEADER_ROW + 1).getCell(rateIdx).value = { formula: '1+1', result: 2 };
    const buf = await wb.xlsx.writeBuffer().then((b) => Buffer.from(b));
    const out = await parseTemplateBuffer(buf, { expectedFamily: 'lease_income' });
    expect(out.kinds.lease.rows[0].base_rent_rate).toBeUndefined(); // formula result NOT trusted
    expect(out.warnings.some((w) => /formula/i.test(w.message))).toBe(true);
  });

  test('a date typed as a real Excel Date normalises to YYYY-MM-DD (UTC, no TZ drift)', () => {
    const { normalizeCell } = __internal;
    const col = { key: 'lease_expiry', type: 'date', header: 'Lease Expiry' };
    expect(normalizeCell(col, new Date(Date.UTC(2031, 2, 31))).value).toBe('2031-03-31');
    expect(normalizeCell(col, '2029-12-01').value).toBe('2029-12-01');
    expect(normalizeCell(col, 'not a date').value).toBeNull();
  });

  test('numbers tolerate ₹ / comma formatting; non-numbers are dropped', () => {
    const { normalizeCell } = __internal;
    const col = { key: 'x', type: 'number', header: 'X' };
    expect(normalizeCell(col, '1,50,000').value).toBe(150000);
    expect(normalizeCell(col, '₹9000').value).toBe(9000);
    expect(normalizeCell(col, 'abc').value).toBeNull();
  });

  test('rejects an over-cap file', async () => {
    const big = Buffer.alloc(__internal.MAX_BYTES + 1, 1);
    await expect(parseTemplateBuffer(big)).rejects.toThrow(/import limit/i);
  });

  test('rejects a non-xlsx buffer as unreadable', async () => {
    await expect(parseTemplateBuffer(Buffer.from('this is not excel'))).rejects.toThrow(/could not be read/i);
  });
});

describe('rentRollImport — commit', () => {
  afterEach(() => jest.restoreAllMocks());

  test('commitImport re-parses server-side and bulk-inserts each kind with source "import"', async () => {
    const spy = jest.spyOn(rentRollService, 'bulkUpsertRecords')
      .mockImplementation(async (_dealId, _kind, rows) => rows.map((_, i) => ({ id: i })));
    const buf = await fillTemplate('lease_income', 'Rent Roll', 'lease', [
      { record_label: 'A-1', base_rent_rate: 100 },
      { record_label: 'A-2' },
    ]);
    const res = await commitImport('deal-1', buf, { expectedFamily: 'lease_income', userId: 'u1' });
    expect(res.total).toBe(2);
    expect(res.byKind.lease).toBe(2);
    expect(spy).toHaveBeenCalledWith('deal-1', 'lease', expect.any(Array), expect.objectContaining({ source: 'import', userId: 'u1' }));
  });

  test('commitImport skips empty kinds (no bulk call for zero rows)', async () => {
    const spy = jest.spyOn(rentRollService, 'bulkUpsertRecords').mockResolvedValue([]);
    const buf = await buildTemplateWorkbook('redevelopment'); // both sheets blank
    const res = await commitImport('deal-1', Buffer.from(await buf), { expectedFamily: 'redevelopment', userId: 'u1' });
    expect(res.total).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});
