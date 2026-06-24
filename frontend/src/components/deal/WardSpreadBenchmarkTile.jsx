import { useMemo } from 'react';
import { TrendingUp, Users } from 'lucide-react';
import Badge from '../common/Badge';
import { Card, Skeleton } from '../../design-system';
import useWardSpreadBenchmark from '../../hooks/useWardSpreadBenchmark';

/**
 * WardSpreadBenchmarkTile — Bayesian sanity check for a deal's
 * price-vs-guidance spread. Pulls the percentile distribution across
 * other deals in the same BBMP ward and lets the analyst see whether
 * this deal sits inside or outside the local market band.
 *
 * Companion to the existing per-deal Spread-vs-Guidance StatTile on
 * DealStreetLookupCard (PR #353). The single-deal tile says "this
 * deal is +12% over guidance"; this ward tile says "in this ward,
 * the median deal is +18% over guidance, p25-p75 is +9-+24%."
 *
 * Renders nothing when:
 *   - propertyId is missing
 *   - ward not yet auto-derived (operator needs to Apply auto-derive first)
 *   - fewer than 3 comparable deals in the ward (insufficient_data)
 *
 * Empty-state copy is honest about WHY the benchmark isn't ready,
 * not a defensive "data unavailable" line.
 */
export default function WardSpreadBenchmarkTile({ propertyId, currentDealSpreadPct = null }) {
  const { data, isFetching } = useWardSpreadBenchmark(propertyId);

  // Where does this deal sit in the ward distribution? Anchors the
  // narrative copy below.
  const dealVsWardLabel = useMemo(() => {
    if (!data?.ok || currentDealSpreadPct === null || currentDealSpreadPct === undefined) return null;
    const median = data.median_spread_pct;
    const p25 = data.p25_spread_pct;
    const p75 = data.p75_spread_pct;
    const delta = currentDealSpreadPct - median;
    let zone;
    if (currentDealSpreadPct < p25) zone = 'below_p25';
    else if (currentDealSpreadPct > p75) zone = 'above_p75';
    else zone = 'within_band';
    return { delta: Number(delta.toFixed(1)), zone };
  }, [data, currentDealSpreadPct]);

  if (!propertyId) return null;

  if (isFetching && !data) {
    return (
      <Card className="p-4 mt-3">
        <Skeleton height="h-4" className="w-1/3 mb-2" />
        <Skeleton height="h-6" className="w-1/2" />
      </Card>
    );
  }

  if (!data) return null;

  // Honest empty states — explain WHY the benchmark isn't ready.
  if (!data.ok && data.reason === 'ward_not_derived') {
    return (
      <Card className="p-3 mt-3 bg-bg-secondary border-hairline" data-testid="ward-spread-empty">
        <div className="flex items-start gap-2 text-xs text-content-muted">
          <Users size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="text-content-secondary font-medium">Ward benchmark not ready</span> —
            click <span className="font-medium text-content-secondary">Derive</span> + Apply on the
            AutoFillCard above to capture this property's BBMP ward, then this tile compares the
            deal's spread to other deals in the same ward.
          </span>
        </div>
      </Card>
    );
  }
  if (!data.ok && data.reason === 'insufficient_data') {
    return (
      <Card className="p-3 mt-3 bg-bg-secondary border-hairline" data-testid="ward-spread-empty">
        <div className="flex items-start gap-2 text-xs text-content-muted">
          <Users size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="text-content-secondary font-medium">Ward {data.ward_no} benchmark</span>{' '}
            — only {data.sample_size} other deal{data.sample_size === 1 ? '' : 's'} in this ward have
            enough data so far. Need at least 3 to compute median + percentiles.
          </span>
        </div>
      </Card>
    );
  }
  if (!data.ok) return null;

  const zoneCopy = {
    below_p25: { tone: 'success', label: 'Better priced than 75% of ward deals' },
    within_band: { tone: 'neutral', label: 'Within the typical ward band' },
    above_p75: { tone: 'warn', label: 'Pricier than 75% of ward deals' },
  };

  return (
    <Card
      className="p-4 mt-3 border-hairline"
      data-testid="ward-spread-benchmark-tile"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2 text-xs text-content-muted">
          <TrendingUp size={12} className="text-content-secondary" aria-hidden="true" />
          <span className="uppercase tracking-wider font-medium">
            Spread vs guidance — Ward {data.ward_no} benchmark
          </span>
        </div>
        <Badge tone="info" className="!text-[10px]">
          {data.sample_size} comparable deal{data.sample_size === 1 ? '' : 's'}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <PercentileCell label="p25" value={data.p25_spread_pct} tone="muted" />
        <PercentileCell label="Median" value={data.median_spread_pct} tone="primary" />
        <PercentileCell label="p75" value={data.p75_spread_pct} tone="muted" />
      </div>

      {dealVsWardLabel && (
        <div className="mt-3 pt-3 border-t border-hairline flex items-center justify-between gap-3">
          <div className="text-xs text-content-secondary">
            <span className="text-content-muted">This deal is</span>{' '}
            <span className="tabular-nums font-medium">
              {dealVsWardLabel.delta >= 0 ? '+' : ''}
              {dealVsWardLabel.delta.toFixed(1)}pp
            </span>{' '}
            <span className="text-content-muted">vs ward median.</span>
          </div>
          <Badge tone={zoneCopy[dealVsWardLabel.zone].tone}>
            {zoneCopy[dealVsWardLabel.zone].label}
          </Badge>
        </div>
      )}

      <p className="text-[10px] text-content-muted mt-3 uppercase tracking-wider">
        Ward benchmark — verify against IGR sale-deed comps before quoting in IC.
      </p>
    </Card>
  );
}

function PercentileCell({ label, value, tone }) {
  const sign = Number.isFinite(value) && value >= 0 ? '+' : '';
  const toneClass =
    tone === 'primary'
      ? 'text-content-primary text-xl font-semibold'
      : 'text-content-secondary text-base font-medium';
  return (
    <div className="flex flex-col items-center text-center" data-testid={`ward-spread-${label.toLowerCase()}`}>
      <span className="text-[10px] text-content-muted uppercase tracking-wider mb-0.5">{label}</span>
      <span className={`${toneClass} tabular-nums`}>
        {Number.isFinite(value) ? `${sign}${value.toFixed(1)}%` : '—'}
      </span>
    </div>
  );
}
