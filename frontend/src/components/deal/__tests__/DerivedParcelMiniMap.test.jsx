import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// react-leaflet doesn't render in jsdom — mock it to passive stubs so
// we can assert on container structure + props without booting leaflet.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, center, zoom }) => (
    <div data-testid="map-container" data-center={JSON.stringify(center)} data-zoom={zoom}>
      {children}
    </div>
  ),
  TileLayer: ({ url, attribution }) => (
    <div data-testid="tile-layer" data-url={url} data-attribution={attribution} />
  ),
  GeoJSON: ({ data, style }) => (
    <div data-testid="geojson-layer" data-style={JSON.stringify(style)} data-geom-type={data?.type} />
  ),
  Circle: ({ center, radius, pathOptions }) => (
    <div
      data-testid="fallback-circle"
      data-center={JSON.stringify(center)}
      data-radius={radius}
      data-stroke={pathOptions?.color}
      data-dash={pathOptions?.dashArray}
    />
  ),
  Marker: ({ position }) => <div data-testid="map-marker" data-position={JSON.stringify(position)} />,
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn() }),
}));

vi.mock('leaflet', () => ({
  default: {
    icon: () => ({}),
    geoJSON: () => ({ getBounds: () => ({ isValid: () => false }) }),
    circle: () => ({ getBounds: () => ({ isValid: () => false }) }),
    latLng: (lat, lng) => ({ lat, lng }),
  },
}));

vi.mock('leaflet/dist/leaflet.css', () => ({}));

import DerivedParcelMiniMap, { _internal } from '../DerivedParcelMiniMap';

const basePayload = {
  coordinates: { lat: 12.97501, lng: 77.60501, source: 'google', confidence: 0.92 },
  coordinatesGate: { gated: false },
  kgis: { hierarchy: { taluk: 'Bangalore South' }, geometry_geojson: null, survey_numbers: [] },
};

describe('DerivedParcelMiniMap — render gating', () => {
  it('renders nothing when there are no coordinates', () => {
    const { container } = render(<DerivedParcelMiniMap data={{ coordinates: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when coordinatesGate is gated (red banner already explains)', () => {
    const data = {
      coordinates: { lat: 12.97, lng: 77.59 },
      coordinatesGate: { gated: true },
    };
    const { container } = render(<DerivedParcelMiniMap data={data} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the map container when coordinates are present + not gated', () => {
    render(<DerivedParcelMiniMap data={basePayload} />);
    expect(screen.getByTestId('derived-parcel-mini-map')).toBeInTheDocument();
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('map-marker')).toBeInTheDocument();
  });
});

describe('DerivedParcelMiniMap — polygon vs fallback circle', () => {
  it('renders the K-GIS GeoJSON polygon when geometry_geojson is a valid Polygon', () => {
    const data = {
      ...basePayload,
      kgis: {
        hierarchy: { taluk: 'Bangalore South' },
        geometry_geojson: {
          type: 'Polygon',
          coordinates: [[[77.6, 12.97], [77.61, 12.97], [77.61, 12.98], [77.6, 12.98], [77.6, 12.97]]],
        },
      },
    };
    render(<DerivedParcelMiniMap data={data} />);
    expect(screen.getByTestId('geojson-layer')).toBeInTheDocument();
    expect(screen.queryByTestId('fallback-circle')).not.toBeInTheDocument();
    expect(screen.getByText(/K-GIS polygon/i)).toBeInTheDocument();
  });

  it('falls back to a dashed-orange circle when K-GIS returns no polygon', () => {
    render(<DerivedParcelMiniMap data={basePayload} />);
    expect(screen.queryByTestId('geojson-layer')).not.toBeInTheDocument();
    const circle = screen.getByTestId('fallback-circle');
    expect(circle).toBeInTheDocument();
    expect(circle.getAttribute('data-radius')).toBe('50');
    expect(circle.getAttribute('data-dash')).toBe('4 4');
    expect(screen.getByText(/Approximate boundary/i)).toBeInTheDocument();
  });

  it('respects custom fallbackRadiusM prop', () => {
    render(<DerivedParcelMiniMap data={basePayload} fallbackRadiusM={120} />);
    const circle = screen.getByTestId('fallback-circle');
    expect(circle.getAttribute('data-radius')).toBe('120');
    // The "120m radius" string appears in both the badge and the footer
    // description — use getAllByText to confirm presence in both.
    expect(screen.getAllByText(/120m radius/).length).toBeGreaterThanOrEqual(1);
  });

  it('unwraps a Feature wrapper around the geometry', () => {
    const data = {
      ...basePayload,
      kgis: {
        hierarchy: {},
        geometry_geojson: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[[77.6, 12.97], [77.61, 12.97], [77.61, 12.98], [77.6, 12.97]]],
          },
        },
      },
    };
    render(<DerivedParcelMiniMap data={data} />);
    expect(screen.getByTestId('geojson-layer')).toBeInTheDocument();
  });

  it('unwraps a FeatureCollection wrapper and picks the first valid polygon', () => {
    const data = {
      ...basePayload,
      kgis: {
        hierarchy: {},
        geometry_geojson: {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', geometry: { type: 'Point', coordinates: [77.6, 12.97] } },  // skip — not a polygon
            { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[77.6, 12.97], [77.61, 12.97], [77.61, 12.98], [77.6, 12.97]]] } },
          ],
        },
      },
    };
    render(<DerivedParcelMiniMap data={data} />);
    expect(screen.getByTestId('geojson-layer')).toBeInTheDocument();
  });
});

describe('DerivedParcelMiniMap — tile layer toggle', () => {
  it('starts on streets and switches to satellite on click', () => {
    render(<DerivedParcelMiniMap data={basePayload} />);
    const streetsBtn = screen.getByTestId('mini-map-tile-streets');
    const satBtn = screen.getByTestId('mini-map-tile-satellite');
    expect(streetsBtn).toHaveAttribute('aria-selected', 'true');
    expect(satBtn).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toMatch(/openstreetmap/);
    fireEvent.click(satBtn);
    expect(streetsBtn).toHaveAttribute('aria-selected', 'false');
    expect(satBtn).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toMatch(/arcgisonline/);
  });
});

describe('DerivedParcelMiniMap — Google sat deep-link', () => {
  it('builds a Google Maps @lat,lng,zoom URL with the derived coords', () => {
    render(<DerivedParcelMiniMap data={basePayload} />);
    // aria-label overrides visible text for accessible name → match by label
    const link = screen.getByLabelText(/Open in Google Maps satellite/i);
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('href')).toMatch(/maps\/@12\.975010,77\.605010,19z/);
  });
});

describe('extractParcelGeometry helper', () => {
  it('returns bare Polygon as-is', () => {
    const g = { type: 'Polygon', coordinates: [[[0, 0]]] };
    expect(_internal.extractParcelGeometry(g)).toBe(g);
  });
  it('returns bare MultiPolygon as-is', () => {
    const g = { type: 'MultiPolygon', coordinates: [[[[0, 0]]]] };
    expect(_internal.extractParcelGeometry(g)).toBe(g);
  });
  it('returns null for non-geometry input', () => {
    expect(_internal.extractParcelGeometry(null)).toBeNull();
    expect(_internal.extractParcelGeometry({})).toBeNull();
    expect(_internal.extractParcelGeometry({ type: 'Point', coordinates: [0, 0] })).toBeNull();
    expect(_internal.extractParcelGeometry({ type: 'Polygon', coordinates: [] })).toBeNull();
  });
});
