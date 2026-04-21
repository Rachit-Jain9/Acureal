import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { financialsAPI } from '../services/api';
import { toast } from '../components/common/Toast';

export function useFinancials(dealId) {
  return useQuery({
    queryKey: ['financials', dealId],
    queryFn: () => financialsAPI.get(dealId).then((r) => r.data.data),
    enabled: !!dealId,
  });
}

export function useCalculateFinancials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, data }) => financialsAPI.calculate(dealId, data).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['financials', dealId] });
      qc.invalidateQueries({ queryKey: ['deal', dealId] });
      toast.success('Financials calculated');
    },
    onError: (err) => {
      const msg = err.response?.data?.message
        || err.response?.data?.errors?.[0]?.message
        || err.message
        || 'Calculation failed';
      toast.error(msg);
    },
  });
}

export function useRunSensitivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, data }) => financialsAPI.sensitivity(dealId, data).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['financials', dealId] });
    },
  });
}

export function useScenarios(dealId) {
  return useQuery({
    queryKey: ['scenarios', dealId],
    queryFn: () => financialsAPI.scenarios(dealId).then((r) => r.data.data),
    enabled: !!dealId,
    staleTime: 5 * 60 * 1000,
  });
}

// Provenance-carrying defaults registry for the current asset class. The
// effective map merges globals with per-class overrides. Values are static
// at kernel-build time, so stale-time is long.
export function useDefaultsMeta(assetClass) {
  return useQuery({
    queryKey: ['defaults-meta', assetClass],
    queryFn: () => financialsAPI.defaults(assetClass).then((r) => r.data.data),
    enabled: !!assetClass,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}

// Stateless what-if runner. Takes raw assumption set + assetClass and
// returns the kernel's {kpis, costs, revenue, areas}. No DB write, no
// toast on success — the caller renders deltas inline next to the slider.
export function useQuickCompute() {
  return useMutation({
    mutationFn: (data) => financialsAPI.quickCompute(data).then((r) => r.data.data),
    // Errors surface via the returned `error` — the what-if panel shows
    // them inline. No global toast so rapid-fire slider changes don't
    // spam the user.
  });
}
