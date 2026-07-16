'use strict';

// Deal-register worksheet(s) for the investor workbook.
//
// Renders the deal's rent roll / sales & collections / hotel operating /
// redevelopment occupant register into a single family-adaptive sheet, from
// the SERVER-RECOMPUTED slice on `ctx.exportContext.rentRoll` (produced by
// rentRoll.service.getExportSlice — metrics recomputed from live rows at export
// time, never the summary cache). This REPLACES the deleted buildLeaseRollSheet
// / buildUnitMixSheet orphans, which fabricated synthetic tenants from blended
// assumptions (a CLAUDE.md hard-rule violation). Every row here is a real,
// recorded register entry; nothing is invented.
//
// Design (mirrors the workbook's committed-block convention, plan v2 §D):
//   • A "Committed register metrics (governs at IC)" block, rendered DIRECTLY
//     from the deterministic engine's output. Because the block is the same
//     object the app and every other surface read, sheet KPIs cannot diverge
//     from the server metrics by construction — stronger than a post-hoc QA
//     check. A build-time test pins each committed cell to its metric.
//   • A records table with LIVE, editable per-row formulas (yellow input cells
//     for the economic drivers; locked formulas recompute in Excel) so an
//     analyst can flex an assumption — and a live "variance vs committed" cell
//     that lights up the instant the interactive total leaves the committed
//     figure. Committed governs; the interactive model is a sensitivity view.
//
// The style/format primitives (styleSectionTitle, styleOutputCell, palette,
// NUMBER_FORMATS, …) are PRIVATE to buildWorkbook.js; they are injected via
// `kit` so this module shares the exact workbook look without either growing
// the 9.5k-line builder or extracting its helper layer. Pure, zero-I/O.
//
// Conventions carried from buildWorkbook.js:
//   - Money summed by the engine in absolute ₹; large aggregates shown in ₹ Cr
//     (÷1e7); per-record figures shown in raw ₹. Rates shown on their basis.
//   - Percent cells take a 0–1 decimal (kit.toPctDecimal) with the % format.
//   - Every cell is locked-by-default; only styleInputCell unlocks. The global
//     ws.protect() call in buildWorkbook applies to this sheet automatically.
//   - Never hand-write a colour; always kit.palette.xlsx('<token>') (the
//     resolve() guard prevents FFundefined corruption).

const CONTRACTED_LEASE_STATUSES = new Set(['occupied', 'notice_served', 'committed']);
const SOLD_SALE_STATUSES = new Set(['booked', 'sold', 'registered']);

const RENT_BASIS_SHORT = {
  per_sqft_month: '₹/sqft/mo',
  per_unit_month: '₹/unit/mo',
  per_acre_month: '₹/acre/mo',
};

const LEASE_STATUS_LABEL = {
  vacant: 'Vacant',
  loi: 'LOI',
  committed: 'Committed',
  occupied: 'Occupied',
  notice_served: 'Notice served',
  expired: 'Expired / MTM',
};
const SALE_STATUS_LABEL = {
  unsold: 'Unsold',
  booked: 'Booked',
  sold: 'Sold',
  registered: 'Registered',
  cancelled: 'Cancelled',
};
const CONTRACT_TYPE_LABEL = {
  hma: 'HMA',
  franchise: 'Franchise',
  master_lease: 'Master lease',
  revenue_share: 'Revenue share',
  other: 'Other',
};
const OCCUPANT_STATUS_LABEL = {
  in_place: 'In place',
  vacated: 'Vacated',
  disputed: 'Disputed',
};
const RISK_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };

const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const colLetter = (n) => COLS[n - 1];

const PAISE_PER_CR = 1e7;

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

// ── Per-family record counts (drives the "render the sheet at all" gate) ────
const countRecords = (records = {}) =>
  Object.values(records).reduce((n, rows) => n + (Array.isArray(rows) ? rows.length : 0), 0);

// ─────────────────────────────────────────────────────────────────────────────
// Shared cell writers (all take the injected kit)
// ─────────────────────────────────────────────────────────────────────────────

// Static, server-computed value cell. Missing → an honest en-dash (never 0,
// which would read as a real zero — the whole point of the presence guards).
const putValue = (kit, cell, value, format, { pct = false, cr = false } = {}) => {
  if (!isNum(value)) {
    cell.value = '–';
    cell.numFmt = '@';
    cell.alignment = { horizontal: 'right', vertical: 'middle' };
    cell.protection = { locked: true };
    cell.font = { name: kit.FONT, size: 10, color: { argb: kit.palette.xlsx('mutedLow') } };
    cell.fill = kit.FILL(kit.palette.xlsx('paper'));
    return;
  }
  let v = Number(value);
  if (cr) v /= PAISE_PER_CR;
  if (pct) v = kit.toPctDecimal(v);
  cell.value = v;
  kit.styleOutputCell(cell, format);
};

// Text display cell (identity, status, dates) — locked, left-aligned label style.
const putText = (kit, cell, value, { right = false } = {}) => {
  kit.styleLabelCell(cell);
  cell.value = isNum(value) || (typeof value === 'string' && value.trim()) ? value : '–';
  if (!isNum(value) && !(typeof value === 'string' && value.trim())) {
    cell.font = { name: kit.FONT, size: 10, color: { argb: kit.palette.xlsx('mutedLow') } };
  }
  if (right) cell.alignment = { vertical: 'middle', horizontal: 'right' };
};

// A bare DATE serialises as 'YYYY-MM-DD' on the UTC API — show it verbatim as
// text (unambiguous, no timezone-shift risk, sorts correctly as ISO).
const putDate = (kit, cell, value) => {
  const s = value ? String(value).slice(0, 10) : '';
  putText(kit, cell, s || '–', { right: true });
};

// Editable economic driver (yellow, unlocked); recomputes downstream formulas.
const putInput = (kit, cell, value, format) => {
  cell.value = isNum(value) ? Number(value) : null;
  kit.styleInputCell(cell);
  if (format) cell.numFmt = format;
};

