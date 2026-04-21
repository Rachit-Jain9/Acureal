import { computeDeal, SUPPORTED_ASSET_CLASSES } from '../src/registry';
import * as F from './fixtures';

const fixtures: Record<string, any> = {
  residential_apartments: (F as any).jiganiResidential,
  plotted_development: (F as any).plottedSample,
  commercial_office: (F as any).commercialSample,
  retail: (F as any).retailSample,
  industrial_warehousing: (F as any).industrialSample,
  hospitality: (F as any).hospitalitySample,
  villas: (F as any).villasSample,
  mixed_use: (F as any).mixedUseSample,
  redevelopment: (F as any).redevelopmentSample,
  land_parcel: (F as any).landParcelSample,
};

describe('smoke — all asset classes produce plausible output with debt', () => {
  for (const ac of SUPPORTED_ASSET_CLASSES) {
    test(`${ac}`, () => {
      const f = fixtures[ac];
      if (!f) { console.log(`${ac}: no fixture`); return; }
      const r = computeDeal({
        ...f,
        raw: {
          ...f.raw,
          debtLTV: 0.6, debtLTC: 0.65, debtRatePct: 11,
          debtTenorYears: 4, amortizationYears: 20,
          debtCoverage: 0.6, interestRatePct: 10,
        },
      });
      const fin = r.financing;
      const dscr = (r.kpis.extras as any).dscr;
      const ecr = (r.kpis.extras as any).exitCapRate;
      const line = `${ac.padEnd(24)} rev=${r.kpis.revenue.toNumber().toFixed(1)}Cr cost=${r.kpis.totalCost.toNumber().toFixed(1)}Cr debt=${fin ? fin.debtDrawn.toNumber().toFixed(1) : 'n/a'} int=${fin ? fin.debtInterest.toNumber().toFixed(2) : 'n/a'} dscr=${dscr == null ? 'null' : dscr.toFixed(2)} exitCap=${ecr == null ? 'null' : String(ecr)} irr=${r.kpis.irr == null ? 'null' : (r.kpis.irr as number).toFixed(2)}`;
      console.log(line);
      // Sanity: totals finite and non-negative.
      expect(r.kpis.totalCost.toNumber()).toBeGreaterThan(0);
      if (fin) {
        expect(fin.debtDrawn.toNumber()).toBeGreaterThan(0);
        expect(fin.debtInterest.toNumber()).toBeGreaterThanOrEqual(0);
        // Interest must not exceed principal × rate × full construction horizon
        // (guards the S-curve-capitalised against runaway compounding bugs).
        const rate = 11 / 100;
        const maxPlausible = fin.debtDrawn.toNumber() * rate * 10;
        expect(fin.debtInterest.toNumber()).toBeLessThan(maxPlausible);
      }
    });
  }
});
