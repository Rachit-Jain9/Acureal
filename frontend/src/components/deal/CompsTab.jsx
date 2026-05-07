import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  AlertCircle,
  ExternalLink,
  Info,
  Crosshair,
  Sparkles,
} from 'lucide-react';
import { compsAPI, compSimilarityAPI } from '../../services/api';
import { SectionHeader, ErrorState, SkeletonList } from '../../design-system';
import StalenessBadge from '../common/StalenessBadge';
import { useDealRecord } from '../../hooks/useDealContext';

// ─── Formatting ────────────────────────────────────────────────────────────

const formatRate = (value) => {
  if (value == null) return '—';
  return `₹${Number(value).toLocaleString('en-IN')} / sqft`;
};

const formatScorePct = (n) => {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${Math.round(n * 100)}%`;
};

const formatDelta = (pct) => {
  if (pct == null || !Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
};

// Per-factor display labels — kept here (not in compSimilarity.js) because
// they're presentational, not part of the deterministic scorer contract.
const FACTOR_META = {
  distance:    { label: 'Distance',     hint: 'Haversine km, decays to per-class saturation radius' },
  asset_class: { label: 'Asset class',  hint: 'Exact-match bonus' },
  bhk_config:  { label: 'BHK overlap',  hint: 'Jaccard similarity over BHK set' },
  vintage:     { label: 'Vintage',      hint: 'Launch-year proximity (6-year decay)' },
  size_band:   { label: 'Size band',    hint: 'Symmetric ratio of total units' },
  amenities:   { label: 'Amenities',    hint: 'Jaccard similarity over amenities set' },
};

// Composite score → tone for the row pill. We don't fabricate confidence we
// don't have; if scorer returned null (sparse data) the badge falls neutral.
const toneForScore = (score) => {
  if (score == null) return 'neutral';
  if (score >= 0.65) return 'success';
  if (score >= 0.4)  return 'warn';
  return 'danger';
};

const TONE_PILL = {
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warn:    'bg-amber-50  text-amber-800   border-amber-200',
  danger:  'bg-rose-50   text-rose-800    border-rose-200',
  neutral: 'bg-bg-secondary text-content-muted border-hairline',
};

// ─── Similarity meter — animates from 0 → score on mount, factor-stacked bars ─

function FactorBar({ label, score, weight, hint }) {
  const targetPct = score == null ? 0 : Math.max(0, Math.min(1, score)) * 100;
  // Tween 0 → targetPct on mount via a CSS width transition. The FRONTEND
  // guideline calls for 600ms with the decelerate cubic-bezier; we run that
  // as a Tailwind arbitrary timing-fn so motion-reduce users get instant.
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(targetPct));
    return () => cancelAnimationFrame(id);
  }, [targetPct]);
  const color =
    score == null      ? 'bg-content-muted/40'
    : score >= 0.65    ? 'bg-emerald-500'
    : score >= 0.4     ? 'bg-amber-500'
                       : 'bg-rose-400';
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-content-secondary font-medium" title={hint}>{label}</span>
        <span className="text-content-muted tabular-nums">
          {score == null ? '—' : formatScorePct(score)}
          <span className="text-content-muted/60 ml-1">· w {Math.round(weight * 100)}%</span>
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-bg-secondary overflow-hidden">
        <div
          className={`h-full ${color} motion-safe:transition-[width] motion-safe:duration-[600ms] motion-safe:[transition-timing-function:cubic-bezier(0.16,1,0.3,1)]`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function SimilarityPopover({ similarity, comp, onClose }) {
  // Mount-fade — render once with opacity 0 + translate-y, then transition
  // to opacity 1 + translate-y-0 on next frame. Honors prefers-reduced-motion
  // via the `motion-safe:` Tailwind variant (collapses to instant).
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!similarity) return null;
  const { factors, weights, overall_score, distance_km, rate_delta_pct } = similarity;
  return (
    <div
      className={
        'absolute right-0 top-full z-30 mt-1.5 w-80 rounded-editorial border border-hairline-strong bg-bg-elevated shadow-lg p-4 ' +
        'motion-safe:transition-all motion-safe:duration-150 motion-safe:ease-out ' +
        (shown ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1')
      }
      role="dialog"
      aria-label={`Similarity breakdown for ${comp.project_name}`}
    >
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <p className="text-eyebrow uppercase text-content-muted font-medium">Why this rank</p>
            <p className="text-sm font-semibold text-content-primary truncate">{comp.project_name}</p>
          </div>
          <button
            onClick={onClose}
            className="text-content-muted hover:text-content-primary transition-colors duration-150"
            aria-label="Close breakdown"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="rounded-lg bg-bg-secondary p-2">
            <p className="text-[10px] uppercase tracking-wide text-content-muted">Composite</p>
            <p className="text-base font-bold text-content-primary tabular-nums">
              {formatScorePct(overall_score)}
            </p>
          </div>
          <div className="rounded-lg bg-bg-secondary p-2">
            <p className="text-[10px] uppercase tracking-wide text-content-muted">Distance</p>
            <p className="text-base font-bold text-content-primary tabular-nums">
              {distance_km != null ? `${distance_km} km` : '—'}
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          {Object.entries(FACTOR_META).map(([key, meta]) => (
            <FactorBar
              key={key}
              label={meta.label}
              hint={meta.hint}
              score={factors?.[key]?.score}
              weight={weights?.[key] ?? 0}
            />
          ))}
        </div>

        {rate_delta_pct != null && (
          <div className="mt-3 pt-3 border-t border-hairline">
            <p className="text-[11px] text-content-muted">Rate vs. underwriting target</p>
            <p
              className={
                'text-sm font-semibold tabular-nums ' +
                (rate_delta_pct > 0 ? 'text-data-negative' : 'text-data-positive')
              }
            >
              {formatDelta(rate_delta_pct)}
              <span className="text-content-muted font-normal ml-1.5">
                ({rate_delta_pct > 0 ? 'comp pricier' : 'comp cheaper'})
              </span>
            </p>
          </div>
        )}

        <p className="mt-3 text-[10px] text-content-muted leading-snug">
          Sparse-data honest: factors with missing input on either side are dropped, not guessed.
        </p>
    </div>
  );
}

// ─── Ranked comps table — uses /comps/ranked/:dealId so the 6-factor scorer
// surfaces in the UX, not just on the wire. Falls back to a sensible empty
// state when subject coords are missing or candidate set is empty. ─────────

function RankedCompsTable({ ranked, onPin, pinnedCompId, similarity }) {
  if (!ranked || ranked.length === 0) {
    return (
      <div className="text-center py-8 text-content-muted text-sm">
        No comparable transactions ranked within the radius.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-bg-secondary border-b border-hairline">
          <tr>
            <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-content-secondary px-4 py-2.5">Project</th>
            <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-content-secondary px-3 py-2.5">Locality</th>
            <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-content-secondary px-3 py-2.5">Rate</th>
            <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-content-secondary px-3 py-2.5">Distance</th>
            <th className="text-center text-[11px] font-semibold uppercase tracking-wide text-content-secondary px-3 py-2.5">Similarity</th>
            <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-content-secondary px-3 py-2.5">Source · Freshness</th>
            <th className="text-center text-[11px] font-semibold uppercase tracking-wide text-content-secondary px-3 py-2.5">Why</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {ranked.map((comp) => {
            const sim = comp.similarity || {};
            const score = sim.overall_score;
            const tone = toneForScore(score);
            const isPinned = pinnedCompId === comp.id;
            return (
              <tr
                key={comp.id}
                className={
                  'transition-colors duration-150 ease-out hover:bg-bg-secondary ' +
                  (isPinned ? 'bg-primary-50/30' : '')
                }
              >
                <td className="px-4 py-3 font-medium text-content-primary">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate max-w-[180px]" title={comp.project_name}>
                      {comp.project_name || '—'}
                    </span>
                    {comp.is_verified && (
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"
                        title="Verified comp"
                      />
                    )}
                  </div>
                  {comp.developer && (
                    <span className="text-[10px] text-content-muted block truncate max-w-[180px]" title={comp.developer}>
                      {comp.developer}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-content-secondary">
                  {comp.locality || '—'}
                </td>
                <td className="px-3 py-3 text-right font-medium text-content-primary tabular-nums whitespace-nowrap">
                  {formatRate(comp.rate_per_sqft)}
                </td>
                <td className="px-3 py-3 text-right text-content-secondary tabular-nums">
                  {sim.distance_km != null ? `${sim.distance_km} km` : '—'}
                </td>
                <td className="px-3 py-3 text-center">
                  <span
                    className={
                      'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums ' +
                      TONE_PILL[tone]
                    }
                  >
                    <span
                      className={
                        'inline-block w-1.5 h-1.5 rounded-full ' +
                        (tone === 'success' ? 'bg-emerald-500'
                         : tone === 'warn'   ? 'bg-amber-500'
                         : tone === 'danger' ? 'bg-rose-500'
                                             : 'bg-content-muted')
                      }
                    />
                    {formatScorePct(score)}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-content-secondary truncate max-w-[140px]" title={comp.source}>
                      {comp.source || '—'}
                    </span>
                    {comp.as_of_date && (
                      <StalenessBadge
                        asOfDate={comp.as_of_date}
                        dataType={comp.data_type}
                        fallback="residential_listing"
                        variant="minimal"
                      />
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 text-center relative">
                  <button
                    onClick={() => onPin(isPinned ? null : comp.id)}
                    className={
                      'inline-flex items-center justify-center w-7 h-7 rounded-full border transition-all duration-150 ease-out ' +
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.95] ' +
                      (isPinned
                        ? 'border-primary-300 bg-primary-50 text-primary-700'
                        : 'border-hairline-strong text-content-muted hover:border-primary-300 hover:text-primary-700')
                    }
                    title={isPinned ? 'Hide breakdown' : 'Show similarity breakdown'}
                    aria-label={isPinned ? 'Hide breakdown' : 'Show similarity breakdown'}
                    aria-expanded={isPinned}
                  >
                    <Info size={13} />
                  </button>
                  {isPinned && similarity && (
                    <SimilarityPopover
                      similarity={similarity}
                      comp={comp}
                      onClose={() => onPin(null)}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Benchmark card — kept from the previous implementation but extended ────
// with a worst-case staleness summary so reviewers see the "is this current?"
// signal next to the rolled-up rates. ──────────────────────────────────────

function BenchmarkCard({ benchmark, city, ranked }) {
  if (!benchmark) return null;

  if (benchmark.found === false) {
    return (
      <div className="card-editorial">
        <SectionHeader
          size="sm"
          icon={TrendingUp}
          title={`Market Benchmark — ${city || 'Location'}`}
          className="mb-2"
        />
        <p className="text-sm text-content-secondary">
          {benchmark.message
            || 'No verified comparable transactions found in this radius. Add project comps to populate pricing benchmarks.'}
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

  // Worst-case freshness across the comp set the benchmark was built from.
  // If most recent comp is stale, the rolled-up rates are themselves stale.
  const newestAsOf = useMemo(() => {
    if (!Array.isArray(ranked) || ranked.length === 0) return null;
    const dates = ranked
      .map((c) => (c.as_of_date ? new Date(c.as_of_date).getTime() : null))
      .filter((t) => Number.isFinite(t));
    if (dates.length === 0) return null;
    return new Date(Math.max(...dates)).toISOString();
  }, [ranked]);

  return (
    <div className="card-editorial">
      <SectionHeader
        size="sm"
        icon={TrendingUp}
        title={`Market Benchmark — ${city || 'Location'}`}
        action={
          <div className="flex items-center gap-2">
            {newestAsOf && (
              <StalenessBadge
                asOfDate={newestAsOf}
                category="micro_market_benchmark_listing"
                variant="compact"
              />
            )}
            <span className="text-xs text-content-muted bg-bg-secondary px-1.5 py-0.5 rounded tabular-nums">
              {benchmark.count} comps · {benchmark.radius_km} km
            </span>
          </div>
        }
        className="mb-4"
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {metrics.map(({ label, value }) => (
          <div
            key={label}
            className="bg-bg-secondary rounded-lg p-3 transition-colors duration-150 ease-out hover:bg-bg-elevated hover:ring-1 hover:ring-hairline-strong"
          >
            <p className="text-xs text-content-muted mb-1">{label}</p>
            <p className="text-sm font-bold text-content-primary tabular-nums">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tab ───────────────────────────────────────────────────────────────────

export default function CompsTab() {
  const deal = useDealRecord();
  const dealId = deal?.id;
  const hasLatLng = deal?.lat != null && deal?.lng != null;
  const city = deal?.city;
  const [pinnedCompId, setPinnedCompId] = useState(null);

  // Ranked comps — the 6-factor similarity scorer ride-share with the
  // existing nearby/benchmark queries. The scorer was built months ago and
  // has been sitting unconsumed; this is its first UI surface.
  const {
    data: rankedData,
    isLoading: rankedLoading,
    isError: rankedError,
    refetch: refetchRanked,
  } = useQuery({
    queryKey: ['comps-ranked', dealId],
    queryFn: () =>
      compSimilarityAPI
        .ranked(dealId, { radiusKm: 8, limit: 25 })
        .then((r) => r.data?.data ?? r.data),
    enabled: Boolean(dealId) && hasLatLng,
  });

  const ranked = useMemo(() => rankedData?.ranked || [], [rankedData]);
  const subjectMessage = rankedData?.message;

  // Pinned-comp single-comp score — drives the popover. Cached per (deal, comp).
  const {
    data: pinnedSimilarityData,
  } = useQuery({
    queryKey: ['comp-score', dealId, pinnedCompId],
    queryFn: () =>
      compSimilarityAPI
        .score(dealId, pinnedCompId)
        .then((r) => r.data?.data ?? r.data),
    enabled: Boolean(dealId && pinnedCompId),
  });

  // Inline-pin similarity falls back to the row-level similarity object the
  // ranked endpoint already returned, so the popover renders instantly even
  // before the per-comp score request resolves.
  const pinnedFallback = useMemo(
    () => ranked.find((c) => c.id === pinnedCompId)?.similarity || null,
    [ranked, pinnedCompId],
  );
  const pinnedSimilarity = pinnedSimilarityData?.similarity || pinnedFallback;

  // Benchmarks — kept on the simpler /comps/benchmarks endpoint since the
  // p25/p75/median aggregates are computed deterministically there and don't
  // need the similarity weighting.
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

  return (
    <div className="space-y-6">
      {!hasLatLng && (
        <ErrorState tone="warn">
          Geocode the property to view nearby comparable transactions. Navigate to the{' '}
          <strong>Parcel / Site</strong> tab and ensure the property record has been geocoded.
        </ErrorState>
      )}

      {/* Market Benchmark */}
      {hasLatLng && (
        benchmarkLoading ? (
          <div className="card-editorial p-4"><SkeletonList rows={3} columns={3} /></div>
        ) : benchmarkError ? (
          <div className="card-editorial text-center py-8">
            <AlertCircle size={24} className="text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-600 mb-2">Failed to load benchmark data.</p>
            <button onClick={refetchBenchmark} className="btn btn-secondary text-sm">Retry</button>
          </div>
        ) : (
          <BenchmarkCard benchmark={benchmarkData} city={city} ranked={ranked} />
        )
      )}

      {/* Ranked Comps */}
      {hasLatLng && (
        <div className="card-editorial p-0 overflow-hidden">
          <SectionHeader
            size="sm"
            icon={Crosshair}
            title="Ranked Comparables"
            sub="Top 25 within 8 km of the site, scored by similarity to the subject deal"
            action={
              <div className="flex items-center gap-2">
                {ranked.length > 0 && (
                  <span className="text-xs rounded-full border border-hairline bg-bg-secondary px-2 py-0.5 text-content-secondary inline-flex items-center gap-1">
                    <Sparkles size={11} className="text-primary-500" />
                    Similarity-ranked
                  </span>
                )}
                {ranked.length > 0 && (
                  <span className="text-sm text-content-secondary tabular-nums">{ranked.length} found</span>
                )}
              </div>
            }
            className="px-5 py-4 border-b border-hairline mb-0"
          />
          {subjectMessage && (
            <div className="px-5 py-3 border-b border-hairline">
              <ErrorState tone="info">{subjectMessage}</ErrorState>
            </div>
          )}
          {rankedLoading ? (
            <div className="px-5 py-3"><SkeletonList rows={4} columns={5} /></div>
          ) : rankedError ? (
            <div className="text-center py-8">
              <AlertCircle size={24} className="text-red-400 mx-auto mb-2" />
              <p className="text-sm text-red-600 mb-2">Failed to load ranked comps.</p>
              <button onClick={refetchRanked} className="btn btn-secondary text-sm">Retry</button>
            </div>
          ) : (
            <RankedCompsTable
              ranked={ranked}
              onPin={setPinnedCompId}
              pinnedCompId={pinnedCompId}
              similarity={pinnedSimilarity}
            />
          )}
        </div>
      )}

      {/* Comps Library Link */}
      <div className="flex items-center justify-end">
        <a
          href="/dashboard/comps"
          className="text-sm text-primary-600 transition-colors duration-150 ease-out hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 rounded inline-flex items-center gap-1"
        >
          View full comps library <ExternalLink size={13} />
        </a>
      </div>
    </div>
  );
}
