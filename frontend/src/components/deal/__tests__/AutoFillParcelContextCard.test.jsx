import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the hook so each test controls the response shape.
const mockHookState = {
  data: null,
  isFetching: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
};
const mockHookFn = vi.fn(() => mockHookState);
vi.mock('../../../hooks/useAutoDeriveParcelContext', () => ({
  default: (...args) => mockHookFn(...args),
}));

import AutoFillParcelContextCard from '../AutoFillParcelContextCard';

const renderCard = (props = {}) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AutoFillParcelContextCard {...props} />
    </QueryClientProvider>,
  );
};

const samplePayload = {
  inputs: { address: '100 Brigade Road' },
  coordinates: {
    lat: 12.97501,
    lng: 77.60501,
    source: 'google',
    confidence: 0.92,
    formatted_address: '100 Brigade Road, Bengaluru, Karnataka 560001, India',
  },
  bbmpJurisdiction: {
    withinBbmp: true,
    ward: { ward_no: 117, source: 'bbmp_street_index_match', confidence: 0.55 },
  },
  bbmpZone: {
    zone_code: 'A',
    zone_name: 'Zone A',
    guidance_value_band_min_inr: 35000,
    guidance_value_band_max_inr: 50000,
    source_street: 'BRIGADE ROAD',
    source_page: 23,
    confidence: 0.55,
  },
  streetIndex: {
    match: { id: 's1', street_name_en: 'BRIGADE ROAD', ward_no: 117, zone_code: 'A', page_number: 23 },
    alternates: [],
    search_token_used: 'Brigade',
  },
  planningDistrict: {
    pd_code: 'PD-01',
    pd_name: 'Central Business District',
    population_2011: 593883,
    area_ha: 2774.3,
    gross_density_pph: 214,
    confidence: 0.6,
    source: 'address-token-fuzz',
  },
  kgis: {
    provider: 'kgis',
    status: 'matched',
    confidence: 0.65,
    hierarchy: { taluk: 'Bangalore South', village: 'Begur', hobli: 'Begur', district: 'Bangalore Urban' },
    survey_numbers: [{ survey_number: '12/3' }],
    geometry_geojson: { type: 'Polygon', coordinates: [] },
  },
  applicableWarnings: [
    { kind: 'Heritage proximity', fact_type: 'heritage', severity: 'high', item_count: 12 },
    { kind: 'SDZ', fact_type: 'sdz', severity: 'medium', item_count: 5 },
  ],
  verifyLinks: [],
  aiDisclaimer: '...',
  derivedAt: '2026-05-17T18:00:00Z',
  elapsedMs: 1234,
};

beforeEach(() => {
  mockHookState.data = null;
  mockHookState.isFetching = false;
  mockHookState.isError = false;
  mockHookState.error = null;
  mockHookState.refetch = vi.fn();
  mockHookFn.mockClear();
});

