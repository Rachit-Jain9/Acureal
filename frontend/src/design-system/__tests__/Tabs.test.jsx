import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from '../Tabs';

const ITEMS = [
  { id: 'overview', label: 'Overview' },
  { id: 'risk', label: 'Risk' },
  { id: 'comps', label: 'Comps' },
];

describe('Tabs', () => {
  it('renders every tab', () => {
    render(<Tabs items={ITEMS} value="overview" onChange={() => {}} />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
  });

  it('marks the active tab as selected', () => {
    render(<Tabs items={ITEMS} value="risk" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Risk' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'false');
  });

  it('uses a roving tabindex', () => {
    render(<Tabs items={ITEMS} value="risk" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Risk' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('tabindex', '-1');
  });

  it('calls onChange when a tab is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs items={ITEMS} value="overview" onChange={onChange} />);
    await user.click(screen.getByRole('tab', { name: 'Comps' }));
    expect(onChange).toHaveBeenCalledWith('comps');
  });

  it('moves to the next tab on ArrowRight', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs items={ITEMS} value="overview" onChange={onChange} />);
    screen.getByRole('tab', { name: 'Overview' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('risk');
  });

  it('renders a count badge when provided', () => {
    render(
      <Tabs items={[{ id: 'dd', label: 'DD', count: 5 }]} value="dd" onChange={() => {}} />,
    );
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders nothing for an empty item list', () => {
    const { container } = render(<Tabs items={[]} value="" onChange={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
