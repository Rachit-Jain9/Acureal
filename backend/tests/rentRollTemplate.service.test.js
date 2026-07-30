'use strict';

// Deal-register import TEMPLATE generator (rent-roll program, PR-11).
// Round-trips every family's template through ExcelJS and pins the header row,
// the hidden redip_meta contract, and the enum dropdowns — the exact things the
// (forthcoming) importer keys on.

const ExcelJS = require('exceljs');
const {
  buildTemplateWorkbook, templateFileName, META_SHEET, HEADER_ROW, TEMPLATE_VERSION,
} = require('../src/services/rentRollTemplate.service');
const {
  IMPORT_COLUMNS_BY_KIND, KIND_SHEET_NAME, KINDS_BY_FAMILY,
} = require('../src/constants/rentRollImportColumns');

const load = async (buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
};

describe('rentRollTemplate.service', () => {
  test('every family template carries the right sheets, headers and hidden meta', async () => {
    for (const family of Object.keys(KINDS_BY_FAMILY)) {
      const wb = await load(await buildTemplateWorkbook(family, { dealName: 'Test Deal' }));
      const kinds = KINDS_BY_FAMILY[family];

      // One data sheet per kind + the veryHidden meta sheet.
      for (const kind of kinds) {
        const sheet = wb.getWorksheet(KIND_SHEET_NAME[kind]);
        expect(sheet).toBeDefined();
        const cols = IMPORT_COLUMNS_BY_KIND[kind];
        cols.forEach((c, i) => {
          expect(sheet.getRow(HEADER_ROW).getCell(i + 1).value).toBe(c.header);
        });
      }

      const meta = wb.getWorksheet(META_SHEET);
      expect(meta).toBeDefined();
      expect(meta.state).toBe('veryHidden');
      expect(meta.getCell('B2').value).toBe(TEMPLATE_VERSION);
      expect(meta.getCell('B3').value).toBe(family);
      expect(Number(meta.getCell('B4').value)).toBe(HEADER_ROW);
      // sheetMap rows (kind | sheetName | JSON keys) — one per kind.
      kinds.forEach((kind, i) => {
        const r = 6 + i;
        expect(meta.getCell(r, 1).value).toBe(kind);
        expect(meta.getCell(r, 2).value).toBe(KIND_SHEET_NAME[kind]);
        expect(JSON.parse(meta.getCell(r, 3).value)).toEqual(IMPORT_COLUMNS_BY_KIND[kind].map((c) => c.key));
      });
    }
  });

  test('enum columns get an Excel list-validation dropdown on the fill range', async () => {
    const wb = await load(await buildTemplateWorkbook('lease_income'));
    const sheet = wb.getWorksheet(KIND_SHEET_NAME.lease);
    const statusIdx = IMPORT_COLUMNS_BY_KIND.lease.findIndex((c) => c.key === 'status');
    const cell = sheet.getCell(HEADER_ROW + 1, statusIdx + 1);
    expect(cell.dataValidation).toBeDefined();
    expect(cell.dataValidation.type).toBe('list');
    expect(cell.dataValidation.formulae[0]).toContain('occupied');
  });

  test('the template ships EMPTY — no fabricated sample records below the header', async () => {
    const wb = await load(await buildTemplateWorkbook('lease_income'));
    const sheet = wb.getWorksheet(KIND_SHEET_NAME.lease);
    // First data row has no text values (only optional input tint), so a user
    // never mistakes a placeholder for a real lease.
    const firstDataRow = sheet.getRow(HEADER_ROW + 1);
    const anyValue = [1, 2, 3, 4].some((c) => {
      const v = firstDataRow.getCell(c).value;
      return v !== null && v !== undefined && String(v).trim() !== '';
    });
    expect(anyValue).toBe(false);
  });

  test('redevelopment template has BOTH occupant and free-sale sheets', async () => {
    const wb = await load(await buildTemplateWorkbook('redevelopment'));
    expect(wb.getWorksheet('Occupants')).toBeDefined();
    expect(wb.getWorksheet('Sales & Collections')).toBeDefined();
  });

  test('unknown family falls back to the lease template (never throws)', async () => {
    const wb = await load(await buildTemplateWorkbook('nonsense'));
    expect(wb.getWorksheet('Rent Roll')).toBeDefined();
    expect(wb.getWorksheet(META_SHEET).getCell('B3').value).toBe('lease_income');
  });

  test('templateFileName is filesystem-safe and descriptive', () => {
    expect(templateFileName('lease_income', 'Whitefield / Phase 2!')).toMatch(/^Acureal-Whitefield-Phase-2-.*-template\.xlsx$/);
    expect(templateFileName('redevelopment', null)).toMatch(/\.xlsx$/);
  });
});
