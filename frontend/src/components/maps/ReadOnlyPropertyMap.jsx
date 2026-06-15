import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, GeoJSON, MapContainer, Marker, Pane, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Maximize2, Minimize2, MapPin, Check, X as XIcon } from 'lucide-react';
import clsx from 'clsx';
import 'leaflet/dist/leaflet.css';
import api, { propertiesAPI } from '../../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '../common/Toast';
import {
  buildCadastralLayers,
  isInRmp2015Bounds,
  RMP2015_LEAFLET_BOUNDS,
  DEFAULT_MASTER_PLAN_OPACITY,
} from '../../utils/cadastralLayers';
import CadastralLayerPanel from './CadastralLayerPanel';

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

// Pin-relocation helper. When the parent enables relocate mode, every map
// click drops the pending pin; analyst can also drag the marker. Saving
// posts to PUT /properties/:id and invalidates query caches.
function MapClickCapture({ active, onPick }) {
  useMapEvents({
    click(e) {
      if (!active) return;
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Default Leaflet marker icons need a manual setup in Vite — without this
// `Marker` renders as a broken-image. Self-hosted from frontend/public/leaflet
// to avoid a third-party hop and to keep CSP img-src tight.
const DEFAULT_ICON = L.icon({
  iconUrl: '/leaflet/marker-icon.png',
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  shadowUrl: '/leaflet/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

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
  // E1 — the geocode status of the pin (verified / manual / approximate /
  // pending). Drives the parcel-pin trust line in the layer panel.
  geocodeStatus = null,
  heightClassName = 'h-[420px]',
  zoom = 17,
  enableScrollZoom = true,
  enableFullscreen = true,
  enableLayerToggle = true,
  // T6.1 — pin relocation. When propertyId is provided and canEdit is true,
  // analysts get a "Move pin" button to drag/click the marker to its real
  // location and save back to /properties/:id. Critical for Bengaluru where
  // address geocoding is often 100-300m off the actual parcel.
  propertyId = null,
  canEdit = false,
  onPinUpdated = null,
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

  // Master-plan (RMP 2015) reference overlay — same-origin proxied raster
  // tiles. Opacity-controlled; bounds-limited so tiles only load over the BDA
  // extent. `mpError` flips on a real tileerror (blank tiles return 204 and are
  // treated as empty, not errored).
  const [mpEnabled, setMpEnabled] = useState(false);
  const [mpOpacity, setMpOpacity] = useState(DEFAULT_MASTER_PLAN_OPACITY);
  const [mpError, setMpError] = useState(false);

  // T6.1 — pin relocation state
  const [relocateMode, setRelocateMode] = useState(false);
  const [pendingPin, setPendingPin] = useState(null); // [lat, lng] | null
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

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

  // E1 — the layer descriptor driving the CadastralLayerPanel: one honest
  // legend over what the map is actually painting and where it comes from.
  // Pure point-in-bbox test — the overlay only covers the BDA extent, so a
  // parcel outside it gets an honest "outside mapped area" state rather than a
  // silently blank overlay.
  const mpInBounds = useMemo(
    () => (center ? isInRmp2015Bounds(center[0], center[1]) : false),
    [center],
  );

  const cadastralLayers = useMemo(
    () =>
      buildCadastralLayers({
        basemap: activeLayer,
        hasBoundary: !!geometry,
        zoning: {
          enabled: zoningEnabled,
          loading: zoningLoading,
          error: zoningError,
          featureCount: zoningGeo?.features?.length ?? null,
        },
        masterPlan: {
          enabled: mpEnabled,
          error: mpError,
          inBounds: mpInBounds,
          opacity: mpOpacity,
        },
        geocodeStatus,
      }),
    [
      activeLayer,
      geometry,
      zoningEnabled,
      zoningLoading,
      zoningError,
      zoningGeo,
      mpEnabled,
      mpError,
      mpInBounds,
      mpOpacity,
      geocodeStatus,
    ],
  );

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

  // Fetch zoning overlay only when toggled on. Cached in component state
  // for the session; closing/reopening the panel re-fetches.
  //
  // Why a ref instead of `zoningLoading` in deps:
  //   The previous version put `zoningLoading` in the deps array as a
  //   guard against double-fetching. But that made the effect re-run the
  //   moment loading flipped true, the cleanup ran and set
  //   `cancelled = true`, and when the promise finally resolved every
  //   state setter bailed (including `setZoningLoading(false)`).
  //   Net effect: the "Fetching Revised Master Plan zone geometry…"
  //   spinner could spin forever on a slow connection or a hung
  //   backend. A ref lets us track in-flight without re-running the
  //   effect.
  //
  // We also enforce a 15-second client-side timeout so a backend that
  // hangs (no response at all) eventually surfaces an error instead of
  // showing "Loading…" indefinitely.
  const zoningRequestRef = useRef(null);
  useEffect(() => {
    if (!zoningEnabled || zoningGeo || !center) return undefined;
    if (zoningRequestRef.current) return undefined; // request already in flight
    const controller = new AbortController();
    zoningRequestRef.current = controller;
    let cancelled = false;
    setZoningLoading(true);
    setZoningError(null);
    api
      .get('/master-plan/zones/geojson', {
        params: { lat: center[0], lng: center[1], radius_km: 5 },
        signal: controller.signal,
        timeout: 15000,
      })
      .then((response) => {
        if (cancelled) return;
        setZoningGeo(response.data?.data || null);
      })
      .catch((err) => {
        if (cancelled || controller.signal.aborted) return;
        const isTimeout =
          err?.code === 'ECONNABORTED'
          || /timeout/i.test(err?.message || '')
          || err?.name === 'CanceledError';
        setZoningError(
          isTimeout
            ? 'Zoning overlay timed out. Try toggling it again.'
            : err?.response?.data?.message
              || err?.message
              || 'Failed to load zoning overlay.',
        );
      })
      .finally(() => {
        zoningRequestRef.current = null;
        if (!cancelled) setZoningLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
      zoningRequestRef.current = null;
    };
  }, [zoningEnabled, zoningGeo, center]);

  // Save the relocated pin. Posts to PUT /properties/:id with new coords,
  // then invalidates the property + parcel-intelligence query caches so the
  // panel re-fetches with the corrected lat/lng (which also re-runs OSM and
  // K-GIS lookups on the next refresh).
  const saveRelocatedPin = async () => {
    if (!propertyId || !pendingPin) return;
    setSaving(true);
    try {
      await propertiesAPI.update(propertyId, {
        lat: pendingPin[0],
        lng: pendingPin[1],
      });
      queryClient.invalidateQueries({ queryKey: ['property', propertyId] });
      queryClient.invalidateQueries({ queryKey: ['property', propertyId, 'parcel-intelligence'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      toast.success('Pin updated. Refresh parcel intelligence to re-run OSM and K-GIS lookups.');
      setRelocateMode(false);
      setPendingPin(null);
      if (onPinUpdated) onPinUpdated(pendingPin);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save pin.');
    } finally {
      setSaving(false);
    }
  };

  const cancelRelocate = () => {
    setRelocateMode(false);
    setPendingPin(null);
  };

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
        {/* RMP 2015 reference overlay — own pane at z350: above the basemap
            (tilePane 200), below the GeoJSON zoning/boundary (overlayPane 400)
            and the parcel pin (markerPane 600). Same-origin proxied tiles
            (CSP-safe); opacity updates live; bounds-limited to the BDA extent. */}
        <Pane name="masterPlanPane" style={{ zIndex: 350 }}>
          {mpEnabled && (
            <TileLayer
              key={`mp-${mpEnabled}`}
              pane="masterPlanPane"
              url="/api/master-plan-tiles/rmp2015/{z}/{x}/{y}.png"
              opacity={mpOpacity}
              minZoom={9}
              maxZoom={19}
              bounds={RMP2015_LEAFLET_BOUNDS}
              attribution="RMP 2015 PLU — BDA / Map Warper (reference)"
              eventHandlers={{ tileerror: () => setMpError(true) }}
            />
          )}
        </Pane>
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
            fillOpacity: relocateMode && pendingPin ? 0.18 : 0.55,
          }}
        >
          <Popup>{title}</Popup>
        </CircleMarker>

        {/* T6.1 — Pin relocation overlay */}
        <MapClickCapture
          active={relocateMode}
          onPick={(la, lo) => setPendingPin([la, lo])}
        />
        {relocateMode && (pendingPin || center) && (
          <Marker
            position={pendingPin || center}
            icon={DEFAULT_ICON}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const ll = e.target.getLatLng();
                setPendingPin([ll.lat, ll.lng]);
              },
            }}
          >
            <Popup>
              <div style={{ fontSize: 12, lineHeight: 1.4 }}>
                <div style={{ fontWeight: 600 }}>Pending pin</div>
                <div style={{ fontFamily: 'monospace', marginTop: 2 }}>
                  {(pendingPin || center)[0].toFixed(6)}, {(pendingPin || center)[1].toFixed(6)}
                </div>
                <div style={{ marginTop: 4, color: '#64748b' }}>
                  Drag this marker, or click anywhere on the map to move it.
                </div>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>

      {/* T6.1 — Pin relocation. Visible only when propertyId + canEdit are
          provided (deal pages). Two states:
          1. Idle: small "Move pin" button below the zoning toggle.
          2. Active: instructional banner + Save / Cancel buttons. */}
      {propertyId && canEdit && relocateMode && (
        <div className="absolute left-1/2 top-3 z-[1100] -translate-x-1/2 flex max-w-[460px] flex-col gap-2 rounded-editorial border border-primary-300 bg-bg-elevated/95 px-3 py-2 shadow-lg backdrop-blur-sm">
          <div className="flex items-start gap-2">
            <MapPin size={13} className="mt-0.5 shrink-0 text-primary-600" />
            <div className="text-[11px] leading-relaxed text-content-primary">
              <span className="font-semibold">Click the map</span> or drag the marker to set the actual parcel pin.
              {pendingPin && (
                <span className="ml-1 font-mono tabular-nums text-content-muted">
                  {pendingPin[0].toFixed(6)}, {pendingPin[1].toFixed(6)}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={cancelRelocate}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md border border-hairline bg-bg-secondary px-2.5 py-1 text-[11px] font-semibold text-content-secondary hover:text-content-primary disabled:opacity-50 transition-colors"
            >
              <XIcon size={11} />
              Cancel
            </button>
            <button
              type="button"
              onClick={saveRelocatedPin}
              disabled={!pendingPin || saving}
              className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              <Check size={11} />
              {saving ? 'Saving…' : 'Save pin'}
            </button>
          </div>
        </div>
      )}

      {/* T6.1 — Move pin. The basemap selector and the zoning overlay now
          live in the CadastralLayerPanel (top-right); only this relocate
          action stays in the top-left corner. */}
      {propertyId && canEdit && !relocateMode && (
        <div className="absolute left-3 top-3 z-[1000]">
          <button
            type="button"
            onClick={() => {
              setRelocateMode(true);
              setPendingPin(center);
            }}
            className="inline-flex items-center gap-1.5 rounded-editorial border border-hairline bg-bg-elevated/95 px-2.5 py-1.5 text-[11px] font-medium text-content-secondary hover:border-primary-300 hover:text-content-primary transition-colors duration-150 ease-out shadow-sm backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
            title="Pin not at the actual parcel? Move it"
          >
            <MapPin size={11} />
            Move pin
          </button>
        </div>
      )}

      {/* E1 — the cadastral layer panel: one honest legend for every layer
          (basemap, cadastral boundary, RMP zoning, parcel pin), replacing
          the scattered basemap + zoning toggles. */}
      {enableLayerToggle && (
        <div className="absolute right-3 top-3 z-[1000]">
          <CadastralLayerPanel
            layers={cadastralLayers}
            onBasemapChange={setActiveLayer}
            onToggleZoning={() => setZoningEnabled((on) => !on)}
            onToggleMasterPlan={() => {
              setMpError(false);
              setMpEnabled((on) => !on);
            }}
            onMasterPlanOpacity={setMpOpacity}
          />
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
