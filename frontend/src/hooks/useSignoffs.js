import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { signoffsAPI } from '../services/api';
import { toast } from '../components/common/Toast';
import { invalidateDealPosture } from './dealPostureQueries';

// Professional sign-off board — the advocate / CA / architect / engineer /
// structural engineer / banker certificate set for a deal. A SIGNED sign-off
// marks its matching K-RERA cockpit item verified, so every mutation
// invalidates the full deal-posture surface (which includes 'signoffs' and
// 'deal-workspace') to keep the board and the cockpit in lock-step.

export function useSignoffs(dealId) {
  return useQuery({
    queryKey: ['signoffs', dealId],
    queryFn: () => signoffsAPI.list(dealId).then((r) => r.data.data ?? r.data),
    enabled: !!dealId,
  });
}

export function useCreateSignoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, data }) => signoffsAPI.create(dealId, data).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      invalidateDealPosture(qc, dealId);
      toast.success('Sign-off added');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to add sign-off'),
  });
}

export function useUpdateSignoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, id, data }) => signoffsAPI.update(dealId, id, data).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      invalidateDealPosture(qc, dealId);
      toast.success('Sign-off updated');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update sign-off'),
  });
}

export function useDeleteSignoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, id }) => signoffsAPI.delete(dealId, id),
    onSuccess: (_, { dealId }) => {
      invalidateDealPosture(qc, dealId);
      toast.success('Sign-off removed');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to remove sign-off'),
  });
}

export function useSeedSignoffs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId }) => signoffsAPI.seed(dealId).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      invalidateDealPosture(qc, dealId);
      toast.success('Standard sign-off board seeded');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to seed sign-off board'),
  });
}
