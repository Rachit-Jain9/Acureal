import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SourcePagesModal from '../SourcePagesModal';

// SourcePagesModal renders the OCR / review status ledger for each page
// of a source PDF. Tests pin the five render branches (loading / error /
// schema-not-ready / empty / data) + the `canPrepare` gating logic
// (Prepare button enabled only when schema is ready AND doc.page_count
// is a positive number).

const doc = {
  id: 'doc-1',
  plan_name: 'RMP 2031 — Volume 6 (Zoning Regulations)',
  page_count: 78,
};

beforeEach(() => {
  cleanup();
});

describe('SourcePagesModal', () => {
  it('renders nothing when isOpen=false', () => {
    const { container } = render(
      <SourcePagesModal isOpen={false} doc={doc} onClose={vi.fn()} onRetry={vi.fn()} onPrepare={vi.fn()} />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders nothing when doc is null', () => {
    const { container } = render(
      <SourcePagesModal isOpen doc={null} onClose={vi.fn()} onRetry={vi.fn()} onPrepare={vi.fn()} />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows the loading skeleton when isLoading=true', () => {
    render(
      <SourcePagesModal isOpen doc={doc} isLoading onClose={vi.fn()} onRetry={vi.fn()} onPrepare={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(/Loading source page ledger/i)).toBeInTheDocument();
  });

  it('shows an error state with a Retry button when isError=true', () => {
    const onRetry = vi.fn();
    render(
      <SourcePagesModal
        isOpen
        doc={doc}
        isError
        onClose={vi.fn()}
        onRetry={onRetry}
        onPrepare={vi.fn()}
      />,
    );
    expect(screen.getByText(/Could not load page ledger/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows a "schema not applied" warning when data.schema_ready=false', () => {
    render(
      <SourcePagesModal
        isOpen
        doc={doc}
        data={{ schema_ready: false, message: 'Apply migration 20260430_source_document_pages.sql' }}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onPrepare={vi.fn()}
      />,
    );
    expect(screen.getByText(/Page storage not applied yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Apply migration 20260430_source_document_pages.sql/i),
    ).toBeInTheDocument();
  });

  it('shows an empty state with a Prepare-pages button when no pages exist yet (page_count > 0)', () => {
    const onPrepare = vi.fn();
    render(
      <SourcePagesModal
        isOpen
        doc={doc}
        data={{ pages: [] }}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onPrepare={onPrepare}
      />,
    );
    expect(screen.getByText(/No pages prepared yet/i)).toBeInTheDocument();
    const prepBtn = screen.getByRole('button', { name: /Prepare pages/i });
    expect(prepBtn).toBeEnabled();
    fireEvent.click(prepBtn);
    expect(onPrepare).toHaveBeenCalledTimes(1);
  });

  it('disables the Prepare button when doc.page_count is 0 (no count set yet)', () => {
    render(
      <SourcePagesModal
        isOpen
        doc={{ ...doc, page_count: 0 }}
        data={{ pages: [] }}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onPrepare={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Set a page count in source review before preparing/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Prepare pages/i })).toBeDisabled();
  });

  it('renders one card per page with OCR + review status badges + text-coverage percent', () => {
    const pages = [
      {
        id: 'p-1',
        page_number: 1,
        page_label: 'Cover page',
        ocr_status: 'completed',
        review_status: 'reviewed',
        text_coverage_ratio: 0.92,
        confidence_score: 0.88,
        reviewer_notes: 'High-confidence text page.',
      },
      {
        id: 'p-2',
        page_number: 2,
        page_label: null,
        ocr_status: 'queued',
        review_status: 'pending',
        text_coverage_ratio: null,
        confidence_score: null,
        reviewer_notes: null,
      },
    ];
    render(
      <SourcePagesModal
        isOpen
        doc={doc}
        data={{ pages }}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onPrepare={vi.fn()}
      />,
    );
    // Cards
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(screen.getByText('Page 2')).toBeInTheDocument();
    expect(screen.getByText('Cover page')).toBeInTheDocument();
    expect(screen.getByText('No page label')).toBeInTheDocument();
    // Status badges (formatted from snake_case)
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('queued')).toBeInTheDocument();
    // Text coverage shown when ratio is non-null (formatPercent: 0.92 → '92%')
    expect(screen.getByText(/Text 92%/i)).toBeInTheDocument();
    expect(screen.getByText(/Confidence 88%/i)).toBeInTheDocument();
    // Total page count badge in the header
    expect(screen.getByText(/2 pages/i)).toBeInTheDocument();
    // Reviewer notes / fallback copy
    expect(screen.getByText('High-confidence text page.')).toBeInTheDocument();
    expect(
      screen.getByText(/OCR text and citation anchors are not stored for this page yet/i),
    ).toBeInTheDocument();
  });

  it('clicking close calls onClose', () => {
    const onClose = vi.fn();
    render(
      <SourcePagesModal
        isOpen
        doc={doc}
        data={{ pages: [] }}
        onClose={onClose}
        onRetry={vi.fn()}
        onPrepare={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Close source page ledger/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
