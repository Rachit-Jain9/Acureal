import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import UrgencyStrip from '../UrgencyStrip';

const daysAgoIso = (n) => new Date(Date.now() - n * 86400000).toISOString();

describe('UrgencyStrip', () => {
  it('renders nothing for a clean deal — no overdue, no recent risk, recent activity', () => {
    const { container } = render(
      <UrgencyStrip deal={{
        overdue_dd_count: 0,
        new_risk_flag_count: 0,
        last_activity_date: daysAgoIso(2),
      }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the overdue-DD pill with item count + pluralisation', () => {
    render(<UrgencyStrip deal={{ overdue_dd_count: 3, new_risk_flag_count: 0 }} />);
    expect(screen.getByText('3 overdue DD')).toBeInTheDocument();
  });

  it('shows the new-risks pill in singular for exactly one flag', () => {
    render(<UrgencyStrip deal={{ overdue_dd_count: 0, new_risk_flag_count: 1 }} />);
    expect(screen.getByText('1 new risk')).toBeInTheDocument();
  });

  it('pluralises new-risks for more than one', () => {
    render(<UrgencyStrip deal={{ overdue_dd_count: 0, new_risk_flag_count: 4 }} />);
    expect(screen.getByText('4 new risks')).toBeInTheDocument();
  });

  it('shows the stale pill when last_activity_date is older than 14 days', () => {
    render(<UrgencyStrip deal={{
      overdue_dd_count: 0,
      new_risk_flag_count: 0,
      last_activity_date: daysAgoIso(22),
    }} />);
    expect(screen.getByText('22d quiet')).toBeInTheDocument();
  });

  it('falls back to updated_at when last_activity_date is missing', () => {
    render(<UrgencyStrip deal={{
      overdue_dd_count: 0,
      new_risk_flag_count: 0,
      updated_at: daysAgoIso(30),
    }} />);
    expect(screen.getByText('30d quiet')).toBeInTheDocument();
  });

  it('does NOT show the stale pill at the threshold boundary (exactly 14 days)', () => {
    render(<UrgencyStrip deal={{
      overdue_dd_count: 0,
      new_risk_flag_count: 0,
      last_activity_date: daysAgoIso(14),
    }} />);
    // > 14 not >= 14
    expect(screen.queryByText(/quiet/)).not.toBeInTheDocument();
  });

  it('shows all three signals together when the deal qualifies for all', () => {
    render(<UrgencyStrip deal={{
      overdue_dd_count: 5,
      new_risk_flag_count: 2,
      last_activity_date: daysAgoIso(20),
    }} />);
    expect(screen.getByText('5 overdue DD')).toBeInTheDocument();
    expect(screen.getByText('2 new risks')).toBeInTheDocument();
    expect(screen.getByText('20d quiet')).toBeInTheDocument();
  });
});
