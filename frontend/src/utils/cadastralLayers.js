/**
 * Cadastral layer model — Workstream E1 (the spatial canvas).
 *
 * The deal map draws up to four things: a basemap, the K-GIS cadastral
 * parcel boundary, the Revised Master Plan zoning overlay, and the parcel
 * pin. This module turns the map's current state into an ordered, honest
 * descriptor of those layers — what each one is, whether it is drawn, and
 * where its data comes from — so the layer panel can present a single
 * legible legend instead of scattered, unlabelled toggle buttons.
 *
 * Pure and deterministic — no AI, no network. The honesty rules
 * (CLAUDE.md) live here: a boundary is only ever called "verified" when a
 * real K-GIS polygon exists; an absent overlay says so plainly; the data
 * source behind every layer is named, never implied.
 *
 * Swatch colours mirror exactly what ReadOnlyPropertyMap paints, so the
 * legend is a true key, not a decorative approximation.
 */

// Tile provenance — the two basemaps ReadOnlyPropertyMap can render.
const BASEMAP_PROVENANCE = {
  streets: 'OpenStreetMap street tiles',
  satellite: 'Esri World Imagery satellite tiles',
};

// Layer paint colours — kept in lockstep with ReadOnlyPropertyMap's
// GeoJSON / CircleMarker styles so the legend swatch is truthful.
export const LAYER_COLORS = {
  boundary: '#14b8a6', // GeoJSON fillColor for the cadastral polygon
  pin: '#3b82f6', // CircleMarker fillColor for the parcel pin
  // The RMP zoning overlay is an FSI heatmap — low → mid → high.
  zoning: ['#0ea5e9', '#f59e0b', '#9333ea'],
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ── Master-plan (RMP 2015) reference overlay ────────────────────────────────
// The georeferenced BDA Revised Master Plan 2015 Proposed-Land-Use raster,
// served same-origin via the tile proxy. It is a REFERENCE layer — community-
// georeferenced government maps, shown for orientation, never an authoritative
// zone determination (CLAUDE.md). Hence it is always toned `approximate`
// (amber), never `verified`, and its provenance carries the "verify" caveat.
export const MASTER_PLAN_PROVENANCE =
  'RMP 2015 Proposed Land Use — BDA base year 2007. Community-georeferenced reference (Map Warper); verify against the official sheet.';

// Coverage extent of the RMP 2015 raster (Map Warper layer 2147 / BDA LPA).
// Mirrors RMP2015_BBOX in backend/src/routes/masterPlanTiles.routes.js.
export const RMP2015_BBOX = { west: 77.379326, south: 12.743347, east: 77.859283, north: 13.190987 };

// Leaflet bounds form ([[south, west], [north, east]]) for the TileLayer.
export const RMP2015_LEAFLET_BOUNDS = [
  [RMP2015_BBOX.south, RMP2015_BBOX.west],
  [RMP2015_BBOX.north, RMP2015_BBOX.east],
];

export const DEFAULT_MASTER_PLAN_OPACITY = 0.6;

// Tile URL for the RMP 2015 raster. Loaded CLIENT-SIDE (the user's browser
// fetches the tiles from their own IP, which Map Warper serves) — Map Warper's
// community server blocks server-side / datacenter fetches, so the same-origin
// proxy (backend/src/routes/masterPlanTiles.routes.js) can't reach it from
// Vercel. The proxy + `MASTER_PLAN_RMP2015_TILE_BASE` remain the path for
// Acureal-self-hosted tiles: host them, then set `VITE_MASTER_PLAN_TILE_URL` to
// `/api/master-plan-tiles/rmp2015/{z}/{x}/{y}.png`. (Map Warper is allow-listed
// in vercel.json `img-src` for the direct load.)
//
// SELF-HOST TEMPORARILY PARKED (2026-06-22): the mirror Action uploaded 2,575
// tiles into Acureal's existing private Vercel Blob store ("redip-documents"; the
// mirror auto-flipped to private to match it). Those 2,575 one-time writes blew
// past the Hobby plan's 2,000 advanced-operations/month cap, so Vercel SUSPENDED
// the store — access auto-resumes 2026-07-22 (or immediately on a Pro upgrade).
// A suspended store serves nothing, so the same-origin proxy returned blank
// tiles and the overlay went dark. Until the store is live again we force the
// proven client-side Map Warper load so the overlay keeps working. (Documents
// are unaffected — the app reads/writes them from Supabase Storage, not Blob.)
// TO RE-ENABLE SELF-HOSTING once the store is live: confirm BLOB_READ_WRITE_TOKEN
// + MASTER_PLAN_RMP2015_TILE_BASE are set on the Vercel project, then un-comment
// the VITE_MASTER_PLAN_TILE_URL read below and redeploy.
export const RMP2015_TILE_URL =
  // (import.meta.env && import.meta.env.VITE_MASTER_PLAN_TILE_URL) ||
  'https://mapwarper.net/layers/tile/2147/{z}/{x}/{y}.png';

// ── RMP 2015 land-use colour key ────────────────────────────────────────────
// Transcribed from the OFFICIAL BDA source documents, not invented:
//   • Land-use zone classification (R, C, I, P&SP, T&T, PU, P, UC, AG) — BDA
//     "Zoning Regulations of Revised Master Plan 2015", Chapter 1.2.
//   • Swatch colours — sampled directly from the legend ("ZONING CLASSIFICATION")
//     printed on the BDA "Proposed Land Use Plans" Consolidated Map sheet.
// Both are published on the Karnataka open-data portal (opencity.in, dataset
// "BDA Revised Master Plan 2015"). It remains a REFERENCE key: the georeferenced
// overlay (Map Warper, base year 2007) can read more muted than the printed
// sheet, so the legend is always labelled "verify against the official sheet"
// — consistent with MASTER_PLAN_PROVENANCE and the no-fabricated-GIS-facts rule.
//
// Grouped by the nine statutory categories; sub-zones carry the map's finer
// shades so an analyst can read a specific colour off the raster.
export const RMP2015_LANDUSE_LEGEND = [
  {
    category: 'Residential',
    code: 'R',
    color: '#FBE496',
    subzones: [
      { label: 'Residential (Main)', color: '#F6F0C8' },
      { label: 'Residential (Mixed)', color: '#FBE496' },
    ],
  },
  {
    category: 'Commercial',
    code: 'C',
    color: '#6CC4EE',
    subzones: [
      { label: 'Commercial (Central)', color: '#6CC4EE' },
      { label: 'Commercial (Business)', color: '#C9E0F1' },
      { label: 'Commercial axes / Mutation corridor', color: '#31B5EE' },
    ],
  },
  {
    category: 'Industrial',
    code: 'I',
    color: '#C5A5CE',
    subzones: [
      { label: 'Industrial (General)', color: '#C5A5CE' },
      { label: 'Industrial (Hi-Tech)', color: '#DAD5EA' },
    ],
  },
  { category: 'Public & Semi-public', code: 'P&SP', color: '#E99996' },
  {
    category: 'Parks & Open Space',
    code: 'P',
    color: '#B1D34E',
    subzones: [
      { label: 'Parks, playgrounds, cemeteries', color: '#B1D34E' },
      { label: 'State forest', color: '#40A258' },
      { label: 'Valley', color: '#46B757' },
      { label: 'Lake / tank', color: '#CBEAF6' },
    ],
  },
  { category: 'Traffic & Transportation', code: 'T&T', color: '#A6ADB5' },
  { category: 'Public Utilities', code: 'PU', color: '#E1CFD1' },
  { category: 'Agricultural land', code: 'AG', color: '#D9ECE7' },
  { category: 'Unclassified', code: 'UC', color: '#D5D8DD' },
];

// One-line provenance for the legend itself (distinct from the raster's).
export const RMP2015_LEGEND_SOURCE =
  'Key from the official BDA RMP 2015 Proposed Land Use (Consolidated Map) legend + Zoning Regulations. Reference — the scanned overlay can read more muted; verify against the official sheet.';

// Pure point-in-bbox test — drives the honest "outside mapped area" state so a
// blank overlay is never mistaken for "no zoning here".
export function isInRmp2015Bounds(lat, lng) {
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
  return (
    la >= RMP2015_BBOX.south
    && la <= RMP2015_BBOX.north
    && lo >= RMP2015_BBOX.west
    && lo <= RMP2015_BBOX.east
  );
}

// Basemap — always present; the only "layer" with a sub-selection.
function basemapLayer(basemap) {
  const active = basemap === 'satellite' ? 'satellite' : 'streets';
  return {
    key: 'basemap',
    label: 'Base map',
    kind: 'basemap',
    active,
    options: [
      { value: 'streets', label: 'Streets' },
      { value: 'satellite', label: 'Satellite' },
    ],
    tone: 'muted',
    provenance: BASEMAP_PROVENANCE[active],
  };
}

// Cadastral boundary — drawn iff a parcel polygon is available. Never
// user-toggleable: it is present or it is honestly absent.
function boundaryLayer(hasBoundary, boundaryApproximate) {
  if (!hasBoundary) {
    return {
      key: 'boundary',
      label: 'Cadastral boundary',
      kind: 'data',
      drawn: false,
      status: 'unavailable',
      statusLabel: 'Not available',
      tone: 'muted',
      provenance: 'No K-GIS parcel polygon returned for this coordinate.',
      swatch: { type: 'solid', color: LAYER_COLORS.boundary },
    };
  }
  if (boundaryApproximate) {
    return {
      key: 'boundary',
      label: 'Cadastral boundary',
      kind: 'data',
      drawn: true,
      status: 'approximate',
      statusLabel: 'Approximate',
      tone: 'approximate',
      provenance: 'Approximate placeholder — not a surveyed parcel boundary.',
      swatch: { type: 'solid', color: LAYER_COLORS.boundary },
    };
  }
  return {
    key: 'boundary',
    label: 'Cadastral boundary',
    kind: 'data',
    drawn: true,
    status: 'verified',
    statusLabel: 'K-GIS atlas',
    tone: 'verified',
    provenance: 'K-GIS cadastral atlas parcel polygon — reference geometry.',
    swatch: { type: 'solid', color: LAYER_COLORS.boundary },
  };
}

// RMP zoning — a user-toggleable overlay. Its state reflects the
// lazy-loaded fetch: off, loading, errored, empty-for-this-area, or live.
function zoningLayer(zoning = {}) {
  const base = {
    key: 'zoning',
    label: 'RMP zoning',
    kind: 'overlay',
    enabled: !!zoning.enabled,
    swatch: { type: 'gradient', colors: LAYER_COLORS.zoning },
  };
  if (!zoning.enabled) {
    return {
      ...base,
      status: 'off',
      statusLabel: 'Off',
      tone: 'muted',
      provenance: 'Revised Master Plan zone polygons, FSI-shaded. Toggle to load.',
    };
  }
  if (zoning.loading) {
    return {
      ...base,
      status: 'loading',
      statusLabel: 'Loading…',
      tone: 'muted',
      provenance: 'Fetching Revised Master Plan zone geometry…',
    };
  }
  if (zoning.error) {
    return {
      ...base,
      status: 'error',
      statusLabel: 'Unavailable',
      tone: 'error',
      provenance: String(zoning.error),
    };
  }
  const count = num(zoning.featureCount);
  if (count === 0) {
    return {
      ...base,
      status: 'empty',
      statusLabel: 'No zones here',
      tone: 'muted',
      provenance: 'No RMP zone geometry has been uploaded for this area yet.',
    };
  }
  return {
    ...base,
    status: 'on',
    statusLabel: count === null ? 'On' : `${count} zone${count === 1 ? '' : 's'}`,
    tone: 'verified',
    provenance: 'Revised Master Plan zone polygons, shaded by permissible FSI.',
  };
}

// RMP 2015 land-use raster — a user-toggleable reference overlay with an
// opacity control. States: off / out-of-bounds / on. Never "verified".
function masterPlanLayer(mp = {}) {
  const opacity = num(mp.opacity);
  const base = {
    key: 'masterPlan',
    label: 'RMP 2015 land use',
    kind: 'overlay',
    enabled: !!mp.enabled,
    opacity: opacity === null ? DEFAULT_MASTER_PLAN_OPACITY : opacity,
    swatch: { type: 'raster' },
  };
  if (!mp.enabled) {
    return {
      ...base,
      status: 'off',
      statusLabel: 'Off',
      tone: 'muted',
      provenance: 'BDA RMP 2015 Proposed Land Use raster. Toggle to load (reference overlay).',
    };
  }
  if (mp.inBounds === false) {
    return {
      ...base,
      status: 'out_of_bounds',
      statusLabel: 'Outside mapped area',
      tone: 'approximate',
      provenance:
        'This location is outside the RMP 2015 mapped area (BDA LPA). See the Zoning tab for the governing authority.',
    };
  }
  return {
    ...base,
    status: 'on',
    statusLabel: 'Reference',
    tone: 'approximate', // amber — a reference overlay, never "verified"
    provenance: MASTER_PLAN_PROVENANCE,
  };
}

// Parcel pin — always drawn. Its trust state is the geocode status.
function pinLayer(geocodeStatus) {
  const status = String(geocodeStatus || '').toLowerCase();
  const base = {
    key: 'pin',
    label: 'Parcel pin',
    kind: 'marker',
    swatch: { type: 'solid', color: LAYER_COLORS.pin },
  };
  if (status === 'verified') {
    return {
      ...base,
      status: 'verified',
      statusLabel: 'Verified',
      tone: 'verified',
      provenance: 'Geocoded coordinate, verified.',
    };
  }
  if (status === 'manual') {
    return {
      ...base,
      status: 'verified',
      statusLabel: 'Manual pin',
      tone: 'verified',
      provenance: 'Coordinate set manually by an analyst.',
    };
  }
  if (status === 'approximate') {
    return {
      ...base,
      status: 'approximate',
      statusLabel: 'Approximate',
      tone: 'approximate',
      provenance: 'Approximate geocode — the pin may sit 100–300 m off the parcel.',
    };
  }
  return {
    ...base,
    status: 'plain',
    statusLabel: 'Geocoded',
    tone: 'muted',
    provenance: 'Geocoded coordinate.',
  };
}

/**
 * Build the ordered layer descriptor for the cadastral canvas.
 *
 * @param {object}  input
 * @param {string}  input.basemap              'streets' | 'satellite'
 * @param {boolean} input.hasBoundary          a parcel polygon is drawn
 * @param {boolean} input.boundaryApproximate  the polygon is a placeholder
 * @param {object}  input.zoning               { enabled, loading, error, featureCount }
 * @param {object}  input.masterPlan           { enabled, inBounds, opacity }
 * @param {string}  input.geocodeStatus        the pin's geocode status
 * @returns {Array<object>} ordered layer descriptors (basemap, boundary,
 *          zoning, master plan, pin) — never null; always five entries.
 */
export function buildCadastralLayers({
  basemap = 'streets',
  hasBoundary = false,
  boundaryApproximate = false,
  zoning = {},
  masterPlan = {},
  geocodeStatus = null,
} = {}) {
  return [
    basemapLayer(basemap),
    boundaryLayer(!!hasBoundary, !!boundaryApproximate),
    zoningLayer(zoning || {}),
    masterPlanLayer(masterPlan || {}),
    pinLayer(geocodeStatus),
  ];
}

export default buildCadastralLayers;
