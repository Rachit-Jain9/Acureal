/**
 * Intelligence layer — shared types for KPI engine, decision engine,
 * sensitivity, and the financial graph. Mirrors the Python wire shape.
 */
import type { Decimal } from '../decimal';

export type InsightKind = 'risk' | 'opportunity' | 'observation';
export type InsightSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Insight {
  readonly kind: InsightKind;
  readonly severity: InsightSeverity;
  readonly title: string;
  readonly explanation: string;
  readonly recommendation?: string;
  readonly metrics?: Readonly<Record<string, number | string | null>>;
}

export interface DSCRProfile {
  readonly min: Decimal | null;
  readonly max: Decimal | null;
  readonly avg: Decimal | null;
  readonly p5: Decimal | null;
  readonly p25: Decimal | null;
  readonly p50: Decimal | null;
  readonly p75: Decimal | null;
  readonly countBelow1_0: number;
  readonly countBelow1_25: number;
}

export interface DebtCapacityResult {
  readonly maxDebtCr: Decimal;
  readonly bindingMonth: number | null;
  readonly achievedMinDSCR: Decimal | null;
}

export interface IntelligenceKPIs {
  readonly irrLevered: Decimal | null;
  readonly irrUnlevered: Decimal | null;
  readonly moic: Decimal | null;
  readonly equityMultiple: Decimal | null;
  readonly dscrProfile: DSCRProfile;
  readonly llcr: Decimal | null;
  readonly plcr: Decimal | null;
  readonly peakEquityCr: Decimal;
  readonly paybackMonth: number | null;
  readonly debtCapacity: DebtCapacityResult;
}

export interface TornadoRow {
  readonly variable: string;
  readonly lowInput: Decimal;
  readonly highInput: Decimal;
  readonly baseKPI: Decimal;
  readonly lowKPI: Decimal;
  readonly highKPI: Decimal;
  readonly swing: number;
}

export interface SensitivityReport {
  readonly targetKPI: 'irr_levered' | 'min_dscr' | 'residual' | 'custom';
  readonly baseKPI: Decimal;
  readonly rows: readonly TornadoRow[];
  readonly variables: readonly string[];
}

export interface FinancialGraphNode {
  readonly id: string;
  readonly kind: 'input' | 'computation' | 'output';
  readonly label: string;
  readonly dependsOn: readonly string[];
  readonly value?: Decimal | number | string | null;
  readonly unit?: string;
  readonly provenance?: readonly string[];
}

export interface FinancialGraphEdge {
  readonly from: string;
  readonly to: string;
}

export interface FinancialGraphSnapshot {
  readonly nodes: readonly FinancialGraphNode[];
  readonly edges: readonly FinancialGraphEdge[];
}

export interface IntelligenceReport {
  readonly kpis: IntelligenceKPIs;
  readonly insights: readonly Insight[];
  readonly sensitivity: SensitivityReport | null;
  readonly graph: FinancialGraphSnapshot | null;
  readonly narrative: string;
  readonly generatedAt: string;
  readonly source: 'v2-ts' | 'v2-python';
}
