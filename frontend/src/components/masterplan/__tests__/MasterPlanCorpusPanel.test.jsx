import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let corpusQuery;

vi.mock('../../../hooks/useMasterPlan', () => ({
  useMasterPlanCorpus: () => corpusQuery,
}));

import MasterPlanCorpusPanel from '../MasterPlanCorpusPanel';

const SAMPLE_CORPUS = [
  {
    canonical_name: 'volume-6-zoning-regulations.pdf',
    plan_name: 'RMP 2031 Volume 6 — Zoning Regulations',
    plan_version: 'RMP 2031 Provisional',
    doc_type: 'rmp_table',
    source_role: 'provisional_plan',
    legal_status: 'provisional',
    authority_name: 'Bangalore Development Authority',
    processing_mode: 'text_extraction',
    ocr_required: false,
    source_confidence: 0.85,
    uploaded: true,
    document: { id: 'doc-vol6', extraction_status: 'pending' },
  },
  {
    canonical_name: 'rmp-provisional.pdf',
    plan_name: 'RMP 2031 Provisional Master Plan',
    plan_version: 'RMP 2031 Provisional',
    doc_type: 'rmp_table',
    source_role: 'provisional_plan',
    legal_status: 'provisional',
    authority_name: 'Bangalore Development Authority',
    processing_mode: 'ocr_required',
    ocr_required: true,
    source_confidence: 0.7,
    uploaded: false,
    document: null,
  },
  {
    canonical_name: 'guidance-value.pdf',
    plan_name: 'BBMP Unit Area Value (UAV) — Property Tax Zones',
    plan_version: 'BBMP UAV',
    doc_type: 'bbmp_uav_pdf',
    source_role: 'property_tax_uav',
    legal_status: 'advisory',
    authority_name: 'Bruhat Bengaluru Mahanagara Palike',
    processing_mode: 'ocr_required',
    ocr_required: true,
    source_confidence: 0.8,
    uploaded: false,
    document: null,
  },
];

describe('MasterPlanCorpusPanel', () => {
  beforeEach(() => {
    corpusQuery = {
      data: SAMPLE_CORPUS,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  });

  it('renders the section header and tallies upload status', () => {
    render(<MasterPlanCorpusPanel />);

    expect(screen.getByText(/Bengaluru RMP 2031 — expected sources/)).toBeInTheDocument();
    expect(screen.getByText('Expected')).toBeInTheDocument();
    expect(screen.getByText('Awaiting')).toBeInTheDocument();
    expect(screen.getByText('OCR pending')).toBeInTheDocument();

    expect(screen.getByText('volume-6-zoning-regulations.pdf')).toBeInTheDocument();
    expect(screen.getByText('rmp-provisional.pdf')).toBeInTheDocument();
    expect(screen.getByText('guidance-value.pdf')).toBeInTheDocument();
  });

  it('flags BBMP UAV row as separate from IGR sale guidance', () => {
    render(<MasterPlanCorpusPanel />);
    expect(screen.getByText(/BBMP property tax — separate from IGR sale guidance/i)).toBeInTheDocument();
  });

  it('shows uploaded vs awaiting badges per row', () => {
    render(<MasterPlanCorpusPanel />);
    expect(screen.getAllByText(/Uploaded/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Awaiting upload/i).length).toBeGreaterThanOrEqual(2);
  });

  it('renders OCR-required processing badge for image-only sources', () => {
    render(<MasterPlanCorpusPanel />);
    const ocrBadges = screen.getAllByText(/OCR required/i);
    expect(ocrBadges.length).toBeGreaterThanOrEqual(2);
  });

  it('shows skeleton when loading', () => {
    corpusQuery = {
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: true,
      refetch: vi.fn(),
    };
    render(<MasterPlanCorpusPanel />);
    expect(screen.getByText(/Loading source corpus/i)).toBeInTheDocument();
  });

  it('shows error state when the corpus endpoint fails', () => {
    corpusQuery = {
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
    };
    render(<MasterPlanCorpusPanel />);
    expect(screen.getByText(/Could not load source corpus/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('shows empty state when corpus is configured empty', () => {
    corpusQuery = {
      data: [],
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
    render(<MasterPlanCorpusPanel />);
    expect(screen.getByText(/No corpus configured/i)).toBeInTheDocument();
  });
});
