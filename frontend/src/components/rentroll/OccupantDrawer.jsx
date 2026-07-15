import { useMemo } from 'react';
import RecordDrawer from './RecordDrawer';
import { visibleOccupantSections } from './rentRollColumns';

// Redevelopment occupier editor — a thin wrapper over the shared RecordDrawer
// with the occupant catalog. A fresh row defaults to 'in_place' (not yet
// vacated), so it counts toward the site-clearance obligation but not yet
// toward vacation progress.

const OCCUPANT_DEFAULTS = { status: 'in_place' };

export default function OccupantDrawer({ open, record, saving, onSave, onDelete, onClose }) {
  const sections = useMemo(() => visibleOccupantSections(), []);
  return (
    <RecordDrawer
      open={open}
      record={record}
      sections={sections}
      defaults={OCCUPANT_DEFAULTS}
      noun="occupant"
      titleFor={(r) => r?.occupant_name || r?.record_label}
      saving={saving}
      onSave={onSave}
      onDelete={onDelete}
      onClose={onClose}
    />
  );
}
