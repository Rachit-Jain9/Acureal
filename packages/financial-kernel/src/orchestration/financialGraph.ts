/**
 * FinancialGraph — dependency DAG of every computation in a deal run.
 *
 * The orchestrator populates this at emit time. It lets the UI answer:
 *   - "What inputs feed this KPI?"   (upstream traversal)
 *   - "What downstream breaks if I change LTV?"  (downstream traversal)
 *   - "Show the full provenance chain for insights."  (snapshot)
 *
 * Graph is *off the hot path* — adding it never affects kernel math.
 */
import type { Decimal } from '../decimal';
import type {
  FinancialGraphNode,
  FinancialGraphSnapshot,
  FinancialGraphEdge,
} from '../intelligence/types';

export class FinancialGraph {
  private readonly nodes = new Map<string, FinancialGraphNode>();
  private readonly fwd = new Map<string, Set<string>>();

  addInput(
    id: string,
    label: string,
    value?: Decimal | number | string | null,
    unit?: string,
  ): void {
    this.assertNew(id);
    this.nodes.set(id, { id, kind: 'input', label, dependsOn: [], value, unit });
  }

  addComputation(
    id: string,
    label: string,
    dependsOn: readonly string[],
    value?: Decimal | number | string | null,
    unit?: string,
    provenance?: readonly string[],
  ): void {
    this.assertNew(id);
    this.nodes.set(id, {
      id, kind: 'computation', label, dependsOn: [...dependsOn], value, unit, provenance,
    });
    this.wire(id, dependsOn);
  }

  addOutput(
    id: string,
    label: string,
    dependsOn: readonly string[],
    value?: Decimal | number | string | null,
    unit?: string,
    provenance?: readonly string[],
  ): void {
    this.assertNew(id);
    this.nodes.set(id, {
      id, kind: 'output', label, dependsOn: [...dependsOn], value, unit, provenance,
    });
    this.wire(id, dependsOn);
  }

  /** All nodes reachable *upward* from id (things it depends on, transitively). */
  upstream(id: string): string[] {
    const out = new Set<string>();
    const stack: string[] = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      const node = this.nodes.get(cur);
      if (!node) continue;
      for (const d of node.dependsOn) {
        if (!out.has(d)) { out.add(d); stack.push(d); }
      }
    }
    return [...out];
  }

  /** All nodes reachable *downward* from id (things that depend on it). */
  downstream(id: string): string[] {
    const out = new Set<string>();
    const stack: string[] = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      const nxt = this.fwd.get(cur);
      if (!nxt) continue;
      for (const d of nxt) {
        if (!out.has(d)) { out.add(d); stack.push(d); }
      }
    }
    return [...out];
  }

  hasNode(id: string): boolean { return this.nodes.has(id); }
  size(): number { return this.nodes.size; }
  nodeIds(): string[] { return [...this.nodes.keys()]; }

  snapshot(): FinancialGraphSnapshot {
    const edges: FinancialGraphEdge[] = [];
    for (const n of this.nodes.values()) {
      for (const d of n.dependsOn) edges.push({ from: d, to: n.id });
    }
    return { nodes: [...this.nodes.values()], edges };
  }

  private wire(id: string, dependsOn: readonly string[]): void {
    for (const d of dependsOn) {
      if (!this.fwd.has(d)) this.fwd.set(d, new Set());
      this.fwd.get(d)!.add(id);
    }
  }

  private assertNew(id: string): void {
    if (this.nodes.has(id)) throw new Error(`financial-graph: duplicate node '${id}'`);
  }
}

export interface StandardGraphInputs {
  readonly facilityIds: readonly string[];
  readonly tierIds: readonly string[];
  readonly hasDSRA: boolean;
  readonly hasCashTraps: boolean;
  readonly hasCovenants: boolean;
}

/** Canonical graph shape for a REDIP deal. Orchestrator populates values. */
export function buildStandardGraph(inp: StandardGraphInputs): FinancialGraph {
  const g = new FinancialGraph();
  g.addInput('assumptions', 'Deal assumptions');
  g.addInput('cfads_inputs', 'Revenue, opex, taxes, capex');
  for (const id of inp.facilityIds) g.addInput(`facility:${id}`, `Facility ${id}`);
  g.addComputation(
    'debt_service',
    'Monthly debt service',
    inp.facilityIds.map((id) => `facility:${id}`),
  );
  g.addComputation('cfads', 'CFADS (revenue − opex − taxes − capex)', ['cfads_inputs']);
  if (inp.hasDSRA) g.addComputation('dsra', 'DSRA balance', ['debt_service']);
  if (inp.hasCashTraps) {
    g.addComputation('cash_traps', 'Trapped cash', ['cfads', 'debt_service']);
  }
  const availableDeps = ['cfads', 'debt_service'];
  if (inp.hasDSRA) availableDeps.push('dsra');
  if (inp.hasCashTraps) availableDeps.push('cash_traps');
  g.addComputation('available_cash', 'Distributable cash per month', availableDeps);
  for (const tid of inp.tierIds) g.addComputation(`tier:${tid}`, `Waterfall tier ${tid}`, ['available_cash']);
  const tierDeps = inp.tierIds.map((t) => `tier:${t}`);
  if (inp.hasCovenants) g.addComputation('covenants', 'Covenant evaluation', ['cfads', 'debt_service']);
  g.addComputation('kpi:irr', 'IRR (levered / unlevered)', ['available_cash', ...tierDeps]);
  g.addComputation('kpi:dscr_profile', 'DSCR profile', ['cfads', 'debt_service']);
  g.addComputation('kpi:llcr', 'LLCR', ['cfads', 'debt_service']);
  g.addComputation('kpi:debt_capacity', 'Max debt at target DSCR', ['cfads']);
  const insightDeps: string[] = ['kpi:irr', 'kpi:dscr_profile', 'kpi:llcr', 'kpi:debt_capacity'];
  if (inp.hasCovenants) insightDeps.push('covenants');
  g.addOutput('insights', 'Investor insights', insightDeps);
  g.addOutput('sensitivity', 'Tornado / sensitivity', ['kpi:irr', 'cfads_inputs', 'assumptions']);
  return g;
}
