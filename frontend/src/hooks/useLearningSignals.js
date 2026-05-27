import { useQuery } from '@tanstack/react-query';
import { adminAPI } from '../services/api';

// E7-PR1 (2026-05-27) — admin learning-signal telemetry. Reads /api/admin/
// learning-signals which aggregates recommendation_verdict signals from
// `improvement_signals` (signal_type='recommendation_verdict') over a
// trailing window. Returns:
//   { window_days, summary, top_dismissed[], top_acted[],
//     active_adjustments: { window_days, adjustments[], adjusted_rule_count },
//     daily_series[], generated_at }
// The endpoint mirrors the consumer-side aggregator's policy (PR #618)
// exactly, so the admin page shows what the platform IS de-ranking right
// now, not a separate computation.
export function useLearningSignals(days = 30) {
  return useQuery({
    queryKey: ['admin-learning-signals', days],
    queryFn: () => adminAPI.getLearningSignals(days).then((r) => r.data.data),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
