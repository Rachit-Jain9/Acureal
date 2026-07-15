import { useMemo } from 'react';
import RecordDrawer from './RecordDrawer';
import { visibleHotelSections, HOTEL_CONTRACT_TYPE_LABELS } from './rentRollColumns';

// Editor for the three hotel record kinds — thin wrappers over the shared
// RecordDrawer with the right catalog + defaults + copy per kind.

const NOUN = {
  hotel_key_block: 'room type',
  hotel_contract: 'contract',
  hotel_operating_month: 'operating month',
};

const DEFAULTS = {
  hotel_key_block: { operational: 'true' },
  hotel_contract: { contract_type: 'hma' },
  hotel_operating_month: {},
};

const titleFor = (kind) => (r) => {
  if (!r) return null;
  if (kind === 'hotel_key_block') return r.room_type;
  if (kind === 'hotel_contract') return r.record_label || r.operator_name || HOTEL_CONTRACT_TYPE_LABELS[r.contract_type];
  return r.month ? String(r.month).slice(0, 7) : null;
};

export default function HotelDrawer({ open, kind, record, saving, onSave, onDelete, onClose }) {
  const sections = useMemo(() => visibleHotelSections(kind), [kind]);
  return (
    <RecordDrawer
      open={open}
      record={record}
      sections={sections}
      defaults={DEFAULTS[kind]}
      noun={NOUN[kind]}
      titleFor={titleFor(kind)}
      saving={saving}
      onSave={onSave}
      onDelete={onDelete}
      onClose={onClose}
    />
  );
}
