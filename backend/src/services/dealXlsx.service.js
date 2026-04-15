'use strict';

const ExcelJS = require('exceljs');
const { inferAssetClass } = require('../utils/assetClass');

const FONT = 'Arial';

const COLORS = {
  navy: '1F3A5F',
  white: 'FFFFFF',
  paper: 'FBF9F6',
  line: 'D7DDE5',
  text: '1F2933',
  muted: '52606D',
  inputFill: 'FFF2CC',
  inputBlue: '0000FF',
  linkGreen: '008000',
  warningRed: 'C00000',
  accent: '8C6677',
  sand: 'E9DFC9',
  lightBlue: 'EAF2F8',
};

const SHEETS = {
  cover: '00_Cover',
  summary: '01_Executive_Summary',
  assumptions: '02_Key_Assumptions',
  scenarios: '03_Scenarios',
  area: '04_Area_Unit_Mix',
  revenue: '05_Revenue',
  costs: '06_Costs',
  phasingDevelopment: '07_Development_Phasing',
  phasingLease: '07_Lease_Phasing',
  cashFlow: '08_Cash_Flow',
  debt: '09_Debt_and_Security',
  returns: '10_Returns',
  sensitivity: '11_Sensitivity',
  charts: '12_Charts',
  audit: '13_Audit_Checks',
};

const ASSET_LABELS = {
  residential_apartments: 'Apartment',
  plotted_development: 'Plotted Development',
  villas: 'Villa',
  commercial_office: 'Office',
  retail: 'Retail',
  industrial_warehousing: 'Warehouse / Industrial',
  hospitality: 'Hospitality',
  mixed_use: 'Mixed Use',
  raw_land: 'Land',
  redevelopment: 'Redevelopment',
};

const DEAL_TYPE_LABELS = {
  acquisition: 'Acquisition',
  outright: 'Outright Purchase',
  jv: 'Joint Venture',
  jda: 'Joint Development',
  da: 'Development Agreement',
  debt: 'Debt Raise',
  lease: 'Lease Yield',
};

const SUMMARY_NUM_FMT = '#,##0.00;[Red](#,##0.00);-';
const PCT_FMT = '0.0%;[Red](0.0%);-';
const INT_FMT = '#,##0;[Red](#,##0);-';
const RETURNS_ROWS = {
  totalRevenue: 4,
  totalCost: 5,
  grossProfit: 6,
  grossMargin: 7,
  projectIrr: 8,
  equityIrr: 9,
  equityMultiple: 10,
  yieldOnCost: 11,
  exitValue: 12,
  netValueGain: 13,
  totalDebt: 14,
  minDscr: 15,
  securityCover: 16,
};
const DEBT_ROWS = {
  loanAsk: 4,
  opening: 5,
  draw: 6,
  interest: 7,
  principal: 8,
  closing: 9,
  debtService: 10,
  dscr: 11,
  security: 12,
};

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const str = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const textOrNull = (...values) => {
  for (const value of values) {
    const parsed = str(value);
    if (parsed) return parsed;
  }
  return null;
};

const firstNumber = (...values) => {
  for (const value of values) {
    const parsed = num(value);
    if (parsed !== null) return parsed;
  }
  return null;
};

const round = (value, decimals = 2) => {
  const parsed = num(value);
  if (parsed === null) return null;
  const factor = 10 ** decimals;
  return Math.round(parsed * factor) / factor;
};

const columnLetter = (index) => {
  let value = Number(index);
  let output = '';
  while (value > 0) {
    const modulo = (value - 1) % 26;
    output = String.fromCharCode(65 + modulo) + output;
    value = Math.floor((value - modulo) / 26);
  }
  return output;
};

const toTitle = (value) =>
  str(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());

const getPeriodScale = (label) => (/q[1-4]/i.test(str(label)) ? 4 : 1);

const makePeriods = (exportContext, inputs) => {
  const quarterly = Array.isArray(exportContext?.cashFlows?.quarterly)
    ? exportContext.cashFlows.quarterly.filter((row) => row && row.label)
    : [];
  if (quarterly.length) {
    return quarterly.map((row, index) => ({
      key: `Q${index + 1}`,
      label: str(row.label),
      positiveWeight: Math.max(0, num(row.net) || 0),
      negativeWeight: Math.max(0, -(num(row.net) || 0)),
      frequency: 4,
    }));
  }

  const yearly = Array.isArray(exportContext?.cashFlows?.yearly)
    ? exportContext.cashFlows.yearly.filter((row) => row && (row.label || row.period_label))
    : [];
  if (yearly.length) {
    return yearly.map((row, index) => ({
      key: `Y${index + 1}`,
      label: str(row.label || row.period_label || `Year ${index + 1}`),
      positiveWeight: Math.max(0, num(row.net) || 0),
      negativeWeight: Math.max(0, -(num(row.net) || 0)),
      frequency: 1,
    }));
  }

  const durationMonths = firstNumber(
    inputs.projectDurationMonths,
    inputs.projectDurationYears ? inputs.projectDurationYears * 12 : null,
    exportContext?.deal?.project_duration_months,
    36,
  );
  const periods = Math.max(1, Math.ceil((durationMonths || 12) / 12));
  return Array.from({ length: periods }, (_, index) => ({
    key: `Y${index + 1}`,
    label: `Year ${index + 1}`,
    positiveWeight: null,
    negativeWeight: null,
    frequency: 1,
  }));
};

const makeWeightVector = (periods, key) => {
  const values = periods.map((period) => num(period[key]));
  const total = values.reduce((sum, value) => sum + (value || 0), 0);
  if (!total) return periods.map(() => null);
  return values.map((value) => round((value || 0) / total, 6));
};

const classifyDealFamily = (assetClass, dealType) => {
  const normalizedDealType = str(dealType).toLowerCase();
  if (assetClass === 'hospitality') return 'hospitality';
  if (['commercial_office', 'retail', 'industrial_warehousing'].includes(assetClass)) return 'income';
  if (['debt', 'loan'].includes(normalizedDealType)) return 'debt';
  return 'development';
};

const buildWorkbookContext = (exportContext, options = {}) => {
  const deal = { ...(exportContext?.deal || {}) };
  const property = { ...(exportContext?.property || {}) };
  const inputs = { ...((deal.model_params && deal.model_params.inputs) || {}), ...(options.inputs || {}) };
  const assetClass = inferAssetClass({
    deal: {
      ...deal,
      property_type: property.property_type || deal.property_type,
      zoning: property.zoning || deal.zoning,
      property_name: property.property_name || deal.property_name,
      property_notes: property.notes || deal.property_notes,
    },
    inputs,
  });
  const dealFamily = classifyDealFamily(assetClass, deal.deal_type);
  const phasingSheetName = dealFamily === 'development' ? SHEETS.phasingDevelopment : SHEETS.phasingLease;
  const periods = makePeriods(exportContext || {}, inputs);
  const revenueWeights = makeWeightVector(periods, 'positiveWeight');
  const costWeights = makeWeightVector(periods, 'negativeWeight');
  const generatedAt = options.generatedAt || exportContext?.generatedAt || new Date().toISOString();
  const brandName = options.brandName || 'REDIP';

  const area = {
    landAreaSqft: firstNumber(property.land_area_sqft, deal.land_area_sqft, inputs.plotAreaSqft),
    builtUpAreaSqft: firstNumber(property.built_up_area_sqft, deal.gross_area_sqft, inputs.builtUpAreaSqft),
    saleableAreaSqft: firstNumber(property.saleable_area_sqft, deal.saleable_area_sqft, deal.super_builtup_area_sqft, inputs.saleableAreaSqft),
    grossAreaSqft: firstNumber(deal.gross_area_sqft, property.built_up_area_sqft, inputs.grossAreaSqft),
    carpetAreaSqft: firstNumber(deal.carpet_area_sqft, inputs.carpetAreaSqft),
    leasableAreaSqft: firstNumber(inputs.leasableAreaSqft, property.saleable_area_sqft, deal.saleable_area_sqft, deal.super_builtup_area_sqft),
    units: firstNumber(inputs.units, inputs.unitCount, inputs.keysOrUnitsOrGla),
    keys: firstNumber(inputs.keys, inputs.keyCount),
  };

  const metrics = {
    sellRatePerSqft: firstNumber(inputs.sellingRatePerSqft, deal.selling_rate_per_sqft),
    baseRentPerSqftMonth: firstNumber(inputs.baseRentPerSqftMonth, inputs.rentPerSqftMonth),
    occupancyPct: firstNumber(inputs.occupancyPct, deal.occupancy_pct),
    vacancyPct: firstNumber(inputs.vacancyPct),
    adr: firstNumber(inputs.adr, inputs.arr),
    fbRevenuePct: firstNumber(inputs.fbRevPct),
    otherRevenuePct: firstNumber(inputs.otherRevPct),
    constructionCostPerSqft: firstNumber(inputs.constructionCostPerSqft, deal.construction_cost_per_sqft),
    constructionCostPerKey: firstNumber(inputs.constructionCostPerKey),
    landCostCr: firstNumber(inputs.landCostCr, deal.land_cost_cr),
    approvalCostCr: firstNumber(inputs.approvalCostCr, deal.approval_cost_cr),
    marketingCostPct: firstNumber(inputs.marketingCostPct),
    financeCostPct: firstNumber(inputs.financeCostPct),
    opexPct: firstNumber(inputs.opexPct),
    gstPct: firstNumber(inputs.gstPct, inputs.gstRatePct),
    stampDutyPct: firstNumber(inputs.stampDutyPct),
    debtPct: firstNumber(inputs.debtLTV, inputs.debtPct, inputs.debtCoverage),
    debtRatePct: firstNumber(inputs.debtRatePct, inputs.interestRatePct),
    moratoriumMonths: firstNumber(inputs.moratoriumMonths),
    exitCapRate: firstNumber(inputs.exitCapRate, inputs.capRate, inputs.entryCapRate),
    holdPeriodYears: firstNumber(inputs.holdPeriodYears),
    projectDurationMonths: firstNumber(inputs.projectDurationMonths, deal.project_duration_months),
    salesVelocityPct: firstNumber(inputs.salesVelocityPct, inputs.absorptionPct),
    collectionPct: firstNumber(inputs.customerCollectionPct),
    escalationPct: firstNumber(inputs.rentEscalationPct, inputs.pricingEscalationPct, inputs.adrGrowthPct),
    discountRatePct: firstNumber(inputs.discountRatePct, deal.discount_rate_pct),
    developerMarginPct: firstNumber(inputs.developerMarginPct, deal.developer_margin_pct),
  };

  return {
    exportContext,
    brandName,
    generatedAt,
    deal,
    property,
    inputs,
    assetClass,
    assetLabel: ASSET_LABELS[assetClass] || toTitle(assetClass),
    dealTypeLabel: DEAL_TYPE_LABELS[str(deal.deal_type).toLowerCase()] || toTitle(deal.deal_type || 'Deal'),
    dealFamily,
    phasingSheetName,
    periods,
    periodScale: getPeriodScale(periods[0]?.label),
    revenueWeights,
    costWeights,
    area,
    metrics,
    sheetRefs: {},
  };
};

const makeSheet = (workbook, name, headerSize = 11) => {
  const sheet = workbook.addWorksheet(name, {
    views: [{ showGridLines: false }],
    properties: { defaultRowHeight: 18 },
  });
  sheet.properties.defaultColWidth = 14;
  sheet.getRow(1).font = { name: FONT, size: headerSize, bold: true, color: { argb: COLORS.white } };
  return sheet;
};

