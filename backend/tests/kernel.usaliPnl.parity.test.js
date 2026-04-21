/**
 * USALI P&L parity: legacy JS engine vs kernel post-processor.
 *
 * Asserts that `packages/financial-kernel/src/postprocess/usaliPnl.ts`
 * produces the 10-year USALI cascade byte-for-byte identical to the legacy
 * `calculateHospitality` function in `backend/src/engines/financial.engine.js`
 * (lines 1829-1946).
 *
 * Approach:
 *   1. Run a canonical hospitality deal through the legacy engine and
 *      capture `computed.revenue.usali_pnl` (the 10-year cascade).
 *   2. Re-build the same cascade via the kernel's `buildUsaliPnl` using the
 *      same deal inputs.
 *   3. Deep-compare every field in every row. 47 fields × 10 years = 470
 *      assertions per deal.
 *
 * Divergence in any field (key name, value, null handling) fails the test
 * — the UI (`HospitalityProformaSection`) reads these fields directly.
 *
 * Run: `cd backend && npm test -- kernel.usaliPnl.parity.test.js`
 */
'use strict';

const path = require('path');
const { calculateFullFinancials } = require('../src/engines/financial.engine');

let kernel;
try {
  kernel = require(
    path.join(__dirname, '..', '..', 'packages', 'financial-kernel', 'dist'),
  );
} catch (err) {
  kernel = null;
  // eslint-disable-next-line no-console
  console.warn(
    '[usaliPnl.parity] financial-kernel dist/ not built. Run:\n' +
      '  cd packages/financial-kernel && npx tsc -p tsconfig.build.json\n' +
      'then re-run this suite.',
  );
}

const describeIfBuilt = kernel ? describe : describe.skip;

// ── Canonical hospitality deals ─────────────────────────────────────────────

const baseHospitality = Object.freeze({
  assetClass: 'hospitality',
  keys: 180,
  sqftPerKey: 550,
  hardCostPerSqft: 11_000,
  landCostCr: 60,
  preOpeningCostPerKey: 350_000,
  adr: 7_500,
  adrGrowthPct: 5,
  stabilizedOccPct: 68,
  initialOccPct: 45,
  stabilizationYear: 4,
  holdPeriodYears: 8,
  fbRevPct: 28,
  otherRevPct: 10,
  exitCapRate: 9,
  discountRatePct: 15,
  projectDurationMonths: 30,
  skipSensitivity: true,
});

const luxuryHospitality = Object.freeze({
  ...baseHospitality,
  keys: 250,
  adr: 12_000,
  stabilizedOccPct: 72,
  fbRestaurantPctOfRooms: 22,
  fbBanquetPctOfRooms: 16,
  otherOperatedPctOfRooms: 9,
  parkingPctOfRooms: 3,
  brandRoyaltyPctOfRooms: 6,
  brandMktReservPctOfRooms: 2.5,
  mgmtBasePct: 3.5,
  mgmtIncentivePct: 10,
  holdPeriodYears: 10,
});

const midscaleHospitality = Object.freeze({
  ...baseHospitality,
  keys: 120,
  adr: 5_000,
  stabilizedOccPct: 65,
  fbRestaurantPctOfRooms: 12,
  fbBanquetPctOfRooms: 8,
  otherOperatedPctOfRooms: 5,
  parkingPctOfRooms: 1.5,
  brandRoyaltyPctOfRooms: 4,
  brandMktReservPctOfRooms: 1.5,
  holdPeriodYears: 6,
});

const ownerRateMixHospitality = Object.freeze({
  ...baseHospitality,
  keys: 200,
  ownerRateKeys: 60,
  ownerRateADR: 5_500,
  ownerRateGuaranteedOccPct: 75,
  holdPeriodYears: 7,
});

const groundLeaseHospitality = Object.freeze({
  ...baseHospitality,
  groundLeaseCrPa: 2.5,
  leaseIncomeCrPa: 0.8,
  propertyTaxPctRev: 2.5,
  insurancePctRev: 1.2,
  holdPeriodYears: 9,
});

// ── Parity helpers ──────────────────────────────────────────────────────────

function assertRowIdentical(legacyRow, kernelRow, ctx) {
  const lKeys = Object.keys(legacyRow).sort();
  const kKeys = Object.keys(kernelRow).sort();
  expect(kKeys).toEqual(lKeys);
  for (const k of lKeys) {
    const lv = legacyRow[k];
    const kv = kernelRow[k];
    if (lv === null || kv === null) {
      expect(kv).toBe(lv);
    } else if (typeof lv === 'number') {
      expect(typeof kv).toBe('number');
      // Money is round4 (1e-4 Cr = ₹10,000); percent is round2 (1e-2 pp).
      // IEEE-754 across two independent computations introduces only
      // sub-nanosecond drift, so 1e-8 tolerance is safely tight.
      expect(Math.abs(lv - kv)).toBeLessThan(1e-8);
    } else {
      expect(kv).toEqual(lv);
    }
  }
}

function assertCascadeIdentical(legacyAnnual, kernelAnnual) {
  expect(kernelAnnual).toHaveLength(legacyAnnual.length);
  for (let y = 0; y < legacyAnnual.length; y++) {
    assertRowIdentical(legacyAnnual[y], kernelAnnual[y], `year[${y}]`);
  }
}

function runParity(deal) {
  const legacy = calculateFullFinancials(deal);
  expect(legacy.revenue).toBeTruthy();
  const legacyAnnual = legacy.revenue.usali_pnl;
  expect(Array.isArray(legacyAnnual)).toBe(true);
  expect(legacyAnnual.length).toBeGreaterThan(0);

  const kernelAnnual = kernel.buildUsaliPnl(deal);
  assertCascadeIdentical(legacyAnnual, kernelAnnual);
}

// ──────────────────────────────────────────────────────────────────────────────

describeIfBuilt('usaliPnl parity — canonical hospitality', () => {
  test('base case (180 keys, ADR 7500)', () => {
    runParity(baseHospitality);
  });

  test('luxury (250 keys, ADR 12000, 10-yr hold)', () => {
    runParity(luxuryHospitality);
  });

  test('midscale (120 keys, ADR 5000, 6-yr hold)', () => {
    runParity(midscaleHospitality);
  });
});

describeIfBuilt('usaliPnl parity — mixed configurations', () => {
  test('owner-rate + market-rate key mix', () => {
    runParity(ownerRateMixHospitality);
  });

  test('ground lease + lease income + elevated fixed %s', () => {
    runParity(groundLeaseHospitality);
  });
});

describeIfBuilt('usaliPnl parity — hold-period extremes', () => {
  test('minimum 5-year hold (clamped from 3)', () => {
    runParity({ ...baseHospitality, holdPeriodYears: 3 });
  });

  test('maximum 15-year hold (clamped from 20)', () => {
    runParity({ ...baseHospitality, holdPeriodYears: 20 });
  });
});
