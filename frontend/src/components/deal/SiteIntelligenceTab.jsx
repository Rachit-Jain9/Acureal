import { useState, useMemo, useEffect, useRef } from 'react';
import { Building2, Ruler, Car, Layers, ArrowRight, SlidersHorizontal, Maximize2 } from 'lucide-react';
import {
  Card, SectionHeader, MetricTile, StatTile, ErrorState, Button, Field, Input, Skeleton,
} from '../../design-system';
import Badge from '../common/Badge';
import { toast } from '../common/Toast';
import { useDealContext, useDealRecord } from '../../hooks/useDealContext';
import { useProperty } from '../../hooks/useProperties';
import { computeSiteYield, resolveFamily, DEFAULT_RESIDENTIAL_MIX } from '../../utils/siteYield';
import { mapProgrammeToInputs, stashPrefill } from '../../utils/programmeToInputs';
import { ASSET_CLASS_LABELS } from '../../utils/assetClasses';
import BuildabilityMassing from './BuildabilityMassing';

// ── formatters ──────────────────────────────────────────────────────────────
const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-IN') : '—');
const numOrUndef = (v) => {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const BINDING_LABEL = {
  far: 'FAR / FSI',
  coverage_height: 'Ground coverage × height',
  plot_subdivision: 'Plot subdivision',
};

const resolveLinkedProperty = (deal) => {
  if (deal?.property?.id) return deal.property;
  if (deal?.property_id) {
    return { id: deal.property_id, name: deal.property_name, land_area_sqft: deal.land_area_sqft };
  }
  return null;
};

// Family-aware seed of the editable assumptions. Defaults intentionally MATCH
// the engine's screening defaults so the UI is transparent about what it uses.
function seedAssumptions(family) {
  if (family === 'commercial') return { leasableEfficiencyPct: 80, parkingEcsPer100Sqm: 1.6 };
  if (family === 'industrial') return { leasableEfficiencyPct: 90, parkingEcsPer100Sqm: 0.4 };
  if (family === 'hospitality') return { grossAreaPerKeySqft: 1000, parkingEcsPerKey: 0.5 };
  if (family === 'plotted') return { saleableLandPct: 55, avgPlotSizeSqft: 1200, villaPlotCoveragePct: 50, villaFloors: 2 };
  // residential family
  return {
    loadingFactorPct: 30,
    parkingEcsPerUnit: 1.3,
    mix: DEFAULT_RESIDENTIAL_MIX.map((m) => ({ ...m })),
  };
}

// Map UI assumption state → engine assumptions (with correct units).
function buildEngineAssumptions(family, a) {
  const out = {};
  if (family === 'residential') {
    if (a.loadingFactorPct != null) out.loadingFactor = Number(a.loadingFactorPct) / 100;
    if (numOrUndef(a.parkingEcsPerUnit) != null) out.parkingEcsPerUnit = Number(a.parkingEcsPerUnit);
    if (Array.isArray(a.mix)) out.unitMix = a.mix.map((m) => ({ ...m, share_pct: numOrUndef(m.share_pct) ?? 0 }));
  } else if (family === 'commercial' || family === 'industrial') {
    if (numOrUndef(a.leasableEfficiencyPct) != null) out.leasableEfficiency = Number(a.leasableEfficiencyPct) / 100;
    if (numOrUndef(a.parkingEcsPer100Sqm) != null) out.parkingEcsPer100Sqm = Number(a.parkingEcsPer100Sqm);
  } else if (family === 'hospitality') {
    if (numOrUndef(a.grossAreaPerKeySqft) != null) out.grossAreaPerKeySqft = Number(a.grossAreaPerKeySqft);
    if (numOrUndef(a.parkingEcsPerKey) != null) out.parkingEcsPerKey = Number(a.parkingEcsPerKey);
  } else if (family === 'plotted') {
    if (numOrUndef(a.saleableLandPct) != null) out.saleableLandPct = Number(a.saleableLandPct) / 100;
    if (numOrUndef(a.avgPlotSizeSqft) != null) out.avgPlotSizeSqft = Number(a.avgPlotSizeSqft);
    if (numOrUndef(a.villaPlotCoveragePct) != null) out.villaPlotCoveragePct = Number(a.villaPlotCoveragePct);
    if (numOrUndef(a.villaFloors) != null) out.villaFloors = Number(a.villaFloors);
  }
  return out;
}

// KPI definitions per family, read from a computed yield result.
function kpisFor(family, r) {
  if (!r?.ok) return [];
  const a = r.areaSchedule || {};
  const t = r.totals || {};
  if (family === 'plotted') {
    const isVilla = t.villas != null;
    return [
      { label: isVilla ? 'Villas' : 'Plots', value: isVilla ? t.villas : t.plots, fmt: fmtInt },
      { label: 'Saleable plot area', value: a.saleable_plot_area_sqft, unit: 'sqft', fmt: fmtInt },
      { label: 'Avg plot', value: a.avg_plot_sqft, unit: 'sqft', fmt: fmtInt },
      isVilla
        ? { label: 'Total villa BUA', value: a.total_villa_bua_sqft, unit: 'sqft', fmt: fmtInt }
        : { label: 'Saleable land', value: a.saleable_land_pct, unit: '%', fmt: (n) => `${Math.round(n)}` },
    ];
  }
  if (family === 'hospitality') {
    return [
      { label: 'Realized GFA', value: a.gfa_sqft, unit: 'sqft', fmt: fmtInt },
      { label: 'Keys', value: t.keys, fmt: fmtInt },
      { label: 'Net saleable', value: a.net_saleable_sqft, unit: 'sqft', fmt: fmtInt },
      { label: 'Parking', value: r.parking?.required_ecs, unit: 'ECS', fmt: fmtInt },
    ];
  }
  if (family === 'commercial' || family === 'industrial') {
    return [
      { label: 'Realized GFA', value: a.gfa_sqft, unit: 'sqft', fmt: fmtInt },
      { label: 'Leasable', value: a.leasable_sqft, unit: 'sqft', fmt: fmtInt },
      { label: 'Floors', value: r.envelope?.floors, fmt: fmtInt },
      { label: 'Parking', value: r.parking?.required_ecs, unit: 'ECS', fmt: fmtInt },
    ];
  }
  // residential
  return [
    { label: 'Realized GFA', value: a.gfa_sqft, unit: 'sqft', fmt: fmtInt },
    { label: 'Units', value: t.units, fmt: fmtInt },
    { label: 'Saleable (SBA)', value: a.saleable_sqft, unit: 'sqft', fmt: fmtInt },
    { label: 'Parking', value: r.parking?.required_ecs, unit: 'ECS', fmt: fmtInt },
  ];
}

export default function SiteIntelligenceTab({ setTab }) {
  const { dealId } = useDealContext();
  const deal = useDealRecord();
  const assetClass = deal?.asset_class || '';
  const family = resolveFamily(assetClass);

  const propertyStub = resolveLinkedProperty(deal);
  const { data: hydratedProperty, isLoading: propertyLoading } = useProperty(propertyStub?.id);
  const property = hydratedProperty ? { ...propertyStub, ...hydratedProperty } : propertyStub;

  // Editable envelope (sourced from the parcel, every field overridable).
  const [env, setEnv] = useState({ landAreaSqft: '', effectiveFsi: '', groundCoveragePct: '', allowedHeightM: '' });
  const [assumptions, setAssumptions] = useState(() => seedAssumptions(family));
  const seededRef = useRef(false);

  // Seed the envelope from the parcel once it hydrates (don't clobber edits).
  useEffect(() => {
    if (!property || seededRef.current) return;
    seededRef.current = true;
    setEnv((e) => ({
      ...e,
      landAreaSqft: e.landAreaSqft || (property.land_area_sqft ?? ''),
      effectiveFsi: e.effectiveFsi || (property.permissible_fsi ?? ''),
    }));
  }, [property]);

  // Re-seed assumptions when the asset-class family changes.
  useEffect(() => { setAssumptions(seedAssumptions(family)); }, [family]);

  const engineEnvelope = useMemo(() => ({
    landAreaSqft: numOrUndef(env.landAreaSqft),
    effectiveFsi: numOrUndef(env.effectiveFsi),
    groundCoveragePct: numOrUndef(env.groundCoveragePct),
    allowedHeightM: numOrUndef(env.allowedHeightM),
  }), [env]);

  const result = useMemo(
    () => computeSiteYield({ assetClass, envelope: engineEnvelope, assumptions: buildEngineAssumptions(family, assumptions) }),
    [assetClass, family, engineEnvelope, assumptions],
  );

  // Massing values (built-form only; needs ground coverage to draw).
  const massingValues = useMemo(() => {
    if (!result.ok || family === 'plotted') return null;
    return {
      ground_coverage_pct: numOrUndef(env.groundCoveragePct),
      max_far: result.envelope?.effective_fsi ?? numOrUndef(env.effectiveFsi),
      max_buildable_area_sqft: result.envelope?.realized_gfa_sqft,
    };
  }, [result, family, env.groundCoveragePct, env.effectiveFsi]);

  const kpis = kpisFor(family, result);

  const applyToFinancials = () => {
    if (!result.ok) return;
    const payload = mapProgrammeToInputs({ assetClass, programme: result.programme, buildability: result.buildability });
    if (!payload) { toast.error('Nothing to apply yet — complete the inputs first.'); return; }
    stashPrefill(dealId, payload);
    toast.success('Programme sent to the Financial Engine as editable assumptions.');
    if (setTab) setTab('financial');
  };

  // ── empty / guard states ────────────────────────────────────────────────
  if (!property?.id) {
    return (
      <ErrorState
        title="Link a property first"
        tone="info"
        action={setTab ? (
          <button
            type="button"
            onClick={() => setTab('parcel')}
            className="rounded-editorial bg-accent px-3 py-2 text-xs font-semibold text-content-inverse"
          >
            Open Parcel
          </button>
        ) : null}
      >
        Site Intelligence turns a parcel + zoning into a screening development programme — link a
        property so its land area and FSI can seed the study.
      </ErrorState>
    );
  }

  if (propertyStub?.id && propertyLoading && !hydratedProperty) {
    return (
      <div className="space-y-5" role="status" aria-busy="true" aria-label="Loading site intelligence">
        <Skeleton className="h-24 w-full rounded-editorial border border-hairline" />
        <Skeleton className="h-72 w-full rounded-editorial border border-hairline" />
      </div>
    );
  }

  const bindingTone = result.ok && result.bindingConstraint === 'coverage_height' && result.unrealizedFarPct > 0
    ? 'warn' : 'info';

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Site Intelligence"
        title={`Screening yield${assetClass ? ` · ${ASSET_CLASS_LABELS[assetClass] || assetClass}` : ''}`}
        sub="Deterministic buildable-area, programme and parking from the regulatory envelope and editable assumptions. Numbers are screening estimates — not a surveyed or sanctioned plan."
        action={(
          <Button
            variant="primary"
            rightIcon={<ArrowRight size={14} />}
            onClick={applyToFinancials}
            disabled={!result.ok}
            title={result.ok ? 'Send the programme into the Financial Engine' : 'Complete the inputs to enable'}
          >
            Apply to Financials
          </Button>
        )}
      />

      {!assetClass && (
        <ErrorState tone="info" title="No asset class set">
          This deal has no asset class yet, so a residential screening is shown. Set the deal’s asset
          class (Edit deal) for class-specific yield logic.
        </ErrorState>
      )}

      {/* Decision cockpit — count-up KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k, i) => (
          <MetricTile
            key={k.label}
            label={k.label}
            value={Number.isFinite(k.value) ? k.value : '—'}
            unit={k.value != null && Number.isFinite(k.value) ? k.unit : undefined}
            format={Number.isFinite(k.value) ? k.fmt : undefined}
            interactive={i === 0}
          />
        ))}
      </div>

      {!result.ok && (
        <ErrorState tone="warn" title="More inputs needed">
          {result.message || 'Enter a plot area and an FSI (or ground coverage + height) to compute yield.'}
        </ErrorState>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left — editable inputs */}
        <div className="lg:col-span-2 space-y-5">
          <Card className="p-5">
            <SectionHeader size="sm" icon={Ruler} title="Envelope" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Plot area (sqft)">
                <Input type="number" inputMode="decimal" value={env.landAreaSqft}
                  onChange={(e) => setEnv((s) => ({ ...s, landAreaSqft: e.target.value }))} placeholder="e.g. 43560" />
              </Field>
              {family !== 'plotted' && (
                <Field label="Effective FSI">
                  <Input type="number" inputMode="decimal" step="0.05" value={env.effectiveFsi}
                    onChange={(e) => setEnv((s) => ({ ...s, effectiveFsi: e.target.value }))} placeholder="e.g. 2.5" />
                </Field>
              )}
              {family !== 'plotted' && (
                <Field label="Ground coverage (%)">
                  <Input type="number" inputMode="decimal" value={env.groundCoveragePct}
                    onChange={(e) => setEnv((s) => ({ ...s, groundCoveragePct: e.target.value }))} placeholder="optional" />
                </Field>
              )}
              {family !== 'plotted' && (
                <Field label="Allowed height (m)">
                  <Input type="number" inputMode="decimal" value={env.allowedHeightM}
                    onChange={(e) => setEnv((s) => ({ ...s, allowedHeightM: e.target.value }))} placeholder="optional" />
                </Field>
              )}
            </div>
            <p className="mt-3 text-[11px] text-content-muted">
              Seeded from the linked parcel where available — every value is editable. Coverage +
              height let the engine test whether ground coverage, not FAR, is the binding limit.
            </p>
          </Card>

          <Card className="p-5">
            <SectionHeader size="sm" icon={SlidersHorizontal} title="Assumptions" />
            <AssumptionsEditor family={family} assumptions={assumptions} setAssumptions={setAssumptions} />
            <p className="mt-3 text-[11px] text-content-muted">
              Screening defaults — directional, not statutory. Parking norms in particular vary by
              RMP 2015 zone; verify before quoting.
            </p>
          </Card>
        </div>

        {/* Right — massing + area schedule */}
        <div className="lg:col-span-3 space-y-5">
          <Card className="p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <SectionHeader size="sm" icon={Building2} title="Massing & binding constraint" className="mb-0" />
              {result.ok && (
                <Badge tone={bindingTone === 'warn' ? 'warn' : 'info'}>
                  Binds on {BINDING_LABEL[result.bindingConstraint] || result.bindingConstraint}
                </Badge>
              )}
            </div>

            {family === 'plotted' ? (
              <PlottedSummary result={result} />
            ) : massingValues && result.ok ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                <BuildabilityMassing values={massingValues} landAreaSqft={result.envelope?.land_sqft} />
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label="FAR-permitted GFA" value={`${fmtInt(result.envelope?.far_gfa_sqft)} sqft`} />
                  <StatTile label="Realized GFA" value={`${fmtInt(result.envelope?.realized_gfa_sqft)} sqft`} />
                  <StatTile label="Footprint cap" value={result.envelope?.footprint_cap_sqft != null ? `${fmtInt(result.envelope.footprint_cap_sqft)} sqft` : '—'} />
                  <StatTile label="Floors" value={result.envelope?.floors != null ? fmtInt(result.envelope.floors) : '—'} />
                </div>
              </div>
            ) : (
              <div className="rounded-editorial border border-dashed border-hairline-strong p-6 text-center">
                <Maximize2 size={18} className="mx-auto text-content-muted mb-2" />
                <p className="text-sm text-content-secondary">
                  Add a ground-coverage % to render the massing envelope.
                </p>
              </div>
            )}

            {result.ok && result.unrealizedFarPct > 0 && (
              <p className="mt-3 text-xs text-data-negative tabular-nums">
                {result.unrealizedFarPct}% of permitted FAR is unrealised at this height — coverage × floors caps the build.
              </p>
            )}
          </Card>

          <Card className="p-5">
            <SectionHeader size="sm" icon={Layers} title="Area schedule" />
            <AreaSchedule result={result} family={family} />
          </Card>

          {result.ok && (
            <Card className="p-5">
              <SectionHeader size="sm" icon={Car} title="Parking" />
              <div className="flex items-baseline gap-3">
                <span className="font-display text-2xl font-semibold text-content-primary tabular-nums">
                  {result.parking?.required_ecs != null ? fmtInt(result.parking.required_ecs) : '—'}
                </span>
                <span className="text-sm text-content-muted">{result.parking?.required_ecs != null ? 'ECS required' : ''}</span>
                {result.parking?.norm && (
                  <Badge tone="neutral">{result.parking.norm}{result.parking.basis === 'assumption' ? ' · custom' : ''}</Badge>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Warnings + disclaimer */}
      {result.warnings?.length > 0 && (
        <ErrorState tone="warn" title="Worth checking">
          <ul className="list-disc pl-4 space-y-1">
            {result.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </ErrorState>
      )}
      {result.disclaimer && (
        <p className="text-[11px] leading-relaxed text-content-muted">{result.disclaimer}</p>
      )}
    </div>
  );
}

// ── sub-components ───────────────────────────────────────────────────────────

function AssumptionsEditor({ family, assumptions, setAssumptions }) {
  const set = (key, value) => setAssumptions((a) => ({ ...a, [key]: value }));
  const setMixShare = (idx, value) => setAssumptions((a) => ({
    ...a,
    mix: a.mix.map((m, i) => (i === idx ? { ...m, share_pct: value } : m)),
  }));

  if (family === 'plotted') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Saleable land (%)">
          <Input type="number" value={assumptions.saleableLandPct ?? ''} onChange={(e) => set('saleableLandPct', e.target.value)} />
        </Field>
        <Field label="Avg plot (sqft)">
          <Input type="number" value={assumptions.avgPlotSizeSqft ?? ''} onChange={(e) => set('avgPlotSizeSqft', e.target.value)} />
        </Field>
        <Field label="Villa coverage (%)">
          <Input type="number" value={assumptions.villaPlotCoveragePct ?? ''} onChange={(e) => set('villaPlotCoveragePct', e.target.value)} />
        </Field>
        <Field label="Villa floors">
          <Input type="number" value={assumptions.villaFloors ?? ''} onChange={(e) => set('villaFloors', e.target.value)} />
        </Field>
      </div>
    );
  }
  if (family === 'hospitality') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Gross area / key (sqft)">
          <Input type="number" value={assumptions.grossAreaPerKeySqft ?? ''} onChange={(e) => set('grossAreaPerKeySqft', e.target.value)} />
        </Field>
        <Field label="Parking / key (ECS)">
          <Input type="number" step="0.1" value={assumptions.parkingEcsPerKey ?? ''} onChange={(e) => set('parkingEcsPerKey', e.target.value)} />
        </Field>
      </div>
    );
  }
  if (family === 'commercial' || family === 'industrial') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Leasable efficiency (%)">
          <Input type="number" value={assumptions.leasableEfficiencyPct ?? ''} onChange={(e) => set('leasableEfficiencyPct', e.target.value)} />
        </Field>
        <Field label="Parking / 100 sqm (ECS)">
          <Input type="number" step="0.1" value={assumptions.parkingEcsPer100Sqm ?? ''} onChange={(e) => set('parkingEcsPer100Sqm', e.target.value)} />
        </Field>
      </div>
    );
  }
  // residential
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Loading factor (%)">
          <Input type="number" value={assumptions.loadingFactorPct ?? ''} onChange={(e) => set('loadingFactorPct', e.target.value)} />
        </Field>
        <Field label="Parking / unit (ECS)">
          <Input type="number" step="0.1" value={assumptions.parkingEcsPerUnit ?? ''} onChange={(e) => set('parkingEcsPerUnit', e.target.value)} />
        </Field>
      </div>
      <div>
        <p className="text-xs text-content-muted mb-1.5">Unit mix (share %)</p>
        <div className="grid grid-cols-3 gap-2">
          {(assumptions.mix || []).map((m, i) => (
            <Field key={m.key} label={`${m.label} · ${m.carpet_sqft} sf`}>
              <Input type="number" value={m.share_pct ?? ''} onChange={(e) => setMixShare(i, e.target.value)} />
            </Field>
          ))}
        </div>
      </div>
    </div>
  );
}

