import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock both compute paths so neither the real kernel (@redip/kernel-browser)
// nor the axios client loads in the test env — we only assert the routing +
// envelope-unwrap + error-shaping contract of runQuickCompute.
vi.mock('../clientKernel', () => ({
  clientQuickCompute: vi.fn(),
  useClientKernel: vi.fn(),
}));
vi.mock('../../services/api', () => ({
  financialsAPI: { quickCompute: vi.fn() },
}));

import { runQuickCompute } from '../quickCompute';
import { clientQuickCompute, useClientKernel } from '../clientKernel';
import { financialsAPI } from '../../services/api';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runQuickCompute', () => {
  it('uses the in-browser kernel and returns the unwrapped data when the flag is on', async () => {
    useClientKernel.mockReturnValue(true);
    clientQuickCompute.mockReturnValue({
      success: true,
      data: { kpis: { irr: 14 }, engineVersion: 'v2-client' },
    });

    const out = await runQuickCompute({ assetClass: 'residential_apartments', sellingRatePerSqft: 12000 });

    expect(out).toEqual({ kpis: { irr: 14 }, engineVersion: 'v2-client' });
    expect(clientQuickCompute).toHaveBeenCalledTimes(1);
    // No HTTP round-trip on the client path — this is what unblocks viewers
    // (the server endpoint is admin|analyst-gated) and saves the fan-out.
    expect(financialsAPI.quickCompute).not.toHaveBeenCalled();
  });

  it('throws an axios-shaped error when the client kernel rejects the inputs', async () => {
    useClientKernel.mockReturnValue(true);
    clientQuickCompute.mockReturnValue({ success: false, status: 422, message: 'unsupported asset class' });

    await expect(runQuickCompute({ assetClass: 'nope' })).rejects.toMatchObject({
      message: 'unsupported asset class',
      response: { status: 422, data: { message: 'unsupported asset class' } },
    });
    expect(financialsAPI.quickCompute).not.toHaveBeenCalled();
  });

  it('falls back to the server endpoint and unwraps data.data when the flag is off', async () => {
    useClientKernel.mockReturnValue(false);
    financialsAPI.quickCompute.mockResolvedValue({ data: { data: { kpis: { irr: 15 } } } });

    const out = await runQuickCompute({ assetClass: 'commercial_office' });

    expect(out).toEqual({ kpis: { irr: 15 } });
    expect(financialsAPI.quickCompute).toHaveBeenCalledTimes(1);
    expect(clientQuickCompute).not.toHaveBeenCalled();
  });
});
