import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Briefcase, Building2, Layers3, MapPin } from 'lucide-react';
import LoadingSpinner from '../common/LoadingSpinner';
import Badge from '../common/Badge';
import {
  COMP_TYPE_META,
  DEFAULT_ZOOM,
  INDIA_CENTER,
  STAGE_HEAT_META,
  ZONING_META,
  getClusterRadius,
  getCoverageRadius,
  getMarkerRadius,
} from './mapConfig';
import { formatArea, formatCrores, formatINR, formatPct } from '../../utils/format';

function PropertyMarker({ property, isSelected, onSelectProperty }) {
  const zoningMeta = ZONING_META[property.zoning] || ZONING_META.residential;

  return (
    <Fragment>
      {isSelected && (
        <Circle
          center={[property.lat, property.lng]}
          radius={getCoverageRadius(property.landAreaSqft)}
          pathOptions={{
            color: zoningMeta.color,
            fillColor: zoningMeta.color,
            fillOpacity: 0.08,
            weight: 2,
          }}
        />
      )}

      <CircleMarker
        center={[property.lat, property.lng]}
        radius={getMarkerRadius(property.landAreaSqft) + (isSelected ? 4 : 0)}
        pathOptions={{
          color: isSelected ? '#0f172a' : (property.geocode_status === 'approximate' ? '#f59e0b' : '#ffffff'),
          weight: isSelected ? 3 : 2,
          fillColor: zoningMeta.color,
          fillOpacity: isSelected ? 1 : 0.9,
        }}
        eventHandlers={{ click: () => onSelectProperty(property.id) }}
      >
        <Tooltip direction="top" offset={[0, -8]} opacity={1}>
          <div className="space-y-0.5">
            <p className="text-sm font-semibold">{property.name}</p>
            <p className="text-xs text-gray-500">{property.city}, {property.state}</p>
            {property.geocode_status === 'approximate' && (
              <p className="text-xs text-amber-600">⚠ Approximate location</p>
            )}
          </div>
        </Tooltip>

        <Popup minWidth={280}>
          <div className="space-y-3">
            <div>
              <p className="text-base font-semibold text-gray-900">{property.name}</p>
              <p className="text-sm text-gray-500">{property.address}</p>
            </div>
            {property.geocode_status === 'approximate' && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                ⚠ Location is approximate — the pin may not reflect the exact site. Enter a precise address and re-geocode from the{' '}
                <Link to={`/properties/${property.id}`} className="underline font-medium">property page</Link>.
              </div>
            )}

            <div className="flex items-center gap-2">
              <Badge className={zoningMeta.badgeClass}>{zoningMeta.label}</Badge>
              {property.city && <span className="text-xs font-medium text-gray-500">{property.city}</span>}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Area</p>
                <p className="mt-1 font-medium text-gray-900">{formatArea(property.landAreaSqft)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Circle Rate</p>
                <p className="mt-1 font-medium text-gray-900">
                  {property.circleRatePerSqft ? `${formatINR(property.circleRatePerSqft, 0)}/sqft` : '-'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => onSelectProperty(property.id)}
                className="text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                Focus property
              </button>
              <Link
                to={`/properties/${property.id}`}
                className="text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                Open detail
              </Link>
            </div>
          </div>
        </Popup>
      </CircleMarker>
    </Fragment>
  );
}

