'use strict';

// Deterministic deal-register IMPORTER — reads a filled REDIP template back in.
//
// Reads the hidden `redip_meta` contract a template stamps (version, family,
// column-key ↔ sheet map), then parses each data sheet VALUE-BY-VALUE against
// the single-source column catalog (constants/rentRollImportColumns.js). It is
// the exact inverse of rentRollTemplate.service — a template round-trips
// losslessly, and a hand-made spreadsheet is rejected with a readable reason
// rather than silently mis-mapped.
//
// Security posture (this parses UNTRUSTED user files server-side):
//   • VALUES ONLY — a formula/shared-formula cell is never trusted (its cached
//     result is ignored, warned, and dropped), which neutralises formula
//     injection; ExcelJS executes no VBA, so a macro-bearing .xlsm carries no
//     runtime risk here (and .xlsm is a distinct type the loader won't confuse
//     for our .xlsx template anyway).
//   • Byte cap before load, row cap while parsing (truncation is reported, never
//     silent), enum values validated-or-dropped so a bad dropdown value can
//     never fail the whole commit on a DB CHECK.
//   • No writes — parsing produces a STAGED preview. The route layer commits by
//     re-parsing (server-authoritative) and calling bulkUpsertRecords, so the
//     imported rows are exactly what the file contains, whitelisted by the
//     service and constrained by the DB.
//
// Pure + deterministic (async only for ExcelJS buffer load). No AI.

const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { IMPORT_COLUMNS_BY_KIND, TEMPLATE_VERSION } = require('../constants/rentRollImportColumns');
const { META_SHEET, HEADER_ROW } = require('./rentRollTemplate.service');
const rentRollService = require('./rentRoll.service');

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — a register template is a few KB; this is a generous guard.
const ROW_CAP = 2000;              // per sheet; Vercel-serverless-friendly.

const FAMILY_LABEL = {
  lease_income: 'rent roll',
  sales_collections: 'sales & collections',
  hotel_operating: 'hotel operating',
  redevelopment: 'redevelopment occupants',
};

const err = (status, message) => {
  const e = new Error(message);
  e.statusCode = status;
  return e;
};

const majorOf = (version) => String(version || '').split('.')[0];
const pad2 = (n) => String(n).padStart(2, '0');

// The literal, trustworthy value of a cell — never a formula's cached result.
// Returns { value, isFormula }.
const literalValue = (cell) => {
  const v = cell ? cell.value : null;
  if (v === null || v === undefined) return { value: null };
  if (typeof v === 'object') {
    if ('formula' in v || 'sharedFormula' in v) return { value: null, isFormula: true };
    if ('error' in v) return { value: null };
    if (Array.isArray(v.richText)) return { value: v.richText.map((r) => r.text).join('') };
    if ('text' in v) return { value: v.text };            // hyperlink cell
    if (v instanceof Date) return { value: v };
    if (Object.prototype.toString.call(v) === '[object Date]') return { value: v };
    return { value: null };
  }
  return { value: v };
};

