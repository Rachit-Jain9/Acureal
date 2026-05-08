import { useState } from 'react';
import { Sparkles, AlertTriangle, RefreshCw, Copy, Check, Brain, ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';
import { Card } from '../../design-system';
import Badge from '../common/Badge';
import { useGenerateParcelNarrative, useCachedParcelNarrative } from '../../hooks/useProperties';

/**
 * AI augmentation — Claude-generated parcel verdict narrative.
 *
 * The narrative is generated on demand (not auto), so an analyst opts in
 * before any token spend. Hard-rule compliance:
 *   - "AI-assisted — requires human review" badge always visible
 *   - Narrative phrases the deterministic snapshot only — never invents
 *     numbers, citations, or zone codes (system prompt restricts scope)
 *   - Cost telemetry recorded server-side via aiRouter
 *
 * Persists to ai_artifacts.parcel_narrative — re-mounts hit cache, no
 * re-spend. Numerical verifier (Tier-1 #3) flags any number Claude
 * rephrased differently from the deterministic snapshot.
 */

export default function ParcelNarrativeCard({ propertyId, dealId, intelligence }) {
  const mutation = useGenerateParcelNarrative();
  const cached = useCachedParcelNarrative({ propertyId, dealId });
  const [copied, setCopied] = useState(false);
  const [driftsExpanded, setDriftsExpanded] = useState(false);

  const verdictLabel = intelligence?.verdict?.label || 'snapshot';
  // Mutation result wins over cache (it's fresher). Cache result fills in
  // when the user lands on the page without re-running Claude.
  const data = mutation.data || cached.data;
  const error = mutation.error;
  const isPending = mutation.isPending;
  const isFromCache = !mutation.data && !!cached.data;

  const handleGenerate = () => {
    setCopied(false);
    setDriftsExpanded(false);
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

  // Drift surface — same shape as IcMemoPanel + OverviewTab AI deal analysis.
  const drifts = data?.numerical_drifts || data?.numericalDrifts || null;
  const highCount = Array.isArray(drifts) ? drifts.filter((d) => d.severity === 'high').length : 0;
  const mediumCount = Array.isArray(drifts) ? drifts.filter((d) => d.severity === 'medium').length : 0;

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
            {isFromCache && (
              <Badge tone="neutral" className="text-[10px]" title="Loaded from cache; click Regenerate for a fresh pass">
                <Brain size={9} className="inline -mt-0.5 mr-1" />
                Cached
              </Badge>
            )}
            {!isFromCache && data.telemetry?.latency_ms != null && (
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

          {/* Numerical drift surface — same affordance as the other AI
              artifact panels. Only renders when drifts > 0. */}
          {Array.isArray(drifts) && drifts.length > 0 && (() => {
            const tone = highCount > 0 ? 'danger' : mediumCount > 0 ? 'warn' : 'info';
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
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          <div className="mt-3 text-[10px] text-content-muted leading-relaxed">
            {data.disclaimer || 'AI-assisted — requires human review. Generated by Claude from the deterministic snapshot. Numbers, citations, and red flags are computed by REDIP engines, not the language model.'}
          </div>
        </div>
      )}
    </Card>
  );
}
