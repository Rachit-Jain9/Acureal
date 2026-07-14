'use strict';

// Golden-fixture tests for the deterministic register metrics.
//
// Every expected value below is HAND-COMPUTED from first principles (day
// counts, paise arithmetic) and annotated inline — the fixture is the
// contract. If a formula change moves one of these numbers, that is a
// deliberate metric redefinition, not a refactor.

const {
  METRICS_VERSION,
  fyLabel,
  parseDate,
  monthlyBaseRentPaise,
  securityDeposit,
  nextEscalation,
  effectiveRentRate,
  renewalBand,
  creditBand,
  waleBand,
  computeLeaseMetrics,
  validateLeaseRoll,
  toLeaseExtract,
} = require('../src/utils/rentRollMetrics');

const AS_OF = '2026-07-14';

// ── Golden fixture: office register, 5 leases, as of 2026-07-14 ─────────────
// Parent denominator 100,000 sqft. Row areas sum to exactly 100,000.
const PARENT = {
  as_of_date: AS_OF,
  total_leasable_area_sqft: 100000,
  settings: {}, // loi_policy defaults to 'include'
};

const L1_ANCHOR = {
  id: 1,
  status: 'occupied',
  tenant_name: 'Anchor Tech Ltd',
  rent_basis: 'per_sqft_month',
  chargeable_area_sqft: 40000,
  base_rent_rate: 100,          // ₹4,000,000/mo
  cam_rate: 20,
  cam_treatment: 'recovery',    // CAM billed & retained: +₹9,600,000/yr gross, offset in expenses
  escalation_pct: 15,
  escalation_every_months: 36,
  lease_start: '2024-01-01',
  rent_commencement: '2024-04-01',
  lease_expiry: '2031-03-31',   // 1,721 days from as-of
  lockin_end: '2029-03-31',     // 991 days from as-of
  market_rent_rate: 120,
  owner_opex_annual: 2400000,
  collection_pct: 98,
  deposit_months: 6,            // derived deposit ₹24,000,000
  security_deposit_amount: 26000000, // actual differs by 8.3% → mismatch flag
};

const L2_MID = {
  id: 2,
  status: 'committed',          // executed, not yet commenced — contracted, not physical
  tenant_name: 'Mid Corp',
  rent_basis: 'per_sqft_month',
  chargeable_area_sqft: 20000,
  base_rent_rate: 110,          // ₹2,200,000/mo
  cam_treatment: 'owner_borne',
  lease_expiry: '2033-06-30',   // 2,543 days from as-of
  market_rent_rate: 115,
  owner_opex_annual: 1200000,
  collection_pct: 100,
  deposit_months: 6,            // derived deposit ₹13,200,000
};

const L3_VACANT = {
  id: 3,
  status: 'vacant',
  rent_basis: 'per_sqft_month',
  chargeable_area_sqft: 25000,
  base_rent_rate: 120,          // deliberately set — must NOT enter contracted revenue
  market_rent_rate: 125,        // ERV ₹37,500,000/yr
};

const L4_LOI = {
  id: 4,
  status: 'loi',
  tenant_name: 'LOI Retail',
  rent_basis: 'per_sqft_month',
  chargeable_area_sqft: 10000,
  base_rent_rate: 105,
  lease_expiry: '2029-12-31',
};

const L5_SMALL = {
  id: 5,
  status: 'occupied',
  tenant_name: 'Small Co',
  rent_basis: 'per_sqft_month',
  chargeable_area_sqft: 5000,
  base_rent_rate: 90,           // ₹450,000/mo
  market_rent_rate: 100,
  // no expiry → excluded from WALE/ladder (excluded.missingExpiry)
  // no collection_pct → cash factor defaults to 100%
};

const FIXTURE = [L1_ANCHOR, L2_MID, L3_VACANT, L4_LOI, L5_SMALL];

