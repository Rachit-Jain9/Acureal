import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { confirm, ConfirmDialogContainer, useConfirmStore } from '../ConfirmDialog';

// The container has to be mounted somewhere for the confirm() promise to
// resolve via UI interaction — pop it into the test DOM once per test.
function mount() {
  return render(<ConfirmDialogContainer />);
}

beforeEach(() => {
  // Reset the singleton store so leftover state from a previous test can't
  // bleed across (the store has module-scoped state).
  useConfirmStore.setState({ pending: null });
});

afterEach(() => {
  cleanup();
});

describe('ConfirmDialog primitive', () => {
  it('returns null when nothing is pending', () => {
    const { container } = mount();
    // The container renders nothing (no dialog, no portal node) until
    // confirm() is called.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens a dialog with the supplied title + message when confirm() is called', async () => {
    mount();
    let promise;
    act(() => {
      promise = confirm({
        title: 'Delete this comp?',
        message: 'This cannot be undone.',
      });
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete this comp?')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    // Resolve to keep the test environment clean.
    act(() => { useConfirmStore.getState().resolveCurrent(false); });
    await promise;
  });

  it('resolves to true when the user clicks the confirm button', async () => {
    const user = userEvent.setup();
    mount();
    let promise;
    act(() => {
      promise = confirm({ title: 'Save changes?', confirmLabel: 'Save' });
    });
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /save/i }));
    await expect(promise).resolves.toBe(true);
  });

  it('resolves to false when the user clicks cancel', async () => {
    const user = userEvent.setup();
    mount();
    let promise;
    act(() => {
      promise = confirm({ title: 'Discard draft?', cancelLabel: 'Keep editing' });
    });
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /keep editing/i }));
    await expect(promise).resolves.toBe(false);
  });

  it('uses Cancel / Confirm as default button labels', async () => {
    mount();
    let promise;
    act(() => { promise = confirm({ title: 'Proceed?' }); });
    await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    act(() => { useConfirmStore.getState().resolveCurrent(false); });
    await promise;
  });

  it('renders the confirm button with danger styling when tone="danger"', async () => {
    mount();
    let promise;
    act(() => {
      promise = confirm({
        title: 'Delete forever?',
        tone: 'danger',
        confirmLabel: 'Delete',
      });
    });
    await screen.findByRole('dialog');
    const deleteBtn = screen.getByRole('button', { name: 'Delete' });
    // The Button primitive's `danger` variant applies the `bg-data-negative`
    // class — assert against it rather than the rendered color so the test
    // doesn't break if the design system swaps Tailwind tokens.
    expect(deleteBtn.className).toMatch(/bg-data-negative/);
    act(() => { useConfirmStore.getState().resolveCurrent(false); });
    await promise;
  });

  it('a non-danger tone uses the primary button (not danger)', async () => {
    mount();
    let promise;
    act(() => {
      promise = confirm({ title: 'Continue?', tone: 'warn', confirmLabel: 'Yes' });
    });
    await screen.findByRole('dialog');
    const yesBtn = screen.getByRole('button', { name: 'Yes' });
    expect(yesBtn.className).toMatch(/bg-accent/);
    expect(yesBtn.className).not.toMatch(/bg-data-negative/);
    act(() => { useConfirmStore.getState().resolveCurrent(false); });
    await promise;
  });

  it('supports multiline messages via whitespace-pre-line', async () => {
    mount();
    let promise;
    act(() => {
      promise = confirm({
        title: 'Disable 2FA?',
        message: 'Your account will only require a password.\nProceed?',
      });
    });
    await screen.findByRole('dialog');
    // The full multi-line text should be present in the DOM as a single
    // node (whitespace-pre-line lets the newline survive into the layout).
    const msg = screen.getByText(/Your account will only require a password/);
    expect(msg.textContent).toContain('\nProceed?');
    act(() => { useConfirmStore.getState().resolveCurrent(false); });
    await promise;
  });
});