const styleCell = (cell, style) => {
  if (style.font) cell.font = { name: FONT, ...style.font };
  if (style.fill) cell.fill = style.fill;
  if (style.alignment) cell.alignment = style.alignment;
  if (style.border) cell.border = style.border;
  if (style.numFmt) cell.numFmt = style.numFmt;
};

const applyRowFill = (row, color) => {
  row.eachCell((cell) => {
    styleCell(cell, {
      fill: {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: color },
      },
    });
  });
};

const makeSectionHeader = (sheet, rowNumber, title, span = 6) => {
  sheet.mergeCells(rowNumber, 1, rowNumber, span);
  const cell = sheet.getCell(rowNumber, 1);
  cell.value = title;
  styleCell(cell, {
    font: { size: 11, bold: true, color: { argb: COLORS.white } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } },
    alignment: { vertical: 'middle', horizontal: 'left' },
  });
  sheet.getRow(rowNumber).height = 20;
};

const setInputCell = (cell, value, numFmt = SUMMARY_NUM_FMT) => {
  cell.value = value === null || value === undefined ? null : value;
  styleCell(cell, {
    font: { size: 9, color: { argb: COLORS.inputBlue } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.inputFill } },
    alignment: { vertical: 'middle', horizontal: 'right' },
    numFmt,
  });
};

const setFormulaCell = (cell, formula, numFmt = SUMMARY_NUM_FMT, fontColor = COLORS.text) => {
  cell.value = { formula };
  styleCell(cell, {
    font: { size: 9, color: { argb: fontColor } },
    alignment: { vertical: 'middle', horizontal: 'right' },
    numFmt,
  });
};

const setLabelCell = (cell, value, bold = false) => {
  cell.value = value;
  styleCell(cell, {
    font: { size: 9, bold, color: { argb: COLORS.text } },
    alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
  });
};

const topBorder = {
  top: { style: 'thin', color: { argb: COLORS.navy } },
};

const buildAssumptionDefinitions = (context) => {
  const { dealFamily, area, metrics, deal } = context;

  const definitions = [
    { key: 'land_area_sqft', section: 'Area', label: 'Land Area', unit: 'sqft', value: area.landAreaSqft, driver: 'none', format: INT_FMT },
    { key: 'saleable_area_sqft', section: 'Area', label: dealFamily === 'income' ? 'Leasable / Chargeable Area' : 'Saleable Area', unit: 'sqft', value: dealFamily === 'income' ? area.leasableAreaSqft : area.saleableAreaSqft, driver: 'none', format: INT_FMT },
    { key: 'built_up_area_sqft', section: 'Area', label: 'Built-up / Gross Area', unit: 'sqft', value: area.builtUpAreaSqft || area.grossAreaSqft, driver: 'none', format: INT_FMT },
    { key: 'carpet_area_sqft', section: 'Area', label: 'Carpet Area', unit: 'sqft', value: area.carpetAreaSqft, driver: 'none', format: INT_FMT },
    { key: 'units_or_keys', section: 'Area', label: dealFamily === 'hospitality' ? 'Keys' : 'Units / Inventory Count', unit: 'count', value: dealFamily === 'hospitality' ? area.keys : area.units, driver: 'none', format: INT_FMT },
  ];

  if (dealFamily === 'development') {
    definitions.push(
      { key: 'sell_rate_psf', section: 'Commercial', label: 'Average Selling Price', unit: 'INR / sqft', value: metrics.sellRatePerSqft, driver: 'revenue_multiplier', format: SUMMARY_NUM_FMT },
      { key: 'sales_velocity_pct', section: 'Commercial', label: 'Sales / Absorption Pace', unit: '% of stock / period', value: metrics.salesVelocityPct, driver: 'duration_multiplier', format: PCT_FMT },
      { key: 'collection_pct', section: 'Commercial', label: 'Customer Collection Curve', unit: '% of revenue recognized', value: metrics.collectionPct, driver: 'none', format: PCT_FMT },
      { key: 'pricing_escalation_pct', section: 'Commercial', label: 'Pricing Escalation', unit: '% p.a.', value: metrics.escalationPct, driver: 'revenue_multiplier', format: PCT_FMT },
      { key: 'construction_cost_psf', section: 'Cost', label: 'Construction Cost', unit: 'INR / sqft', value: metrics.constructionCostPerSqft, driver: 'cost_multiplier', format: SUMMARY_NUM_FMT },
      { key: 'land_cost_cr', section: 'Cost', label: 'Land Cost', unit: 'INR Cr', value: metrics.landCostCr, driver: 'none', format: SUMMARY_NUM_FMT },
      { key: 'approval_cost_cr', section: 'Cost', label: 'Approvals / Statutory Cost', unit: 'INR Cr', value: metrics.approvalCostCr, driver: 'cost_multiplier', format: SUMMARY_NUM_FMT },
      { key: 'marketing_cost_pct', section: 'Cost', label: 'Marketing Cost', unit: '% of revenue', value: metrics.marketingCostPct, driver: 'cost_multiplier', format: PCT_FMT },
      { key: 'finance_cost_pct', section: 'Cost', label: 'Finance Cost', unit: '% of cost', value: metrics.financeCostPct, driver: 'finance_delta', format: PCT_FMT },
      { key: 'gst_pct', section: 'Tax', label: 'GST', unit: '%', value: metrics.gstPct, driver: 'none', format: PCT_FMT },
      { key: 'stamp_duty_pct', section: 'Tax', label: 'Stamp Duty / Registration', unit: '%', value: metrics.stampDutyPct, driver: 'none', format: PCT_FMT },
      { key: 'project_duration_months', section: 'Timing', label: 'Project Duration', unit: 'months', value: metrics.projectDurationMonths, driver: 'duration_multiplier', format: SUMMARY_NUM_FMT },
      { key: 'debt_pct', section: 'Debt', label: 'Debt as % of Cost', unit: '%', value: metrics.debtPct, driver: 'none', format: PCT_FMT },
      { key: 'debt_rate_pct', section: 'Debt', label: 'Debt Cost', unit: '% p.a.', value: metrics.debtRatePct, driver: 'finance_delta', format: PCT_FMT },
      { key: 'discount_rate_pct', section: 'Returns', label: 'Discount Rate', unit: '%', value: metrics.discountRatePct, driver: 'none', format: PCT_FMT },
      { key: 'developer_margin_pct', section: 'Returns', label: 'Target Margin', unit: '%', value: metrics.developerMarginPct, driver: 'none', format: PCT_FMT },
    );
  }

  if (dealFamily === 'income') {
    definitions.push(
      { key: 'base_rent_psf_pm', section: 'Commercial', label: 'Base Rent', unit: 'INR / sqft / month', value: metrics.baseRentPerSqftMonth, driver: 'revenue_multiplier', format: SUMMARY_NUM_FMT },
      { key: 'occupancy_pct', section: 'Commercial', label: 'Stabilized Occupancy', unit: '%', value: metrics.occupancyPct, driver: 'occupancy_delta', format: PCT_FMT },
      { key: 'vacancy_pct', section: 'Commercial', label: 'Vacancy', unit: '%', value: metrics.vacancyPct, driver: 'occupancy_delta_inverse', format: PCT_FMT },
      { key: 'escalation_pct', section: 'Commercial', label: 'Rent Escalation', unit: '%', value: metrics.escalationPct, driver: 'revenue_multiplier', format: PCT_FMT },
      { key: 'land_cost_cr', section: 'Cost', label: 'Acquisition / Land Cost', unit: 'INR Cr', value: metrics.landCostCr || deal.entry_value_cr, driver: 'none', format: SUMMARY_NUM_FMT },
      { key: 'construction_cost_psf', section: 'Cost', label: 'Capex / TI / Fit-out Cost', unit: 'INR / sqft', value: metrics.constructionCostPerSqft, driver: 'cost_multiplier', format: SUMMARY_NUM_FMT },
      { key: 'approval_cost_cr', section: 'Cost', label: 'Approvals / Closing Cost', unit: 'INR Cr', value: metrics.approvalCostCr, driver: 'cost_multiplier', format: SUMMARY_NUM_FMT },
      { key: 'opex_pct', section: 'Cost', label: 'Operating Expense Ratio', unit: '% of revenue', value: metrics.opexPct, driver: 'cost_multiplier', format: PCT_FMT },
      { key: 'debt_pct', section: 'Debt', label: 'Debt as % of Cost', unit: '%', value: metrics.debtPct, driver: 'none', format: PCT_FMT },
      { key: 'debt_rate_pct', section: 'Debt', label: 'Debt Cost', unit: '% p.a.', value: metrics.debtRatePct, driver: 'finance_delta', format: PCT_FMT },
      { key: 'moratorium_months', section: 'Debt', label: 'Moratorium', unit: 'months', value: metrics.moratoriumMonths, driver: 'none', format: SUMMARY_NUM_FMT },
      { key: 'exit_cap_rate', section: 'Exit', label: 'Exit Cap Rate', unit: '%', value: metrics.exitCapRate, driver: 'exit_cap_delta', format: PCT_FMT },
      { key: 'hold_period_years', section: 'Exit', label: 'Hold Period', unit: 'years', value: metrics.holdPeriodYears, driver: 'duration_multiplier', format: SUMMARY_NUM_FMT },
      { key: 'discount_rate_pct', section: 'Returns', label: 'Discount Rate', unit: '%', value: metrics.discountRatePct, driver: 'none', format: PCT_FMT },
    );
  }

  if (dealFamily === 'hospitality') {
    definitions.push(
      { key: 'keys', section: 'Commercial', label: 'Keys', unit: 'count', value: area.keys, driver: 'none', format: INT_FMT },
      { key: 'adr', section: 'Commercial', label: 'ADR / ARR', unit: 'INR / key / night', value: metrics.adr, driver: 'revenue_multiplier', format: SUMMARY_NUM_FMT },
      { key: 'occupancy_pct', section: 'Commercial', label: 'Stabilized Occupancy', unit: '%', value: metrics.occupancyPct, driver: 'occupancy_delta', format: PCT_FMT },
      { key: 'fb_revenue_pct', section: 'Commercial', label: 'F&B Revenue', unit: '% of rooms revenue', value: metrics.fbRevenuePct, driver: 'revenue_multiplier', format: PCT_FMT },
      { key: 'other_revenue_pct', section: 'Commercial', label: 'Other Revenue', unit: '% of rooms revenue', value: metrics.otherRevenuePct, driver: 'revenue_multiplier', format: PCT_FMT },
      { key: 'construction_cost_per_key', section: 'Cost', label: 'Construction Cost', unit: 'INR / key', value: metrics.constructionCostPerKey, driver: 'cost_multiplier', format: SUMMARY_NUM_FMT },
      { key: 'land_cost_cr', section: 'Cost', label: 'Land Cost', unit: 'INR Cr', value: metrics.landCostCr, driver: 'none', format: SUMMARY_NUM_FMT },
      { key: 'approval_cost_cr', section: 'Cost', label: 'Pre-opening / Approval Cost', unit: 'INR Cr', value: metrics.approvalCostCr, driver: 'cost_multiplier', format: SUMMARY_NUM_FMT },
      { key: 'opex_pct', section: 'Cost', label: 'Operating Expense Ratio', unit: '% of revenue', value: metrics.opexPct, driver: 'cost_multiplier', format: PCT_FMT },
      { key: 'debt_pct', section: 'Debt', label: 'Debt as % of Cost', unit: '%', value: metrics.debtPct, driver: 'none', format: PCT_FMT },
      { key: 'debt_rate_pct', section: 'Debt', label: 'Debt Cost', unit: '% p.a.', value: metrics.debtRatePct, driver: 'finance_delta', format: PCT_FMT },
      { key: 'exit_cap_rate', section: 'Exit', label: 'Hotel Exit Yield', unit: '%', value: metrics.exitCapRate, driver: 'exit_cap_delta', format: PCT_FMT },
      { key: 'hold_period_years', section: 'Exit', label: 'Hold Period', unit: 'years', value: metrics.holdPeriodYears, driver: 'duration_multiplier', format: SUMMARY_NUM_FMT },
      { key: 'discount_rate_pct', section: 'Returns', label: 'Discount Rate', unit: '%', value: metrics.discountRatePct, driver: 'none', format: PCT_FMT },
    );
  }

  return definitions;
};