function PropertyClusterLayer({ properties, selectedProperty, showClusters, onSelectProperty }) {
  const map = useMap();
  const [viewVersion, setViewVersion] = useState(0);

  useMapEvents({
    moveend: () => setViewVersion((value) => value + 1),
    zoomend: () => setViewVersion((value) => value + 1),
  });

  const clusterItems = useMemo(() => {
    if (!properties.length) {
      return [];
    }

    const zoom = map.getZoom();
    const bounds = map.getBounds().pad(0.3);
    const selectedId = selectedProperty?.id || null;
    const visibleProperties = properties.filter((property) => bounds.contains([property.lat, property.lng]));
    const selectedVisible = visibleProperties.find((property) => property.id === selectedId) || null;
    const candidates = visibleProperties.filter((property) => property.id !== selectedId);

    if (!showClusters || zoom >= 12 || candidates.length < 3) {
      return [
        ...candidates.map((property) => ({ type: 'property', property })),
        ...(selectedVisible ? [{ type: 'property', property: selectedVisible, selected: true }] : []),
      ];
    }

    const cellSize = zoom >= 10 ? 60 : zoom >= 8 ? 80 : 100;
    const buckets = new Map();

    for (const property of candidates) {
      const point = map.project([property.lat, property.lng], zoom);
      const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
      const bucket = buckets.get(key) || {
        latSum: 0,
        lngSum: 0,
        properties: [],
        zoningCount: {},
      };

      bucket.latSum += property.lat;
      bucket.lngSum += property.lng;
      bucket.properties.push(property);
      bucket.zoningCount[property.zoning] = (bucket.zoningCount[property.zoning] || 0) + 1;
      buckets.set(key, bucket);
    }

    const clustered = Array.from(buckets.values()).map((bucket) => {
      if (bucket.properties.length === 1) {
        return { type: 'property', property: bucket.properties[0] };
      }

      const dominantZoning = Object.entries(bucket.zoningCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'residential';
      return {
        type: 'cluster',
        count: bucket.properties.length,
        lat: bucket.latSum / bucket.properties.length,
        lng: bucket.lngSum / bucket.properties.length,
        dominantZoning,
        properties: bucket.properties.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
        bounds: L.latLngBounds(bucket.properties.map((property) => [property.lat, property.lng])),
      };
    });

    if (selectedVisible) {
      clustered.push({ type: 'property', property: selectedVisible, selected: true });
    }

    return clustered;
  }, [map, properties, selectedProperty, showClusters, viewVersion]);

  return clusterItems.map((item, index) => {
    if (item.type === 'property') {
      return (
        <PropertyMarker
          key={item.property.id}
          property={item.property}
          isSelected={item.property.id === selectedProperty?.id}
          onSelectProperty={onSelectProperty}
        />
      );
    }

    const clusterMeta = ZONING_META[item.dominantZoning] || ZONING_META.residential;

    return (
      <CircleMarker
        key={`cluster-${index}-${item.count}`}
        center={[item.lat, item.lng]}
        radius={getClusterRadius(item.count)}
        pathOptions={{
          color: '#ffffff',
          weight: 2,
          fillColor: clusterMeta.color,
          fillOpacity: 0.92,
        }}
        eventHandlers={{
          click: () => {
            map.fitBounds(item.bounds, { padding: [60, 60], maxZoom: Math.min(map.getZoom() + 3, 13) });
          },
        }}
      >
        <Tooltip direction="top" offset={[0, -8]} opacity={1}>
          <div className="space-y-0.5 text-center">
            <p className="text-sm font-semibold">{item.count} properties</p>
            <p className="text-xs text-gray-500">Click to expand cluster</p>
          </div>
        </Tooltip>

        <Popup minWidth={280}>
          <div className="space-y-3">
            <div>
              <p className="text-base font-semibold text-gray-900">{item.count} clustered properties</p>
              <p className="text-sm text-gray-500">Dominant zoning: {clusterMeta.label}</p>
            </div>

            <div className="max-h-40 space-y-2 overflow-y-auto">
              {item.properties.map((property) => (
                <button
                  key={property.id}
                  type="button"
                  onClick={() => onSelectProperty(property.id)}
                  className="flex w-full items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-left hover:bg-gray-100"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{property.name}</p>
                    <p className="text-xs text-gray-500">{property.city}</p>
                  </div>
                  <span className="text-xs font-medium text-primary-600">Focus</span>
                </button>
              ))}
            </div>
          </div>
        </Popup>
      </CircleMarker>
    );
  });
}

function MapViewportController({ properties, selectedProperty, fitVersion }) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();
  }, [map]);

  useEffect(() => {
    if (!properties.length) {
      map.setView(INDIA_CENTER, DEFAULT_ZOOM, { animate: false });
      return;
    }

    if (selectedProperty) {
      map.flyTo([selectedProperty.lat, selectedProperty.lng], Math.max(map.getZoom(), 11), {
        animate: true,
        duration: 1.1,
      });
      return;
    }

    if (properties.length === 1) {
      map.flyTo([properties[0].lat, properties[0].lng], 11, {
        animate: true,
        duration: 1.1,
      });
      return;
    }

    const bounds = L.latLngBounds(properties.map((property) => [property.lat, property.lng]));
    map.fitBounds(bounds, {
      padding: [48, 48],
      maxZoom: 10,
      animate: fitVersion > 0,
    });
  }, [fitVersion, map, properties, selectedProperty]);

  return null;
}

