import { describe, it, expect } from 'vitest';
import {
  prefersNonResidentialBand,
  selectPrimaryBbmpZone,
  selectPrimaryStreetRow,
  NON_RESIDENTIAL_ASSET_CLASSES,
} from '../bbmpRegister';

describe('prefersNonResidentialBand', () => {
  it('is true for exactly the non-residential asset classes', () => {
    ['commercial_office', 'retail', 'industrial_warehousing', 'hospitality'].forEach((a) => {
      expect(prefersNonResidentialBand(a)).toBe(true);
    });
  });

  it('is false for residential / mixed / land / unknown asset classes', () => {
    ['residential_apartments', 'villas', 'plotted_development', 'mixed_use', 'raw_land', 'redevelopment', undefined, null, '', 'commercial']
      .forEach((a) => {
        expect(prefersNonResidentialBand(a)).toBe(false);
      });
  });

  it('does NOT match on a naive substring (the wrong-string trap)', () => {
    // 'commercial' alone is NOT a real asset_class value; the real ones are
    // commercial_office / industrial_warehousing. Guard against includes() bugs.
    expect(prefersNonResidentialBand('commercial')).toBe(false);
    expect(NON_RESIDENTIAL_ASSET_CLASSES.has('commercial')).toBe(false);
    expect(NON_RESIDENTIAL_ASSET_CLASSES.has('industrial')).toBe(false);
  });
});

describe('selectPrimaryBbmpZone', () => {
  const zone = {
    zone_code: 'D',
    zone_name: 'Zone D',
    register: 'residential',
    guidance_value_band_min_inr: 4500,
    guidance_value_band_max_inr: 9800,
    non_residential: {
      zone_code: 'B',
      zone_name: 'Zone B',
      guidance_value_band_min_inr: 8000,
      guidance_value_band_max_inr: 15000,
      source_street: 'MG ROAD',
      source_page: 400,
    },
  };

  it('returns null for a null payload', () => {
    expect(selectPrimaryBbmpZone(null, 'commercial_office')).toBeNull();
  });

  it('promotes the non-residential twin for a commercial asset class', () => {
    const out = selectPrimaryBbmpZone(zone, 'commercial_office');
    expect(out.zone_code).toBe('B');
    expect(out.primary_register).toBe('non_residential');
    expect(out.guidance_value_band_min_inr).toBe(8000);
    expect(out.guidance_value_band_max_inr).toBe(15000);
    // residential stays visible as the twin (nothing hidden)
    expect(out.residential_twin.zone_code).toBe('D');
    expect(out.residential_twin.guidance_value_band_min_inr).toBe(4500);
  });

  it('keeps residential primary for a residential / undefined asset class', () => {
    expect(selectPrimaryBbmpZone(zone, 'residential_apartments').zone_code).toBe('D');
    expect(selectPrimaryBbmpZone(zone, 'residential_apartments').primary_register).toBe('residential');
    expect(selectPrimaryBbmpZone(zone, undefined).zone_code).toBe('D');
    // mixed_use deliberately stays residential-primary
    expect(selectPrimaryBbmpZone(zone, 'mixed_use').zone_code).toBe('D');
  });

  it('falls back to residential when a commercial deal has no non-residential twin', () => {
    const resOnly = { zone_code: 'C', register: 'residential', non_residential: null };
    const out = selectPrimaryBbmpZone(resOnly, 'commercial_office');
    expect(out.zone_code).toBe('C');
    expect(out.primary_register).toBe('residential');
  });
});

describe('selectPrimaryStreetRow', () => {
  const rows = [
    { id: 'res', street_name_en: 'MG ROAD', register: 'residential', zone_code: 'D', guidance_value_band_min_inr: 4500, guidance_value_band_max_inr: 9800 },
    { id: 'nonres', street_name_en: 'MG ROAD', register: 'non_residential', zone_code: 'B', guidance_value_band_min_inr: 8000, guidance_value_band_max_inr: 15000 },
  ];

  it('returns null for empty / non-array input', () => {
    expect(selectPrimaryStreetRow([], 'commercial_office')).toBeNull();
    expect(selectPrimaryStreetRow(undefined, 'commercial_office')).toBeNull();
  });

  it('prefers the non-residential row for the SAME street for a commercial deal', () => {
    expect(selectPrimaryStreetRow(rows, 'commercial_office').id).toBe('nonres');
    expect(selectPrimaryStreetRow(rows, 'industrial_warehousing').zone_code).toBe('B');
  });

  it('prefers the residential row for a residential / unknown deal', () => {
    expect(selectPrimaryStreetRow(rows, 'residential_apartments').id).toBe('res');
    expect(selectPrimaryStreetRow(rows, undefined).id).toBe('res');
  });

  it('does NOT headline a different street: same-street match wins over a foreign non-res row', () => {
    const mixed = [
      { id: 'top', street_name_en: 'BRIGADE ROAD', register: 'residential', zone_code: 'D' },
      { id: 'other-nonres', street_name_en: 'SOME OTHER ROAD', register: 'non_residential', zone_code: 'A' },
      { id: 'same-nonres', street_name_en: 'BRIGADE ROAD', register: 'non_residential', zone_code: 'B' },
    ];
    expect(selectPrimaryStreetRow(mixed, 'retail').id).toBe('same-nonres');
  });

  it('falls back to any non-res row, then the top hit, when the same-street register is absent', () => {
    const noSameStreetNonRes = [
      { id: 'top', street_name_en: 'BRIGADE ROAD', register: 'residential', zone_code: 'D' },
      { id: 'foreign-nonres', street_name_en: 'OTHER ROAD', register: 'non_residential', zone_code: 'A' },
    ];
    expect(selectPrimaryStreetRow(noSameStreetNonRes, 'retail').id).toBe('foreign-nonres');

    const allRes = [
      { id: 'a', street_name_en: 'X', register: 'residential', zone_code: 'D' },
      { id: 'b', street_name_en: 'Y', register: 'residential', zone_code: 'C' },
    ];
    expect(selectPrimaryStreetRow(allRes, 'commercial_office').id).toBe('a'); // falls back to top hit
  });

  it('treats rows with no register as residential (legacy rows) → returns the top hit', () => {
    const legacy = [
      { id: 'a', street_name_en: 'X', zone_code: 'B' },
      { id: 'b', street_name_en: 'Y', zone_code: 'C' },
    ];
    expect(selectPrimaryStreetRow(legacy, undefined).id).toBe('a');
    expect(selectPrimaryStreetRow(legacy, 'commercial_office').id).toBe('a'); // no non-res → top hit
  });
});
