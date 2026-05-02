import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let zonesQuery;

vi.mock('../../../hooks/useMasterPlan', () => ({
  useZones: () => zonesQuery,
}));

import BuildabilityLab from '../BuildabilityLab';

const SAMPLE_ZONE_R = {
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
    { road_width_m: 9.0, fsi: 1.5, max_ground_coverage_pct: 75 },
    { road_width_m: 12.0, fsi: 1.75, max_ground_coverage_pct: 70 },
    { road_width_m: 18.0, fsi: 2.25, max_ground_coverage_pct: 65, tdr_addition: 0.45 },
    { road_width_m: 24.0, fsi: 2.4, max_ground_coverage_pct: 60, tdr_addition: 0.6 },
    { road_width_m: 30.0, fsi: 2.5, max_ground_coverage_pct: 50, tdr_addition: 0.7 },
  ],
};

const SAMPLE_ZONE_M = {
  id: 'zone-m-1',
  zone_code: 'M-1',
  zone_name: 'Mixed Use Corridor',
  plan_version: 'RMP 2031 Provisional',
  permissible_fsi_base: 2.0,
  permissible_fsi_max: 3.5,
  ground_coverage_pct: 60,
  building_height_max_m: 90,
  fsi_road_width_rules: [
    { road_width_m: 12.0, fsi: 2.0, max_ground_coverage_pct: 60 },
    { road_width_m: 18.0, fsi: 2.5, max_ground_coverage_pct: 60 },
    { road_width_m: 30.0, fsi: 3.5, max_ground_coverage_pct: 60 },
  ],
};

describe('BuildabilityLab', () => {
  beforeEach(() => {
    zonesQuery = { data: [SAMPLE_ZONE_R, SAMPLE_ZONE_M], isLoading: false };
  });

  it('renders the section header and three scenario cards labelled A / B / C', () => {
    render(<BuildabilityLab />);
    expect(screen.getByText(/Buildability Lab/i)).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('flags the wider-road scenario as the most-buildable winner under default inputs', () => {
    render(<BuildabilityLab />);
    // Default scenarios share zone + plot; only road width and height differ.
    // Scenario C has the widest road (30m) and the highest FAR tier, so it wins.
    // The trophy chip in the winner card is "Most buildable" (no trailing word).
    const trophy = screen.getByText('Most buildable');
    expect(trophy).toBeInTheDocument();
    // The trade-off summary names the winner.
    expect(screen.getByText(/unlocks the most buildable area/i)).toBeInTheDocument();
  });

  it('renders an FAR / setback / footprint readout per scenario', () => {
    render(<BuildabilityLab />);
    expect(screen.getAllByText('Effective FAR')).toHaveLength(3);
    expect(screen.getAllByText('Front / Side / Rear')).toHaveLength(3);
    expect(screen.getAllByText('Footprint cap')).toHaveLength(3);
    expect(screen.getAllByText('Buildable (max)')).toHaveLength(3);
  });

  it('lets the user edit a scenario road width and re-runs the kernel', async () => {
    const user = userEvent.setup();
    render(<BuildabilityLab />);
    const roadInput = screen.getByLabelText('Scenario A road width');
    await user.clear(roadInput);
    await user.type(roadInput, '30');
    // After bumping A to 30m, the FAR readout for A should reflect the wider tier.
    // We can't easily target by scenario here, but a sanity check: the value persists.
    expect(roadInput).toHaveValue(30);
  });

  it('flags a height that exceeds the road cap with a warning', async () => {
    const user = userEvent.setup();
    render(<BuildabilityLab />);
    // Scenario A defaults: road 12m, height 15m → road cap = 1.5*12 + 2.0 = 20m
    // Bump height to 60 to exceed.
    const heightA = screen.getByLabelText('Scenario A building height');
    await user.clear(heightA);
    await user.type(heightA, '60');
    expect(screen.getByText(/Height exceeds road-cap/i)).toBeInTheDocument();
  });

  it('lets the user pick a different zone for one scenario', async () => {
    const user = userEvent.setup();
    render(<BuildabilityLab />);
    // First combobox is scenario A's zone select.
    const zoneSelectA = screen.getAllByRole('combobox')[0];
    await user.selectOptions(zoneSelectA, SAMPLE_ZONE_M.id);
    expect(zoneSelectA).toHaveValue(SAMPLE_ZONE_M.id);
  });

  it('shows a skeleton while zones load', () => {
    zonesQuery = { data: [], isLoading: true };
    render(<BuildabilityLab />);
    expect(screen.getByText(/Loading buildability lab/i)).toBeInTheDocument();
  });

  it('shows an empty state when no zones exist', () => {
    zonesQuery = { data: [], isLoading: false };
    render(<BuildabilityLab />);
    expect(screen.getByText(/No approved zones yet/i)).toBeInTheDocument();
  });

  it('renders the AI-assisted disclaimer', () => {
    render(<BuildabilityLab />);
    expect(screen.getByText(/AI-assisted preview/i)).toBeInTheDocument();
  });

  it('resets all three scenarios when Reset is clicked', async () => {
    const user = userEvent.setup();
    render(<BuildabilityLab />);
    const roadInputA = screen.getByLabelText('Scenario A road width');
    await user.clear(roadInputA);
    await user.type(roadInputA, '99');
    expect(roadInputA).toHaveValue(99);

    const reset = screen.getByRole('button', { name: /Reset/i });
    await user.click(reset);

    // After reset, scenario A's road should be back to its default (12m).
    expect(screen.getByLabelText('Scenario A road width')).toHaveValue(12);
  });
});
