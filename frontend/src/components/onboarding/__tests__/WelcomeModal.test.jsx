import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WelcomeModal from '../WelcomeModal';
import { WELCOME_PANES } from '../tourSteps';

const noop = () => {};

describe('WelcomeModal', () => {
  it('opens on the first welcome pane', () => {
    render(<WelcomeModal open onStartTour={noop} onSkip={noop} />);
    expect(screen.getByText(WELCOME_PANES[0].title)).toBeInTheDocument();
  });

  it('advances through panes when Next is clicked', () => {
    render(<WelcomeModal open onStartTour={noop} onSkip={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText(WELCOME_PANES[1].title)).toBeInTheDocument();
    // The middle pane is the one with bullets — they should all render.
    WELCOME_PANES[1].bullets.forEach((bullet) => {
      expect(screen.getByText(bullet)).toBeInTheDocument();
    });
  });

  it('walks back via the Back button', () => {
    render(<WelcomeModal open onStartTour={noop} onSkip={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText(WELCOME_PANES[0].title)).toBeInTheDocument();
  });

  it('calls onStartTour from the final pane', () => {
    const onStartTour = vi.fn();
    render(<WelcomeModal open onStartTour={onStartTour} onSkip={noop} />);
    // Advance to the final pane.
    for (let i = 0; i < WELCOME_PANES.length - 1; i++) {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    }
    expect(
      screen.getByText(WELCOME_PANES[WELCOME_PANES.length - 1].title),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /take the tour/i }));
    expect(onStartTour).toHaveBeenCalledTimes(1);
  });

  it('calls onSkip when the user clicks "Skip — I\'ll explore"', () => {
    const onSkip = vi.fn();
    render(<WelcomeModal open onStartTour={noop} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole('button', { name: /skip — i'll explore/i }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
