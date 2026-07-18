import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { adminAPI } from '../services/api';

// Platform-wide signup roster from /api/admin/signups. Powers the operator's
// "Signups" admin page — who has joined the open beta, with the profile detail
// they gave (company / role / city) and account timestamps. Platform-admin only.
//
// `search` filters server-side across name / email / company / city. We keep
// the previous page's rows visible while a new search resolves so the table
// doesn't flash empty on each keystroke.
export function useSignups({ search = '', limit = 200 } = {}) {
  return useQuery({
    queryKey: ['admin-signups', search, limit],
    queryFn: () =>
      adminAPI.getSignups({ search: search || undefined, limit }).then((r) => r.data.data),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
}
