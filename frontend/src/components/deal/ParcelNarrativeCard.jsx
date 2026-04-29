import { useState } from 'react';
import { Sparkles, AlertTriangle, RefreshCw, Copy, Check } from 'lucide-react';
import { Card } from '../../design-system';
import Badge from '../common/Badge';
import { useGenerateParcelNarrative } from '../../hooks/useProperties';

/**
 * AI augmentation — Claude-generated parcel verdict narrative.
 *
 * The narrative is generated on demand (not auto), so an analyst opts in
 * before any token spend. Hard-rule compliance:
 *   - "AI-assisted — requires human review" badge always visible.
 *   - Narrative phrases the deterministic snapshot only — never invents
 *     numbers, citations, or zone codes (system prompt restricts scope).
 *   - Cost telemetry is recorded server-side via aiRouter; here we just
 *     show the analyst that the call was logged.
 */

export default function ParcelNarrativeCard({ propertyId, dealId, intelligence }) {
  const mutation = useGenerateParcelNarrative();
  const [copied, setCopied] = useState(false);

  const verdictLabel = intelligence?.verdict?.label || 'snapshot';
  const data = mutation.data;
  const error = mutation.error;
  const isPending = mutation.isPending;

  const handleGenerate = () => {
    setCopied(false);
    mutation.mutate({ propertyId, dealId });
  };

  const handleCopy = async () => {
    if (!data?.narrative) return;
    try {
      await navigator.clipboard.writeText(data.narrative);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be unavailable in some browsers; ignore silently */
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-content-primary">
            <Sparkles size={15} className="text-premium" />
            Executive narrative
          </div>
          <p className="mt-1 text-xs text-content-secondary leading-relaxed">
            One-click 2-paragraph summary of the deterministic snapshot in plain investor English. Claude phrases the verdict and red flags — it does not invent any number.
          </p>
        </div>
        {data?.narrative && (
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-editorial border border-hairline bg-bg-secondary px-2.5 py-1.5 text-[11px] font-semibold text-content-secondary hover:border-primary-300 hover:text-content-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
            aria-label="Copy narrative to clipboard"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>

      {!data && !isPending && !error && (
        <button
          type="button"
          onClick={handleGenerate}
          className="inline-flex items-center gap-2 rounded-editorial bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 transition-colors active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
        >
          <Sparkles size={14} />
          Generate AI summary for {verdictLabel.toLowerCase()}
        </button>
      )}

      {isPending && (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 w-full rounded bg-bg-secondary" />
          <div className="h-3 w-11/12 rounded bg-bg-secondary" />
          <div className="h-3 w-9/12 rounded bg-bg-secondary" />
          <div className="mt-3 h-3 w-full rounded bg-bg-secondary" />
          <div className="h-3 w-10/12 rounded bg-bg-secondary" />
          <div className="h-3 w-7/12 rounded bg-bg-secondary" />
        </div>
      )}

      {error && !isPending && (
        <div className="rounded-editorial border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <div>
              {error.response?.data?.message || error.message || 'Narrative generation failed.'}
            </div>
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-900 hover:underline"
          >
            <RefreshCw size={11} />
            Try again
          </button>
        </div>
      )}

      {data?.narrative && !isPending && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone="warn" className="text-[10px]">AI-assisted — requires human review</Badge>
            {data.telemetry?.latency_ms != null && (
              <span className="text-[10px] text-content-muted tabular-nums">
                {data.telemetry.latency_ms}ms
                {data.telemetry.cost_usd != null && ` · $${Number(data.telemetry.cost_usd).toFixed(4)}`}
              </span>
            )}
            <button
              type="button"
              onClick={handleGenerate}
              className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-content-muted hover:text-content-primary transition-colors"
            >
              <RefreshCw size={10} />
              Regenerate
            </button>
          </div>
          <div className="text-sm text-content-primary leading-relaxed whitespace-pre-line">
            {data.narrative}
          </div>
          <div className="mt-3 text-[10px] text-content-muted leading-relaxed">
            {data.disclaimer}
          </div>
        </div>
      )}
    </Card>
  );
}
