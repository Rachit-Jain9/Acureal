import { useMemo } from 'react';
import RecordDrawer from './RecordDrawer';
import { visibleSaleSections } from './rentRollColumns';

// Plot / free-sale unit editor — a thin wrapper over the shared RecordDrawer
// with the sale catalog. A fresh row defaults to 'unsold' so it lands in
// inventory (never contributing to collections until booked/sold).

const SALE_DEFAULTS = { status: 'unsold' };

export default function SaleDrawer({ open, record, saving, onSave, onDelete, onClose }) {
  const sections = useMemo(() => visibleSaleSections(), []);
  return (
    <RecordDrawer
      open={open}
      record={record}
      sections={sections}
      defaults={SALE_DEFAULTS}
      noun="plot"
      titleFor={(r) => r?.record_label || r?.customer_name}
      saving={saving}
      onSave={onSave}
      onDelete={onDelete}
      onClose={onClose}
    />
  );
}
