import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, ScrollText, ShoppingBag, ArrowRight } from 'lucide-react';
import {
  Card, SectionHeader, MetricTile, Button, Field, Input,
  EmptyState, ErrorState, SkeletonList,
} from '../../design-system';
import { useDealContext, useDealRecord } from '../../hooks/useDealContext';
import {
  useRentRoll, useSaveRegisterSettings, useCreateRecord, useUpdateRecord, useDeleteRecord,
} from '../../hooks/useRentRoll';
import { useFinancials } from '../../hooks/useFinancials';
import { computeLeaseMetrics, computeSaleMetrics } from '../../utils/rentRollMetrics';
import { INCOME_PREFILL_CLASSES, SALES_PREFILL_CLASSES } from '../../utils/rentRollPrefill';
import { registerFamilyFor, REGISTER_TAB_LABELS } from './rentRollColumns';
import LeaseGrid from './LeaseGrid';
import LeaseDrawer from './LeaseDrawer';
import CollectionsGrid from './CollectionsGrid';
import SaleDrawer from './SaleDrawer';
import ApplyToFinancialsModal from './ApplyToFinancialsModal';

// Recharts is ~115 KB gz — lazy-load the Shape-B visuals so the register grid
// paints immediately and the chart chunk only downloads when sale rows exist.
const SalesCharts = lazy(() => import('./SalesCharts'));

const fmtPct = (n) => `${n.toFixed(1)}%`;
const fmtYears = (n) => `${n.toFixed(1)} yr`;
const fmtCr = (n) => `₹${(n / 1e7).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr`;
const fmtCrOrL = (n) => {
  if (Math.abs(n) >= 1e7) return fmtCr(n);
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};
const fmtSignedPct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

// Register-level scalars autosave (Yield Studio pattern): 700ms debounce,
// change-gated so opening the tab never fires a phantom save. Shared by both
// families; the sales view simply doesn't render the leasable-area field.
function useSettingsAutosave(dealId, register) {
  const save = useSaveRegisterSettings();
  const [form, setForm] = useState({ as_of_date: '', total_leasable_area_sqft: '' });
  const lastSyncedRef = useRef(null);

  useEffect(() => {
    const next = {
      as_of_date: register?.as_of_date ? String(register.as_of_date).slice(0, 10) : '',
      total_leasable_area_sqft: register?.total_leasable_area_sqft ?? '',
    };
    setForm(next);
    lastSyncedRef.current = JSON.stringify(next);
  }, [register?.id, register?.as_of_date, register?.total_leasable_area_sqft]);

  useEffect(() => {
    const serialized = JSON.stringify(form);
    if (serialized === lastSyncedRef.current) return undefined;
    const t = setTimeout(() => {
      lastSyncedRef.current = serialized;
      save.mutate({
        dealId,
        as_of_date: form.as_of_date || null,
        total_leasable_area_sqft: form.total_leasable_area_sqft === ''
          ? null
          : Number(form.total_leasable_area_sqft),
      });
    }, 700);
    return () => clearTimeout(t);
  }, [form, dealId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { form, setForm, saving: save.isPending };
}

// The saved model cites a frozen snapshot; if the live register's content hash
// has moved on, the model is quoting older evidence. Shared across families.
function StaleModelBanner({ provenance, liveDataHash }) {
  const stale = Boolean(provenance?.dataHash && liveDataHash && provenance.dataHash !== liveDataHash);
  if (!stale) return null;
  const noun = provenance.basisNoun || 'record';
  const count = provenance.basisCount ?? '—';
  return (
    <ErrorState tone="warn" title="The saved financial model cites an older register">
      {`Assumptions were seeded from the snapshot of ${provenance.asOfDate || 'an earlier date'} (${count} ${noun}${count === 1 ? '' : 's'}); the register has changed since. Use “Apply to Financials” to re-seed, or keep the older snapshot deliberately.`}
    </ErrorState>
  );
}

function RegisterSettingsRow({ form, setForm, canEdit, showLeasableArea }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3 mb-4">
      <Field label="Register as of" helper="Every derived metric anchors to this date.">
        <Input
          type="date"
          value={form.as_of_date}
          onChange={(e) => setForm((f) => ({ ...f, as_of_date: e.target.value }))}
          disabled={!canEdit}
        />
      </Field>
      {showLeasableArea && (
        <Field label="Total leasable area (sqft)" helper="Occupancy denominator. Falls back to the summed row areas.">
          <Input
            type="number"
            inputMode="decimal"
            value={form.total_leasable_area_sqft}
            onChange={(e) => setForm((f) => ({ ...f, total_leasable_area_sqft: e.target.value }))}
            disabled={!canEdit}
          />
        </Field>
      )}
    </div>
  );
}

// ── Lease-income family ─────────────────────────────────────────────────────

function LeaseKpiStrip({ metrics }) {
  const occ = metrics.occupancy;
  const wale = metrics.wale;
  const noi = metrics.revenue.accrualNOI;
  const mtm = metrics.mtm.portfolioPct;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <MetricTile
        label="Committed Occupancy"
        value={occ.committedPct}
        format={occ.committedPct === null ? undefined : fmtPct}
        footnote={occ.committedPct === null
          ? 'Needs a leasable-area denominator'
          : `Physical ${occ.physicalPct?.toFixed(0) ?? '—'}% · denominator: ${occ.denominatorSource === 'register_total' ? 'register total' : 'sum of rows'}`}
      />
      <MetricTile
        label="WALE (to expiry)"
        value={wale.toExpiryAreaYears}
        format={wale.toExpiryAreaYears === null ? undefined : fmtYears}
        footnote={metrics.excluded.missingExpiry > 0
          ? `From ${wale.coveredLeases} lease(s) — ${metrics.excluded.missingExpiry} missing expiry`
          : wale.lockinRemainingYears !== null
            ? `Lock-in remaining ${wale.lockinRemainingYears.toFixed(1)} yr (${wale.lockinBand})`
            : undefined}
      />
      <MetricTile
        label="In-place vs Market"
        value={mtm}
        format={mtm === null ? undefined : fmtSignedPct}
        tone={mtm === null ? 'neutral' : mtm >= 0 ? 'up' : 'down'}
        footnote={mtm === null ? 'Add market rents to compare' : `Across ${metrics.mtm.coveredLeases} lease(s)`}
      />
      <MetricTile
        label="Annual NOI (contracted)"
        value={noi}
        format={fmtCr}
        footnote={`Cash-adjusted ${fmtCr(metrics.revenue.cashNOI)}${metrics.revenue.ervVacantAnnual > 0 ? ` · vacant ERV ${fmtCr(metrics.revenue.ervVacantAnnual)}` : ''}`}
      />
    </div>
  );
}

