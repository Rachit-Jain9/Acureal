import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Tier-1 #4 — RiskTab. Focused on the AI risk-brief panel: cached
// renders, Copy + Download buttons, expand/collapse. We only stub the
// hooks the brief surface depends on.

// PR-NX72 (2026-05-19) — RiskTab no longer calls useRiskFlags / useRiskScore
// directly; those reads come from the shared workspace cache via
// useDealRedFlags + useDealRiskScore. Mocks updated to reflect the new
// dependency surface.
const useCreateRiskFlagFn = vi.fn(() => ({ mutateAsync: vi.fn() }));
const useUpdateRiskFlagFn = vi.fn(() => ({ mutateAsync: vi.fn() }));
const useDeleteRiskFlagFn = vi.fn(() => ({ mutate: vi.fn() }));
const useRunInconsistencyCheckFn = vi.fn(() => ({ mutate: vi.fn(), isPending: false }));
const useRiskBriefFn = vi.fn();

const downloadMarkdownFn = vi.fn();
const copyToClipboardFn = vi.fn();
const buildArtifactFilenameFn = vi.fn(() => 'whitefield-plot-22-risk-brief-2026-05-09.md');

vi.mock('../../../hooks/useRiskFlags', () => ({
  // PR-NX72: useRiskFlags + useRiskScore no longer consumed by RiskTab —
  // mocks for those hooks are dropped. Keep mutation + brief hooks.
  useCreateRiskFlag: (...args) => useCreateRiskFlagFn(...args),
  useUpdateRiskFlag: (...args) => useUpdateRiskFlagFn(...args),
  useDeleteRiskFlag: (...args) => useDeleteRiskFlagFn(...args),
  useRunInconsistencyCheck: (...args) => useRunInconsistencyCheckFn(...args),
  useRiskBrief: (...args) => useRiskBriefFn(...args),
}));

// PR-NX72: useDealContext now provides isLoading/isError/refetch (shared
// workspace state). useDealRedFlags + useDealRiskScore are the selector
// hooks RiskTab reads from.
vi.mock('../../../hooks/useDealContext', () => ({
  useDealContext: () => ({ dealId: 'd-1', isLoading: false, isError: false, refetch: vi.fn() }),
  useDealRecord: () => ({ name: 'Whitefield Plot 22' }),
  useDealRedFlags: () => [],
  useDealRiskScore: () => null,
}));

// PR-NX47 (2026-05-19) — the new RiskNarrativePanel mounted at the top
// of RiskTab calls useRiskNarrative. Mock it as a no-op (available:
// false) so the existing brief-panel tests don't see the new panel.
vi.mock('../../../hooks/useRiskNarrative', () => ({
  useRiskNarrative: () => ({
    data: { available: false, reason: 'no risks logged' },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }),
}));

// Workstream B — the RiskRadarPanel mounted at the top of RiskTab is its own
// component with its own test; stub it so these brief-panel tests stay
// focused (and so they don't need a QueryClient for useRiskRadar).
vi.mock('../RiskRadarPanel', () => ({ default: () => null }));

vi.mock('../../../utils/downloadMarkdown', () => ({
  downloadMarkdown: (...args) => downloadMarkdownFn(...args),
  copyMarkdownToClipboard: (...args) => copyToClipboardFn(...args),
  buildArtifactFilename: (...args) => buildArtifactFilenameFn(...args),
}));

import RiskTab from '../RiskTab';

beforeEach(() => {
  downloadMarkdownFn.mockReset();
  copyToClipboardFn.mockReset();
  copyToClipboardFn.mockResolvedValue(true);
  useRiskBriefFn.mockReturnValue({ data: null });
  // PR-NX72: useRiskFlags/useRiskScore mock resets removed — the selector
  // hooks now return [] / null from the static vi.mock factory above.
});

describe('RiskTab — AI Risk Brief panel', () => {
  it('does not render the brief panel when no artifact exists', () => {
    render(<RiskTab />);
    expect(screen.queryByText(/AI Risk Brief/i)).not.toBeInTheDocument();
  });

  it('renders the brief panel with body when an artifact is present', () => {
    useRiskBriefFn.mockReturnValueOnce({ data: {
      contentMd: '## Cross-document inconsistencies\n\n- Seller name mismatch on EC',
      generatedAt: '2026-05-09T10:00:00Z',
    } });
    render(<RiskTab />);
    expect(screen.getByText(/AI Risk Brief/i)).toBeInTheDocument();
    expect(screen.getByText(/Seller name mismatch on EC/)).toBeInTheDocument();
  });

  it('Copy button on the brief calls copyMarkdownToClipboard', async () => {
    useRiskBriefFn.mockReturnValueOnce({ data: {
      contentMd: '## Brief body',
      generatedAt: '2026-05-09T10:00:00Z',
    } });
    render(<RiskTab />);
    const copyBtn = await screen.findByRole('button', { name: /^Copied|^Copy$/ });
    fireEvent.click(copyBtn);
    await waitFor(() => expect(copyToClipboardFn).toHaveBeenCalledWith('## Brief body'));
  });

  it('Download button on the brief writes a .md with the deal-name filename', async () => {
    useRiskBriefFn.mockReturnValueOnce({ data: {
      contentMd: '## Brief body',
      generatedAt: '2026-05-09T10:00:00Z',
    } });
    render(<RiskTab />);
    const downloadBtn = await screen.findByRole('button', { name: /^Download$/ });
    fireEvent.click(downloadBtn);
    expect(downloadMarkdownFn).toHaveBeenCalled();
    expect(buildArtifactFilenameFn).toHaveBeenCalledWith('Whitefield Plot 22', 'risk-brief');
  });

  it('renders the AI-assisted disclaimer beneath the brief', () => {
    useRiskBriefFn.mockReturnValueOnce({ data: {
      contentMd: '## Brief',
      generatedAt: '2026-05-09T10:00:00Z',
    } });
    render(<RiskTab />);
    expect(screen.getByText(/AI-assisted — requires human review/i)).toBeInTheDocument();
  });

  it('hides the brief body when collapsed', () => {
    useRiskBriefFn.mockReturnValueOnce({ data: {
      contentMd: '## Brief body',
      generatedAt: '2026-05-09T10:00:00Z',
    } });
    render(<RiskTab />);
    // Click the header to collapse
    fireEvent.click(screen.getByRole('button', { expanded: true }));
    expect(screen.queryByText(/Brief body/)).not.toBeInTheDocument();
  });
});
