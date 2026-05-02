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
    // Poll while any row is mid-extraction so the badge flips to completed /
    // failed without a manual refresh. 4-second cadence keeps the UI feeling
    // live without overloading the listDocuments call (the reaper also runs
    // there, so each poll doubles as a stuck-row cleanup tick). Polling
    // stops as soon as nothing is in_progress.
    refetchInterval: (data) => (
      Array.isArray(data) && data.some((doc) => doc?.extraction_status === 'in_progress')
        ? 4000
        : false
    ),
  });
}

export function useMasterPlanCorpus(params = {}) {
  return useQuery({
    queryKey: ['master-plan-corpus', params],
    queryFn: () => masterPlanAPI.listCorpus(params).then((r) => r.data.data ?? []),
  });
}

export function useLandUseIntelligence() {
  return useQuery({
    queryKey: ['master-plan-land-use-intelligence'],
    queryFn: () => masterPlanAPI.landUseIntelligence().then((r) => r.data.data ?? { existing: [], proposed: [], totals: [], callouts: [] }),
    staleTime: 5 * 60 * 1000,
  });
}

export function useDistrictIntelligence() {
  return useQuery({
    queryKey: ['master-plan-district-intelligence'],
    queryFn: () => masterPlanAPI.districtIntelligence().then((r) => r.data.data ?? { districts: [], summary: {}, callouts: {}, disclaimer: '' }),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSourceExplorer() {
  return useQuery({
    queryKey: ['master-plan-source-explorer'],
    queryFn: () => masterPlanAPI.sourceExplorer().then((r) => r.data.data ?? { sources: [], summary: {}, disclaimer: '' }),
    staleTime: 5 * 60 * 1000,
  });
}

export function useReviewQueue() {
  return useQuery({
    queryKey: ['master-plan-review-queue'],
    queryFn: () => masterPlanAPI.reviewQueue().then((r) => r.data.data ?? { counts: {}, summary: {}, needs_review: [], disclaimer: '' }),
    staleTime: 5 * 60 * 1000,
  });
}

export function useBbmpUavEntries(params = {}) {
  return useQuery({
    queryKey: ['master-plan-bbmp-uav', params],
    queryFn: () => masterPlanAPI.listBbmpUav(params).then((r) => r.data.data ?? { schema_ready: true, rows: [] }),
    keepPreviousData: true,
  });
}

export function useImportZoneGeoJSON() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => masterPlanAPI.importZonesGeoJSON(data).then((r) => r.data.data),
    onSuccess: (summary) => {
      qc.invalidateQueries({ queryKey: ['master-plan-zones'] });
      const updated = Number(summary?.updated || 0);
      const skippedExisting = Number(summary?.skipped_existing_geom || 0);
      const skippedUnknown = Number(summary?.skipped_unknown_zone || 0);
      const rejected = Number(summary?.rejected || 0);
      if (updated > 0) {
        toast.success(`${updated} zone${updated === 1 ? '' : 's'} updated · ${skippedExisting} skipped (already had geometry) · ${skippedUnknown} unmatched · ${rejected} rejected`);
      } else if (skippedExisting > 0 || skippedUnknown > 0 || rejected > 0) {
        toast.info(`No zones updated · ${skippedExisting} already had geometry · ${skippedUnknown} unmatched · ${rejected} rejected`);
      } else {
        toast.success('GeoJSON processed');
      }
    },
    onError: (err) => toast.error(err.response?.data?.message || err.message || 'GeoJSON import failed'),
  });
}

export function useMasterPlanDocumentVersions(id) {
  return useQuery({
    queryKey: ['master-plan-doc-versions', id],
    queryFn: () => masterPlanAPI.getDocVersions(id).then((r) => r.data.data ?? []),
    enabled: !!id,
  });
}

export function useMasterPlanDocumentPages(id) {
  return useQuery({
    queryKey: ['master-plan-doc-pages', id],
    queryFn: () => masterPlanAPI.getDocPages(id).then((r) => r.data.data ?? { pages: [] }),
    enabled: !!id,
  });
}

export function usePrepareMasterPlanDocumentPages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pageCount }) =>
      masterPlanAPI.prepareDocPages(id, { pageCount }).then((r) => r.data.data),
    onSuccess: (data, { id }) => {
      qc.invalidateQueries({ queryKey: ['master-plan-doc-pages', id] });
      if (data?.schema_ready === false) {
        toast.error(data.message || 'Source page storage is not ready');
        return;
      }
      const created = Number(data?.pages_created || 0);
      toast.success(created > 0 ? `${created} source page${created === 1 ? '' : 's'} prepared` : 'Source pages already prepared');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not prepare source pages'),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['master-plan-docs'] });
      qc.invalidateQueries({ queryKey: ['master-plan-corpus'] });
      toast.success('Extraction queued — running in the background. The row updates when it finishes.');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Extraction failed'),
  });
}

export function useExtractMasterPlanDocumentsBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids) => masterPlanAPI.extractDocsBatch(ids).then((r) => r.data.data),
    onSuccess: (summary) => {
      qc.invalidateQueries({ queryKey: ['master-plan-docs'] });
      qc.invalidateQueries({ queryKey: ['master-plan-corpus'] });
      const queued = Number(summary?.queued_count || 0);
      const skipped = Number(summary?.skipped_count || 0);
      if (queued > 0 && skipped === 0) {
        toast.success(`${queued} extraction${queued === 1 ? '' : 's'} queued — running in the background.`);
      } else if (queued > 0 && skipped > 0) {
        toast.info(`${queued} queued · ${skipped} skipped (not extractable or blocked).`);
      } else if (queued === 0 && skipped > 0) {
        toast.error(`No extractable documents in selection — ${skipped} skipped.`);
      } else {
        toast.info('No documents selected for extraction.');
      }
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Batch extraction failed'),
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
