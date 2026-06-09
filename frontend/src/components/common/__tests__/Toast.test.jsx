import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import ToastContainer, { useToastStore, toast } from '../Toast';

describe('Toast a11y', () => {
  beforeEach(() => {
    act(() => {
      useToastStore.setState({ toasts: [] });
    });
  });

  test('renders nothing when there are no toasts', () => {
    render(<ToastContainer />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('non-error toast announces with role="status" + aria-live="polite"', () => {
    render(<ToastContainer />);
    act(() => {
      toast.success('Saved');
    });
    const node = screen.getByRole('status');
    expect(node).toHaveAttribute('aria-live', 'polite');
    expect(node).toHaveTextContent('Saved');
  });

  test('error toast announces with role="alert" + aria-live="assertive"', () => {
    render(<ToastContainer />);
    act(() => {
      toast.error('Save failed');
    });
    const node = screen.getByRole('alert');
    expect(node).toHaveAttribute('aria-live', 'assertive');
    expect(node).toHaveTextContent('Save failed');
  });

  test('dismiss button has an accessible label', () => {
    render(<ToastContainer />);
    act(() => {
      toast.info('Hello');
    });
    expect(screen.getByLabelText('Dismiss notification')).toBeInTheDocument();
  });

  test('enters with the slide-in animation class', () => {
    render(<ToastContainer />);
    act(() => {
      toast.success('Saved');
    });
    expect(screen.getByRole('status').className).toContain('redip-toast-in');
  });
});
