import axios from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { documentsAPI, extractionAPI } from '../services/api';
import { toast } from '../components/common/Toast';

const getDocumentErrorMessage = (err, fallback) => {
  if (err.code === 'ECONNABORTED') {
    return 'Upload timed out. Please retry with a smaller file or a more stable connection.';
  }

  if (err.response?.status === 413) {
    return 'File exceeds the maximum allowed size (50 MB).';
  }

  if (err.response?.status === 403) {
    return err.response.data?.message || 'You do not have permission to perform this action.';
  }

  if (err.response?.data?.message) {
    return err.response.data.message;
  }

  if (err.message) {
    return err.message;
  }

  if (err.request) {
    return 'No response from the server. Check your connection and retry.';
  }

  return fallback;
};

// The extract endpoint returns HTTP 201 for completed, partial, AND failed
// runs — a failed extraction is caught server-side and returned, not thrown —
// so a blanket "Document extracted" success toast lies to the operator when
// nothing was captured. Decide an honest toast from the returned row. Pure +
// exported for unit testing. `structured_fields` may arrive as an object
// (JSONB) or a JSON string depending on the column type, so handle both.
export function resolveExtractionToast(extraction) {
  const status = extraction?.extraction_status;
  let fields = extraction?.structured_fields;
  if (typeof fields === 'string') {
    try { fields = JSON.parse(fields); } catch { fields = null; }
  }
  const fieldCount = fields && typeof fields === 'object' ? Object.keys(fields).length : 0;

  if (status === 'failed') {
    return {
      type: 'error',
      message: extraction?.error_message
        ? `Extraction failed: ${extraction.error_message}`
        : 'Extraction failed — please retry.',
    };
  }
  if (fieldCount === 0) {
    return { type: 'warning', message: 'Extraction finished, but no fields were found in this document.' };
  }
  if (status === 'partial') {
    return { type: 'warning', message: 'Document partially extracted — some fields may be missing. Please review.' };
  }
  const ingestion = extraction?.evidence_ingestion;
  if (ingestion && ingestion.skipped === false) {
    return { type: 'success', message: 'Evidence queued for review' };
  }
  return { type: 'success', message: 'Document extracted' };
}

export function useDocumentDealOptions() {
  return useQuery({
    queryKey: ['documents', 'deal-options'],
    queryFn: () => documentsAPI.dealOptions().then((r) => r.data.data),
  });
}

export function useDocuments(dealId, category) {
  return useQuery({
    queryKey: ['documents', dealId, category],
    queryFn: () => documentsAPI.list(dealId, category).then((r) => r.data.documents ?? r.data),
    enabled: !!dealId,
  });
}

/**
 * Two-step direct-to-Supabase upload:
 *   1. Get a presigned URL from the backend
 *   2. PUT the file directly to Supabase (bypasses Vercel 4.5 MB limit)
 *   3. Confirm the upload with the backend to save metadata
 *
 * Variables:
 *   • onProgress(pct) — 0-100 upload progress, driven by the direct PUT.
 *   • silent — suppress the per-file success toast. The multi-file queue sets
 *     this and shows ONE summary toast at the end instead of N.
 */
export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dealId, file, category, description, onProgress }) => {
      // Step 1: get presigned upload URL
      const urlRes = await documentsAPI.getUploadUrl(dealId, file.name, file.size);
      const { signedUrl, storagePath } = urlRes.data.data;

      // Step 2: PUT directly to Supabase. A BARE axios call (not the shared
      // `api` instance) so no auth interceptor / baseURL ever touches the
      // signed URL — and so we get real upload-progress events, which the
      // fetch API cannot report.
      await axios.put(signedUrl, file, {
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        onUploadProgress: (evt) => {
          if (typeof onProgress === 'function' && evt.total) {
            onProgress(Math.min(100, Math.round((evt.loaded / evt.total) * 100)));
          }
        },
      });

      // Step 3: confirm upload with backend
      const confirmRes = await documentsAPI.confirmUpload(dealId, {
        storagePath,
        originalName: file.name,
        fileType: file.type,
        fileSize: file.size,
        category,
        description,
      });

      return confirmRes.data;
    },
    onSuccess: (_, { dealId, silent }) => {
      qc.invalidateQueries({ queryKey: ['documents', dealId] });
      qc.invalidateQueries({ queryKey: ['deal-workspace', dealId] });
      if (!silent) toast.success('Document uploaded');
    },
    // The queue reports a single summary error/success; a per-file toast here
    // would spam under a batch. Only toast when not silent.
    onError: (err, vars) => {
      if (!vars?.silent) toast.error(getDocumentErrorMessage(err, 'Upload failed'));
    },
  });
}

export function useExtractDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, docType }) =>
      extractionAPI.extract(documentId, docType ? { docType } : undefined).then((response) => response.data.data),
    onSuccess: (extraction, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['extractions', dealId] });
      qc.invalidateQueries({ queryKey: ['documents', dealId] });
      qc.invalidateQueries({ queryKey: ['deal-workspace', dealId] });
      qc.invalidateQueries({ queryKey: ['parcel-intelligence-admin-status'] });
      qc.invalidateQueries({ queryKey: ['parcel-intelligence-review-queue'] });

      const { type, message } = resolveExtractionToast(extraction);
      toast[type](message);
    },
    onError: (err) => toast.error(getDocumentErrorMessage(err, 'Extraction failed')),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, docId }) => documentsAPI.delete(dealId, docId),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['documents', dealId] });
      qc.invalidateQueries({ queryKey: ['deal-workspace', dealId] });
      toast.success('Document deleted');
    },
    onError: (err) => toast.error(getDocumentErrorMessage(err, 'Delete failed')),
  });
}

export function useDownloadDocument() {
  return useMutation({
    mutationFn: ({ dealId, docId }) => documentsAPI.download(dealId, docId).then((r) => r.data),
    onError: (err) => toast.error(getDocumentErrorMessage(err, 'Download failed')),
  });
}
