import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../hooks/useDealContext', () => ({
  useDealContext: () => ({ dealId: 'deal-123' }),
  useDealRecord: () => ({
    id: 'deal-123',
    name: 'Hebbal Mixed Use',
    stage: 'screening',
    deal_type: 'acquisition',
    financials: {
      total_cost_cr: 100,
      total_revenue_cr: 140,
      gross_margin_pct: 28,
      gross_profit_cr: 40,
      irr_pct: 24,
      npv_cr: 12,
      equity_multiple: 1.8,
      developer_profit_cr: 18,
    },
    stage_history: [],
    recent_activities: [],
    next_steps: [],
    key_risks: [],
  }),
}));

vi.mock('../../../services/api', () => ({
  intelligenceAPI: {
    getDealAnalysis: vi.fn(),
  },
}));

vi.mock('../BuildabilitySummary', () => ({
  default: () => null,
}));

import OverviewTab from '../OverviewTab';

describe('OverviewTab', () => {
  it('links to the financial model with the context deal id', () => {
    render(
      <MemoryRouter>
        <OverviewTab />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /full model/i })).toHaveAttribute(
      'href',
      '/dashboard/financials/deal-123',
    );
  });
});
