'use strict';

/**
 * Static integrity audit for a generated workbook.
 *
 * WHY THIS EXISTS. The XLSX model is Acureal's most institutional artifact — an
 * investor opens it in Excel and edits inputs. Excel, not Node, evaluates its
 * ~4,400 formulas, and the existing suites cannot see that: they read
 * `cell.value.result`, which is the number the KERNEL cached at write time. A
 * formula can therefore be wrong while the cached number is right, and every
 * test passes while the customer sees `#NAME?`.
 *
 * That is not hypothetical. `buildWorkbook.js` carries a comment explaining
 * that `RERAEscrowPct` shipped exactly this way — an inputs section skipped for
 * some deals while the Cash Flow Engine referenced the name unconditionally,
 * producing a "#NAME? cascade" fixed by hand on 2026-07-17. The fix was applied
 * to that one name. Auditing the generator afterwards found two more live
 * instances (`ExitCapRatePct`, `LandownerSharePct`), which is what a
 * patch-one-instance-at-a-time defect always looks like.
 *
 * WHAT IT CHECKS. Everything provable from the workbook alone, without
 * evaluating anything:
 *
 *   undefined_name    a formula references a defined name the workbook does not
 *                     declare -> #NAME? in Excel
 *   missing_sheet     a formula references a sheet that is not present -> #REF!
 *   ref_error         a formula contains a literal #REF!
 *   duplicate_name    the same defined name is declared twice, so which value
 *                     wins depends on load order
 *
 * WHAT IT DOES NOT CHECK. It does not evaluate formulas, so it cannot catch a
 * formula that is well-formed but points at the wrong (existing) cell. Closing
 * that needs a real evaluator; this closes the class that has actually shipped.
 *
 * Pure and dependency-free — takes a loaded ExcelJS workbook, returns findings.
 */

// Excel built-ins that appear as bare identifiers or as function heads. A name
// in this set is never a workbook-defined name, so it must not be reported.
const EXCEL_FUNCTIONS = new Set((
  'IF,IFS,IFERROR,IFNA,SUM,SUMIF,SUMIFS,SUMPRODUCT,MAX,MAXIFS,MIN,MINIFS,ABS,ROUND,ROUNDUP,'
  + 'ROUNDDOWN,MROUND,INDEX,MATCH,EDATE,EOMONTH,IRR,XIRR,MIRR,NPV,XNPV,COUNT,COUNTA,COUNTIF,'
  + 'COUNTIFS,COUNTBLANK,AVERAGE,AVERAGEIF,AVERAGEIFS,TEXT,CONCAT,CONCATENATE,TEXTJOIN,AND,OR,'
  + 'NOT,XOR,ISERROR,ISERR,ISNUMBER,ISBLANK,ISTEXT,ISNA,NA,TODAY,NOW,YEAR,MONTH,DAY,DATE,'
  + 'DATEDIF,DAYS,WEEKDAY,POWER,SQRT,LN,LOG,LOG10,EXP,PMT,IPMT,PPMT,FV,PV,RATE,NPER,CUMIPMT,'
  + 'CUMPRINC,SLN,DB,DDB,CHOOSE,OFFSET,INDIRECT,ROW,ROWS,COLUMN,COLUMNS,ADDRESS,LEFT,RIGHT,MID,'
  + 'LEN,TRIM,UPPER,LOWER,PROPER,SUBSTITUTE,REPLACE,FIND,SEARCH,VALUE,NUMBERVALUE,LOOKUP,VLOOKUP,'
  + 'HLOOKUP,XLOOKUP,MEDIAN,MODE,STDEV,STDEVP,VAR,VARP,LARGE,SMALL,RANK,PERCENTILE,QUARTILE,MOD,'
  + 'INT,TRUNC,CEILING,FLOOR,SIGN,PRODUCT,SUBTOTAL,AGGREGATE,TRANSPOSE,SEQUENCE,LET,LAMBDA,'
  + 'SWITCH,TRUE,FALSE,PI,RAND,RANDBETWEEN'
).split(','));

// A1 / $A$1 / AA123 — a cell reference, not a name.
const CELL_REFERENCE = /^\$?[A-Z]{1,3}\$?\d{1,7}$/;
// A bare 1-3 letter token is a COLUMN reference (the `A` in `A:A`, or a column
// half of a range). Without this every column letter reads as an undefined
// name and the real findings drown in alphabet.
const COLUMN_REFERENCE = /^\$?[A-Z]{1,3}$/;
// Structured/boolean literals that are not names.
const LITERALS = new Set(['TRUE', 'FALSE']);

