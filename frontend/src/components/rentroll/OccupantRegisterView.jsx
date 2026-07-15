import { lazy, Suspense, useMemo, useState } from 'react';
import { Plus, Users, ArrowRight } from 'lucide-react';
import { Card, SectionHeader, MetricTile, Button, Badge, EmptyState, SkeletonList } from '../../design-system';
import {
  useRentRoll, useCreateRecord, useUpdateRecord, useDeleteRecord,
} from '../../hooks/useRentRoll';
import { useFinancials } from '../../hooks/useFinancials';
import { computeOccupantMetrics, computeSaleMetrics, num } from '../../utils/rentRollMetrics';
import { REDEVELOPMENT_PREFILL_CLASSES } from '../../utils/rentRollPrefill';
import RegisterGrid from './RegisterGrid';
import CollectionsGrid from './CollectionsGrid';
import OccupantDrawer from './OccupantDrawer';
import SaleDrawer from './SaleDrawer';
import ApplyToFinancialsModal from './ApplyToFinancialsModal';
import { OCCUPANT_STATUS_CONFIG, OCCUPANT_STATUS_OPTIONS, DOC_RISK_TONE } from './rentRollColumns';
import {
  fmtPct, fmtCr, fmtCrOrL, fmtInt,
  useSettingsAutosave, StaleModelBanner, RegisterSettingsRow, RegisterUnavailable,
} from './registerShared';

const OccupantCharts = lazy(() => import('./OccupantCharts'));

const dash = <span className="text-content-muted">—</span>;
const fmtSqft = (v) => { const n = num(v); return n === null ? dash : `${Math.round(n).toLocaleString('en-IN')}`; };
const fmtRupee = (v) => { const n = num(v); return n === null || n === 0 ? dash : `₹${Math.round(n).toLocaleString('en-IN')}`; };

// Per-row one-time obligation (the transit carry is a portfolio-level forward
// figure shown in the KPI strip, not a per-row cell).
const oneTimeOf = (r) => ['shifting_allowance', 'brokerage_amount', 'corpus_amount', 'other_obligation_amount']
  .reduce((s, k) => { const n = num(r[k]); return s + (n === null ? 0 : n); }, 0);

const upliftOf = (r) => {
  const c = num(r.existing_carpet_area_sqft);
  const e = num(r.rehab_entitlement_sqft);
  return (c !== null && c > 0 && e !== null) ? (e / c - 1) * 100 : null;
};

