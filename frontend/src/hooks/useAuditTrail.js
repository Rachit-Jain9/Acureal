import { useQuery } from '@tanstack/react-query';
import { adminAPI } from '../services/api';

// E7-PR2 (2026-05-27) — admin audit-trail tail with filters. Reads
// /api/admin/audit-trail which queries `deal_events` (HMAC-signed
// financial-computation audit log). Returns:
//   { events[], event_type_catalog[], window_days, limit, filter }
//
// The dashboard's small Recent Events widget still reads /admin/recent-events
// (unchanged flat-array shape). This hook is for the dedicated admin page
// that needs filters + larger result sets.
//
// Filters:
//   days        — 1-365 (default 7)
//   eventType   — exact match against deal_events.event_type
//   dealId      — UUID to scope to one deal
//   limit       — 1-200 (default 50)
export function useAuditTrail({ days = 7, eventType = null, dealId = null, limit = 50 } = {}) {
  const params = { days, limit };
  if (eventType) params.eventType = eventType;
  if (dealId) params.dealId = dealId;
  return useQuery({
    queryKey: ['admin-audit-trail', days, eventType, dealId, limit],
    queryFn: () => adminAPI.getAuditTrail(params).then((r) => r.data.data),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