// Locked live formula cell.
const putFormula = (kit, cell, formula, format) => {
  cell.value = { formula };
  kit.styleOutputCell(cell, format);
};

const bannerTitle = (sheet, kit, ctx, label, lastCol) => {
  sheet.mergeCells(1, 1, 1, lastCol);
  sheet.getCell(1, 1).value = `${ctx.brandName} | ${ctx.deal.name || ctx.property.property_name || 'Deal'} | ${label}`;
  kit.styleSectionTitle(sheet.getCell(1, 1));
  sheet.getRow(1).height = 28;
};

const subtitle = (sheet, kit, row, lastCol, text) => {
  sheet.mergeCells(row, 1, row, lastCol);
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.font = { name: kit.FONT, size: 9, italic: true, color: { argb: kit.palette.xlsx('mutedHigh') } };
  cell.alignment = { vertical: 'middle', wrapText: true };
  cell.protection = { locked: true };
  sheet.getRow(row).height = 26;
};

const sectionBanner = (sheet, kit, row, lastCol, text) => {
  sheet.mergeCells(row, 1, row, lastCol);
  sheet.getCell(row, 1).value = text;
  kit.styleSectionTitle(sheet.getCell(row, 1));
  sheet.getRow(row).height = 20;
};

const governsNote = (sheet, kit, row, lastCol, text) => {
  sheet.mergeCells(row, 1, row, lastCol);
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.font = { name: kit.FONT, size: 9, italic: true, color: { argb: kit.palette.xlsx('mutedHigh') } };
  cell.alignment = { wrapText: true, vertical: 'top' };
  cell.protection = { locked: true };
  sheet.getRow(row).height = 30;
};

// A committed KPI stack: two side-by-side label/value pairs per row so the
// governing metrics read as a compact tile grid, not a long single column.
// `items` = [{ label, value, format, pct?, cr? }] for numbers, or
// { label, text: '…' } for a text summary (e.g. the governing contract).
// Missing numeric values render an honest '–'.
const committedGrid = (sheet, kit, startRow, items) => {
  let r = startRow;
  const writePair = (labelCol, valCol, item) => {
    sheet.getCell(r, labelCol).value = item.label;
    kit.styleLabelCell(sheet.getCell(r, labelCol));
    const vc = sheet.getCell(r, valCol);
    if (item.text !== undefined) {
      kit.styleLabelCell(vc);
      vc.value = item.text || '–';
      vc.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    } else {
      putValue(kit, vc, item.value, item.format, item);
    }
  };
  for (let i = 0; i < items.length; i += 2) {
    writePair(1, 2, items[i]);
    if (items[i + 1]) writePair(4, 5, items[i + 1]);
    r += 1;
  }
  return r;
};

const tableHeader = (sheet, kit, row, headers) => {
  headers.forEach((h, i) => { sheet.getCell(row, i + 1).value = h; });
  kit.styleHeader(sheet.getRow(row));
};

// Zebra a written record row (bottom hairline already applied by the style
// helpers; alternate rows get the subtle paper fill for scanability).
const zebra = (sheet, kit, row, lastCol) => {
  if (row % 2 === 1) return; // keep odd rows on their assigned fill
  for (let c = 1; c <= lastCol; c += 1) {
    const cell = sheet.getCell(row, c);
    if (cell.protection && cell.protection.locked === false) continue; // never repaint input cells
    cell.fill = kit.FILL(kit.palette.xlsx('paperSubtle'));
  }
};

// Reconciliation strip: committed (static) vs the sheet's own live total, with
// a live variance + a status formula that flips when an assumption is flexed.
// This is the plan's "sheet KPI totals vs server-recomputed metrics" check,
// realised live inside Excel rather than as a one-shot build-time assertion.
const reconciliationStrip = (sheet, kit, startRow, lastCol, {
  label, committedValue, liveTotalRef, cr = false,
}) => {
  let r = startRow;
  sectionBanner(sheet, kit, r, lastCol, 'Reconciliation — committed figure governs');
  r += 1;
  governsNote(sheet, kit, r, lastCol,
    'The committed figure below is the deterministic engine’s own total — the same number the app and IC memo cite. '
    + 'The live total recomputes from the yellow input cells above; a non-zero variance means an assumption was flexed for '
    + 'sensitivity. The committed figure governs at IC.');
  r += 1;

  const committedRow = r;
  sheet.getCell(committedRow, 1).value = `${label} — committed (₹${cr ? ' Cr' : ''})`;
  kit.styleLabelCell(sheet.getCell(committedRow, 1));
  putValue(kit, sheet.getCell(committedRow, 2), committedValue, kit.NUMBER_FORMATS.currency, { cr });
  r += 1;

  const liveRow = r;
  sheet.getCell(liveRow, 1).value = `${label} — live total (this sheet)`;
  kit.styleLabelCell(sheet.getCell(liveRow, 1));
  const liveCell = sheet.getCell(liveRow, 2);
  putFormula(kit, liveCell, `=${liveTotalRef}${cr ? '/10000000' : ''}`, kit.NUMBER_FORMATS.currency);
  r += 1;

  const varRow = r;
  sheet.getCell(varRow, 1).value = 'Variance (live − committed)';
  kit.styleLabelCell(sheet.getCell(varRow, 1));
  const cRef = `${colLetter(2)}${committedRow}`;
  const lRef = `${colLetter(2)}${liveRow}`;
  putFormula(kit, sheet.getCell(varRow, 2), `=${lRef}-${cRef}`, kit.NUMBER_FORMATS.currency);
  const statusCell = sheet.getCell(varRow, 4);
  sheet.mergeCells(varRow, 4, varRow, lastCol);
  statusCell.value = {
    formula: `=IF(ABS(${lRef}-${cRef})<=MAX(0.005*ABS(${cRef}),0.01),"✓ Matches committed","⚠ Assumption flexed — committed governs")`,
  };
  statusCell.font = { name: kit.FONT, size: 9, italic: true, color: { argb: kit.palette.xlsx('mutedHigh') } };
  statusCell.alignment = { vertical: 'middle', horizontal: 'left' };
  statusCell.protection = { locked: true };
  return r + 1;
};

