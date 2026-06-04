import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SectionHeader } from '../index';

describe('SectionHeader helpTopic', () => {
  it('renders no help button without helpTopic', () => {
    render(<SectionHeader title="Plain section" />);
    expect(screen.queryByRole('button', { name: /open the guide/i })).toBeNull();
  });

  it('opens the Guide to the topic when the help button is clicked', () => {
    const handler = vi.fn();
    window.addEventListener('redip:guide-open', handler);
    render(<SectionHeader title="Financial Model Summary" helpTopic="deal.financial-model" />);
    fireEvent.click(screen.getByRole('button', { name: /what is financial model summary/i }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ topicId: 'deal.financial-model' });
    window.removeEventListener('redip:guide-open', handler);
  });
});
