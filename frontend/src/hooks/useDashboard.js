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
