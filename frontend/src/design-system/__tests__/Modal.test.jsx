import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../Modal';

// Flush the enter-animation requestAnimationFrame inside act() so its
// resulting setState doesn't trip React's "not wrapped in act" warning.
const settle = () =>
  act(async () => {
    await new Promise((resolve) => { requestAnimationFrame(() => resolve()); });
  });

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={() => {}} title="Hidden">body</Modal>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a dialog when open', async () => {
    render(<Modal open onClose={() => {}} title="Edit deal">body text</Modal>);
    await settle();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Edit deal')).toBeInTheDocument();
    expect(screen.getByText('body text')).toBeInTheDocument();
  });

  it('links the dialog to its title via aria-labelledby', async () => {
    render(<Modal open onClose={() => {}} title="Edit deal">body</Modal>);
    await settle();
    const labelId = screen.getByRole('dialog').getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId)).toHaveTextContent('Edit deal');
  });

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Edit deal">body</Modal>);
    await settle();
    await user.click(screen.getByRole('button', { name: /close dialog/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Edit deal">body</Modal>);
    await settle();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('renders footer content', async () => {
    render(
      <Modal open onClose={() => {}} title="Edit deal" footer={<button type="button">Save</button>}>
        body
      </Modal>,
    );
    await settle();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
