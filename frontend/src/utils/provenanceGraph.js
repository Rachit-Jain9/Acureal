/**
 * Client-side mirror of `buildStandardGraph` from
 * `packages/financial-kernel/src/orchestration/financialGraph.ts`, extended
 * with asset-class-specific upstream topology so the UI shows the actual
 * computation chain for the deal being viewed (not a one-size-fits-all DAG).
 *
 * The kernel builds the same topology at runtime. We replicate it here
 * so the UI can render the provenance DAG without requiring a full
 * orchestration round-trip for every deal view. When the kernel's
 * shape evolves, update this mirror in lock-step.
 */

const INCOME_CLASSES = new Set([
  'commercial_office',
  'retail',
  'industrial_warehousing',
]);
const HOSPITALITY_CLASSES = new Set(['hospitality']);
const LAND_ONLY_CLASSES = new Set(['land_parcel']);
const MERCHANT_SALE_CLASSES = new Set([
  'residential_apartments',
  'plotted_development',
  'villas',
  'mixed_use',
  'redevelopment',
]);

/**
 * Build an asset-class-aware topology graph for the KPIs of a single deal.
 *
 * @param {object} opts
 * @param {string}   [opts.assetClass]   one of the REDIP asset classes
 * @param {string[]} [opts.facilityIds]  one entry per debt facility
 * @param {string[]} [opts.tierIds]      one entry per waterfall tier
 * @param {boolean}  [opts.hasDSRA]
 * @param {boolean}  [opts.hasCashTraps]
 * @param {boolean}  [opts.hasCovenants]
 * @returns {{nodes: Array, edges: Array}}
 */
