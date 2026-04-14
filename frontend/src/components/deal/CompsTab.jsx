import { useQuery } from '@tanstack/react-query';
import { MapPin, TrendingUp, AlertCircle, ExternalLink } from 'lucide-react';
import { compsAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';

function formatRate(value) {
  if (value == null) return '-';
  return `₹${Number(value).toLocaleString('en-IN')} / sqft`;
}

function NearbyCompsTable({ comps }) {
  if (!comps || comps.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        No comparable transactions found within 5 km.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            <th className="text-left text-xs font-semibold text-gray-500 px-4 py-2.5">Project</th>
            <th className="text-left text-xs font-semibold text-gray-500 px-3 py-2.5">Locality</th>
            <th className="text-right text-xs font-semibold text-gray-500 px-3 py-2.5">Rate</th>
            <th className="text-left text-xs font-semibold text-gray-500 px-3 py-2.5">Config</th>
            <th className="text-left text-xs font-semibold text-gray-500 px-3 py-2.5">Launch</th>
            <th className="text-left text-xs font-semibold text-gray-500 px-3 py-2.5">Possession</th>
            <th className="text-left text-xs font-semibold text-gray-500 px-3 py-2.5">Source</th>
            <th className="text-center text-xs font-semibold text-gray-500 px-3 py-2.5">Verified</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {comps.map((comp) => (
            <tr key={comp.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-gray-900">
                {comp.project_name || '-'}
              </td>
              <td className="px-3 py-3 text-gray-600">
                {comp.locality || '-'}
              </td>
              <td className="px-3 py-3 text-right font-medium text-gray-900">
                {formatRate(comp.rate_per_sqft)}
              </td>
              <td className="px-3 py-3 text-gray-600">
                {comp.bhk_config || '-'}
              </td>
              <td className="px-3 py-3 text-gray-600">
                {comp.launch_year || '-'}
              </td>
              <td className="px-3 py-3 text-gray-600">
                {comp.possession_year || '-'}
              </td>
              <td className="px-3 py-3 text-gray-500 text-xs">
                {comp.source || '-'}
              </td>
              <td className="px-3 py-3 text-center">
                {comp.is_verified ? (
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="Verified" />
                ) : (
                  <span className="inline-block w-2 h-2 rounded-full bg-gray-300" title="Unverified" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BenchmarkCard({ benchmark, city }) {
  if (!benchmark) return null;

  if (benchmark.found === false) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp size={16} className="text-gray-400" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Market Benchmark — {city || 'Location'}</h3>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {benchmark.message || 'No verified comparable transactions found in this radius. Add project comps to populate pricing benchmarks.'}
        </p>
      </div>
    );
  }

  const b = benchmark.benchmarks || {};
  const metrics = [
    { label: 'Average Rate', value: formatRate(b.avg_rate_per_sqft) },
    { label: 'Median Rate',  value: formatRate(b.median_rate_per_sqft) },
    { label: 'Min',          value: formatRate(b.min_rate_per_sqft) },
    { label: 'Max',          value: formatRate(b.max_rate_per_sqft) },
    { label: '25th Pctile',  value: formatRate(b.p25_rate_per_sqft) },
    { label: '75th Pctile',  value: formatRate(b.p75_rate_per_sqft) },
  ];

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={16} className="text-primary-600" />
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Market Benchmark — {city || 'Location'}
        </h3>
        <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-1.5 py-0.5 rounded ml-auto">
          {benchmark.count} comps · {benchmark.radius_km} km
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {metrics.map(({ label, value }) => (
          <div key={label} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{label}</p>
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CompsTab({ deal }) {
  const hasLatLng = deal?.lat != null && deal?.lng != null;
  const city = deal?.city;

  const {
    data: nearbyData,
    isLoading: nearbyLoading,
    isError: nearbyError,
    refetch: refetchNearby,
  } = useQuery({
    queryKey: ['comps-nearby', deal?.lat, deal?.lng],
    queryFn: () =>
      compsAPI
        .nearby({ lat: deal.lat, lng: deal.lng, radius: 5 })
        .then((r) => r.data?.data ?? r.data),
    enabled: hasLatLng,
  });

  const {
    data: benchmarkData,
    isLoading: benchmarkLoading,
    isError: benchmarkError,
    refetch: refetchBenchmark,
  } = useQuery({
    queryKey: ['comps-benchmark', deal?.lat, deal?.lng],
    queryFn: () =>
      compsAPI
        .benchmarks({ lat: deal.lat, lng: deal.lng, radius: 5 })
        .then((r) => r.data?.data ?? r.data),
    enabled: hasLatLng,
  });

  const nearbyComps = Array.isArray(nearbyData) ? nearbyData : [];
  const benchmark = benchmarkData;

  return (
    <div className="space-y-6">
      {/* No geocode warning */}
      {!hasLatLng && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
          <AlertCircle size={16} className="text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-800">
            Geocode the property to view nearby comparable transactions. Navigate to the{' '}
            <strong>Parcel / Site</strong> tab and ensure the property record has been geocoded.
          </p>
        </div>
      )}

      {/* Market Benchmark */}
      {hasLatLng && (
        benchmarkLoading ? (
          <LoadingSpinner className="py-8" />
        ) : benchmarkError ? (
          <div className="card text-center py-8">
            <AlertCircle size={24} className="text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-600 mb-2">Failed to load benchmark data.</p>
            <button onClick={refetchBenchmark} className="btn btn-secondary text-sm">Retry</button>
          </div>
        ) : (
          <BenchmarkCard benchmark={benchmark} city={city} />
        )
      )}

      {/* Nearby Comps */}
      {hasLatLng && (
        <div className="card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <MapPin size={16} className="text-gray-400" />
              Nearby Comparables
              <span className="text-xs font-normal text-gray-400">(5 km radius)</span>
            </h3>
            {nearbyComps.length > 0 && (
              <span className="text-sm text-gray-500">{nearbyComps.length} found</span>
            )}
          </div>
          {nearbyLoading ? (
            <LoadingSpinner className="py-10" />
          ) : nearbyError ? (
            <div className="text-center py-8">
              <AlertCircle size={24} className="text-red-400 mx-auto mb-2" />
              <p className="text-sm text-red-600 mb-2">Failed to load nearby comps.</p>
              <button onClick={refetchNearby} className="btn btn-secondary text-sm">Retry</button>
            </div>
          ) : (
            <NearbyCompsTable comps={nearbyComps} />
          )}
        </div>
      )}

      {/* Comps Library Link */}
      <div className="flex items-center justify-end">
        <a
          href="/dashboard/comps"
          className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
        >
          View full comps library <ExternalLink size={13} />
        </a>
      </div>
    </div>
  );
}
