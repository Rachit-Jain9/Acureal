import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const useDealBestUseMock = vi.fn();
const useDealStructureRecommenderMock = vi.fn();
const useDealCapitalStackMock = vi.fn();
vi.mock('../../../hooks/useDealContext', () => ({
  useDealBestUse: (...a) => useDealBestUseMock(...a),
  useDealStructureRecommender: (...a) => useDealStructureRecommenderMock(...a),
  useDealCapitalStack: (...a) => useDealCapitalStackMock(...a),
}));

// The three nested panels read from the same hooks — when the hooks return
// the appropriate empty-state shapes, the panels themselves will render
// their own empty UIs (which the section header just frames).
import StrategicFitSection from '../StrategicFitSection';

beforeEach(() => {
  useDealBestUseMock.mockReset();
  useDealStructureRecommenderMock.mockReset();
  useDealCapitalStackMock.mockReset();
});

describe('StrategicFitSection', () => {
  it('bows out cleanly when every panel reports unavailable + nothing to show', () => {
    useDealBestUseMock.mockReturnValue({ scores: [], reason: 'unavailable' });
    useDealStructureRecommenderMock.mockReturnValue({ scores: [], reason: 'unavailable' });
    useDealCapitalStackMock.mockReturnValue({ scenarios: [], reason: 'unavailable' });
    const { container } = render(<StrategicFitSection />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the section header + summary strip when at least one panel has data', () => {
    useDealBestUseMock.mockReturnValue({
      scores: [
        { asset_class: 'residential_apartments', label: 'Residential Apartments', verdict: 'Recommend', score: 82, band: 'high', rationale: [], factors: {} },
      ],
      reason: null,
    });
    useDealStructureRecommenderMock.mockReturnValue({ scores: [], reason: 'no_asset_class' });
    useDealCapitalStackMock.mockReturnValue({ scenarios: [], reason: 'no_financial_model' });
    render(<StrategicFitSection />);
    expect(screen.getByText('Strategic Fit Analysis')).toBeInTheDocument();
    expect(screen.getByText(/What to build · How to structure/)).toBeInTheDocument();
    // Top-fit summary chips
    expect(screen.getByText('Best Use:')).toBeInTheDocument();
    expect(screen.getByText('Structure:')).toBeInTheDocument();
    expect(screen.getByText('Capital Stack:')).toBeInTheDocument();
    // The Best Use top fit is rendered with verdict
    expect(screen.getAllByText('Residential Apartments').length).toBeGreaterThanOrEqual(1);
    // Honest empty-state copy for the two unavailable ones
    expect(screen.getByText(/asset class needed/)).toBeInTheDocument();
    expect(screen.getByText(/kernel not run/)).toBeInTheDocument();
  });

  it('collapsing the header hides the nested panels', () => {
    useDealBestUseMock.mockReturnValue({
      scores: [{ asset_class: 'residential_apartments', label: 'Residential Apartments', verdict: 'Recommend', score: 82, band: 'high', rationale: [], factors: {} }],
      reason: null,
    });
    useDealStructureRecommenderMock.mockReturnValue({
      scores: [{ deal_structure: 'outright', label: 'Outright', verdict: 'Recommend', score: 80, band: 'high', mix: {}, rationale: [], factors: {} }],
      reason: null,
    });
    useDealCapitalStackMock.mockReturnValue({
      scenarios: [{ scenario: 'base', label: 'Base', verdict: 'Consider', score: 70, band: 'high', mix: { equity_pct: 30, construction_finance_pct: 50, pref_equity_pct: 12, mezz_pct: 8 }, amounts_cr: {}, covenants: {}, rationale: [], factors: {} }],
      reason: null,
    });
    render(<StrategicFitSection />);
    // All three nested panel headings exist by default
    expect(screen.getByText('Best Use Simulator')).toBeInTheDocument();
    expect(screen.getByText('Deal-Structure Recommender')).toBeInTheDocument();
    expect(screen.getByText('Capital-Stack Optimizer')).toBeInTheDocument();
    // Collapse the section
    fireEvent.click(screen.getByRole('button', { expanded: true }));
    // Nested panel headings disappear; section header stays
    expect(screen.getByText('Strategic Fit Analysis')).toBeInTheDocument();
    expect(screen.queryByText('Best Use Simulator')).not.toBeInTheDocument();
    expect(screen.queryByText('Deal-Structure Recommender')).not.toBeInTheDocument();
    expect(screen.queryByText('Capital-Stack Optimizer')).not.toBeInTheDocument();
  });

  it('reflects all three top-fit verdicts in the summary strip', () => {
    useDealBestUseMock.mockReturnValue({
      scores: [{ asset_class: 'residential_apartments', label: 'Residential Apartments', verdict: 'Recommend', score: 82, band: 'high', rationale: [], factors: {} }],
      reason: null,
    });
    useDealStructureRecommenderMock.mockReturnValue({
      scores: [{ deal_structure: 'outright', label: 'Outright', verdict: 'Consider', score: 65, band: 'medium', rationale: [], factors: {} }],
      reason: null,
    });
    useDealCapitalStackMock.mockReturnValue({
      scenarios: [{ scenario: 'aggressive', label: 'Aggressive', verdict: 'Re-examine', score: 50, band: 'medium', mix: { equity_pct: 20, construction_finance_pct: 55, pref_equity_pct: 15, mezz_pct: 10 }, amounts_cr: {}, covenants: {}, rationale: [], factors: {} }],
      reason: null,
    });
    render(<StrategicFitSection />);
    // The summary chip uses normal-case labels — verdict chips show the value
    // Recommend (Best Use), Consider (Structure), Re-examine (Capital Stack)
    // — these chips are unique to the summary strip vs the nested panels.
    expect(screen.getAllByText('Recommend').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Consider').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Re-examine').length).toBeGreaterThanOrEqual(1);
  });
});
