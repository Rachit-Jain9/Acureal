import { lazy, Suspense, useMemo, useState } from 'react';
import { Plus, ShoppingBag, ArrowRight } from 'lucide-react';
import { Card, SectionHeader, MetricTile, Button, EmptyState, SkeletonList } from '../../design-system';
import {
  useRentRoll, useCreateRecord, useUpdateRecord, useDeleteRecord,
} from '../../hooks/useRentRoll';
import { useFinancials } from '../../hooks/useFinancials';
import { computeSaleMetrics } from '../../utils/rentRollMetrics';
import { SALES_PREFILL_CLASSES } from '../../utils/rentRollPrefill';
import CollectionsGrid from './CollectionsGrid';
import SaleDrawer from './SaleDrawer';
import ApplyToFinancialsModal from './ApplyToFinancialsModal';
import ImportRegisterButton from './ImportRegisterModal';
import {
  fmtPct, fmtCr, fmtCrOrL, fmtSignedPct,
  useSettingsAutosave, StaleModelBanner, RegisterSettingsRow, RegisterUnavailable,
  TemplateDownloadButton,
} from './registerShared';

const SalesCharts = lazy(() => import('./SalesCharts'));

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

export default function SalesRegisterView({ dealId, assetClass, canEdit }) {
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
            description="Add the first plot or unit with whatever is known — plot number, area, or price alone is enough at sourcing stage. Or download a blank template to prepare the inventory in Excel with the exact columns this register accepts."
            action={canEdit && (
              <div className="flex items-center gap-2 flex-wrap justify-center">
                <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setDrawer({ record: null })}>Add first plot</Button>
                <TemplateDownloadButton dealId={dealId} />
                <ImportRegisterButton dealId={dealId} />
              </div>
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
