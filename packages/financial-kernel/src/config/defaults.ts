/**
 * Single source of truth for all asset-class defaults.
 *
 * Every numeric, string, or boolean default that the kernel, post-processors,
 * or upstream adapters need to fall back to — stamp duty, GST rates, per-
 * asset carpet ratios, USALI expense percentages, cap-rate bands — lives
 * here, in exactly one place, with metadata attached. Downstream modules
 * (`assumptions.ts`, `config/india.ts`, `assets/*.ts`) re-export or read
 * from this registry; they never redeclare a value.
 *
 * Why this exists (per docs/CLEANUP_INVENTORY.md + modernization plan):
 *   - Avoids the "same constant defined in four places" drift that hardcodes
 *     Bengaluru 2025 assumptions into 2026 code in ways that rot invisibly.
 *   - Every default carries `unit`, `range`, `source`, and `lastReviewed`
 *     so an auditor (or a provenance badge on the UI) can cite the default
 *     back to a regulatory notice, a market benchmark, or an explicit
 *     product decision.
 *   - Per-asset-class defaults are comprehensive: each class exposes every
 *     tunable its kernel adapter or post-processor reads, so nothing
 *     escapes the registry.
 *
 * If a default is missing from a deal, the kernel resolves it in this order
 * (later layers win, null/undefined = skip):
 *   1. `GLOBAL_DEFAULTS` (this file)         — platform-wide baseline
 *   2. `ASSET_DEFAULTS[class]` (this file)   — per-class tuning
 *   3. `dealOverrides`                       — the UI form
 *   4. `scenarioOverrides`                   — sensitivity / what-if
 *
 * IMPORTANT: Every value here is a *default*, not law. Deal-specific
 * overrides always win. The point of centralization is provenance, not
 * to prevent users from setting their own numbers.
 */

import type { AssetClass } from '../types';
import { INDIA_CONFIG } from './india';

// ─────────────────────────────────────────────────────────────────────────────
//  Metadata shape — every default carries this envelope.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unit of measure. Drives UI formatting and sanity checks. Numeric defaults
 * are paired with exactly one of these; strings/enums use `'enum'`; booleans
 * use `'flag'`.
 */
export type DefaultUnit =
  | 'pct'            // 0–100 percent
  | 'pp'             // percentage points (difference of two pct)
  | 'ratio'          // dimensionless fraction (e.g. 0.7)
  | 'inr'            // rupees absolute
  | 'inr_cr'         // rupees in crore
  | 'inr_per_sqft'   // rupees per square foot
  | 'inr_per_key'    // rupees per hospitality key
  | 'sqft'           // area
  | 'sqft_per_key'   // area per hospitality key
  | 'months'
  | 'years'
  | 'days'
  | 'count'          // integer count (keys, units, phases)
  | 'enum'           // string with allowed values
  | 'flag';          // boolean

export interface DefaultMeta<V = number> {
  /** The default value itself. */
  readonly value: V;
  /** Unit — drives UI display and validation. */
  readonly unit: DefaultUnit;
  /** Valid range `[min, max]` for numeric defaults. Omit for enums/flags. */
  readonly range?: readonly [number, number];
  /**
   * Where this default comes from. Keep terse — a regulatory citation,
   * a market benchmark, or an explicit product decision. Provenance
   * badges in the UI show this text verbatim, so write it to be read
   * by a skeptical investor.
   */
  readonly source: string;
  /** ISO date the default was last reviewed against its source. */
  readonly lastReviewed: string;
  /** One-line human description. Keep factual, no marketing. */
  readonly description: string;
  /** Allowed values when `unit === 'enum'`. */
  readonly enum?: readonly string[];
}

/** Record of default metadata entries keyed by field name. */
export type DefaultsBlock = Readonly<Record<string, DefaultMeta>>;

// ─────────────────────────────────────────────────────────────────────────────
//  Small helper — builds a metadata envelope with sensible defaults so
//  individual entries stay readable.
// ─────────────────────────────────────────────────────────────────────────────