const buildCoverSheet = (workbook, context) => {
  const sheet = makeSheet(workbook, SHEETS.cover, 12);
  sheet.columns = [{ width: 24 }, { width: 28 }, { width: 28 }, { width: 20 }];
  sheet.mergeCells('A1:D1');
  sheet.getCell('A1').value = `${context.brandName} Institutional Workbook`;
  styleCell(sheet.getCell('A1'), {
    font: { size: 14, bold: true, color: { argb: COLORS.white } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } },
    alignment: { horizontal: 'left', vertical: 'middle' },
  });

  makeSectionHeader(sheet, 3, 'Deal Summary', 4);
  const rows = [
    ['Deal Name', textOrNull(context.deal.name, context.deal.property_name, 'Unnamed Deal')],
    ['Asset Class', context.assetLabel],
    ['Deal Type', context.dealTypeLabel],
    ['City', textOrNull(context.property.city, context.deal.city)],
    ['Micro-market', textOrNull(context.property.micro_market, context.deal.micro_market)],
    ['Generated At', context.generatedAt],
    ['Recommendation', textOrNull(context.exportContext?.risks?.recommendation?.label, 'Not available')],
  ];

  let row = 4;
  rows.forEach(([label, value]) => {
    setLabelCell(sheet.getCell(`A${row}`), label, true);
    setLabelCell(sheet.getCell(`B${row}`), value || '');
    row += 1;
  });

  makeSectionHeader(sheet, row + 1, 'Workbook Scope', 4);
  const scopeRows = [
    'Formula-driven underwriting workbook with editable assumptions and scenario control',
    'Dynamic revenue, cost, phasing, cash flow, debt, returns, sensitivity, and audit tabs',
    'Prepared for investor, lender, and internal Investor-Grade workflows',
  ];
  scopeRows.forEach((item, index) => {
    setLabelCell(sheet.getCell(`A${row + 2 + index}`), String(index + 1), true);
    sheet.mergeCells(row + 2 + index, 2, row + 2 + index, 4);
    setLabelCell(sheet.getCell(`B${row + 2 + index}`), item);
  });

  sheet.getCell('D12').value = 'Editable';
  styleCell(sheet.getCell('D12'), {
    font: { size: 11, bold: true, color: { argb: COLORS.white } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.accent } },
    alignment: { horizontal: 'center', vertical: 'middle' },
  });

  context.sheetRefs.cover = { scopeEndRow: row + 4 };
};

const buildScenarioSheet = (workbook, context) => {
  const sheet = makeSheet(workbook, SHEETS.scenarios);
  sheet.columns = [{ width: 18 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 26 }];
  makeSectionHeader(sheet, 1, 'Scenario Control', 7);

  setLabelCell(sheet.getCell('A2'), 'Active Scenario', true);
  setInputCell(sheet.getCell('B2'), 'Base');
  sheet.getCell('B2').dataValidation = {
    type: 'list',
    allowBlank: false,
    formulae: ['"Base,Upside,Downside"'],
  };

  ['Scenario', 'Revenue Multiplier', 'Cost Multiplier', 'Duration Multiplier', 'Finance Delta', 'Exit Cap Delta', 'Comment'].forEach((heading, index) => {
    const cell = sheet.getCell(3, index + 1);
    setLabelCell(cell, heading, true);
    applyRowFill(sheet.getRow(3), COLORS.lightBlue);
  });

  const rows = [
    ['Base', 1, 1, 1, 0, 0, 'Stored underwriting'],
    ['Upside', 1.05, 0.97, 0.95, -0.0025, -0.0025, 'Price/rent upside, lighter cost load'],
    ['Downside', 0.95, 1.05, 1.1, 0.0025, 0.0025, 'Revenue pressure and slower execution'],
  ];

  rows.forEach((values, index) => {
    const rowNumber = 4 + index;
    values.forEach((value, colIndex) => {
      const cell = sheet.getCell(rowNumber, colIndex + 1);
      if (colIndex === 0 || colIndex === 6) {
        setLabelCell(cell, value);
      } else if (colIndex >= 1 && colIndex <= 3) {
        setInputCell(cell, value, colIndex === 3 ? SUMMARY_NUM_FMT : PCT_FMT);
      } else {
        setInputCell(cell, value, PCT_FMT);
      }
    });
  });

  context.sheetRefs.scenarios = {
    scenarioCell: `${SHEETS.scenarios}!$B$2`,
    tableRange: `${SHEETS.scenarios}!$A$4:$G$6`,
  };
};

const buildAssumptionsSheet = (workbook, context) => {
  const sheet = makeSheet(workbook, SHEETS.assumptions);
  sheet.columns = [{ width: 16 }, { width: 28 }, { width: 16 }, { width: 18 }, { width: 22 }, { width: 18 }];
  makeSectionHeader(sheet, 1, 'Editable Assumptions', 6);

  ['Section', 'Assumption', 'Base Input', 'Unit / Convention', 'Scenario Driver', 'Active Value'].forEach((heading, index) => {
    setLabelCell(sheet.getCell(3, index + 1), heading, true);
  });
  applyRowFill(sheet.getRow(3), COLORS.lightBlue);

  const definitions = buildAssumptionDefinitions(context);
  const refs = {};
  let row = 4;
  definitions.forEach((definition) => {
    setLabelCell(sheet.getCell(row, 1), definition.section);
    setLabelCell(sheet.getCell(row, 2), definition.label);
    setInputCell(sheet.getCell(row, 3), definition.value, definition.format);
    setLabelCell(sheet.getCell(row, 4), definition.unit);
    setLabelCell(sheet.getCell(row, 5), toTitle(definition.driver || 'none'));

    const baseAddress = `${SHEETS.assumptions}!$C$${row}`;
    const matchFormula = `MATCH(${SHEETS.scenarios}!$B$2,${SHEETS.scenarios}!$A$4:$A$6,0)`;
    let formula = baseAddress;

    if (definition.driver === 'revenue_multiplier') {
      formula = `IF(${baseAddress}=\"\",\"\",${baseAddress}*INDEX(${SHEETS.scenarios}!$B$4:$B$6,${matchFormula}))`;
    } else if (definition.driver === 'cost_multiplier') {
      formula = `IF(${baseAddress}=\"\",\"\",${baseAddress}*INDEX(${SHEETS.scenarios}!$C$4:$C$6,${matchFormula}))`;
    } else if (definition.driver === 'duration_multiplier') {
      formula = `IF(${baseAddress}=\"\",\"\",${baseAddress}*INDEX(${SHEETS.scenarios}!$D$4:$D$6,${matchFormula}))`;
    } else if (definition.driver === 'finance_delta') {
      formula = `IF(${baseAddress}=\"\",\"\",${baseAddress}+INDEX(${SHEETS.scenarios}!$E$4:$E$6,${matchFormula}))`;
    } else if (definition.driver === 'exit_cap_delta') {
      formula = `IF(${baseAddress}=\"\",\"\",${baseAddress}+INDEX(${SHEETS.scenarios}!$F$4:$F$6,${matchFormula}))`;
    } else if (definition.driver === 'occupancy_delta') {
      formula = `IF(${baseAddress}=\"\",\"\",MIN(1,MAX(0,${baseAddress}+INDEX(${SHEETS.scenarios}!$B$4:$B$6,${matchFormula})-1)))`;
    } else if (definition.driver === 'occupancy_delta_inverse') {
      formula = `IF(${baseAddress}=\"\",\"\",MIN(1,MAX(0,${baseAddress}-(INDEX(${SHEETS.scenarios}!$B$4:$B$6,${matchFormula})-1))))`;
    }

    setFormulaCell(sheet.getCell(row, 6), formula, definition.format);
    refs[definition.key] = {
      row,
      baseCell: `${SHEETS.assumptions}!$C$${row}`,
      activeCell: `${SHEETS.assumptions}!$F$${row}`,
      format: definition.format,
    };
    row += 1;
  });

  context.sheetRefs.assumptions = refs;
};

const assumptionRef = (context, key, type = 'activeCell', blank = '""') =>
  context.sheetRefs.assumptions?.[key]?.[type] || blank;

const buildAreaSheet = (workbook, context) => {
  const sheet = makeSheet(workbook, SHEETS.area);
  sheet.columns = [{ width: 24 }, { width: 18 }, { width: 18 }, { width: 42 }];
  makeSectionHeader(sheet, 1, 'Area and Inventory', 4);

  ['Metric', 'Value', 'Unit', 'Commentary'].forEach((heading, index) => {
    setLabelCell(sheet.getCell(3, index + 1), heading, true);
  });
  applyRowFill(sheet.getRow(3), COLORS.lightBlue);

  const rows = [
    ['Land Area', assumptionRef(context, 'land_area_sqft'), 'sqft', 'Site area used by the model'],
    [context.dealFamily === 'income' ? 'Leasable / Chargeable Area' : 'Saleable Area', assumptionRef(context, 'saleable_area_sqft'), 'sqft', 'Commercially monetized area'],
    ['Built-up / Gross Area', assumptionRef(context, 'built_up_area_sqft'), 'sqft', 'Gross constructed area'],
    ['Carpet Area', assumptionRef(context, 'carpet_area_sqft'), 'sqft', 'Usable area where provided'],
    [context.dealFamily === 'hospitality' ? 'Keys' : 'Units / Inventory Count', assumptionRef(context, 'units_or_keys'), 'count', 'Count used for density and realization tests'],
  ];

  let row = 4;
  rows.forEach(([label, formula, unit, note]) => {
    setLabelCell(sheet.getCell(row, 1), label);
    setFormulaCell(sheet.getCell(row, 2), formula.replace(/^=/, ''), INT_FMT);
    setLabelCell(sheet.getCell(row, 3), unit);
    setLabelCell(sheet.getCell(row, 4), note);
    row += 1;
  });

  makeSectionHeader(sheet, row + 1, 'Asset Module', 4);
  row += 2;

  if (context.dealFamily === 'development') {
    const saleable = assumptionRef(context, 'saleable_area_sqft');
    const units = assumptionRef(context, 'units_or_keys');
    const sellRate = assumptionRef(context, 'sell_rate_psf');
    const avgSizeCell = `${SHEETS.area}!$B$${row}`;

    setLabelCell(sheet.getCell(row, 1), 'Average Unit Size');
    setFormulaCell(sheet.getCell(row, 2), `IFERROR(${saleable}/${units},"")`, INT_FMT);
    setLabelCell(sheet.getCell(row, 3), 'sqft / unit');
    setLabelCell(sheet.getCell(row, 4), 'Saleable area divided by modeled unit count');
    row += 1;

    setLabelCell(sheet.getCell(row, 1), 'Revenue Density');
    setFormulaCell(sheet.getCell(row, 2), `IFERROR(${sellRate}, "")`, SUMMARY_NUM_FMT);
    setLabelCell(sheet.getCell(row, 3), 'INR / sqft');
    setLabelCell(sheet.getCell(row, 4), `Modeled ASP with scenario overlay; avg size link ${avgSizeCell}`);
    row += 1;
  } else if (context.dealFamily === 'income') {
    setLabelCell(sheet.getCell(row, 1), 'Base Rent');
    setFormulaCell(sheet.getCell(row, 2), assumptionRef(context, 'base_rent_psf_pm').replace(/^=/, ''), SUMMARY_NUM_FMT);
    setLabelCell(sheet.getCell(row, 3), 'INR / sqft / month');
    setLabelCell(sheet.getCell(row, 4), 'Passing / modeled starting rent');
    row += 1;

    setLabelCell(sheet.getCell(row, 1), 'Occupancy');
    setFormulaCell(sheet.getCell(row, 2), assumptionRef(context, 'occupancy_pct').replace(/^=/, ''), PCT_FMT);
    setLabelCell(sheet.getCell(row, 3), '%');
    setLabelCell(sheet.getCell(row, 4), 'Stabilized occupied share after scenario adjustment');
    row += 1;
  } else {
    setLabelCell(sheet.getCell(row, 1), 'ADR / ARR');
    setFormulaCell(sheet.getCell(row, 2), assumptionRef(context, 'adr').replace(/^=/, ''), SUMMARY_NUM_FMT);
    setLabelCell(sheet.getCell(row, 3), 'INR / key / night');
    setLabelCell(sheet.getCell(row, 4), 'Average daily rate at stabilization');
    row += 1;

    setLabelCell(sheet.getCell(row, 1), 'Occupancy');
    setFormulaCell(sheet.getCell(row, 2), assumptionRef(context, 'occupancy_pct').replace(/^=/, ''), PCT_FMT);
    setLabelCell(sheet.getCell(row, 3), '%');
    setLabelCell(sheet.getCell(row, 4), 'Occupancy ramp for rooms revenue build-up');
    row += 1;
  }

  context.sheetRefs.area = {
    lastRow: row,
  };
};

