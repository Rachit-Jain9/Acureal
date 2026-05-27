import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const useDealIcReadinessMock = vi.fn();
const useDealContextMock = vi.fn(() => ({ dealId: 'deal-1' }));
vi.mock('../../../hooks/useDealContext', () => ({
  useDealContext: (...a) => useDealContextMock(...a),
  useDealIcReadiness: (...a) => useDealIcReadinessMock(...a),
}));

const dealIcReadinessDocxMock = vi.fn();
vi.mock('../../../services/api', () => ({
  exportsAPI: { dealIcReadinessDocx: (...a) => dealIcReadinessDocxMock(...a) },
}));

vi.mock('../../common/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import IcReadinessPanel from '../IcReadinessPanel';

beforeEach(() => {
  useDealIcReadinessMock.mockReset();
  dealIcReadinessDocxMock.mockReset();
});

describe('IcReadinessPanel', () => {
  it('renders nothing when slice has no overall', () => {
    useDealIcReadinessMock.mockReturnValue({ overall: null, buckets: [], gaps: [] });
    const { container } = render(<IcReadinessPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the readiness card with all six headline metrics', () => {
    useDealIcReadinessMock.mockReturnValue({
      applicable: true,
      asset_class: 'residential_apartments',
      deal_name: 'Jigani Apartments',
      overall: {
        completeness_pct: 52,
        readiness_tier: 'pre_ic',
        by_status: { verified: 7, uploaded: 5, available: 3, pending: 4, missing: 11 },
        total_items: 30,
      },
      buckets: [
        {
          id: 'financial_underwriting', label: 'Financial Underwriting',
          description: 'Kernel + KPIs', completeness_pct: 80,
          bucket_status: 'complete', total_items: 7,
          items: [
            { id: 'kernel_ran', label: 'Kernel computed', description: 'Kernel ran', weight: 5,
              evidence: { status: 'verified', source: 'kernel', evidence_label: 'costs + revenue present' },
              recommended_action: null },
          ],
        },
      ],
      gaps: [
        { item_id: 'title_deed', item_label: 'Title deed uploaded', bucket_label: 'Title & Legal',
          weight: 5, severity: 'critical',
          recommended_action: 'Upload the registered title deed' },
      ],
      disclaimer: 'Organisation aid only — not an IC approval.',
    });
    render(<IcReadinessPanel />);
    expect(screen.getByText('IC Readiness Pack')).toBeInTheDocument();
    expect(screen.getByText('Pre-IC')).toBeInTheDocument();
    expect(screen.getByText('52')).toBeInTheDocument();
    expect(screen.getByText(/Seven-bucket inventory/)).toBeInTheDocument();
    expect(screen.getByText('Financial Underwriting')).toBeInTheDocument();
    // "Title deed uploaded" appears twice — Top Gap tile + gaps list.
    expect(screen.getAllByText('Title deed uploaded').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('critical')).toBeInTheDocument();
    expect(screen.getByText('Organisation aid only — not an IC approval.')).toBeInTheDocument();
  });

  it('clicking Download triggers the DOCX export hook', () => {
    useDealIcReadinessMock.mockReturnValue({
      overall: { completeness_pct: 60, readiness_tier: 'pre_ic', by_status: {}, total_items: 30 },
      buckets: [],
      gaps: [],
      deal_name: 'Test Deal',
    });
    dealIcReadinessDocxMock.mockResolvedValue({ data: new Blob() });
    render(<IcReadinessPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Download DOCX/i }));
    expect(dealIcReadinessDocxMock).toHaveBeenCalledWith('deal-1');
  });

  it('expanding a bucket reveals individual item rows', () => {
    useDealIcReadinessMock.mockReturnValue({
      overall: { completeness_pct: 80, readiness_tier: 'ic_ready', by_status: {}, total_items: 1 },
      buckets: [
        {
          id: 'financial_underwriting', label: 'Financial Underwriting',
          description: 'Kernel + KPIs.', completeness_pct: 80,
          bucket_status: 'complete', total_items: 1,
          items: [
            { id: 'kernel_ran', label: 'Kernel computed', description: 'kernel ran',
              weight: 5,
              evidence: { status: 'verified', source: 'kernel', evidence_label: 'costs + revenue present' },
              recommended_action: null },
          ],
        },
      ],
      gaps: [],
      disclaimer: 'Disclaimer.',
    });
    render(<IcReadinessPanel />);
    expect(screen.queryByText('Kernel computed')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Financial Underwriting/i }));
    expect(screen.getByText('Kernel computed')).toBeInTheDocument();
    expect(screen.getByText(/kernel: costs \+ revenue present/)).toBeInTheDocument();
  });
});
