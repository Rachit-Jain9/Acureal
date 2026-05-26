'use strict';

const {
  parseListingPage,
  normaliseHeader,
  normaliseAssetClass,
  normaliseStatus,
  inferPromoterEntityType,
  parseIntegerLoose,
  parseFloatLoose,
  parseDateLoose,
} = require('../src/services/karnatakaReraTracker.parser');

describe('normaliseHeader', () => {
  test('lowercases + strips punctuation + collapses whitespace', () => {
    expect(normaliseHeader('Registration No.')).toBe('registration no');
    expect(normaliseHeader('  Project   Name  ')).toBe('project name');
    expect(normaliseHeader('No. of Apartments')).toBe('no of apartments');
    expect(normaliseHeader('Date of  Registration')).toBe('date of registration');
  });
});

describe('normaliseAssetClass', () => {
  test('maps known K-RERA project types to canonical asset classes', () => {
    expect(normaliseAssetClass('Residential')).toBe('residential_apartments');
    expect(normaliseAssetClass('Group Housing - Residential')).toBe('residential_apartments');
    expect(normaliseAssetClass('Villas')).toBe('villas');
    expect(normaliseAssetClass('Plotted Development')).toBe('plotted_development');
    expect(normaliseAssetClass('Commercial')).toBe('commercial_office');
    expect(normaliseAssetClass('Retail')).toBe('retail');
    expect(normaliseAssetClass('Industrial')).toBe('industrial_warehousing');
    expect(normaliseAssetClass('Warehousing')).toBe('industrial_warehousing');
    expect(normaliseAssetClass('Hotel')).toBe('hospitality');
    expect(normaliseAssetClass('Mixed')).toBe('mixed_use');
  });

  test('returns null on unknown / empty input', () => {
    expect(normaliseAssetClass(null)).toBeNull();
    expect(normaliseAssetClass('')).toBeNull();
    expect(normaliseAssetClass('Some New Category')).toBeNull();
  });
});

describe('normaliseStatus', () => {
  test('maps known K-RERA status strings', () => {
    expect(normaliseStatus('Registered')).toBe('registered');
    expect(normaliseStatus('Active')).toBe('registered');
    expect(normaliseStatus('Ongoing')).toBe('registered');
    expect(normaliseStatus('Extended')).toBe('extended');
    expect(normaliseStatus('Extension Granted')).toBe('extended');
    expect(normaliseStatus('Completed')).toBe('completed');
    expect(normaliseStatus('Lapsed')).toBe('lapsed');
    expect(normaliseStatus('Revoked')).toBe('revoked');
    expect(normaliseStatus('Withdrawn')).toBe('withdrawn');
  });

  test('returns null on unknown / empty input', () => {
    expect(normaliseStatus(null)).toBeNull();
    expect(normaliseStatus('Something Else')).toBeNull();
  });
});

describe('inferPromoterEntityType', () => {
  test('infers entity type from common suffixes', () => {
    expect(inferPromoterEntityType('Prestige Estates Projects Limited')).toBe('public_limited');
    expect(inferPromoterEntityType('Sobha Developers Private Limited')).toBe('private_limited');
    expect(inferPromoterEntityType('Brigade Enterprises Pvt Ltd')).toBe('private_limited');
    expect(inferPromoterEntityType('Some Developer LLP')).toBe('llp');
    expect(inferPromoterEntityType('Sri Rama Trust')).toBe('trust');
  });

  test('returns null when no entity suffix detected', () => {
    expect(inferPromoterEntityType('XYZ Builders')).toBeNull();
    expect(inferPromoterEntityType(null)).toBeNull();
  });
});

