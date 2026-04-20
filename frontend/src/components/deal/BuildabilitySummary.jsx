import { useMemo } from 'react';
import { Sparkles, Building2, Layers, AlertTriangle, Info, Home, Car } from 'lucide-react';
import { clsx } from 'clsx';
import { useZone } from '../../hooks/useMasterPlan';
import { computeBuildability, fmtNum } from '../../utils/buildability';

// Compact buildability readout. Drop on property detail pages, deal overview
// cards, and anywhere else a one-glance envelope figure is useful.
export default function BuildabilitySummary({ property, assetClass, title = 'Buildable envelope', compact = false }) {
  const { data: zone } = useZone(property?.zone_id);

  const result = useMemo(
    () => computeBuildability({ zone, property, assetClass }),
    [zone, property, assetClass],
  );

  if (!property?.id) return null;

  const hasEnough = result.effective_fsi != null && result.land_sqft != null;
  const hasPremium = result.premium_fsi_available != null && result.premium_fsi_available > 0.01;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-5 py-3 flex items-center justify-between gap-3 bg-gradient-to-r from-emerald-50 via-white to-primary-50 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-primary-500 flex items-center justify-center text-white shadow-sm">
            <Sparkles size={14} />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">Zoning output</div>
            <div className="text-sm font-semibold text-gray-800">{title}</div>
          </div>
        </div>
        {result.zone ? (
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 font-medium">
            {result.zone.code}
          </span>
        ) : null}
      </div>

      <div className={clsx('p-5', compact && 'p-4')}>
        {!hasEnough ? (
          <div>
            <p className="text-xs text-gray-500 mb-2">
              {result.has_zone
                ? 'Add parcel area to see the regulated envelope.'
                : 'Assign a master plan zone and parcel area to see the envelope.'}
            </p>
            {result.missing_inputs.length > 0 && (
              <ul className="text-[11px] text-gray-400 space-y-0.5">
                {result.missing_inputs.map((m) => <li key={m}>{'\u2022'} {m}</li>)}
              </ul>
            )}
          </div>
        ) : (
          <>
            {/* FSI chip with breakdown */}
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">Effective FSI</span>
                <span className="ml-2 text-2xl font-bold text-gray-900">{fmtNum(result.effective_fsi, 2)}</span>
              </div>
              {hasPremium && result.base_fsi != null && (
                <span className="text-[11px] text-gray-500">
                  = {fmtNum(result.base_fsi, 2)} base
                  <span className="mx-1">+</span>
                  <span className="text-indigo-600 font-semibold">{fmtNum(result.premium_fsi_available, 2)} premium</span>
                </span>
              )}
              {result.matched_tier?.rule && (
                <span className="text-[10px] text-gray-400 ml-auto">
                  road {'\u2265'} {result.matched_tier.rule.road_width_m} m
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Tile
                icon={Building2}
                tone="emerald"
                label="Max built-up"
                value={fmtNum(result.realized_built_up_sqft)}
                unit="sqft"
                hint={result.realized_built_up_sqft != null
                  ? `${fmtNum(result.realized_built_up_sqft / 43560, 2)} ac`
                  : null}
              />
              <Tile
                icon={Layers}
                tone="amber"
                label="Floors"
                value={result.max_floors != null ? fmtNum(result.max_floors, 0) : '\u2014'}
                hint={result.max_height_m ? `\u2264${result.max_height_m} m` : null}
              />
              <Tile
                icon={Home}
                tone="indigo"
                label="Footprint"
                value={result.typical_footprint_sqft != null
                  ? fmtNum(result.typical_footprint_sqft)
                  : '\u2014'}
                unit="sqft"
                hint={result.typical_footprint_sqft != null && result.land_sqft
                  ? `${fmtNum((result.typical_footprint_sqft / result.land_sqft) * 100, 1)}%/floor`
                  : null}
              />
              <Tile
                icon={Sparkles}
                tone="primary"
                label={result.unit_label || 'Units'}
                value={result.unit_count != null ? fmtNum(result.unit_count, 0) : '\u2014'}
                hint={result.unit_size_sqft != null
                  ? `@${fmtNum(result.unit_size_sqft)} sqft`
                  : 'Set asset class'}
              />
            </div>

            {result.parking && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
                <Car size={12} className="text-gray-500" />
                <span className="font-semibold text-gray-700">{fmtNum(result.parking.cars, 0)}</span>
                <span>car bays</span>
                {result.parking.visitor_cars > 0 && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span>{fmtNum(result.parking.visitor_cars, 0)} visitor</span>
                  </>
                )}
                <span className="text-gray-300">·</span>
                <span>{fmtNum(result.parking.ev_bays, 0)} EV</span>
              </div>
            )}

            {result.flags.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {result.flags.slice(0, 2).map((f, i) => (
                  <div
                    key={i}
                    className={clsx(
                      'flex items-start gap-2 rounded-md px-2.5 py-1.5 text-[11px]',
                      f.level === 'warning'
                        ? 'bg-amber-50 text-amber-800 border border-amber-100'
                        : 'bg-blue-50 text-blue-800 border border-blue-100',
                    )}
                  >
                    {f.level === 'warning'
                      ? <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                      : <Info size={12} className="flex-shrink-0 mt-0.5" />}
                    <div>
                      <span className="font-medium">{f.title}.</span>{' '}
                      <span className="opacity-80">{f.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ icon: Icon, tone, label, value, unit, hint }) {
  const tones = {
    primary: 'bg-primary-50/70 text-primary-800',
    emerald: 'bg-emerald-50/70 text-emerald-800',
    indigo:  'bg-indigo-50/70  text-indigo-800',
    amber:   'bg-amber-50/70   text-amber-800',
  };
  return (
    <div className={clsx('rounded-lg p-2.5', tones[tone] || tones.primary)}>
      <div className="flex items-center gap-1 mb-0.5">
        {Icon && <Icon size={11} className="opacity-70" />}
        <span className="text-[10px] uppercase tracking-[0.1em] font-medium opacity-75">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-base font-bold leading-none">{value}</span>
        {unit && <span className="text-[10px] opacity-70">{unit}</span>}
      </div>
      {hint && <div className="text-[10px] opacity-70 mt-0.5">{hint}</div>}
    </div>
  );
}
