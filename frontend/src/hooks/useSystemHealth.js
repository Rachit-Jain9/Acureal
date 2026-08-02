import { useQuery } from '@tanstack/react-query';
import { adminAPI } from '../services/api';

// Live liveness snapshot from /api/admin/system-health. Runs the same five
// subsystem checks as the hourly watchdog cron (AI provider error share,
// audit-write liveness, stuck extractions, the tenant-isolation fail-closed
// canary, and the Data API exposure guard) on demand — no Sentry alerts (the
// cron owns alerting).
//
// Refetches on a gentle 60s interval and on window focus so the operator's
// System Health page stays live without hammering the DB. The checks are cheap,
// index-backed aggregate reads.
export function useSystemHealth() {
  return useQuery({
    queryKey: ['admin-system-health'],
    queryFn: () => adminAPI.getSystemHealth().then((r) => r.data.data),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
}