const buildRevenueSheet = (workbook, context) => {
  const sheet = makeSheet(workbook, SHEETS.revenue);
  sheet.columns = [{ width: 28 }, { width: 18 }, { width: 18 }, { width: 40 }];
  makeSectionHeader(sheet, 1, 'Revenue Build-up', 4);
  ['Line Item', 'Driver', 'Value', 'Formula Logic'].forEach((heading, index) => {
    setLabelCell(sheet.getCell(3, index + 1), heading, true);
  });
  applyRowFill(sheet.getRow(3), COLORS.lightBlue);

  let row = 4;

  if (context.dealFamily === 'development') {
    const saleable = assumptionRef(context, 'saleable_area_sqft', 'activeCell', '0');
    const asp = assumptionRef(context, 'sell_rate_psf', 'activeCell', '0');
    const collection = assumptionRef(context, 'collection_pct', 'activeCell', '1');
    const escalation = assumptionRef(context, 'pricing_escalation_pct', 'activeCell', '0');

    setLabelCell(sheet.getCell(row, 1), 'Saleable Area');
    setLabelCell(sheet.getCell(row, 2), 'Area');
    setFormulaCell(sheet.getCell(row, 3), saleable.replace(/^=/, ''), INT_FMT);
    setLabelCell(sheet.getCell(row, 4), 'Pulled from assumptions sheet');
    row += 1;

    setLabelCell(sheet.getCell(row, 1), 'Average Selling Price');
    setLabelCell(sheet.getCell(row, 2), 'Rate');
    setFormulaCell(sheet.getCell(row, 3), asp.replace(/^=/, ''), SUMMARY_NUM_FMT);
    setLabelCell(sheet.getCell(row, 4), 'Scenario-linked ASP');
    row += 1;

    setLabelCell(sheet.getCell(row, 1), 'Escalation Uplift');
    setLabelCell(sheet.getCell(row, 2), 'Escalation');
    setFormulaCell(sheet.getCell(row, 3), `IFERROR(1+${escalation},1)`, PCT_FMT);
    setLabelCell(sheet.getCell(row, 4), 'Annual pricing uplift factor if populated');
    row += 1;

    setLabelCell(sheet.getCell(row, 1), 'Gross Development Value');
    setLabelCell(sheet.getCell(row, 2), 'Area x Rate');
    setFormulaCell(sheet.getCell(row, 3), `IF(OR(${saleable}=0,${asp}=0),"",${saleable}*${asp}/10000000*(1+${escalation}))`);
    setLabelCell(sheet.getCell(row, 4), 'Area times rate converted to INR Cr');
    const grossRevenueRow = row;
    row += 1;

    setLabelCell(sheet.getCell(row, 1), 'Collections');
    setLabelCell(sheet.getCell(row, 2), 'GDV x Collection Curve');
    setFormulaCell(sheet.getCell(row, 3), `IFERROR(C${grossRevenueRow}*${collection},"")`);
    setLabelCell(sheet.getCell(row, 4), 'Cash realization based on customer collection curve when provided');
    const totalRevenueRow = row;
    row += 1;

    context.sheetRefs.revenue = {
      totalRevenueCell: `${SHEETS.revenue}!$C$${totalRevenueRow}`,
      stabilizedIncomeCell: `${SHEETS.revenue}!$C$${grossRevenueRow}`,
      exitValueCell: null,
      opexCell: null,
    };
  } else if (context.dealFamily === 'income') {
    const areaRef = assumptionRef(context, 'saleable_area_sqft', 'activeCell', '0');
    const rentRef = assumptionRef(context, 'base_rent_psf_pm', 'activeCell', '0');
    const occRef = assumptionRef(context, 'occupancy_pct', 'activeCell', '0');
    const vacRef = assumptionRef(context, 'vacancy_pct', 'activeCell', '0');
    const opexRef = assumptionRef(context, 'opex_pct', 'activeCell', '0');
    const capRef = assumptionRef(context, 'exit_cap_rate', 'activeCell', '0');

    setLabelCell(sheet.getCell(row, 1), 'Gross Potential Rent');
    setLabelCell(sheet.getCell(row, 2), 'Area x Rent x 12');
    setFormulaCell(sheet.getCell(row, 3), `IF(OR(${areaRef}=0,${rentRef}=0),"",${areaRef}*${rentRef}*12/10000000)`);
    setLabelCell(sheet.getCell(row, 4), 'Annual gross rent before vacancy');
    const gprRow = row;
    row += 1;

    setLabelCell(sheet.getCell(row, 1), 'Vacancy / Occupancy Adjustment');
    setLabelCell(sheet.getCell(row, 2), 'Occupancy');
    setFormulaCell(sheet.getCell(row, 3), `IF(OR(C${gprRow}=\"\",${occRef}=0),"",C${gprRow}*${occRef}*(1-${vacRef}))`);
    setLabelCell(sheet.getCell(row, 4), 'Stabilized occupied rent after vacancy friction');
    const effRentRow = row;
    row += 1;

    setLabelCell(sheet.getCell(row, 1), 'Operating Expense');
    setLabelCell(sheet.getCell(row, 2), 'Revenue x Opex %');
    setFormulaCell(sheet.getCell(row, 3), `IFERROR(C${effRentRow}*${opexRef},"")`);
    setLabelCell(sheet.getCell(row, 4), 'Recoverable and non-recoverable opex load');
    const opexRow = row;
    row += 1;

    setLabelCell(sheet.getCell(row, 1), 'NOI');
    setLabelCell(sheet.getCell(row, 2), 'Revenue - Opex');
    setFormulaCell(sheet.getCell(row, 3), `IFERROR(C${effRentRow}-C${opexRow},"")`);
    setLabelCell(sheet.getCell(row, 4), 'Stabilized net operating income');
    const noiRow = row;
    row += 1;

    setLabelCell(sheet.getCell(row, 1), 'Exit Value');
    setLabelCell(sheet.getCell(row, 2), 'NOI / Exit Cap');
    setFormulaCell(sheet.getCell(row, 3), `IF(${capRef}=0,"",C${noiRow}/${capRef})`);
    setLabelCell(sheet.getCell(row, 4), 'Cap-rate valuation output');
    const exitRow = row;
    row += 1;

    context.sheetRefs.revenue = {
      totalRevenueCell: `${SHEETS.revenue}!$C$${effRentRow}`,
      stabilizedIncomeCell: `${SHEETS.revenue}!$C$${noiRow}`,
      exitValueCell: `${SHEETS.revenue}!$C$${exitRow}`,
      opexCell: `${SHEETS.revenue}!$C$${opexRow}`,
    };
  } else {
    const keysRef = assumptionRef(context, 'keys', 'activeCell', '0');
    const adrRef = assumptionRef(context, 'adr', 'activeCell', '0');
    const occRef = assumptionRef(context, 'occupancy_pct', 'activeCell', '0');
    const fbRef = assumptionRef(context, 'fb_revenue_pct', 'activeCell', '0');
    const otherRef = assumptionRef(context, 'other_revenue_pct', 'activeCell', '0');
    const opexRef = assumptionRef(context, 'opex_pct', 'activeCell', '0');
    const capRef = assumptionRef(context, 'exit_cap_rate', 'activeCell', '0');

    setLabelCell(sheet.getCell(row, 1), 'Rooms Revenue');
    setLabelCell(sheet.getCell(row, 2), 'Keys x ADR x Occ x 365');
    setFormulaCell(sheet.getCell(row, 3), `IF(OR(${keysRef}=0,${adrRef}=0,${occRef}=0),"",${keysRef}*${adrRef}*${occRef}*365/10000000)`);
    setLabelCell(sheet.getCell(row, 4), 'Annual rooms revenue');
    const roomsRow = row;
    row += 1;

    setLabelCell(sheet.getCell(row, 1), 'F&B Revenue');
    setLabelCell(sheet.getCell(row, 2), '% of Rooms');
    setFormulaCell(sheet.getCell(row, 3), `IFERROR(C${roomsRow}*${fbRef},"")`);
    setLabelCell(sheet.getCell(row, 4), 'Ancillary revenue from F&B');
    const fbRow = row;
    row += 1;

    setLabelCell(sheet.getCell(row, 1), 'Other Revenue');
    setLabelCell(sheet.getCell(row, 2), '% of Rooms');
    setFormulaCell(sheet.getCell(row, 3), `IFERROR(C${roomsRow}*${otherRef},"")`);
    setLabelCell(sheet.getCell(row, 4), 'Spa, banquets, and other ancillary lines');
    const otherRow = row;
    row += 1;

    setLabelCell(sheet.getCell(row, 1), 'Total Operating Revenue');
    setLabelCell(sheet.getCell(row, 2), 'Rooms + F&B + Other');
    setFormulaCell(sheet.getCell(row, 3), `IFERROR(C${roomsRow}+C${fbRow}+C${otherRow},"")`);
    setLabelCell(sheet.getCell(row, 4), 'Top-line hotel revenue');
    const revenueRow = row;
    row += 1;

    setLabelCell(sheet.getCell(row, 1), 'Operating Expense');
    setLabelCell(sheet.getCell(row, 2), 'Revenue x Opex %');
    setFormulaCell(sheet.getCell(row, 3), `IFERROR(C${revenueRow}*${opexRef},"")`);
    setLabelCell(sheet.getCell(row, 4), 'Departmental and undistributed operating costs');
    const opexRow = row;
    row += 1;

    setLabelCell(sheet.getCell(row, 1), 'EBITDA');
    setLabelCell(sheet.getCell(row, 2), 'Revenue - Opex');
    setFormulaCell(sheet.getCell(row, 3), `IFERROR(C${revenueRow}-C${opexRow},"")`);
    setLabelCell(sheet.getCell(row, 4), 'Operating EBITDA before financing');
    const ebitdaRow = row;
    row += 1;

    setLabelCell(sheet.getCell(row, 1), 'Exit Value');
    setLabelCell(sheet.getCell(row, 2), 'EBITDA / Exit Yield');
    setFormulaCell(sheet.getCell(row, 3), `IF(${capRef}=0,"",C${ebitdaRow}/${capRef})`);
    setLabelCell(sheet.getCell(row, 4), 'Hotel valuation output');
    const exitRow = row;
    row += 1;

    context.sheetRefs.revenue = {
      totalRevenueCell: `${SHEETS.revenue}!$C$${revenueRow}`,
      stabilizedIncomeCell: `${SHEETS.revenue}!$C$${ebitdaRow}`,
      exitValueCell: `${SHEETS.revenue}!$C$${exitRow}`,
      opexCell: `${SHEETS.revenue}!$C$${opexRow}`,
    };
  }
};

