import { useState } from 'react';
import { VirtualizedList } from '../../design-system';

// Column-spec register grid. One component for the display-heavy register
// tables (hotel key inventory, contracts, operating months). Each column is a
// spec — the grid stays dumb, the specs own presentation. Windows via
// VirtualizedList past 100 rows; a whole row is clickable to open its drawer,
// while inline-edit cells stop propagation.
//
// Column spec:
//   { key, label, align?: 'left'|'right', width?, render(record) => node,
//     inlineEdit?: { field, type: 'number'|'select', options?, disabled?(r) } }
//
// (LeaseGrid / CollectionsGrid keep their bespoke derived cells; this serves
// the simpler tabular kinds — a deliberate split, not duplication.)

const inlineInputClass =
  'w-full bg-transparent rounded px-1 py-0.5 text-right tabular-nums text-content-primary '
  + 'border border-transparent transition-colors duration-150 ease-out '
  + 'hover:border-hairline focus:border-hairline-strong focus-visible:outline-none '
  + 'focus-visible:ring-2 focus-visible:ring-accent/40';

const inlineSelectClass =
  'bg-transparent text-sm rounded border border-transparent px-1 py-0.5 text-content-primary '
  + 'transition-colors duration-150 ease-out hover:border-hairline focus-visible:outline-none '
  + 'focus-visible:ring-2 focus-visible:ring-accent/40 cursor-pointer';

function InlineNumber({ value, onCommit }) {
  const [draft, setDraft] = useState(null);
  const commit = () => {
    if (draft === null) return;
    const trimmed = draft.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    const current = value === null || value === undefined || value === '' ? null : Number(value);
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

// Read-only display for an inline-edit column that has no explicit render —
// e.g. a viewer-role user, for whom the editors never mount. Without this the
// grid would call an undefined render and crash the whole tab.
const displayInlineValue = (v) => {
  if (v === null || v === undefined || v === '') return <span className="text-content-muted">—</span>;
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(v);
};

function Cell({ col, record, canEdit, onPatch }) {
  const alignClass = col.align === 'right' ? 'text-right' : 'text-left';
  const editable = canEdit && col.inlineEdit && !(col.inlineEdit.disabled && col.inlineEdit.disabled(record));

  if (editable) {
    const { field, type, options } = col.inlineEdit;
    return (
      <td className={`px-3 py-2 ${alignClass}`} style={col.width ? { width: col.width } : undefined} onClick={(e) => e.stopPropagation()}>
        {type === 'select' ? (
          <select className={inlineSelectClass} value={record[field] ?? ''} onChange={(e) => onPatch({ [field]: e.target.value })} aria-label={col.label}>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <InlineNumber value={record[field]} onCommit={(v) => onPatch({ [field]: v })} />
        )}
      </td>
    );
  }

  // Non-editable: prefer an explicit render; else fall back to the inline-edit
  // field's raw value (so inline-edit-only columns still show for viewers).
  const content = col.render
    ? col.render(record)
    : (col.inlineEdit ? displayInlineValue(record[col.inlineEdit.field]) : null);
  return (
    <td className={`px-3 py-2 ${alignClass} ${col.align === 'right' ? 'tabular-nums' : ''}`} style={col.width ? { width: col.width } : undefined}>
      {content}
    </td>
  );
}

function Row({ record, columns, canEdit, onPatch, onOpen }) {
  return (
    <tr
      className="group border-b border-hairline-soft transition-colors duration-150 ease-out hover:bg-bg-secondary cursor-pointer"
      onClick={onOpen}
    >
      {columns.map((col) => (
        <Cell key={col.key} col={col} record={record} canEdit={canEdit} onPatch={onPatch} />
      ))}
    </tr>
  );
}

export default function RegisterGrid({ records, columns, canEdit, onPatch, onOpen }) {
  const header = (
    <thead>
      <tr className="bg-bg-secondary">
        {columns.map((col) => (
          <th
            key={col.key}
            className={`px-3 py-2 text-eyebrow uppercase tracking-[0.06em] font-medium text-content-muted ${col.align === 'right' ? 'text-right' : 'text-left'}`}
          >
            {col.label}
          </th>
        ))}
      </tr>
    </thead>
  );

  if (records.length > 100) {
    return (
      <div className="border border-hairline rounded-editorial overflow-hidden">
        <table className="w-full text-sm">{header}</table>
        <VirtualizedList items={records} estimateSize={48}>
          {(record) => (
            <table className="w-full text-sm" key={record.id}>
              <tbody>
                <Row record={record} columns={columns} canEdit={canEdit} onPatch={(patch) => onPatch(record, patch)} onOpen={() => onOpen(record)} />
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
            <Row key={record.id} record={record} columns={columns} canEdit={canEdit} onPatch={(patch) => onPatch(record, patch)} onOpen={() => onOpen(record)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
