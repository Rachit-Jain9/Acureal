import { useQuery } from '@tanstack/react-query';
import { propertiesAPI } from '../services/api';

/**
 * React-query wrapper around `GET /api/properties/auto-derive-context`.
 *
 * Disabled by default — call `refetch()` (or set `enabled: true` when an
 * address / coordinate pair becomes available) to trigger the round-trip.
 * The backend caches at multiple layers (geocode_cache, kgis_cache, HTTP
 * Cache-Control), so re-fetching for the same address is effectively free.
 *
 * `staleTime: 30 minutes` matches the address's typical edit cadence on a
 * deal — operators tweak the address text rarely, but may refresh other
 * deal data often, and we don't want every re-render to re-derive.
 */
export default function useAutoDeriveParcelContext({ address, lat, lng, enabled = false } = {}) {
  const queryKey = ['auto-derive-context', address || '', lat ?? '', lng ?? ''];
  const hasInput =
    (typeof address === 'string' && address.trim().length > 0) ||
    (lat !== undefined && lat !== null && lat !== '' && lng !== undefined && lng !== null && lng !== '');

  return useQuery({
    queryKey,
    queryFn: () => propertiesAPI.autoDeriveContext({ address, lat, lng }).then((r) => r.data?.data),
    enabled: enabled && hasInput,
    staleTime: 30 * 60 * 1000,
    retry: (failureCount, error) => {
      // Retry once on 5xx; never on 4xx (we send those for bad input).
      const status = error?.response?.status ?? 500;
      return status >= 500 && failureCount < 1;
    },
  });
}
