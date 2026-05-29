import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TerminalValuePanel } from '../FinancialVisualizationLayer';

// Single-method fixture: only exit_cap_rate qualifies (capPct>0 && noiExit>0;
// discountPct==gPct so perpetuity_growth does NOT push, exitMultiple/fwd are 0)
// → comparison.length === 1 → the Recharts comparison chart does NOT render,
// keeping this test free of jsdom/ResponsiveContainer flakiness.
const KPIS = {
  terminalValueMethod: 'exit_cap_rate',
  terminalValue: 100,
  terminalValuePV: 60,
  noi: 8,
  noiAtExit: 10,
  exitCapRate: 8,
  npv: 50,
};
const INPUTS = {
  discountRatePct: 0,
  holdPeriodYears: 5,
  exitMultiple: 0,
  perpetuityGrowthPct: 0,
  forwardPurchasePriceCr: 0,
};

describe('TerminalValuePanel', () => {
  it('renders nothing when no terminal-value method is set', () => {
    const { container } = render(<TerminalValuePanel kpis={{}} revenue={{}} inputs={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the panel once a terminal-value method is present', () => {
    render(<TerminalValuePanel kpis={KPIS} revenue={{}} inputs={INPUTS} />);
    expect(screen.getByText('Terminal Value', { selector: 'h3' })).toBeInTheDocument();
  });

  it('does NOT crash transitioning method absent -> present (React #310 hooks regression)', () => {
    // The bug: the comparison useMemo sat AFTER `if (!method) return null`.
    // method loads async for income-like deals (null until the kernel computes
    // a terminal value), so the same mounted instance re-rendered absent->present
    // and grew the hook count 0->1 -> React #310. This exercises that lifecycle.
    const { rerender, container } = render(<TerminalValuePanel kpis={{}} revenue={{}} inputs={{}} />);
    expect(container.firstChild).toBeNull();
    expect(() =>
      rerender(<TerminalValuePanel kpis={KPIS} revenue={{}} inputs={INPUTS} />),
    ).not.toThrow();
    expect(screen.getByText('Terminal Value', { selector: 'h3' })).toBeInTheDocument();
  });
});
