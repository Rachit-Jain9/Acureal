import { useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, useJsApiLoader, OverlayView } from '@react-google-maps/api';
import { Building2, MapPin, Layers, MousePointerClick, AlertTriangle } from 'lucide-react';
import useTheme from '../../hooks/useTheme';
import { Skeleton } from '../../design-system';
import ProvenanceCell from '../common/ProvenanceCell';

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
// Built from Google's Night-mode preset, tuned to Acureal's neutral palette
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
      className="absolute group cursor-pointer transition-transform duration-150 ease-out hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded-full"
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
// leaflet popup with a custom overlay so the styling matches Acureal chrome
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

// Cluster marker — drawn when multiple comps share the same locality
// centroid (which is the common case after the centroid-geocoding migration:
// 15+ Whitefield comps all sit at exactly 12.9698, 77.7499). Without this,
// they stack invisibly into one indistinguishable blob.
//
// Uses the dominant data_type colour for the cluster fill, with an interior
// count badge. Click expands a list popup so the user can pick a specific
// project.
function ClusterMarker({ count, dominantPalette, expanded, onClick, theme }) {
  const selStroke = theme === 'dark' ? '#ffffff' : '#0f172a';
  const size = expanded ? 38 : 32;
  const ringSize = size + 8;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={`${count} comparables at this location`}
      aria-expanded={expanded}
      className="absolute group cursor-pointer transition-transform duration-200 ease-out hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded-full"
      style={{
        transform: `translate(-${ringSize / 2}px, -${ringSize / 2}px)`,
        width: ringSize,
        height: ringSize,
      }}
    >
      {expanded && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full motion-safe:animate-ping"
          style={{ backgroundColor: dominantPalette.fill, opacity: 0.3 }}
        />
      )}
      <span
        className="absolute rounded-full shadow-md flex items-center justify-center text-white font-semibold tabular-nums"
        style={{
          left: (ringSize - size) / 2,
          top:  (ringSize - size) / 2,
          width: size,
          height: size,
          fontSize: count >= 100 ? 11 : 13,
          backgroundColor: dominantPalette.fill,
          border: `${expanded ? 3 : 2}px solid ${expanded ? selStroke : dominantPalette.stroke}`,
        }}
      >
        {count}
      </span>
    </button>
  );
}

