import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let ledgerState;
const chainMutate = vi.fn();

vi.mock('../../../hooks/useDealContext', () => ({
  useDealContext: () => ({ dealId: 'd-1' }),
}));
vi.mock('../../../hooks/useProvenance', () => ({
  useDealEvidenceLedger: () => ledgerState,
}));
vi.mock('../../../hooks/useDealEvents', () => ({
  useVerifyDealChain: () => ({ mutateAsync: chainMutate, isPending: false }),
}));

import ProvenanceTab from '../ProvenanceTab';

const LEDGER = {
  available: true,
  dealId: 'd-1',
  dealName: 'Test Deal',
  engineVersion: 'kernel-v2',
  computedAt: '2026-07-17T00:00:00.000Z',
  groups: [
    {
      category: 'Returns',
      claims: [
        { key: 'irr', label: 'Project IRR', value: 18.4, unit: 'pct', source: { type: 'kernel', label: 'REDIP deterministic kernel', detail: 'kernel v2' }, traced: true },
        { key: 'npv', label: 'NPV', value: 42.1, unit: 'inr_cr', source: { type: 'kernel', label: 'REDIP deterministic kernel', detail: 'kernel v2' }, traced: true },
      ],
    },
    {
      category: 'Key assumptions',
      claims: [
        { key: 'sellRate', label: 'Sell rate', value: 9500, unit: 'inr_per_sqft', source: { type: 'analyst', label: 'Set for this deal', detail: 'analyst entered' }, traced: true },
      ],
    },
  ],
  summary: { total: 3, traced: 3, byType: { kernel: 2, analyst: 1 } },
  generatedAt: '2026-07-18T00:00:00.000Z',
};

beforeEach(() => {
  chainMutate.mockReset();
  ledgerState = { data: LEDGER, isLoading: false, isError: false };
});

describe('ProvenanceTab', () => {
  it('renders the traced ledger — groups, claims, values and typed source pills', () => {
    render(<ProvenanceTab />);
    expect(screen.getByText('Provenance')).toBeInTheDocument();
    expect(screen.getByText(/every one traced/i)).toBeInTheDocument();
    expect(screen.getByText('Returns')).toBeInTheDocument();
    expect(screen.getByText('Key assumptions')).toBeInTheDocument();
    expect(screen.getByText('Project IRR')).toBeInTheDocument();
    expect(screen.getByText('Sell rate')).toBeInTheDocument();
    // typed source pills carry the honest origin label
    expect(screen.getAllByText('REDIP deterministic kernel').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Set for this deal')).toBeInTheDocument();
    // formatted values
    expect(screen.getByText('18.4%')).toBeInTheDocument();
  });

  it('offers a cryptographic seal that verifies the whole signed chain', async () => {
    chainMutate.mockResolvedValueOnce({ total_events: 2, verified: 2, failed: 0, all_verified: true, key_available: true });
    render(<ProvenanceTab />);
    expect(screen.getByText('Cryptographic seal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Verify computations/i }));
    expect(await screen.findByText(/2 computations verified/i)).toBeInTheDocument();
  });

  it('hides the seal button when there are no kernel-signed figures', () => {
    ledgerState = {
      data: { ...LEDGER, summary: { total: 1, traced: 1, byType: { analyst: 1 } }, groups: [LEDGER.groups[1]] },
      isLoading: false,
      isError: false,
    };
    render(<ProvenanceTab />);
    expect(screen.getByText('Cryptographic seal')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Verify computations/i })).not.toBeInTheDocument();
    expect(screen.getByText(/run the financial model/i)).toBeInTheDocument();
  });

  it('shows an honest empty state when the ledger is unavailable', () => {
    ledgerState = { data: { available: false }, isLoading: false, isError: false };
    render(<ProvenanceTab />);
    expect(screen.getByText(/No provenance to trace yet/i)).toBeInTheDocument();
  });

  it('embedded: drops the redundant section header (the modal supplies it) but keeps the ledger', () => {
    render(<ProvenanceTab embedded />);
    // The "Chain of custody" eyebrow + the standalone header sub are gone…
    expect(screen.queryByText('Chain of custody')).not.toBeInTheDocument();
    // …but the traced ledger and its groups still render.
    expect(screen.getByText(/every one traced/i)).toBeInTheDocument();
    expect(screen.getByText('Returns')).toBeInTheDocument();
    expect(screen.getByText('Project IRR')).toBeInTheDocument();
  });
});
