import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WelcomeModal from '../WelcomeModal';

const noop = () => {};
const next = () => fireEvent.click(screen.getByRole('button', { name: /^next$/i }));

beforeEach(() => {
  window.localStorage.clear();
});

describe('WelcomeModal', () => {
  it('opens on the welcome scene', () => {
    render(<WelcomeModal open onStartTour={noop} onSkip={noop} />);
    expect(screen.getByText(/welcome to redip/i)).toBeInTheDocument();
  });

  it('advances through the scenes with Next', () => {
    render(<WelcomeModal open onStartTour={noop} onSkip={noop} />);
    next();
    expect(screen.getByText(/why redip earns your trust/i)).toBeInTheDocument();
    next();
    expect(screen.getByText(/where will you spend most of your time/i)).toBeInTheDocument();
    next();
    expect(screen.getByText(/here.s your starting point/i)).toBeInTheDocument();
  });

  it('walks back via the Back button', () => {
    render(<WelcomeModal open onStartTour={noop} onSkip={noop} />);
    next();
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText(/welcome to redip/i)).toBeInTheDocument();
  });

  it('records a personalisation choice (aria-pressed toggles)', () => {
    render(<WelcomeModal open onStartTour={noop} onSkip={noop} />);
    next();
    next();
    const option = screen.getByRole('button', { name: /run diligence & underwriting/i });
    expect(option).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(option);
    expect(option).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('redip.welcome.focus')).toBe('diligence');
  });

  it('starts the tour from the final scene', () => {
    const onStartTour = vi.fn();
    render(<WelcomeModal open onStartTour={onStartTour} onSkip={noop} />);
    next();
    next();
    next();
    fireEvent.click(screen.getByRole('button', { name: /take the 2-min tour/i }));
    expect(onStartTour).toHaveBeenCalledTimes(1);
  });

  it('calls onSkip from the skip control', () => {
    const onSkip = vi.fn();
    render(<WelcomeModal open onStartTour={noop} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
