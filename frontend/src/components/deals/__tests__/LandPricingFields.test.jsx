import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LandPricingFields from '../LandPricingFields';

// Shared land-pricing fieldset (New Deal + Edit deal modals). The regression
// this file locks: the "Computed total land price" tile used to render
// white-on-white in light theme (bg-bg-primary + text-white) so a correctly
// computed ₹54.00 Cr looked permanently empty.

const baseValues = {
  landPricingBasis: 'per_sqft',
  landAskPriceCr: '',
  landPriceRateInr: '12000',
  landExtentInputValue: '45000',
  landExtentInputUnit: 'sqft',
};

describe('LandPricingFields', () => {
  // The preview tiles restate the inputs, so "45,000 sqft" also appears in the
  // extent field's AmountReadout — read the tile by its label to assert the
  // computed value specifically.
  const tileValue = (label) => screen.getByText(label).parentElement.querySelector('p:last-child').textContent;

  it('computes and RENDERS the total for per_sqft rate × extent (12,000 × 45,000 sqft = ₹54 Cr)', () => {
    render(<LandPricingFields values={baseValues} onFieldChange={() => {}} />);
    expect(tileValue('Computed total land price')).toBe('54.00 Cr');
    expect(tileValue('Normalized area')).toBe('45,000 sqft');
    expect(tileValue('Equivalent acres')).toBe('1.0331'); // 45,000 / 43,560
  });

  it('theme-safety regression: the computed-total tile never pairs text-white with a theme background', () => {
    const { container } = render(
      <LandPricingFields values={baseValues} onFieldChange={() => {}} />,
    );
    expect(container.querySelector('.text-white')).toBeNull();
    expect(container.querySelector('.bg-bg-primary')).toBeNull();
  });

  it('converts acres via 43,560 sqft/acre (1 acre @ ₹12,000/sqft = ₹52.27 Cr)', () => {
    render(
      <LandPricingFields
        values={{ ...baseValues, landExtentInputValue: '1', landExtentInputUnit: 'acre' }}
        onFieldChange={() => {}}
      />,
    );
    expect(tileValue('Normalized area')).toBe('43,560 sqft');
    expect(tileValue('Computed total land price')).toBe('52.27 Cr');
  });

  it('falls back to the linked property area when extent is blank', () => {
    render(
      <LandPricingFields
        values={{ ...baseValues, landExtentInputValue: '' }}
        onFieldChange={() => {}}
        fallbackAreaSqft={10000}
      />,
    );
    expect(tileValue('Computed total land price')).toBe('12.00 Cr'); // 12,000 × 10,000 / 1e7
    expect(screen.getByText(/Linked property fallback area: 10,000 sqft/)).toBeInTheDocument();
  });

  it('total_cr basis edits the ask price directly and derives the implied rates', () => {
    const onFieldChange = vi.fn();
    render(
      <LandPricingFields
        values={{
          landPricingBasis: 'total_cr',
          landAskPriceCr: '54',
          landPriceRateInr: '',
          landExtentInputValue: '45000',
          landExtentInputUnit: 'sqft',
        }}
        onFieldChange={onFieldChange}
      />,
    );
    expect(tileValue('Computed total land price')).toBe('54.00 Cr');
    fireEvent.change(screen.getByLabelText('Total land price in crore'), { target: { value: '60' } });
    expect(onFieldChange).toHaveBeenCalledWith('landAskPriceCr', '60');
  });

  it('reports basis / rate / extent edits through onFieldChange', () => {
    const onFieldChange = vi.fn();
    render(<LandPricingFields values={baseValues} onFieldChange={onFieldChange} />);
    fireEvent.change(screen.getByLabelText('Land pricing basis'), { target: { value: 'per_acre' } });
    expect(onFieldChange).toHaveBeenCalledWith('landPricingBasis', 'per_acre');
    fireEvent.change(screen.getByLabelText('Land extent for pricing'), { target: { value: '30' } });
    expect(onFieldChange).toHaveBeenCalledWith('landExtentInputValue', '30');
    fireEvent.change(screen.getByLabelText('Land extent unit'), { target: { value: 'acre' } });
    expect(onFieldChange).toHaveBeenCalledWith('landExtentInputUnit', 'acre');
  });

  it('shows honest placeholders when nothing is computable', () => {
    render(
      <LandPricingFields
        values={{
          landPricingBasis: 'per_sqft',
          landAskPriceCr: '',
          landPriceRateInr: '',
          landExtentInputValue: '',
          landExtentInputUnit: 'sqft',
        }}
        onFieldChange={() => {}}
      />,
    );
    expect(screen.getAllByText('-')).toHaveLength(3);
  });
});
