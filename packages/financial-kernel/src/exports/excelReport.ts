/**
 * Workbook row builder. Emits a plain-data representation
 * (`ExcelWorkbook`) that any serializer (exceljs, SheetJS, CSV) can turn
 * into a file. Keeping the kernel IO-free is deliberate — exceljs stays
 * in the backend where it already lives for the 14-sheet deal export.
 *
 * Sheets:
 *   Summary         — one-row KPI snapshot
 *   Monthly         — per-month CFADS, DS, available cash, DSCR
 *   Insights        — sorted by severity with recommendations
 *   Waterfall       — tier-level distributions
 *   Tornado         — sensitivity variable swings
 *   DSCR Profile    — min/max/avg + percentiles
 */
import type { InvestorPackage, ExcelSheet, ExcelWorkbook } from './types';

const round = (n: number | null, dp = 4): number | null =>
  n == null ? null : Number.isFinite(n) ? Number(n.toFixed(dp)) : null;

function summarySheet(pkg: InvestorPackage): ExcelSheet {
  const k = pkg.summary.kpi;
  return {
    name: 'Summary',
    columns: [
      { key: 'metric', header: 'Metric' },
      { key: 'value', header: 'Value' },
    ],
    rows: [
      { metric: 'Deal ID', value: pkg.summary.dealId },
      { metric: 'Engine', value: pkg.summary.engineVersion },
      { metric: 'Generated', value: pkg.summary.generatedAt },
      { metric: 'Headline', value: pkg.summary.headline },
      { metric: 'IRR (Levered) %', value: round(k.irrLeveredPct, 2) },
      { metric: 'IRR (Unlevered) %', value: round(k.irrUnleveredPct, 2) },
      { metric: 'MOIC', value: round(k.moic, 3) },
      { metric: 'Min DSCR', value: round(k.minDSCR, 3) },
      { metric: 'Avg DSCR', value: round(k.avgDSCR, 3) },
      { metric: 'LLCR', value: round(k.llcr, 3) },
      { metric: 'PLCR', value: round(k.plcr, 3) },
      { metric: 'Peak Equity (Cr)', value: round(k.peakEquityCr, 2) },
      { metric: 'Payback Month', value: k.paybackMonth },
      { metric: 'Debt Capacity (Cr)', value: round(k.debtCapacityCr, 2) },
      { metric: 'Peak Debt (Cr)', value: round(k.peakDebtCr, 2) },
      { metric: 'Cumulative Debt Service (Cr)', value: round(k.cumulativeDebtServiceCr, 2) },
      { metric: 'Residual Pool (Cr)', value: round(k.residualTotalCr, 2) },
      { metric: 'Covenant Breach Months', value: k.breachCount },
    ],
  };
}

function monthlySheet(pkg: InvestorPackage): ExcelSheet {
  return {
    name: 'Monthly',
    columns: [
      { key: 'month', header: 'Month' },
      { key: 'cfads', header: 'CFADS (Cr)' },
      { key: 'debtService', header: 'Debt Service (Cr)' },
      { key: 'availableCash', header: 'Available Cash (Cr)' },
      { key: 'dscr', header: 'DSCR' },
    ],
    rows: pkg.monthly.map((r) => ({
      month: r.month,
      cfads: round(r.cfads.toNumber(), 4),
      debtService: round(r.debtService.toNumber(), 4),
      availableCash: round(r.availableCash.toNumber(), 4),
      dscr: round(r.dscr, 3),
    })),
  };
}

function insightsSheet(pkg: InvestorPackage): ExcelSheet {
  return {
    name: 'Insights',
    columns: [
      { key: 'severity', header: 'Severity' },
      { key: 'kind', header: 'Kind' },
      { key: 'title', header: 'Title' },
      { key: 'explanation', header: 'Explanation' },
      { key: 'recommendation', header: 'Recommendation' },
    ],
    rows: pkg.summary.insights.map((i) => ({
      severity: i.severity,
      kind: i.kind,
      title: i.title,
      explanation: i.explanation,
      recommendation: i.recommendation ?? null,
    })),
  };
}

function waterfallSheet(pkg: InvestorPackage): ExcelSheet {
  return {
    name: 'Waterfall',
    columns: [
      { key: 'month', header: 'Month' },
      { key: 'tierId', header: 'Tier' },
      { key: 'stakeholderId', header: 'Stakeholder' },
      { key: 'amount', header: 'Amount (Cr)' },
    ],
    rows: pkg.waterfallRows.map((r) => ({
      month: r.month,
      tierId: r.tierId,
      stakeholderId: r.stakeholderId,
      amount: round(r.amount.toNumber(), 4),
    })),
  };
}

function tornadoSheet(pkg: InvestorPackage): ExcelSheet {
  const rows = pkg.summary.sensitivity?.rows ?? [];
  return {
    name: 'Tornado',
    columns: [
      { key: 'variable', header: 'Variable' },
      { key: 'lowInput', header: 'Low Input' },
      { key: 'highInput', header: 'High Input' },
      { key: 'baseKpi', header: 'Base KPI' },
      { key: 'lowKpi', header: 'Low KPI' },
      { key: 'highKpi', header: 'High KPI' },
      { key: 'swing', header: 'Swing (abs)' },
    ],
    rows: rows.map((r) => ({
      variable: r.variable,
      lowInput: round(r.lowInput.toNumber(), 4),
      highInput: round(r.highInput.toNumber(), 4),
      baseKpi: round(r.baseKPI.toNumber(), 6),
      lowKpi: round(r.lowKPI.toNumber(), 6),
      highKpi: round(r.highKPI.toNumber(), 6),
      swing: round(r.swing, 6),
    })),
  };
}

function dscrProfileSheet(pkg: InvestorPackage): ExcelSheet {
  const k = pkg.summary.kpi;
  return {
    name: 'DSCR Profile',
    columns: [
      { key: 'stat', header: 'Statistic' },
      { key: 'value', header: 'Value' },
    ],
    rows: [
      { stat: 'Min', value: round(k.minDSCR, 3) },
      { stat: 'P5', value: round(k.p5DSCR, 3) },
      { stat: 'P25', value: round(k.p25DSCR, 3) },
      { stat: 'P50 (Median)', value: round(k.p50DSCR, 3) },
      { stat: 'P75', value: round(k.p75DSCR, 3) },
      { stat: 'Average', value: round(k.avgDSCR, 3) },
      { stat: 'Max', value: round(k.maxDSCR, 3) },
      { stat: 'Breach Months (<1.0x)', value: k.breachCount },
    ],
  };
}

export function buildInvestorWorkbook(pkg: InvestorPackage): ExcelWorkbook {
  return {
    sheets: [
      summarySheet(pkg),
      monthlySheet(pkg),
      insightsSheet(pkg),
      dscrProfileSheet(pkg),
      waterfallSheet(pkg),
      tornadoSheet(pkg),
    ],
  };
}