// Normalise one raw cell value against its column spec → { value, warn }.
// A dropped value returns { value: null } (+ optional warn); it never throws.
const normalizeCell = (col, raw) => {
  if (raw === null || raw === undefined || raw === '') return { value: null };

  switch (col.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,\s₹]/g, ''));
      if (!Number.isFinite(n)) return { value: null, warn: `${col.header}: "${raw}" is not a number (dropped)` };
      return { value: n };
    }
    case 'date': {
      if (raw instanceof Date || Object.prototype.toString.call(raw) === '[object Date]') {
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return { value: null, warn: `${col.header}: invalid date (dropped)` };
        return { value: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` };
      }
      const s = String(raw).trim();
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return { value: `${m[1]}-${m[2]}-${m[3]}` };
      return { value: null, warn: `${col.header}: "${s}" is not a YYYY-MM-DD date (dropped)` };
    }
    case 'boolean': {
      if (raw === true || raw === false) return { value: raw };
      const s = String(raw).trim().toLowerCase();
      if (['true', 'yes', 'y', '1', 'operational'].includes(s)) return { value: true };
      if (['false', 'no', 'n', '0', 'out of service'].includes(s)) return { value: false };
      return { value: null, warn: `${col.header}: expected TRUE/FALSE (dropped)` };
    }
    case 'select': {
      const s = String(raw).trim();
      if (col.options.includes(s)) return { value: s };
      const ci = col.options.find((o) => o.toLowerCase() === s.toLowerCase());
      if (ci) return { value: ci };
      return { value: null, warn: `${col.header}: "${s}" is not one of ${col.options.join(' / ')} (dropped)` };
    }
    default:
      return { value: String(raw).trim() || null };
  }
};

// Normalise a raw record object ({ dbKey: value }) against a kind's catalog →
// { record, warnings }. The record keeps only present, valid fields (invalid
// enums/dates/numbers dropped with a warning). Shared with the AI-extraction
// bridge (rentRollExtract.service) so a template row and an extracted row pass
// through the exact same validation before they ever reach the register.
const normalizeRecord = (kind, raw, rowRef) => {
  const columns = IMPORT_COLUMNS_BY_KIND[kind] || [];
  const record = {};
  const warnings = [];
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const col of columns) {
    if (!Object.prototype.hasOwnProperty.call(src, col.key)) continue;
    const { value, warn } = normalizeCell(col, src[col.key]);
    if (warn) warnings.push({ kind, row: rowRef, message: warn });
    if (value !== null && value !== undefined && value !== '') record[col.key] = value;
  }
  return { record, warnings };
};

// Read + validate the redip_meta contract. Throws a readable 422 on mismatch.
const readMeta = (workbook, expectedFamily) => {
  const meta = workbook.getWorksheet(META_SHEET);
  if (!meta) {
    throw err(422, 'This file is not a REDIP register template (its hidden template sheet is missing). '
      + 'Download a fresh template from the register tab and fill that.');
  }
  const version = String(meta.getCell('B2').value || '');
  const family = String(meta.getCell('B3').value || '');
  const headerRow = Number(meta.getCell('B4').value) || HEADER_ROW;

  if (!version || majorOf(version) !== majorOf(TEMPLATE_VERSION)) {
    throw err(422, `This template is version "${version || 'unknown'}", but the current template is ${TEMPLATE_VERSION}. `
      + 'Download a fresh template and re-enter your data.');
  }
  if (expectedFamily && family && family !== expectedFamily) {
    throw err(422, `This is a ${FAMILY_LABEL[family] || family} template, but this deal's register is `
      + `${FAMILY_LABEL[expectedFamily] || expectedFamily}. Download the template from THIS deal's register tab.`);
  }

  const sheetSpecs = [];
  for (let r = 6; r <= meta.rowCount + 1; r += 1) {
    const kind = meta.getCell(r, 1).value;
    if (!kind) break;
    let columnKeys = [];
    try { columnKeys = JSON.parse(meta.getCell(r, 3).value || '[]'); } catch { columnKeys = []; }
    sheetSpecs.push({ kind: String(kind), sheetName: String(meta.getCell(r, 2).value || ''), columnKeys });
  }
  if (sheetSpecs.length === 0) {
    throw err(422, 'The template sheet map is empty or corrupt. Download a fresh template.');
  }
  return { version, family, headerRow, sheetSpecs };
};

/**
 * Parse a filled template buffer into staged, per-kind records — NO writes.
 *
 * @param {Buffer} buffer
 * @param {object} [opts]  { expectedFamily?, rowCap? }
 * @returns {Promise<{family, version, kinds, totalRows, truncated, warnings, dataHash}>}
 *   kinds = { [kind]: { sheetName, rows: [...], count } }
 */
