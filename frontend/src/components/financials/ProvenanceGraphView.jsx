import { useEffect, useMemo, useState } from 'react';
import { GitBranch, ChevronRight, ChevronDown, RefreshCw, AlertCircle } from 'lucide-react';
import { buildStandardGraph, layoutGraph } from '../../utils/provenanceGraph';
import { financialsAPI } from '../../services/api';

const KIND_STYLES = {
  input: {
    fill: '#eef2ff',
    stroke: '#6366f1',
    label: 'text-accent',
  },
  computation: {
    fill: '#f9fafb',
    stroke: '#9ca3af',
    label: 'text-content-secondary',
  },
  output: {
    fill: '#ecfdf5',
    stroke: '#10b981',
    label: 'text-data-positive',
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

/** Format node value for display based on its unit. Returns an empty string
 *  when the node has no numeric value (e.g. `cashFlows` or `capitalStack`). */
function formatNodeValue(value, unit) {
  if (value == null || !Number.isFinite(value)) return '';
  if (unit === 'Cr') return `₹${Number(value).toFixed(2)} Cr`;
  if (unit === '%') return `${Number(value).toFixed(2)}%`;
  if (unit === 'x') return `${Number(value).toFixed(2)}x`;
  if (unit === 'sqft') return `${Math.round(value).toLocaleString('en-IN')} sqft`;
  if (unit === 'months') return `${Math.round(value)} mo`;
  if (unit === 'keys') return `${Math.round(value)} keys`;
  if (unit === 'INR/sqft') return `₹${Math.round(value).toLocaleString('en-IN')}/sqft`;
  if (unit === 'INR') return `₹${Math.round(value).toLocaleString('en-IN')}`;
  if (unit === 'INR/sqft/mo') return `₹${Number(value).toFixed(0)}/sqft/mo`;
  if (unit === 'ratio') return Number(value).toFixed(2);
  return String(value);
}

/**
 * Read-only SVG view of the kernel's FinancialGraph for the deal being viewed.
 *
 * When `dealId` is provided, fetches the authoritative graph from
 * `GET /api/financials/:dealId/financial-graph` (kernel-v2 DAG with live
 * node values). Falls back to client-side `buildStandardGraph` when no
 * `dealId`, when fetch fails, or for unsaved deals. Topology is
 * asset-class-aware — income assets get an NOI/CapRate chain, hospitality
 * gets RevPAR/GOP/EBITDA, merchant-sale classes get RLV.
 *
 * Click any node to highlight its upstream dependency chain. Hover any node
 * to see the rounded value + unit.
 *
 * Props:
 *   - dealId (optional): if set, fetches the live graph from the backend.
 *   - assetClass: one of the REDIP asset classes. Drives client-side fallback
 *     topology when `dealId` is absent.
 *   - facilityIds, tierIds, hasDSRA, hasCashTraps, hasCovenants:
 *     passed to client-side fallback; ignored when the backend graph loads.
 *   - defaultOpen: collapse/expand control.
 */
export default function ProvenanceGraphView({
  dealId,
  assetClass,
  facilityIds,
  tierIds,
  hasDSRA = false,
  hasCashTraps = false,
  hasCovenants = true,
  defaultOpen = false,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [remoteGraph, setRemoteGraph] = useState(null);
  const [remoteMeta, setRemoteMeta] = useState(null);
  const [remoteStatus, setRemoteStatus] = useState('idle'); // idle | loading | ok | error

  useEffect(() => {
    if (!dealId || !open) return;
    let cancelled = false;
    setRemoteStatus('loading');
    financialsAPI
      .financialGraph(dealId)
      .then((res) => {
        if (cancelled) return;
        const g = res?.data?.data;
        if (g && Array.isArray(g.nodes) && Array.isArray(g.edges)) {
          setRemoteGraph({ nodes: g.nodes, edges: g.edges });
          setRemoteMeta({
            engineVersion: g.engineVersion,
            generatedAt: g.generatedAt,
            assetClass: g.assetClass,
            nodeCount: g.nodeCount,
            edgeCount: g.edgeCount,
          });
          setRemoteStatus('ok');
        } else {
          setRemoteStatus('error');
        }
      })
      .catch(() => {
        if (!cancelled) setRemoteStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [dealId, open]);

  const fallbackGraph = useMemo(
    () => buildStandardGraph({ assetClass, facilityIds, tierIds, hasDSRA, hasCashTraps, hasCovenants }),
    [assetClass, facilityIds, tierIds, hasDSRA, hasCashTraps, hasCovenants],
  );
  const graph = remoteGraph || fallbackGraph;
  const laid = useMemo(() => layoutGraph(graph), [graph]);
  const source = remoteGraph ? 'live' : 'preview';

  const highlighted = useMemo(() => {
    if (!selected) return null;
    const u = upstream(graph, selected);
    u.add(selected);
    return u;
  }, [selected, graph]);

  const nodeOpacity = (id) => (highlighted && !highlighted.has(id) ? 0.2 : 1);
  const edgeOpacity = (from, to) =>
    highlighted && (!highlighted.has(from) || !highlighted.has(to)) ? 0.1 : 0.6;

  const hoveredNode = hovered ? laid.nodes.find((n) => n.id === hovered) : null;

  return (
    <div className="card-editorial">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-left group"
      >
        <div className="flex items-center gap-2">
          <GitBranch size={16} className="text-content-secondary" />
          <h4 className="text-sm font-semibold text-content-secondary uppercase tracking-wider">
            How this deal is computed
          </h4>
          {source === 'live' && remoteMeta?.engineVersion && (
            <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-pos-soft text-data-positive border border-hairline">
              <span className="w-1.5 h-1.5 rounded-full bg-data-positive"></span>
              {remoteMeta.engineVersion}
            </span>
          )}
          {source === 'preview' && (
            <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-secondary text-content-secondary border border-hairline-strong">
              preview
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-content-muted">
          {remoteStatus === 'loading' && (
            <RefreshCw size={12} className="animate-spin" />
          )}
          <span className="hidden sm:inline">
            {graph.nodes.length} nodes · {graph.edges.length} edges
          </span>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          {remoteStatus === 'error' && (
            <div className="flex items-start gap-2 p-2 rounded border border-hairline bg-premium-soft text-xs text-premium">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                Live graph unavailable — showing a preview topology for{' '}
                <strong>{assetClass || 'this asset class'}</strong>. Save the model to see the
                authoritative graph with live KPI values.
              </span>
            </div>
          )}
          <p className="text-xs text-content-secondary max-w-2xl">
            Each node is a step in the deterministic kernel pipeline. Inputs (indigo) flow into
            computations (grey) and finally into outputs (green). Click any node to highlight its
            full upstream provenance chain; hover to see its value.
          </p>

          <div className="relative overflow-x-auto border rounded-lg bg-bg-elevated">
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
                  const isHovered = hovered === n.id;
                  const formatted = formatNodeValue(n.value, n.unit);
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x},${n.y})`}
                      className="cursor-pointer"
                      onClick={() =>
                        setSelected((prev) => (prev === n.id ? null : n.id))
                      }
                      onMouseEnter={() => setHovered(n.id)}
                      onMouseLeave={() => setHovered((prev) => (prev === n.id ? null : prev))}
                      opacity={nodeOpacity(n.id)}
                    >
                      <rect
                        width={n.width}
                        height={n.height}
                        rx={8}
                        fill={style.fill}
                        stroke={isSelected || isHovered ? '#111827' : style.stroke}
                        strokeWidth={isSelected ? 2 : isHovered ? 1.5 : 1}
                      />
                      <text
                        x={n.width / 2}
                        y={formatted ? n.height / 2 - 4 : n.height / 2 + 4}
                        textAnchor="middle"
                        className={`text-[11px] font-medium pointer-events-none ${style.label}`}
                      >
                        {n.label.length > 28 ? `${n.label.slice(0, 26)}…` : n.label}
                      </text>
                      {formatted && (
                        <text
                          x={n.width / 2}
                          y={n.height / 2 + 10}
                          textAnchor="middle"
                          className="text-[10px] fill-content-muted font-mono pointer-events-none"
                        >
                          {formatted}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-content-secondary">
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
            {remoteMeta?.generatedAt && (
              <span className="text-content-muted">
                Computed {new Date(remoteMeta.generatedAt).toLocaleString('en-IN', {
                  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            )}
            {selected && (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="ml-auto text-xs text-content-secondary underline hover:text-content-primary"
              >
                Clear selection
              </button>
            )}
          </div>

          {hoveredNode && (
            <div className="p-3 rounded-md border border-hairline-strong bg-bg-secondary text-xs text-content-secondary">
              <div className="font-semibold text-content-primary">{hoveredNode.label}</div>
              <div className="mt-1 text-content-secondary font-mono text-[11px]">{hoveredNode.id}</div>
              {formatNodeValue(hoveredNode.value, hoveredNode.unit) && (
                <div className="mt-1">
                  Value:{' '}
                  <span className="font-mono text-content-primary">
                    {formatNodeValue(hoveredNode.value, hoveredNode.unit)}
                  </span>
                </div>
              )}
              {hoveredNode.dependsOn?.length > 0 && (
                <div className="mt-1">
                  Depends on:{' '}
                  <span className="font-mono text-content-secondary">
                    {hoveredNode.dependsOn.join(', ')}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
