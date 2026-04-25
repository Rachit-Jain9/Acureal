import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parcelIntelligenceAdminAPI } from '../services/api';
import { toast } from '../components/common/Toast';

export function useParcelIntelligenceStatus() {
  return useQuery({
    queryKey: ['parcel-intelligence-admin-status'],
    queryFn: () => parcelIntelligenceAdminAPI.status().then((response) => response.data.data),
  });
}

export function useParcelIntelligenceReviewQueue(params = {}) {
  return useQuery({
    queryKey: ['parcel-intelligence-review-queue', params],
    queryFn: () => parcelIntelligenceAdminAPI.reviewQueue(params).then((response) => response.data.data ?? []),
    keepPreviousData: true,
  });
}

export function useReviewParcelIntelligenceItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id, status, notes }) =>
      parcelIntelligenceAdminAPI.reviewItem(type, id, { status, notes }).then((response) => response.data.data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['parcel-intelligence-admin-status'] });
      queryClient.invalidateQueries({ queryKey: ['parcel-intelligence-review-queue'] });
      toast.success(`Review item marked ${variables.status.replace(/_/g, ' ')}`);
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Review update failed');
    },
  });
}
