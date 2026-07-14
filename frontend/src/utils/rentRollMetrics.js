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

export const METRICS_VERSION = 'rr-metrics-1.0.0';
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

  const ladder = new Map(); // fy → { fy, areaSqft, annualRentPaise (base), leaseCount }
  let expiredArea = 0;
  const tenants = new Map(); // tenant → monthly base paise

  for (const r of rows) {
    const area = num(r.chargeable_area_sqft);
    const contracted = CONTRACTED_STATUSES.has(r.status);
    const physical = PHYSICAL_STATUSES.has(r.status);

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
    if (!contracted) continue; // loi / expired rows carry no revenue

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
