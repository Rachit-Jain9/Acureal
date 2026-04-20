/**
 * Builds the investor-facing `InvestorPackage` from an orchestrator
 * output. Keeps the shape flat, numeric, and serialization-ready so
 * the UI / PDF / XLSX pipelines don't need kernel internals.
 *
 * Mirrors the Python `intelligence.report.build_investor_package`
 * shape so the HTTP boundary is engine-agnostic.
 */
import { Decimal } from '../decimal';
import type { Insight, IntelligenceReport, IntelligenceKPIs } from '../intelligence/types';
import type { OrchestrationOutput } from '../orchestration/types';
import type {
  InsightsByKind,
  InvestorKPI,
  InvestorPackage,
  InvestorSummary,
  MonthlyCashFlowRow,
} from './types';

const num = (d: Decimal | null | undefined): number | null =>
  d == null ? null : d.toNumber();

const SEVERITY_RANK: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1, info: 0,
};

function sortBySeverity(insights: readonly Insight[]): Insight[] {
  return [...insights].sort(
    (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
  );
}

function groupByKind(insights: readonly Insight[]): InsightsByKind {
  const buckets: { risk: Insight[]; opportunity: Insight[]; observation: Insight[] } = {
    risk: [], opportunity: [], observation: [],
  };
  for (const i of insights) {
    (buckets[i.kind] ?? buckets.observation).push(i);
  }
  return buckets;
}

function dedupeRecommendations(insights: readonly Insight[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of insights) {
    const r = i.recommendation;
    if (!r || seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}

function headline(kpis: IntelligenceKPIs): string {
  const irr = kpis.irrLevered;
  const dscr = kpis.dscrProfile.min;
  const irrStr = irr == null ? 'IRR n/a' : `IRR ${(irr.toNumber() * 100).toFixed(2)}%`;
  const dscrStr = dscr == null ? '' : ` · Min DSCR ${dscr.toNumber().toFixed(2)}x`;
  return `${irrStr}${dscrStr}`;
}

function buildKpi(
  intelligence: IntelligenceReport,
  out: OrchestrationOutput,
  residualTotalCr: number,
): InvestorKPI {
  const k = intelligence.kpis;
  const p = k.dscrProfile;
  return {
    irrLeveredPct: k.irrLevered == null ? null : k.irrLevered.toNumber() * 100,
    irrUnleveredPct: k.irrUnlevered == null ? null : k.irrUnlevered.toNumber() * 100,
    moic: num(k.moic),
    minDSCR: num(p.min),
    maxDSCR: num(p.max),
    avgDSCR: num(p.avg),
    p5DSCR: num(p.p5),
    p25DSCR: num(p.p25),
    p50DSCR: num(p.p50),
    p75DSCR: num(p.p75),
    llcr: num(k.llcr),
    plcr: num(k.plcr),
    peakEquityCr: k.peakEquityCr.toNumber(),
    paybackMonth: k.paybackMonth,
    debtCapacityCr: k.debtCapacity.maxDebtCr.toNumber(),
    cumulativeDebtServiceCr: out.kpis.cumulativeDebtServiceCr,
    peakDebtCr: out.kpis.peakDebtCr,
    residualTotalCr,
    breachCount: out.kpis.breachCount,
  };
}

export function buildInvestorPackage(
  out: OrchestrationOutput,
  intelligence: IntelligenceReport,
  dealId: string,
): InvestorPackage {
  const totalMonths = out.aggregate.totalMonths;
  const monthly: MonthlyCashFlowRow[] = [];
  for (let m = 0; m < totalMonths; m++) {
    const cfads = out.cfads.monthly[m] ?? Decimal.zero();
    const ds = out.aggregate.monthlyDebtService[m] ?? Decimal.zero();
    const cov = out.covenants.monthly[m];
    monthly.push({
      month: m,
      cfads,
      debtService: ds,
      availableCash: cfads.sub(ds),
      dscr: cov?.dscr ?? null,
    });
  }

  const waterfallRows = out.waterfall
    ? out.waterfall.rows.map((r) => ({
        month: r.month,
        tierId: r.tierId,
        stakeholderId: r.stakeholderId,
        amount: r.amount,
      }))
    : [];

  const residualTotal = out.waterfall
    ? out.waterfall.residualByMonth.reduce((a, d) => a.add(d), Decimal.zero()).toNumber()
    : 0;

  const sorted = sortBySeverity(intelligence.insights);
  const byKind = groupByKind(sorted);
  const recs = dedupeRecommendations(sorted);

  const summary: InvestorSummary = {
    dealId,
    engineVersion: out.engineVersion,
    generatedAt: intelligence.generatedAt,
    headline: headline(intelligence.kpis),
    kpi: buildKpi(intelligence, out, residualTotal),
    insights: sorted,
    insightsByKind: byKind,
    recommendations: recs,
    sensitivity: intelligence.sensitivity,
    graph: intelligence.graph,
    narrative: intelligence.narrative,
  };
  return { summary, monthly, waterfallRows };
}
