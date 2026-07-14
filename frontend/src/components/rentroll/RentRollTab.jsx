import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, ScrollText } from 'lucide-react';
import {
  Card, SectionHeader, MetricTile, Button, Field, Input, Select,
  EmptyState, ErrorState, SkeletonList,
} from '../../design-system';
import { useDealContext, useDealRecord } from '../../hooks/useDealContext';
import {
  useRentRoll, useSaveRegisterSettings, useCreateRecord, useUpdateRecord, useDeleteRecord,
} from '../../hooks/useRentRoll';
import { computeLeaseMetrics } from '../../utils/rentRollMetrics';
import { registerFamilyFor, REGISTER_TAB_LABELS } from './rentRollColumns';
import LeaseGrid from './LeaseGrid';
import LeaseDrawer from './LeaseDrawer';

// Deal Register tab. PR-3 ships the lease-income family (offices, retail,
// warehousing, rental residential, villas, land licences, mixed-use);
// sales & collections, hotel operating, and occupant registers follow — their
// states below are honest placeholders, never mock UI.

const fmtPct = (n) => `${n.toFixed(1)}%`;
const fmtYears = (n) => `${n.toFixed(1)} yr`;
const fmtCr = (n) => `₹${(n / 1e7).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr`;
const fmtSignedPct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

// Register-level scalars autosave (Yield Studio pattern): 700ms debounce,
// change-gated so opening the tab never fires a phantom save.
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
  const createRecord = useCreateRecord();
  const updateRecord = useUpdateRecord();
  const deleteRecord = useDeleteRecord();
  const [drawer, setDrawer] = useState(null); // null | { record: row|null }

  const register = data?.register || null;
  const leases = data?.records?.lease || [];
  const { form, setForm } = useSettingsAutosave(dealId, register);

  // Metrics recompute locally from the fetched rows (mirrored deterministic
  // util) so KPIs are instant; the server recomputes the same numbers into
  // the summary cache inside every mutation transaction.
  const metrics = useMemo(() => computeLeaseMetrics(leases, {
    as_of_date: form.as_of_date || register?.as_of_date || null,
    total_leasable_area_sqft: form.total_leasable_area_sqft === ''
      ? null
      : Number(form.total_leasable_area_sqft),
    settings: register?.settings || {},
  }), [leases, register, form]);

  if (isLoading) return <SkeletonList rows={6} />;

  if (data?.unavailable) {
    return (
      <ErrorState
        tone="info"
        title="Register storage is being provisioned"
        description="The database update for deal registers has not been applied yet. Data entry opens as soon as it lands."
      />
    );
  }

  const saveDrawer = (payload) => {
    const record = drawer?.record;
    const onSuccess = () => setDrawer(null);
    if (record?.id) {
      updateRecord.mutate({ dealId, kind: 'lease', recordId: record.id, ...payload }, { onSuccess });
    } else {
      createRecord.mutate({ dealId, kind: 'lease', ...payload }, { onSuccess });
    }
  };

  return (
    <div className="space-y-4">
      {leases.length > 0 && <LeaseKpiStrip metrics={metrics} />}

      <Card className="p-4">
        <SectionHeader
          size="sm"
          icon={ScrollText}
          eyebrow="Deal register"
          title="Rent Roll"
          sub={`One row per lease or licence. Figures are gross (pre ownership share); vacant rows count toward potential, never contracted income.${metrics.counts.total > 0 ? ` ${metrics.counts.total} record(s).` : ''}`}
          action={canEdit && (
            <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setDrawer({ record: null })}>
              Add lease
            </Button>
          )}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3 mb-4">
          <Field label="Rent roll as of" helper="Every derived metric anchors to this date.">
            <Input
              type="date"
              value={form.as_of_date}
              onChange={(e) => setForm((f) => ({ ...f, as_of_date: e.target.value }))}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Total leasable area (sqft)" helper="Occupancy denominator. Falls back to the summed row areas.">
            <Input
              type="number"
              inputMode="decimal"
              value={form.total_leasable_area_sqft}
              onChange={(e) => setForm((f) => ({ ...f, total_leasable_area_sqft: e.target.value }))}
              disabled={!canEdit}
            />
          </Field>
        </div>

        {leases.length === 0 ? (
          <EmptyState
            title="No leases recorded yet"
            description="Add the first lease with whatever is known — tenant, area, or rent alone is enough at sourcing stage. Spreadsheet import and document extraction arrive in upcoming updates."
            action={canEdit && (
              <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setDrawer({ record: null })}>
                Add first lease
              </Button>
            )}
          />
        ) : (
          <LeaseGrid
            records={leases}
            canEdit={canEdit}
            onPatch={(record, patch) => updateRecord.mutate({ dealId, kind: 'lease', recordId: record.id, ...patch })}
            onOpen={(record) => setDrawer({ record })}
          />
        )}
      </Card>

      {drawer && (
        <LeaseDrawer
          key={drawer.record?.id ?? 'new'}
          open
          record={drawer.record}
          assetClass={assetClass}
          saving={createRecord.isPending || updateRecord.isPending || deleteRecord.isPending}
          onSave={saveDrawer}
          onDelete={(record) => deleteRecord.mutate(
            { dealId, kind: 'lease', recordId: record.id },
            { onSuccess: () => setDrawer(null) },
          )}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}

export default function RentRollTab({ canEdit = false }) {
  const { dealId } = useDealContext();
  const deal = useDealRecord();
  const assetClass = deal?.asset_class || 'commercial_office';
  const family = registerFamilyFor(assetClass);

  if (family !== 'lease_income') {
    // Honest placeholder — these register families ship next; no mock UI.
    return (
      <EmptyState
        title={`${REGISTER_TAB_LABELS[family]} register is on its way`}
        description="This deal type gets its own register format (not a tenant rent roll) in an upcoming update. Nothing here is simulated in the meantime."
      />
    );
  }

  return <LeaseRegisterView dealId={dealId} assetClass={assetClass} canEdit={canEdit} />;
}
