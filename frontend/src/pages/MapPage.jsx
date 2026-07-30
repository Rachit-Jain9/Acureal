import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Layers3,
  LocateFixed,
  MapPin,
  RefreshCw,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useProperties, useBulkGeocodeProperties } from '../hooks/useProperties';
import { useDeals } from '../hooks/useDeals';
import useAuthStore from '../store/authStore';
import { compsAPI } from '../services/api';
import Badge from '../components/common/Badge';
import PageHeader from '../components/common/PageHeader';
import MapCanvas from '../components/map/MapCanvas';
import {
  DEFAULT_VISIBLE_STAGES,
  PRECISE_GEOCODE_STATUSES,
  SEARCH_RADIUS_OPTIONS,
  STAGE_HEAT_META,
  ZONING_META,
  mapZoningToCompType,
  matchesSearch,
  normalizeComp,
  normalizeDeal,
  normalizeProperty,
} from '../components/map/mapConfig';
import { formatArea, formatCrores, formatINR } from '../utils/format';

function ToggleRow({ checked, label, description, onChange }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-hairline-strong bg-bg-elevated px-3 py-3/80">
      <div>
        <p className="text-sm font-medium text-content-primary">{label}</p>
        <p className="mt-0.5 text-xs text-content-secondary">{description}</p>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-1 h-4 w-4 rounded border-hairline-strong text-accent focus:ring-accent"
      />
    </label>
  );
}

