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
  computeSaleMetrics,
  validateSaleRoll,
  computeHotelMetrics,
  validateHotelRoll,
  transitRentRemainingPaise,
  computeOccupantMetrics,
  validateOccupantRoll,
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

  test('financial-bridge aggregates (hand-computed)', () => {
    // Base rent annual: (4.0M + 2.2M + 0.45M) × 12 = 79,800,000
    expect(m.revenue.baseRentAnnual).toBeCloseTo(79800000, 2);
    // Owner opex: 2,400,000 + 1,200,000 (CAM offset excluded by design)
    expect(m.revenue.ownerOpexAnnual).toBeCloseTo(3600000, 2);
    // EGR basis = contracted 79.8M + LOI L4 (105 × 10,000 × 12 = 12.6M)
    // under the default include policy → 3.6M / 92.4M = 3.8961%
    expect(m.revenue.opexPctOfEgrBasis).toBeCloseTo((3600000 / 92400000) * 100, 6);
    // Only L1 carries pct-model escalation: 15% every 36mo → 5% pa annualized;
    // rent-weighted over rows WITH escalation → exactly 5.
    expect(m.revenue.weightedEscalationPctAnnual).toBeCloseTo(5, 10);
    // No row is flagged Anchor → ex-anchor rate equals the blended rate.
    expect(m.revenue.inPlaceRentPerSqftMonthExAnchor)
      .toBeCloseTo(m.revenue.inPlaceRentPerSqftMonth, 10);
  });

  test('loi_policy=exclude drops LOI rent from the EGR basis', () => {
    const excl = computeLeaseMetrics(FIXTURE, { ...PARENT, settings: { loi_policy: 'exclude' } });
    expect(excl.revenue.opexPctOfEgrBasis).toBeCloseTo((3600000 / 79800000) * 100, 6);
  });

  test('owner opex on VACANT rows still counts — upkeep is status-agnostic', () => {
    const withVacantOpex = FIXTURE.map((r) => (r.id === 3
      ? { ...r, owner_opex_annual: 1200000 }
      : r));
    const mv = computeLeaseMetrics(withVacantOpex, PARENT);
    expect(mv.revenue.ownerOpexAnnual).toBeCloseTo(4800000, 2);
    expect(mv.revenue.opexPctOfEgrBasis).toBeCloseTo((4800000 / 92400000) * 100, 6);
  });

  test('retail anchor rows drop out of the ex-anchor rate (kernel inline basis)', () => {
    const withAnchor = FIXTURE.map((r) => (r.id === 1
      ? { ...r, attributes: { anchor_inline: 'Anchor' } }
      : r));
    const ma = computeLeaseMetrics(withAnchor, PARENT);
    // Remaining per-sqft contracted rows: L2 20,000@110 + L5 5,000@90
    // → (2.2M + 0.45M) / 25,000 = 106
    expect(ma.revenue.inPlaceRentPerSqftMonthExAnchor).toBeCloseTo(2650000 / 25000, 10);
    // Blended figure is unchanged — only the ex-anchor view moves.
    expect(ma.revenue.inPlaceRentPerSqftMonth).toBeCloseTo(6650000 / 65000, 10);
  });

  test('rent_steps rows are excluded from the weighted escalation average', () => {
    const withSteps = FIXTURE.map((r) => (r.id === 1
      ? { ...r, rent_steps: [{ from_date: '2028-07-01', rate: 120 }] }
      : r));
    const ms = computeLeaseMetrics(withSteps, PARENT);
    // L1 was the only escalation contributor; as a stepped lease it drops out.
    expect(ms.revenue.weightedEscalationPctAnnual).toBeNull();
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

// ── Sales & collections golden fixture (plotted), as of 2026-07-14 ──────────
const SALE_PARENT = { as_of_date: AS_OF, settings: {} };
const SALE_FIXTURE = [
  {
    // Explicit agreement value governs; no milestones.
    id: 1, status: 'sold', area_sqft: 1500, base_price_per_sqft: 7200,
    other_charges_amount: 700000, agreement_value: 11500000,
    amount_collected: 9500000, amount_overdue: 0,
    booking_date: '2025-05-15', possession_date: '2026-12-31',
  },
  {
    // Derived agreement (7600×2400 + 950,000 = 19,190,000); milestone aging.
    id: 2, status: 'booked', area_sqft: 2400, base_price_per_sqft: 7600,
    other_charges_amount: 950000, amount_collected: 6000000, amount_overdue: 500000,
    booking_date: '2026-04-10', possession_date: '2027-06-30',
    payment_milestones: [
      { name: 'Booking', pct: 10, due_date: '2026-04-10', collected: 1919000 },
      { name: 'Agreement', pct: 20, due_date: '2026-05-05', collected: 2000000 },
      { name: 'Construction', pct: 60, due_date: '2026-12-31' },
    ],
  },
  {
    id: 3, status: 'unsold', area_sqft: 1200, base_price_per_sqft: 6900, current_market_rate: 8000,
  },
  { id: 4, status: 'cancelled', area_sqft: 1800, base_price_per_sqft: 7000, agreement_value: 13000000 },
];

describe('computeSaleMetrics — golden plotted fixture', () => {
  const m = computeSaleMetrics(SALE_FIXTURE, SALE_PARENT);

  test('status counts + inventory sell-through', () => {
    expect(m.counts).toMatchObject({ total: 4, unsold: 1, booked: 1, sold: 1, registered: 0, cancelled: 1 });
    expect(m.inventory).toMatchObject({ totalUnits: 3, soldUnits: 2, unsoldUnits: 1 });
    expect(m.inventory.sellThroughByCountPct).toBeCloseTo((2 / 3) * 100, 6);
  });

  test('areas exclude cancelled; sell-through by area 76.47%', () => {
    expect(m.area).toMatchObject({ totalAreaSqft: 5100, soldAreaSqft: 3900, unsoldAreaSqft: 1200 });
    expect(m.area.sellThroughByAreaPct).toBeCloseTo((3900 / 5100) * 100, 6);
  });

  test('collections funnel: GDV 3.069cr, collected 1.55cr, receivable 1.519cr', () => {
    // sold GDV = 11,500,000 (explicit) + 19,190,000 (derived) = 30,690,000
    expect(m.collections.soldGDV).toBeCloseTo(30690000, 2);
    expect(m.collections.collected).toBeCloseTo(15500000, 2);
    expect(m.collections.receivable).toBeCloseTo(15190000, 2);
    expect(m.collections.overdue).toBeCloseTo(500000, 2);
    expect(m.collections.collectionEfficiencyPct).toBeCloseTo((15500000 / 30690000) * 100, 6);
  });

  test('unsold GDV/MTM: market 96L vs base 82.8L → +15.94%', () => {
    expect(m.unsold.unsoldGDV).toBeCloseTo(9600000, 2);
    expect(m.unsold.unsoldBaseGDV).toBeCloseTo(8280000, 2);
    expect(m.unsold.unsoldMtmPct).toBeCloseTo((9600000 / 8280000 - 1) * 100, 6);
  });

  test('bridge pricing: base rate ₹7446.15/sf, realization ₹7869.23/sf, plot 1950 sf', () => {
    // (7200×1500 + 7600×2400) / 3900
    expect(m.pricing.avgSoldBaseRatePerSqft).toBeCloseTo(29040000 / 3900, 4);
    expect(m.pricing.avgSoldRealizationPerSqft).toBeCloseTo(30690000 / 3900, 4);
    expect(m.pricing.avgSoldPlotSizeSqft).toBeCloseTo(1950, 10);
  });

  test('receivables aging from milestones: ₹18.38L in the 61-90 day bucket', () => {
    // Agreement milestone due 2026-05-05, demanded 20%×19.19M=3.838M, collected 2.0M
    // → outstanding 1.838M, 70 days overdue → 61-90 bucket. Booking milestone
    // fully collected (skipped); Construction not yet due.
    const b = Object.fromEntries(m.aging.buckets.map((x) => [x.bucket, x.amount]));
    expect(b['61-90']).toBeCloseTo(1838000, 2);
    expect(b['0-30']).toBe(0);
    expect(b['31-60']).toBe(0);
    expect(b['90+']).toBe(0);
    expect(m.aging.unaged).toBe(0); // row 2 matched milestones → not double-counted
    expect(m.aging.hasMilestoneData).toBe(true);
  });

  test('rows without milestones fall back to unaged overdue', () => {
    const noMilestones = [
      { id: 9, status: 'sold', area_sqft: 1000, agreement_value: 5000000, amount_collected: 3000000, amount_overdue: 800000 },
    ];
    const mm = computeSaleMetrics(noMilestones, SALE_PARENT);
    expect(mm.aging.unaged).toBeCloseTo(800000, 2);
    expect(mm.aging.hasMilestoneData).toBe(false);
  });

  test('Number(null) safety: a sold row with no agreement is excluded, not zeroed', () => {
    const bare = [{ id: 7, status: 'sold', area_sqft: 1000 }];
    const mb = computeSaleMetrics(bare, SALE_PARENT);
    expect(mb.collections.soldGDV).toBe(0);
    expect(mb.excluded.missingAgreement).toBe(1);
    expect(mb.pricing.avgSoldBaseRatePerSqft).toBeNull();
  });
});

describe('validateSaleRoll — WARN-only findings', () => {
  test('flags collections exceeding agreement value', () => {
    const w = validateSaleRoll([{ id: 1, status: 'sold', agreement_value: 1000000, amount_collected: 1200000 }]);
    expect(w.some((x) => x.code === 'collected_exceeds_agreement')).toBe(true);
  });

  test('flags possession before booking', () => {
    const w = validateSaleRoll([{ id: 1, status: 'booked', booking_date: '2026-06-01', possession_date: '2026-01-01' }]);
    expect(w.some((x) => x.code === 'possession_before_booking')).toBe(true);
  });

  test('flags overdue larger than the outstanding receivable', () => {
    const w = validateSaleRoll([{ id: 1, status: 'sold', agreement_value: 1000000, amount_collected: 900000, amount_overdue: 500000 }]);
    expect(w.some((x) => x.code === 'overdue_exceeds_receivable')).toBe(true);
  });

  test('clean fixture raises no warnings', () => {
    expect(validateSaleRoll(SALE_FIXTURE)).toEqual([]);
  });
});

// ── Hotel operating golden fixture, as of 2026-07-31 ────────────────────────
// 100 keys, fully operational, 0% OOO → availableKeys = 100.
// Two TTM months chosen so ADR blends to a clean ₹6,000 and F&B/other are
// exact 25% / 10% of room revenue.
const HOTEL_ASOF = '2026-07-31';
const HOTEL_RECORDS = {
  hotel_key_block: [
    { id: 1, room_type: 'Deluxe King', keys_count: 100, operational: true, ooo_pct: 0, adr_premium_pct: 0 },
  ],
  hotel_contract: [
    { id: 10, contract_type: 'hma', operator_name: 'Sample Operator', brand: 'Sample Brand', base_fee_pct: 2.5, incentive_fee_pct: 8, ffe_reserve_pct: 4, keys_covered: 100, start_date: '2025-01-01', end_date: '2044-12-31' },
  ],
  hotel_operating_month: [
    // June: 30 days, availNights 3000, occ 60% → occNights 1800, ADR 6000 → room 10,800,000
    { id: 100, month: '2026-06-01', occupancy_pct: 60, adr: 6000, room_revenue: 10800000, fnb_revenue: 2700000, other_revenue: 1080000, gop: 5000000, owner_noi: 3000000 },
    // July: 31 days, availNights 3100, occ 80% → occNights 2480, ADR 6000 → room 14,880,000
    { id: 101, month: '2026-07-01', occupancy_pct: 80, adr: 6000, room_revenue: 14880000, fnb_revenue: 3720000, other_revenue: 1488000, gop: 8000000, owner_noi: 5000000 },
  ],
};

describe('computeHotelMetrics — golden fixture', () => {
  const m = computeHotelMetrics(HOTEL_RECORDS, { as_of_date: HOTEL_ASOF, settings: {} });

  test('counts + key inventory (100 available, 0% OOO)', () => {
    expect(m.counts).toEqual({ keyBlocks: 1, contracts: 1, operatingMonths: 2 });
    expect(m.keys).toMatchObject({ totalKeys: 100, availableKeys: 100, operationalKeys: 100, roomTypes: 1 });
    expect(m.keys.weightedAdrPremiumPct).toBeCloseTo(0, 10);
  });

  test('out-of-order keys reduce availability', () => {
    const withOoo = computeHotelMetrics({
      hotel_key_block: [{ id: 1, keys_count: 80, operational: true, ooo_pct: 2, adr_premium_pct: 0 },
        { id: 2, keys_count: 40, operational: true, ooo_pct: 2, adr_premium_pct: -3 }],
    }, { as_of_date: HOTEL_ASOF });
    expect(withOoo.keys.availableKeys).toBeCloseTo(117.6, 6); // 80×.98 + 40×.98
    expect(withOoo.keys.weightedAdrPremiumPct).toBeCloseTo(-1, 6); // (0×80 + -3×40)/120
  });

  test('contract summary surfaces the governing HMA fee structure', () => {
    expect(m.contract).toMatchObject({
      count: 1, primaryType: 'hma', operator: 'Sample Operator', brand: 'Sample Brand',
      baseFeePct: 2.5, incentiveFeePct: 8, ffeReservePct: 4, keysCovered: 100,
    });
  });

  test('TTM occupancy is room-night weighted: 4280 / 6100', () => {
    // occNights = 1800 + 2480 = 4280; availNights = 3000 + 3100 = 6100
    expect(m.operating.basis).toBe('room_nights');
    expect(m.operating.ttmOccupancyPct).toBeCloseTo((4280 / 6100) * 100, 6);
  });

  test('TTM ADR is room-revenue weighted → ₹6,000; RevPAR = room/availNights', () => {
    // both months ADR 6000 → blended 6000; roomRev 25,680,000 / occNights 4280 = 6000
    expect(m.operating.ttmAdr).toBeCloseTo(6000, 6);
    expect(m.operating.ttmRevpar).toBeCloseTo(25680000 / 6100, 4);
  });

  test('TTM revenue composition + margins (F&B 25%, other 10%)', () => {
    expect(m.operating.ttmRoomRevenue).toBeCloseTo(25680000, 2);
    expect(m.operating.ttmFnbRevenue).toBeCloseTo(6420000, 2);
    expect(m.operating.ttmOtherRevenue).toBeCloseTo(2568000, 2);
    expect(m.operating.ttmTotalRevenue).toBeCloseTo(34668000, 2);
    expect(m.operating.fbRevPct).toBeCloseTo(25, 6);
    expect(m.operating.otherRevPct).toBeCloseTo(10, 6);
    // GOP 13,000,000 / total 34,668,000
    expect(m.operating.ttmGop).toBeCloseTo(13000000, 2);
    expect(m.operating.ttmGopMarginPct).toBeCloseTo((13000000 / 34668000) * 100, 6);
    expect(m.operating.ttmOwnerNoi).toBeCloseTo(8000000, 2);
  });

  test('per-month series carries RevPAR = ADR × occupancy', () => {
    expect(m.operating.series).toHaveLength(2);
    expect(m.operating.series[0]).toMatchObject({ month: '2026-06', occupancyPct: 60, adr: 6000 });
    expect(m.operating.series[0].revpar).toBeCloseTo(6000 * 0.60, 6);
    expect(m.operating.series[1].revpar).toBeCloseTo(6000 * 0.80, 6);
  });

  test('falls back to days-weighted occupancy when no key inventory recorded', () => {
    const noKeys = computeHotelMetrics({ hotel_operating_month: HOTEL_RECORDS.hotel_operating_month }, { as_of_date: HOTEL_ASOF });
    expect(noKeys.operating.basis).toBe('stored_averages');
    // (60×30 + 80×31) / 61 = (1800 + 2480)/61
    expect(noKeys.operating.ttmOccupancyPct).toBeCloseTo((1800 + 2480) / 61, 6);
    expect(noKeys.operating.ttmAdr).toBeCloseTo(6000, 6); // mean of 6000, 6000
  });

  test('a month missing occupancy never deflates TTM occupancy or inflates ADR', () => {
    // Row A fully specified (occ 80, ADR 4500 → room 10.8M); Row B has room
    // revenue but NO occupancy. Occupancy and ADR must use only Row A; RevPAR
    // may use both (room revenue is present on both).
    const partial = {
      hotel_key_block: [{ id: 1, keys_count: 100, operational: true, ooo_pct: 0 }],
      hotel_operating_month: [
        { id: 200, month: '2026-06-01', occupancy_pct: 80, adr: 4500, room_revenue: 10800000 },
        { id: 201, month: '2026-07-01', room_revenue: 5000000 }, // occ omitted
      ],
    };
    const mm = computeHotelMetrics(partial, { as_of_date: HOTEL_ASOF });
    expect(mm.operating.ttmOccupancyPct).toBeCloseTo(80, 6);   // Row A only: 2400/3000
    expect(mm.operating.ttmAdr).toBeCloseTo(4500, 6);          // Row A only: 10.8M/2400
    // RevPAR spans both revenue months: (10.8M + 5.0M) / (3000 + 3100)
    expect(mm.operating.ttmRevpar).toBeCloseTo(15800000 / 6100, 4);
  });

  test('a blank GOP column yields a null margin, never 0%', () => {
    const noGop = {
      hotel_key_block: [{ id: 1, keys_count: 100, operational: true, ooo_pct: 0 }],
      hotel_operating_month: [{ id: 300, month: '2026-06-01', occupancy_pct: 70, adr: 6000, room_revenue: 12600000, fnb_revenue: 3150000 }],
    };
    const mm = computeHotelMetrics(noGop, { as_of_date: HOTEL_ASOF });
    expect(mm.operating.ttmGopMarginPct).toBeNull();
    expect(mm.operating.fbRevPct).toBeCloseTo(25, 6);   // fnb recorded → derivable
    expect(mm.operating.otherRevPct).toBeNull();         // other never recorded
  });

  test('TTM window keeps only the latest 12 months at/behind as-of', () => {
    const many = { hotel_operating_month: [] };
    for (let i = 0; i < 18; i += 1) {
      const mm = String((i % 12) + 1).padStart(2, '0');
      const yy = 2025 + Math.floor(i / 12);
      many.hotel_operating_month.push({ id: i, month: `${yy}-${mm}-01`, occupancy_pct: 70, adr: 6000, room_revenue: 1000000 });
    }
    const res = computeHotelMetrics(many, { as_of_date: '2026-12-31' });
    expect(res.operating.monthsCovered).toBe(12);
    expect(res.counts.operatingMonths).toBe(18);
  });
});

describe('validateHotelRoll — WARN-only findings', () => {
  test('flags occupancy out of range', () => {
    const w = validateHotelRoll({ hotel_operating_month: [{ id: 1, occupancy_pct: 120 }] });
    expect(w.some((x) => x.code === 'occupancy_out_of_range')).toBe(true);
  });
  test('flags GOP above total revenue', () => {
    const w = validateHotelRoll({ hotel_operating_month: [{ id: 1, room_revenue: 1000000, gop: 1500000 }] });
    expect(w.some((x) => x.code === 'gop_exceeds_revenue')).toBe(true);
  });
  test('flags owner NOI above GOP', () => {
    const w = validateHotelRoll({ hotel_operating_month: [{ id: 1, gop: 500000, owner_noi: 800000 }] });
    expect(w.some((x) => x.code === 'noi_exceeds_gop')).toBe(true);
  });
  test('flags a contract keys-covered mismatch vs inventory', () => {
    const w = validateHotelRoll({
      hotel_key_block: [{ id: 1, keys_count: 100 }],
      hotel_contract: [{ id: 2, contract_type: 'hma', keys_covered: 160 }],
    });
    expect(w.some((x) => x.code === 'contract_keys_mismatch')).toBe(true);
  });
  test('clean fixture raises no warnings', () => {
    expect(validateHotelRoll(HOTEL_RECORDS)).toEqual([]);
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

// ── Redevelopment occupants ─────────────────────────────────────────────────
// A four-occupier society redevelopment as of 2026-07-14. Every expected value
// is hand-computed below.
const OCC_ASOF = '2026-07-14';
const OCCUPANT_RECORDS = [
  {
    id: 1, status: 'vacated', occupant_name: 'Flat 101', occupancy_type: 'owner',
    existing_carpet_area_sqft: 500, rehab_entitlement_sqft: 600, additional_area_sqft: 50,
    transit_rent_monthly: 30000, transit_rent_start: '2025-07-01', transit_rent_end: '2027-07-01',
    transit_rent_escalation_pct: 5,
    shifting_allowance: 20000, brokerage_amount: 30000, corpus_amount: 100000, other_obligation_amount: 0,
    documentation_risk: 'low', agreement_status: 'Registered PAAA',
  },
  {
    id: 2, status: 'vacated', occupant_name: 'Flat 102', occupancy_type: 'tenant',
    existing_carpet_area_sqft: 400, rehab_entitlement_sqft: 480, additional_area_sqft: 0,
    transit_rent_monthly: 25000, transit_rent_start: '2026-01-01', transit_rent_end: '2027-07-01',
    transit_rent_escalation_pct: 0,
    shifting_allowance: 20000, brokerage_amount: 25000, corpus_amount: 80000,
    documentation_risk: 'medium',
  },
  {
    id: 3, status: 'in_place', occupant_name: 'Shop 1', occupancy_type: 'commercial',
    existing_carpet_area_sqft: 300, rehab_entitlement_sqft: 300,
    transit_rent_monthly: 40000, // will be paid once vacated; no window yet
    corpus_amount: 50000, documentation_risk: 'high',
  },
  {
    id: 4, status: 'disputed', occupant_name: 'Flat 201',
    existing_carpet_area_sqft: 450, rehab_entitlement_sqft: 500,
    documentation_risk: 'high',
  },
];

describe('computeOccupantMetrics — golden redevelopment fixture', () => {
  const m = computeOccupantMetrics(OCCUPANT_RECORDS, { as_of_date: OCC_ASOF, settings: {} });

  test('status counts', () => {
    expect(m.counts).toEqual({ total: 4, inPlace: 1, vacated: 2, disputed: 1 });
  });

  test('vacation progress by count and by existing carpet area', () => {
    expect(m.vacancy.vacatedByCountPct).toBeCloseTo(50, 6);          // 2/4
    // vacated carpet 500+400=900 of 1650 total
    expect(m.vacancy.existingCarpetSqft).toBe(1650);
    expect(m.vacancy.vacatedCarpetSqft).toBe(900);
    expect(m.vacancy.vacatedByAreaPct).toBeCloseTo((900 / 1650) * 100, 6);
  });

  test('entitlement areas + area-weighted uplift', () => {
    expect(m.entitlement.rehabEntitlementSqft).toBe(1880);          // 600+480+300+500
    expect(m.entitlement.additionalAreaSqft).toBe(50);
    expect(m.entitlement.totalRehabAreaSqft).toBe(1930);            // 1880+50
    // Σ entitlement / Σ existing − 1 = 1880/1650 − 1
    expect(m.entitlement.avgUpliftPct).toBeCloseTo((1880 / 1650 - 1) * 100, 6);
  });

  test('one-time obligations sum by type', () => {
    expect(m.obligations.shiftingAllowanceTotal).toBe(40000);       // 20k+20k
    expect(m.obligations.brokerageTotal).toBe(55000);               // 30k+25k
    expect(m.obligations.corpusTotal).toBe(230000);                 // 100k+80k+50k
    expect(m.obligations.otherObligationTotal).toBe(0);
    expect(m.obligations.oneTimeTotal).toBe(325000);
  });

  test('current transit run-rate = escalated rate on active vacated windows only', () => {
    // O1: started 2025-07-01, 1 full year elapsed by asOf → 30000×1.05 = 31,500.
    // O2: started 2026-01-01, 0 years, no escalation → 25,000.
    // O3 (in_place) is not yet drawing; O4 has no transit rent.
    expect(m.obligations.currentMonthlyTransitRent).toBe(56500);
    expect(m.obligations.annualizedTransitRunRate).toBe(56500 * 12);
  });

  test('forward transit liability is escalation-compounded and excludes unresolved windows', () => {
    // Both O1 and O2 have 11 whole months remaining to 2027-07-01 from 2026-07-14.
    // O1: all 11 months sit in escalation tier 1 (5%) → 11 × 31,500 = 346,500.
    // O2: no escalation → 11 × 25,000 = 275,000.
    // O3: monthly rent but no end/possession date → excluded, counted.
    expect(m.obligations.transitRentRemaining).toBe(346500 + 275000);
    expect(m.excluded.missingTransitEnd).toBe(1);
  });

  test('total rehousing obligation = one-time + forward transit', () => {
    expect(m.obligations.totalRehousingObligation).toBe(325000 + 621500);
    expect(m.obligations.byType.find((b) => b.type === 'Corpus').amount).toBe(230000);
  });

  test('documentation-risk bands + at-risk count', () => {
    expect(m.risk.documentationRisk).toEqual({ low: 1, medium: 1, high: 2, unspecified: 0 });
    expect(m.risk.highRiskUnits).toBe(2);
    expect(m.risk.disputedUnits).toBe(1);
    // Distinct occupiers that are disputed OR high-risk: Shop 1 (high) + Flat 201 (disputed+high).
    expect(m.risk.atRiskUnits).toBe(2);
  });

  test('missing inputs are excluded, never coerced to zero', () => {
    const partial = computeOccupantMetrics([
      { id: 1, status: 'vacated' }, // nothing recorded
      { id: 2, status: 'in_place', existing_carpet_area_sqft: 400 },
    ], { as_of_date: OCC_ASOF });
    expect(partial.excluded.missingCarpet).toBe(1);
    expect(partial.excluded.missingEntitlement).toBe(2);
    expect(partial.entitlement.avgUpliftPct).toBeNull();
    expect(partial.obligations.totalRehousingObligation).toBe(0);
    expect(partial.vacancy.vacatedByAreaPct).toBe(0); // no vacated carpet of 400 total
  });

  test('transitRentRemainingPaise falls back to possession target when no transit end', () => {
    // Monthly 10,000, no escalation, no transit_end, possession target 6 whole months out.
    const paise = transitRentRemainingPaise(
      { transit_rent_monthly: 10000, rehab_possession_target: '2027-01-14' },
      parseDate('2026-07-14'),
    );
    expect(paise).toBe(6 * 1000000); // 6 months × ₹10,000 → paise
  });

  test('escalation applies to an in-place occupier projected from as-of (no transit_start)', () => {
    // 36 months out, 10% pa: 12×50,000 + 12×55,000 + 12×60,500 = ₹19,86,000.
    // Anchoring escalation to the projected vacation point (as-of) — NOT flat —
    // so identical economics never diverge by move-out status.
    const inPlace = transitRentRemainingPaise(
      {
        status: 'in_place', transit_rent_monthly: 50000,
        transit_rent_escalation_pct: 10, rehab_possession_target: '2029-07-14',
      },
      parseDate('2026-07-14'),
    );
    expect(inPlace).toBe(1986000 * 100);
    // A vacated occupier starting at as-of with the same terms is identical.
    const vacatedAtAsOf = transitRentRemainingPaise(
      {
        status: 'vacated', transit_rent_monthly: 50000, transit_rent_escalation_pct: 10,
        transit_rent_start: '2026-07-14', transit_rent_end: '2029-07-14',
      },
      parseDate('2026-07-14'),
    );
    expect(vacatedAtAsOf).toBe(inPlace);
  });

  test('empty register yields honest nulls, never NaN', () => {
    const empty = computeOccupantMetrics([], { as_of_date: OCC_ASOF });
    expect(empty.counts.total).toBe(0);
    expect(empty.vacancy.vacatedByCountPct).toBeNull();
    expect(empty.entitlement.avgUpliftPct).toBeNull();
    expect(empty.obligations.totalRehousingObligation).toBe(0);
  });
});

describe('validateOccupantRoll — WARN-only findings', () => {
  test('flags a rehab entitlement below existing carpet', () => {
    const w = validateOccupantRoll([
      { id: 1, existing_carpet_area_sqft: 500, rehab_entitlement_sqft: 450 },
    ]);
    expect(w.map((x) => x.code)).toContain('entitlement_below_existing');
  });

  test('flags a reversed transit window', () => {
    const w = validateOccupantRoll([
      { id: 1, transit_rent_start: '2027-01-01', transit_rent_end: '2026-01-01' },
    ]);
    expect(w.map((x) => x.code)).toContain('transit_end_before_start');
  });

  test('flags a negative obligation amount', () => {
    const w = validateOccupantRoll([{ id: 1, corpus_amount: -5000 }]);
    expect(w.map((x) => x.code)).toContain('negative_obligation');
  });

  test('the golden fixture is clean (a normal occupier mix is not a data warning)', () => {
    expect(validateOccupantRoll(OCCUPANT_RECORDS)).toEqual([]);
  });
});
