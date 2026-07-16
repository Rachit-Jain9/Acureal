import { lazy, Suspense, useMemo, useState } from 'react';
import { Plus, Hotel, ArrowRight } from 'lucide-react';
import { Card, SectionHeader, MetricTile, Button, Badge, EmptyState, SkeletonList } from '../../design-system';
import {
  useRentRoll, useCreateRecord, useUpdateRecord, useDeleteRecord,
} from '../../hooks/useRentRoll';
import { useFinancials } from '../../hooks/useFinancials';
import { computeHotelMetrics, num } from '../../utils/rentRollMetrics';
import { HOSPITALITY_PREFILL_CLASSES } from '../../utils/rentRollPrefill';
import RegisterGrid from './RegisterGrid';
import HotelDrawer from './HotelDrawer';
import ApplyToFinancialsModal from './ApplyToFinancialsModal';
import { HOTEL_CONTRACT_TYPE_LABELS } from './rentRollColumns';
import {
  fmtPct, fmtCr, fmtCrOrL, fmtInt,
  useSettingsAutosave, StaleModelBanner, RegisterSettingsRow, RegisterUnavailable, TemplateDownloadButton,
} from './registerShared';

const HotelCharts = lazy(() => import('./HotelCharts'));

const dash = <span className="text-content-muted">—</span>;
const rupee0 = (v) => { const n = num(v); return n === null ? dash : `₹${Math.round(n).toLocaleString('en-IN')}`; };
const pct1 = (v) => { const n = num(v); return n === null ? dash : `${n.toFixed(1)}%`; };
const monthShort = (ym) => {
  if (!ym) return dash;
  const [y, m] = String(ym).slice(0, 7).split('-');
  const names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(m)] || m} ${String(y).slice(2)}`;
};

// ── Column specs per hotel kind ─────────────────────────────────────────────

const availableKeysOf = (r) => {
  const keys = num(r.keys_count);
  if (keys === null) return null;
  if (r.operational === false) return 0;
  const ooo = num(r.ooo_pct);
  return keys * (1 - (ooo === null ? 0 : Math.min(Math.max(ooo, 0), 100)) / 100);
};

const KEY_COLUMNS = [
  { key: 'room_type', label: 'Room Type', render: (r) => <span className="text-content-primary font-medium">{r.room_type || dash}</span> },
  { key: 'status', label: 'Status', render: (r) => (r.operational === false ? <Badge tone="danger">Out of service</Badge> : <Badge tone="success">Operational</Badge>) },
  { key: 'keys_count', label: 'Keys', align: 'right', width: '6rem', inlineEdit: { field: 'keys_count', type: 'number' } },
  { key: 'ooo_pct', label: 'OOO %', align: 'right', render: (r) => pct1(r.ooo_pct) },
  { key: 'available', label: 'Available', align: 'right', render: (r) => { const a = availableKeysOf(r); return a === null ? dash : <span className="text-content-secondary">{a.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</span>; } },
  { key: 'adr_premium_pct', label: 'ADR Premium', align: 'right', render: (r) => { const p = num(r.adr_premium_pct); return p === null ? dash : <span className={p >= 0 ? 'text-data-positive' : 'text-data-negative'}>{p >= 0 ? '+' : ''}{p}%</span>; } },
];

const CONTRACT_COLUMNS = [
  { key: 'record_label', label: 'Contract', render: (r) => <span className="text-content-primary font-medium">{r.record_label || r.operator_name || dash}</span> },
  { key: 'brand', label: 'Brand', render: (r) => r.brand || dash },
  { key: 'contract_type', label: 'Type', render: (r) => (r.contract_type ? HOTEL_CONTRACT_TYPE_LABELS[r.contract_type] || r.contract_type : dash) },
  { key: 'base_fee_pct', label: 'Base Fee', align: 'right', render: (r) => pct1(r.base_fee_pct) },
  { key: 'incentive_fee_pct', label: 'Incentive', align: 'right', render: (r) => pct1(r.incentive_fee_pct) },
  { key: 'ffe_reserve_pct', label: 'FF&E', align: 'right', render: (r) => pct1(r.ffe_reserve_pct) },
  { key: 'keys_covered', label: 'Keys', align: 'right', render: (r) => { const k = num(r.keys_covered); return k === null ? dash : fmtInt(k); } },
];

const totalRevOf = (r) => (num(r.room_revenue) || 0) + (num(r.fnb_revenue) || 0) + (num(r.other_revenue) || 0);

const MONTH_COLUMNS = [
  { key: 'month', label: 'Month', render: (r) => <span className="text-content-primary font-medium">{monthShort(r.month)}</span> },
  { key: 'occupancy_pct', label: 'Occ %', align: 'right', width: '6rem', inlineEdit: { field: 'occupancy_pct', type: 'number' } },
  { key: 'adr', label: 'ADR', align: 'right', width: '7rem', inlineEdit: { field: 'adr', type: 'number' } },
  { key: 'revpar', label: 'RevPAR', align: 'right', render: (r) => { const a = num(r.adr); const o = num(r.occupancy_pct); return (a === null || o === null) ? dash : `₹${Math.round(a * o / 100).toLocaleString('en-IN')}`; } },
  { key: 'total', label: 'Total Rev', align: 'right', render: (r) => { const t = totalRevOf(r); return t > 0 ? fmtCrOrL(t) : dash; } },
  { key: 'gop', label: 'GOP', align: 'right', render: (r) => { const g = num(r.gop); return g === null ? dash : fmtCrOrL(g); } },
  { key: 'gopMargin', label: 'GOP %', align: 'right', render: (r) => { const g = num(r.gop); const t = totalRevOf(r); return (g === null || t <= 0) ? dash : `${(g / t * 100).toFixed(0)}%`; } },
  { key: 'owner_noi', label: 'Owner NOI', align: 'right', render: (r) => { const n = num(r.owner_noi); return n === null ? dash : <span className="font-medium">{fmtCrOrL(n)}</span>; } },
];

const SEGMENTS = [
  { kind: 'hotel_key_block', label: 'Key Inventory', columns: KEY_COLUMNS, addLabel: 'Add room type', noun: 'room type' },
  { kind: 'hotel_contract', label: 'Contracts', columns: CONTRACT_COLUMNS, addLabel: 'Add contract', noun: 'contract' },
  { kind: 'hotel_operating_month', label: 'Operating History', columns: MONTH_COLUMNS, addLabel: 'Add month', noun: 'operating month' },
];

function HotelKpiStrip({ metrics }) {
  const k = metrics.keys;
  const op = metrics.operating;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <MetricTile
        label="Available Keys"
        value={k.availableKeys}
        format={k.availableKeys > 0 ? (n) => fmtInt(n) : undefined}
        footnote={k.totalKeys > 0 ? `${fmtInt(k.totalKeys)} total · ${k.roomTypes} room type${k.roomTypes === 1 ? '' : 's'}` : 'Add room inventory'}
      />
      <MetricTile
        label="TTM Occupancy"
        value={op.ttmOccupancyPct}
        format={op.ttmOccupancyPct === null ? undefined : fmtPct}
        footnote={op.ttmRevpar !== null ? `RevPAR ₹${Math.round(op.ttmRevpar).toLocaleString('en-IN')} · ${op.monthsCovered} mo` : 'Add operating months'}
      />
      <MetricTile
        label="TTM ADR"
        value={op.ttmAdr}
        format={op.ttmAdr === null ? undefined : (n) => `₹${Math.round(n).toLocaleString('en-IN')}`}
        footnote={op.basis === 'room_nights' ? 'Room-night weighted' : op.monthsCovered > 0 ? 'Stored-average basis' : 'Add operating months'}
      />
      <MetricTile
        label="TTM Owner NOI"
        value={op.ttmOwnerNoi}
        format={op.monthsCovered > 0 ? fmtCr : undefined}
        footnote={op.ttmGopMarginPct !== null ? `GOP margin ${op.ttmGopMarginPct.toFixed(0)}% · rev ${fmtCr(op.ttmTotalRevenue)}` : undefined}
      />
    </div>
  );
}

export default function HotelRegisterView({ dealId, assetClass, canEdit }) {
  const { data, isLoading } = useRentRoll(dealId);
  const { data: financials } = useFinancials(dealId);
  const createRecord = useCreateRecord();
  const updateRecord = useUpdateRecord();
  const deleteRecord = useDeleteRecord();
  const [segment, setSegment] = useState('hotel_key_block');
  const [drawer, setDrawer] = useState(null); // { kind, record }
  const [applyOpen, setApplyOpen] = useState(false);

  const register = data?.register || null;
  const records = data?.records || {};
  const { form, setForm } = useSettingsAutosave(dealId, register);

  const bridgeSupported = HOSPITALITY_PREFILL_CLASSES.has(assetClass);
  const savedProvenance = financials?.model_params?.rentRollProvenance || null;
  const liveDataHash = register?.summary?.dataHash || null;

  const metrics = useMemo(() => computeHotelMetrics(records, {
    as_of_date: form.as_of_date || register?.as_of_date || null,
    settings: register?.settings || {},
  }), [records, register, form]);

  if (isLoading) return <SkeletonList rows={6} />;
  if (data?.unavailable) return <RegisterUnavailable />;

  const activeSegment = SEGMENTS.find((s) => s.kind === segment);
  const segmentRows = records[segment] || [];
  const hasAnyData = (metrics.counts.keyBlocks + metrics.counts.contracts + metrics.counts.operatingMonths) > 0;
  const hasSeries = metrics.operating.series.length > 0;

  const saveDrawer = (payload) => {
    const { kind, record } = drawer;
    const onSuccess = () => setDrawer(null);
    if (record?.id) updateRecord.mutate({ dealId, kind, recordId: record.id, ...payload }, { onSuccess });
    else createRecord.mutate({ dealId, kind, ...payload }, { onSuccess });
  };

  return (
    <div className="space-y-4">
      {hasAnyData && <HotelKpiStrip metrics={metrics} />}
      <StaleModelBanner provenance={savedProvenance} liveDataHash={liveDataHash} />

      {hasSeries && (
        <Suspense fallback={<div className="h-60 redip-skeleton rounded-editorial" />}>
          <HotelCharts metrics={metrics} />
        </Suspense>
      )}

      <Card className="p-4">
        <SectionHeader
          size="sm" icon={Hotel} eyebrow="Deal register" title="Operating Roll"
          sub="Room inventory, management contracts, and the actual monthly P&L. Trailing-twelve-month metrics summarise how the asset trades; the model forecasts forward."
          action={canEdit && (
            <div className="flex items-center gap-2">
              {bridgeSupported && metrics.operating.monthsCovered > 0 && (
                <Button variant="secondary" size="sm" rightIcon={<ArrowRight size={14} />} onClick={() => setApplyOpen(true)}>
                  Apply to Financials
                </Button>
              )}
              <TemplateDownloadButton dealId={dealId} />
            </div>
          )}
        />
        <RegisterSettingsRow form={form} setForm={setForm} canEdit={canEdit} showLeasableArea={false} />

        {/* Segmented control — the three record kinds under one register. */}
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="inline-flex rounded-editorial border border-hairline overflow-hidden text-sm font-medium" role="tablist" aria-label="Hotel register sections">
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

        {segmentRows.length === 0 ? (
          <EmptyState
            title={`No ${activeSegment.noun}s recorded yet`}
            description={segment === 'hotel_operating_month'
              ? 'Add each month of the actual operating P&L — occupancy, ADR, revenue and GOP. Trailing metrics and the trend charts build from these. Bulk import arrives in an upcoming update.'
              : `Add the ${activeSegment.noun}s with whatever is known. Everything is optional at sourcing stage.`}
            action={canEdit && (
              <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setDrawer({ kind: segment, record: null })}>{activeSegment.addLabel}</Button>
            )}
          />
        ) : (
          <RegisterGrid
            records={segmentRows}
            columns={activeSegment.columns}
            canEdit={canEdit}
            onPatch={(record, patch) => updateRecord.mutate({ dealId, kind: segment, recordId: record.id, ...patch })}
            onOpen={(record) => setDrawer({ kind: segment, record })}
          />
        )}
      </Card>

      {drawer && (
        <HotelDrawer
          key={`${drawer.kind}-${drawer.record?.id ?? 'new'}`}
          open kind={drawer.kind} record={drawer.record}
          saving={createRecord.isPending || updateRecord.isPending || deleteRecord.isPending}
          onSave={saveDrawer}
          onDelete={(record) => deleteRecord.mutate({ dealId, kind: drawer.kind, recordId: record.id }, { onSuccess: () => setDrawer(null) })}
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
