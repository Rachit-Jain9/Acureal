import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Tier-2 #13 — IC memo panel.
// Tests the cached-on-mount path, the streaming Generate flow, the
// Cancel button, and the Copy / Download .md export buttons.

const getCachedIcMemo = vi.fn();
const streamIcMemo = vi.fn();
const downloadMarkdownFn = vi.fn();
const copyToClipboardFn = vi.fn();
const buildArtifactFilenameFn = vi.fn(() => 'mock-deal-ic-memo-2026-05-09.md');

vi.mock('../../../services/api', () => ({
  intelligenceAPI: {
    getCachedIcMemo: (...args) => getCachedIcMemo(...args),
    streamIcMemo: (...args) => streamIcMemo(...args),
  },
}));

vi.mock('../../../utils/downloadMarkdown', () => ({
  downloadMarkdown: (...args) => downloadMarkdownFn(...args),
  copyMarkdownToClipboard: (...args) => copyToClipboardFn(...args),
  buildArtifactFilename: (...args) => buildArtifactFilenameFn(...args),
}));

// Workstream A — IcMemoEvidence is its own component with its own test and
// its own React Query hook; stub it so this IcMemoPanel test stays focused.
vi.mock('../IcMemoEvidence', () => ({
  default: () => null,
}));

import IcMemoPanel from '../IcMemoPanel';

beforeEach(() => {
  getCachedIcMemo.mockReset();
  streamIcMemo.mockReset();
  downloadMarkdownFn.mockReset();
  copyToClipboardFn.mockReset();
  copyToClipboardFn.mockResolvedValue(true);
});

describe('IcMemoPanel', () => {
  it('renders the empty / call-to-action state when no cached memo exists', async () => {
    getCachedIcMemo.mockResolvedValueOnce({ data: { data: null } });
    render(<IcMemoPanel dealId="d-1" dealName="Whitefield Plot 22" />);
    await waitFor(() => expect(getCachedIcMemo).toHaveBeenCalledWith('d-1'));
    expect(screen.getByText(/Generate IC Memo/)).toBeInTheDocument();
    // Explainer copy beneath the CTA.
    expect(screen.getByText(/executive summary, deal snapshot, investment thesis/i)).toBeInTheDocument();
  });

  it('renders the cached memo on mount with a Cached badge + export buttons', async () => {
    getCachedIcMemo.mockResolvedValueOnce({ data: { data: {
      memo: '## Executive Summary\n\nWhitefield Plot 22 is IC-ready.',
      generatedAt: '2026-05-09T10:00:00Z',
      callId: 'call-1',
      snapshotHash: 'hash-1',
      numericalDrifts: [],
    } } });
    render(<IcMemoPanel dealId="d-1" dealName="Whitefield Plot 22" />);
    await waitFor(() => expect(screen.getByText(/Cached/)).toBeInTheDocument());
    expect(screen.getByText(/Whitefield Plot 22 is IC-ready/)).toBeInTheDocument();
    // Export buttons are gated on memo presence — should be visible.
    expect(screen.getByRole('button', { name: /^Copy$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Download$/ })).toBeInTheDocument();
    // The CTA changes from "Generate" to "Regenerate" once content exists.
    expect(screen.getByRole('button', { name: /Regenerate/ })).toBeInTheDocument();
  });

  it('Generate button opens a stream and paints the streamed text', async () => {
    getCachedIcMemo.mockResolvedValueOnce({ data: { data: null } });
    let capturedHandlers;
    streamIcMemo.mockImplementation((dealId, handlers) => {
      capturedHandlers = handlers;
      return { promise: new Promise(() => {}), abort: vi.fn() };
    });

    render(<IcMemoPanel dealId="d-2" dealName="Hebbal Mixed Use" />);
    await waitFor(() => expect(getCachedIcMemo).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Generate IC Memo/ }));
    expect(streamIcMemo).toHaveBeenCalledWith('d-2', expect.objectContaining({
      onText: expect.any(Function),
      onDone: expect.any(Function),
    }));

    // Simulate streamed deltas → UI paints them.
    capturedHandlers.onText('## Section 1\n\nThe deal ');
    capturedHandlers.onText('is solid.');
    await waitFor(() => expect(screen.getByText(/The deal is solid/)).toBeInTheDocument());
  });

  it('Cancel button aborts the in-flight stream', async () => {
    getCachedIcMemo.mockResolvedValueOnce({ data: { data: null } });
    const abortFn = vi.fn();
    streamIcMemo.mockReturnValueOnce({
      promise: new Promise(() => {}),
      abort: abortFn,
    });

    render(<IcMemoPanel dealId="d-3" dealName="Sarjapur 3.5ac" />);
    await waitFor(() => expect(getCachedIcMemo).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Generate IC Memo/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(abortFn).toHaveBeenCalled();
  });

  it('Copy button calls copyMarkdownToClipboard with the memo body', async () => {
    getCachedIcMemo.mockResolvedValueOnce({ data: { data: {
      memo: '## Memo body',
      generatedAt: '2026-05-09T10:00:00Z',
    } } });
    render(<IcMemoPanel dealId="d-1" dealName="Whitefield" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Copy$/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));
    await waitFor(() => expect(copyToClipboardFn).toHaveBeenCalledWith('## Memo body'));
  });

  it('Download button writes a .md file with the deal-name filename', async () => {
    getCachedIcMemo.mockResolvedValueOnce({ data: { data: {
      memo: '## Memo body',
      generatedAt: '2026-05-09T10:00:00Z',
    } } });
    render(<IcMemoPanel dealId="d-1" dealName="Whitefield Plot 22" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Download$/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^Download$/ }));
    await waitFor(() => expect(downloadMarkdownFn).toHaveBeenCalled());
    expect(buildArtifactFilenameFn).toHaveBeenCalledWith('Whitefield Plot 22', 'ic-memo');
  });

  it('renders the AI-assisted disclaimer when content is present', async () => {
    getCachedIcMemo.mockResolvedValueOnce({ data: { data: {
      memo: '## Memo',
      generatedAt: '2026-05-09T10:00:00Z',
    } } });
    render(<IcMemoPanel dealId="d-1" dealName="Whitefield" />);
    await waitFor(() => expect(screen.getByText(/AI-assisted/)).toBeInTheDocument());
  });

  it('renders the numerical drift surface when drifts are non-empty', async () => {
    getCachedIcMemo.mockResolvedValueOnce({ data: { data: {
      memo: '## Memo body',
      generatedAt: '2026-05-09T10:00:00Z',
      numericalDrifts: [
        { label: 'IRR', severity: 'high', claimed: 22.4, snapshot: 18.5, unit: '%', delta_pct: 21.1 },
      ],
    } } });
    render(<IcMemoPanel dealId="d-1" dealName="Whitefield" />);
    await waitFor(() => expect(screen.getByText(/1 numerical claim flagged/)).toBeInTheDocument());
  });
});
