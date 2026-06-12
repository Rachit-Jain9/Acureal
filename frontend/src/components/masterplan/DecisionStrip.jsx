import { useEffect, useMemo, useState } from 'react';
import {
  Building2, Ruler, ArrowsUpFromLine, Layers, MoveHorizontal, Info, AlertTriangle,
} from 'lucide-react';
import Badge from '../common/Badge';
import { Card, ErrorState, SectionHeader, Skeleton, StatTile } from '../../design-system';
import { useZones } from '../../hooks/useMasterPlan';
import { calculateBuildEnvelope } from '../../utils/buildEnvelope';

const ROAD_WIDTH_PRESETS = [9.0, 12.0, 15.0, 18.0, 24.0, 30.0, 45.0, 60.0];
const PLOT_AREA_PRESETS = [60, 240, 600, 1200, 2400, 4000, 10000];

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

function NumberInput({ label, value, onChange, suffix, presets, min = 0, step = 0.5 }) {
  return (
    <div>
      <label className="block text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-1.5 font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
          step={step}
          min={min}
          className="w-28 rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm text-content-primary tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {suffix && <span className="text-xs text-content-muted">{suffix}</span>}
      </div>
      {presets && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(preset)}
              className={`px-2 py-0.5 rounded text-[11px] tabular-nums transition-colors duration-150 ${
                Number(value) === preset
                  ? 'bg-accent-soft text-accent border border-accent'
                  : 'bg-bg-secondary text-content-secondary hover:text-content-primary border border-transparent'
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ValueRow({ icon: Icon, label, value, hint, tone = 'neutral' }) {
  const toneClass = {
    success: 'text-data-positive',
    warn: 'text-data-negative',
    neutral: 'text-content-primary',
    muted: 'text-content-muted',
  }[tone];
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-hairline last:border-b-0">
      <Icon size={14} className="mt-0.5 text-content-muted shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="text-eyebrow uppercase text-content-muted tracking-[0.08em] mb-0.5 font-medium">
          {label}
        </div>
        <div className={`text-sm font-medium tabular-nums ${toneClass}`}>{value}</div>
        {hint && <div className="text-[11px] text-content-muted mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}

export default function DecisionStrip() {
  const { data: zones = [], isLoading } = useZones({ status: 'approved' });

  const [zoneId, setZoneId] = useState('');
  const [roadWidthM, setRoadWidthM] = useState(18);
  const [plotAreaSqm, setPlotAreaSqm] = useState(1000);
  const [buildingHeightM, setBuildingHeightM] = useState(15);

  // Auto-select the first zone when zones load.
  useEffect(() => {
    if (!zoneId && zones.length > 0) setZoneId(zones[0].id);
  }, [zoneId, zones]);

  const selectedZone = useMemo(
    () => zones.find((z) => z.id === zoneId) || null,
    [zones, zoneId],
  );

  const envelope = useMemo(() => {
    if (!selectedZone) return null;
    return calculateBuildEnvelope(selectedZone, {
      roadWidthM,
      plotAreaSqm,
      buildingHeightM,
    });
  }, [selectedZone, roadWidthM, plotAreaSqm, buildingHeightM]);

  if (isLoading) {
    return (
      <Card elevated className="p-6">
        <div className="space-y-3">
          <Skeleton className="h-3 w-40 rounded" />
          <Skeleton className="h-5 w-2/3 rounded" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
            <Skeleton className="h-20 rounded" />
            <Skeleton className="h-20 rounded" />
            <Skeleton className="h-20 rounded" />
          </div>
          <Skeleton className="h-32 rounded" />
        </div>
        <span className="sr-only">Loading decision strip</span>
      </Card>
    );
  }

  if (zones.length === 0) {
    return (
      <ErrorState tone="info" title="No approved zones available">
        Add and approve master-plan zones before using the Decision Strip.
      </ErrorState>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Build envelope"
        title="Decision Strip — what you can build, given a zone"
        sub="Pick a zone and try road-width / plot-area / building-height combinations. The envelope is computed from the operative RMP 2015 Vol III — setback Tables 8 & 9 and the per-zone FAR road-width tables — all deterministic, no AI in the math."
      />

      <Card elevated className="p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-1.5 font-medium">
              Zone
            </label>
            <select
              value={zoneId}
              onChange={(event) => setZoneId(event.target.value)}
              className="w-full rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.zone_code} — {zone.zone_name}
                </option>
              ))}
            </select>
            {selectedZone?.plan_version && (
              <div className="text-[11px] text-content-muted mt-1.5">{selectedZone.plan_version}</div>
            )}
          </div>
          <NumberInput
            label="Road width"
            value={roadWidthM}
            onChange={setRoadWidthM}
            suffix="m"
            presets={ROAD_WIDTH_PRESETS}
            step={0.5}
          />
          <NumberInput
            label="Plot area"
            value={plotAreaSqm}
            onChange={setPlotAreaSqm}
            suffix="sqm"
            presets={PLOT_AREA_PRESETS}
            step={50}
          />
          <NumberInput
            label="Target building height"
            value={buildingHeightM}
            onChange={setBuildingHeightM}
            suffix="m"
            presets={[9.5, 12.5, 15, 18, 24, 30, 45, 60]}
            step={0.5}
          />
        </div>
      </Card>

      {envelope && envelope.ok && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile
              label="Base FAR"
              value={fmt(envelope.far.base_fsi, 2)}
              footnote={`tier ≥ ${fmt(envelope.far.tier_road_width_m, 1)}m road`}
            />
            <StatTile
              label="Max FAR"
              value={fmt(envelope.far.max_fsi, 2)}
              footnote={envelope.far.tdr_addition !== null ? `+${fmt(envelope.far.tdr_addition, 2)} via TDR` : 'no TDR uplift'}
            />
            <StatTile
              label="Ground coverage"
              value={`${fmt(envelope.ground_coverage_pct, 0)}%`}
              footnote={`footprint cap ≈ ${fmtSqm(envelope.capacity.footprint_cap_sqm)}`}
            />
            <StatTile
              label="Permitted height"
              value={`${fmt(envelope.height.allowed_max_m, 1)} m`}
              footnote={
                envelope.height.road_cap_m !== null && envelope.height.zone_max_m !== null
                  ? `min(zone ${fmt(envelope.height.zone_max_m, 0)}m, road cap ${fmt(envelope.height.road_cap_m, 1)}m)`
                  : 'zone ceiling'
              }
              negative={envelope.height.allowed_max_m !== null && buildingHeightM > envelope.height.allowed_max_m}
            />
          </div>

          <Card elevated className="p-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-1">
              <div>
                <div className="text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-2 font-medium">
                  Setbacks
                </div>
                <ValueRow
                  icon={MoveHorizontal}
                  label="Front"
                  value={`${fmt(envelope.setbacks.front_m, 2)} m`}
                  hint={envelope.setbacks.basis}
                  tone="neutral"
                />
                <ValueRow
                  icon={ArrowsUpFromLine}
                  label="Rear"
                  value={envelope.setbacks.rear_m !== null ? `${fmt(envelope.setbacks.rear_m, 2)} m` : '—'}
                  hint={envelope.setbacks.model === 'low_rise' ? 'rear referenced to site depth' : 'uniform all-around'}
                  tone="neutral"
                />
                <ValueRow
                  icon={ArrowsUpFromLine}
                  label="Side (max of left / right)"
                  value={envelope.setbacks.side_m !== null ? `${fmt(envelope.setbacks.side_m, 2)} m` : '—'}
                  hint={
                    envelope.setbacks.left_m !== null || envelope.setbacks.right_m !== null
                      ? `left ${fmt(envelope.setbacks.left_m, 2)} m / right ${fmt(envelope.setbacks.right_m, 2)} m`
                      : null
                  }
                  tone="neutral"
                />
              </div>
              <div>
                <div className="text-eyebrow uppercase tracking-[0.08em] text-content-muted mb-2 font-medium">
                  Capacity
                </div>
                <ValueRow
                  icon={Building2}
                  label="Buildable area at base FAR"
                  value={fmtSqm(envelope.capacity.buildable_base_sqm)}
                  hint={`${fmtSqm(envelope.inputs.plot_area_sqm)} × ${fmt(envelope.far.base_fsi, 2)}`}
                  tone="success"
                />
                <ValueRow
                  icon={Layers}
                  label="Buildable area at max FAR (with TDR)"
                  value={fmtSqm(envelope.capacity.buildable_max_sqm)}
                  hint={`${fmtSqm(envelope.inputs.plot_area_sqm)} × ${fmt(envelope.far.max_fsi, 2)}`}
                  tone="success"
                />
                <ValueRow
                  icon={Ruler}
                  label="Footprint at max ground coverage"
                  value={fmtSqm(envelope.capacity.footprint_cap_sqm)}
                  hint={`${fmtSqm(envelope.inputs.plot_area_sqm)} × ${fmt(envelope.ground_coverage_pct, 0)}%`}
                  tone="neutral"
                />
              </div>
            </div>
          </Card>

          {envelope.height.allowed_max_m !== null && buildingHeightM > envelope.height.allowed_max_m && (
            <ErrorState tone="warn" title="Target height exceeds permitted ceiling">
              Your target {fmt(buildingHeightM, 1)} m is above the permitted {fmt(envelope.height.allowed_max_m, 1)} m
              ({envelope.height.road_cap_m !== null
                && (envelope.height.zone_max_m === null || envelope.height.road_cap_m <= envelope.height.zone_max_m)
                ? `screening cap ≈ 1.5 × ${fmt(envelope.inputs.road_width_m, 1)}m road + front setback`
                : 'zone-level ceiling'})
              . Either drop the height, widen the abutting road, or pick a different zone.
            </ErrorState>
          )}

          <div className="rounded-md border border-hairline bg-bg-secondary/40 p-3 text-xs text-content-secondary leading-relaxed flex items-start gap-2">
            <Info size={13} className="mt-0.5 text-content-muted shrink-0" />
            <div>
              <div className="font-medium text-content-primary mb-0.5">
                Sources used in this calculation
              </div>
              <ul className="space-y-0.5">
                <li>FAR road-width tiers — {envelope.sources.far_table}</li>
                <li>Setbacks, height ≤ 11.5 m — {envelope.sources.low_rise_setback_table}</li>
                <li>Setbacks, height &gt; 11.5 m — {envelope.sources.high_rise_setback_table}</li>
                <li>Height ceiling — {envelope.sources.max_height_rule}</li>
              </ul>
              <div className="mt-2 flex items-center gap-1.5 text-content-muted">
                <AlertTriangle size={11} />
                <span>{envelope.disclaimer}</span>
              </div>
            </div>
          </div>
        </>
      )}

      {envelope && !envelope.ok && (
        <ErrorState tone="warn" title="Could not compute envelope">
          {envelope.error}
        </ErrorState>
      )}
    </div>
  );
}
