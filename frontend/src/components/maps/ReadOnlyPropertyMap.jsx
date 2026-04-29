import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, GeoJSON, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Layers, Maximize2, Minimize2, Map as MapIcon } from 'lucide-react';
import clsx from 'clsx';
import 'leaflet/dist/leaflet.css';
import api from '../../services/api';

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

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
    attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
};

function FitToGeometry({ geometry, fallbackCenter, fallbackZoom }) {
  const map = useMap();
  const fittedRef = useRef(false);

  useEffect(() => {
    if (fittedRef.current) return;
    if (geometry) {
      try {
        const layer = L.geoJSON(geometry);
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [32, 32], maxZoom: 18, animate: true, duration: 0.5 });
          fittedRef.current = true;
          return;
        }
      } catch {
        // fall through to center fallback
      }
    }
    if (fallbackCenter) {
      map.setView(fallbackCenter, fallbackZoom, { animate: true });
      fittedRef.current = true;
    }
  }, [geometry, map, fallbackCenter, fallbackZoom]);

  return null;
}

export default function ReadOnlyPropertyMap({
  lat,
  lng,
  title = 'Parcel reference point',
  geometryGeojson = null,
  heightClassName = 'h-[420px]',
  zoom = 17,
  enableScrollZoom = true,
  enableFullscreen = true,
  enableLayerToggle = true,
}) {
  const containerRef = useRef(null);
  const [activeLayer, setActiveLayer] = useState('streets');
  const [isFullscreen, setIsFullscreen] = useState(false);
  // T3 — zoning overlay. Lazy-loaded from /api/master-plan/zones/geojson
  // when toggle flips on. Empty FeatureCollection is a valid response and
  // surfaces the "no zone geometry uploaded yet" hint.
  const [zoningEnabled, setZoningEnabled] = useState(false);
  const [zoningGeo, setZoningGeo] = useState(null);
  const [zoningLoading, setZoningLoading] = useState(false);
  const [zoningError, setZoningError] = useState(null);

  const center = useMemo(() => {
    const latitude = toNumber(lat);
    const longitude = toNumber(lng);
    return latitude === null || longitude === null ? null : [latitude, longitude];
  }, [lat, lng]);

  const geometry = useMemo(() => {
    if (!geometryGeojson) return null;
    if (typeof geometryGeojson !== 'string') return geometryGeojson;
    try {
      return JSON.parse(geometryGeojson);
    } catch {
      return null;
    }
  }, [geometryGeojson]);

  useEffect(() => {
    const handleChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await containerRef.current.requestFullscreen();
      }
    } catch {
      // fullscreen denied — silently no-op
    }
  };

  // Fetch zoning overlay only when toggled on. Cached in component state for
  // the session; closing/reopening the panel re-fetches. No tile-level caching
  // — keep it simple until we see real zone uploads.
  useEffect(() => {
    if (!zoningEnabled || zoningGeo || zoningLoading || !center) return undefined;
    let cancelled = false;
    setZoningLoading(true);
    setZoningError(null);
    api
      .get('/master-plan/zones/geojson', {
        params: { lat: center[0], lng: center[1], radius_km: 5 },
      })
      .then((response) => {
        if (cancelled) return;
        setZoningGeo(response.data?.data || null);
      })
      .catch((err) => {
        if (cancelled) return;
        setZoningError(err?.response?.data?.message || err?.message || 'Failed to load zoning overlay.');
      })
      .finally(() => {
        if (!cancelled) setZoningLoading(false);
      });
    return () => { cancelled = true; };
  }, [zoningEnabled, zoningGeo, zoningLoading, center]);

  if (!center) {
    return null;
  }

  const layer = TILE_LAYERS[activeLayer];

  return (
    <div
      ref={containerRef}
      className={clsx(
        'relative overflow-hidden rounded-editorial border border-hairline bg-bg-secondary',
        isFullscreen ? 'h-screen w-screen rounded-none border-0' : heightClassName,
      )}
    >
      <MapContainer
        key={`${center[0]}:${center[1]}`}
        center={center}
        zoom={zoom}
        scrollWheelZoom={enableScrollZoom}
        zoomControl
        attributionControl
        className="h-full w-full"
      >
        <TileLayer
          key={activeLayer}
          attribution={layer.attribution}
          url={layer.url}
          maxZoom={layer.maxZoom}
        />
        <FitToGeometry geometry={geometry} fallbackCenter={center} fallbackZoom={zoom} />
        {geometry && (
          <GeoJSON
            data={geometry}
            style={{
              color: '#0f766e',
              weight: 2.5,
              fillColor: '#14b8a6',
              fillOpacity: 0.18,
            }}
          />
        )}
        {zoningEnabled && zoningGeo?.features?.length > 0 && (
          <GeoJSON
            // Key forces re-render when overlay toggles or new features arrive.
            key={`zoning-${zoningGeo.features.length}`}
            data={zoningGeo}
            style={(feature) => {
              const fsi = feature?.properties?.permissible_fsi_max || 0;
              // FSI heatmap: low = teal, mid = amber, high = magenta. Keeps
              // brand-accent blue reserved for the parcel pin.
              let fillColor = '#a3a3a3';
              if (fsi >= 3) fillColor = '#9333ea';
              else if (fsi >= 2) fillColor = '#f59e0b';
              else if (fsi > 0) fillColor = '#0ea5e9';
              return {
                color: '#475569',
                weight: 1,
                fillColor,
                fillOpacity: 0.18,
                dashArray: '3 3',
              };
            }}
            onEachFeature={(feature, layer) => {
              const p = feature?.properties || {};
              const html = `
                <div style="font-family: inherit; font-size: 12px; min-width: 160px">
                  <div style="font-weight: 600; margin-bottom: 4px">${p.zone_code || 'Zone'}</div>
                  ${p.zone_name ? `<div style="color: #475569; margin-bottom: 4px">${p.zone_name}</div>` : ''}
                  ${p.permissible_fsi_max ? `<div>Max FSI: <b>${p.permissible_fsi_max}</b></div>` : ''}
                  ${p.permissible_fsi_base ? `<div>Base FSI: ${p.permissible_fsi_base}</div>` : ''}
                </div>
              `;
              layer.bindPopup(html);
            }}
          />
        )}
        <CircleMarker
          center={center}
          radius={9}
          pathOptions={{
            color: '#1d4ed8',
            weight: 2,
            fillColor: '#3b82f6',
            fillOpacity: 0.55,
          }}
        >
          <Popup>{title}</Popup>
        </CircleMarker>
      </MapContainer>

      {/* T3 — Zoning overlay toggle. Empty state when no zones have geom. */}
      <div className="absolute left-3 top-3 z-[1000] flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setZoningEnabled((on) => !on)}
          aria-pressed={zoningEnabled}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-editorial border bg-bg-elevated/95 px-2.5 py-1.5 text-[11px] font-medium shadow-sm backdrop-blur-sm transition-colors duration-150 ease-out',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
            zoningEnabled
              ? 'border-primary-400 text-content-primary'
              : 'border-hairline text-content-secondary hover:border-primary-300 hover:text-content-primary',
          )}
          title={zoningEnabled ? 'Hide zoning overlay' : 'Show RMP zoning overlay'}
        >
          <MapIcon size={11} />
          {zoningEnabled ? 'Zoning on' : 'Zoning'}
        </button>
        {zoningEnabled && zoningLoading && (
          <div className="rounded-editorial border border-hairline bg-bg-elevated/95 px-2.5 py-1 text-[10px] text-content-muted shadow-sm backdrop-blur-sm">
            Loading zones…
          </div>
        )}
        {zoningEnabled && !zoningLoading && zoningError && (
          <div className="rounded-editorial border border-amber-300 bg-amber-50/95 px-2.5 py-1 text-[10px] text-amber-900 shadow-sm">
            {zoningError}
          </div>
        )}
        {zoningEnabled && !zoningLoading && !zoningError && zoningGeo?.features?.length === 0 && (
          <div className="max-w-[220px] rounded-editorial border border-hairline bg-bg-elevated/95 px-2.5 py-1.5 text-[10px] text-content-muted shadow-sm backdrop-blur-sm leading-relaxed">
            No zone geometry uploaded yet for this area. Upload RMP zone GeoJSON in the master-plan admin to populate this overlay.
          </div>
        )}
      </div>

      {enableLayerToggle && (
        <div
          role="tablist"
          aria-label="Map base layer"
          className="absolute right-3 top-3 z-[1000] inline-flex rounded-editorial border border-hairline bg-bg-elevated/95 p-1 shadow-sm backdrop-blur-sm"
        >
          {Object.entries(TILE_LAYERS).map(([key, def]) => {
            const isActive = activeLayer === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveLayer(key)}
                className={clsx(
                  'inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 ease-out',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
                  isActive
                    ? 'bg-bg-secondary text-content-primary shadow-sm'
                    : 'text-content-secondary hover:text-content-primary',
                )}
              >
                {key === 'streets' ? <Layers size={11} /> : null}
                {def.label}
              </button>
            );
          })}
        </div>
      )}

      {enableFullscreen && (
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          className={clsx(
            'absolute bottom-6 right-3 z-[1000] inline-flex items-center justify-center rounded-editorial border border-hairline bg-bg-elevated/95 p-1.5 shadow-sm backdrop-blur-sm transition-colors duration-150 ease-out',
            'hover:border-primary-300 active:scale-[0.98]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
          )}
        >
          {isFullscreen ? (
            <Minimize2 size={14} className="text-content-primary" />
          ) : (
            <Maximize2 size={14} className="text-content-primary" />
          )}
        </button>
      )}
    </div>
  );
}
