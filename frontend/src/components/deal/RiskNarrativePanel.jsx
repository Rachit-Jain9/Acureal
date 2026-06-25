import { Sparkles, AlertTriangle, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { useRiskNarrative } from '../../hooks/useRiskNarrative';
import { Skeleton, GuideHelp } from '../../design-system';
import { formatFallbackReason } from '../../utils/formatFallbackReason';

/**
 * RiskNarrativePanel (PR-NX47 — 2026-05-19)
 *
 * Surfaces the AI-synthesized risk profile narrative directly on the
 * RiskTab — same Claude-generated content that ships in the DOCX Risk
 * Register section (PR-NX43), now visible inline in the live workspace.
 *
 * Layout:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ ✨ Risk Profile Synthesis           [AI-assisted]   ↻ Refresh   │
 *   │                                                                  │
 *   │ ► Summary                                                        │
 *   │ Legal exposure dominates the risk picture. 3 of 3 open items     │
 *   │ sit on title / approvals risk...                                 │
 *   │                                                                  │
 *   │ ► Critical / High-Severity Spotlight                             │
 *   │ Conversion order pending is the single dealbreaker — without     │
 *   │ DC approval, no sale deed can register...                        │
 *   │                                                                  │
 *   │ Confidence: high · Synthesis: claude-sonnet-4-6                  │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Renders nothing when the service returned `available: false` for a
 * reason like "no risks logged" (zero clutter on clean deals). Renders
 * a polite "could not generate" line when both providers failed.
 *
 * Per CLAUDE.md: amber AI-assisted disclosure badge is mandatory on
 * every AI-driven surface.
 */
export default function RiskNarrativePanel({ dealId }) {
  const { data, isLoading, isError, error, refetch, isFetching } = useRiskNarrative(dealId);

  // Loading skeleton on first paint.
  if (isLoading) {
    return (
      <div className="rounded-xl border border-hairline bg-paper px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} className="text-accent" />
          <span className="text-sm font-semibold text-content-primary">Risk Profile Synthesis</span>
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

  // Error state — surface the message so operator knows what to do.
  if (isError) {
    const status = error?.response?.status;
    const msg = error?.response?.data?.message || error?.message || 'Could not load AI risk narrative.';
    return (
      <div className="rounded-xl border border-hairline bg-paper px-5 py-4 text-sm text-content-secondary">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle size={14} className="text-data-negative" />
          <span className="font-medium text-content-primary">Risk synthesis unavailable</span>
        </div>
        <p className="text-xs">{status ? `(${status}) ` : ''}{msg}</p>
      </div>
    );
  }

  // Hide entirely when no AI fired (clean deal — no risks logged, or
  // all risks closed). This avoids the "0 risks → please populate"
  // duplication; the existing RiskTab empty state already handles it.
  if (!data || data.available === false) {
    return null;
  }

  // Real content — render both paragraphs + attribution line.
  const { summary_paragraph, critical_spotlight_paragraph, confidence, provider, fallbackReason } = data;
  if (!summary_paragraph && !critical_spotlight_paragraph) return null;

  const attribution = [];
  if (confidence) attribution.push(`Confidence: ${confidence}`);
  if (provider) attribution.push(`Synthesis: ${provider}`);
  const cleanFallback = formatFallbackReason(fallbackReason);
  if (cleanFallback) attribution.push(cleanFallback);

  return (
    <div className="rounded-xl border border-hairline bg-paper px-5 py-4">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={14} className="text-accent flex-shrink-0" />
          <span className="text-sm font-semibold text-content-primary">Risk Profile Synthesis</span>
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-premium-soft text-premium border border-hairline font-medium flex-shrink-0">
            AI-assisted
          </span>
          <GuideHelp topic="deal.risk-narrative" label="Risk Profile Synthesis" />
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

      {summary_paragraph && (
        <div className="mb-3">
          <p className="text-[11px] uppercase tracking-wider text-content-tertiary font-medium mb-1">Summary</p>
          <p className="text-sm text-content-primary leading-relaxed">{summary_paragraph}</p>
        </div>
      )}

      {critical_spotlight_paragraph && (
        <div className="mb-3">
          <p className="text-[11px] uppercase tracking-wider text-content-tertiary font-medium mb-1">
            Critical / High-Severity Spotlight
          </p>
          <p className="text-sm text-content-primary leading-relaxed">{critical_spotlight_paragraph}</p>
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
