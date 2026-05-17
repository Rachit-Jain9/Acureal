// frontend/src/utils/guidanceValueAnalysis.js
// Pure-JS kernel that compares a deal's effective transaction price per sqft
// against a BBMP guidance-value bandwidth and produces:
//   • Spread %  ((market - guidance_mid) / guidance_mid) × 100
//   • Investor signal: undervalued / fair / overpriced / bubble
//   • Risk-adjusted entry price = guidance_mid × 1.10 (per GROK doc rule)
//
// Inputs are loose (numbers, strings, nulls accepted) so a deal page can
// pipe them in without sanitising — the kernel returns `ok: false` with a
// machine-readable `reason` whenever computation isn't possible.
//
// Why a frontend-only kernel: every calculation is deterministic and runs
// on values the deal page already has in props. No new backend call needed.
// If/when we need to surface Spread % in IC exports or backend snapshots,
// mirror this file to backend/src/utils/ and add a parity test (same
// pattern as buildEnvelope / parcelBuildability).

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

// Resolve the "midpoint" of a guidance bandwidth. If only the lower bound
// is present (e.g. Zone A's "Rs. 7,001+ /sqft" with max = null), the
// midpoint is the lower bound itself — that's the floor the gazette
// publishes, so it's the right anchor for spread math.
const guidanceMidpoint = (minInr, maxInr) => {
  const lo = toFiniteNumber(minInr);
  const hi = toFiniteNumber(maxInr);
  if (lo === null && hi === null) return null;
  if (lo === null) return hi;
  if (hi === null) return lo;
  return (lo + hi) / 2;
};

// Signal thresholds — calibrated from the GROK domain note, restated:
//   spread < -15%   → undervalued opportunity
//   -15% ≤ s < 25%  → fair (transaction in line with gazette band)
//   25% ≤ s < 60%   → overpriced (market premium over circle rate)
//   s ≥ 60%         → bubble (verify model assumptions + comps before quoting)
// These bands are conservative defaults; tune via project context if/when
// deal teams ask for tighter cutoffs.
const SIGNAL_THRESHOLDS = [
  { max: -15, key: 'undervalued', label: 'Undervalued', tone: 'success' },
  { max: 25, key: 'fair', label: 'Fair', tone: 'neutral' },
  { max: 60, key: 'overpriced', label: 'Overpriced', tone: 'warn' },
  { max: Infinity, key: 'bubble', label: 'Bubble risk', tone: 'danger' },
];

const classifySignal = (spreadPct) => {
  if (spreadPct === null) return null;
  for (const band of SIGNAL_THRESHOLDS) {
    if (spreadPct < band.max) return { ...band, spread_pct: spreadPct };
  }
  // Theoretically unreachable (last band's max is Infinity) but kept for
  // defensive symmetry.
  return { ...SIGNAL_THRESHOLDS[SIGNAL_THRESHOLDS.length - 1], spread_pct: spreadPct };
};

// Risk-adjusted entry = guidance_mid × 1.10. This is the "stay close to
// the gazette" anchor a conservative IC would use as a not-to-exceed
// transaction price. Rounded to the nearest rupee for display.
const riskAdjustedEntry = (guidanceMid) => {
  if (guidanceMid === null) return null;
  return Math.round(guidanceMid * 1.10);
};

// Effective per-sqft transaction price for the deal. Caller passes either
// `transactionPriceCr` + `landAreaSqft` OR a pre-computed `pricePerSqft`.
// The kernel prefers `pricePerSqft` when supplied (e.g. when the deal
// already exposes a normalized rate), else derives from total + area.
const computePricePerSqft = ({ transactionPriceCr, landAreaSqft, pricePerSqft }) => {
  const explicit = toFiniteNumber(pricePerSqft);
  if (explicit !== null && explicit > 0) return explicit;

  const cr = toFiniteNumber(transactionPriceCr);
  const sqft = toFiniteNumber(landAreaSqft);
  if (cr === null || sqft === null || sqft <= 0) return null;
  // 1 crore = 10,000,000 rupees
  return (cr * 10_000_000) / sqft;
};

/**
 * Main entry: compare a deal's per-sqft price against a guidance bandwidth.
 *
 * @param {object} inputs
 * @param {number|string|null} inputs.transactionPriceCr - total deal price in INR crore
 * @param {number|string|null} inputs.landAreaSqft       - parcel area in sqft
 * @param {number|string|null} inputs.pricePerSqft       - optional pre-computed ₹/sqft
 * @param {number|string|null} inputs.guidanceMinInr     - guidance band min ₹/sqft
 * @param {number|string|null} inputs.guidanceMaxInr     - guidance band max ₹/sqft (may be null for "& Above")
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   price_per_sqft?: number|null,
 *   guidance_mid_inr?: number|null,
 *   guidance_band?: { min: number|null, max: number|null },
 *   spread_pct?: number,
 *   signal?: { key: string, label: string, tone: string, spread_pct: number },
 *   risk_adjusted_entry_inr?: number,
 *   disclaimer: string,
 * }}
 */
export function analyseGuidanceValueSpread(inputs = {}) {
  const pricePerSqft = computePricePerSqft(inputs);
  const guidanceMid = guidanceMidpoint(inputs.guidanceMinInr, inputs.guidanceMaxInr);
  const DISCLAIMER = 'Spread and signals are derived against the BBMP-published guidance bandwidth — verify the matched zone against the original gazette page before treating the signal as committed.';

  if (guidanceMid === null) {
    return {
      ok: false,
      reason: 'guidance_missing',
      price_per_sqft: pricePerSqft,
      guidance_mid_inr: null,
      guidance_band: { min: null, max: null },
      disclaimer: DISCLAIMER,
    };
  }
  if (pricePerSqft === null) {
    return {
      ok: false,
      reason: 'price_missing',
      price_per_sqft: null,
      guidance_mid_inr: guidanceMid,
      guidance_band: {
        min: toFiniteNumber(inputs.guidanceMinInr),
        max: toFiniteNumber(inputs.guidanceMaxInr),
      },
      risk_adjusted_entry_inr: riskAdjustedEntry(guidanceMid),
      disclaimer: DISCLAIMER,
    };
  }

  const spreadPct = ((pricePerSqft - guidanceMid) / guidanceMid) * 100;
  const signal = classifySignal(spreadPct);

  return {
    ok: true,
    price_per_sqft: pricePerSqft,
    guidance_mid_inr: guidanceMid,
    guidance_band: {
      min: toFiniteNumber(inputs.guidanceMinInr),
      max: toFiniteNumber(inputs.guidanceMaxInr),
    },
    spread_pct: spreadPct,
    signal,
    risk_adjusted_entry_inr: riskAdjustedEntry(guidanceMid),
    disclaimer: DISCLAIMER,
  };
}

// Re-exports so consumers can use the helpers directly when needed.
export const __testables = {
  computePricePerSqft,
  guidanceMidpoint,
  classifySignal,
  riskAdjustedEntry,
  SIGNAL_THRESHOLDS,
};
