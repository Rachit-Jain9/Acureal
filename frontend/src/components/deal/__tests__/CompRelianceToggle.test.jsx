import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CompRelianceToggle from '../CompRelianceToggle';

describe('CompRelianceToggle (Workstream C1)', () => {
  it('renders an unpressed toggle when the comp is not relied on', () => {
    render(<CompRelianceToggle relied={false} onToggle={() => {}} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).not.toBeDisabled();
  });

  it('renders a pressed toggle when the comp is relied on', () => {
    render(<CompRelianceToggle relied onToggle={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<CompRelianceToggle relied={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('is disabled and does not fire onToggle while a toggle is pending', () => {
    const onToggle = vi.fn();
    render(<CompRelianceToggle relied={false} onToggle={onToggle} isPending />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
