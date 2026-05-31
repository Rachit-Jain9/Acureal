import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let landUseQuery;

vi.mock('../../../hooks/useMasterPlan', () => ({
  useLandUseIntelligence: () => landUseQuery,
}));

import DealPlanningContextCard from '../DealPlanningContextCard';

// These are the EXACT shapes the live evidence_facts rows carry (verified
// against the Supabase regulatory_data.evidence_facts table on 2026-05-31).
// SDZ + heritage are ARRAYS of objects; NGT + PRR are flat OBJECTS whose keys
// are `*_buffer_m` / `alignment` / `status`. The PREVIOUS version of this test
// asserted a synthetic `{count, max_far, buffer_m_primary, width_m}` schema
// that was never actually seeded — so it passed green while the card rendered
// an empty "not ingested yet" state in production. This version locks the
// real shapes so that can never happen again.
const REAL_CALLOUTS = [
  {
    type: 'sdz',
    key: 'special_development_zones',
    value: [
      { name: 'SDZ Bellary Road', corridor_axis: 'Bellary Road', source_page: 88 },
      { name: 'SDZ Old Madras Road', corridor_axis: 'Old Madras Road', source_page: 88 },
      { name: 'SDZ Sarjapur Road', corridor_axis: 'Sarjapur Road', source_page: 88 },
      { name: 'SDZ Hosur Road', corridor_axis: 'Hosur Road', source_page: 88 },
      { name: 'SDZ Mysuru Road', corridor_axis: 'Mysuru Road', source_page: 88 },
    ],
  },
  {
    type: 'environmental',
    key: 'ngt_drainage_classification',
    value: {
      lake_buffer_m: 75,
      primary_buffer_m: 50,
      secondary_buffer_m: 35,
      tertiary_buffer_m: 25,
      notes: 'NGT order — no construction zones.',
    },
  },
  {
    type: 'heritage',
    key: 'heritage_zones',
    value: Array.from({ length: 12 }, (_, i) => ({
      name: `${['Central Administrative', 'Petta and Bangalore Fort', 'Gavipuram', 'M.G.Road', 'Shivajinagar', 'Cleveland Town', 'Richards Town', 'Malleshwaram', 'Ulsoor', 'Whitefield Inner Circle', 'Begur Temple', 'Bangalore Palace'][i]} Heritage Zone`,
      location: 'Bengaluru',
    })),
  },
  {
    type: 'road_network',
    key: 'peripheral_ring_road',
    value: {
      alignment: 'northern leg PRR, part of a structured road network',
      status: 'Proposed/Under implementation, expected by 2031.',
    },
  },
];

const renderWithRouter = () => render(
  <MemoryRouter>
    <DealPlanningContextCard />
  </MemoryRouter>,
);

describe('DealPlanningContextCard', () => {
  beforeEach(() => {
    landUseQuery = { data: { callouts: REAL_CALLOUTS }, isLoading: false, isError: false };
  });

  it('renders SDZ, NGT, heritage, and PRR tiles from the real evidence_facts shapes', () => {
    renderWithRouter();
    expect(screen.getByText('5 corridors')).toBeInTheDocument();
    expect(screen.getByText('12 zones')).toBeInTheDocument();
    // NGT buffers read from *_buffer_m keys (the bug read buffer_m_*).
    expect(screen.getByText(/Lake 75m · P 50m · S 35m · T 25m/)).toBeInTheDocument();
    // SDZ corridor names come from corridor_axis on each array element.
    expect(screen.getByText(/Bellary Road/)).toBeInTheDocument();
  });

  it('surfaces the RMP 2031 draft / not-notified caveat', () => {
    renderWithRouter();
    expect(screen.getByText(/never legally notified/i)).toBeInTheDocument();
  });

  it('does NOT show the hollow "not ingested yet" state when callouts are present', () => {
    renderWithRouter();
    expect(screen.queryByText(/have not been ingested yet/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open intelligence/i })).toBeInTheDocument();
  });

  it('renders the empty state only when no callout carries real fields — and still shows the caveat', () => {
    landUseQuery = {
      data: { callouts: [{ type: 'sdz', key: 'special_development_zones', value: [] }] },
      isLoading: false,
      isError: false,
    };
    renderWithRouter();
    expect(screen.getByText(/have not been ingested yet/i)).toBeInTheDocument();
    expect(screen.getByText(/never legally notified/i)).toBeInTheDocument();
  });

  it('never interpolates "undefined" when callout objects are hollow', () => {
    landUseQuery = {
      data: {
        callouts: [
          { key: 'special_development_zones', value: [] },
          { key: 'ngt_drainage_classification', value: {} },
          { key: 'heritage_zones', value: [] },
          { key: 'peripheral_ring_road', value: {} },
        ],
      },
      isLoading: false,
      isError: false,
    };
    const { container } = renderWithRouter();
    expect(container.textContent).not.toMatch(/undefined/i);
  });

  it('shows a skeleton while loading', () => {
    landUseQuery = { data: undefined, isLoading: true, isError: false };
    renderWithRouter();
    expect(screen.getByText(/Loading planning context/i)).toBeInTheDocument();
  });

  it('shows an error state when the request fails', () => {
    landUseQuery = { data: undefined, isLoading: false, isError: true };
    renderWithRouter();
    expect(screen.getByText(/Could not load planning context/i)).toBeInTheDocument();
  });
});
