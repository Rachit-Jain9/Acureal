import { describe, it, expect } from 'vitest';
import {
  buildCadastralLayers,
  isInRmp2015Bounds,
  RMP2015_BBOX,
  DEFAULT_MASTER_PLAN_OPACITY,
} from '../cadastralLayers';

describe('isInRmp2015Bounds', () => {
  it('is true for central Bengaluru (BDA core)', () => {
    expect(isInRmp2015Bounds(12.9716, 77.5946)).toBe(true); // city centre
    expect(isInRmp2015Bounds(12.78, 77.64)).toBe(true); // Jigani — above the southern edge
  });

  it('is false outside the BDA extent', () => {
    expect(isInRmp2015Bounds(12.71, 77.69)).toBe(false); // Anekal town — below southern edge 12.743
    expect(isInRmp2015Bounds(13.5, 77.6)).toBe(false); // far north
    expect(isInRmp2015Bounds(12.9, 78.2)).toBe(false); // far east
  });

  it('is false for non-finite input', () => {
    expect(isInRmp2015Bounds(null, null)).toBe(false);
    expect(isInRmp2015Bounds(undefined, 77.6)).toBe(false);
    expect(isInRmp2015Bounds('x', 'y')).toBe(false);
  });

  it('bbox matches the backend tile-proxy extent', () => {
    expect(RMP2015_BBOX).toEqual({ west: 77.379326, south: 12.743347, east: 77.859283, north: 13.190987 });
  });
});

describe('buildCadastralLayers — master-plan layer', () => {
  const mp = (layers) => layers.find((l) => l.key === 'masterPlan');

  it('always includes the master-plan layer between zoning and pin', () => {
    const layers = buildCadastralLayers({});
    const keys = layers.map((l) => l.key);
    expect(keys).toEqual(['basemap', 'boundary', 'zoning', 'masterPlan', 'pin']);
  });

  it('off by default with the toggle-to-load provenance', () => {
    const m = mp(buildCadastralLayers({ masterPlan: { enabled: false } }));
    expect(m.status).toBe('off');
    expect(m.tone).toBe('muted');
    expect(m.opacity).toBe(DEFAULT_MASTER_PLAN_OPACITY);
  });

  it('on (amber reference, never verified) when enabled + in bounds', () => {
    const m = mp(buildCadastralLayers({ masterPlan: { enabled: true, inBounds: true, opacity: 0.5 } }));
    expect(m.status).toBe('on');
    expect(m.tone).toBe('approximate'); // never 'verified' — it's a reference overlay
    expect(m.statusLabel).toBe('Reference');
    expect(m.opacity).toBe(0.5);
    expect(m.provenance).toMatch(/verify against the official sheet/i);
  });

  it('out_of_bounds when enabled but the parcel is outside the BDA extent', () => {
    const m = mp(buildCadastralLayers({ masterPlan: { enabled: true, inBounds: false } }));
    expect(m.status).toBe('out_of_bounds');
    expect(m.tone).toBe('approximate');
    expect(m.provenance).toMatch(/outside the RMP 2015 mapped area/i);
  });
});
