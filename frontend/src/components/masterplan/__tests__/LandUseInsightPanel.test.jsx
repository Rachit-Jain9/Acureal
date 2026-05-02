import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let landUseQuery;

vi.mock('../../../hooks/useMasterPlan', () => ({
  useLandUseIntelligence: () => landUseQuery,
}));

import LandUseInsightPanel from '../LandUseInsightPanel';

const SAMPLE = {
  existing: [
    { key: 'residential', label: 'Residential', value: 17.63, absolute_ha: 21284, year: 2015 },
    { key: 'commercial',  label: 'Commercial',  value:  3.17, absolute_ha:  3828, year: 2015 },
    { key: 'parks_open',  label: 'Parks & Open Spaces', value: 1.70, absolute_ha: 2046, year: 2015 },
    { key: 'transport',   label: 'Transport & Communication', value: 7.29, absolute_ha: 8802, year: 2015 },
  ],
  proposed: [
    { key: 'residential', label: 'Residential', value: 48.04, absolute_ha: 42486.39, year: 2031 },
    { key: 'commercial',  label: 'Commercial',  value:  2.80, absolute_ha:  2477.07, year: 2031 },
    { key: 'parks_open',  label: 'Parks & Open Spaces', value: 4.23, absolute_ha: 3736.49, year: 2031 },
    { key: 'transport',   label: 'Transport & Communication', value: 13.29, absolute_ha: 11753.04, year: 2031 },
  ],
  totals: [
    { key: 'bma_total_area',       label: 'BMA Total Area',  value: { value: 120697, unit: 'Ha' } },
    { key: 'bma_developable_area', label: 'Developable Area', value: { value:  88431.56, unit: 'Ha' } },
  ],
  callouts: [
    { type: 'sdz', key: 'special_development_zones', value: { count: 5, max_far: 3.5, locations: ['Bellary Road','Old Madras Road','Sarjapura Road','Hosur Road','Mysuru Road'] } },
    { type: 'environmental', key: 'ngt_drainage_classification', value: { buffer_m_primary: 50, buffer_m_secondary: 35, buffer_m_tertiary: 25, source: 'NGT order; Volume 6 §6.5.3 p.80' } },
    { type: 'heritage', key: 'heritage_zones', value: { count: 12, prohibited_radius_m: 100, regulated_radius_m: 200 } },
    { type: 'road_network', key: 'peripheral_ring_road', value: { width_m: 100, type: 'PRR', note: '100m corridor visible on the proposed land-use map' } },
  ],
  disclaimer: 'AI-extracted from Volume 4 + Existing Land Use 2015 + Proposed Land Use 2031 maps.',
};

describe('LandUseInsightPanel', () => {
  beforeEach(() => {
    landUseQuery = { data: SAMPLE, isLoading: false, isError: false };
  });

  it('renders the section header and totals', () => {
    render(<LandUseInsightPanel />);
    expect(screen.getByText(/Land Use Intelligence/i)).toBeInTheDocument();
    expect(screen.getByText('BMA total area')).toBeInTheDocument();
    expect(screen.getByText('Developable area (2031)')).toBeInTheDocument();
  });

  it('renders one row per land-use category with baseline, target, and delta', () => {
    render(<LandUseInsightPanel />);
    expect(screen.getByText('Residential')).toBeInTheDocument();
    expect(screen.getByText('Commercial')).toBeInTheDocument();
    expect(screen.getByText('Parks & Open Spaces')).toBeInTheDocument();
    // residential delta = 48.04 - 17.63 = +30.41 pts
    expect(screen.getByText(/\+30\.41 pts/)).toBeInTheDocument();
  });

  it('renders all four callouts (SDZ, NGT, Heritage, PRR)', () => {
    render(<LandUseInsightPanel />);
    expect(screen.getByText(/Special Development Zones/)).toBeInTheDocument();
    expect(screen.getByText(/NGT drain buffers/)).toBeInTheDocument();
    expect(screen.getByText(/Heritage zones/)).toBeInTheDocument();
    expect(screen.getByText(/Peripheral Ring Road/)).toBeInTheDocument();
  });

  it('shows a skeleton while loading', () => {
    landUseQuery = { data: undefined, isLoading: true, isError: false };
    render(<LandUseInsightPanel />);
    expect(screen.getByText(/Loading land-use intelligence/i)).toBeInTheDocument();
  });

  it('shows an error state when the request fails', () => {
    landUseQuery = { data: undefined, isLoading: false, isError: true };
    render(<LandUseInsightPanel />);
    expect(screen.getByText(/Could not load land-use intelligence/i)).toBeInTheDocument();
  });

  it('shows an info empty state when no facts exist', () => {
    landUseQuery = { data: { existing: [], proposed: [], totals: [], callouts: [] }, isLoading: false, isError: false };
    render(<LandUseInsightPanel />);
    expect(screen.getByText(/No land-use facts yet/i)).toBeInTheDocument();
  });
});
