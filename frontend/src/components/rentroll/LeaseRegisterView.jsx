import { useMemo, useState } from 'react';
import { Plus, ScrollText, ArrowRight } from 'lucide-react';
import { Card, SectionHeader, MetricTile, Button, EmptyState, SkeletonList } from '../../design-system';
import {
  useRentRoll, useCreateRecord, useUpdateRecord, useDeleteRecord,
} from '../../hooks/useRentRoll';
import { useFinancials } from '../../hooks/useFinancials';
import { computeLeaseMetrics } from '../../utils/rentRollMetrics';
import { INCOME_PREFILL_CLASSES } from '../../utils/rentRollPrefill';
import LeaseGrid from './LeaseGrid';
import LeaseDrawer from './LeaseDrawer';
import ApplyToFinancialsModal from './ApplyToFinancialsModal';
import ImportRegisterButton from './ImportRegisterModal';
import ExtractRegisterButton from './ExtractRegisterModal';
import {
  fmtPct, fmtYears, fmtCr, fmtSignedPct,
  useSettingsAutosave, StaleModelBanner, RegisterSettingsRow, RegisterUnavailable, TemplateDownloadButton,
} from './registerShared';

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

export default function LeaseRegisterView({ dealId, assetClass, canEdit }) {
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
              {leases.length > 0 && <ExtractRegisterButton dealId={dealId} />}
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
            description="Add the first lease with whatever is known — tenant, area, or rent alone is enough at sourcing stage. Or download a blank template to prepare the roll in Excel with the exact columns this register accepts."
            action={canEdit && (
              <div className="flex items-center gap-2 flex-wrap justify-center">
                <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setDrawer({ record: null })}>Add first lease</Button>
                <ExtractRegisterButton dealId={dealId} />
                <TemplateDownloadButton dealId={dealId} />
                <ImportRegisterButton dealId={dealId} />
              </div>
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
