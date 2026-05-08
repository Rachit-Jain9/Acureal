import { useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, useJsApiLoader, OverlayView } from '@react-google-maps/api';
import { Building2, MapPin, Layers, MousePointerClick, AlertTriangle } from 'lucide-react';
import useTheme from '../../hooks/useTheme';

// Bengaluru fallback center for the comps map. The seed data is residential
// Bengaluru-only as of audit; this keeps the map oriented even before any
// row is selected. When the comps span a wider bbox we fit to it.
const BENGALURU_CENTER = { lat: 12.9716, lng: 77.5946 };
const DEFAULT_ZOOM = 11;

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

// Dark-theme map style — desaturated, matches the editorial dashboard chrome.
// Built from Google's Night-mode preset, tuned to REDIP's neutral palette
// (fewer pure blacks, more navy-grey, restrained labels). Light theme uses
// no override so the default Google "roadmap" style ships.
const DARK_MAP_STYLES = [
  { elementType: 'geometry',           stylers: [{ color: '#1f2937' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#9ca3af' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1f2937' }] },
  { featureType: 'administrative',     elementType: 'geometry',         stylers: [{ visibility: 'off' }] },
  { featureType: 'poi',                stylers: [{ visibility: 'off' }] },
  { featureType: 'road',               elementType: 'geometry',         stylers: [{ color: '#374151' }] },
  { featureType: 'road',               elementType: 'labels.text.fill', stylers: [{ color: '#9ca3af' }] },
  { featureType: 'road.highway',       elementType: 'geometry',         stylers: [{ color: '#4b5563' }] },
  { featureType: 'transit',            stylers: [{ visibility: 'off' }] },
  { featureType: 'water',              elementType: 'geometry',         stylers: [{ color: '#0b1220' }] },
  { featureType: 'water',              elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
];

// Compact rate formatter so popups don't overflow on small screens.
const formatRate = (value) => {
  if (value == null) return '—';
  return `₹${Number(value).toLocaleString('en-IN')}/sqft`;
};

// Custom marker — drawn as a small absolutely-positioned div (via
// OverlayView) so we can use CSS for animation and theming. Cheaper than
// rebuilding a Marker per render and lets the selected state animate
// smoothly. Click handler stops propagation so the underlying map doesn't
// receive a deselect.
function MarkerDot({ comp, selected, onClick, theme }) {
  const palette = paletteFor(comp);
  const selStroke = theme === 'dark' ? '#ffffff' : '#0f172a';
  const size = selected ? 22 : 14;
  const ringSize = selected ? size + 8 : size;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={`${comp.project_name} — ${formatRate(comp.rate_per_sqft)}`}
      className="absolute group cursor-pointer transition-transform duration-150 ease-out hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60 rounded-full"
      style={{
        // OverlayView renders us at a div whose origin matches lat/lng;
        // subtract half the visual size so the geometric centre lands at
        // the coord, not the top-left.
        transform: `translate(-${ringSize / 2}px, -${ringSize / 2}px)`,
        width: ringSize,
        height: ringSize,
      }}
    >
      {selected && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full motion-safe:animate-ping"
          style={{ backgroundColor: palette.fill, opacity: 0.35 }}
        />
      )}
      <span
        className="absolute rounded-full shadow-md"
        style={{
          left: (ringSize - size) / 2,
          top:  (ringSize - size) / 2,
          width: size,
          height: size,
          backgroundColor: palette.fill,
          border: `${selected ? 3 : 2}px solid ${selected ? selStroke : palette.stroke}`,
        }}
      />
    </button>
  );
}

// Inline tooltip rendered next to the selected marker — replaces the
// leaflet popup with a custom overlay so the styling matches REDIP chrome
// instead of Google's white-on-shadow default. Anchored above the marker
// with a small gap.
function MarkerTooltip({ comp }) {
  return (
    <div
      className="absolute z-[10] -translate-x-1/2 -translate-y-full mb-2 pointer-events-none"
      style={{ marginBottom: 18 }}
    >
      <div className="bg-bg-elevated border border-hairline-strong rounded-editorial shadow-lg px-3 py-2 min-w-[180px]">
        <p className="text-sm font-semibold text-content-primary truncate">{comp.project_name}</p>
        <p className="text-xs text-content-secondary tabular-nums">
          {formatRate(comp.rate_per_sqft)}
          {comp.locality && <span className="text-content-muted"> · {comp.locality}</span>}
        </p>
      </div>
    </div>
  );
}

// Stable libraries array — passing a new array reference on each render
// makes useJsApiLoader emit a "LoadScript has been reloaded unintentionally"
// warning and re-fetch the SDK. Hoisted here so identity stays stable.
const GMAPS_LIBRARIES = ['marker'];

export default function CompsMap({
  comps,
  selectedCompId,
  onSelectComp,
  height = 520,
}) {
  const theme = useTheme();
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey || '',
    libraries: GMAPS_LIBRARIES,
  });

  // Surface the underlying loadError to the console + a state mirror so the
  // failure UI can show the actual Error.message instead of a generic guess.
  // Without this, useJsApiLoader.loadError sat invisible while the UI claimed
  // it was a referrer issue — wasting an entire debug session chasing the
  // wrong layer.
  useEffect(() => {
    if (!loadError) return;
    // eslint-disable-next-line no-console
    console.error('[CompsMap] useJsApiLoader.loadError:', loadError);
    // eslint-disable-next-line no-console
    console.error('[CompsMap] loadError.message:', loadError?.message);
    // eslint-disable-next-line no-console
    console.error('[CompsMap] loadError.stack:', loadError?.stack);
    // eslint-disable-next-line no-console
    console.error('[CompsMap] script src expected:', `https://maps.googleapis.com/maps/api/js?key=${(apiKey || '').slice(0, 10)}…&libraries=marker&v=weekly`);
  }, [loadError, apiKey]);

  const mapRef = useRef(null);

  // Google Maps auth-failure capture. The Maps JS SDK emits its actual auth
  // error code (RefererNotAllowedMapError, ApiNotActivatedMapError, etc.) via
  // a global `gm_authFailure` callback — `useJsApiLoader.loadError` does NOT
  // surface this detail, leaving the UI stuck on a generic "Could not load"
  // message. We hook the global callback so the failure card can render the
  // exact restriction that's failing, plus the host the SDK was rejected from.
  const [authFailure, setAuthFailure] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    // Preserve any prior global hook so we don't trample on other consumers.
    const prev = window.gm_authFailure;
    window.gm_authFailure = () => {
      // Google calls this with no arguments; we capture the host so the
      // operator sees exactly which referrer pattern needs allowlisting.
      setAuthFailure({
        host: window.location.host,
        href: window.location.href,
        timestamp: new Date().toISOString(),
      });
      // eslint-disable-next-line no-console
      console.error(
        '[CompsMap] Google Maps gm_authFailure fired — key restriction blocked the load.',
        { host: window.location.host, href: window.location.href }
      );
      if (typeof prev === 'function') prev();
    };
    return () => {
      // Restore previous hook on unmount so other map instances on the page
      // don't lose their handler.
      window.gm_authFailure = prev;
    };
  }, []);

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

  // Map options — restyle whenever theme changes, restrict zoom, kill the
  // default UI noise. `gestureHandling: 'greedy'` matches leaflet's
  // scrollWheelZoom default; without it Google insists on Cmd/Ctrl-scroll.
  //
  // CRITICAL: `google.maps.ControlPosition` lives on the SDK's namespace,
  // which only exists AFTER `useJsApiLoader` has populated `window.google.maps`.
  // The previous guard `typeof google !== 'undefined'` was insufficient: the
  // SDK creates `window.google` (the empty namespace shell) very early, then
  // populates `.maps` later. So on first SPA mount before the SDK script
  // finished downloading, the guard passed but `google.maps` was still
  // undefined → reading `.ControlPosition` threw and the entire page
  // crashed with "Cannot read properties of undefined (reading
  // 'ControlPosition')". Browser refresh "fixed" it because the SDK script
  // was then served from disk cache and `.maps` populated synchronously.
  //
  // Fix: gate the zoomControlOptions on `isLoaded` AND a real namespace
  // check, AND include isLoaded in the useMemo deps so the option is
  // backfilled the moment the SDK becomes ready.
  const mapOptions = useMemo(() => {
    const opts = {
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: 'greedy',
      minZoom: 4,
      maxZoom: 19,
      styles: theme === 'dark' ? DARK_MAP_STYLES : null,
      backgroundColor: theme === 'dark' ? '#1f2937' : '#f3f4f6',
    };
    if (
      isLoaded
      && typeof google !== 'undefined'
      && google?.maps?.ControlPosition
    ) {
      opts.zoomControlOptions = { position: google.maps.ControlPosition.RIGHT_BOTTOM };
    }
    return opts;
  }, [theme, isLoaded]);

  // Fit bounds to the comp set on first map load. Skip if there are <2
  // points (fitting to a single point overshoots; default zoom is fine).
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!isLoaded || !mapRef.current || fittedRef.current) return;
    if (mappable.length < 2) return;
    const bounds = new window.google.maps.LatLngBounds();
    for (const c of mappable) {
      bounds.extend({ lat: Number(c.lat), lng: Number(c.lng) });
    }
    mapRef.current.fitBounds(bounds, 40);
    fittedRef.current = true;
  }, [isLoaded, mappable]);

  // Pan to selection. 400ms native panTo matches the FRONTEND_GUIDELINES
  // map zoom/pan budget. Re-fits zoom to at least 14 so users can see
  // detail on the focused project.
  useEffect(() => {
    if (!isLoaded || !mapRef.current || !selectedComp) return;
    if (!Number.isFinite(Number(selectedComp.lat)) || !Number.isFinite(Number(selectedComp.lng))) return;
    const map = mapRef.current;
    map.panTo({ lat: Number(selectedComp.lat), lng: Number(selectedComp.lng) });
    if ((map.getZoom?.() || 0) < 14) map.setZoom(14);
  }, [isLoaded, selectedComp]);

  // ── Failure modes ─────────────────────────────────────────────────────────
  // Three honest failure surfaces, each with a clear action:
  //   1. No API key configured → tell the operator what to set.
  //   2. SDK failed to load (likely referrer-restriction failure) → tell them
  //      to add HTTP referrer to Google Cloud Console.
  //   3. SDK loading → skeleton shimmer.

  if (!apiKey) {
    return (
      <div
        className="relative bg-bg-elevated rounded-editorial border border-hairline-strong overflow-hidden shadow-editorial flex items-center justify-center"
        style={{ height }}
        role="status"
      >
        <div className="text-center max-w-sm px-6">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-50 border border-amber-200 mb-2.5">
            <AlertTriangle size={16} className="text-amber-600" />
          </span>
          <p className="text-sm font-semibold text-content-primary mb-1">Map key not configured</p>
          <p className="text-xs text-content-secondary leading-relaxed">
            Set <code className="text-[11px] bg-bg-secondary px-1 py-0.5 rounded">VITE_GOOGLE_MAPS_API_KEY</code> in
            Vercel env (or <code className="text-[11px] bg-bg-secondary px-1 py-0.5 rounded">frontend/.env</code> for
            local dev) and redeploy.
          </p>
        </div>
      </div>
    );
  }

  // Combine the synchronous loader error and the async auth-failure callback
  // into one failure surface. Three honest layers, in priority order:
  //   1. authFailure   → Google rejected us (post-load): exact host shown
  //   2. loadError     → script never loaded: real Error.message shown
  //                       (most often: extension/adblocker, network, CSP)
  //   3. fallback hint → referrer / API restriction
  if (loadError || authFailure) {
    const realErrorMsg = loadError?.message || '';
    // Heuristic: if loadError fires WITHOUT gm_authFailure, the script never
    // reached Google (it would have run gm_authFailure if it did). That
    // signals an upstream block — extension, network, or our own CSP.
    const isLikelyClientBlock = !!loadError && !authFailure;
    return (
      <div
        className="relative bg-bg-elevated rounded-editorial border border-hairline-strong overflow-hidden shadow-editorial flex items-center justify-center"
        style={{ height }}
        role="status"
      >
        <div className="text-center max-w-md px-6 py-5">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-rose-50 border border-rose-200 mb-2.5">
            <AlertTriangle size={16} className="text-rose-600" />
          </span>
          <p className="text-sm font-semibold text-content-primary mb-1.5">Could not load Google Maps</p>

          {realErrorMsg && (
            <div className="mt-2 mb-2.5 text-left">
              <p className="text-[10px] uppercase tracking-[0.1em] font-semibold text-content-muted mb-1">Error</p>
              <pre className="bg-bg-secondary border border-hairline rounded px-2.5 py-1.5 text-[11px] text-rose-700 whitespace-pre-wrap leading-snug font-mono break-words">
                {realErrorMsg}
              </pre>
            </div>
          )}

          {authFailure?.host && (
            <p className="mb-2 text-[11px] text-content-muted">
              Rejected host: <code className="bg-bg-secondary px-1 py-0.5 rounded text-rose-700">{authFailure.host}</code>
            </p>
          )}

          {isLikelyClientBlock ? (
            <div className="text-left text-xs text-content-secondary leading-relaxed space-y-1.5">
              <p className="font-medium text-content-primary">Most likely causes (in order):</p>
              <ol className="list-decimal pl-4 space-y-1">
                <li>
                  Browser extension blocking <code className="bg-bg-secondary px-1 rounded text-[10px]">maps.googleapis.com</code>
                  {' '}(uBlock, Privacy Badger, DuckDuckGo, etc.). Try an incognito window with extensions off.
                </li>
                <li>Network/firewall block on Google Maps domains.</li>
                <li>Stale browser cache from before the CSP fix — hard-refresh (Cmd/Ctrl+Shift+R).</li>
              </ol>
            </div>
          ) : (
            <p className="text-xs text-content-secondary leading-relaxed">
              Open Google Cloud Console → Credentials → edit the key → add the current host to allowed
              HTTP referrers and reload. Wait up to 5 min for propagation.
            </p>
          )}

          <p className="mt-3 text-[10px] text-content-muted leading-relaxed">
            Full diagnostic logs in the browser console (filter for <code className="bg-bg-secondary px-1 rounded">[CompsMap]</code>).
          </p>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div
        className="relative bg-bg-secondary rounded-editorial border border-hairline-strong overflow-hidden shadow-editorial motion-safe:animate-pulse"
        style={{ height }}
        aria-busy="true"
      />
    );
  }

  return (
    <div
      className="relative bg-bg-elevated rounded-editorial border border-hairline-strong overflow-hidden shadow-editorial"
      style={{ height }}
    >
      <GoogleMap
        center={BENGALURU_CENTER}
        zoom={DEFAULT_ZOOM}
        options={mapOptions}
        mapContainerStyle={{ width: '100%', height: '100%' }}
        onLoad={(map) => { mapRef.current = map; }}
        onUnmount={() => { mapRef.current = null; }}
      >
        {mappable.map((comp) => {
          const isSel = comp.id === selectedCompId;
          return (
            <OverlayView
              key={comp.id}
              position={{ lat: Number(comp.lat), lng: Number(comp.lng) }}
              mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
            >
              <div className="relative">
                <MarkerDot
                  comp={comp}
                  selected={isSel}
                  onClick={() => onSelectComp?.(comp.id)}
                  theme={theme}
                />
                {isSel && <MarkerTooltip comp={comp} />}
              </div>
            </OverlayView>
          );
        })}
      </GoogleMap>

      {/* Legend — top-left overlay. Editorial chrome (no gradients), tabular
          nums for counts, hairline borders. Positioned absolute so it
          floats over the map canvas without affecting layout. */}
      <div
        className="absolute top-3 left-3 z-[5] rounded-editorial border border-hairline-strong bg-bg-elevated/95 backdrop-blur px-3 py-2 shadow-editorial"
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
          className="absolute bottom-3 left-3 z-[5] max-w-[260px] rounded-editorial border border-primary-200 bg-bg-elevated/95 backdrop-blur px-3 py-2 shadow-editorial transition-all duration-150 ease-out"
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
          className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 z-[5] inline-flex items-center gap-1.5 rounded-full border border-hairline bg-bg-elevated/90 backdrop-blur px-2.5 py-1 shadow-editorial"
          aria-hidden="true"
        >
          <MousePointerClick size={11} className="text-content-muted" />
          <span className="text-[10px] uppercase tracking-[0.1em] font-medium text-content-muted">
            Click any row or marker to focus
          </span>
        </div>
      )}

      {/* Empty-state overlay — when the table has rows but none have coords,
          or when the table itself is empty. Avoids the blank-map look. */}
      {mappable.length === 0 && (
        <div
          className="pointer-events-none absolute inset-0 z-[6] flex items-center justify-center bg-bg-elevated/80 backdrop-blur-sm"
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
