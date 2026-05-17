import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let summaryQuery;

vi.mock('../../../hooks/useMasterPlan', () => ({
  useBbmpWardSummary: () => summaryQuery,
}));

import BbmpWardSummaryPanel from '../BbmpWardSummaryPanel';

const SAMPLE = {
  wards: [
    {
      ward_no: 84,
      street_count: 100,
      enriched_count: 70,
      distinct_zone_count: 2,
      median_guidance_mid_inr: 4251,
      sample_aro_section: 'WHITEFIELD / RESIDENTIAL',
      dominant_zone: 'C',
      dominant_zone_count: 50,
      dominant_zone_share_pct: 71.4,
    },
    {
      ward_no: 151,
      street_count: 60,
      enriched_count: 0,
      distinct_zone_count: 0,
      median_guidance_mid_inr: null,
      sample_aro_section: 'KORAMANGALA / RESIDENTIAL',
      dominant_zone: null,
      dominant_zone_count: null,
      dominant_zone_share_pct: null,
    },
    {
      ward_no: 111,
      street_count: 40,
      enriched_count: 40,
      distinct_zone_count: 1,
      median_guidance_mid_inr: 7001,
      sample_aro_section: 'CHIKPETE / RESIDENTIAL',
      dominant_zone: 'A',
      dominant_zone_count: 40,
      dominant_zone_share_pct: 100.0,
    },
  ],
  summary: {
    ward_count: 3,
    total_streets: 200,
    total_enriched: 110,
    enriched_pct: 55,
    wards_fully_enriched: 1,
    wards_with_multiple_zones: 1,
  },
  source_document: 'BBMP Guidance Value Notification No. 384 (09-Mar-2016)',
  disclaimer: 'Ward rollups derived from the AI-extracted street index.',
};

describe('BbmpWardSummaryPanel', () => {
  beforeEach(() => {
    summaryQuery = { data: SAMPLE, isLoading: false, isError: false };
  });

  it('renders the section header and four summary tiles', () => {
    render(<BbmpWardSummaryPanel />);
    expect(screen.getByText(/Ward Summary/i)).toBeInTheDocument();
    expect(screen.getByText('Wards covered')).toBeInTheDocument();
    expect(screen.getByText('Streets indexed')).toBeInTheDocument();
    expect(screen.getByText('Enriched')).toBeInTheDocument();
    expect(screen.getByText('Wards with multiple zones')).toBeInTheDocument();
  });

  it('renders one row per ward with street count + dominant zone + median guidance', () => {
    render(<BbmpWardSummaryPanel />);
    expect(screen.getByText('Ward 84')).toBeInTheDocument();
    expect(screen.getByText('Ward 151')).toBeInTheDocument();
    expect(screen.getByText('Ward 111')).toBeInTheDocument();
    // Median guidance for ward 84 is ₹4,251
    expect(screen.getByText(/₹4,251/)).toBeInTheDocument();
    // Ward 84 dominant zone is Zone C
    expect(screen.getByText('Zone C')).toBeInTheDocument();
    // Ward 111 dominant zone is Zone A
    expect(screen.getByText('Zone A')).toBeInTheDocument();
  });

  it('shows "no enrichment yet" for wards without a dominant zone', () => {
    render(<BbmpWardSummaryPanel />);
    expect(screen.getByText(/no enrichment yet/i)).toBeInTheDocument();
  });

  it('shows the multi-zone hint when distinct_zone_count > 1', () => {
    render(<BbmpWardSummaryPanel />);
    // Ward 84 has 2 distinct zones → "+1 other"
    expect(screen.getByText(/\+1 other/)).toBeInTheDocument();
  });

  it('sorts by street count when the Streets header is clicked (defaults to desc)', () => {
    render(<BbmpWardSummaryPanel />);
    const header = screen.getByText('Streets').closest('th');
    fireEvent.click(header);
    const rows = screen.getAllByRole('row').slice(1);
    // Largest street count first: Ward 84 (100) → Ward 151 (60) → Ward 111 (40)
    expect(rows[0]).toHaveTextContent('Ward 84');
    expect(rows[1]).toHaveTextContent('Ward 151');
    expect(rows[2]).toHaveTextContent('Ward 111');
  });

  it('toggles sort direction when the same header is clicked twice', () => {
    render(<BbmpWardSummaryPanel />);
    const header = screen.getByText('Streets').closest('th');
    fireEvent.click(header); // desc
    fireEvent.click(header); // asc
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Ward 111'); // 40 streets, smallest
  });

  it('filters by ward number when the user types a digit', () => {
    render(<BbmpWardSummaryPanel />);
    const search = screen.getByPlaceholderText(/Filter by ward number/i);
    fireEvent.change(search, { target: { value: '84' } });
    expect(screen.getByText('Ward 84')).toBeInTheDocument();
    expect(screen.queryByText('Ward 151')).not.toBeInTheDocument();
  });

  it('filters by ARO area name (case-insensitive)', () => {
    render(<BbmpWardSummaryPanel />);
    const search = screen.getByPlaceholderText(/Filter by ward number/i);
    fireEvent.change(search, { target: { value: 'whitefield' } });
    expect(screen.getByText('Ward 84')).toBeInTheDocument();
    expect(screen.queryByText('Ward 111')).not.toBeInTheDocument();
  });

  it('filters by zone code (single-letter)', () => {
    render(<BbmpWardSummaryPanel />);
    const search = screen.getByPlaceholderText(/Filter by ward number/i);
    fireEvent.change(search, { target: { value: 'A' } });
    // Only Ward 111 has dominant_zone = 'A'
    expect(screen.getByText('Ward 111')).toBeInTheDocument();
    expect(screen.queryByText('Ward 84')).not.toBeInTheDocument();
  });

  it('shows a skeleton while loading', () => {
    summaryQuery = { data: undefined, isLoading: true, isError: false };
    render(<BbmpWardSummaryPanel />);
    expect(screen.getByText(/Loading BBMP ward summary/i)).toBeInTheDocument();
  });

  it('shows an error state when the request fails', () => {
    summaryQuery = { data: undefined, isLoading: false, isError: true };
    render(<BbmpWardSummaryPanel />);
    expect(screen.getByText(/Could not load ward summary/i)).toBeInTheDocument();
  });

  it('shows an empty-search hint when filter matches nothing', () => {
    render(<BbmpWardSummaryPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Filter by ward/i), {
      target: { value: '999999' },
    });
    expect(screen.getByText(/No wards match the current filter/i)).toBeInTheDocument();
  });

  it('renders the AI-extracted disclaimer', () => {
    render(<BbmpWardSummaryPanel />);
    expect(screen.getByText(/AI-extracted street index/i)).toBeInTheDocument();
  });
});
