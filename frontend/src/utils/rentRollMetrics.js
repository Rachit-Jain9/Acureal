'use strict';

// Mirror of backend/src/utils/rentRollMetrics.js. Keep in lockstep — change
// one, change both, run backend/tests/rentRollMetrics.parity.test.js.
//
// Deterministic register metrics — the ONLY place rent-roll math lives.
//
// Pure functions, zero I/O. Consumed by rentRoll.service.js (summary cache +
// snapshots), export builders (recomputed from live rows at export time), and
// the benchmark validators. A frontend mirror ships at
// frontend/src/utils/rentRollMetrics.js — keep in lockstep, change one, change
// both, run the parity test (backend/tests/rentRollMetrics.parity.test.js).
//
// Conventions (decided 2026-07-14, plan v2):
// - Money arrives in absolute ₹ and is summed in whole PAISE integers to avoid
//   binary floating-point drift; rupee values are emitted at the boundary.
// - Areas are stored in sqft (1 acre = 43,560 sqft normalized at write time).
// - A value participates in a metric only if it is genuinely present:
//   Number(null) === 0 silently corrupts weighted averages, so presence is
//   checked before coercion. Rows missing an input are EXCLUDED from that
//   metric and counted in `excluded` — never coerced to zero.
// - Status drives eligibility: vacant rows feed ERV potential, never
//   contracted revenue. LOIs count toward committed occupancy only under the
//   register's visible loi_policy setting.
// - Rates are GROSS (pre JDA/JV landowner share) — the kernel's structure
//   transform nets downstream; benchmark comparisons also use gross.
// - GST/TDS are informational and excluded from all rent/NOI metrics.

export const METRICS_VERSION = 'rr-metrics-1.1.0';
export const SQFT_PER_ACRE = 43560;
const DAYS_PER_YEAR = 365.25;

// Status eligibility sets (lease_records.status).
export const PHYSICAL_STATUSES = new Set(['occupied', 'notice_served']);
export const CONTRACTED_STATUSES = new Set(['occupied', 'notice_served', 'committed']);
const LOI_STATUS = 'loi';
const VACANT_STATUS = 'vacant';

// Weighted lock-in remaining (WALT-to-break) bands for the LRD signal
// (dealStructureMatrix `wale_band_for_lrd`). Lenders discount cash flow beyond
// the non-cancellable window; thresholds are a documented heuristic.
const WALE_BAND_THRESHOLDS = { moderate: 2, strong: 4 };

// ── Presence & numeric guards ───────────────────────────────────────────────

export const isPresent = (v) => v !== null && v !== undefined && v !== '';

