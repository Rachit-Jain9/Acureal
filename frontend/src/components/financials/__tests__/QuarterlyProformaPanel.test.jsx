import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import QuarterlyProformaPanel from '../QuarterlyProformaPanel';

// Minimal-but-complete proforma: 1 quarter, one outflow + one inflow row.
const PROFORMA = {
  quarters: [{ quarter: 1, label: 'Q1', startDate: '2026-01-01' }],
  net: [10],
  cumulative: [-90],
  outflows: {
    rows: [{ category: 'land', subcategory: null, label: 'Land', cells: [-100] }],
    subtotals: [-100],
    total: -100,
  },
  inflows: {
    rows: [{ category: 'sales', subcategory: null, label: 'Sales', cells: [110] }],
    subtotals: [110],
    total: 110,
  },
  peakDeploymentQuarter: 1,
  peakDeployment: -100,
};

describe('QuarterlyProformaPanel', () => {
  it('renders nothing when the proforma is absent or has no quarters', () => {
    const { container } = render(<QuarterlyProformaPanel proforma={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the proforma table once quarters are present', () => {
    render(<QuarterlyProformaPanel proforma={PROFORMA} />);
    expect(screen.getByText(/Quarterly proforma/i)).toBeInTheDocument();
  });

  it('does NOT crash transitioning empty -> populated (React #310 hooks regression)', () => {
    // The bug: useMemo sat AFTER `if (!proforma...) return null`, so the
    // empty render ran one fewer hook than the populated render. A recalc
    // that populates the proforma on a still-mounted instance then grew the
    // hook count 1->2 -> React #310. This exercises that exact lifecycle.
    const { rerender, container } = render(<QuarterlyProformaPanel proforma={null} />);
    expect(container.firstChild).toBeNull();
    expect(() => rerender(<QuarterlyProformaPanel proforma={PROFORMA} />)).not.toThrow();
    expect(screen.getByText(/Quarterly proforma/i)).toBeInTheDocument();
  });
});
