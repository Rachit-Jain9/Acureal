import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const useDealReraReadinessMock = vi.fn();
const refetchMock = vi.fn(() => Promise.resolve());
const useDealContextMock = vi.fn(() => ({ dealId: 'deal-1', refetch: refetchMock, workspace: null }));
vi.mock('../../../hooks/useDealContext', () => ({
  useDealContext: (...a) => useDealContextMock(...a),
  useDealReraReadiness: (...a) => useDealReraReadinessMock(...a),
}));

// Mock the API surface — DOCX download + the deal update (project-facts save).
const dealReraReadinessDocxMock = vi.fn();
const dealsUpdateMock = vi.fn(() => Promise.resolve({ data: {} }));
vi.mock('../../../services/api', () => ({
  exportsAPI: { dealReraReadinessDocx: (...a) => dealReraReadinessDocxMock(...a) },
  dealsAPI: { update: (...a) => dealsUpdateMock(...a) },
}));

// Toast mocks
vi.mock('../../common/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import KarnatakaReraReadinessPanel from '../KarnatakaReraReadinessPanel';

beforeEach(() => {
  useDealReraReadinessMock.mockReset();
  dealReraReadinessDocxMock.mockReset();
  dealsUpdateMock.mockClear();
  refetchMock.mockClear();
});

describe('KarnatakaReraReadinessPanel', () => {
  it('renders the not-applicable empty state for non-residential asset classes', () => {
    useDealReraReadinessMock.mockReturnValue({
      applicable: false,
      reason_if_not: 'Commercial office projects are outside K-RERA project-level registration.',
      overall: null,
      buckets: [],
      gaps: [],
    });
    render(<KarnatakaReraReadinessPanel />);
    expect(screen.getByText('K-RERA Readiness Pack')).toBeInTheDocument();
    expect(screen.getByText(/Commercial office projects are outside/)).toBeInTheDocument();
  });

  it('renders nothing when the slice is unavailable (no data, no header)', () => {
    useDealReraReadinessMock.mockReturnValue({
      applicable: false,
      reason_if_not: 'unavailable',
      overall: null,
      buckets: [],
      gaps: [],
    });
    const { container } = render(<KarnatakaReraReadinessPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the readiness card with headline metrics + buckets when applicable', () => {
    useDealReraReadinessMock.mockReturnValue({
      applicable: true,
      reason_if_not: null,
      overall: {
        completeness_pct: 42,
        readiness_tier: 'partial',
        by_status: { verified: 5, uploaded: 4, available: 2, pending: 3, missing: 6 },
        total_items: 20,
      },
      buckets: [
        {
          id: 'title_ownership',
          label: 'Title & Ownership',
          description: 'Title chain, encumbrance, mutation.',
          completeness_pct: 60,
          bucket_status: 'partial',
          total_items: 5,
          items: [
            {
              id: 'title_deed',
              label: 'Authenticated title deed',
              description: 'Registered sale deed.',
              weight: 5,
              evidence: { status: 'verified', source: 'approval', evidence_label: 'Title Deed scan' },
              recommended_action: null,
            },
            {
              id: 'encumbrance_certificate',
              label: 'Encumbrance Certificate (EC)',
              description: '30-year EC.',
              weight: 5,
              evidence: { status: 'missing', source: null },
              recommended_action: 'Obtain a 30-year EC from the sub-registrar.',
            },
          ],
        },
      ],
      gaps: [
        {
          item_id: 'rera_escrow_account',
          item_label: '70% Escrow Bank Account opening letter',
          bucket_label: 'Escrow & Finance',
          weight: 5,
          severity: 'critical',
          recommended_action: 'Open the escrow account at a scheduled bank.',
        },
      ],
      disclaimer: 'This is an organisation aid... not a RERA compliance verdict.',
    });
    render(<KarnatakaReraReadinessPanel />);
    // Header
    expect(screen.getByText('K-RERA Readiness Pack')).toBeInTheDocument();
    // Readiness tier badge
    expect(screen.getByText('Partial')).toBeInTheDocument();
    // Score
    expect(screen.getByText('42')).toBeInTheDocument();
    // Headline metric counts
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
    // Bucket header
    expect(screen.getByText('Title & Ownership')).toBeInTheDocument();
    expect(screen.getByText('(5 items)')).toBeInTheDocument();
    // Top gap surfaces in the gaps section (appears twice: top-gap metric tile + gaps list)
    expect(screen.getAllByText('70% Escrow Bank Account opening letter').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('critical')).toBeInTheDocument();
    // CLAUDE.md disclaimer surfaced
    expect(screen.getByText(/organisation aid/)).toBeInTheDocument();
  });

  it('expanding a bucket reveals individual item rows', () => {
    useDealReraReadinessMock.mockReturnValue({
      applicable: true,
      reason_if_not: null,
      overall: { completeness_pct: 50, readiness_tier: 'partial', by_status: {}, total_items: 1 },
      buckets: [
        {
          id: 'title_ownership',
          label: 'Title & Ownership',
          description: 'Title chain.',
          completeness_pct: 50,
          bucket_status: 'partial',
          total_items: 1,
          items: [
            {
              id: 'title_deed',
              label: 'Authenticated title deed',
              description: 'Registered sale deed.',
              weight: 5,
              evidence: { status: 'verified', source: 'approval', evidence_label: 'Title Deed scan' },
              recommended_action: null,
            },
          ],
        },
      ],
      gaps: [],
      disclaimer: 'Disclaimer.',
    });
    render(<KarnatakaReraReadinessPanel />);
    // Item label hidden until bucket is expanded
    expect(screen.queryByText('Authenticated title deed')).not.toBeInTheDocument();
    // Click the bucket header
    fireEvent.click(screen.getByRole('button', { name: /Title & Ownership/ }));
    expect(screen.getByText('Authenticated title deed')).toBeInTheDocument();
    expect(screen.getByText(/Source: Title Deed scan/)).toBeInTheDocument();
  });

  it('renders the applicability chip and reveals the deterministic rule trace on click', () => {
    useDealReraReadinessMock.mockReturnValue({
      applicable: true,
      reason_if_not: null,
      applicability: {
        status: 'in_scope',
        reason: 'Likely K-RERA in-scope — land area exceeds 500 sqm.',
        rule_trace: [{ text: 'land area 1200 sqm > 500 sqm', result: true }],
        signals: { already_registered: false },
      },
      overall: { completeness_pct: 30, readiness_tier: 'partial', by_status: {}, total_items: 10, blockers: [] },
      buckets: [], gaps: [], fee_estimate: null, milestone: null, disclaimer: 'organisation aid',
    });
    render(<KarnatakaReraReadinessPanel />);
    expect(screen.getByText('In scope')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /In scope/ }));
    expect(screen.getByText(/land area 1200 sqm/)).toBeInTheDocument();
  });

  it('shows the estimated registration fee labelled as an estimate', () => {
    useDealReraReadinessMock.mockReturnValue({
      applicable: true, reason_if_not: null, applicability: null,
      overall: { completeness_pct: 20, readiness_tier: 'early', by_status: {}, total_items: 10, blockers: [] },
      buckets: [], gaps: [],
      fee_estimate: { fee_inr: 12000, category_label: 'Group housing', last_verified: '2026-06-04', source_url: 'https://rera.karnataka.gov.in/', is_overridden: false },
      milestone: null, disclaimer: 'organisation aid',
    });
    render(<KarnatakaReraReadinessPanel />);
    expect(screen.getByText('₹12,000')).toBeInTheDocument();
    expect(screen.getByText(/Estimate only/)).toBeInTheDocument();
  });

  it('renders the fatal-blockers callout and Blocked tier when blocked', () => {
    useDealReraReadinessMock.mockReturnValue({
      applicable: true, reason_if_not: null, applicability: null,
      overall: {
        completeness_pct: 40, readiness_tier: 'blocked', by_status: {}, total_items: 10, is_blocked: true,
        blockers: [{ item_id: 'commencement_certificate', item_label: 'Building Commencement Certificate (BCC)' }],
      },
      buckets: [], gaps: [], fee_estimate: null, milestone: null, disclaimer: 'organisation aid',
    });
    render(<KarnatakaReraReadinessPanel />);
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText(/fatal blocker/i)).toBeInTheDocument();
    expect(screen.getByText('Building Commencement Certificate (BCC)')).toBeInTheDocument();
  });

  it('renders the milestone band', () => {
    useDealReraReadinessMock.mockReturnValue({
      applicable: true, reason_if_not: null, applicability: null,
      overall: { completeness_pct: 20, readiness_tier: 'early', by_status: {}, total_items: 10, blockers: [] },
      buckets: [], gaps: [], fee_estimate: null,
      milestone: { phase: 'registration', derived_from: 'Core plan approval is on file.' },
      disclaimer: 'organisation aid',
    });
    render(<KarnatakaReraReadinessPanel />);
    expect(screen.getByText('Pre-registration')).toBeInTheDocument();
    expect(screen.getByText('Registration')).toBeInTheDocument();
    expect(screen.getByText('Post-registration')).toBeInTheDocument();
  });

  it('saves project facts via dealsAPI.update', async () => {
    useDealReraReadinessMock.mockReturnValue({
      applicable: true, reason_if_not: null, applicability: null,
      overall: { completeness_pct: 10, readiness_tier: 'early', by_status: {}, total_items: 10, blockers: [] },
      buckets: [], gaps: [], fee_estimate: null, milestone: null, disclaimer: 'organisation aid',
    });
    render(<KarnatakaReraReadinessPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Set project facts/ }));
    fireEvent.change(screen.getByPlaceholderText('e.g. 48'), { target: { value: '48' } });
    fireEvent.click(screen.getByRole('button', { name: 'Selling' }));
    fireEvent.click(screen.getByRole('button', { name: /Save facts/ }));
    await waitFor(() =>
      expect(dealsUpdateMock).toHaveBeenCalledWith('deal-1', { reraInputs: { unit_or_plot_count: 48, sale_intent: true } }),
    );
  });
});
