import { useQuery, useMutation } from '@tanstack/react-query';
import { dealEventsAPI } from '../services/api';
import { toast } from '../components/common/Toast';

const errMessage = (err, fallback) =>
  err?.response?.data?.message || err?.message || fallback;

// Audit-tab data hook. Pulls the signed deal_events for a deal with a
// curated outputs-summary projection so the timeline can render KPI
// deltas (IRR, NPV, revenue, cost) between consecutive events without
// N+1 round-trips.
export function useDealEvents(dealId, { limit = 50 } = {}) {
  return useQuery({
    queryKey: ['deal-events', dealId, limit],
    queryFn: () =>
      dealEventsAPI
        .list(dealId, { limit, include_outputs_summary: true })
        .then((r) => r.data.data),
    enabled: !!dealId,
    staleTime: 30_000,
  });
}

// Cryptographic verification for a single event. Server re-hashes the
// inputs/outputs JSON and re-signs the row — pass/fail per layer
// (inputs hash, outputs hash, HMAC signature). Used by the Verify
// button on the audit row.
export function useVerifyDealEvent() {
  return useMutation({
    mutationFn: ({ dealId, eventId }) =>
      dealEventsAPI.verify(dealId, eventId).then((r) => r.data.data),
    onError: (err) => toast.error(errMessage(err, 'Verify failed')),
  });
}

// Replay an event — runs the deterministic kernel against the stored
// inputs and diffs the result against the stored outputs. The "prove
// the number on the pitch deck" primitive. Admin/analyst only.
export function useReplayDealEvent() {
  return useMutation({
    mutationFn: ({ dealId, eventId }) =>
      dealEventsAPI.replay(dealId, eventId).then((r) => r.data.data),
    onSuccess: (data) => {
      // The replay result includes a `replay.differs` boolean — surface a
      // toast either way so the analyst knows the call landed.
      if (data?.replay?.differs) {
        toast.error('Replay differed from stored outputs — open the row for details.');
      } else {
        toast.success('Replay matches stored outputs.');
      }
    },
    onError: (err) => toast.error(errMessage(err, 'Replay failed')),
  });
}
