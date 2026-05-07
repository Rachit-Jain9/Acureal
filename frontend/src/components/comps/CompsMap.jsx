import { useEffect, useMemo, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  Tooltip,
  ZoomControl,
  useMap,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Building2, MapPin, Layers, MousePointerClick } from 'lucide-react';
import useTheme from '../../hooks/useTheme';

// Bengaluru fallback center for the comps map. The seed data is residential
// Bengaluru-only as of audit; this keeps the map oriented even before any
// row is selected. When the comps span a wider bbox we fit to it.
const BENGALURU_CENTER = [12.9716, 77.5946];
const DEFAULT_ZOOM = 11;

// Tile-layer URLs by theme. CartoDB ships matched Light (Positron) and Dark
// (Dark Matter) styles — we swap based on the active dashboard theme so the
// map stops looking like a pale rectangle inside a dark UI. The TileLayer's
// `key` prop is forced to remount on theme change because react-leaflet
// doesn't react to URL prop changes alone.
const TILES_BY_THEME = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CartoDB',
  },
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CartoDB',
  },
};

// Per-data-type marker palette. Mirrors the source-pill tones on the Comps
// table so the visual mapping reads instantly: emerald = verified, blue =
// listing, violet = IPC. Sticky to one accent per row so reviewers can
// triangulate freshness across map and table.
const DATA_TYPE_PALETTE = {
  internal_benchmark_apr_2026: { fill: '#10b981', stroke: '#047857', label: 'Verified' },
  listing_q1_2026:             { fill: '#3b82f6', stroke: '#1d4ed8', label: 'Listing' },
  ipc_q1_2026:                 { fill: '#8b5cf6', stroke: '#6d28d9', label: 'IPC' },
};
const DEFAULT_PALETTE = { fill: '#94a3b8', stroke: '#475569', label: 'Other' };

const paletteFor = (comp) => {
  if (comp.is_verified) return DATA_TYPE_PALETTE.internal_benchmark_apr_2026;
  return DATA_TYPE_PALETTE[comp.data_type] || DEFAULT_PALETTE;
};

// Auto-fit the map to the comp set on first render, and fly to the selected
// comp whenever the parent updates `selectedCompId`. Lives inside the
// MapContainer because flyTo/fitBounds need the leaflet `useMap()` handle.
function MapEffects({ comps, selectedComp }) {
  const map = useMap();
  const fittedRef = useRef(false);

  // First-render fit: drop a tight bounding box around all rows that have
  // coords. Skip if there are no coords or there's only one (keep default
  // zoom in those cases — fitting to a single point overshoots).
  useEffect(() => {
    if (fittedRef.current) return;
    const points = comps
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
      .map((c) => [c.lat, c.lng]);
    if (points.length < 2) return;
    map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
    fittedRef.current = true;
  }, [map, comps]);

  // Fly to selection. 400ms duration matches the FRONTEND_GUIDELINES
  // map zoom/pan budget. Honors the leaflet default easing.
  useEffect(() => {
    if (!selectedComp) return;
    if (!Number.isFinite(selectedComp.lat) || !Number.isFinite(selectedComp.lng)) return;
    map.flyTo([selectedComp.lat, selectedComp.lng], Math.max(map.getZoom(), 14), {
      duration: 0.4,
    });
  }, [map, selectedComp]);

  return null;
}

// Compact rate formatter so popups don't overflow on small screens.
const formatRate = (value) => {
  if (value == null) return '—';
  return `₹${Number(value).toLocaleString('en-IN')}/sqft`;
};

