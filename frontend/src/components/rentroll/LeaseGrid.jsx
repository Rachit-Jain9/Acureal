import { useState } from 'react';
import { Badge, VirtualizedList } from '../../design-system';
import { formatDate } from '../../utils/format';
import { LEASE_STATUS_CONFIG, LEASE_STATUS_OPTIONS, RENT_BASIS_SHORT } from './rentRollColumns';
import { monthlyBaseRentPaise, fyLabel, parseDate, num } from '../../utils/rentRollMetrics';

// Dense lease register grid (RankedCompsTable idiom). Hot cells edit inline —
// status (select), base rent + area (number, commits on blur/Enter when
// changed) — everything else through the row drawer. Windows via
// VirtualizedList past 100 rows.

const rupees = (paise) => (paise === null ? null : paise / 100);

const fmtMoney = (v) => {
  if (v === null || v === undefined) return '—';
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
};

const fmtRate = (v) => {
  const n = num(v);
  return n === null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

const fmtArea = (v) => {
  const n = num(v);
  return n === null ? '—' : n.toLocaleString('en-IN');
};

const mtmPct = (r) => {
  const base = num(r.base_rent_rate);
  const market = num(r.market_rent_rate);
  if (base === null || market === null || base <= 0) return null;
  return (market / base - 1) * 100;
};

// Shared 4-state chrome for inline editors: quiet at rest, visible on hover,
// ring on focus.
const inlineInputClass =
  'w-full bg-transparent rounded px-1 py-0.5 text-right tabular-nums text-content-primary '
  + 'border border-transparent transition-colors duration-150 ease-out '
  + 'hover:border-hairline focus:border-hairline-strong focus-visible:outline-none '
  + 'focus-visible:ring-2 focus-visible:ring-accent/40';

function InlineNumberCell({ value, onCommit, disabled }) {
  const [draft, setDraft] = useState(null); // null = not editing

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
      disabled={disabled}
      aria-label="Edit value"
    />
  );
}

function LeaseRow({ record, canEdit, onPatch, onOpen }) {
  const monthly = rupees(monthlyBaseRentPaise(record));
  const expiry = parseDate(record.lease_expiry);
  const mtm = mtmPct(record);
  const statusCfg = LEASE_STATUS_CONFIG[record.status] || LEASE_STATUS_CONFIG.vacant;

  return (
    <tr
      className="group border-b border-hairline-soft transition-colors duration-150 ease-out hover:bg-bg-secondary cursor-pointer"
      onClick={onOpen}
    >
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="text-sm text-content-primary font-medium truncate max-w-[10rem]">
          {record.tenant_name || <span className="text-content-muted">—</span>}
        </div>
        <div className="text-xs text-content-muted truncate max-w-[10rem]">
          {[record.record_label, record.building].filter(Boolean).join(' · ') || ' '}
        </div>
      </td>
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        {canEdit ? (
          <select
            className="bg-transparent text-sm rounded border border-transparent px-1 py-0.5 text-content-primary transition-colors duration-150 ease-out hover:border-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 cursor-pointer"
            value={record.status}
            onChange={(e) => onPatch({ status: e.target.value })}
            aria-label="Lease status"
          >
            {LEASE_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : (
          <Badge tone={statusCfg.tone}>{statusCfg.label}</Badge>
        )}
      </td>
      <td className="px-3 py-2 text-right w-28" onClick={(e) => e.stopPropagation()}>
        {canEdit ? (
          <InlineNumberCell
            value={record.chargeable_area_sqft}
            onCommit={(v) => onPatch({ chargeable_area_sqft: v })}
          />
        ) : (
          <span className="text-sm tabular-nums">{fmtArea(record.chargeable_area_sqft)}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right w-28" onClick={(e) => e.stopPropagation()}>
        {canEdit ? (
          <InlineNumberCell
            value={record.base_rent_rate}
            onCommit={(v) => onPatch({ base_rent_rate: v })}
          />
        ) : (
          <span className="text-sm tabular-nums">{fmtRate(record.base_rent_rate)}</span>
        )}
        <div className="text-[10px] text-content-muted text-right">
          {RENT_BASIS_SHORT[record.rent_basis] || ''}
        </div>
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums text-content-secondary whitespace-nowrap">
        {fmtMoney(monthly)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="text-sm tabular-nums text-content-secondary">
          {record.lease_expiry ? formatDate(record.lease_expiry) : '—'}
        </span>
        {expiry && (
          <span className="ml-1.5 text-[10px] text-content-muted">{fyLabel(expiry)}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums whitespace-nowrap">
        {mtm === null ? (
          <span className="text-content-muted">—</span>
        ) : (
          <span className={mtm >= 0 ? 'text-data-positive' : 'text-data-negative'}>
            {mtm >= 0 ? '+' : ''}{mtm.toFixed(1)}%
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {record.verified ? (
          <Badge tone="success">Verified</Badge>
        ) : (
          <span className="text-[10px] uppercase tracking-wide text-content-muted">
            {record.source === 'manual' ? 'Manual' : record.source}
          </span>
        )}
      </td>
    </tr>
  );
}

const HEADERS = [
  { label: 'Tenant / Unit', align: 'text-left' },
  { label: 'Status', align: 'text-left' },
  { label: 'Area (sqft)', align: 'text-right' },
  { label: 'Rent Rate', align: 'text-right' },
  { label: 'Rent (₹/mo)', align: 'text-right' },
  { label: 'Expiry', align: 'text-left' },
  { label: 'vs Market', align: 'text-right' },
  { label: 'Source', align: 'text-right' },
];

export default function LeaseGrid({ records, canEdit, onPatch, onOpen }) {
  const header = (
    <thead>
      <tr className="bg-bg-secondary">
        {HEADERS.map((h) => (
          <th
            key={h.label}
            className={`px-3 py-2 text-eyebrow uppercase tracking-[0.06em] font-medium text-content-muted ${h.align}`}
          >
            {h.label}
          </th>
        ))}
      </tr>
    </thead>
  );

  // Past 100 rows, window the body (VirtualizedList renders row DIVs, so the
  // windowed variant swaps the <table> for stacked rows with the same cells).
  if (records.length > 100) {
    return (
      <div className="border border-hairline rounded-editorial overflow-hidden">
        <table className="w-full text-sm">{header}</table>
        <VirtualizedList items={records} estimateSize={52}>
          {(record) => (
            <table className="w-full text-sm" key={record.id}>
              <tbody>
                <LeaseRow
                  record={record}
                  canEdit={canEdit}
                  onPatch={(patch) => onPatch(record, patch)}
                  onOpen={() => onOpen(record)}
                />
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
            <LeaseRow
              key={record.id}
              record={record}
              canEdit={canEdit}
              onPatch={(patch) => onPatch(record, patch)}
              onOpen={() => onOpen(record)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