export const num = (v) => {
  if (!isPresent(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toPaise = (rupees) => Math.round(rupees * 100);
const fromPaise = (paise) => paise / 100;

// ── Date helpers (UTC, no deps) ─────────────────────────────────────────────

export const parseDate = (v) => {
  if (!isPresent(v)) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
};

export const addMonthsUtc = (date, months) => {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
};

const daysBetween = (from, to) => (to.getTime() - from.getTime()) / 86400000;
const yearsBetween = (from, to) => daysBetween(from, to) / DAYS_PER_YEAR;
export const daysInMonth = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();

// Whole calendar months from `from` to `to` (fractional months floor).
export const monthsBetween = (from, to) => {
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12
    + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return months;
};

// Indian financial year label: April–March, named for the ending year.
// 2027-03-31 → FY27; 2027-04-01 → FY28.
export const fyLabel = (date) => {
  const fyEndYear = date.getUTCMonth() + 1 >= 4
    ? date.getUTCFullYear() + 1
    : date.getUTCFullYear();
  return `FY${String(fyEndYear % 100).padStart(2, '0')}`;
};

// ── Per-record economics ────────────────────────────────────────────────────

// Monthly base rent in paise, resolving the rent basis. Null when the inputs
// needed for the basis are absent (the row is then excluded, not zeroed).
export const monthlyBaseRentPaise = (r) => {
  const rate = num(r.base_rent_rate);
  if (rate === null) return null;
  const area = num(r.chargeable_area_sqft);
  switch (r.rent_basis) {
    case 'per_unit_month':
      return toPaise(rate);
    case 'per_acre_month':
      if (area === null) return null;
      return toPaise(rate * (area / SQFT_PER_ACRE));
    case 'per_sqft_month':
    default:
      if (area === null) return null;
      return toPaise(rate * area);
  }
};

// Monthly market rent in paise on the same basis (for MTM / ERV).
export const monthlyMarketRentPaise = (r) => {
  const rate = num(r.market_rent_rate);
  if (rate === null) return null;
  const area = num(r.chargeable_area_sqft);
  switch (r.rent_basis) {
    case 'per_unit_month':
      return toPaise(rate);
    case 'per_acre_month':
      if (area === null) return null;
      return toPaise(rate * (area / SQFT_PER_ACRE));
    case 'per_sqft_month':
    default:
      if (area === null) return null;
      return toPaise(rate * area);
  }
};

// CAM enters gross revenue only when the owner bills and retains/reconciles it
// ('recovery'). pass_through never touches the owner; included_in_rent is
// already inside base rent; owner_borne is a cost, not income. Under
// 'recovery' an equal offsetting expense keeps accrual NOI CAM-neutral.
const monthlyCamRecoveryPaise = (r) => {
  if (r.cam_treatment !== 'recovery') return 0;
  const rate = num(r.cam_rate);
  const area = num(r.chargeable_area_sqft);
  if (rate === null || area === null) return 0;
  return toPaise(rate * area);
};

const monthlyAncillaryPaise = (r) => {
  const qty = num(r.ancillary_qty);
  const rate = num(r.ancillary_rate_monthly);
  if (qty === null || rate === null) return 0;
  return toPaise(qty * rate);
};

const monthlyOtherIncomePaise = (r) => {
  const other = num(r.other_income_monthly);
  return other === null ? 0 : toPaise(other);
};

const annualVariableRentPaise = (r) => {
  const base = num(r.sales_revenue_base_annual);
  const pct = num(r.variable_rent_pct);
  if (base === null || pct === null) return 0;
  return toPaise(base * (pct / 100));
};

// Annual gross revenue components for a CONTRACTED row, in paise.
// Returns null when base rent can't be resolved (row excluded from revenue).
export const annualGrossPaise = (r) => {
  const base = monthlyBaseRentPaise(r);
  if (base === null) return null;
  return (base + monthlyCamRecoveryPaise(r) + monthlyAncillaryPaise(r)
    + monthlyOtherIncomePaise(r)) * 12 + annualVariableRentPaise(r);
};

// Annual expenses attached to a row: owner opex + the CAM-recovery offset.
const annualExpensesPaise = (r) => {
  const opex = num(r.owner_opex_annual);
  return (opex === null ? 0 : toPaise(opex)) + monthlyCamRecoveryPaise(r) * 12;
};

// Security deposit: the negotiated absolute ₹ is the source of truth when
// present; months × monthly rent is the derived cross-check.
export const securityDeposit = (r) => {
  const actual = num(r.security_deposit_amount);
  const months = num(r.deposit_months);
  const base = monthlyBaseRentPaise(r);
  const derivedPaise = months !== null && base !== null ? Math.round(months * base) : null;
  const amountPaise = actual !== null ? toPaise(actual) : derivedPaise;
  let mismatch = false;
  if (actual !== null && derivedPaise !== null && derivedPaise > 0) {
    mismatch = Math.abs(toPaise(actual) - derivedPaise) / derivedPaise > 0.05;
  }
  return {
    amount: amountPaise === null ? null : fromPaise(amountPaise),
    derivedFromMonths: derivedPaise === null ? null : fromPaise(derivedPaise),
    source: actual !== null ? 'actual' : (derivedPaise !== null ? 'derived' : 'missing'),
    mismatch,
  };
};

// Escalation steps: explicit rent_steps override the pct/frequency model.
const rentSteps = (r) => {
  if (!Array.isArray(r.rent_steps) || r.rent_steps.length === 0) return null;
  const steps = r.rent_steps
    .map((s) => ({ fromDate: parseDate(s.from_date), rate: num(s.rate) }))
    .filter((s) => s.fromDate && s.rate !== null)
    .sort((a, b) => a.fromDate - b.fromDate);
  return steps.length > 0 ? steps : null;
};

// Next escalation date after asOf (null when unknowable or past expiry).
export const nextEscalation = (r, asOf) => {
  const expiry = parseDate(r.lease_expiry);
  const steps = rentSteps(r);
  if (steps) {
    const next = steps.find((s) => s.fromDate > asOf);
    if (!next) return null;
    if (expiry && next.fromDate > expiry) return null;
    return next.fromDate;
  }
  const anchor = parseDate(r.rent_commencement) || parseDate(r.lease_start);
  const every = num(r.escalation_every_months);
  const pct = num(r.escalation_pct);
  if (!anchor || every === null || every <= 0 || pct === null || pct === 0) return null;
  const elapsed = Math.max(0, monthsBetween(anchor, asOf));
  const k = Math.floor(elapsed / every) + 1;
  const next = addMonthsUtc(anchor, k * every);
  if (expiry && next > expiry) return null;
  return next;
};

// Straight-lined effective rent over the term: contracted base rent with
// step-ups, minus rent-free at the opening rate, averaged per month. Returns
// the effective RATE on the record's own basis (₹/sf/mo for per_sqft_month).
export const effectiveRentRate = (r) => {
  const rate = num(r.base_rent_rate);
  const start = parseDate(r.rent_commencement) || parseDate(r.lease_start);
  const expiry = parseDate(r.lease_expiry);
  if (rate === null || !start || !expiry || expiry <= start) return null;
  const termMonths = monthsBetween(start, expiry);
  if (termMonths <= 0) return null;

  const steps = rentSteps(r);
  const every = num(r.escalation_every_months);
  const pct = num(r.escalation_pct);
  let total = 0;
  for (let m = 0; m < termMonths; m += 1) {
    const monthStart = addMonthsUtc(start, m);
    let monthRate = rate;
    if (steps) {
      for (const s of steps) {
        if (s.fromDate <= monthStart) monthRate = s.rate;
      }
    } else if (every !== null && every > 0 && pct !== null) {
      const stepIdx = Math.floor(m / every);
      monthRate = rate * ((1 + pct / 100) ** stepIdx);
    }
    total += monthRate;
  }
  const rentFree = num(r.rent_free_months);
  if (rentFree !== null && rentFree > 0) total -= Math.min(rentFree, termMonths) * rate;
  return total / termMonths;
};

// ── Heuristic bands (deterministic threshold rules, labeled as heuristics) ──

// Renewal likelihood: a tenant paying below market (positive MTM) has an
// economic incentive to renew; deep above-market rent is flight risk.
export const renewalBand = (r) => {
  const base = num(r.base_rent_rate);
  const market = num(r.market_rent_rate);
  if (base === null || market === null || base <= 0) return null;
  const mtmPct = (market / base - 1) * 100;
  if (mtmPct >= 10) return 'high';
  if (mtmPct <= -10) return 'low';
  return 'medium';
};

// Collection discipline band from collection %.
export const creditBand = (r) => {
  const pct = num(r.collection_pct);
  if (pct === null) return null;
  if (pct < 90) return 'watchlist';
  if (pct < 97) return 'monitor';
  return 'good';
};

export const waleBand = (years) => {
  if (years === null) return null;
  if (years >= WALE_BAND_THRESHOLDS.strong) return 'strong';
  if (years >= WALE_BAND_THRESHOLDS.moderate) return 'moderate';
  return 'weak';
};

// ── Portfolio roll-up (lease family / Shape A) ──────────────────────────────

/**
 * Compute the full lease-register metric set.
 *
 * @param {Array<object>} records  live lease_records rows (snake_case fields)
 * @param {object} parent          deal_registers row ({ total_leasable_area_sqft, as_of_date, settings })
 * @param {object} [opts]          { asOf?: Date|string, leasableAreaFallbackSqft?: number }
 */
export const computeLeaseMetrics = (records, parent = {}, opts = {}) => {
  const asOf = parseDate(opts.asOf) || parseDate(parent.as_of_date) || new Date();
  const settings = parent.settings || {};
  const loiPolicy = settings.loi_policy === 'exclude' ? 'exclude' : 'include';

  const rows = (records || []).filter((r) => r && !r.deleted_at);
  const excluded = { missingArea: 0, missingRent: 0, missingExpiry: 0, missingMarket: 0 };

  // Area tallies by eligibility bucket.
  let physicalArea = 0;
  let contractedArea = 0;
  let loiArea = 0;
  let vacantArea = 0;
  let totalRowArea = 0;

  // Money tallies (paise).
  let grossPaise = 0;
  let cashGrossPaise = 0;
  let expensesPaise = 0;
  let ervVacantPaise = 0;
  let contractedBasePaise = 0; // all contracted monthly base rent (tenant shares)
  let passingPaise = 0;   // MTM basis: contracted monthly base WHERE market known
  let marketPaise = 0;    // MTM basis: contracted monthly market
  let mtmRows = 0;
  let depositPaise = 0;
  let depositMismatches = 0;

  // WALE accumulators (contracted rows with expiry + area).
  let waleAreaDays = 0;
  let waleArea = 0;
  let waleRentDaysPaise = 0;
  let waleRentPaise = 0;
  let lockinAreaDays = 0;
  let lockinArea = 0;

  // Financial-bridge aggregates. Opex counts EVERY live row (an owner bears
  // upkeep on vacant floors too); the % basis is the kernel's EGR analogue —
  // contracted base rent plus LOI base rent when the policy counts LOIs
  // toward committed occupancy (vacancyPct is derived from that same basis).
  let ownerOpexPaise = 0;
  let opexRecordedRows = 0;    // "no opex recorded" must yield null, never 0%
  let loiBasePaise = 0;        // monthly base rent proposed on LOI rows
  let escWeightPaise = 0;      // Σ base rent of rows with a resolvable escalation
  let escWeightedSumPaise = 0; // Σ base × annualized escalation %
  // Retail: the kernel's baseRentPerSqftMonth is the INLINE (non-anchor)
  // rate — it applies the anchor discount itself via blendedFactor. Track an
  // ex-anchor weighted rate so the bridge never double-counts the discount.
  let exAnchorRentPaise = 0;
  let exAnchorArea = 0;

  const ladder = new Map(); // fy → { fy, areaSqft, annualRentPaise (base), leaseCount }
  let expiredArea = 0;
  const tenants = new Map(); // tenant → monthly base paise

  const isAnchorRow = (r) => {
    const flag = r.attributes && r.attributes.anchor_inline;
    return flag === 'Anchor' || flag === 'Mini anchor';
  };

  for (const r of rows) {
    const area = num(r.chargeable_area_sqft);
    const contracted = CONTRACTED_STATUSES.has(r.status);
    const physical = PHYSICAL_STATUSES.has(r.status);

    // Owner opex is borne regardless of letting status — accumulate BEFORE
    // any status filtering so a vacant floor's upkeep is never dropped.
    const opexAnyStatus = num(r.owner_opex_annual);
    if (opexAnyStatus !== null) {
      ownerOpexPaise += toPaise(opexAnyStatus);
      opexRecordedRows += 1;
    }

    if (area !== null) {
      totalRowArea += area;
      if (physical) physicalArea += area;
      if (contracted) contractedArea += area;
      if (r.status === LOI_STATUS) loiArea += area;
      if (r.status === VACANT_STATUS) vacantArea += area;
    } else {
      excluded.missingArea += 1;
    }

    if (r.status === VACANT_STATUS) {
      // Vacant rows feed ERV potential only — never contracted revenue,
      // even when a rate is entered against them.
      const mkt = monthlyMarketRentPaise(r);
      if (mkt !== null) ervVacantPaise += mkt * 12;
      else excluded.missingMarket += 1;
      continue;
    }
    if (!contracted) {
      // LOI rows: proposed rent joins the EGR basis under the include policy
      // (committed occupancy — and therefore vacancyPct — already counts them).
      if (r.status === LOI_STATUS) {
        const loiBase = monthlyBaseRentPaise(r);
        if (loiBase !== null) loiBasePaise += loiBase;
      }
      continue; // loi / expired rows carry no contracted revenue
    }

    const base = monthlyBaseRentPaise(r);
    if (base === null) {
      excluded.missingRent += 1;
    } else {
      const gross = annualGrossPaise(r);
      const expenses = annualExpensesPaise(r);
      grossPaise += gross;
      expensesPaise += expenses;
      contractedBasePaise += base;
      const collection = num(r.collection_pct);
      const collectionFactor = collection === null
        ? 1
        : Math.min(Math.max(collection, 0), 100) / 100;
      cashGrossPaise += Math.round(gross * collectionFactor);

      const mkt = monthlyMarketRentPaise(r);
      if (mkt !== null) {
        passingPaise += base;
        marketPaise += mkt;
        mtmRows += 1;
      }

      if (isPresent(r.tenant_name)) {
        tenants.set(r.tenant_name, (tenants.get(r.tenant_name) || 0) + base);
      }

      if (!isAnchorRow(r) && r.rent_basis === 'per_sqft_month' && area !== null && area > 0) {
        exAnchorRentPaise += base;
        exAnchorArea += area;
      }

      // Annualized escalation, rent-weighted. Explicit rent_steps have no
      // single "% pa" — such rows are excluded from the weighted average
      // (their step economics already live in effectiveRentRate).
      const escPct = num(r.escalation_pct);
      const escEvery = num(r.escalation_every_months);
      if (!rentSteps(r) && escPct !== null && escEvery !== null && escEvery > 0) {
        escWeightPaise += base;
        escWeightedSumPaise += base * (escPct * (12 / escEvery));
      }
    }

    const dep = securityDeposit(r);
    if (dep.amount !== null) depositPaise += toPaise(dep.amount);
    if (dep.mismatch) depositMismatches += 1;

    const expiry = parseDate(r.lease_expiry);
    if (!expiry) {
      excluded.missingExpiry += 1;
    } else if (expiry <= asOf) {
      if (area !== null) expiredArea += area;
    } else {
      const days = daysBetween(asOf, expiry);
      if (area !== null) {
        waleAreaDays += area * days;
        waleArea += area;
      }
      if (base !== null) {
        waleRentDaysPaise += base * days;
        waleRentPaise += base;
      }
      const fy = fyLabel(expiry);
      const bucket = ladder.get(fy) || { fy, areaSqft: 0, annualRentPaise: 0, leaseCount: 0 };
      if (area !== null) bucket.areaSqft += area;
      if (base !== null) bucket.annualRentPaise += base * 12;
      bucket.leaseCount += 1;
      ladder.set(fy, bucket);
    }

    const lockin = parseDate(r.lockin_end);
    if (lockin && area !== null) {
      lockinAreaDays += area * Math.max(0, daysBetween(asOf, lockin));
      lockinArea += area;
    }
  }

  // Occupancy denominator with a documented fallback chain.
  const parentTotal = num(parent.total_leasable_area_sqft);
  const fallback = num(opts.leasableAreaFallbackSqft);
  let denominator = null;
  let denominatorSource = 'missing';
  if (parentTotal !== null && parentTotal > 0) {
    denominator = parentTotal;
    denominatorSource = 'register_total';
  } else if (totalRowArea > 0) {
    denominator = totalRowArea;
    denominatorSource = 'sum_of_rows';
  } else if (fallback !== null && fallback > 0) {
    denominator = fallback;
    denominatorSource = 'financial_inputs';
  }

  const pctOfDenominator = (areaSqft) => (denominator ? (areaSqft / denominator) * 100 : null);
  const committedArea = contractedArea + (loiPolicy === 'include' ? loiArea : 0);

  const waleToExpiryAreaYears = waleArea > 0 ? waleAreaDays / waleArea / DAYS_PER_YEAR : null;
  const waleToExpiryRentYears = waleRentPaise > 0
    ? waleRentDaysPaise / waleRentPaise / DAYS_PER_YEAR : null;
  const lockinRemainingYears = lockinArea > 0
    ? lockinAreaDays / lockinArea / DAYS_PER_YEAR : null;

  const grossAnnual = fromPaise(grossPaise);
  const cashGrossAnnual = fromPaise(cashGrossPaise);
  const expensesAnnual = fromPaise(expensesPaise);

  const topTenants = [...tenants.entries()]
    .map(([name, monthlyPaise]) => ({
      tenant: name,
      monthlyBaseRent: fromPaise(monthlyPaise),
      sharePct: contractedBasePaise > 0 ? (monthlyPaise / contractedBasePaise) * 100 : null,
    }))
    .sort((a, b) => b.monthlyBaseRent - a.monthlyBaseRent)
    .slice(0, 10);

  const expiryLadder = [...ladder.values()]
    .map((b) => ({
      fy: b.fy,
      areaSqft: b.areaSqft,
      annualBaseRent: fromPaise(b.annualRentPaise),
      leaseCount: b.leaseCount,
    }))
    .sort((a, b) => a.fy.localeCompare(b.fy));
  if (expiredArea > 0) {
    expiryLadder.unshift({ fy: 'Expired/MTM', areaSqft: expiredArea, annualBaseRent: null, leaseCount: null });
  }

  // Weighted in-place rate (per sqft) over contracted rows — the prefill seam
  // reads this; GROSS by construction.
  const inPlaceRentPerSqftMonth = (() => {
    let rentPaise = 0;
    let rentArea = 0;
    for (const r of rows) {
      if (!CONTRACTED_STATUSES.has(r.status) || r.rent_basis !== 'per_sqft_month') continue;
      const base = monthlyBaseRentPaise(r);
      const area = num(r.chargeable_area_sqft);
      if (base === null || area === null || area <= 0) continue;
      rentPaise += base;
      rentArea += area;
    }
    return rentArea > 0 ? fromPaise(rentPaise) / rentArea : null;
  })();

  return {
    metricsVersion: METRICS_VERSION,
    asOf: asOf.toISOString().slice(0, 10),
    counts: {
      total: rows.length,
      contracted: rows.filter((r) => CONTRACTED_STATUSES.has(r.status)).length,
      vacant: rows.filter((r) => r.status === VACANT_STATUS).length,
      loi: rows.filter((r) => r.status === LOI_STATUS).length,
    },
    excluded,
    occupancy: {
      physicalPct: pctOfDenominator(physicalArea),
      contractedPct: pctOfDenominator(contractedArea),
      committedPct: pctOfDenominator(committedArea),
      loiPolicy,
      physicalAreaSqft: physicalArea,
      contractedAreaSqft: contractedArea,
      committedAreaSqft: committedArea,
      vacantAreaSqft: vacantArea,
      denominatorSqft: denominator,
      denominatorSource,
    },
    wale: {
      toExpiryAreaYears: waleToExpiryAreaYears,
      toExpiryRentYears: waleToExpiryRentYears,
      lockinRemainingYears,
      lockinBand: waleBand(lockinRemainingYears),
      coveredLeases: ladder.size > 0
        ? [...ladder.values()].reduce((n, b) => n + b.leaseCount, 0) : 0,
    },
    mtm: {
      portfolioPct: passingPaise > 0 ? (marketPaise / passingPaise - 1) * 100 : null,
      coveredLeases: mtmRows,
    },
    revenue: {
      contractedAnnualGross: grossAnnual,
      cashAdjustedAnnualGross: cashGrossAnnual,
      accrualNOI: grossAnnual - expensesAnnual,
      cashNOI: cashGrossAnnual - expensesAnnual,
      ervVacantAnnual: fromPaise(ervVacantPaise),
      inPlaceRentPerSqftMonth,
      // Financial-bridge aggregates (see accumulators note).
      baseRentAnnual: fromPaise(contractedBasePaise * 12),
      // ALL recorded owner opex — vacant/LOI/expired floors included; the
      // owner bears upkeep regardless of letting status.
      ownerOpexAnnual: fromPaise(ownerOpexPaise),
      // % over the kernel's EGR analogue: contracted base rent + LOI base
      // rent when the policy counts LOIs (matching the vacancyPct basis).
      opexPctOfEgrBasis: (() => {
        const egrBasisPaise = (contractedBasePaise
          + (loiPolicy === 'include' ? loiBasePaise : 0)) * 12;
        return opexRecordedRows > 0 && egrBasisPaise > 0
          ? (ownerOpexPaise / egrBasisPaise) * 100 : null;
      })(),
      weightedEscalationPctAnnual: escWeightPaise > 0
        ? escWeightedSumPaise / escWeightPaise : null,
      // Ex-anchor weighted rate — what the retail kernel's baseRentPerSqftMonth
      // actually means (it blends the anchor discount in itself). Equals the
      // blended figure when no row is flagged Anchor / Mini anchor.
      inPlaceRentPerSqftMonthExAnchor: exAnchorArea > 0
        ? fromPaise(exAnchorRentPaise) / exAnchorArea : null,
    },
    deposits: {
      total: fromPaise(depositPaise),
      mismatchCount: depositMismatches,
    },
    expiryLadder,
    topTenants,
  };
};

// ── Validation (WARN-only findings, shared by both validator surfaces) ──────

export const validateLeaseRoll = (records, parent = {}, financialInputs = null) => {
  const warnings = [];
  const rows = (records || []).filter((r) => r && !r.deleted_at);
  const add = (code, message, recordIds = []) => warnings.push({ code, message, recordIds });

  const badDates = rows.filter((r) => {
    const start = parseDate(r.lease_start);
    const expiry = parseDate(r.lease_expiry);
    return start && expiry && expiry <= start;
  });
  if (badDates.length > 0) {
    add('expiry_before_start',
      `${badDates.length} lease(s) expire on or before their start date.`,
      badDates.map((r) => r.id));
  }

  const badCommencement = rows.filter((r) => {
    const start = parseDate(r.lease_start);
    const comm = parseDate(r.rent_commencement);
    return start && comm && comm < start;
  });
  if (badCommencement.length > 0) {
    add('commencement_before_start',
      `${badCommencement.length} lease(s) have rent commencement before lease start.`,
      badCommencement.map((r) => r.id));
  }

  const negativeRates = rows.filter((r) => {
    const rate = num(r.base_rent_rate);
    return rate !== null && rate < 0;
  });
  if (negativeRates.length > 0) {
    add('negative_rent', `${negativeRates.length} lease(s) carry a negative base rent.`,
      negativeRates.map((r) => r.id));
  }

  const lowCollection = rows.filter((r) => {
    const pct = num(r.collection_pct);
    return pct !== null && (pct < 50 || pct > 100);
  });
  if (lowCollection.length > 0) {
    add('collection_out_of_band',
      `${lowCollection.length} lease(s) have a collection % outside 50–100.`,
      lowCollection.map((r) => r.id));
  }

  const parentTotal = num(parent.total_leasable_area_sqft);
  if (parentTotal !== null && parentTotal > 0) {
    let rowArea = 0;
    for (const r of rows) {
      const area = num(r.chargeable_area_sqft);
      if (area !== null) rowArea += area;
    }
    if (rowArea > parentTotal * 1.02) {
      add('area_exceeds_total',
        `Summed record area (${Math.round(rowArea).toLocaleString('en-IN')} sqft) exceeds `
        + `the register's total leasable area (${Math.round(parentTotal).toLocaleString('en-IN')} sqft) by more than 2%.`);
    }
  }

  if (financialInputs) {
    const modelRent = num(financialInputs.baseRentPerSqftMonth);
    const metrics = computeLeaseMetrics(records, parent);
    const inPlace = metrics.revenue.inPlaceRentPerSqftMonth;
    if (modelRent !== null && modelRent > 0 && inPlace !== null) {
      const driftPct = (inPlace / modelRent - 1) * 100;
      if (Math.abs(driftPct) > 10) {
        add('model_rent_drift',
          `Register in-place rent (₹${inPlace.toFixed(0)}/sqft/mo) diverges `
          + `${driftPct.toFixed(0)}% from the model's baseRentPerSqftMonth (₹${modelRent}/sqft/mo). `
          + 'Re-examine the income assumptions or re-apply from the register.');
      }
    }
  }

  return warnings;
};

// ── Forward-compat seam ─────────────────────────────────────────────────────
// Normalized lease array for the future kernel-native `leases[]` input
// (operator-gated). Shape is frozen here so Phase-1 storage never needs rework.

export const toLeaseExtract = (records, opts = {}) => {
  const asOf = parseDate(opts.asOf) || new Date();
  return (records || [])
    .filter((r) => r && !r.deleted_at && CONTRACTED_STATUSES.has(r.status))
    .map((r) => {
      const base = monthlyBaseRentPaise(r);
      const expiry = parseDate(r.lease_expiry);
      return {
        areaSqft: num(r.chargeable_area_sqft),
        monthlyRent: base === null ? null : fromPaise(base),
        expiry: expiry ? expiry.toISOString().slice(0, 10) : null,
        remainingTermYears: expiry ? Math.max(0, yearsBetween(asOf, expiry)) : null,
        escalationPct: num(r.escalation_pct),
        escalationEveryMonths: num(r.escalation_every_months),
        rentFreeMonths: num(r.rent_free_months),
        rentSteps: rentSteps(r),
      };
    });
};

// ── Sales & collections family (Shape B: plotted + free-sale inventory) ─────
//
// One row per plot/unit. Status drives eligibility: booked/sold/registered are
// "sold" (carry agreement value, collections, receivables); unsold rows carry
// only inventory GDV/MTM potential; cancelled rows are excluded from both.

export const SALE_SOLD_STATUSES = new Set(['booked', 'sold', 'registered']);
const SALE_UNSOLD_STATUS = 'unsold';
const SALE_CANCELLED_STATUS = 'cancelled';

// Aging bucket edges (days overdue). '90+' captures the tail.
const AGING_BUCKETS = [
  { key: '0-30', maxDays: 30 },
  { key: '31-60', maxDays: 60 },
  { key: '61-90', maxDays: 90 },
  { key: '90+', maxDays: Infinity },
];

// Agreement (consideration) value for a sale row, in paise. The stored column
// is the source of truth; when absent it is derived from base rate × area plus
// other charges — mirroring the template's `base×area + charges`. Null when
// neither is resolvable (the row is then excluded from GDV, never zeroed).
export const agreementValuePaise = (r) => {
  const stored = num(r.agreement_value);
  if (stored !== null) return toPaise(stored);
  const rate = num(r.base_price_per_sqft);
  const area = num(r.area_sqft);
  if (rate === null || area === null) return null;
  const charges = num(r.other_charges_amount);
  return toPaise(rate * area + (charges === null ? 0 : charges));
};

// Unsold inventory GDV in paise: area × current market rate, falling back to
// the base list price. Null when neither a rate nor area is known.
const unsoldGdvPaise = (r) => {
  const area = num(r.area_sqft);
  if (area === null) return null;
  const market = num(r.current_market_rate);
  const base = num(r.base_price_per_sqft);
  const rate = market !== null ? market : base;
  return rate === null ? null : toPaise(rate * area);
};

// Receivables aging from a row's payment-plan milestones. Each milestone that
// has fallen due (due_date <= asOf) and is not fully collected contributes its
// outstanding amount to the bucket for its days-overdue. Milestone amount is
// taken from an explicit `amount`, else `pct` of the row's agreement value.
// Returns per-bucket paise; rows without milestone data return null so the
// caller can fall back to the (unaged) overdue column.
const agingFromMilestones = (r, asOf, agreementPaise) => {
  if (!Array.isArray(r.payment_milestones) || r.payment_milestones.length === 0) return null;
  const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0]));
  let matched = false;
  for (const m of r.payment_milestones) {
    const due = parseDate(m.due_date);
    if (!due || due > asOf) continue;
    let demandedPaise = null;
    const amt = num(m.amount);
    if (amt !== null) demandedPaise = toPaise(amt);
    else {
      const pct = num(m.pct);
      if (pct !== null && agreementPaise !== null) demandedPaise = Math.round(agreementPaise * (pct / 100));
    }
    if (demandedPaise === null) continue;
    const collectedPaise = num(m.collected) !== null ? toPaise(num(m.collected)) : 0;
    const outstanding = demandedPaise - collectedPaise;
    if (outstanding <= 0) continue;
    matched = true;
    const daysOverdue = daysBetween(due, asOf);
    const bucket = AGING_BUCKETS.find((b) => daysOverdue <= b.maxDays) || AGING_BUCKETS[AGING_BUCKETS.length - 1];
    buckets[bucket.key] += outstanding;
  }
  return matched ? buckets : null;
};

