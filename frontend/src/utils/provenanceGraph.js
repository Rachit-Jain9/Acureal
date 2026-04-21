/**
 * Client-side mirror of `buildStandardGraph` from
 * `packages/financial-kernel/src/orchestration/financialGraph.ts`.
 *
 * The kernel builds the same topology at runtime. We replicate it here
 * so the UI can render the provenance DAG without requiring a full
 * orchestration round-trip for every deal view. When the kernel's
 * shape evolves, update this mirror in lock-step.
 */

/**
 * Build a topology graph describing how a deal's KPIs are derived.
 *
 * @param {object} opts
 * @param {string[]} [opts.facilityIds] one entry per debt facility
 * @param {string[]} [opts.tierIds]     one entry per waterfall tier
 * @param {boolean}  [opts.hasDSRA]
 * @param {boolean}  [opts.hasCashTraps]
 * @param {boolean}  [opts.hasCovenants]
 * @returns {{nodes: Array, edges: Array}}
 */
export function buildStandardGraph({
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

  addNode('assumptions', 'input', 'Deal assumptions');
  addNode('cfads_inputs', 'input', 'Revenue, opex, taxes, capex');
  facilityIds.forEach((id) => addNode(`facility:${id}`, 'input', `Facility ${id}`));

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

  const tierDeps = tierIds.map((t) => `tier:${t}`);
  addNode('kpi:irr', 'computation', 'IRR (levered / unlevered)', ['available_cash', ...tierDeps]);
  addNode('kpi:dscr_profile', 'computation', 'DSCR profile', ['cfads', 'debt_service']);
  addNode('kpi:llcr', 'computation', 'LLCR', ['cfads', 'debt_service']);
  addNode('kpi:debt_capacity', 'computation', 'Max debt at target DSCR', ['cfads']);

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
