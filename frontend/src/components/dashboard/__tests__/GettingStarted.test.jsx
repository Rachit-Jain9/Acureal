import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GettingStarted from '../GettingStarted';

function renderPanel(props = {}) {
  return render(
    <MemoryRouter>
      <GettingStarted userName="Test User" role="owner" onDismiss={() => {}} {...props} />
    </MemoryRouter>,
  );
}

describe('GettingStarted', () => {
  it('greets the user by first name only', () => {
    renderPanel({ userName: 'Rachit Jain' });
    expect(screen.getByText('Welcome to REDIP, Rachit.')).toBeInTheDocument();
  });

  it('greets gracefully when no name is available', () => {
    renderPanel({ userName: undefined });
    expect(screen.getByText('Welcome to REDIP.')).toBeInTheDocument();
  });

  it('offers a create-deal step to editors and above with a deep-link to the create modal', () => {
    renderPanel({ role: 'editor' });
    expect(screen.getByText('Create your first deal')).toBeInTheDocument();
    // The CTA deep-links into the create-deal modal directly (via ?new=1
    // — same trigger Cmd-K uses) so the first click lands on the form,
    // not the empty deals list.
    expect(screen.getByRole('link', { name: /new deal/i })).toHaveAttribute(
      'href',
      '/dashboard/deals?new=1',
    );
  });

  it('gives viewers a read-only first step instead', () => {
    renderPanel({ role: 'viewer' });
    expect(screen.queryByText('Create your first deal')).not.toBeInTheDocument();
    expect(screen.getByText('Explore the deal pipeline')).toBeInTheDocument();
  });

  it('shows the workspace-setup step only for admins and owners', () => {
    const { rerender } = renderPanel({ role: 'editor' });
    expect(screen.queryByText('Set up your workspace')).not.toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <GettingStarted userName="Test User" role="admin" onDismiss={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Set up your workspace')).toBeInTheDocument();
  });

  it('calls onDismiss when the skip control is clicked', () => {
    const onDismiss = vi.fn();
    renderPanel({ onDismiss });
    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
