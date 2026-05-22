import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Button from '../Button';

describe('Button', () => {
  it('renders its label', () => {
    render(<Button>Save deal</Button>);
    expect(screen.getByRole('button', { name: 'Save deal' })).toBeInTheDocument();
  });

  it('defaults to type="button"', () => {
    render(<Button>x</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('applies the primary variant surface', () => {
    render(<Button variant="primary">Go</Button>);
    expect(screen.getByRole('button').className).toMatch(/bg-accent/);
  });

  it('applies the danger variant surface', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button').className).toMatch(/bg-data-negative/);
  });

  it('applies the requested size class', () => {
    render(<Button size="lg">Big</Button>);
    expect(screen.getByRole('button').className).toMatch(/px-5/);
  });

  it('shows a spinner and disables itself while loading', () => {
    const { container } = render(<Button loading>Saving</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('fires onClick when enabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Click</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders as a different element via `as`', () => {
    render(<Button as="a" href="#x">Link</Button>);
    const el = screen.getByText('Link').closest('a');
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe('A');
  });

  it('forwards a ref to the underlying element', () => {
    const ref = { current: null };
    render(<Button ref={ref}>x</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
