import { useState, useMemo } from 'react';
import {
  MapPin, Shield, AlertTriangle, CheckCircle2, FileText, ExternalLink,
  Building2, Sparkles, Info, Car,
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

function FsiStack({ buildability, usePremium, setUsePremium }) {
  const base = buildability.base_fsi;
  const premiumAvail = buildability.premium_fsi_available;
  const premiumUsed = buildability.premium_fsi_used ?? 0;
  const effective = buildability.effective_fsi;
  const hasPremium = premiumAvail != null && premiumAvail > 0.01;
  const tier = buildability.matched_tier;

  return (
    <div className="rounded-xl border border-primary-100 bg-gradient-to-br from-primary-50/60 via-white to-indigo-50/50 p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-indigo-500 flex items-center justify-center text-white shadow-sm">
            <Sparkles size={16} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-primary-700/70">
              Floor area ratio stack
            </div>
            <div className="text-2xl font-bold text-gray-900 leading-tight">
              {fmtNum(effective, 2)}
              <span className="ml-2 text-xs font-medium text-primary-600">effective FSI</span>
            </div>
            {tier?.rule && (
              <div className="text-[11px] text-gray-500 mt-0.5">
                Tier: road {'\u2265'} {tier.rule.road_width_m} m
              </div>
            )}
          </div>
        </div>

        {hasPremium && (
          <label className="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={usePremium}
              onChange={(e) => setUsePremium(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            Use premium FAR ({fmtNum(premiumAvail, 2)} available)
          </label>
        )}
      </div>

      {/* Stacked bar */}
      {(base != null || premiumAvail != null) && (
        <div className="mt-3">
          <div className="h-3 rounded-full overflow-hidden bg-gray-100 flex">
            {base != null && (
              <div
                className="bg-gradient-to-r from-primary-500 to-primary-400"
                style={{ width: `${(base / (base + (premiumAvail || 0))) * 100}%` }}
                title={`Base FSI ${fmtNum(base, 2)}`}
              />
            )}
            {hasPremium && (
              <div
                className={clsx(
                  'transition-opacity',
                  usePremium
                    ? 'bg-gradient-to-r from-indigo-400 to-indigo-500 opacity-100'
                    : 'bg-indigo-200 opacity-50',
                )}
                style={{ width: `${(premiumAvail / (base + premiumAvail)) * 100}%` }}
                title={`Premium FAR ${fmtNum(premiumAvail, 2)}`}
              />
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {base != null && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-primary-500" />
                <span className="text-gray-600">Base</span>
                <span className="font-semibold text-primary-700">{fmtNum(base, 2)}</span>
              </span>
            )}
            {hasPremium && (
              <span className="inline-flex items-center gap-1.5">
                <span className={clsx('h-2 w-2 rounded-full', usePremium ? 'bg-indigo-500' : 'bg-indigo-200')} />
                <span className="text-gray-600">Premium</span>
                <span className={clsx('font-semibold', usePremium ? 'text-indigo-700' : 'text-gray-400 line-through')}>
                  +{fmtNum(premiumAvail, 2)}
                </span>
                <span className="text-[10px] text-gray-400">(paid to BDA)</span>
              </span>
            )}
            {buildability.manual_fsi != null && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="text-gray-600">Manual override</span>
                <span className="font-semibold text-amber-700">{fmtNum(buildability.manual_fsi, 2)}</span>
              </span>
            )}
          </div>
          {hasPremium && !usePremium && (
            <div className="mt-1.5 text-[11px] text-gray-500 italic">
              Premium FAR excluded from envelope. Toggle above to include (fee payable to BDA).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ParkingPanel({ parking }) {
  if (!parking) return null;
  const totalBays = (parking.cars || 0) + (parking.visitor_cars || 0);
  return (
    <div className="mt-4 rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50/80 to-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
          <Car size={13} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-gray-500">
            Parking programme
          </div>
          <div className="text-sm font-semibold text-gray-800">Estimated car bays</div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ParkTile label="Resident bays" value={fmtNum(parking.cars, 0)} tone="primary" />
        <ParkTile label="Visitor" value={fmtNum(parking.visitor_cars, 0)} tone="gray" />
        <ParkTile label="EV charging" value={fmtNum(parking.ev_bays, 0)} tone="emerald" />
        <ParkTile label="Total" value={fmtNum(totalBays, 0)} tone="indigo" />
      </div>
      <div className="mt-2 text-[11px] text-gray-500">{parking.basis}</div>
    </div>
  );
}

function ParkTile({ label, value, tone }) {
  const tones = {
    primary: 'bg-primary-50 text-primary-800',
    emerald: 'bg-emerald-50 text-emerald-800',
    indigo:  'bg-indigo-50 text-indigo-800',
    gray:    'bg-gray-50 text-gray-700',
  };
  return (
    <div className={clsx('rounded-lg px-3 py-2', tones[tone] || tones.gray)}>
      <div className="text-[10px] uppercase tracking-[0.1em] opacity-70 font-medium">{label}</div>
      <div className="mt-0.5 text-base font-bold leading-none">{value}</div>
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
  const [usePremium, setUsePremium] = useState(true);

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
      options: { usePremiumFar: usePremium },
    }),
    [zone, property, deal?.asset_class, usePremium],
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
                <li key={m}>{'\u2022'} {m}</li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            {/* FSI stack: base + premium */}
            <FsiStack buildability={buildability} usePremium={usePremium} setUsePremium={setUsePremium} />

            {/* Primary envelope tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <BigStat
                label="Max built-up"
                value={fmtNum(buildability.realized_built_up_sqft)}
                unit="sqft"
                tone="emerald"
                hint={buildability.realized_built_up_sqft != null
                  ? `${fmtNum(buildability.realized_built_up_sqft / 43560, 2)} ac realized`
                  : null}
              />
              <BigStat
                label="Max floors"
                value={buildability.max_floors != null ? fmtNum(buildability.max_floors, 0) : '\u2014'}
                tone="amber"
                hint={buildability.max_height_m
                  ? `\u2264${buildability.max_height_m} m @ ${fmtNum(buildability.floor_height_m, 1)} m/floor`
                  : (buildability.limiting_factor ? `limited by ${buildability.limiting_factor}` : null)}
              />
              <BigStat
                label="Typical footprint"
                value={buildability.typical_footprint_sqft != null
                  ? fmtNum(buildability.typical_footprint_sqft)
                  : '\u2014'}
                unit="sqft"
                tone="indigo"
                hint={buildability.typical_footprint_sqft != null && buildability.land_sqft
                  ? `${fmtNum((buildability.typical_footprint_sqft / buildability.land_sqft) * 100, 1)}% of plot / floor`
                  : null}
              />
              <BigStat
                label="Ground coverage"
                value={buildability.max_ground_coverage_sqft != null
                  ? fmtNum(buildability.max_ground_coverage_sqft)
                  : '\u2014'}
                unit="sqft"
                tone="primary"
                hint={`${fmtNum(buildability.ground_coverage_pct, 0)}% of parcel${buildability.ground_coverage_source === 'default' ? ' (default)' : ''}`}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 mt-4">
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
                    ? `${fmtNum(buildability.land_sqft)} sqft \u00b7 ${fmtNum(buildability.land_acres, 2)} ac`
                    : 'Not set'}
                  muted={buildability.land_sqft == null}
                />
                <KeyValue
                  label="Road width"
                  value={buildability.road_width_m != null ? `${buildability.road_width_m} m` : 'Not set'}
                  muted={buildability.road_width_m == null}
                />
                <KeyValue
                  label="Ground coverage cap"
                  value={buildability.max_ground_coverage_sqft != null
                    ? `${fmtNum(buildability.max_ground_coverage_sqft)} sqft \u00b7 ${fmtNum(buildability.ground_coverage_pct, 0)}%${buildability.ground_coverage_source === 'default' ? ' (default)' : ''}`
                    : '\u2014'}
                />
                {buildability.net_plot && (
                  <KeyValue
                    label="Net plot after setbacks"
                    value={`${fmtNum(buildability.net_plot.net_plot_sqft)} sqft`}
                  />
                )}
                <KeyValue
                  label="Height cap"
                  value={buildability.max_height_m != null
                    ? `${buildability.max_height_m} m \u2192 ${buildability.max_floors_by_height ?? '\u2014'} floors @ ${fmtNum(buildability.floor_height_m, 1)} m/floor`
                    : 'Not set on zone'}
                  muted={buildability.max_height_m == null}
                />
                <KeyValue
                  label="Min floors to reach FSI"
                  value={buildability.min_floors_for_fsi != null
                    ? `${buildability.min_floors_for_fsi} (at full coverage)`
                    : '\u2014'}
                  muted={buildability.min_floors_for_fsi == null}
                />
                {deal?.asset_class && (
                  <KeyValue
                    label="Asset class alignment"
                    value={
                      buildability.alignment.status === 'aligned'  ? '\u2713 Permitted'
                    : buildability.alignment.status === 'blocked'  ? '\u2717 Prohibited'
                    : buildability.alignment.status === 'unclear'  ? '\u2014 Unclear'
                    : '\u2014'
                    }
                  />
                )}
              </div>
            </div>

            {/* Parking & programming */}
            {buildability.parking && (
              <ParkingPanel parking={buildability.parking} />
            )}

            {buildability.flags.length > 0 && (
              <div className="mt-4 space-y-2">
                {buildability.flags.map((f, i) => <FlagRow key={i} flag={f} />)}
              </div>
            )}

            <div className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-500 flex items-start gap-2">
              <Info size={12} className="mt-0.5 flex-shrink-0" />
              <div>
                Deterministic rule-engine output. Floors are whole numbers, capped by the
                zone height limit at {fmtNum(buildability.floor_height_m, 1)} m per floor.
                Unit counts are floor()'d to whole numbers. Premium FAR assumes full BDA
                fee payment or TDR. Actual approvals depend on site geometry and
                BBMP / BDA scrutiny.
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
