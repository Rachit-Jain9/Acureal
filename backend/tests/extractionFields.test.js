const {
  unwrapStructuredFields,
  mergeStructuredFields,
} = require('../src/utils/extractionFields');

describe('extractionFields utils', () => {
  test('unwraps obvious extracted_json response wrappers', () => {
    expect(unwrapStructuredFields({
      doc_type: 'e_khata',
      extracted_json: {
        khata_number: '151900802100321399',
        site_area_sqft: 129417.81,
      },
    })).toEqual({
      khata_number: '151900802100321399',
      site_area_sqft: 129417.81,
    });
  });

  test('keeps non-wrapper payloads intact when extracted_json is a real field', () => {
    const payload = {
      title: 'Review note',
      extracted_json: { raw: true },
      fact_value: 'kept',
    };

    expect(unwrapStructuredFields(payload)).toBe(payload);
  });

  test('merges corrections over unwrapped base fields', () => {
    expect(mergeStructuredFields(
      {
        doc_type: 'e_khata',
        extracted_json: {
          owner_name: 'Old owner',
          site_area_sqft: 100,
        },
      },
      { owner_name: 'Reviewed owner' },
    )).toEqual({
      owner_name: 'Reviewed owner',
      site_area_sqft: 100,
    });
  });
});