describe('rentRollMetrics — golden office fixture', () => {
  const m = computeLeaseMetrics(FIXTURE, PARENT);

  test('carries version + as-of + counts', () => {
    expect(m.metricsVersion).toBe(METRICS_VERSION);
    expect(m.asOf).toBe(AS_OF);
    expect(m.counts).toEqual({ total: 5, contracted: 3, vacant: 1, loi: 1 });
    expect(m.excluded).toEqual({
      missingArea: 0, missingRent: 0, missingExpiry: 1, missingMarket: 0,
    });
  });

  test('occupancy triple: physical 45% / contracted 65% / committed 75%', () => {
    // physical = L1 40,000 + L5 5,000; contracted adds L2 20,000;
    // committed adds L4 LOI 10,000 under the default include policy.
    expect(m.occupancy.physicalPct).toBeCloseTo(45, 10);
    expect(m.occupancy.contractedPct).toBeCloseTo(65, 10);
    expect(m.occupancy.committedPct).toBeCloseTo(75, 10);
    expect(m.occupancy.vacantAreaSqft).toBe(25000);
    expect(m.occupancy.denominatorSource).toBe('register_total');
    expect(m.occupancy.loiPolicy).toBe('include');
  });

  test('loi_policy=exclude drops LOI area from committed occupancy', () => {
    const excl = computeLeaseMetrics(FIXTURE, {
      ...PARENT, settings: { loi_policy: 'exclude' },
    });
    expect(excl.occupancy.committedPct).toBeCloseTo(65, 10);
    expect(excl.occupancy.loiPolicy).toBe('exclude');
  });

  test('denominator falls back to summed row areas when parent total absent', () => {
    const fb = computeLeaseMetrics(FIXTURE, { ...PARENT, total_leasable_area_sqft: null });
    expect(fb.occupancy.denominatorSqft).toBe(100000); // rows sum to exactly 100,000
    expect(fb.occupancy.denominatorSource).toBe('sum_of_rows');
  });

  test('contracted revenue: gross ₹8.94cr, accrual NOI ₹7.62cr', () => {
    // L1: base 48,000,000 + CAM recovery 9,600,000 = 57,600,000
    // L2: 26,400,000   L5: 5,400,000   → gross 89,400,000
    expect(m.revenue.contractedAnnualGross).toBeCloseTo(89400000, 2);
    // Expenses: L1 opex 2,400,000 + CAM offset 9,600,000; L2 opex 1,200,000
    // → accrual NOI 89,400,000 − 13,200,000 = 76,200,000 (CAM-neutral by design)
    expect(m.revenue.accrualNOI).toBeCloseTo(76200000, 2);
  });

  test('cash-adjusted: gross ₹8.8248cr, cash NOI ₹7.5048cr', () => {
    // L1 57,600,000 × 0.98 = 56,448,000; L2 ×1.0; L5 collection missing → ×1.0
    expect(m.revenue.cashAdjustedAnnualGross).toBeCloseTo(88248000, 2);
    expect(m.revenue.cashNOI).toBeCloseTo(75048000, 2);
  });

  test('vacant rows feed ERV only — never contracted revenue', () => {
    // L3 carries a base rate of 120 but is vacant: ERV = 125 × 25,000 × 12
    expect(m.revenue.ervVacantAnnual).toBeCloseTo(37500000, 2);
    // Proof the 120 never leaked into gross: remove L3, gross is unchanged.
    const without = computeLeaseMetrics(FIXTURE.filter((r) => r.id !== 3), PARENT);
    expect(without.revenue.contractedAnnualGross)
      .toBeCloseTo(m.revenue.contractedAnnualGross, 6);
  });

  test('portfolio MTM +14.29% (market 7.6L vs passing 6.65L monthly, ₹000s)', () => {
    // passing = 4,000,000 + 2,200,000 + 450,000 = 6,650,000
    // market  = 4,800,000 + 2,300,000 + 500,000 = 7,600,000
    expect(m.mtm.portfolioPct).toBeCloseTo((7600000 / 6650000 - 1) * 100, 6);
    expect(m.mtm.coveredLeases).toBe(3);
  });

  test('WALE: area-weighted 5.462y, rent-weighted 5.510y, lock-in 2.713y moderate', () => {
    // L1 1,721 days, L2 2,543 days (hand-counted incl. 2028/2032 leap days).
    // Area: (40,000×1,721 + 20,000×2,543) / 60,000 = 1,995 days → /365.25
    expect(m.wale.toExpiryAreaYears).toBeCloseTo(1995 / 365.25, 6);
    // Rent: (4.0M×1,721 + 2.2M×2,543) / 6.2M = 2,012.677… days
    expect(m.wale.toExpiryRentYears).toBeCloseTo(12478600000 / 6200000 / 365.25, 6);
    // Lock-in: only L1 carries one — 991 days → 2.713y → 'moderate' band
    expect(m.wale.lockinRemainingYears).toBeCloseTo(991 / 365.25, 6);
    expect(m.wale.lockinBand).toBe('moderate');
  });

  test('expiry ladder by Indian FY: FY31 then FY34', () => {
    expect(m.expiryLadder).toEqual([
      { fy: 'FY31', areaSqft: 40000, annualBaseRent: 48000000, leaseCount: 1 },
      { fy: 'FY34', areaSqft: 20000, annualBaseRent: 26400000, leaseCount: 1 },
    ]);
  });

  test('deposits: total ₹3.92cr with one actual-vs-derived mismatch', () => {
    // L1 actual 26,000,000 (derived 24,000,000 → 8.3% mismatch flagged)
    // L2 derived 13,200,000; L5 none.
    expect(m.deposits.total).toBeCloseTo(39200000, 2);
    expect(m.deposits.mismatchCount).toBe(1);
  });

  test('top tenants ranked by rent with shares of ALL contracted rent', () => {
    expect(m.topTenants[0]).toEqual({
      tenant: 'Anchor Tech Ltd',
      monthlyBaseRent: 4000000,
      sharePct: expect.closeTo((4000000 / 6650000) * 100, 6),
    });
    expect(m.topTenants.map((t) => t.tenant))
      .toEqual(['Anchor Tech Ltd', 'Mid Corp', 'Small Co']);
  });

  test('weighted in-place rent ₹102.31/sqft/mo (gross, prefill seam)', () => {
    expect(m.revenue.inPlaceRentPerSqftMonth).toBeCloseTo(6650000 / 65000, 6);
  });
});

