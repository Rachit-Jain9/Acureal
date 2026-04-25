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
 */
export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dealId, file, category, description }) => {
      // Step 1: get presigned upload URL
      const urlRes = await documentsAPI.getUploadUrl(dealId, file.name, file.size);
      const { signedUrl, storagePath } = urlRes.data.data;

      // Step 2: upload directly to Supabase
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text().catch(() => '');
        throw new Error(`Direct upload failed (${uploadRes.status}): ${errText || uploadRes.statusText}`);
      }

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
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['documents', dealId] });
      qc.invalidateQueries({ queryKey: ['deal-workspace', dealId] });
      toast.success('Document uploaded');
    },
    onError: (err) => toast.error(getDocumentErrorMessage(err, 'Upload failed')),
  });
}

export function useExtractDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId }) =>
      extractionAPI.extract(documentId).then((response) => response.data.data),
    onSuccess: (extraction, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['extractions', dealId] });
      qc.invalidateQueries({ queryKey: ['documents', dealId] });
      qc.invalidateQueries({ queryKey: ['deal-workspace', dealId] });
      qc.invalidateQueries({ queryKey: ['parcel-intelligence-admin-status'] });
      qc.invalidateQueries({ queryKey: ['parcel-intelligence-review-queue'] });

      const ingestion = extraction?.evidence_ingestion;
      if (ingestion && ingestion.skipped === false) {
        toast.success('Evidence queued for review');
      } else {
        toast.success('Document extracted');
      }
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
