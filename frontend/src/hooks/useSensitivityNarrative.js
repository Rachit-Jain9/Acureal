import { useQuery } from '@tanstack/react-query';
import { financialsAPI } from '../services/api';

/**
 * Live AI sensitivity-narrative fetch (PR-NX48 — 2026-05-19).
 *
 * Surfaces the same 2-paragraph OpenAI-synthesized driver decomposition
 * + recommended stress tests that ships in the DOCX Financials section
 * (PR-NX44). Operators no longer need to download a DOCX to read the AI
 * sensitivity interpretation — it renders inline on FinancialsPage.
 *
 * Returns envelope from generateSensitivityNarrative:
 *   {
 *     available: boolean,
 *     driver_decomposition_paragraph: string | null,
 *     stress_test_paragraph: string | null,
 *     dominant_driver: string | null,
 *     confidence: 'high' | 'medium' | 'low' | null,
 *     provider: 'gpt-5.4' | 'claude-sonnet-4-6' | null,
 *     fallbackReason: string | null,
 *     // Or:
 *     reason: string,  // 'no financial model' / 'insufficient sensitivity grid'
 *   }
 */
export function useSensitivityNarrative(dealId) {
  return useQuery({
    queryKey: ['sensitivity-narrative', dealId],
    queryFn: () => financialsAPI.sensitivityNarrative(dealId).then((r) => r.data?.data),
    enabled: !!dealId,
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, err) => {
      const status = err?.response?.status;
      if (status === 403 || status === 404) return false;
      return failureCount < 2;
    },
  });
}
