import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PageIntro from '../PageIntro';

beforeEach(() => {
  window.localStorage.clear();
});

describe('PageIntro', () => {
  it('shows the topic intro on first visit', () => {
    render(<PageIntro topicId="deals" />);
    expect(screen.getByRole('button', { name: /more in the guide/i })).toBeInTheDocument();
  });

  it('renders nothing for an unknown topic', () => {
    const { container } = render(<PageIntro topicId="does-not-exist" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the Guide to this topic via the event', () => {
    const handler = vi.fn();
    window.addEventListener('redip:guide-open', handler);
    render(<PageIntro topicId="comps" />);
    fireEvent.click(screen.getByRole('button', { name: /more in the guide/i }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ topicId: 'comps' });
    window.removeEventListener('redip:guide-open', handler);
  });

  it('dismisses and stays hidden on the next visit', () => {
    const { unmount } = render(<PageIntro topicId="reports" />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByRole('button', { name: /more in the guide/i })).toBeNull();
    unmount();
    render(<PageIntro topicId="reports" />);
    expect(screen.queryByRole('button', { name: /more in the guide/i })).toBeNull();
  });
});
