import { useEffect, useRef, useState } from 'react';
import {
  Brain,
  Loader2,
  X,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Download,
} from 'lucide-react';
import { clsx } from 'clsx';
import { intelligenceAPI } from '../../services/api';
import Badge from '../common/Badge';
import { SectionHeader } from '../../design-system';
import AiMarkdown from '../common/AiMarkdown';
import { downloadMarkdown, copyMarkdownToClipboard, buildArtifactFilename } from '../../utils/downloadMarkdown';

/**
 * IC Memo panel (Tier-2 #13).
 *
 * Generates and renders a Claude-authored Investment Committee memo for a
 * deal. Mirrors the streaming + cache pattern of the AI Deal Analysis
 * surface above it, but the output is structured markdown across 8
 * IC-grade sections rather than plain-text paragraphs.
 *
 * UI design notes:
 *   - Cached on mount via getCachedIcMemo so repeat visits don't re-run
 *     Claude. The user can press Refresh to regenerate.
 *   - Streaming via SSE — first paint at <1s, full memo in 30-90s
 *     depending on context size. The cancel button aborts the upstream
 *     call so cancelled memos don't burn token budget.
 *   - Numerical drift badge piggybacks on Tier-1 #3's verifier output —
 *     same shape as the deal_analysis drift surface.
 *   - "AI-assisted — requires human review" disclaimer per CLAUDE.md.
 */
