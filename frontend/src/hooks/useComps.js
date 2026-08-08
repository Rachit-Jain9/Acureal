import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { compsAPI } from '../services/api';
import { toast } from '../components/common/Toast';
import { invalidateCompsDependents } from './compsQueries';

export function useComps(params = {}) {
  return useQuery({
    queryKey: ['comps', params],
    queryFn: () => compsAPI.list(params).then((r) => r.data),
  });
}

export function useCreateComp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => compsAPI.create(data).then((r) => r.data),
    onSuccess: () => {
      invalidateCompsDependents(qc);
      toast.success('Comparable added');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to add comparable'),
  });
}

export function useDeleteComp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => compsAPI.delete(id),
    onSuccess: () => {
      invalidateCompsDependents(qc);
      toast.success('Comparable deleted');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete comparable'),
  });
}