export function buildStandardGraph({
  assetClass,
  facilityIds = ['construction-loan'],
  tierIds = [],
  hasDSRA = false,
  hasCashTraps = false,
  hasCovenants = true,
} = {}) {
  const nodes = [];
  const edges = [];
  const seen = new Set();

  const addNode = (id, kind, label, dependsOn = []) => {
    if (seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, kind, label, dependsOn });
    for (const from of dependsOn) edges.push({ from, to: id });
  };

  // ── Inputs ────────────────────────────────────────────────────────────────
  addNode('assumptions', 'input', 'Deal assumptions');
  facilityIds.forEach((id) => addNode(`facility:${id}`, 'input', `Facility ${id}`));

  // ── Asset-class-specific revenue/cost pipeline ────────────────────────────
  const isIncome = INCOME_CLASSES.has(assetClass);
  const isHospitality = HOSPITALITY_CLASSES.has(assetClass);
  const isLandOnly = LAND_ONLY_CLASSES.has(assetClass);
  const isMerchant = MERCHANT_SALE_CLASSES.has(assetClass) ||
    (!isIncome && !isHospitality && !isLandOnly);

  if (isIncome) {
    addNode('input.area', 'input', 'Leasable area, rent, cap rates');
    addNode('comp.rent', 'computation', 'Gross rent (PGI)', ['input.area', 'assumptions']);
    addNode('comp.egi', 'computation', 'EGI (− vacancy)', ['comp.rent']);
    addNode('comp.opex', 'computation', 'OPEX', ['comp.egi', 'assumptions']);
    addNode('comp.noi', 'computation', 'Stabilized NOI', ['comp.egi', 'comp.opex']);
    addNode('comp.entryValue', 'computation', 'Entry value (NOI / entryCap)', ['comp.noi']);
    addNode('comp.exitValue', 'computation', 'Exit value (NOI_exit / exitCap)', ['comp.noi']);
    addNode('comp.yieldOnCost', 'computation', 'Yield on cost', ['comp.noi']);
    addNode('cfads_inputs', 'computation', 'Revenue stream (NOI + exit)', [
      'comp.noi', 'comp.exitValue',
    ]);
  } else if (isHospitality) {
    addNode('input.keys', 'input', 'Keys, ADR, occupancy');
    addNode('comp.revPar', 'computation', 'RevPAR (ADR × Occ)', ['input.keys', 'assumptions']);
    addNode('comp.rooms', 'computation', 'Rooms revenue', ['comp.revPar']);
    addNode('comp.fb', 'computation', 'F&B revenue', ['comp.rooms', 'assumptions']);
    addNode('comp.totalRev', 'computation', 'Total revenue', ['comp.rooms', 'comp.fb']);
    addNode('comp.gop', 'computation', 'GOP (USALI)', ['comp.totalRev', 'assumptions']);
    addNode('comp.ebitda', 'computation', 'EBITDA (GOP − FF&E)', ['comp.gop']);
    addNode('comp.exitValue', 'computation', 'Exit value (EBITDA / cap)', ['comp.ebitda']);
    addNode('cfads_inputs', 'computation', 'Revenue stream (opex, FF&E)', [
      'comp.ebitda', 'comp.exitValue',
    ]);
  } else if (isLandOnly) {
    addNode('input.landArea', 'input', 'Land area, appreciation rate');
    addNode('comp.holdingCost', 'computation', 'Holding cost over period', ['assumptions']);
    addNode('comp.exitValue', 'computation', 'Exit price (compounded)', ['input.landArea']);
    addNode('cfads_inputs', 'computation', 'Net proceeds − holding', [
      'comp.exitValue', 'comp.holdingCost',
    ]);
  } else if (isMerchant) {
    addNode('input.area', 'input', 'Plot, FSI, loading, saleable');
    addNode('comp.revenue', 'computation', 'Sales revenue (area × rate)', [
      'input.area', 'assumptions',
    ]);
    addNode('comp.hardCost', 'computation', 'Hard cost (area × ₹/sqft)', [
      'input.area', 'assumptions',
    ]);
    addNode('comp.softCost', 'computation', 'Soft cost (approval, arch, PMC, mktg)', [
      'comp.hardCost', 'comp.revenue',
    ]);
    addNode('comp.financeCost', 'computation', 'Finance cost (S-curve draws + capitalised interest)', [
      'comp.hardCost', 'assumptions',
    ]);
    addNode('comp.rlv', 'computation', 'Residual land value', [
      'comp.revenue', 'comp.hardCost', 'comp.softCost', 'comp.financeCost',
    ]);
    addNode('cfads_inputs', 'computation', 'Quarterly cash flows', [
      'comp.revenue', 'comp.hardCost', 'comp.softCost', 'comp.financeCost',
    ]);
  } else {
    addNode('cfads_inputs', 'input', 'Revenue, opex, taxes, capex');
  }

  // ── Debt service and availability ─────────────────────────────────────────
  addNode(
    'debt_service',
    'computation',
    'Monthly debt service',
    facilityIds.map((id) => `facility:${id}`),
  );
  addNode('cfads', 'computation', 'CFADS', ['cfads_inputs']);
  if (hasDSRA) addNode('dsra', 'computation', 'DSRA balance', ['debt_service']);
  if (hasCashTraps) addNode('cash_traps', 'computation', 'Trapped cash', ['cfads', 'debt_service']);

  const availableDeps = ['cfads', 'debt_service'];
  if (hasDSRA) availableDeps.push('dsra');
  if (hasCashTraps) availableDeps.push('cash_traps');
  addNode('available_cash', 'computation', 'Distributable cash', availableDeps);

  tierIds.forEach((tid) =>
    addNode(`tier:${tid}`, 'computation', `Waterfall tier ${tid}`, ['available_cash']),
  );

  if (hasCovenants) {
    addNode('covenants', 'computation', 'Covenant evaluation', ['cfads', 'debt_service']);
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const tierDeps = tierIds.map((t) => `tier:${t}`);
  addNode('kpi:irr', 'computation', 'IRR (levered / unlevered)', ['available_cash', ...tierDeps]);
  addNode('kpi:dscr_profile', 'computation', 'DSCR profile', ['cfads', 'debt_service']);
  addNode('kpi:llcr', 'computation', 'LLCR', ['cfads', 'debt_service']);
  addNode('kpi:debt_capacity', 'computation', 'Max debt at target DSCR', ['cfads']);

  if (isMerchant) {
    addNode('kpi:grossMargin', 'computation', 'Gross margin %', ['comp.revenue']);
    addNode('kpi:rlv', 'computation', 'Residual land value', ['comp.rlv']);
  } else if (isIncome) {
    addNode('kpi:yield', 'computation', 'Yield on cost', ['comp.yieldOnCost']);
    addNode('kpi:spread', 'computation', 'Spread over exit cap', ['comp.yieldOnCost']);
  } else if (isHospitality) {
    addNode('kpi:revPar', 'computation', 'RevPAR', ['comp.revPar']);
    addNode('kpi:gopPar', 'computation', 'GOPPAR', ['comp.gop', 'input.keys']);
  }

  // ── Outputs ───────────────────────────────────────────────────────────────
  const insightDeps = ['kpi:irr', 'kpi:dscr_profile', 'kpi:llcr', 'kpi:debt_capacity'];
  if (hasCovenants) insightDeps.push('covenants');
  addNode('insights', 'output', 'Investor insights', insightDeps);
  addNode('sensitivity', 'output', 'Tornado / sensitivity', [
    'kpi:irr',
    'cfads_inputs',
    'assumptions',
  ]);

  return { nodes, edges };
}