const provenanceFooter = (sheet, kit, row, lastCol, ctx, slice) => {
  sheet.mergeCells(row, 1, row, lastCol);
  const cell = sheet.getCell(row, 1);
  cell.value = `Generated ${ctx.generatedAt} | ${ctx.brandName} | Deal register as of ${slice.asOfDate || 'n/a'} `
    + `| snapshot ${String(slice.dataHash || '').slice(0, 12) || 'n/a'} | ${slice.metricsVersion || ''} `
    + '| Yellow cells are editable; every other cell recalculates or is committed.';
  cell.font = { name: kit.FONT, size: 8, italic: true, color: { argb: kit.palette.xlsx('mutedHigh') } };
  cell.alignment = { vertical: 'middle', wrapText: true };
  cell.protection = { locked: true };
  sheet.getRow(row).height = 24;
};

// ─────────────────────────────────────────────────────────────────────────────
// Lease income → "Rent Roll"
// ─────────────────────────────────────────────────────────────────────────────

const buildLeaseRegisterSheet = (workbook, ctx, kit, slice) => {
  const LAST_COL = 16; // A..P
  const sheet = workbook.addWorksheet(kit.SHEETS.registerLease, {
    views: [{ showGridLines: false, state: 'frozen', xSplit: 1, ySplit: 2 }],
  });
  sheet.columns = [
    { width: 22 }, { width: 16 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 12 },
    { width: 12 }, { width: 13 }, { width: 11 }, { width: 12 }, { width: 12 }, { width: 12 },
    { width: 12 }, { width: 10 }, { width: 16 }, { width: 16 },
  ];

  const m = slice.metrics || {};
  const rows = (slice.records && slice.records.lease) || [];
  const occ = m.occupancy || {};
  const wale = m.wale || {};
  const rev = m.revenue || {};
  const mtm = m.mtm || {};
  const counts = m.counts || {};

  bannerTitle(sheet, kit, ctx, 'Rent Roll', LAST_COL);
  subtitle(sheet, kit, 2, LAST_COL,
    `Contracted lease income as of ${slice.asOfDate || 'n/a'} — ${counts.total || rows.length} lease(s). `
    + 'Figures are gross (pre JDA/JV ownership share); vacant rows count toward potential, never contracted income.');

  // Committed metrics block.
  let r = 4;
  sectionBanner(sheet, kit, r, LAST_COL, 'Committed register metrics (governs at IC)'); r += 1;
  governsNote(sheet, kit, r, LAST_COL,
    'Deterministic figures from the deal register — the same occupancy, WALE, MTM and NOI the app and IC memo cite. '
    + 'Static by design; the interactive lease table below recomputes live so an analyst can flex an assumption.'); r += 1;
  r = committedGrid(sheet, kit, r, [
    { label: 'Committed occupancy', value: occ.committedPct, format: kit.NUMBER_FORMATS.percent, pct: true },
    { label: 'Physical occupancy', value: occ.physicalPct, format: kit.NUMBER_FORMATS.percent, pct: true },
    { label: 'Leasable area (sqft)', value: occ.denominatorSqft, format: kit.NUMBER_FORMATS.integer },
    { label: 'Contracted area (sqft)', value: occ.contractedAreaSqft, format: kit.NUMBER_FORMATS.integer },
    { label: 'WALE to expiry (yr, area-wtd)', value: wale.toExpiryAreaYears, format: '0.0' },
    { label: 'Lock-in remaining (yr)', value: wale.lockinRemainingYears, format: '0.0' },
    { label: 'In-place vs market (MTM)', value: mtm.portfolioPct, format: kit.NUMBER_FORMATS.percent, pct: true },
    { label: 'In-place rent (₹/sqft/mo)', value: rev.inPlaceRentPerSqftMonth, format: kit.NUMBER_FORMATS.currency },
    { label: 'Contracted annual gross (₹ Cr)', value: rev.contractedAnnualGross, format: kit.NUMBER_FORMATS.currency, cr: true },
    { label: 'Accrual NOI (₹ Cr)', value: rev.accrualNOI, format: kit.NUMBER_FORMATS.currency, cr: true },
    { label: 'Cash-adjusted NOI (₹ Cr)', value: rev.cashNOI, format: kit.NUMBER_FORMATS.currency, cr: true },
    { label: 'Deposits held (₹ Cr)', value: (m.deposits || {}).total, format: kit.NUMBER_FORMATS.currency, cr: true },
  ]);
  // Coverage line — honest about what the metrics span.
  sheet.mergeCells(r, 1, r, LAST_COL);
  sheet.getCell(r, 1).value = `Contracted ${counts.contracted || 0} · vacant ${counts.vacant || 0} · LOI ${counts.loi || 0}`
    + `${(m.excluded && m.excluded.missingExpiry) ? ` · ${m.excluded.missingExpiry} lease(s) missing an expiry (excluded from WALE)` : ''}.`;
  sheet.getCell(r, 1).font = { name: kit.FONT, size: 9, italic: true, color: { argb: kit.palette.xlsx('mutedLow') } };
  sheet.getCell(r, 1).protection = { locked: true };
  r += 2;

  // Lease table.
  const headerRow = r;
  tableHeader(sheet, kit, headerRow,
    ['Unit / Ref', 'Building', 'Tenant / Occupier', 'Sector', 'Status', 'Basis', 'Area (sqft)',
      'Base rate', 'CAM', 'Market rate', 'Start', 'Expiry', 'Lock-in', 'Escal %', 'Monthly base (₹)', 'Annual base (₹)']);
  r += 1;
  const firstDataRow = r;
  rows.forEach((rec) => {
    const contracted = CONTRACTED_LEASE_STATUSES.has(rec.status);
    putText(kit, sheet.getCell(r, 1), rec.record_label);
    putText(kit, sheet.getCell(r, 2), rec.building);
    putText(kit, sheet.getCell(r, 3), rec.tenant_name);
    putText(kit, sheet.getCell(r, 4), rec.sector_use);
    putText(kit, sheet.getCell(r, 5), LEASE_STATUS_LABEL[rec.status] || rec.status);
    putText(kit, sheet.getCell(r, 6), RENT_BASIS_SHORT[rec.rent_basis] || rec.rent_basis, { right: true });
    putInput(kit, sheet.getCell(r, 7), rec.chargeable_area_sqft, kit.NUMBER_FORMATS.integer);
    putInput(kit, sheet.getCell(r, 8), rec.base_rent_rate, kit.NUMBER_FORMATS.currency);
    putValue(kit, sheet.getCell(r, 9), rec.cam_rate, kit.NUMBER_FORMATS.currency);
    putValue(kit, sheet.getCell(r, 10), rec.market_rent_rate, kit.NUMBER_FORMATS.currency);
    putDate(kit, sheet.getCell(r, 11), rec.lease_start);
    putDate(kit, sheet.getCell(r, 12), rec.lease_expiry);
    putDate(kit, sheet.getCell(r, 13), rec.lockin_end);
    putValue(kit, sheet.getCell(r, 14), rec.escalation_pct, kit.NUMBER_FORMATS.percent, { pct: true });
    // Monthly base rent — basis-aware live formula, contracted rows only.
    const g = `$${colLetter(7)}${r}`;
    const h = `$${colLetter(8)}${r}`;
    const f = `$${colLetter(6)}${r}`;
    if (contracted) {
      putFormula(kit, sheet.getCell(r, 15),
        `=IF(${f}="${RENT_BASIS_SHORT.per_unit_month}",${h},IF(${f}="${RENT_BASIS_SHORT.per_acre_month}",${g}/43560*${h},${g}*${h}))`,
        kit.NUMBER_FORMATS.integer);
      putFormula(kit, sheet.getCell(r, 16), `=${colLetter(15)}${r}*12`, kit.NUMBER_FORMATS.integer);
    } else {
      putText(kit, sheet.getCell(r, 15), '–', { right: true });
      putText(kit, sheet.getCell(r, 16), '–', { right: true });
    }
    zebra(sheet, kit, r, LAST_COL);
    r += 1;
  });
  const lastDataRow = r - 1;

  // Reconciliation strip: SUM of annual base (contracted rows) vs committed.
  r += 1;
  r = reconciliationStrip(sheet, kit, r, LAST_COL, {
    label: 'Contracted base rent',
    committedValue: rev.baseRentAnnual,
    liveTotalRef: lastDataRow >= firstDataRow
      ? `SUMIF(${colLetter(16)}${firstDataRow}:${colLetter(16)}${lastDataRow},"<>–")`
      : '0',
  });

  r += 1;
  provenanceFooter(sheet, kit, r, LAST_COL, ctx, slice);
  return sheet;
};

