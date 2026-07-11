import { describe, it, expect } from 'vitest';
import { kmlToGeoJson } from '../kmlToGeoJson';
import { geojsonAreaSqft } from '../geoArea';

const POLY_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><Polygon>
<outerBoundaryIs><LinearRing><coordinates>
77.5,13.0,0 77.50586,13.0,0 77.50586,13.000572,0 77.5,13.000572,0 77.5,13.0,0
</coordinates></LinearRing></outerBoundaryIs>
</Polygon></Placemark></Document></kml>`;

const MULTI_KML = `<kml><Document>
<Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>77.5,13.0 77.501,13.0 77.501,13.001 77.5,13.0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>77.6,13.0 77.601,13.0 77.601,13.001 77.6,13.0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;

describe('kmlToGeoJson', () => {
  it('parses a single Polygon with lng,lat,alt coordinates (alt dropped)', () => {
    const geo = kmlToGeoJson(POLY_KML);
    expect(geo.type).toBe('Polygon');
    expect(geo.coordinates[0]).toHaveLength(5);
    expect(geo.coordinates[0][0]).toEqual([77.5, 13.0]); // lng first, alt dropped
    // ~1 acre square → a sane positive area
    expect(geojsonAreaSqft(geo)).toBeGreaterThan(30000);
  });

  it('emits a MultiPolygon for multiple Placemarks', () => {
    const geo = kmlToGeoJson(MULTI_KML);
    expect(geo.type).toBe('MultiPolygon');
    expect(geo.coordinates).toHaveLength(2);
  });

  it('returns null when there is no polygon', () => {
    expect(kmlToGeoJson('<kml><Document><Placemark><Point><coordinates>77,13</coordinates></Point></Placemark></Document></kml>')).toBeNull();
  });

  it('throws on malformed XML', () => {
    expect(() => kmlToGeoJson('<kml><Document')).toThrow();
  });

  it('drops truncated coordinate tuples instead of fabricating a [lng,0] vertex', () => {
    // The middle tuple "77.50586," is missing its latitude. Number('') === 0,
    // so before the fix it survived as a fabricated [77.50586, 0] equator
    // vertex that corrupts the ring. It must be dropped, leaving a valid ring.
    const kml = `<kml><Document><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>
      77.5,13.0 77.50586, 77.50586,13.000572 77.5,13.000572 77.5,13.0
    </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
    const geo = kmlToGeoJson(kml);
    expect(geo.type).toBe('Polygon');
    // No vertex sits on the equator (lat 0) — the bad tuple was dropped.
    expect(geo.coordinates[0].every(([, lat]) => lat > 12)).toBe(true);
    // Area stays sane (~1 acre), not warped by a spurious equator point.
    expect(geojsonAreaSqft(geo)).toBeGreaterThan(30000);
  });
});