function LeaseRegisterView({ dealId, assetClass, canEdit }) {
  const { data, isLoading } = useRentRoll(dealId);
  const { data: financials } = useFinancials(dealId);
  const createRecord = useCreateRecord();
  const updateRecord = useUpdateRecord();
  const deleteRecord = useDeleteRecord();
  const [drawer, setDrawer] = useState(null);
  const [applyOpen, setApplyOpen] = useState(false);

  const register = data?.register || null;
  const leases = data?.records?.lease || [];
  const { form, setForm } = useSettingsAutosave(dealId, register);

  const bridgeSupported = INCOME_PREFILL_CLASSES.has(assetClass);
  const savedProvenance = financials?.model_params?.rentRollProvenance || null;
  const liveDataHash = register?.summary?.dataHash || null;

  const metrics = useMemo(() => computeLeaseMetrics(leases, {
    as_of_date: form.as_of_date || register?.as_of_date || null,
    total_leasable_area_sqft: form.total_leasable_area_sqft === '' ? null : Number(form.total_leasable_area_sqft),
    settings: register?.settings || {},
  }), [leases, register, form]);

  if (isLoading) return <SkeletonList rows={6} />;
  if (data?.unavailable) return <RegisterUnavailable />;

  const saveDrawer = (payload) => {
    const record = drawer?.record;
    const onSuccess = () => setDrawer(null);
    if (record?.id) updateRecord.mutate({ dealId, kind: 'lease', recordId: record.id, ...payload }, { onSuccess });
    else createRecord.mutate({ dealId, kind: 'lease', ...payload }, { onSuccess });
  };

  return (
    <div className="space-y-4">
      {leases.length > 0 && <LeaseKpiStrip metrics={metrics} />}
      <StaleModelBanner provenance={savedProvenance} liveDataHash={liveDataHash} />

      <Card className="p-4">
        <SectionHeader
          size="sm" icon={ScrollText} eyebrow="Deal register" title="Rent Roll"
          sub={`One row per lease or licence. Figures are gross (pre ownership share); vacant rows count toward potential, never contracted income.${metrics.counts.total > 0 ? ` ${metrics.counts.total} record(s).` : ''}`}
          action={canEdit && (
            <div className="flex items-center gap-2">
              {bridgeSupported && leases.length > 0 && (
                <Button variant="secondary" size="sm" rightIcon={<ArrowRight size={14} />} onClick={() => setApplyOpen(true)}>
                  Apply to Financials
                </Button>
              )}
              <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setDrawer({ record: null })}>
                Add lease
              </Button>
            </div>
          )}
        />
        <RegisterSettingsRow form={form} setForm={setForm} canEdit={canEdit} showLeasableArea />

        {leases.length === 0 ? (
          <EmptyState
            title="No leases recorded yet"
            description="Add the first lease with whatever is known — tenant, area, or rent alone is enough at sourcing stage. Spreadsheet import and document extraction arrive in upcoming updates."
            action={canEdit && (
              <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setDrawer({ record: null })}>Add first lease</Button>
            )}
          />
        ) : (
          <LeaseGrid
            records={leases} canEdit={canEdit}
            onPatch={(record, patch) => updateRecord.mutate({ dealId, kind: 'lease', recordId: record.id, ...patch })}
            onOpen={(record) => setDrawer({ record })}
          />
        )}
      </Card>

      {drawer && (
        <LeaseDrawer
          key={drawer.record?.id ?? 'new'} open record={drawer.record} assetClass={assetClass}
          saving={createRecord.isPending || updateRecord.isPending || deleteRecord.isPending}
          onSave={saveDrawer}
          onDelete={(record) => deleteRecord.mutate({ dealId, kind: 'lease', recordId: record.id }, { onSuccess: () => setDrawer(null) })}
          onClose={() => setDrawer(null)}
        />
      )}
      {applyOpen && (
        <ApplyToFinancialsModal
          open dealId={dealId} assetClass={assetClass} records={data?.records || {}} register={register}
          currentInputs={financials?.model_params?.inputs || null} onClose={() => setApplyOpen(false)}
        />
      )}
    </div>
  );
}

