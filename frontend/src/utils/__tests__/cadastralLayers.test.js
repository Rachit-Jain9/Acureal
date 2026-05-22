import { describe, it, expect } from 'vitest';
import { buildCadastralLayers, LAYER_COLORS } from '../cadastralLayers';

const byKey = (layers, key) => layers.find((l) => l.key === key);

describe('buildCadastralLayers', () => {
  it('always returns the four layers in canvas order', () => {
    const layers = buildCadastralLayers();
    expect(layers.map((l) => l.key)).toEqual(['basemap', 'boundary', 'zoning', 'pin']);
  });

  it('reflects the active basemap and its tile provenance', () => {
    const streets = byKey(buildCadastralLayers({ basemap: 'streets' }), 'basemap');
    expect(streets.active).toBe('streets');
    expect(streets.provenance).toMatch(/OpenStreetMap/);

    const sat = byKey(buildCadastralLayers({ basemap: 'satellite' }), 'basemap');
    expect(sat.active).toBe('satellite');
    expect(sat.provenance).toMatch(/Esri/);

    // An unknown basemap value falls back to streets, never throws.
    expect(byKey(buildCadastralLayers({ basemap: 'nonsense' }), 'basemap').active).toBe('streets');
  });

  it('marks the cadastral boundary unavailable when no polygon is drawn', () => {
    const boundary = byKey(buildCadastralLayers({ hasBoundary: false }), 'boundary');
    expect(boundary.drawn).toBe(false);
    expect(boundary.status).toBe('unavailable');
    expect(boundary.tone).toBe('muted');
    expect(boundary.provenance).toMatch(/No K-GIS/);
  });

  it('marks the boundary verified — K-GIS — when a real polygon is drawn', () => {
    const boundary = byKey(buildCadastralLayers({ hasBoundary: true }), 'boundary');
    expect(boundary.drawn).toBe(true);
    expect(boundary.status).toBe('verified');
    expect(boundary.statusLabel).toMatch(/K-GIS/);
    expect(boundary.tone).toBe('verified');
    expect(boundary.swatch).toEqual({ type: 'solid', color: LAYER_COLORS.boundary });
  });

  it('never calls an approximate boundary verified', () => {
    const boundary = byKey(
      buildCadastralLayers({ hasBoundary: true, boundaryApproximate: true }),
      'boundary',
    );
    expect(boundary.status).toBe('approximate');
    expect(boundary.tone).toBe('approximate');
    expect(boundary.provenance).toMatch(/not a surveyed/i);
  });

  it('walks the zoning overlay through its lifecycle states', () => {
    const off = byKey(buildCadastralLayers({ zoning: { enabled: false } }), 'zoning');
    expect(off.status).toBe('off');

    const loading = byKey(
      buildCadastralLayers({ zoning: { enabled: true, loading: true } }),
      'zoning',
    );
    expect(loading.status).toBe('loading');

    const errored = byKey(
      buildCadastralLayers({ zoning: { enabled: true, error: 'API 500' } }),
      'zoning',
    );
    expect(errored.status).toBe('error');
    expect(errored.tone).toBe('error');
    expect(errored.provenance).toBe('API 500');

    const empty = byKey(
      buildCadastralLayers({ zoning: { enabled: true, featureCount: 0 } }),
      'zoning',
    );
    expect(empty.status).toBe('empty');
    expect(empty.provenance).toMatch(/no rmp zone geometry/i);
  });

  it('counts and pluralises live zoning features', () => {
    const one = byKey(
      buildCadastralLayers({ zoning: { enabled: true, featureCount: 1 } }),
      'zoning',
    );
    expect(one.status).toBe('on');
    expect(one.statusLabel).toBe('1 zone');
    expect(one.tone).toBe('verified');

    const many = byKey(
      buildCadastralLayers({ zoning: { enabled: true, featureCount: 6 } }),
      'zoning',
    );
    expect(many.statusLabel).toBe('6 zones');
  });

  it('maps the parcel pin trust state from the geocode status', () => {
    expect(byKey(buildCadastralLayers({ geocodeStatus: 'verified' }), 'pin').tone).toBe('verified');
    expect(byKey(buildCadastralLayers({ geocodeStatus: 'manual' }), 'pin').statusLabel).toMatch(/Manual/);

    const approx = byKey(buildCadastralLayers({ geocodeStatus: 'approximate' }), 'pin');
    expect(approx.tone).toBe('approximate');
    expect(approx.provenance).toMatch(/100–300 m/);

    // Pending / unknown still draws the pin, just without a trust claim.
    const pending = byKey(buildCadastralLayers({ geocodeStatus: 'pending' }), 'pin');
    expect(pending.status).toBe('plain');
    expect(pending.tone).toBe('muted');
  });
});