const OCCUPANT_COLUMNS = [
  {
    key: 'occupant',
    label: 'Occupier',
    render: (r) => (
      <div>
        <div className="text-content-primary font-medium truncate max-w-[11rem]">{r.record_label || r.occupant_name || dash}</div>
        <div className="text-xs text-content-muted truncate max-w-[11rem]">
          {[r.building, r.occupant_name && r.record_label ? r.occupant_name : null, r.occupancy_type].filter(Boolean).join(' · ') || ' '}
        </div>
      </div>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    inlineEdit: { field: 'status', type: 'select', options: OCCUPANT_STATUS_OPTIONS },
    render: (r) => {
      const cfg = OCCUPANT_STATUS_CONFIG[r.status] || OCCUPANT_STATUS_CONFIG.in_place;
      return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
    },
  },
  { key: 'existing_carpet_area_sqft', label: 'Existing (sqft)', align: 'right', render: (r) => fmtSqft(r.existing_carpet_area_sqft) },
  {
    key: 'rehab_entitlement_sqft',
    label: 'Rehab (sqft)',
    align: 'right',
    render: (r) => {
      const e = fmtSqft(r.rehab_entitlement_sqft);
      const u = upliftOf(r);
      return (
        <div>
          <div>{e}</div>
          {u !== null && <div className={`text-xs ${u >= 0 ? 'text-data-positive' : 'text-data-negative'}`}>{u >= 0 ? '+' : ''}{u.toFixed(0)}%</div>}
        </div>
      );
    },
  },
  { key: 'transit_rent_monthly', label: 'Transit ₹/mo', align: 'right', width: '8rem', inlineEdit: { field: 'transit_rent_monthly', type: 'number' }, render: (r) => fmtRupee(r.transit_rent_monthly) },
  { key: 'oneTime', label: 'One-time ₹', align: 'right', render: (r) => { const v = oneTimeOf(r); return v > 0 ? <span className="tabular-nums">₹{Math.round(v).toLocaleString('en-IN')}</span> : dash; } },
  { key: 'documentation_risk', label: 'Doc Risk', align: 'right', render: (r) => (r.documentation_risk ? <Badge tone={DOC_RISK_TONE[r.documentation_risk] || 'neutral'}>{r.documentation_risk}</Badge> : dash) },
];

function OccupantKpiStrip({ metrics }) {
  const v = metrics.vacancy;
  const e = metrics.entitlement;
  const o = metrics.obligations;
  const risk = metrics.risk;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <MetricTile
        label="Vacation Progress"
        value={v.vacatedByCountPct}
        format={v.vacatedByCountPct === null ? undefined : fmtPct}
        tone={v.vacatedByCountPct === null ? 'neutral' : v.vacatedByCountPct >= 90 ? 'up' : 'neutral'}
        footnote={v.vacatedByCountPct === null
          ? 'Add occupiers to track clearance'
          : `${v.vacatedUnits}/${metrics.counts.total} vacated${v.vacatedByAreaPct !== null ? ` · ${v.vacatedByAreaPct.toFixed(0)}% by area` : ''}`}
      />
      <MetricTile
        label="Free Rehab Area"
        value={e.rehabEntitlementSqft > 0 ? e.rehabEntitlementSqft : null}
        format={e.rehabEntitlementSqft > 0 ? (n) => `${fmtInt(n)} sqft` : undefined}
        footnote={e.avgUpliftPct !== null
          ? `Uplift +${e.avgUpliftPct.toFixed(1)}% over existing${e.additionalAreaSqft > 0 ? ` · +${fmtInt(e.additionalAreaSqft)} add’l` : ''}`
          : 'Owed to existing occupiers'}
      />
      <MetricTile
        label="Rehousing Obligation"
        value={o.totalRehousingObligation > 0 ? o.totalRehousingObligation : null}
        format={o.totalRehousingObligation > 0 ? fmtCrOrL : undefined}
        footnote={o.currentMonthlyTransitRent > 0
          ? `Transit ${fmtCrOrL(o.currentMonthlyTransitRent)}/mo run-rate · corpus ${fmtCrOrL(o.corpusTotal)}`
          : o.oneTimeTotal > 0 ? `One-time ${fmtCrOrL(o.oneTimeTotal)}` : 'Forward transit + one-time'}
      />
      <MetricTile
        label="At-risk Occupiers"
        value={risk.atRiskUnits}
        format={fmtInt}
        tone={risk.atRiskUnits > 0 ? 'down' : 'up'}
        footnote={`${risk.disputedUnits} disputed · ${risk.highRiskUnits} high doc-risk`}
      />
    </div>
  );
}

function FreeSaleSummary({ metrics }) {
  const c = metrics.collections;
  const u = metrics.unsold;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
      <MetricTile label="Free-sale GDV (sold)" value={c.soldGDV} format={fmtCr} footnote={`${metrics.inventory.soldUnits}/${metrics.inventory.totalUnits} units`} />
      <MetricTile
        label="Collection Efficiency"
        value={c.collectionEfficiencyPct}
        format={c.collectionEfficiencyPct === null ? undefined : fmtPct}
        tone={c.collectionEfficiencyPct === null ? 'neutral' : c.collectionEfficiencyPct >= 90 ? 'up' : 'neutral'}
        footnote={c.collectionEfficiencyPct === null ? 'No sold units yet' : `${fmtCr(c.collected)} collected`}
      />
      <MetricTile label="Unsold GDV" value={u.unsoldGDV} format={fmtCr} footnote={u.unsoldMtmPct !== null ? `MTM ${u.unsoldMtmPct >= 0 ? '+' : ''}${u.unsoldMtmPct.toFixed(1)}%` : 'Add market rates'} />
    </div>
  );
}