describe('AutoFillParcelContextCard', () => {
  it('renders the empty hint when no input has been entered', () => {
    renderCard();
    expect(screen.getByText(/Enter an address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Derive parcel context/i })).toBeDisabled();
  });

  it('lets the user toggle between by-address and by-coordinates modes', () => {
    renderCard();
    expect(screen.getByLabelText('Parcel address')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /By coordinates/i }));
    expect(screen.getByLabelText('Latitude')).toBeInTheDocument();
    expect(screen.getByLabelText('Longitude')).toBeInTheDocument();
    expect(screen.queryByLabelText('Parcel address')).not.toBeInTheDocument();
  });

  it('fires the hook with enabled=true after clicking Derive on an address', async () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('Parcel address'), { target: { value: '100 Brigade Road' } });
    fireEvent.click(screen.getByRole('button', { name: /Derive parcel context/i }));
    await waitFor(() => {
      const lastCall = mockHookFn.mock.calls.at(-1)[0];
      expect(lastCall).toMatchObject({ address: '100 Brigade Road', enabled: true });
    });
  });

  it('does not call the hook with enabled=true until Derive is clicked', () => {
    renderCard({ defaultAddress: 'Some Address' });
    const calls = mockHookFn.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c[0]?.enabled === false)).toBe(true);
  });

  it('renders a skeleton while loading', () => {
    mockHookState.isFetching = true;
    mockHookState.data = null;
    renderCard({ defaultAddress: '100 Brigade Road' });
    // The 5-row skeleton produces multiple aria-busy elements (each
    // Skeleton row is its own role=status). At least one must be present.
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('renders an error banner with retry when the hook returns an error', () => {
    mockHookState.isError = true;
    mockHookState.error = { message: 'Network down' };
    renderCard({ defaultAddress: '100 Brigade Road' });
    expect(screen.getByText(/Auto-derive failed: Network down/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('renders all derived fields when payload is present', () => {
    mockHookState.data = samplePayload;
    renderCard({ defaultAddress: '100 Brigade Road' });

    // Summary chips
    expect(screen.getByText(/Within BBMP/i)).toBeInTheDocument();
    expect(screen.getByText(/100 Brigade Road, Bengaluru/i)).toBeInTheDocument();

    // Field rows
    expect(screen.getByTestId('auto-fill-row-coordinates')).toBeInTheDocument();
    expect(screen.getByTestId('auto-fill-row-ward')).toBeInTheDocument();
    expect(screen.getByTestId('auto-fill-row-bbmp_zone')).toBeInTheDocument();
    expect(screen.getByTestId('auto-fill-row-planning_district')).toBeInTheDocument();
    expect(screen.getByTestId('auto-fill-row-kgis_hierarchy')).toBeInTheDocument();
    expect(screen.getByTestId('auto-fill-row-applicable_warnings')).toBeInTheDocument();

    // Specific values surfaced
    expect(screen.getByText(/Ward 117/)).toBeInTheDocument();
    expect(screen.getByText(/Zone A/)).toBeInTheDocument();
    expect(screen.getByText(/PD-01/)).toBeInTheDocument();
    expect(screen.getByText(/Bangalore South \/ Begur/)).toBeInTheDocument();
    expect(screen.getByText(/2 callouts/)).toBeInTheDocument();
  });

  it('toggles a row to skipped, then back to included', () => {
    mockHookState.data = samplePayload;
    renderCard({ defaultAddress: '100 Brigade Road' });

    const wardRow = screen.getByTestId('auto-fill-row-ward');
    const skipBtn = wardRow.querySelector('button[aria-label*="Skip BBMP ward"]');
    expect(skipBtn).toBeInTheDocument();
    fireEvent.click(skipBtn);
    expect(wardRow.querySelector('button[aria-label*="Include BBMP ward"]')).toBeInTheDocument();
    expect(wardRow.className).toMatch(/opacity-50/);
    // Click again to include.
    fireEvent.click(wardRow.querySelector('button[aria-label*="Include BBMP ward"]'));
    expect(wardRow.querySelector('button[aria-label*="Skip BBMP ward"]')).toBeInTheDocument();
  });

  it('calls onApply with only the non-skipped fields', () => {
    const onApply = vi.fn();
    mockHookState.data = samplePayload;
    renderCard({ defaultAddress: '100 Brigade Road', onApply });

    // Skip the ward row.
    const wardRow = screen.getByTestId('auto-fill-row-ward');
    fireEvent.click(wardRow.querySelector('button[aria-label*="Skip BBMP ward"]'));

    fireEvent.click(screen.getByRole('button', { name: /Apply derived context to deal/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const payload = onApply.mock.calls[0][0];
    expect(payload.pickedFields).not.toHaveProperty('ward');
    expect(payload.pickedFields).toHaveProperty('coordinates');
    expect(payload.pickedFields).toHaveProperty('bbmp_zone');
    expect(payload.payload).toBe(samplePayload);
  });

  it('shows the elapsed-ms readout from the payload', () => {
    mockHookState.data = samplePayload;
    renderCard({ defaultAddress: '100 Brigade Road' });
    expect(screen.getByText(/1234/)).toBeInTheDocument();
  });

  it('renders the always-on AI-assisted disclaimer', () => {
    renderCard();
    expect(screen.getByText(/AI-assisted derivation/i)).toBeInTheDocument();
  });

  it('shows the high-severity CoordinatesGateExplainer + switch-to-coords button when geocode is gated', () => {
    mockHookState.data = {
      ...samplePayload,
      coordinatesGate: {
        gated: true,
        reason: 'low_confidence_geocode',
        threshold: 0.7,
        confidence: 0.45,
        provider: 'nominatim',
        message: 'Geocoder returned an approximate match (confidence 45%, nominatim). BBMP street index, ward, zone, and Planning District lookups are skipped — those would chain on inaccurate coordinates and produce misleading values. Switch to "By coordinates" and paste a precise lat/lng (e.g. right-click the parcel pin in Google Maps → copy coordinates) to continue.',
      },
      bbmpJurisdiction: { withinBbmp: false, ward: null, detection_method: 'low_confidence_geocode_blocked' },
      bbmpZone: null,
      streetIndex: { match: null, alternates: [], search_token_used: null, search_summary: null },
      planningDistrict: null,
      kgis: { hierarchy: { taluk: 'Anekal', district: 'Bangalore Urban' }, status: 'matched', confidence: 0.65, survey_numbers: [] },
    };
    renderCard({ defaultAddress: 'Jigani, Bengaluru' });

    const banner = screen.getByTestId('coordinates-gate-explainer');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/Geocode is approximate \(45% confidence, nominatim\)/i);
    expect(banner.textContent).toMatch(/BBMP lookups skipped/i);
    expect(banner.textContent).toMatch(/Anekal, Bangalore Urban/);
    expect(banner.textContent).toMatch(/right-click the parcel pin/i);

    // The lower-severity outside-BBMP explainer must NOT also fire when
    // the gate is active (that would be double-warning noise).
    expect(screen.queryByTestId('outside-bbmp-explainer')).not.toBeInTheDocument();

    // Clicking the switch button should flip mode to coordinates.
    const switchBtn = screen.getByRole('button', { name: /Switch to coordinate input/i });
    fireEvent.click(switchBtn);
    expect(screen.getByLabelText('Latitude')).toBeInTheDocument();
    expect(screen.getByLabelText('Longitude')).toBeInTheDocument();
  });

  it('hides BBMP-specific rows + shows generic OutsideBbmpExplainer when bbox check excluded the parcel', () => {
    // Detection method 'bbmp_bbox_check' means the coords fell outside
    // the BBMP rectangle entirely (no K-GIS taluk available to name).
    mockHookState.data = {
      ...samplePayload,
      bbmpJurisdiction: {
        withinBbmp: false,
        ward: null,
        detection_method: 'bbmp_bbox_check',
        reason: 'Coordinate falls outside the BBMP city-limits bbox.',
        kgis_taluk: null,
      },
      bbmpZone: null,
      planningDistrict: null,
      kgis: { hierarchy: { taluk: 'Anekal', village: 'Attibele', district: 'Bangalore Urban' }, status: 'matched', confidence: 0.65, survey_numbers: [] },
    };
    renderCard({ defaultAddress: 'Attibele Industrial Area' });

    expect(screen.getByTestId('outside-bbmp-explainer')).toBeInTheDocument();
    expect(screen.getByText(/sits outside BBMP city limits/i)).toBeInTheDocument();
    expect(screen.getByText(/Anekal, Bangalore Urban/)).toBeInTheDocument();

    expect(screen.queryByTestId('auto-fill-row-ward')).not.toBeInTheDocument();
    expect(screen.queryByTestId('auto-fill-row-bbmp_zone')).not.toBeInTheDocument();
    expect(screen.queryByTestId('auto-fill-row-planning_district')).not.toBeInTheDocument();

    expect(screen.getByTestId('auto-fill-row-coordinates')).toBeInTheDocument();
    expect(screen.getByTestId('auto-fill-row-kgis_hierarchy')).toBeInTheDocument();
    expect(screen.getByTestId('auto-fill-row-applicable_warnings')).toBeInTheDocument();

    expect(screen.getByText('Outside BBMP')).toBeInTheDocument();
    expect(screen.getByText(/Anekal taluk/i)).toBeInTheDocument();
  });

  it('shows specific taluk-override copy when K-GIS revealed the parcel is in Anekal/Hosakote/etc', () => {
    // Detection method 'kgis_taluk_override' means the bbox passed but
    // K-GIS revealed a non-BBMP taluk. The banner should NAME the taluk
    // up front so the user knows which Planning Authority to verify with.
    mockHookState.data = {
      ...samplePayload,
      bbmpJurisdiction: {
        withinBbmp: false,
        ward: null,
        detection_method: 'kgis_taluk_override',
        reason: 'K-GIS placed this coordinate in Anekal taluk, which is governed by a separate Planning Authority (not BBMP). BBMP street index, ward, and zone lookups are skipped.',
        kgis_taluk: 'Anekal',
      },
      bbmpZone: null,
      planningDistrict: null,
      kgis: { hierarchy: { taluk: 'Anekal', village: 'Jigani', district: 'Bangalore Urban' }, status: 'matched', confidence: 0.65, survey_numbers: [] },
    };
    renderCard({ defaultAddress: 'Thyme Park Apartments Jigani' });

    const banner = screen.getByTestId('outside-bbmp-explainer');
    expect(banner).toBeInTheDocument();
    // Specific taluk-override copy — leads with the taluk name, not the
    // generic "outside city limits" sentence.
    expect(banner.textContent).toMatch(/This parcel is in Anekal taluk — outside BBMP/i);
    expect(banner.textContent).toMatch(/separate Planning Authority/i);
  });

  it('disables Apply when there are no included fields', () => {
    mockHookState.data = samplePayload;
    const onApply = vi.fn();
    renderCard({ defaultAddress: '100 Brigade Road', onApply });

    // Skip every row.
    for (const row of screen.getAllByTestId(/auto-fill-row-/)) {
      const btn = row.querySelector('button[aria-label*="Skip"]');
      if (btn) fireEvent.click(btn);
    }
    const applyBtn = screen.getByRole('button', { name: /Apply derived context to deal/i });
    expect(applyBtn).toBeDisabled();
  });
});
