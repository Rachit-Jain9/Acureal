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
        stats={{ avg_irr_pct: null, active_deals_count: 0, total_pipeline_value_cr: 0, at_ic_or_beyond_count: 0 }}
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
        stats={{ avg_irr_pct: 8.5, active_deals_count: 3, total_pipeline_value_cr: 100, at_ic_or_beyond_count: 0 }}
      />,
    );
    expect(screen.getByText(/Below bench/i)).toBeInTheDocument();
  });

  it('shows "Above 20% bench" when avg_irr_pct clears the benchmark', () => {
    render(
      <KpiStripWidget
        stats={{ avg_irr_pct: 24, active_deals_count: 3, total_pipeline_value_cr: 100, at_ic_or_beyond_count: 2 }}
      />,
    );
    expect(screen.getByText(/Above 20% bench/i)).toBeInTheDocument();
  });
});

// REGRESSION — these two tiles read API fields that the backend never sent
// (`ic_ready_count`, `deals_with_open_risks`), so the tile rendered 0 and the
// risk delta never appeared, on every dashboard. The fixtures above fabricated
// the missing keys, which is precisely why the suite stayed green. These pin
// the REAL contract: the field names the API actually produces.
describe('KpiStripWidget — reads the fields the API actually sends', () => {
  it('renders the At-IC count from at_ic_or_beyond_count', () => {
    render(
      <KpiStripWidget
        stats={{
          avg_irr_pct: null,
          active_deals_count: 9,
          total_pipeline_value_cr: 0,
          at_ic_or_beyond_count: 4,
          deals_with_open_risks: 0,
        }}
      />,
    );
    expect(screen.getByText('At IC or beyond')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('renders the open-risk delta from deals_with_open_risks', () => {
    render(
      <KpiStripWidget
        stats={{
          avg_irr_pct: null,
          active_deals_count: 9,
          total_pipeline_value_cr: 0,
          at_ic_or_beyond_count: 0,
          deals_with_open_risks: 3,
        }}
      />,
    );
    expect(screen.getByText('3 with open risk')).toBeInTheDocument();
  });

  it('never claims a vetting judgement the stage-based count does not carry', () => {
    render(
      <KpiStripWidget
        stats={{ avg_irr_pct: null, active_deals_count: 1, total_pipeline_value_cr: 0, at_ic_or_beyond_count: 2 }}
      />,
    );
    expect(screen.queryByText(/fully vetted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ready to deploy/i)).not.toBeInTheDocument();
  });
});
