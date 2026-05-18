import { useQuery } from '@tanstack/react-query';
import { riskAPI } from '../services/api';

/**
 * Live AI risk-narrative fetch (PR-NX47 — 2026-05-19).
 *
 * Surfaces the same 2-paragraph Claude-synthesized risk profile +
 * critical-spotlight callout that ships in the DOCX Risk Register
 * section (PR-NX43). Operators no longer need to download a DOCX to
 * read the AI synthesis — it renders inline on the RiskTab.
 *
 * Returns envelope from generateRiskNarrative:
 *   {
 *     available: boolean,
 *     summary_paragraph: string | null,
 *     critical_spotlight_paragraph: string | null,
 *     confidence: 'high' | 'medium' | 'low' | null,
 *     provider: 'claude-sonnet-4-6' | 'gpt-5.4' | null,
 *     fallbackReason: string | null,
 *     disclaimer: string,
 *     // Or when no AI fires:
 *     reason: string,  // e.g., 'no risks logged'
 *   }
 *
 * Stale time: 5 minutes — the narrative is expensive to generate but
 * doesn't need to be fresh-on-every-render. Risk-flag mutations
 * elsewhere on the page should invalidate this query (the RiskTab
 * mutation hooks already handle that).
 *
 * Disabled until dealId is known to avoid a wasted call during the
 * deal-page initial load.
 */
export function useRiskNarrative(dealId) {
  return useQuery({
    queryKey: ['risk-narrative', dealId],
    queryFn: () => riskAPI.narrative(dealId).then((r) => r.data?.data),
    enabled: !!dealId,
    staleTime: 5 * 60 * 1000,
    // Don't retry on 403/404 — those are operator-actionable.
    retry: (failureCount, err) => {
      const status = err?.response?.status;
      if (status === 403 || status === 404) return false;
      return failureCount < 2;
    },
  });
}
