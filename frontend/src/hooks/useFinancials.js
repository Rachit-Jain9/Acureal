import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { financialsAPI } from '../services/api';
import { toast } from '../components/common/Toast';
import { runQuickCompute } from '../utils/quickCompute';

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
      qc.invalidateQueries({ queryKey: ['scenarios', dealId] });
      qc.invalidateQueries({ queryKey: ['deal', dealId] });
      qc.invalidateQueries({ queryKey: ['deal-workspace', dealId] });
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

// Workstream A (Provenance Spine) — read-side model-confidence summary for a
// saved financial model: how many key inputs are set for this deal vs. still
// on REDIP's benchmark defaults. Read-only display; no toast on error — the
// panel hides itself when the payload is unavailable.
export function useModelConfidence(dealId) {
  return useQuery({
    queryKey: ['model-confidence', dealId],
    queryFn: () => financialsAPI.modelConfidence(dealId).then((r) => r.data.data),
    enabled: !!dealId,
    retry: 1,
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
//
// Defaults to running the kernel entirely in-browser (see
// `utils/clientKernel.js`) so slider scrubbing doesn't pay an HTTP
// round-trip per debounced tick. Same kernel code on both sides — the
// frontend imports the kernel source via the Vite alias — so results
// are byte-for-byte identical by construction. Set
// `VITE_CLIENT_KERNEL=0` at build time to force the server path (the
// `/financials/quick-compute` endpoint is preserved as a failsafe).
export function useQuickCompute() {
  return useMutation({
    // Routing (client kernel vs server) + envelope-unwrap live in the
    // shared runQuickCompute helper so every what-if surface (sliders,
    // tornado, scenarios) stays byte-for-byte consistent.
    mutationFn: (data) => runQuickCompute(data),
    // Errors surface via the returned `error` — the what-if panel shows
    // them inline. No global toast so rapid-fire slider changes don't
    // spam the user.
  });
}
