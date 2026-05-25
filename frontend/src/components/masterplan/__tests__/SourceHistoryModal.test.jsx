import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SourceHistoryModal from '../SourceHistoryModal';

// SourceHistoryModal is a read-only audit-trail viewer. Tests pin the
// four render branches (loading / error / empty / data) + the formatting
// of "Previous <field>" rows that show pre-edit values, since the field
// labels run through formatHistoryField + the values run through
// formatHistoryValue (enum lookup, percent formatting, blank handling).

const doc = { id: 'doc-1', plan_name: 'RMP 2031 — Volume 6' };

beforeEach(() => {
  cleanup();
});

describe('SourceHistoryModal', () => {
  it('renders nothing when isOpen=false', () => {
    const { container } = render(
      <SourceHistoryModal isOpen={false} doc={doc} onClose={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders nothing when doc is null', () => {
    const { container } = render(
      <SourceHistoryModal isOpen doc={null} onClose={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows the loading skeleton state while isLoading=true', () => {
    render(<SourceHistoryModal isOpen doc={doc} isLoading onClose={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(/Loading source review history/i)).toBeInTheDocument();
  });

  it('shows an error state with a Retry button when isError=true', () => {
    const onRetry = vi.fn();
    render(
      <SourceHistoryModal
        isOpen
        doc={doc}
        isError
        onClose={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText(/Could not load history/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when versions is an empty array', () => {
    render(
      <SourceHistoryModal isOpen doc={doc} versions={[]} onClose={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(screen.getByText(/No source review history yet/i)).toBeInTheDocument();
  });

  it('renders one card per version with the actor + change reason + field count', () => {
    const versions = [
      {
        id: 'v-1',
        changed_by_name: 'Asha',
        changed_at: '2026-05-22T10:00:00Z',
        change_reason: 'fix gazetted status',
        previous_values: { legal_status: 'draft', authority_name: 'BBMP' },
      },
      {
        id: 'v-2',
        changed_by_name: null,
        changed_at: '2026-05-21T09:30:00Z',
        change_reason: null,
        previous_values: {},
      },
    ];
    render(
      <SourceHistoryModal
        isOpen
        doc={doc}
        versions={versions}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    // Actor / fallback "System" badge
    expect(screen.getByText('Asha')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    // Change reason / default copy
    expect(screen.getByText('fix gazetted status')).toBeInTheDocument();
    expect(screen.getByText('Source metadata review')).toBeInTheDocument();
    // Field counts: 2 fields + 0 fields
    expect(screen.getByText(/2 fields/)).toBeInTheDocument();
    expect(screen.getByText(/0 fields/)).toBeInTheDocument();
    // "Previous Legal status" via formatHistoryField
    expect(screen.getByText(/Previous Legal status/i)).toBeInTheDocument();
    // Value formatting — legal_status 'draft' → "Draft" (enum lookup)
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('handles a JSON-encoded previous_values string', () => {
    const versions = [
      {
        id: 'v-3',
        changed_by_name: 'System',
        changed_at: '2026-05-20T12:00:00Z',
        change_reason: 'JSON-encoded reload',
        // Server sometimes ships previous_values as a JSON string. The
        // modal calls normalizePreviousValues to parse it before iterating.
        previous_values: '{"doc_type":"rmp_table"}',
      },
    ];
    render(
      <SourceHistoryModal
        isOpen
        doc={doc}
        versions={versions}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    // formatHistoryField('doc_type') → 'Document type'
    expect(screen.getByText(/Previous Document type/i)).toBeInTheDocument();
    // formatHistoryValue('doc_type', 'rmp_table') → 'RMP / FAR table'
    expect(screen.getByText('RMP / FAR table')).toBeInTheDocument();
  });

  it('clicking the close button calls onClose', () => {
    const onClose = vi.fn();
    render(
      <SourceHistoryModal
        isOpen
        doc={doc}
        versions={[]}
        onClose={onClose}
        onRetry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Close source review history/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