export default function MapPage() {
  const { data: propertiesData, isLoading: propertiesLoading } = useProperties({ limit: 500 });
  // fields:'summary' → lightweight projection (no per-row DD/risk/approval
  // rollup subqueries or recommendation batch); the map reads only
  // lat/lng/stage/irr/revenue/propertyId.
  const { data: dealsData, isLoading: dealsLoading } = useDeals({ limit: 500, fields: 'summary' });
  const { user } = useAuthStore();
  const bulkGeocode = useBulkGeocodeProperties();
  const canGeocode = ['owner', 'admin', 'editor'].includes(user?.role);

  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('all');
  const [zoningFilter, setZoningFilter] = useState('all');
  const [selectedPropertyId, setSelectedPropertyId] = useState(null);
  const [fitVersion, setFitVersion] = useState(0);
  const [showClusters, setShowClusters] = useState(true);
  const [showNearbyComps, setShowNearbyComps] = useState(true);
  const [showDealHeat, setShowDealHeat] = useState(true);
  const [nearbyRadiusKm, setNearbyRadiusKm] = useState(5);
  const [visibleStages, setVisibleStages] = useState(DEFAULT_VISIBLE_STAGES);

  const rawProperties = propertiesData?.properties ?? propertiesData?.data ?? [];
  const rawDeals = dealsData?.data ?? [];

  const normalizedProperties = useMemo(
    () => rawProperties.map(normalizeProperty),
    [rawProperties]
  );

  const normalizedDeals = useMemo(
    () => rawDeals.map(normalizeDeal),
    [rawDeals]
  );

  const preciseProperties = useMemo(
    () =>
      normalizedProperties.filter((property) => property.isPreciseLocation),
    [normalizedProperties]
  );

  const reviewQueueProperties = useMemo(
    () => normalizedProperties.filter((property) => !property.isPreciseLocation),
    [normalizedProperties]
  );

  const cityOptions = useMemo(
    () => [...new Set(preciseProperties.map((property) => property.city).filter(Boolean))].sort(),
    [preciseProperties]
  );

  const filteredProperties = useMemo(
    () =>
      preciseProperties.filter((property) => {
        if (cityFilter !== 'all' && property.city !== cityFilter) {
          return false;
        }

        if (zoningFilter !== 'all' && property.zoning !== zoningFilter) {
          return false;
        }

        return matchesSearch(property, search);
      }),
    [cityFilter, preciseProperties, search, zoningFilter]
  );

  const filteredPropertyIds = useMemo(
    () => new Set(filteredProperties.map((property) => property.id)),
    [filteredProperties]
  );

  const selectedProperty = filteredProperties.find((property) => property.id === selectedPropertyId) || null;

  useEffect(() => {
    if (selectedPropertyId && !filteredProperties.some((property) => property.id === selectedPropertyId)) {
      setSelectedPropertyId(null);
    }
  }, [filteredProperties, selectedPropertyId]);

  const nearbyCompProjectType = selectedProperty ? mapZoningToCompType(selectedProperty.zoning) : null;

  const { data: nearbyCompsResponse, isFetching: nearbyCompsLoading } = useQuery({
    queryKey: ['map-nearby-comps', selectedProperty?.id, nearbyRadiusKm, nearbyCompProjectType],
    enabled: showNearbyComps && !!selectedProperty,
    queryFn: () =>
      compsAPI.nearby({
        lat: selectedProperty.lat,
        lng: selectedProperty.lng,
        radius: nearbyRadiusKm,
        projectType: nearbyCompProjectType,
      }).then((response) => response.data.data || []),
  });

  const { data: nearbyBenchmarksResponse, isFetching: nearbyBenchmarksLoading } = useQuery({
    queryKey: ['map-comp-benchmarks', selectedProperty?.id, nearbyRadiusKm, nearbyCompProjectType],
    enabled: showNearbyComps && !!selectedProperty,
    queryFn: () =>
      compsAPI.benchmarks({
        lat: selectedProperty.lat,
        lng: selectedProperty.lng,
        radius: nearbyRadiusKm,
        projectType: nearbyCompProjectType,
      }).then((response) => response.data.data || null),
  });

  const nearbyComps = useMemo(
    () =>
      (nearbyCompsResponse || [])
        .map(normalizeComp)
        .filter((comp) => Number.isFinite(comp.lat) && Number.isFinite(comp.lng)),
    [nearbyCompsResponse]
  );

  const visibleDeals = useMemo(
    () =>
      normalizedDeals.filter(
        (deal) =>
          filteredPropertyIds.has(deal.propertyId) &&
          Number.isFinite(deal.lat) &&
          Number.isFinite(deal.lng)
      ),
    [filteredPropertyIds, normalizedDeals]
  );

  const heatLayers = useMemo(() => {
    const grouped = new Map();

    for (const deal of visibleDeals) {
      if (!visibleStages[deal.stage]) {
        continue;
      }

      const key = `${deal.propertyId}:${deal.stage}`;
      const current = grouped.get(key) || {
        id: key,
        propertyName: deal.property_name || deal.propertyName,
        city: deal.city,
        stage: deal.stage,
        lat: deal.lat,
        lng: deal.lng,
        count: 0,
        totalRevenueCr: 0,
        irrAccumulator: 0,
      };

      current.count += 1;
      current.totalRevenueCr += Number.isFinite(deal.totalRevenueCr) ? deal.totalRevenueCr : 0;
      current.irrAccumulator += Number.isFinite(deal.irrPct) ? deal.irrPct : 0;
      grouped.set(key, current);
    }

    return Array.from(grouped.values()).map((layer) => ({
      ...layer,
      avgIrrPct: layer.count > 0 ? layer.irrAccumulator / layer.count : null,
      radiusMeters: 1800 + layer.count * 1800 + (STAGE_HEAT_META[layer.stage]?.radiusBoost || 0),
    }));
  }, [visibleDeals, visibleStages]);

  const totalLandArea = filteredProperties.reduce(
    (sum, property) => sum + (Number.isFinite(property.landAreaSqft) ? property.landAreaSqft : 0),
    0
  );

  const visibleDealValueCr = visibleDeals.reduce(
    (sum, deal) => sum + (Number.isFinite(deal.totalRevenueCr) ? deal.totalRevenueCr : 0),
    0
  );

  const cityCounts = filteredProperties.reduce((acc, property) => {
    if (property.city) {
      acc[property.city] = (acc[property.city] || 0) + 1;
    }
    return acc;
  }, {});

  const dominantCity = Object.entries(cityCounts).sort((a, b) => b[1] - a[1])[0] || null;
  const approximateCount = reviewQueueProperties.filter((property) => property.isApproximateLocation).length;
  const missingPinCount = reviewQueueProperties.filter((property) => !property.hasCoordinates).length;
  const reviewQueuePreview = reviewQueueProperties.slice(0, 6);

  const circleRateValues = filteredProperties
    .map((property) => property.circleRatePerSqft)
    .filter((value) => Number.isFinite(value) && value > 0);

  const averageCircleRate = circleRateValues.length > 0
    ? circleRateValues.reduce((sum, value) => sum + value, 0) / circleRateValues.length
    : null;

  const nearbyBenchmarks = nearbyBenchmarksResponse?.benchmarks || null;
  const mapIsLoading = propertiesLoading || dealsLoading;

  const toggleStageVisibility = (stage) => {
    setVisibleStages((current) => ({
      ...current,
      [stage]: !current[stage],
    }));
  };

  const resetFilters = () => {
    setSearch('');
    setCityFilter('all');
    setZoningFilter('all');
    setSelectedPropertyId(null);
    setNearbyRadiusKm(5);
    setShowClusters(true);
    setShowNearbyComps(true);
    setShowDealHeat(true);
    setVisibleStages(DEFAULT_VISIBLE_STAGES);
    setFitVersion((value) => value + 1);
  };

  const fitVisibleProperties = () => {
    setSelectedPropertyId(null);
    setFitVersion((value) => value + 1);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Map Intelligence"
        description="Explore clustered properties, stage-based deal heat, and nearby comparable overlays from one spatial control room."
      />

      <div className="grid grid-cols-1 xl:grid-cols-[390px_minmax(0,1fr)] gap-6">
        <aside className="card-editorial flex h-[calc(100vh-180px)] min-h-[720px] flex-col overflow-hidden">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-hairline bg-accent-soft px-3 py-4 dark:border-blue-900/60 dark:bg-blue-950/45">
              <p className="text-xs font-medium uppercase tracking-wide text-accent dark:text-accent">Visible Properties</p>
              <p className="mt-2 text-2xl font-semibold text-content-primary">{filteredProperties.length}</p>
            </div>
            <div className="rounded-xl border border-hairline bg-pos-soft px-3 py-4 dark:border-emerald-900/60 dark:bg-emerald-950/45">
              <p className="text-xs font-medium uppercase tracking-wide text-data-positive dark:text-data-positive">Visible Deals</p>
              <p className="mt-2 text-2xl font-semibold text-content-primary">{visibleDeals.length}</p>
            </div>
            <div className="rounded-xl border border-hairline bg-accent-soft px-3 py-4 dark:border-purple-900/60 dark:bg-purple-950/45">
              <p className="text-xs font-medium uppercase tracking-wide text-accent dark:text-accent">Cities</p>
              <p className="mt-2 text-2xl font-semibold text-content-primary">{Object.keys(cityCounts).length}</p>
            </div>
            <div className="rounded-xl border border-hairline bg-premium-soft px-3 py-4 dark:border-amber-900/60 dark:bg-amber-950/45">
              <p className="text-xs font-medium uppercase tracking-wide text-premium dark:text-premium">Pin Review</p>
              <p className="mt-2 text-2xl font-semibold text-content-primary">{reviewQueueProperties.length}</p>
            </div>
          </div>

          {reviewQueueProperties.length > 0 && (
            <div className="mt-5 rounded-2xl border border-hairline bg-premium-soft p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-premium">Precision Mode</p>
                  <h2 className="mt-2 text-base font-semibold text-premium">Only precise property pins appear on this map</h2>
                  <p className="mt-1 text-sm text-premium">
                    Acureal now excludes low-confidence locations from nearby comps and deal heat layers.
                    {approximateCount > 0 ? ` ${approximateCount} properties are approximate.` : ''}
                    {missingPinCount > 0 ? ` ${missingPinCount} still need coordinates.` : ''}
                  </p>
                </div>
                <div className="rounded-xl border border-hairline bg-white/80 px-3 py-2 text-right text-xs text-premium">
                  <p>Precise statuses</p>
                  <p className="mt-1 font-semibold">{Array.from(PRECISE_GEOCODE_STATUSES).join(' + ')}</p>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {reviewQueuePreview.map((property) => (
                  <Link
                    key={property.id}
                    to={`/dashboard/properties/${property.id}`}
                    className="flex items-center justify-between rounded-xl border border-hairline bg-bg-elevated px-3 py-3 transition hover:border-hairline-strong hover:bg-premium-soft"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-content-primary">{property.name}</p>
                      <p className="mt-0.5 truncate text-xs text-content-secondary">
                        {[property.city, property.state].filter(Boolean).join(', ') || 'Location incomplete'}
                      </p>
                    </div>
                    <span className="rounded-full bg-premium-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-premium">
                      {property.geocodeStatus?.replace(/_/g, ' ') || 'review'}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 rounded-2xl border border-hairline-strong bg-bg-secondary p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search property, city, survey, owner..."
                className="input pl-10"
              />
            </div>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select
                value={cityFilter}
                onChange={(event) => setCityFilter(event.target.value)}
                className="input"
              >
                <option value="all">All Cities</option>
                {cityOptions.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>

              <select
                value={zoningFilter}
                onChange={(event) => setZoningFilter(event.target.value)}
                className="input"
              >
                <option value="all">All Zoning</option>
                {Object.entries(ZONING_META).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={fitVisibleProperties} className="btn-secondary text-sm">
                <LocateFixed size={16} className="mr-2" />
                Fit Visible
              </button>
              <button type="button" onClick={resetFilters} className="btn-secondary text-sm">
                <RotateCcw size={16} className="mr-2" />
                Reset
              </button>
              {canGeocode && (
                <button
                  type="button"
                  disabled={bulkGeocode.isPending}
                  onClick={() => bulkGeocode.mutate()}
                  className="btn-secondary text-sm disabled:opacity-50"
                  title="Re-geocode all properties using saved address. Fixes wrong map pins."
                >
                  <RefreshCw size={16} className={`mr-2 ${bulkGeocode.isPending ? 'animate-spin' : ''}`} />
                  {bulkGeocode.isPending ? 'Re-geocoding…' : 'Fix All Pins'}
                </button>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 text-sm">
              <div className="rounded-xl bg-bg-elevated px-3 py-3">
                <p className="text-xs uppercase tracking-wide text-content-muted">Visible Land Bank</p>
                <p className="mt-1 font-semibold text-content-primary">{formatArea(totalLandArea)}</p>
              </div>
              <div className="rounded-xl bg-bg-elevated px-3 py-3">
                <p className="text-xs uppercase tracking-wide text-content-muted">Visible Deal Value</p>
                <p className="mt-1 font-semibold text-content-primary">{formatCrores(visibleDealValueCr)}</p>
              </div>
              <div className="rounded-xl bg-bg-elevated px-3 py-3">
                <p className="text-xs uppercase tracking-wide text-content-muted">Average Circle Rate</p>
                <p className="mt-1 font-semibold text-content-primary">
                  {averageCircleRate ? `${formatINR(averageCircleRate, 0)}/sqft` : '-'}
                </p>
              </div>
              <div className="rounded-xl bg-bg-elevated px-3 py-3">
                <p className="text-xs uppercase tracking-wide text-content-muted">Dominant City</p>
                <p className="mt-1 font-semibold text-content-primary">
                  {dominantCity ? `${dominantCity[0]} (${dominantCity[1]})` : '-'}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-hairline-strong bg-bg-secondary p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-content-primary">Smart Layers</h2>
                <p className="text-sm text-content-secondary">Turn overlays on and off depending on the story you want to see.</p>
              </div>
              <div className="rounded-xl bg-accent-soft p-2 text-accent">
                <Layers3 size={18} />
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <ToggleRow
                checked={showClusters}
                onChange={() => setShowClusters((value) => !value)}
                label="Property clustering"
                description="Automatically groups nearby properties at wider zoom levels."
              />
              <ToggleRow
                checked={showNearbyComps}
                onChange={() => setShowNearbyComps((value) => !value)}
                label="Nearby comps overlay"
                description="Shows comparable projects around the selected property."
              />
              <ToggleRow
                checked={showDealHeat}
                onChange={() => setShowDealHeat((value) => !value)}
                label="Deal-stage heat zones"
                description="Renders translucent stage-based influence zones using deal pipeline data."
              />
            </div>

            <div className="mt-4 rounded-xl bg-bg-elevated px-3 py-3">
              <p className="text-xs uppercase tracking-wide text-content-muted">Nearby Comp Radius</p>
              <p className="mt-1 text-sm text-content-secondary">
                {selectedProperty ? 'Adjust the search area for the selected property.' : 'Select a property to activate nearby comps.'}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {SEARCH_RADIUS_OPTIONS.map((radius) => (
                  <button
                    key={radius}
                    type="button"
                    onClick={() => setNearbyRadiusKm(radius)}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                      nearbyRadiusKm === radius
                        ? 'bg-accent text-white'
                        : 'bg-bg-secondary text-content-secondary hover:brightness-95'
                    }`}
                  >
                    {radius} km
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-xl bg-bg-elevated px-3 py-3">
              <p className="text-xs uppercase tracking-wide text-content-muted">Stage Heat Filters</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(STAGE_HEAT_META).map(([stage, meta]) => (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => setVisibleStages((current) => ({ ...current, [stage]: !current[stage] }))}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
                      visibleStages[stage]
                        ? 'border-transparent bg-bg-primary text-white'
                        : 'border-hairline-strong bg-bg-elevated text-content-secondary'
                    }`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                    {meta.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-hairline-strong bg-bg-secondary p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-content-primary">Selected Property</h2>
                <p className="text-sm text-content-secondary">Focus one property to unlock nearby comps and pricing context.</p>
              </div>
              <div className="rounded-xl bg-accent-soft p-2 text-accent">
                <MapPin size={18} />
              </div>
            </div>

            {selectedProperty ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl bg-bg-elevated px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-content-primary">{selectedProperty.name}</p>
                      <p className="mt-1 text-sm text-content-secondary">{selectedProperty.city}, {selectedProperty.state}</p>
                    </div>
                    <Badge className={(ZONING_META[selectedProperty.zoning] || ZONING_META.residential).badgeClass}>
                      {(ZONING_META[selectedProperty.zoning] || ZONING_META.residential).label}
                    </Badge>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-content-muted">Area</p>
                      <p className="mt-1 font-medium text-content-primary">{formatArea(selectedProperty.landAreaSqft)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-content-muted">Circle Rate</p>
                      <p className="mt-1 font-medium text-content-primary">
                        {selectedProperty.circleRatePerSqft ? `${formatINR(selectedProperty.circleRatePerSqft, 0)}/sqft` : '-'}
                      </p>
                    </div>
                  </div>

                  <Link
                    to={`/dashboard/properties/${selectedProperty.id}`}
                    className="mt-3 inline-flex text-sm font-medium text-accent hover:text-accent-hover"
                  >
                    Open property detail
                  </Link>
                </div>

                <div className="rounded-xl bg-bg-elevated px-3 py-3">
                  <p className="text-xs uppercase tracking-wide text-content-muted">Nearby Comp Benchmarks</p>
                  {showNearbyComps ? (
                    nearbyBenchmarksLoading ? (
                      <p className="mt-2 text-sm text-content-secondary">Loading comp benchmarks...</p>
                    ) : nearbyBenchmarksResponse?.found ? (
                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-content-muted">Median Rate</p>
                          <p className="mt-1 font-medium text-content-primary">
                            {formatINR(nearbyBenchmarks.median_rate_per_sqft, 0)}/sqft
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-content-muted">Comp Count</p>
                          <p className="mt-1 font-medium text-content-primary">{nearbyBenchmarksResponse.count || nearbyComps.length}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-content-muted">P25-P75 Band</p>
                          <p className="mt-1 font-medium text-content-primary">
                            {formatINR(nearbyBenchmarks.p25_rate_per_sqft, 0)} - {formatINR(nearbyBenchmarks.p75_rate_per_sqft, 0)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-content-muted">Search Radius</p>
                          <p className="mt-1 font-medium text-content-primary">{nearbyBenchmarksResponse.radius_km || nearbyRadiusKm} km</p>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-content-secondary">No comparable projects found near this property yet.</p>
                    )
                  ) : (
                    <p className="mt-2 text-sm text-content-secondary">Enable the nearby comp overlay to see pricing benchmarks.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-hairline-strong px-4 py-8 text-center">
                <p className="text-sm font-medium text-content-secondary">Select a property from the list or the map.</p>
                <p className="mt-1 text-sm text-content-secondary">That will focus the map, draw the land coverage ring, and unlock nearby comps.</p>
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-content-primary">Mapped Properties</h2>
              <p className="text-sm text-content-secondary">Click a card to focus it on the map and activate overlays.</p>
            </div>
          </div>

          <div className="mt-4 flex-1 overflow-y-auto pr-1">
            {filteredProperties.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-hairline-strong px-4 py-10 text-center">
                <p className="text-sm font-medium text-content-secondary">No properties match these filters.</p>
                <p className="mt-1 text-sm text-content-secondary">Try clearing search or widening your city and zoning filters.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredProperties.map((property) => {
                  const zoningMeta = ZONING_META[property.zoning] || ZONING_META.residential;
                  const isSelected = property.id === selectedPropertyId;

                  return (
                    <div
                      key={property.id}
                      className={`rounded-2xl border px-4 py-4 transition ${
                        isSelected
                          ? 'border-accent bg-accent-soft shadow-sm'
                          : 'border-hairline-strong bg-bg-elevated hover:border-hairline-strong hover:shadow-sm'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedPropertyId(property.id)}
                        className="w-full text-left"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-content-primary">{property.name}</p>
                            <p className="mt-1 text-sm text-content-secondary">{property.city}, {property.state}</p>
                          </div>
                          <Badge className={zoningMeta.badgeClass}>{zoningMeta.label}</Badge>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-content-muted">Area</p>
                            <p className="mt-1 font-medium text-content-primary">{formatArea(property.landAreaSqft)}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-content-muted">Circle Rate</p>
                            <p className="mt-1 font-medium text-content-primary">
                              {property.circleRatePerSqft ? formatINR(property.circleRatePerSqft, 0) : '-'}
                            </p>
                          </div>
                        </div>
                      </button>

                      <div className="mt-3 flex items-center justify-between text-sm">
                        <button
                          type="button"
                          onClick={() => setSelectedPropertyId(property.id)}
                          className="inline-flex items-center gap-1 text-content-secondary hover:text-content-primary"
                        >
                          <MapPin size={14} />
                          Focus on map
                        </button>
                        <Link
                          to={`/dashboard/properties/${property.id}`}
                          className="font-medium text-accent hover:text-accent-hover"
                        >
                          Open detail
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <section className="card-editorial overflow-hidden p-0">
          <MapCanvas
            properties={filteredProperties}
            selectedProperty={selectedProperty}
            setSelectedPropertyId={setSelectedPropertyId}
            fitVersion={fitVersion}
            mapIsLoading={mapIsLoading}
            showClusters={showClusters}
            showNearbyComps={showNearbyComps}
            nearbyComps={nearbyComps}
            nearbyRadiusKm={nearbyRadiusKm}
            showDealHeat={showDealHeat}
            heatLayers={heatLayers}
            visibleStages={visibleStages}
            nearbyCompsLoading={nearbyCompsLoading}
          />
        </section>
      </div>
    </div>
  );
}
