import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, GeoJSON, MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Layers, Map as MapIcon, ExternalLink } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import Badge from '../common/Badge';

/**
 * DerivedParcelMiniMap — compact map (default 240px tall) that visualises
 * the auto-derived parcel location on the AutoFillParcelContextCard.
 *
 * Phase C-8 of the autonomous-window plan. Visual confirmation that the
 * auto-derive landed correctly — operators can see at a glance whether
 * Google's coordinates match the address they typed, and whether K-GIS
 * returned a true parcel polygon or just a survey-area approximation.
 *
 * What it renders (in this priority order):
 *   1. K-GIS GeoJSON parcel polygon if `kgis.geometry_geojson` is a
 *      valid Polygon/MultiPolygon — accurate boundary from the
 *      cadastral atlas.
 *   2. Fallback 50m buffered circle around the (lat, lng) when no
 *      K-GIS polygon — explicitly badged "approximate" so the operator
 *      knows it's a placeholder, not a real survey boundary.
 *   3. Centre marker at the derived (lat, lng).
 *   4. Tile layer toggle (streets / satellite).
 *
 * Hidden when:
 *   - No coordinates at all
 *   - coordinatesGate.gated === true (the red banner above already
 *     explains why we can't trust coordinates — a map would just
 *     reinforce a misleading location)
 *
 * Honesty (CLAUDE.md):
 *   - When the only available geometry is the fallback circle, the
 *     "Approximate boundary" badge fires AND the circle stroke is
 *     dashed to distinguish from a real polygon. Never present a
 *     buffered radius as if it were a survey-precise outline.
 *   - We do NOT render a master_plan_zones overlay yet — those zones
 *     don't have geom imported in the DB (deliberately gated in
 *     parcelContext.service). When that ships, this component will
 *     pick it up via a new prop without breaking changes.
 *   - Google Maps satellite link uses the documented @lat,lng,zoom
 *     URL pattern (the same one parcelVerificationLinks builds for
 *     the verify-links section) — true deep-link, not faked.
 */

const TILE_LAYERS = {
  streets: {
    label: 'Streets',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19,
  },
};

// Default Leaflet marker (same self-hosted icons as ReadOnlyPropertyMap
// to avoid an extra third-party hop and keep CSP img-src tight).
const DEFAULT_ICON = L.icon({
  iconUrl: '/leaflet/marker-icon.png',
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  shadowUrl: '/leaflet/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Heuristic: a GeoJSON object is a "real" parcel polygon if it has
// geometry coordinates we can fit. Accepts both bare Geometry objects
// and Feature/FeatureCollection wrappers (K-GIS has been observed to
// return both shapes).
function extractParcelGeometry(geojson) {
  if (!geojson || typeof geojson !== 'object') return null;
  // Bare geometry
  if (
    (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon') &&
    Array.isArray(geojson.coordinates) &&
    geojson.coordinates.length > 0
  ) {
    return geojson;
  }
  // Feature
  if (geojson.type === 'Feature' && geojson.geometry) {
    return extractParcelGeometry(geojson.geometry);
  }
  // FeatureCollection — pick the first valid polygon
  if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
    for (const f of geojson.features) {
      const g = extractParcelGeometry(f);
      if (g) return g;
    }
  }
  return null;
}

function FitToBounds({ geometry, fallbackCenter, fallbackRadiusM }) {
  const map = useMap();
  const fittedRef = useRef(false);

  useEffect(() => {
    if (fittedRef.current) return;
    if (geometry) {
      try {
        const layer = L.geoJSON(geometry);
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [24, 24], maxZoom: 18, animate: true, duration: 0.4 });
          fittedRef.current = true;
          return;
        }
      } catch {
        // fall through
      }
    }
    if (Array.isArray(fallbackCenter) && Number.isFinite(fallbackCenter[0])) {
      const center = L.latLng(fallbackCenter[0], fallbackCenter[1]);
      const circle = L.circle(center, { radius: fallbackRadiusM || 50 });
      const bounds = circle.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [24, 24], maxZoom: 18, animate: true, duration: 0.4 });
        fittedRef.current = true;
      }
    }
  }, [geometry, map, fallbackCenter, fallbackRadiusM]);
  return null;
}