// ─────────────────────────────────────────────────────────────────────────────
// Sales & collections → "Sales & Collections"
// ─────────────────────────────────────────────────────────────────────────────

const buildSalesRegisterSheet = (workbook, ctx, kit, slice) => {
  const LAST_COL = 13; // A..M
  const sheet = workbook.addWorksheet(kit.SHEETS.registerSales, {
    views: [{ showGridLines: false, state: 'frozen', xSplit: 1, ySplit: 2 }],
  });
  sheet.columns = [
    { width: 18 }, { width: 14 }, { width: 16 }, { width: 18 }, { width: 12 }, { width: 12 },
    { width: 13 }, { width: 15 }, { width: 15 }, { width: 12 }, { width: 13 }, { width: 12 }, { width: 12 },
  ];

  const m = slice.metrics || {};
  const rows = (slice.records && slice.records.sale) || [];
  const inv = m.inventory || {};
  const area = m.area || {};
  const coll = m.collections || {};
  const unsold = m.unsold || {};
  const pricing = m.pricing || {};

  bannerTitle(sheet, kit, ctx, 'Sales & Collections', LAST_COL);
  subtitle(sheet, kit, 2, LAST_COL,
    `Plotted / free-sale inventory and collections as of ${slice.asOfDate || 'n/a'} — ${(m.counts || {}).total || rows.length} unit(s). `
    + 'Agreement value governs when entered, else base × area + charges. Cancelled units are excluded from all metrics.');

  let r = 4;
  sectionBanner(sheet, kit, r, LAST_COL, 'Committed register metrics (governs at IC)'); r += 1;
  governsNote(sheet, kit, r, LAST_COL,
    'Deterministic sell-through, collections and mark-to-market from the deal register. Static by design; the inventory '
    + 'table below recomputes live.'); r += 1;
  r = committedGrid(sheet, kit, r, [
    { label: 'Units (active)', value: inv.totalUnits, format: kit.NUMBER_FORMATS.integer },
    { label: 'Sold units', value: inv.soldUnits, format: kit.NUMBER_FORMATS.integer },
    { label: 'Sell-through by count', value: inv.sellThroughByCountPct, format: kit.NUMBER_FORMATS.percent, pct: true },
    { label: 'Sell-through by area', value: area.sellThroughByAreaPct, format: kit.NUMBER_FORMATS.percent, pct: true },
    { label: 'Sold GDV (₹ Cr)', value: coll.soldGDV, format: kit.NUMBER_FORMATS.currency, cr: true },
    { label: 'Collected (₹ Cr)', value: coll.collected, format: kit.NUMBER_FORMATS.currency, cr: true },
    { label: 'Receivable (₹ Cr)', value: coll.receivable, format: kit.NUMBER_FORMATS.currency, cr: true },
    { label: 'Overdue (₹ Cr)', value: coll.overdue, format: kit.NUMBER_FORMATS.currency, cr: true },
    { label: 'Collection efficiency', value: coll.collectionEfficiencyPct, format: kit.NUMBER_FORMATS.percent, pct: true },
    { label: 'Avg sold rate (₹/sqft)', value: pricing.avgSoldBaseRatePerSqft, format: kit.NUMBER_FORMATS.integer },
    { label: 'Unsold GDV @ market (₹ Cr)', value: unsold.unsoldGDV, format: kit.NUMBER_FORMATS.currency, cr: true },
    { label: 'Unsold mark-to-market', value: unsold.unsoldMtmPct, format: kit.NUMBER_FORMATS.percent, pct: true },
  ]);
  r += 1;

  const headerRow = r;
  tableHeader(sheet, kit, headerRow,
    ['Plot / Unit', 'Block / Phase', 'Type', 'Customer', 'Status', 'Area (sqft)', 'Base ₹/sqft',
      'Charges (₹)', 'Agreement (₹)', 'Collected (₹)', 'Overdue (₹)', 'Coll %', 'Market ₹/sqft']);
  r += 1;
  const firstDataRow = r;
  rows.forEach((rec) => {
    const sold = SOLD_SALE_STATUSES.has(rec.status);
    putText(kit, sheet.getCell(r, 1), rec.record_label);
    putText(kit, sheet.getCell(r, 2), rec.block_phase);
    putText(kit, sheet.getCell(r, 3), rec.unit_type);
    putText(kit, sheet.getCell(r, 4), rec.customer_name);
    putText(kit, sheet.getCell(r, 5), SALE_STATUS_LABEL[rec.status] || rec.status);
    putInput(kit, sheet.getCell(r, 6), rec.area_sqft, kit.NUMBER_FORMATS.integer);
    putInput(kit, sheet.getCell(r, 7), rec.base_price_per_sqft, kit.NUMBER_FORMATS.integer);
    putValue(kit, sheet.getCell(r, 8), rec.other_charges_amount, kit.NUMBER_FORMATS.integer);
    // Agreement value: stored governs; else derived live from area × base + charges.
    const areaRef = `$${colLetter(6)}${r}`;
    const baseRef = `$${colLetter(7)}${r}`;
    const chargesRef = `$${colLetter(8)}${r}`;
    if (isNum(rec.agreement_value)) {
      putValue(kit, sheet.getCell(r, 9), rec.agreement_value, kit.NUMBER_FORMATS.integer);
    } else {
      putFormula(kit, sheet.getCell(r, 9), `=${areaRef}*${baseRef}+N(${chargesRef})`, kit.NUMBER_FORMATS.integer);
    }
    putInput(kit, sheet.getCell(r, 10), rec.amount_collected, kit.NUMBER_FORMATS.integer);
    putValue(kit, sheet.getCell(r, 11), rec.amount_overdue, kit.NUMBER_FORMATS.integer);
    // Collection % = collected ÷ agreement, sold rows only.
    if (sold) {
      const agrRef = `$${colLetter(9)}${r}`;
      const colRef = `$${colLetter(10)}${r}`;
      putFormula(kit, sheet.getCell(r, 12), `=IFERROR(${colRef}/${agrRef},"–")`, kit.NUMBER_FORMATS.percent);
    } else {
      putText(kit, sheet.getCell(r, 12), '–', { right: true });
    }
    putValue(kit, sheet.getCell(r, 13), rec.current_market_rate, kit.NUMBER_FORMATS.integer);
    zebra(sheet, kit, r, LAST_COL);
    r += 1;
  });
  const lastDataRow = r - 1;

  r += 1;
  r = reconciliationStrip(sheet, kit, r, LAST_COL, {
    label: 'Sold GDV',
    committedValue: coll.soldGDV,
    // Sum agreement value across SOLD rows (col I where col L, coll %, is numeric).
    liveTotalRef: lastDataRow >= firstDataRow
      ? `SUMIF(${colLetter(12)}${firstDataRow}:${colLetter(12)}${lastDataRow},"<>–",${colLetter(9)}${firstDataRow}:${colLetter(9)}${lastDataRow})`
      : '0',
    cr: true,
  });

  r += 1;
  provenanceFooter(sheet, kit, r, LAST_COL, ctx, slice);
  return sheet;
};

