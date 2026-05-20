import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockConf = { data: undefined, isLoading: false };
const mockRange = { data: undefined, isLoading: false };

vi.mock('../../../hooks/useFinancials', () => ({
  useModelConfidence: () => mockConf,
  useConfidenceRange: () => mockRange,
}));

import ModelTrustSummary from '../ModelTrustSummary';

const confData = (o = {}) => ({
  available: true,
  confidencePct: 62,
  band: 'mixed',
  dealSetCount: 6,
  defaultCount: 4,
  total: 10,
  ...o,
});

const rangeData = (o = {}) => ({
  available: true,
  primaryKpi: 'irr',
  unverifiedCount: 4,
  kpis: [
    { key: 'irr', label: 'IRR', unit: 'pct', base: 18.4, low: 14.2, high: 21.9, swing: 7.7 },
    { key: 'npv', label: 'NPV', unit: 'inr_cr', base: 24.1, low: 12, high: 33.5, swing: 21.5 },
  ],
  drivers: [],
  ...o,
});

const renderPanel = () =>
  render(
    <MemoryRouter>
      <ModelTrustSummary dealId="d-1" />
    </MemoryRouter>,
  );

beforeEach(() => {
  mockConf.data = undefined;
  mockConf.isLoading = false;
  mockRange.data = undefined;
  mockRange.isLoading = false;
});

describe('ModelTrustSummary (Workstream A)', () => {
  it('shows a skeleton while either signal loads', () => {
    mockConf.isLoading = true;
    const { container } = renderPanel();
    expect(container.querySelector('.redip-skeleton')).not.toBeNull();
  });

  it('renders nothing when both signals are unavailable', () => {
    mockConf.data = { available: false };
    mockRange.data = { available: false };
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the confidence headline, band and KPI ranges', () => {
    mockConf.data = confData();
    mockRange.data = rangeData();
    renderPanel();
    expect(screen.getByText('Model Trust')).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText('Mixed basis')).toBeInTheDocument();
    expect(screen.getByText(/of 10 key inputs set for this deal/i)).toBeInTheDocument();
    expect(screen.getByText(/Headline numbers/i)).toBeInTheDocument();
    expect(screen.getByText('18.4%')).toBeInTheDocument();
  });

  it('shows the positive state when nothing is unverified', () => {
    mockConf.data = confData({ confidencePct: 100, band: 'grounded' });
    mockRange.data = rangeData({
      unverifiedCount: 0,
      kpis: [
        { key: 'irr', label: 'IRR', unit: 'pct', base: 18.4, low: 18.4, high: 18.4, swing: 0 },
      ],
    });
    renderPanel();
    expect(
      screen.getByText(/Every key assumption is set for this deal/i),
    ).toBeInTheDocument();
  });

  it('renders with only the confidence signal available', () => {
    mockConf.data = confData();
    mockRange.data = { available: false };
    renderPanel();
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.queryByText(/Headline numbers/i)).not.toBeInTheDocument();
  });

  it('links to the full confidence breakdown on the financials page', () => {
    mockConf.data = confData();
    mockRange.data = rangeData();
    renderPanel();
    expect(
      screen.getByRole('link', { name: /full confidence breakdown/i }),
    ).toHaveAttribute('href', '/dashboard/financials/d-1');
  });
});