// Expanded cluster list popup — appears when the user clicks a cluster
// marker. Lists every comp at that location with rate + verified flag so
// the user can pick a specific project. Clicking a row selects that comp
// in the table without dismissing, so adjacent projects can be browsed.
//
// Positioning: anchored ABOVE the cluster pin (translate-y-full) so the
// popup grows upward and doesn't collide with the bottom-left "Selected"
// inset or bottom-right zoom controls. Cluster pins after fitBounds tend
// to sit in the center of the map, leaving plenty of room above.
//
// Z-index: 25 — sits above the bottom-left Selected inset (z-5) and the
// top-left legend (z-5). Only the cluster popup gets this elevated layer.
function ClusterListPopup({ comps, selectedCompId, onSelect, onClose }) {
  // Put the selected comp first so it's the first thing the user sees
  // when the popup auto-opens after a table click. Otherwise the user
  // has to scan a list of 25 to find what they just clicked.
  const sortedComps = useMemo(() => {
    if (!selectedCompId) return comps;
    const sel = comps.find((c) => c.id === selectedCompId);
    if (!sel) return comps;
    return [sel, ...comps.filter((c) => c.id !== selectedCompId)];
  }, [comps, selectedCompId]);

  return (
    <div
      className="absolute z-[25] -translate-x-1/2 -translate-y-full pointer-events-auto"
      style={{ bottom: 22 }}
      role="dialog"
      aria-label={`${comps.length} comparables at this location`}
    >
      <div className="bg-bg-elevated border border-hairline-strong rounded-editorial shadow-xl min-w-[260px] max-w-[320px] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-hairline bg-bg-secondary/60">
          <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">
            {comps.length} comparable{comps.length === 1 ? '' : 's'} here
          </p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="text-content-muted hover:text-content-primary transition-colors text-xs leading-none px-1"
            aria-label="Close list"
          >
            ✕
          </button>
        </div>
        <ul className="max-h-[220px] overflow-y-auto divide-y divide-hairline">
          {sortedComps.map((comp) => {
            const palette = paletteFor(comp);
            const isSel = comp.id === selectedCompId;
            return (
              <li key={comp.id}>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSelect(comp.id); }}
                  aria-current={isSel ? 'true' : undefined}
                  className={[
                    'w-full text-left px-3 py-2 transition-colors flex items-start gap-2',
                    isSel
                      ? 'bg-accent-soft hover:brightness-95 ring-1 ring-inset ring-accent/40'
                      : 'hover:bg-bg-secondary',
                  ].join(' ')}
                >
                  <span
                    aria-hidden="true"
                    className="mt-1.5 inline-block rounded-full shrink-0"
                    style={{
                      width: isSel ? 10 : 8,
                      height: isSel ? 10 : 8,
                      backgroundColor: palette.fill,
                      border: `1px solid ${palette.stroke}`,
                      boxShadow: isSel ? `0 0 0 3px ${palette.fill}33` : undefined,
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm truncate ${isSel ? 'font-semibold text-content-primary' : 'font-medium text-content-primary'}`}>
                      {comp.project_name || '(unnamed)'}
                    </p>
                    <p className="text-xs text-content-secondary tabular-nums">
                      {formatRate(comp.rate_per_sqft)}
                      {comp.developer && (
                        <span className="text-content-muted"> · {comp.developer}</span>
                      )}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
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
    if (import.meta.env.DEV) {
      // Single dev-only diagnostic; never logs in production and never
      // echoes any part of the API key.
      // eslint-disable-next-line no-console
      console.error('[CompsMap] useJsApiLoader.loadError:', {
        message: loadError?.message,
        stack: loadError?.stack,
      });
    }
  }, [loadError]);

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
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error(
          '[CompsMap] Google Maps gm_authFailure fired — key restriction blocked the load.',
          { host: window.location.host, href: window.location.href }
        );
      }
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
  // Selected comp can be EITHER mappable or unmapped. We look up against the
  // full `comps` list so the bottom-left "Selected" inset still renders for
  // unmapped rows (with an off-map flag), instead of disappearing entirely
  // and leaving the user staring at the previous selection's map state.
  const selectedComp = useMemo(
    () => (comps || []).find((c) => c.id === selectedCompId) || null,
    [comps, selectedCompId],
  );
  const selectedCompIsMapped = !!selectedComp
    && Number.isFinite(Number(selectedComp.lat))
    && Number.isFinite(Number(selectedComp.lng));

  // Group comps that share (almost) the same coordinate. After the bulk
  // locality-centroid geocoding migration most comps in the same locality
  // sit at identical coords — without grouping they stack invisibly into
  // one marker and the user can't see/click individuals. We round to 4
  // decimals (~11m precision) so genuine project-precise coords still
  // separate but identical-centroid stacks collapse cleanly.
  //
  // For each group we pick the dominant palette (verified > listing > IPC)
  // for the cluster marker fill, so a cluster of mostly-verified comps
  // reads emerald at a glance.
  const markerGroups = useMemo(() => {
    const groups = new Map();
    for (const c of mappable) {
      const key = `${Number(c.lat).toFixed(4)},${Number(c.lng).toFixed(4)}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          lat: Number(c.lat),
          lng: Number(c.lng),
          comps: [],
        });
      }
      groups.get(key).comps.push(c);
    }
    // Decide a dominant palette per group — verified beats listing beats IPC.
    for (const g of groups.values()) {
      const ranks = { internal_benchmark_apr_2026: 0, ipc_q1_2026: 0, listing_q1_2026: 0, other: 0 };
      for (const c of g.comps) {
        if (c.is_verified) ranks.internal_benchmark_apr_2026 += 3;
        else if (c.data_type === 'ipc_q1_2026') ranks.ipc_q1_2026 += 2;
        else if (c.data_type === 'listing_q1_2026') ranks.listing_q1_2026 += 1;
        else ranks.other += 1;
      }
      const top = Object.entries(ranks).sort((a, b) => b[1] - a[1])[0][0];
      g.dominantPalette = DATA_TYPE_PALETTE[top] || DEFAULT_PALETTE;
    }
    return Array.from(groups.values());
  }, [mappable]);

  // Which cluster, if any, is showing its expanded list popup. Tracked by
  // the group key (lat,lng-rounded) so it's stable across re-renders.
  const [expandedClusterKey, setExpandedClusterKey] = useState(null);

  // Auto-expand the cluster that contains the currently-selected comp,
  // so when the user clicks a row in the table or a marker, the relevant
  // cluster's list opens to show context. Doesn't auto-close on deselect
  // (user can explicitly close via X or by selecting another).
  useEffect(() => {
    if (!selectedCompId) return;
    const group = markerGroups.find((g) =>
      g.comps.some((c) => c.id === selectedCompId)
    );
    if (group && group.comps.length > 1 && expandedClusterKey !== group.key) {
      setExpandedClusterKey(group.key);
    }
  }, [selectedCompId, markerGroups, expandedClusterKey]);
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
  //
  // After fitBounds, CAP the zoom at 13 if Google overshot to a higher
  // level — happens when many comps share a single locality centroid and
  // the resulting bounds rectangle is near-zero, so Google zooms to ~22
  // (max). At that zoom Bengaluru tiles are sparse and the view looks
  // almost like ocean. Capping at 13 keeps the city visible.
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!isLoaded || !mapRef.current || fittedRef.current) return;
    if (mappable.length < 2) return;
    const bounds = new window.google.maps.LatLngBounds();
    for (const c of mappable) {
      bounds.extend({ lat: Number(c.lat), lng: Number(c.lng) });
    }
    const map = mapRef.current;
    map.fitBounds(bounds, 40);
    // Google fires `idle` once after fitBounds settles. Use a small
    // setTimeout instead of an `idle` listener so we don't pin a
    // listener that fires on every subsequent pan/zoom.
    setTimeout(() => {
      if (mapRef.current && (mapRef.current.getZoom?.() || 0) > 13) {
        mapRef.current.setZoom(13);
      }
    }, 250);
    fittedRef.current = true;
  }, [isLoaded, mappable]);

  // Pan to selection. 400ms native panTo matches the FRONTEND_GUIDELINES
  // map zoom/pan budget. Re-fits zoom to at least 14 so users can see
  // detail on the focused project.
  //
  // If the selected comp has NULL coords (unmapped basket / premium comp
  // that didn't match the geocode lookup), DON'T pan — the map stays in
  // its current position and the cluster popup state is reset so the
  // user isn't shown stale UI from a previous selection. Without this,
  // the map appears stuck on a previous locality with no visible link
  // to the row the user just clicked.
  useEffect(() => {
    if (!isLoaded || !mapRef.current || !selectedComp) return;
    const hasCoords = Number.isFinite(Number(selectedComp.lat))
                   && Number.isFinite(Number(selectedComp.lng));
    if (!hasCoords) {
      // Reset cluster popup so the user doesn't see leftover UI from a
      // previous comp's cluster. The map itself stays where it is — no
      // useful pan target exists for an ungeocoded row.
      setExpandedClusterKey(null);
      return;
    }
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
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-premium-soft border border-hairline mb-2.5">
            <AlertTriangle size={16} className="text-premium" />
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
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-neg-soft border border-hairline mb-2.5">
            <AlertTriangle size={16} className="text-data-negative" />
          </span>
          <p className="text-sm font-semibold text-content-primary mb-1.5">Could not load Google Maps</p>

          {realErrorMsg && (
            <div className="mt-2 mb-2.5 text-left">
              <p className="text-[10px] uppercase tracking-[0.1em] font-semibold text-content-muted mb-1">Error</p>
              <pre className="bg-bg-secondary border border-hairline rounded px-2.5 py-1.5 text-[11px] text-data-negative whitespace-pre-wrap leading-snug font-mono break-words">
                {realErrorMsg}
              </pre>
            </div>
          )}

          {authFailure?.host && (
            <p className="mb-2 text-[11px] text-content-muted">
              Rejected host: <code className="bg-bg-secondary px-1 py-0.5 rounded text-data-negative">{authFailure.host}</code>
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
      <Skeleton
        className="relative w-full rounded-editorial border border-hairline-strong overflow-hidden shadow-editorial"
        style={{ height }}
        ariaLabel="Loading map"
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
        {markerGroups.map((group) => {
          const isCluster = group.comps.length > 1;
          const expanded  = expandedClusterKey === group.key;
          if (!isCluster) {
            // Single-comp group renders the same way it always did — the
            // existing MarkerDot + tooltip pattern. No regression.
            const comp = group.comps[0];
            const isSel = comp.id === selectedCompId;
            return (
              <OverlayView
                key={group.key}
                position={{ lat: group.lat, lng: group.lng }}
                mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
              >
                <div className="relative">
                  <MarkerDot
                    comp={comp}
                    selected={isSel}
                    onClick={() => {
                      setExpandedClusterKey(null);
                      onSelectComp?.(comp.id);
                    }}
                    theme={theme}
                  />
                  {isSel && <MarkerTooltip comp={comp} />}
                </div>
              </OverlayView>
            );
          }
          // Multi-comp cluster — show count badge + optional list popup.
          return (
            <OverlayView
              key={group.key}
              position={{ lat: group.lat, lng: group.lng }}
              mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
            >
              <div className="relative">
                <ClusterMarker
                  count={group.comps.length}
                  dominantPalette={group.dominantPalette}
                  expanded={expanded}
                  onClick={() => setExpandedClusterKey(expanded ? null : group.key)}
                  theme={theme}
                />
                {expanded && (
                  <ClusterListPopup
                    comps={group.comps}
                    selectedCompId={selectedCompId}
                    onSelect={(id) => {
                      onSelectComp?.(id);
                      // Keep the popup open so the user can pick another
                      // adjacent project without re-clicking the cluster.
                    }}
                    onClose={() => setExpandedClusterKey(null)}
                  />
                )}
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
          <p className="mt-1.5 pt-1.5 border-t border-hairline text-[10px] text-premium flex items-center gap-1">
            <MapPin size={10} />
            <span className="tabular-nums">{ungeocodedCount}</span> row{ungeocodedCount === 1 ? '' : 's'} not geocoded
          </p>
        )}
      </div>

      {/* Selected-comp inset — bottom-left. Renders whenever a row/marker is
          pinned AND no cluster popup is open. For UNMAPPED comps (no
          coords), shows an "off-map" amber pill instead of the normal
          primary-tinted "Selected" pill — so the user knows the row they
          clicked exists in the dataset but doesn't have a geocoded
          location yet, instead of being confused by an unchanged map.
          Hidden while a cluster popup is open to avoid duplicate "you
          picked X" UI. */}
      {selectedComp && !expandedClusterKey && (
        <div
          className={[
            'absolute bottom-3 left-3 z-[5] max-w-[260px] rounded-editorial border bg-bg-elevated/95 backdrop-blur px-3 py-2 shadow-editorial transition-all duration-150 ease-out',
            selectedCompIsMapped ? 'border-accent' : 'border-hairline',
          ].join(' ')}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-1.5 mb-1">
            {selectedCompIsMapped ? (
              <Building2 size={12} className="text-accent" />
            ) : (
              <AlertTriangle size={12} className="text-premium" />
            )}
            <p className={`text-[10px] uppercase tracking-[0.12em] font-semibold ${selectedCompIsMapped ? 'text-accent' : 'text-premium'}`}>
              {selectedCompIsMapped ? 'Selected' : 'Selected · off-map'}
            </p>
          </div>
          <p className="text-sm font-semibold text-content-primary truncate" title={selectedComp.project_name}>
            {selectedComp.project_name}
          </p>
          <p className="text-xs text-content-secondary">
            {formatRate(selectedComp.rate_per_sqft)}
            {selectedComp.locality && <span> · {selectedComp.locality}</span>}
          </p>
          {/* Honest provenance (CLAUDE.md: never surface a comp without source +
              freshness + verified). Reuses the shared ProvenanceCell so the inset
              reads identically to the Comps table + exports. */}
          <div className="mt-1.5 pt-1.5 border-t border-hairline-soft">
            <ProvenanceCell comp={selectedComp} compact />
          </div>
          {!selectedCompIsMapped && (
            <p className="mt-1 pt-1 border-t border-hairline text-[10px] text-premium leading-snug">
              No coordinates on file for this row — it appears in the table but not on the map.
            </p>
          )}
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
