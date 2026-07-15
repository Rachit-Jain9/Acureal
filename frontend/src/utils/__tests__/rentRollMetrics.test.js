import { describe, it, expect } from 'vitest';
// Import the mirror as a LIVE ES module — the exact evaluation path the browser
// takes when the Rent Roll tab lazy-loads it. If the file ever carries a
// CommonJS artifact (a stray `module.exports`, `require`, `process`), this
// import throws "module is not defined" at eval time and fails here instead of
// crashing the page. (A prior regression shipped exactly that; the backend
// parity test reads the file as text under a Node shim and could not catch it.)
import {
  computeLeaseMetrics,
  computeSaleMetrics,
  fyLabel,
  parseDate,
  monthlyBaseRentPaise,
  toLeaseExtract,
} from '../rentRollMetrics';

const AS_OF = '2026-07-14';
const PARENT = { as_of_date: AS_OF, total_leasable_area_sqft: 100000, settings: {} };
const FIXTURE = [
  {
    id: 1, status: 'occupied', tenant_name: 'Anchor', rent_basis: 'per_sqft_month',
    chargeable_area_sqft: 40000, base_rent_rate: 100, cam_treatment: 'owner_borne',
    lease_expiry: '2031-03-31', market_rent_rate: 120, collection_pct: 100,
  },
  { id: 2, status: 'vacant', rent_basis: 'per_sqft_month', chargeable_area_sqft: 60000, base_rent_rate: 90, market_rent_rate: 95 },
];

describe('rentRollMetrics (frontend ESM mirror) evaluates in a browser-like module', () => {
  it('imports and computes without a CommonJS reference error', () => {
    const m = computeLeaseMetrics(FIXTURE, PARENT);
    expect(m.occupancy.physicalPct).toBeCloseTo(40, 6);
    expect(m.revenue.contractedAnnualGross).toBeCloseTo(48000000, 2);
    // Vacant row feeds ERV only, never contracted revenue.
    expect(m.revenue.ervVacantAnnual).toBeCloseTo(68400000, 2);
  });

  it('per-record helpers work', () => {
    expect(fyLabel(parseDate('2027-04-01'))).toBe('FY28');
    expect(monthlyBaseRentPaise(FIXTURE[0])).toBe(400000000);
    expect(toLeaseExtract(FIXTURE, { asOf: AS_OF })).toHaveLength(1);
  });

  it('computeSaleMetrics evaluates (sales family)', () => {
    const m = computeSaleMetrics([
      { id: 1, status: 'sold', area_sqft: 1000, agreement_value: 5000000, amount_collected: 4000000 },
      { id: 2, status: 'unsold', area_sqft: 1200, base_price_per_sqft: 6900, current_market_rate: 8000 },
    ], { as_of_date: AS_OF, settings: {} });
    expect(m.collections.receivable).toBeCloseTo(1000000, 2);
    expect(m.unsold.unsoldMtmPct).toBeCloseTo((8000 / 6900 - 1) * 100, 6);
  });
});
