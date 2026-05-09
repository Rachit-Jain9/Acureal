'use strict';

// Lightweight unit test for the audit-trail outputs summarizer that
// powers the deal-page Audit tab. Pure function — no DB.

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const audit = require('../src/services/audit.service');

describe('summarizeEventOutputs', () => {
  test('null / non-object returns null', () => {
    expect(audit.summarizeEventOutputs(null)).toBeNull();
    expect(audit.summarizeEventOutputs(undefined)).toBeNull();
    expect(audit.summarizeEventOutputs('string')).toBeNull();
    expect(audit.summarizeEventOutputs(42)).toBeNull();
  });

  test('returns null when no recognized fields are present', () => {
    expect(audit.summarizeEventOutputs({ unrelated: 'value' })).toBeNull();
  });

  test('extracts canonical KPI fields', () => {
    const out = audit.summarizeEventOutputs({
      irr_pct: 22.4,
      npv_cr: 14.5,
      total_revenue_cr: 75.0,
      total_cost_cr: 42.5,
      gross_profit_cr: 32.5,
      gross_margin_pct: 43.3,
      equity_multiple: 1.85,
      residual_land_value_cr: 13.2,
    });
    expect(out).toMatchObject({
      irr_pct: 22.4,
      npv_cr: 14.5,
      total_revenue_cr: 75,
      total_cost_cr: 42.5,
    });
  });

  test('falls back to camelCase aliases when snake_case is absent', () => {
    const out = audit.summarizeEventOutputs({
      totalRevenueCr: 100,
      totalCostCr: 60,
      grossMarginPct: 40,
      equityMultiple: 2,
    });
    expect(out.total_revenue_cr).toBe(100);
    expect(out.total_cost_cr).toBe(60);
    expect(out.gross_margin_pct).toBe(40);
    expect(out.equity_multiple).toBe(2);
  });

  test('coerces numeric strings, drops non-finite', () => {
    const out = audit.summarizeEventOutputs({
      irr_pct: '15.5',
      npv_cr: 'NaN',
      total_revenue_cr: Infinity,
      total_cost_cr: 50,
    });
    expect(out.irr_pct).toBe(15.5);
    expect(out.npv_cr).toBeNull();
    expect(out.total_revenue_cr).toBeNull();
    expect(out.total_cost_cr).toBe(50);
  });
});