export default function CompsMap({
  comps,
  selectedCompId,
  onSelectComp,
  height = 520,
}) {
  const theme = useTheme();
  const tile = TILES_BY_THEME[theme] || TILES_BY_THEME.dark;
  // Filter once for points with valid coordinates. Comps without geocode are
  // still listed in the table — they just don't appear on the map. Surfaced
  // in the legend's count below so the user understands the gap.
  const mappable = useMemo(
    () => (comps || []).filter((c) => Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng))),
    [comps],
  );
  const selectedComp = useMemo(
    () => mappable.find((c) => c.id === selectedCompId) || null,
    [mappable, selectedCompId],
  );
  const ungeocodedCount = (comps?.length || 0) - mappable.length;

  // Palette breakdown for the legend. Counts give the user a sense of source
  // mix (verified vs listing vs IPC) at a glance.
  const paletteCounts = useMemo(() => {
    const counts = { internal_benchmark_apr_2026: 0, listing_q1_2026: 0, ipc_q1_2026: 0, other: 0 };
    for (const c of mappable) {
      if (c.is_verified) { counts.internal_benchmark_apr_2026 += 1; continue; }
      if (counts[c.data_type] != null) counts[c.data_type] += 1;
      else counts.other += 1;
    }
    return counts;
  }, [mappable]);

  return (
    <div
      className="relative bg-bg-elevated rounded-editorial border border-hairline-strong overflow-hidden shadow-editorial"
      style={{ height }}
    >
      <MapContainer
        center={BENGALURU_CENTER}
        zoom={DEFAULT_ZOOM}
        zoomControl={false}
        scrollWheelZoom
        className="h-full w-full"
        // Subtle background so markers stand out against neutral terrain;
        // tiles swap between Positron (light) and DarkMatter (dark) so the
        // map blends into whichever theme is active.
      >
        <TileLayer
          // Force a remount on theme change so leaflet swaps tile providers.
          key={theme}
          attribution={tile.attribution}
          url={tile.url}
          subdomains={['a', 'b', 'c', 'd']}
          maxZoom={19}
        />
        <ZoomControl position="bottomright" />
        <MapEffects comps={mappable} selectedComp={selectedComp} />
        {mappable.map((comp) => {
          const palette = paletteFor(comp);
          const isSel = comp.id === selectedCompId;
          // Selected state: bigger radius + heavy stroke that contrasts with
          // either theme. Uses the theme to pick a stroke that pops on dark
          // tiles (white) vs. light tiles (deep slate).
          const selStroke = theme === 'dark' ? '#ffffff' : '#0f172a';
          return (
            <CircleMarker
              key={comp.id}
              center={[comp.lat, comp.lng]}
              radius={isSel ? 12 : 8}
              pathOptions={{
                color: isSel ? selStroke : palette.stroke,
                weight: isSel ? 3 : 2,
                fillColor: palette.fill,
                fillOpacity: isSel ? 1 : 0.92,
              }}
              eventHandlers={{
                click: () => onSelectComp?.(comp.id),
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={1} sticky>
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold">{comp.project_name}</p>
                  <p className="text-xs">
                    {formatRate(comp.rate_per_sqft)}
                    {comp.locality && <span className="text-content-secondary"> · {comp.locality}</span>}
                  </p>
                </div>
              </Tooltip>
              <Popup minWidth={240}>
                <div className="space-y-2">
                  <div>
                    <p className="text-sm font-semibold text-content-primary">{comp.project_name}</p>
                    {comp.developer && (
                      <p className="text-xs text-content-secondary">{comp.developer}</p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-content-muted">Rate</p>
                      <p className="font-semibold tabular-nums">{formatRate(comp.rate_per_sqft)}</p>
                    </div>
                    {comp.bhk_config && (
                      <div>
                        <p className="text-content-muted">Config</p>
                        <p className="font-semibold">{comp.bhk_config}</p>
                      </div>
                    )}
                    {comp.launch_year && (
                      <div>
                        <p className="text-content-muted">Launch</p>
                        <p className="font-semibold tabular-nums">{comp.launch_year}</p>
                      </div>
                    )}
                    {comp.locality && (
                      <div>
                        <p className="text-content-muted">Locality</p>
                        <p className="font-semibold truncate">{comp.locality}</p>
                      </div>
                    )}
                  </div>
                  {comp.source && (
                    <p className="text-[10px] text-content-muted truncate" title={comp.source}>
                      {comp.source}
                    </p>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* Legend — top-left overlay. Editorial chrome (no gradients), tabular
          nums for counts, hairline borders. Positioned absolute so it
          floats over the leaflet canvas without affecting layout. */}
      <div
        className="absolute top-3 left-3 z-[400] rounded-editorial border border-hairline-strong bg-bg-elevated/95 backdrop-blur px-3 py-2 shadow-editorial"
        role="region"
        aria-label="Map legend"
      >
        <div className="flex items-center gap-1.5 mb-1.5">
          <Layers size={12} className="text-content-muted" />
          <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">
            Source mix
          </p>
        </div>
        <ul className="space-y-1">
          {Object.entries(DATA_TYPE_PALETTE).map(([key, palette]) => (
            <li key={key} className="flex items-center justify-between gap-3 text-[11px]">
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full border"
                  style={{ backgroundColor: palette.fill, borderColor: palette.stroke }}
                  aria-hidden="true"
                />
                <span className="text-content-secondary">{palette.label}</span>
              </div>
              <span className="text-content-muted tabular-nums">{paletteCounts[key]}</span>
            </li>
          ))}
        </ul>
        {ungeocodedCount > 0 && (
          <p className="mt-1.5 pt-1.5 border-t border-hairline text-[10px] text-amber-700 flex items-center gap-1">
            <MapPin size={10} />
            <span className="tabular-nums">{ungeocodedCount}</span> row{ungeocodedCount === 1 ? '' : 's'} not geocoded
          </p>
        )}
      </div>

      {/* Selected-comp inset — bottom-left. Renders only when a row/marker is
          pinned. Mirrors the table row's identity so the map and table feel
          like one surface, not two views. */}
      {selectedComp && (
        <div
          className="absolute bottom-3 left-3 z-[400] max-w-[260px] rounded-editorial border border-primary-200 bg-bg-elevated/95 backdrop-blur px-3 py-2 shadow-editorial transition-all duration-150 ease-out"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Building2 size={12} className="text-primary-600" />
            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-primary-700">Selected</p>
          </div>
          <p className="text-sm font-semibold text-content-primary truncate" title={selectedComp.project_name}>
            {selectedComp.project_name}
          </p>
          <p className="text-xs text-content-secondary">
            {formatRate(selectedComp.rate_per_sqft)}
            {selectedComp.locality && <span> · {selectedComp.locality}</span>}
          </p>
        </div>
      )}

      {/* Idle hint — bottom-center pill teaching the row↔marker interaction.
          Only renders when nothing is pinned, so it stays out of the way once
          users discover the gesture. */}
      {!selectedComp && mappable.length > 0 && (
        <div
          className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 z-[400] inline-flex items-center gap-1.5 rounded-full border border-hairline bg-bg-elevated/90 backdrop-blur px-2.5 py-1 shadow-editorial"
          aria-hidden="true"
        >
          <MousePointerClick size={11} className="text-content-muted" />
          <span className="text-[10px] uppercase tracking-[0.1em] font-medium text-content-muted">
            Click any row or marker to focus
          </span>
        </div>
      )}

      {/* Empty-state overlay — when the table has rows but none have coords,
          or when the table itself is empty. Avoids the "blank pale map" look
          the user flagged in the screenshot. */}
      {mappable.length === 0 && (
        <div
          className="pointer-events-none absolute inset-0 z-[300] flex items-center justify-center bg-bg-elevated/80 backdrop-blur-sm"
          role="status"
        >
          <div className="text-center max-w-[260px] px-4">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-bg-secondary border border-hairline mb-2.5">
              <MapPin size={16} className="text-content-muted" />
            </span>
            <p className="text-sm font-semibold text-content-primary mb-1">
              {(comps?.length || 0) === 0 ? 'No comparables to plot' : 'None of these comps are geocoded'}
            </p>
            <p className="text-xs text-content-secondary leading-relaxed">
              {(comps?.length || 0) === 0
                ? 'Adjust filters above or add a new comp to populate the map.'
                : `${comps.length} row${comps.length === 1 ? '' : 's'} in the table — add latitude/longitude to make them visible here.`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
