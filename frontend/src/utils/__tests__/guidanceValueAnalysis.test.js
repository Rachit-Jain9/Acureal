import { describe, it, expect } from 'vitest';
import { analyseGuidanceValueSpread, __testables } from '../guidanceValueAnalysis';

const { computePricePerSqft, guidanceMidpoint, classifySignal, riskAdjustedEntry } = __testables;

describe('guidanceValueAnalysis — pure helpers', () => {
  describe('computePricePerSqft', () => {
    it('prefers the pre-computed pricePerSqft when supplied', () => {
      expect(computePricePerSqft({ pricePerSqft: 5500, transactionPriceCr: 10, landAreaSqft: 1000 })).toBe(5500);
    });

    it('derives from transactionPriceCr + landAreaSqft using ₹1 cr = ₹1e7', () => {
      // ₹10 cr / 2000 sqft → ₹50,000 per sqft
      expect(computePricePerSqft({ transactionPriceCr: 10, landAreaSqft: 2000 })).toBe(50000);
    });

    it('returns null when either ingredient is missing or non-positive', () => {
      expect(computePricePerSqft({})).toBeNull();
      expect(computePricePerSqft({ transactionPriceCr: 10 })).toBeNull();
      expect(computePricePerSqft({ landAreaSqft: 1000 })).toBeNull();
      expect(computePricePerSqft({ transactionPriceCr: 10, landAreaSqft: 0 })).toBeNull();
      expect(computePricePerSqft({ transactionPriceCr: 10, landAreaSqft: -1 })).toBeNull();
    });

    it('accepts string inputs (deal inputs are often strings)', () => {
      expect(computePricePerSqft({ transactionPriceCr: '10', landAreaSqft: '2000' })).toBe(50000);
      expect(computePricePerSqft({ pricePerSqft: '5500' })).toBe(5500);
    });
  });

  describe('guidanceMidpoint', () => {
    it('returns the midpoint when both bounds are present', () => {
      expect(guidanceMidpoint(2001, 3500)).toBe(2750.5);
    });

    it('returns the lower bound when only min is present (open-ended "& Above" zones)', () => {
      expect(guidanceMidpoint(7001, null)).toBe(7001);
    });

    it('returns the upper bound when only max is present', () => {
      expect(guidanceMidpoint(null, 1000)).toBe(1000);
    });

    it('returns null when both bounds are missing', () => {
      expect(guidanceMidpoint(null, null)).toBeNull();
      expect(guidanceMidpoint(undefined, undefined)).toBeNull();
    });
  });

  describe('classifySignal', () => {
    it.each([
      [-50, 'undervalued'],
      [-16, 'undervalued'],
      [-15.01, 'undervalued'],
      [-15, 'fair'],
      [0, 'fair'],
      [24.99, 'fair'],
      [25, 'overpriced'],
      [59.99, 'overpriced'],
      [60, 'bubble'],
      [200, 'bubble'],
    ])('spread %f%% → %s', (spread, expectedKey) => {
      const result = classifySignal(spread);
      expect(result.key).toBe(expectedKey);
      expect(result.spread_pct).toBe(spread);
    });

    it('returns null when spread is null', () => {
      expect(classifySignal(null)).toBeNull();
    });
  });

  describe('riskAdjustedEntry', () => {
    it('returns guidance_mid × 1.10 rounded to nearest rupee', () => {
      expect(riskAdjustedEntry(2750)).toBe(3025);
      expect(riskAdjustedEntry(5000)).toBe(5500);
      expect(riskAdjustedEntry(7001)).toBe(7701);
    });

    it('returns null when guidance is null', () => {
      expect(riskAdjustedEntry(null)).toBeNull();
    });
  });
});