/**
 * Compute a left-to-right layered layout for the DAG.
 * Depth: inputs=0; computations = 1 + max(depth of deps); outputs pinned to
 * the maximum computation depth + 1. Nodes within a layer are distributed
 * vertically in insertion order, which matches the kernel's traversal order.
 */
export function layoutGraph(graph, opts = {}) {
  const {
    columnWidth = 200,
    nodeWidth = 170,
    nodeHeight = 44,
    rowGap = 14,
    paddingX = 24,
    paddingY = 24,
  } = opts;

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const depth = new Map();
  const resolve = (id, stack = new Set()) => {
    if (depth.has(id)) return depth.get(id);
    if (stack.has(id)) return 0;
    stack.add(id);
    const node = byId.get(id);
    if (!node) return 0;
    if (node.kind === 'input') {
      depth.set(id, 0);
      return 0;
    }
    const d = node.dependsOn.length === 0
      ? 0
      : 1 + Math.max(...node.dependsOn.map((p) => resolve(p, stack)));
    depth.set(id, d);
    return d;
  };
  graph.nodes.forEach((n) => resolve(n.id));

  const maxComputationDepth = Math.max(
    1,
    ...graph.nodes
      .filter((n) => n.kind === 'computation')
      .map((n) => depth.get(n.id) ?? 1),
  );
  const outputDepth = maxComputationDepth + 1;

  const assignedDepth = new Map();
  graph.nodes.forEach((n) => {
    if (n.kind === 'output') assignedDepth.set(n.id, outputDepth);
    else assignedDepth.set(n.id, depth.get(n.id) ?? 0);
  });

  const columns = new Map();
  graph.nodes.forEach((n) => {
    const d = assignedDepth.get(n.id);
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d).push(n);
  });

  const positions = new Map();
  let maxCol = 0;
  columns.forEach((list, col) => {
    if (col > maxCol) maxCol = col;
    list.forEach((n, idx) => {
      positions.set(n.id, {
        x: paddingX + col * columnWidth,
        y: paddingY + idx * (nodeHeight + rowGap),
        width: nodeWidth,
        height: nodeHeight,
      });
    });
  });

  const tallest = Math.max(
    ...Array.from(columns.values()).map(
      (list) => paddingY * 2 + list.length * (nodeHeight + rowGap) - rowGap,
    ),
  );

  return {
    nodes: graph.nodes.map((n) => ({ ...n, ...positions.get(n.id) })),
    edges: graph.edges,
    width: paddingX * 2 + (maxCol + 1) * columnWidth + nodeWidth - columnWidth + paddingX,
    height: Math.max(200, tallest + paddingY),
  };
}
