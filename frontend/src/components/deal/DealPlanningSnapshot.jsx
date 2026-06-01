import { useMemo } from 'react';
import { Building2, MapPin, Users, Maximize2, Gauge, Layers } from 'lucide-react';
import Badge from '../common/Badge';
import useAutoDeriveParcelContext from '../../hooks/useAutoDeriveParcelContext';

/**
 * DealPlanningSnapshot — the positive counterpart to
 * DealAutoDerivedWarningsStrip. Surfaces the resolved Bengaluru Planning
 * District + its census demographics + BBMP guidance band on the deal
 * Overview, so the master-plan / planning context the auto-derive
 * orchestrator already computes is visible on the front page — not buried
 * on the Parcel tab.
 *
 * Auto-fires the SAME shared hook the warnings strip + AutoFillParcelContextCard
 * use (identical query key → one network round-trip, shared cache). If the
 * operator already clicked Derive on the Parcel tab, this is instant.
 *
 * Honest by construction:
 *   - Renders nothing when there's no address/coords, the deal isn't
 *     Bengaluru, the geocode was gated (approximate), or no Planning
 *     District resolved — no empty-state noise, no fabricated context.
 *   - Demographics are 2011 Census figures (the latest authoritative
 *     PD-level data); labelled as such.
 *   - Carries the match source + a "verify on Parcel tab" prompt — this is
 *     an address-fuzz match, not a spatial parcel intersection.
 */
// Land-use category → swatch colour for the existing-land-use mix bar. A
// data-viz palette (not UI chrome), so explicit hex like the chart components.
const LU_COLOR = {
  'Residential': '#3b82f6',
  'Commercial': '#f59e0b',
  'Industrial': '#8b5cf6',
  'Public Semi Public': '#14b8a6',
  'Public & Semi Public - Defence': '#0d9488',
  'Public Utility': '#64748b',
  'Parks & Open Spaces': '#22c55e',
  'Transport & Communication': '#94a3b8',
  'Vacant': '#cbd5e1',
  'Agriculture': '#84cc16',
  'Forest': '#15803d',
  'Streams': '#67e8f9',
  'Water Bodies': '#06b6d4',
  'Quarry/Mining Sites': '#a16207',
};
const luColor = (cat) => LU_COLOR[cat] || '#9ca3af';
const LU_SHORT = {
  'Public Semi Public': 'Public/Semi-Public',
  'Public & Semi Public - Defence': 'Defence',
  'Public Utility': 'Utilities',
  'Parks & Open Spaces': 'Parks',
  'Transport & Communication': 'Transport',
  'Water Bodies': 'Water',
};
const luShort = (cat) => LU_SHORT[cat] || cat;

