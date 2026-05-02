import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let landUseQuery;

vi.mock('../../../hooks/useMasterPlan', () => ({
  useLandUseIntelligence: () => landUseQuery,
}));

import DealPlanningContextCard from '../DealPlanningContextCard';

const renderWithRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

const SAMPLE_FULL = {
  callouts: [
    {
      type: 'sdz',
      key: 'special_development_zones',
      value: { count: 5, max_far: 3.5, locations: ['Bellary Road', 'Old Madras Road', 'Sarjapura Road'] },
    },
    {
      type: 'environmental',
      key: 'ngt_drainage_classification',
      value: { buffer_m_primary: 50, buffer_m_secondary: 35, buffer_m_tertiary: 25, source: 'NGT order' },
    },
    {
      type: 'heritage',
      key: 'heritage_zones',
      value: { count: 12, prohibited_radius_m: 100, regulated_radius_m: 200 },
    },
    {
      type: 'road_network',
      key: 'peripheral_ring_road',
      value: { width_m: 100, type: 'PRR', note: '100m corridor on the proposed map' },
    },
  ],
};

const SAMPLE_EMPTY = { callouts: [] };

describe('DealPlanningContextCard', () => {
  beforeEach(() => {
    landUseQuery = { data: SAMPLE_FULL, isLoading: false, isError: false };
  });

  it('renders the section header and links to Planning Intelligence admin', () => {
    renderWithRouter(<DealPlanningContextCard />);
    expect(screen.getByText(/Bengaluru planning context/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Open Planning Intelligence/i });
    expect(link).toHaveAttribute('href', '/admin/master-plan?tab=intelligence');
  });

  it('renders all four city-wide callouts when data is present', () => {
    renderWithRouter(<DealPlanningContextCard />);
    expect(screen.getByText('Special Development Zones')).toBeInTheDocument();
    expect(screen.getByText(/5 corridors/i)).toBeInTheDocument();
    expect(screen.getByText('NGT drain buffers')).toBeInTheDocument();
    expect(screen.getByText('Heritage zones')).toBeInTheDocument();
    expect(screen.getByText(/12 zones/i)).toBeInTheDocument();
    expect(screen.getByText('Peripheral Ring Road')).toBeInTheDocument();
  });

  it('formats the heritage prohibited radius and regulated hint', () => {
    renderWithRouter(<DealPlanningContextCard />);
    expect(screen.getByText(/100m prohibited/)).toBeInTheDocument();
    expect(screen.getByText(/200m regulated radius/)).toBeInTheDocument();
  });

  it('shows the AI-assisted disclaimer', () => {
    renderWithRouter(<DealPlanningContextCard />);
    expect(screen.getByText(/AI-extracted from RMP 2031 land-use maps/i)).toBeInTheDocument();
  });

  it('shows a friendly empty state when no callouts have been ingested yet', () => {
    landUseQuery = { data: SAMPLE_EMPTY, isLoading: false, isError: false };
    renderWithRouter(<DealPlanningContextCard />);
    expect(screen.getByText(/Land-use facts have not been ingested yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open intelligence/i })).toBeInTheDocument();
  });

  it('renders only the available callouts when some are missing', () => {
    landUseQuery = {
      data: {
        callouts: [
          {
            type: 'sdz',
            key: 'special_development_zones',
            value: { count: 3, max_far: 2.75, locations: ['Hosur Road'] },
          },
        ],
      },
      isLoading: false,
      isError: false,
    };
    renderWithRouter(<DealPlanningContextCard />);
    expect(screen.getByText('Special Development Zones')).toBeInTheDocument();
    expect(screen.queryByText('NGT drain buffers')).not.toBeInTheDocument();
    expect(screen.queryByText('Heritage zones')).not.toBeInTheDocument();
    expect(screen.queryByText('Peripheral Ring Road')).not.toBeInTheDocument();
  });

  it('shows a skeleton while loading', () => {
    landUseQuery = { data: undefined, isLoading: true, isError: false };
    renderWithRouter(<DealPlanningContextCard />);
    expect(screen.getByText(/Loading planning context/i)).toBeInTheDocument();
  });

  it('shows an error state when the request fails', () => {
    landUseQuery = { data: undefined, isLoading: false, isError: true };
    renderWithRouter(<DealPlanningContextCard />);
    expect(screen.getByText(/Could not load planning context/i)).toBeInTheDocument();
  });
});