export default function DerivedParcelMiniMap({
  data,
  height = 240,
  className = '',
  fallbackRadiusM = 50,
}) {
  const [tileMode, setTileMode] = useState('streets');

  const lat = data?.coordinates?.lat;
  const lng = data?.coordinates?.lng;
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const gated = !!data?.coordinatesGate?.gated;
  const parcelGeom = useMemo(() => extractParcelGeometry(data?.kgis?.geometry_geojson), [data]);

  // Hide entirely when we have no trustworthy coords. Avoids reinforcing
  // a known-bad location with a map pin.
  if (!hasCoords || gated) return null;

  const tile = TILE_LAYERS[tileMode];
  const googleSatHref = `https://www.google.com/maps/@${Number(lat).toFixed(6)},${Number(lng).toFixed(6)},19z/data=!3m1!1e3`;

  return (
    <div
      className={`mt-4 rounded-md border border-hairline overflow-hidden ${className}`}
      data-testid="derived-parcel-mini-map"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-bg-secondary border-b border-hairline text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <MapIcon size={11} className="text-content-muted shrink-0" aria-hidden="true" />
          <span className="font-medium text-content-secondary">Parcel location</span>
          {parcelGeom ? (
            <Badge tone="success">K-GIS polygon</Badge>
          ) : (
            <Badge tone="warn">Approximate boundary ({fallbackRadiusM}m radius)</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div
            role="tablist"
            aria-label="Tile layer"
            className="inline-flex rounded border border-hairline bg-bg-elevated p-0.5 text-[10px] font-medium"
          >
            {['streets', 'satellite'].map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={tileMode === mode}
                onClick={() => setTileMode(mode)}
                className={`px-1.5 py-0.5 rounded transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.97] ${
                  tileMode === mode ? 'bg-bg-secondary text-content-primary' : 'text-content-muted hover:text-content-secondary'
                }`}
                data-testid={`mini-map-tile-${mode}`}
              >
                {mode === 'streets' ? 'Streets' : 'Satellite'}
              </button>
            ))}
          </div>
          <a
            href={googleSatHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-content-muted hover:text-content-primary transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 rounded px-1"
            aria-label="Open in Google Maps satellite (new tab)"
          >
            <ExternalLink size={10} /> Google sat
          </a>
        </div>
      </div>

      <div style={{ height: `${height}px` }} data-testid="mini-map-canvas">
        <MapContainer
          center={[lat, lng]}
          zoom={17}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={false}
          zoomControl
          attributionControl
        >
          <TileLayer
            key={tileMode}  /* force re-mount on toggle so the new url takes effect */
            url={tile.url}
            attribution={tile.attribution}
            maxZoom={tile.maxZoom}
          />
          <FitToBounds
            geometry={parcelGeom}
            fallbackCenter={[lat, lng]}
            fallbackRadiusM={fallbackRadiusM}
          />
          {parcelGeom ? (
            <GeoJSON
              data={parcelGeom}
              style={{ color: '#0ea5e9', weight: 2, fillColor: '#0ea5e9', fillOpacity: 0.12 }}
            />
          ) : (
            <Circle
              center={[lat, lng]}
              radius={fallbackRadiusM}
              pathOptions={{
                color: '#d97706',
                weight: 2,
                dashArray: '4 4',
                fillColor: '#fbbf24',
                fillOpacity: 0.10,
              }}
            />
          )}
          <Marker position={[lat, lng]} icon={DEFAULT_ICON} />
        </MapContainer>
      </div>

      <p className="px-3 py-1.5 text-[10px] text-content-muted bg-bg-secondary/60 border-t border-hairline leading-snug">
        {parcelGeom ? (
          <>
            <Layers size={9} className="inline mr-1 -mt-0.5" aria-hidden="true" />
            Blue outline is the K-GIS cadastral parcel polygon. The pin is the geocoded address. If they don't match, the geocoder may have landed on a different parcel — verify with the survey number on Bhoomi RTC.
          </>
        ) : (
          <>
            <Layers size={9} className="inline mr-1 -mt-0.5" aria-hidden="true" />
            K-GIS did not return a parcel polygon for this coordinate; the orange dashed circle is a {fallbackRadiusM}m radius placeholder around the geocoded pin, not a survey boundary.
          </>
        )}
      </p>
    </div>
  );
}

// Exported for tests
export const _internal = { extractParcelGeometry };