/**
 * Compute the full sales-&-collections metric set.
 *
 * @param {Array<object>} records  live sale_records rows (snake_case)
 * @param {object} parent          deal_registers row ({ as_of_date, settings })
 * @param {object} [opts]          { asOf?: Date|string }
 */
export const computeSaleMetrics = (records, parent = {}, opts = {}) => {
  const asOf = parseDate(opts.asOf) || parseDate(parent.as_of_date) || new Date();
  const rows = (records || []).filter((r) => r && !r.deleted_at);
  const excluded = { missingArea: 0, missingAgreement: 0, missingUnsoldRate: 0 };

  const counts = { total: rows.length, unsold: 0, booked: 0, sold: 0, registered: 0, cancelled: 0 };
  let totalArea = 0;
  let soldArea = 0;
  let unsoldArea = 0;

  let soldGdvPaise = 0;
  let collectedPaise = 0;
  let overduePaise = 0;
  let unsoldGdvTotalPaise = 0;
  let unsoldBaseGdvPaise = 0;

  // Sold pricing (bridge inputs): weighted base rate + mean plot size.
  let soldBaseRateAreaPaise = 0; // Σ base_price × area (paise·sqft basis via toPaise on rate)
  let soldBaseRateArea = 0;      // Σ area for rows with a base rate
  let soldRealizationPaise = 0;  // Σ agreement value on sold rows with area
  let soldRealizationArea = 0;
  let soldPlotSizeSum = 0;
  let soldPlotSizeCount = 0;

  const aging = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0]));
  let unagedOverduePaise = 0;

  for (const r of rows) {
    const status = r.status;
    if (status && Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;

    if (status === SALE_CANCELLED_STATUS) continue;

    const area = num(r.area_sqft);
    if (area !== null) totalArea += area;
    else excluded.missingArea += 1;

    if (status === SALE_UNSOLD_STATUS) {
      if (area !== null) unsoldArea += area;
      const gdv = unsoldGdvPaise(r);
      if (gdv !== null) unsoldGdvTotalPaise += gdv;
      else excluded.missingUnsoldRate += 1;
      const base = num(r.base_price_per_sqft);
      if (base !== null && area !== null) unsoldBaseGdvPaise += toPaise(base * area);
      continue;
    }

    if (!SALE_SOLD_STATUSES.has(status)) continue; // unknown status → inventory only

    if (area !== null) soldArea += area;

    const agreement = agreementValuePaise(r);
    if (agreement === null) {
      excluded.missingAgreement += 1;
    } else {
      soldGdvPaise += agreement;
      const collected = num(r.amount_collected);
      if (collected !== null) collectedPaise += toPaise(collected);
      if (area !== null && area > 0) {
        soldRealizationPaise += agreement;
        soldRealizationArea += area;
      }
    }

    const overdue = num(r.amount_overdue);
    const rowAging = agingFromMilestones(r, asOf, agreement);
    if (rowAging) {
      for (const b of AGING_BUCKETS) aging[b.key] += rowAging[b.key];
    } else if (overdue !== null && overdue > 0) {
      unagedOverduePaise += toPaise(overdue);
    }
    if (overdue !== null) overduePaise += toPaise(overdue);

    const base = num(r.base_price_per_sqft);
    if (base !== null && area !== null && area > 0) {
      soldBaseRateAreaPaise += toPaise(base) * area;
      soldBaseRateArea += area;
    }
    if (area !== null && area > 0) {
      soldPlotSizeSum += area;
      soldPlotSizeCount += 1;
    }
  }

  const receivablePaise = Math.max(0, soldGdvPaise - collectedPaise);
  const soldUnits = counts.booked + counts.sold + counts.registered;
  const activeUnits = counts.total - counts.cancelled;

  return {
    metricsVersion: METRICS_VERSION,
    asOf: asOf.toISOString().slice(0, 10),
    counts,
    excluded,
    inventory: {
      totalUnits: activeUnits,
      soldUnits,
      unsoldUnits: counts.unsold,
      sellThroughByCountPct: activeUnits > 0 ? (soldUnits / activeUnits) * 100 : null,
    },
    area: {
      totalAreaSqft: totalArea,
      soldAreaSqft: soldArea,
      unsoldAreaSqft: unsoldArea,
      sellThroughByAreaPct: totalArea > 0 ? (soldArea / totalArea) * 100 : null,
    },
    collections: {
      soldGDV: fromPaise(soldGdvPaise),
      collected: fromPaise(collectedPaise),
      receivable: fromPaise(receivablePaise),
      overdue: fromPaise(overduePaise),
      collectionEfficiencyPct: soldGdvPaise > 0 ? (collectedPaise / soldGdvPaise) * 100 : null,
    },
    unsold: {
      unsoldGDV: fromPaise(unsoldGdvTotalPaise),
      unsoldBaseGDV: fromPaise(unsoldBaseGdvPaise),
      unsoldMtmPct: unsoldBaseGdvPaise > 0
        ? (unsoldGdvTotalPaise / unsoldBaseGdvPaise - 1) * 100 : null,
    },
    pricing: {
      avgSoldBaseRatePerSqft: soldBaseRateArea > 0
        ? fromPaise(soldBaseRateAreaPaise / soldBaseRateArea) : null,
      avgSoldRealizationPerSqft: soldRealizationArea > 0
        ? fromPaise(soldRealizationPaise) / soldRealizationArea : null,
      avgSoldPlotSizeSqft: soldPlotSizeCount > 0 ? soldPlotSizeSum / soldPlotSizeCount : null,
    },
    aging: {
      buckets: AGING_BUCKETS.map((b) => ({ bucket: b.key, amount: fromPaise(aging[b.key]) })),
      unaged: fromPaise(unagedOverduePaise),
      hasMilestoneData: AGING_BUCKETS.some((b) => aging[b.key] > 0),
    },
  };
};