const buildCostsSheet = (workbook, context) => {
  const sheet = makeSheet(workbook, SHEETS.costs);
  sheet.columns = [{ width: 28 }, { width: 18 }, { width: 18 }, { width: 40 }];
  makeSectionHeader(sheet, 1, 'Cost Stack', 4);
  ['Line Item', 'Driver', 'Value', 'Formula Logic'].forEach((heading, index) => {
    setLabelCell(sheet.getCell(3, index + 1), heading, true);
  });
  applyRowFill(sheet.getRow(3), COLORS.lightBlue);

  const landCost = assumptionRef(context, 'land_cost_cr', 'activeCell', '0');
  const approvals = assumptionRef(context, 'approval_cost_cr', 'activeCell', '0');
  const financeCostPct = assumptionRef(context, 'finance_cost_pct', 'activeCell', '0');
  const marketingPct = assumptionRef(context, 'marketing_cost_pct', 'activeCell', '0');
  const gstPct = assumptionRef(context, 'gst_pct', 'activeCell', '0');
  const stampPct = assumptionRef(context, 'stamp_duty_pct', 'activeCell', '0');
  const opexPct = assumptionRef(context, 'opex_pct', 'activeCell', '0');

  let row = 4;
  setLabelCell(sheet.getCell(row, 1), 'Land / Acquisition Cost');
  setLabelCell(sheet.getCell(row, 2), 'Input');
  setFormulaCell(sheet.getCell(row, 3), landCost.replace(/^=/, ''));
  setLabelCell(sheet.getCell(row, 4), 'Direct land or acquisition consideration');
  row += 1;

  setLabelCell(sheet.getCell(row, 1), context.dealFamily === 'hospitality' ? 'Construction / FF&E Cost' : 'Construction / Capex Cost');
  setLabelCell(sheet.getCell(row, 2), 'Area / Key Based');
  if (context.dealFamily === 'hospitality') {
    setFormulaCell(
      sheet.getCell(row, 3),
      `IF(OR(${assumptionRef(context, 'keys', 'activeCell', '0')}=0,${assumptionRef(context, 'construction_cost_per_key', 'activeCell', '0')}=0),"",${assumptionRef(context, 'keys', 'activeCell', '0')}*${assumptionRef(context, 'construction_cost_per_key', 'activeCell', '0')}/10000000)`,
    );
  } else {
    setFormulaCell(
      sheet.getCell(row, 3),
      `IF(OR(${assumptionRef(context, 'saleable_area_sqft', 'activeCell', '0')}=0,${assumptionRef(context, 'construction_cost_psf', 'activeCell', '0')}=0),"",${assumptionRef(context, 'saleable_area_sqft', 'activeCell', '0')}*${assumptionRef(context, 'construction_cost_psf', 'activeCell', '0')}/10000000)`,
    );
  }
  setLabelCell(sheet.getCell(row, 4), 'Primary build / fit-out / capex line');
  const hardCostRow = row;
  row += 1;

  setLabelCell(sheet.getCell(row, 1), 'Approval / Statutory Cost');
  setLabelCell(sheet.getCell(row, 2), 'Input');
  setFormulaCell(sheet.getCell(row, 3), approvals.replace(/^=/, ''));
  setLabelCell(sheet.getCell(row, 4), 'Approvals, pre-opening, and statutory costs');
  row += 1;

  if (context.dealFamily === 'development') {
    setLabelCell(sheet.getCell(row, 1), 'Marketing Cost');
    setLabelCell(sheet.getCell(row, 2), '% of Revenue');
    setFormulaCell(sheet.getCell(row, 3), `IFERROR(${context.sheetRefs.revenue.totalRevenueCell}*${marketingPct},"")`);
    setLabelCell(sheet.getCell(row, 4), 'Sales and channel cost load');
    row += 1;
  }

  if (context.dealFamily !== 'development') {
    setLabelCell(sheet.getCell(row, 1), 'Operating Expense Reserve');
    setLabelCell(sheet.getCell(row, 2), '% of Revenue');
    setFormulaCell(sheet.getCell(row, 3), `IFERROR(${context.sheetRefs.revenue.totalRevenueCell}*${opexPct},"")`);
    setLabelCell(sheet.getCell(row, 4), 'Operating reserve derived from revenue');
    row += 1;
  }

  setLabelCell(sheet.getCell(row, 1), 'Finance Cost Reserve');
  setLabelCell(sheet.getCell(row, 2), '% of Hard Cost');
  setFormulaCell(sheet.getCell(row, 3), `IFERROR(C${hardCostRow}*${financeCostPct},"")`);
  setLabelCell(sheet.getCell(row, 4), 'Top-side reserve before detailed debt schedule');
  row += 1;

  setLabelCell(sheet.getCell(row, 1), 'GST');
  setLabelCell(sheet.getCell(row, 2), '% of Revenue');
  setFormulaCell(sheet.getCell(row, 3), `IFERROR(${context.sheetRefs.revenue.totalRevenueCell}*${gstPct},"")`);
  setLabelCell(sheet.getCell(row, 4), 'Only populated where stored input exists');
  row += 1;

  setLabelCell(sheet.getCell(row, 1), 'Stamp Duty / Registration');
  setLabelCell(sheet.getCell(row, 2), '% of Land Cost');
  setFormulaCell(sheet.getCell(row, 3), `IFERROR(${landCost}*${stampPct},"")`);
  setLabelCell(sheet.getCell(row, 4), 'Transaction tax / registration cost');
  row += 1;

  setLabelCell(sheet.getCell(row, 1), 'Total Cost');
  setLabelCell(sheet.getCell(row, 2), 'Sum');
  setFormulaCell(sheet.getCell(row, 3), `SUM(C4:C${row - 1})`);
  setLabelCell(sheet.getCell(row, 4), 'Model cost base in INR Cr');
  sheet.getCell(`A${row}`).border = topBorder;
  sheet.getCell(`B${row}`).border = topBorder;
  sheet.getCell(`C${row}`).border = topBorder;
  sheet.getCell(`D${row}`).border = topBorder;

  context.sheetRefs.costs = {
    totalCostCell: `${SHEETS.costs}!$C$${row}`,
    hardCostCell: `${SHEETS.costs}!$C$${hardCostRow}`,
    totalRow: row,
  };
};

const buildPhasingSheet = (workbook, context) => {
  const sheet = makeSheet(workbook, context.phasingSheetName);
  const periodStartCol = 3;
  const totalCol = periodStartCol + context.periods.length;
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 28;
  context.periods.forEach((period, index) => {
    sheet.getColumn(periodStartCol + index).width = 14;
    setLabelCell(sheet.getCell(3, periodStartCol + index), period.label, true);
  });
  sheet.getColumn(totalCol).width = 16;
  makeSectionHeader(sheet, 1, context.dealFamily === 'development' ? 'Development / Sales Phasing' : 'Lease / Operating Phasing', totalCol);
  setLabelCell(sheet.getCell(3, 1), 'Line Item', true);
  setLabelCell(sheet.getCell(3, 2), 'Commentary', true);
  setLabelCell(sheet.getCell(3, totalCol), 'Total', true);
  applyRowFill(sheet.getRow(3), COLORS.lightBlue);

  const hasTimingInput = context.revenueWeights.some((value) => value !== null) || context.costWeights.some((value) => value !== null);

  let row = 4;
  const rows = context.dealFamily === 'development'
    ? [
        { key: 'revWeight', label: 'Revenue Allocation %', note: hasTimingInput ? 'Derived from stored cash flow inflow profile; editable' : 'Fill editable timing weights if detailed sales phasing is not stored', kind: 'input', values: context.revenueWeights, format: PCT_FMT },
        { key: 'collectionWeight', label: 'Collection Allocation %', note: 'Defaults to revenue timing; edit where customer collection differs', kind: 'input', values: context.revenueWeights, format: PCT_FMT },
        { key: 'costWeight', label: 'Cost Allocation %', note: hasTimingInput ? 'Derived from stored cash flow outflow profile; editable' : 'Fill editable timing weights if construction phasing is not stored', kind: 'input', values: context.costWeights, format: PCT_FMT },
        { key: 'revenue', label: 'Revenue Recognized', note: 'Total modeled revenue by period', kind: 'formula', format: SUMMARY_NUM_FMT },
        { key: 'collections', label: 'Collections', note: 'Cash collections by period', kind: 'formula', format: SUMMARY_NUM_FMT },
        { key: 'cost', label: 'Cost Incurred', note: 'Modeled cost deployment by period', kind: 'formula', format: SUMMARY_NUM_FMT },
        { key: 'net', label: 'Net Pre-debt Cash Flow', note: 'Collections less cost', kind: 'formula', format: SUMMARY_NUM_FMT },
      ]
    : [
        { key: 'revWeight', label: 'Revenue Weight %', note: hasTimingInput ? 'Derived from stored cash flow inflow profile; editable' : 'Fill editable revenue timing weights where detailed operating phasing is not stored', kind: 'input', values: context.revenueWeights, format: PCT_FMT },
        { key: 'costWeight', label: 'Cost / Capex Weight %', note: hasTimingInput ? 'Derived from stored cash flow outflow profile; editable' : 'Fill editable cost timing weights where detailed capex phasing is not stored', kind: 'input', values: context.costWeights, format: PCT_FMT },
        { key: 'grossRevenue', label: context.dealFamily === 'hospitality' ? 'Operating Revenue' : 'Gross Rental Revenue', note: 'Modeled revenue by period', kind: 'formula', format: SUMMARY_NUM_FMT },
        { key: 'opex', label: 'Operating Expense', note: 'Modeled opex by period', kind: 'formula', format: SUMMARY_NUM_FMT },
        { key: 'income', label: context.dealFamily === 'hospitality' ? 'EBITDA' : 'NOI', note: 'Operating income by period', kind: 'formula', format: SUMMARY_NUM_FMT },
        { key: 'cost', label: 'Acquisition / Capex Outflow', note: 'Capital deployment by period', kind: 'formula', format: SUMMARY_NUM_FMT },
        { key: 'net', label: 'Net Pre-debt Cash Flow', note: 'Income less capex deployment', kind: 'formula', format: SUMMARY_NUM_FMT },
      ];

  const rowRefs = {};
  rows.forEach((config) => {
    rowRefs[config.key] = row;
    setLabelCell(sheet.getCell(row, 1), config.label);
    setLabelCell(sheet.getCell(row, 2), config.note);
    context.periods.forEach((period, index) => {
      const col = periodStartCol + index;
      const cell = sheet.getCell(row, col);
      if (config.kind === 'input') {
        setInputCell(cell, config.values[index], config.format);
      }
    });
    row += 1;
  });

  context.periods.forEach((period, index) => {
    const col = periodStartCol + index;
    const colLetter = sheet.getColumn(col).letter;
    if (context.dealFamily === 'development') {
      setFormulaCell(sheet.getCell(rowRefs.revenue, col), `IFERROR(${context.sheetRefs.revenue.totalRevenueCell}*${colLetter}${rowRefs.revWeight},"")`);
      setFormulaCell(sheet.getCell(rowRefs.collections, col), `IFERROR(${context.sheetRefs.revenue.totalRevenueCell}*${colLetter}${rowRefs.collectionWeight},"")`);
      setFormulaCell(sheet.getCell(rowRefs.cost, col), `IFERROR(${context.sheetRefs.costs.totalCostCell}*${colLetter}${rowRefs.costWeight},"")`);
      setFormulaCell(sheet.getCell(rowRefs.net, col), `IFERROR(${colLetter}${rowRefs.collections}-${colLetter}${rowRefs.cost},"")`);
    } else {
      setFormulaCell(sheet.getCell(rowRefs.grossRevenue, col), `IFERROR(${context.sheetRefs.revenue.totalRevenueCell}*${colLetter}${rowRefs.revWeight},"")`);
      setFormulaCell(sheet.getCell(rowRefs.opex, col), context.sheetRefs.revenue.opexCell ? `IFERROR(${context.sheetRefs.revenue.opexCell}*${colLetter}${rowRefs.revWeight},"")` : '""');
      setFormulaCell(sheet.getCell(rowRefs.income, col), `IFERROR(${colLetter}${rowRefs.grossRevenue}-${colLetter}${rowRefs.opex},"")`);
      setFormulaCell(sheet.getCell(rowRefs.cost, col), `IFERROR(${context.sheetRefs.costs.totalCostCell}*${colLetter}${rowRefs.costWeight},"")`);
      setFormulaCell(sheet.getCell(rowRefs.net, col), `IFERROR(${colLetter}${rowRefs.income}-${colLetter}${rowRefs.cost},"")`);
    }
  });

  rows.forEach((config) => {
    const totalCell = sheet.getCell(rowRefs[config.key], totalCol);
    const start = sheet.getColumn(periodStartCol).letter;
    const end = sheet.getColumn(totalCol - 1).letter;
    setFormulaCell(totalCell, `SUM(${start}${rowRefs[config.key]}:${end}${rowRefs[config.key]})`, config.format);
    totalCell.border = topBorder;
    sheet.getCell(rowRefs[config.key], 1).border = topBorder;
    sheet.getCell(rowRefs[config.key], 2).border = topBorder;
  });

  context.sheetRefs.phasing = {
    sheetName: context.phasingSheetName,
    periodStartCol,
    totalCol,
    rowRefs,
    periodCount: context.periods.length,
  };
};

