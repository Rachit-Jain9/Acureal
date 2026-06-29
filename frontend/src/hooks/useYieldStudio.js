import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { yieldStudioAPI } from '../services/api';
import { toast } from '../components/common/Toast';

// Server-saved Yield Studio study (per deal). The server row is the source of
// truth (cross-device / team); the component keeps a localStorage cache for an
// instant first paint. Mutations use setQueryData (not invalidate) so the saved
// echo seeds the cache without a stale→fresh refetch flip.

export function useYieldStudy(dealId) {
  return useQuery({
    queryKey: ['deal', dealId, 'yield-study'],
    queryFn: () => yieldStudioAPI.getStudy(dealId).then((r) => r.data.data),
    enabled: !!dealId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveYieldStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, ...body }) => yieldStudioAPI.saveStudy(dealId, body).then((r) => r.data.data),
    onSuccess: (saved, { dealId }) => qc.setQueryData(['deal', dealId, 'yield-study'], saved),
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not save the study'),
  });
}

// Analyst-uploaded / drawn parcel boundary (per property), persisted server-side.
export function useParcelBoundary(propertyId) {
  return useQuery({
    queryKey: ['property', propertyId, 'boundary'],
    queryFn: () => yieldStudioAPI.getBoundary(propertyId).then((r) => r.data.data),
    enabled: !!propertyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUploadParcelBoundary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ propertyId, ...body }) => yieldStudioAPI.saveBoundary(propertyId, body).then((r) => r.data.data),
    onSuccess: (saved, { propertyId }) => {
      qc.setQueryData(['property', propertyId, 'boundary'], saved);
      toast.success('Parcel boundary saved.');
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Boundary upload failed'),
  });
}
