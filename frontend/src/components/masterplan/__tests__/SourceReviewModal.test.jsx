import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SourceReviewModal from '../SourceReviewModal';

// Focused tests for the SourceReviewModal payload normalization. The modal
// is presentational — most chrome is exercised by the integration tests
// on MasterPlanAdminPage — but the form-to-payload mapping has subtle
// percent-ratio conversions and OCR-required derivation that would
// silently corrupt master-plan source metadata if regressed.

const sampleDoc = {
  id: 'doc-1',
  plan_name: 'RMP 2031 — Volume 6 (Zoning Regulations)',
  doc_type: 'rmp_table',
  source_role: 'operative_regulation',
  legal_status: 'gazetted',
  authority_name: 'BDA',
  published_on: '2017-05-15T00:00:00.000Z',
  source_url: 'https://example.gov.in/rmp.pdf',
  page_count: 78,
  processing_mode: 'text_extraction',
  text_coverage_ratio: 0.9,
  ocr_required: false,
  source_confidence: 0.85,
  registry_notes: 'Verified against gazette copy.',
};

beforeEach(() => {
  cleanup();
});

function openModal(props = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const result = render(
    <SourceReviewModal
      isOpen
      doc={sampleDoc}
      onSubmit={onSubmit}
      onClose={onClose}
      submitting={false}
      {...props}
    />,
  );
  return { ...result, onSubmit, onClose };
}

function submitForm() {
  const saveBtn = screen.getByRole('button', { name: /Save review/i });
  // Submitting the button submits its parent <form>.
  fireEvent.click(saveBtn);
}

describe('SourceReviewModal', () => {
  it('renders nothing when isOpen=false', () => {
    const { container } = render(
      <SourceReviewModal
        isOpen={false}
        doc={sampleDoc}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders nothing when doc is null', () => {
    const { container } = render(
      <SourceReviewModal isOpen doc={null} onSubmit={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('pre-fills form fields from the doc prop', () => {
    openModal();
    expect(screen.getByLabelText(/Document type/i)).toHaveValue('rmp_table');
    expect(screen.getByLabelText(/Source role/i)).toHaveValue('operative_regulation');
    expect(screen.getByLabelText(/Legal status/i)).toHaveValue('gazetted');
    expect(screen.getByLabelText(/Authority/i)).toHaveValue('BDA');
    // published_on is sliced to YYYY-MM-DD for the <input type="date">.
    expect(screen.getByLabelText(/Published on/i)).toHaveValue('2017-05-15');
    expect(screen.getByLabelText(/Page count/i)).toHaveValue(78);
    expect(screen.getByLabelText(/Processing/i)).toHaveValue('text_extraction');
    // Ratios round-trip through ratioToPct on load (0.9 → "90") and
    // pctToRatio on submit. The input shows the integer percent.
    expect(screen.getByLabelText(/Text coverage %/i)).toHaveValue(90);
    expect(screen.getByLabelText(/Confidence %/i)).toHaveValue(85);
  });

  it('submits a normalised payload with ratios converted back to 0..1', () => {
    const { onSubmit } = openModal();
    submitForm();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({
      docType: 'rmp_table',
      sourceRole: 'operative_regulation',
      legalStatus: 'gazetted',
      authorityName: 'BDA',
      publishedOn: '2017-05-15',
      sourceUrl: 'https://example.gov.in/rmp.pdf',
      pageCount: 78,
      processingMode: 'text_extraction',
      textCoverageRatio: 0.9,
      ocrRequired: false,
      sourceConfidence: 0.85,
      registryNotes: 'Verified against gazette copy.',
      changeReason: 'source registry review',
    });
  });

  it('trims whitespace on text fields and submits empty strings as null', () => {
    const { onSubmit } = openModal({
      doc: {
        ...sampleDoc,
        authority_name: '  BBMP  ',
        source_url: '  https://example.gov.in/foo  ',
        registry_notes: '   ',
      },
    });
    submitForm();
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.authorityName).toBe('BBMP');
    expect(payload.sourceUrl).toBe('https://example.gov.in/foo');
    expect(payload.registryNotes).toBeNull();
  });

  it('emits null pageCount when the input is cleared', () => {
    const { onSubmit } = openModal({ doc: { ...sampleDoc, page_count: null } });
    submitForm();
    expect(onSubmit.mock.calls[0][0].pageCount).toBeNull();
  });

  it('forces ocrRequired=true when processingMode is ocr_required, even if the checkbox is unchecked', () => {
    const { onSubmit } = openModal({
      doc: { ...sampleDoc, processing_mode: 'ocr_required', ocr_required: false },
    });
    submitForm();
    expect(onSubmit.mock.calls[0][0].ocrRequired).toBe(true);
    expect(onSubmit.mock.calls[0][0].processingMode).toBe('ocr_required');
  });

  it('forces ocrRequired=true when processingMode is image_review', () => {
    const { onSubmit } = openModal({
      doc: { ...sampleDoc, processing_mode: 'image_review', ocr_required: false },
    });
    submitForm();
    expect(onSubmit.mock.calls[0][0].ocrRequired).toBe(true);
  });

  it('reflects the operator-chosen ocrRequired checkbox when processingMode does not force it', () => {
    const { onSubmit } = openModal();
    const checkbox = screen.getByRole('checkbox', { name: /OCR needed/i });
    fireEvent.click(checkbox);
    submitForm();
    expect(onSubmit.mock.calls[0][0].ocrRequired).toBe(true);
  });

  it('updates the form when a different doc is supplied', () => {
    const { rerender } = openModal();
    expect(screen.getByLabelText(/Authority/i)).toHaveValue('BDA');
    rerender(
      <SourceReviewModal
        isOpen
        doc={{ ...sampleDoc, authority_name: 'BBMP' }}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Authority/i)).toHaveValue('BBMP');
  });

  it('clicking Cancel calls onClose without invoking onSubmit', () => {
    const { onSubmit, onClose } = openModal();
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