function AreaSchedule({ result, family }) {
  if (!result.ok) return <p className="text-sm text-content-muted">—</p>;
  const a = result.areaSchedule || {};
  const rows = [];
  const push = (label, value, unit = 'sqft') => {
    if (value == null || !Number.isFinite(value)) return;
    rows.push({ label, value: `${fmtInt(value)}${unit ? ` ${unit}` : ''}` });
  };
  if (family === 'plotted') {
    push('Land', a.land_sqft);
    push('Saleable plot area', a.saleable_plot_area_sqft);
    push('Avg plot', a.avg_plot_sqft);
    push('Per-villa BUA', a.per_villa_bua_sqft);
    push('Total villa BUA', a.total_villa_bua_sqft);
  } else if (family === 'hospitality') {
    push('Realized GFA', a.gfa_sqft);
    push('Net saleable', a.net_saleable_sqft);
    push('Gross area / key', a.gross_area_per_key_sqft);
  } else if (family === 'commercial' || family === 'industrial') {
    push('Realized GFA', a.gfa_sqft);
    push('Leasable', a.leasable_sqft);
    if (a.leasable_efficiency_pct != null) rows.push({ label: 'Leasable efficiency', value: `${a.leasable_efficiency_pct}%` });
  } else {
    push('Realized GFA', a.gfa_sqft);
    push('Carpet pool', a.carpet_sqft);
    push('Saleable (SBA)', a.saleable_sqft);
    if (a.loading_factor_pct != null) rows.push({ label: 'Loading factor', value: `${a.loading_factor_pct}%` });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {rows.map((r) => <StatTile key={r.label} label={r.label} value={r.value} />)}
      </div>
      {Array.isArray(result.unitMix) && result.unitMix.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-content-muted">
              <th className="font-medium py-1.5">Type</th>
              <th className="font-medium py-1.5 text-right tabular-nums">Units</th>
              <th className="font-medium py-1.5 text-right tabular-nums">Carpet (sqft)</th>
            </tr>
          </thead>
          <tbody>
            {result.unitMix.map((u) => (
              <tr key={u.key} className="border-t border-hairline-soft">
                <td className="py-1.5 text-content-secondary">{u.label}</td>
                <td className="py-1.5 text-right tabular-nums text-content-primary">{fmtInt(u.count)}</td>
                <td className="py-1.5 text-right tabular-nums text-content-secondary">{fmtInt(u.carpet_total_sqft)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PlottedSummary({ result }) {
  if (!result.ok) {
    return <p className="text-sm text-content-muted">Enter a plot area to compute the subdivision.</p>;
  }
  const a = result.areaSchedule || {};
  const t = result.totals || {};
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <StatTile label={t.villas != null ? 'Villas' : 'Plots'} value={fmtInt(t.villas != null ? t.villas : t.plots)} />
      <StatTile label="Saleable plot area" value={`${fmtInt(a.saleable_plot_area_sqft)} sqft`} />
      <StatTile label="Saleable land" value={`${a.saleable_land_pct}%`} />
      <StatTile label="Avg plot" value={`${fmtInt(a.avg_plot_sqft)} sqft`} />
      {a.per_villa_bua_sqft != null && <StatTile label="Per-villa BUA" value={`${fmtInt(a.per_villa_bua_sqft)} sqft`} />}
      {a.total_villa_bua_sqft != null && <StatTile label="Total villa BUA" value={`${fmtInt(a.total_villa_bua_sqft)} sqft`} />}
    </div>
  );
}
