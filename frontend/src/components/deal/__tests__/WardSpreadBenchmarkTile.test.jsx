import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockHookState = { data: null, isFetching: false };
const mockHookFn = vi.fn(() => mockHookState);
vi.mock('../../../hooks/useWardSpreadBenchmark', () => ({
  default: (...args) => mockHookFn(...args),
}));

import WardSpreadBenchmarkTile from '../WardSpreadBenchmarkTile';

const renderTile = (props = {}) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WardSpreadBenchmarkTile propertyId="prop-1" {...props} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  mockHookState.data = null;
  mockHookState.isFetching = false;
  mockHookFn.mockClear();
});

describe('WardSpreadBenchmarkTile', () => {
  it('renders nothing when propertyId is missing', () => {
    const { container } = renderTile({ propertyId: undefined });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an honest "not ready" hint when ward is not derived', () => {
    mockHookState.data = { ok: false, reason: 'ward_not_derived', ward_no: null };
    renderTile();
    const empty = screen.getByTestId('ward-spread-empty');
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toMatch(/Ward benchmark not ready/i);
    // Text spans multiple DOM nodes (span wrappers for emphasis); assert
    // against the full textContent rather than a single text-node match.
    expect(empty.textContent).toMatch(/click.*Derive.*Apply on the AutoFillCard/i);
  });

  it('renders insufficient-data hint when sample < 3', () => {
    mockHookState.data = { ok: false, reason: 'insufficient_data', ward_no: 117, sample_size: 2 };
    renderTile();
    expect(screen.getByTestId('ward-spread-empty')).toBeInTheDocument();
    expect(screen.getByText(/Ward 117 benchmark/i)).toBeInTheDocument();
    expect(screen.getByText(/only 2 other deals/i)).toBeInTheDocument();
  });

  it('renders the percentile distribution + sample size when data is ok', () => {
    mockHookState.data = {
      ok: true,
      ward_no: 117,
      sample_size: 8,
      median_spread_pct: 17.6,
      p25_spread_pct: 5.9,
      p75_spread_pct: 29.4,
      min_spread_pct: -5.9,
      max_spread_pct: 41.2,
      samples: [],
    };
    renderTile();
    expect(screen.getByTestId('ward-spread-benchmark-tile')).toBeInTheDocument();
    expect(screen.getByText(/Ward 117 benchmark/i)).toBeInTheDocument();
    expect(screen.getByText(/8 comparable deals/i)).toBeInTheDocument();
    expect(screen.getByTestId('ward-spread-median')).toHaveTextContent('+17.6%');
    expect(screen.getByTestId('ward-spread-p25')).toHaveTextContent('+5.9%');
    expect(screen.getByTestId('ward-spread-p75')).toHaveTextContent('+29.4%');
  });

  it('shows "within band" when current deal spread is between p25 and p75', () => {
    mockHookState.data = {
      ok: true, ward_no: 117, sample_size: 5,
      median_spread_pct: 20, p25_spread_pct: 10, p75_spread_pct: 30,
      min_spread_pct: 0, max_spread_pct: 40, samples: [],
    };
    renderTile({ currentDealSpreadPct: 18 });
    expect(screen.getByText(/Within the typical ward band/i)).toBeInTheDocument();
    // delta = 18 - 20 = -2pp
    expect(screen.getByText(/-2.0pp/)).toBeInTheDocument();
  });

  it('shows "pricier than 75%" when current deal spread is above p75', () => {
    mockHookState.data = {
      ok: true, ward_no: 117, sample_size: 5,
      median_spread_pct: 20, p25_spread_pct: 10, p75_spread_pct: 30,
      min_spread_pct: 0, max_spread_pct: 40, samples: [],
    };
    renderTile({ currentDealSpreadPct: 50 });
    expect(screen.getByText(/Pricier than 75% of ward deals/i)).toBeInTheDocument();
    expect(screen.getByText(/\+30.0pp/)).toBeInTheDocument();
  });

  it('shows "better priced than 75%" when current deal spread is below p25', () => {
    mockHookState.data = {
      ok: true, ward_no: 117, sample_size: 5,
      median_spread_pct: 20, p25_spread_pct: 10, p75_spread_pct: 30,
      min_spread_pct: 0, max_spread_pct: 40, samples: [],
    };
    renderTile({ currentDealSpreadPct: 5 });
    expect(screen.getByText(/Better priced than 75% of ward deals/i)).toBeInTheDocument();
  });

  it('hides the deal-vs-ward comparison when currentDealSpreadPct is null', () => {
    mockHookState.data = {
      ok: true, ward_no: 117, sample_size: 5,
      median_spread_pct: 20, p25_spread_pct: 10, p75_spread_pct: 30,
      min_spread_pct: 0, max_spread_pct: 40, samples: [],
    };
    renderTile({ currentDealSpreadPct: null });
    expect(screen.queryByText(/vs ward median/i)).not.toBeInTheDocument();
  });
});