export const validateSaleRoll = (records, parent = {}) => {
  const warnings = [];
  const rows = (records || []).filter((r) => r && !r.deleted_at);
  const add = (code, message, recordIds = []) => warnings.push({ code, message, recordIds });

  const overCollected = rows.filter((r) => {
    const agreement = agreementValuePaise(r);
    const collected = num(r.amount_collected);
    return agreement !== null && collected !== null && toPaise(collected) > agreement * 1.001;
  });
  if (overCollected.length > 0) {
    add('collected_exceeds_agreement',
      `${overCollected.length} unit(s) have collections exceeding the agreement value.`,
      overCollected.map((r) => r.id));
  }

  const negatives = rows.filter((r) => {
    const a = num(r.agreement_value);
    const c = num(r.amount_collected);
    const o = num(r.amount_overdue);
    return (a !== null && a < 0) || (c !== null && c < 0) || (o !== null && o < 0);
  });
  if (negatives.length > 0) {
    add('negative_sale_amount', `${negatives.length} unit(s) carry a negative amount.`,
      negatives.map((r) => r.id));
  }

  const badPossession = rows.filter((r) => {
    const booking = parseDate(r.booking_date);
    const possession = parseDate(r.possession_date);
    return booking && possession && possession < booking;
  });
  if (badPossession.length > 0) {
    add('possession_before_booking',
      `${badPossession.length} unit(s) have a possession date before booking.`,
      badPossession.map((r) => r.id));
  }

  const overdueExceedsReceivable = rows.filter((r) => {
    if (!SALE_SOLD_STATUSES.has(r.status)) return false;
    const agreement = agreementValuePaise(r);
    const collected = num(r.amount_collected);
    const overdue = num(r.amount_overdue);
    if (agreement === null || overdue === null) return false;
    const receivable = agreement - (collected !== null ? toPaise(collected) : 0);
    return toPaise(overdue) > receivable + 1;
  });
  if (overdueExceedsReceivable.length > 0) {
    add('overdue_exceeds_receivable',
      `${overdueExceedsReceivable.length} unit(s) show an overdue amount larger than the outstanding receivable.`,
      overdueExceedsReceivable.map((r) => r.id));
  }

  return warnings;
};

