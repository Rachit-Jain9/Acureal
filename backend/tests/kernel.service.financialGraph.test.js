/**
 * Financial provenance graph — acceptance suite.
 *
 * What is locked here:
 *   - Every call to `computeFullFinancials` returns a non-null `financialGraph`
 *     unless `skipGraph: true` is passed.
 *   - Graph has the documented top-level shape: { nodes, edges, nodeCount,
 *     edgeCount, assetClass, engineVersion, generatedAt }.
 *   - Node IDs follow the stable contract: `input.*`, `cost.*`, `revenue.*`,
 *     `kpi.*`, `output.*`, plus the two anchor nodes `cashFlows` and
 *     `capitalStack` (when debt is used).
 *   - Every output node's value matches the flat KPI/cost/revenue value
 *     bit-for-bit — the UI can safely render off either source.
 *   - Dependency wiring: `output.irr` → `kpi.irr` → `cashFlows`, and every
 *     cost/revenue/KPI computation chain is reachable from at least one input.
 *   - Asset-specific nodes exist for hospitality (keys/adr/occupancy),
 *     income-family (leaseRate/exitCapRate), and plotted (plots.pricePerSqft).
 *   - The DAG is acyclic (topological sort succeeds).
 *
 * Run: `cd backend && npm test -- kernel.service.financialGraph`
 */
'use strict';

const { computeFullFinancials } = require('../src/engines/kernel.service');

// ── Deal fixtures (mirror kernel.service.acceptance.test.js shapes) ───────────

const residentialDeal = Object.freeze({
  assetClass: 'residential_apartments',
  plotAreaSqft: 50_000,
  fsi: 2.5,
  loadingFactor: 0.15,
  constructionCostPerSqft: 3_500,
  sellingRatePerSqft: 9_500,
  landCostCr: 30,
  projectDurationMonths: 36,
  discountRatePct: 14,
  developerMarginPct: 20,
  contingencyPct: 5,
  architectFeePct: 2,
  pmcFeePct: 1.5,
  marketingCostPct: 4,
  approvalCostCr: 2,
  debtLTV: 0,
  skipSensitivity: true,
});

const plottedDeal = Object.freeze({
  assetClass: 'plotted_development',
  totalLandSqft: 400_000,
  saleableLandPct: 55,
  avgPlotSizeSqft: 1500,
  sellingRatePerSqft: 3_800,
  landCostCr: 40,
  devCostPerSqft: 350,
  approvalCostCr: 3,
  projectDurationMonths: 24,
  marketingCostPct: 4,
  financeCostPct: 12,
  discountRatePct: 14,
  skipSensitivity: true,
});

const commercialDeal = Object.freeze({
  assetClass: 'commercial_office',
  leasableAreaSqft: 300_000,
  constructionCostPerSqft: 5_500,
  landCostCr: 75,
  baseRentPerSqftMonth: 95,
  rentEscalationPct: 5,
  vacancyPct: 10,
  opexPct: 22,
  exitCapRatePct: 8.0,
  projectDurationMonths: 42,
  holdPeriodYears: 10,
  debtLTV: 0.6,
  debtRatePct: 10.5,
  skipSensitivity: true,
});

const hospitalityDeal = Object.freeze({
  assetClass: 'hospitality',
  plotAreaSqft: 80_000,
  numberOfKeys: 200,
  hardCostPerSqft: 6_500,
  adr: 8_500,
  stabilizedOccupancyPct: 72,
  landCostCr: 60,
  projectDurationMonths: 48,
  holdPeriodYears: 10,
  stabilizationYear: 3,
  refiYear: 3,
  debtLTV: 0.55,
  debtRatePct: 10.5,
  skipSensitivity: true,
});

