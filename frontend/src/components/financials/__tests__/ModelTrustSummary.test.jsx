import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockConf = { data: undefined, isLoading: false };

vi.mock('../../../hooks/useFinancials', () => ({
  useModelConfidence: () => mockConf,
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

const renderPanel = () =>
  render(
    <MemoryRouter>
      <ModelTrustSummary dealId="d-1" />
    </MemoryRouter>,
  );

beforeEach(() => {
  mockConf.data = undefined;
  mockConf.isLoading = false;
});

describe('ModelTrustSummary (Workstream A — Model Confidence)', () => {
  it('shows a skeleton while the signal loads', () => {
    mockConf.isLoading = true;
    const { container } = renderPanel();
    expect(container.querySelector('.redip-skeleton')).not.toBeNull();
  });

  it('renders nothing when the confidence signal is unavailable', () => {
    mockConf.data = { available: false };
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the confidence headline and band', () => {
    mockConf.data = confData();
    renderPanel();
    expect(screen.getByText('Model Trust')).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText('Mixed basis')).toBeInTheDocument();
    expect(screen.getByText(/of 10 key inputs set for this deal/i)).toBeInTheDocument();
  });

  it('links to the full confidence breakdown on the financials page', () => {
    mockConf.data = confData();
    renderPanel();
    expect(
      screen.getByRole('link', { name: /full confidence breakdown/i }),
    ).toHaveAttribute('href', '/dashboard/financials/d-1');
  });
});