describe('numeric parsers', () => {
  test('parseIntegerLoose extracts ints from messy strings', () => {
    expect(parseIntegerLoose('120 units')).toBe(120);
    expect(parseIntegerLoose('1,200')).toBe(1200);
    expect(parseIntegerLoose(' -45 ')).toBe(-45);
    expect(parseIntegerLoose('N/A')).toBeNull();
    expect(parseIntegerLoose(null)).toBeNull();
  });

  test('parseFloatLoose extracts decimals', () => {
    expect(parseFloatLoose('42,800.5 sqft')).toBe(42800.5);
    expect(parseFloatLoose('—')).toBeNull();
  });
});

describe('parseDateLoose', () => {
  test('parses DD/MM/YYYY', () => {
    expect(parseDateLoose('12/01/2024')).toBe('2024-01-12');
    expect(parseDateLoose('1/9/2023')).toBe('2023-09-01');
  });

  test('parses DD-MM-YYYY', () => {
    expect(parseDateLoose('12-01-2024')).toBe('2024-01-12');
  });

  test('parses "DD Mmm YYYY"', () => {
    expect(parseDateLoose('12 Jan 2024')).toBe('2024-01-12');
    expect(parseDateLoose('5 Sep 2023')).toBe('2023-09-05');
    expect(parseDateLoose('5 Sept 2023')).toBe('2023-09-05');
  });

  test('returns null on garbage', () => {
    expect(parseDateLoose(null)).toBeNull();
    expect(parseDateLoose('')).toBeNull();
    expect(parseDateLoose('not a date')).toBeNull();
  });
});

