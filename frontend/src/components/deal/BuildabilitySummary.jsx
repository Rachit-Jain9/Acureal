import { useMemo } from 'react';
import { Sparkles, Building2, Layers, Ruler, AlertTriangle, Info } from 'lucide-react';
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
                {result.missing_inputs.map((m) => <li key={m}>• {m}</li>)}
              </ul>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Tile
                icon={Sparkles}
                tone="primary"
                label="Effective FSI"
                value={fmtNum(result.effective_fsi, 2)}
                hint={result.fsi_source === 'zone' && result.matched_tier
                  ? `Tier ≥${result.matched_tier.rule.road_width_m} m`
                  : result.fsi_source === 'zone' ? 'Base' : 'Manual'}
              />
              <Tile
                icon={Building2}
                tone="emerald"
                label="Max built-up"
                value={fmtNum(result.max_built_up_sqft)}
                unit="sqft"
              />
              <Tile
                icon={Ruler}
                tone="indigo"
                label="Ground cov."
                value={fmtNum(result.max_ground_coverage_sqft)}
                unit="sqft"
                hint={`${fmtNum(result.ground_coverage_pct, 0)}%`}
              />
              <Tile
                icon={Layers}
                tone="amber"
                label={result.limiting_factor ? `Floors (${result.limiting_factor})` : 'Floors'}
                value={fmtNum(result.max_floors, 1)}
                hint={result.max_height_m ? `≤${result.max_height_m} m` : null}
              />
            </div>

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
