export const INDIA_CENTER = [20.5937, 78.9629];
export const DEFAULT_ZOOM = 5;
export const SEARCH_RADIUS_OPTIONS = [3, 5, 8, 12];
export const PRECISE_GEOCODE_STATUSES = new Set(['verified', 'manual']);

export const ZONING_META = {
  residential: {
    label: 'Residential',
    color: '#2563eb',
    badgeClass: 'bg-accent-soft text-accent',
  },
  commercial: {
    label: 'Commercial',
    color: '#f97316',
    badgeClass: 'bg-premium-soft text-premium',
  },
  mixed_use: {
    label: 'Mixed Use',
    color: '#8b5cf6',
    badgeClass: 'bg-accent-soft text-accent',
  },
  industrial: {
    label: 'Industrial',
    color: '#059669',
    badgeClass: 'bg-pos-soft text-data-positive',
  },
  agricultural: {
    label: 'Agricultural',
    color: '#65a30d',
    badgeClass: 'bg-pos-soft text-data-positive',
  },
};

export const COMP_TYPE_META = {
  residential: {
    label: 'Residential Comp',
    color: '#1d4ed8',
    badgeClass: 'bg-accent-soft text-accent',
  },
  commercial: {
    label: 'Commercial Comp',
    color: '#ea580c',
    badgeClass: 'bg-premium-soft text-premium',
  },
  mixed_use: {
    label: 'Mixed Use Comp',
    color: '#7c3aed',
    badgeClass: 'bg-accent-soft text-accent',
  },
};

export const STAGE_HEAT_META = {
  screening: { label: 'Screening', color: '#94a3b8', radiusBoost: 0 },
  site_visit: { label: 'Site Visit', color: '#38bdf8', radiusBoost: 300 },
  loi: { label: 'LOI', color: '#facc15', radiusBoost: 600 },
  underwriting: { label: 'Underwriting', color: '#a855f7', radiusBoost: 900 },
  active: { label: 'Active', color: '#22c55e', radiusBoost: 1200 },
  closed: { label: 'Closed', color: '#10b981', radiusBoost: 600 },
  dead: { label: 'Dead', color: '#ef4444', radiusBoost: 300 },
};

export const DEFAULT_VISIBLE_STAGES = {
  screening: true,
  site_visit: true,
  loi: true,
  underwriting: true,
  active: true,
  closed: false,
  dead: false,
};

const toFiniteNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const normalizeProperty = (property) => {
  const geocodeStatus = property.geocode_status || 'pending';
  const lat = toFiniteNumber(property.lat);
  const lng = toFiniteNumber(property.lng);
  const hasCoordinates = lat !== null && lng !== null;
  const isPreciseLocation = hasCoordinates && PRECISE_GEOCODE_STATUSES.has(geocodeStatus);

  return {
    ...property,
    id: property.id || property._id,
    name:
      property.display_name ||
      property.name ||
      property.address ||
      [property.city, property.state].filter(Boolean).join(', ') ||
      'Unnamed property',
    geocodeStatus,
    lat,
    lng,
    hasCoordinates,
    isPreciseLocation,
    isApproximateLocation: hasCoordinates && geocodeStatus === 'approximate',
    landAreaSqft: Number(property.land_area_sqft ?? property.landAreaSqft ?? 0),
    circleRatePerSqft: Number(property.circle_rate_per_sqft ?? property.circleRatePerSqft ?? 0),
    zoning: property.zoning || 'residential',
  };
};

export const normalizeDeal = (deal) => ({
  ...deal,
  id: deal.id || deal._id,
  propertyId: deal.property_id || deal.propertyId,
  lat: toFiniteNumber(deal.lat),
  lng: toFiniteNumber(deal.lng),
  totalRevenueCr: Number(deal.total_revenue_cr ?? 0),
  irrPct: Number(deal.irr_pct ?? 0),
});

export const normalizeComp = (comp) => ({
  ...comp,
  id: comp.id || comp._id,
  lat: toFiniteNumber(comp.lat),
  lng: toFiniteNumber(comp.lng),
  ratePerSqft: Number(comp.rate_per_sqft ?? 0),
  distanceKm: Number(comp.distance_km ?? 0),
  projectType: comp.project_type || 'residential',
});

export const mapZoningToCompType = (zoning) => {
  if (zoning === 'mixed_use') {
    return 'mixed_use';
  }

  if (zoning === 'commercial' || zoning === 'industrial') {
    return 'commercial';
  }

  return 'residential';
};

export const matchesSearch = (property, rawSearch) => {
  const search = rawSearch.trim().toLowerCase();
  if (!search) {
    return true;
  }

  return [
    property.name,
    property.address,
    property.city,
    property.state,
    property.owner_name,
    property.survey_number,
  ].some((field) => field?.toLowerCase().includes(search));
};

export const getMarkerRadius = (landAreaSqft) => {
  if (!Number.isFinite(landAreaSqft) || landAreaSqft <= 0) {
    return 9;
  }

  return Math.max(9, Math.min(22, 8 + Math.sqrt(landAreaSqft) / 85));
};

export const getCoverageRadius = (landAreaSqft) => {
  if (!Number.isFinite(landAreaSqft) || landAreaSqft <= 0) {
    return 350;
  }

  return Math.max(350, Math.min(2400, Math.sqrt(landAreaSqft) * 3));
};

export const getClusterRadius = (count) => Math.max(16, Math.min(28, 12 + count * 2.2));
