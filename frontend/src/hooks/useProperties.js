import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { propertiesAPI } from '../services/api';
import { toast } from '../components/common/Toast';

// `options` forwards react-query settings (e.g. { enabled, staleTime }) so a
// caller can defer the fetch until it's actually needed — e.g. the Deals page
// only needs the property picker once the New-Deal modal opens, not on every
// list visit. Backward-compatible: existing callers pass only params.
export function useProperties(params = {}, options = {}) {
  return useQuery({
    queryKey: ['properties', params],
    queryFn: () => propertiesAPI.list(params).then((r) => r.data),
    ...options,
  });
}

export function useProperty(id) {
  return useQuery({
    queryKey: ['property', id],
    queryFn: () => propertiesAPI.get(id).then((r) => r.data.data),
    enabled: !!id,
  });
}

export function useCreateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => propertiesAPI.create(data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['properties'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Property created');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create property'),
  });
}

// Smart Property Capture — sends a raw user input (Google Maps URL,
// Plus Code, lat/lng, survey number, address, or broker text) to the
// /capture endpoint and returns the resolved candidate (no DB write).
// The caller renders a preview and, on confirm, hands suggestedFields
// to useCreateProperty.
export function useCaptureProperty() {
  return useMutation({
    mutationFn: ({ input, aiAssisted = true } = {}) =>
      propertiesAPI.capture({ input, aiAssisted }).then((r) => r.data.data),
    onError: (err) =>
      toast.error(err.response?.data?.message || 'Could not resolve that input. Try a different format.'),
  });
}

export function useUpdateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => propertiesAPI.update(id, data).then((r) => r.data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['properties'] });
      qc.invalidateQueries({ queryKey: ['property', id] });
      qc.invalidateQueries({ queryKey: ['property', id, 'parcel-intelligence'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
      qc.invalidateQueries({ queryKey: ['deal-workspace'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Property updated');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update property'),
  });
}

export function useGeocodeProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => propertiesAPI.geocode(id).then((r) => r.data),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['properties'] });
      qc.invalidateQueries({ queryKey: ['property', id] });
      toast.success('Property geocoded — map pin updated');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Geocoding failed'),
  });
}

export function useBulkGeocodeProperties() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => propertiesAPI.bulkGeocode().then((r) => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['properties'] });
      toast.success(data.message || 'All properties re-geocoded');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Bulk geocode failed'),
  });
}

export function useParcelIntelligence(propertyId) {
  return useQuery({
    queryKey: ['property', propertyId, 'parcel-intelligence'],
    queryFn: () => propertiesAPI.parcelIntelligence(propertyId).then((r) => r.data.data),
    enabled: !!propertyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useRefreshParcelIntelligence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (propertyId) => propertiesAPI.refreshParcelIntelligence(propertyId).then((r) => r.data.data),
    onSuccess: (_, propertyId) => {
      qc.invalidateQueries({ queryKey: ['property', propertyId, 'parcel-intelligence'] });
      qc.invalidateQueries({ queryKey: ['property', propertyId, 'parcel-verifications'] });
      toast.success('Parcel intelligence refreshed');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Parcel intelligence refresh failed'),
  });
}

export function useParcelVerifications(propertyId) {
  return useQuery({
    queryKey: ['property', propertyId, 'parcel-verifications'],
    queryFn: () => propertiesAPI.parcelVerifications(propertyId).then((r) => r.data.data),
    enabled: !!propertyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useVerifyParcelItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ propertyId, ...payload }) =>
      propertiesAPI.verifyParcelItem(propertyId, payload).then((r) => r.data.data),
    onSuccess: (_, { propertyId }) => {
      qc.invalidateQueries({ queryKey: ['property', propertyId, 'parcel-verifications'] });
      qc.invalidateQueries({ queryKey: ['property', propertyId, 'parcel-intelligence'] });
      toast.success('Item verified — citation logged');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Verification failed'),
  });
}

// Apply the AutoFillParcelContextCard's picks via the dedicated
// /properties/:id/apply-auto-derived-context endpoint. Invalidates the
// same caches as useUpdateProperty so the deal page reflects the new
// auto_derived_* values without a manual refresh.
export function useApplyAutoDerivedContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, picks, derivedSource }) =>
      propertiesAPI.applyAutoDerivedContext(id, { picks, derivedSource }).then((r) => r.data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['properties'] });
      qc.invalidateQueries({ queryKey: ['property', id] });
      qc.invalidateQueries({ queryKey: ['property', id, 'parcel-intelligence'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
      qc.invalidateQueries({ queryKey: ['deal-workspace'] });
    },
    onError: (err) =>
      toast.error(err.response?.data?.message || 'Failed to apply auto-derived context'),
  });
}

export function useUnverifyParcelItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ propertyId, linkId }) =>
      propertiesAPI.unverifyParcelItem(propertyId, linkId).then((r) => r.data.data),
    onSuccess: (_, { propertyId }) => {
      qc.invalidateQueries({ queryKey: ['property', propertyId, 'parcel-verifications'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not remove verification'),
  });
}
