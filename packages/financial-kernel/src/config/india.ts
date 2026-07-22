/**
 * Canonical source of India/Bengaluru regulatory and unit constants.
 *
 * Anything hard-coded to Indian jurisdiction or Bengaluru municipal rules
 * should be declared here, with a pointer to its authority and a last-
 * reviewed date. Every other module in the kernel (and the backend JS
 * engine where relevant) should re-export from here rather than redeclare.
 *
 * These values are *defaults*, not law. Production callers can override
 * any of them on a per-deal basis via `AssumptionSet.dealOverrides` — this
 * file exists so the defaults live in exactly one place.
 *
 * IMPORTANT: do not add currency-conversion, market-rate, or asset-class-
 * specific pricing here. Those belong in `assumptions.ts` or in deal input.
 */
export const INDIA_CONFIG = Object.freeze({
  /** 1 acre = 43,560 sqft (US customary — same in India for RE area). */
  SQFT_PER_ACRE: 43_560,

  /** ₹1 Crore in rupees. Used to flip between ₹/sqft inputs and Cr outputs. */
  CRORE: 1e7,

  /**
   * Stamp duty on land purchase (% of consideration).
   * Default 5% — Karnataka slab for consideration above ₹45 lakh (2% / 3%
   * on lower slabs). Urban add-ons (10% cess + 2% surcharge on the duty)
   * take the effective duty to ~5.6%; adjust per deal.
   * Last reviewed 2026-07-22 — 5% slab CONFIRMED current.
   */
  STAMP_DUTY_RATE: 0.05,

  /**
   * Karnataka combined stamp + registration for urban property transfers
   * (5% stamp + 1% registration + 0.6% cess/surcharge). Used by the
   * hospitality adapter when registering property.
   *
   * ⚠ KNOWN STALE (review 2026-07-22): Karnataka doubled the registration
   * fee 1% → 2% in Aug 2025 (first revision since 2003), so the current
   * combined urban figure is ~7.6%. Value intentionally NOT changed here yet:
   * 0.066 is load-bearing across the XLSX v2 builder defaults, the kernel
   * parity/precision/export test suites, and the backend + frontend config
   * mirrors — the update must move all of them in lockstep (tracked as a
   * dedicated follow-up). Deal-level overrides win regardless.
   */
  KARNATAKA_STAMP_REG_RATE: 0.066,

  /**
   * Registration charge component (part of the 6.6% figure above).
   * ⚠ KNOWN STALE (review 2026-07-22): now 2% (Aug 2025) — see note above;
   * updates in lockstep with KARNATAKA_STAMP_REG_RATE.
   */
  REGISTRATION_RATE: 0.01,

  /**
   * GST on under-construction property (no ITC) — CBIC schedule.
   *   - All other construction: 18% — CONFIRMED current (review 2026-07-22).
   *   - Land parcel: 0% (Schedule III — sale of land outside GST) — CONFIRMED.
   *   - Plotted development: ⚠ KNOWN STALE (review 2026-07-22): the Sept-2025
   *     GST rate rationalization retired most of the 12% services slab; works-
   *     contract / development services on plotted land are now 18% on the
   *     development component (land itself remains outside GST). Value kept at
   *     0.12 pending the same lockstep update as the stamp/registration rates
   *     (kernel adapters + validators + tests reference it).
   * Asset-class dispatch lives in `DEFAULT_GST_BY_ASSET` in common.ts.
   */
  GST_CONSTRUCTION_STANDARD: 0.18,
  GST_CONSTRUCTION_PLOTTED: 0.12,
  GST_LAND_PARCEL: 0.0,

  /**
   * Property-tax annual charge as % of stabilized revenue (hospitality and
   * income assets). Bengaluru BBMP is a unit-area-value system, so this
   * is a planning proxy — tune per-asset in deal overrides.
   */
  PROPERTY_TAX_PCT_OF_REVENUE: 0.02,

  /** Typical builder insurance (% of revenue). */
  BUILDING_INSURANCE_PCT_OF_REVENUE: 0.01,

  /** Residential carpet : built-up area ratio (RERA India norm). */
  CARPET_RATIO: 0.7,

  /** Default loading factor on FAR for saleable area. */
  DEFAULT_LOADING_FACTOR: 0.15,
} as const);

/**
 * Plain-object form intended for JSON/CJS consumers (the legacy JS engine,
 * backend services, frontend utils). Identical values; the separate export
 * lets non-TS code import without a type dependency.
 */
export const INDIA_CONFIG_JSON: {
  readonly [K in keyof typeof INDIA_CONFIG]: number;
} = INDIA_CONFIG;

/** Convert square feet to acres. */
export function sqftToAcres(sqft: number): number {
  return sqft / INDIA_CONFIG.SQFT_PER_ACRE;
}

/** Convert acres to square feet. */
export function acresToSqft(acres: number): number {
  return acres * INDIA_CONFIG.SQFT_PER_ACRE;
}

/** Convert rupees to crores. */
export function rupeesToCrore(inr: number): number {
  return inr / INDIA_CONFIG.CRORE;
}
