import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, Info, AlertTriangle } from 'lucide-react';
import Badge from '../common/Badge';
import { Card, ErrorState, SectionHeader, StatTile } from '../../design-system';
import { useLandUseIntelligence } from '../../hooks/useMasterPlan';

const fmt = (value, fractionDigits = 2) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: 0,
  });
};

function ShiftRow({ label, baseline, target }) {
  const baseValue = Number(baseline?.value ?? 0);
  const targetValue = Number(target?.value ?? 0);
  const delta = targetValue - baseValue;
  const tone = Math.abs(delta) < 0.5 ? 'flat' : (delta > 0 ? 'up' : 'down');

  const Icon = tone === 'up' ? TrendingUp : tone === 'down' ? TrendingDown : Minus;
  const deltaColor = {
    up: 'text-data-positive',
    down: 'text-data-negative',
    flat: 'text-content-muted',
  }[tone];

  return (
    <tr className="border-b border-hairline last:border-b-0 hover:bg-bg-secondary/40 transition-colors duration-150">
      <td className="px-4 py-2.5 text-sm text-content-primary leading-snug">
        {label}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-content-secondary">
        {baseline ? `${fmt(baseValue, 2)}%` : '—'}
        {baseline?.absolute_ha && (
          <div className="text-[11px] text-content-muted">{fmt(baseline.absolute_ha, 0)} Ha</div>
        )}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-content-secondary">
        {target ? `${fmt(targetValue, 2)}%` : '—'}
        {target?.absolute_ha && (
          <div className="text-[11px] text-content-muted">{fmt(target.absolute_ha, 0)} Ha</div>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        {baseline && target && (
          <div className={`inline-flex items-center gap-1 text-sm tabular-nums font-medium ${deltaColor}`}>
            <Icon size={12} />
            {delta > 0 ? '+' : ''}{fmt(delta, 2)} pts
          </div>
        )}
      </td>
    </tr>
  );
}

function PanelSkeleton() {
  return (
    <Card elevated className="p-6">
      <div className="space-y-3 animate-pulse motion-reduce:animate-none">
        <div className="h-3 w-40 rounded bg-bg-secondary" />
        <div className="h-5 w-2/3 rounded bg-bg-secondary" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
          <div className="h-20 rounded bg-bg-secondary" />
          <div className="h-20 rounded bg-bg-secondary" />
          <div className="h-20 rounded bg-bg-secondary" />
        </div>
        <div className="h-64 rounded bg-bg-secondary" />
      </div>
      <span className="sr-only">Loading land-use intelligence</span>
    </Card>
  );
}

const PRIMARY_CATEGORIES = [
  'residential', 'commercial', 'industrial', 'psp',
  'parks_open', 'transport', 'water_bodies',
];

export default function LandUseInsightPanel() {
  const { data, isLoading, isError } = useLandUseIntelligence();

  const rows = useMemo(() => {
    if (!data) return [];
    const existingByKey = new Map((data.existing || []).map((r) => [r.key, r]));
    const proposedByKey = new Map((data.proposed || []).map((r) => [r.key, r]));
    const allKeys = new Set([
      ...PRIMARY_CATEGORIES,
      ...existingByKey.keys(),
      ...proposedByKey.keys(),
    ]);
    // Order primary categories first, then any extras alphabetically.
    const ordered = [
      ...PRIMARY_CATEGORIES.filter((k) => allKeys.has(k)),
      ...[...allKeys].filter((k) => !PRIMARY_CATEGORIES.includes(k)).sort(),
    ];
    return ordered.map((key) => ({
      key,
      label: existingByKey.get(key)?.label || proposedByKey.get(key)?.label || key,
      baseline: existingByKey.get(key) || null,
      target: proposedByKey.get(key) || null,
    }));
  }, [data]);

  const totals = useMemo(() => {
    if (!data) return {};
    const find = (k) => data.totals?.find((t) => t.key === k)?.value;
    return {
      bma: find('bma_total_area'),
      developable: find('bma_developable_area'),
      agricultureOutsideDev: find('proposed_agriculture_outside_dev'),
    };
  }, [data]);

  const callouts = useMemo(() => {
    if (!data?.callouts) return { sdz: null, ngt: null, heritage: null, prr: null };
    const find = (predicate) => data.callouts.find(predicate)?.value;
    return {
      sdz: find((c) => c.key === 'special_development_zones'),
      ngt: find((c) => c.key === 'ngt_drainage_classification'),
      heritage: find((c) => c.key === 'heritage_zones'),
      prr: find((c) => c.key === 'peripheral_ring_road'),
      regional_parks: find((c) => c.key === 'regional_parks'),
    };
  }, [data]);

  if (isLoading) return <PanelSkeleton />;
  if (isError) {
    return (
      <ErrorState tone="warn" title="Could not load land-use intelligence">
        Try refreshing. If the problem persists, the master-plan service may be unavailable.
      </ErrorState>
    );
  }

  const hasAnyData = rows.some((r) => r.baseline || r.target);
  if (!hasAnyData) {
    return (
      <ErrorState tone="info" title="No land-use facts yet">
        Land-use shares appear here once the Existing Land Use 2015 and Proposed Land Use 2031 maps have been ingested.
      </ErrorState>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="BMA macro view"
        title="Land Use Intelligence — 2015 baseline → 2031 proposed"
        sub="Where Bengaluru's Metropolitan Area is shifting per RMP 2031. Numbers extracted directly from the Existing Land Use 2015 map and the Proposed Land Use 2031 map; deltas in percentage points of total developable area."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatTile
          label="BMA total area"
          value={totals.bma?.value ? fmt(totals.bma.value, 0) : '—'}
          footnote={totals.bma?.unit || 'Ha'}
        />
        <StatTile
          label="Developable area (2031)"
          value={totals.developable?.value ? fmt(totals.developable.value, 0) : '—'}
          footnote={totals.developable?.unit || 'Ha'}
        />
        <StatTile
          label="Agriculture outside developable"
          value={totals.agricultureOutsideDev?.value ? fmt(totals.agricultureOutsideDev.value, 0) : '—'}
          footnote={totals.agricultureOutsideDev?.unit || 'Ha'}
        />
      </div>

      <Card elevated className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-eyebrow uppercase tracking-[0.08em] text-content-muted bg-bg-secondary border-b border-hairline">
              <tr>
                <th className="text-left font-medium px-4 py-2">Land use category</th>
                <th className="text-right font-medium px-4 py-2">2015 baseline</th>
                <th className="text-right font-medium px-4 py-2">2031 proposed</th>
                <th className="text-right font-medium px-4 py-2">Delta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((row) => (
                <ShiftRow
                  key={row.key}
                  label={row.label}
                  baseline={row.baseline}
                  target={row.target}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {callouts.sdz && (
          <div className="rounded-md border border-hairline bg-bg-secondary/40 p-3">
            <div className="text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-1.5 font-medium">
              Special Development Zones
            </div>
            <div className="text-sm text-content-primary leading-snug">
              {callouts.sdz.count} corridors · max FAR {callouts.sdz.max_far}
            </div>
            <div className="text-[11px] text-content-muted mt-1">
              {Array.isArray(callouts.sdz.locations) ? callouts.sdz.locations.join(', ') : ''}
            </div>
          </div>
        )}
        {callouts.ngt && (
          <div className="rounded-md border border-hairline bg-bg-secondary/40 p-3">
            <div className="text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-1.5 font-medium">
              NGT drain buffers
            </div>
            <div className="text-sm text-content-primary leading-snug tabular-nums">
              Primary {callouts.ngt.buffer_m_primary}m · Secondary {callouts.ngt.buffer_m_secondary}m · Tertiary {callouts.ngt.buffer_m_tertiary}m
            </div>
            <div className="text-[11px] text-content-muted mt-1">{callouts.ngt.source}</div>
          </div>
        )}
        {callouts.heritage && (
          <div className="rounded-md border border-hairline bg-bg-secondary/40 p-3">
            <div className="text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-1.5 font-medium">
              Heritage zones
            </div>
            <div className="text-sm text-content-primary leading-snug tabular-nums">
              {callouts.heritage.count} delineated · prohibited {callouts.heritage.prohibited_radius_m}m, regulated {callouts.heritage.regulated_radius_m}m
            </div>
          </div>
        )}
        {callouts.prr && (
          <div className="rounded-md border border-hairline bg-bg-secondary/40 p-3">
            <div className="text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-1.5 font-medium">
              Peripheral Ring Road
            </div>
            <div className="text-sm text-content-primary leading-snug tabular-nums">
              {callouts.prr.width_m} m corridor · {callouts.prr.type}
            </div>
            <div className="text-[11px] text-content-muted mt-1">{callouts.prr.note}</div>
          </div>
        )}
      </div>

      {data?.disclaimer && (
        <div className="text-[11px] text-content-muted flex items-center gap-1.5">
          <AlertTriangle size={11} />
          {data.disclaimer}
        </div>
      )}
    </div>
  );
}
