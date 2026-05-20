import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockHookState = {
  data: undefined,
  isLoading: false,
};

vi.mock('../../../hooks/useFinancials', () => ({
  useModelConfidence: () => mockHookState,
}));

import ModelConfidencePanel from '../ModelConfidencePanel';

const sampleData = (overrides = {}) => ({
  available: true,
  assetClass: 'residential_apartments',
  modelClass: 'residential_apartments',
  dealSetCount: 5,
  defaultCount: 5,
  total: 10,
  confidencePct: 50,
  band: 'mixed',
  inputs: [
    {
      key: 'plotAreaSqft',
      label: 'Plot area',
      category: 'Site & area',
      kind: 'fact',
      status: 'deal-set',
      value: 50000,
      benchmarkValue: null,
      benchmarkSource: null,
      basis: 'Entered for this deal',
    },
    {
      key: 'discountRatePct',
      label: 'Discount rate',
      category: 'Financing',
      kind: 'assumption',
      status: 'default',
      value: 14,
      benchmarkValue: 14,
      benchmarkSource: 'REDIP WACC model',
      basis: 'Matches the REDIP benchmark — REDIP WACC model',
    },
  ],
  ...overrides,
});

beforeEach(() => {
  mockHookState.data = undefined;
  mockHookState.isLoading = false;
});

describe('ModelConfidencePanel (Workstream A)', () => {
  it('shows a skeleton during initial load', () => {
    mockHookState.isLoading = true;
    const { container } = render(<ModelConfidencePanel dealId="d-1" />);
    expect(container.querySelector('.redip-skeleton')).not.toBeNull();
  });

  it('renders nothing when data is undefined', () => {
    mockHookState.data = undefined;
    const { container } = render(<ModelConfidencePanel dealId="d-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the summary is unavailable', () => {
    mockHookState.data = { available: false, reason: 'no financial model on this deal yet' };
    const { container } = render(<ModelConfidencePanel dealId="d-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the headline metric, band chip and counts', () => {
    mockHookState.data = sampleData();
    render(<ModelConfidencePanel dealId="d-1" />);
    expect(screen.getByText('Model Confidence')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText(/of 10 key inputs set for this deal/i)).toBeInTheDocument();
    expect(screen.getByText('Mixed basis')).toBeInTheDocument();
    expect(screen.getByText(/5 set for this deal/i)).toBeInTheDocument();
  });

  it('renders the well-grounded band label for a high-confidence model', () => {
    mockHookState.data = sampleData({ confidencePct: 90, band: 'grounded', dealSetCount: 9, defaultCount: 1 });
    render(<ModelConfidencePanel dealId="d-1" />);
    expect(screen.getByText('Well-grounded')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
  });

  it('keeps the input breakdown collapsed until the toggle is clicked', () => {
    mockHookState.data = sampleData();
    render(<ModelConfidencePanel dealId="d-1" />);

    // Collapsed — individual input rows are not in the DOM yet.
    expect(screen.queryByText('Plot area')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show input breakdown/i }));

    // Expanded — rows + category headers now render.
    expect(screen.getByText('Site & area')).toBeInTheDocument();
    expect(screen.getByText('Plot area')).toBeInTheDocument();
    expect(screen.getByText('Discount rate')).toBeInTheDocument();
    expect(screen.getByText('Deal-specific')).toBeInTheDocument();
    expect(screen.getByText('Benchmark default')).toBeInTheDocument();
  });

  it('states plainly that confidence is not a document-verification check', () => {
    mockHookState.data = sampleData();
    render(<ModelConfidencePanel dealId="d-1" />);
    expect(
      screen.getByText(/not a check that an input was verified against a source document/i),
    ).toBeInTheDocument();
  });
});
