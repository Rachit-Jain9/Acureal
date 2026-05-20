import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The strip reads the radar via useRiskRadar — mock it for a deterministic,
// offline test.
const useRiskRadarMock = vi.fn();
vi.mock('../../../hooks/useRiskFlags', () => ({
  useRiskRadar: (...a) => useRiskRadarMock(...a),
}));

import RiskRadarStrip from '../RiskRadarStrip';

const RADAR = {
  generated_at: '2026-05-20T00:00:00.000Z',
  overall_posture: 'flagged',
  categories: [
    { key: 'title_ownership', posture: 'flagged' },
    { key: 'approvals_regulatory', posture: 'unverified' },
    { key: 'financial', posture: 'cleared' },
    { key: 'physical_technical', posture: 'unverified' },
    { key: 'market', posture: 'unverified' },
  ],
};

const renderStrip = () =>
  render(
    <MemoryRouter>
      <RiskRadarStrip dealId="deal-1" />
    </MemoryRouter>
  );

beforeEach(() => useRiskRadarMock.mockReset());

describe('RiskRadarStrip', () => {
  it('renders the five failure modes and links to the Risk tab', () => {
    useRiskRadarMock.mockReturnValue({ data: RADAR, isLoading: false, isError: false });
    renderStrip();
    for (const label of ['Title', 'Approvals', 'Financial', 'Physical', 'Market']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('Cleared')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/dashboard/deals/deal-1?tab=risk'
    );
  });

  it('shows a skeleton while the radar is loading', () => {
    useRiskRadarMock.mockReturnValue({ isLoading: true });
    const { container } = renderStrip();
    expect(container.querySelector('.redip-skeleton')).not.toBeNull();
    expect(screen.queryByText('Title')).toBeNull();
  });

  it('renders nothing on error — stays quiet on the deal front page', () => {
    useRiskRadarMock.mockReturnValue({ isError: true });
    const { container } = renderStrip();
    expect(container.firstChild).toBeNull();
  });
});
