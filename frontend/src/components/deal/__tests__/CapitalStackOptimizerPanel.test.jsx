import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const useDealCapitalStackMock = vi.fn();
vi.mock('../../../hooks/useDealContext', () => ({
  useDealCapitalStack: (...a) => useDealCapitalStackMock(...a),
}));

import CapitalStackOptimizerPanel from '../CapitalStackOptimizerPanel';

beforeEach(() => {
  useDealCapitalStackMock.mockReset();
});

describe('CapitalStackOptimizerPanel', () => {
  it('renders the no-asset-class empty state honestly', () => {
    useDealCapitalStackMock.mockReturnValue({ scenarios: [], reason: 'no_asset_class' });
    render(<CapitalStackOptimizerPanel />);
    expect(screen.getByText('Capital-Stack Optimizer')).toBeInTheDocument();
    expect(screen.getByText(/Set an asset class/)).toBeInTheDocument();
  });

  it('renders the no-financial-model empty state when the kernel has not run', () => {
    useDealCapitalStackMock.mockReturnValue({ scenarios: [], reason: 'no_financial_model' });
    render(<CapitalStackOptimizerPanel />);
    expect(screen.getByText(/Run the financial model/)).toBeInTheDocument();
  });

  it('renders the incomplete-kernel-output state when total cost is missing', () => {
    useDealCapitalStackMock.mockReturnValue({ scenarios: [], reason: 'incomplete_kernel_output' });
    render(<CapitalStackOptimizerPanel />);
    expect(screen.getByText(/incomplete kernel output/)).toBeInTheDocument();
  });

  it('renders nothing when the slice is unavailable', () => {
    useDealCapitalStackMock.mockReturnValue({ scenarios: [], reason: 'unavailable' });
    const { container } = render(<CapitalStackOptimizerPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders ranked scenarios with verdict + score + rationale + project context', () => {
    useDealCapitalStackMock.mockReturnValue({
      scenarios: [
        {
          scenario: 'aggressive',
          label: 'Aggressive',
          score: 82,
          band: 'high',
          verdict: 'Recommend',
          mix: { equity_pct: 20, construction_finance_pct: 55, pref_equity_pct: 15, mezz_pct: 10 },
          amounts_cr: { equity: 20, construction_finance: 55, pref_equity: 15, mezz: 10 },
          covenants: {
            ltv: { value: 0.367, threshold: 0.70, passes: true },
            ltc: { value: 0.55, threshold: 0.80, passes: true },
            dscr: { value: 1.70, threshold: 1.25, passes: true },
          },
          blended_cost_of_capital_pct: 15.1,
          rationale: [
            'Aggressive stack: 20% equity / 55% CF / 15% pref / 10% mezz.',
            'LTV 37% ✓ (≤70%); LTC 55% ✓ (≤80%); DSCR 1.70× ✓ (≥1.25×)',
            'blended cost 15.1%',
          ],
          factors: {
            covenant_compliance: { score: 25, of: 25, signal: 'all pass' },
            debt_serviceability: { score: 20, of: 20, signal: 'DSCR cushion' },
            capital_efficiency:  { score: 19, of: 20, signal: '20% equity' },
            cost_of_capital:     { score: 12, of: 20, signal: 'blended 15.1%' },
            flexibility:         { score: 15, of: 15, signal: '4-layer stack' },
          },
        },
        {
          scenario: 'base',
          label: 'Base',
          score: 71,
          band: 'high',
          verdict: 'Consider',
          mix: { equity_pct: 30, construction_finance_pct: 50, pref_equity_pct: 12, mezz_pct: 8 },
          amounts_cr: { equity: 30, construction_finance: 50, pref_equity: 12, mezz: 8 },
          covenants: {
            ltv: { value: 0.333, threshold: 0.65, passes: true },
            ltc: { value: 0.50, threshold: 0.75, passes: true },
            dscr: { value: 1.70, threshold: 1.40, passes: true },
          },
          blended_cost_of_capital_pct: 14.6,
          rationale: [
            'Base stack: 30% equity / 50% CF / 12% pref / 8% mezz.',
            'LTV 33% ✓; LTC 50% ✓; DSCR 1.70× ✓',
            'blended cost 14.6%',
          ],
          factors: {
            covenant_compliance: { score: 25, of: 25, signal: 'all pass' },
            debt_serviceability: { score: 17, of: 20, signal: 'cushion' },
            capital_efficiency:  { score: 16, of: 20, signal: '30% equity' },
            cost_of_capital:     { score: 13, of: 20, signal: '14.6%' },
            flexibility:         { score: 15, of: 15, signal: '4-layer' },
          },
        },
      ],
      inputs: { asset_class: 'residential_apartments', total_cost_cr: 100, gross_sales_value_cr: 150, stabilized_dscr: 1.70 },
      reason: null,
    });
    render(<CapitalStackOptimizerPanel />);
    expect(screen.getByText('Capital-Stack Optimizer')).toBeInTheDocument();
    // Top entry label appears twice (row + Top fit badge)
    expect(screen.getAllByText('Aggressive')).toHaveLength(2);
    expect(screen.getByText('Base')).toBeInTheDocument();
    expect(screen.getByText('Recommend')).toBeInTheDocument();
    expect(screen.getByText('Consider')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('71')).toBeInTheDocument();
    // Inputs context line surfaces total cost + DSCR (DSCR string also
    // appears in rationale, so use getAllByText for the multi-match case).
    expect(screen.getByText(/Project cost ₹100 Cr/)).toBeInTheDocument();
    expect(screen.getAllByText(/DSCR 1\.70×/).length).toBeGreaterThanOrEqual(1);
  });

  it('expanding a scenario reveals the stack mix, covenants, and factor breakdown', () => {
    useDealCapitalStackMock.mockReturnValue({
      scenarios: [
        {
          scenario: 'conservative',
          label: 'Conservative',
          score: 65,
          band: 'medium',
          verdict: 'Consider',
          mix: { equity_pct: 50, construction_finance_pct: 30, pref_equity_pct: 15, mezz_pct: 5 },
          amounts_cr: { equity: 50, construction_finance: 30, pref_equity: 15, mezz: 5 },
          covenants: {
            ltv: { value: 0.20, threshold: 0.55, passes: true },
            ltc: { value: 0.30, threshold: 0.65, passes: true },
            dscr: { value: 1.70, threshold: 1.60, passes: true },
          },
          blended_cost_of_capital_pct: 17.5,
          rationale: ['Conservative stack', 'all covenants pass', 'blended 17.5%'],
          factors: {
            covenant_compliance: { score: 25, of: 25, signal: 'all pass with cushion' },
            debt_serviceability: { score: 11, of: 20, signal: 'DSCR cushion' },
            capital_efficiency:  { score: 10, of: 20, signal: '50% equity tied' },
            cost_of_capital:     { score: 7,  of: 20, signal: 'blended 17.5%' },
            flexibility:         { score: 15, of: 15, signal: '4-layer' },
          },
        },
      ],
      inputs: { total_cost_cr: 100, stabilized_dscr: 1.70 },
      reason: null,
    });
    render(<CapitalStackOptimizerPanel />);
    // Collapsed: factor labels hidden
    expect(screen.queryByText('Covenant compliance')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    // Expanded: capital stack mix, covenant checks, factor labels all visible
    expect(screen.getByText('Capital stack mix')).toBeInTheDocument();
    expect(screen.getByText('Equity')).toBeInTheDocument();
    expect(screen.getByText('Construction Finance')).toBeInTheDocument();
    expect(screen.getByText('Preferred Equity')).toBeInTheDocument();
    expect(screen.getByText('Mezzanine')).toBeInTheDocument();
    expect(screen.getByText('Covenant checks')).toBeInTheDocument();
    expect(screen.getByText('LTV')).toBeInTheDocument();
    expect(screen.getByText('LTC')).toBeInTheDocument();
    expect(screen.getByText('DSCR')).toBeInTheDocument();
    expect(screen.getByText('Covenant compliance')).toBeInTheDocument();
    expect(screen.getByText('Capital efficiency')).toBeInTheDocument();
  });
});
