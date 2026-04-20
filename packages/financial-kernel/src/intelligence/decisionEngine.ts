/**
 * Decision engine — rule-based investor insights.
 * Thresholds calibrated to Indian CRE institutional practice.
 *
 * Every insight has (kind, severity, title, explanation, recommendation,
 * metrics) so the exports layer can render both concise badges and full
 * narrative. Keep rules deterministic — no LLM here.
 */
import type { Decimal } from '../decimal';
import type { IntelligenceKPIs, Insight } from './types';

export interface DecisionContext {
  readonly kpis: IntelligenceKPIs;
  readonly ltcPct?: Decimal | null;
  readonly ltvPct?: Decimal | null;
  readonly residualCr: Decimal;
  readonly breachCount: number;
}

export function evaluateDeal(ctx: DecisionContext): readonly Insight[] {
  const out: Insight[] = [];
  const { kpis } = ctx;

  const irrPct = kpis.irrLevered == null ? null : kpis.irrLevered.toNumber() * 100;
  if (irrPct == null) {
    out.push({
      kind: 'risk',
      severity: 'high',
      title: 'IRR not computable',
      explanation: 'Equity cash flows do not cross zero — cannot solve for a rate of return.',
      recommendation: 'Verify equity contribution timing and exit proceeds.',
      metrics: { irrLevered: null },
    });
  } else if (irrPct < 12) {
    out.push({
      kind: 'risk',
      severity: 'high',
      title: 'Low levered IRR',
      explanation: `Levered IRR ${irrPct.toFixed(1)}% is below the 12% institutional threshold for Indian CRE.`,
      recommendation: 'Increase rent growth, reduce acquisition price, or raise leverage within covenant limits.',
      metrics: { irrPct },
    });
  } else if (irrPct < 18) {
    out.push({
      kind: 'observation',
      severity: 'medium',
      title: 'Acceptable IRR',
      explanation: `Levered IRR ${irrPct.toFixed(1)}% sits in the core-plus range (12–18%).`,
      recommendation: 'Consider whether incremental leverage could lift return without breaching covenants.',
      metrics: { irrPct },
    });
  } else {
    out.push({
      kind: 'opportunity',
      severity: 'low',
      title: 'Strong IRR profile',
      explanation: `Levered IRR ${irrPct.toFixed(1)}% exceeds the 18% value-add threshold.`,
      recommendation: 'Pressure-test exit cap and rent-growth assumptions before IC.',
      metrics: { irrPct },
    });
  }

  const md = kpis.dscrProfile.min?.toNumber() ?? null;
  if (md != null) {
    if (md < 1.0) {
      out.push({
        kind: 'risk',
        severity: 'critical',
        title: 'DSCR breach',
        explanation: `Minimum DSCR ${md.toFixed(2)}x falls below 1.0x in ${kpis.dscrProfile.countBelow1_0} month(s) — cash flow cannot service debt.`,
        recommendation: 'Reduce leverage, extend amortization, or pre-fund a 12-month DSRA.',
        metrics: { minDSCR: md, countBelow1_0: kpis.dscrProfile.countBelow1_0 },
      });
    } else if (md < 1.25) {
      out.push({
        kind: 'risk',
        severity: 'high',
        title: 'Thin DSCR cushion',
        explanation: `Minimum DSCR ${md.toFixed(2)}x is below the 1.25x institutional floor (${kpis.dscrProfile.countBelow1_25} months under 1.25x).`,
        recommendation: 'Consider a DSRA top-up, longer interest-only period, or reducing quantum by 5–10%.',
        metrics: { minDSCR: md, countBelow1_25: kpis.dscrProfile.countBelow1_25 },
      });
    } else if (md < 1.5) {
      out.push({
        kind: 'observation',
        severity: 'low',
        title: 'Adequate DSCR',
        explanation: `Minimum DSCR ${md.toFixed(2)}x sits above the institutional floor with modest cushion.`,
        metrics: { minDSCR: md },
      });
    } else {
      out.push({
        kind: 'opportunity',
        severity: 'low',
        title: 'Strong DSCR cushion',
        explanation: `Minimum DSCR ${md.toFixed(2)}x leaves room for additional leverage.`,
        recommendation: 'Run a higher-LTV scenario to test whether IRR lifts meaningfully.',
        metrics: { minDSCR: md },
      });
    }
  }

  const llcrVal = kpis.llcr?.toNumber() ?? null;
  if (llcrVal != null && llcrVal < 1.1) {
    out.push({
      kind: 'risk',
      severity: 'high',
      title: 'Weak LLCR',
      explanation: `LLCR ${llcrVal.toFixed(2)}x — PV of CFADS barely covers outstanding debt.`,
      recommendation: 'Reduce debt quantum or negotiate a longer tenor.',
      metrics: { llcr: llcrVal },
    });
  }

  if (ctx.ltcPct != null) {
    const p = ctx.ltcPct.toNumber();
    if (p > 75) {
      out.push({
        kind: 'risk',
        severity: 'high',
        title: 'High LTC',
        explanation: `LTC ${p.toFixed(1)}% exceeds the 75% conservative threshold.`,
        recommendation: 'Bring in more equity or restructure into senior + mezzanine.',
        metrics: { ltcPct: p },
      });
    }
  }

  if (ctx.ltvPct != null) {
    const p = ctx.ltvPct.toNumber();
    if (p > 70) {
      out.push({
        kind: 'risk',
        severity: 'medium',
        title: 'High LTV',
        explanation: `LTV ${p.toFixed(1)}% is above 70%.`,
        recommendation: 'Validate property valuation — stressed LTV could breach 75%.',
        metrics: { ltvPct: p },
      });
    }
  }

  const res = ctx.residualCr.toNumber();
  if (res < 0) {
    out.push({
      kind: 'risk',
      severity: 'critical',
      title: 'Distribution shortfall',
      explanation: `Residual pool is negative (₹${res.toFixed(2)} Cr) — waterfall under-delivers.`,
      recommendation: 'Verify fee/reserve assumptions and reduce promote targets.',
      metrics: { residualCr: res },
    });
  }

  if (ctx.breachCount > 0) {
    out.push({
      kind: 'risk',
      severity: 'high',
      title: 'Covenant breaches',
      explanation: `${ctx.breachCount} covenant-breach month(s) detected.`,
      recommendation: 'Review cure periods and waiver likelihood with lender.',
      metrics: { breachCount: ctx.breachCount },
    });
  }

  return out;
}

/** Short human-readable narrative composed from the highest-severity insights. */
export function buildNarrative(insights: readonly Insight[], kpis: IntelligenceKPIs): string {
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...insights].sort((a, b) => order[a.severity] - order[b.severity]);
  const lead = sorted[0];
  const irrPct = kpis.irrLevered == null ? 'n/a' : `${(kpis.irrLevered.toNumber() * 100).toFixed(1)}%`;
  const md = kpis.dscrProfile.min == null ? 'n/a' : `${kpis.dscrProfile.min.toNumber().toFixed(2)}x`;
  const head = `Levered IRR ${irrPct} · min DSCR ${md}.`;
  if (!lead) return `${head} No flags raised.`;
  return `${head} ${lead.title}: ${lead.explanation}${lead.recommendation ? ' ' + lead.recommendation : ''}`;
}
