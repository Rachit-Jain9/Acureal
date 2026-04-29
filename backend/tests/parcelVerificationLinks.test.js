const { buildVerificationLinks } = require('../src/utils/parcelVerificationLinks');

describe('parcelVerificationLinks.buildVerificationLinks', () => {
  test('returns the canonical six links for an empty input', () => {
    const links = buildVerificationLinks();
    expect(links.map((l) => l.key)).toEqual([
      'bhoomi_rtc',
      'kaveri_ec',
      'bbmp_eaasthi',
      'rera',
      'igr_guidance',
      'kgis_cadastral',
    ]);
    // Google Maps deep-link is only emitted when lat/lng are present.
    // Every link with no inputs should be inputs_missing.
    links.forEach((link) => expect(link.status).toBe('inputs_missing'));
  });

  test('K-GIS cadastral is a copy-paste card (no deep-link) and Google Maps is the satellite deep-link', () => {
    const links = buildVerificationLinks({
      property: { lat: 13.035, lng: 77.59 },
    });

    const kgis = links.find((l) => l.key === 'kgis_cadastral');
    expect(kgis.deep_link).toBe(false);
    expect(kgis.status).toBe('ready');
    // Points to the working K-GIS viewer homepage; coords go in copy payload.
    expect(kgis.href).toBe('https://kgis.ksrsac.in/kgis/');
    expect(kgis.copy_text).toBe('13.035000, 77.590000');

    const gmaps = links.find((l) => l.key === 'google_maps_satellite');
    expect(gmaps).toBeDefined();
    expect(gmaps.deep_link).toBe(true);
    expect(gmaps.status).toBe('ready');
    expect(gmaps.href).toContain('13.035000,77.590000');
    expect(gmaps.href).toContain('1e3');
  });

  test('Google Maps deep-link is omitted when no coordinates exist', () => {
    const links = buildVerificationLinks();
    const gmaps = links.find((l) => l.key === 'google_maps_satellite');
    expect(gmaps).toBeUndefined();
  });

  test('Bhoomi RTC and Kaveri become ready when survey + village land', () => {
    const links = buildVerificationLinks({
      property: { survey_number: '12' },
      kgis: {
        hierarchy: { village: 'Hebbal', taluk: 'Bengaluru North', district: 'Bengaluru Urban' },
        survey_numbers: ['12'],
      },
    });
    const bhoomi = links.find((l) => l.key === 'bhoomi_rtc');
    expect(bhoomi.status).toBe('ready');
    expect(bhoomi.hint).toContain('Hebbal');
    expect(bhoomi.hint).toContain('Survey No 12');
    expect(bhoomi.copy_text).toContain('Survey No: 12');
    expect(bhoomi.copy_text).toContain('Village: Hebbal');

    const kaveri = links.find((l) => l.key === 'kaveri_ec');
    expect(kaveri.status).toBe('ready');
    expect(kaveri.hint).toContain('survey 12');
  });

  test('BBMP e-Aasthi prefers PID over khata in the hint, but accepts either', () => {
    const onlyPid = buildVerificationLinks({ property: { pid: 'PID-1234' } });
    const bbmpPid = onlyPid.find((l) => l.key === 'bbmp_eaasthi');
    expect(bbmpPid.status).toBe('ready');
    expect(bbmpPid.hint).toContain('PID PID-1234');

    const onlyKhata = buildVerificationLinks({ property: { khata_no: 'K-99' } });
    const bbmpKhata = onlyKhata.find((l) => l.key === 'bbmp_eaasthi');
    expect(bbmpKhata.status).toBe('ready');
    expect(bbmpKhata.hint).toContain('Khata No K-99');
  });

  test('K-RERA goes ready when a registration number exists', () => {
    const links = buildVerificationLinks({
      property: { rera_registration_number: 'PRM/KA/RERA/1251/446/AG/200120/000123' },
    });
    const rera = links.find((l) => l.key === 'rera');
    expect(rera.status).toBe('ready');
    expect(rera.hint).toContain('PRM/KA/RERA/1251/446/AG/200120/000123');
    expect(rera.copy_text).toContain('RERA:');
  });

  test('IGR guidance carries district/village context when KGIS hierarchy is known', () => {
    const links = buildVerificationLinks({
      property: { address: '123 Hebbal Main Rd' },
      kgis: { hierarchy: { district: 'Bengaluru Urban', village: 'Hebbal', hobli: 'Yelahanka' } },
    });
    const igr = links.find((l) => l.key === 'igr_guidance');
    expect(igr.status).toBe('ready');
    expect(igr.hint).toContain('Bengaluru Urban');
    expect(igr.hint).toContain('Hebbal');
    expect(igr.hint).toContain('Yelahanka');
  });

  test('survey numbers from KGIS get merged with property survey_number, deduped', () => {
    const links = buildVerificationLinks({
      property: { survey_number: '12' },
      kgis: { survey_numbers: [{ survey_number: '12' }, { survey_number: '12/4' }] },
    });
    const bhoomi = links.find((l) => l.key === 'bhoomi_rtc');
    expect(bhoomi.copy_text).toContain('Survey No: 12, 12/4');
  });
});
