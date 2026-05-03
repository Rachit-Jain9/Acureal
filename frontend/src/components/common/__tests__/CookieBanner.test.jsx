import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CookieBanner from '../CookieBanner';

describe('CookieBanner', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders on first visit when no dismissal stored', async () => {
    render(<CookieBanner />);
    // The banner uses requestAnimationFrame to mount; flush via vi.waitFor.
    const region = await screen.findByRole('region', { name: /Cookie notice/i });
    expect(region).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Learn more/i })).toHaveAttribute('href', '/cookies');
  });

  it('persists dismissal in localStorage when "Got it" is clicked', async () => {
    render(<CookieBanner />);
    const got = await screen.findByRole('button', { name: /Got it/i });
    fireEvent.click(got);
    expect(localStorage.getItem('cookie_notice_dismissed')).toBe('v1');
    expect(screen.queryByRole('region', { name: /Cookie notice/i })).toBeNull();
  });

  it('stays hidden on subsequent renders after dismissal', () => {
    localStorage.setItem('cookie_notice_dismissed', 'v1');
    render(<CookieBanner />);
    expect(screen.queryByRole('region', { name: /Cookie notice/i })).toBeNull();
  });
});
