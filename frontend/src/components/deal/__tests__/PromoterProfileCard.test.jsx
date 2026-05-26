import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The card reads/writes via usePromoterProfile — mock the hooks for a
// deterministic, offline test. The card calls four hooks unconditionally
// (usePromoterProfile + useUpsertPromoterProfile + useLinkReraPromoter +
// useUnlinkReraPromoter), so every mock factory must export all four —
// React would otherwise throw on the conditional-hook-order rule.
const usePromoterProfileMock = vi.fn();
const upsertMutateAsync = vi.fn();
const linkMutate = vi.fn();
const unlinkMutate = vi.fn();
vi.mock('../../../hooks/usePromoterProfile', () => ({
  usePromoterProfile: (...a) => usePromoterProfileMock(...a),
  useUpsertPromoterProfile: () => ({ mutateAsync: upsertMutateAsync, isPending: false }),
  useLinkReraPromoter: () => ({ mutate: linkMutate, isPending: false }),
  useUnlinkReraPromoter: () => ({ mutate: unlinkMutate, isPending: false }),
}));

import PromoterProfileCard from '../PromoterProfileCard';

beforeEach(() => {
  usePromoterProfileMock.mockReset();
  upsertMutateAsync.mockReset();
  linkMutate.mockReset();
  unlinkMutate.mockReset();
});

describe('PromoterProfileCard', () => {
  it('shows an empty state and a Record action when nothing is recorded', () => {
    usePromoterProfileMock.mockReturnValue({
      data: { profile: null, assessment: { posture: 'unverified', signals: [] }, rera: null },
      isLoading: false,
      isError: false,
    });
    render(<PromoterProfileCard dealId="deal-1" />);
    expect(screen.getByText('Not verified')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Record/i })).toBeInTheDocument();
  });

  it('renders a recorded track record with its posture and facts', () => {
    usePromoterProfileMock.mockReturnValue({
      data: {
        profile: {
          promoter_name: 'Prestige Group',
          entity_type: 'public_limited',
          years_active: 25,
          total_projects: 280,
          delivered_on_time: 250,
          delivered_delayed: 30,
          ongoing_projects: 40,
          rera_registered: true,
          rera_complaints: 0,
          notes: null,
        },
        assessment: {
          posture: 'cleared',
          signals: [{ tone: 'positive', text: 'Strong delivery record on file' }],
        },
        rera: { candidates: [], linked: null, stats: null },
      },
      isLoading: false,
      isError: false,
    });
    render(<PromoterProfileCard dealId="deal-1" />);
    expect(screen.getByText('Cleared')).toBeInTheDocument();
    expect(screen.getByText('Prestige Group')).toBeInTheDocument();
    expect(screen.getByText('Strong delivery record on file')).toBeInTheDocument();
  });

  it('opens the edit form when Edit is clicked', () => {
    usePromoterProfileMock.mockReturnValue({
      data: {
        profile: { promoter_name: 'Prestige Group' },
        assessment: { posture: 'unverified', signals: [] },
        rera: null,
      },
      isLoading: false,
      isError: false,
    });
    render(<PromoterProfileCard dealId="deal-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Edit/i }));
    expect(screen.getByText(/Promoter \/ builder name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save track record/i })).toBeInTheDocument();
  });

  it('shows a skeleton while loading', () => {
    usePromoterProfileMock.mockReturnValue({ isLoading: true });
    const { container } = render(<PromoterProfileCard dealId="deal-1" />);
    expect(container.querySelector('.redip-skeleton')).not.toBeNull();
  });

  it('renders K-RERA candidates and links on Confirm match', () => {
    usePromoterProfileMock.mockReturnValue({
      data: {
        profile: { promoter_name: 'Prestige' },
        assessment: { posture: 'unverified', signals: [] },
        rera: {
          candidates: [
            { promoter_name: 'Prestige Estates Projects Limited', sim_score: 0.92 },
            { promoter_name: 'Prestige Builders Pvt Ltd', sim_score: 0.71 },
          ],
          linked: null,
          stats: null,
        },
      },
      isLoading: false,
      isError: false,
    });
    render(<PromoterProfileCard dealId="deal-1" />);
    // K-RERA section visible with both candidates
    expect(screen.getByText('K-RERA candidates')).toBeInTheDocument();
    expect(screen.getByText('Prestige Estates Projects Limited')).toBeInTheDocument();
    expect(screen.getByText('Prestige Builders Pvt Ltd')).toBeInTheDocument();
    // Click Confirm match on the first candidate
    const confirmButtons = screen.getAllByRole('button', { name: /Confirm match/i });
    fireEvent.click(confirmButtons[0]);
    expect(linkMutate).toHaveBeenCalledTimes(1);
    expect(linkMutate).toHaveBeenCalledWith({
      dealId: 'deal-1',
      reraPromoterName: 'Prestige Estates Projects Limited',
      matchConfidence: 0.92,
    });
  });

  it('renders the linked K-RERA promoter with aggregate stats + Unlink', () => {
    usePromoterProfileMock.mockReturnValue({
      data: {
        profile: { promoter_name: 'Prestige', linked_rera_promoter_name: 'Prestige Estates Projects Limited' },
        assessment: { posture: 'unverified', signals: [] },
        rera: {
          candidates: [],
          linked: {
            promoter_name: 'Prestige Estates Projects Limited',
            match_confidence: 0.92,
            linked_at: '2026-05-20T10:00:00Z',
          },
          stats: {
            total_projects: 12,
            completed_projects: 7,
            ongoing_projects: 4,
            lapsed_projects: 1,
            avg_delivery_delay_months: 3.2,
          },
        },
      },
      isLoading: false,
      isError: false,
    });
    render(<PromoterProfileCard dealId="deal-1" />);
    expect(screen.getByText('K-RERA match')).toBeInTheDocument();
    expect(screen.getByText('Prestige Estates Projects Limited')).toBeInTheDocument();
    // Stats line includes counts + a humanised delay
    expect(screen.getByText(/12 projects on K-RERA/)).toBeInTheDocument();
    expect(screen.getByText(/3.2 months late on average/)).toBeInTheDocument();
    // Unlink button triggers the unlink mutation
    fireEvent.click(screen.getByRole('button', { name: /Unlink/i }));
    expect(unlinkMutate).toHaveBeenCalledWith({ dealId: 'deal-1' });
  });

  it('renders nothing in the K-RERA section when there are no candidates and no link', () => {
    usePromoterProfileMock.mockReturnValue({
      data: {
        profile: { promoter_name: 'Tiny Builders Co' },
        assessment: { posture: 'unverified', signals: [] },
        rera: { candidates: [], linked: null, stats: null },
      },
      isLoading: false,
      isError: false,
    });
    render(<PromoterProfileCard dealId="deal-1" />);
    // No K-RERA section at all when K-RERA index has nothing similar
    expect(screen.queryByText('K-RERA candidates')).not.toBeInTheDocument();
    expect(screen.queryByText('K-RERA match')).not.toBeInTheDocument();
  });
});
