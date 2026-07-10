import { useState, useMemo, useEffect, useRef } from 'react';
import { Building2, Ruler, Car, Layers, ArrowRight, SlidersHorizontal, Maximize2, GitCompare, Shapes, RotateCcw } from 'lucide-react';
import {
  Card, SectionHeader, MetricTile, StatTile, ErrorState, Button, Field, Input, Skeleton,
} from '../../design-system';
import Badge from '../common/Badge';
import { toast } from '../common/Toast';
import { useDealContext, useDealRecord } from '../../hooks/useDealContext';
import { useCanEdit } from '../../hooks/useCanEdit';
import { useProperty, useParcelIntelligence } from '../../hooks/useProperties';
import { computeSiteYield, resolveFamily, DEFAULT_RESIDENTIAL_MIX } from '../../utils/siteYield';
import { numOrUndef, buildEngineAssumptions } from '../../utils/yieldStudioInputs';
import { mapProgrammeToInputs, stashPrefill } from '../../utils/programmeToInputs';
import { geojsonAreaSqft, polygonOutlineForSvg, reconcileArea } from '../../utils/geoArea';
import { loadYieldStudy, saveYieldStudy, clearYieldStudy } from '../../utils/yieldStudioStore';
import { useYieldStudy, useSaveYieldStudy, useParcelBoundary } from '../../hooks/useYieldStudio';
import { ASSET_CLASS_LABELS } from '../../utils/assetClasses';
import BuildabilityMassing from './BuildabilityMassing';
import BoundaryUploadButton from './BoundaryUploadButton';

// ── formatters ──────────────────────────────────────────────────────────────
const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-IN') : '—');

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

// Headline yield metric per family for a scenario card.
function primaryYield(family, r) {
  if (!r?.ok) return { label: '—', value: null };
  const t = r.totals || {};
  const a = r.areaSchedule || {};
  if (family === 'plotted') {
    const isVilla = t.villas != null;
    return { label: isVilla ? 'Villas' : 'Plots', value: isVilla ? t.villas : t.plots };
  }
  if (family === 'hospitality') return { label: 'Keys', value: t.keys };
  if (family === 'commercial' || family === 'industrial') return { label: 'Leasable', value: a.leasable_sqft, unit: 'sqft' };
  return { label: 'Units', value: t.units };
}

// Build a 3-point deterministic sensitivity band by flexing the single
// highest-leverage lever. Built form → FSI ×0.9/1.0/1.15; plotted → saleable
// land % ±5 pts. Each point is a full engine run; nothing is interpolated.
function buildScenarios({ assetClass, family, engineEnvelope, engineAssumptions }) {
  const run = (envOverride, asmOverride) => computeSiteYield({
    assetClass,
    envelope: { ...engineEnvelope, ...envOverride },
    assumptions: { ...engineAssumptions, ...asmOverride },
  });

  if (family === 'plotted') {
    const base = engineAssumptions.saleableLandPct != null ? engineAssumptions.saleableLandPct : 0.55;
    return [
      { key: 'cons', label: 'Conservative', d: -0.05 },
      { key: 'base', label: 'Base', d: 0 },
      { key: 'opt', label: 'Optimized', d: 0.05 },
    ].map((v) => {
      const pct = Math.max(0.4, Math.min(0.7, Math.round((base + v.d) * 100) / 100));
      return { key: v.key, label: v.label, isBase: v.key === 'base', note: `${Math.round(pct * 100)}% saleable`, result: run({}, { saleableLandPct: pct }) };
    });
  }

  const baseFsi = engineEnvelope.effectiveFsi;
  if (!baseFsi) return null;
  return [
    { key: 'cons', label: 'Conservative', m: 0.9 },
    { key: 'base', label: 'Base', m: 1.0 },
    { key: 'opt', label: 'Optimized', m: 1.15 },
  ].map((v) => {
    const fsi = Math.round(baseFsi * v.m * 100) / 100;
    return { key: v.key, label: v.label, isBase: v.key === 'base', note: `FSI ${fsi.toFixed(2)}`, result: run({ effectiveFsi: fsi }, {}) };
  });
}