export default function IcMemoPanel({ dealId, dealName }) {
  const [text, setText] = useState('');
  const [meta, setMeta] = useState(null);
  const [drifts, setDrifts] = useState(null);
  const [driftsExpanded, setDriftsExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cached, setCached] = useState(false);
  const [copied, setCopied] = useState(false);
  const streamCtrl = useRef(null);

  const handleCopy = async () => {
    if (!text) return;
    const ok = await copyMarkdownToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleDownload = () => {
    if (!text) return;
    downloadMarkdown(text, buildArtifactFilename(dealName, 'ic-memo'));
  };

  // On mount, fetch the last persisted memo. If one exists, render it
  // immediately so repeat visits don't re-run Claude.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await intelligenceAPI.getCachedIcMemo(dealId);
        const c = res?.data?.data;
        if (cancelled || !c) return;
        setText(c.memo || '');
        setMeta({ generatedAt: c.generatedAt, callId: c.callId, snapshotHash: c.snapshotHash });
        setDrifts(c.numericalDrifts ?? null);
        setCached(true);
      } catch {
        // Best-effort; silent on miss.
      }
    })();
    return () => { cancelled = true; };
  }, [dealId]);

  const handleGenerate = () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setText('');
    setMeta(null);
    setDrifts(null);
    setDriftsExpanded(false);
    setCached(false);

    const stream = intelligenceAPI.streamIcMemo(dealId, {
      onText: (delta) => setText((t) => t + delta),
      onDone: (m) => {
        setMeta(m);
        if (m?.numericalDrifts !== undefined) setDrifts(m.numericalDrifts);
      },
    });
    streamCtrl.current = stream;

    stream.promise
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setError(
          err?.message ||
            'IC memo generation failed. Check that OPENAI_API_KEY is configured and the deal has financials + risk flags populated.',
        );
      })
      .finally(() => {
        setLoading(false);
        streamCtrl.current = null;
      });
  };

  const handleCancel = () => {
    if (streamCtrl.current) streamCtrl.current.abort();
  };

  return (
    <div>
      <SectionHeader
        size="sm"
        icon={Brain}
        title={
          <>
            Full IC Memo
            <Badge className="ml-2" tone="neutral">AI-assisted — review before signoff</Badge>
            {cached && !loading && (
              <Badge className="ml-1" tone="neutral">Cached</Badge>
            )}
          </>
        }
        action={
          <div className="flex items-center gap-2">
            {/* Copy + Download .md — shown only when there's content to
                share. Analysts paste into IC decks / emails without
                losing the markdown structure. */}
            {text && !loading && (
              <>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-bg-elevated px-2.5 py-1.5 text-xs font-medium text-content-secondary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  title="Copy markdown to clipboard"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-bg-elevated px-2.5 py-1.5 text-xs font-medium text-content-secondary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  title="Download as a .md file (renders cleanly in Word, Google Docs, Obsidian)"
                >
                  <Download size={12} />
                  Download
                </button>
              </>
            )}
            {loading && (
              <button
                onClick={handleCancel}
                className="btn btn-ghost flex items-center gap-1.5 text-sm"
                type="button"
              >
                <X size={14} /> Cancel
              </button>
            )}
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="btn btn-primary flex items-center gap-1.5 text-sm"
              type="button"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
              {loading ? 'Drafting…' : text ? 'Regenerate' : 'Generate IC Memo'}
            </button>
          </div>
        }
      />

      {error && (
        <p className="mt-3 text-sm text-data-negative bg-bg-secondary border border-hairline rounded px-3 py-2">
          {error}
        </p>
      )}

      {text ? (
        <div className="mt-4 space-y-2">
          <AiMarkdown>{text}</AiMarkdown>
          {loading && (
            <span
              aria-hidden="true"
              className="inline-block w-1.5 h-3.5 align-middle bg-content-secondary animate-pulse"
            />
          )}

          {/* Numerical drift surface — same shape as the deal-analysis
              variant on the parent OverviewTab. */}
          {!loading && Array.isArray(drifts) && drifts.length > 0 && (() => {
            const highCount = drifts.filter((d) => d.severity === 'high').length;
            const mediumCount = drifts.filter((d) => d.severity === 'medium').length;
            const tone =
              highCount > 0 ? 'danger' : mediumCount > 0 ? 'warn' : 'info';
            const palette =
              tone === 'danger'
                ? { bg: 'bg-rose-50',  border: 'border-rose-200',  text: 'text-rose-900',  icon: 'text-rose-600' }
                : tone === 'warn'
                ? { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900', icon: 'text-amber-600' }
                : { bg: 'bg-sky-50',   border: 'border-sky-200',   text: 'text-sky-900',   icon: 'text-sky-600' };
            return (
              <div className={clsx('mt-3 border rounded-md', palette.bg, palette.border)}>
                <button
                  type="button"
                  onClick={() => setDriftsExpanded((v) => !v)}
                  className={clsx(
                    'w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-medium',
                    palette.text,
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-md',
                  )}
                  aria-expanded={driftsExpanded}
                >
                  <AlertTriangle size={13} className={clsx('shrink-0', palette.icon)} />
                  <span className="flex-1">
                    {drifts.length} numerical claim{drifts.length === 1 ? '' : 's'} flagged
                    {highCount > 0 && <span> · {highCount} high</span>}
                    {mediumCount > 0 && <span> · {mediumCount} medium</span>}
                  </span>
                  {driftsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
                {driftsExpanded && (
                  <div className="px-3 pb-3 pt-0 space-y-2 text-xs">
                    {drifts.map((d, i) => (
                      <div key={i} className={clsx('pt-2 border-t', palette.border)}>
                        <div className="flex items-baseline justify-between gap-2 tabular-nums">
                          <span className={clsx('font-medium', palette.text)}>{d.label || d.field}</span>
                          <span className={palette.text}>
                            claimed <strong>{d.claimed}{d.unit ? ` ${d.unit}` : ''}</strong>
                            {d.snapshot != null && (
                              <> · model says <strong>{d.snapshot}{d.unit ? ` ${d.unit}` : ''}</strong></>
                            )}
                            {d.delta_pct != null && <> · {d.delta_pct.toFixed(1)}% drift</>}
                            {d.reason === 'no_snapshot_value' && <> · no model baseline to compare</>}
                          </span>
                        </div>
                        {d.claim_context && (
                          <p className={clsx('mt-1 italic text-[11px] opacity-80', palette.text)}>
                            "…{d.claim_context}…"
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          <p className="mt-2 text-[11px] text-content-muted">
            AI-assisted — requires human review. Numbers are validated against the underlying financial model; flagged drifts (if any) appear above.
          </p>

          {meta && meta.generatedAt && (
            <p className="text-xs text-content-muted">
              Generated {new Date(meta.generatedAt).toLocaleString('en-IN')} · 8 IC sections synthesized from deal financials, risk flags, DD items, approval status, comps, and Bengaluru market benchmarks
            </p>
          )}
        </div>
      ) : (
        !loading && !error && (
          <p className="mt-2 text-sm text-content-secondary">
            Generate a Claude-authored IC memo with executive summary, deal snapshot, investment thesis, underwriting highlights, risk register, DD status, required approvals, and recommendation. 700-1200 words. Streamed live as Claude writes it.
          </p>
        )
      )}
    </div>
  );
}
