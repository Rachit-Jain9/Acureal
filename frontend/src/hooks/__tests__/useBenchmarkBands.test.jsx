import { describe, expect, it } from 'vitest';
import {
  computeSellRateWarning,
  computeDscrWarning,
  computeYocSpreadWarning,
  computeKernelWarnings,
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

describe('PR-NX56 — computeKernelWarnings (post-Calculate)', () => {
  const thresholds = {
    rbiDscrFloor: 1.20,
    yocVsExitCapMinSpreadBps: 50,
  };

  it('returns empty array when kpis is null', () => {
    expect(computeKernelWarnings(null, {}, thresholds)).toEqual([]);
  });

  it('returns empty array when thresholds is null', () => {
    expect(computeKernelWarnings({ dscr: 0.5 }, {}, null)).toEqual([]);
  });

  it('returns empty array when all KPIs are within band', () => {
    const kpis = { dscr: 1.65, yieldOnCost: 9.5, exitCapRate: 7.5 }; // DSCR ok, spread 200bps
    expect(computeKernelWarnings(kpis, {}, thresholds)).toEqual([]);
  });

  it('flags DSCR below 1.20 as warn (not critical when >= 1.00)', () => {
    const kpis = { dscr: 1.05 };
    const w = computeKernelWarnings(kpis, {}, thresholds);
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe('dscr');
    expect(w[0].severity).toBe('warn');
    expect(w[0].label).toMatch(/DSCR 1\.05×/);
    expect(w[0].label).toMatch(/below RBI Master Direction floor/);
  });

  it('flags DSCR below 1.00 as critical', () => {
    const kpis = { dscr: 0.85 };
    const w = computeKernelWarnings(kpis, {}, thresholds);
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe('dscr');
    expect(w[0].severity).toBe('critical');
    expect(w[0].label).toMatch(/does NOT cover annual debt service/);
  });

  it('flags thin YoC vs Exit Cap spread as warn', () => {
    const kpis = { yieldOnCost: 7.75, exitCapRate: 7.50 }; // 25 bps
    const w = computeKernelWarnings(kpis, {}, thresholds);
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe('yoc');
    expect(w[0].severity).toBe('warn');
    expect(w[0].label).toMatch(/Thin YoC vs Exit Cap spread/);
    expect(w[0].label).toMatch(/25 bps/);
  });

  it('flags negative YoC vs Exit Cap spread as critical', () => {
    const kpis = { yieldOnCost: 6.50, exitCapRate: 7.50 }; // -100 bps
    const w = computeKernelWarnings(kpis, {}, thresholds);
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe('yoc');
    expect(w[0].severity).toBe('critical');
    expect(w[0].label).toMatch(/Negative YoC vs Exit Cap spread/);
    expect(w[0].label).toMatch(/100 bps deficit/);
  });

  it('falls back to inputs.exitCapRate when kpis.exitCapRate is missing', () => {
    const kpis = { yieldOnCost: 7.50 };
    const inputs = { exitCapRate: 8.00 }; // -50 bps
    const w = computeKernelWarnings(kpis, inputs, thresholds);
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe('yoc');
    expect(w[0].severity).toBe('critical');
  });

  it('returns BOTH warnings when DSCR + YoC both trip', () => {
    const kpis = { dscr: 0.95, yieldOnCost: 7.00, exitCapRate: 7.50 }; // both trip
    const w = computeKernelWarnings(kpis, {}, thresholds);
    expect(w).toHaveLength(2);
    expect(w.find((x) => x.kind === 'dscr')).toBeTruthy();
    expect(w.find((x) => x.kind === 'yoc')).toBeTruthy();
  });

  it('skips YoC check when only yieldOnCost is present (no exit cap)', () => {
    const kpis = { yieldOnCost: 7.50 };
    expect(computeKernelWarnings(kpis, {}, thresholds)).toEqual([]);
  });

  it('skips DSCR check when DSCR is null or 0 (asset class without debt)', () => {
    expect(computeKernelWarnings({ dscr: null }, {}, thresholds)).toEqual([]);
    expect(computeKernelWarnings({ dscr: 0 }, {}, thresholds)).toEqual([]);
  });

  // ── Fundamental-economics floor (2026-06-11): IRR<0 + equity multiple<1.0× ──
  // Applies to EVERY asset class — incl. residential/plotted deals with no DSCR/YoC.
  it('flags negative IRR as critical for a deal with NO DSCR/YoC (residential)', () => {
    const kpis = { irr: -4.2, equityMultiple: 1.4 }; // residential: no dscr, no yoc
    const w = computeKernelWarnings(kpis, {}, thresholds);
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe('irr');
    expect(w[0].severity).toBe('critical');
    expect(w[0].label).toMatch(/Negative IRR/);
    expect(w[0].label).toMatch(/-4\.2%/);
  });

  it('flags a sub-1.0× equity multiple as critical (capital not returned in full)', () => {
    const kpis = { irr: 3.1, equityMultiple: 0.85 };
    const w = computeKernelWarnings(kpis, {}, thresholds);
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe('equity_multiple');
    expect(w[0].severity).toBe('critical');
    expect(w[0].label).toMatch(/0\.85× — below 1\.0×/);
  });

  it('returns BOTH fundamental flags when IRR<0 AND equity multiple<1.0×', () => {
    const w = computeKernelWarnings({ irr: -8, equityMultiple: 0.6 }, {}, thresholds);
    expect(w).toHaveLength(2);
    expect(w.find((x) => x.kind === 'irr')).toBeTruthy();
    expect(w.find((x) => x.kind === 'equity_multiple')).toBeTruthy();
  });

  it('does NOT flag a healthy residential deal (positive IRR, EM ≥ 1.0×)', () => {
    expect(computeKernelWarnings({ irr: 18, equityMultiple: 2.1 }, {}, thresholds)).toEqual([]);
  });

  it('does NOT flag IRR = 0 or equity multiple = 1.0 exactly (boundary)', () => {
    expect(computeKernelWarnings({ irr: 0, equityMultiple: 1.0 }, {}, thresholds)).toEqual([]);
  });

  it('is fail-open: silent when IRR / equity multiple are null / NaN / undefined', () => {
    expect(computeKernelWarnings({ irr: null, equityMultiple: null }, {}, thresholds)).toEqual([]);
    expect(computeKernelWarnings({ irr: NaN, equityMultiple: undefined }, {}, thresholds)).toEqual([]);
    expect(computeKernelWarnings({}, {}, thresholds)).toEqual([]);
  });
});