export default function YieldStudioTab({ setTab }) {
  const { dealId } = useDealContext();
  const deal = useDealRecord();
  const assetClass = deal?.asset_class || '';
  const family = resolveFamily(assetClass);

  const propertyStub = resolveLinkedProperty(deal);
  const { data: hydratedProperty, isLoading: propertyLoading } = useProperty(propertyStub?.id);
  const property = hydratedProperty ? { ...propertyStub, ...hydratedProperty } : propertyStub;

  // Restore a saved study (env + assumptions) for this deal if one exists — the
  // analyst's working scratch survives reloads/revisits. Falls back to
  // parcel-seeded defaults.
  const savedStudy = useMemo(() => loadYieldStudy(dealId), [dealId]);
  const [env, setEnv] = useState(
    () => savedStudy?.env || { landAreaSqft: '', effectiveFsi: '', groundCoveragePct: '', allowedHeightM: '' },
  );
  const [assumptions, setAssumptions] = useState(() => savedStudy?.assumptions || seedAssumptions(family));
  const seededRef = useRef(!!savedStudy?.env); // a restored study already carries its envelope
  const familyRef = useRef(family);

  // Server is the source of truth (cross-device / team); the localStorage cache
  // above gives an instant first paint. Once the server query settles we
  // hydrate from it (it wins) and then debounce-save edits back up.
  const { data: serverStudy, isSuccess: studyLoaded, isError: studyLoadError, refetch: refetchStudy } = useYieldStudy(dealId);
  const serverHydratedRef = useRef(false);
  const serverSaveTimer = useRef(null);
  const saveStudyMut = useSaveYieldStudy();
  const canEdit = useCanEdit();
  // Change-gating for the server autosave. `lastSyncedRef` holds the serialized
  // study as of the post-hydrate baseline / last dispatched save; the persist
  // effect only schedules a PUT when the serialized study DIFFERS. Without
  // this, the hydrate's own setState re-ran the effect and every tab OPEN
  // fired a phantom save — a row swap + a bogus `yield_study_saved` event in
  // the immutable deal audit trail per visit (and a 403 toast for viewers).
  const lastSyncedRef = useRef(null);
  const latestStudyRef = useRef(null);
  // 'idle' | 'pending' (debounce armed) | 'saving' | 'saved' | 'error' — drives
  // the quiet sync chip in the header so the analyst always knows whether the
  // study is on the server or only on this device.
  const [syncState, setSyncState] = useState('idle');

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

  // Re-seed assumptions only when the asset-class family ACTUALLY changes — not
  // on mount, which would clobber a restored study.
  useEffect(() => {
    if (familyRef.current === family) return;
    familyRef.current = family;
    setAssumptions(seedAssumptions(family));
  }, [family]);

  // Hydrate from the server once its query settles — the server row wins over
  // the local cache. When no server study exists yet, still flip the flag so
  // saving is enabled for a brand-new study.
  useEffect(() => {
    if (serverHydratedRef.current || !studyLoaded) return;
    serverHydratedRef.current = true;
    if (serverStudy?.envelope) setEnv((e) => ({ ...e, ...serverStudy.envelope }));
    if (serverStudy?.assumptions) setAssumptions(serverStudy.assumptions);
    if (serverStudy) seededRef.current = true; // server row carries the envelope
  }, [studyLoaded, serverStudy]);

  // Persist: localStorage instantly (fast cache) + the server debounced (source
  // of truth). Don't push to the server before the first hydrate, or the seed
  // would overwrite a just-loaded server row. The study is stored UI-shaped
  // (env + assumptions) for an exact cross-device editor restore.
  //
  // Server saves are CHANGE-GATED: the first post-hydrate run only records the
  // baseline; a PUT is scheduled only when the serialized study differs from
  // the last synced snapshot, and only for editors (viewers keep the local
  // scratch but must never trigger a 403 write).
  useEffect(() => {
    if (dealId) saveYieldStudy(dealId, { env, assumptions });
    if (!dealId || !serverHydratedRef.current || !canEdit) return undefined;
    const serialized = JSON.stringify({ env, assumptions, assetClass });
    latestStudyRef.current = {
      serialized,
      payload: {
        dealId,
        envelope: env,
        assumptions,
        asset_class: assetClass,
        selected_scenario: 'base',
        engine_version: 'siteYield@1',
      },
    };
    if (lastSyncedRef.current === null) {
      // First run after hydrate — this IS the server (or brand-new) state.
      // Record it as the baseline; opening the tab is not an edit.
      lastSyncedRef.current = serialized;
      return undefined;
    }
    if (serialized === lastSyncedRef.current) return undefined;
    clearTimeout(serverSaveTimer.current);
    setSyncState('pending');
    serverSaveTimer.current = setTimeout(() => {
      serverSaveTimer.current = null;
      lastSyncedRef.current = serialized;
      setSyncState('saving');
      saveStudyMut.mutate(latestStudyRef.current.payload, {
        onSuccess: () => setSyncState('saved'),
        onError: () => setSyncState('error'),
      });
    }, 700);
    return () => clearTimeout(serverSaveTimer.current);
    // saveStudyMut is stable from react-query; excluded to avoid resubscribing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, env, assumptions, assetClass, canEdit]);

  // Flush a still-debouncing edit on unmount instead of dropping it — an edit
  // made <700ms before navigating away must still reach the server. (The
  // timeout id stays truthy after clearTimeout, so this works regardless of
  // cleanup ordering across effects.)
  useEffect(() => () => {
    if (!serverSaveTimer.current || !latestStudyRef.current) return;
    clearTimeout(serverSaveTimer.current);
    const { serialized, payload } = latestStudyRef.current;
    if (serialized !== lastSyncedRef.current) {
      lastSyncedRef.current = serialized;
      saveStudyMut.mutate(payload);
    }
    // saveStudyMut is stable; unmount-only cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const engineEnvelope = useMemo(() => ({
    landAreaSqft: numOrUndef(env.landAreaSqft),
    effectiveFsi: numOrUndef(env.effectiveFsi),
    groundCoveragePct: numOrUndef(env.groundCoveragePct),
    allowedHeightM: numOrUndef(env.allowedHeightM),
  }), [env]);

  const engineAssumptions = useMemo(() => buildEngineAssumptions(family, assumptions), [family, assumptions]);

  const result = useMemo(
    () => computeSiteYield({ assetClass, envelope: engineEnvelope, assumptions: engineAssumptions }),
    [assetClass, family, engineEnvelope, engineAssumptions],
  );

  // Deterministic scenario band — flex the single highest-leverage lever (FSI for
  // built form, saleable-land % for plotted) ±, holding everything else equal. A
  // sensitivity view, not a claim of extra entitlement (the caption says so).
  const scenarios = useMemo(
    () => (result.ok ? buildScenarios({ assetClass, family, engineEnvelope, engineAssumptions }) : null),
    [result.ok, assetClass, family, engineEnvelope, engineAssumptions],
  );

  // Parcel boundary from the K-GIS cadastral record — the real shape + a true
  // geodesic area to reconcile against the typed plot area. Read-only; no new
  // persistence (uploads + storage land with the parcel_geometries migration).
  const { data: parcelIntel } = useParcelIntelligence(property?.id);
  // An analyst-uploaded boundary (their own survey/file) takes precedence over
  // the community K-GIS reference; fall back to K-GIS when none is uploaded.
  const { data: uploadedBoundary } = useParcelBoundary(property?.id);
  const boundaryGeojson = uploadedBoundary?.geometry_geojson || parcelIntel?.kgis?.geometry_geojson || null;
  const boundarySource = uploadedBoundary ? 'uploaded' : (parcelIntel?.kgis?.geometry_geojson ? 'kgis' : null);
  const boundaryAreaSqft = useMemo(() => geojsonAreaSqft(boundaryGeojson), [boundaryGeojson]);
  const boundaryOutline = useMemo(() => polygonOutlineForSvg(boundaryGeojson, { size: 220, pad: 12 }), [boundaryGeojson]);
  const reconciliation = useMemo(
    () => reconcileArea(numOrUndef(env.landAreaSqft), boundaryAreaSqft),
    [env.landAreaSqft, boundaryAreaSqft],
  );
  const boundarySeededRef = useRef(false);
  // If the parcel has no stored land area but K-GIS gives a boundary, seed the
  // plot area from the boundary's geodesic area (once; never clobbers edits).
  useEffect(() => {
    if (boundarySeededRef.current || !boundaryAreaSqft) return;
    boundarySeededRef.current = true;
    setEnv((e) => (e.landAreaSqft ? e : { ...e, landAreaSqft: String(boundaryAreaSqft) }));
  }, [boundaryAreaSqft]);

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

  // Discard the saved study and re-seed from the parcel + family defaults.
  const resetStudy = () => {
    clearYieldStudy(dealId);
    boundarySeededRef.current = false;
    familyRef.current = family;
    setEnv({
      // Fall back to the K-GIS boundary area when the parcel has no stored land
      // area — mirrors the mount-time boundary seed, so Reset never leaves a
      // boundary-only parcel with an empty plot area.
      landAreaSqft: property?.land_area_sqft ?? (boundaryAreaSqft != null ? String(boundaryAreaSqft) : ''),
      effectiveFsi: property?.permissible_fsi ?? '',
      groundCoveragePct: '',
      allowedHeightM: '',
    });
    setAssumptions(seedAssumptions(family));
    toast.success('Reset to parcel defaults.');
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
        Yield Studio turns a parcel + zoning into a screening development programme — link a
        property so its land area and FSI can seed the study.
      </ErrorState>
    );
  }

  if (propertyStub?.id && propertyLoading && !hydratedProperty) {
    return (
      <div className="space-y-5" role="status" aria-busy="true" aria-label="Loading Yield Studio">
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
        eyebrow="Yield Studio"
        title={`Screening yield${assetClass ? ` · ${ASSET_CLASS_LABELS[assetClass] || assetClass}` : ''}`}
        sub="Deterministic buildable-area, programme and parking from the regulatory envelope and editable assumptions. Numbers are screening estimates — not a surveyed or sanctioned plan."
        action={(
          <div className="flex items-center gap-2">
            {/* Quiet sync status — the analyst should always know whether the
                study lives on the server or only on this device. */}
            {canEdit && syncState !== 'idle' && (
              syncState === 'error' ? (
                <button
                  type="button"
                  onClick={() => {
                    lastSyncedRef.current = '';
                    setEnv((e) => ({ ...e }));
                  }}
                  className="text-[11px] font-medium text-premium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1"
                  title="The last save didn't reach the server — edits are on this device only. Click to retry."
                >
                  Not synced — retry
                </button>
              ) : (
                <span className="text-[11px] text-content-muted tabular-nums" role="status">
                  {syncState === 'saved' ? 'Saved' : 'Saving…'}
                </span>
              )
            )}
            <Button
              variant="ghost"
              leftIcon={<RotateCcw size={14} />}
              onClick={resetStudy}
              title="Discard edits and re-seed from the parcel"
            >
              Reset
            </Button>
            <Button
              variant="primary"
              rightIcon={<ArrowRight size={14} />}
              onClick={applyToFinancials}
              disabled={!result.ok}
              title={result.ok ? 'Send the programme into the Financial Engine' : 'Complete the inputs to enable'}
            >
              Apply to Financials
            </Button>
          </div>
        )}
      />

      {studyLoadError && (
        <ErrorState
          tone="warn"
          title="Couldn't reach the server"
          action={(
            <Button variant="secondary" size="sm" onClick={() => refetchStudy()}>
              Retry
            </Button>
          )}
        >
          Your edits are being kept on this device only until the connection recovers — a saved
          study from another device may exist that isn't shown here.
        </ErrorState>
      )}

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

        {/* Right — boundary + massing + area schedule */}
        <div className="lg:col-span-3 space-y-5">
          <BoundaryCard
            outline={boundaryOutline}
            areaSqft={boundaryAreaSqft}
            source={boundarySource}
            reconciliation={reconciliation}
            onAdopt={boundaryAreaSqft ? () => setEnv((e) => ({ ...e, landAreaSqft: String(boundaryAreaSqft) })) : null}
            uploadButton={<BoundaryUploadButton propertyId={property.id} dealId={dealId} />}
          />
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

      {/* Scenario band — deterministic sensitivity on the key lever */}
      {scenarios && scenarios.length > 1 && (
        <Card className="p-5">
          <SectionHeader
            size="sm"
            icon={GitCompare}
            title="Scenario comparison"
            sub={family === 'plotted'
              ? 'Layout-efficiency sensitivity — saleable-land % flexed ±5 pts. Verify against layout/open-space norms.'
              : 'FSI sensitivity — your entered FSI flexed ±. Confirm the achievable FSI (incl. any TDR/premium) against the FAR rule before relying on the upside.'}
          />
          <ScenarioStrip scenarios={scenarios} family={family} />
        </Card>
      )}

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

const BOUNDARY_SOURCE_LABEL = { uploaded: 'Uploaded', kgis: 'K-GIS parcel' };

function BoundaryCard({ outline, areaSqft, source, reconciliation, onAdopt, uploadButton }) {
  const sevTone = reconciliation
    ? (reconciliation.severity === 'match' ? 'success' : reconciliation.severity === 'minor' ? 'warn' : 'danger')
    : 'neutral';
  const deltaText = reconciliation
    ? `${Math.abs(reconciliation.deltaPct)}% ${reconciliation.deltaPct >= 0 ? 'above' : 'below'} boundary`
    : null;
  const hasBoundary = !!outline;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <SectionHeader size="sm" icon={Shapes} title="Site boundary" className="mb-0" />
        <div className="flex items-center gap-2 shrink-0">
          {source && <Badge tone={source === 'uploaded' ? 'success' : 'neutral'}>{BOUNDARY_SOURCE_LABEL[source]}</Badge>}
          {uploadButton}
        </div>
      </div>

      {hasBoundary ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
          <div className="flex items-center justify-center rounded-editorial border border-hairline bg-bg-secondary p-3">
            <svg
              viewBox={outline.viewBox}
              className="w-full h-auto max-h-48"
              role="img"
              aria-label={`Parcel boundary outline (${source === 'uploaded' ? 'uploaded file' : 'K-GIS cadastral record'})`}
            >
              <polygon
                points={outline.points}
                className="fill-accent stroke-accent"
                fillOpacity="0.14"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-[11px] text-content-muted">Boundary area (geodesic)</p>
              <p className="font-display text-2xl font-semibold text-content-primary tabular-nums">
                {areaSqft != null ? fmtInt(areaSqft) : '—'}<span className="text-sm text-content-muted"> sqft</span>
              </p>
            </div>
            {deltaText && (
              <Badge tone={sevTone}>
                {reconciliation.severity === 'match' ? 'Matches entered area' : `Entry ${deltaText}`}
              </Badge>
            )}
            {onAdopt && (
              <div>
                <Button variant="secondary" onClick={onAdopt}>Use boundary area</Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-editorial border border-dashed border-hairline-strong p-6 text-center">
          <Shapes size={18} className="mx-auto text-content-muted mb-2" />
          <p className="text-sm text-content-secondary">
            No parcel boundary yet. Upload a <span className="font-medium text-content-primary">.geojson</span> or{' '}
            <span className="font-medium text-content-primary">.kml</span> to ground the study in the real plot shape and area.
          </p>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-content-muted">
        {source === 'uploaded'
          ? 'Outline + area from your uploaded file. Verify against a registered survey before relying on it.'
          : 'Real parcel shape + area from the K-GIS cadastral record — a reference source. Verify against a registered survey before relying on it.'}
      </p>
    </Card>
  );
}

function ScenarioStrip({ scenarios, family }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {scenarios.map((s) => {
        const r = s.result;
        const yld = primaryYield(family, r);
        const gfa = family === 'plotted' ? r.areaSchedule?.saleable_plot_area_sqft : r.envelope?.realized_gfa_sqft;
        const gfaLabel = family === 'plotted' ? 'Saleable plot area' : 'Realized GFA';
        return (
          <div
            key={s.key}
            className={`rounded-editorial border p-4 transition-colors duration-150 ${
              s.isBase ? 'border-accent bg-accent-soft' : 'border-hairline bg-bg-secondary'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-sm font-semibold text-content-primary">{s.label}</span>
              {s.isBase && <Badge tone="info">Current</Badge>}
            </div>
            <p className="text-[11px] text-content-muted mb-3 tabular-nums">{s.note}</p>
            {r.ok ? (
              <div className="space-y-2">
                <div>
                  <p className="text-[11px] text-content-muted">{yld.label}</p>
                  <p className="font-display text-xl font-semibold text-content-primary tabular-nums">
                    {fmtInt(yld.value)}{yld.unit ? ` ${yld.unit}` : ''}
                  </p>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-content-muted">{gfaLabel}</span>
                  <span className="tabular-nums text-content-secondary">{fmtInt(gfa)} sqft</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-content-muted">Binds on</span>
                  <span className="text-content-secondary">{BINDING_LABEL[r.bindingConstraint] || r.bindingConstraint}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-content-muted">Insufficient inputs</p>
            )}
          </div>
        );
      })}
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
