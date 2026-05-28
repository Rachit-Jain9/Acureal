import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// The standing-quality panel fetches its trend via adminAPI — mock it so
// the test is deterministic and offline.
const getTrendMock = vi.fn();
const runBaselineMock = vi.fn();

vi.mock('../../services/api', () => ({
  adminAPI: {
    getAbEvalQualityTrend: (...a) => getTrendMock(...a),
    runAbEvalBaseline: (...a) => runBaselineMock(...a),
  },
}));
vi.mock('../../components/common/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { QualityTrendPanel } from '../AdminAbEvalPage';

const trendDataRegressed = () => ({
  available: true,
  window_days: 90,
  tasks: {
    // A regressed task — latest 80, trailing baseline 88, delta −8.
    export_insights: {
      available: true,
      run_count: 2,
      series: [],
      latest: { run_id: 'r2', overall: 80, hallucination: 88, tone: 70 },
      baseline_avg: 88,
      delta: -8,
      regression: true,
    },
  },
  generated_at: '2026-05-21T00:00:00Z',
});

const trendDataEmpty = () => ({
  available: true,
  window_days: 90,
  tasks: {
    export_insights: {
      available: true,
      run_count: 0,
      series: [],
      latest: null,
      baseline_avg: null,
      delta: null,
      regression: false,
    },
  },
  generated_at: '2026-05-21T00:00:00Z',
});

beforeEach(() => {
  getTrendMock.mockReset();
  runBaselineMock.mockReset();
  getTrendMock.mockResolvedValue({ data: { data: trendDataRegressed() } });
  runBaselineMock.mockResolvedValue({ data: { data: { status: 'completed' } } });
});

describe('QualityTrendPanel', () => {
  it('renders the section and the monitored task row once loaded', async () => {
    render(<QualityTrendPanel />);
    expect(await screen.findByText('AI quality trend')).toBeInTheDocument();
    expect(screen.getByText('Export deck IC opinion')).toBeInTheDocument();
  });

  it('shows the latest score and a regression badge for a regressed task', async () => {
    render(<QualityTrendPanel />);
    expect(await screen.findByText('80')).toBeInTheDocument();
    expect(screen.getByText(/regression/i)).toBeInTheDocument();
  });

  it('shows an empty state for a task with no baselines', async () => {
    getTrendMock.mockResolvedValue({ data: { data: trendDataEmpty() } });
    render(<QualityTrendPanel />);
    expect(await screen.findByText(/No baseline recorded yet/i)).toBeInTheDocument();
  });

  it('triggers a baseline run for the export_insights task', async () => {
    render(<QualityTrendPanel />);
    const buttons = await screen.findAllByRole('button', { name: /Run baseline/i });
    fireEvent.click(buttons[0]);
    await waitFor(() =>
      expect(runBaselineMock).toHaveBeenCalledWith({ task: 'export_insights' }),
    );
  });

  it('shows a setup message when the eval tables are not migrated', async () => {
    getTrendMock.mockResolvedValue({
      data: { data: { available: false, window_days: 90, tasks: {} } },
    });
    render(<QualityTrendPanel />);
    expect(await screen.findByText(/being set up/i)).toBeInTheDocument();
  });

  it('shows an error state when the trend request fails', async () => {
    getTrendMock.mockRejectedValue(new Error('network'));
    render(<QualityTrendPanel />);
    expect(
      await screen.findByText(/Couldn't load the quality trend/i),
    ).toBeInTheDocument();
  });
});
