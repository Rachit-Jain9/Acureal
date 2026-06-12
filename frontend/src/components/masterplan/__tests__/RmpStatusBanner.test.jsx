import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RmpStatusBanner from '../RmpStatusBanner';

describe('RmpStatusBanner (plan-aware)', () => {
  it('shows the withdrawn-draft caveat by default (no plan)', () => {
    const { getByText } = render(<RmpStatusBanner />);
    expect(getByText(/never legally notified/i)).toBeInTheDocument();
  });

  it('still warns for a Bengaluru RMP 2031 plan version', () => {
    const { getByText } = render(<RmpStatusBanner planVersion="RMP 2031 Draft" />);
    expect(getByText(/never legally notified/i)).toBeInTheDocument();
  });

  it('shows a calm operative note for an Anekal plan (no draft warning)', () => {
    const { getByText, queryByText } = render(
      <RmpStatusBanner planVersion="Anekal LPA MP 2031" planName="Residential (Anekal)" />,
    );
    expect(getByText(/Operative plan: Residential \(Anekal\)/i)).toBeInTheDocument();
    expect(getByText(/Anekal Local Planning Area/i)).toBeInTheDocument();
    expect(queryByText(/never legally notified/i)).toBeNull();
  });

  it('shows a calm operative note for RMP 2015 (no draft warning)', () => {
    const { getByText, queryByText } = render(<RmpStatusBanner planVersion="RMP 2015" />);
    expect(getByText(/Operative plan/i)).toBeInTheDocument();
    expect(getByText(/BDA Local Planning Area/i)).toBeInTheDocument();
    expect(queryByText(/never legally notified/i)).toBeNull();
  });
});
