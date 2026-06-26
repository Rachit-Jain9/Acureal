import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProvenanceCell from '../ProvenanceCell';

describe('ProvenanceCell', () => {
  it('renders source-type chip + Verified pill + freshness for a verified IPC comp', () => {
    render(<ProvenanceCell comp={{ data_type: 'ipc_q1_2026_v0_2_premium_project', is_verified: true, as_of_date: '2026-05-04' }} />);
    expect(screen.getByText('Research report')).toBeTruthy();
    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.getByText('as of 4 May 2026')).toBeTruthy();
  });

  it('shows Unverified WITHOUT the success tone (never green for an unverified row)', () => {
    render(<ProvenanceCell comp={{ source: 'MagicBricks listing', is_verified: false }} />);
    expect(screen.getByText('Listing')).toBeTruthy();
    const pill = screen.getByText('Unverified');
    expect(pill.className).not.toMatch(/badge-success/);
  });

  it('renders the honest unavailable state for an unsourced comp', () => {
    render(<ProvenanceCell comp={{}} />);
    expect(screen.getByText('No verified feed')).toBeTruthy();
  });

  it('wraps the source-type chip in a new-tab link when source_url is present', () => {
    render(<ProvenanceCell comp={{ data_type: 'ipc_q1_2026', is_verified: true, source_url: 'https://example.com/report' }} />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://example.com/report');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