/** Defined names declared by the workbook, in whatever shape ExcelJS exposes. */
const collectDefinedNames = (workbook) => {
  const names = [];
  const model = workbook?.definedNames?.model;
  if (Array.isArray(model)) {
    for (const entry of model) if (entry && entry.name) names.push(String(entry.name));
  }
  return names;
};

/**
 * Identifiers in a formula that could be workbook-defined names.
 *
 * Order matters: string literals go first (a warning message may contain any
 * word), then sheet-qualified prefixes (`'Cash Flow Engine'!B4` must not read
 * as a name), and only then are bare identifiers considered.
 */
const extractCandidateNames = (formula) => {
  const stripped = String(formula)
    .replace(/"(?:[^"]|"")*"/g, ' ')          // string literals
    .replace(/'[^']+'!/g, ' ')                 // 'Quoted Sheet'!
    .replace(/[A-Za-z_][A-Za-z0-9_.]*!/g, ' '); // BareSheet!

  const out = [];
  for (const match of stripped.matchAll(/(?<![A-Za-z0-9_$.!])([A-Za-z_][A-Za-z0-9_.]{1,80})\s*(\()?/g)) {
    const identifier = match[1];
    if (match[2]) continue;                                   // a function call
    const upper = identifier.toUpperCase();
    if (EXCEL_FUNCTIONS.has(upper) || LITERALS.has(upper)) continue;
    if (CELL_REFERENCE.test(upper) || COLUMN_REFERENCE.test(upper)) continue;
    out.push(identifier);
  }
  return out;
};

/** Sheet names referenced with the `'Name'!` form. */
const extractQuotedSheetRefs = (formula) =>
  [...String(formula).matchAll(/'([^']+)'!/g)].map((m) => m[1]);

/**
 * Audit a loaded ExcelJS workbook.
 *
 * @param {import('exceljs').Workbook} workbook
 * @returns {{ findings: Array<{type,identifier,sheet,cell,formula}>, formulaCount:number,
 *             definedNameCount:number, sheetCount:number }}
 */
const auditWorkbook = (workbook) => {
  const sheetNames = new Set((workbook.worksheets || []).map((s) => s.name));
  const declaredNames = collectDefinedNames(workbook);
  const declared = new Set(declaredNames);

  const findings = [];
  // One finding per distinct problem, with the first site that proves it —
  // 4,000 formulas referencing one missing name is one bug, not 4,000.
  const seen = new Set();
  const record = (type, identifier, sheet, cell, formula) => {
    const key = `${type}::${identifier}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      type,
      identifier,
      sheet,
      cell,
      formula: String(formula).slice(0, 200),
    });
  };

  const duplicates = new Map();
  for (const name of declaredNames) duplicates.set(name, (duplicates.get(name) || 0) + 1);
  for (const [name, count] of duplicates) {
    if (count > 1) record('duplicate_name', name, null, null, `declared ${count} times`);
  }

  let formulaCount = 0;
  for (const sheet of workbook.worksheets || []) {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = cell.value;
        const formula = value && typeof value === 'object'
          ? (value.formula || value.sharedFormula)
          : null;
        if (!formula) return;
        formulaCount += 1;

        if (String(formula).includes('#REF!')) {
          record('ref_error', `${sheet.name}!${cell.address}`, sheet.name, cell.address, formula);
        }
        for (const referenced of extractQuotedSheetRefs(formula)) {
          if (!sheetNames.has(referenced)) {
            record('missing_sheet', referenced, sheet.name, cell.address, formula);
          }
        }
        for (const candidate of extractCandidateNames(formula)) {
          if (!declared.has(candidate)) {
            record('undefined_name', candidate, sheet.name, cell.address, formula);
          }
        }
      });
    });
  }

  return {
    findings,
    formulaCount,
    definedNameCount: declared.size,
    sheetCount: sheetNames.size,
  };
};

/** Human-readable one-liner per finding, for a test failure message. */
const describeFinding = (f) => {
  const where = f.sheet ? ` at ${f.sheet}!${f.cell}` : '';
  const why = {
    undefined_name: 'referenced but never declared — Excel shows #NAME?',
    missing_sheet: 'sheet referenced but not present — Excel shows #REF!',
    ref_error: 'formula contains a literal #REF!',
    duplicate_name: 'declared more than once — which value wins depends on load order',
  }[f.type] || f.type;
  return `${f.type}: "${f.identifier}" ${why}${where}\n      =${f.formula}`;
};

module.exports = {
  auditWorkbook,
  describeFinding,
  extractCandidateNames,
  extractQuotedSheetRefs,
  collectDefinedNames,
  EXCEL_FUNCTIONS,
};
