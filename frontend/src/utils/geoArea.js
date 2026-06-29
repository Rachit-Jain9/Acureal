// Deterministic geodesic geometry helpers for parcel boundaries.
//
// Dependency-free — implements the standard spherical ring-area formula
// (Chamberlain & Duquette; the same algorithm @turf/area uses) so we get an
// accurate plot area from a GeoJSON polygon without pulling in turf. Pure
// functions, no AI, fully unit-tested.
//
// Used by Yield Studio to read a K-GIS parcel boundary, compute its true area,
// reconcile it against the typed plot area, and draw the real parcel outline.

const EARTH_RADIUS_M = 6378137; // WGS84 equatorial radius (matches turf)
const SQM_TO_SQFT = 10.76391041671;
const toRad = (deg) => (deg * Math.PI) / 180;

// Signed spherical area (sqm) of a single linear ring of [lng, lat] pairs.
function ringAreaSqm(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % ring.length];
    if (!p1 || !p2 || p1.length < 2 || p2.length < 2) return 0;
    total += toRad(p2[0] - p1[0]) * (2 + Math.sin(toRad(p1[1])) + Math.sin(toRad(p2[1])));
  }
  return (total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2;
}

// Area (sqm) of one polygon = |outer ring| − Σ|holes|, never negative.
function polygonAreaSqm(rings) {
  if (!Array.isArray(rings) || rings.length === 0) return 0;
  const outer = Math.abs(ringAreaSqm(rings[0]));
  let holes = 0;
  for (let i = 1; i < rings.length; i += 1) holes += Math.abs(ringAreaSqm(rings[i]));
  return Math.max(0, outer - holes);
}

// Normalize any GeoJSON shape into an array of polygons (each = array of rings,
// each ring = array of [lng, lat]). Accepts FeatureCollection | Feature |
// Geometry | bare Polygon/MultiPolygon coordinates. Returns [] when nothing
// usable is found.
export function extractPolygons(geojson) {
  if (!geojson || typeof geojson !== 'object') return [];
  if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
    return geojson.features.flatMap((f) => extractPolygons(f));
  }
  if (geojson.type === 'Feature') return extractPolygons(geojson.geometry);
  if (geojson.type === 'Polygon' && Array.isArray(geojson.coordinates)) {
    return [geojson.coordinates];
  }
  if (geojson.type === 'MultiPolygon' && Array.isArray(geojson.coordinates)) {
    return geojson.coordinates;
  }
  if (geojson.type === 'GeometryCollection' && Array.isArray(geojson.geometries)) {
    return geojson.geometries.flatMap((g) => extractPolygons(g));
  }
  return [];
}

// Total area in sqft across every polygon in the GeoJSON. null when there is no
// usable polygon (so callers can show an honest "no boundary" state).
export function geojsonAreaSqft(geojson) {
  const polys = extractPolygons(geojson);
  if (!polys.length) return null;
  let sqm = 0;
  for (const rings of polys) sqm += polygonAreaSqm(rings);
  if (!(sqm > 0)) return null;
  return Math.round(sqm * SQM_TO_SQFT);
}

// Project the largest polygon's outer ring into a fitted SVG polygon. Uses a
// local equirectangular projection (x scaled by cos(meanLat)) — accurate enough
// for a single parcel outline, with no map tiles. Returns { points, viewBox }
// or null. Y is flipped so north is up.
export function polygonOutlineForSvg(geojson, { size = 240, pad = 12 } = {}) {
  const polys = extractPolygons(geojson);
  if (!polys.length) return null;
  let outer = null;
  let best = -1;
  for (const rings of polys) {
    const a = Math.abs(ringAreaSqm(rings[0]));
    if (a > best) { best = a; outer = rings[0]; }
  }
  if (!Array.isArray(outer) || outer.length < 3) return null;

  const lats = outer.map((c) => c[1]);
  const meanLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const k = Math.cos(toRad(meanLat)) || 1; // longitude compression at this latitude
  const xs = outer.map((c) => c[0] * k);
  const ys = outer.map((c) => c[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = (maxX - minX) || 1e-9;
  const spanY = (maxY - minY) || 1e-9;
  const scale = Math.min((size - 2 * pad) / spanX, (size - 2 * pad) / spanY);
  const w = spanX * scale + 2 * pad;
  const h = spanY * scale + 2 * pad;
  const points = outer.map((c) => {
    const x = pad + (c[0] * k - minX) * scale;
    const y = pad + (maxY - c[1]) * scale; // flip: north up
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return { points, viewBox: `0 0 ${w.toFixed(1)} ${h.toFixed(1)}`, width: w, height: h };
}

// Reconciliation between a typed plot area and the boundary-derived area.
// Returns { deltaPct, severity } where severity is 'match' | 'minor' | 'major'.
export function reconcileArea(typedSqft, boundarySqft) {
  const t = Number(typedSqft);
  const b = Number(boundarySqft);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(b) || b <= 0) return null;
  const deltaPct = ((t - b) / b) * 100;
  const abs = Math.abs(deltaPct);
  const severity = abs <= 3 ? 'match' : abs <= 10 ? 'minor' : 'major';
  return { deltaPct: Math.round(deltaPct * 10) / 10, severity };
}
