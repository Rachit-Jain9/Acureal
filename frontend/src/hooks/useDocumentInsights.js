import { useQuery } from '@tanstack/react-query';
import { extractionAPI } from '../services/api';

/**
 * Live AI document-insights fetch (PR-NX49 — 2026-05-19).
 *
 * Surfaces the same Claude-synthesized cross-document analysis + 0-5
 * inconsistency findings that ships in the DOCX Document-Derived
 * Insights section (PR-NX45). Operators no longer need to download a
 * DOCX to read the AI cross-document reasoning — it renders inline on
 * the DocumentsTab.
 *
 * Returns envelope from generateDocumentInsights:
 *   {
 *     available: boolean,
 *     summary_paragraph: string | null,
 *     findings: [
 *       { title, severity: 'critical'|'high'|'medium'|'low',
 *         description, recommendation: string | null }
 *     ],
 *     confidence: 'high' | 'medium' | 'low' | null,
 *     provider: 'claude-sonnet-4-6' | 'gpt-5.4' | null,
 *     fallbackReason: string | null,
 *     // Or:
 *     reason: string,  // 'no extractions...'
 *   }
 */
export function useDocumentInsights(dealId) {
  return useQuery({
    queryKey: ['document-insights', dealId],
    queryFn: () => extractionAPI.documentInsights(dealId).then((r) => r.data?.data),
    enabled: !!dealId,
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, err) => {
      const status = err?.response?.status;
      if (status === 403 || status === 404) return false;
      return failureCount < 2;
    },
  });
}
