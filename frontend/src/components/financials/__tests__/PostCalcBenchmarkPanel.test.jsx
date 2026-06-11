import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import PostCalcBenchmarkPanel from '../PostCalcBenchmarkPanel';
import * as useBenchmarkBandsHook from '../../../hooks/useBenchmarkBands';

const THRESHOLDS = {
  rbiDscrFloor: 1.20,
  yocVsExitCapMinSpreadBps: 50,
  yocVsExitCapHealthyBps: 200,
  compCoverageMinForBands: 5,
};

function mockBands({ thresholds = THRESHOLDS, isLoading = false } = {}) {
  vi.spyOn(useBenchmarkBandsHook, 'useBenchmarkBands').mockReturnValue({
    data: { thresholds, count: 5, verifiedCount: 5, bands: null, location: null },
    isLoading,
  });
}

describe('PostCalcBenchmarkPanel (PR-NX56)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders NOTHING while bands are loading', () => {
    mockBands({ isLoading: true });
    const { container } = render(
      <PostCalcBenchmarkPanel dealId="d1" kpis={{ dscr: 0.5 }} inputs={{}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders NOTHING when bands never arrived (no thresholds)', () => {
    vi.spyOn(useBenchmarkBandsHook, 'useBenchmarkBands').mockReturnValue({
      data: null,
      isLoading: false,
    });
    const { container } = render(
      <PostCalcBenchmarkPanel dealId="d1" kpis={{ dscr: 0.5 }} inputs={{}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders NOTHING when no KPIs are evaluable (no DSCR, YoC, IRR, or equity multiple)', () => {
    mockBands();
    const { container } = render(
      <PostCalcBenchmarkPanel dealId="d1" kpis={{}} inputs={{}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  // ── Fundamental-economics floor (2026-06-11) — works for non-income deals ──
  it('renders the negative-IRR critical chip for a residential deal (no DSCR/YoC)', () => {
    mockBands();
    render(
      <PostCalcBenchmarkPanel dealId="d1" kpis={{ irr: -4.2, equityMultiple: 1.4 }} inputs={{}} />,
    );
    expect(screen.getByText(/Underwriting Benchmarks/i)).toBeInTheDocument();
    expect(screen.getByText(/Negative IRR/i)).toBeInTheDocument();
  });

  it('renders the capital-destruction chip when equity multiple is below 1.0×', () => {
    mockBands();
    render(
      <PostCalcBenchmarkPanel dealId="d1" kpis={{ irr: 3.1, equityMultiple: 0.85 }} inputs={{}} />,
    );
    expect(screen.getByText(/0\.85× — below 1\.0×/i)).toBeInTheDocument();
  });

  it('renders the ALL-CLEAR pill for a healthy residential deal (positive IRR, EM ≥ 1.0×)', () => {
    mockBands();
    render(
      <PostCalcBenchmarkPanel dealId="d1" kpis={{ irr: 18, equityMultiple: 2.1 }} inputs={{}} />,
    );
    expect(screen.getByText(/Underwriting benchmarks · all clear/i)).toBeInTheDocument();
  });

  it('renders quiet ALL-CLEAR pill when DSCR + spread are within band', () => {
    mockBands();
    render(
      <PostCalcBenchmarkPanel
        dealId="d1"
        kpis={{ dscr: 1.65, yieldOnCost: 9.5, exitCapRate: 7.5 }}
        inputs={{}}
      />,
    );
    expect(screen.getByText(/Underwriting benchmarks · all clear/i)).toBeInTheDocument();
  });

  it('renders the DSCR warning when kernel DSCR is below floor', () => {
    mockBands();
    render(
      <PostCalcBenchmarkPanel
        dealId="d1"
        kpis={{ dscr: 1.05 }}
        inputs={{}}
      />,
    );
    expect(screen.getByText(/Underwriting Benchmarks/i)).toBeInTheDocument();
    expect(screen.getAllByText(/DSCR 1\.05×/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/below RBI Master Direction floor of 1\.20×/i)).toBeInTheDocument();
  });

  it('renders BOTH warnings when DSCR + YoC both trip', () => {
    mockBands();
    render(
      <PostCalcBenchmarkPanel
        dealId="d1"
        kpis={{ dscr: 0.85, yieldOnCost: 6.5, exitCapRate: 7.5 }}
        inputs={{}}
      />,
    );
    expect(screen.getByText(/2 flags on kernel output/i)).toBeInTheDocument();
    expect(screen.getByText(/does NOT cover annual debt service/i)).toBeInTheDocument();
    expect(screen.getByText(/Negative YoC vs Exit Cap spread/i)).toBeInTheDocument();
  });

  it('shows singular "1 flag" copy when only one warning fires', () => {
    mockBands();
    render(
      <PostCalcBenchmarkPanel
        dealId="d1"
        kpis={{ dscr: 1.05 }}
        inputs={{}}
      />,
    );
    expect(screen.getByText(/1 flag on kernel output/i)).toBeInTheDocument();
  });
});
