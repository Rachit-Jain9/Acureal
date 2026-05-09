import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Tier-2 #13 follow-on — parcel narrative card.
// Tests the on-mount cache hit (shows the persisted narrative + Cached
// badge), the empty / CTA state, the Regenerate flow, and the Copy
// button. Mutation + cache hooks are mocked so no React Query setup
// is needed for this test.

let mutationState;
let cachedState;
const mutateFn = vi.fn();

vi.mock('../../../hooks/useProperties', () => ({
  useGenerateParcelNarrative: () => mutationState,
  useCachedParcelNarrative: () => cachedState,
}));

import ParcelNarrativeCard from '../ParcelNarrativeCard';

const SAMPLE_INTEL = {
  verdict: { label: 'Verified Clean' },
};

beforeEach(() => {
  mutateFn.mockReset();
  mutationState = { data: null, error: null, isPending: false, mutate: mutateFn };
  cachedState = { data: null, isLoading: false, isError: false };
});

describe('ParcelNarrativeCard', () => {
  it('shows Generate CTA when nothing is cached', () => {
    render(<ParcelNarrativeCard propertyId="p-1" dealId="d-1" intelligence={SAMPLE_INTEL} />);
    expect(screen.getByRole('button', { name: /Generate AI summary/i })).toBeInTheDocument();
  });

  it('renders the cached narrative on mount with the Cached badge', () => {
    cachedState = {
      data: {
        narrative: 'Whitefield Plot 22 carries a clean title chain. Verification of road width is the next step.',
        generated_at: '2026-05-09T10:00:00Z',
        snapshot_hash: 'h-1',
      },
      isLoading: false,
    };
    render(<ParcelNarrativeCard propertyId="p-1" dealId="d-1" intelligence={SAMPLE_INTEL} />);
    expect(screen.getByText(/Whitefield Plot 22 carries a clean title chain/)).toBeInTheDocument();
    expect(screen.getByText(/Cached/)).toBeInTheDocument();
    // Regenerate affordance always exposed once content exists.
    expect(screen.getByRole('button', { name: /Regenerate/i })).toBeInTheDocument();
  });

  it('Generate button calls mutate with propertyId + dealId', () => {
    render(<ParcelNarrativeCard propertyId="p-99" dealId="d-77" intelligence={SAMPLE_INTEL} />);
    fireEvent.click(screen.getByRole('button', { name: /Generate AI summary/i }));
    expect(mutateFn).toHaveBeenCalledWith({ propertyId: 'p-99', dealId: 'd-77' });
  });

  it('shows skeleton rows while pending', () => {
    mutationState = { ...mutationState, isPending: true };
    const { container } = render(
      <ParcelNarrativeCard propertyId="p-1" dealId="d-1" intelligence={SAMPLE_INTEL} />,
    );
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders the error state with a Try again button', () => {
    mutationState = {
      ...mutationState,
      error: { message: 'Claude is not configured' },
    };
    render(<ParcelNarrativeCard propertyId="p-1" dealId="d-1" intelligence={SAMPLE_INTEL} />);
    expect(screen.getByText(/Claude is not configured/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });

  it('Copy button writes the narrative to the clipboard', async () => {
    cachedState = {
      data: { narrative: 'snapshot prose', generated_at: '2026-05-09T10:00:00Z' },
      isLoading: false,
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<ParcelNarrativeCard propertyId="p-1" dealId="d-1" intelligence={SAMPLE_INTEL} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('snapshot prose'));
  });

  it('renders the AI-assisted disclaimer when content is present', () => {
    cachedState = {
      data: {
        narrative: 'prose body',
        disclaimer: 'AI-assisted — review the snapshot.',
        generated_at: '2026-05-09T10:00:00Z',
      },
      isLoading: false,
    };
    render(<ParcelNarrativeCard propertyId="p-1" dealId="d-1" intelligence={SAMPLE_INTEL} />);
    expect(screen.getByText(/AI-assisted — review the snapshot/)).toBeInTheDocument();
  });

  it('renders the drift surface when numerical_drifts has entries', () => {
    cachedState = {
      data: {
        narrative: 'prose body',
        generated_at: '2026-05-09T10:00:00Z',
        numerical_drifts: [
          { label: 'FAR', severity: 'high', claimed: 4, snapshot: 2.5, delta_pct: 60 },
        ],
      },
      isLoading: false,
    };
    render(<ParcelNarrativeCard propertyId="p-1" dealId="d-1" intelligence={SAMPLE_INTEL} />);
    expect(screen.getByText(/1 numerical claim flagged/)).toBeInTheDocument();
  });
});
