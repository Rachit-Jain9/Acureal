import { Sparkles, AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';
import { clsx } from 'clsx';
import { useDocumentInsights } from '../../hooks/useDocumentInsights';
import { Skeleton } from '../../design-system';

/**
 * DocumentInsightsPanel (PR-NX49 — 2026-05-19)
 *
 * Surfaces the AI-synthesized cross-document analysis + inconsistency
 * findings directly on the DocumentsTab — same Claude-generated content
 * that ships in the DOCX Document-Derived Insights section (PR-NX45),
 * now visible inline in the live workspace.
 *
 * Layout:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ ✨ Cross-Document Analysis        [AI-assisted]   ↻ Refresh    │
 *   │                                                                  │
 *   │ 3 documents on file: sale deed, EC, RTC. Coverage adequate for  │
 *   │ title diligence...                                              │
 *   │                                                                  │
 *   │ ► Inconsistency findings (1)                                     │
 *   │ [CRITICAL] Owner name mismatch — sale deed vs RTC                │
 *   │   Sale deed shows "Real Owner Pvt Ltd" but RTC shows...          │
 *   │   Recommended: Order updated mutation/khata before proceeding.   │
 *   │                                                                  │
 *   │ Confidence: high · Synthesis: claude-sonnet-4-6                  │
 *   └──────────────────────────────────────────────────────────────────┘
 */

const SEVERITY_STYLES = {
  critical: { tone: 'text-data-negative',  bg: 'bg-data-negative/10  border-data-negative/30',  label: 'Critical' },
  high:     { tone: 'text-amber-700',      bg: 'bg-amber-50 border-amber-200',                  label: 'High'     },
  medium:   { tone: 'text-content-secondary', bg: 'bg-bg-secondary border-hairline',           label: 'Medium'   },
  low:      { tone: 'text-content-muted',  bg: 'bg-bg-secondary border-hairline',              label: 'Low'      },
};

const SEVERITY_RANK = { critical: 1, high: 2, medium: 3, low: 4 };

export default function DocumentInsightsPanel({ dealId }) {
  const { data, isLoading, isError, error, refetch, isFetching } = useDocumentInsights(dealId);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-hairline bg-paper px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} className="text-accent" />
          <span className="text-sm font-semibold text-content-primary">Cross-Document Analysis</span>
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-medium">
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
    const msg = error?.response?.data?.message || error?.message || 'Could not load AI document insights.';
    return (
      <div className="rounded-xl border border-hairline bg-paper px-5 py-4 text-sm text-content-secondary">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle size={14} className="text-data-negative" />
          <span className="font-medium text-content-primary">Document insights unavailable</span>
        </div>
        <p className="text-xs">{status ? `(${status}) ` : ''}{msg}</p>
      </div>
    );
  }

  if (!data || data.available === false) return null;
  const { summary_paragraph, findings, confidence, provider, fallbackReason } = data;
  const findingsList = Array.isArray(findings) ? findings : [];
  if (!summary_paragraph && findingsList.length === 0) return null;

  // Sort findings by severity (critical first).
  const sortedFindings = [...findingsList].sort((a, b) => {
    const sevA = SEVERITY_RANK[a.severity] || 99;
    const sevB = SEVERITY_RANK[b.severity] || 99;
    return sevA - sevB;
  });

  const attribution = [];
  if (confidence) attribution.push(`Confidence: ${confidence}`);
  if (provider) attribution.push(`Synthesis: ${provider}`);
  if (fallbackReason) attribution.push(`auto-failover: ${fallbackReason}`);

  return (
    <div className="rounded-xl border border-hairline bg-paper px-5 py-4">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={14} className="text-accent flex-shrink-0" />
          <span className="text-sm font-semibold text-content-primary">Cross-Document Analysis</span>
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-medium flex-shrink-0">
            AI-assisted
          </span>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs text-content-tertiary hover:text-content-primary flex items-center gap-1 disabled:opacity-50"
          title="Re-run the AI analysis"
          aria-label="Refresh"
        >
          <RefreshCw size={12} className={clsx(isFetching && 'animate-spin')} />
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {summary_paragraph && (
        <p className="text-sm text-content-primary leading-relaxed mb-3">{summary_paragraph}</p>
      )}

      {sortedFindings.length > 0 ? (
        <div className="space-y-2 mb-2">
          <p className="text-[11px] uppercase tracking-wider text-content-tertiary font-medium">
            Inconsistency findings ({sortedFindings.length})
          </p>
          {sortedFindings.map((finding, idx) => {
            const style = SEVERITY_STYLES[finding.severity] || SEVERITY_STYLES.medium;
            return (
              <div key={idx} className={clsx('rounded-md border px-3 py-2', style.bg)}>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className={clsx('text-[10px] font-bold uppercase tracking-wider', style.tone)}>
                    {`[${style.label}]`}
                  </span>
                  <span className="text-sm font-semibold text-content-primary">{finding.title || '(untitled)'}</span>
                </div>
                {finding.description && (
                  <p className="text-xs text-content-secondary leading-relaxed mb-1">{finding.description}</p>
                )}
                {finding.recommendation && (
                  <p className="text-xs italic text-content-tertiary">
                    <span className="font-semibold not-italic">Recommended:</span> {finding.recommendation}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/40 px-3 py-2 flex items-center gap-2 mb-2">
          <ShieldCheck size={14} className="text-emerald-700 flex-shrink-0" />
          <p className="text-xs text-emerald-800">
            No inconsistencies detected across the document set — a positive signal.
          </p>
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
