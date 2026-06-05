import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// vi.hoisted so the spy is available inside the (hoisted) vi.mock factory.
const { dealPack } = vi.hoisted(() => ({ dealPack: vi.fn() }));
vi.mock('../../../services/api', () => ({
  exportsAPI: {
    dealPdf: vi.fn(() => Promise.resolve({ data: new Blob(['x']), headers: {} })),
    dealPptx: vi.fn(() => Promise.resolve({ data: new Blob(['x']), headers: {} })),
    dealDocx: vi.fn(() => Promise.resolve({ data: new Blob(['x']), headers: {} })),
    dealPack,
  },
}));
vi.mock('../../../utils/download', () => ({ downloadAxiosResponse: vi.fn() }));
vi.mock('../../common/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ExportMenu from '../ExportMenu';

beforeEach(() => {
  dealPack.mockReset();
  dealPack.mockResolvedValue({ data: new Blob(['x']), headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } });
});

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

  it('shows the Audience packs group with lender / investor / buyer', async () => {
    const user = userEvent.setup();
    render(<ExportMenu dealId="d1" dealName="Test deal" />);
    await user.click(screen.getByRole('button', { name: /export/i }));
    expect(screen.getByText('Audience packs')).toBeInTheDocument();
    expect(screen.getByText('Lender pack')).toBeInTheDocument();
    expect(screen.getByText('Investor pack')).toBeInTheDocument();
    expect(screen.getByText('Buyer pack')).toBeInTheDocument();
  });

  it('clicking a pack calls the parameterized pack export', async () => {
    const user = userEvent.setup();
    render(<ExportMenu dealId="d1" dealName="Test deal" />);
    await user.click(screen.getByRole('button', { name: /export/i }));
    await user.click(screen.getByText('Lender pack'));
    expect(dealPack).toHaveBeenCalledWith('d1', 'lender');
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
