import { describe, it, expect } from 'vitest';
import { computeSiteYield } from '../siteYield';
import { mapProgrammeToInputs } from '../programmeToInputs';

// Locks the producer -> consumer contract: a site-yield programme must flow
// cleanly into the financial-model prefill via mapProgrammeToInputs, with the
// right driver fields populated per asset class.

const ACRE = 43560;

const prefillFor = (assetClass, envelope, assumptions) => {
  const yld = computeSiteYield({ assetClass, envelope, assumptions });
  expect(yld.ok).toBe(true);
  return mapProgrammeToInputs({ assetClass, programme: yld.programme, buildability: yld.buildability });
};

describe('siteYield → mapProgrammeToInputs round-trip', () => {
  it('residential populates plot area, FSI, avg unit size, construction cost', () => {
    const out = prefillFor('residential_apartments', { land_sqft: ACRE, effective_fsi: 2.5 });
    expect(out.plotAreaSqft).toBe(String(ACRE));
    expect(out.totalLandSqft).toBe(String(ACRE));
    expect(out.fsi).toBe('2.5');
    expect(Number(out.avgUnitSizeSqft)).toBeGreaterThan(0);
    expect(Number(out.constructionCostPerSqft)).toBeGreaterThan(0);
    expect(out.__prefilledFrom).toBe('buildability');
  });

  it('commercial office populates leasable area + hard cost (canonical class)', () => {
    const out = prefillFor('commercial_office', { land_sqft: ACRE, effective_fsi: 3.0 });
    expect(Number(out.leasableSqft)).toBeGreaterThan(0);
    expect(Number(out.hardCostPerSqft)).toBeGreaterThan(0);
  });

  it('retail (canonical "retail", not "commercial_retail") is handled', () => {
    const out = prefillFor('retail', { land_sqft: ACRE, effective_fsi: 2.0 });
    expect(Number(out.leasableSqft)).toBeGreaterThan(0);
  });

  it('industrial_warehousing (canonical, not "industrial"/"warehousing") is handled', () => {
    const out = prefillFor('industrial_warehousing', { land_sqft: ACRE * 2, effective_fsi: 1.5 });
    expect(Number(out.leasableSqft)).toBeGreaterThan(0);
    expect(Number(out.hardCostPerSqft)).toBeGreaterThan(0);
  });

  it('plotted populates dev cost per sqft', () => {
    const out = prefillFor('plotted_development', { land_sqft: ACRE * 4 });
    expect(Number(out.devCostPerSqft)).toBeGreaterThan(0);
  });

  it('hospitality populates keys + per-key construction cost', () => {
    const out = prefillFor('hospitality', { land_sqft: ACRE, effective_fsi: 3.0 });
    expect(Number(out.keys)).toBeGreaterThan(0);
    expect(Number(out.constructionCostPerKey)).toBeGreaterThan(0);
  });

  it('villas carries a per-sqft construction cost (financial model = residential)', () => {
    const out = prefillFor('villas', { land_sqft: ACRE * 4 });
    expect(Number(out.constructionCostPerSqft)).toBeGreaterThan(0);
  });
});