function M<V>(
  value: V,
  unit: DefaultUnit,
  description: string,
  source: string,
  opts?: {
    range?: readonly [number, number];
    lastReviewed?: string;
    enum?: readonly string[];
  },
): DefaultMeta<V> {
  return Object.freeze({
    value,
    unit,
    description,
    source,
    lastReviewed: opts?.lastReviewed ?? '2026-07-22',
    range: opts?.range,
    enum: opts?.enum,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Global defaults — apply to every asset class unless overridden.
// ─────────────────────────────────────────────────────────────────────────────

export const GLOBAL_DEFAULTS_META: DefaultsBlock = Object.freeze({
  stampDutyPct: M(
    INDIA_CONFIG.STAMP_DUTY_RATE * 100, 'pct',
    'Stamp duty on land purchase (% of consideration).',
    'Karnataka Stamp Act Schedule, non-urban / developer transaction rate.',
    { range: [3, 7] },
  ),
  registrationPct: M(
    INDIA_CONFIG.REGISTRATION_RATE * 100, 'pct',
    'Registration charge on land transfer.',
    'Karnataka Registration Act Sec. 78. NOTE: Karnataka doubled this fee to '
      + '2% in Aug 2025; default update pending (moves in lockstep with the '
      + 'combined stamp+registration rate across kernel, exports, and tests). '
      + 'Override per deal for current transactions.',
    { range: [0.5, 2.5] },
  ),
  gstOnConstructionPct: M(
    INDIA_CONFIG.GST_CONSTRUCTION_STANDARD * 100, 'pct',
    'GST on under-construction property (no ITC). Adapter overrides per asset.',
    'CBIC GST Rate Notification 11/2017 as amended.',
    { range: [0, 18] },
  ),
  marketingCostPct: M(
    4, 'pct',
    'Sales & marketing as % of project revenue. Merchant-sale assets only.',
    'Anarock/JLL Bengaluru developer benchmarks — typical residential spend band.',
    { range: [1, 10] },
  ),
  financeCostPct: M(
    12, 'pct',
    'Annualised interest on construction debt (coupon, not all-in IRR).',
    'HDFC/ICICI/Tata Capital construction-loan rate cards Q1-2026.',
    { range: [8, 18] },
  ),
  architectFeePct: M(
    2, 'pct',
    'Architect fee as % of hard construction cost.',
    'CoA scale-of-fees for commercial/residential design-and-build.',
    { range: [0.5, 4] },
  ),
  pmcFeePct: M(
    1.5, 'pct',
    'Project management consultancy as % of hard cost.',
    'Turner/RLB Indian PMC benchmarks.',
    { range: [0.5, 3.5] },
  ),
  contingencyPct: M(
    5, 'pct',
    'Contingency as % of hard cost. Higher for complex hospitality/retail builds.',
    'Industry-standard construction contingency envelope.',
    { range: [2, 10] },
  ),
  developerMarginPct: M(
    20, 'pct',
    'Target developer margin — used for RLV back-solve when unset by deal.',
    'REDIP merchant-sale underwriting target.',
    { range: [10, 35] },
  ),
  discountRatePct: M(
    14, 'pct',
    'DCF discount rate (annual). Hospitality overrides to 15; all other '
      + 'asset classes use this 14% global default.',
    'REDIP WACC model — unlevered 12-16% band for India RE.',
    { range: [8, 22] },
  ),
  loadingFactor: M(
    INDIA_CONFIG.DEFAULT_LOADING_FACTOR, 'ratio',
    'Loading (common-area) factor over carpet to derive saleable. 15% default.',
    'RERA norms + Bengaluru market convention.',
    { range: [0, 0.3] },
  ),
  carpetRatio: M(
    INDIA_CONFIG.CARPET_RATIO, 'ratio',
    'Carpet / built-up area ratio. RERA-compliant India default.',
    'RERA Act 2016 disclosure norms.',
    { range: [0.55, 0.85] },
  ),
  vacancyPct: M(
    10, 'pct',
    'Stabilised vacancy assumption for income-producing assets.',
    'JLL APAC office/retail market snapshot average.',
    { range: [3, 25] },
  ),
  opexPct: M(
    20, 'pct',
    'Operating expense as % of gross rental revenue (incl. property tax, '
      + 'insurance, CAM net of recovery).',
    'JLL India core-asset OpEx benchmark.',
    { range: [8, 35] },
  ),
  rentEscalationPct: M(
    5, 'pct',
    'Annual rent escalation — typical India institutional lease.',
    'Blackstone/DLF office leasing rate card (CPI+).',
    { range: [3, 8] },
  ),
  exitCapRatePct: M(
    8, 'pct',
    'Exit cap rate for income assets. Class overrides: office 7.5, '
      + 'retail 8, industrial 8.5, hospitality 9.',
    'Cushman & Wakefield India cap-rate survey Q1-2026.',
    { range: [6, 12] },
  ),
  entryCapRatePct: M(
    8, 'pct',
    'Entry cap rate when back-solving land value from stabilised NOI.',
    'REDIP RLV convention — mirrors exit unless stated otherwise.',
    { range: [6, 12] },
  ),
  holdPeriodYears: M(
    5, 'years',
    'Income-asset hold period. Hospitality overrides to 10 years.',
    'REDIP standard underwriting — 5 year hold for core/core-plus.',
    { range: [3, 15] },
  ),
  propertyTaxPctOfRevenue: M(
    INDIA_CONFIG.PROPERTY_TAX_PCT_OF_REVENUE * 100, 'pct',
    'Annual property tax as % of gross revenue. BBMP UAV-system proxy.',
    'BBMP property tax calculator + REDIP revenue conversion.',
    { range: [0.5, 4] },
  ),
  buildingInsurancePctOfRevenue: M(
    INDIA_CONFIG.BUILDING_INSURANCE_PCT_OF_REVENUE * 100, 'pct',
    'Annual building insurance as % of gross revenue.',
    'ICICI Lombard / HDFC Ergo property insurance benchmarks.',
    { range: [0.3, 2] },
  ),
  landAppreciationPct: M(
    8, 'pct',
    'Annual land-value appreciation for raw-land holds.',
    'Knight Frank Bengaluru land index 5-year CAGR.',
    { range: [3, 15] },
  ),
});

// ─────────────────────────────────────────────────────────────────────────────
//  Per-asset-class defaults — comprehensive, named, attributed.
//  Each block overrides + supplements `GLOBAL_DEFAULTS_META`.
// ─────────────────────────────────────────────────────────────────────────────

/** Residential apartments — multi-family sale development. */
const RESIDENTIAL_APARTMENTS_META: DefaultsBlock = Object.freeze({
  fsi: M(
    2.5, 'ratio',
    'Floor Space Index (FAR) for residential plots inside BBMP limits.',
    'BDA Revised Master Plan 2031 — residential zone base.',
    { range: [0.8, 4] },
  ),
  avgUnitSizeSqft: M(
    1150, 'sqft',
    'Average saleable 2BHK+3BHK mix unit size (Bengaluru mid-market).',
    'Anarock Bengaluru residential supply mix Q1-2026.',
    { range: [600, 3500] },
  ),
  sellingRatePerSqft: M(
    9500, 'inr_per_sqft',
    'Base selling rate (carpet) for mid-market Bengaluru.',
    'PropEquity / 99acres new-launch medians Q1-2026.',
    { range: [5000, 35000] },
  ),
  hardCostPerSqft: M(
    2800, 'inr_per_sqft',
    'Structural + MEP hard cost per BUA sqft.',
    'Turner India construction cost index Q1-2026.',
    { range: [1800, 6000] },
  ),
  projectDurationMonths: M(
    36, 'months',
    'Launch-to-CC project duration for a typical apartment tower.',
    'RERA-registered Bengaluru project median.',
    { range: [24, 72] },
  ),
  saleCycleMonths: M(
    42, 'months',
    'Launch-to-final-unit-sold duration (tail longer than construction).',
    'Anarock absorption-velocity analysis.',
    { range: [24, 84] },
  ),
  preLaunchDiscountPct: M(
    8, 'pct',
    'Inventory discount on pre-launch tranche to seed sales.',
    'Developer launch-strategy norm.',
    { range: [0, 20] },
  ),
});

/** Villas — low-density residential. */
const VILLAS_META: DefaultsBlock = Object.freeze({
  fsi: M(
    0.8, 'ratio',
    'Plot-level FSI for villa layouts. Lower than apartments.',
    'BDA / peripheral panchayat layout sanctions.',
    { range: [0.4, 1.2] },
  ),
  loadingFactor: M(
    0.05, 'ratio',
    'Minimal common area (private plots → minimal loading).',
    'Observed practice in Bengaluru villa layouts.',
    { range: [0, 0.1] },
  ),
  avgPlotSizeSqft: M(
    2400, 'sqft',
    'Typical Bengaluru villa plot size.',
    'Prestige/Sobha/Godrej villa launches 2022-2025 median.',
    { range: [1200, 6000] },
  ),
  avgBuiltUpSqft: M(
    3000, 'sqft',
    'Typical built-up area per villa.',
    'Bengaluru villa project data.',
    { range: [1800, 7500] },
  ),
  sellingRatePerSqft: M(
    12000, 'inr_per_sqft',
    'Base selling rate for villas (plot + built-up blended).',
    'Bengaluru villa project launch rates 2025-2026.',
    { range: [7000, 30000] },
  ),
});

/** Plotted development — pure land subdivision + basic infra. */
const PLOTTED_DEVELOPMENT_META: DefaultsBlock = Object.freeze({
  gstOnConstructionPct: M(
    INDIA_CONFIG.GST_CONSTRUCTION_PLOTTED * 100, 'pct',
    'GST on plotted development (land component separable).',
    'CBIC GST Rate Notification 11/2017 as amended. NOTE: the Sept-2025 GST '
      + 'rate rationalization moved development-component works on plotted land '
      + 'to 18% (land itself stays outside GST); default update pending in '
      + 'lockstep with kernel adapters + tests. Override per deal.',
    { range: [0, 18] },
  ),
  saleableLandPct: M(
    55, 'pct',
    'Saleable land % of gross site after roads, parks, utilities, amenities.',
    'DTCP/BDA plotted-layout sanction norms (40-45% loss to roads/parks/amenity).',
    { range: [45, 70] },
  ),
  roadWidthFt: M(
    30, 'count',
    'Default internal road width (ft). DTCP minimum for residential plotting.',
    'DTCP layout rules, Karnataka.',
    { range: [18, 60] },
  ),
  developmentCostPerSqft: M(
    450, 'inr_per_sqft',
    'Infra cost per saleable sqft — roads, drains, water, power, amenity.',
    'Bengaluru developer plotted-layout cost sheets 2025.',
    { range: [200, 1200] },
  ),
  projectDurationMonths: M(
    18, 'months',
    'Plotted development cycle — faster than vertical construction.',
    'RERA-registered plotted project median.',
    { range: [9, 36] },
  ),
  phaseCount: M(
    3, 'count',
    'Default phase count for phased release of plots.',
    'Developer norm for inventory management.',
    { range: [1, 8] },
  ),
});

/** Commercial office — institutional-grade income. */
const COMMERCIAL_OFFICE_META: DefaultsBlock = Object.freeze({
  vacancyPct: M(
    10, 'pct',
    'Stabilised office vacancy. Bengaluru tech-corridor average.',
    'JLL Bengaluru Office Market Monitor Q1-2026.',
    { range: [3, 25] },
  ),
  exitCapRatePct: M(
    7.5, 'pct',
    'Grade A office exit cap rate (institutional buyer).',
    'Cushman & Wakefield India cap-rate survey Q1-2026.',
    { range: [6, 10] },
  ),
  rentPerSqftPerMonth: M(
    95, 'inr_per_sqft',
    'Grade A office rent (₹/sqft/month). Bengaluru CBD ORR benchmark.',
    'CBRE Bengaluru office rent snapshot Q1-2026.',
    { range: [40, 200] },
  ),
  rentEscalationPct: M(
    5, 'pct',
    'Rent escalation — typical 5%/year or 15% every 3 years.',
    'Institutional lease convention.',
    { range: [3, 8] },
  ),
  leaseTermYears: M(
    9, 'years',
    'Lease term for grade A office (5+4 or 9-yr lock).',
    'Mindspace/Embassy REIT lease schedules.',
    { range: [3, 15] },
  ),
  tiAllowancePerSqft: M(
    700, 'inr_per_sqft',
    'Tenant improvement allowance for speculative offices.',
    'CBRE India office fit-out cost guide.',
    { range: [0, 2500] },
  ),
  leasingCommissionPct: M(
    2, 'pct',
    'Leasing broker commission (% of first-year rent).',
    'IPC (JLL/CBRE/KF) India leasing fee norms.',
    { range: [1, 4] },
  ),
  parkingRatioPerKSqft: M(
    1, 'count',
    'Car parks per 1,000 sqft leasable — Bengaluru STP norm.',
    'BBMP parking requirement for office 1:1000 sqft.',
    { range: [0.5, 2.5] },
  ),
});

/** Retail — mall / high-street income. */
const RETAIL_META: DefaultsBlock = Object.freeze({
  vacancyPct: M(
    12, 'pct',
    'Retail vacancy — higher than office due to anchor turnover.',
    'JLL India Retail Market Monitor.',
    { range: [5, 25] },
  ),
  anchorPct: M(
    40, 'pct',
    'Anchor share of leasable area — mall norm.',
    'JLL/CBRE mall composition guidelines.',
    { range: [20, 55] },
  ),
  anchorRentDiscount: M(
    20, 'pct',
    'Anchor rent discount vs. in-line tenants (draw benefit).',
    'Phoenix/DLF mall leasing data.',
    { range: [10, 40] },
  ),
  exitCapRatePct: M(
    8, 'pct',
    'Mall / institutional retail exit cap.',
    'Cushman & Wakefield India retail cap survey.',
    { range: [7, 11] },
  ),
  rentPerSqftPerMonth: M(
    180, 'inr_per_sqft',
    'In-line retail rent (₹/sqft/month) — Bengaluru mall average.',
    'JLL Bengaluru retail rent benchmark.',
    { range: [60, 500] },
  ),
  camRecoveryPct: M(
    95, 'pct',
    'Common area maintenance recovery rate from tenants.',
    'Institutional mall recovery norm.',
    { range: [70, 100] },
  ),
  turnoverRentPct: M(
    5, 'pct',
    '% of tenant turnover rent (on top of minimum guarantee) — anchor clauses.',
    'Mall leasing deal structure.',
    { range: [0, 12] },
  ),
  footfallPerSqftPerYear: M(
    40, 'count',
    'Annual footfall per leasable sqft — mall benchmark.',
    'Shopping Centres Association of India.',
    { range: [15, 100] },
  ),
});

/** Industrial / warehousing — grade A logistics. */
const INDUSTRIAL_WAREHOUSING_META: DefaultsBlock = Object.freeze({
  vacancyPct: M(
    8, 'pct',
    'Grade A warehousing vacancy — tight supply in India.',
    'Knight Frank India Warehousing Report Q1-2026.',
    { range: [3, 15] },
  ),
  opexPct: M(
    15, 'pct',
    'Warehouse OpEx as % of rent (triple-net leases lower this).',
    'IndoSpace/ESR India operating data.',
    { range: [5, 25] },
  ),
  exitCapRatePct: M(
    8.5, 'pct',
    'Grade A warehousing exit cap.',
    'Cushman & Wakefield India logistics cap survey.',
    { range: [7, 11] },
  ),
  rentPerSqftPerMonth: M(
    24, 'inr_per_sqft',
    'Grade A warehouse rent — Bengaluru / Chennai markets.',
    'Knight Frank India Warehousing Report Q1-2026.',
    { range: [15, 45] },
  ),
  eaveHeightFt: M(
    36, 'count',
    'Clear eave height (ft) for grade A spec.',
    'WDRA grade A warehouse spec.',
    { range: [24, 48] },
  ),
  dockRatioPer10kSqft: M(
    1, 'count',
    'Dock doors per 10,000 sqft — typical 3PL specification.',
    'Industry standard for grade A.',
    { range: [0.5, 2] },
  ),
  hardCostPerSqft: M(
    1700, 'inr_per_sqft',
    'PEB-based warehouse hard cost per sqft.',
    'Turner India PEB cost index.',
    { range: [1200, 3500] },
  ),
  leaseTermYears: M(
    9, 'years',
    'Typical 3PL / institutional tenant lease term.',
    'Institutional warehouse lease norm.',
    { range: [3, 15] },
  ),
});

/** Hospitality — upper-upscale / luxury urban hotel. */
const HOSPITALITY_META: DefaultsBlock = Object.freeze({
  exitCapRatePct: M(
    9, 'pct',
    'Hospitality exit cap — higher than office due to operational intensity.',
    'Cushman & Wakefield India hotel cap survey Q1-2026.',
    { range: [7, 12] },
  ),
  discountRatePct: M(
    15, 'pct',
    'Hospitality DCF discount — reflects higher op risk + stabilisation ramp.',
    'REDIP WACC model — hospitality band.',
    { range: [10, 22] },
  ),
  // NB: These values are aligned with the legacy hospitality kernel's
  // hardcoded num() fallbacks (see assets/hospitality.ts). The parity
  // suite (backend/tests/kernel.parity.test.js) depends on them matching
  // the kernel's internal defaults byte-for-byte. Upgrade to more current
  // market benchmarks requires moving the kernel's fallbacks in lockstep.
  keys: M(
    200, 'count',
    'Default room count — mid-to-upper-upscale urban hotel.',
    'HVS India hotel benchmark.',
    { range: [30, 500] },
  ),
  sqftPerKey: M(
    550, 'sqft_per_key',
    'Gross BUA per key (room + back-of-house + amenity share).',
    'Marriott/IHG/Hyatt design briefs for India upper-upscale.',
    { range: [400, 900] },
  ),
  adr: M(
    8500, 'inr',
    'Average Daily Rate (stabilised) — legacy hardcoded, matches parity gate.',
    'HVS India Hotel Review Q1-2026 (upper-upscale band).',
    { range: [3000, 30000] },
  ),
  adrGrowthPct: M(
    5, 'pct',
    'Annual ADR escalation post-stabilisation.',
    'HVS India ADR CAGR observed 2015-2025.',
    { range: [2, 10] },
  ),
  stabilizedOccPct: M(
    65, 'pct',
    'Stabilised occupancy — matches legacy kernel fallback. HVS upper-upscale '
      + 'can run 68-72%; leaving default at 65 preserves parity.',
    'Legacy kernel fallback (65%). HVS India 2025 benchmark: 68-72%.',
    { range: [50, 85] },
  ),
  initialOccPct: M(
    45, 'pct',
    'Year-1 occupancy (ramp-up starting point). USALI cascade default.',
    'HVS India new-hotel ramp-up curve.',
    { range: [25, 60] },
  ),
  stabilizationYear: M(
    4, 'years',
    'Years to reach stabilised occupancy.',
    'HVS India ramp-up benchmark (3-5 yrs typical).',
    { range: [2, 6] },
  ),
  // NB: holdPeriodYears intentionally NOT overridden here — the kernel
  // hospitality adapter clamps this via its own input schema. Global
  // default of 5 years applies; hospitality deals typically override.

  // ── Simplified single-margin fields consumed by the kernel's hospitality
  //   adapter (assets/hospitality.ts). These are the *aggregate* cascade
  //   defaults; the detailed USALI post-processor uses the split fields
  //   below (fbRestaurantPctOfRooms + fbBanquetPctOfRooms, etc.). Aligned
  //   to legacy kernel hardcoded fallbacks for parity.
  fbRevPct: M(
    30, 'pct',
    'Total F&B revenue as % of rooms revenue (aggregate — kernel simplified '
      + 'model). Split detail lives in fbRestaurantPctOfRooms + fbBanquetPctOfRooms.',
    'Legacy kernel hardcoded default (30%). Matches 18 + 12 USALI split.',
    { range: [15, 50] },
  ),
  otherRevPct: M(
    9, 'pct',
    'Other operated + parking revenue as % of rooms revenue (aggregate).',
    'Legacy kernel hardcoded default (9%). Matches 7 + 2 USALI split.',
    { range: [3, 20] },
  ),
  gopMarginPct: M(
    30, 'pct',
    'Gross Operating Profit margin — kernel simplified cascade (legacy parity).',
    'HVS India upper-upscale GOP benchmark ~30% stabilised.',
    { range: [20, 45] },
  ),
  ebitdaMarginPct: M(
    22, 'pct',
    'EBITDA margin — kernel simplified cascade (legacy parity).',
    'HVS India upper-upscale EBITDA benchmark ~22% stabilised.',
    { range: [12, 35] },
  ),

  fbRestaurantPctOfRooms: M(
    18, 'pct',
    'Restaurant F&B revenue as % of rooms revenue.',
    'USALI 11e — India upper-upscale reference P&L.',
    { range: [10, 30] },
  ),
  fbBanquetPctOfRooms: M(
    12, 'pct',
    'Banquet F&B revenue as % of rooms revenue.',
    'USALI 11e — India upper-upscale reference P&L.',
    { range: [4, 25] },
  ),
  otherOperatedPctOfRooms: M(
    7, 'pct',
    'Other operated (spa, laundry, business centre) as % of rooms revenue.',
    'USALI 11e — India upper-upscale reference P&L.',
    { range: [3, 15] },
  ),
  parkingPctOfRooms: M(
    2, 'pct',
    'Parking revenue as % of rooms revenue.',
    'USALI 11e — India urban upper-upscale.',
    { range: [0, 5] },
  ),
  roomsDeptCostPct: M(
    28, 'pct',
    'Rooms departmental expense as % of rooms revenue.',
    'USALI 11e — India upper-upscale.',
    { range: [20, 40] },
  ),
  fbDeptCostPct: M(
    75, 'pct',
    'F&B departmental expense as % of F&B revenue.',
    'USALI 11e — India upper-upscale.',
    { range: [60, 90] },
  ),
  otherDeptCostPct: M(
    52, 'pct',
    'Other operated departmental expense as % of other-operated revenue.',
    'USALI 11e reference.',
    { range: [40, 70] },
  ),
  aAndGPct: M(
    7.5, 'pct',
    'Administrative & General as % of total revenue.',
    'USALI 11e undistributed benchmarks.',
    { range: [5, 12] },
  ),
  itPct: M(
    2.0, 'pct',
    'Information Technology as % of total revenue.',
    'USALI 11e undistributed benchmarks.',
    { range: [1, 4] },
  ),
  smPct: M(
    5.5, 'pct',
    'Sales & Marketing as % of total revenue.',
    'USALI 11e undistributed benchmarks.',
    { range: [3, 9] },
  ),
  pomPct: M(
    4.5, 'pct',
    'Property Operations & Maintenance as % of total revenue.',
    'USALI 11e undistributed benchmarks.',
    { range: [3, 7] },
  ),
  utilitiesPct: M(
    5.0, 'pct',
    'Utilities as % of total revenue.',
    'USALI 11e undistributed benchmarks.',
    { range: [3, 9] },
  ),
  mgmtBasePct: M(
    3.0, 'pct',
    'Management base fee — % of total revenue.',
    'Marriott/IHG/Hyatt India HMA standard.',
    { range: [1.5, 5] },
  ),
  mgmtIncentivePct: M(
    9.0, 'pct',
    'Management incentive fee — % of GOP (clamped at zero when GOP < 0).',
    'Marriott/IHG/Hyatt India HMA standard.',
    { range: [5, 12] },
  ),
  brandRoyaltyPctOfRooms: M(
    5.0, 'pct',
    'Brand royalty fee — % of rooms revenue.',
    'Marriott/Hilton/IHG franchise fee schedule.',
    { range: [3, 8] },
  ),
  brandMktReservPctOfRooms: M(
    2.0, 'pct',
    'Brand marketing + reservation fee — % of rooms revenue.',
    'Marriott/Hilton/IHG franchise fee schedule.',
    { range: [1, 4] },
  ),
  propertyTaxPctRev: M(
    2.0, 'pct',
    'Property tax as % of total revenue (BBMP UAV proxy).',
    'BBMP property tax + India hotel revenue conversion.',
    { range: [0.5, 4] },
  ),
  insurancePctRev: M(
    1.0, 'pct',
    'Insurance as % of total revenue.',
    'India hotel insurance benchmarks.',
    { range: [0.3, 2] },
  ),
  ffeReservePct: M(
    4.0, 'pct',
    'FF&E reserve — % of total revenue, held back for refurbishment.',
    'HVS India FF&E reserve convention (typically 4% stabilised).',
    { range: [2, 6] },
  ),
  preOpeningCostPerKey: M(
    350_000, 'inr_per_key',
    'Pre-opening cost per key (training, marketing, soft-opening losses).',
    'HVS India upper-upscale pre-opening benchmark.',
    { range: [200_000, 800_000] },
  ),
});

/** Mixed use — blended residential + commercial. */
const MIXED_USE_META: DefaultsBlock = Object.freeze({
  residentialShareOfRevenue: M(
    60, 'pct',
    'Default revenue split — residential vs. commercial.',
    'Typical Bengaluru mixed-use project profile.',
    { range: [20, 80] },
  ),
  retailShareOfRevenue: M(
    10, 'pct',
    'Retail share of revenue in mixed-use.',
    'Typical project composition.',
    { range: [0, 35] },
  ),
});

/** Land parcel — raw-land merchant hold or flip. */
const LAND_PARCEL_META: DefaultsBlock = Object.freeze({
  gstOnConstructionPct: M(
    INDIA_CONFIG.GST_LAND_PARCEL * 100, 'pct',
    'GST on raw land — 0% (sale of land is out of GST scope).',
    'CBIC — Schedule III of CGST Act.',
    { range: [0, 0] },
  ),
  stampDutyPct: M(
    INDIA_CONFIG.STAMP_DUTY_RATE * 100, 'pct',
    'Stamp duty on raw-land purchase.',
    'Karnataka Stamp Act Schedule.',
    { range: [3, 7] },
  ),
  holdPeriodYears: M(
    3, 'years',
    'Default land-hold horizon before flip.',
    'REDIP raw-land underwriting.',
    { range: [1, 10] },
  ),
  landAppreciationPct: M(
    8, 'pct',
    'Annual appreciation assumption.',
    'Knight Frank Bengaluru land index 5-yr CAGR.',
    { range: [3, 15] },
  ),
  holdingCostPctOfLand: M(
    1.5, 'pct',
    'Annual carry cost (taxes, security, interest) as % of land cost.',
    'REDIP raw-land carry convention.',
    { range: [0.5, 4] },
  ),
});

/** Redevelopment — society / cluster redevelopment deal. */
const REDEVELOPMENT_META: DefaultsBlock = Object.freeze({
  rehabSharePct: M(
    55, 'pct',
    'Area share reserved for existing occupant rehabilitation (vs. saleable).',
    'Mumbai DCR 33(7)/33(9) + Bengaluru cluster-redev norms.',
    { range: [30, 75] },
  ),
  saleableSharePct: M(
    45, 'pct',
    'Developer saleable share.',
    'Mirror of rehabSharePct. Sum must = 100.',
    { range: [25, 70] },
  ),
  corpusPerRehabUnitCr: M(
    0.25, 'inr_cr',
    'Corpus fund per rehab unit — developer-paid to society.',
    'Typical Mumbai/Bengaluru redev deal structures 2024-2026.',
    { range: [0.05, 1.5] },
  ),
  rentInLieuPerMonth: M(
    40_000, 'inr',
    'Alternate-accommodation rent paid during construction (₹/unit/month).',
    'Market-standard redev rent-in-lieu schedule.',
    { range: [15_000, 120_000] },
  ),
  projectDurationMonths: M(
    48, 'months',
    'Approval + construction + handover cycle (longer than green-field).',
    'Redev cycle median (incl. NOC lag).',
    { range: [30, 84] },
  ),
});

// ─────────────────────────────────────────────────────────────────────────────
//  Asset registry — one frozen object per asset class.
// ─────────────────────────────────────────────────────────────────────────────

export const ASSET_DEFAULTS_META: Readonly<Record<AssetClass, DefaultsBlock>> =
  Object.freeze({
    residential_apartments: RESIDENTIAL_APARTMENTS_META,
    villas: VILLAS_META,
    plotted_development: PLOTTED_DEVELOPMENT_META,
    commercial_office: COMMERCIAL_OFFICE_META,
    retail: RETAIL_META,
    industrial_warehousing: INDUSTRIAL_WAREHOUSING_META,
    hospitality: HOSPITALITY_META,
    mixed_use: MIXED_USE_META,
    land_parcel: LAND_PARCEL_META,
    redevelopment: REDEVELOPMENT_META,
  });

// ─────────────────────────────────────────────────────────────────────────────
//  Value-only projections (backward compat with `assumptions.ts`).
// ─────────────────────────────────────────────────────────────────────────────

/** Extract `{ key: value }` from a metadata block. */
function stripMeta(block: DefaultsBlock): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [k, m] of Object.entries(block)) {
    if (typeof m.value === 'number') out[k] = m.value;
  }
  return Object.freeze(out);
}

/** Plain `{ key: value }` projection of GLOBAL_DEFAULTS_META. */
export const GLOBAL_DEFAULTS_VALUES: Readonly<Record<string, number>> =
  stripMeta(GLOBAL_DEFAULTS_META);

/** Plain `{ key: value }` projection per asset class. */
export const ASSET_DEFAULTS_VALUES: Readonly<
  Record<AssetClass, Readonly<Record<string, number>>>
> = Object.freeze(
  Object.fromEntries(
    (Object.entries(ASSET_DEFAULTS_META) as [AssetClass, DefaultsBlock][]).map(
      ([cls, block]) => [cls, stripMeta(block)],
    ),
  ) as Record<AssetClass, Readonly<Record<string, number>>>,
);

// ─────────────────────────────────────────────────────────────────────────────
//  Accessors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the full metadata block for an asset class (per-asset overrides
 * only — not merged with globals). Use this when you want to show a
 * user every tunable for a class and where each number came from.
 */
