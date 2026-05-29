import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { parcelIntelligenceAdminAPI } from '../services/api';
import { toast } from '../components/common/Toast';

const getApiErrorMessage = (error, fallback) => {
  const data = error?.response?.data;
  if (Array.isArray(data?.errors) && data.errors.length) {
    const details = data.errors
      .slice(0, 3)
      .map((item) => [item.field, item.message].filter(Boolean).join(': '))
      .filter(Boolean)
      .join('; ');
    return details ? `${data.message || fallback}: ${details}` : data.message || fallback;
  }
  return data?.message || error?.message || fallback;
};

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
    // React Query v5: the bare `keepPreviousData: true` option was removed;
    // it's now `placeholderData: keepPreviousData` (the imported helper). The
    // old form was a silent no-op, so paginated/filtered lists flashed a
    // skeleton on every page/filter change instead of holding prior rows.
    placeholderData: keepPreviousData,
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
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['property'] });
      queryClient.invalidateQueries({ queryKey: ['deal-workspace'] });
      toast.success(`Review item marked ${variables.status.replace(/_/g, ' ')}`);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Review update failed'));
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
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['property'] });
      queryClient.invalidateQueries({ queryKey: ['deal-workspace'] });
      const updated = result?.summary?.updated || 0;
      const failed = result?.summary?.failed || 0;
      toast.success(`Marked ${updated} item${updated === 1 ? '' : 's'} ${variables.status.replace(/_/g, ' ')}${failed ? `; ${failed} failed` : ''}`);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Batch review update failed'));
    },
  });
}

export function useCreateAuthorityInput() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) =>
      parcelIntelligenceAdminAPI.createAuthorityInput(data).then((response) => response.data.data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['parcel-intelligence-admin-status'] });
      queryClient.invalidateQueries({ queryKey: ['parcel-intelligence-review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['property', result?.property_id] });
      queryClient.invalidateQueries({ queryKey: ['deal-workspace'] });
      queryClient.invalidateQueries({ queryKey: ['property', result?.property_id, 'parcel-intelligence'] });
      toast.success('Authority input created');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Authority input creation failed'));
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
      toast.error(getApiErrorMessage(error, 'Promotion failed'));
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
      toast.error(getApiErrorMessage(error, 'Batch promotion failed'));
    },
  });
}
