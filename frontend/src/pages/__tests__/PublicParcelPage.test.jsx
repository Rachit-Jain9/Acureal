import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock only the public data hook — the shell, the shared explorer, and the
// conversion CTA all render for real, so this exercises the actual page.
let lookupState;
vi.mock('../../hooks/usePublicParcel', () => ({
  usePublicStreetLookup: () => lookupState,
}));

import PublicParcelPage from '../PublicParcelPage';

const renderPage = (entry = '/parcel') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <PublicParcelPage />
    </MemoryRouter>,
  );

const HIT = {
  id: 'row-1',
  street_name_en: 'WHITEFIELD MAIN ROAD',
  zone_code: 'D',
  register: 'residential',
  ward_no: 84,
  page_number: 233,
  aro_section: 'ARO Whitefield',
  guidance_value_band_min_inr: 3500,
  guidance_value_band_max_inr: 5200,
};

beforeEach(() => {
  lookupState = { data: { rows: [], summary: {} }, isLoading: false, isError: false, isFetching: false };
});

describe('PublicParcelPage', () => {
  it('renders the public shell — masthead actions, hero claim, custody strip, footer', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get started' })).toBeInTheDocument();
    expect(screen.getByText(/cited to the gazette page/i)).toBeInTheDocument();
    expect(screen.getByText(/One gazette, 686 pages/i)).toBeInTheDocument();
    expect(screen.getByText(/Deterministically indexed/i)).toBeInTheDocument();
  });

  it('resolves a street to its cited chain without any auth', () => {
    lookupState = {
      data: {
        rows: [HIT],
        summary: { total: 19830, distinct_streets: 11932, wards: 199, enriched: 19830 },
        source_document: 'BBMP Guidance-Value gazette (Notification No. 384, 09-Mar-2016)',
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    };
    renderPage('/parcel?q=whitefield');
    expect(screen.getAllByText(/WHITEFIELD MAIN ROAD/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Zone D/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/PDF page 233/i)).toBeInTheDocument();
  });

  it('stops at statutory zoning and converts through the zoning-certificate upload', () => {
    lookupState = {
      data: { rows: [HIT], summary: { total: 19830, wards: 199, enriched: 19830 } },
      isLoading: false,
      isError: false,
      isFetching: false,
    };
    renderPage('/parcel?q=whitefield');
    // The honest boundary is stated, and the CTA goes to signup — never an
    // auto-asserted zone.
    expect(screen.getByText(/Statutory zoning, FAR & indicative buildable/i)).toBeInTheDocument();
    expect(screen.getByText(/zoning certificate or sanctioned plan/i)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /create a free workspace/i });
    expect(cta).toHaveAttribute('href', '/login?mode=register');
  });

  it('never claims the legal four — the reference-only note is always present', () => {
    renderPage();
    expect(screen.getByText(/never states title, encumbrance, RERA, or approval status/i)).toBeInTheDocument();
  });
});
