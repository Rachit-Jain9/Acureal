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
 * @param {string}  input.geocodeStatus        the pin's geocode status
 * @returns {Array<object>} ordered layer descriptors (basemap, boundary,
 *          zoning, pin) — never null; always four entries.
 */
export function buildCadastralLayers({
  basemap = 'streets',
  hasBoundary = false,
  boundaryApproximate = false,
  zoning = {},
  geocodeStatus = null,
} = {}) {
  return [
    basemapLayer(basemap),
    boundaryLayer(!!hasBoundary, !!boundaryApproximate),
    zoningLayer(zoning || {}),
    pinLayer(geocodeStatus),
  ];
}

export default buildCadastralLayers;
