import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardHero from '../DashboardHero';

describe('DashboardHero', () => {
  it('renders the live pipeline eyebrow + the four KPI tiles', () => {
    render(
      <DashboardHero
        stats={{
          total_pipeline_value_cr: 812.5,
          active_deals_count: 18,
          avg_irr_pct: 22.4,
          ic_ready_count: 5,
          deals_with_open_risks: 2,
        }}
      />,
    );
    expect(screen.getByText('Pipeline · live')).toBeInTheDocument();
    expect(screen.getByText('Active deals')).toBeInTheDocument();
    expect(screen.getByText('Avg IRR')).toBeInTheDocument();
    expect(screen.getByText('Open high risks')).toBeInTheDocument();
    expect(screen.getByText('Investor-grade')).toBeInTheDocument();
  });

  it('tags IRR at/above bench when >= 12%', () => {
    render(<DashboardHero stats={{ avg_irr_pct: 18 }} />);
    expect(screen.getByText('At or above bench')).toBeInTheDocument();
  });

  it('flags IRR below benchmark when < 12%', () => {
    render(<DashboardHero stats={{ avg_irr_pct: -2.4 }} />);
    expect(screen.getByText('Below benchmark')).toBeInTheDocument();
  });

  it('shows an honest em-dash + neutral note when IRR is missing (never a confident 0%)', () => {
    render(<DashboardHero stats={{ avg_irr_pct: null }} />);
    expect(screen.getByText('No modelled IRR yet')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/0%/)).toBeNull();
  });
});
