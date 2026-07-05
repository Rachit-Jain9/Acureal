import { useMemo, useRef, useState } from 'react';
import {
  CircleMarker,
  MapContainer,
  Pane,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { Link } from 'react-router-dom';
import {
  Search, Layers, Crosshair, MapPin, X as XIcon, ExternalLink, Info, Landmark,
} from 'lucide-react';
import clsx from 'clsx';
import 'leaflet/dist/leaflet.css';
import { useQuery } from '@tanstack/react-query';
import { dealsAPI, propertiesAPI, masterPlanAPI } from '../../services/api';
import { toast } from '../common/Toast';
import {
  isInRmp2015Bounds,
  RMP2015_LEAFLET_BOUNDS,
  RMP2015_TILE_URL,
  DEFAULT_MASTER_PLAN_OPACITY,
  MASTER_PLAN_PROVENANCE,
  RMP2015_LANDUSE_LEGEND,
} from '../../utils/cadastralLayers';
import { getMarkerRadius, STAGE_HEAT_META } from '../map/mapConfig';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import MasterPlanLegend from './MasterPlanLegend';

// A truthful mini-chip for the overlay toggle: the four most common statutory
// land-use colours (residential, commercial, industrial, open space), pulled
// from the source-verified legend so it is never a decorative approximation.
const TOGGLE_CHIP_GRADIENT = (() => {
  const by = (code) => RMP2015_LANDUSE_LEGEND.find((g) => g.code === code)?.color;
  const [r, c, i, p] = [by('R'), by('C'), by('I'), by('P')];
  return `linear-gradient(135deg, ${r} 0 25%, ${c} 25% 50%, ${i} 50% 75%, ${p} 75% 100%)`;
})();

// Centre + extent of the BDA RMP 2015 raster (Map Warper layer 2147).
const BENGALURU_CENTER = [12.9716, 77.5946];
const EXPLORER_ZOOM = 12;

const BASEMAPS = {
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

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Imperatively fly the map when `target` changes (search result / locate).
function FlyTo({ target }) {
  const map = useMap();
  const lastRef = useRef(null);
  if (target && target !== lastRef.current) {
    lastRef.current = target;
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    map.flyTo([target.lat, target.lng], target.zoom || 16, {
      duration: reduce ? 0 : 0.4,
    });
  }
  return null;
}

// Click anywhere on the map (not a marker) → surface the deterministic
// regulatory context for that point.
function MapClickCapture({ onPick }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

// The deterministic regulatory-context drawer. Pure: bbox coverage + the known
// operative-plan fact for the BDA LPA + an honest next-step. No AI, no fabricated
// zoning — the exact zone/FAR comes from linking a property (the deterministic
// kernel), which this points to.
function ContextDrawer({ selected, onClose }) {
  // Hook must run unconditionally (no-ops when inactive); guard comes after.
  const trapRef = useFocusTrap(!!selected, { onEscape: onClose });
  if (!selected) return null;
  const isDeal = selected.kind === 'deal';
  const lat = toNum(selected.lat);
  const lng = toNum(selected.lng);
  const inBounds = lat !== null && lng !== null && isInRmp2015Bounds(lat, lng);

  return (
    // Anchored bottom-left so it never overlaps the controls (top-right) or the
    // search (top-left); a focus-trapped, Escape-closable dialog.
    <div
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mp-context-title"
      className="absolute bottom-3 left-3 z-[1200] max-h-[58vh] w-[300px] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-editorial border border-hairline bg-bg-elevated shadow-lg"
    >
      <div className="flex items-start justify-between gap-2 border-b border-hairline-soft px-3.5 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-content-muted">
            {isDeal ? 'Deal' : 'Map point'}
          </p>
          <h3 id="mp-context-title" className="truncate text-sm font-semibold text-content-primary">
            {isDeal ? (selected.name || 'Untitled deal') : 'Regulatory context'}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded p-1 text-content-muted transition-colors hover:bg-bg-secondary hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <XIcon size={14} />
        </button>
      </div>

      <div className="space-y-3 px-3.5 py-3">
        {lat !== null && lng !== null && (
          <p className="font-mono text-[11px] tabular-nums text-content-muted">
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </p>
        )}

        {/* Coverage — the one fact we know deterministically at any point. */}
        <div
          className={clsx(
            'rounded-md border px-2.5 py-2',
            inBounds
              ? 'border-hairline bg-premium-soft text-premium'
              : 'border-hairline bg-bg-secondary text-content-secondary',
          )}
        >
          <p className="text-[11px] font-semibold">
            {inBounds ? 'Inside the RMP 2015 mapped area' : 'Outside the RMP 2015 mapped area'}
          </p>
          <p className="mt-1 text-[11px] leading-snug">
            {inBounds
              ? 'This falls within the BDA Local Planning Area. The operative plan here is the BDA Revised Master Plan 2015 — the land-use overlay shows its proposed zoning (reference; verify against the official sheet).'
              : 'This is outside the BDA RMP 2015 extent — a different Planning Authority governs (e.g. Anekal LPA to the south). Link a property here to resolve the exact authority.'}
          </p>
        </div>

        {isDeal ? (
          <>
            {selected.stage && (
              <p className="text-[11px] text-content-secondary">
                Stage: <span className="font-medium text-content-primary">{String(selected.stage).replace(/_/g, ' ')}</span>
              </p>
            )}
            <Link
              to={`/dashboard/deals/${selected.id}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Open deal — Zoning & Parcel <ExternalLink size={11} />
            </Link>
            <p className="text-[10px] leading-snug text-content-muted">
              The deal's Parcel and Regulatory / Zoning tabs carry its deterministically resolved authority, plan, zone, FAR and guidance — with source + confidence.
            </p>
          </>
        ) : (
          <p className="text-[10px] leading-snug text-content-muted">
            <span className="font-medium text-content-secondary">Next step:</span> link a property at this point to run full parcel intelligence — jurisdiction → zone → FAR → confidence, each cited to source.
          </p>
        )}
      </div>
    </div>
  );
}

// Regulatory coverage — the operative authorities REDIP holds a rulebook for.
// Makes the RMP-2015-only land-use overlay read as ONE layer of a deliberate,
// multi-authority system rather than "coverage stops at the city". Honest: only
// RMP 2015 has a georeferenced map overlay; the LPA rulebooks apply per-deal.
// Data-driven (self-updating as new LPAs are seeded); renders nothing until loaded.
function RegulatoryCoveragePanel({ authorities }) {
  if (!authorities?.length) return null;
  return (
    <div className="shrink-0 overflow-hidden rounded-editorial border border-hairline bg-bg-elevated shadow-md">
      <div className="flex items-center gap-1.5 border-b border-hairline-soft px-3 py-2">
        <Landmark size={12} className="text-content-secondary" aria-hidden="true" />
        <span className="text-[11px] font-semibold text-content-primary">Regulatory coverage</span>
      </div>
      <ul className="divide-y divide-hairline-soft">
        {authorities.map((a) => (
          <li key={a.authority_code} className="px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-medium text-content-primary">
                {a.area || a.authority_name}
              </span>
              <span
                className={clsx(
                  'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.05em]',
                  a.has_map_overlay ? 'bg-accent-soft text-accent' : 'bg-premium-soft text-premium',
                )}
              >
                {a.has_map_overlay ? 'Map + rules' : 'Rules · on deals'}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[10px] text-content-muted">
              {(a.plan_code || a.plan_name || '').replace(/_/g, ' ')}
              {a.rules_loaded && (
                <span className="tabular-nums"> · {a.far_rules} rules · {a.zones} zones</span>
              )}
            </p>
          </li>
        ))}
      </ul>
      <p className="border-t border-hairline-soft px-3 py-2 text-[10px] leading-snug text-content-muted">
        <span className="font-medium text-content-secondary">Only RMP 2015 has a land-use map overlay</span>{' '}
        (shown here). Each LPA rulebook applies on its deals&apos; Parcel / Zoning tab; their map overlays are reference-pending.
      </p>
    </div>
  );
}

export default function MasterPlanExplorer() {
  const [basemap, setBasemap] = useState('satellite');
  const [mpEnabled, setMpEnabled] = useState(true);
  const [mpOpacity, setMpOpacity] = useState(DEFAULT_MASTER_PLAN_OPACITY + 0.05);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [flyTarget, setFlyTarget] = useState(null);

  // The user's deals as pins — `fields:'summary'` uses the lightweight
  // projection (lat/lng/land_area_sqft/name only), skipping the ~11 per-deal
  // correlated subqueries + the recommendation batch the full projection runs.
  // Matches the sibling MapPage. We only need coordinates to draw pins.
  const { data: dealsResp } = useQuery({
    queryKey: ['masterplan-explorer-deals'],
    queryFn: () => dealsAPI.list({ limit: 500, fields: 'summary' }),
    staleTime: 60_000,
  });

  // Regulatory coverage — the operative authorities REDIP holds a rulebook for.
  // Powers the "Regulatory coverage" panel so the RMP-2015-only overlay reads as
  // one layer of a broader system. Reference data → long staleTime.
  const { data: coverageResp } = useQuery({
    queryKey: ['masterplan-regulatory-coverage'],
    queryFn: () => masterPlanAPI.coverage(),
    staleTime: 300_000,
  });
  const coverageAuthorities =
    coverageResp?.data?.data?.authorities || coverageResp?.data?.authorities || [];

  const dealPins = useMemo(() => {
    const rows = dealsResp?.data?.data || dealsResp?.data || [];
    if (!Array.isArray(rows)) return [];
    return rows
      .map((d) => ({
        id: d.id,
        name: d.name || d.property_name,
        stage: d.stage,
        lat: toNum(d.lat),
        lng: toNum(d.lng),
        landAreaSqft: Number(d.land_area_sqft ?? 0),
      }))
      .filter((d) => d.lat !== null && d.lng !== null);
  }, [dealsResp]);

  const runSearch = async (e) => {
    e?.preventDefault?.();
    const q = search.trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const res = await propertiesAPI.autoDeriveContext({ address: q });
      const d = res?.data?.data || res?.data || {};
      const lat = toNum(d.coordinates?.lat ?? d.lat ?? d.geocode?.lat);
      const lng = toNum(d.coordinates?.lng ?? d.lng ?? d.geocode?.lng);
      if (lat === null || lng === null) {
        toast.error('Could not locate that address.');
        return;
      }
      setFlyTarget({ lat, lng, zoom: 16, t: Date.now() });
      setSelected({ kind: 'point', lat, lng });
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const base = BASEMAPS[basemap];

  return (
    <div className="relative h-full min-h-[460px] overflow-hidden rounded-editorial border border-hairline bg-bg-secondary">
      <MapContainer
        center={BENGALURU_CENTER}
        zoom={EXPLORER_ZOOM}
        scrollWheelZoom
        zoomControl
        attributionControl
        className="h-full w-full"
      >
        <TileLayer key={basemap} attribution={base.attribution} url={base.url} maxZoom={base.maxZoom} />

        <Pane name="masterPlanPane" style={{ zIndex: 350 }}>
          {mpEnabled && (
            <TileLayer
              key={`mp-${mpEnabled}`}
              pane="masterPlanPane"
              url={RMP2015_TILE_URL}
              opacity={mpOpacity}
              minZoom={9}
              maxZoom={19}
              bounds={RMP2015_LEAFLET_BOUNDS}
              attribution="RMP 2015 PLU — BDA / Map Warper (reference)"
            />
          )}
        </Pane>

        <MapClickCapture onPick={(pt) => setSelected({ kind: 'point', ...pt })} />
        <FlyTo target={flyTarget} />

        {dealPins.map((d) => {
          const stage = STAGE_HEAT_META[d.stage];
          const color = stage?.color || '#3b82f6';
          return (
            <CircleMarker
              key={d.id}
              center={[d.lat, d.lng]}
              radius={getMarkerRadius(d.landAreaSqft)}
              pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.6 }}
              eventHandlers={{ click: () => setSelected({ kind: 'deal', ...d }) }}
            >
              <Popup>{d.name || 'Deal'}</Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* Search — top-left. The whole pill rings on focus (the input keeps
          focus:outline-none so the global :focus-visible outline doesn't clash). */}
      <form
        onSubmit={runSearch}
        className="absolute left-3 top-3 z-[1000] flex items-center gap-1.5 rounded-editorial border border-hairline bg-bg-elevated px-2 py-1.5 shadow-md transition-shadow duration-[80ms] ease-out focus-within:ring-2 focus-within:ring-accent/40"
      >
        <Search size={13} className="text-content-muted" aria-hidden="true" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search address or locality…"
          aria-label="Search address or locality"
          className="w-44 bg-transparent text-[12px] text-content-primary placeholder:text-content-muted focus:outline-none sm:w-56"
        />
        <button
          type="submit"
          disabled={searching || !search.trim()}
          className="rounded bg-accent px-2 py-0.5 text-[11px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {searching ? '…' : 'Go'}
        </button>
      </form>

      {/* Controls + legend — top-right, a height-capped scrolling stack so the two
          cards never spill off the map. Always mounted (the drawer is anchored
          bottom-left) so the controls stay usable while inspecting a context. */}
      <div className="absolute right-3 top-3 z-[1000] flex max-h-[calc(100%-1.5rem)] w-60 max-w-[82vw] flex-col gap-2 overflow-y-auto">
        <div className="shrink-0 overflow-hidden rounded-editorial border border-hairline bg-bg-elevated shadow-md">
          <div className="flex items-center gap-1.5 border-b border-hairline-soft px-3 py-2">
            <Layers size={12} className="text-content-secondary" aria-hidden="true" />
            <span className="text-[11px] font-semibold text-content-primary">Master Plan Explorer</span>
          </div>
          <div className="space-y-2.5 px-3 py-2.5">
            {/* Basemap */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-content-secondary">Base map</span>
              <div role="tablist" aria-label="Base map" className="inline-flex rounded border border-hairline bg-bg-secondary p-0.5">
                {Object.entries(BASEMAPS).map(([key, b]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={basemap === key}
                    onClick={() => setBasemap(key)}
                    className={clsx(
                      'rounded px-2 py-0.5 text-[10px] font-medium transition-colors duration-150 ease-out',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97]',
                      basemap === key ? 'bg-bg-elevated text-content-primary shadow-sm' : 'text-content-secondary hover:text-content-primary',
                    )}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            {/* RMP overlay toggle */}
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-content-secondary">
                <span aria-hidden="true" className="h-3 w-3 rounded-sm border border-black/10" style={{ background: TOGGLE_CHIP_GRADIENT }} />
                RMP 2015 land use
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={mpEnabled}
                aria-label="Toggle RMP 2015 overlay"
                onClick={() => setMpEnabled((v) => !v)}
                className={clsx(
                  'relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  mpEnabled ? 'bg-accent' : 'bg-bg-secondary border border-hairline-strong',
                )}
              >
                <span className={clsx('absolute top-0.5 h-3 w-3 rounded-full bg-bg-elevated shadow-sm transition-transform duration-150 ease-out', mpEnabled ? 'translate-x-3.5' : 'translate-x-0.5')} />
              </button>
            </div>

            {/* Opacity */}
            {mpEnabled && (
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={mpOpacity}
                  aria-label="Overlay opacity"
                  onChange={(e) => setMpOpacity(Number(e.target.value))}
                  className="h-1 flex-1 cursor-pointer accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                />
                <span className="w-8 shrink-0 text-right text-[10px] font-medium tabular-nums text-content-muted">
                  {Math.round(mpOpacity * 100)}%
                </span>
              </div>
            )}

            {/* Provenance + reset view */}
            <p className="flex items-start gap-1 text-[10px] leading-snug text-content-muted">
              <Info size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
              {MASTER_PLAN_PROVENANCE}
            </p>
            <button
              type="button"
              onClick={() => setFlyTarget({ lat: BENGALURU_CENTER[0], lng: BENGALURU_CENTER[1], zoom: EXPLORER_ZOOM, t: Date.now() })}
              className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-bg-secondary px-2 py-1 text-[10px] font-medium text-content-secondary transition-colors hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <Crosshair size={11} /> Recenter on Bengaluru
            </button>
            {dealPins.length > 0 && (
              <p className="flex items-center gap-1.5 text-[10px] text-content-muted">
                <MapPin size={11} aria-hidden="true" /> {dealPins.length} deal{dealPins.length === 1 ? '' : 's'} on the map — click a pin for context
              </p>
            )}
          </div>
        </div>

        <RegulatoryCoveragePanel authorities={coverageAuthorities} />

        <MasterPlanLegend collapsible defaultOpen className="shrink-0" />
      </div>

      <ContextDrawer selected={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
