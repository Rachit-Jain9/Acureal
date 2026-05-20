import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// The widget fetches /api/admin/extraction-quality via adminAPI — mock it so
// the test is deterministic and offline.
const getExtractionQualityMock = vi.fn();
vi.mock('../../../services/api', () => ({
  adminAPI: {
    getExtractionQuality: (...a) => getExtractionQualityMock(...a),
  },
}));

import ExtractionQualityWidget from '../ExtractionQualityWidget';

const SAMPLE = {
  available: true,
  window_days: 90,
  overall: { reviewed: 20, corrected: 5, accuracy_pct: 75 },
  by_field: [
    { doc_type: 'sale_deed', field_key: 'consideration_inr', reviewed: 10, corrected: 4, accuracy_pct: 60 },
    { doc_type: 'sale_deed', field_key: 'survey_number', reviewed: 10, corrected: 1, accuracy_pct: 90 },
  ],
  generated_at: '2026-05-20T00:00:00.000Z',
};

beforeEach(() => {
  getExtractionQualityMock.mockReset();
  getExtractionQualityMock.mockResolvedValue({ data: { data: SAMPLE } });
});

describe('ExtractionQualityWidget', () => {
  it('renders the per-field accuracy table once loaded', async () => {
    render(<ExtractionQualityWidget days={90} />);
    expect(await screen.findByText('75.0%')).toBeInTheDocument();
    expect(screen.getByText('consideration_inr')).toBeInTheDocument();
    expect(screen.getByText('survey_number')).toBeInTheDocument();
    expect(screen.getByText('60.0%')).toBeInTheDocument();
    expect(getExtractionQualityMock).toHaveBeenCalledWith(90);
  });

  it('shows a setup message when accuracy data is not yet available', async () => {
    getExtractionQualityMock.mockResolvedValue({
      data: {
        data: {
          available: false,
          window_days: 90,
          overall: { reviewed: 0, corrected: 0, accuracy_pct: null },
          by_field: [],
        },
      },
    });
    render(<ExtractionQualityWidget days={90} />);
    expect(await screen.findByText(/being set up/i)).toBeInTheDocument();
  });

  it('shows an empty state when no reviews are recorded yet', async () => {
    getExtractionQualityMock.mockResolvedValue({
      data: {
        data: {
          available: true,
          window_days: 30,
          overall: { reviewed: 0, corrected: 0, accuracy_pct: null },
          by_field: [],
        },
      },
    });
    render(<ExtractionQualityWidget days={30} />);
    expect(await screen.findByText(/No extraction reviews recorded/i)).toBeInTheDocument();
  });

  it('shows an error state when the request fails', async () => {
    getExtractionQualityMock.mockRejectedValue(new Error('network'));
    render(<ExtractionQualityWidget days={90} />);
    expect(
      await screen.findByText(/Couldn't load extraction accuracy/i)
    ).toBeInTheDocument();
  });
});
