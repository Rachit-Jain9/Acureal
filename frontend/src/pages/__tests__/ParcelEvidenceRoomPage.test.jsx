import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock only the data hook — everything else (design-system, PageHeader, count-up)
// renders for real so the test exercises the actual page.
let lookupState;
vi.mock('../../hooks/useMasterPlan', () => ({
  useStreetLookup: () => lookupState,
}));

import ParcelEvidenceRoomPage from '../ParcelEvidenceRoomPage';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/dashboard/parcel-evidence']}>
      <ParcelEvidenceRoomPage />
    </MemoryRouter>,
  );

const HIT = {
  id: 'row-1',
  street_name_en: 'KORAMANGALA 80 FEET ROAD',
  zone_code: 'C',
  register: 'residential',
  ward_no: 151,
  page_number: 120,
  aro_section: 'ARO Koramangala',
  guidance_value_band_min_inr: 12000,
  guidance_value_band_max_inr: 18000,
};

beforeEach(() => {
  lookupState = { data: { rows: [], summary: {} }, isLoading: false, isError: false, isFetching: false };
});

describe('ParcelEvidenceRoomPage', () => {
  it('shows the search hero, example chips and an empty prompt before any query', () => {
    renderPage();
    expect(screen.getByText('Parcel Evidence Room')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Koramangala' })).toBeInTheDocument();
    expect(screen.getByText(/Search a street to begin/i)).toBeInTheDocument();
  });

  it('renders the full cited evidence chain for a hit', () => {
    lookupState = {
      data: {
        rows: [HIT],
        summary: { total: 18743, distinct_streets: 12000, wards: 198, enriched: 18000 },
        source_document: 'BBMP Guidance-Value gazette (Notification No. 384, 09-Mar-2016)',
        disclaimer: 'BBMP property-tax zones underpin this index — they are NOT IGR sale-deed guidance values.',
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    };
    renderPage();

    // Evidence chain header + the street resolves (appears in the list + the spine).
    expect(screen.getByText('Evidence chain')).toBeInTheDocument();
    expect(screen.getAllByText(/KORAMANGALA 80 FEET ROAD/i).length).toBeGreaterThan(0);
    // Zone + ward + guidance band + citation.
    expect(screen.getAllByText(/Zone C/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Ward 151/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/12,000/).length).toBeGreaterThan(0);
    expect(screen.getByText(/PDF page 120/i)).toBeInTheDocument();
  });

  it('always stops honestly at the deal-gated FAR node and shows the gazette disclaimer', () => {
    lookupState = {
      data: {
        rows: [HIT],
        summary: { total: 18743, wards: 198, enriched: 18000 },
        source_document: 'BBMP gazette',
        disclaimer: 'BBMP property-tax zones underpin this index — they are NOT IGR sale-deed guidance values.',
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    };
    renderPage();

    // The honest boundary: FAR/buildable is deal-gated, never auto-asserted.
    expect(screen.getByText(/FAR & indicative buildable/i)).toBeInTheDocument();
    expect(screen.getByText(/Start a deal to underwrite this parcel/i)).toBeInTheDocument();
    // Verbatim gazette caveat is always present.
    expect(screen.getByText(/NOT IGR sale-deed guidance values/i)).toBeInTheDocument();
  });

  it('honestly labels a row whose zone is not yet enriched', () => {
    lookupState = {
      data: {
        rows: [{ ...HIT, id: 'row-2', zone_code: null, guidance_value_band_min_inr: null, guidance_value_band_max_inr: null }],
        summary: { total: 18743, wards: 198, enriched: 18000 },
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    };
    renderPage();
    expect(screen.getByText(/Zone not yet enriched/i)).toBeInTheDocument();
    expect(screen.getByText(/Not published for this row/i)).toBeInTheDocument();
  });
});
