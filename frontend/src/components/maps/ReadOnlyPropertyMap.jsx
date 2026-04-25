import { useMemo } from 'react';
import { CircleMarker, GeoJSON, MapContainer, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export default function ReadOnlyPropertyMap({
  lat,
  lng,
  title = 'Parcel reference point',
  geometryGeojson = null,
  heightClassName = 'h-72',
  zoom = 16,
}) {
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

  if (!center) {
    return null;
  }

  return (
    <div className={`${heightClassName} overflow-hidden rounded-editorial border border-hairline-strong bg-bg-secondary`}>
      <MapContainer
        key={`${center[0]}:${center[1]}:${zoom}`}
        center={center}
        zoom={zoom}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {geometry && (
          <GeoJSON
            data={geometry}
            style={{
              color: '#0f766e',
              weight: 2,
              fillColor: '#14b8a6',
              fillOpacity: 0.12,
            }}
          />
        )}
        <CircleMarker
          center={center}
          radius={8}
          pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.45 }}
        >
          <Popup>{title}</Popup>
        </CircleMarker>
      </MapContainer>
    </div>
  );
}
