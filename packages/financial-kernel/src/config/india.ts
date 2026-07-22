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
   * (5% stamp + 2% registration + 0.6% cess/surcharge on the duty). Used by
   * the hospitality adapter when registering property.
   * Karnataka doubled the registration fee 1% → 2% in Aug 2025 (first
   * revision since 2003) — combined moved 6.6% → 7.6%.
   * Last reviewed 2026-07-22. Deal-level overrides win regardless.
   */
  KARNATAKA_STAMP_REG_RATE: 0.076,

  /**
   * Registration charge component (part of the 7.6% figure above).
   * 2% since Aug 2025 (Karnataka Registration Act — fee doubled from the
   * 1% that had held since 2003). Last reviewed 2026-07-22.
   */
  REGISTRATION_RATE: 0.02,

  /**
   * GST on construction / development works (cost-side, applied to the
   * construction or development cost in the kernel adapters) — CBIC schedule
   * after the Sept-2025 GST rate rationalization:
   *   - Standard construction (works contract): 18%.
   *   - Plotted development: 18% on the development component — the 12%
   *     services slab was retired in Sept 2025; land itself stays outside GST.
   *   - Land parcel: 0% (Schedule III — sale of land outside GST scope).
   * Asset-class dispatch lives in `DEFAULT_GST_BY_ASSET` in common.ts.
   * Last reviewed 2026-07-22.
   */
  GST_CONSTRUCTION_STANDARD: 0.18,
  GST_CONSTRUCTION_PLOTTED: 0.18,
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
