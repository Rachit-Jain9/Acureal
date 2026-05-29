import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PageHeader from '../PageHeader';

describe('PageHeader', () => {
  it('renders title + description + actions (canonical prop names)', () => {
    render(
      <PageHeader
        title="Audit Trail"
        description="Every kernel run, HMAC-signed."
        actions={<button type="button">Refresh</button>}
      />,
    );
    expect(screen.getByText('Audit Trail')).toBeInTheDocument();
    expect(screen.getByText('Every kernel run, HMAC-signed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('accepts the SectionHeader-style `sub` alias as the caption', () => {
    // Four admin pages were copy-pasted with `sub=` and silently dropped
    // their subtitle until PageHeader learned this alias.
    render(<PageHeader title="Learning Signals" sub="Per-rule verdict counts." />);
    expect(screen.getByText('Per-rule verdict counts.')).toBeInTheDocument();
  });

  it('accepts the `right` alias for the trailing control', () => {
    // AdminAbEvalPage passed its Refresh button as `right=` — it never showed
    // until this alias was added.
    render(<PageHeader title="A/B Evaluations" right={<button type="button">Refresh</button>} />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('prefers description over sub when both are given', () => {
    render(<PageHeader title="X" description="canonical" sub="legacy" />);
    expect(screen.getByText('canonical')).toBeInTheDocument();
    expect(screen.queryByText('legacy')).not.toBeInTheDocument();
  });
});
