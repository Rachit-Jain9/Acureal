import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const usePipelineVelocityMock = vi.fn();
vi.mock('../../../hooks/useDashboard', () => ({
  usePipelineVelocity: (...a) => usePipelineVelocityMock(...a),
}));

import PipelineVelocityWidget from '../PipelineVelocityWidget';

beforeEach(() => usePipelineVelocityMock.mockReset());
const wrap = (ui) => <MemoryRouter>{ui}</MemoryRouter>;

const POPULATED = {
  headline: {
    total_deals: 20, live_deals: 7, dead_deals: 4, closed_deals: 1,
    median_days_to_active: 42, aging_count: 2,
    biggest_dropoff: { from_stage: 'screening', from_label: 'Screening', to_stage: 'site_visit', conversion_pct: 50 },
  },
  funnel: [
    { stage: 'sourced', label: 'Sourced', reached: 20, current: 0, next_stage: 'screening', conversion_to_next_pct: 70 },
    { stage: 'screening', label: 'Screening', reached: 14, current: 3, next_stage: 'site_visit', conversion_to_next_pct: 50 },
    { stage: 'underwriting', label: 'Underwriting', reached: 6, current: 0, next_stage: 'ic_review', conversion_to_next_pct: 33 },
  ],
  time_in_stage: [
    { stage: 'sourced', label: 'Sourced', sample_size: 12, insufficient: false, median_days: 11 },
    { stage: 'screening', label: 'Screening', sample_size: 2, insufficient: true, median_days: null },
  ],
  cycle_time: [
    { milestone: 'underwriting', label: 'Underwriting', reached_count: 6, insufficient: false, median_days: 30 },
    { milestone: 'ic_review', label: 'IC review', reached_count: 2, insufficient: true, median_days: null },
    { milestone: 'active', label: 'Active', reached_count: 2, insufficient: true, median_days: null },
  ],
  aging: [
    { deal_id: 'd1', deal_name: 'Whitefield Plot', stage: 'underwriting', stage_label: 'Underwriting', days_in_stage: 120, typical_days: 30 },
  ],
  throughput: [
    { month: 'Jan 2026', advances: 3 }, { month: 'Feb 2026', advances: 4 },
    { month: 'Mar 2026', advances: 1 }, { month: 'Apr 2026', advances: 1 },
    { month: 'May 2026', advances: 0 }, { month: 'Jun 2026', advances: 0 },
  ],
  disclaimer: 'Pipeline Velocity is a deterministic roll-up of your team’s recorded stage changes.',
};

describe('PipelineVelocityWidget', () => {
  it('renders the loading skeleton', () => {
    usePipelineVelocityMock.mockReturnValue({ data: null, isLoading: true, isError: false });
    const { container } = render(wrap(<PipelineVelocityWidget />));
    expect(container.querySelector('.redip-skeleton')).not.toBeNull();
  });

  it('renders the error state without breaking the dashboard', () => {
    usePipelineVelocityMock.mockReturnValue({ data: null, isLoading: false, isError: true });
    render(wrap(<PipelineVelocityWidget />));
    expect(screen.getByText(/Couldn't load pipeline velocity/)).toBeInTheDocument();
  });

  it('renders the empty state + CTA when there is no history', () => {
    usePipelineVelocityMock.mockReturnValue({
      data: { headline: { total_deals: 0 }, funnel: [], time_in_stage: [], cycle_time: [], aging: [], throughput: [] },
      isLoading: false, isError: false,
    });
    render(wrap(<PipelineVelocityWidget />));
    expect(screen.getByText(/No pipeline history yet/)).toBeInTheDocument();
  });

  it('renders the populated funnel, cycle, aging and headline', () => {
    usePipelineVelocityMock.mockReturnValue({ data: POPULATED, isLoading: false, isError: false });
    render(wrap(<PipelineVelocityWidget />));
    expect(screen.getByText('Median to active')).toBeInTheDocument();
    expect(screen.getByText('42d')).toBeInTheDocument();        // cycle to active
    expect(screen.getByText('Sourced')).toBeInTheDocument();    // funnel row (unique)
    expect(screen.getByText('to Underwriting')).toBeInTheDocument(); // cycle tile
    expect(screen.getByText('Whitefield Plot')).toBeInTheDocument(); // aging row
    expect(screen.getByText('120d')).toBeInTheDocument();       // days in stage
    expect(screen.getByText(/Biggest leak/)).toBeInTheDocument();
  });

  it('shows an em-dash (never "0d") for an insufficient-data median', () => {
    usePipelineVelocityMock.mockReturnValue({ data: POPULATED, isLoading: false, isError: false });
    render(wrap(<PipelineVelocityWidget />));
    // screening time-in-stage + ic_review/active cycle are insufficient (null) → em-dash.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    // and the misleading "0d" must NOT appear for those gated values.
    expect(screen.queryByText('0d')).toBeNull();
  });
});