// ── Hotel operating family (Shape C: keys × contracts × monthly actuals) ────
//
// Three record kinds under one register. The metric set has three parts:
//   • key inventory rollup — total / available (net out-of-order) keys, room
//     types, key-weighted ADR premium;
//   • management-contract summary — the governing fee structure;
//   • a trailing-twelve-months (TTM) operating rollup from ACTUAL monthly
//     P&L rows — the evidence of how the asset actually trades. Occupancy and
//     ADR are ROOM-NIGHT weighted (available keys × days per month), the only
//     defensible blend; when no key inventory is recorded it falls back to
//     days-weighted occupancy + arithmetic-mean ADR, and reports which basis
//     it used. Forecasting stays the deterministic kernel's job — this grounds it.

// Summarize the governing management contract (HMA / lease / franchise). The
// first non-cancelled contract governs; its fee structure drives owner NOI.
const summarizeHotelContracts = (contracts) => {
  if (!contracts || contracts.length === 0) {
    return { count: 0, primaryType: null, baseFeePct: null, incentiveFeePct: null, ffeReservePct: null, operator: null, brand: null };
  }
  const primary = contracts.find((c) => c.contract_type === 'hma' || c.contract_type === 'master_lease') || contracts[0];
  return {
    count: contracts.length,
    primaryType: primary.contract_type || null,
    operator: isPresent(primary.operator_name) ? primary.operator_name : null,
    brand: isPresent(primary.brand) ? primary.brand : null,
    baseFeePct: num(primary.base_fee_pct),
    incentiveFeePct: num(primary.incentive_fee_pct),
    ffeReservePct: num(primary.ffe_reserve_pct),
    keysCovered: num(primary.keys_covered),
  };
};