async function parseTemplateBuffer(buffer, opts = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw err(400, 'No file was received.');
  }
  if (buffer.length > MAX_BYTES) {
    throw err(413, `The file is ${(buffer.length / 1048576).toFixed(1)} MB — larger than the ${MAX_BYTES / 1048576} MB import limit. `
      + 'Split it into smaller files, or remove empty rows.');
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw err(422, 'That file could not be read as an Excel workbook (.xlsx). '
      + 'Re-download the template, fill it, and upload the .xlsx (not a .csv or .xls).');
  }

  const { version, family, headerRow, sheetSpecs } = readMeta(workbook, opts.expectedFamily);
  const rowCap = Number(opts.rowCap) > 0 ? Number(opts.rowCap) : ROW_CAP;

  const kinds = {};
  const warnings = [];
  let totalRows = 0;
  let truncated = false;

  for (const spec of sheetSpecs) {
    const columns = IMPORT_COLUMNS_BY_KIND[spec.kind];
    const rows = [];
    if (columns) {
      const colByKey = new Map(columns.map((c) => [c.key, c]));
      const sheet = workbook.getWorksheet(spec.sheetName);
      if (sheet) {
        const lastRow = sheet.actualRowCount ? Math.max(sheet.actualRowCount, sheet.rowCount) : sheet.rowCount;
        for (let rn = headerRow + 1; rn <= lastRow; rn += 1) {
          if (rows.length >= rowCap) { truncated = true; break; }
          const excelRow = sheet.getRow(rn);
          const rec = {};
          let hasAny = false;
          spec.columnKeys.forEach((key, ci) => {
            const col = colByKey.get(key);
            if (!col) return;
            const { value: raw, isFormula } = literalValue(excelRow.getCell(ci + 1));
            if (isFormula) {
              warnings.push({ kind: spec.kind, row: rn, message: `${col.header}: a formula was ignored (values only)` });
              return;
            }
            const { value, warn } = normalizeCell(col, raw);
            if (warn) warnings.push({ kind: spec.kind, row: rn, message: warn });
            if (value !== null && value !== undefined && value !== '') {
              rec[key] = value;
              hasAny = true;
            }
          });
          if (hasAny) rows.push(rec);
        }
      }
    }
    kinds[spec.kind] = { sheetName: spec.sheetName, rows, count: rows.length };
    totalRows += rows.length;
  }

  const dataHash = crypto.createHash('sha256').update(buffer).digest('hex');
  return { family, version, kinds, totalRows, truncated, warnings, dataHash };
}

/**
 * Commit an import: re-parse the file server-side (authoritative — never trusts
 * client-supplied rows) and bulk-insert each kind's rows. One audit event per
 * kind (bulkUpsertRecords), the summary cache recomputed in-txn. Returns the
 * per-kind counts committed.
 *
 * @param {string} dealId
 * @param {Buffer} buffer
 * @param {object} [opts]  { expectedFamily?, userId? }
 */
async function commitImport(dealId, buffer, opts = {}) {
  const parsed = await parseTemplateBuffer(buffer, { expectedFamily: opts.expectedFamily });
  const byKind = {};
  let total = 0;
  for (const [kind, group] of Object.entries(parsed.kinds)) {
    if (!group.rows || group.rows.length === 0) continue;
    const inserted = await rentRollService.bulkUpsertRecords(dealId, kind, group.rows, {
      source: 'import',
      userId: opts.userId || null,
    });
    byKind[kind] = inserted.length;
    total += inserted.length;
  }
  return {
    total, byKind, family: parsed.family, warnings: parsed.warnings, truncated: parsed.truncated,
  };
}

module.exports = {
  parseTemplateBuffer,
  commitImport,
  normalizeRecord,
  // exported for unit tests
  __internal: {
    literalValue, normalizeCell, normalizeRecord, readMeta, majorOf, MAX_BYTES, ROW_CAP,
  },
};
