import { useState, useMemo } from 'react';
import {
  MapPin, Shield, AlertTriangle, CheckCircle2, FileText, ExternalLink,
  Building2, Sparkles, Info,
} from 'lucide-react';
import { clsx } from 'clsx';
import MasterPlanZonePanel from './MasterPlanZonePanel';
import { useZone } from '../../hooks/useMasterPlan';
import { computeBuildability, fmtNum } from '../../utils/buildability';

const OVERLAY_CHECKS = [
  { key: 'lake_buffer',      label: 'Lake / water body buffer (75 m)' },
  { key: 'rajakaluve',       label: 'Rajakaluve (storm drain) buffer' },
  { key: 'heritage',         label: 'Heritage zone / protected monument' },
  { key: 'airport_height',   label: 'Airport height constraint (CIAL / HAL)' },
  { key: 'tod_zone',         label: 'Transit-Oriented Development zone' },
  { key: 'road_widening',    label: 'Road widening reservation' },
  { key: 'eco_sensitive',    label: 'Eco-sensitive / forest zone' },
];

const STATUS_CONFIG = {
  not_checked: { label: 'Not checked', color: 'bg-gray-100 text-gray-500',  icon: null },
  clear:       { label: 'Clear',       color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  flag:        { label: 'Flag',        color: 'bg-red-100 text-red-700',     icon: AlertTriangle },
};

function SectionCard({ icon: Icon, title, kicker, children, className }) {
  return (
    <div className={clsx('card', className)}>
      <div className="flex items-start justify-between mb-4 gap-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={16} className="text-primary-600 flex-shrink-0" />}
          <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        </div>
        {kicker}
      </div>
      {children}
    </div>
  );
}

function BigStat({ label, value, unit, tone = 'default', hint }) {
  const tones = {
    default: 'bg-gray-50 text-gray-800',
    primary: 'bg-gradient-to-br from-primary-50 to-primary-100/60 text-primary-800 border border-primary-100',
    emerald: 'bg-gradient-to-br from-emerald-50 to-emerald-100/60 text-emerald-800 border border-emerald-100',
    indigo:  'bg-gradient-to-br from-indigo-50 to-indigo-100/60 text-indigo-800 border border-indigo-100',
    amber:   'bg-gradient-to-br from-amber-50 to-amber-100/60 text-amber-800 border border-amber-100',
  };
  return (
    <div className={clsx('rounded-xl p-3', tones[tone])}>
      <div className="text-[10px] uppercase tracking-[0.12em] font-medium opacity-70">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-xl font-bold leading-none">{value}</span>
        {unit && <span className="text-xs opacity-70">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-[11px] opacity-70">{hint}</div>}
    </div>
  );
}

function KeyValue({ label, value, muted }) {
  return (
    <div className="flex items-start justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={clsx('text-xs font-medium text-right', muted ? 'text-gray-400 italic' : 'text-gray-800')}>
        {value}
      </span>
    </div>
  );
}

function SetbackDiagram({ setbacks }) {
  const hasAny = setbacks?.front_m != null || setbacks?.rear_m != null || setbacks?.side_m != null;
  if (!hasAny) return null;
  const f = setbacks.front_m ?? '-';
  const r = setbacks.rear_m ?? '-';
  const s = setbacks.side_m ?? '-';
  return (
    <div className="relative mx-auto w-full max-w-[240px] aspect-[5/4] rounded-xl bg-gradient-to-br from-primary-50 to-white border border-primary-100 p-5">
      <div className="absolute inset-5 rounded-lg border-2 border-dashed border-primary-300 bg-white/70" />
      <div className="absolute inset-0 flex items-start justify-center pt-0.5">
        <span className="text-[10px] font-semibold text-primary-700">Front {f} m</span>
      </div>
      <div className="absolute inset-0 flex items-end justify-center pb-0.5">
        <span className="text-[10px] font-semibold text-primary-700">Rear {r} m</span>
      </div>
      <div className="absolute inset-0 flex items-center justify-start pl-0.5">
        <span className="text-[10px] font-semibold text-primary-700 -rotate-90 origin-center">Side {s} m</span>
      </div>
      <div className="absolute inset-0 flex items-center justify-end pr-0.5">
        <span className="text-[10px] font-semibold text-primary-700 rotate-90 origin-center">Side {s} m</span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Buildable envelope</div>
          <Building2 size={22} className="mx-auto mt-1 text-primary-500" />
        </div>
      </div>
    </div>
  );
}

function FlagRow({ flag }) {
  const styles = flag.level === 'warning'
    ? 'bg-amber-50 border border-amber-200 text-amber-900'
    : 'bg-blue-50 border border-blue-200 text-blue-900';
  const Icon = flag.level === 'warning' ? AlertTriangle : Info;
  return (
    <div className={clsx('flex gap-2 rounded-lg px-3 py-2 text-xs', styles)}>
      <Icon size={14} className="flex-shrink-0 mt-0.5" />
      <div>
        <div className="font-semibold">{flag.title}</div>
        <div className="opacity-80">{flag.detail}</div>
      </div>
    </div>
  );
}

export default function ZoningTab({ deal, dealId, setTab }) {
  const [overlayStatuses, setOverlayStatuses] = useState(
    Object.fromEntries(OVERLAY_CHECKS.map((o) => [o.key, 'not_checked'])),
  );
  const [zoningNotes, setZoningNotes] = useState('');

  const property = deal?.property || (deal?.property_id
    ? {
        id: deal.property_id,
        zone_id: deal.zone_id ?? null,
        zone_notes: deal.zone_notes ?? null,
        road_width_mtrs: deal.road_width_mtrs ?? null,
        permissible_fsi: deal.permissible_fsi ?? null,
        land_area_sqft: deal.land_area_sqft ?? null,
        existing_fsi: deal.existing_fsi ?? null,
        circle_rate_per_sqft: deal.circle_rate_per_sqft ?? null,
        zoning: deal.zoning ?? null,
      }
    : null);

  const { data: zone } = useZone(property?.zone_id);

  const buildability = useMemo(
    () => computeBuildability({
      zone,
      property,
      assetClass: deal?.asset_class,
    }),
    [zone, property, deal?.asset_class],
  );

  const zoningLabel = property?.zoning ? property.zoning.replace(/_/g, ' ') : null;
  const circleRate = property?.circle_rate_per_sqft;
  const landSqft   = property?.land_area_sqft;
  const hasAnyParcelData = !!(zoningLabel || property?.road_width_mtrs || property?.permissible_fsi || circleRate || landSqft);

  const cycleOverlay = (key) =>
    setOverlayStatuses((prev) => ({
      ...prev,
      [key]:
        prev[key] === 'not_checked' ? 'clear'
        : prev[key] === 'clear'     ? 'flag'
        : 'not_checked',
    }));

  return (
    <div className="space-y-5">
      {/* Master Plan Zone (hero) */}
      <MasterPlanZonePanel property={property} />

      {/* Zone-driven buildability envelope */}
      <SectionCard
        icon={Sparkles}
        title="Buildability Envelope"
        kicker={
          buildability.has_zone ? (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary-50 text-primary-700">
              <Shield size={11} />
              {buildability.zone?.code} · {buildability.zone?.plan_version}
            </span>
          ) : buildability.effective_fsi != null ? (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
              <Info size={11} /> Manual FSI only — assign a zone for full envelope
            </span>
          ) : null
        }
      >
        {buildability.effective_fsi == null && buildability.land_sqft == null ? (
          <div className="py-6 text-center">
            <p className="text-sm text-gray-600 mb-3">
              Assign a master plan zone and add parcel area to see the regulated envelope.
            </p>
            <ul className="text-xs text-gray-500 space-y-1 inline-block text-left">
              {buildability.missing_inputs.map((m) => (
                <li key={m}>• {m}</li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <BigStat
                label="Effective FSI"
                value={fmtNum(buildability.effective_fsi, 2)}
                tone="primary"
                hint={
                  buildability.fsi_source === 'zone' && buildability.matched_tier
                    ? `Tier: road ≥ ${buildability.matched_tier.rule.road_width_m} m`
                    : buildability.fsi_source === 'zone'
                      ? 'From zone base'
                      : buildability.fsi_source === 'manual'
                        ? 'Manual override'
                        : null
                }
              />
              <BigStat
                label="Max built-up"
                value={fmtNum(buildability.max_built_up_sqft)}
                unit="sqft"
                tone="emerald"
                hint={buildability.max_built_up_sqft != null
                  ? `${fmtNum(buildability.max_built_up_sqft / 43560, 2)} ac`
                  : null}
              />
              <BigStat
                label="Ground coverage"
                value={fmtNum(buildability.max_ground_coverage_sqft)}
                unit="sqft"
                tone="indigo"
                hint={`${fmtNum(buildability.ground_coverage_pct, 0)}% of parcel${buildability.ground_coverage_source === 'default' ? ' (default)' : ''}`}
              />
              <BigStat
                label={buildability.limiting_factor ? `Floors (by ${buildability.limiting_factor})` : 'Floors'}
                value={fmtNum(buildability.max_floors, 1)}
                tone="amber"
                hint={buildability.max_height_m ? `Height cap ${buildability.max_height_m} m` : null}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
              <div>
                <SetbackDiagram setbacks={buildability.setbacks} />
                {!buildability.has_setbacks && (
                  <p className="mt-2 text-[11px] text-gray-400 italic text-center">
                    Setbacks not captured on this zone.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Derived figures</h4>
                <KeyValue
                  label="Parcel area"
                  value={buildability.land_sqft != null
                    ? `${fmtNum(buildability.land_sqft)} sqft · ${fmtNum(buildability.land_acres, 2)} ac`
                    : 'Not set'}
                  muted={buildability.land_sqft == null}
                />
                <KeyValue
                  label="Road width"
                  value={buildability.road_width_m != null ? `${buildability.road_width_m} m` : 'Not set'}
                  muted={buildability.road_width_m == null}
                />
                {buildability.net_plot && (
                  <KeyValue
                    label="Net plot after setbacks"
                    value={`${fmtNum(buildability.net_plot.net_plot_sqft)} sqft`}
                  />
                )}
                <KeyValue
                  label="Max floors by coverage"
                  value={buildability.max_floors_by_coverage != null ? fmtNum(buildability.max_floors_by_coverage, 1) : '—'}
                  muted={buildability.max_floors_by_coverage == null}
                />
                <KeyValue
                  label="Max floors by height"
                  value={buildability.max_floors_by_height != null ? `${fmtNum(buildability.max_floors_by_height, 1)} (at 3 m/floor)` : '—'}
                  muted={buildability.max_floors_by_height == null}
                />
                <KeyValue
                  label="Height cap"
                  value={buildability.max_height_m != null ? `${buildability.max_height_m} m` : 'Not set on zone'}
                  muted={buildability.max_height_m == null}
                />
                {deal?.asset_class && (
                  <KeyValue
                    label="Asset class alignment"
                    value={
                      buildability.alignment.status === 'aligned'  ? '✓ Permitted'
                    : buildability.alignment.status === 'blocked'  ? '✗ Prohibited'
                    : buildability.alignment.status === 'unclear'  ? '— Unclear'
                    : '—'
                    }
                  />
                )}
              </div>
            </div>

            {buildability.flags.length > 0 && (
              <div className="mt-4 space-y-2">
                {buildability.flags.map((f, i) => <FlagRow key={i} flag={f} />)}
              </div>
            )}

            <div className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-500 flex items-start gap-2">
              <Info size={12} className="mt-0.5 flex-shrink-0" />
              <div>
                Deterministic rule-engine output. Ground coverage assumed 40% when the zone
                does not specify a value. Floor estimate uses 3 m / floor and is capped by
                whichever limit — coverage or height — binds first. Actual approvals
                depend on site geometry, premium FSI purchase, and BBMP / BDA scrutiny.
              </div>
            </div>
          </>
        )}
      </SectionCard>

      {/* Parcel inputs */}
      <SectionCard
        icon={MapPin}
        title="Parcel inputs"
        kicker={
          setTab && (
            <button
              onClick={() => setTab('parcel')}
              className="text-[11px] text-primary-600 hover:underline"
            >
              Edit in Parcel / Site
            </button>
          )
        }
      >
        {hasAnyParcelData ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <KeyValue label="Zoning (high-level)"   value={zoningLabel || 'Not set'}           muted={!zoningLabel} />
            <KeyValue label="Land area (sqft)"      value={landSqft ? fmtNum(landSqft) : 'Not set'} muted={!landSqft} />
            <KeyValue label="Road width (m)"        value={property?.road_width_mtrs ? `${property.road_width_mtrs} m` : 'Not set'} muted={!property?.road_width_mtrs} />
            <KeyValue label="Permissible FSI"       value={property?.permissible_fsi != null ? fmtNum(property.permissible_fsi, 2) : 'Not set'} muted={property?.permissible_fsi == null} />
            <KeyValue label="Existing / consumed FSI" value={property?.existing_fsi != null ? fmtNum(property.existing_fsi, 2) : 'Not set'} muted={property?.existing_fsi == null} />
            <KeyValue label="Circle rate"           value={circleRate ? `₹${fmtNum(circleRate)}/sqft` : 'Not set'} muted={!circleRate} />
          </div>
        ) : (
          <p className="text-sm text-gray-400 italic">
            Parcel data not yet captured. Open the Parcel / Site tab to fill in area, road width, and commercial fields.
          </p>
        )}
      </SectionCard>

      {/* Overlay / buffer checks */}
      <SectionCard
        icon={Shield}
        title="Overlay & buffer checks"
        kicker={<span className="text-[11px] text-gray-500">Click a status to cycle</span>}
      >
        <p className="text-xs text-gray-500 mb-3">
          Manual entry until the GIS layer is wired in. BBMP / BDA datasets required — see TODO_DATA.md.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {OVERLAY_CHECKS.map((overlay) => {
                const status = overlayStatuses[overlay.key];
                const cfg    = STATUS_CONFIG[status];
                const Icon   = cfg.icon;
                return (
                  <tr key={overlay.key} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 text-xs text-gray-700">{overlay.label}</td>
                    <td className="py-2.5 text-right">
                      <button
                        onClick={() => cycleOverlay(overlay.key)}
                        className={clsx(
                          'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                          cfg.color,
                        )}
                      >
                        {Icon && <Icon size={11} />}
                        {cfg.label}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Rule sets */}
      <SectionCard icon={FileText} title="Applicable rule sets">
        <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center">
          <p className="text-sm text-gray-500 mb-2">
            No additional rule packs loaded for this deal's jurisdiction.
          </p>
          <p className="text-xs text-gray-400 max-w-lg mx-auto">
            Upload master plan PDFs, gazette notifications, or BBMP / BDA rule extracts in the
            Documents tab to queue them for extraction.
          </p>
          {setTab && (
            <button
              onClick={() => setTab('documents')}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-50 text-primary-700 text-xs font-medium hover:bg-primary-100 transition-colors"
            >
              <ExternalLink size={12} />
              Go to documents
            </button>
          )}
        </div>
      </SectionCard>

      {/* Manual notes */}
      <SectionCard icon={AlertTriangle} title="Analyst notes (manual)">
        <p className="text-xs text-gray-400 mb-2">
          For observations, authority feedback, or pending clarifications. Not used in calculations.
        </p>
        <textarea
          rows={4}
          value={zoningNotes}
          onChange={(e) => setZoningNotes(e.target.value)}
          placeholder="Site-specific zoning notes, constraints, authority conversations, pending verifications..."
          className="input text-sm w-full"
        />
      </SectionCard>
    </div>
  );
}
