import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { joinList, parseList, toNum } from '../../utils/masterPlanHelpers';

/**
 * Initial-form state used when the modal opens in "Add Zone" mode (or as a
 * baseline that incoming `zone` props are spread on top of in edit mode).
 *
 * Kept inside this component file because it's exclusively the modal's
 * concern — no other screen needs a "blank zone" stub.
 */
const EMPTY_ZONE = {
  zone_code: '',
  zone_name: '',
  plan_version: 'RMP 2031 Draft',
  city: 'Bengaluru',
  permissible_fsi_base: '',
  permissible_fsi_max: '',
  ground_coverage_pct: '',
  building_height_max_m: '',
  road_width_min_m: '',
  permissible_uses: '',
  prohibited_uses: '',
  notes: '',
  source_page: '',
  source_section: '',
  fsi_road_width_rules: [],
  setback_rules: { front_m: '', rear_m: '', side_m: '' },
  effective_from: '',
  effective_to: '',
  review_status: 'pending',
};

/**
 * Create-or-edit modal for a master-plan zone (RMP 2031, etc).
 *
 * Extracted from `pages/MasterPlanAdminPage.jsx` as part of the Task #6
 * decomposition (Tier B — modal extractions). Behaviour-preserving move,
 * no logic changes.
 *
 * Props:
 *   - isOpen:     whether the modal is currently mounted
 *   - onClose:    closes the modal without saving
 *   - zone:       the zone being edited (null/undefined when creating)
 *   - onSubmit:   called with the normalised payload on save
 *   - submitting: disables the save button while a mutation is in flight
 */
