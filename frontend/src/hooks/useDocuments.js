import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { documentsAPI } from '../services/api';
import { toast } from '../components/common/Toast';

const getDocumentErrorMessage = (err, fallback) => {
  if (err.code === 'ECONNABORTED') {
    return 'Upload timed out. Please retry with a smaller file or a more stable connection.';
  }

  if (err.response?.data?.message) {
    return err.response.data.message;
  }

  if (err.request) {
    return 'Could not reach the document service. Please retry.';
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

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, formData }) => documentsAPI.upload(dealId, formData).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['documents', dealId] });
      toast.success('Document uploaded');
    },
    onError: (err) => toast.error(getDocumentErrorMessage(err, 'Upload failed')),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, docId }) => documentsAPI.delete(dealId, docId),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['documents', dealId] });
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
