import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock the data hooks so the card renders deterministically and offline.
const mockSetMutate = vi.fn();
let mockQuery;

vi.mock('../../../hooks/useOrgBenchmarkSetting', () => ({
  useOrgBenchmarkSetting: () => mockQuery,
  useSetOrgBenchmarkSetting: () => ({ mutate: mockSetMutate, isPending: false }),
}));

import OrgBenchmarkCard from '../OrgBenchmarkCard';

const loadedData = (optedOut = false, eligible = false) => ({
  opted_out: optedOut,
  available: true,
  history: [
    {
      id: 1,
      purpose: 'benchmark_opt_out',
      granted: optedOut,
      created_at: '2026-05-21T00:00:00Z',
      changed_by_name: 'Rachit',
    },
  ],
  your_eligibility: {
    included_in_aggregate: eligible,
    org_opted_out: optedOut,
    user_consented: eligible,
    reasons: eligible
      ? []
      : ['The contributing user has not granted anonymized-benchmarking consent.'],
  },
});

beforeEach(() => {
  mockSetMutate.mockReset();
  mockQuery = { data: loadedData(false, false), isLoading: false, isError: false, refetch: vi.fn() };
});

describe('OrgBenchmarkCard', () => {
  it('renders the heading and explanatory copy', () => {
    render(<OrgBenchmarkCard />);
    expect(screen.getByText(/Market benchmark contribution/i)).toBeInTheDocument();
    expect(screen.getByText(/anonymized market-benchmark layer/i)).toBeInTheDocument();
  });

  it('renders the opt-out switch reflecting the current state (not opted out)', () => {
    render(<OrgBenchmarkCard />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('shows the switch engaged when the organisation has opted out', () => {
    mockQuery.data = loadedData(true, false);
    render(<OrgBenchmarkCard />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('engages the opt-out when the switch is toggled on', () => {
    render(<OrgBenchmarkCard />);
    fireEvent.click(screen.getByRole('switch'));
    expect(mockSetMutate).toHaveBeenCalledWith(true);
  });

  it('releases the opt-out when an engaged switch is toggled off', () => {
    mockQuery.data = loadedData(true, false);
    render(<OrgBenchmarkCard />);
    fireEvent.click(screen.getByRole('switch'));
    expect(mockSetMutate).toHaveBeenCalledWith(false);
  });

  it("shows the caller's own contribution eligibility", () => {
    render(<OrgBenchmarkCard />);
    expect(screen.getByText(/deals you create would not contribute/i)).toBeInTheDocument();
  });

  it('shows the last-updated provenance line', () => {
    render(<OrgBenchmarkCard />);
    expect(screen.getByText(/Last updated by Rachit/i)).toBeInTheDocument();
  });

  it('renders a setup message when the feature is not yet migrated', () => {
    mockQuery.data = { opted_out: false, available: false, history: [], your_eligibility: null };
    render(<OrgBenchmarkCard />);
    expect(screen.getByText(/being set up/i)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('renders an error state with a retry control', () => {
    mockQuery = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() };
    render(<OrgBenchmarkCard />);
    expect(screen.getByText(/Couldn't load the benchmark setting/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });
});