export default function MapCanvas({
  properties,
  selectedProperty,
  setSelectedPropertyId,
  fitVersion,
  mapIsLoading,
  showClusters,
  showNearbyComps,
  nearbyComps,
  nearbyRadiusKm,
  showDealHeat,
  heatLayers,
  visibleStages,
  nearbyCompsLoading,
}) {
  return (
    <div className="relative h-[calc(100vh-180px)] min-h-[720px]">
      {mapIsLoading && (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-white/70">
          <div className="flex flex-col items-center gap-3">
            <LoadingSpinner />
            <span className="text-sm text-gray-500">Loading map intelligence...</span>
          </div>
        </div>
      )}

      <MapContainer
        center={INDIA_CENTER}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom
        zoomControl={false}
        className="h-full w-full z-0"
      >
        <ZoomControl position="bottomright" />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapViewportController
          properties={properties}
          selectedProperty={selectedProperty}
          fitVersion={fitVersion}
        />

        {showDealHeat && heatLayers.map((layer) => {
          const stageMeta = STAGE_HEAT_META[layer.stage] || STAGE_HEAT_META.screening;

          return (
            <Circle
              key={layer.id}
              center={[layer.lat, layer.lng]}
              radius={layer.radiusMeters}
              pathOptions={{
                color: stageMeta.color,
                fillColor: stageMeta.color,
                fillOpacity: Math.min(0.28, 0.08 + layer.count * 0.05),
                weight: 1.5,
              }}
            >
              <Popup minWidth={260}>
                <div className="space-y-3">
                  <div>
                    <p className="text-base font-semibold text-gray-900">{stageMeta.label} heat zone</p>
                    <p className="text-sm text-gray-500">{layer.propertyName || 'Mapped property'}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-400">Deals</p>
                      <p className="mt-1 font-medium text-gray-900">{layer.count}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-400">Value</p>
                      <p className="mt-1 font-medium text-gray-900">{formatCrores(layer.totalRevenueCr)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-400">Average IRR</p>
                      <p className="mt-1 font-medium text-gray-900">{formatPct(layer.avgIrrPct)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-400">Location</p>
                      <p className="mt-1 font-medium text-gray-900">{layer.city || '-'}</p>
                    </div>
                  </div>
                </div>
              </Popup>
            </Circle>
          );
        })}

        {selectedProperty && showNearbyComps && (
          <Circle
            center={[selectedProperty.lat, selectedProperty.lng]}
            radius={nearbyRadiusKm * 1000}
            pathOptions={{
              color: '#0f172a',
              dashArray: '8 8',
              fillColor: '#0f172a',
              fillOpacity: 0.02,
              weight: 1.5,
            }}
          />
        )}

        {showNearbyComps && nearbyComps.map((comp) => {
          const compMeta = COMP_TYPE_META[comp.projectType] || COMP_TYPE_META.residential;

          return (
            <CircleMarker
              key={comp.id}
              center={[comp.lat, comp.lng]}
              radius={7}
              pathOptions={{
                color: '#ffffff',
                weight: 1.5,
                fillColor: compMeta.color,
                fillOpacity: 0.95,
              }}
            >
              <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold">{comp.project_name}</p>
                  <p className="text-xs text-gray-500">
                    {comp.distanceKm ? `${comp.distanceKm.toFixed(2)} km away` : comp.city}
                  </p>
                </div>
              </Tooltip>

              <Popup minWidth={260}>
                <div className="space-y-3">
                  <div>
                    <p className="text-base font-semibold text-gray-900">{comp.project_name}</p>
                    <p className="text-sm text-gray-500">
                      {[comp.locality, comp.city].filter(Boolean).join(', ') || 'Comparable project'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge className={compMeta.badgeClass}>{compMeta.label}</Badge>
                    <span className="text-xs font-medium text-gray-500">
                      {comp.distanceKm ? `${comp.distanceKm.toFixed(2)} km away` : 'Distance unavailable'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-400">Rate</p>
                      <p className="mt-1 font-medium text-gray-900">
                        {comp.ratePerSqft ? `${formatINR(comp.ratePerSqft, 0)}/sqft` : '-'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-400">Launch</p>
                      <p className="mt-1 font-medium text-gray-900">{comp.launch_year || '-'}</p>
                    </div>
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        <PropertyClusterLayer
          properties={properties}
          selectedProperty={selectedProperty}
          showClusters={showClusters}
          onSelectProperty={setSelectedPropertyId}
        />
      </MapContainer>

      <div className="pointer-events-none absolute left-4 top-4 z-[1000] max-w-sm rounded-2xl bg-white/95 p-4 shadow-lg ring-1 ring-black/5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary-50 p-2 text-primary-600">
            <Layers3 size={18} />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Spatial Control Room</p>
            {selectedProperty ? (
              <>
                <p className="mt-1 font-semibold text-gray-900">{selectedProperty.name}</p>
                <p className="text-sm text-gray-500">{selectedProperty.city}, {selectedProperty.state}</p>
                <p className="mt-2 text-sm text-gray-600">
                  Property focus, nearby comps, and stage heat layers are now centered on the same land parcel.
                </p>
              </>
            ) : (
              <>
                <p className="mt-1 font-semibold text-gray-900">Use the map like an intelligence layer</p>
                <p className="text-sm text-gray-600">
                  Filter by city or zoning, zoom into clusters, then focus a property to unlock comparable and pipeline context around it.
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="absolute bottom-4 left-4 z-[1000] flex flex-wrap items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
        <span className="inline-flex items-center gap-2">
          <Building2 size={15} />
          {properties.length} properties
        </span>
        <span className="inline-flex items-center gap-2">
          <Briefcase size={15} />
          {heatLayers.reduce((sum, layer) => sum + layer.count, 0)} mapped deals
        </span>
        <span className="inline-flex items-center gap-2">
          <MapPin size={15} />
          {showNearbyComps ? `${nearbyComps.length} nearby comps` : 'Nearby comps hidden'}
        </span>
      </div>

      <div className="absolute bottom-16 right-4 z-[1000] max-w-sm rounded-2xl bg-white/95 p-4 shadow-lg ring-1 ring-black/5">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Heat Layer Legend</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(STAGE_HEAT_META)
            .filter(([stage]) => visibleStages[stage])
            .map(([stage, meta]) => (
              <span
                key={stage}
                className="inline-flex items-center gap-2 rounded-full bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                {meta.label}
              </span>
            ))}
        </div>
      </div>

      {selectedProperty && showNearbyComps && (
        <div className="absolute right-4 top-4 z-[1000] max-w-sm rounded-2xl bg-white/95 p-4 shadow-lg ring-1 ring-black/5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Nearby Comp Snapshot</p>
          {nearbyCompsLoading ? (
            <p className="mt-2 text-sm text-gray-500">Loading nearby comps...</p>
          ) : nearbyComps.length > 0 ? (
            <div className="mt-2 space-y-2">
              {nearbyComps.slice(0, 3).map((comp) => (
                <div key={comp.id} className="rounded-xl bg-gray-50 px-3 py-2">
                  <p className="text-sm font-medium text-gray-900">{comp.project_name}</p>
                  <p className="text-xs text-gray-500">
                    {comp.distanceKm ? `${comp.distanceKm.toFixed(2)} km` : comp.city}
                    {comp.ratePerSqft ? ` • ${formatINR(comp.ratePerSqft, 0)}/sqft` : ''}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-500">No nearby comps available within {nearbyRadiusKm} km.</p>
          )}
        </div>
      )}
    </div>
  );
}
