'use strict';

const {
  runMarketBenchmarkValidators,
  __internal,
} = require('../src/services/exports/xlsx/v2/marketBenchmarkValidator');

const {
  percentileNearestRank,
  extractVerifiedRatesPerSqft,
  validateSellRateBands,
  validateCompCoverage,
  validateCompFreshness,
} = __internal;

// Helper: capture addIssue calls into an array so each test can inspect.
const makeIssueCollector = () => {
  const issues = [];
  const addIssue = (severity, check, field, message, action, scope) => {
    issues.push({ severity, check, field, message, action, scope });
  };
  return { issues, addIssue };
};

const verifiedComp = (rate, launchYear = 2026, overrides = {}) => ({
  is_verified: true,
  rate_per_sqft: rate,
  launch_year: launchYear,
  ...overrides,
});

const unverifiedComp = (rate, launchYear = 2026) => ({
  is_verified: false,
  rate_per_sqft: rate,
  launch_year: launchYear,
});

describe('marketBenchmarkValidator', () => {
  describe('__internal.percentileNearestRank', () => {
    test('p50 of [10, 20, 30, 40, 50] is 30', () => {
      expect(percentileNearestRank([10, 20, 30, 40, 50], 0.50)).toBe(30);
    });

    test('p95 of [10..100] is 100 (top of sample)', () => {
      const sample = Array.from({ length: 10 }, (_, i) => (i + 1) * 10);
      expect(percentileNearestRank(sample, 0.95)).toBe(100);
    });

    test('p25 of [10, 20, 30, 40, 50] is 20', () => {
      expect(percentileNearestRank([10, 20, 30, 40, 50], 0.25)).toBe(20);
    });

    test('empty array returns null', () => {
      expect(percentileNearestRank([], 0.5)).toBeNull();
    });

    test('fraction clamped to [0,1]', () => {
      // fraction > 1 should clamp to top
      expect(percentileNearestRank([1, 2, 3], 99)).toBe(3);
      // fraction < 0 should clamp to bottom
      expect(percentileNearestRank([1, 2, 3], -5)).toBe(1);
    });
  });

  describe('__internal.extractVerifiedRatesPerSqft', () => {
    test('filters unverified, returns sorted ascending', () => {
      const comps = [
        verifiedComp(15000),
        unverifiedComp(99999), // dropped
        verifiedComp(10000),
        verifiedComp(20000),
      ];
      expect(extractVerifiedRatesPerSqft(comps)).toEqual([10000, 15000, 20000]);
    });

    test('filters null / zero / non-numeric rates', () => {
      const comps = [
        verifiedComp(10000),
        verifiedComp(null),
        verifiedComp(0),
        verifiedComp('not a number'),
        verifiedComp(15000),
      ];
      expect(extractVerifiedRatesPerSqft(comps)).toEqual([10000, 15000]);
    });

    test('non-array returns empty', () => {
      expect(extractVerifiedRatesPerSqft(null)).toEqual([]);
      expect(extractVerifiedRatesPerSqft(undefined)).toEqual([]);
      expect(extractVerifiedRatesPerSqft('not an array')).toEqual([]);
    });

    test('accepts is_verified="true" string variant (CSV-imported comps)', () => {
      const comps = [{ is_verified: 'true', rate_per_sqft: 12345 }];
      expect(extractVerifiedRatesPerSqft(comps)).toEqual([12345]);
    });
  });

  describe('validateSellRateBands — development family only', () => {
    const buildCtx = (comps, sellRatePerSqft, dealFamily = 'development') => ({
      dealFamily,
      exportContext: { market: { exportComps: comps } },
    });

    test('income-family deal skipped (no SellRatePerSqft to compare)', () => {
      const { issues, addIssue } = makeIssueCollector();
      validateSellRateBands(buildCtx([verifiedComp(15000)], 99999, 'income'), { sellRatePerSqft: 99999 }, addIssue);
      expect(issues).toHaveLength(0);
    });

    test('missing sellRatePerSqft → no comparison fired', () => {
      const { issues, addIssue } = makeIssueCollector();
      validateSellRateBands(buildCtx([verifiedComp(15000), verifiedComp(20000), verifiedComp(25000)]), { sellRatePerSqft: null }, addIssue);
      expect(issues).toHaveLength(0);
    });

    test('fewer than 3 verified comps → silent (insufficient sample)', () => {
      const { issues, addIssue } = makeIssueCollector();
      validateSellRateBands(buildCtx([verifiedComp(15000), verifiedComp(20000)]), { sellRatePerSqft: 100000 }, addIssue);
      expect(issues).toHaveLength(0);
    });

    test('proposed rate above p95 → WARN with citation', () => {
      const { issues, addIssue } = makeIssueCollector();
      const comps = [
        verifiedComp(10000), verifiedComp(12000), verifiedComp(14000),
        verifiedComp(16000), verifiedComp(18000), verifiedComp(20000),
      ];
      // p95 of this set lands at 20000; propose 25000 (way above)
      validateSellRateBands(buildCtx(comps), { sellRatePerSqft: 25000 }, addIssue);
      expect(issues).toHaveLength(1);
      const issue = issues[0];
      expect(issue.severity).toBe('warn');
      expect(issue.field).toBe('SellRatePerSqft');
      expect(issue.message).toMatch(/ABOVE the 95th percentile/);
      expect(issue.message).toMatch(/6 verified nearby comps/);
      // Citation must include actual percentile values
      expect(issue.message).toContain('20,000');
    });

    test('proposed rate below p25 → WARN with citation', () => {
      const { issues, addIssue } = makeIssueCollector();
      const comps = [
        verifiedComp(10000), verifiedComp(12000), verifiedComp(14000),
        verifiedComp(16000), verifiedComp(18000), verifiedComp(20000),
      ];
      // p25 = 12000 (idx 1 of 6); propose 8000 (well below)
      validateSellRateBands(buildCtx(comps), { sellRatePerSqft: 8000 }, addIssue);
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toMatch(/BELOW the 25th percentile/);
    });

    test('proposed rate inside p25-p95 band → silent (no warning)', () => {
      const { issues, addIssue } = makeIssueCollector();
      const comps = [
        verifiedComp(10000), verifiedComp(12000), verifiedComp(14000),
        verifiedComp(16000), verifiedComp(18000), verifiedComp(20000),
      ];
      validateSellRateBands(buildCtx(comps), { sellRatePerSqft: 15000 }, addIssue);
      expect(issues).toHaveLength(0);
    });
  });

  describe('validateCompCoverage', () => {
    const buildCtx = (comps) => ({
      exportContext: { market: { exportComps: comps } },
    });

    test('no comps → silent (covered by buildExportQa core warn)', () => {
      const { issues, addIssue } = makeIssueCollector();
      validateCompCoverage(buildCtx([]), {}, addIssue);
      expect(issues).toHaveLength(0);
    });

    test('all unverified comps → WARN about zero verified', () => {
      const { issues, addIssue } = makeIssueCollector();
      validateCompCoverage(buildCtx([unverifiedComp(15000), unverifiedComp(20000)]), {}, addIssue);
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toMatch(/NONE are marked as verified/);
    });

    test('fewer than 5 verified comps → WARN about thin sample', () => {
      const { issues, addIssue } = makeIssueCollector();
      const comps = [
        verifiedComp(10000),
        verifiedComp(12000),
        verifiedComp(14000),
        unverifiedComp(99999),
      ];
      validateCompCoverage(buildCtx(comps), {}, addIssue);
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toMatch(/Only 3 verified comps/);
      expect(issues[0].message).toMatch(/4 total/);
    });

    test('5 or more verified comps → silent (sample is adequate)', () => {
      const { issues, addIssue } = makeIssueCollector();
      const comps = [
        verifiedComp(10000), verifiedComp(12000), verifiedComp(14000),
        verifiedComp(16000), verifiedComp(18000),
      ];
      validateCompCoverage(buildCtx(comps), {}, addIssue);
      expect(issues).toHaveLength(0);
    });
  });

  describe('validateCompFreshness', () => {
    const buildCtx = (comps, generatedAt) => ({
      exportContext: { market: { exportComps: comps } },
      generatedAt: generatedAt || '2026-05-17T00:00:00.000Z',
    });

    test('latest comp launched in current year → silent', () => {
      const { issues, addIssue } = makeIssueCollector();
      validateCompFreshness(buildCtx([verifiedComp(15000, 2026)]), {}, addIssue);
      expect(issues).toHaveLength(0);
    });

    test('latest comp launched 2 years ago → silent (still within window)', () => {
      const { issues, addIssue } = makeIssueCollector();
      validateCompFreshness(buildCtx([verifiedComp(15000, 2024)]), {}, addIssue);
      expect(issues).toHaveLength(0);
    });

    test('latest comp launched 3+ years ago → WARN about staleness', () => {
      const { issues, addIssue } = makeIssueCollector();
      validateCompFreshness(buildCtx([verifiedComp(15000, 2023)]), {}, addIssue);
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toMatch(/launched in 2023/);
      expect(issues[0].message).toMatch(/3 years old/);
    });

    test('latest comp launched 5 years ago → WARN with 5-year age', () => {
      const { issues, addIssue } = makeIssueCollector();
      validateCompFreshness(buildCtx([verifiedComp(15000, 2021)]), {}, addIssue);
      expect(issues[0].message).toMatch(/5 years old/);
    });

    test('mixed comps — most recent counts (others ignored)', () => {
      const { issues, addIssue } = makeIssueCollector();
      // Latest is 2025 (within window) so silent
      const comps = [
        verifiedComp(10000, 2018),
        verifiedComp(15000, 2025),
        verifiedComp(20000, 2010),
      ];
      validateCompFreshness(buildCtx(comps), {}, addIssue);
      expect(issues).toHaveLength(0);
    });

    test('comps with no launch_year → silent (cannot assess)', () => {
      const { issues, addIssue } = makeIssueCollector();
      validateCompFreshness(buildCtx([{ rate_per_sqft: 15000 }]), {}, addIssue);
      expect(issues).toHaveLength(0);
    });
  });

  describe('runMarketBenchmarkValidators — orchestrator', () => {
    test('runs all 3 validators in order', () => {
      const { issues, addIssue } = makeIssueCollector();
      const ctx = {
        dealFamily: 'development',
        generatedAt: '2026-05-17T00:00:00.000Z',
        exportContext: {
          market: {
            exportComps: [
              verifiedComp(10000, 2018),
              verifiedComp(12000, 2018),
              verifiedComp(14000, 2018),
              verifiedComp(16000, 2018),
              verifiedComp(18000, 2018),
              verifiedComp(20000, 2018),
            ],
          },
        },
      };
      const core = { sellRatePerSqft: 35000 }; // above p95
      runMarketBenchmarkValidators(ctx, core, addIssue);
      // Expect 2 WARNs: sell-rate above p95 + comp set stale (2018 launches)
      const fields = issues.map((i) => i.field).sort();
      expect(fields).toContain('SellRatePerSqft');
      expect(fields).toContain('MarketComps'); // freshness
      expect(issues.every((i) => i.severity === 'warn')).toBe(true);
    });

    test('a failing validator does not abort the others (fail-open)', () => {
      const { issues, addIssue } = makeIssueCollector();
      // Craft a ctx that makes ONE validator throw (e.g., a non-array
      // exportComps that some validators still tolerate). The other
      // validators must still run and complete.
      const ctx = {
        dealFamily: 'development',
        generatedAt: '2026-05-17T00:00:00.000Z',
        exportContext: { market: { exportComps: 'not an array' } },
      };
      const core = { sellRatePerSqft: 99999 };
      // Should NOT throw
      expect(() => runMarketBenchmarkValidators(ctx, core, addIssue)).not.toThrow();
    });

    test('silent when no comps at all (defers to buildExportQa core warn)', () => {
      const { issues, addIssue } = makeIssueCollector();
      const ctx = {
        dealFamily: 'development',
        exportContext: { market: { exportComps: [] } },
      };
      runMarketBenchmarkValidators(ctx, { sellRatePerSqft: 50000 }, addIssue);
      expect(issues).toHaveLength(0);
    });
  });
});