describe('analyseGuidanceValueSpread — happy path', () => {
  it('computes spread + signal + risk-adjusted entry from price + bandwidth', () => {
    const result = analyseGuidanceValueSpread({
      transactionPriceCr: 11,
      landAreaSqft: 2000,
      guidanceMinInr: 5001,
      guidanceMaxInr: 7000,
    });
    expect(result.ok).toBe(true);
    expect(result.price_per_sqft).toBe(55000);
    expect(result.guidance_mid_inr).toBe(6000.5);
    expect(result.guidance_band).toEqual({ min: 5001, max: 7000 });
    // Spread is way over → bubble territory
    expect(result.signal.key).toBe('bubble');
    expect(result.risk_adjusted_entry_inr).toBe(6601);
    expect(result.disclaimer).toMatch(/Spread and signals/);
  });

  it('handles Zone A open-ended "₹7,001+ /sqft" bandwidth (max null)', () => {
    const result = analyseGuidanceValueSpread({
      transactionPriceCr: 1.5,
      landAreaSqft: 2000,
      guidanceMinInr: 7001,
      guidanceMaxInr: null,
    });
    expect(result.ok).toBe(true);
    // ₹1.5cr / 2000 sqft = ₹7,500 / sqft. Midpoint = lower bound = 7,001.
    expect(result.price_per_sqft).toBe(7500);
    expect(result.guidance_mid_inr).toBe(7001);
    // Spread ≈ 7.1% → fair
    expect(result.signal.key).toBe('fair');
    expect(result.signal.spread_pct).toBeCloseTo(7.13, 1);
  });

  it('flags an undervalued deal when price is well below the band midpoint', () => {
    const result = analyseGuidanceValueSpread({
      pricePerSqft: 1500,
      guidanceMinInr: 2001,
      guidanceMaxInr: 3500,
    });
    // Mid = 2750.5; spread = (1500 - 2750.5) / 2750.5 = -45.5% → undervalued
    expect(result.ok).toBe(true);
    expect(result.signal.key).toBe('undervalued');
    expect(result.signal.spread_pct).toBeLessThan(-15);
  });

  it('flags overpriced when spread is between 25% and 60%', () => {
    const result = analyseGuidanceValueSpread({
      pricePerSqft: 4000,
      guidanceMinInr: 2001,
      guidanceMaxInr: 3500,
    });
    // Mid = 2750.5; spread ≈ 45.4% → overpriced
    expect(result.signal.key).toBe('overpriced');
  });
});

describe('analyseGuidanceValueSpread — defensive paths', () => {
  it('returns ok:false reason:guidance_missing when no bandwidth is supplied', () => {
    const result = analyseGuidanceValueSpread({
      transactionPriceCr: 10,
      landAreaSqft: 2000,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('guidance_missing');
    expect(result.price_per_sqft).toBe(50000);
    expect(result.guidance_mid_inr).toBeNull();
  });

  it('returns ok:false reason:price_missing when no price-derivable inputs are supplied', () => {
    const result = analyseGuidanceValueSpread({
      guidanceMinInr: 2001,
      guidanceMaxInr: 3500,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('price_missing');
    expect(result.price_per_sqft).toBeNull();
    // Even without a price, we can still surface guidance + risk-adjusted entry
    expect(result.guidance_mid_inr).toBe(2750.5);
    expect(result.risk_adjusted_entry_inr).toBe(3026);
  });

  it('returns ok:false when both inputs are missing', () => {
    const result = analyseGuidanceValueSpread({});
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('guidance_missing');
  });

  it('ignores zero-area / negative-area gracefully', () => {
    const result = analyseGuidanceValueSpread({
      transactionPriceCr: 10,
      landAreaSqft: 0,
      guidanceMinInr: 5001,
      guidanceMaxInr: 7000,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('price_missing');
  });

  it('always returns the disclaimer regardless of ok / not-ok path', () => {
    const okResult = analyseGuidanceValueSpread({
      pricePerSqft: 6000,
      guidanceMinInr: 5001,
      guidanceMaxInr: 7000,
    });
    const notOk = analyseGuidanceValueSpread({});
    expect(okResult.disclaimer).toMatch(/verify the matched zone/i);
    expect(notOk.disclaimer).toMatch(/verify the matched zone/i);
  });
});
