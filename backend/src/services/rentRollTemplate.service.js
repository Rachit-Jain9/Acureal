'use strict';

// Deal-register import TEMPLATE generator.
//
// Produces a schema-correct blank XLSX for a register family — one data sheet
// per record kind (headers + Excel dropdowns for enum columns), plus a hidden
// `acureal_meta` sheet that stamps the template version, family, and the exact
// column-key ↔ header ↔ sheet map. The deterministic importer reads that sheet
// to map each sheet back to its kind and each column back to its DB field with
// zero guessing — so a filled template round-trips exactly.
//
// Everything comes from the single-source catalog in
// constants/rentRollImportColumns.js: the header a user sees, the column the
// template writes, and the field the importer maps are the same object.
//
// Deterministic + pure (no I/O beyond building the buffer). No AI, no fabricated
// sample data — the template ships EMPTY (an optional one-line hint row only),
// so a user never mistakes a placeholder for a real record.

// exceljs is required at point of use below — off the serverless cold-start path.
const palette = require('./exports/shared/palette');
const {
  TEMPLATE_VERSION, IMPORT_COLUMNS_BY_KIND, KIND_SHEET_NAME, KINDS_BY_FAMILY,
} = require('../constants/rentRollImportColumns');

const FONT = palette.FONTS.body;
const META_SHEET = 'acureal_meta';
// Templates downloaded before the Acureal rename stamp their contract on a
// sheet with the old name. New templates write META_SHEET; the importer accepts
// either, so a template already sitting on someone's disk still round-trips.
// Delete this only once no in-flight template can predate the rename.
const LEGACY_META_SHEET = 'redip_meta';
const HEADER_ROW = 3; // rows 1–2 carry the title + instruction band
const MAX_DROPDOWN_ROWS = 500; // apply list validation to a generous fill range

const FILL = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

const resolveFamily = (family) => (KINDS_BY_FAMILY[family] ? family : 'lease_income');

const styleTitle = (cell, value) => {
  cell.value = value;
  cell.font = { name: FONT, size: 12, bold: true, color: { argb: palette.xlsx('paperElevated') } };
  cell.fill = FILL(palette.xlsx('inkDeep'));
  cell.alignment = { vertical: 'middle', horizontal: 'left' };
};

const styleInstruction = (cell, value) => {
  cell.value = value;
  cell.font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
};

const styleHeaderCell = (cell, col) => {
  cell.value = col.header;
  cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('paperElevated') } };
  cell.fill = FILL(palette.xlsx(col.required ? 'accent' : 'mutedHigh'));
  cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  cell.border = {
    top: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
    bottom: { style: 'thin', color: { argb: palette.xlsx('hairlineStrong') } },
    left: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
    right: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
  };
};

// Excel list-validation formula: options comma-joined inside one quoted string.
const listFormula = (options) => [`"${options.join(',')}"`];

const buildKindSheet = (workbook, kind) => {
  const columns = IMPORT_COLUMNS_BY_KIND[kind];
  if (!columns) return null;
  const sheetName = KIND_SHEET_NAME[kind] || kind;
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: HEADER_ROW, showGridLines: true }],
  });
  sheet.columns = columns.map((c) => ({ width: Math.min(Math.max(c.header.length + 2, 14), 34) }));

  sheet.mergeCells(1, 1, 1, columns.length);
  styleTitle(sheet.getCell(1, 1), `Acureal | ${sheetName} — import template`);
  sheet.getRow(1).height = 24;
  sheet.mergeCells(2, 1, 2, columns.length);
  styleInstruction(sheet.getCell(2, 1),
    'Fill one row per record below the header. Copper-headed columns are the key identifier. '
    + 'Dates as YYYY-MM-DD. Areas in sqft. Money in whole ₹. Leave anything unknown blank. '
    + `Do not rename or reorder the header row, and do not edit the hidden ${META_SHEET} sheet.`);
  sheet.getRow(2).height = 30;

  const headerRow = sheet.getRow(HEADER_ROW);
  columns.forEach((col, i) => styleHeaderCell(headerRow.getCell(i + 1), col));
  headerRow.height = 26;

  // Enum dropdowns + light input-cell styling on the fill range.
  columns.forEach((col, i) => {
    const colLetter = sheet.getColumn(i + 1).letter;
    const firstFill = HEADER_ROW + 1;
    const lastFill = HEADER_ROW + MAX_DROPDOWN_ROWS;
    if (col.type === 'select' && Array.isArray(col.options)) {
      for (let r = firstFill; r <= lastFill; r += 1) {
        sheet.getCell(r, i + 1).dataValidation = {
          type: 'list', allowBlank: true, formulae: listFormula(col.options),
          showErrorMessage: true, errorStyle: 'warning',
          errorTitle: 'Pick from the list', error: `Allowed: ${col.options.join(' / ')}`,
        };
      }
    } else if (col.type === 'boolean') {
      for (let r = firstFill; r <= lastFill; r += 1) {
        sheet.getCell(r, i + 1).dataValidation = {
          type: 'list', allowBlank: true, formulae: listFormula(['TRUE', 'FALSE']),
          showErrorMessage: true, errorStyle: 'warning', errorTitle: 'TRUE or FALSE', error: 'Enter TRUE or FALSE',
        };
      }
    }
    // Soft input tint on the first ~50 fill rows so the entry zone reads clearly.
    for (let r = firstFill; r <= firstFill + 49; r += 1) {
      sheet.getCell(r, i + 1).fill = FILL(palette.xlsx('inputFill'));
    }
    void colLetter;
  });

  return { kind, sheetName, columnKeys: columns.map((c) => c.key), columnHeaders: columns.map((c) => c.header) };
};

