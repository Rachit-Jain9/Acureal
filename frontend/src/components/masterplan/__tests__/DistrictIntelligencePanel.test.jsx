import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

let districtQuery;

vi.mock('../../../hooks/useMasterPlan', () => ({
  useDistrictIntelligence: () => districtQuery,
}));

import DistrictIntelligencePanel from '../DistrictIntelligencePanel';

const SAMPLE = {
  districts: [
    {
      id: 'd1',
      pd_code: 'PD-01',
      pd_name: 'CENTRAL BUSINESS DISTRICT',
      is_sdz: false,
      population_2011: 593883,
      area_ha: 2774.3,
      gross_density_pph: 214,
      ward_count: 19,
      village_count: null,
      source_page: 23,
      source_section: '2.PD 1: CENTRAL BUSINESS DISTRICT',
      raw_notes: 'Population (2011 Census): 5,93,883; Area of PD: 2774.3 ha; Wards in PD: 19; Gross Density: 214PPH',
    },
    {
      id: 'd2',
      pd_code: 'PD-11',
      pd_name: 'DODDA NEKKUNDI - WHITEFIELD',
      is_sdz: false,
      population_2011: 207212,
      area_ha: 4238.4,
      gross_density_pph: 49,
      ward_count: 4,
      village_count: null,
      source_page: 123,
      source_section: '12.PD 11: DODDA NEKKUNDI - WHITEFIELD',
      raw_notes: 'Population: 2,07,212; Area of PD: 42.38 sqkm (4238.4 ha); Wards in PD: 4; Gross Density: 49 pph',
    },
    {
      id: 'd3',
      pd_code: 'PD-23',
      pd_name: 'CHEEMASANDRA SPECIAL DEVELOPMENT ZONE',
      is_sdz: true,
      population_2011: 39377,
      area_ha: 2729.41,
      gross_density_pph: 14.4,
      ward_count: null,
      village_count: 17,
      source_page: 225,
      source_section: '24.PD 23: CHEEMASANDRA SPECIAL DEVELOPMENT ZONE',
      raw_notes: 'Population (2011 Census): 39,377; Area of PD: 2729.41 ha; Villages in PD: 17; Gross Density: 14.4 pph',
    },
  ],
  summary: {
    district_count: 3,
    sdz_count: 1,
    total_population_2011: 593883 + 207212 + 39377,
    total_area_ha: 9742,
    mean_density_pph: 88,
  },
  callouts: {
    sdz: { count: 5, max_far: 3.5, locations: ['Cheemasandra'] },
    heritage: { count: 12, prohibited_radius_m: 100, regulated_radius_m: 200 },
    landmarks: [{ name: 'Bangalore Palace' }, { name: 'Lalbagh' }, { name: 'Cubbon Park' }],
    adjacent_authorities: [{ name: 'Anekal PA' }, { name: 'Magadi PA' }],
    peripheral_ring: { width_m: 100, type: 'PRR', note: '100m corridor on proposed map' },
  },
  disclaimer: 'AI-extracted from RMP 2031 Volume 4 PDR.',
};

describe('DistrictIntelligencePanel', () => {
  beforeEach(() => {
    districtQuery = { data: SAMPLE, isLoading: false, isError: false };
  });

  it('renders the section header and the four summary tiles', () => {
    render(<DistrictIntelligencePanel />);
    expect(screen.getByText(/District Intelligence/i)).toBeInTheDocument();
    expect(screen.getByText('Planning Districts')).toBeInTheDocument();
    expect(screen.getByText('Special Development Zones')).toBeInTheDocument();
    expect(screen.getByText('Total population (2011)')).toBeInTheDocument();
    expect(screen.getByText('Total area')).toBeInTheDocument();
  });

  it('renders one table row per district with a SDZ badge for SDZ rows', () => {
    render(<DistrictIntelligencePanel />);
    expect(screen.getByText('CENTRAL BUSINESS DISTRICT')).toBeInTheDocument();
    expect(screen.getByText('DODDA NEKKUNDI - WHITEFIELD')).toBeInTheDocument();
    expect(screen.getByText('CHEEMASANDRA SPECIAL DEVELOPMENT ZONE')).toBeInTheDocument();
    // Only the SDZ district carries the badge
    expect(screen.getAllByText('SDZ')).toHaveLength(1);
  });

  it('formats Indian-lakh population in compact form', () => {
    render(<DistrictIntelligencePanel />);
    // 593883 / 1e5 = 5.93 Lakh
    expect(screen.getByText('5.94 L')).toBeInTheDocument();
  });

  it('filters by search term across pd_code and pd_name', () => {
    render(<DistrictIntelligencePanel />);
    const search = screen.getByPlaceholderText(/Search by PD code or area name/);
    fireEvent.change(search, { target: { value: 'whitefield' } });
    expect(screen.getByText('DODDA NEKKUNDI - WHITEFIELD')).toBeInTheDocument();
    expect(screen.queryByText('CENTRAL BUSINESS DISTRICT')).not.toBeInTheDocument();
    expect(screen.queryByText('CHEEMASANDRA SPECIAL DEVELOPMENT ZONE')).not.toBeInTheDocument();
  });

  it('expands a district to show source notes when its row is clicked', () => {
    render(<DistrictIntelligencePanel />);
    const row = screen.getByText('CENTRAL BUSINESS DISTRICT').closest('tr');
    fireEvent.click(row);
    expect(screen.getByText('Source notes')).toBeInTheDocument();
    expect(screen.getByText(/Population \(2011 Census\): 5,93,883/)).toBeInTheDocument();
  });

  it('sorts by population descending when the population header is clicked', () => {
    render(<DistrictIntelligencePanel />);
    const popHeader = screen.getByText('Population (2011)').closest('th');
    fireEvent.click(popHeader);
    const rows = screen.getAllByRole('row').slice(1); // skip header
    // Largest population (CBD = 5.94 L) first
    expect(within(rows[0]).getByText(/CENTRAL BUSINESS DISTRICT/)).toBeInTheDocument();
  });

  it('renders landmarks, adjacent authorities, and PRR callouts', () => {
    render(<DistrictIntelligencePanel />);
    expect(screen.getByText(/Major landmarks in BMA/)).toBeInTheDocument();
    expect(screen.getByText(/3 mapped/)).toBeInTheDocument();
    expect(screen.getByText(/Adjacent planning authorities/)).toBeInTheDocument();
    expect(screen.getByText(/2 jurisdictions border BMA/)).toBeInTheDocument();
    expect(screen.getByText(/Peripheral Ring Road/)).toBeInTheDocument();
  });

  it('shows a skeleton while loading', () => {
    districtQuery = { data: undefined, isLoading: true, isError: false };
    render(<DistrictIntelligencePanel />);
    expect(screen.getByText(/Loading district intelligence/i)).toBeInTheDocument();
  });

  it('shows an error state when the request fails', () => {
    districtQuery = { data: undefined, isLoading: false, isError: true };
    render(<DistrictIntelligencePanel />);
    expect(screen.getByText(/Could not load district intelligence/i)).toBeInTheDocument();
  });

  it('shows an empty state when no districts exist', () => {
    districtQuery = { data: { districts: [], summary: {}, callouts: {}, disclaimer: '' }, isLoading: false, isError: false };
    render(<DistrictIntelligencePanel />);
    expect(screen.getByText(/No district facts yet/i)).toBeInTheDocument();
  });
});
