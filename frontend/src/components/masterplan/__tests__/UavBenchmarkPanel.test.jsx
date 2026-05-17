import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let benchmarkQuery;

vi.mock('../../../hooks/useMasterPlan', () => ({
  useUavBenchmark: () => benchmarkQuery,
}));

import UavBenchmarkPanel from '../UavBenchmarkPanel';

const SAMPLE = {
  zones: ['A', 'B', 'C', 'D', 'E', 'F'],
  uses: [
    'Non-residential premium (AC/escalator/IT/BT)',
    'Residential RCC / Madras terrace (owner-occupied)',
    'Vacant land / land not built upon',
  ],
  matrix: [
    {
      use: 'Non-residential premium (AC/escalator/IT/BT)',
      cells: [
        { zone: 'A', rate: 25.0 },
        { zone: 'B', rate: 20.0 },
        { zone: 'C', rate: 17.5 },
        { zone: 'D', rate: 15.0 },
        { zone: 'E', rate: 12.5 },
        { zone: 'F', rate: 10.0 },
      ],
    },
    {
      use: 'Residential RCC / Madras terrace (owner-occupied)',
      cells: [
        { zone: 'A', rate: 3.0 },
        { zone: 'B', rate: 2.4 },
        { zone: 'C', rate: 1.95 },
        { zone: 'D', rate: 1.65 },
        { zone: 'E', rate: 1.35 },
        { zone: 'F', rate: 1.05 },
      ],
    },
    {
      use: 'Vacant land / land not built upon',
      cells: [
        { zone: 'A', rate: 0.6 },
        { zone: 'B', rate: 0.48 },
        { zone: 'C', rate: 0.4 },
        { zone: 'D', rate: 0.35 },
        { zone: 'E', rate: 0.28 },
        { zone: 'F', rate: 0.2 },
      ],
    },
  ],
  ratios: { A: 1.0, B: 0.8, C: 0.65, D: 0.55, E: 0.45, F: 0.35 },
  unit_label: 'INR per sqft per month',
  city: 'Bengaluru',
  summary: { zone_count: 6, use_count: 3, row_count: 18, source_pages: [4, 5, 6] },
  disclaimer: 'BBMP property-tax UAV rates only — these are NOT IGR sale-deed guidance values.',
};

describe('UavBenchmarkPanel', () => {
  beforeEach(() => {
    benchmarkQuery = { data: SAMPLE, isLoading: false, isError: false };
  });

  it('renders the section header and four summary tiles', () => {
    render(<UavBenchmarkPanel />);
    expect(screen.getByText(/BBMP UAV Benchmark/i)).toBeInTheDocument();
    expect(screen.getByText('UAV zones')).toBeInTheDocument();
    expect(screen.getByText('Property uses')).toBeInTheDocument();
    expect(screen.getByText('Rate-card rows')).toBeInTheDocument();
    expect(screen.getByText('Outer-zone discount')).toBeInTheDocument();
  });

  it('shows the outer-zone discount as a percent of Zone A', () => {
    render(<UavBenchmarkPanel />);
    // Zone F ratio 0.35 → 35%
    expect(screen.getByText('35%')).toBeInTheDocument();
  });

  it('renders one column per zone in the matrix header', () => {
    render(<UavBenchmarkPanel />);
    expect(screen.getByText('Zone A')).toBeInTheDocument();
    expect(screen.getByText('Zone F')).toBeInTheDocument();
  });

  it('dispatches a "bbmp:focus-zone" window event when a zone header is clicked', () => {
    const events = [];
    const handler = (e) => events.push(e.detail);
    window.addEventListener('bbmp:focus-zone', handler);
    try {
      render(<UavBenchmarkPanel />);
      // The "Zone C" header is a clickable button.
      const zoneCBtn = screen.getByRole('button', { name: /Zone C/i });
      fireEvent.click(zoneCBtn);
      expect(events).toContainEqual({ zone: 'C' });
    } finally {
      window.removeEventListener('bbmp:focus-zone', handler);
    }
  });

  it('renders the ratio strip below the zone headers', () => {
    render(<UavBenchmarkPanel />);
    expect(screen.getByText(/Avg ratio vs Zone A/i)).toBeInTheDocument();
    expect(screen.getByText('1.00x')).toBeInTheDocument();
    expect(screen.getByText('0.80x')).toBeInTheDocument();
  });

  it('renders one row per property use with rates per zone', () => {
    render(<UavBenchmarkPanel />);
    // Use cells are <td> with the full use name; search for a unique fragment
    // within table cells specifically (not the filter chips).
    const useCells = screen.getAllByRole('cell').filter((c) => /Vacant land/.test(c.textContent));
    expect(useCells.length).toBeGreaterThan(0);
    expect(screen.getByText('₹25')).toBeInTheDocument();
    expect(screen.getByText('₹3')).toBeInTheDocument();
  });

  it('filters the matrix by use family when a chip is clicked', () => {
    render(<UavBenchmarkPanel />);
    const residentialChip = screen.getByRole('button', { name: 'Residential' });
    fireEvent.click(residentialChip);
    // After filter: only residential row remains in the table body.
    const useCells = screen.getAllByRole('cell').filter((c) =>
      /Residential RCC|Non-residential premium|Vacant land/.test(c.textContent)
    );
    expect(useCells.length).toBe(1);
    expect(useCells[0].textContent).toMatch(/Residential RCC/);
  });

  it('filters the matrix by search term', () => {
    render(<UavBenchmarkPanel />);
    const search = screen.getByPlaceholderText(/Search property use/i);
    fireEvent.change(search, { target: { value: 'vacant' } });
    const useCells = screen.getAllByRole('cell').filter((c) =>
      /Residential RCC|Non-residential premium|Vacant land/.test(c.textContent)
    );
    expect(useCells.length).toBe(1);
    expect(useCells[0].textContent).toMatch(/Vacant land/);
  });

  it('shows an empty-search hint when nothing matches', () => {
    render(<UavBenchmarkPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Search property use/i), {
      target: { value: 'nothing-matches' },
    });
    expect(screen.getByText(/No uses match this filter/i)).toBeInTheDocument();
  });

  it('shows a skeleton while loading', () => {
    benchmarkQuery = { data: undefined, isLoading: true, isError: false };
    render(<UavBenchmarkPanel />);
    expect(screen.getByText(/Loading UAV benchmark/i)).toBeInTheDocument();
  });

  it('shows an error state when the request fails', () => {
    benchmarkQuery = { data: undefined, isLoading: false, isError: true };
    render(<UavBenchmarkPanel />);
    expect(screen.getByText(/Could not load UAV benchmark/i)).toBeInTheDocument();
  });

  it('shows an empty state when the rate card has not been ingested', () => {
    benchmarkQuery = {
      data: { zones: [], uses: [], matrix: [], summary: {}, ratios: {}, unit_label: '', city: '', disclaimer: '' },
      isLoading: false,
      isError: false,
    };
    render(<UavBenchmarkPanel />);
    expect(screen.getByText(/No BBMP UAV rate card ingested yet/i)).toBeInTheDocument();
  });

  it('renders the property-tax disclaimer to disambiguate from IGR guidance', () => {
    render(<UavBenchmarkPanel />);
    expect(screen.getByText(/NOT IGR sale-deed guidance values/i)).toBeInTheDocument();
  });
});
