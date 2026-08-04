import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { publicParcelAPI } from '../services/api';

// Public twin of useStreetLookup — same query shape, unauthenticated client,
// and the server-side public row cap (the limit param is advisory there).
export function usePublicStreetLookup(params = {}) {
  const search = String(params.search || '').trim();
  return useQuery({
    queryKey: ['public-parcel-street-lookup', search],
    queryFn: () => publicParcelAPI
      .streetLookup({ q: search })
      .then((r) => r.data.data ?? { query: search, rows: [], summary: {}, disclaimer: '' }),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
}
