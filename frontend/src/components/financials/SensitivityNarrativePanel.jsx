import { Sparkles, AlertTriangle, RefreshCw, Target } from 'lucide-react';
import { clsx } from 'clsx';
import { useSensitivityNarrative } from '../../hooks/useSensitivityNarrative';
import { Skeleton } from '../../design-system';
import { formatFallbackReason } from '../../utils/formatFallbackReason';

/**
 * SensitivityNarrativePanel (PR-NX48 — 2026-05-19)
 *
 * Surfaces the AI-synthesized driver decomposition + recommended stress
 * tests directly on the FinancialsPage — same OpenAI-generated content
 * that ships in the DOCX Financials section (PR-NX44), now visible
 * inline.
 *
 * Layout:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ ✨ Sensitivity Analysis · Dominant driver: Sell Rate            │
 *   │                                            [AI-assisted] ↻      │
 *   │ ► Driver decomposition                                           │
 *   │ Sell rate dominates with 800 bps IRR swing vs construction       │
 *   │ cost's 400 bps; debt rate adds 120 bps...                        │
 *   │                                                                  │
 *   │ ► Recommended stress tests                                       │
 *   │ Stress 1: sell rate −10% AND construction cost +15% takes IRR    │
 *   │ to 14% — still above hurdle but with no margin...                │
 *   │                                                                  │
 *   │ Confidence: high · Synthesis: gpt-5.4                            │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Renders nothing when grid is too sparse / no financial model. Renders
 * a polite "could not generate" line when both providers failed.
 */
export default function SensitivityNarrativePanel({ dealId }) {
  const { data, isLoading, isError, error, refetch, isFetching } = useSensitivityNarrative(dealId);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-hairline bg-paper px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} className="text-accent" />
          <span className="text-sm font-semibold text-content-primary">Sensitivity Analysis</span>
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-premium-soft text-premium border border-hairline font-medium">
            AI-assisted
          </span>
        </div>
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-5/6 mb-2" />
        <Skeleton className="h-4 w-4/6" />
      </div>
    );
  }

  if (isError) {
    const status = error?.response?.status;
    const msg = error?.response?.data?.message || error?.message || 'Could not load AI sensitivity narrative.';
    return (
      <div className="rounded-xl border border-hairline bg-paper px-5 py-4 text-sm text-content-secondary">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle size={14} className="text-data-negative" />
          <span className="font-medium text-content-primary">Sensitivity synthesis unavailable</span>
        </div>
        <p className="text-xs">{status ? `(${status}) ` : ''}{msg}</p>
      </div>
    );
  }

  // Hide when no AI content (no financial model, sparse grid, etc.)
  if (!data || data.available === false) return null;
  const { driver_decomposition_paragraph, stress_test_paragraph, dominant_driver, confidence, provider, fallbackReason } = data;
  if (!driver_decomposition_paragraph && !stress_test_paragraph) return null;

  const attribution = [];
  if (confidence) attribution.push(`Confidence: ${confidence}`);
  if (provider) attribution.push(`Synthesis: ${provider}`);
  const cleanFallback = formatFallbackReason(fallbackReason);
  if (cleanFallback) attribution.push(cleanFallback);

  return (
    <div className="rounded-xl border border-hairline bg-paper px-5 py-4">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={14} className="text-accent flex-shrink-0" />
          <span className="text-sm font-semibold text-content-primary">Sensitivity Analysis</span>
          {dominant_driver && (
            <span className="inline-flex items-center gap-1 text-xs text-content-secondary">
              <Target size={11} className="text-content-tertiary" />
              Dominant driver:{' '}
              <span className="font-semibold text-content-primary">{dominant_driver}</span>
            </span>
          )}
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-premium-soft text-premium border border-hairline font-medium flex-shrink-0">
            AI-assisted
          </span>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs text-content-tertiary hover:text-content-primary flex items-center gap-1 disabled:opacity-50"
          title="Re-run the AI synthesis"
          aria-label="Refresh"
        >
          <RefreshCw size={12} className={clsx(isFetching && 'animate-spin')} />
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {driver_decomposition_paragraph && (
        <div className="mb-3">
          <p className="text-[11px] uppercase tracking-wider text-content-tertiary font-medium mb-1">Driver decomposition</p>
          <p className="text-sm text-content-primary leading-relaxed">{driver_decomposition_paragraph}</p>
        </div>
      )}

      {stress_test_paragraph && (
        <div className="mb-3">
          <p className="text-[11px] uppercase tracking-wider text-content-tertiary font-medium mb-1">
            Recommended stress tests
          </p>
          <p className="text-sm text-content-primary leading-relaxed">{stress_test_paragraph}</p>
        </div>
      )}

      {attribution.length > 0 && (
        <p className="text-[11px] italic text-content-tertiary border-t border-hairline pt-2 mt-2">
          {attribution.join(' · ')}
        </p>
      )}
    </div>
  );
}
