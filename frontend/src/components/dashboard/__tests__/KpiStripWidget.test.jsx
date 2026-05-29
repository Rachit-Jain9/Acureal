import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiStripWidget } from '../DashboardWidgets';

// Assertions target the STATIC benchmark delta tags + the em-dash, not the
// count-up-animated IRR number (which advances via rAF and is unreliable in
// jsdom).
describe('KpiStripWidget — Avg IRR honesty', () => {
  it('shows "—" and no benchmark tag when avg_irr_pct is null (no modelled deals)', () => {
    render(
      <KpiStripWidget
        stats={{ avg_irr_pct: null, active_deals_count: 0, total_pipeline_value_cr: 0, ic_ready_count: 0 }}
      />,
    );
    expect(screen.getByText('Avg IRR')).toBeInTheDocument();
    // The honesty bug: a null IRR used to render a confident "0.0% · Below bench".
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
    expect(screen.queryByText(/Below bench/i)).not.toBeInTheDocument();
    // The Avg IRR tile renders an em-dash instead.
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows "Below bench" when avg_irr_pct is a real, low number', () => {
    render(
      <KpiStripWidget
        stats={{ avg_irr_pct: 8.5, active_deals_count: 3, total_pipeline_value_cr: 100, ic_ready_count: 0 }}
      />,
    );
    expect(screen.getByText(/Below bench/i)).toBeInTheDocument();
  });

  it('shows "Above 20% bench" when avg_irr_pct clears the benchmark', () => {
    render(
      <KpiStripWidget
        stats={{ avg_irr_pct: 24, active_deals_count: 3, total_pipeline_value_cr: 100, ic_ready_count: 2 }}
      />,
    );
    expect(screen.getByText(/Above 20% bench/i)).toBeInTheDocument();
  });
});
