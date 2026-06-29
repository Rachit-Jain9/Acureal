import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// jsdom lacks matchMedia, which useReducedMotion (inside MetricTile) calls.
if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
}

// vi.mock factories are hoisted above module scope, so shared mock state must
// live in vi.hoisted() to be reachable from inside the factories.
const h = vi.hoisted(() => ({
  toast: { success: () => {}, error: () => {} },
  state: {
    dealRecord: { asset_class: 'residential_apartments', property_id: 'p1' },
    propertyData: { id: 'p1', land_area_sqft: 43560, permissible_fsi: 2.5 },
  },
}));

vi.mock('../../../hooks/useDealContext', () => ({
  useDealContext: () => ({ dealId: 'd1' }),
  useDealRecord: () => h.state.dealRecord,
}));
vi.mock('../../../hooks/useProperties', () => ({
  useProperty: () => ({ data: h.state.propertyData, isLoading: false }),
}));
vi.mock('../../common/Toast', () => ({ toast: h.toast }));

import YieldStudioTab from '../YieldStudioTab';

const setTab = vi.fn();

beforeEach(() => {
  setTab.mockReset();
  h.toast.success = vi.fn();
  h.toast.error = vi.fn();
  h.state.dealRecord = { asset_class: 'residential_apartments', property_id: 'p1' };
  h.state.propertyData = { id: 'p1', land_area_sqft: 43560, permissible_fsi: 2.5 };
});

describe('YieldStudioTab', () => {
  it('computes a residential programme from the seeded parcel envelope', () => {
    render(<YieldStudioTab setTab={setTab} />);
    expect(screen.getByText(/Screening yield/)).toBeInTheDocument();
    // "Realized GFA" appears in both a KPI tile and the area schedule.
    expect(screen.getAllByText('Realized GFA').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Units').length).toBeGreaterThan(0);
    expect(screen.getByText('Massing & binding constraint')).toBeInTheDocument();
    expect(screen.getByText(/Binds on FAR/)).toBeInTheDocument();
  });

  it('applies the programme to the financial engine and navigates', () => {
    render(<YieldStudioTab setTab={setTab} />);
    fireEvent.click(screen.getByRole('button', { name: /Apply to Financials/i }));
    expect(h.toast.success).toHaveBeenCalledTimes(1);
    expect(setTab).toHaveBeenCalledWith('financial');
  });

  it('prompts to link a property when none is attached', () => {
    h.state.dealRecord = { asset_class: 'residential_apartments' };
    h.state.propertyData = undefined;
    render(<YieldStudioTab setTab={setTab} />);
    expect(screen.getByText('Link a property first')).toBeInTheDocument();
  });

  it('shows a plotted summary (plots, no FSI input) for plotted development', () => {
    h.state.dealRecord = { asset_class: 'plotted_development', property_id: 'p1' };
    h.state.propertyData = { id: 'p1', land_area_sqft: 43560 * 4 };
    render(<YieldStudioTab setTab={setTab} />);
    // "Plots" appears in both the KPI tile and the plotted summary.
    expect(screen.getAllByText('Plots').length).toBeGreaterThan(0);
    expect(screen.queryByText('Effective FSI')).not.toBeInTheDocument();
  });
});
