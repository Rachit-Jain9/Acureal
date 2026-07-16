import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rentRollAPI } from '../services/api';
import { toast } from '../components/common/Toast';

// Deal Register data layer. The GET returns { register, records: { kind: rows } }
// (register null = valid empty state). Record mutations invalidate the register
// query AND the deal-workspace payload (its rent_roll summary slice must not
// go stale — the server recomputed it inside the mutation transaction).

const registerKey = (dealId) => ['rent-roll', dealId];

export function useRentRoll(dealId) {
  return useQuery({
    queryKey: registerKey(dealId),
    queryFn: () => rentRollAPI.get(dealId).then((r) => r.data.data),
    enabled: !!dealId,
    staleTime: 60 * 1000,
  });
}

const invalidate = (qc, dealId) => {
  qc.invalidateQueries({ queryKey: registerKey(dealId) });
  qc.invalidateQueries({ queryKey: ['deal-workspace', dealId] });
  qc.invalidateQueries({ queryKey: ['deal-workspace-lite', dealId] });
};

export function useSaveRegisterSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, ...body }) => rentRollAPI.saveSettings(dealId, body).then((r) => r.data.data),
    onSuccess: (_saved, { dealId }) => invalidate(qc, dealId),
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not save register settings'),
  });
}

export function useCreateRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, kind, ...data }) =>
      rentRollAPI.createRecord(dealId, { kind, ...data }).then((r) => r.data.data),
    onSuccess: (_rec, { dealId }) => invalidate(qc, dealId),
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not add the record'),
  });
}

export function useUpdateRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, kind, recordId, ...data }) =>
      rentRollAPI.updateRecord(dealId, kind, recordId, data).then((r) => r.data.data),
    onSuccess: (_rec, { dealId }) => invalidate(qc, dealId),
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not save the change'),
  });
}

export function useCommitImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, fileBase64 }) =>
      rentRollAPI.commitImport(dealId, fileBase64).then((r) => r.data),
    onSuccess: (_res, { dealId }) => invalidate(qc, dealId),
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not import the template'),
  });
}

export function useDeleteRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, kind, recordId }) =>
      rentRollAPI.deleteRecord(dealId, kind, recordId).then((r) => r.data.data),
    onSuccess: (_res, { dealId }) => {
      invalidate(qc, dealId);
      toast.success('Record removed.');
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not remove the record'),
  });
}
