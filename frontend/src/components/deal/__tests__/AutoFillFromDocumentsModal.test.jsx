import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the extraction hook BEFORE importing the modal so the import-time
// hook resolution picks up our mock implementation.
const mockExtractionData = {
  count: 2,
  extractions: [],
  field_map: {
    survey_number: {
      value: '45/2A',
      raw_key: 'survey_number',
      confidence: 0.95,
      document_id: 'doc-1',
      document_name: 'sale-deed.pdf',
      doc_type: 'sale_deed',
      extraction_id: 'ext-1',
    },
    consideration_inr: {
      value: 180000000,
      raw_key: 'consideration_inr',
      confidence: 0.88,
      document_id: 'doc-1',
      document_name: 'sale-deed.pdf',
      doc_type: 'sale_deed',
      extraction_id: 'ext-1',
    },
    land_area_sqft: {
      value: 12500,
      raw_key: 'land_area_sqft',
      confidence: 0.55, // medium band — should NOT be auto-checked
      document_id: 'doc-1',
      document_name: 'sale-deed.pdf',
      doc_type: 'sale_deed',
      extraction_id: 'ext-1',
    },
  },
};

vi.mock('../../../hooks/useDealExtractions', () => ({
  useDealExtractions: () => ({ data: mockExtractionData, isLoading: false, isError: false, refetch: vi.fn() }),
}));

const mockApply = vi.fn();
vi.mock('../../../hooks/useApplyExtractions', () => ({
  useApplyExtractions: () => ({
    mutateAsync: mockApply,
    isPending: false,
  }),
}));

import AutoFillFromDocumentsModal from '../AutoFillFromDocumentsModal';

const renderModal = (props = {}) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AutoFillFromDocumentsModal
        dealId="deal-123"
        open={true}
        onClose={vi.fn()}
        dealCurrentValues={{ negotiated_price_cr: null, rera_number: null }}
        propertyCurrentValues={{ survey_number: '99/1', land_area_sqft: null }}
        {...props}
      />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  mockApply.mockReset();
});

