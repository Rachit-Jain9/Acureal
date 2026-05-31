import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockHookState = { data: null };
const mockHookFn = vi.fn(() => mockHookState);
vi.mock('../../../hooks/useAutoDeriveParcelContext', () => ({
  default: (...args) => mockHookFn(...args),
}));

import DealPlanningSnapshot from '../DealPlanningSnapshot';

const renderSnapshot = (deal) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DealPlanningSnapshot deal={deal} />
    </QueryClientProvider>,
  );
};

const pdPayload = {
  planningDistrict: {
    pd_code: 'PD-04',
    pd_name: 'Rajarajeshwari Nagar',
    population_2011: 412345,
    area_ha: 2870,
    gross_density_pph: 143,
    source: 'address-fuzz',
    confidence: 0.82,
  },
  bbmpZone: { zone_code: 'D', guidance_value_band_min_inr: 4500, guidance_value_band_max_inr: 9800 },
  applicableWarnings: [
    { kind: 'SDZ', fact_type: 'sdz' },
    { kind: 'PRR / road alignment', fact_type: 'road_network' },
  ],
};

beforeEach(() => {
  mockHookState.data = null;
  mockHookFn.mockClear();
});

describe('DealPlanningSnapshot', () => {
  it('renders nothing when the deal has no address and no coords', () => {
    const { container } = renderSnapshot({ city: 'Bengaluru' });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for non-Bengaluru deals even when a PD payload is present', () => {
    mockHookState.data = pdPayload;
    const { container } = renderSnapshot({ city: 'Mumbai', address: 'X' });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the geocode was gated (approximate)', () => {
    mockHookState.data = { ...pdPayload, coordinatesGate: { gated: true, confidence: 0.3 } };
    const { container } = renderSnapshot({ city: 'Bengaluru', address: '100 Brigade Road' });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no Planning District resolved (e.g. outside BBMP)', () => {
    mockHookState.data = { applicableWarnings: [] };
    const { container } = renderSnapshot({ city: 'Bengaluru', address: '100 Brigade Road' });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the district + census demographics when a PD resolves', () => {
    mockHookState.data = pdPayload;
    renderSnapshot({ city: 'Bengaluru', address: '100 Brigade Road' });
    expect(screen.getByTestId('deal-planning-snapshot')).toBeInTheDocument();
    expect(screen.getByText(/PD-04.*Rajarajeshwari Nagar/)).toBeInTheDocument();
    expect(screen.getByText('4,12,345')).toBeInTheDocument(); // en-IN grouped population
    expect(screen.getByText('143 PPH')).toBeInTheDocument();
    expect(screen.getByText('Zone D')).toBeInTheDocument();
  });

  it('shows the guidance band and the overlay count', () => {
    mockHookState.data = pdPayload;
    renderSnapshot({ city: 'Bengaluru', address: '100 Brigade Road' });
    expect(screen.getByText(/4,500.*9,800\/sqft/)).toBeInTheDocument();
    expect(screen.getByText(/2 city-level overlays to verify/)).toBeInTheDocument();
  });

  it('fires the hook only for Bengaluru deals with input', () => {
    renderSnapshot({ city: 'Bengaluru', address: '100 Brigade Road' });
    const lastCall = mockHookFn.mock.calls.at(-1)[0];
    expect(lastCall.enabled).toBe(true);
    expect(lastCall.address).toBe('100 Brigade Road');
  });

  it('does NOT fire the hook for non-Bengaluru deals', () => {
    renderSnapshot({ city: 'Mumbai', address: 'X' });
    expect(mockHookFn.mock.calls.at(-1)[0].enabled).toBe(false);
  });
});
