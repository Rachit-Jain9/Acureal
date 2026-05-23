import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EvidenceBadge from '../EvidenceBadge';

// Mock the API service the hook calls under the hood. Keeping the mock at
// the api layer (not the hook layer) keeps the test honest about how the
// hook wires up — including the lazy-fetch gate.
vi.mock('../../../services/api', () => ({
  evidenceLinksAPI: {
    list: vi.fn(),
  },
}));

import { evidenceLinksAPI } from '../../../services/api';

const renderBadge = (props = {}, queryClient) => {
  const qc = queryClient || new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <EvidenceBadge ownerKind="dd_item" ownerId="dd-1" {...props} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EvidenceBadge', () => {
  it('does NOT fetch on mount — the chip is lazy', () => {
    renderBadge();
    expect(evidenceLinksAPI.list).not.toHaveBeenCalled();
    // Neutral chip before any fetch
    expect(screen.getByRole('button')).toHaveTextContent(/Evidence/i);
  });

  it('fetches once the chip opens, and shows the bucket pill', async () => {
    evidenceLinksAPI.list.mockResolvedValueOnce({
      data: {
        data: {
          links: [],
          summary: {
            source_count: 2,
            manual_count: 0,
            max_confidence: 0.9,
            avg_confidence: 0.85,
            bucket: 'verified',
          },
        },
      },
    });

    renderBadge();
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(evidenceLinksAPI.list).toHaveBeenCalledWith('dd_item', 'dd-1');
    });

    // The pill colour-codes the bucket; the label is "Verified" with the
    // source count rolled up next to it on the trigger pill itself.
    const trigger = screen.getByRole('button');
    await waitFor(() => {
      expect(trigger.textContent).toMatch(/Verified/);
    });
  });

  it('renders linked sources with page numbers and confidence', async () => {
    evidenceLinksAPI.list.mockResolvedValueOnce({
      data: {
        data: {
          links: [
            {
              id: 'l1',
              link_kind: 'evidence_source',
              evidence_source_title: 'Sale Deed 2024',
              evidence_source_authority: 'Sub-Registrar',
              confidence_score: 0.87,
              page_number: 3,
              source_section: 'Schedule A',
              created_by_name: 'Rachit',
              created_at: new Date(Date.now() - 3600 * 1000).toISOString(),
            },
          ],
          summary: {
            source_count: 1,
            manual_count: 0,
            max_confidence: 0.87,
            bucket: 'verified',
          },
        },
      },
    });

    renderBadge();
    fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByText('Sale Deed 2024')).toBeInTheDocument();
    // Page number and source section render as the subtitle.
    expect(screen.getByText(/p\. 3 · Schedule A · Sub-Registrar/)).toBeInTheDocument();
    // Confidence formatted as percent.
    expect(screen.getByText('87% confidence')).toBeInTheDocument();
    // "Linked by Rachit" attribution.
    expect(screen.getByText(/Linked by/)).toBeInTheDocument();
  });

  it('shows the empty-state copy when no links are attached', async () => {
    evidenceLinksAPI.list.mockResolvedValueOnce({
      data: {
        data: {
          links: [],
          summary: {
            source_count: 0,
            manual_count: 0,
            max_confidence: null,
            bucket: 'needs_verification',
          },
        },
      },
    });

    renderBadge();
    fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByText(/No evidence linked yet/i)).toBeInTheDocument();
  });

  it('labels manual verifications with the "Verified by" wording', async () => {
    evidenceLinksAPI.list.mockResolvedValueOnce({
      data: {
        data: {
          links: [
            {
              id: 'l1',
              link_kind: 'manual_verification',
              external_url: 'https://example.com/kaveri-verify',
              created_by_name: 'Rachit',
              verified_by_name: 'Rachit',
              created_at: new Date().toISOString(),
              verified_at: new Date().toISOString(),
            },
          ],
          summary: {
            source_count: 0,
            manual_count: 1,
            max_confidence: null,
            bucket: 'inferred',
          },
        },
      },
    });

    renderBadge();
    fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByText(/Verified by/)).toBeInTheDocument();
    // Falls back to the URL hostname when no title is present on the link.
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('caches across re-opens — the second open does not refetch', async () => {
    evidenceLinksAPI.list.mockResolvedValue({
      data: {
        data: {
          links: [],
          summary: {
            source_count: 0,
            manual_count: 0,
            max_confidence: null,
            bucket: 'needs_verification',
          },
        },
      },
    });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
    });
    renderBadge({}, qc);

    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    await waitFor(() => expect(evidenceLinksAPI.list).toHaveBeenCalledTimes(1));

    // Close + reopen. With staleTime > 0 the cached query should serve the
    // second open without a refetch.
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    await waitFor(() => expect(evidenceLinksAPI.list).toHaveBeenCalledTimes(1));
  });
});
