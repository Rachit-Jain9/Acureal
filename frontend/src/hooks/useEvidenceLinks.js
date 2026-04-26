import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { evidenceLinksAPI } from '../services/api';
import { toast } from '../components/common/Toast';

const OWNER_KINDS = [
  'dd_item',
  'approval',
  'risk_flag',
  'comp',
  'financial_scenario',
  'parcel_intelligence',
  'deal_note',
  'guidance_value',
];

export const EVIDENCE_OWNER_KINDS = OWNER_KINDS;

const summaryDefault = {
  source_count: 0,
  manual_count: 0,
  max_confidence: null,
  avg_confidence: null,
  bucket: 'needs_verification',
};

/**
 * Read evidence links for one workflow object (DD item, approval, risk flag,
 * comp, etc.). Pairs with backend GET /evidence-links/:ownerKind/:ownerId.
 *
 * Returns `{ links: [], summary: { bucket, max_confidence, ... } }`.
 * The `bucket` is one of `verified | inferred | needs_verification` and is
 * the same language the parcel intelligence panel uses, so a UI can render
 * a consistent chip across surfaces.
 */
export function useEvidenceLinks(ownerKind, ownerId, options = {}) {
  return useQuery({
    queryKey: ['evidence-links', ownerKind, ownerId],
    queryFn: () => evidenceLinksAPI.list(ownerKind, ownerId).then((r) => r.data?.data || { links: [], summary: summaryDefault }),
    enabled: !!ownerKind && !!ownerId && OWNER_KINDS.includes(ownerKind) && options.enabled !== false,
    staleTime: 60_000,
  });
}

export function useAttachEvidenceLink(ownerKind, ownerId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => evidenceLinksAPI.attach(ownerKind, ownerId, body).then((r) => r.data?.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['evidence-links', ownerKind, ownerId] });
      toast.success('Evidence linked');
    },
    onError: (err) => {
      const status = err?.response?.status;
      if (status === 409) {
        toast.error('That evidence is already linked.');
      } else if (status === 404) {
        toast.error('Item not found in your organization.');
      } else {
        toast.error(err?.response?.data?.message || 'Failed to link evidence');
      }
    },
  });
}

export function useDetachEvidenceLink(ownerKind, ownerId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId) => evidenceLinksAPI.detach(linkId).then((r) => r.data?.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['evidence-links', ownerKind, ownerId] });
      toast.success('Evidence unlinked');
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Failed to unlink evidence'),
  });
}

/**
 * UI helper: derive the chip tone + label from a summary row, matching the
 * tones used by the parcel verdict so DD/approvals/risk feel consistent.
 *
 *   verified            → green pill, "Verified"
 *   inferred            → amber pill, "Inferred"
 *   needs_verification  → grey pill, "Unverified"
 */
export const deriveEvidenceChip = (summary = summaryDefault) => {
  const bucket = summary?.bucket || 'needs_verification';
  if (bucket === 'verified') {
    return {
      tone: 'success',
      label: 'Verified',
      sublabel: summary.source_count ? `${summary.source_count} source${summary.source_count > 1 ? 's' : ''}` : '',
    };
  }
  if (bucket === 'inferred') {
    return {
      tone: 'warning',
      label: 'Inferred',
      sublabel: summary.source_count
        ? `${summary.source_count} reference${summary.source_count > 1 ? 's' : ''}`
        : `${summary.manual_count} manual`,
    };
  }
  return {
    tone: 'muted',
    label: 'Unverified',
    sublabel: 'Add evidence to verify',
  };
};
