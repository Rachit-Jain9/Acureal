import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// The panel reads the radar via useRiskRadar — mock that hook so the test
// is deterministic and offline.
const useRiskRadarMock = vi.fn();
vi.mock('../../../hooks/useRiskFlags', () => ({
  useRiskRadar: (...a) => useRiskRadarMock(...a),
}));

import RiskRadarPanel from '../RiskRadarPanel';

const emptyCounts = {
  flags: { total: 0, ever: 0, critical: 0, high: 0, medium: 0, low: 0 },
  diligence: { total: 0, required_total: 0, required_open: 0, completed: 0, flagged: 0 },
  approvals: null,
};

const RADAR = {
  generated_at: '2026-05-20T00:00:00.000Z',
  overall_posture: 'flagged',
  categories: [
    {
      key: 'title_ownership',
      label: 'Title & Ownership',
      posture: 'flagged',
      ...emptyCounts,
      signals: [{ tone: 'negative', text: '1 open risk flag (critical)' }],
    },
    {
      key: 'approvals_regulatory',
      label: 'Approvals & Regulatory',
      posture: 'unverified',
      ...emptyCounts,
      signals: [{ tone: 'warn', text: '2 of 5 required approvals not yet validated' }],
    },
    {
      key: 'financial',
      label: 'Financial',
      posture: 'cleared',
      ...emptyCounts,
      signals: [{ tone: 'positive', text: 'Required diligence complete' }],
    },
    {
      key: 'physical_technical',
      label: 'Physical & Technical',
      posture: 'unverified',
      ...emptyCounts,
      signals: [{ tone: 'warn', text: 'No diligence recorded for this failure mode yet' }],
    },
    {
      key: 'market',
      label: 'Market & Demand',
      posture: 'unverified',
      ...emptyCounts,
      signals: [{ tone: 'warn', text: 'No diligence recorded for this failure mode yet' }],
    },
  ],
};

beforeEach(() => {
  useRiskRadarMock.mockReset();
});

describe('RiskRadarPanel', () => {
  it('renders every failure-mode category with its posture and signals', () => {
    useRiskRadarMock.mockReturnValue({ data: RADAR, isLoading: false, isError: false });
    render(<RiskRadarPanel dealId="deal-1" />);

    expect(screen.getByRole('heading', { name: /Risk Radar/i })).toBeInTheDocument();
    for (const label of [
      'Title & Ownership',
      'Approvals & Regulatory',
      'Financial',
      'Physical & Technical',
      'Market & Demand',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Postures surface as chips.
    expect(screen.getByText('Cleared')).toBeInTheDocument();
    expect(screen.getAllByText('Not verified').length).toBeGreaterThanOrEqual(3);
    // Signals render.
    expect(screen.getByText('1 open risk flag (critical)')).toBeInTheDocument();
    expect(
      screen.getByText('2 of 5 required approvals not yet validated')
    ).toBeInTheDocument();
  });

  it('shows the skeleton while loading and no categories yet', () => {
    useRiskRadarMock.mockReturnValue({ isLoading: true });
    render(<RiskRadarPanel dealId="deal-1" />);
    expect(screen.getByRole('heading', { name: /Risk Radar/i })).toBeInTheDocument();
    expect(screen.queryByText('Title & Ownership')).toBeNull();
  });

  it('shows a retry affordance on error', () => {
    useRiskRadarMock.mockReturnValue({ isError: true, refetch: vi.fn() });
    render(<RiskRadarPanel dealId="deal-1" />);
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });
});
