import { useMemo, useState } from 'react';
import { Modal, Button, Field, Input, Select, confirm } from '../../design-system';

// Catalog-driven editor for one register record (lease or sale). Driven
// entirely by the `sections` catalog so the form, grid, import mapping, and
// export columns can never disagree on structure. Explicit Save/Cancel —
// records are discrete audited entities, so no keystroke autosave here
// (register-level settings autosave instead).
//
// Per-record descriptor fields (catalog `isAttribute`) live under
// record.attributes; the payload builder splits them out and merges over the
// record's existing attributes so reserved keys survive.

const toFormValue = (v, f) => {
  if (v === null || v === undefined) return '';
  if (f?.boolean) return v === true || v === 'true' ? 'true' : 'false';
  const s = typeof v === 'string' ? v : String(v);
  // Date/month columns arrive as 'YYYY-MM-DD' (production + CI run the API on
  // UTC, where the pg DATE serializes with no offset). month inputs bind to
  // YYYY-MM, date inputs to YYYY-MM-DD. (A non-UTC API server would shift a
  // bare DATE by its offset — a global pg DATE type-parser fix tracked
  // separately; it does not affect the deployed product.)
  if (f?.type === 'month') return s.slice(0, 7);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  if (f?.type === 'date') return s.slice(0, 10);
  return s;
};

const buildForm = (record, sections, defaults) => {
  const form = {};
  for (const section of sections) {
    for (const f of section.fields) {
      form[f.name] = toFormValue(f.isAttribute ? record?.attributes?.[f.name] : record?.[f.name], f);
    }
  }
  if (!record) Object.assign(form, defaults || {});
  return form;
};

// '' → null (never 0 — Number('') is 0 and would corrupt weighted averages
// server-side); numeric fields coerced so the API receives numbers. Catalog
// attribute fields are folded into `attributes`, preserving existing keys.
const cleanPayload = (form, sections, record) => {
  const fieldByName = new Map(sections.flatMap((s) => s.fields).map((f) => [f.name, f]));
  const out = {};
  const attributes = { ...(record?.attributes || {}) };
  let attributesTouched = false;

  for (const [name, raw] of Object.entries(form)) {
    const def = fieldByName.get(name);
    let value;
    if (def?.boolean) value = raw === 'true';        // booleans are never null (select is bound)
    else if (raw === '') value = null;
    else if (def?.type === 'number') {
      const n = Number(raw);
      value = Number.isFinite(n) ? n : null;
    } else if (def?.type === 'month') {
      value = `${raw}-01`;                            // YYYY-MM → first-of-month date
    } else value = raw;

    if (def?.isAttribute) { attributes[name] = value; attributesTouched = true; }
    else out[name] = value;
  }
  if (attributesTouched) out.attributes = attributes;
  return out;
};

export default function RecordDrawer({
  open,
  record,          // existing row, or null for "add"
  sections,        // catalog sections for this record kind
  defaults,        // seed values for a fresh record (keeps it metric-eligible)
  noun,            // 'lease' | 'plot' — copy
  titleFor,        // (record) => string
  saving = false,
  onSave,          // (payload) => void
  onDelete,        // (record) => void — only offered on existing records
  onClose,
}) {
  const [form, setForm] = useState(() => buildForm(record, sections, defaults));
  const isEdit = Boolean(record?.id);
  const setField = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Remove this ${noun}?`,
      description: `${titleFor(record) || 'This record'} will be removed from the register. The change is kept in the deal's audit history.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (ok) onDelete(record);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? (titleFor(record) || `Edit ${noun}`) : `Add ${noun}`}
      description={isEdit ? 'Changes save on confirm and are audit-logged.' : 'Only what you know — every field is optional at sourcing stage.'}
      size="lg"
      footer={(
        <div className="flex w-full items-center justify-between gap-3">
          <div>
            {isEdit && (
              <Button variant="ghost" onClick={handleDelete} disabled={saving}>
                {`Remove ${noun}`}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => onSave(cleanPayload(form, sections, record))}>
              {isEdit ? 'Save changes' : `Add ${noun}`}
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
                      {/* Descriptor selects are optional — allow clearing to unset. */}
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