const buildDebtSheet = (workbook, context) => {
  const sheet = makeSheet(workbook, SHEETS.debt);
  const periodStartCol = 3;
  const totalCol = periodStartCol + context.periods.length;
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 26;
  context.periods.forEach((period, index) => {
    sheet.getColumn(periodStartCol + index).width = 14;
    setLabelCell(sheet.getCell(3, periodStartCol + index), period.label, true);
  });
  sheet.getColumn(totalCol).width = 16;
  makeSectionHeader(sheet, 1, 'Debt and Security', totalCol);
  setLabelCell(sheet.getCell(3, 1), 'Line Item', true);
  setLabelCell(sheet.getCell(3, 2), 'Commentary', true);
  setLabelCell(sheet.getCell(3, totalCol), 'Total', true);
  applyRowFill(sheet.getRow(3), COLORS.lightBlue);

  const debtPct = assumptionRef(context, 'debt_pct', 'activeCell', '0');
  const debtRate = assumptionRef(context, 'debt_rate_pct', 'activeCell', '0');
  const incomeRow = context.dealFamily === 'development' ? context.sheetRefs.phasing.rowRefs.collections : context.sheetRefs.phasing.rowRefs.income;
  const costRow = context.sheetRefs.phasing.rowRefs.cost;
  const rows = [
    [DEBT_ROWS.loanAsk, 'Loan Ask', 'Modeled debt as % of total cost'],
    [DEBT_ROWS.opening, 'Opening Balance', 'Opening debt balance by period'],
    [DEBT_ROWS.draw, 'Debt Draw', 'Debt funded against capital deployment'],
    [DEBT_ROWS.interest, 'Interest', 'Periodic interest accrual'],
    [DEBT_ROWS.principal, 'Principal', 'Balloon repayment in terminal period'],
    [DEBT_ROWS.closing, 'Closing Balance', 'Closing debt balance by period'],
    [DEBT_ROWS.debtService, 'Debt Service', 'Interest plus principal'],
    [DEBT_ROWS.dscr, 'DSCR', 'Operating cash available for debt service'],
    [DEBT_ROWS.security, 'Security Cover', 'Exit / residual value over closing debt'],
  ];

  const rowRefs = { ...DEBT_ROWS };
  rows.forEach(([row, label, note]) => {
    setLabelCell(sheet.getCell(row, 1), label);
    setLabelCell(sheet.getCell(row, 2), note);
  });

  const firstPeriodCol = sheet.getColumn(periodStartCol).letter;
  const lastPeriodCol = sheet.getColumn(totalCol - 1).letter;
  const phasingSheet = context.phasingSheetName;

  context.periods.forEach((period, index) => {
    const col = periodStartCol + index;
    const colLetter = sheet.getColumn(col).letter;
    const prevColLetter = index === 0 ? null : sheet.getColumn(col - 1).letter;
    const drawFormula = `IF(${debtPct}=\"\",\"\",${phasingSheet}!${colLetter}${costRow}*${debtPct})`;
    const openingFormula = index === 0 ? '0' : `${prevColLetter}${rowRefs.closing}`;
    const interestFormula = `IF(${debtPct}=\"\",\"\",(${colLetter}${rowRefs.opening}+${colLetter}${rowRefs.draw}/2)*${debtRate}/${context.periodScale})`;
    const principalFormula = index === context.periods.length - 1 ? `${colLetter}${rowRefs.opening}+${colLetter}${rowRefs.draw}+${colLetter}${rowRefs.interest}` : '0';
    const closingFormula = `${colLetter}${rowRefs.opening}+${colLetter}${rowRefs.draw}+${colLetter}${rowRefs.interest}-${colLetter}${rowRefs.principal}`;
    const debtServiceFormula = `${colLetter}${rowRefs.interest}+${colLetter}${rowRefs.principal}`;
    const dscrFormula = `IFERROR(${phasingSheet}!${colLetter}${incomeRow}/${colLetter}${rowRefs.debtService},"")`;
    const securityFormula = context.sheetRefs.revenue.exitValueCell
      ? `IFERROR(${context.sheetRefs.revenue.exitValueCell}/MAX(${colLetter}${rowRefs.closing},0.0001),"")`
      : `IFERROR(${context.sheetRefs.revenue.totalRevenueCell}/MAX(${colLetter}${rowRefs.closing},0.0001),"")`;

    setFormulaCell(sheet.getCell(rowRefs.loanAsk, col), `IF(${debtPct}=\"\",\"\",${context.sheetRefs.costs.totalCostCell}*${debtPct})`);
    setFormulaCell(sheet.getCell(rowRefs.opening, col), openingFormula);
    setFormulaCell(sheet.getCell(rowRefs.draw, col), drawFormula);
    setFormulaCell(sheet.getCell(rowRefs.interest, col), interestFormula);
    setFormulaCell(sheet.getCell(rowRefs.principal, col), principalFormula);
    setFormulaCell(sheet.getCell(rowRefs.closing, col), closingFormula);
    setFormulaCell(sheet.getCell(rowRefs.debtService, col), debtServiceFormula);
    setFormulaCell(sheet.getCell(rowRefs.dscr, col), dscrFormula, SUMMARY_NUM_FMT);
    setFormulaCell(sheet.getCell(rowRefs.security, col), securityFormula, SUMMARY_NUM_FMT);
  });

  for (let r = rowRefs.loanAsk; r <= rowRefs.security; r += 1) {
    setFormulaCell(sheet.getCell(r, totalCol), `SUM(${firstPeriodCol}${r}:${lastPeriodCol}${r})`);
    sheet.getCell(r, totalCol).border = topBorder;
  }
  setFormulaCell(sheet.getCell(rowRefs.dscr, totalCol), `MIN(${firstPeriodCol}${rowRefs.dscr}:${lastPeriodCol}${rowRefs.dscr})`, SUMMARY_NUM_FMT);
  setFormulaCell(sheet.getCell(rowRefs.security, totalCol), `MAX(${firstPeriodCol}${rowRefs.security}:${lastPeriodCol}${rowRefs.security})`, SUMMARY_NUM_FMT);

  context.sheetRefs.debt = {
    rowRefs,
    totalDebtCell: `${SHEETS.debt}!$${sheet.getColumn(totalCol).letter}$${rowRefs.draw}`,
    minDscrCell: `${SHEETS.debt}!$${sheet.getColumn(totalCol).letter}$${rowRefs.dscr}`,
    securityCell: `${SHEETS.debt}!$${sheet.getColumn(totalCol).letter}$${rowRefs.security}`,
    lastClosingCell: `${SHEETS.debt}!$${lastPeriodCol}$${rowRefs.closing}`,
  };
};

