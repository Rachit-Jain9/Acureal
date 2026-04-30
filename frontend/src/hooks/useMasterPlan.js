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

export function useMasterPlanDocumentVersions(id) {
  return useQuery({
    queryKey: ['master-plan-doc-versions', id],
    queryFn: () => masterPlanAPI.getDocVersions(id).then((r) => r.data.data ?? []),
    enabled: !!id,
  });
}

export function useUploadMasterPlanDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      city,
      planName,
      planVersion,
      docType,
      sourceRole,
      legalStatus,
      authorityName,
      processingMode,
      ocrRequired,
      registryNotes,
    }) => {
      const urlRes = await masterPlanAPI.getDocUploadUrl(file.name, file.size);
      const { signedUrl, storagePath } = urlRes.data.data;

      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text().catch(() => '');
        throw new Error(`Direct upload failed (${uploadRes.status}): ${errText || uploadRes.statusText}`);
      }

      const confirmRes = await masterPlanAPI.confirmDocUpload({
        storagePath,
        originalName: file.name,
        fileType: file.type,
        fileSize: file.size,
        city,
        planName,
        planVersion,
        docType,
        sourceRole,
        legalStatus,
        authorityName,
        processingMode,
        ocrRequired,
        registryNotes,
      });

      return confirmRes.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['master-plan-docs'] });
      toast.success('Source document uploaded');
    },
    onError: (err) => toast.error(err.response?.data?.message || err.message || 'Upload failed'),
  });
}

export function useExtractMasterPlanDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, docType }) =>
      masterPlanAPI.extractDoc(id, { docType }).then((r) => r.data.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['master-plan-docs'] });
      qc.invalidateQueries({ queryKey: ['master-plan-zones'] });
      qc.invalidateQueries({ queryKey: ['parcel-intelligence-admin-status'] });
      qc.invalidateQueries({ queryKey: ['parcel-intelligence-review-queue'] });
      const queued =
        (data?.document?.evidence_facts_extracted || 0)
        + (data?.document?.far_rules_extracted || 0)
        + (data?.document?.guidance_rows_extracted || 0)
        + (data?.document?.zones_extracted || 0);
      toast.success(queued > 0 ? `${queued} item${queued === 1 ? '' : 's'} queued for review` : 'Extraction completed');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Extraction failed'),
  });
}

export function useUpdateMasterPlanDocumentMetadata() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) =>
      masterPlanAPI.updateDocMetadata(id, data).then((r) => r.data.data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['master-plan-docs'] });
      qc.invalidateQueries({ queryKey: ['master-plan-doc-versions', id] });
      toast.success('Source metadata updated');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Source metadata update failed'),
  });
}

export function useOpenMasterPlanDocument() {
  return useMutation({
    mutationFn: (id) => masterPlanAPI.downloadDoc(id).then((r) => r.data.data),
    onSuccess: (data) => {
      if (data?.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      }
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not open source'),
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

export function useAssignZoneToProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ zoneId, propertyId, notes }) =>
      masterPlanAPI.assignZoneToProperty(zoneId, { propertyId, notes }).then((r) => r.data.data),
    onSuccess: (data, { propertyId }) => {
      qc.invalidateQueries({ queryKey: ['properties'] });
      qc.invalidateQueries({ queryKey: ['property', propertyId] });
      qc.invalidateQueries({ queryKey: ['property', propertyId, 'parcel-intelligence'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
      qc.invalidateQueries({ queryKey: ['deal-workspace'] });
      toast.success(`Assigned ${data?.zone?.zone_code || 'reviewed zone'}`);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Zone assignment failed'),
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
