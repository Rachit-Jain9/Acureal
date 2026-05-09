import { useQuery } from '@tanstack/react-query';
import { adminAPI } from '../services/api';

// Pulls the AI usage rollups from /api/admin/ai-usage. Window is configurable
// (1d / 7d / 30d / 90d / 365d). The endpoint returns:
//   { summary, daily[], by_task_provider[], by_doctype[], top_cost_calls[] }
// All aggregations are computed server-side; the client is purely a renderer.
export function useAiUsage(days = 30) {
  return useQuery({
    queryKey: ['admin-ai-usage', days],
    queryFn: () => adminAPI.getAiUsage(days).then((r) => r.data.data),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
