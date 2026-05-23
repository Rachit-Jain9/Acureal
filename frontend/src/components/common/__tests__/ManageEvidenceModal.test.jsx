import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ManageEvidenceModal from '../ManageEvidenceModal';

// Mock both the evidence-links API and the documents API used by the
// embedded "pick a document" dropdown.
vi.mock('../../../services/api', () => ({
  evidenceLinksAPI: {
    list: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
  },
  documentsAPI: {
    list: vi.fn(),
  },
}));

import { evidenceLinksAPI, documentsAPI } from '../../../services/api';

const renderModal = (props = {}, qc) => {
  const queryClient = qc || new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ManageEvidenceModal
          open={true}
          onClose={vi.fn()}
          ownerKind="dd_item"
          ownerId="dd-1"
          ownerLabel="Title Search — EC for 30 years"
          dealId="deal-1"
          {...props}
        />
      </QueryClientProvider>,
    ),
  };
};

const defaultLinksResponse = (overrides = {}) => ({
  data: {
    data: {
      links: [],
      summary: {
        source_count: 0,
        manual_count: 0,
        max_confidence: null,
        bucket: 'needs_verification',
      },
      ...overrides,
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  evidenceLinksAPI.list.mockResolvedValue(defaultLinksResponse());
  documentsAPI.list.mockResolvedValue({
    data: { documents: [{ id: 'doc-1', name: 'Sale Deed 2024.pdf' }] },
  });
});

describe('ManageEvidenceModal', () => {
  it('renders the header with the owner label', async () => {
    renderModal();
    expect(await screen.findByText(/Manage evidence — Title Search — EC for 30 years/i))
      .toBeInTheDocument();
  });

  it('shows an empty-state line when no evidence is linked', async () => {
    renderModal();
    expect(await screen.findByText(/No evidence linked yet/i)).toBeInTheDocument();
  });

  it('renders an existing link with a remove button', async () => {
    evidenceLinksAPI.list.mockResolvedValueOnce(defaultLinksResponse({
      links: [
        {
          id: 'link-1',
          link_kind: 'document',
          // A name that doesn't collide with the docs-dropdown mock so the
          // assertion can pin to a single occurrence.
          document_name: 'Encumbrance Certificate 1995-2025.pdf',
          page_number: 3,
          source_section: 'Schedule A',
          confidence_score: 0.9,
          created_by_name: 'Rachit',
          created_at: new Date().toISOString(),
          notes: 'Para 4 confirms 30-year chain.',
        },
      ],
      summary: { source_count: 1, manual_count: 0, max_confidence: 0.9, bucket: 'verified' },
    }));

    renderModal();

    expect(await screen.findByText('Encumbrance Certificate 1995-2025.pdf')).toBeInTheDocument();
    expect(screen.getByText(/p\. 3/)).toBeInTheDocument();
    expect(screen.getByText(/90% confidence/)).toBeInTheDocument();
    expect(screen.getByText(/Para 4 confirms 30-year chain./)).toBeInTheDocument();
    expect(screen.getByLabelText('Remove this link')).toBeInTheDocument();
  });

  it('blocks document attach when no document is picked', async () => {
    renderModal();
    // Default link kind is "document"; submitting without picking one
    // should surface an error and not call the API.
    const submit = await screen.findByRole('button', { name: /Add evidence/i });
    fireEvent.click(submit);
    expect(await screen.findByText(/Pick a document/i)).toBeInTheDocument();
    expect(evidenceLinksAPI.attach).not.toHaveBeenCalled();
  });

  it('attaches a document with page + confidence + notes when valid', async () => {
    evidenceLinksAPI.attach.mockResolvedValueOnce({ data: { data: { id: 'new-link' } } });
    renderModal();

    // Wait for the docs to load into the dropdown — without this the
    // select is rendered with only the placeholder option and `value`
    // changes silently no-op.
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Sale Deed 2024\.pdf/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Document$/i), {
      target: { value: 'doc-1' },
    });
    fireEvent.change(screen.getByLabelText(/Page number/i), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/Source section/i), { target: { value: 'Schedule A' } });
    fireEvent.change(screen.getByLabelText(/Confidence/i), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText(/Notes/i), { target: { value: 'Title chain clean.' } });

    fireEvent.click(screen.getByRole('button', { name: /Add evidence/i }));

    await waitFor(() => {
      expect(evidenceLinksAPI.attach).toHaveBeenCalledWith('dd_item', 'dd-1', expect.objectContaining({
        linkKind: 'document',
        documentId: 'doc-1',
        pageNumber: 3,
        sourceSection: 'Schedule A',
        confidenceScore: 0.9,
        notes: 'Title chain clean.',
        externalUrl: null,
      }));
    });
  });

  it('rejects malformed external URLs', async () => {
    renderModal();
    fireEvent.click(screen.getByLabelText(/External URL/i));
    fireEvent.change(await screen.findByLabelText(/^URL$/i), { target: { value: 'not-a-url' } });
    fireEvent.click(screen.getByRole('button', { name: /Add evidence/i }));
    expect(await screen.findByText(/Enter a valid URL/i)).toBeInTheDocument();
    expect(evidenceLinksAPI.attach).not.toHaveBeenCalled();
  });

  it('requires notes for a manual verification', async () => {
    renderModal();
    fireEvent.click(screen.getByLabelText(/Manual verification/i));
    fireEvent.click(screen.getByRole('button', { name: /Add evidence/i }));
    expect(await screen.findByText(/Add a short note/i)).toBeInTheDocument();
    expect(evidenceLinksAPI.attach).not.toHaveBeenCalled();
  });

  it('disables the document option when the deal has no uploaded docs', async () => {
    documentsAPI.list.mockResolvedValueOnce({ data: { documents: [] } });
    renderModal();

    // Wait for the empty-doc state to render.
    await waitFor(() => {
      expect(screen.getByText(/Upload a document on the Documents tab first/i)).toBeInTheDocument();
    });

    // Submit attempt while "Document" is still the (disabled) selected kind
    // should bail with the same "no doc picked" guard.
    fireEvent.click(screen.getByRole('button', { name: /Add evidence/i }));
    expect(evidenceLinksAPI.attach).not.toHaveBeenCalled();
  });
});