describe('parseListingPage — synthetic fixture', () => {
  const SYNTHETIC_FIXTURE = `<!doctype html>
<html><body>
  <table>
    <thead>
      <tr>
        <th>Registration No.</th>
        <th>Project Name</th>
        <th>Promoter Name</th>
        <th>City</th>
        <th>Locality</th>
        <th>Project Type</th>
        <th>Date of Registration</th>
        <th>Proposed Completion Date</th>
        <th>Status</th>
        <th>No. of Apartments</th>
        <th>Total Saleable Area</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>PRM/KA/RERA/1251/446/PR/180120/000123</td>
        <td>Whitefield Heights</td>
        <td>Prestige Estates Projects Limited</td>
        <td>Bengaluru</td>
        <td>Whitefield</td>
        <td>Group Housing - Residential</td>
        <td>12/01/2024</td>
        <td>30/06/2027</td>
        <td>Registered</td>
        <td>240</td>
        <td>4,80,000</td>
      </tr>
      <tr>
        <td>PRM/KA/RERA/1251/446/PR/180120/000456</td>
        <td>Devanahalli Plots</td>
        <td>Sri Rama Trust</td>
        <td>Bengaluru</td>
        <td>Devanahalli</td>
        <td>Plotted Development</td>
        <td>5 Sep 2023</td>
        <td>5 Sep 2026</td>
        <td>Extended</td>
        <td></td>
        <td>2,50,000</td>
      </tr>
      <tr>
        <td>PRM/KA/RERA/1251/446/PR/180120/000789</td>
        <td>Sarjapur Commercial</td>
        <td>Brigade Enterprises Pvt Ltd</td>
        <td>Bengaluru</td>
        <td>Sarjapur Outer Ring Road</td>
        <td>Commercial</td>
        <td>20-02-2025</td>
        <td>20-02-2028</td>
        <td>Registered</td>
        <td></td>
        <td>1,20,000</td>
      </tr>
    </tbody>
  </table>
</body></html>`;

  test('parses exactly the three project rows', () => {
    const rows = parseListingPage(SYNTHETIC_FIXTURE, { sourceUrl: 'https://rera.karnataka.gov.in/viewAllProjects?page=1' });
    expect(rows).toHaveLength(3);
  });

  test('maps RERA project IDs correctly', () => {
    const rows = parseListingPage(SYNTHETIC_FIXTURE);
    expect(rows[0].rera_project_id).toBe('PRM/KA/RERA/1251/446/PR/180120/000123');
    expect(rows[1].rera_project_id).toBe('PRM/KA/RERA/1251/446/PR/180120/000456');
    expect(rows[2].rera_project_id).toBe('PRM/KA/RERA/1251/446/PR/180120/000789');
  });

  test('normalises asset classes', () => {
    const rows = parseListingPage(SYNTHETIC_FIXTURE);
    expect(rows[0].asset_class).toBe('residential_apartments');
    expect(rows[1].asset_class).toBe('plotted_development');
    expect(rows[2].asset_class).toBe('commercial_office');
  });

  test('infers promoter entity types', () => {
    const rows = parseListingPage(SYNTHETIC_FIXTURE);
    expect(rows[0].promoter_entity_type).toBe('public_limited');
    expect(rows[1].promoter_entity_type).toBe('trust');
    expect(rows[2].promoter_entity_type).toBe('private_limited');
  });

  test('parses dates across all three formats present in the fixture', () => {
    const rows = parseListingPage(SYNTHETIC_FIXTURE);
    expect(rows[0].registration_date).toBe('2024-01-12');
    expect(rows[1].registration_date).toBe('2023-09-05');
    expect(rows[2].registration_date).toBe('2025-02-20');
    expect(rows[0].proposed_completion).toBe('2027-06-30');
  });

  test('maps statuses', () => {
    const rows = parseListingPage(SYNTHETIC_FIXTURE);
    expect(rows[0].status).toBe('registered');
    expect(rows[1].status).toBe('extended');
    expect(rows[2].status).toBe('registered');
  });

  test('parses Indian-comma-formatted areas', () => {
    const rows = parseListingPage(SYNTHETIC_FIXTURE);
    expect(rows[0].total_saleable_sqft).toBe(480000);
    expect(rows[1].total_saleable_sqft).toBe(250000);
    expect(rows[2].total_saleable_sqft).toBe(120000);
  });

  test('preserves the raw payload for re-parsing', () => {
    const rows = parseListingPage(SYNTHETIC_FIXTURE);
    expect(rows[0].raw_payload.cells).toContain('PRM/KA/RERA/1251/446/PR/180120/000123');
    expect(rows[0].raw_payload.headers).toContain('rera_project_id');
  });

  test('attaches source_url when provided', () => {
    const rows = parseListingPage(SYNTHETIC_FIXTURE, { sourceUrl: 'https://example' });
    expect(rows[0].source_url).toBe('https://example');
  });

  test('null-safe inputs', () => {
    expect(parseListingPage(null)).toEqual([]);
    expect(parseListingPage('')).toEqual([]);
    expect(parseListingPage('<html><body>no table here</body></html>')).toEqual([]);
  });
});

describe('parseListingPage — header reorder resilience', () => {
  // Same data, columns in a different order — should produce identical rows.
  const REORDERED_FIXTURE = `<table>
    <thead>
      <tr>
        <th>Project Name</th>
        <th>Registration No.</th>
        <th>Promoter</th>
        <th>Status</th>
        <th>Project Type</th>
        <th>Locality</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Hebbal Towers</td>
        <td>PRM/KA/RERA/1251/446/PR/180120/999</td>
        <td>Sobha Developers Private Limited</td>
        <td>Registered</td>
        <td>Residential</td>
        <td>Hebbal</td>
      </tr>
    </tbody>
  </table>`;

  test('column-by-header (not by-index) so portal reorders do not break parsing', () => {
    const rows = parseListingPage(REORDERED_FIXTURE);
    expect(rows).toHaveLength(1);
    expect(rows[0].project_name).toBe('Hebbal Towers');
    expect(rows[0].rera_project_id).toBe('PRM/KA/RERA/1251/446/PR/180120/999');
    expect(rows[0].promoter_name).toBe('Sobha Developers Private Limited');
    expect(rows[0].status).toBe('registered');
    expect(rows[0].asset_class).toBe('residential_apartments');
    expect(rows[0].locality_text).toBe('Hebbal');
  });
});
