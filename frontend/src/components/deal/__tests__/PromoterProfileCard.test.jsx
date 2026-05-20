import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The card reads/writes via usePromoterProfile — mock the hooks for a
// deterministic, offline test.
const usePromoterProfileMock = vi.fn();
const upsertMutateAsync = vi.fn();
vi.mock('../../../hooks/usePromoterProfile', () => ({
  usePromoterProfile: (...a) => usePromoterProfileMock(...a),
  useUpsertPromoterProfile: () => ({ mutateAsync: upsertMutateAsync, isPending: false }),
}));

import PromoterProfileCard from '../PromoterProfileCard';

beforeEach(() => {
  usePromoterProfileMock.mockReset();
  upsertMutateAsync.mockReset();
});

describe('PromoterProfileCard', () => {
  it('shows an empty state and a Record action when nothing is recorded', () => {
    usePromoterProfileMock.mockReturnValue({
      data: { profile: null, assessment: { posture: 'unverified', signals: [] } },
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
});
