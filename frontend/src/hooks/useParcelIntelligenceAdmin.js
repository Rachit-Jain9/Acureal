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

export function useReviewParcelIntelligenceItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ items, status, notes }) =>
      parcelIntelligenceAdminAPI.reviewItems({ items, status, notes }).then((response) => response.data.data),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['parcel-intelligence-admin-status'] });
      queryClient.invalidateQueries({ queryKey: ['parcel-intelligence-review-queue'] });
      const updated = result?.summary?.updated || 0;
      const failed = result?.summary?.failed || 0;
      toast.success(`Marked ${updated} item${updated === 1 ? '' : 's'} ${variables.status.replace(/_/g, ' ')}${failed ? `; ${failed} failed` : ''}`);
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Batch review update failed');
    },
  });
}

export function usePromoteEvidenceFactToProperty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, overwrite = false }) =>
      parcelIntelligenceAdminAPI.promoteEvidenceFact(id, { overwrite }).then((response) => response.data.data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['parcel-intelligence-admin-status'] });
      queryClient.invalidateQueries({ queryKey: ['parcel-intelligence-review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['property', result?.property_id] });
      queryClient.invalidateQueries({ queryKey: ['deal-workspace'] });
      queryClient.invalidateQueries({ queryKey: ['property', result?.property_id, 'parcel-intelligence'] });
      toast.success(`${result?.label || 'Evidence'} promoted to property inputs`);
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Promotion failed');
    },
  });
}

export function usePromoteEvidenceFactsToProperty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, overwrite = false }) =>
      parcelIntelligenceAdminAPI
        .promoteEvidenceFacts({ fact_ids: ids, overwrite })
        .then((response) => response.data.data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['parcel-intelligence-admin-status'] });
      queryClient.invalidateQueries({ queryKey: ['parcel-intelligence-review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['deal-workspace'] });
      (result?.promoted || []).forEach((item) => {
        queryClient.invalidateQueries({ queryKey: ['property', item?.property_id] });
        queryClient.invalidateQueries({ queryKey: ['property', item?.property_id, 'parcel-intelligence'] });
      });
      const promoted = result?.summary?.promoted || 0;
      const skipped = result?.summary?.skipped || 0;
      const failed = result?.summary?.failed || 0;
      toast.success(`Promoted ${promoted} input${promoted === 1 ? '' : 's'}${skipped || failed ? `; ${skipped + failed} skipped` : ''}`);
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Batch promotion failed');
    },
  });
}