const buildCashFlowSheet = (workbook, context) => {
  const sheet = makeSheet(workbook, SHEETS.cashFlow);
  const periodStartCol = 3;
  const totalCol = periodStartCol + context.periods.length;
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 24;
  context.periods.forEach((period, index) => {
    sheet.getColumn(periodStartCol + index).width = 14;
    setLabelCell(sheet.getCell(3, periodStartCol + index), period.label, true);
  });
  sheet.getColumn(totalCol).width = 16;
  makeSectionHeader(sheet, 1, 'Project Cash Flow', totalCol);
  setLabelCell(sheet.getCell(3, 1), 'Line Item', true);
  setLabelCell(sheet.getCell(3, 2), 'Commentary', true);
  setLabelCell(sheet.getCell(3, totalCol), 'Total', true);
  applyRowFill(sheet.getRow(3), COLORS.lightBlue);

  const rows = [
    ['Revenue / Collections', 'Top-line or collected inflow'],
    ['Cost Outflow', 'Capital and operating deployment'],
    ['Pre-debt Net', 'Before financing'],
    ['Debt Draw', 'Financing inflow'],
    ['Interest', 'Financing cost'],
    ['Principal', 'Debt repayment'],
    ['Equity Cash Flow', 'Net cash flow to equity'],
    ['Cumulative Equity CF', 'Running equity balance'],
  ];

  let row = 4;
  const rowRefs = {};
  rows.forEach(([label, note], index) => {
    rowRefs[index] = row;
    setLabelCell(sheet.getCell(row, 1), label);
    setLabelCell(sheet.getCell(row, 2), note);
    row += 1;
  });

  const phasingRows = context.sheetRefs.phasing.rowRefs;
  const revenueRow = context.dealFamily === 'development' ? phasingRows.collections : phasingRows.income;
  const costRow = phasingRows.cost;
  context.periods.forEach((period, index) => {
    const col = periodStartCol + index;
    const colLetter = sheet.getColumn(col).letter;
    const prevColLetter = index === 0 ? null : sheet.getColumn(col - 1).letter;
    setFormulaCell(sheet.getCell(rowRefs[0], col), `${context.phasingSheetName}!${colLetter}${revenueRow}`);
    setFormulaCell(sheet.getCell(rowRefs[1], col), `-${context.phasingSheetName}!${colLetter}${costRow}`);
    setFormulaCell(sheet.getCell(rowRefs[2], col), `${colLetter}${rowRefs[0]}+${colLetter}${rowRefs[1]}`);
    setFormulaCell(sheet.getCell(rowRefs[3], col), `${SHEETS.debt}!${colLetter}${DEBT_ROWS.draw}`);
    setFormulaCell(sheet.getCell(rowRefs[4], col), `-${SHEETS.debt}!${colLetter}${DEBT_ROWS.interest}`);
    setFormulaCell(sheet.getCell(rowRefs[5], col), `-${SHEETS.debt}!${colLetter}${DEBT_ROWS.principal}`);
    setFormulaCell(sheet.getCell(rowRefs[6], col), `SUM(${colLetter}${rowRefs[2]}:${colLetter}${rowRefs[5]})`);
    const cumFormula = index === 0 ? `${colLetter}${rowRefs[6]}` : `${prevColLetter}${rowRefs[7]}+${colLetter}${rowRefs[6]}`;
    setFormulaCell(sheet.getCell(rowRefs[7], col), cumFormula);
  });

  const firstPeriodCol = sheet.getColumn(periodStartCol).letter;
  const lastPeriodCol = sheet.getColumn(totalCol - 1).letter;
  for (let r = rowRefs[0]; r <= rowRefs[7]; r += 1) {
    setFormulaCell(sheet.getCell(r, totalCol), `SUM(${firstPeriodCol}${r}:${lastPeriodCol}${r})`);
    sheet.getCell(r, totalCol).border = topBorder;
  }

  context.sheetRefs.cashFlow = {
    rowRefs,
    equityRange: `${SHEETS.cashFlow}!$${firstPeriodCol}$${rowRefs[6]}:$${lastPeriodCol}$${rowRefs[6]}`,
    projectRange: `${SHEETS.cashFlow}!$${firstPeriodCol}$${rowRefs[2]}:$${lastPeriodCol}$${rowRefs[2]}`,
    cumulativeLastCell: `${SHEETS.cashFlow}!$${lastPeriodCol}$${rowRefs[7]}`,
    totalEquityCell: `${SHEETS.cashFlow}!$${sheet.getColumn(totalCol).letter}$${rowRefs[6]}`,
  };
};

const buildReturnsSheet = (workbook, context) => {
  const sheet = makeSheet(workbook, SHEETS.returns);
  sheet.columns = [{ width: 28 }, { width: 18 }, { width: 18 }, { width: 42 }];
  makeSectionHeader(sheet, 1, 'Returns and Credit Metrics', 4);
  ['Metric', 'Type', 'Value', 'Commentary'].forEach((heading, index) => {
    setLabelCell(sheet.getCell(3, index + 1), heading, true);
  });
  applyRowFill(sheet.getRow(3), COLORS.lightBlue);

  const yieldFormula = context.dealFamily === 'development'
    ? `IFERROR(C${RETURNS_ROWS.grossProfit}/C${RETURNS_ROWS.totalCost},"")`
    : `IFERROR(${context.sheetRefs.revenue.stabilizedIncomeCell}/${context.sheetRefs.costs.totalCostCell},"")`;

  const exitValueFormula = context.sheetRefs.revenue.exitValueCell || context.sheetRefs.revenue.totalRevenueCell;
  const rowDefs = [
    ['Total Revenue / Income', 'Output', context.sheetRefs.revenue.totalRevenueCell, 'Pulled from revenue tab'],
    ['Total Cost', 'Output', context.sheetRefs.costs.totalCostCell, 'Pulled from cost tab'],
    ['Gross Profit / Spread', 'Output', `C${RETURNS_ROWS.totalRevenue}-C${RETURNS_ROWS.totalCost}`, 'Revenue less cost'],
    ['Gross Margin', 'Output', `IFERROR(C${RETURNS_ROWS.grossProfit}/C${RETURNS_ROWS.totalRevenue},"")`, 'Profitability ratio'],
    ['Project IRR', 'Return', `IFERROR(IRR(${context.sheetRefs.cashFlow.projectRange}),"")`, 'Unlevered project IRR from pre-debt cash flows'],
    ['Equity IRR', 'Return', `IFERROR(IRR(${context.sheetRefs.cashFlow.equityRange}),"")`, 'Levered equity IRR'],
    ['Equity Multiple', 'Return', `IFERROR(SUMIF(${context.sheetRefs.cashFlow.equityRange},\">0\",${context.sheetRefs.cashFlow.equityRange})/ABS(SUMIF(${context.sheetRefs.cashFlow.equityRange},\"<0\",${context.sheetRefs.cashFlow.equityRange})),"")`, 'Total equity distributions over invested equity'],
    ['Yield on Cost', 'Return', yieldFormula, context.dealFamily === 'development' ? 'Profit over total cost' : 'Stabilized operating income over cost base'],
    ['Exit Value', 'Valuation', exitValueFormula, 'Cap-rate or exit yield valuation'],
    ['Net Value Gain', 'Valuation', `C${RETURNS_ROWS.exitValue}-C${RETURNS_ROWS.totalCost}`, 'Modeled value less total cost'],
    ['Total Debt Drawn', 'Credit', context.sheetRefs.debt.totalDebtCell, 'Debt schedule draw total'],
    ['Minimum DSCR', 'Credit', context.sheetRefs.debt.minDscrCell, 'Lowest coverage ratio during the model'],
    ['Security Cover', 'Credit', context.sheetRefs.debt.securityCell, 'Peak cover from terminal value vs debt balance'],
  ];

  rowDefs.forEach(([label, type, formula, note], index) => {
    const row = 4 + index;
    setLabelCell(sheet.getCell(row, 1), label);
    setLabelCell(sheet.getCell(row, 2), type);
    setFormulaCell(
      sheet.getCell(row, 3),
      formula.replace(/^=/, ''),
      [RETURNS_ROWS.grossMargin, RETURNS_ROWS.projectIrr, RETURNS_ROWS.equityIrr, RETURNS_ROWS.yieldOnCost].includes(row)
        ? PCT_FMT
        : SUMMARY_NUM_FMT,
    );
    setLabelCell(sheet.getCell(row, 4), note);
    if ([RETURNS_ROWS.totalRevenue, RETURNS_ROWS.totalCost, RETURNS_ROWS.grossProfit, RETURNS_ROWS.exitValue].includes(row)) {
      sheet.getCell(row, 1).border = topBorder;
      sheet.getCell(row, 2).border = topBorder;
      sheet.getCell(row, 3).border = topBorder;
      sheet.getCell(row, 4).border = topBorder;
    }
  });

  context.sheetRefs.returns = {
    totalRevenueCell: `${SHEETS.returns}!$C$${RETURNS_ROWS.totalRevenue}`,
    totalCostCell: `${SHEETS.returns}!$C$${RETURNS_ROWS.totalCost}`,
    equityIrrCell: `${SHEETS.returns}!$C$${RETURNS_ROWS.equityIrr}`,
    projectIrrCell: `${SHEETS.returns}!$C$${RETURNS_ROWS.projectIrr}`,
  };
};

const buildExecutiveSummarySheet = (workbook, context) => {
  const sheet = makeSheet(workbook, SHEETS.summary, 12);
  sheet.columns = [{ width: 24 }, { width: 20 }, { width: 18 }, { width: 24 }, { width: 20 }, { width: 18 }];
  makeSectionHeader(sheet, 1, 'Executive Summary', 6);

  setLabelCell(sheet.getCell('A3'), 'Deal', true);
  setLabelCell(sheet.getCell('B3'), textOrNull(context.deal.name, context.deal.property_name, 'Unnamed Deal'));
  setLabelCell(sheet.getCell('D3'), 'Recommendation', true);
  setLabelCell(sheet.getCell('E3'), textOrNull(context.exportContext?.risks?.recommendation?.label, 'Underwrite Review'));
  styleCell(sheet.getCell('E3'), {
    font: { size: 10, bold: true, color: { argb: COLORS.linkGreen } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.sand } },
    alignment: { horizontal: 'center', vertical: 'middle' },
  });

  const kpis = [
    ['Total Revenue / Income', `${SHEETS.returns}!$C$${RETURNS_ROWS.totalRevenue}`, SUMMARY_NUM_FMT],
    ['Total Cost', `${SHEETS.returns}!$C$${RETURNS_ROWS.totalCost}`, SUMMARY_NUM_FMT],
    ['Project IRR', `${SHEETS.returns}!$C$${RETURNS_ROWS.projectIrr}`, PCT_FMT],
    ['Equity IRR', `${SHEETS.returns}!$C$${RETURNS_ROWS.equityIrr}`, PCT_FMT],
    ['Equity Multiple', `${SHEETS.returns}!$C$${RETURNS_ROWS.equityMultiple}`, SUMMARY_NUM_FMT],
    ['Yield on Cost', `${SHEETS.returns}!$C$${RETURNS_ROWS.yieldOnCost}`, PCT_FMT],
    ['Exit Value', `${SHEETS.returns}!$C$${RETURNS_ROWS.exitValue}`, SUMMARY_NUM_FMT],
    ['Minimum DSCR', `${SHEETS.returns}!$C$${RETURNS_ROWS.minDscr}`, SUMMARY_NUM_FMT],
  ];

  let row = 5;
  kpis.forEach(([label, formula, format], index) => {
    const baseCol = index % 2 === 0 ? 1 : 4;
    if (index % 2 === 0 && index !== 0) row += 2;
    const labelCell = sheet.getCell(row, baseCol);
    const valueCell = sheet.getCell(row, baseCol + 1);
    setLabelCell(labelCell, label, true);
    setFormulaCell(valueCell, formula, format, COLORS.linkGreen);
    styleCell(valueCell, {
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.paper } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      font: { size: 11, bold: true, color: { argb: COLORS.linkGreen } },
      numFmt: format,
    });
  });

  makeSectionHeader(sheet, 15, 'Underwriting View', 6);
  const narrative = [
    ['Asset', context.assetLabel],
    ['Deal Type', context.dealTypeLabel],
    ['Location', textOrNull(context.property.micro_market, context.deal.micro_market, context.property.city, context.deal.city)],
    ['Timing', context.periods.map((period) => period.label).join(', ')],
    ['Note', context.revenueWeights.some((value) => value !== null) ? 'Phasing seeded from stored cash flow timing and remains editable.' : 'Detailed phasing not stored; editable timing rows are left for the analyst to complete.'],
  ];
  narrative.forEach(([label, value], index) => {
    setLabelCell(sheet.getCell(16 + index, 1), label, true);
    sheet.mergeCells(16 + index, 2, 16 + index, 6);
    setLabelCell(sheet.getCell(16 + index, 2), value || '');
  });
};