// ─────────────────────────────────────────────────────────────────────────────
// Hotel operating → "Operating Roll"
// ─────────────────────────────────────────────────────────────────────────────

const buildHotelRegisterSheet = (workbook, ctx, kit, slice) => {
  const LAST_COL = 9; // A..I
  const sheet = workbook.addWorksheet(kit.SHEETS.registerHotel, {
    views: [{ showGridLines: false, state: 'frozen', xSplit: 1, ySplit: 2 }],
  });
  sheet.columns = [
    { width: 20 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 15 }, { width: 15 },
    { width: 15 }, { width: 13 }, { width: 15 },
  ];

  const m = slice.metrics || {};
  const keys = m.keys || {};
  const contract = m.contract || {};
  const op = m.operating || {};
  const records = slice.records || {};
  const blocks = records.hotel_key_block || [];
  const contracts = records.hotel_contract || [];
  const series = Array.isArray(op.series) ? op.series : [];

  bannerTitle(sheet, kit, ctx, 'Operating Roll', LAST_COL);
  subtitle(sheet, kit, 2, LAST_COL,
    `Key inventory, management contract and actual monthly trading as of ${slice.asOfDate || 'n/a'}. `
    + `Trailing-twelve-month metrics summarise how the asset trades (${op.basis === 'room_nights' ? 'room-night weighted' : 'stored-average basis'}); the model forecasts forward.`);

  const contractText = contract.primaryType
    ? `${CONTRACT_TYPE_LABEL[contract.primaryType] || contract.primaryType}${contract.operator ? ` · ${contract.operator}` : ''}${contract.brand ? ` (${contract.brand})` : ''}`
    : (contracts.length ? 'Recorded' : 'None recorded');
  const mixParts = [];
  if (isNum(op.fbRevPct)) mixParts.push(`F&B ${Number(op.fbRevPct).toFixed(0)}%`);
  if (isNum(op.otherRevPct)) mixParts.push(`Other ${Number(op.otherRevPct).toFixed(0)}%`);

  let r = 4;
  sectionBanner(sheet, kit, r, LAST_COL, 'Committed register metrics (governs at IC)'); r += 1;
  governsNote(sheet, kit, r, LAST_COL,
    'Deterministic key inventory and trailing-twelve-month operating metrics from the actual monthly P&L. '
    + 'Occupancy and ADR are room-night weighted. Static by design.'); r += 1;
  r = committedGrid(sheet, kit, r, [
    { label: 'Total keys', value: keys.totalKeys, format: kit.NUMBER_FORMATS.integer },
    { label: 'Available keys (net OOO)', value: keys.availableKeys, format: '#,##0.0' },
    { label: 'Room types', value: keys.roomTypes, format: kit.NUMBER_FORMATS.integer },
    { label: 'Governing contract', text: contractText },
    { label: 'TTM occupancy', value: op.ttmOccupancyPct, format: kit.NUMBER_FORMATS.percent, pct: true },
    { label: 'TTM ADR (₹)', value: op.ttmAdr, format: kit.NUMBER_FORMATS.integer },
    { label: 'TTM RevPAR (₹)', value: op.ttmRevpar, format: kit.NUMBER_FORMATS.integer },
    { label: 'TTM GOP margin', value: op.ttmGopMarginPct, format: kit.NUMBER_FORMATS.percent, pct: true },
    { label: 'TTM total revenue (₹ Cr)', value: op.ttmTotalRevenue, format: kit.NUMBER_FORMATS.currency, cr: true },
    { label: 'TTM owner NOI (₹ Cr)', value: op.ttmOwnerNoi, format: kit.NUMBER_FORMATS.currency, cr: true },
    { label: 'Months of actuals', value: op.monthsCovered, format: kit.NUMBER_FORMATS.integer },
    { label: 'Revenue mix (of rooms)', text: mixParts.length ? mixParts.join(' · ') : '–' },
  ]);
  r += 1;

  // Key inventory table.
  if (blocks.length) {
    sectionBanner(sheet, kit, r, LAST_COL, 'Key inventory'); r += 1;
    tableHeader(sheet, kit, r, ['Room type', 'Keys', 'Status', 'OOO %', 'ADR premium', 'Floor / Wing', 'Available', '', '']);
    r += 1;
    blocks.forEach((b) => {
      putText(kit, sheet.getCell(r, 1), b.room_type);
      putInput(kit, sheet.getCell(r, 2), b.keys_count, kit.NUMBER_FORMATS.integer);
      putText(kit, sheet.getCell(r, 3), b.operational === false ? 'Out of service' : 'Operational', { right: true });
      putValue(kit, sheet.getCell(r, 4), b.ooo_pct, kit.NUMBER_FORMATS.percent, { pct: true });
      putValue(kit, sheet.getCell(r, 5), b.adr_premium_pct, kit.NUMBER_FORMATS.percent, { pct: true });
      putText(kit, sheet.getCell(r, 6), b.floor_wing, { right: true });
      // Available keys = keys × (1 − OOO%) when operational, else 0.
      const keyRef = `$${colLetter(2)}${r}`;
      const oooRef = `$${colLetter(4)}${r}`;
      putFormula(kit, sheet.getCell(r, 7),
        b.operational === false ? '=0' : `=${keyRef}*(1-N(${oooRef}))`, '#,##0.0');
      zebra(sheet, kit, r, LAST_COL);
      r += 1;
    });
    r += 1;
  }

  // Management contract summary.
  if (contracts.length) {
    sectionBanner(sheet, kit, r, LAST_COL, 'Management contract'); r += 1;
    tableHeader(sheet, kit, r, ['Contract', 'Operator', 'Brand', 'Type', 'Base fee', 'Incentive', 'FF&E', 'Keys', 'Term end']);
    r += 1;
    contracts.forEach((c) => {
      putText(kit, sheet.getCell(r, 1), c.record_label);
      putText(kit, sheet.getCell(r, 2), c.operator_name);
      putText(kit, sheet.getCell(r, 3), c.brand);
      putText(kit, sheet.getCell(r, 4), CONTRACT_TYPE_LABEL[c.contract_type] || c.contract_type, { right: true });
      putValue(kit, sheet.getCell(r, 5), c.base_fee_pct, kit.NUMBER_FORMATS.percent, { pct: true });
      putValue(kit, sheet.getCell(r, 6), c.incentive_fee_pct, kit.NUMBER_FORMATS.percent, { pct: true });
      putValue(kit, sheet.getCell(r, 7), c.ffe_reserve_pct, kit.NUMBER_FORMATS.percent, { pct: true });
      putValue(kit, sheet.getCell(r, 8), c.keys_covered, kit.NUMBER_FORMATS.integer);
      putDate(kit, sheet.getCell(r, 9), c.end_date);
      zebra(sheet, kit, r, LAST_COL);
      r += 1;
    });
    r += 1;
  }

  // Operating history (actual monthly trading).
  if (series.length) {
    sectionBanner(sheet, kit, r, LAST_COL, 'Operating history — actual monthly P&L'); r += 1;
    tableHeader(sheet, kit, r, ['Month', 'Occupancy', 'ADR (₹)', 'RevPAR (₹)', 'Room rev (₹)', 'F&B (₹)', 'Other (₹)', 'GOP (₹)', 'Owner NOI (₹)']);
    r += 1;
    const firstMonthRow = r;
    series.forEach((s) => {
      putText(kit, sheet.getCell(r, 1), s.month);
      putInput(kit, sheet.getCell(r, 2), isNum(s.occupancyPct) ? Number(s.occupancyPct) / 100 : null, kit.NUMBER_FORMATS.percent);
      putInput(kit, sheet.getCell(r, 3), s.adr, kit.NUMBER_FORMATS.integer);
      // RevPAR = ADR × occupancy (live).
      const occRef = `$${colLetter(2)}${r}`;
      const adrRef = `$${colLetter(3)}${r}`;
      putFormula(kit, sheet.getCell(r, 4), `=${adrRef}*${occRef}`, kit.NUMBER_FORMATS.integer);
      putValue(kit, sheet.getCell(r, 5), s.roomRevenue, kit.NUMBER_FORMATS.integer);
      putValue(kit, sheet.getCell(r, 6), s.fnbRevenue, kit.NUMBER_FORMATS.integer);
      putValue(kit, sheet.getCell(r, 7), s.otherRevenue, kit.NUMBER_FORMATS.integer);
      putValue(kit, sheet.getCell(r, 8), s.gop, kit.NUMBER_FORMATS.integer);
      putValue(kit, sheet.getCell(r, 9), s.ownerNoi, kit.NUMBER_FORMATS.integer);
      zebra(sheet, kit, r, LAST_COL);
      r += 1;
    });
    const lastMonthRow = r - 1;

    r += 1;
    r = reconciliationStrip(sheet, kit, r, LAST_COL, {
      label: 'TTM total revenue',
      committedValue: op.ttmTotalRevenue,
      liveTotalRef: `SUM(${colLetter(5)}${firstMonthRow}:${colLetter(7)}${lastMonthRow})`,
      cr: true,
    });
  }

  r += 1;
  provenanceFooter(sheet, kit, r, LAST_COL, ctx, slice);
  return sheet;
};