// ── Sales & collections family ──────────────────────────────────────────────

function SalesKpiStrip({ metrics }) {
  const c = metrics.collections;
  const inv = metrics.inventory;
  const area = metrics.area;
  const unsold = metrics.unsold;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <MetricTile
        label="Sold GDV"
        value={c.soldGDV}
        format={fmtCr}
        footnote={area.sellThroughByAreaPct !== null
          ? `${area.sellThroughByAreaPct.toFixed(0)}% sold by area · ${inv.soldUnits}/${inv.totalUnits} units`
          : `${inv.soldUnits}/${inv.totalUnits} units sold`}
      />
      <MetricTile
        label="Collection Efficiency"
        value={c.collectionEfficiencyPct}
        format={c.collectionEfficiencyPct === null ? undefined : fmtPct}
        tone={c.collectionEfficiencyPct === null ? 'neutral' : c.collectionEfficiencyPct >= 90 ? 'up' : c.collectionEfficiencyPct >= 50 ? 'neutral' : 'down'}
        footnote={c.collectionEfficiencyPct === null ? 'No sold units yet' : `${fmtCr(c.collected)} of ${fmtCr(c.soldGDV)}`}
      />
      <MetricTile
        label="Receivable"
        value={c.receivable}
        format={fmtCr}
        footnote={`Outstanding across ${inv.soldUnits} sold unit${inv.soldUnits === 1 ? '' : 's'}`}
      />
      <MetricTile
        label="Overdue"
        value={c.overdue}
        format={fmtCrOrL}
        tone={c.overdue > 0 ? 'down' : 'neutral'}
        footnote={unsold.unsoldGDV > 0
          ? `Unsold GDV ${fmtCr(unsold.unsoldGDV)}${unsold.unsoldMtmPct !== null ? ` · MTM ${fmtSignedPct(unsold.unsoldMtmPct)}` : ''}`
          : 'No overdue amounts flagged'}
      />
    </div>
  );
}