const SEGMENTS = [
  { kind: 'occupant', label: 'Occupants', addLabel: 'Add occupant', noun: 'occupant' },
  { kind: 'sale', label: 'Free-sale', addLabel: 'Add free-sale unit', noun: 'unit' },
];

export default function OccupantRegisterView({ dealId, assetClass, canEdit }) {
  const { data, isLoading } = useRentRoll(dealId);
  const { data: financials } = useFinancials(dealId);
  const createRecord = useCreateRecord();
  const updateRecord = useUpdateRecord();
  const deleteRecord = useDeleteRecord();
  const [segment, setSegment] = useState('occupant');
  const [drawer, setDrawer] = useState(null); // { kind, record }
  const [applyOpen, setApplyOpen] = useState(false);

  const register = data?.register || null;
  const records = data?.records || {};
  const occupants = records.occupant || [];
  const sales = records.sale || [];
  const { form, setForm } = useSettingsAutosave(dealId, register);

  const bridgeSupported = REDEVELOPMENT_PREFILL_CLASSES.has(assetClass);
  const savedProvenance = financials?.model_params?.rentRollProvenance || null;
  const liveDataHash = register?.summary?.dataHash || null;

  const parentForMetrics = useMemo(() => ({
    as_of_date: form.as_of_date || register?.as_of_date || null,
    settings: register?.settings || {},
  }), [form.as_of_date, register]);

  const occMetrics = useMemo(() => computeOccupantMetrics(occupants, parentForMetrics), [occupants, parentForMetrics]);
  const saleMetrics = useMemo(() => computeSaleMetrics(sales, parentForMetrics), [sales, parentForMetrics]);

  if (isLoading) return <SkeletonList rows={6} />;
  if (data?.unavailable) return <RegisterUnavailable />;

  const activeSegment = SEGMENTS.find((s) => s.kind === segment);
  const hasOccupants = occupants.length > 0;
  const canApply = bridgeSupported && saleMetrics.inventory.soldUnits > 0;

  const saveDrawer = (payload) => {
    const { kind, record } = drawer;
    const onSuccess = () => setDrawer(null);
    if (record?.id) updateRecord.mutate({ dealId, kind, recordId: record.id, ...payload }, { onSuccess });
    else createRecord.mutate({ dealId, kind, ...payload }, { onSuccess });
  };

  return (
    <div className="space-y-4">
      {hasOccupants && <OccupantKpiStrip metrics={occMetrics} />}
      <StaleModelBanner provenance={savedProvenance} liveDataHash={liveDataHash} />

      {hasOccupants && (
        <Suspense fallback={<div className="h-56 redip-skeleton rounded-editorial" />}>
          <OccupantCharts metrics={occMetrics} />
        </Suspense>
      )}

      <Card className="p-4">
        <SectionHeader
          size="sm" icon={Users} eyebrow="Deal register" title="Occupants & Sales"
          sub="Existing occupiers and their rehousing obligations, plus the free-sale inventory. Figures are gross; the model nets any ownership share downstream."
          action={canEdit && canApply && (
            <Button variant="secondary" size="sm" rightIcon={<ArrowRight size={14} />} onClick={() => setApplyOpen(true)}>
              Apply to Financials
            </Button>
          )}
        />
        <RegisterSettingsRow form={form} setForm={setForm} canEdit={canEdit} showLeasableArea={false} />

        {/* Segmented control — occupants + free-sale inventory under one register. */}
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="inline-flex rounded-editorial border border-hairline overflow-hidden text-sm font-medium" role="tablist" aria-label="Redevelopment register sections">
            {SEGMENTS.map((s, i) => (
              <button
                key={s.kind}
                type="button"
                role="tab"
                aria-selected={segment === s.kind}
                onClick={() => setSegment(s.kind)}
                className={`px-3.5 py-1.5 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98] ${i > 0 ? 'border-l border-hairline' : ''} ${segment === s.kind ? 'bg-accent text-white' : 'bg-bg-elevated text-content-secondary hover:bg-bg-secondary'}`}
              >
                {s.label}
                {(records[s.kind]?.length ?? 0) > 0 && (
                  <span className={`ml-1.5 tabular-nums ${segment === s.kind ? 'text-white/80' : 'text-content-muted'}`}>{records[s.kind].length}</span>
                )}
              </button>
            ))}
          </div>
          {canEdit && (
            <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setDrawer({ kind: segment, record: null })}>
              {activeSegment.addLabel}
            </Button>
          )}
        </div>

        {segment === 'occupant' ? (
          occupants.length === 0 ? (
            <EmptyState
              title="No occupiers recorded yet"
              description="Add each existing occupier with whatever is known — unit, area, or transit rent alone is enough at sourcing stage. Vacation progress and the rehousing obligation build from these. Import and extraction arrive in upcoming updates."
              action={canEdit && (
                <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setDrawer({ kind: 'occupant', record: null })}>Add first occupant</Button>
              )}
            />
          ) : (
            <RegisterGrid
              records={occupants}
              columns={OCCUPANT_COLUMNS}
              canEdit={canEdit}
              onPatch={(record, patch) => updateRecord.mutate({ dealId, kind: 'occupant', recordId: record.id, ...patch })}
              onOpen={(record) => setDrawer({ kind: 'occupant', record })}
            />
          )
        ) : (
          sales.length === 0 ? (
            <EmptyState
              title="No free-sale inventory recorded yet"
              description="Add the free-sale flats or units the redevelopment will sell — plot/unit number, area, or price alone is enough at sourcing stage. This seeds the model's selling rate."
              action={canEdit && (
                <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setDrawer({ kind: 'sale', record: null })}>Add first free-sale unit</Button>
              )}
            />
          ) : (
            <>
              <FreeSaleSummary metrics={saleMetrics} />
              <CollectionsGrid
                records={sales} canEdit={canEdit}
                onPatch={(record, patch) => updateRecord.mutate({ dealId, kind: 'sale', recordId: record.id, ...patch })}
                onOpen={(record) => setDrawer({ kind: 'sale', record })}
              />
            </>
          )
        )}
      </Card>

      {drawer && drawer.kind === 'occupant' && (
        <OccupantDrawer
          key={`occ-${drawer.record?.id ?? 'new'}`} open record={drawer.record}
          saving={createRecord.isPending || updateRecord.isPending || deleteRecord.isPending}
          onSave={saveDrawer}
          onDelete={(record) => deleteRecord.mutate({ dealId, kind: 'occupant', recordId: record.id }, { onSuccess: () => setDrawer(null) })}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer && drawer.kind === 'sale' && (
        <SaleDrawer
          key={`sale-${drawer.record?.id ?? 'new'}`} open record={drawer.record}
          saving={createRecord.isPending || updateRecord.isPending || deleteRecord.isPending}
          onSave={saveDrawer}
          onDelete={(record) => deleteRecord.mutate({ dealId, kind: 'sale', recordId: record.id }, { onSuccess: () => setDrawer(null) })}
          onClose={() => setDrawer(null)}
        />
      )}
      {applyOpen && (
        <ApplyToFinancialsModal
          open dealId={dealId} assetClass={assetClass} records={records} register={register}
          currentInputs={financials?.model_params?.inputs || null} onClose={() => setApplyOpen(false)}
        />
      )}
    </div>
  );
}
