import { useQuery } from '@tanstack/react-query';
import { dashboardAPI } from '../services/api';

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardAPI.getStats().then((r) => r.data.data),
  });
}

// Portfolio Risk Radar — workspace-level rollup of every live deal's
// per-failure-mode posture. Backed server-side by the deterministic
// portfolioRiskRadar.service.js. 30s staleTime matches the per-deal radar
// hook so the two feel consistent when an analyst toggles between them.
export function usePortfolioRiskRadar() {
  return useQuery({
    queryKey: ['portfolio-risk-radar'],
    queryFn: () => dashboardAPI.portfolioRiskRadar().then((r) => r.data.data),
    staleTime: 30_000,
  });
}

// Portfolio Readiness — workspace-level rollup of every live deal's IC +
// RERA readiness state. Pairs with the per-deal IC Readiness Pack on the
// DD tab (this is the same posture surfaced at portfolio zoom). 30 s
// staleTime matches the per-deal pack.
export function usePortfolioReadiness() {
  return useQuery({
    queryKey: ['portfolio-readiness'],
    queryFn: () => dashboardAPI.portfolioReadiness().then((r) => r.data.data),
    staleTime: 30_000,
  });
}

// Today's Attention — specific item-level signals across the live portfolio
// (overdue required DD, expiring approvals, recent risk flags, stale deals,
// the last 10 audit-log entries). The companion read to usePortfolioRiskRadar:
// the radar shows aggregates ("3 overdue DD items"); this returns the
// underlying rows so the dashboard tile can render clickable items.
//
// 30s staleTime matches the radar so toggling between them stays warm.
export function useAttention() {
  return useQuery({
    queryKey: ['dashboard-attention'],
    queryFn: () => dashboardAPI.attention().then((r) => r.data.data),
    staleTime: 30_000,
  });
}
