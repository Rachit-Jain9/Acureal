import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

let sourceQuery;

vi.mock('../../../hooks/useMasterPlan', () => ({
  useSourceExplorer: () => sourceQuery,
}));

import SourceExplorerPanel from '../SourceExplorerPanel';

const SAMPLE = {
  sources: [
    {
      id: 'src-vol6',
      document_id: 'doc-vol6',
      source_kind: 'official_pdf',
      source_title: 'RMP 2031 Volume 6 — Zoning Regulations',
      plan_version: 'RMP 2031 (Draft)',
      file_name: 'Volume-6 Zoning Regulations.pdf',
      legal_status: 'gazetted',
      processing_mode: 'text_extraction',
      fact_count: 3,
      page_count: 3,
      fact_types: ['rmp_table', 'sdz'],
      first_page: 38,
      last_page: 80,
      facts: [
        {
          id: 'f1', source_id: 'src-vol6', fact_type: 'rmp_table', fact_key: 'front_setback_table',
          fact_value: { tiers: 10 }, page_number: 38, source_section: 'Table 1', confidence_score: 0.95,
        },
        {
          id: 'f2', source_id: 'src-vol6', fact_type: 'rmp_table', fact_key: 'height_setback_table',
          fact_value: { tiers: 16 }, page_number: 39, source_section: 'Table 2', confidence_score: 0.95,
        },
        {
          id: 'f3', source_id: 'src-vol6', fact_type: 'sdz', fact_key: 'special_development_zones',
          fact_value: { count: 5 }, page_number: 80, source_section: '§6.5', confidence_score: 0.88,
        },
      ],
    },
    {
      id: 'src-pdr',
      document_id: null,
      source_kind: 'official_pdf',
      source_title: 'RMP 2031 Volume 4 — Planning District Reports',
      plan_version: 'RMP 2031 Provisional',
      file_name: null,
      legal_status: null,
      processing_mode: null,
      fact_count: 1,
      page_count: 1,
      fact_types: ['rmp_table'],
      first_page: 23,
      last_page: 23,
      facts: [
        {
          id: 'f4', source_id: 'src-pdr', fact_type: 'rmp_table', fact_key: 'planning_districts',
          fact_value: [{ pd_code: 'PD-01', pd_name: 'CBD' }], page_number: 23, source_section: 'PDR §2', confidence_score: 0.85,
        },
      ],
    },
  ],
  summary: {
    source_count: 2,
    fact_count: 4,
    linked_doc_count: 1,
    fact_type_counts: { rmp_table: 3, sdz: 1 },
  },
  disclaimer: 'Each fact below traces back to a specific source-document page.',
};

describe('SourceExplorerPanel', () => {
  beforeEach(() => {
    sourceQuery = { data: SAMPLE, isLoading: false, isError: false };
  });

  it('renders the section header and four summary tiles', () => {
    render(<SourceExplorerPanel />);
    expect(screen.getByText(/Source Explorer/i)).toBeInTheDocument();
    expect(screen.getByText('Sources with facts')).toBeInTheDocument();
    expect(screen.getByText('Extracted facts')).toBeInTheDocument();
    expect(screen.getByText('Linked documents')).toBeInTheDocument();
    expect(screen.getByText('Fact types')).toBeInTheDocument();
  });

  it('lists every source in the left rail with its fact count', () => {
    render(<SourceExplorerPanel />);
    const list = screen.getByRole('listbox', { name: /Source list/i });
    // Scope queries to the left rail to avoid colliding with the right-pane h3.
    expect(within(list).getByText('RMP 2031 Volume 6 — Zoning Regulations')).toBeInTheDocument();
    expect(within(list).getByText('RMP 2031 Volume 4 — Planning District Reports')).toBeInTheDocument();
  });

  it('auto-selects the first source and renders its facts grouped by page', () => {
    render(<SourceExplorerPanel />);
    // Volume 6 is auto-selected; pages 38, 39, 80 each get a header.
    expect(screen.getByText(/Page 38/i)).toBeInTheDocument();
    expect(screen.getByText(/Page 39/i)).toBeInTheDocument();
    expect(screen.getByText(/Page 80/i)).toBeInTheDocument();
    expect(screen.getByText('front_setback_table')).toBeInTheDocument();
    expect(screen.getByText('height_setback_table')).toBeInTheDocument();
    expect(screen.getByText('special_development_zones')).toBeInTheDocument();
  });

  it('switches the right pane when the user clicks a different source', () => {
    render(<SourceExplorerPanel />);
    const pdrButton = screen.getByText('RMP 2031 Volume 4 — Planning District Reports');
    fireEvent.click(pdrButton);
    // Volume 4 has only PD page 23
    expect(screen.getByText(/Page 23/i)).toBeInTheDocument();
    expect(screen.getByText('planning_districts')).toBeInTheDocument();
    // Volume 6 facts should no longer appear
    expect(screen.queryByText('front_setback_table')).not.toBeInTheDocument();
  });

  it('filters the source list by search term', () => {
    render(<SourceExplorerPanel />);
    const search = screen.getByPlaceholderText(/Search sources/i);
    fireEvent.change(search, { target: { value: 'Volume 4' } });
    // Volume 4 matches; Volume 6 drops out of the rail.
    const list = screen.getByRole('listbox', { name: /Source list/i });
    expect(within(list).queryByText('RMP 2031 Volume 6 — Zoning Regulations')).not.toBeInTheDocument();
    expect(within(list).getByText('RMP 2031 Volume 4 — Planning District Reports')).toBeInTheDocument();
  });

  it('shows a hint that a linked PDF exists when document_id is present', () => {
    render(<SourceExplorerPanel />);
    expect(screen.getByText(/linked PDF in Source Documents/i)).toBeInTheDocument();
  });

  it('does not show the linked-PDF hint for sources without a document_id', () => {
    render(<SourceExplorerPanel />);
    fireEvent.click(screen.getByText('RMP 2031 Volume 4 — Planning District Reports'));
    expect(screen.queryByText(/linked PDF in Source Documents/i)).not.toBeInTheDocument();
  });

  it('shows a skeleton while loading', () => {
    sourceQuery = { data: undefined, isLoading: true, isError: false };
    render(<SourceExplorerPanel />);
    expect(screen.getByText(/Loading source explorer/i)).toBeInTheDocument();
  });

  it('shows an error state when the request fails', () => {
    sourceQuery = { data: undefined, isLoading: false, isError: true };
    render(<SourceExplorerPanel />);
    expect(screen.getByText(/Could not load source explorer/i)).toBeInTheDocument();
  });

  it('shows an empty state when no facts have been extracted', () => {
    sourceQuery = { data: { sources: [], summary: {}, disclaimer: '' }, isLoading: false, isError: false };
    render(<SourceExplorerPanel />);
    expect(screen.getByText(/No facts have been extracted yet/i)).toBeInTheDocument();
  });

  it('renders the AI-assisted disclaimer', () => {
    render(<SourceExplorerPanel />);
    expect(screen.getByText(/traces back to a specific source-document page/i)).toBeInTheDocument();
  });
});
