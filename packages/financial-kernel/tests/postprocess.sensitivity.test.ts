/**
 * Unit tests for the sensitivity post-processor.
 *
 * Covers shape parity with the legacy JS engine readers
 * (`frontend/src/components/financials/SensitivityMatrix.jsx`) plus
 * directional monotonicity sanity checks — e.g. IRR must decrease when
 * construction cost rises holding selling rate fixed.
 */

import {
  buildSensitivityMatrix,
  buildResidentialSensitivity,
  buildPlottedSensitivity,
  buildIncomeSensitivity,
  buildHospSensitivity,
} from '../src/postprocess/sensitivity';
import { allFixtures } from './fixtures';

describe('buildResidentialSensitivity', () => {
  const out = buildResidentialSensitivity({
    raw: allFixtures.residential_apartments.raw,
    assetClass: 'residential_apartments',
  });

  it('returns a 9×9 matrix with the legacy shape', () => {
    expect(out.sellingRates).toHaveLength(9);
    expect(out.constructionCosts).toHaveLength(9);
    expect(out.irrGrid).toHaveLength(9);
    out.irrGrid.forEach((row) => expect(row).toHaveLength(9));
    expect(out.axis).toEqual(['Constr. Cost/sqft', 'Selling Rate/sqft']);
    expect(out.variations).toHaveLength(9);
    expect(out.variations[0]).toBe('-20%');
    expect(out.variations[4]).toBe('0%');
    expect(out.variations[8]).toBe('+20%');
  });

  it('is monotonic in selling rate (rows non-decreasing)', () => {
    // Hold construction fixed (middle row), selling rate varies left→right
    // IRR should never decrease as selling rate rises.
    const midRow = out.irrGrid[4];
    const vals = midRow.filter((v): v is number => v != null);
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i] + 1e-6).toBeGreaterThanOrEqual(vals[i - 1]);
    }
  });

  it('is monotonic in construction cost (columns non-increasing)', () => {
    // Hold selling rate fixed (middle column), construction cost rises top→bottom.
    const midCol = out.irrGrid.map((row) => row[4]);
    const vals = midCol.filter((v): v is number => v != null);
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeLessThanOrEqual(vals[i - 1] + 1e-6);
    }
  });
});

describe('buildPlottedSensitivity', () => {
  it('returns a 9×9 matrix with Dev. Cost axis', () => {
    const out = buildPlottedSensitivity({
      raw: allFixtures.plotted_development.raw,
      assetClass: 'plotted_development',
    });
    expect(out.axis).toEqual(['Dev. Cost/sqft', 'Selling Rate/sqft']);
    expect(out.constructionCosts).toHaveLength(9);
    expect(out.irrGrid).toHaveLength(9);
  });
});

describe('buildIncomeSensitivity', () => {
  it('returns a 5×5 matrix with cap-rate rows', () => {
    const out = buildIncomeSensitivity({
      raw: allFixtures.commercial_office.raw,
      assetClass: 'commercial_office',
    });
    expect(out.axis).toEqual(['Exit Cap Rate (%)', 'Base Rent/sqft/mo']);
    expect(out.sellingRates).toHaveLength(5); // rents
    expect(out.constructionCosts).toHaveLength(5); // cap rates
    expect(out.variations).toEqual(['5%', '6%', '7%', '8%', '9%']);
  });

  it('IRR decreases as cap rate widens (row 0 ≥ row 4 on same column)', () => {
    const out = buildIncomeSensitivity({
      raw: allFixtures.commercial_office.raw,
      assetClass: 'commercial_office',
    });
    const col = 2;
    const top = out.irrGrid[0][col];
    const bot = out.irrGrid[4][col];
    if (top != null && bot != null) {
      expect(top).toBeGreaterThanOrEqual(bot - 1e-6);
    }
  });
});

describe('buildHospSensitivity', () => {
  const out = buildHospSensitivity({
    raw: allFixtures.hospitality.raw,
    assetClass: 'hospitality',
  });

  it('emits occAdr, hardCost, interestRate, capRate sub-blocks', () => {
    expect(out).toHaveProperty('occAdr');
    expect(out).toHaveProperty('hardCost');
    expect(out).toHaveProperty('interestRate');
    expect(out).toHaveProperty('capRate');
    expect(out.occAdr.irrGrid).toHaveLength(5);
    expect(out.occAdr.rowLabel).toBe('Occupancy (%)');
    expect(out.occAdr.colLabel).toBe('ADR (₹)');
  });

  it('hardCost / interestRate / capRate arrays have 5 entries each', () => {
    expect(out.hardCost.irr).toHaveLength(5);
    expect(out.hardCost.variations).toEqual(['-15%', '-10%', '+0%', '+10%', '+15%']);
    expect(out.interestRate.irr).toHaveLength(5);
    expect(out.interestRate.variations).toEqual([
      '-150 bps',
      '-75 bps',
      '+0 bps',
      '+75 bps',
      '+150 bps',
    ]);
    expect(out.capRate.irr).toHaveLength(5);
  });
});

describe('buildSensitivityMatrix dispatcher', () => {
  it.each([
    ['residential_apartments', 9],
    ['villas', 9],
    ['redevelopment', 9],
    ['mixed_use', 9], // routed to residential in the kernel
    ['plotted_development', 9],
    ['commercial_office', 5],
    ['retail', 5],
    ['industrial_warehousing', 5],
    ['hospitality', 5],
  ] as const)('%s → %d×%d matrix', (assetClass, size) => {
    const fixture = allFixtures[assetClass];
    const out = buildSensitivityMatrix({ raw: fixture.raw, assetClass });
    expect(out).not.toBeNull();
    if (out) {
      expect(out.irrGrid).toHaveLength(size);
    }
  });

  it('land_parcel returns null', () => {
    const out = buildSensitivityMatrix({
      raw: allFixtures.land_parcel.raw,
      assetClass: 'land_parcel',
    });
    expect(out).toBeNull();
  });
});

describe('sensitivity — defensive fallbacks', () => {
  it('empty residential inputs return an empty grid', () => {
    const out = buildResidentialSensitivity({
      raw: { landCostCr: 10 }, // missing construction / selling
      assetClass: 'residential_apartments',
    });
    expect(out.sellingRates).toHaveLength(0);
    expect(out.irrGrid).toHaveLength(0);
  });

  it('empty income inputs return an empty grid', () => {
    const out = buildIncomeSensitivity({
      raw: {}, // missing leasable / rent
      assetClass: 'commercial_office',
    });
    expect(out.irrGrid).toHaveLength(0);
  });
});
