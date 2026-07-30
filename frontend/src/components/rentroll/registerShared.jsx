import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Field, Input, ErrorState, Button } from '../../design-system';
import { useSaveRegisterSettings } from '../../hooks/useRentRoll';
import { rentRollAPI } from '../../services/api';
import { downloadAxiosResponse } from '../../utils/download';
import { toast } from '../common/Toast';

// Shared scaffolding for the per-family register views (lease / sales / hotel).
// Keeping these in one place means all three families autosave, warn about
// staleness, and render their settings row identically.

export const fmtPct = (n) => `${n.toFixed(1)}%`;
export const fmtYears = (n) => `${n.toFixed(1)} yr`;
export const fmtCr = (n) => `₹${(n / 1e7).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr`;
export const fmtCrOrL = (n) => {
  if (Math.abs(n) >= 1e7) return fmtCr(n);
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};
export const fmtSignedPct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
export const fmtInt = (n) => Math.round(n).toLocaleString('en-IN');

// Register-level scalars autosave (Yield Studio pattern): 700ms debounce,
// change-gated so opening the tab never fires a phantom save. Shared by every
// family; a family simply chooses whether to render the leasable-area field.
export function useSettingsAutosave(dealId, register) {
  const save = useSaveRegisterSettings();
  const [form, setForm] = useState({ as_of_date: '', total_leasable_area_sqft: '' });
  const lastSyncedRef = useRef(null);

  useEffect(() => {
    const next = {
      as_of_date: register?.as_of_date ? String(register.as_of_date).slice(0, 10) : '',
      total_leasable_area_sqft: register?.total_leasable_area_sqft ?? '',
    };
    setForm(next);
    lastSyncedRef.current = JSON.stringify(next);
  }, [register?.id, register?.as_of_date, register?.total_leasable_area_sqft]);

  useEffect(() => {
    const serialized = JSON.stringify(form);
    if (serialized === lastSyncedRef.current) return undefined;
    const t = setTimeout(() => {
      lastSyncedRef.current = serialized;
      save.mutate({
        dealId,
        as_of_date: form.as_of_date || null,
        total_leasable_area_sqft: form.total_leasable_area_sqft === ''
          ? null
          : Number(form.total_leasable_area_sqft),
      });
    }, 700);
    return () => clearTimeout(t);
  }, [form, dealId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { form, setForm, saving: save.isPending };
}

// The saved model cites a frozen snapshot; if the live register's content hash
// has moved on, the model is quoting older evidence. One banner, every family.
export function StaleModelBanner({ provenance, liveDataHash }) {
  const stale = Boolean(provenance?.dataHash && liveDataHash && provenance.dataHash !== liveDataHash);
  if (!stale) return null;
  const noun = provenance.basisNoun || 'record';
  const count = provenance.basisCount ?? '—';
  return (
    <ErrorState tone="warn" title="The saved financial model cites an older register">
      {`Assumptions were seeded from the snapshot of ${provenance.asOfDate || 'an earlier date'} (${count} ${noun}${count === 1 ? '' : 's'}); the register has changed since. Use “Apply to Financials” to re-seed, or keep the older snapshot deliberately.`}
    </ErrorState>
  );
}

export function RegisterSettingsRow({ form, setForm, canEdit, showLeasableArea }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3 mb-4">
      <Field label="Register as of" helper="Every derived metric anchors to this date.">
        <Input
          type="date"
          value={form.as_of_date}
          onChange={(e) => setForm((f) => ({ ...f, as_of_date: e.target.value }))}
          disabled={!canEdit}
        />
      </Field>
      {showLeasableArea && (
        <Field label="Total leasable area (sqft)" helper="Occupancy denominator. Falls back to the summed row areas.">
          <Input
            type="number"
            inputMode="decimal"
            value={form.total_leasable_area_sqft}
            onChange={(e) => setForm((f) => ({ ...f, total_leasable_area_sqft: e.target.value }))}
            disabled={!canEdit}
          />
        </Field>
      )}
    </div>
  );
}

// Downloads a schema-correct blank XLSX template for this deal's register
// family — the exact columns (with Excel dropdowns) the register accepts, so a
// user can prepare data offline. Server-generated; the filename comes from the
// response's Content-Disposition.
export function TemplateDownloadButton({ dealId, variant = 'secondary', size = 'sm' }) {
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    setBusy(true);
    try {
      const res = await rentRollAPI.downloadTemplate(dealId);
      const cd = res.headers?.['content-disposition'] || '';
      const match = /filename="?([^";]+)"?/.exec(cd);
      downloadAxiosResponse(res, (match && match[1]) || 'Acureal-register-template.xlsx');
      toast.success('Template downloaded — fill one row per record in Excel, keeping the header row as-is.');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not download the template.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant={variant} size={size} leftIcon={<Download size={14} />} loading={busy} onClick={onClick}>
      Download template
    </Button>
  );
}

export function RegisterUnavailable() {
  return (
    <ErrorState tone="info" title="Register storage is being provisioned">
      The database update for deal registers has not been applied yet. Data entry opens as soon as it lands.
    </ErrorState>
  );
}