/**
 * Compute the full hotel operating metric set.
 *
 * @param {object} recordsByKind  { hotel_key_block, hotel_contract, hotel_operating_month }
 * @param {object} parent         deal_registers row ({ as_of_date, settings })
 * @param {object} [opts]         { asOf?: Date|string }
 */
export const computeHotelMetrics = (recordsByKind = {}, parent = {}, opts = {}) => {
  const asOf = parseDate(opts.asOf) || parseDate(parent.as_of_date) || new Date();
  const live = (r) => r && !r.deleted_at;
  const blocks = (recordsByKind.hotel_key_block || []).filter(live);
  const contracts = (recordsByKind.hotel_contract || []).filter(live);
  const monthsAll = (recordsByKind.hotel_operating_month || []).filter(live);

  // ── Key inventory ──
  let totalKeys = 0;
  let availableKeys = 0;
  let operationalKeys = 0;
  let premiumKeyWeighted = 0;
  let premiumKeys = 0;
  for (const b of blocks) {
    const keys = num(b.keys_count);
    if (keys === null) continue;
    totalKeys += keys;
    const operational = b.operational !== false; // default true
    if (operational) {
      operationalKeys += keys;
      const ooo = num(b.ooo_pct);
      const oooFrac = ooo === null ? 0 : Math.min(Math.max(ooo, 0), 100) / 100;
      availableKeys += keys * (1 - oooFrac);
    }
    const prem = num(b.adr_premium_pct);
    if (prem !== null) { premiumKeyWeighted += prem * keys; premiumKeys += keys; }
  }

  // ── TTM window: the latest ≤12 months at/behind the as-of date ──
  const months = monthsAll
    .map((m) => ({ row: m, date: parseDate(m.month) }))
    .filter((m) => m.date && m.date <= asOf)
    .sort((a, b) => b.date - a.date)
    .slice(0, 12)
    .sort((a, b) => a.date - b.date);

  let roomRevP = 0;
  let fnbP = 0;
  let otherP = 0;
  let gopP = 0;
  let noiP = 0;
  // Presence counters — a ratio is only defensible when its component was
  // actually recorded (blank GOP must not read as 0% margin).
  let gopCount = 0;
  let fnbCount = 0;
  let otherCount = 0;
  // Room-night pools, each gated on the presence of EVERY input it needs so a
  // month with revenue-but-no-occupancy can never inflate ADR, nor a month
  // with occupancy-but-no-revenue deflate it. Each pool's numerator and
  // denominator therefore always cover exactly the same months.
  let occAvailNights = 0;  // occupancy known
  let occOccNights = 0;
  let adrOccNights = 0;    // occupancy AND room revenue known
  let adrRoomRevP = 0;
  let revparAvailNights = 0; // room revenue known
  let revparRoomRevP = 0;
  // Stored-average fallback (no key inventory).
  let occDaysWeighted = 0;
  let daysWithOcc = 0;
  let adrSum = 0;
  let adrCount = 0;
  const series = [];

  for (const { row: m, date } of months) {
    const days = daysInMonth(date);
    const occ = num(m.occupancy_pct);
    const adr = num(m.adr);
    const roomRev = num(m.room_revenue);
    const fnb = num(m.fnb_revenue);
    const other = num(m.other_revenue);
    const gop = num(m.gop);
    const noi = num(m.owner_noi);

    if (roomRev !== null) roomRevP += toPaise(roomRev);
    if (fnb !== null) { fnbP += toPaise(fnb); fnbCount += 1; }
    if (other !== null) { otherP += toPaise(other); otherCount += 1; }
    if (gop !== null) { gopP += toPaise(gop); gopCount += 1; }
    if (noi !== null) noiP += toPaise(noi);

    if (availableKeys > 0) {
      const an = availableKeys * days;
      if (occ !== null) {
        occAvailNights += an;
        occOccNights += an * (occ / 100);
        if (roomRev !== null) {
          adrOccNights += an * (occ / 100);
          adrRoomRevP += toPaise(roomRev);
        }
      }
      if (roomRev !== null) {
        revparAvailNights += an;
        revparRoomRevP += toPaise(roomRev);
      }
    }
    if (occ !== null) { occDaysWeighted += occ * days; daysWithOcc += days; }
    if (adr !== null) { adrSum += adr; adrCount += 1; }

    const hasRev = roomRev !== null || fnb !== null || other !== null;
    const totalRev = (roomRev || 0) + (fnb || 0) + (other || 0);
    series.push({
      month: date.toISOString().slice(0, 7),
      occupancyPct: occ,
      adr,
      revpar: (adr !== null && occ !== null) ? adr * (occ / 100) : null,
      roomRevenue: roomRev,
      fnbRevenue: fnb,
      otherRevenue: other,
      totalRevenue: hasRev ? totalRev : null,
      gop,
      gopMarginPct: (gop !== null && totalRev > 0) ? (gop / totalRev) * 100 : null,
      ownerNoi: noi,
    });
  }

  const totalRevP = roomRevP + fnbP + otherP;
  const roomNightBasis = availableKeys > 0;
  const ttmOccupancyPct = roomNightBasis && occAvailNights > 0
    ? (occOccNights / occAvailNights) * 100
    : (daysWithOcc > 0 ? occDaysWeighted / daysWithOcc : null);
  const ttmAdr = roomNightBasis && adrOccNights > 0
    ? fromPaise(adrRoomRevP) / adrOccNights
    : (adrCount > 0 ? adrSum / adrCount : null);
  const ttmRevpar = roomNightBasis && revparAvailNights > 0
    ? fromPaise(revparRoomRevP) / revparAvailNights
    : (ttmAdr !== null && ttmOccupancyPct !== null ? ttmAdr * (ttmOccupancyPct / 100) : null);

  return {
    metricsVersion: METRICS_VERSION,
    asOf: asOf.toISOString().slice(0, 10),
    counts: {
      keyBlocks: blocks.length,
      contracts: contracts.length,
      operatingMonths: monthsAll.length,
    },
    keys: {
      totalKeys,
      availableKeys,
      operationalKeys,
      roomTypes: blocks.length,
      weightedAdrPremiumPct: premiumKeys > 0 ? premiumKeyWeighted / premiumKeys : null,
    },
    contract: summarizeHotelContracts(contracts),
    operating: {
      monthsCovered: months.length,
      basis: roomNightBasis ? 'room_nights' : 'stored_averages',
      ttmOccupancyPct,
      ttmAdr,
      ttmRevpar,
      ttmTotalRevenue: fromPaise(totalRevP),
      ttmRoomRevenue: fromPaise(roomRevP),
      ttmFnbRevenue: fromPaise(fnbP),
      ttmOtherRevenue: fromPaise(otherP),
      ttmGop: fromPaise(gopP),
      // Null (not 0%) when no month recorded a GOP figure — a blank GOP column
      // is missing data, not a zero-margin quarter. Same for the mix ratios.
      ttmGopMarginPct: gopCount > 0 && totalRevP > 0 ? (gopP / totalRevP) * 100 : null,
      ttmOwnerNoi: fromPaise(noiP),
      fbRevPct: fnbCount > 0 && roomRevP > 0 ? (fnbP / roomRevP) * 100 : null,
      otherRevPct: otherCount > 0 && roomRevP > 0 ? (otherP / roomRevP) * 100 : null,
      series,
    },
  };
};

