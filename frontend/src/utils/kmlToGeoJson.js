// Minimal, dependency-free KML → GeoJSON for parcel boundaries (matches
// geoArea.js's no-dep ethos). Extracts Polygon / MultiPolygon geometry only —
// outer ring + holes — which is all a parcel boundary needs. Points/LineStrings
// are ignored; KMZ (zipped) is out of scope (unzip to .kml first).
//
// KML coordinates are whitespace-separated "lng,lat[,alt]" tuples (lng FIRST,
// same axis order as GeoJSON) — altitude is dropped.

function parseCoords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const parts = tok.split(',');
      return [Number(parts[0]), Number(parts[1])];
    })
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

function ringsOfPolygon(polyEl) {
  const rings = [];
  const outer = polyEl.getElementsByTagName('outerBoundaryIs')[0];
  const outerCoords = outer?.getElementsByTagName('coordinates')[0]?.textContent;
  const outerRing = parseCoords(outerCoords);
  if (outerRing.length >= 3) rings.push(outerRing);
  const inners = polyEl.getElementsByTagName('innerBoundaryIs');
  for (let j = 0; j < inners.length; j += 1) {
    const hole = parseCoords(inners[j].getElementsByTagName('coordinates')[0]?.textContent);
    if (hole.length >= 3) rings.push(hole);
  }
  return rings;
}

// Returns a GeoJSON Polygon | MultiPolygon geometry, or null when no usable
// polygon is found. Throws on malformed XML.
export function kmlToGeoJson(kmlText) {
  if (typeof DOMParser === 'undefined') throw new Error('DOMParser unavailable');
  const doc = new DOMParser().parseFromString(String(kmlText || ''), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Invalid KML / XML');
  }
  const polyEls = doc.getElementsByTagName('Polygon');
  const polygons = [];
  for (let i = 0; i < polyEls.length; i += 1) {
    const rings = ringsOfPolygon(polyEls[i]);
    if (rings.length > 0) polygons.push(rings);
  }
  if (polygons.length === 0) return null;
  if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] };
  return { type: 'MultiPolygon', coordinates: polygons };
}

export default kmlToGeoJson;