// ─────────────────────────────────────────────────────────────────────────────
// Redevelopment → "Occupants & Sales" (occupant obligations + free-sale reuse)
// ─────────────────────────────────────────────────────────────────────────────

const buildOccupantRegisterSheet = (workbook, ctx, kit, slice) => {
  const LAST_COL = 12; // A..L
  const sheet = workbook.addWorksheet(kit.SHEETS.registerOccupants, {
    views: [{ showGridLines: false, state: 'frozen', xSplit: 1, ySplit: 2 }],
  });
  sheet.columns = [
    { width: 18 }, { width: 14 }, { width: 18 }, { width: 12 }, { width: 12 }, { width: 13 },
    { width: 13 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 11 },
  ];

  // metricsForFamily('redevelopment') returns { occupant, sale }.
  const m = slice.metrics || {};
  const occ = m.occupant || {};
  const sale = m.sale || {};
  const records = slice.records || {};
  const occupants = records.occupant || [];
  const freeSale = records.sale || [];

  const vac = occ.vacancy || {};
  const ent = occ.entitlement || {};
  const obl = occ.obligations || {};
  const risk = occ.risk || {};

  bannerTitle(sheet, kit, ctx, 'Occupants & Sales', LAST_COL);
  subtitle(sheet, kit, 2, LAST_COL,
    `Existing occupiers, their rehousing obligations, and free-sale inventory as of ${slice.asOfDate || 'n/a'} — `
    + `${(occ.counts || {}).total || occupants.length} occupier(s), ${(sale.counts || {}).total || freeSale.length} free-sale unit(s). `
    + 'Figures are gross; the model nets any ownership share downstream.');

  let r = 4;
  sectionBanner(sheet, kit, r, LAST_COL, 'Committed register metrics (governs at IC)'); r += 1;
  governsNote(sheet, kit, r, LAST_COL,
    'Deterministic vacation progress, free-rehab area and rehousing obligation from the deal register, plus free-sale '
    + 'collections. Static by design; the tables below recompute live.'); r += 1;
  r = committedGrid(sheet, kit, r, [
    { label: 'Vacation progress (by count)', value: vac.vacatedByCountPct, format: kit.NUMBER_FORMATS.percent, pct: true },
    { label: 'Vacation progress (by area)', value: vac.vacatedByAreaPct, format: kit.NUMBER_FORMATS.percent, pct: true },
    { label: 'Existing carpet (sqft)', value: ent.existingCarpetSqft, format: kit.NUMBER_FORMATS.integer },
    { label: 'Free rehab area (sqft)', value: ent.rehabEntitlementSqft, format: kit.NUMBER_FORMATS.integer },
    { label: 'Additional / fungible (sqft)', value: ent.additionalAreaSqft, format: kit.NUMBER_FORMATS.integer },
    { label: 'Area uplift over existing', value: ent.avgUpliftPct, format: kit.NUMBER_FORMATS.percent, pct: true },
    { label: 'Current transit run-rate (₹/mo)', value: obl.currentMonthlyTransitRent, format: kit.NUMBER_FORMATS.integer },
    { label: 'Transit remaining (₹ Cr)', value: obl.transitRentRemaining, format: kit.NUMBER_FORMATS.currency, cr: true },
    { label: 'One-time obligations (₹ Cr)', value: obl.oneTimeTotal, format: kit.NUMBER_FORMATS.currency, cr: true },
    { label: 'Total rehousing obligation (₹ Cr)', value: obl.totalRehousingObligation, format: kit.NUMBER_FORMATS.currency, cr: true },
    { label: 'At-risk occupiers', value: risk.atRiskUnits, format: kit.NUMBER_FORMATS.integer },
    { label: 'High doc-risk · disputed', text: `${risk.highRiskUnits || 0} high · ${risk.disputedUnits || 0} disputed` },
  ]);
  // Free-sale one-liner.
  sheet.mergeCells(r, 1, r, LAST_COL);
  sheet.getCell(r, 1).value = freeSale.length
    ? `Free sale: ${(sale.inventory || {}).soldUnits || 0}/${(sale.inventory || {}).totalUnits || 0} units sold · `
      + `sold GDV ₹${(((sale.collections || {}).soldGDV || 0) / PAISE_PER_CR).toFixed(2)} Cr · `
      + `collection ${isNum((sale.collections || {}).collectionEfficiencyPct) ? Number(sale.collections.collectionEfficiencyPct).toFixed(0) : '–'}%.`
    : 'No free-sale inventory recorded yet.';
  sheet.getCell(r, 1).font = { name: kit.FONT, size: 9, italic: true, color: { argb: kit.palette.xlsx('mutedLow') } };
  sheet.getCell(r, 1).protection = { locked: true };
  r += 2;

  // Occupants table.
  sectionBanner(sheet, kit, r, LAST_COL, 'Existing occupiers & rehousing obligations'); r += 1;
  tableHeader(sheet, kit, r,
    ['Unit / Ref', 'Building', 'Occupant', 'Status', 'Existing (sqft)', 'Rehab (sqft)', 'Transit ₹/mo',
      'Shifting (₹)', 'Brokerage (₹)', 'Corpus (₹)', 'Other (₹)', 'Doc risk']);
  r += 1;
  const firstOccRow = r;
  occupants.forEach((rec) => {
    putText(kit, sheet.getCell(r, 1), rec.record_label);
    putText(kit, sheet.getCell(r, 2), rec.building);
    putText(kit, sheet.getCell(r, 3), rec.occupant_name);
    putText(kit, sheet.getCell(r, 4), OCCUPANT_STATUS_LABEL[rec.status] || rec.status);
    putValue(kit, sheet.getCell(r, 5), rec.existing_carpet_area_sqft, kit.NUMBER_FORMATS.integer);
    putValue(kit, sheet.getCell(r, 6), rec.rehab_entitlement_sqft, kit.NUMBER_FORMATS.integer);
    putInput(kit, sheet.getCell(r, 7), rec.transit_rent_monthly, kit.NUMBER_FORMATS.integer);
    putInput(kit, sheet.getCell(r, 8), rec.shifting_allowance, kit.NUMBER_FORMATS.integer);
    putInput(kit, sheet.getCell(r, 9), rec.brokerage_amount, kit.NUMBER_FORMATS.integer);
    putInput(kit, sheet.getCell(r, 10), rec.corpus_amount, kit.NUMBER_FORMATS.integer);
    putInput(kit, sheet.getCell(r, 11), rec.other_obligation_amount, kit.NUMBER_FORMATS.integer);
    putText(kit, sheet.getCell(r, 12), RISK_LABEL[rec.documentation_risk] || '–', { right: true });
    zebra(sheet, kit, r, LAST_COL);
    r += 1;
  });
  const lastOccRow = r - 1;
  // One-time obligations live total (shifting + brokerage + corpus, per row summed).
  if (lastOccRow >= firstOccRow) {
    r += 1;
    r = reconciliationStrip(sheet, kit, r, LAST_COL, {
      label: 'One-time obligations',
      committedValue: obl.oneTimeTotal,
      liveTotalRef: `SUM(${colLetter(8)}${firstOccRow}:${colLetter(11)}${lastOccRow})`,
      cr: true,
    });
  }
  r += 1;

  // Free-sale inventory table (reuses the sale record shape).
  if (freeSale.length) {
    sectionBanner(sheet, kit, r, LAST_COL, 'Free-sale inventory & collections'); r += 1;
    tableHeader(sheet, kit, r,
      ['Unit', 'Block / Phase', 'Customer', 'Status', 'Area (sqft)', 'Base ₹/sqft', 'Agreement (₹)',
        'Collected (₹)', 'Overdue (₹)', 'Market ₹/sqft', '', '']);
    r += 1;
    freeSale.forEach((rec) => {
      putText(kit, sheet.getCell(r, 1), rec.record_label);
      putText(kit, sheet.getCell(r, 2), rec.block_phase);
      putText(kit, sheet.getCell(r, 3), rec.customer_name);
      putText(kit, sheet.getCell(r, 4), SALE_STATUS_LABEL[rec.status] || rec.status);
      putValue(kit, sheet.getCell(r, 5), rec.area_sqft, kit.NUMBER_FORMATS.integer);
      putValue(kit, sheet.getCell(r, 6), rec.base_price_per_sqft, kit.NUMBER_FORMATS.integer);
      putValue(kit, sheet.getCell(r, 7), isNum(rec.agreement_value)
        ? rec.agreement_value
        : (isNum(rec.base_price_per_sqft) && isNum(rec.area_sqft)
          ? Number(rec.base_price_per_sqft) * Number(rec.area_sqft) + (Number(rec.other_charges_amount) || 0)
          : null), kit.NUMBER_FORMATS.integer);
      putValue(kit, sheet.getCell(r, 8), rec.amount_collected, kit.NUMBER_FORMATS.integer);
      putValue(kit, sheet.getCell(r, 9), rec.amount_overdue, kit.NUMBER_FORMATS.integer);
      putValue(kit, sheet.getCell(r, 10), rec.current_market_rate, kit.NUMBER_FORMATS.integer);
      zebra(sheet, kit, r, LAST_COL);
      r += 1;
    });
    r += 1;
  }

  provenanceFooter(sheet, kit, r, LAST_COL, ctx, slice);
  return sheet;
};

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch
// ─────────────────────────────────────────────────────────────────────────────

