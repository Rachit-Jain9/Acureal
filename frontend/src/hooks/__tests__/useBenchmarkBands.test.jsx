import { describe, expect, it } from 'vitest';
import {
  computeSellRateWarning,
  computeDscrWarning,
  computeYocSpreadWarning,
} from '../useBenchmarkBands';

describe('PR-NX52 — computeSellRateWarning', () => {
  const bands = { p25: 7000, p50: 8500, p75: 10000, p95: 12000 };

  it('returns null when sellRate is null/zero/negative', () => {
    expect(computeSellRateWarning(null, bands)).toBeNull();
    expect(computeSellRateWarning(0, bands)).toBeNull();
    expect(computeSellRateWarning(-100, bands)).toBeNull();
  });

  it('returns null when bands missing or incomplete', () => {
    expect(computeSellRateWarning(8000, null)).toBeNull();
    expect(computeSellRateWarning(8000, {})).toBeNull();
    expect(computeSellRateWarning(8000, { p25: 7000 })).toBeNull(); // missing p95
  });

  it('returns null when sellRate is within band [p25, p95]', () => {
    expect(computeSellRateWarning(7000, bands)).toBeNull();
    expect(computeSellRateWarning(8500, bands)).toBeNull();
    expect(computeSellRateWarning(12000, bands)).toBeNull();
  });

  it('returns warn when sellRate > p95', () => {
    const w = computeSellRateWarning(13000, bands);
    expect(w).toBeTruthy();
    expect(w.severity).toBe('warn');
    expect(w.label).toMatch(/Above 95th percentile/);
    expect(w.detail).toMatch(/13,000/);
    expect(w.detail).toMatch(/12,000/);
  });

  it('returns warn when sellRate < p25', () => {
    const w = computeSellRateWarning(6000, bands);
    expect(w).toBeTruthy();
    expect(w.severity).toBe('warn');
    expect(w.label).toMatch(/Below 25th percentile/);
    expect(w.detail).toMatch(/6,000/);
    expect(w.detail).toMatch(/7,000/);
  });
});

describe('PR-NX52 — computeDscrWarning', () => {
  const thresholds = { rbiDscrFloor: 1.20 };

  it('returns null when any required input missing/invalid', () => {
    expect(computeDscrWarning({}, thresholds)).toBeNull();
    expect(computeDscrWarning({ noiCr: 5 }, thresholds)).toBeNull();
    expect(computeDscrWarning({ noiCr: 5, totalCostCr: 0, debtLTV: 0.5, debtRatePct: 0.10 }, thresholds)).toBeNull();
    expect(computeDscrWarning({ noiCr: 5, totalCostCr: 100, debtLTV: 1.5, debtRatePct: 0.10 }, thresholds)).toBeNull(); // LTV > 1 invalid
  });

  it('returns null when DSCR ≥ floor (1.20×)', () => {
    // NOI 12, cost 100, LTV 50%, rate 9%, term 15yr → loan 50, service ~6.2 → DSCR ~1.93
    const w = computeDscrWarning(
      { noiCr: 12, totalCostCr: 100, debtLTV: 0.5, debtRatePct: 0.09, loanTermYears: 15 },
      thresholds,
    );
    expect(w).toBeNull();
  });

  it('returns warn when DSCR in [1.00, 1.20)', () => {
    // NOI 10, cost 100, LTV 60%, rate 10%, term 10yr → loan 60, service ~9.76 → DSCR ~1.02
    const w = computeDscrWarning(
      { noiCr: 10, totalCostCr: 100, debtLTV: 0.6, debtRatePct: 0.10, loanTermYears: 10 },
      thresholds,
    );
    expect(w).toBeTruthy();
    expect(w.severity).toBe('warn');
    expect(w.label).toMatch(/below RBI Master Direction floor/);
  });

  it('returns critical when DSCR < 1.00', () => {
    // NOI 5, cost 100, LTV 80%, rate 11%, term 10yr → loan 80, service ~13.6 → DSCR ~0.37
    const w = computeDscrWarning(
      { noiCr: 5, totalCostCr: 100, debtLTV: 0.8, debtRatePct: 0.11, loanTermYears: 10 },
      thresholds,
    );
    expect(w).toBeTruthy();
    expect(w.severity).toBe('critical');
    expect(w.label).toMatch(/does NOT cover annual debt service/);
  });
});

describe('PR-NX52 — computeYocSpreadWarning', () => {
  const thresholds = { yocVsExitCapMinSpreadBps: 50 };

  it('returns null when missing inputs', () => {
    expect(computeYocSpreadWarning({}, thresholds)).toBeNull();
    expect(computeYocSpreadWarning({ yieldOnCost: 0.08 }, thresholds)).toBeNull();
  });

  it('returns null when spread >= 50 bps', () => {
    // YoC 8.5%, ExitCap 7.5% → 100 bps spread → silent
    expect(computeYocSpreadWarning({ yieldOnCost: 0.085, exitCapRate: 0.075 }, thresholds)).toBeNull();
  });

  it('returns warn when 0 ≤ spread < 50 bps', () => {
    // YoC 7.75%, ExitCap 7.5% → 25 bps → thin
    const w = computeYocSpreadWarning({ yieldOnCost: 0.0775, exitCapRate: 0.075 }, thresholds);
    expect(w).toBeTruthy();
    expect(w.severity).toBe('warn');
    expect(w.label).toMatch(/Thin YoC vs Exit Cap spread/);
    expect(w.label).toMatch(/25 bps/);
  });

  it('returns critical when spread < 0', () => {
    // YoC 6.5%, ExitCap 7.5% → -100 bps
    const w = computeYocSpreadWarning({ yieldOnCost: 0.065, exitCapRate: 0.075 }, thresholds);
    expect(w).toBeTruthy();
    expect(w.severity).toBe('critical');
    expect(w.label).toMatch(/Negative YoC vs Exit Cap spread/);
    expect(w.label).toMatch(/100 bps deficit/);
  });
});