const buildSensitivitySheet = (workbook, context) => {
  const sheet = makeSheet(workbook, SHEETS.sensitivity);
  sheet.columns = [{ width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 22 }];
  makeSectionHeader(sheet, 1, 'Sensitivity', 7);

  const title = context.dealFamily === 'development'
    ? 'Price vs Cost Margin Sensitivity'
    : context.dealFamily === 'hospitality'
      ? 'ADR vs Occupancy Revenue Sensitivity'
      : 'Rent vs Occupancy NOI Sensitivity';
  setLabelCell(sheet.getCell('A3'), title, true);

  const shocks = [-0.1, -0.05, 0, 0.05, 0.1];
  shocks.forEach((shock, index) => {
    setInputCell(sheet.getCell(4, index + 2), shock, PCT_FMT);
    setInputCell(sheet.getCell(index + 5, 1), shock, PCT_FMT);
  });

  if (context.dealFamily === 'development') {
    shocks.forEach((costShock, rIndex) => {
      shocks.forEach((priceShock, cIndex) => {
        const cell = sheet.getCell(5 + rIndex, 2 + cIndex);
        const rowShock = sheet.getCell(5 + rIndex, 1).address;
        const colShock = sheet.getCell(4, 2 + cIndex).address;
        setFormulaCell(
          cell,
          `IFERROR(((${context.sheetRefs.revenue.totalRevenueCell}*(1+${colShock}))-(${context.sheetRefs.costs.totalCostCell}*(1+${rowShock})))/(${context.sheetRefs.revenue.totalRevenueCell}*(1+${colShock})),"")`,
          PCT_FMT,
        );
      });
    });
  } else if (context.dealFamily === 'income') {
    shocks.forEach((occShock, rIndex) => {
      shocks.forEach((rentShock, cIndex) => {
        const cell = sheet.getCell(5 + rIndex, 2 + cIndex);
        const rowShock = sheet.getCell(5 + rIndex, 1).address;
        const colShock = sheet.getCell(4, 2 + cIndex).address;
        setFormulaCell(
          cell,
          `IFERROR(${context.sheetRefs.revenue.stabilizedIncomeCell}*(1+${colShock})*(1+${rowShock}),"")`,
          SUMMARY_NUM_FMT,
        );
      });
    });
  } else {
    shocks.forEach((occShock, rIndex) => {
      shocks.forEach((adrShock, cIndex) => {
        const cell = sheet.getCell(5 + rIndex, 2 + cIndex);
        const rowShock = sheet.getCell(5 + rIndex, 1).address;
        const colShock = sheet.getCell(4, 2 + cIndex).address;
        setFormulaCell(
          cell,
          `IFERROR(${context.sheetRefs.revenue.totalRevenueCell}*(1+${colShock})*(1+${rowShock}),"")`,
          SUMMARY_NUM_FMT,
        );
      });
    });
  }

  makeSectionHeader(sheet, 12, 'Scenario Read-through', 7);
  setLabelCell(sheet.getCell('A13'), 'Scenario', true);
  setLabelCell(sheet.getCell('B13'), 'Revenue', true);
  setLabelCell(sheet.getCell('C13'), 'Cost', true);
  setLabelCell(sheet.getCell('D13'), 'Margin / NOI', true);
  applyRowFill(sheet.getRow(13), COLORS.lightBlue);

  ['Base', 'Upside', 'Downside'].forEach((scenario, index) => {
    const row = 14 + index;
    setLabelCell(sheet.getCell(row, 1), scenario);
    setFormulaCell(sheet.getCell(row, 2), `INDEX(${SHEETS.scenarios}!$B$4:$B$6,MATCH(A${row},${SHEETS.scenarios}!$A$4:$A$6,0))*${context.sheetRefs.revenue.totalRevenueCell}`);
    setFormulaCell(sheet.getCell(row, 3), `INDEX(${SHEETS.scenarios}!$C$4:$C$6,MATCH(A${row},${SHEETS.scenarios}!$A$4:$A$6,0))*${context.sheetRefs.costs.totalCostCell}`);
    setFormulaCell(sheet.getCell(row, 4), `IFERROR((B${row}-C${row})/B${row},"")`, PCT_FMT);
  });
};

const buildChartsSheet = (workbook, context) => {
  const sheet = makeSheet(workbook, SHEETS.charts);
  sheet.columns = [{ width: 26 }, { width: 16 }, { width: 40 }];
  makeSectionHeader(sheet, 1, 'Chart-ready Outputs', 3);
  ['Series', 'Value', 'Visual'].forEach((heading, index) => {
    setLabelCell(sheet.getCell(3, index + 1), heading, true);
  });
  applyRowFill(sheet.getRow(3), COLORS.lightBlue);

  const rows = [
    ['Revenue / Income', context.sheetRefs.returns.totalRevenueCell],
    ['Total Cost', context.sheetRefs.returns.totalCostCell],
    ['Gross Profit / Spread', `${SHEETS.returns}!$C$${RETURNS_ROWS.grossProfit}`],
    ['Exit Value', `${SHEETS.returns}!$C$${RETURNS_ROWS.exitValue}`],
  ];

  rows.forEach(([label, formula], index) => {
    const row = 4 + index;
    setLabelCell(sheet.getCell(row, 1), label);
    setFormulaCell(sheet.getCell(row, 2), formula, SUMMARY_NUM_FMT, COLORS.linkGreen);
    setFormulaCell(sheet.getCell(row, 3), `REPT("|",ROUND(B${row}/MAX($B$4:$B$7,0.0001)*40,0))`, '@');
  });

  makeSectionHeader(sheet, 10, 'Period Cash Flow Profile', 3);
  setLabelCell(sheet.getCell('A11'), 'Period', true);
  setLabelCell(sheet.getCell('B11'), 'Equity CF', true);
  setLabelCell(sheet.getCell('C11'), 'Visual', true);
  applyRowFill(sheet.getRow(11), COLORS.lightBlue);

  context.periods.forEach((period, index) => {
    const row = 12 + index;
    const cfCol = columnLetter(3 + index);
    setLabelCell(sheet.getCell(row, 1), period.label);
    setFormulaCell(sheet.getCell(row, 2), `${SHEETS.cashFlow}!$${cfCol}$${context.sheetRefs.cashFlow.rowRefs[6]}`, SUMMARY_NUM_FMT, COLORS.linkGreen);
    setFormulaCell(sheet.getCell(row, 3), `REPT("|",ROUND(ABS(B${row})/MAX(MAX($B$12:$B$${11 + context.periods.length}),ABS(MIN($B$12:$B$${11 + context.periods.length})),0.0001)*40,0))`, '@');
  });
};

const buildAuditSheet = (workbook, context) => {
  const sheet = makeSheet(workbook, SHEETS.audit);
  sheet.columns = [{ width: 30 }, { width: 18 }, { width: 18 }, { width: 40 }];
  makeSectionHeader(sheet, 1, 'Audit Checks', 4);
  ['Check', 'Status', 'Value', 'Commentary'].forEach((heading, index) => {
    setLabelCell(sheet.getCell(3, index + 1), heading, true);
  });
  applyRowFill(sheet.getRow(3), COLORS.lightBlue);

  const checks = [
    ['Revenue Phasing Reconciles', `IF(ABS(${context.phasingSheetName}!$${columnLetter(context.sheetRefs.phasing.totalCol)}$${context.sheetRefs.phasing.rowRefs[context.dealFamily === 'development' ? 'collections' : 'income']}-${context.sheetRefs.revenue.totalRevenueCell})<0.1,"PASS","CHECK")`, `ABS(${context.phasingSheetName}!$${columnLetter(context.sheetRefs.phasing.totalCol)}$${context.sheetRefs.phasing.rowRefs[context.dealFamily === 'development' ? 'collections' : 'income']}-${context.sheetRefs.revenue.totalRevenueCell})`, 'Periodized inflow should reconcile to modeled revenue'],
    ['Cost Phasing Reconciles', `IF(ABS(${context.phasingSheetName}!$${columnLetter(context.sheetRefs.phasing.totalCol)}$${context.sheetRefs.phasing.rowRefs.cost}-${context.sheetRefs.costs.totalCostCell})<0.1,"PASS","CHECK")`, `ABS(${context.phasingSheetName}!$${columnLetter(context.sheetRefs.phasing.totalCol)}$${context.sheetRefs.phasing.rowRefs.cost}-${context.sheetRefs.costs.totalCostCell})`, 'Periodized cost should reconcile to total cost'],
    ['Debt Closes', `IF(ABS(${context.sheetRefs.debt.lastClosingCell})<0.1,"PASS","CHECK")`, `ABS(${context.sheetRefs.debt.lastClosingCell})`, 'Terminal debt balance should be near zero'],
    ['Scenario Selection Valid', `IF(COUNTIF(${SHEETS.scenarios}!$A$4:$A$6,${SHEETS.scenarios}!$B$2)=1,"PASS","CHECK")`, `${SHEETS.scenarios}!$B$2`, 'Scenario dropdown must map to a stored case'],
    ['Area Present', `IF(COUNT(${SHEETS.area}!B4:B8)>1,"PASS","CHECK")`, `COUNT(${SHEETS.area}!B4:B8)`, 'Core area drivers should be populated'],
    ['Timing Seeded', context.revenueWeights.some((value) => value !== null) ? '"PASS"' : '"CHECK"', context.revenueWeights.some((value) => value !== null) ? '1' : '0', 'Flags whether phasing was seeded from stored cash flow timing'],
  ];

  checks.forEach(([label, statusFormula, valueFormula, note], index) => {
    const row = 4 + index;
    setLabelCell(sheet.getCell(row, 1), label);
    setFormulaCell(sheet.getCell(row, 2), statusFormula, '@');
    setFormulaCell(sheet.getCell(row, 3), valueFormula, SUMMARY_NUM_FMT);
    setLabelCell(sheet.getCell(row, 4), note);
  });

  setLabelCell(sheet.getCell(`D${4 + checks.length + 1}`), 'Warnings and missing timing assumptions are intentionally surfaced here instead of being silently defaulted.', true);
  styleCell(sheet.getCell(`D${4 + checks.length + 1}`), {
    font: { size: 9, color: { argb: COLORS.warningRed }, italic: true },
    alignment: { wrapText: true },
  });
};

const buildDealWorkbookXlsx = async (exportContext, options = {}) => {
  const context = buildWorkbookContext(exportContext, options);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = options.userName || 'REDIP';
  workbook.company = context.brandName;
  workbook.subject = `${context.assetLabel} underwriting workbook`;
  workbook.title = `${context.brandName} - ${textOrNull(context.deal.name, context.deal.property_name, 'Deal')} workbook`;
  workbook.created = new Date(context.generatedAt);
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  buildCoverSheet(workbook, context);
  buildExecutiveSummarySheet(workbook, context);
  buildAssumptionsSheet(workbook, context);
  buildScenarioSheet(workbook, context);
  buildAreaSheet(workbook, context);
  buildRevenueSheet(workbook, context);
  buildCostsSheet(workbook, context);
  buildPhasingSheet(workbook, context);
  buildCashFlowSheet(workbook, context);
  buildDebtSheet(workbook, context);
  buildReturnsSheet(workbook, context);
  buildSensitivitySheet(workbook, context);
  buildChartsSheet(workbook, context);
  buildAuditSheet(workbook, context);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
};

module.exports = {
  buildDealWorkbookXlsx,
  __testables: {
    buildWorkbookContext,
    buildAssumptionDefinitions,
    columnLetter,
    SHEETS,
    RETURNS_ROWS,
  },
};
