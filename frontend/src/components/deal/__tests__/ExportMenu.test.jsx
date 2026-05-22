import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExportMenu from '../ExportMenu';

describe('ExportMenu', () => {
  it('renders the Export trigger', () => {
    render(<ExportMenu dealId="d1" dealName="Test deal" />);
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
  });

  it('opens the menu with the three export formats', async () => {
    const user = userEvent.setup();
    render(<ExportMenu dealId="d1" dealName="Test deal" />);
    expect(screen.queryByText('Investor tear-sheet')).toBeNull();
    await user.click(screen.getByRole('button', { name: /export/i }));
    expect(screen.getByText('Investor tear-sheet')).toBeInTheDocument();
    expect(screen.getByText('Investor deck')).toBeInTheDocument();
    expect(screen.getByText('Underwriting report')).toBeInTheDocument();
  });

  it('closes the menu when the trigger is clicked again', async () => {
    const user = userEvent.setup();
    render(<ExportMenu dealId="d1" dealName="Test deal" />);
    const trigger = screen.getByRole('button', { name: /export/i });
    await user.click(trigger);
    expect(screen.getByText('Investor deck')).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.queryByText('Investor deck')).toBeNull();
  });

  it('closes the menu on Escape', async () => {
    const user = userEvent.setup();
    render(<ExportMenu dealId="d1" dealName="Test deal" />);
    await user.click(screen.getByRole('button', { name: /export/i }));
    expect(screen.getByText('Investor deck')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Investor deck')).toBeNull();
  });
});
