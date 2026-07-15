import { useState } from 'react';
import { Badge, VirtualizedList } from '../../design-system';
import { SALE_STATUS_CONFIG, SALE_STATUS_OPTIONS } from './rentRollColumns';
import { agreementValuePaise, num } from '../../utils/rentRollMetrics';

// Dense plot / free-sale inventory grid (CollectionsGrid). Hot cells edit
// inline — status (select) and collected-to-date (number, commits on
// blur/Enter) — everything else through the row drawer. Windows via
// VirtualizedList past 100 rows.

const rupeesFromPaise = (paise) => (paise === null ? null : paise / 100);

const fmtMoney = (v) => {
  if (v === null || v === undefined) return '—';
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
};

const fmtArea = (v) => {
  const n = num(v);
  return n === null ? '—' : n.toLocaleString('en-IN');
};

const marketMtmPct = (r) => {
  const base = num(r.base_price_per_sqft);
  const market = num(r.current_market_rate);
  if (base === null || market === null || base <= 0) return null;
  return (market / base - 1) * 100;
};

const inlineInputClass =
  'w-full bg-transparent rounded px-1 py-0.5 text-right tabular-nums text-content-primary '
  + 'border border-transparent transition-colors duration-150 ease-out '
  + 'hover:border-hairline focus:border-hairline-strong focus-visible:outline-none '
  + 'focus-visible:ring-2 focus-visible:ring-accent/40';

function InlineNumberCell({ value, onCommit }) {
  const [draft, setDraft] = useState(null);
  const commit = () => {
    if (draft === null) return;
    const trimmed = draft.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    const current = num(value);
    if (trimmed !== '' && !Number.isFinite(next)) { setDraft(null); return; }
    if (next !== current) onCommit(next);
    setDraft(null);
  };
  return (
    <input
      type="number"
      inputMode="decimal"
      className={inlineInputClass}
      value={draft ?? (value ?? '')}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setDraft(String(value ?? ''))}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setDraft(null); }}
      aria-label="Edit value"
    />
  );
}

function SaleRow({ record, canEdit, onPatch, onOpen }) {
  const agreement = rupeesFromPaise(agreementValuePaise(record));
  const collected = num(record.amount_collected);
  const overdue = num(record.amount_overdue);
  const collectionPct = agreement && agreement > 0 && collected !== null
    ? (collected / agreement) * 100 : null;
  const mtm = marketMtmPct(record);
  const statusCfg = SALE_STATUS_CONFIG[record.status] || SALE_STATUS_CONFIG.unsold;
  const isSold = record.status === 'booked' || record.status === 'sold' || record.status === 'registered';

  return (
    <tr
      className="group border-b border-hairline-soft transition-colors duration-150 ease-out hover:bg-bg-secondary cursor-pointer"
      onClick={onOpen}
    >
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="text-sm text-content-primary font-medium truncate max-w-[9rem]">
          {record.record_label || <span className="text-content-muted">—</span>}
        </div>
        <div className="text-xs text-content-muted truncate max-w-[9rem]">
          {[record.block_phase, record.customer_name].filter(Boolean).join(' · ') || ' '}
        </div>
      </td>
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        {canEdit ? (
          <select
            className="bg-transparent text-sm rounded border border-transparent px-1 py-0.5 text-content-primary transition-colors duration-150 ease-out hover:border-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 cursor-pointer"
            value={record.status}
            onChange={(e) => onPatch({ status: e.target.value })}
            aria-label="Sale status"
          >
            {SALE_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <Badge tone={statusCfg.tone}>{statusCfg.label}</Badge>
        )}
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums w-24">{fmtArea(record.area_sqft)}</td>
      <td className="px-3 py-2 text-right text-sm tabular-nums text-content-secondary whitespace-nowrap">
        {fmtMoney(agreement)}
      </td>
      <td className="px-3 py-2 text-right w-32" onClick={(e) => e.stopPropagation()}>
        {canEdit && isSold ? (
          <InlineNumberCell value={record.amount_collected} onCommit={(v) => onPatch({ amount_collected: v })} />
        ) : (
          <span className="text-sm tabular-nums">{fmtMoney(collected)}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums whitespace-nowrap">
        {collectionPct === null ? <span className="text-content-muted">—</span>
          : <span className={collectionPct >= 90 ? 'text-data-positive' : collectionPct >= 50 ? 'text-content-secondary' : 'text-data-negative'}>{collectionPct.toFixed(0)}%</span>}
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums whitespace-nowrap">
        {overdue && overdue > 0 ? <span className="text-data-negative">{fmtMoney(overdue)}</span> : <span className="text-content-muted">—</span>}
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums whitespace-nowrap">
        {mtm === null ? <span className="text-content-muted">—</span>
          : <span className={mtm >= 0 ? 'text-data-positive' : 'text-data-negative'}>{mtm >= 0 ? '+' : ''}{mtm.toFixed(1)}%</span>}
      </td>
    </tr>
  );
}

const HEADERS = [
  { label: 'Plot / Block', align: 'text-left' },
  { label: 'Status', align: 'text-left' },
  { label: 'Area (sqft)', align: 'text-right' },
  { label: 'Agreement ₹', align: 'text-right' },
  { label: 'Collected ₹', align: 'text-right' },
  { label: 'Coll. %', align: 'text-right' },
  { label: 'Overdue ₹', align: 'text-right' },
  { label: 'Market MTM', align: 'text-right' },
];

export default function CollectionsGrid({ records, canEdit, onPatch, onOpen }) {
  const header = (
    <thead>
      <tr className="bg-bg-secondary">
        {HEADERS.map((h) => (
          <th key={h.label} className={`px-3 py-2 text-eyebrow uppercase tracking-[0.06em] font-medium text-content-muted ${h.align}`}>
            {h.label}
          </th>
        ))}
      </tr>
    </thead>
  );

  if (records.length > 100) {
    return (
      <div className="border border-hairline rounded-editorial overflow-hidden">
        <table className="w-full text-sm">{header}</table>
        <VirtualizedList items={records} estimateSize={52}>
          {(record) => (
            <table className="w-full text-sm" key={record.id}>
              <tbody>
                <SaleRow record={record} canEdit={canEdit} onPatch={(patch) => onPatch(record, patch)} onOpen={() => onOpen(record)} />
              </tbody>
            </table>
          )}
        </VirtualizedList>
      </div>
    );
  }

  return (
    <div className="border border-hairline rounded-editorial overflow-x-auto">
      <table className="w-full text-sm">
        {header}
        <tbody>
          {records.map((record) => (
            <SaleRow key={record.id} record={record} canEdit={canEdit} onPatch={(patch) => onPatch(record, patch)} onOpen={() => onOpen(record)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
