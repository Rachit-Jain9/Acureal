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
import { computeDeal } from '../src/registry';
import type { AssetClass } from '../src/types';
import { allFixtures } from './fixtures';

const headlineIrr = (assetClass: AssetClass, raw: Readonly<Record<string, unknown>>): number | null =>
  computeDeal({ assetClass, raw: { ...raw, skipSensitivity: true } }).kpis.irr;

const centre = (grid: readonly (readonly (number | null)[])[]): number | null => {
  const r = Math.floor(grid.length / 2);
  const row = grid[r] ?? [];
  return row[Math.floor(row.length / 2)] ?? null;
};

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
    // Was the absolute ladder ['5%','6%','7%','8%','9%'], on which this
    // 7.5% deal had no row of its own. Now ±100 bps around the deal.
    expect(out.variations).toEqual(['6.5%', '7%', '7.5%', '8%', '8.5%']);
    expect(out.constructionCosts[2]).toBe(allFixtures.commercial_office.raw.exitCapRate);
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

/**
 * The load-bearing property of every grid this module emits.
 *
 * `export.insights.service.js`, `docx/buildReport.js`, `pptx/slides.js`
 * and `reportPack/composePack.js` all read `irrGrid[mid][mid]` and print
 * it as "Base IRR". If that cell is not the deal, an IC reads one number
 * on the KPI tile and a different, rosier one at the centre of the grid
 * beside it — which is exactly what income and hospitality did before
 * they were moved onto the kernel: +1.2 to +3.5 points, always
 * optimistic, because they ran their own simplified projections.
 */
describe('INVARIANT: the centre of the grid is the deal', () => {
  const MATRIX_CLASSES = [
    'residential_apartments',
    'villas',
    'redevelopment',
    'mixed_use',
    'plotted_development',
    'commercial_office',
    'retail',
    'industrial_warehousing',
    'hospitality',
  ] as const;

  it.each(MATRIX_CLASSES)('%s — centre cell === headline IRR', (assetClass) => {
    const { raw } = allFixtures[assetClass];
    const headline = headlineIrr(assetClass, raw);
    const out = buildSensitivityMatrix({ raw, assetClass });

    expect(out).not.toBeNull();
    // Exact, not approximate: the grid re-runs the same kernel on the
    // same inputs, so anything other than equality means a cell is
    // pricing a different deal.
    expect(centre(out!.irrGrid)).toBe(headline);
  });

  it('is not passing vacuously — the fixtures really do produce IRRs', () => {
    // `null === null` satisfies the assertion above, so a fixture set
    // that stopped computing would turn the whole suite green and
    // meaningless. The `villas` fixture is a known exception: it pairs
    // the flagship ₹155 Cr Jigani land cost with an FSI of 0.8, which
    // yields ₹28 Cr of revenue against ₹254 Cr of cost. Every cash flow
    // is negative, there is no sign change, and the IRR is legitimately
    // null. That fixture is worth revisiting on its own — it means the
    // villas golden tests exercise a deal no one would underwrite — but
    // it is not this module's bug to fix.
    const withIrr = MATRIX_CLASSES.filter(
      (ac) => headlineIrr(ac, allFixtures[ac].raw) != null,
    );
    expect(withIrr).toEqual(MATRIX_CLASSES.filter((ac) => ac !== 'villas'));
  });

  it('holds for non-integer inputs (the axis must not round the centre tick)', () => {
    // Off-centre ticks are rounded for legibility. Rounding the CENTRE
    // tick would price ₹9,488/sqft against a deal underwritten at
    // ₹9,487.50 — close enough to look right, wrong enough to be a
    // different number from the KPI tile.
    const raw = {
      ...allFixtures.residential_apartments.raw,
      sellingRatePerSqft: 9487.5,
      constructionCostPerSqft: 2612.25,
    };
    const out = buildResidentialSensitivity({ raw, assetClass: 'residential_apartments' });

    expect(out.sellingRates[4]).toBe(9487.5);
    expect(out.constructionCosts[4]).toBe(2612.25);
    expect(centre(out.irrGrid)).toBe(headlineIrr('residential_apartments', raw));
  });

  it('holds for a non-integer income cap rate', () => {
    const raw = {
      ...allFixtures.commercial_office.raw,
      exitCapRate: 7.35,
      baseRentPerSqftMonth: 94.75,
    };
    const out = buildIncomeSensitivity({ raw, assetClass: 'commercial_office' });

    expect(out.constructionCosts[2]).toBe(7.35);
    expect(out.sellingRates[2]).toBe(94.75);
    expect(centre(out.irrGrid)).toBe(headlineIrr('commercial_office', raw));
  });

  it('holds for each hospitality strip, not just the occupancy × ADR grid', () => {
    const { raw } = allFixtures.hospitality;
    const headline = headlineIrr('hospitality', raw);
    const out = buildHospSensitivity({ raw, assetClass: 'hospitality' });

    // Index 2 is the 0% / 0 bps tick on all three — the deal, unvaried.
    expect(out.hardCost.irr[2]).toBe(headline);
    expect(out.interestRate.irr[2]).toBe(headline);
    expect(out.capRate.irr[2]).toBe(headline);
    expect(centre(out.occAdr.irrGrid)).toBe(headline);
  });

  it('holds when hard cost is expressed per key rather than per sqft', () => {
    // Hotels are budgeted per key, so most deals carry only
    // `constructionCostPerKey`. The hard-cost strip varies
    // `hardCostPerSqft`, so it has to reproduce the kernel's per-key →
    // per-sqft conversion or its 0% tick prices a different hotel.
    const { raw } = allFixtures.hospitality;
    expect(raw.constructionCostPerKey).toBeGreaterThan(0);
    expect(raw.hardCostPerSqft).toBeUndefined();

    const out = buildHospSensitivity({ raw, assetClass: 'hospitality' });
    expect(out.hardCost.irr[2]).toBe(headlineIrr('hospitality', raw));
    // …and the strip still bites in both directions.
    expect(out.hardCost.irr[0]).not.toBe(out.hardCost.irr[2]);
    expect(out.hardCost.irr[4]).not.toBe(out.hardCost.irr[2]);
  });

  it('keeps the deal on the axis even at an unusually high occupancy', () => {
    // Off-centre occupancy ticks clamp to 40–90%. The centre tick must
    // not: a hotel underwritten at 95% stabilised occupancy would
    // otherwise have its own grid centred on a 90% hotel.
    const raw = { ...allFixtures.hospitality.raw, stabilizedOccPct: 95 };
    const out = buildHospSensitivity({ raw, assetClass: 'hospitality' });

    expect(out.occAdr.rows[2]).toBe(95);
    expect(centre(out.occAdr.irrGrid)).toBe(headlineIrr('hospitality', raw));
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
