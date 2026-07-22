/**
 * Tests for `config/defaults.ts` — the single source-of-truth defaults registry.
 *
 * Asserts:
 *   - Every asset class has a defaults block (10 classes).
 *   - Every metadata entry has value, unit, source, description, lastReviewed.
 *   - Numeric values fall within declared ranges.
 *   - The value-only projections (backward-compat with assumptions.ts) match
 *     the metadata values byte-for-byte.
 *   - `resolveAssumptions` → `ASSET_DEFAULTS[cls]` merge preserves every
 *     historical value, so the kernel's hospitality + income adapters see
 *     the same resolved inputs they did before the refactor.
 *   - Accessors throw on unknown keys.
 */

import {
  GLOBAL_DEFAULTS_META,
  GLOBAL_DEFAULTS_VALUES,
  ASSET_DEFAULTS_META,
  ASSET_DEFAULTS_VALUES,
  SUPPORTED_ASSET_CLASSES,
  getAssetDefaultsMeta,
  getDefaultMeta,
  getDefaultValue,
  listDefaultKeys,
} from '../src/config/defaults';
import { GLOBAL_DEFAULTS, ASSET_DEFAULTS } from '../src/assumptions';
import type { AssetClass } from '../src/types';

const ALL_CLASSES: readonly AssetClass[] = [
  'residential_apartments',
  'villas',
  'plotted_development',
  'commercial_office',
  'retail',
  'industrial_warehousing',
  'hospitality',
  'mixed_use',
  'land_parcel',
  'redevelopment',
];