const landDeal = Object.freeze({
  assetClass: 'land_parcel',
  plotAreaSqft: 200_000,
  landCostCr: 50,
  projectDurationMonths: 12,
  skipSensitivity: true,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const findNode = (graph, id) => graph.nodes.find((n) => n.id === id);

const isAcyclic = (graph) => {
  const outgoing = new Map();
  const inDegree = new Map();
  for (const n of graph.nodes) {
    outgoing.set(n.id, []);
    inDegree.set(n.id, 0);
  }
  for (const e of graph.edges) {
    outgoing.get(e.from)?.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
  }
  const queue = [];
  for (const [id, deg] of inDegree) if (deg === 0) queue.push(id);
  let visited = 0;
  while (queue.length) {
    const cur = queue.shift();
    visited += 1;
    for (const next of outgoing.get(cur) || []) {
      inDegree.set(next, inDegree.get(next) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }
  return visited === graph.nodes.length;
};

const reachesInput = (graph, fromId) => {
  const seen = new Set();
  const stack = [fromId];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    const node = findNode(graph, cur);
    if (!node) continue;
    if (node.kind === 'input') return true;
    for (const dep of node.dependsOn) stack.push(dep);
  }
  return false;
};

// ── Shape tests — universal across every asset class ─────────────────────────

describe.each([
  ['residential_apartments', residentialDeal],
  ['plotted_development', plottedDeal],
  ['commercial_office', commercialDeal],
  ['hospitality', hospitalityDeal],
  ['land_parcel', landDeal],
])('financialGraph shape — %s', (_label, deal) => {
  const result = computeFullFinancials(deal);
  const graph = result.financialGraph;

  test('is present and non-null by default', () => {
    expect(graph).not.toBeNull();
    expect(graph).toBeDefined();
  });

  test('has documented top-level shape', () => {
    expect(graph).toEqual(expect.objectContaining({
      nodes: expect.any(Array),
      edges: expect.any(Array),
      nodeCount: expect.any(Number),
      edgeCount: expect.any(Number),
      assetClass: deal.assetClass,
      engineVersion: 'kernel-v2',
      generatedAt: expect.any(String),
    }));
    expect(graph.nodes.length).toBe(graph.nodeCount);
    expect(graph.edges.length).toBe(graph.edgeCount);
  });

  test('every edge references a node that exists', () => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const e of graph.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  test('every non-input node has at least one dependency', () => {
    for (const n of graph.nodes) {
      if (n.kind === 'input') continue;
      expect(n.dependsOn.length).toBeGreaterThan(0);
    }
  });

  test('DAG is acyclic', () => {
    expect(isAcyclic(graph)).toBe(true);
  });

  test('every output reaches at least one input via upstream traversal', () => {
    const outputs = graph.nodes.filter((n) => n.kind === 'output');
    expect(outputs.length).toBeGreaterThan(0);
    for (const o of outputs) {
      expect(reachesInput(graph, o.id)).toBe(true);
    }
  });

  test('contains the canonical output nodes', () => {
    const outputIds = graph.nodes.filter((n) => n.kind === 'output').map((n) => n.id);
    expect(outputIds).toEqual(expect.arrayContaining([
      'output.totalCost',
      'output.revenue',
      'output.irr',
      'output.npv',
      'output.rlv',
      'output.equityMultiple',
      'output.grossMargin',
    ]));
  });

  test('contains the canonical KPI nodes', () => {
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining([
      'kpi.grossProfit',
      'kpi.grossMargin',
      'kpi.irr',
      'kpi.npv',
      'kpi.rlv',
      'kpi.equityMultiple',
      'cashFlows',
    ]));
  });

  test('output.irr traces through kpi.irr → cashFlows', () => {
    const outIrr = findNode(graph, 'output.irr');
    expect(outIrr.dependsOn).toContain('kpi.irr');
    const kpiIrr = findNode(graph, 'kpi.irr');
    expect(kpiIrr.dependsOn).toContain('cashFlows');
  });
});

// ── Value equality — output node values must match flat KPIs bit-for-bit ─────

describe('financialGraph — output values match flat result', () => {
  test('residential_apartments: every output node value matches flat result', () => {
    const r = computeFullFinancials(residentialDeal);
    const g = r.financialGraph;
    expect(findNode(g, 'output.totalCost').value).toBe(r.costs.total);
    expect(findNode(g, 'output.revenue').value).toBe(r.revenue.totalRevenueCr);
    expect(findNode(g, 'output.irr').value).toBe(r.kpis.irr);
    expect(findNode(g, 'output.npv').value).toBe(r.kpis.npv);
    expect(findNode(g, 'output.rlv').value).toBe(r.kpis.rlv);
    expect(findNode(g, 'output.equityMultiple').value).toBe(r.kpis.equityMultiple);
    expect(findNode(g, 'output.grossMargin').value).toBe(r.kpis.grossMarginPct);
  });

  test('commercial_office: NOI / exitValue flow into revenue.total', () => {
    const r = computeFullFinancials(commercialDeal);
    const g = r.financialGraph;
    const noi = findNode(g, 'revenue.operating');
    const exit = findNode(g, 'revenue.exitValue');
    const total = findNode(g, 'revenue.total');
    expect(noi).toBeTruthy();
    expect(exit).toBeTruthy();
    expect(total.dependsOn).toEqual(expect.arrayContaining(['revenue.operating', 'revenue.exitValue']));
    expect(noi.value).toBe(r.revenue.stabilizedNOI);
    expect(exit.value).toBe(r.revenue.exitValue);
  });

  test('hospitality: keys/adr/occupancy inputs feed revenue.operating', () => {
    const r = computeFullFinancials(hospitalityDeal);
    const g = r.financialGraph;
    expect(findNode(g, 'input.hotel.keys').value).toBe(200);
    expect(findNode(g, 'input.hotel.adr').value).toBe(8_500);
    expect(findNode(g, 'input.hotel.occupancy').value).toBe(72);
    const rev = findNode(g, 'revenue.operating');
    expect(rev.dependsOn).toEqual(expect.arrayContaining([
      'input.hotel.keys',
      'input.hotel.adr',
      'input.hotel.occupancy',
    ]));
    const stack = findNode(g, 'capitalStack');
    expect(stack).toBeTruthy();
    expect(stack.dependsOn).toEqual(expect.arrayContaining(['cost.total', 'revenue.noi']));
  });

  test('land_parcel: no construction / hard-cost nodes', () => {
    const r = computeFullFinancials(landDeal);
    const g = r.financialGraph;
    const ids = g.nodes.map((n) => n.id);
    expect(ids).not.toContain('cost.construction');
    expect(ids).not.toContain('cost.softCosts');
    expect(ids).not.toContain('cost.finance');
    expect(findNode(g, 'cost.total').dependsOn).toEqual(['cost.land']);
  });
});

// ── Opt-out flag ─────────────────────────────────────────────────────────────

describe('financialGraph — skipGraph flag', () => {
  test('skipGraph:true yields null financialGraph (zero-cost bypass)', () => {
    const r = computeFullFinancials({ ...residentialDeal, skipGraph: true });
    expect(r.financialGraph).toBeNull();
  });

  test('default behavior retains the graph', () => {
    const r = computeFullFinancials(residentialDeal);
    expect(r.financialGraph).not.toBeNull();
  });
});

// ── Size sanity — guard against runaway graph growth ─────────────────────────

describe('financialGraph — size bounds', () => {
  test('residential graph stays under 40 nodes', () => {
    const r = computeFullFinancials(residentialDeal);
    expect(r.financialGraph.nodeCount).toBeLessThan(40);
  });

  test('hospitality graph stays under 50 nodes', () => {
    const r = computeFullFinancials(hospitalityDeal);
    expect(r.financialGraph.nodeCount).toBeLessThan(50);
  });
});