export default function ZoneModal({ isOpen, onClose, zone, onSubmit, submitting }) {
  const [form, setForm] = useState(EMPTY_ZONE);

  useMemo(() => {
    if (!isOpen) return;
    if (zone) {
      setForm({
        ...EMPTY_ZONE,
        ...zone,
        permissible_uses: joinList(zone.permissible_uses),
        prohibited_uses: joinList(zone.prohibited_uses),
        fsi_road_width_rules: zone.fsi_road_width_rules || [],
        setback_rules: zone.setback_rules || { front_m: '', rear_m: '', side_m: '' },
        effective_from: zone.effective_from ? String(zone.effective_from).slice(0, 10) : '',
        effective_to:   zone.effective_to   ? String(zone.effective_to).slice(0, 10)   : '',
        source_page: zone.source_page ?? '',
        source_section: zone.source_section ?? '',
      });
    } else {
      setForm(EMPTY_ZONE);
    }
  }, [isOpen, zone?.id]);

  if (!isOpen) return null;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setSetback = (k, v) => setForm((f) => ({ ...f, setback_rules: { ...f.setback_rules, [k]: v } }));

  const addTier = () =>
    setForm((f) => ({
      ...f,
      fsi_road_width_rules: [...f.fsi_road_width_rules, { road_width_m: '', fsi: '' }],
    }));
  const updateTier = (i, k, v) =>
    setForm((f) => ({
      ...f,
      fsi_road_width_rules: f.fsi_road_width_rules.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)),
    }));
  const removeTier = (i) =>
    setForm((f) => ({
      ...f,
      fsi_road_width_rules: f.fsi_road_width_rules.filter((_, idx) => idx !== i),
    }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.zone_code.trim() || !form.zone_name.trim()) return;
    const payload = {
      zone_code: form.zone_code.trim(),
      zone_name: form.zone_name.trim(),
      plan_version: form.plan_version?.trim() || null,
      city: form.city?.trim() || 'Bengaluru',
      permissible_fsi_base: toNum(form.permissible_fsi_base),
      permissible_fsi_max:  toNum(form.permissible_fsi_max),
      ground_coverage_pct:  toNum(form.ground_coverage_pct),
      building_height_max_m: toNum(form.building_height_max_m),
      road_width_min_m:      toNum(form.road_width_min_m),
      permissible_uses: parseList(form.permissible_uses),
      prohibited_uses: parseList(form.prohibited_uses),
      notes: form.notes?.trim() || null,
      source_page: toNum(form.source_page),
      source_section: form.source_section?.trim() || null,
      fsi_road_width_rules: form.fsi_road_width_rules
        .map((r) => ({ road_width_m: toNum(r.road_width_m), fsi: toNum(r.fsi) }))
        .filter((r) => r.road_width_m != null && r.fsi != null),
      setback_rules: {
        front_m: toNum(form.setback_rules.front_m),
        rear_m:  toNum(form.setback_rules.rear_m),
        side_m:  toNum(form.setback_rules.side_m),
      },
      effective_from: form.effective_from || null,
      effective_to:   form.effective_to || null,
      review_status: form.review_status,
    };
    onSubmit(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-bg-elevated rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-content-primary">
            {zone ? `Edit Zone — ${zone.zone_code}` : 'Add Zone'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-secondary text-content-muted hover:text-content-secondary">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Zone Code *</label>
              <input className="input" required value={form.zone_code} onChange={(e) => set('zone_code', e.target.value)} placeholder="R1" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-content-secondary mb-1">Zone Name *</label>
              <input className="input" required value={form.zone_name} onChange={(e) => set('zone_name', e.target.value)} placeholder="Residential (Main)" />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Plan Version</label>
              <input className="input" value={form.plan_version} onChange={(e) => set('plan_version', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">City</label>
              <input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Review Status</label>
              <select className="input" value={form.review_status} onChange={(e) => set('review_status', e.target.value)}>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">FSI Base</label>
              <input type="number" step="0.01" className="input" value={form.permissible_fsi_base} onChange={(e) => set('permissible_fsi_base', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">FSI Max</label>
              <input type="number" step="0.01" className="input" value={form.permissible_fsi_max} onChange={(e) => set('permissible_fsi_max', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Ground Cov %</label>
              <input type="number" step="0.01" className="input" value={form.ground_coverage_pct} onChange={(e) => set('ground_coverage_pct', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Height Max (m)</label>
              <input type="number" step="0.01" className="input" value={form.building_height_max_m} onChange={(e) => set('building_height_max_m', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Road Min (m)</label>
              <input type="number" step="0.01" className="input" value={form.road_width_min_m} onChange={(e) => set('road_width_min_m', e.target.value)} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-content-secondary">FSI Road-Width Tiers</label>
              <button type="button" onClick={addTier} className="text-xs text-primary-600 hover:underline inline-flex items-center gap-1">
                <Plus size={12} /> Add tier
              </button>
            </div>
            {form.fsi_road_width_rules.length === 0 ? (
              <p className="text-xs text-content-muted italic">No tiers — FSI will fall back to base value.</p>
            ) : (
              <div className="space-y-2">
                {form.fsi_road_width_rules.map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr,1fr,auto] gap-2 items-center">
                    <input type="number" step="0.01" placeholder="road width ≥ (m)" className="input" value={r.road_width_m} onChange={(e) => updateTier(i, 'road_width_m', e.target.value)} />
                    <input type="number" step="0.01" placeholder="FSI" className="input" value={r.fsi} onChange={(e) => updateTier(i, 'fsi', e.target.value)} />
                    <button type="button" onClick={() => removeTier(i)} className="text-content-muted hover:text-red-500 p-1">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Setback Front (m)</label>
              <input type="number" step="0.01" className="input" value={form.setback_rules.front_m ?? ''} onChange={(e) => setSetback('front_m', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Setback Rear (m)</label>
              <input type="number" step="0.01" className="input" value={form.setback_rules.rear_m ?? ''} onChange={(e) => setSetback('rear_m', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Setback Side (m)</label>
              <input type="number" step="0.01" className="input" value={form.setback_rules.side_m ?? ''} onChange={(e) => setSetback('side_m', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Permissible Uses (comma-separated)</label>
              <input className="input" value={form.permissible_uses} onChange={(e) => set('permissible_uses', e.target.value)} placeholder="Residential, Retail, Parks" />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Prohibited Uses (comma-separated)</label>
              <input className="input" value={form.prohibited_uses} onChange={(e) => set('prohibited_uses', e.target.value)} placeholder="Industrial, Slaughterhouse" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-content-secondary mb-1">Notes (verbatim clause text)</label>
            <textarea
              rows={4}
              className="input text-sm w-full"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Paste the verbatim zoning regulation clause from the source PDF."
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Source Page</label>
              <input type="number" className="input" value={form.source_page} onChange={(e) => set('source_page', e.target.value)} />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-content-secondary mb-1">Source Section</label>
              <input className="input" value={form.source_section} onChange={(e) => set('source_section', e.target.value)} placeholder="Part II - Zoning Regulations" />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Effective From</label>
              <input type="date" className="input" value={form.effective_from} onChange={(e) => set('effective_from', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Effective To</label>
              <input type="date" className="input" value={form.effective_to} onChange={(e) => set('effective_to', e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-hairline">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-content-secondary hover:bg-bg-secondary">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="px-3 py-1.5 rounded-lg text-sm bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60">
              {submitting ? 'Saving…' : (zone ? 'Save changes' : 'Create zone')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
