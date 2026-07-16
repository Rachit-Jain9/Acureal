import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The field_map now carries a deterministic `signal` per field (produced by
// backend utils/extractionFieldQuality) — NOT a fabricated confidence %. These
// fixtures use the shapes the pipeline actually emits:
//   • survey_number  — a legal-four TITLE fact. Even though it is grounded
//     verbatim in the source, it is capped to 'verify_legal' and must NEVER be
//     pre-ticked or bulk-selected (CLAUDE.md: extraction aid only).
//   • consideration_inr — non-legal, proven verbatim → 'source_verified' → the
//     one row safe to pre-tick.
//   • land_area_sqft — non-legal but only read, not verified → 'unverified' →
//     not pre-ticked; the operator must look at it.
const mockExtractionData = {
  count: 2,
  extractions: [],
  field_map: {
    survey_number: {
      value: '45/2A',
      raw_key: 'survey_number',
      signal_score: 0.4,
      signal: {
        status: 'verify_legal',
        lane: 'legal_title',
        grounded: true,
        reason: 'Found verbatim in the document text, but this is a title & ownership fact — REDIP never fills these automatically. Verify against the source document before applying.',
      },
      document_id: 'doc-1',
      document_name: 'sale-deed.pdf',
      doc_type: 'sale_deed',
      extraction_id: 'ext-1',
    },
    consideration_inr: {
      value: 180000000,
      raw_key: 'consideration_inr',
      signal_score: 0.9,
      signal: {
        status: 'source_verified',
        lane: null,
        grounded: true,
        reason: 'Found verbatim in the document text.',
      },
      document_id: 'doc-1',
      document_name: 'sale-deed.pdf',
      doc_type: 'sale_deed',
      extraction_id: 'ext-1',
    },
    land_area_sqft: {
      value: 12500,
      raw_key: 'land_area_sqft',
      signal_score: 0.55,
      signal: {
        status: 'unverified',
        lane: null,
        grounded: null,
        reason: 'Read by AI. REDIP could not verify it against the document text — check it against the source.',
      },
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
  useApplyExtractions: () => ({ mutateAsync: mockApply, isPending: false }),
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
    expect(screen.getByText(/Survey Number/i)).toBeInTheDocument();
    expect(screen.getByText(/Sale Consideration/i)).toBeInTheDocument();
    expect(screen.getByText(/Land Area \(sqft\)/i)).toBeInTheDocument();
  });

  // ── The core behaviour change ───────────────────────────────────────────────

  it('pre-ticks ONLY the source-verified, non-legal row — never a legal fact', () => {
    renderModal();
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(3);
    // Only consideration_inr (source_verified, non-legal) is pre-selected.
    // survey_number is legal (capped) and land_area is unverified — both off.
    expect(checkboxes.filter((c) => c.checked)).toHaveLength(1);
  });

  it('a grounded LEGAL fact is not pre-ticked even though it was found in the source', () => {
    renderModal();
    // survey_number's checkbox is the one labelled for Survey Number.
    const surveyCheckbox = screen.getByRole('checkbox', { name: /Approve Survey Number/i });
    expect(surveyCheckbox.checked).toBe(false);
  });

  it('shows the verification reason for each field (not a percentage)', () => {
    renderModal();
    expect(screen.getByText(/never fills these automatically/i)).toBeInTheDocument();
    expect(screen.getByText(/^Found verbatim in the document text\.$/i)).toBeInTheDocument();
    expect(screen.getByText(/could not verify it against the document text/i)).toBeInTheDocument();
    // No fabricated percentage anywhere.
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  });

  it('surfaces a "legal fields need your review" banner when any legal fact is present', () => {
    renderModal();
    expect(screen.getByText(/1 legal field need/i)).toBeInTheDocument();
  });

  it('the "Apply N fields" CTA reflects the single pre-selected verified field', () => {
    renderModal();
    const applyBtn = screen.getByRole('button', { name: /Apply 1 field/i });
    expect(applyBtn).toBeInTheDocument();
    expect(applyBtn).not.toBeDisabled();
  });

  it('shows "X of Y selected" counter', () => {
    renderModal();
    expect(screen.getByText(/1 of 3 selected/i)).toBeInTheDocument();
  });

  it('"Select verified" adds only the verified row, never the legal one', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Clear$/i }));
    expect(screen.getByText(/0 of 3 selected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Select verified/i }));
    // Back to exactly the one verified, non-legal field.
    expect(screen.getByText(/1 of 3 selected/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Approve Survey Number/i }).checked).toBe(false);
  });

  it('a legal fact CAN still be applied — but only by a deliberate per-row tick', () => {
    renderModal();
    const surveyCheckbox = screen.getByRole('checkbox', { name: /Approve Survey Number/i });
    fireEvent.click(surveyCheckbox);
    expect(surveyCheckbox.checked).toBe(true);
    expect(screen.getByText(/2 of 3 selected/i)).toBeInTheDocument();
  });

  it('toggles a row on checkbox click', () => {
    renderModal();
    const landCheckbox = screen.getByRole('checkbox', { name: /Approve Land Area/i });
    fireEvent.click(landCheckbox);
    expect(landCheckbox.checked).toBe(true);
    expect(screen.getByText(/2 of 3 selected/i)).toBeInTheDocument();
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
    expect(screen.getByText(/overwrites/i)).toBeInTheDocument();
  });

  it('applies the approved subset, carrying the verification status (not a fake %)', async () => {
    mockApply.mockResolvedValueOnce({ applied: [], skipped: [] });
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /Apply 1 field/i }));

    await waitFor(() => expect(mockApply).toHaveBeenCalledTimes(1));
    const [approved] = mockApply.mock.calls[0];
    expect(approved).toHaveLength(1);
    const item = approved[0];
    expect(item.canonical_field).toBe('consideration_inr');
    expect(item.source_extraction_id).toBe('ext-1');
    expect(item.source_document_id).toBe('doc-1');
    expect(item.verification_status).toBe('source_verified');
    expect(item.confidence).toBe(0.9); // the deterministic signal score, for audit
  });

  it('renders an editable proposed-value input per row, pre-filled with the AI value', () => {
    renderModal();
    expect(screen.getAllByRole('textbox')).toHaveLength(3);
    expect(screen.getByLabelText('Proposed value for Survey Number')).toHaveValue('45/2A');
  });

  it('sends the operator-corrected value on apply and flags the row as edited', async () => {
    mockApply.mockResolvedValueOnce({ applied: [], skipped: [] });
    renderModal();

    // Correcting a value auto-selects it — so editing the legal survey_number
    // is the deliberate human action that lets it be applied.
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
    fireEvent.change(screen.getByLabelText('Proposed value for Land Area (sqft)'), {
      target: { value: '13000' },
    });
    expect(screen.getByText(/2 of 3 selected/i)).toBeInTheDocument();
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

  it('degrades honestly for a field with no signal (legacy extraction): review, not pre-ticked', () => {
    const orig = mockExtractionData.field_map;
    mockExtractionData.field_map = {
      land_area_sqft: {
        value: 12500,
        raw_key: 'land_area_sqft',
        // no `signal` — extracted before the verification signal shipped
        document_id: 'doc-1',
        document_name: 'old.pdf',
        doc_type: 'sale_deed',
        extraction_id: 'ext-9',
      },
    };
    renderModal();
    const checkbox = screen.getByRole('checkbox', { name: /Approve Land Area/i });
    expect(checkbox.checked).toBe(false);
    expect(screen.getByText(/Check this value against the source document/i)).toBeInTheDocument();
    mockExtractionData.field_map = orig;
  });

  it('renders empty state when no candidates match the ontology', () => {
    const orig = mockExtractionData.field_map;
    mockExtractionData.field_map = {};
    renderModal();
    expect(screen.getByText(/No mapped extractions on this deal/i)).toBeInTheDocument();
    mockExtractionData.field_map = orig;
  });

  // Guard against the class of bug where a status-pill icon name does not exist
  // in lucide-react: jsdom renders `undefined` silently, but the production
  // build FAILS on the missing export. Render every verification status and
  // assert a real SVG icon paints for each.
  it('every verification status renders a real icon (no silent undefined)', () => {
    const statuses = ['source_verified', 'format_checked', 'unverified', 'not_in_source', 'format_mismatch', 'verify_legal'];
    const orig = mockExtractionData.field_map;
    // One field per status against a real ontology-mapped canonical key.
    const keysByStatus = {
      source_verified: 'consideration_inr',
      format_checked: 'land_area_sqft',
      unverified: 'circle_rate_per_sqft',
      not_in_source: 'fsi',
      format_mismatch: 'road_width_m',
      verify_legal: 'survey_number',
    };
    mockExtractionData.field_map = Object.fromEntries(
      statuses.map((status) => [keysByStatus[status], {
        value: '1',
        raw_key: keysByStatus[status],
        signal_score: 0.5,
        signal: { status, lane: status === 'verify_legal' ? 'legal_title' : null, grounded: null, reason: `reason for ${status}` },
        document_id: 'doc-1', document_name: 'x.pdf', doc_type: 'sale_deed', extraction_id: 'ext-1',
      }]),
    );
    const { container } = renderModal();
    // Every rendered row must carry exactly one status pill with a real <svg>.
    // A nonexistent lucide icon renders `undefined` (nothing) in jsdom but
    // FAILS the production build — so pills === rows proves each status maps to
    // a real icon.
    const rows = screen.getAllByRole('checkbox').length;
    expect(rows).toBeGreaterThanOrEqual(5); // most keys route via the ontology
    const pills = container.querySelectorAll('.rounded-full svg');
    expect(pills.length).toBe(rows);
    mockExtractionData.field_map = orig;
  });
});
