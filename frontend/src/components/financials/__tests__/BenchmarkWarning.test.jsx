import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import BenchmarkWarning from '../BenchmarkWarning';

describe('BenchmarkWarning (PR-NX52)', () => {
  it('renders NOTHING when warning is null', () => {
    const { container } = render(<BenchmarkWarning warning={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders NOTHING when warning is undefined', () => {
    const { container } = render(<BenchmarkWarning warning={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders warn-tone with amber icon + label + detail when severity=warn', () => {
    render(
      <BenchmarkWarning
        warning={{
          severity: 'warn',
          label: 'Above 95th percentile of nearby comps',
          detail: 'Sell rate ₹15,000/sqft exceeds p95 ₹12,000/sqft.',
        }}
      />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Above 95th percentile of nearby comps/i)).toBeInTheDocument();
    expect(screen.getByText(/exceeds p95/i)).toBeInTheDocument();
  });

  it('renders critical-tone with red icon when severity=critical', () => {
    render(
      <BenchmarkWarning
        warning={{
          severity: 'critical',
          label: 'DSCR 0.85× — does NOT cover annual debt service',
          detail: 'NOI ₹5 Cr cannot service annual debt ₹6 Cr.',
        }}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.className).toMatch(/data-negative/);
    expect(screen.getByText(/DSCR 0\.85× — does NOT cover/i)).toBeInTheDocument();
  });

  it('renders without detail line when only label is provided', () => {
    render(<BenchmarkWarning warning={{ severity: 'warn', label: 'Only label' }} />);
    expect(screen.getByText('Only label')).toBeInTheDocument();
  });
});
