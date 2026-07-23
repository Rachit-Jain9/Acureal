import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DueDateChip from '../DueDateChip';

// dd_items.due_date had no editor anywhere in the product, so it was NULL on
// every organically-created item — which made the dashboard's "Overdue
// diligence" list, the Deals-list overdue chip and the Risk Radar's overdue
// scoring term structurally unable to fire. These pin the control that fixes it.

const FIXED_NOW = new Date('2026-07-23T10:00:00+05:30');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// Days offset from the fixed "today", as a local ISO day.
const dayOffset = (n) => {
  const d = new Date(FIXED_NOW);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('DueDateChip — unset state', () => {
  it('offers a set-date affordance when editable', () => {
    render(<DueDateChip value={null} onChange={vi.fn()} itemName="Title chain review" />);
    expect(screen.getByRole('button', { name: /set a due date for title chain review/i })).toBeInTheDocument();
  });

  it('renders nothing for a view-only user — no dead affordance', () => {
    const { container } = render(<DueDateChip value={null} onChange={vi.fn()} disabled itemName="X" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('DueDateChip — derived urgency', () => {
  it('reads a past date as overdue, in days', () => {
    render(<DueDateChip value={dayOffset(-3)} onChange={vi.fn()} itemName="Encumbrance certificate" />);
    expect(screen.getByRole('button', { name: /3 days overdue/i })).toBeInTheDocument();
  });

  it('says "Due today" rather than overdue when the date is today', () => {
    // The whole-day comparison matters: a date-only value parses to midnight,
    // so a naive timestamp diff would call an item due today "overdue".
    render(<DueDateChip value={dayOffset(0)} onChange={vi.fn()} itemName="Khata verification" />);
    expect(screen.getByRole('button', { name: /due today/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /overdue/i })).not.toBeInTheDocument();
  });

  it('flags the coming week without shouting about distant dates', () => {
    const { unmount } = render(<DueDateChip value={dayOffset(4)} onChange={vi.fn()} itemName="A" />);
    expect(screen.getByRole('button', { name: /due in 4 days/i })).toBeInTheDocument();
    unmount();

    render(<DueDateChip value={dayOffset(45)} onChange={vi.fn()} itemName="B" />);
    // Far-off dates show the date only — no urgency caption.
    expect(screen.queryByText(/due in/i)).not.toBeInTheDocument();
  });
});

describe('DueDateChip — editing', () => {
  it('clears the date without opening the picker', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();
    render(<DueDateChip value={dayOffset(2)} onChange={onChange} itemName="Survey sketch" />);

    await user.click(screen.getByRole('button', { name: /clear the due date for survey sketch/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('swaps to a native date field when the chip is clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DueDateChip value={null} onChange={vi.fn()} itemName="Title chain review" />);

    await user.click(screen.getByRole('button', { name: /set a due date/i }));
    const input = screen.getByLabelText(/due date for title chain review/i);
    expect(input).toHaveAttribute('type', 'date');
  });

  it('a view-only user cannot open the editor or clear the value', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();
    render(<DueDateChip value={dayOffset(2)} onChange={onChange} disabled itemName="Locked" />);

    expect(screen.queryByRole('button', { name: /clear the due date/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /due/i }));
    expect(screen.queryByLabelText(/due date for locked/i)).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
