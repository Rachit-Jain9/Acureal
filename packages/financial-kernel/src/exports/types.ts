/**
 * Exports layer types — the investor-facing payload the UI and PDF/XLSX
 * renderers consume. Every field is strongly typed so downstream code
 * can render without inspecting raw kernel internals.
 *
 * Must round-trip the shape emitted by the Python
 * `intelligence.report.build_investor_package` so the HTTP boundary
 * stays engine-agnostic.
 */
import type { Decimal } from '../decimal';
import type { Insight, IntelligenceReport } from '../intelligence/types';

export type InsightKind = 'risk' | 'opportunity' | 'observation';

export interface InvestorKPI {
  readonly irrLeveredPct: number | null;
  readonly irrUnleveredPct: number | null;
  readonly moic: number | null;
  readonly minDSCR: number | null;
  readonly maxDSCR: number | null;
  readonly avgDSCR: number | null;
  readonly p5DSCR: number | null;
  readonly p25DSCR: number | null;
  readonly p50DSCR: number | null;
  readonly p75DSCR: number | null;
  readonly llcr: number | null;
  readonly plcr: number | null;
  readonly peakEquityCr: number;
  readonly paybackMonth: number | null;
  readonly debtCapacityCr: number;
  readonly cumulativeDebtServiceCr: number;
  readonly peakDebtCr: number;
  readonly residualTotalCr: number;
  readonly breachCount: number;
}

export interface InsightsByKind {
  readonly risk: readonly Insight[];
  readonly opportunity: readonly Insight[];
  readonly observation: readonly Insight[];
}

export interface InvestorSummary {
  readonly dealId: string;
  /** Which runtime produced the numbers. Matches orchestration EngineVersion. */
  readonly engineVersion: 'inline' | 'python' | 'safe-mode';
  readonly generatedAt: string;
  readonly headline: string;
  readonly kpi: InvestorKPI;
  readonly insights: readonly Insight[];
  readonly insightsByKind: InsightsByKind;
  readonly recommendations: readonly string[];
  readonly sensitivity: IntelligenceReport['sensitivity'];
  readonly graph: IntelligenceReport['graph'];
  readonly narrative: string;
}

export interface MonthlyCashFlowRow {
  readonly month: number;
  readonly cfads: Decimal;
  readonly debtService: Decimal;
  readonly availableCash: Decimal;
  readonly dscr: number | null;
}

export interface WaterfallDistributionRow {
  readonly month: number;
  readonly tierId: string;
  readonly stakeholderId: string;
  readonly amount: Decimal;
}

export interface InvestorPackage {
  readonly summary: InvestorSummary;
  readonly monthly: readonly MonthlyCashFlowRow[];
  readonly waterfallRows: readonly WaterfallDistributionRow[];
}

/** Shape of a single workbook sheet — caller serializes with exceljs/SheetJS. */
export interface ExcelSheet {
  readonly name: string;
  readonly columns: readonly { readonly key: string; readonly header: string }[];
  readonly rows: readonly Record<string, string | number | null>[];
}

export interface ExcelWorkbook {
  readonly sheets: readonly ExcelSheet[];
}
