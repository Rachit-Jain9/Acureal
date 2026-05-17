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
  zone_filter: null,
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
  summary: {
    total: 9913,
    enriched: 2943,
    wards: 199,
    by_zone: { A: 292, B: 257, C: 465, D: 824, E: 879, F: 226, unknown: 6970 },
  },
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
    // "Zone A" appears in BOTH the row badge and the filter chip — assert
    // at least 2 instances rather than asserting uniqueness.
    expect(screen.getAllByText('Zone A').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Zone C').length).toBeGreaterThanOrEqual(2);
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
    streetQuery = {
      data: { query: '', zone_filter: null, rows: [], summary: { total: 0, enriched: 0, wards: 0, by_zone: {} }, disclaimer: '' },
      isLoading: false, isError: false, isFetching: false,
    };
    render(<BengaluruStreetLookupPanel />);
    expect(screen.getByText(/Start typing a street or area name above/i)).toBeInTheDocument();
  });

  it('shows the no-matches hint when a search returns nothing', async () => {
    streetQuery = {
      data: { query: 'xyz123', zone_filter: null, rows: [], summary: { total: 9913, enriched: 2943, wards: 199, by_zone: {} }, disclaimer: '' },
      isLoading: false, isError: false, isFetching: false,
    };
    render(<BengaluruStreetLookupPanel />);
    const input = screen.getByPlaceholderText(/Search by street or area name/i);
    fireEvent.change(input, { target: { value: 'xyz123' } });
    await waitFor(() => {
      expect(screen.getByText(/No streets match the current filter/i)).toBeInTheDocument();
    }, { timeout: 600 });
  });

  it('renders the zone-filter chips with per-zone counts when summary is populated', () => {
    render(<BengaluruStreetLookupPanel />);
    expect(screen.getByRole('button', { name: /All zones/i })).toBeInTheDocument();
    // Zone A has 292 in the summary fixture; the chip should display the count.
    expect(screen.getByRole('button', { name: /Zone A.*\(292\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Zone F.*\(226\)/ })).toBeInTheDocument();
  });

  it('threads the zone filter through to the hook when a chip is clicked', async () => {
    render(<BengaluruStreetLookupPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Zone C/ }));
    await waitFor(() => {
      expect(lastParams.zone).toBe('C');
    }, { timeout: 200 });
  });

  it('shows enriched count + percent in the enrichment tile', () => {
    render(<BengaluruStreetLookupPanel />);
    // 2,943 / 9,913 = 30%
    expect(screen.getByText(/2,943 \(30%\)/)).toBeInTheDocument();
    expect(screen.getByText(/LLM pass extends coverage/i)).toBeInTheDocument();
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

  it('listens for the "bbmp:focus-zone" window event and updates the zone filter', async () => {
    render(<BengaluruStreetLookupPanel />);
    window.dispatchEvent(new CustomEvent('bbmp:focus-zone', { detail: { zone: 'C' } }));
    await waitFor(() => {
      expect(lastParams.zone).toBe('C');
    }, { timeout: 200 });
  });

  it('ignores "bbmp:focus-zone" with an invalid zone code', async () => {
    render(<BengaluruStreetLookupPanel />);
    window.dispatchEvent(new CustomEvent('bbmp:focus-zone', { detail: { zone: 'Z' } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(lastParams.zone).toBeFalsy();
  });

  it('renders the source document name and the AI-assisted disclaimer', () => {
    render(<BengaluruStreetLookupPanel />);
    // "Notification No. 384" appears in both the eyebrow sub and the source
    // chip in the results header — count both instead of asserting unique.
    expect(screen.getAllByText(/Notification No\. 384/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/AI-extracted street index/i)).toBeInTheDocument();
  });
});
