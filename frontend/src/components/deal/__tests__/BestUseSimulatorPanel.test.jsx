import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The panel reads its data via useDealBestUse — mock the hook for a
// deterministic, offline test.
const useDealBestUseMock = vi.fn();
vi.mock('../../../hooks/useDealContext', () => ({
  useDealBestUse: (...a) => useDealBestUseMock(...a),
}));

import BestUseSimulatorPanel from '../BestUseSimulatorPanel';

beforeEach(() => {
  useDealBestUseMock.mockReset();
});

describe('BestUseSimulatorPanel', () => {
  it('renders the no-coordinates empty state honestly', () => {
    useDealBestUseMock.mockReturnValue({
      classification: { locality_code: null, confidence: null },
      locality: null,
      scores: [],
      reason: 'no_parcel_coordinates',
    });
    render(<BestUseSimulatorPanel />);
    expect(screen.getByText('Best Use Simulator')).toBeInTheDocument();
    expect(screen.getByText(/Add the parcel's coordinates/)).toBeInTheDocument();
  });

  it('renders the outside-seeded-markets empty state when no locality match', () => {
    useDealBestUseMock.mockReturnValue({
      classification: { locality_code: null, confidence: null },
      locality: null,
      scores: [],
      reason: 'no_micro_market_match',
    });
    render(<BestUseSimulatorPanel />);
    expect(screen.getByText(/outside Acureal's seeded Bengaluru micro-markets/)).toBeInTheDocument();
  });

  it('renders nothing when the migration is unavailable', () => {
    useDealBestUseMock.mockReturnValue({
      classification: { locality_code: null, confidence: null },
      locality: null,
      scores: [],
      reason: 'unavailable',
    });
    const { container } = render(<BestUseSimulatorPanel />);
    // No card chrome — the panel quietly bows out
    expect(container.firstChild).toBeNull();
  });

  it('renders ranked asset-class rows with verdict + score + rationale', () => {
    useDealBestUseMock.mockReturnValue({
      classification: { locality_code: 'whitefield-east-orr', confidence: 'high' },
      locality: { locality_code: 'whitefield-east-orr', name: 'Whitefield (East ORR)', tier: 'prime' },
      scores: [
        {
          asset_class: 'residential_apartments',
          label: 'Residential Apartments',
          score: 82,
          band: 'high',
          verdict: 'Recommend',
          rationale: [
            'Whitefield (East ORR): 4 published benchmarks; absorption pressure 0.95 (favorable)',
            'sale rate p50 ₹12,100, band tight (±7%)',
            'price +8% YoY; buyer mix: IT 60%',
          ],
          factors: {
            demand_fit: { score: 25, of: 30, signal: '4 benchmarks; absorption favorable' },
            price_realisability: { score: 25, of: 25, signal: 'sale rate p50 ₹12,100' },
            growth_signal: { score: 12, of: 15, signal: 'price +8% YoY' },
            approval_risk: { score: 9, of: 15, signal: '12-month approval pipeline' },
            capital_intensity: { score: 11, of: 15, signal: '₹4,200/sf typical build cost' },
          },
        },
        {
          asset_class: 'commercial_office',
          label: 'Commercial Office',
          score: 45,
          band: 'medium',
          verdict: 'Re-examine',
          rationale: [
            'Whitefield (East ORR): no demand benchmarks published for this asset class',
            'no office rent benchmark published',
            '₹5,400/sf typical build cost (prime tier)',
          ],
          factors: {
            demand_fit: { score: 0, of: 30, signal: 'no benchmarks' },
            price_realisability: { score: 0, of: 25, signal: 'no benchmark' },
            growth_signal: { score: 0, of: 15, signal: 'no signal' },
            approval_risk: { score: 9, of: 15, signal: '9-month pipeline' },
            capital_intensity: { score: 4, of: 15, signal: '₹5,400/sf' },
          },
        },
      ],
      reason: null,
    });
    render(<BestUseSimulatorPanel />);
    // Header
    expect(screen.getByText('Best Use Simulator')).toBeInTheDocument();
    // Top entry label appears twice — once in the row, once in the "Top fit" badge.
    expect(screen.getAllByText('Residential Apartments')).toHaveLength(2);
    expect(screen.getByText('Commercial Office')).toBeInTheDocument();
    // Verdict chips
    expect(screen.getByText('Recommend')).toBeInTheDocument();
    expect(screen.getByText('Re-examine')).toBeInTheDocument();
    // Score numbers
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    // Top fit badge (lead) — uses the top entry's label
    expect(screen.getByText(/Top fit:/)).toBeInTheDocument();
  });

  it('expanding a row reveals the factor breakdown', () => {
    useDealBestUseMock.mockReturnValue({
      classification: { locality_code: 'whitefield-east-orr', confidence: 'high' },
      locality: { name: 'Whitefield (East ORR)', tier: 'prime' },
      scores: [
        {
          asset_class: 'residential_apartments',
          label: 'Residential Apartments',
          score: 82,
          band: 'high',
          verdict: 'Recommend',
          rationale: ['Whitefield: strong residential demand'],
          factors: {
            demand_fit: { score: 25, of: 30, signal: '4 published benchmarks' },
            price_realisability: { score: 25, of: 25, signal: 'sale rate p50 ₹12,100' },
            growth_signal: { score: 12, of: 15, signal: 'price +8% YoY' },
            approval_risk: { score: 9, of: 15, signal: '12-month pipeline' },
            capital_intensity: { score: 11, of: 15, signal: '₹4,200/sf' },
          },
        },
      ],
      reason: null,
    });
    render(<BestUseSimulatorPanel />);
    // Factor breakdown is hidden by default
    expect(screen.queryByText('Demand fit')).not.toBeInTheDocument();
    // Click the row toggle button
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    // Factor labels are now visible
    expect(screen.getByText('Demand fit')).toBeInTheDocument();
    expect(screen.getByText('Price realisability')).toBeInTheDocument();
    expect(screen.getByText('Growth signal')).toBeInTheDocument();
    expect(screen.getByText('Approval-timeline')).toBeInTheDocument();
    expect(screen.getByText('Capital intensity')).toBeInTheDocument();
    expect(screen.getByText('4 published benchmarks')).toBeInTheDocument();
  });
});
