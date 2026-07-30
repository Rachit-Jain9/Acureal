import { buildMassingModel } from '../../utils/buildabilityMassing';

/**
 * Buildability massing — Workstream E (the spatial canvas).
 *
 * An axonometric massing diagram of the legal buildable envelope: the plot,
 * the ground-coverage footprint inset within it, and that footprint
 * extruded to the floor count the FAR forces. It answers "what can I
 * legally build here" spatially, as a companion to the buildability numbers.
 *
 * Pure SVG — no 3D engine, no dependency. Drawn entirely from the
 * deterministic `buildMassingModel`; the proportions (coverage, floors,
 * FAR utilisation) are exact. The plot is a representative square because
 * Acureal holds the parcel's area, not its surveyed shape — stated plainly
 * in the caption so the schematic is never mistaken for a site plan.
 */

// Axonometric projection — a 30° isometric.
const ISO_X = Math.cos(Math.PI / 6); // ≈ 0.866
const ISO_Y = Math.sin(Math.PI / 6); // = 0.5
// Plot-units of height per floor. With the plot a 1×1 square, a G+9 tower
// reads as comfortably taller than wide; the fit-transform below rescales.
const FLOOR_UNIT = 0.085;
const VIEW_W = 360;
const VIEW_H = 300;
const PAD = 26;

// Project a ground point (gx, gy) at height h — all in plot-units.
const rawProject = (gx, gy, h) => ({
  x: (gx - gy) * ISO_X,
  y: (gx + gy) * ISO_Y - h,
});

export default function BuildabilityMassing({ values, landAreaSqft, className = '' }) {
  const model = buildMassingModel({ values, landAreaSqft });
  if (!model) return null;

  const { floors, coveragePct, openGroundPct, maxFar } = model;

  // Footprint side ratio, clamped so the diagram is always legible.
  const r = Math.min(0.97, Math.max(0.1, model.footprintRatio));
  const m = (1 - r) / 2; // setback inset on each side
  const H = floors * FLOOR_UNIT; // mass height in plot-units

  // Project the 12 defining points, fit them to the viewBox.
  const keyPoints = [
    rawProject(0, 0, 0), rawProject(1, 0, 0), rawProject(1, 1, 0), rawProject(0, 1, 0),
    rawProject(m, m, H), rawProject(1 - m, m, H), rawProject(1 - m, 1 - m, H), rawProject(m, 1 - m, H),
  ];
  const xs = keyPoints.map((p) => p.x);
  const ys = keyPoints.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX || 1;
  const spanY = Math.max(...ys) - minY || 1;
  const scale = Math.min((VIEW_W - 2 * PAD) / spanX, (VIEW_H - 2 * PAD) / spanY);
  const offX = (VIEW_W - spanX * scale) / 2 - minX * scale;
  const offY = (VIEW_H - spanY * scale) / 2 - minY * scale;

  const P = (gx, gy, h) => {
    const p = rawProject(gx, gy, h);
    return { x: offX + p.x * scale, y: offY + p.y * scale };
  };
  const poly = (...pts) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Ground plot, footprint base, mass top.
  const ground = [P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0)];
  const baseB = P(1 - m, m, 0);
  const baseC = P(1 - m, 1 - m, 0);
  const baseD = P(m, 1 - m, 0);
  const topA = P(m, m, H);
  const topB = P(1 - m, m, H);
  const topC = P(1 - m, 1 - m, H);
  const topD = P(m, 1 - m, H);

  // Floor delineation lines on the two visible mass faces.
  const floorLines = [];
  for (let i = 1; i < floors; i += 1) {
    const z = (i / floors) * H;
    floorLines.push({
      key: i,
      right: [P(1 - m, m, z), P(1 - m, 1 - m, z)],
      left: [P(m, 1 - m, z), P(1 - m, 1 - m, z)],
    });
  }

  const labelTop = P(m, m, H); // back-top corner — anchor the floor count here

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Schematic massing — ${floors} floor${floors === 1 ? '' : 's'} at ${coveragePct}% ground coverage`}
      >
        {/* Plot — the full site. The ring of plot left uncovered by the mass
            base is the setback / open ground. */}
        <polygon
          points={poly(...ground)}
          className="fill-bg-secondary stroke-hairline-strong"
          strokeWidth="1"
          strokeLinejoin="round"
        />

        {/* Mass — three shaded faces give the axonometric read. */}
        {/* Right face */}
        <polygon
          points={poly(baseB, baseC, topC, topB)}
          className="fill-accent stroke-accent"
          strokeWidth="1"
          strokeLinejoin="round"
          fillOpacity="0.85"
        />
        {/* Left face */}
        <polygon
          points={poly(baseD, baseC, topC, topD)}
          className="fill-accent stroke-accent"
          strokeWidth="1"
          strokeLinejoin="round"
          fillOpacity="0.7"
        />
        {/* Top face */}
        <polygon
          points={poly(topA, topB, topC, topD)}
          className="fill-accent stroke-accent"
          strokeWidth="1"
          strokeLinejoin="round"
        />

        {/* Floor lines */}
        {floorLines.map((fl) => (
          <g key={fl.key} className="stroke-white" strokeWidth="0.75" strokeOpacity="0.3">
            <line x1={fl.right[0].x} y1={fl.right[0].y} x2={fl.right[1].x} y2={fl.right[1].y} />
            <line x1={fl.left[0].x} y1={fl.left[0].y} x2={fl.left[1].x} y2={fl.left[1].y} />
          </g>
        ))}

        {/* Floor-count label, anchored above the mass. */}
        <text
          x={labelTop.x}
          y={labelTop.y - 10}
          textAnchor="middle"
          className="fill-content-secondary"
          fontSize="13"
          fontWeight="600"
        >
          {floors} floor{floors === 1 ? '' : 's'}
        </text>
      </svg>

      <div className="mt-2 flex items-center justify-center gap-4 text-[11px] text-content-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-accent" />
          Buildable mass
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-bg-secondary border border-hairline-strong" />
          Open ground · {openGroundPct}%
        </span>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-content-muted text-center">
        Schematic — {coveragePct}% ground coverage{maxFar ? `, FAR ${maxFar}` : ''}. Proportions
        reflect the verified buildability rules; the plot is drawn as a representative square,
        not a surveyed boundary.
      </p>
    </div>
  );
}
