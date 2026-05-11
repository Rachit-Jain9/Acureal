import { useEffect, useRef, useState } from 'react';
import {
  Brain,
  Loader2,
  X,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { clsx } from 'clsx';
import { intelligenceAPI } from '../../services/api';
import Badge from '../common/Badge';
import { SectionHeader } from '../../design-system';

/**
 * Streamed AI Deal Analysis panel.
 *
 * Extracted from OverviewTab so the deal-page AI surfaces can live in a
 * single tabbed container alongside IcMemoPanel. Behaviour identical to
 * what shipped before:
 *
 *   • On mount: fetches the cached analysis (no token spend on revisits).
 *   • Generate / Refresh: opens an SSE stream; text accumulates as
 *     Claude generates so first paint is < 1s.
 *   • Cancel: aborts the upstream Anthropic call so cancelled analyses
 *     don't burn token budget.
 *   • Drift surface (Tier-1 #3): renders only when the post-hoc
 *     numerical verifier flagged claims that disagree with the
 *     deterministic financial snapshot.
 *
 * "AI-assisted — requires human review" disclaimer always renders below
 * generated content per CLAUDE.md hard rule.
 */
export default function DealAnalysisPanel({ dealId }) {
  const [aiText, setAiText] = useState('');
  const [aiMeta, setAiMeta] = useState(null);
  const [aiDrifts, setAiDrifts] = useState(null);
  const [driftsExpanded, setDriftsExpanded] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiCached, setAiCached] = useState(false);
  const streamCtrl = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await intelligenceAPI.getCachedDealAnalysis(dealId);
        const cached = res?.data?.data;
        if (cancelled || !cached) return;
        setAiText(cached.analysis || '');
        setAiMeta({ generatedAt: cached.generatedAt, callId: cached.callId });
        setAiDrifts(cached.numericalDrifts ?? null);
        setAiCached(true);
      } catch {
        // best-effort
      }
    })();
    return () => { cancelled = true; };
  }, [dealId]);

  const handleAiAnalysis = () => {
    if (aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    setAiText('');
    setAiMeta(null);
    setAiDrifts(null);
    setDriftsExpanded(false);
    setAiCached(false);

    const stream = intelligenceAPI.streamDealAnalysis(dealId, {
      onText: (delta) => setAiText((t) => t + delta),
      onDone: (meta) => {
        setAiMeta(meta);
        if (meta?.numericalDrifts !== undefined) setAiDrifts(meta.numericalDrifts);
      },
    });
    streamCtrl.current = stream;

    stream.promise
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setAiError(
          err?.message ||
            'Analysis failed. Check that OPENAI_API_KEY is configured.',
        );
      })
      .finally(() => {
        setAiLoading(false);
        streamCtrl.current = null;
      });
  };

  const handleAiCancel = () => {
    if (streamCtrl.current) streamCtrl.current.abort();
  };

  return (
    <div>
      <SectionHeader
        size="sm"
        icon={Brain}
        title={
          <>
            Quick Analysis
            <Badge className="ml-2" tone="neutral">AI-assisted — review before relying</Badge>
            {aiCached && !aiLoading && (
              <Badge className="ml-1" tone="neutral">Cached</Badge>
            )}
          </>
        }
        action={
          <div className="flex items-center gap-2">
            {aiLoading && (
              <button
                onClick={handleAiCancel}
                className="btn btn-ghost flex items-center gap-1.5 text-sm"
                type="button"
              >
                <X size={14} /> Cancel
              </button>
            )}
            <button
              onClick={handleAiAnalysis}
              disabled={aiLoading}
              className="btn btn-primary flex items-center gap-1.5 text-sm"
              type="button"
            >
              {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
              {aiLoading ? 'Analysing…' : aiText ? 'Refresh' : 'Generate Analysis'}
            </button>
          </div>
        }
      />
      {aiError && (
        <p className="mt-3 text-sm text-data-negative bg-bg-secondary border border-hairline rounded px-3 py-2">
          {aiError}
        </p>
      )}
      {aiText ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-content-primary leading-relaxed whitespace-pre-line">
            {aiText}
            {aiLoading && (
              <span
                aria-hidden="true"
                className="inline-block ml-1 w-1.5 h-3.5 align-middle bg-content-secondary animate-pulse"
              />
            )}
          </p>

          {!aiLoading && Array.isArray(aiDrifts) && aiDrifts.length > 0 && (() => {
            const highCount   = aiDrifts.filter((d) => d.severity === 'high').length;
            const mediumCount = aiDrifts.filter((d) => d.severity === 'medium').length;
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
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-md'
                  )}
                  aria-expanded={driftsExpanded}
                >
                  <AlertTriangle size={13} className={clsx('shrink-0', palette.icon)} />
                  <span className="flex-1">
                    {aiDrifts.length} numerical claim{aiDrifts.length === 1 ? '' : 's'} flagged
                    {highCount > 0 && <span> · {highCount} high</span>}
                    {mediumCount > 0 && <span> · {mediumCount} medium</span>}
                  </span>
                  {driftsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
                {driftsExpanded && (
                  <div className="px-3 pb-3 pt-0 space-y-2 text-xs">
                    {aiDrifts.map((d, i) => (
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
            AI-assisted — requires human review. Numbers are validated against the
            underlying financial model; flagged drifts (if any) appear above.
          </p>

          {aiMeta && aiMeta.generatedAt && (
            <p className="text-xs text-content-muted">
              Generated {new Date(aiMeta.generatedAt).toLocaleString('en-IN')} · Cross-referenced
              against internal pipeline, market benchmarks, and verified comps
            </p>
          )}
        </div>
      ) : (
        !aiLoading && !aiError && (
          <p className="mt-2 text-sm text-content-secondary">
            Investor-grade memo cross-referencing this deal's financials against
            Bengaluru micro-market benchmarks and verified comps. Streamed live as it generates.
          </p>
        )
      )}
    </div>
  );
}