export function getAssetDefaultsMeta(cls: AssetClass): DefaultsBlock {
  return ASSET_DEFAULTS_META[cls];
}

/**
 * Return the effective metadata for a single default key, consulting the
 * asset-class override first and falling back to globals. Throws if the
 * key is unknown in both layers.
 */
export function getDefaultMeta(cls: AssetClass, key: string): DefaultMeta {
  const assetBlock = ASSET_DEFAULTS_META[cls];
  if (key in assetBlock) return assetBlock[key];
  if (key in GLOBAL_DEFAULTS_META) return GLOBAL_DEFAULTS_META[key];
  throw new Error(
    `No default registered for "${key}" in asset "${cls}" or globals. ` +
      `Add it to config/defaults.ts before reading it.`,
  );
}

/**
 * Return a plain value (number) for a default, resolving asset-first
 * then global. Throws on unknown key — never returns undefined.
 */
export function getDefaultValue(cls: AssetClass, key: string): number {
  const m = getDefaultMeta(cls, key);
  if (typeof m.value !== 'number') {
    throw new Error(
      `Default "${key}" for asset "${cls}" is non-numeric (unit=${m.unit}). ` +
        `Use getDefaultMeta() instead.`,
    );
  }
  return m.value;
}

/**
 * List every default key that applies to an asset class (global keys
 * + per-asset overrides), de-duplicated and stable-sorted. Useful for
 * rendering an "all defaults for this class" inspector in the UI.
 */
export function listDefaultKeys(cls: AssetClass): ReadonlyArray<string> {
  const set = new Set<string>([
    ...Object.keys(GLOBAL_DEFAULTS_META),
    ...Object.keys(ASSET_DEFAULTS_META[cls]),
  ]);
  return Object.freeze([...set].sort());
}

/** The list of asset classes the registry covers. */
export const SUPPORTED_ASSET_CLASSES: ReadonlyArray<AssetClass> =
  Object.freeze(Object.keys(ASSET_DEFAULTS_META) as AssetClass[]);
