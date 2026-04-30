import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let bbmpQuery;

vi.mock('../../../hooks/useMasterPlan', () => ({
  useBbmpUavEntries: () => bbmpQuery,
}));

import MasterPlanBbmpUavPanel from '../MasterPlanBbmpUavPanel';

const SAMPLE_ROWS = [
  {
    id: 'uav-1',
    uav_zone_code: 'A',
    uav_zone_name: 'Central Business District',
    ward_number: '76',
    ward_name: 'Shantala Nagar',
    road_name: 'MG Road',
    area_name: 'Bangalore',
    property_use: 'commercial',
    unit_area_value_inr: 12500,
    unit_label: 'per sqft',
    source_page: 14,
    confidence_score: 0.88,
    review_status: 'pending',
  },
  {
    id: 'uav-2',
    uav_zone_code: 'B',
    uav_zone_name: 'Inner Ring',
    ward_number: '113',
    ward_name: 'Jayanagar',
    road_name: 'Kanakapura Road',
    property_use: 'residential',
    unit_area_value_inr: 6800,
    unit_label: 'per sqft',
    source_page: 18,
    confidence_score: 0.74,
    review_status: 'approved',
  },
];

describe('MasterPlanBbmpUavPanel', () => {
  beforeEach(() => {
    bbmpQuery = {
      data: { schema_ready: true, rows: SAMPLE_ROWS },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  });

  it('renders the BBMP UAV header and stat tiles', () => {
    render(<MasterPlanBbmpUavPanel />);
    expect(screen.getByText(/Unit Area Value \(UAV\) review queue/i)).toBeInTheDocument();
    expect(screen.getByText('Rows in view')).toBeInTheDocument();
    expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Approved').length).toBeGreaterThanOrEqual(1);
  });

  it('renders one row per UAV entry with values formatted in rupees', () => {
    render(<MasterPlanBbmpUavPanel />);
    expect(screen.getByText('MG Road')).toBeInTheDocument();
    expect(screen.getByText('Kanakapura Road')).toBeInTheDocument();
    expect(screen.getByText('₹12,500')).toBeInTheDocument();
    expect(screen.getByText('₹6,800')).toBeInTheDocument();
  });

  it('shows the BBMP separation note', () => {
    render(<MasterPlanBbmpUavPanel />);
    expect(screen.getByText(/Not IGR sale guidance/i)).toBeInTheDocument();
  });

  it('shows skeleton when loading', () => {
    bbmpQuery = {
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: true,
      refetch: vi.fn(),
    };
    render(<MasterPlanBbmpUavPanel />);
    expect(screen.getByText(/Loading BBMP UAV entries/i)).toBeInTheDocument();
  });

  it('shows the schema-not-ready warning when migration has not been applied', () => {
    bbmpQuery = {
      data: {
        schema_ready: false,
        rows: [],
        message: 'BBMP UAV review storage is pending. Apply the source document pages migration before reviewing UAV rows.',
      },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
    render(<MasterPlanBbmpUavPanel />);
    expect(screen.getByText(/BBMP UAV storage not applied yet/i)).toBeInTheDocument();
    expect(screen.getByText(/source document pages migration/i)).toBeInTheDocument();
  });

  it('shows empty state when no rows in current filter', () => {
    bbmpQuery = {
      data: { schema_ready: true, rows: [] },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
    render(<MasterPlanBbmpUavPanel />);
    expect(screen.getByText(/No BBMP UAV entries/i)).toBeInTheDocument();
  });

  it('lets the user switch the status filter', async () => {
    const user = userEvent.setup();
    render(<MasterPlanBbmpUavPanel />);
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText(/status filter: all/i)).toBeInTheDocument();
  });
});
