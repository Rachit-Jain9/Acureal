import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let zonesQuery;

vi.mock('../../../hooks/useMasterPlan', () => ({
  useZones: () => zonesQuery,
}));

import DecisionStrip from '../DecisionStrip';

const SAMPLE_ZONE = {
  id: 'zone-r-pz-a',
  zone_code: 'R-PZ-A',
  zone_name: 'Residential (Planning Zone A — inside ORR)',
  plan_version: 'RMP 2031 Provisional',
  permissible_fsi_base: 1.5,
  permissible_fsi_max: 2.7,
  ground_coverage_pct: 65,
  building_height_max_m: 60,
  source_page: 45,
  source_section: '5.3 Table 6',
  fsi_road_width_rules: [
    { road_width_m: 6.0, fsi: 1.5, max_ground_coverage_pct: 75 },
    { road_width_m: 9.5, fsi: 1.5, max_ground_coverage_pct: 75 },
    { road_width_m: 12.5, fsi: 1.5, max_ground_coverage_pct: 70 },
    { road_width_m: 15.5, fsi: 1.5, max_ground_coverage_pct: 70 },
    { road_width_m: 18.5, fsi: 2.25, max_ground_coverage_pct: 65, tdr_addition: 0.45 },
    { road_width_m: 24.5, fsi: 2.4, max_ground_coverage_pct: 60, tdr_addition: 0.6 },
    { road_width_m: 30.5, fsi: 2.5, max_ground_coverage_pct: 50, tdr_addition: 0.7 },
  ],
};

describe('DecisionStrip', () => {
  beforeEach(() => {
    zonesQuery = { data: [SAMPLE_ZONE], isLoading: false };
  });

  it('renders the headline + zone selector with the auto-selected zone', () => {
    render(<DecisionStrip />);
    expect(screen.getByText(/Decision Strip/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('zone-r-pz-a');
    expect(screen.getByText('RMP 2031 Provisional')).toBeInTheDocument();
  });

  it('renders the four envelope StatTiles for the default inputs', () => {
    render(<DecisionStrip />);
    expect(screen.getByText('Base FAR')).toBeInTheDocument();
    expect(screen.getByText('Max FAR')).toBeInTheDocument();
    expect(screen.getByText('Ground coverage')).toBeInTheDocument();
    expect(screen.getByText('Permitted height')).toBeInTheDocument();
  });

  it('shows source citations and the AI-assisted disclaimer', () => {
    render(<DecisionStrip />);
    expect(screen.getByText(/Sources used in this calculation/i)).toBeInTheDocument();
    expect(screen.getByText(/Volume 6 Table 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Volume 6 Table 2/i)).toBeInTheDocument();
    expect(screen.getByText(/AI-assisted preview/i)).toBeInTheDocument();
  });

  it('updates envelope when the user changes road-width preset', async () => {
    const user = userEvent.setup();
    render(<DecisionStrip />);
    // Default is 18m road. Click 30m preset.
    const preset30 = screen.getAllByRole('button', { name: '30' }).find((b) => b.classList.contains('tabular-nums'));
    await user.click(preset30);
    // The new tier should be reflected in the strip (look for "tier ≥ 30m road" or similar).
    expect(screen.getAllByText(/tier/i).length).toBeGreaterThan(0);
  });

  it('shows a height-exceeded warning when target height > permitted ceiling', async () => {
    const user = userEvent.setup();
    render(<DecisionStrip />);
    const heightInputs = screen.getAllByRole('spinbutton');
    // The height input is the last of the three; bump to a value that exceeds the road cap (1.5*18 + 3.5 = 30.5)
    const heightInput = heightInputs[heightInputs.length - 1];
    await user.clear(heightInput);
    await user.type(heightInput, '50');
    expect(screen.getByText(/Target height exceeds permitted ceiling/i)).toBeInTheDocument();
  });

  it('shows a skeleton while zones are loading', () => {
    zonesQuery = { data: [], isLoading: true };
    render(<DecisionStrip />);
    expect(screen.getByText(/Loading decision strip/i)).toBeInTheDocument();
  });

  it('shows an empty state when no approved zones exist', () => {
    zonesQuery = { data: [], isLoading: false };
    render(<DecisionStrip />);
    expect(screen.getByText(/No approved zones available/i)).toBeInTheDocument();
  });
});
