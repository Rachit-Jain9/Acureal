import { useMemo } from 'react';
import RecordDrawer from './RecordDrawer';
import { visibleLeaseSections } from './rentRollColumns';

// Lease editor — a thin wrapper over the shared RecordDrawer with the lease
// catalog and lease-specific defaults/title.

const LEASE_DEFAULTS = { status: 'vacant', rent_basis: 'per_sqft_month', cam_treatment: 'recovery' };

export default function LeaseDrawer({ open, record, assetClass, saving, onSave, onDelete, onClose }) {
  const sections = useMemo(() => visibleLeaseSections(assetClass), [assetClass]);
  return (
    <RecordDrawer
      open={open}
      record={record}
      sections={sections}
      defaults={LEASE_DEFAULTS}
      noun="lease"
      titleFor={(r) => r?.tenant_name || r?.record_label}
      saving={saving}
      onSave={onSave}
      onDelete={onDelete}
      onClose={onClose}
    />
  );
}
