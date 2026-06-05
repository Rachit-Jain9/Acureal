import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────────
let signoffsState;
const createMutateAsync = vi.fn(() => Promise.resolve({}));
const updateMutate = vi.fn();
const deleteMutate = vi.fn();
const seedMutate = vi.fn();

vi.mock('../../../hooks/useSignoffs', () => ({
  useSignoffs: () => signoffsState,
  useCreateSignoff: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateSignoff: () => ({ mutate: updateMutate, isPending: false }),
  useDeleteSignoff: () => ({ mutate: deleteMutate, isPending: false }),
  useSeedSignoffs: () => ({ mutate: seedMutate, isPending: false }),
}));

// Keep the real design-system components but stub the async confirm dialog.
vi.mock('../../../design-system', async (importOriginal) => ({
  ...(await importOriginal()),
  confirm: vi.fn(() => Promise.resolve(true)),
}));

import SignoffsSection from '../SignoffsSection';

beforeEach(() => {
  createMutateAsync.mockClear();
  updateMutate.mockClear();
  deleteMutate.mockClear();
  seedMutate.mockClear();
  signoffsState = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
});

describe('SignoffsSection', () => {
  it('renders a skeleton while loading', () => {
    signoffsState = { data: undefined, isLoading: true };
    render(<SignoffsSection dealId="d1" canEdit />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders an error state with Retry', () => {
    const refetch = vi.fn();
    signoffsState = { isError: true, refetch };
    render(<SignoffsSection dealId="d1" canEdit />);
    expect(screen.getByText(/Failed to load the sign-off board/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('shows the empty state + seed button, and seeds on click', () => {
    render(<SignoffsSection dealId="d1" canEdit />);
    expect(screen.getByText(/No sign-offs yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Seed Standard Board/i }));
    expect(seedMutate).toHaveBeenCalledWith({ dealId: 'd1' });
  });

  it('renders rows and marks a signed sign-off with the verified check', () => {
    signoffsState = {
      data: [
        { id: 's1', professional_role: 'architect', scope: 'Form-2', status: 'signed', signed_at: '2026-06-01' },
        { id: 's2', professional_role: 'advocate', scope: 'Title opinion', status: 'requested' },
      ],
      isLoading: false, isError: false,
    };
    render(<SignoffsSection dealId="d1" canEdit />);
    expect(screen.getByText('Architect')).toBeInTheDocument();
    expect(screen.getByText('Advocate')).toBeInTheDocument();
    // The signed row exposes the verified affordance; the requested one does not.
    expect(screen.getByLabelText(/verifies the matching K-RERA item/i)).toBeInTheDocument();
  });

  it('changing a row status calls update with a partial { status }', () => {
    signoffsState = {
      data: [{ id: 's1', professional_role: 'ca', scope: 'Form-1', status: 'requested' }],
      isLoading: false, isError: false,
    };
    render(<SignoffsSection dealId="d1" canEdit />);
    fireEvent.change(screen.getByLabelText('Sign-off status'), { target: { value: 'signed' } });
    expect(updateMutate).toHaveBeenCalledWith({ dealId: 'd1', id: 's1', data: { status: 'signed' } });
  });

  it('deletes a row after confirmation', async () => {
    signoffsState = {
      data: [{ id: 's1', professional_role: 'banker', scope: 'Bank affidavit', status: 'not_started' }],
      isLoading: false, isError: false,
    };
    render(<SignoffsSection dealId="d1" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: /Remove sign-off/i }));
    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith({ dealId: 'd1', id: 's1' }));
  });

  it('view-only mode hides edit controls and shows status as a badge', () => {
    signoffsState = {
      data: [{ id: 's1', professional_role: 'engineer', scope: 'Form-3', status: 'signed' }],
      isLoading: false, isError: false,
    };
    render(<SignoffsSection dealId="d1" canEdit={false} />);
    expect(screen.queryByRole('button', { name: /Add Sign-off/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sign-off status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove sign-off/i })).not.toBeInTheDocument();
    // Status shows as a badge (not a select). Scope to the badge to avoid the
    // "Signed" column header colliding with the badge label.
    expect(screen.getByText('Signed', { selector: '.badge' })).toBeInTheDocument();
  });
});
