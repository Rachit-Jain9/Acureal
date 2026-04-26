import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { propertiesAPI } from '../services/api';
import { toast } from '../components/common/Toast';

export function useProperties(params = {}) {
  return useQuery({
    queryKey: ['properties', params],
    queryFn: () => propertiesAPI.list(params).then((r) => r.data),
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

export function useDeleteProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => propertiesAPI.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['properties'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Property deleted');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to delete property'),
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
      toast.success('Parcel intelligence refreshed');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Parcel intelligence refresh failed'),
  });
}
