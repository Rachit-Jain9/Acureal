import { useEffect, useMemo, useState } from 'react';
import { Trophy, AlertTriangle, RotateCcw } from 'lucide-react';
import Badge from '../common/Badge';
import { Card, ErrorState, SectionHeader, Skeleton } from '../../design-system';
import { useZones } from '../../hooks/useMasterPlan';
import { calculateBuildEnvelope } from '../../utils/buildEnvelope';

// Three side-by-side scenarios. Default values mirror common Bengaluru deal
// shapes: 30m & 18m roads, 1000sqm plot, mid-rise heights.
const DEFAULT_SCENARIOS = [
  { label: 'A', roadWidthM: 12, plotAreaSqm: 1000, buildingHeightM: 15 },
  { label: 'B', roadWidthM: 18, plotAreaSqm: 1000, buildingHeightM: 30 },
  { label: 'C', roadWidthM: 30, plotAreaSqm: 1000, buildingHeightM: 45 },
];

const fmt = (value, fractionDigits = 2) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: 0,
  });
};

const fmtSqm = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n >= 10000) return `${fmt(n / 10000, 2)} ha`;
  return `${fmt(n, 0)} sqm`;
};

function ScenarioCard({ label, scenario, zones, onChange, envelope, isWinner }) {
  const handleField = (key) => (event) => {
    const raw = event.target.value;
    const next = raw === '' ? '' : Number(raw);
    onChange({ ...scenario, [key]: next });
  };

  const handleZone = (event) => {
    onChange({ ...scenario, zoneId: event.target.value });
  };

  const heightExceeded = envelope?.height?.allowed_max_m != null
    && Number(scenario.buildingHeightM) > envelope.height.allowed_max_m;

  return (
    <Card
      elevated
      className={`p-4 transition-all duration-220 ${isWinner ? 'ring-2 ring-data-positive/60 bg-data-positive/5' : ''}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-bg-secondary text-content-primary text-xs font-semibold tabular-nums">
            {label}
          </span>
          <span className="text-eyebrow uppercase tracking-[0.08em] text-content-muted font-medium">
            Scenario
          </span>
        </div>
        {isWinner && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-data-positive">
            <Trophy size={11} aria-hidden="true" />
            Most buildable
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        <div>
          <label className="block text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-1 font-medium">
            Zone
          </label>
          <select
            value={scenario.zoneId || ''}
            onChange={handleZone}
            className="w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="" disabled>Select zone</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>{z.zone_code} — {z.zone_name}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-1 font-medium">
              Road
            </label>
            <input
              aria-label={`Scenario ${label} road width`}
              type="number"
              value={scenario.roadWidthM}
              onChange={handleField('roadWidthM')}
              step={1.5}
              min={0}
              className="w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm text-content-primary tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <span className="text-[10px] text-content-muted">m</span>
          </div>
          <div>
            <label className="block text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-1 font-medium">
              Plot
            </label>
            <input
              aria-label={`Scenario ${label} plot area`}
              type="number"
              value={scenario.plotAreaSqm}
              onChange={handleField('plotAreaSqm')}
              step={50}
              min={0}
              className="w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm text-content-primary tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <span className="text-[10px] text-content-muted">sqm</span>
          </div>
          <div>
            <label className="block text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-1 font-medium">
              Height
            </label>
            <input
              aria-label={`Scenario ${label} building height`}
              type="number"
              value={scenario.buildingHeightM}
              onChange={handleField('buildingHeightM')}
              step={3}
              min={0}
              className="w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm text-content-primary tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <span className="text-[10px] text-content-muted">m</span>
          </div>
        </div>
      </div>

      {envelope?.ok && (
        <div className="mt-4 pt-3 border-t border-hairline space-y-2">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
            <div className="text-content-muted">Effective FAR</div>
            <div className="text-right tabular-nums text-content-primary font-medium">
              {fmt(envelope.far?.max_fsi, 2)}
            </div>

            <div className="text-content-muted">Front / Side / Rear</div>
            <div className="text-right tabular-nums text-content-primary">
              {fmt(envelope.setbacks.front_m, 1)} / {fmt(envelope.setbacks.side_m, 1)} / {fmt(envelope.setbacks.rear_m, 1)} m
            </div>

            <div className="text-content-muted">Footprint cap</div>
            <div className="text-right tabular-nums text-content-secondary">
              {fmtSqm(envelope.capacity.footprint_cap_sqm)}
            </div>

            <div className="text-content-muted">Allowed height</div>
            <div className="text-right tabular-nums text-content-secondary">
              {fmt(envelope.height.allowed_max_m, 1)} m
            </div>
          </div>

          <div className="bg-bg-secondary rounded-md p-2.5 mt-2">
            <div className="text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-0.5 font-medium">
              Buildable (max)
            </div>
            <div className="text-base font-semibold tabular-nums text-content-primary">
              {fmtSqm(envelope.capacity.buildable_max_sqm)}
            </div>
          </div>

          {heightExceeded && (
            <div className="flex items-start gap-1.5 text-[11px] text-data-negative">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span>Height exceeds the {fmt(envelope.height.allowed_max_m, 1)}m screening ceiling. Reduce building height or use a wider road.</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function BuildabilityLab() {
  const { data: zones = [], isLoading } = useZones({ status: 'approved' });
  const [scenarios, setScenarios] = useState(DEFAULT_SCENARIOS);

  // Auto-fill the zone for any scenario that doesn't have one once zones load.
  useEffect(() => {
    if (zones.length === 0) return;
    setScenarios((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (s.zoneId) return s;
        changed = true;
        return { ...s, zoneId: zones[0].id };
      });
      return changed ? next : prev;
    });
  }, [zones]);

  const envelopes = useMemo(() => scenarios.map((s) => {
    const zone = zones.find((z) => z.id === s.zoneId) || null;
    if (!zone) return null;
    return calculateBuildEnvelope(zone, {
      roadWidthM: s.roadWidthM,
      plotAreaSqm: s.plotAreaSqm,
      buildingHeightM: s.buildingHeightM,
    });
  }), [scenarios, zones]);

  const winnerIdx = useMemo(() => {
    let best = -1;
    let bestVal = -Infinity;
    envelopes.forEach((e, i) => {
      const v = Number(e?.capacity?.buildable_max_sqm);
      if (Number.isFinite(v) && v > bestVal) {
        bestVal = v;
        best = i;
      }
    });
    return best;
  }, [envelopes]);

  const tradeoff = useMemo(() => {
    const winner = envelopes[winnerIdx];
    if (!winner?.ok) return null;
    const others = envelopes
      .map((e, i) => ({ e, i }))
      .filter(({ i }) => i !== winnerIdx && envelopes[i]?.ok);
    if (others.length === 0) return null;
    const best = Number(winner.capacity.buildable_max_sqm) || 0;
    const labelOf = (i) => scenarios[i].label;
    const gains = others.map(({ e, i }) => {
      const v = Number(e.capacity.buildable_max_sqm) || 0;
      const delta = best - v;
      return { label: labelOf(i), delta, vs_label: scenarios[winnerIdx].label };
    });
    return { winnerLabel: scenarios[winnerIdx].label, gains };
  }, [envelopes, scenarios, winnerIdx]);

  const handleScenarioChange = (idx) => (next) => {
    setScenarios((prev) => prev.map((s, i) => (i === idx ? next : s)));
  };

  const handleReset = () => setScenarios(DEFAULT_SCENARIOS.map((s) => ({ ...s, zoneId: zones[0]?.id })));

  if (isLoading) {
    return (
      <Card elevated className="p-6">
        <div className="space-y-3">
          <Skeleton className="h-3 w-40 rounded" />
          <Skeleton className="h-5 w-2/3 rounded" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 pt-3">
            <Skeleton className="h-72 rounded" />
            <Skeleton className="h-72 rounded" />
            <Skeleton className="h-72 rounded" />
          </div>
        </div>
        <span className="sr-only">Loading buildability lab</span>
      </Card>
    );
  }

  if (zones.length === 0) {
    return (
      <ErrorState tone="info" title="No approved zones yet">
        Buildability scenarios appear once at least one zone has been reviewed and approved.
      </ErrorState>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="What-if scenarios"
        title="Buildability Lab — compare three envelopes side-by-side"
        sub="Stack three combinations of zone, road width, plot area, and building height. Each card shows the envelope kernel output from the operative RMP 2015 Vol III (setback Tables 8 & 9 + per-zone FAR tables); the highest buildable scenario is flagged."
        action={(
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-content-secondary hover:text-content-primary border border-hairline rounded-md hover:bg-bg-secondary transition-colors duration-120"
          >
            <RotateCcw size={11} />
            Reset
          </button>
        )}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {scenarios.map((s, i) => (
          <ScenarioCard
            key={s.label}
            label={s.label}
            scenario={s}
            zones={zones}
            onChange={handleScenarioChange(i)}
            envelope={envelopes[i]}
            isWinner={i === winnerIdx && envelopes[i]?.ok && Number.isFinite(Number(envelopes[i].capacity.buildable_max_sqm))}
          />
        ))}
      </div>

      {tradeoff && (
        <Card elevated className="p-4">
          <div className="text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-2 font-medium">
            Trade-off
          </div>
          <div className="text-sm text-content-primary leading-relaxed">
            <span className="font-medium">Scenario {tradeoff.winnerLabel}</span> unlocks the most buildable area.
            {tradeoff.gains.map((g) => (
              <span key={g.label}>
                {' '}vs Scenario {g.label}: <span className="tabular-nums text-data-positive">+{fmtSqm(g.delta)}</span>.
              </span>
            ))}
          </div>
        </Card>
      )}

      <div className="text-[11px] text-content-muted flex items-start gap-1.5">
        <AlertTriangle size={11} className="mt-0.5 shrink-0" />
        <span>
          Deterministic screening estimate from the operative RMP 2015 Vol III setback
          (Tables 8 &amp; 9) and FAR kernel. Verify against the rulebook and a site survey
          before committing to numbers in IC memos.
        </span>
      </div>
    </div>
  );
}
