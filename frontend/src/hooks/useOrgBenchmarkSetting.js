import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { organizationAPI } from '../services/api';
import { toast } from '../components/common/Toast';

// Workstream C2 — the organisation's benchmark-contribution posture: the
// org-level opt-out state, its change history, and the calling user's own
// current contribution eligibility. Read-side.
export function useOrgBenchmarkSetting() {
  return useQuery({
    queryKey: ['org-benchmark-setting'],
    queryFn: () => organizationAPI.getBenchmarkSetting().then((r) => r.data.data),
  });
}

// Engage or release the org-level "do not benchmark" opt-out. The PUT returns
// the fresh payload, so the query cache is updated directly — no refetch.
export function useSetOrgBenchmarkSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (optedOut) =>
      organizationAPI.setBenchmarkSetting(optedOut).then((r) => r.data.data),
    onSuccess: (data) => {
      qc.setQueryData(['org-benchmark-setting'], data);
      toast.success(
        data.opted_out
          ? 'Benchmark opt-out engaged — your organisation will not contribute.'
          : 'Benchmark opt-out released — contribution still requires each user’s consent.',
      );
    },
    onError: (err) =>
      toast.error(
        err.response?.data?.message || 'Could not update the benchmark setting.',
      ),
  });
}
