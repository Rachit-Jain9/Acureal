import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DerivedValueChip from '../DerivedValueChip';

describe('DerivedValueChip', () => {
  it('renders the source label as the inline chip text', () => {
    render(<DerivedValueChip source="google" confidence={0.92} />);
    expect(screen.getByTestId('derived-value-chip')).toBeInTheDocument();
    expect(screen.getByText('google')).toBeInTheDocument();
  });

  it('shows the confidence percentage in the inline chip', () => {
    render(<DerivedValueChip source="BBMP street index" confidence={0.55} />);
    expect(screen.getByText('55%')).toBeInTheDocument();
  });

  it('omits the inline confidence when compact=true (popover still shows it)', () => {
    render(<DerivedValueChip source="K-GIS" confidence={0.65} compact />);
    // Inline chip should NOT contain the 65% text
    const chip = screen.getByTestId('derived-value-chip');
    expect(chip.textContent).not.toMatch(/65%/);
    // But hovering opens the popover with the confidence
    fireEvent.mouseEnter(chip.parentElement);
    expect(screen.getByTestId('derived-value-chip-popover')).toBeInTheDocument();
    expect(screen.getByTestId('derived-value-chip-popover').textContent).toMatch(/65%/);
  });

  it('falls back to "derived" when no source is given', () => {
    render(<DerivedValueChip />);
    expect(screen.getByText('derived')).toBeInTheDocument();
  });

  it('opens popover on click and shows Provenance heading', () => {
    render(<DerivedValueChip source="google" confidence={0.92} />);
    expect(screen.queryByTestId('derived-value-chip-popover')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('derived-value-chip'));
    expect(screen.getByTestId('derived-value-chip-popover')).toBeInTheDocument();
    expect(screen.getByText(/Provenance/i)).toBeInTheDocument();
  });

  it('opens popover on hover', () => {
    render(<DerivedValueChip source="google" />);
    const wrapper = screen.getByTestId('derived-value-chip').parentElement;
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByTestId('derived-value-chip-popover')).toBeInTheDocument();
  });

  it('closes popover when Escape is pressed', () => {
    render(<DerivedValueChip source="google" />);
    fireEvent.click(screen.getByTestId('derived-value-chip'));
    expect(screen.getByTestId('derived-value-chip-popover')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('derived-value-chip-popover')).not.toBeInTheDocument();
  });

  it('renders extras inside the popover when provided', () => {
    render(
      <DerivedValueChip
        source="BBMP street index"
        confidence={0.55}
        extras={[
          { label: 'PDF page', value: 23 },
          { label: 'Street', value: 'BRIGADE ROAD' },
          { label: 'Ignored', value: null },  // should be filtered out
          { label: 'EmptyStr', value: '' },   // should be filtered out
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId('derived-value-chip'));
    const popover = screen.getByTestId('derived-value-chip-popover');
    expect(popover.textContent).toMatch(/PDF page/);
    expect(popover.textContent).toMatch(/23/);
    expect(popover.textContent).toMatch(/Street/);
    expect(popover.textContent).toMatch(/BRIGADE ROAD/);
    expect(popover.textContent).not.toMatch(/Ignored/);
    expect(popover.textContent).not.toMatch(/EmptyStr/);
  });

  it('shows "just now" age when derivedAt is within 5 seconds', () => {
    render(<DerivedValueChip source="google" derivedAt={new Date().toISOString()} />);
    fireEvent.click(screen.getByTestId('derived-value-chip'));
    expect(screen.getByText('just now')).toBeInTheDocument();
  });

  it('shows seconds-ago age for derivedAt 30 seconds ago', () => {
    const past = new Date(Date.now() - 30_000).toISOString();
    render(<DerivedValueChip source="google" derivedAt={past} />);
    fireEvent.click(screen.getByTestId('derived-value-chip'));
    expect(screen.getByText(/30s ago/)).toBeInTheDocument();
  });

  it('shows minutes-ago age for derivedAt 5 min ago', () => {
    const past = new Date(Date.now() - 5 * 60_000).toISOString();
    render(<DerivedValueChip source="google" derivedAt={past} />);
    fireEvent.click(screen.getByTestId('derived-value-chip'));
    expect(screen.getByText(/5 min ago/)).toBeInTheDocument();
  });

  it('calls onClick handler when provided', () => {
    const onClick = vi.fn();
    render(<DerivedValueChip source="google" onClick={onClick} />);
    fireEvent.click(screen.getByTestId('derived-value-chip'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies the tone class (warn variant)', () => {
    render(<DerivedValueChip source="google" tone="warn" />);
    const chip = screen.getByTestId('derived-value-chip');
    // tone="warn" maps to amber palette via TONE_CLASS
    expect(chip.className).toMatch(/amber/);
  });

  it('toggles popover open/closed on repeated clicks', () => {
    render(<DerivedValueChip source="google" />);
    const chip = screen.getByTestId('derived-value-chip');
    fireEvent.click(chip);
    expect(screen.getByTestId('derived-value-chip-popover')).toBeInTheDocument();
    fireEvent.click(chip);
    expect(screen.queryByTestId('derived-value-chip-popover')).not.toBeInTheDocument();
  });

  it('does not show confidence row in popover when confidence is null', () => {
    render(<DerivedValueChip source="evidence_facts" confidence={null} />);
    fireEvent.click(screen.getByTestId('derived-value-chip'));
    const popover = screen.getByTestId('derived-value-chip-popover');
    expect(popover.textContent).not.toMatch(/Confidence/);
  });
});