// Hidden, machine-readable contract the importer keys on. Human-illegible on
// purpose (row 1 warns not to touch it); the parser validates version + family
// + the per-sheet column map before it will accept a single row.
const buildMetaSheet = (workbook, family, sheetSpecs) => {
  const meta = workbook.addWorksheet(META_SHEET);
  meta.state = 'veryHidden';
  meta.getCell('A1').value = 'Acureal DEAL-REGISTER IMPORT TEMPLATE — do not edit or delete this sheet.';
  meta.getCell('A2').value = 'templateVersion';
  meta.getCell('B2').value = TEMPLATE_VERSION;
  meta.getCell('A3').value = 'registerFamily';
  meta.getCell('B3').value = family;
  meta.getCell('A4').value = 'headerRow';
  meta.getCell('B4').value = HEADER_ROW;
  meta.getCell('A5').value = 'sheetMap';
  // One row per data sheet: kind | sheetName | JSON column keys.
  sheetSpecs.forEach((spec, i) => {
    const r = 6 + i;
    meta.getCell(r, 1).value = spec.kind;
    meta.getCell(r, 2).value = spec.sheetName;
    meta.getCell(r, 3).value = JSON.stringify(spec.columnKeys);
  });
  meta.getColumn(1).width = 20;
  meta.getColumn(2).width = 24;
  meta.getColumn(3).width = 80;
  return meta;
};

/**
 * Build a blank import-template workbook for a register family.
 * @param {string} family  lease_income | sales_collections | hotel_operating | redevelopment
 * @param {object} [opts]  { dealName?, brandName? } — cosmetic only
 * @returns {Promise<Buffer>}
 */
async function buildTemplateWorkbook(family, opts = {}) {
  const resolved = resolveFamily(family);
  const kinds = KINDS_BY_FAMILY[resolved];
  const ExcelJS = require('exceljs'); // lazy — off the cold-start path
  const workbook = new ExcelJS.Workbook();
  workbook.creator = opts.brandName || 'Acureal';
  workbook.created = opts.now instanceof Date ? opts.now : undefined;

  const specs = [];
  for (const kind of kinds) {
    const spec = buildKindSheet(workbook, kind);
    if (spec) specs.push(spec);
  }
  buildMetaSheet(workbook, resolved, specs);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

// A safe, descriptive download filename for a family template.
const templateFileName = (family, dealName) => {
  const fam = (KIND_SHEET_NAME[KINDS_BY_FAMILY[resolveFamily(family)][0]] || 'register')
    .replace(/[^A-Za-z0-9]+/g, '-');
  const deal = String(dealName || 'deal').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '') || 'deal';
  return `Acureal-${deal}-${fam}-template.xlsx`;
};

module.exports = {
  TEMPLATE_VERSION,
  META_SHEET,
  LEGACY_META_SHEET,
  HEADER_ROW,
  buildTemplateWorkbook,
  templateFileName,
  resolveFamily,
};
