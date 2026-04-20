import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { masterPlanAPI } from '../services/api';
import { toast } from '../components/common/Toast';

export function useZones(params = {}) {
  return useQuery({
    queryKey: ['master-plan-zones', params],
    queryFn: () => masterPlanAPI.listZones(params).then((r) => r.data.data ?? []),
    keepPreviousData: true,
  });
}

export function useZone(id, params = {}) {
  return useQuery({
    queryKey: ['master-plan-zone', id, params],
    queryFn: () => masterPlanAPI.getZone(id, params).then((r) => r.data.data),
    enabled: !!id,
  });
}

export function useZoneVersions(id) {
  return useQuery({
    queryKey: ['master-plan-zone-versions', id],
    queryFn: () => masterPlanAPI.getVersions(id).then((r) => r.data.data ?? []),
    enabled: !!id,
  });
}

export function useMasterPlanDocuments(params = {}) {
  return useQuery({
    queryKey: ['master-plan-docs', params],
    queryFn: () => masterPlanAPI.listDocs(params).then((r) => r.data.data ?? []),
  });
}

export function useCreateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => masterPlanAPI.createZone(data).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['master-plan-zones'] });
      toast.success('Zone created');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create zone'),
  });
}

export function useUpdateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => masterPlanAPI.updateZone(id, data).then((r) => r.data.data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['master-plan-zones'] });
      qc.invalidateQueries({ queryKey: ['master-plan-zone', id] });
      qc.invalidateQueries({ queryKey: ['master-plan-zone-versions', id] });
      toast.success('Zone updated');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to update zone'),
  });
}

export function useReviewZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, changeReason }) =>
      masterPlanAPI.reviewZone(id, { status, changeReason }).then((r) => r.data.data),
    onSuccess: (_, { id, status }) => {
      qc.invalidateQueries({ queryKey: ['master-plan-zones'] });
      qc.invalidateQueries({ queryKey: ['master-plan-zone', id] });
      toast.success(`Zone ${status}`);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Review failed'),
  });
}

// Deterministic rules engine — mirrors backend/Postgres implementation.
// Road-width-tiered FSI. Returns null only if the zone lacks a base.
export function calculateEffectiveFSI(zone, roadWidthM) {
  if (!zone) return null;
  const base = zone.permissible_fsi_base;
  const rules = Array.isArray(zone.fsi_road_width_rules) ? zone.fsi_road_width_rules : [];
  const rw = Number(roadWidthM);
  if (!rules.length || !Number.isFinite(rw)) return base ?? null;
  const sorted = [...rules].sort(
    (a, b) => Number(b.road_width_m || 0) - Number(a.road_width_m || 0),
  );
  const match = sorted.find((r) => rw >= Number(r.road_width_m || 0));
  return match?.fsi != null ? Number(match.fsi) : (base ?? null);
}
