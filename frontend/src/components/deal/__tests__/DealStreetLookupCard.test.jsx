import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let lookupQuery;
let lastParams;

vi.mock('../../../hooks/useMasterPlan', () => ({
  useStreetLookup: (params) => {
    lastParams = params;
    return lookupQuery;
  },
}));

import DealStreetLookupCard from '../DealStreetLookupCard';

const SAMPLE = {
  query: '',
  zone_filter: null,
  rows: [
    {
      id: 'r1',
      street_name_en: 'WHITEFIELD MAIN ROAD, WHITEFIELD',
      ward_no: 84,
      page_number: 297,
      aro_section: 'WHITEFIELD / RESIDENTIAL',
      zone_code: 'B',
      guidance_value_band_min_inr: 5001,
      guidance_value_band_max_inr: 7000,
    },
    {
      id: 'r2',
      street_name_en: 'BOREWELL ROAD, WHITEFIELD',
      ward_no: 84,
      page_number: 298,
      aro_section: 'WHITEFIELD / RESIDENTIAL',
      zone_code: 'C',
      guidance_value_band_min_inr: 3001,
      guidance_value_band_max_inr: 5000,
    },
  ],
  summary: { total: 9913, enriched: 2943, wards: 199, by_zone: {} },
  source_document: 'BBMP Guidance Value Notification No. 384 (09-Mar-2016)',
  disclaimer: 'AI-extracted street index.',
};

const BENGALURU_PROPERTY = {
  id: 'p1',
  name: 'Whitefield Main Road',
  address: 'Whitefield Main Road, Bengaluru, Karnataka',
  city: 'Bengaluru',
};

const renderWithRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('DealStreetLookupCard', () => {
  beforeEach(() => {
    lookupQuery = { data: SAMPLE, isLoading: false, isError: false, isFetching: false };
    lastParams = undefined;
  });

  it('renders the section header and three summary tiles', () => {
    renderWithRouter(<DealStreetLookupCard property={BENGALURU_PROPERTY} />);
    expect(screen.getByText(/Bengaluru street lookup/i)).toBeInTheDocument();
    expect(screen.getByText('Top match zone')).toBeInTheDocument();
    expect(screen.getByText('Top match guidance')).toBeInTheDocument();
    expect(screen.getByText('Index coverage')).toBeInTheDocument();
  });

  it('seeds the search input from the property name', async () => {
    renderWithRouter(<DealStreetLookupCard property={BENGALURU_PROPERTY} />);
    const input = screen.getByPlaceholderText(/Refine the street name/i);
    expect(input).toHaveValue('Whitefield Main Road');
    await waitFor(() => {
      expect(lastParams.search).toBe('Whitefield Main Road');
    }, { timeout: 600 });
  });

  it('falls back to the first comma-segment of the address when name is missing', () => {
    renderWithRouter(<DealStreetLookupCard property={{ id: 'p2', address: 'Brigade Road, Bengaluru', city: 'Bengaluru' }} />);
    const input = screen.getByPlaceholderText(/Refine the street name/i);
    expect(input).toHaveValue('Brigade Road');
  });

  it('hides itself when the property is outside Bengaluru', () => {
    const { container } = renderWithRouter(<DealStreetLookupCard property={{ id: 'p3', name: 'Some Street', city: 'Mumbai' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the top-match zone in the first tile and the guidance band in the second', () => {
    renderWithRouter(<DealStreetLookupCard property={BENGALURU_PROPERTY} />);
    // "Zone B" appears in the first tile AND on the first hit-row badge — count both.
    expect(screen.getAllByText('Zone B').length).toBeGreaterThanOrEqual(2);
    // ₹5,001–7,000 appears in both the tile and the first hit-row band — count both.
    expect(screen.getAllByText(/₹5,001.*7,000/).length).toBeGreaterThanOrEqual(2);
  });

  it('shows index coverage as enriched/total + percent', () => {
    renderWithRouter(<DealStreetLookupCard property={BENGALURU_PROPERTY} />);
    expect(screen.getByText('2,943 / 9,913')).toBeInTheDocument();
    expect(screen.getByText('30% have a zone')).toBeInTheDocument();
  });

  it('renders up to 6 hits and a "more" link to the full lookup when there are more', () => {
    lookupQuery = {
      data: {
        ...SAMPLE,
        rows: Array.from({ length: 9 }, (_, i) => ({
          id: `r${i}`,
          street_name_en: `STREET ${i}`,
          ward_no: 10 + i,
          page_number: 100 + i,
          aro_section: null,
          zone_code: null,
          guidance_value_band_min_inr: null,
          guidance_value_band_max_inr: null,
        })),
      },
      isLoading: false, isError: false, isFetching: false,
    };
    renderWithRouter(<DealStreetLookupCard property={BENGALURU_PROPERTY} />);
    expect(screen.getByText('STREET 0')).toBeInTheDocument();
    expect(screen.getByText('STREET 5')).toBeInTheDocument();
    expect(screen.queryByText('STREET 6')).not.toBeInTheDocument();
    expect(screen.getByText(/\+3 more in full lookup/)).toBeInTheDocument();
  });

  it('shows the "no matches" hint when search returns empty rows', async () => {
    lookupQuery = {
      data: { ...SAMPLE, rows: [], summary: { total: 9913, enriched: 2943, wards: 199, by_zone: {} } },
      isLoading: false, isError: false, isFetching: false,
    };
    renderWithRouter(<DealStreetLookupCard property={BENGALURU_PROPERTY} />);
    const input = screen.getByPlaceholderText(/Refine the street name/i);
    fireEvent.change(input, { target: { value: 'xyz-no-match' } });
    await waitFor(() => {
      expect(screen.getByText(/No BBMP streets matched/)).toBeInTheDocument();
    }, { timeout: 600 });
  });

  it('shows a skeleton while loading and no data is cached', () => {
    lookupQuery = { data: undefined, isLoading: true, isError: false, isFetching: true };
    renderWithRouter(<DealStreetLookupCard property={BENGALURU_PROPERTY} />);
    expect(screen.getByText(/Loading Bengaluru street lookup/i)).toBeInTheDocument();
  });

  it('shows an error state when the lookup fails', () => {
    lookupQuery = { data: undefined, isLoading: false, isError: true, isFetching: false };
    renderWithRouter(<DealStreetLookupCard property={BENGALURU_PROPERTY} />);
    expect(screen.getByText(/Could not load Bengaluru street lookup/i)).toBeInTheDocument();
  });

  it('includes a link to the full lookup on the admin Planning Intelligence tab', () => {
    renderWithRouter(<DealStreetLookupCard property={BENGALURU_PROPERTY} />);
    const link = screen.getByRole('link', { name: /Open full lookup/i });
    expect(link).toHaveAttribute('href', '/admin/master-plan?tab=intelligence');
  });

  it('includes a Verify-on-Kaveri CTA pointing at the IGR portal in a new tab', () => {
    renderWithRouter(<DealStreetLookupCard property={BENGALURU_PROPERTY} />);
    expect(screen.getByText(/For an exact, current guidance value/i)).toBeInTheDocument();
    const kaveri = screen.getByRole('link', { name: /Open Kaveri Online/i });
    expect(kaveri).toHaveAttribute('href', 'https://kaveri.karnataka.gov.in/');
    expect(kaveri).toHaveAttribute('target', '_blank');
    expect(kaveri).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders a disclaimer making the BBMP-vs-IGR distinction explicit', () => {
    renderWithRouter(<DealStreetLookupCard property={BENGALURU_PROPERTY} />);
    expect(screen.getByText(/NOT IGR sale-deed guidance values/i)).toBeInTheDocument();
  });

  describe('Spread vs guidance tile', () => {
    it('renders the spread % + signal when deal price and guidance band are both present', () => {
      // Whitefield Main Road top match: Zone B, ₹5,001–7,000 → mid ₹6,000.5
      // Deal: 11 cr / 2000 sqft = ₹55,000/sqft → spread ≈ +816% → bubble
      renderWithRouter(
        <DealStreetLookupCard
          property={{ ...BENGALURU_PROPERTY, land_area_sqft: 2000 }}
          deal={{ negotiated_price_cr: 11 }}
        />
      );
      expect(screen.getByText(/Spread vs guidance/i)).toBeInTheDocument();
      // +816.6% bubble signal
      expect(screen.getByText(/\+816\.6%/)).toBeInTheDocument();
      expect(screen.getByText(/Bubble risk/i)).toBeInTheDocument();
      // Risk-adjusted entry = 6000.5 * 1.10 = 6601 rounded
      expect(screen.getByText(/Risk-adj entry ₹6,601/)).toBeInTheDocument();
    });

    it('falls back to "Enter deal price to compute" when no price is available', () => {
      renderWithRouter(
        <DealStreetLookupCard
          property={{ ...BENGALURU_PROPERTY, land_area_sqft: 2000 }}
          deal={{}}
        />
      );
      expect(screen.getByText(/Enter deal price to compute/i)).toBeInTheDocument();
    });

    it('falls back to "Top match has no zone yet" when matched row lacks guidance band', () => {
      lookupQuery = {
        data: {
          ...SAMPLE,
          rows: [{
            id: 'r1',
            street_name_en: 'WHITEFIELD MAIN ROAD, WHITEFIELD',
            ward_no: 84, page_number: 297, aro_section: null,
            zone_code: null,
            guidance_value_band_min_inr: null,
            guidance_value_band_max_inr: null,
          }],
        },
        isLoading: false, isError: false, isFetching: false,
      };
      renderWithRouter(
        <DealStreetLookupCard
          property={{ ...BENGALURU_PROPERTY, land_area_sqft: 2000 }}
          deal={{ negotiated_price_cr: 11 }}
        />
      );
      expect(screen.getByText(/Top match has no zone yet/i)).toBeInTheDocument();
    });

    it('uses pricePerSqft directly when supplied on the property', () => {
      renderWithRouter(
        <DealStreetLookupCard
          property={{ ...BENGALURU_PROPERTY, selling_rate_per_sqft: 6500 }}
          deal={{}}
        />
      );
      // Mid = 6000.5; price = 6500; spread ≈ +8.32% → fair
      expect(screen.getByText(/\+8\.3%/)).toBeInTheDocument();
      expect(screen.getByText(/Fair/i)).toBeInTheDocument();
    });
  });
});
