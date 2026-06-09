import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AmountReadout from '../AmountReadout';

const text = () => screen.getByTestId('amount-readout').textContent;

describe('AmountReadout', () => {
  it('rupeeCrore: shows just the ₹ Cr figure', () => {
    render(<AmountReadout value="25.5" kind="rupeeCrore" />);
    expect(text()).toContain('₹25.50 Cr');
    expect(text()).not.toContain('·'); // no grouped echo for crore fields
  });

  it('rupeePlain ≥ ₹1 Cr: grouped digits · ₹ Cr', () => {
    render(<AmountReadout value="53567890" kind="rupeePlain" />);
    expect(text()).toContain('5,35,67,890');
    expect(text()).toContain('₹5.36 Cr');
  });

  it('rupeePlain < ₹1 L: single ₹ figure, no redundant grouped echo', () => {
    render(<AmountReadout value="8000" kind="rupeePlain" />);
    expect(text().trim()).toBe('₹8,000');
  });

  it('count with a unit suffix: grouped digits · lakh gloss + unit', () => {
    render(<AmountReadout value="200000" kind="count" unitSuffix="sqft" />);
    expect(text()).toContain('2,00,000');
    expect(text()).toContain('2 Lakh');
    expect(text()).toContain('sqft');
  });

  it('appends a per-unit suffix for rate fields (per acre)', () => {
    render(<AmountReadout value="250000000" kind="rupeePlain" unitSuffix="/acre" />);
    expect(text()).toContain('₹25.00 Cr');
    expect(text()).toContain('/acre');
  });

  it('renders an empty (CLS-safe) line for kind none, empty, or zero', () => {
    const { rerender } = render(<AmountReadout value="50" kind="none" />);
    expect(text().trim()).toBe('');
    rerender(<AmountReadout value="" kind="rupeeCrore" />);
    expect(text().trim()).toBe('');
    rerender(<AmountReadout value="0" kind="rupeePlain" />);
    expect(text().trim()).toBe('');
  });
});
