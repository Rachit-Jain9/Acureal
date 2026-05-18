import { useQuery } from '@tanstack/react-query';
import { propertiesAPI } from '../services/api';

/**
 * Pulls the price-vs-guidance spread percentile distribution across
 * other deals in the same BBMP ward as this property. Powers the
 * WardSpreadBenchmarkTile on the deal page (PR-C7 from the
 * autonomous-window plan).
 *
 * Disabled when `propertyId` is missing. Returns the orchestrator's
 * shape directly — `{ ok, ward_no, sample_size, median_spread_pct,
 * p25_spread_pct, p75_spread_pct, samples, ... }` or `{ ok: false,
 * reason }`. 5-minute staleTime — ward stats don't change rapidly.
 */
export default function useWardSpreadBenchmark(propertyId) {
  return useQuery({
    queryKey: ['property', propertyId, 'ward-spread-benchmark'],
    queryFn: () => propertiesAPI.wardSpreadBenchmark(propertyId).then((r) => r.data?.data),
    enabled: !!propertyId,
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) => {
      const status = error?.response?.status ?? 500;
      return status >= 500 && failureCount < 1;
    },
  });
}
