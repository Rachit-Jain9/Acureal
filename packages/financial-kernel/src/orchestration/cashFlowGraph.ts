/**
 * Cash-flow graph — event-sourced assembly of the monthly cash pool
 * that the waterfall distributes.
 *
 * Nodes:
 *   - revenue / opex / tax / capex (external)
 *   - debt draws / interest / principal / prepayment (facility-level)
 *   - DSRA funding & release
 *   - working-capital delta
 *
 * Edges are time-indexed (monthly). The graph is assembled from the
 * debt engine output plus the CFADS primitives, then reduced to a
 * single `availableByMonth` series for the waterfall.
 */

import { Decimal, sum as decSum } from '../decimal';
import type {
  CFADSOutputs,
  DebtScheduleAggregate,
} from '../debt-engine';

export interface CashFlowGraphInputs {
  readonly cfads: CFADSOutputs;
  readonly debt: DebtScheduleAggregate;
  readonly dsraFundingPerMonth?: readonly Decimal[];
  readonly dsraReleasePerMonth?: readonly Decimal[];
  readonly cashTrapsPerMonth?: readonly Decimal[];
  readonly totalMonths: number;
}

export interface CashFlowGraphOutput {
  /** CFADS − debt service − DSRA funding + DSRA release − cash traps. */
  readonly availableByMonth: readonly Decimal[];
  /** Running cash balance (non-negative, driven by available + prior). */
  readonly endingCashByMonth: readonly Decimal[];
  readonly debtServiceByMonth: readonly Decimal[];
  readonly cfadsByMonth: readonly Decimal[];
}

export function buildCashFlowGraph(inputs: CashFlowGraphInputs): CashFlowGraphOutput {
  const { totalMonths } = inputs;
  const cfads = inputs.cfads.monthly;
  const ds = inputs.debt.monthlyDebtService;
  const dsraFund = inputs.dsraFundingPerMonth ?? [];
  const dsraRel = inputs.dsraReleasePerMonth ?? [];
  const traps = inputs.cashTrapsPerMonth ?? [];

  const available: Decimal[] = [];
  const cash: Decimal[] = [];
  const debtService: Decimal[] = [];
  const cfadsOut: Decimal[] = [];
  let running = Decimal.zero();
  for (let m = 0; m < totalMonths; m++) {
    const c = m < cfads.length ? cfads[m] : Decimal.zero();
    const d = m < ds.length ? ds[m] : Decimal.zero();
    const fund = m < dsraFund.length ? dsraFund[m] : Decimal.zero();
    const rel = m < dsraRel.length ? dsraRel[m] : Decimal.zero();
    const trap = m < traps.length ? traps[m] : Decimal.zero();
    const net = c.sub(d).sub(fund).add(rel).sub(trap);
    available.push(net.isNegative() ? Decimal.zero() : net);
    running = running.add(available[m]);
    cash.push(running);
    debtService.push(d);
    cfadsOut.push(c);
  }
  return {
    availableByMonth: available,
    endingCashByMonth: cash,
    debtServiceByMonth: debtService,
    cfadsByMonth: cfadsOut,
  };
}

/** Total distributable cash across horizon. */
export function totalDistributable(graph: CashFlowGraphOutput): Decimal {
  return decSum(graph.availableByMonth);
}