export const validateHotelRoll = (recordsByKind = {}) => {
  const warnings = [];
  const live = (r) => r && !r.deleted_at;
  const add = (code, message, recordIds = []) => warnings.push({ code, message, recordIds });
  const months = (recordsByKind.hotel_operating_month || []).filter(live);
  const contracts = (recordsByKind.hotel_contract || []).filter(live);
  const blocks = (recordsByKind.hotel_key_block || []).filter(live);

  const badOccupancy = months.filter((m) => {
    const occ = num(m.occupancy_pct);
    return occ !== null && (occ < 0 || occ > 100);
  });
  if (badOccupancy.length > 0) {
    add('occupancy_out_of_range', `${badOccupancy.length} operating month(s) have an occupancy outside 0–100%.`, badOccupancy.map((m) => m.id));
  }

  const gopExceedsRevenue = months.filter((m) => {
    const gop = num(m.gop);
    const total = (num(m.room_revenue) || 0) + (num(m.fnb_revenue) || 0) + (num(m.other_revenue) || 0);
    return gop !== null && total > 0 && gop > total * 1.001;
  });
  if (gopExceedsRevenue.length > 0) {
    add('gop_exceeds_revenue', `${gopExceedsRevenue.length} operating month(s) show GOP above total revenue.`, gopExceedsRevenue.map((m) => m.id));
  }

  const noiExceedsGop = months.filter((m) => {
    const noi = num(m.owner_noi);
    const gop = num(m.gop);
    return noi !== null && gop !== null && noi > gop + 1;
  });
  if (noiExceedsGop.length > 0) {
    add('noi_exceeds_gop', `${noiExceedsGop.length} operating month(s) show owner NOI above GOP.`, noiExceedsGop.map((m) => m.id));
  }

  const badContractDates = contracts.filter((c) => {
    const start = parseDate(c.start_date);
    const end = parseDate(c.end_date);
    return start && end && end < start;
  });
  if (badContractDates.length > 0) {
    add('contract_end_before_start', `${badContractDates.length} contract(s) end before they start.`, badContractDates.map((c) => c.id));
  }

  // Contract keys-covered vs recorded inventory — a >10% mismatch is worth a look.
  const totalKeys = blocks.reduce((s, b) => s + (num(b.keys_count) || 0), 0);
  const primary = contracts.find((c) => c.contract_type === 'hma' || c.contract_type === 'master_lease') || contracts[0];
  const covered = primary ? num(primary.keys_covered) : null;
  if (totalKeys > 0 && covered !== null && covered > 0 && Math.abs(covered - totalKeys) / totalKeys > 0.10) {
    add('contract_keys_mismatch',
      `The governing contract covers ${covered} keys but the inventory records ${totalKeys}.`);
  }

  return warnings;
};

