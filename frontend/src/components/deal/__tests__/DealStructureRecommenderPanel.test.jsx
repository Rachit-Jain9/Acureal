import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const useDealStructureRecommenderMock = vi.fn();
vi.mock('../../../hooks/useDealContext', () => ({
  useDealStructureRecommender: (...a) => useDealStructureRecommenderMock(...a),
}));

import DealStructureRecommenderPanel from '../DealStructureRecommenderPanel';

beforeEach(() => {
  useDealStructureRecommenderMock.mockReset();
});

describe('DealStructureRecommenderPanel', () => {
  it('renders the no-asset-class empty state honestly', () => {
    useDealStructureRecommenderMock.mockReturnValue({ scores: [], reason: 'no_asset_class' });
    render(<DealStructureRecommenderPanel />);
    expect(screen.getByText('Deal-Structure Recommender')).toBeInTheDocument();
    expect(screen.getByText(/Pick an asset class/)).toBeInTheDocument();
  });

  it('renders nothing when slice is unavailable', () => {
    useDealStructureRecommenderMock.mockReturnValue({ scores: [], reason: 'unavailable' });
    const { container } = render(<DealStructureRecommenderPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders ranked structures with verdict + score + rationale', () => {
    useDealStructureRecommenderMock.mockReturnValue({
      scores: [
        {
          deal_structure: 'outright',
          label: 'Outright',
          score: 82,
          band: 'high',
          verdict: 'Recommend',
          rationale: [
            'Purchase the land, develop, capture full upside / downside.',
            'tight market favours capturing upside',
            'cleared promoter × outright compatibility',
          ],
          factors: {
            structural_validity:    { score: 25, of: 25, signal: 'Compatible with residential_apartments' },
            promoter_compatibility: { score: 25, of: 25, signal: 'cleared promoter × outright' },
            capital_efficiency:     { score: 4,  of: 20, signal: 'high equity tie-up' },
            market_posture:         { score: 14, of: 15, signal: 'tight market favours capturing upside' },
            execution_complexity:   { score: 14, of: 15, signal: 'execution simple' },
          },
        },
        {
          deal_structure: 'jda',
          label: 'Joint Development Agreement',
          score: 64,
          band: 'medium',
          verdict: 'Consider',
          rationale: [
            'Landowner stays on title; developer builds; share revenue / area.',
            'cleared promoter × jda compatibility',
          ],
          factors: {
            structural_validity:    { score: 25, of: 25, signal: 'Compatible with residential_apartments' },
            promoter_compatibility: { score: 22, of: 25, signal: 'cleared × jda' },
            capital_efficiency:     { score: 17, of: 20, signal: 'low equity tie-up — capital-efficient' },
            market_posture:         { score: 8,  of: 15, signal: 'neutral' },
            execution_complexity:   { score: 6,  of: 15, signal: 'execution complex' },
          },
        },
      ],
      reason: null,
    });
    render(<DealStructureRecommenderPanel />);
    expect(screen.getByText('Deal-Structure Recommender')).toBeInTheDocument();
    // Top entry label appears twice (row + Top fit badge)
    expect(screen.getAllByText('Outright')).toHaveLength(2);
    expect(screen.getByText('Joint Development Agreement')).toBeInTheDocument();
    expect(screen.getByText('Recommend')).toBeInTheDocument();
    expect(screen.getByText('Consider')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('64')).toBeInTheDocument();
  });

  it('expanding a row reveals the factor breakdown', () => {
    useDealStructureRecommenderMock.mockReturnValue({
      scores: [
        {
          deal_structure: 'outright',
          label: 'Outright',
          score: 82,
          band: 'high',
          verdict: 'Recommend',
          rationale: ['Outright top fit'],
          factors: {
            structural_validity:    { score: 25, of: 25, signal: 'Compatible' },
            promoter_compatibility: { score: 25, of: 25, signal: 'cleared' },
            capital_efficiency:     { score: 4,  of: 20, signal: 'high equity tie-up' },
            market_posture:         { score: 14, of: 15, signal: 'tight market' },
            execution_complexity:   { score: 14, of: 15, signal: 'simple' },
          },
        },
      ],
      reason: null,
    });
    render(<DealStructureRecommenderPanel />);
    expect(screen.queryByText('Structural validity')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('Structural validity')).toBeInTheDocument();
    expect(screen.getByText('Promoter compatibility')).toBeInTheDocument();
    expect(screen.getByText('Capital efficiency')).toBeInTheDocument();
    expect(screen.getByText('Market posture')).toBeInTheDocument();
    expect(screen.getByText('Execution complexity')).toBeInTheDocument();
  });
});