export default function DealPlanningSnapshot({ deal }) {
  const address = deal?.property_address || deal?.address || null;
  const lat = deal?.lat ?? null;
  const lng = deal?.lng ?? null;
  const hasInput =
    (typeof address === 'string' && address.trim().length > 0) || (lat != null && lng != null);
  const isBengaluru = /beng|bang/i.test(String(deal?.city || ''));

  // Same args/queryKey as the warnings strip → shared react-query cache.
  const { data } = useAutoDeriveParcelContext({
    address,
    lat,
    lng,
    enabled: hasInput && isBengaluru,
  });

  const pd = data?.planningDistrict || null;
  const zone = data?.bbmpZone || null;
  const overlays = useMemo(
    () => (Array.isArray(data?.applicableWarnings) ? data.applicableWarnings : []),
    [data],
  );

  // Honest gates: no input, non-BLR, approximate geocode, or no PD resolved
  // (e.g. outside BBMP) → render nothing rather than an empty shell.
  if (!hasInput || !isBengaluru) return null;
  if (data?.coordinatesGate?.gated) return null;
  if (!pd || !pd.pd_code) return null;

  const demo = [
    pd.population_2011 != null
      ? { icon: Users, label: 'Population (2011)', value: Number(pd.population_2011).toLocaleString('en-IN') }
      : null,
    pd.area_ha != null
      ? { icon: Maximize2, label: 'Area', value: `${Number(pd.area_ha).toLocaleString('en-IN')} ha` }
      : null,
    pd.gross_density_pph != null
      ? { icon: Gauge, label: 'Gross density', value: `${pd.gross_density_pph} PPH` }
      : null,
  ].filter(Boolean);

  const band =
    Number.isFinite(Number(zone?.guidance_value_band_min_inr)) &&
    Number.isFinite(Number(zone?.guidance_value_band_max_inr))
      ? `₹${Number(zone.guidance_value_band_min_inr).toLocaleString('en-IN')}–${Number(
          zone.guidance_value_band_max_inr,
        ).toLocaleString('en-IN')}/sqft`
      : null;

  const confidencePct = pd.confidence != null ? Math.round(Number(pd.confidence) * 100) : null;

  const landUse =
    Array.isArray(pd.existing_land_use?.categories) && pd.existing_land_use.categories.length > 0
      ? pd.existing_land_use
      : null;

  return (
    <div
      className="rounded-xl border border-hairline-strong bg-bg-elevated overflow-hidden"
      data-testid="deal-planning-snapshot"
    >
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-hairline bg-bg-secondary/50">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-bg-elevated border border-hairline shrink-0">
          <Building2 size={13} className="text-content-secondary" aria-hidden="true" />
        </span>
        <h3 className="text-sm font-semibold tracking-tight text-content-primary min-w-0 truncate">
          Planning context
        </h3>
        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-bg-secondary text-content-muted border border-hairline font-medium">
          Auto-derived
        </span>
      </div>

      <div className="px-4 py-3.5 space-y-3.5">
        {/* Planning District headline + BBMP tax zone */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-content-muted font-medium mb-0.5">
              Bengaluru Planning District
            </p>
            <p className="text-base font-bold text-content-primary leading-tight">
              {pd.pd_code}
              {pd.pd_name ? ` — ${pd.pd_name}` : ''}
            </p>
          </div>
          {zone?.zone_code && (
            <div className="text-right shrink-0">
              <p className="text-[10px] uppercase tracking-wider text-content-muted font-medium mb-0.5">
                BBMP tax zone
              </p>
              <p className="text-sm font-semibold text-content-primary tabular-nums">Zone {zone.zone_code}</p>
            </div>
          )}
        </div>

        {/* Demographics */}
        {demo.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {demo.map(({ icon: Icon, label, value }) => (
              <div key={label} className="rounded-lg bg-bg-secondary px-2.5 py-2">
                <div className="flex items-center gap-1 text-content-muted mb-0.5">
                  <Icon size={11} aria-hidden="true" />
                  <span className="text-[9px] uppercase tracking-wider font-medium leading-tight">{label}</span>
                </div>
                <p className="text-sm font-semibold text-content-primary tabular-nums leading-tight">{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Existing land-use mix (RMP planning-district report, 2015 baseline) —
            present for the 7 central PDs (PD-01..PD-07) with a digitised report. */}
        {landUse && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-content-muted font-medium mb-1.5">
              Existing land use · {landUse.baseline_year} baseline
            </p>
            <div
              className="flex h-2.5 w-full rounded-full overflow-hidden bg-bg-secondary"
              role="img"
              aria-label="Existing land-use composition"
            >
              {landUse.categories.map((c) => (
                <div
                  key={c.category}
                  style={{ width: `${c.pct}%`, backgroundColor: luColor(c.category) }}
                  title={`${c.category}: ${c.pct}% (${Number(c.area_ha).toLocaleString('en-IN')} ha)`}
                />
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {landUse.categories.slice(0, 5).map((c) => (
                <span
                  key={c.category}
                  className="inline-flex items-center gap-1 text-[10px] text-content-secondary"
                >
                  <span
                    className="w-2 h-2 rounded-sm shrink-0"
                    style={{ backgroundColor: luColor(c.category) }}
                  />
                  {luShort(c.category)}{' '}
                  <span className="tabular-nums font-medium text-content-primary">{c.pct}%</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Guidance band + overlays count */}
        {(band || overlays.length > 0) && (
          <div className="flex items-center gap-2.5 flex-wrap text-[11px]">
            {band && (
              <span className="inline-flex items-center gap-1 text-content-secondary">
                <Layers size={11} className="text-content-muted" aria-hidden="true" />
                Guidance band <span className="font-medium text-content-primary tabular-nums">{band}</span>
              </span>
            )}
            {overlays.length > 0 && (
              <Badge tone="warn" className="!text-[11px]">
                {overlays.length} city-level overlay{overlays.length === 1 ? '' : 's'} to verify
              </Badge>
            )}
          </div>
        )}

        {/* Provenance / honesty footer */}
        <p className="text-[11px] text-content-muted pt-2 border-t border-hairline-soft">
          <MapPin size={10} className="inline mr-1 -mt-0.5" aria-hidden="true" />
          Census 2011 demographics · matched from address
          {pd.source ? ` (${pd.source})` : ''}
          {confidencePct != null ? ` · ${confidencePct}% confidence` : ''} — verify against the parcel on the
          Parcel tab before quoting in IC.
        </p>
      </div>
    </div>
  );
}
