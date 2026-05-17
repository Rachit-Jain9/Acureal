import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockHookState = { data: null };
const mockHookFn = vi.fn(() => mockHookState);
vi.mock('../../../hooks/useAutoDeriveParcelContext', () => ({
  default: (...args) => mockHookFn(...args),
}));

import DealAutoDerivedWarningsStrip from '../DealAutoDerivedWarningsStrip';

const renderStrip = (deal) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DealAutoDerivedWarningsStrip deal={deal} />
    </QueryClientProvider>,
  );
};

const warningsPayload = {
  applicableWarnings: [
    { kind: 'Heritage proximity', fact_type: 'heritage', severity: 'high', item_count: 12 },
    { kind: 'SDZ', fact_type: 'sdz', severity: 'medium', item_count: 5 },
    { kind: 'NGT drainage buffer', fact_type: 'environmental', severity: 'high', item_count: 1 },
    { kind: 'Regional park / environmental', fact_type: 'environmental', severity: 'high', item_count: 1 },
    { kind: 'PRR / road alignment', fact_type: 'road_network', severity: 'medium', item_count: 1 },
  ],
};

beforeEach(() => {
  mockHookState.data = null;
  mockHookFn.mockClear();
});

describe('DealAutoDerivedWarningsStrip', () => {
  it('renders nothing when the deal has no address and no coords', () => {
    const { container } = renderStrip({ city: 'Bengaluru' });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for non-Bengaluru deals even when an address is present', () => {
    const { container } = renderStrip({ city: 'Mumbai', address: 'Some Mumbai address' });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the hook returns an empty warnings list', () => {
    mockHookState.data = { applicableWarnings: [] };
    const { container } = renderStrip({ city: 'Bengaluru', address: '100 Brigade Road' });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders up to 4 warning chips + an overflow badge when there are 5', () => {
    mockHookState.data = warningsPayload;
    renderStrip({ city: 'Bengaluru', address: '100 Brigade Road' });
    expect(screen.getByTestId('deal-warnings-strip')).toBeInTheDocument();
    // 4 buttons (the visible chips) + the "+1 more" badge.
    expect(screen.getByText('Heritage proximity')).toBeInTheDocument();
    expect(screen.getByText('SDZ')).toBeInTheDocument();
    expect(screen.getByText('NGT drainage buffer')).toBeInTheDocument();
    expect(screen.getByText('Regional park / environmental')).toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
    // The 5th warning is hidden from chips.
    expect(screen.queryByText('PRR / road alignment')).not.toBeInTheDocument();
  });

  it('shows item_count alongside the kind label when > 1', () => {
    mockHookState.data = warningsPayload;
    renderStrip({ city: 'Bengaluru', address: '100 Brigade Road' });
    expect(screen.getByText('(12)')).toBeInTheDocument(); // Heritage 12 items
    expect(screen.getByText('(5)')).toBeInTheDocument();  // SDZ 5 items
  });

  it('hides chip item_count when count is 1', () => {
    mockHookState.data = {
      applicableWarnings: [{ kind: 'PRR / road alignment', fact_type: 'road_network', item_count: 1 }],
    };
    renderStrip({ city: 'Bengaluru', address: 'X' });
    // The "(1)" suffix should NOT appear.
    expect(screen.queryByText('(1)')).not.toBeInTheDocument();
    expect(screen.getByText('PRR / road alignment')).toBeInTheDocument();
  });

  it('fires the hook only when input is present and city is Bengaluru', () => {
    renderStrip({ city: 'Bengaluru', address: '100 Brigade Road' });
    const lastCall = mockHookFn.mock.calls.at(-1)[0];
    expect(lastCall.enabled).toBe(true);
    expect(lastCall.address).toBe('100 Brigade Road');
  });

  it('does NOT fire the hook for Mumbai deals', () => {
    renderStrip({ city: 'Mumbai', address: 'X' });
    const lastCall = mockHookFn.mock.calls.at(-1)[0];
    expect(lastCall.enabled).toBe(false);
  });
});