function SalesRegisterView({ dealId, assetClass, canEdit }) {
  const { data, isLoading } = useRentRoll(dealId);
  const { data: financials } = useFinancials(dealId);
  const createRecord = useCreateRecord();
  const updateRecord = useUpdateRecord();
  const deleteRecord = useDeleteRecord();
  const [drawer, setDrawer] = useState(null);
  const [applyOpen, setApplyOpen] = useState(false);

  const register = data?.register || null;
  const sales = data?.records?.sale || [];
  const { form, setForm } = useSettingsAutosave(dealId, register);

  const bridgeSupported = SALES_PREFILL_CLASSES.has(assetClass);
  const savedProvenance = financials?.model_params?.rentRollProvenance || null;
  const liveDataHash = register?.summary?.dataHash || null;

  const metrics = useMemo(() => computeSaleMetrics(sales, {
    as_of_date: form.as_of_date || register?.as_of_date || null,
    settings: register?.settings || {},
  }), [sales, register, form]);

  if (isLoading) return <SkeletonList rows={6} />;
  if (data?.unavailable) return <RegisterUnavailable />;

  const saveDrawer = (payload) => {
    const record = drawer?.record;
    const onSuccess = () => setDrawer(null);
    if (record?.id) updateRecord.mutate({ dealId, kind: 'sale', recordId: record.id, ...payload }, { onSuccess });
    else createRecord.mutate({ dealId, kind: 'sale', ...payload }, { onSuccess });
  };

  return (
    <div className="space-y-4">
      {sales.length > 0 && <SalesKpiStrip metrics={metrics} />}
      <StaleModelBanner provenance={savedProvenance} liveDataHash={liveDataHash} />

      {sales.length > 0 && (
        <Suspense fallback={<div className="h-56 redip-skeleton rounded-editorial" />}>
          <SalesCharts metrics={metrics} />
        </Suspense>
      )}

      <Card className="p-4">
        <SectionHeader
          size="sm" icon={ShoppingBag} eyebrow="Deal register" title="Sales & Collections"
          sub={`One row per plot or unit. Booked/sold/registered units carry collections; unsold units feed inventory GDV.${metrics.counts.total > 0 ? ` ${metrics.counts.total} record(s).` : ''}`}
          action={canEdit && (
            <div className="flex items-center gap-2">
              {bridgeSupported && metrics.inventory.soldUnits > 0 && (
                <Button variant="secondary" size="sm" rightIcon={<ArrowRight size={14} />} onClick={() => setApplyOpen(true)}>
                  Apply to Financials
                </Button>
              )}
              <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setDrawer({ record: null })}>
                Add plot
              </Button>
            </div>
          )}
        />
        <RegisterSettingsRow form={form} setForm={setForm} canEdit={canEdit} showLeasableArea={false} />

        {sales.length === 0 ? (
          <EmptyState
            title="No inventory recorded yet"
            description="Add the first plot or unit with whatever is known — plot number, area, or price alone is enough at sourcing stage. Spreadsheet import and document extraction arrive in upcoming updates."
            action={canEdit && (
              <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setDrawer({ record: null })}>Add first plot</Button>
            )}
          />
        ) : (
          <CollectionsGrid
            records={sales} canEdit={canEdit}
            onPatch={(record, patch) => updateRecord.mutate({ dealId, kind: 'sale', recordId: record.id, ...patch })}
            onOpen={(record) => setDrawer({ record })}
          />
        )}
      </Card>

      {drawer && (
        <SaleDrawer
          key={drawer.record?.id ?? 'new'} open record={drawer.record}
          saving={createRecord.isPending || updateRecord.isPending || deleteRecord.isPending}
          onSave={saveDrawer}
          onDelete={(record) => deleteRecord.mutate({ dealId, kind: 'sale', recordId: record.id }, { onSuccess: () => setDrawer(null) })}
          onClose={() => setDrawer(null)}
        />
      )}
      {applyOpen && (
        <ApplyToFinancialsModal
          open dealId={dealId} assetClass={assetClass} records={data?.records || {}} register={register}
          currentInputs={financials?.model_params?.inputs || null} onClose={() => setApplyOpen(false)}
        />
      )}
    </div>
  );
}

function RegisterUnavailable() {
  return (
    <ErrorState tone="info" title="Register storage is being provisioned">
      The database update for deal registers has not been applied yet. Data entry opens as soon as it lands.
    </ErrorState>
  );
}

export default function RentRollTab({ canEdit = false }) {
  const { dealId } = useDealContext();
  const deal = useDealRecord();
  const assetClass = deal?.asset_class || 'commercial_office';
  const family = registerFamilyFor(assetClass);

  if (family === 'lease_income') {
    return <LeaseRegisterView dealId={dealId} assetClass={assetClass} canEdit={canEdit} />;
  }
  if (family === 'sales_collections') {
    return <SalesRegisterView dealId={dealId} assetClass={assetClass} canEdit={canEdit} />;
  }

  // hotel_operating / redevelopment ship next — honest placeholder, no mock UI.
  return (
    <EmptyState
      title={`${REGISTER_TAB_LABELS[family]} register is on its way`}
      description="This deal type gets its own register format in an upcoming update. Nothing here is simulated in the meantime."
    />
  );
}