describe('config/defaults — registry shape', () => {
  test('covers every AssetClass (10 classes)', () => {
    expect(SUPPORTED_ASSET_CLASSES).toHaveLength(ALL_CLASSES.length);
    for (const cls of ALL_CLASSES) {
      expect(SUPPORTED_ASSET_CLASSES).toContain(cls);
      expect(ASSET_DEFAULTS_META[cls]).toBeTruthy();
    }
  });

  test('every global metadata entry is well-formed', () => {
    for (const [key, meta] of Object.entries(GLOBAL_DEFAULTS_META)) {
      expect(meta.value).not.toBeUndefined();
      expect(meta.unit).toBeTruthy();
      expect(meta.source).toBeTruthy();
      expect(meta.description).toBeTruthy();
      // ISO date format YYYY-MM-DD.
      expect(meta.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Source should be meaningfully attributed (> 10 chars).
      expect(meta.source.length).toBeGreaterThan(10);
      // Key must have description beyond the key name.
      expect(meta.description.length).toBeGreaterThan(10);
      // Mark key as accessed to keep lint quiet.
      expect(key).toBeTruthy();
    }
  });

  test('every asset-class metadata entry is well-formed', () => {
    for (const cls of ALL_CLASSES) {
      const block = ASSET_DEFAULTS_META[cls];
      for (const [key, meta] of Object.entries(block)) {
        expect(meta.value).not.toBeUndefined();
        expect(meta.unit).toBeTruthy();
        expect(meta.source).toBeTruthy();
        expect(meta.description).toBeTruthy();
        expect(meta.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(key).toBeTruthy();
      }
    }
  });

  test('numeric values fall within their declared ranges', () => {
    const allBlocks: [string, typeof GLOBAL_DEFAULTS_META][] = [
      ['GLOBAL', GLOBAL_DEFAULTS_META],
      ...ALL_CLASSES.map(
        (cls) => [cls, ASSET_DEFAULTS_META[cls]] as [string, typeof GLOBAL_DEFAULTS_META],
      ),
    ];
    for (const [ctx, block] of allBlocks) {
      for (const [key, meta] of Object.entries(block)) {
        if (meta.range && typeof meta.value === 'number') {
          const [min, max] = meta.range;
          expect({ ctx, key, value: meta.value, min, max }).toEqual(
            expect.objectContaining({
              value: expect.any(Number),
            }),
          );
          expect(meta.value).toBeGreaterThanOrEqual(min);
          expect(meta.value).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  test('every block is frozen (immutable)', () => {
    expect(Object.isFrozen(GLOBAL_DEFAULTS_META)).toBe(true);
    expect(Object.isFrozen(ASSET_DEFAULTS_META)).toBe(true);
    for (const cls of ALL_CLASSES) {
      expect(Object.isFrozen(ASSET_DEFAULTS_META[cls])).toBe(true);
    }
  });
});

describe('config/defaults — value projections', () => {
  test('GLOBAL_DEFAULTS_VALUES matches GLOBAL_DEFAULTS_META numeric fields', () => {
    for (const [k, meta] of Object.entries(GLOBAL_DEFAULTS_META)) {
      if (typeof meta.value === 'number') {
        expect(GLOBAL_DEFAULTS_VALUES[k]).toBe(meta.value);
      }
    }
  });

  test('ASSET_DEFAULTS_VALUES matches ASSET_DEFAULTS_META per-class', () => {
    for (const cls of ALL_CLASSES) {
      const meta = ASSET_DEFAULTS_META[cls];
      const values = ASSET_DEFAULTS_VALUES[cls];
      for (const [k, m] of Object.entries(meta)) {
        if (typeof m.value === 'number') {
          expect(values[k]).toBe(m.value);
        }
      }
    }
  });

  test('assumptions.ts re-exports point at the registry (no drift)', () => {
    // Backward-compat guarantee: existing import sites (kernel adapters,
    // inputSchema, parity tests) reading from `assumptions` see the same
    // shapes as before the refactor.
    expect(GLOBAL_DEFAULTS).toBe(GLOBAL_DEFAULTS_VALUES);
    for (const cls of ALL_CLASSES) {
      expect(ASSET_DEFAULTS[cls]).toBe(ASSET_DEFAULTS_VALUES[cls]);
    }
  });
});

describe('config/defaults — legacy parity values preserved', () => {
  // These assertions protect the hospitality kernel parity gate. The kernel's
  // num() fallbacks (assets/hospitality.ts) require these exact values;
  // drifting from them silently breaks backend/tests/kernel.parity.test.js.
  test('hospitality kernel-simplified defaults match legacy', () => {
    const h = ASSET_DEFAULTS_VALUES.hospitality;
    expect(h.fbRevPct).toBe(30);
    expect(h.otherRevPct).toBe(9);
    expect(h.gopMarginPct).toBe(30);
    expect(h.ebitdaMarginPct).toBe(22);
    expect(h.stabilizedOccPct).toBe(65);
    expect(h.adrGrowthPct).toBe(5);
    expect(h.adr).toBe(8500);
    expect(h.sqftPerKey).toBe(550);
    expect(h.keys).toBe(200);
    expect(h.exitCapRatePct).toBe(9);
    expect(h.discountRatePct).toBe(15);
  });

  test('hospitality USALI-cascade defaults match legacy post-processor', () => {
    const h = ASSET_DEFAULTS_VALUES.hospitality;
    // These match the usaliPnl.ts post-processor's byte-for-byte parity
    // with legacy financial.engine.js:1829-1946.
    expect(h.fbRestaurantPctOfRooms).toBe(18);
    expect(h.fbBanquetPctOfRooms).toBe(12);
    expect(h.otherOperatedPctOfRooms).toBe(7);
    expect(h.parkingPctOfRooms).toBe(2);
    expect(h.roomsDeptCostPct).toBe(28);
    expect(h.fbDeptCostPct).toBe(75);
    expect(h.otherDeptCostPct).toBe(52);
    expect(h.aAndGPct).toBe(7.5);
    expect(h.itPct).toBe(2.0);
    expect(h.smPct).toBe(5.5);
    expect(h.pomPct).toBe(4.5);
    expect(h.utilitiesPct).toBe(5.0);
    expect(h.mgmtBasePct).toBe(3.0);
    expect(h.mgmtIncentivePct).toBe(9.0);
    expect(h.brandRoyaltyPctOfRooms).toBe(5.0);
    expect(h.brandMktReservPctOfRooms).toBe(2.0);
    expect(h.propertyTaxPctRev).toBe(2.0);
    expect(h.insurancePctRev).toBe(1.0);
    expect(h.ffeReservePct).toBe(4.0);
    expect(h.preOpeningCostPerKey).toBe(350_000);
    expect(h.initialOccPct).toBe(45);
    expect(h.stabilizationYear).toBe(4);
  });

  test('plotted_development GST + saleable land overrides', () => {
    const p = ASSET_DEFAULTS_VALUES.plotted_development;
    // 18% since the Sept-2025 GST rate rationalization retired the 12%
    // services slab (development-component works; land stays outside GST).
    expect(p.gstOnConstructionPct).toBe(18);
    expect(p.saleableLandPct).toBe(55);
  });

  test('income-asset overrides match legacy', () => {
    expect(ASSET_DEFAULTS_VALUES.commercial_office.vacancyPct).toBe(10);
    expect(ASSET_DEFAULTS_VALUES.commercial_office.exitCapRatePct).toBe(7.5);
    expect(ASSET_DEFAULTS_VALUES.retail.vacancyPct).toBe(12);
    expect(ASSET_DEFAULTS_VALUES.retail.anchorPct).toBe(40);
    expect(ASSET_DEFAULTS_VALUES.retail.anchorRentDiscount).toBe(20);
    expect(ASSET_DEFAULTS_VALUES.retail.exitCapRatePct).toBe(8);
    expect(ASSET_DEFAULTS_VALUES.industrial_warehousing.vacancyPct).toBe(8);
    expect(ASSET_DEFAULTS_VALUES.industrial_warehousing.opexPct).toBe(15);
    expect(ASSET_DEFAULTS_VALUES.industrial_warehousing.exitCapRatePct).toBe(8.5);
  });

  test('villas preserves legacy FSI + loading override', () => {
    expect(ASSET_DEFAULTS_VALUES.villas.fsi).toBe(0.8);
    expect(ASSET_DEFAULTS_VALUES.villas.loadingFactor).toBe(0.05);
  });

  test('land_parcel preserves legacy 0% GST + 5% stamp', () => {
    expect(ASSET_DEFAULTS_VALUES.land_parcel.gstOnConstructionPct).toBe(0);
    expect(ASSET_DEFAULTS_VALUES.land_parcel.stampDutyPct).toBe(5);
  });

  test('globals preserve legacy baseline values', () => {
    expect(GLOBAL_DEFAULTS_VALUES.stampDutyPct).toBe(5);
    // 2% since Aug 2025 — Karnataka doubled the registration fee (first
    // revision since 2003).
    expect(GLOBAL_DEFAULTS_VALUES.registrationPct).toBe(2);
    expect(GLOBAL_DEFAULTS_VALUES.gstOnConstructionPct).toBe(18);
    expect(GLOBAL_DEFAULTS_VALUES.marketingCostPct).toBe(4);
    expect(GLOBAL_DEFAULTS_VALUES.financeCostPct).toBe(12);
    expect(GLOBAL_DEFAULTS_VALUES.architectFeePct).toBe(2);
    expect(GLOBAL_DEFAULTS_VALUES.pmcFeePct).toBe(1.5);
    expect(GLOBAL_DEFAULTS_VALUES.contingencyPct).toBe(5);
    expect(GLOBAL_DEFAULTS_VALUES.developerMarginPct).toBe(20);
    expect(GLOBAL_DEFAULTS_VALUES.discountRatePct).toBe(14);
    expect(GLOBAL_DEFAULTS_VALUES.loadingFactor).toBeCloseTo(0.15, 5);
    expect(GLOBAL_DEFAULTS_VALUES.carpetRatio).toBeCloseTo(0.7, 5);
    expect(GLOBAL_DEFAULTS_VALUES.vacancyPct).toBe(10);
    expect(GLOBAL_DEFAULTS_VALUES.opexPct).toBe(20);
    expect(GLOBAL_DEFAULTS_VALUES.rentEscalationPct).toBe(5);
    expect(GLOBAL_DEFAULTS_VALUES.exitCapRatePct).toBe(8);
    expect(GLOBAL_DEFAULTS_VALUES.entryCapRatePct).toBe(8);
    expect(GLOBAL_DEFAULTS_VALUES.holdPeriodYears).toBe(5);
    expect(GLOBAL_DEFAULTS_VALUES.landAppreciationPct).toBe(8);
  });
});

describe('config/defaults — accessors', () => {
  test('getAssetDefaultsMeta returns the per-class block', () => {
    const block = getAssetDefaultsMeta('hospitality');
    expect(block).toBe(ASSET_DEFAULTS_META.hospitality);
  });

  test('getDefaultMeta resolves asset-first, then global', () => {
    // Global-only.
    const stamp = getDefaultMeta('commercial_office', 'stampDutyPct');
    expect(stamp.value).toBe(5);
    expect(stamp.unit).toBe('pct');

    // Asset override wins over global (retail vacancyPct = 12, global = 10).
    const retailVac = getDefaultMeta('retail', 'vacancyPct');
    expect(retailVac.value).toBe(12);

    // Asset-only (plotted saleableLandPct has no global).
    const plotSaleable = getDefaultMeta('plotted_development', 'saleableLandPct');
    expect(plotSaleable.value).toBe(55);
  });

  test('getDefaultMeta throws on unknown key', () => {
    expect(() => getDefaultMeta('hospitality', 'bogusFieldXYZ')).toThrow(
      /No default registered/,
    );
  });

  test('getDefaultValue returns plain number and throws on non-numeric', () => {
    expect(getDefaultValue('retail', 'vacancyPct')).toBe(12);
    expect(getDefaultValue('hospitality', 'adr')).toBe(8500);
    expect(() => getDefaultValue('hospitality', 'bogus')).toThrow();
  });

  test('listDefaultKeys returns unique sorted keys', () => {
    const keys = listDefaultKeys('hospitality');
    expect(keys.length).toBeGreaterThan(25);
    // Includes globals.
    expect(keys).toContain('stampDutyPct');
    // Includes hospitality-specific.
    expect(keys).toContain('adr');
    expect(keys).toContain('ffeReservePct');
    // Sorted.
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    // No duplicates.
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('config/defaults — provenance completeness', () => {
  test('every entry cites a source with last-reviewed date', () => {
    // Aggregate all entries and ensure coverage.
    const allEntries: Array<[string, string, string]> = [];
    for (const [k, m] of Object.entries(GLOBAL_DEFAULTS_META)) {
      allEntries.push(['GLOBAL', k, m.source]);
    }
    for (const cls of ALL_CLASSES) {
      for (const [k, m] of Object.entries(ASSET_DEFAULTS_META[cls])) {
        allEntries.push([cls, k, m.source]);
      }
    }
    expect(allEntries.length).toBeGreaterThan(50);
    for (const [ctx, key, source] of allEntries) {
      expect({ ctx, key, source: source.length }).toEqual(
        expect.objectContaining({ source: expect.any(Number) }),
      );
      expect(source.length).toBeGreaterThan(10);
    }
  });

  test('every asset-class block has at least one defined default', () => {
    for (const cls of ALL_CLASSES) {
      const keys = Object.keys(ASSET_DEFAULTS_META[cls]);
      expect(keys.length).toBeGreaterThan(0);
    }
  });
});
