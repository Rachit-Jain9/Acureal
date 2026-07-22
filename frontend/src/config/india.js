/**
 * Frontend mirror of `packages/financial-kernel/src/config/india.ts`.
 *
 * The frontend is a browser bundle; it can't `require` the kernel's
 * Node-built dist. Instead, it holds its own constant object whose
 * values must stay in lockstep with the kernel's `INDIA_CONFIG`. A
 * Jest test at `packages/financial-kernel/tests/config.defaults.test.ts`
 * guards the invariants; if that suite breaks after editing this file,
 * update both sides at once.
 *
 * Do not inline `43560`, `0.05`, `0.18` anywhere else in the frontend
 * — always import from here.
 */
export const INDIA_CONFIG = Object.freeze({
  /** 1 acre = 43,560 sqft. */
  SQFT_PER_ACRE: 43_560,

  /** ₹1 Crore in rupees. */
  CRORE: 1e7,

  /** Stamp duty on land purchase (% of consideration). */
  STAMP_DUTY_RATE: 0.05,

  /**
   * Karnataka combined stamp + registration for urban property transfers.
   * Registration doubled 1% → 2% in Aug 2025 (combined 6.6% → 7.6%).
   */
  KARNATAKA_STAMP_REG_RATE: 0.076,

  /** Registration-only charge component (2% since Aug 2025). */
  REGISTRATION_RATE: 0.02,

  /**
   * GST on construction / development works (cost-side). Plotted moved
   * 12% → 18% with the Sept-2025 GST rate rationalization.
   */
  GST_CONSTRUCTION_STANDARD: 0.18,
  GST_CONSTRUCTION_PLOTTED: 0.18,
  GST_LAND_PARCEL: 0.0,

  /** Property tax as % of stabilized revenue (Bengaluru BBMP proxy). */
  PROPERTY_TAX_PCT_OF_REVENUE: 0.02,

  /** Building insurance as % of revenue. */
  BUILDING_INSURANCE_PCT_OF_REVENUE: 0.01,

  /** Residential carpet : built-up area ratio (RERA norm). */
  CARPET_RATIO: 0.7,

  /** Default loading factor on FAR for saleable area. */
  DEFAULT_LOADING_FACTOR: 0.15,
});

export const SQFT_PER_ACRE = INDIA_CONFIG.SQFT_PER_ACRE;
export const CRORE = INDIA_CONFIG.CRORE;
export const STAMP_DUTY_RATE = INDIA_CONFIG.STAMP_DUTY_RATE;
export const KARNATAKA_STAMP_REG_RATE = INDIA_CONFIG.KARNATAKA_STAMP_REG_RATE;
export const REGISTRATION_RATE = INDIA_CONFIG.REGISTRATION_RATE;
export const GST_CONSTRUCTION_STANDARD = INDIA_CONFIG.GST_CONSTRUCTION_STANDARD;
export const GST_CONSTRUCTION_PLOTTED = INDIA_CONFIG.GST_CONSTRUCTION_PLOTTED;
export const GST_LAND_PARCEL = INDIA_CONFIG.GST_LAND_PARCEL;

export const sqftToAcres = (sqft) => sqft / SQFT_PER_ACRE;
export const acresToSqft = (acres) => acres * SQFT_PER_ACRE;
export const rupeesToCrore = (inr) => inr / CRORE;