describe('AutoFillFromDocumentsModal', () => {
  it('does not render when closed', () => {
    renderModal({ open: false });
    expect(screen.queryByText(/Auto-fill deal from extracted documents/i)).not.toBeInTheDocument();
  });

  it('renders header + mandatory AI-assisted disclosure', () => {
    renderModal();
    expect(screen.getByText(/Auto-fill deal from extracted documents/i)).toBeInTheDocument();
    expect(screen.getByText(/AI-assisted — requires human review/i)).toBeInTheDocument();
  });

  it('renders one row per mapped canonical field from the ontology', () => {
    renderModal();
    // Field labels come from the ontology v1.json
    expect(screen.getByText(/Survey Number/i)).toBeInTheDocument();
    expect(screen.getByText(/Sale Consideration/i)).toBeInTheDocument();
    expect(screen.getByText(/Land Area \(sqft\)/i)).toBeInTheDocument();
  });

  it('auto-checks HIGH-confidence rows on first render; leaves medium/low unchecked', () => {
    renderModal();
    const checkboxes = screen.getAllByRole('checkbox');
    // 3 rows total: survey_number (0.95 high), consideration_inr (0.88 high), land_area_sqft (0.55 medium)
    expect(checkboxes).toHaveLength(3);
    // First two (high) checked; third (medium) unchecked
    const checkedCount = checkboxes.filter((c) => c.checked).length;
    expect(checkedCount).toBe(2);
  });

  it('shows the "Apply N fields" CTA with the auto-selected count', () => {
    renderModal();
    // Two high-confidence rows auto-selected → button should read "Apply 2 fields"
    const applyBtn = screen.getByRole('button', { name: /Apply 2 fields/i });
    expect(applyBtn).toBeInTheDocument();
    expect(applyBtn).not.toBeDisabled();
  });

  it('shows "X of Y selected" counter', () => {
    renderModal();
    expect(screen.getByText(/2 of 3 selected/i)).toBeInTheDocument();
  });

  it('toggles a row on checkbox click', () => {
    renderModal();
    const checkboxes = screen.getAllByRole('checkbox');
    // Click the third (medium) — should now be checked
    fireEvent.click(checkboxes[2]);
    expect(checkboxes[2].checked).toBe(true);
    expect(screen.getByText(/3 of 3 selected/i)).toBeInTheDocument();
  });

  it('clears all selections on Clear button click', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Clear$/i }));
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.every((c) => !c.checked)).toBe(true);
    expect(screen.getByText(/0 of 3 selected/i)).toBeInTheDocument();
  });

  it('shows "overwrites" warning when proposed differs from current', () => {
    renderModal();
    // propertyCurrentValues.survey_number is '99/1', proposed is '45/2A' → overwrites
    expect(screen.getByText(/overwrites/i)).toBeInTheDocument();
  });

  it('routes each canonical field to the correct table.column in the row caption', () => {
    renderModal();
    // Ontology routes survey_number → properties.survey_number
    expect(screen.getByText(/→ properties\.survey_number/)).toBeInTheDocument();
    // consideration_inr → deals.negotiated_price_cr with inr_to_cr transform
    expect(screen.getByText(/→ deals\.negotiated_price_cr/)).toBeInTheDocument();
    expect(screen.getAllByText(/transform: inr_to_cr/).length).toBeGreaterThan(0);
  });

  it('invokes useApplyExtractions.mutateAsync with the approved subset on Apply click', async () => {
    mockApply.mockResolvedValueOnce({ applied: [], skipped: [] });
    renderModal();

    // Click Apply with the default 2 high-confidence selections
    fireEvent.click(screen.getByRole('button', { name: /Apply 2 fields/i }));

    await waitFor(() => {
      expect(mockApply).toHaveBeenCalledTimes(1);
    });
    const [approved] = mockApply.mock.calls[0];
    expect(approved).toHaveLength(2);
    const keys = approved.map((a) => a.canonical_field).sort();
    expect(keys).toEqual(['consideration_inr', 'survey_number']);

    // Each approved item carries the source attribution
    const surveyItem = approved.find((a) => a.canonical_field === 'survey_number');
    expect(surveyItem.value).toBe('45/2A');
    expect(surveyItem.source_extraction_id).toBe('ext-1');
    expect(surveyItem.source_document_id).toBe('doc-1');
    expect(surveyItem.confidence).toBe(0.95);
  });

  it('renders an editable proposed-value input per row, pre-filled with the AI value', () => {
    renderModal();
    expect(screen.getAllByRole('textbox')).toHaveLength(3);
    expect(screen.getByLabelText('Proposed value for Survey Number')).toHaveValue('45/2A');
  });

  it('sends the operator-corrected value on apply and flags the row as edited', async () => {
    mockApply.mockResolvedValueOnce({ applied: [], skipped: [] });
    renderModal();

    const surveyInput = screen.getByLabelText('Proposed value for Survey Number');
    fireEvent.change(surveyInput, { target: { value: '78/9C' } });
    expect(screen.getByText(/·\s*edited/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Apply 2 fields/i }));
    await waitFor(() => expect(mockApply).toHaveBeenCalledTimes(1));

    const [approved] = mockApply.mock.calls[0];
    expect(approved.find((a) => a.canonical_field === 'survey_number').value).toBe('78/9C');
  });

  it('auto-selects an unchecked row once its value is edited', () => {
    renderModal();
    // land_area_sqft is medium-confidence → unchecked by default (2 of 3).
    fireEvent.change(screen.getByLabelText('Proposed value for Land Area (sqft)'), {
      target: { value: '13000' },
    });
    expect(screen.getByText(/3 of 3 selected/i)).toBeInTheDocument();
  });

  it('resets an edited value back to the AI-extracted value', () => {
    renderModal();
    const surveyInput = screen.getByLabelText('Proposed value for Survey Number');
    fireEvent.change(surveyInput, { target: { value: '78/9C' } });
    expect(surveyInput).toHaveValue('78/9C');

    fireEvent.click(
      screen.getByRole('button', { name: 'Reset Survey Number to the AI-extracted value' }),
    );
    expect(surveyInput).toHaveValue('45/2A');
    expect(screen.queryByText(/·\s*edited/i)).not.toBeInTheDocument();
  });

  it('disables Apply when nothing is selected', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Clear$/i }));
    const applyBtn = screen.getByRole('button', { name: /Apply/i });
    expect(applyBtn).toBeDisabled();
  });

  it('calls onClose when Cancel clicked', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders empty state when no candidates match the ontology', () => {
    // Different mock: empty field_map
    const orig = mockExtractionData.field_map;
    mockExtractionData.field_map = {};
    renderModal();
    expect(screen.getByText(/No mapped extractions on this deal/i)).toBeInTheDocument();
    mockExtractionData.field_map = orig;
  });
});
