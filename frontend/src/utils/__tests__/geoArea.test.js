import { describe, it, expect } from 'vitest';
import {
  geojsonAreaSqft, extractPolygons, polygonOutlineForSvg, reconcileArea,
} from '../geoArea';

// Build a square of a known area (sqm) centred near Bengaluru (lat ~13) so we
// can check the geodesic area against ground truth.
const METERS_PER_DEG_LAT = (Math.PI * 6378137) / 180; // ≈ 111319.49
function squareOfArea(sqm, lng0 = 77.5, lat0 = 13.0) {
  const side = Math.sqrt(sqm);
  const dLat = side / METERS_PER_DEG_LAT;
  const dLng = side / (METERS_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180));
  return [[lng0, lat0], [lng0 + dLng, lat0], [lng0 + dLng, lat0 + dLat], [lng0, lat0 + dLat], [lng0, lat0]];
}

const ACRE_SQM = 4046.8564224;
const ACRE_SQFT = 43560;

describe('geojsonAreaSqft', () => {
  it('measures a 1-acre square within 2% of 43,560 sqft', () => {
    const poly = { type: 'Polygon', coordinates: [squareOfArea(ACRE_SQM)] };
    const sqft = geojsonAreaSqft(poly);
    expect(Math.abs(sqft - ACRE_SQFT) / ACRE_SQFT).toBeLessThan(0.02);
  });

  it('unwraps a Feature and a FeatureCollection', () => {
    const ring = [squareOfArea(ACRE_SQM)];
    const feature = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: ring } };
    const fc = { type: 'FeatureCollection', features: [feature] };
    expect(geojsonAreaSqft(feature)).toBe(geojsonAreaSqft({ type: 'Polygon', coordinates: ring }));
    expect(geojsonAreaSqft(fc)).toBe(geojsonAreaSqft(feature));
  });

  it('sums a MultiPolygon', () => {
    const a = squareOfArea(ACRE_SQM, 77.5, 13.0);
    const b = squareOfArea(ACRE_SQM, 77.6, 13.0);
    const mp = { type: 'MultiPolygon', coordinates: [[a], [b]] };
    const sqft = geojsonAreaSqft(mp);
    expect(Math.abs(sqft - 2 * ACRE_SQFT) / (2 * ACRE_SQFT)).toBeLessThan(0.02);
  });

  it('subtracts a hole', () => {
    const outer = squareOfArea(ACRE_SQM * 4); // 4 acres
    const hole = squareOfArea(ACRE_SQM);       // 1-acre hole
    const withHole = geojsonAreaSqft({ type: 'Polygon', coordinates: [outer, hole] });
    const solid = geojsonAreaSqft({ type: 'Polygon', coordinates: [outer] });
    expect(solid - withHole).toBeGreaterThan(0);
    expect(Math.abs((solid - withHole) - ACRE_SQFT) / ACRE_SQFT).toBeLessThan(0.03);
  });

  it('returns null for non-polygon or empty input', () => {
    expect(geojsonAreaSqft(null)).toBeNull();
    expect(geojsonAreaSqft({ type: 'Point', coordinates: [77, 13] })).toBeNull();
    expect(geojsonAreaSqft({ type: 'FeatureCollection', features: [] })).toBeNull();
  });
});

describe('extractPolygons', () => {
  it('finds polygons across nested shapes', () => {
    expect(extractPolygons({ type: 'Polygon', coordinates: [squareOfArea(ACRE_SQM)] })).toHaveLength(1);
    expect(extractPolygons({ type: 'MultiPolygon', coordinates: [[squareOfArea(ACRE_SQM)], [squareOfArea(ACRE_SQM)]] })).toHaveLength(2);
    expect(extractPolygons({ type: 'Point', coordinates: [1, 2] })).toHaveLength(0);
  });
});

describe('polygonOutlineForSvg', () => {
  it('returns a points string + viewBox for a polygon', () => {
    const out = polygonOutlineForSvg({ type: 'Polygon', coordinates: [squareOfArea(ACRE_SQM)] }, { size: 200, pad: 10 });
    expect(out).not.toBeNull();
    expect(typeof out.points).toBe('string');
    expect(out.points.split(' ').length).toBe(5); // 5 vertices (closed ring)
    expect(out.viewBox).toMatch(/^0 0 [\d.]+ [\d.]+$/);
  });

  it('returns null when there is no polygon', () => {
    expect(polygonOutlineForSvg({ type: 'Point', coordinates: [1, 2] })).toBeNull();
  });
});

describe('reconcileArea', () => {
  it('classifies match / minor / major by delta', () => {
    expect(reconcileArea(1000, 1000).severity).toBe('match');
    expect(reconcileArea(1020, 1000).severity).toBe('match'); // 2%
    expect(reconcileArea(1080, 1000).severity).toBe('minor'); // 8%
    expect(reconcileArea(1300, 1000).severity).toBe('major'); // 30%
    expect(reconcileArea(1080, 1000).deltaPct).toBe(8);
  });

  it('returns null on bad inputs', () => {
    expect(reconcileArea(0, 1000)).toBeNull();
    expect(reconcileArea(1000, null)).toBeNull();
  });
});
