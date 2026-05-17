import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let streetQuery;
let lastParams;

vi.mock('../../../hooks/useMasterPlan', () => ({
  useStreetLookup: (params) => {
    lastParams = params;
    return streetQuery;
  },
}));

import BengaluruStreetLookupPanel from '../BengaluruStreetLookupPanel';

const SAMPLE = {
  query: '',
  total: 3,
  rows: [
    {
      id: 'r1', street_name_en: 'WHITEFIELD MAIN ROAD, WHITEFIELD',
      ward_no: 84, page_number: 297, aro_section: 'WHITEFIELD / RESIDENTIAL',
      zone_code: null, guidance_value_band_min_inr: null, guidance_value_band_max_inr: null,
      row_excerpt: '...',
    },
    {
      id: 'r2', street_name_en: 'BRIGADE ROAD',
      ward_no: 111, page_number: 227, aro_section: null,
      zone_code: 'A', guidance_value_band_min_inr: 7001, guidance_value_band_max_inr: null,
      row_excerpt: '...',
    },
    {
      id: 'r3', street_name_en: 'KORAMANGALA 4TH BLOCK',
      ward_no: 151, page_number: 127, aro_section: 'KORAMANGALA / RESIDENTIAL',
      zone_code: 'C', guidance_value_band_min_inr: 3501, guidance_value_band_max_inr: 5000,
      row_excerpt: '...',
    },
  ],
  source_document: 'BBMP Guidance Value Notification No. 384 (09-Mar-2016)',
  disclaimer: 'AI-extracted street index — verify the ward and zone classification against the original PDF page before quoting.',
};

describe('BengaluruStreetLookupPanel', () => {
  beforeEach(() => {
    streetQuery = { data: SAMPLE, isLoading: false, isError: false, isFetching: false };
    lastParams = undefined;
  });

  it('renders the section header and the three summary tiles', () => {
    render(<BengaluruStreetLookupPanel />);
    expect(screen.getByText(/Find a street's BBMP zone/i)).toBeInTheDocument();
    expect(screen.getByText('Streets indexed')).toBeInTheDocument();
    expect(screen.getByText('BBMP wards covered')).toBeInTheDocument();
    expect(screen.getByText('With zone enrichment')).toBeInTheDocument();
  });

  it('renders one row per result with street name, ward and page', () => {
    render(<BengaluruStreetLookupPanel />);
    expect(screen.getByText('WHITEFIELD MAIN ROAD, WHITEFIELD')).toBeInTheDocument();
    expect(screen.getByText('BRIGADE ROAD')).toBeInTheDocument();
    expect(screen.getByText('Ward 84')).toBeInTheDocument();
    expect(screen.getByText('PDF p.297')).toBeInTheDocument();
  });

  it('shows a Zone badge when zone enrichment is present on a row', () => {
    render(<BengaluruStreetLookupPanel />);
    expect(screen.getByText('Zone A')).toBeInTheDocument();
    expect(screen.getByText('Zone C')).toBeInTheDocument();
  });

  it('formats the guidance value band when present (min only renders with +, min+max renders as range)', () => {
    render(<BengaluruStreetLookupPanel />);
    // BRIGADE ROAD has only a min → "₹7,001+/sqft"
    expect(screen.getByText(/Guidance value: ₹7,001\+\/sqft/)).toBeInTheDocument();
    // KORAMANGALA 4TH BLOCK has min and max → "₹3,501 – ₹5,000/sqft"
    expect(screen.getByText(/Guidance value: ₹3,501 – ₹5,000\/sqft/)).toBeInTheDocument();
  });

  it('debounces the search input and threads it through to the hook', async () => {
    render(<BengaluruStreetLookupPanel />);
    const input = screen.getByPlaceholderText(/Search by street or area name/i);
    fireEvent.change(input, { target: { value: 'whitefield' } });
    // Initial render uses the empty debounced value; the hook gets the debounced value after the timeout.
    await waitFor(() => {
      expect(lastParams.search).toBe('whitefield');
    }, { timeout: 600 });
  });

  it('shows the empty-search hint card when there are no rows and the search is empty', () => {
    streetQuery = { data: { query: '', total: 0, rows: [], disclaimer: '' }, isLoading: false, isError: false, isFetching: false };
    render(<BengaluruStreetLookupPanel />);
    expect(screen.getByText(/Start typing a street or area name above/i)).toBeInTheDocument();
  });

  it('shows the no-matches hint when a search returns nothing', async () => {
    streetQuery = { data: { query: 'xyz123', total: 0, rows: [], disclaimer: '' }, isLoading: false, isError: false, isFetching: false };
    render(<BengaluruStreetLookupPanel />);
    const input = screen.getByPlaceholderText(/Search by street or area name/i);
    fireEvent.change(input, { target: { value: 'xyz123' } });
    await waitFor(() => {
      expect(screen.getByText(/No streets matched "xyz123"/i)).toBeInTheDocument();
    }, { timeout: 600 });
  });

  it('shows a skeleton while loading', () => {
    streetQuery = { data: undefined, isLoading: true, isError: false, isFetching: false };
    render(<BengaluruStreetLookupPanel />);
    expect(screen.getByText(/Loading Bengaluru street lookup/i)).toBeInTheDocument();
  });

  it('shows an error state when the request fails', () => {
    streetQuery = { data: undefined, isLoading: false, isError: true, isFetching: false };
    render(<BengaluruStreetLookupPanel />);
    expect(screen.getByText(/Could not load street lookup/i)).toBeInTheDocument();
  });

  it('renders the source document name and the AI-assisted disclaimer', () => {
    render(<BengaluruStreetLookupPanel />);
    // "Notification No. 384" appears in both the eyebrow sub and the source
    // chip in the results header — count both instead of asserting unique.
    expect(screen.getAllByText(/Notification No\. 384/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/AI-extracted street index/i)).toBeInTheDocument();
  });
});