describe('rentRollMetrics — unit behaviors', () => {
  test('fyLabel: Indian FY boundary at 1 April', () => {
    expect(fyLabel(parseDate('2027-03-31'))).toBe('FY27');
    expect(fyLabel(parseDate('2027-04-01'))).toBe('FY28');
    expect(fyLabel(parseDate('2030-12-15'))).toBe('FY31');
  });

  test('per-acre basis: ₹55,000/acre/mo on 12.5 acres → ₹687,500/mo', () => {
    const paise = monthlyBaseRentPaise({
      rent_basis: 'per_acre_month',
      base_rent_rate: 55000,
      chargeable_area_sqft: 12.5 * 43560,
    });
    expect(paise).toBe(68750000);
  });

  test('Number(null) never zero-corrupts: missing rent excludes the row', () => {
    const m = computeLeaseMetrics([{
      id: 9, status: 'occupied', rent_basis: 'per_sqft_month',
      chargeable_area_sqft: 1000, base_rent_rate: null,
    }], { total_leasable_area_sqft: 1000 });
    expect(m.revenue.contractedAnnualGross).toBe(0);
    expect(m.excluded.missingRent).toBe(1);
    expect(m.revenue.inPlaceRentPerSqftMonth).toBeNull(); // not 0
  });

  test('nextEscalation from pct/frequency: anchor + k×36 months', () => {
    const next = nextEscalation(L1_ANCHOR, parseDate(AS_OF));
    expect(next.toISOString().slice(0, 10)).toBe('2027-04-01');
  });

  test('nextEscalation past expiry returns null', () => {
    const next = nextEscalation(
      { ...L1_ANCHOR, lease_expiry: '2027-03-01' }, parseDate(AS_OF),
    );
    expect(next).toBeNull();
  });

  test('rent_steps override the pct/frequency model', () => {
    const rec = {
      base_rent_rate: 100,
      rent_commencement: '2025-01-01',
      lease_expiry: '2032-01-01',
      escalation_pct: 15,
      escalation_every_months: 12, // would say 2027-01-01 — steps must win
      rent_steps: [
        { from_date: '2028-07-01', rate: 120 },
        { from_date: '2031-07-01', rate: 132 },
      ],
    };
    const next = nextEscalation(rec, parseDate(AS_OF));
    expect(next.toISOString().slice(0, 10)).toBe('2028-07-01');
  });

  test('effectiveRentRate: 10%/12mo steps, 3 rent-free months → ₹102/sqft/mo', () => {
    // 36-month term: 12×100 + 12×110 + 12×121 = 3,972; minus 3×100 rent-free
    // = 3,672; ÷36 = 102.
    const rate = effectiveRentRate({
      base_rent_rate: 100,
      rent_commencement: '2025-01-01',
      lease_expiry: '2028-01-01',
      escalation_pct: 10,
      escalation_every_months: 12,
      rent_free_months: 3,
    });
    expect(rate).toBeCloseTo(102, 10);
  });

  test('effectiveRentRate honors explicit rent_steps', () => {
    // 24 months: 12×100 + 12×130 = 2,760 ÷ 24 = 115.
    const rate = effectiveRentRate({
      base_rent_rate: 100,
      rent_commencement: '2025-01-01',
      lease_expiry: '2027-01-01',
      rent_steps: [{ from_date: '2026-01-01', rate: 130 }],
    });
    expect(rate).toBeCloseTo(115, 10);
  });

  test('securityDeposit: actual is source of truth, derived is the cross-check', () => {
    const dep = securityDeposit(L1_ANCHOR);
    expect(dep.amount).toBe(26000000);
    expect(dep.derivedFromMonths).toBe(24000000);
    expect(dep.source).toBe('actual');
    expect(dep.mismatch).toBe(true); // 8.3% > 5% tolerance

    const derivedOnly = securityDeposit(L2_MID);
    expect(derivedOnly.amount).toBe(13200000);
    expect(derivedOnly.source).toBe('derived');
    expect(derivedOnly.mismatch).toBe(false);
  });

  test('heuristic bands are deterministic thresholds', () => {
    expect(renewalBand({ base_rent_rate: 100, market_rent_rate: 120 })).toBe('high');
    expect(renewalBand({ base_rent_rate: 120, market_rent_rate: 100 })).toBe('low');
    expect(renewalBand({ base_rent_rate: 100, market_rent_rate: 105 })).toBe('medium');
    expect(renewalBand({ base_rent_rate: 100 })).toBeNull();

    expect(creditBand({ collection_pct: 85 })).toBe('watchlist');
    expect(creditBand({ collection_pct: 95 })).toBe('monitor');
    expect(creditBand({ collection_pct: 99 })).toBe('good');
    expect(creditBand({})).toBeNull();

    expect(waleBand(5)).toBe('strong');
    expect(waleBand(3)).toBe('moderate');
    expect(waleBand(1)).toBe('weak');
    expect(waleBand(null)).toBeNull();
  });

  test('retail variable rent joins gross revenue', () => {
    const m = computeLeaseMetrics([{
      id: 11, status: 'occupied', rent_basis: 'per_sqft_month',
      chargeable_area_sqft: 10000, base_rent_rate: 100,
      sales_revenue_base_annual: 120000000, variable_rent_pct: 2.5,
    }], { total_leasable_area_sqft: 10000 });
    // 12,000,000 base + 3,000,000 turnover rent
    expect(m.revenue.contractedAnnualGross).toBeCloseTo(15000000, 2);
  });
});

