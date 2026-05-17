import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the modal itself so this test is a pure unit test of the card.
// We assert the card opens it (via prop) but don't render the modal body.
vi.mock('../AutoFillFromDocumentsModal', () => ({
  default: ({ open, dealId }) => (open ? <div data-testid="modal-open" data-dealid={dealId}>MODAL</div> : null),
}));

// Default mock state — empty extraction set. Tests that need data
// reassign this object before render.
const mockExtractionState = {
  data: { count: 0, extractions: [], field_map: {} },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('../../../hooks/useDealExtractions', () => ({
  useDealExtractions: () => mockExtractionState,
}));

vi.mock('../../../hooks/useDealContext', () => ({
  useDealRecord: () => ({ id: 'deal-1', name: 'Test Deal', survey_number: '12/A' }),
}));

import AutoFillReadyCard from '../AutoFillReadyCard';

const renderCard = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AutoFillReadyCard dealId="deal-1" />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  // Reset to default empty state; each test that needs data sets explicitly.
  mockExtractionState.data = { count: 0, extractions: [], field_map: {} };
});

describe('AutoFillReadyCard', () => {
  it('renders NOTHING when no extracted fields are mapped (no empty-state noise)', () => {
    mockExtractionState.data = { count: 0, extractions: [], field_map: {} };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when extractionData is undefined (still loading)', () => {
    mockExtractionState.data = undefined;
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the card with field count when ≥1 field is mapped', () => {
    mockExtractionState.data = {
      count: 1,
      extractions: [],
      field_map: {
        survey_number: { value: '12/A', confidence: 0.9, document_name: 'sale-deed.pdf', doc_type: 'sale_deed' },
        consideration_inr: { value: 18000000, confidence: 0.85, document_name: 'sale-deed.pdf', doc_type: 'sale_deed' },
        rera_number: { value: 'PRM/X', confidence: 0.92, document_name: 'rera-cert.pdf', doc_type: 'rera_registration' },
      },
    };
    renderCard();
    expect(screen.getByText(/3 fields ready to auto-fill from documents/i)).toBeInTheDocument();
    expect(screen.getByText(/Review now/i)).toBeInTheDocument();
    expect(screen.getByText(/AI-assisted/i)).toBeInTheDocument();
  });

  it('uses singular form when exactly 1 field', () => {
    mockExtractionState.data = {
      count: 1,
      extractions: [],
      field_map: {
        survey_number: { value: '12/A', confidence: 0.9, document_name: 'sale-deed.pdf', doc_type: 'sale_deed' },
      },
    };
    renderCard();
    expect(screen.getByText(/1 field ready to auto-fill/i)).toBeInTheDocument();
  });

  it('cites distinct source doc types in the subtext (up to 3)', () => {
    mockExtractionState.data = {
      count: 1,
      extractions: [],
      field_map: {
        survey_number:     { value: '12/A',    confidence: 0.9, document_name: 'd1.pdf', doc_type: 'sale_deed' },
        khata_number:      { value: 'K-99',    confidence: 0.8, document_name: 'd2.pdf', doc_type: 'khata_extract' },
        rera_number:       { value: 'PRM/X',   confidence: 0.9, document_name: 'd3.pdf', doc_type: 'rera_registration' },
        consideration_inr: { value: 18000000,  confidence: 0.8, document_name: 'd1.pdf', doc_type: 'sale_deed' }, // dup type
      },
    };
    renderCard();
    // Distinct doc types separated by ·; only the first 3 distinct ones (sale_deed, khata_extract, rera_registration).
    const subtext = screen.getByText(/Extracted from/i);
    expect(subtext.textContent).toMatch(/sale deed/);
    expect(subtext.textContent).toMatch(/khata extract/);
    expect(subtext.textContent).toMatch(/rera registration/);
  });

  it('opens the modal on click', () => {
    mockExtractionState.data = {
      count: 1,
      extractions: [],
      field_map: {
        survey_number: { value: '12/A', confidence: 0.9, document_name: 'sale-deed.pdf', doc_type: 'sale_deed' },
      },
    };
    renderCard();
    expect(screen.queryByTestId('modal-open')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Auto-fill/i }));
    expect(screen.getByTestId('modal-open')).toBeInTheDocument();
    expect(screen.getByTestId('modal-open').dataset.dealid).toBe('deal-1');
  });

  it('falls back to a generic subtext when extractions have no doc_type / document_name', () => {
    mockExtractionState.data = {
      count: 1,
      extractions: [],
      field_map: {
        survey_number: { value: '12/A', confidence: 0.9 }, // no doc info at all
      },
    };
    renderCard();
    expect(screen.getByText(/Review side-by-side with current values/i)).toBeInTheDocument();
  });
});
