import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Stub the lazy-loaded ledger so the test doesn't pull in its data hooks —
// the point here is the chip + modal wiring, not the ledger internals.
vi.mock('../../deal/ProvenanceTab', () => ({
  default: () => <div>MOCK_PROVENANCE_LEDGER</div>,
}));

import ProvenanceLedgerChip from '../ProvenanceLedgerChip';

describe('ProvenanceLedgerChip', () => {
  it('renders nothing without a dealId', () => {
    const { container } = render(<ProvenanceLedgerChip dealId={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the one-liner and opens the ledger in a modal only on click', async () => {
    render(<ProvenanceLedgerChip dealId="d-1" />);

    const btn = screen.getByRole('button', { name: /provenance/i });
    expect(btn).toBeInTheDocument();
    expect(screen.getByText(/every figure traced/i)).toBeInTheDocument();

    // Lazy + gated on `open` → the ledger is NOT mounted until the chip is clicked.
    expect(screen.queryByText('MOCK_PROVENANCE_LEDGER')).not.toBeInTheDocument();

    fireEvent.click(btn);
    expect(await screen.findByText('MOCK_PROVENANCE_LEDGER')).toBeInTheDocument();
  });
});
