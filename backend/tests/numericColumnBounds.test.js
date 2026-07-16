'use strict';

// Fit-or-NULL persistence guard for kernel KPIs (numeric field overflow fix).
// The kernel emits raw values; anything a NUMERIC(p,s) column cannot hold
// must persist as NULL — never clamped (CLAUDE.md: no fabricated financials),
// never a Postgres 22003 that 500s the Calculate.

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../src/config/database');
const {
  fitNumeric,
  fitToColumn,
  getNumericColumnBounds,
  FALLBACK_BOUNDS,
  __resetBoundsCache,
} = require('../src/utils/numericColumnBounds');

beforeEach(() => {
  jest.clearAllMocks();
  __resetBoundsCache();
});

describe('fitNumeric', () => {
  test('passes representable values through unrounded, coercing numeric strings', () => {
    expect(fitNumeric(23.4567, 8, 4)).toBe(23.4567);
    expect(fitNumeric(-4.25, 8, 4)).toBe(-4.25);
    expect(fitNumeric(0, 8, 4)).toBe(0);
    // Postgres rounds to scale on write; the guard must not pre-round the
    // value (that would silently alter a persisted financial fact).
    expect(fitNumeric(23.456789, 8, 4)).toBe(23.456789);
    expect(fitNumeric('123.45', 8, 4)).toBe(123.45); // numeric strings coerced
  });

  test('NULLs values beyond the column range instead of clamping', () => {
    expect(fitNumeric(10000, 8, 4)).toBeNull();       // NUMERIC(8,4) max is 9999.9999
    expect(fitNumeric(-10000, 8, 4)).toBeNull();
    expect(fitNumeric(1.23e9, 12, 4)).toBeNull();     // NUMERIC(12,4) max is 99,999,999.9999
    expect(fitNumeric(9999.9999, 8, 4)).toBe(9999.9999);
  });

  test('accounts for Postgres rounding to scale at the boundary', () => {
    // 9999.99995 would be rounded UP to 10000.0000 by Postgres → overflow.
    expect(fitNumeric(9999.99995, 8, 4)).toBeNull();
    expect(fitNumeric(9999.99994, 8, 4)).toBe(9999.99994);
  });

  test('NULLs non-finite and empty inputs', () => {
    expect(fitNumeric(Infinity, 8, 4)).toBeNull();
    expect(fitNumeric(-Infinity, 8, 4)).toBeNull();
    expect(fitNumeric(NaN, 8, 4)).toBeNull();
    expect(fitNumeric('not-a-number', 8, 4)).toBeNull();
    expect(fitNumeric(null, 8, 4)).toBeNull();
    expect(fitNumeric(undefined, 8, 4)).toBeNull();
    expect(fitNumeric('', 8, 4)).toBeNull();
  });
});

describe('fitToColumn', () => {
  test('uses live introspected bounds when provided', () => {
    const widened = { financials: { irr_pct: [12, 4] } };
    expect(fitToColumn(widened, 'financials', 'irr_pct', 123456.7)).toBe(123456.7);
    expect(fitToColumn(widened, 'financials', 'irr_pct', 1e9)).toBeNull();
  });

  test('falls back to the narrowest shipped width when bounds are absent', () => {
    // Pre-migration financials.irr_pct is NUMERIC(8,4).
    expect(fitToColumn(null, 'financials', 'irr_pct', 123456.7)).toBeNull();
    expect(fitToColumn(null, 'financials', 'irr_pct', 42.5)).toBe(42.5);
    expect(fitToColumn(null, 'financial_scenarios', 'irr_pct', 123456.7)).toBe(123456.7); // (10,4)
  });

  test('unknown columns get only the finiteness guard', () => {
    expect(fitToColumn(null, 'financials', 'not_a_column', 1e300)).toBe(1e300);
    expect(fitToColumn(null, 'financials', 'not_a_column', Infinity)).toBeNull();
  });
});

describe('getNumericColumnBounds', () => {
  test('merges live widths over the fallback and caches on success', async () => {
    query.mockResolvedValue({
      rows: [
        { table_name: 'financials', column_name: 'irr_pct', numeric_precision: 12, numeric_scale: 4 },
      ],
    });
    const bounds = await getNumericColumnBounds();
    expect(bounds.financials.irr_pct).toEqual([12, 4]);
    // untouched columns keep the fallback width
    expect(bounds.financials.gross_margin_pct).toEqual(FALLBACK_BOUNDS.financials.gross_margin_pct);

    await getNumericColumnBounds();
    expect(query).toHaveBeenCalledTimes(1); // second call served from cache
  });

  test('fails open to fallback bounds on introspection error, without caching the failure', async () => {
    query.mockRejectedValueOnce(new Error('connection refused'));
    const bounds = await getNumericColumnBounds();
    expect(bounds.financials.irr_pct).toEqual(FALLBACK_BOUNDS.financials.irr_pct);

    // Next call retries the introspection (failure was not cached).
    query.mockResolvedValueOnce({
      rows: [
        { table_name: 'financials', column_name: 'irr_pct', numeric_precision: 12, numeric_scale: 4 },
      ],
    });
    const next = await getNumericColumnBounds();
    expect(next.financials.irr_pct).toEqual([12, 4]);
  });

  test('fails open when introspection returns no rows or undefined', async () => {
    query.mockResolvedValueOnce(undefined);
    const bounds = await getNumericColumnBounds();
    expect(bounds.financials.irr_pct).toEqual(FALLBACK_BOUNDS.financials.irr_pct);
  });
});
