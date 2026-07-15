import { useMemo, useState } from 'react';
import { Modal, Button, Field, Input, Select, confirm } from '../../design-system';
import { visibleLeaseSections } from './rentRollColumns';

// Full-record editor for one lease. Driven entirely by the column catalog so
// the form, grid, import mapping, and export columns can never disagree on
// structure. Explicit Save/Cancel — records are discrete audited entities,
// so no keystroke autosave here (register-level settings autosave instead).
//
// Per-class descriptor fields (catalog `isAttribute`) live under
// record.attributes; the payload builder splits them out and merges over the
// record's existing attributes so reserved keys (e.g. area_input) survive.

const toFormValue = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  return String(v);
};

const buildForm = (record, sections) => {
  const form = {};
  for (const section of sections) {
    for (const f of section.fields) {
      form[f.name] = toFormValue(f.isAttribute ? record?.attributes?.[f.name] : record?.[f.name]);
    }
  }
  // Defaults for a fresh lease keep the row metric-eligible from keystroke one.
  if (!record) {
    form.status = 'vacant';
    form.rent_basis = 'per_sqft_month';
    form.cam_treatment = 'recovery';
  }
  return form;
};

// '' → null (never 0 — Number('') is 0 and would corrupt weighted averages
// server-side); numeric fields coerced so the API receives numbers. Catalog
// attribute fields are folded into `attributes`, preserving existing keys.
const cleanPayload = (form, sections, record) => {
  const fieldByName = new Map(
    sections.flatMap((s) => s.fields).map((f) => [f.name, f]),
  );
  const out = {};
  const attributes = { ...(record?.attributes || {}) };
  let attributesTouched = false;

  for (const [name, raw] of Object.entries(form)) {
    const def = fieldByName.get(name);
    let value;
    if (raw === '') {
      value = null;
    } else if (def?.type === 'number') {
      const n = Number(raw);
      value = Number.isFinite(n) ? n : null;
    } else {
      value = raw;
    }
    if (def?.isAttribute) {
      attributes[name] = value;
      attributesTouched = true;
    } else {
      out[name] = value;
    }
  }
  if (attributesTouched) out.attributes = attributes;
  return out;
};

export default function LeaseDrawer({
  open,
  record,          // existing lease row, or null for "add"
  assetClass,
  saving = false,
  onSave,          // (payload) => void
  onDelete,        // (record) => void — only offered on existing records
  onClose,
}) {
  const sections = useMemo(() => visibleLeaseSections(assetClass), [assetClass]);
  const [form, setForm] = useState(() => buildForm(record, sections));
  const isEdit = Boolean(record?.id);

  const setField = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Remove this lease?',
      description: `${record.tenant_name || record.record_label || 'This record'} will be removed from the register. The change is kept in the deal's audit history.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (ok) onDelete(record);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? (record.tenant_name || record.record_label || 'Edit lease') : 'Add lease'}
      description={isEdit ? 'Changes save on confirm and are audit-logged.' : 'Only what you know — every field is optional at sourcing stage.'}
      size="lg"
      footer={(
        <div className="flex w-full items-center justify-between gap-3">
          <div>
            {isEdit && (
              <Button variant="ghost" onClick={handleDelete} disabled={saving}>
                Remove lease
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => onSave(cleanPayload(form, sections, record))}>
              {isEdit ? 'Save changes' : 'Add lease'}
            </Button>
          </div>
        </div>
      )}
    >
      <div className="space-y-6">
        {sections.map((section) => (
          <section key={section.title}>
            <h4 className="text-eyebrow uppercase tracking-[0.08em] text-content-muted font-medium mb-3">
              {section.title}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              {section.fields.map((f) => (
                <Field key={f.name} label={f.label} helper={f.hint}>
                  {f.type === 'select' ? (
                    <Select value={form[f.name]} onChange={setField(f.name)}>
                      {/* Descriptor selects are optional — allow clearing back to unset. */}
                      {f.isAttribute && <option value="">—</option>}
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      type={f.type}
                      step={f.step}
                      value={form[f.name]}
                      onChange={setField(f.name)}
                      inputMode={f.type === 'number' ? 'decimal' : undefined}
                    />
                  )}
                </Field>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
