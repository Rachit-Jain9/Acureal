import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockState = { data: undefined, isLoading: false };

vi.mock('../../../hooks/useIcEvidence', () => ({
  useIcEvidence: () => mockState,
}));

import IcMemoEvidence from '../IcMemoEvidence';

const sampleData = (overrides = {}) => ({
  available: true,
  dealId: 'd-1',
  groups: [
    {
      category: 'Returns',
      claims: [
        {
          key: 'irr',
          label: 'Project IRR',
          value: 18.4,
          unit: 'pct',
          source: {
            type: 'kernel',
            label: 'REDIP deterministic kernel',
            detail: 'Computed by the deterministic kernel from the saved model inputs.',
          },
          traced: true,
        },
      ],
    },
    {
      category: 'Key assumptions',
      claims: [
        {
          key: 'discountRatePct',
          label: 'Discount rate',
          value: 14,
          unit: 'pct',
          source: {
            type: 'benchmark',
            label: 'REDIP benchmark',
            detail: 'On REDIP cited benchmark — WACC model.',
          },
          traced: true,
        },
      ],
    },
  ],
  summary: { total: 2, traced: 2, byType: { kernel: 1, benchmark: 1 } },
  ...overrides,
});

beforeEach(() => {
  mockState.data = undefined;
  mockState.isLoading = false;
});

describe('IcMemoEvidence (Workstream A — A3)', () => {
  it('shows a skeleton while loading', () => {
    mockState.isLoading = true;
    const { container } = render(<IcMemoEvidence dealId="d-1" />);
    expect(container.querySelector('.redip-skeleton')).not.toBeNull();
  });

  it('renders nothing when the ledger is unavailable', () => {
    mockState.data = { available: false };
    const { container } = render(<IcMemoEvidence dealId="d-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there are no claim groups', () => {
    mockState.data = sampleData({ groups: [] });
    const { container } = render(<IcMemoEvidence dealId="d-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the header with the traced-count summary, collapsed by default', () => {
    mockState.data = sampleData();
    render(<IcMemoEvidence dealId="d-1" />);
    expect(screen.getByText('Evidence & Sources')).toBeInTheDocument();
    expect(screen.getByText(/2 numbers, every one traced/i)).toBeInTheDocument();
    // Collapsed — individual claims are not in the DOM yet.
    expect(screen.queryByText('Project IRR')).not.toBeInTheDocument();
  });

  it('reveals the grouped claims and source chips when expanded', () => {
    mockState.data = sampleData();
    render(<IcMemoEvidence dealId="d-1" />);

    fireEvent.click(screen.getByRole('button', { name: /evidence & sources/i }));

    expect(screen.getByText('Returns')).toBeInTheDocument();
    expect(screen.getByText('Project IRR')).toBeInTheDocument();
    expect(screen.getByText('Discount rate')).toBeInTheDocument();
    expect(screen.getByText('Kernel-computed')).toBeInTheDocument();
    expect(screen.getByText('Benchmark')).toBeInTheDocument();
    expect(screen.getByText(/1 kernel-computed/i)).toBeInTheDocument();
  });

  it('expands a claim to reveal its source detail', () => {
    mockState.data = sampleData();
    render(<IcMemoEvidence dealId="d-1" />);

    fireEvent.click(screen.getByRole('button', { name: /evidence & sources/i }));
    expect(
      screen.queryByText(/Computed by the deterministic kernel/i),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Project IRR/i }));
    expect(
      screen.getByText(/Computed by the deterministic kernel/i),
    ).toBeInTheDocument();
  });
});
