import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { activitiesAPI } from '../services/api';
import { toast } from '../components/common/Toast';

export function useActivities(dealId, params = {}) {
  return useQuery({
    queryKey: ['activities', dealId, params],
    queryFn: () => activitiesAPI.list(dealId, params).then((r) => r.data),
    enabled: !!dealId,
  });
}

export function useActivityFeed(params = {}) {
  return useQuery({
    queryKey: ['activities', 'feed', params],
    queryFn: () => activitiesAPI.all(params).then((r) => r.data),
  });
}

export function useRecentActivities(limit = 20) {
  return useQuery({
    queryKey: ['activities', 'recent', limit],
    queryFn: () => activitiesAPI.recent(limit).then((r) => r.data.data),
  });
}

export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, data }) => activitiesAPI.create(dealId, data).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['activities', dealId] });
      qc.invalidateQueries({ queryKey: ['activities', 'feed'] });
      qc.invalidateQueries({ queryKey: ['activities', 'recent'] });
      qc.invalidateQueries({ queryKey: ['deal', dealId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Activity logged');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to log activity'),
  });
}

export function useUpdateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ activityId, data }) => activitiesAPI.update(activityId, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activities'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Activity updated');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update activity'),
  });
}

export function useUpdateActivityStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ activityId, status }) => activitiesAPI.updateStatus(activityId, status).then((r) => r.data),
    onSuccess: (_, { status }) => {
      qc.invalidateQueries({ queryKey: ['activities'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(status === 'completed' ? 'Activity completed' : 'Activity updated');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update activity status'),
  });
}

export function useDeleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (activityId) => activitiesAPI.delete(activityId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activities'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Activity deleted');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete activity'),
  });
}

export function useActivitiesByDeal(dealId) {
  return useQuery({
    queryKey: ['activities', dealId],
    queryFn: () => activitiesAPI.list(dealId).then((r) => r.data.data || r.data),
    enabled: !!dealId,
  });
}
