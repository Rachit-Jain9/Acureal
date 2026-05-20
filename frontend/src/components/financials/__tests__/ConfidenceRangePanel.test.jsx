import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockHookState = {
  data: undefined,
  isLoading: false,
};

vi.mock('../../../hooks/useFinancials', () => ({
  useConfidenceRange: () => mockHookState,
}));

import ConfidenceRangePanel from '../ConfidenceRangePanel';

const sampleData = (overrides = {}) => ({
  available: true,
  assetClass: 'residential_apartments',
  modelClass: 'residential_apartments',
  primaryKpi: 'irr',
  unverifiedCount: 3,
  kpis: [
    { key: 'irr', label: 'IRR', unit: 'pct', base: 18.4, low: 14.2, high: 21.9, swing: 7.7 },
    { key: 'npv', label: 'NPV', unit: 'inr_cr', base: 24.1, low: 12, high: 33.5, swing: 21.5 },
    { key: 'equityMultiple', label: 'Equity multiple', unit: 'x', base: 1.85, low: 1.4, high: 2.2, swing: 0.8 },
  ],
  drivers: [
    {
      key: 'loadingFactor',
      label: 'Loading factor',
      category: 'Site & area',
      benchmarkSource: 'RERA norms + Bengaluru market convention',
      low: 14.2,
      high: 21.9,
      swing: 7.7,
    },
    {
      key: 'marketingCostPct',
      label: 'Marketing cost',
      category: 'Costs',
      benchmarkSource: 'Anarock/JLL Bengaluru developer benchmarks',
      low: 17.1,
      high: 19.5,
      swing: 2.4,
    },
  ],
  ...overrides,
});

beforeEach(() => {
  mockHookState.data = undefined;
  mockHookState.isLoading = false;
});

describe('ConfidenceRangePanel (Workstream A slice 2)', () => {
  it('shows a skeleton during initial load', () => {
    mockHookState.isLoading = true;
    const { container } = render(<ConfidenceRangePanel dealId="d-1" />);
    expect(container.querySelector('.redip-skeleton')).not.toBeNull();
  });

  it('renders nothing when data is undefined', () => {
    mockHookState.data = undefined;
    const { container } = render(<ConfidenceRangePanel dealId="d-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the summary is unavailable', () => {
    mockHookState.data = { available: false, reason: 'no financial model on this deal yet' };
    const { container } = render(<ConfidenceRangePanel dealId="d-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders KPI rows with base values and the unverified-assumption count', () => {
    mockHookState.data = sampleData();
    render(<ConfidenceRangePanel dealId="d-1" />);
    expect(screen.getByText('Confidence Range')).toBeInTheDocument();
    expect(screen.getByText('IRR')).toBeInTheDocument();
    expect(screen.getByText('18.4%')).toBeInTheDocument();
    expect(screen.getByText('₹24.1 Cr')).toBeInTheDocument();
    expect(screen.getByText('1.85x')).toBeInTheDocument();
    expect(screen.getByText(/3 unverified assumptions/i)).toBeInTheDocument();
  });

  it('shows the positive state when nothing is unverified', () => {
    mockHookState.data = sampleData({
      unverifiedCount: 0,
      drivers: [],
      kpis: [
        { key: 'irr', label: 'IRR', unit: 'pct', base: 18.4, low: 18.4, high: 18.4, swing: 0 },
        { key: 'npv', label: 'NPV', unit: 'inr_cr', base: 24.1, low: 24.1, high: 24.1, swing: 0 },
      ],
    });
    render(<ConfidenceRangePanel dealId="d-1" />);
    expect(
      screen.getByText(/Every key assumption is set for this deal/i),
    ).toBeInTheDocument();
  });

  it('keeps the driver breakdown collapsed until the toggle is clicked', () => {
    mockHookState.data = sampleData();
    render(<ConfidenceRangePanel dealId="d-1" />);

    expect(screen.queryByText('Loading factor')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show what widens the range/i }));

    expect(screen.getByText('Loading factor')).toBeInTheDocument();
    expect(screen.getByText('Marketing cost')).toBeInTheDocument();
    expect(screen.getByText('RERA norms + Bengaluru market convention')).toBeInTheDocument();
  });

  it('states plainly that the range is not a probability forecast', () => {
    mockHookState.data = sampleData();
    render(<ConfidenceRangePanel dealId="d-1" />);
    expect(screen.getByText(/not a probability forecast/i)).toBeInTheDocument();
  });
});
