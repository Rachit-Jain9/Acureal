import { useMemo, useState } from 'react';
import { GitBranch, ChevronRight, ChevronDown } from 'lucide-react';
import { buildStandardGraph, layoutGraph } from '../../utils/provenanceGraph';

const KIND_STYLES = {
  input: {
    fill: '#eef2ff',
    stroke: '#6366f1',
    label: 'text-indigo-700',
  },
  computation: {
    fill: '#f9fafb',
    stroke: '#9ca3af',
    label: 'text-gray-700',
  },
  output: {
    fill: '#ecfdf5',
    stroke: '#10b981',
    label: 'text-emerald-700',
  },
};

function edgePath(from, to) {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const midX = (x1 + x2) / 2;
  return `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`;
}

function upstream(graph, targetId) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Set();
  const stack = [targetId];
  while (stack.length) {
    const cur = stack.pop();
    const node = byId.get(cur);
    if (!node) continue;
    for (const d of node.dependsOn || []) {
      if (!out.has(d)) {
        out.add(d);
        stack.push(d);
      }
    }
  }
  return out;
}

/**
 * Read-only SVG view of the kernel's FinancialGraph (the standard topology
 * the orchestrator builds at runtime). Click any node to highlight its
 * upstream dependency chain.
 *
 * Props:
 *   - facilityIds, tierIds, hasDSRA, hasCashTraps, hasCovenants
 *     Passed to `buildStandardGraph`; if you pass nothing, sensible defaults
 *     render a 1-facility / covenanted chain.
 *   - defaultOpen: collapse/expand control
 */
export default function ProvenanceGraphView({
  facilityIds,
  tierIds,
  hasDSRA = false,
  hasCashTraps = false,
  hasCovenants = true,
  defaultOpen = false,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [selected, setSelected] = useState(null);

  const graph = useMemo(
    () => buildStandardGraph({ facilityIds, tierIds, hasDSRA, hasCashTraps, hasCovenants }),
    [facilityIds, tierIds, hasDSRA, hasCashTraps, hasCovenants],
  );
  const laid = useMemo(() => layoutGraph(graph), [graph]);

  const highlighted = useMemo(() => {
    if (!selected) return null;
    const u = upstream(graph, selected);
    u.add(selected);
    return u;
  }, [selected, graph]);

  const nodeOpacity = (id) => (highlighted && !highlighted.has(id) ? 0.2 : 1);
  const edgeOpacity = (from, to) =>
    highlighted && (!highlighted.has(from) || !highlighted.has(to)) ? 0.1 : 0.6;

  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-left group"
      >
        <div className="flex items-center gap-2">
          <GitBranch size={16} className="text-gray-500" />
          <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
            How this deal is computed
          </h4>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="hidden sm:inline">
            {graph.nodes.length} nodes · {graph.edges.length} edges
          </span>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-gray-500 max-w-2xl">
            Each node is a step in the deterministic kernel pipeline. Inputs (indigo) flow into
            computations (grey) and finally into outputs (green). Click any node to highlight its
            full upstream provenance chain.
          </p>

          <div className="overflow-x-auto border rounded-lg bg-white">
            <svg
              width={laid.width}
              height={laid.height}
              role="img"
              aria-label="Financial graph"
              className="min-w-full"
            >
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L10,5 L0,10 z" fill="#9ca3af" />
                </marker>
              </defs>
              <g>
                {laid.edges.map((e, i) => {
                  const from = laid.nodes.find((n) => n.id === e.from);
                  const to = laid.nodes.find((n) => n.id === e.to);
                  if (!from || !to) return null;
                  return (
                    <path
                      key={i}
                      d={edgePath(from, to)}
                      fill="none"
                      stroke="#9ca3af"
                      strokeWidth={1.5}
                      opacity={edgeOpacity(e.from, e.to)}
                      markerEnd="url(#arrow)"
                    />
                  );
                })}
              </g>
              <g>
                {laid.nodes.map((n) => {
                  const style = KIND_STYLES[n.kind] || KIND_STYLES.computation;
                  const isSelected = selected === n.id;
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x},${n.y})`}
                      style={{ cursor: 'pointer' }}
                      onClick={() =>
                        setSelected((prev) => (prev === n.id ? null : n.id))
                      }
                      opacity={nodeOpacity(n.id)}
                    >
                      <rect
                        width={n.width}
                        height={n.height}
                        rx={8}
                        fill={style.fill}
                        stroke={isSelected ? '#111827' : style.stroke}
                        strokeWidth={isSelected ? 2 : 1}
                      />
                      <text
                        x={n.width / 2}
                        y={n.height / 2 + 4}
                        textAnchor="middle"
                        className={`text-[11px] font-medium ${style.label}`}
                        style={{ pointerEvents: 'none' }}
                      >
                        {n.label.length > 28 ? `${n.label.slice(0, 26)}…` : n.label}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded"
                style={{ background: KIND_STYLES.input.fill, border: `1px solid ${KIND_STYLES.input.stroke}` }}
              />
              Input
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded"
                style={{ background: KIND_STYLES.computation.fill, border: `1px solid ${KIND_STYLES.computation.stroke}` }}
              />
              Computation
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded"
                style={{ background: KIND_STYLES.output.fill, border: `1px solid ${KIND_STYLES.output.stroke}` }}
              />
              Output
            </span>
            {selected && (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="ml-auto text-xs text-gray-500 underline hover:text-gray-900"
              >
                Clear selection
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