const FAMILY_BUILDERS = {
  lease_income: buildLeaseRegisterSheet,
  sales_collections: buildSalesRegisterSheet,
  hotel_operating: buildHotelRegisterSheet,
  redevelopment: buildOccupantRegisterSheet,
};

/**
 * Add the deal-register worksheet to the workbook, if the deal has one with
 * records. Family-adaptive: exactly one sheet per deal.
 *
 * @param {ExcelJS.Workbook} workbook
 * @param {object} ctx    prepared workbook context (ctx.exportContext.rentRoll is the slice)
 * @param {object} kit    injected style/format primitives from buildWorkbook.js
 * @returns {ExcelJS.Worksheet|null}
 */
const buildRegisterSheets = (workbook, ctx, kit) => {
  const slice = ctx && ctx.exportContext && ctx.exportContext.rentRoll;
  if (!slice || !slice.family) return null;
  if (countRecords(slice.records) === 0) return null; // empty register → no tab (mirror Site Yield / Comps auto-hide)
  const builder = FAMILY_BUILDERS[slice.family];
  if (!builder) return null;
  return builder(workbook, ctx, kit, slice);
};

module.exports = {
  buildRegisterSheets,
  // Exported for unit tests.
  __internal: {
    countRecords,
    buildLeaseRegisterSheet,
    buildSalesRegisterSheet,
    buildHotelRegisterSheet,
    buildOccupantRegisterSheet,
    FAMILY_BUILDERS,
  },
};
