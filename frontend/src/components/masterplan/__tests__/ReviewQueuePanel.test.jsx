import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let queueQuery;

vi.mock('../../../hooks/useMasterPlan', () => ({
  useReviewQueue: () => queueQuery,
}));

import ReviewQueuePanel from '../ReviewQueuePanel';

const SAMPLE_NEEDS_REVIEW = {
  counts: {
    high:     { pending: 1, approved: 5, rejected: 0, total: 6 },
    medium:   { pending: 2, approved: 1, rejected: 0, total: 3 },
    low:      { pending: 1, approved: 1, rejected: 0, total: 2 },
    unscored: { pending: 1, approved: 0, rejected: 0, total: 1 },
  },
  summary: {
    fact_count: 12,
    needs_review_count: 6,
    high_count: 6,
    medium_count: 3,
    low_count: 2,
    unscored_count: 1,
  },
  needs_review: [
    {
      id: 'f1', source_id: 's1', source_title: 'Volume 6 Zoning Regulations',
      plan_version: 'RMP 2031 (Draft)',
      fact_type: 'rmp_table', fact_key: 'height_setback_table',
      fact_value: { tiers: 16 },
      page_number: 39, source_section: 'Table 2', confidence_score: 0.92,
      bucket: 'high', review_status: 'pending', created_at: '2026-04-30T10:00:00Z',
    },
    {
      id: 'f2', source_id: 's2', source_title: 'PDR Volume 4',
      plan_version: 'RMP 2031 Provisional',
      fact_type: 'rmp_table', fact_key: 'noise_corridor_estimate',
      fact_value: 'unclear',
      page_number: 24, source_section: null, confidence_score: 0.55,
      bucket: 'low', review_status: 'approved', created_at: '2026-04-29T10:00:00Z',
    },
    {
      id: 'f3', source_id: 's3', source_title: 'Map source',
      plan_version: null,
      fact_type: 'landmark', fact_key: 'lalbagh',
      fact_value: { name: 'Lalbagh' },
      page_number: null, source_section: null, confidence_score: null,
      bucket: 'unscored', review_status: 'pending', created_at: '2026-04-28T10:00:00Z',
    },
  ],
  disclaimer: 'AI-extracted facts that fall below 0.9 confidence...',
};

const SAMPLE_ALL_CLEAR = {
  counts: {
    high:     { pending: 0, approved: 12, rejected: 0, total: 12 },
    medium:   { pending: 0, approved: 0, rejected: 0, total: 0 },
    low:      { pending: 0, approved: 0, rejected: 0, total: 0 },
    unscored: { pending: 0, approved: 0, rejected: 0, total: 0 },
  },
  summary: {
    fact_count: 12,
    needs_review_count: 0,
    high_count: 12,
    medium_count: 0,
    low_count: 0,
    unscored_count: 0,
  },
  needs_review: [],
  disclaimer: 'AI-extracted facts...',
};

describe('ReviewQueuePanel', () => {
  beforeEach(() => {
    queueQuery = { data: SAMPLE_NEEDS_REVIEW, isLoading: false, isError: false };
  });

  it('renders the section header and four bucket tiles', () => {
    render(<ReviewQueuePanel />);
    expect(screen.getByText(/Review Queue/i)).toBeInTheDocument();
    expect(screen.getByText('High confidence')).toBeInTheDocument();
    expect(screen.getByText('Medium confidence')).toBeInTheDocument();
    expect(screen.getByText('Low confidence')).toBeInTheDocument();
    expect(screen.getByText('Unscored')).toBeInTheDocument();
  });

  it('shows the needs-review table with one row per low-confidence or pending fact', () => {
    render(<ReviewQueuePanel />);
    expect(screen.getByText('height_setback_table')).toBeInTheDocument();
    expect(screen.getByText('noise_corridor_estimate')).toBeInTheDocument();
    expect(screen.getByText('lalbagh')).toBeInTheDocument();
  });

  it('formats confidence scores to two decimals and shows a dash for null', () => {
    render(<ReviewQueuePanel />);
    expect(screen.getByText('0.92')).toBeInTheDocument();
    expect(screen.getByText('0.55')).toBeInTheDocument();
  });

  it('filters the needs-review list by search term', () => {
    render(<ReviewQueuePanel />);
    const search = screen.getByPlaceholderText(/Search by fact key/i);
    fireEvent.change(search, { target: { value: 'noise' } });
    expect(screen.getByText('noise_corridor_estimate')).toBeInTheDocument();
    expect(screen.queryByText('height_setback_table')).not.toBeInTheDocument();
    expect(screen.queryByText('lalbagh')).not.toBeInTheDocument();
  });

  it('shows the all-clear card when every fact is high-confidence and approved', () => {
    queueQuery = { data: SAMPLE_ALL_CLEAR, isLoading: false, isError: false };
    render(<ReviewQueuePanel />);
    expect(screen.getByText(/All clear/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Search by fact key/i)).not.toBeInTheDocument();
  });

  it('shows the empty-search hint when filter matches nothing', () => {
    render(<ReviewQueuePanel />);
    const search = screen.getByPlaceholderText(/Search by fact key/i);
    fireEvent.change(search, { target: { value: 'no-such-key-anywhere' } });
    expect(screen.getByText(/No facts match this search/i)).toBeInTheDocument();
  });

  it('shows a skeleton while loading', () => {
    queueQuery = { data: undefined, isLoading: true, isError: false };
    render(<ReviewQueuePanel />);
    expect(screen.getByText(/Loading review queue/i)).toBeInTheDocument();
  });

  it('shows an error state when the request fails', () => {
    queueQuery = { data: undefined, isLoading: false, isError: true };
    render(<ReviewQueuePanel />);
    expect(screen.getByText(/Could not load review queue/i)).toBeInTheDocument();
  });

  it('renders the AI-assisted disclaimer', () => {
    render(<ReviewQueuePanel />);
    expect(screen.getByText(/AI-extracted facts that fall below 0\.9 confidence/i)).toBeInTheDocument();
  });
});