describe('validateLeaseRoll — WARN-only findings', () => {
  test('flags expiry on/before start', () => {
    const w = validateLeaseRoll([{
      id: 1, status: 'occupied', lease_start: '2026-01-01', lease_expiry: '2025-01-01',
    }]);
    expect(w.some((x) => x.code === 'expiry_before_start')).toBe(true);
  });

  test('flags summed area exceeding register total by >2%', () => {
    const w = validateLeaseRoll(FIXTURE, { total_leasable_area_sqft: 50000 });
    expect(w.some((x) => x.code === 'area_exceeds_total')).toBe(true);
  });

  test('flags >10% drift between register in-place rent and model assumption', () => {
    // in-place ₹102.31 vs model ₹80 → +27.9% drift
    const w = validateLeaseRoll(FIXTURE, PARENT, { baseRentPerSqftMonth: 80 });
    expect(w.some((x) => x.code === 'model_rent_drift')).toBe(true);
    // within band → silent
    const ok = validateLeaseRoll(FIXTURE, PARENT, { baseRentPerSqftMonth: 100 });
    expect(ok.some((x) => x.code === 'model_rent_drift')).toBe(false);
  });

  test('clean fixture raises no structural warnings', () => {
    const w = validateLeaseRoll(FIXTURE, PARENT);
    expect(w).toEqual([]);
  });
});

describe('toLeaseExtract — forward-compat kernel seam', () => {
  test('emits contracted leases only, in the frozen shape', () => {
    const extract = toLeaseExtract(FIXTURE, { asOf: AS_OF });
    expect(extract).toHaveLength(3);
    expect(extract[0]).toEqual({
      areaSqft: 40000,
      monthlyRent: 4000000,
      expiry: '2031-03-31',
      remainingTermYears: expect.closeTo(1721 / 365.25, 6),
      escalationPct: 15,
      escalationEveryMonths: 36,
      rentFreeMonths: null,
      rentSteps: null,
    });
  });
});
