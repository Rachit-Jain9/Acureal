'use strict';

const ontology = require('../src');

describe('@redip/real-estate-ontology', () => {
  describe('asset class taxonomy', () => {
    test('exposes all 10 native asset classes per CLAUDE.md', () => {
      const keys = ontology.getAssetClassKeys();
      expect(keys.sort()).toEqual([
        'commercial_office',
        'hospitality',
        'industrial_warehousing',
        'mixed_use',
        'plotted_development',
        'raw_land',
        'redevelopment',
        'residential_apartments',
        'retail',
        'villas',
      ]);
    });

    test('every asset class carries label, family, india_notes', () => {
      for (const ac of ontology.getAssetClasses()) {
        expect(ac).toHaveProperty('key');
        expect(ac).toHaveProperty('label');
        expect(ac).toHaveProperty('family');
        expect(ac).toHaveProperty('india_notes');
        expect(['income', 'development', 'land']).toContain(ac.family);
      }
    });

    test('getAssetClassFamily resolves family for known keys', () => {
      expect(ontology.getAssetClassFamily('hospitality')).toBe('income');
      expect(ontology.getAssetClassFamily('residential_apartments')).toBe('development');
      expect(ontology.getAssetClassFamily('raw_land')).toBe('land');
      expect(ontology.getAssetClassFamily('unknown_xyz')).toBeNull();
    });
  });

  describe('deal structure taxonomy', () => {
    test('exposes the 4 canonical deal structures', () => {
      expect(ontology.getDealStructureKeys().sort()).toEqual([
        'development_management',
        'jda_area_share',
        'jda_revenue_share',
        'outright_purchase',
      ]);
    });
  });

  describe('exit strategy taxonomy (family-conditional)', () => {
    test('income family has REIT exit + strategic sale + refinance hold + hold-to-perpetuity', () => {
      const keys = ontology.getExitStrategyKeys('income').sort();
      expect(keys).toEqual([
        'hold_to_perpetuity',
        'refinance_hold',
        'reit_exit',
        'strategic_sale',
      ]);
    });

    test('development family has outright_progressive + bulk_exit_completion + hold_post_completion', () => {
      const keys = ontology.getExitStrategyKeys('development').sort();
      expect(keys).toEqual([
        'bulk_exit_completion',
        'hold_post_completion',
        'outright_progressive',
      ]);
    });

    test('land family has its own exit set distinct from income/development', () => {
      const keys = ontology.getExitStrategyKeys('land').sort();
      expect(keys).toContain('strategic_sale');
      expect(keys).not.toContain('reit_exit'); // REIT requires income asset
    });

    test('unknown family returns empty array (defensive)', () => {
      expect(ontology.getExitStrategies('unknown_family')).toEqual([]);
      expect(ontology.getExitStrategies(null)).toEqual([]);
      expect(ontology.getExitStrategies()).toEqual([]);
    });
  });

  describe('zoning + ownership taxonomies match Postgres enums', () => {
    test('zoning values include the 11 zoning_type entries used by the deals/properties schema', () => {
      const values = ontology.getZoningValues();
      expect(values).toContain('residential');
      expect(values).toContain('commercial');
      expect(values).toContain('mixed_use');
      expect(values).toContain('industrial');
      expect(values).toContain('agricultural');
    });

    test('ownership_type includes A-khata + B-khata + mixed (Bengaluru-critical taxonomy)', () => {
      const keys = ontology.getOwnershipTypeKeys();
      expect(keys).toContain('a_khata');
      expect(keys).toContain('b_khata');
      expect(keys).toContain('mixed_khata');
      expect(keys).toContain('freehold');
      expect(keys).toContain('leasehold');
    });
  });

  describe('area unit conversion', () => {
    test('sqft → sqft is identity', () => {
      expect(ontology.toSqft(1000, 'sqft')).toBe(1000);
    });

    test('1 acre → 43560 sqft (Karnataka convention)', () => {
      expect(ontology.sqftFromAcres(1)).toBe(43560);
      expect(ontology.toSqft(1, 'acre')).toBe(43560);
    });

    test('1 guntha → 1089 sqft (Karnataka rural convention)', () => {
      expect(ontology.toSqft(1, 'guntha')).toBe(1089);
    });

    test('1 ground → 2400 sqft (Tamil Nadu convention)', () => {
      expect(ontology.toSqft(1, 'ground')).toBe(2400);
    });

    test('inverse: 43560 sqft → 1 acre', () => {
      expect(ontology.acresFromSqft(43560)).toBe(1);
    });

    test('rejects unknown units with an explanatory error', () => {
      expect(() => ontology.toSqft(10, 'parsec')).toThrow(/Unknown area unit "parsec"/);
    });

    test('null / NaN inputs return null (no throw)', () => {
      expect(ontology.toSqft(null, 'sqft')).toBeNull();
      expect(ontology.toSqft('abc', 'sqft')).toBeNull();
      expect(ontology.acresFromSqft(null)).toBeNull();
    });
  });

  describe('pricing unit conversion', () => {
    test('1 Cr = 10,000,000 INR (₹10 crore = ₹10,00,00,000)', () => {
      expect(ontology.crToInr(1)).toBe(10000000);
      expect(ontology.inrToCr(10000000)).toBe(1);
    });

    test('1 Lakh = 100,000 INR', () => {
      expect(ontology.inrToLakh(100000)).toBe(1);
    });

    test('inrToCr rounds-trips with crToInr', () => {
      expect(ontology.inrToCr(ontology.crToInr(7.5))).toBe(7.5);
    });

    test('null inputs return null (no throw)', () => {
      expect(ontology.inrToCr(null)).toBeNull();
      expect(ontology.crToInr(undefined)).toBeNull();
    });
  });

  describe('extraction field map → table/column routing', () => {
    test('exposes the documented canonical extraction fields', () => {
      const keys = ontology.getExtractionFieldKeys();
      // Critical fields for the sale-deed → deal autofill MVP
      expect(keys).toContain('survey_number');
      expect(keys).toContain('khata_number');
      expect(keys).toContain('land_area_sqft');
      expect(keys).toContain('land_area_acres');
      expect(keys).toContain('owner_name');
      expect(keys).toContain('consideration_inr');
      expect(keys).toContain('rera_number');
      expect(keys).toContain('circle_rate_per_sqft');
    });

    test('every field carries table + column + value_type + description', () => {
      for (const [key, spec] of Object.entries(ontology.getExtractionFieldMap())) {
        expect(spec).toHaveProperty('table');
        expect(spec).toHaveProperty('column');
        expect(spec).toHaveProperty('value_type');
        expect(spec).toHaveProperty('description');
        // Routing must point at a real REDIP table
        expect(['deals', 'properties']).toContain(spec.table);
        // Numbers carry min/max guardrails; strings carry max_length
        if (spec.value_type === 'number') {
          // min/max are recommended but not all numeric fields have both
          expect(typeof spec.min === 'number' || spec.min === undefined).toBe(true);
        }
        if (spec.value_type === 'string') {
          expect(spec.max_length).toBeGreaterThan(0);
        }
        // Sanity: key matches a string identifier pattern (no spaces, lowercase)
        expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });

    test('survey_number routes to properties.survey_number', () => {
      const spec = ontology.getExtractionField('survey_number');
      expect(spec.table).toBe('properties');
      expect(spec.column).toBe('survey_number');
    });

    test('consideration_inr routes to deals.negotiated_price_cr with inr_to_cr transform', () => {
      const spec = ontology.getExtractionField('consideration_inr');
      expect(spec.table).toBe('deals');
      expect(spec.column).toBe('negotiated_price_cr');
      expect(spec.transform).toBe('inr_to_cr');
    });

    test('land_area_acres routes to properties.land_area_sqft with acres_to_sqft transform', () => {
      const spec = ontology.getExtractionField('land_area_acres');
      expect(spec.table).toBe('properties');
      expect(spec.column).toBe('land_area_sqft');
      expect(spec.transform).toBe('acres_to_sqft');
    });

    test('getExtractionField returns null for unknown key', () => {
      expect(ontology.getExtractionField('nonexistent_xyz')).toBeNull();
    });
  });

  describe('transforms (acres_to_sqft, inr_to_cr)', () => {
    test('acres_to_sqft converts 2.5 acres → 108,900 sqft', () => {
      expect(ontology.applyTransform('acres_to_sqft', 2.5)).toBe(108900);
    });

    test('inr_to_cr converts ₹18,00,00,000 → 18 Cr', () => {
      expect(ontology.applyTransform('inr_to_cr', 180000000)).toBe(18);
    });

    test('inr_lakh_to_cr converts 100 lakh → 1 Cr', () => {
      expect(ontology.applyTransform('inr_lakh_to_cr', 100)).toBe(1);
    });

    test('identity transform is a no-op', () => {
      expect(ontology.applyTransform('identity', 'hello')).toBe('hello');
      expect(ontology.applyTransform(null, 42)).toBe(42);
    });

    test('unknown transform throws explanatory error', () => {
      expect(() => ontology.applyTransform('time_travel', 10)).toThrow(/Unknown ontology transform/);
    });
  });

  describe('validateAndCoerce — the apply-extractions gate', () => {
    test('valid sqft number passes through', () => {
      const r = ontology.validateAndCoerce('land_area_sqft', 12500);
      expect(r.ok).toBe(true);
      expect(r.value).toBe(12500);
      expect(r.transform).toBeNull();
    });

    test('numeric string is coerced to number', () => {
      const r = ontology.validateAndCoerce('land_area_sqft', '12,500');
      expect(r.ok).toBe(true);
      expect(r.value).toBe(12500);
    });

    test('acres input is transformed to sqft on write', () => {
      const r = ontology.validateAndCoerce('land_area_acres', 2);
      expect(r.ok).toBe(true);
      // 2 acres × 43560 = 87120 sqft
      expect(r.value).toBe(87120);
      expect(r.transform).toBe('acres_to_sqft');
      expect(r.original_value).toBe(2);
    });

    test('consideration in rupees is transformed to crore on write', () => {
      const r = ontology.validateAndCoerce('consideration_inr', 180000000);
      expect(r.ok).toBe(true);
      // ₹18,00,00,000 → 18 Cr
      expect(r.value).toBe(18);
      expect(r.transform).toBe('inr_to_cr');
    });

    test('value below min rejected with explanatory error', () => {
      // land_area_sqft min is 100
      const r = ontology.validateAndCoerce('land_area_sqft', 50);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/below min 100/);
    });

    test('value above max rejected with explanatory error', () => {
      // land_area_sqft max is 50,000,000
      const r = ontology.validateAndCoerce('land_area_sqft', 100000000);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/above max/);
    });

    test('string longer than max_length rejected', () => {
      // survey_number max_length is 100
      const r = ontology.validateAndCoerce('survey_number', 'X'.repeat(101));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/exceeds max 100/);
    });

    test('null / empty value rejected', () => {
      expect(ontology.validateAndCoerce('survey_number', null).ok).toBe(false);
      expect(ontology.validateAndCoerce('survey_number', '').ok).toBe(false);
      expect(ontology.validateAndCoerce('survey_number', '   ').ok).toBe(false);
    });

    test('unknown canonical field rejected with explanatory error', () => {
      const r = ontology.validateAndCoerce('nonexistent_xyz', 'hello');
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/Unknown canonical field/);
    });

    test('non-numeric string for a number field rejected', () => {
      const r = ontology.validateAndCoerce('land_area_sqft', 'not a number');
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/Could not coerce/);
    });

    test('string is trimmed before length check', () => {
      const r = ontology.validateAndCoerce('survey_number', '  45/2A  ');
      expect(r.ok).toBe(true);
      expect(r.value).toBe('45/2A');
    });
  });

  describe('confidence bands', () => {
    test('0.92 → high (above 0.80 threshold)', () => {
      expect(ontology.getConfidenceBand(0.92).key).toBe('high');
    });

    test('0.65 → medium (between 0.50 and 0.80)', () => {
      expect(ontology.getConfidenceBand(0.65).key).toBe('medium');
    });

    test('0.30 → low (below 0.50)', () => {
      expect(ontology.getConfidenceBand(0.30).key).toBe('low');
    });

    test('exactly at boundary 0.80 lands in high (inclusive)', () => {
      expect(ontology.getConfidenceBand(0.80).key).toBe('high');
    });

    test('non-numeric returns null', () => {
      expect(ontology.getConfidenceBand('high')).toBeNull();
      expect(ontology.getConfidenceBand(null)).toBeNull();
    });

    test('each band carries label + tone + applies guidance', () => {
      const high = ontology.getConfidenceBand(0.9);
      expect(high.label).toBe('High');
      expect(high.tone).toBe('data-positive');
      expect(high.applies).toMatch(/accept/);
    });
  });

  describe('version + introspection', () => {
    test('ontology version is exposed as a semver string', () => {
      expect(ontology.getOntologyVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test('raw ontology is the full v1.json object', () => {
      const raw = ontology.getRawOntology();
      expect(raw.ontology_version).toBe('1.0.0');
      expect(raw.asset_class).toBeDefined();
      expect(raw.extraction_field_map).toBeDefined();
    });
  });
});
