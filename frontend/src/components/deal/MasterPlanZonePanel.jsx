import { useMemo, useState } from 'react';
import {
  Shield, Search, CheckCircle2, Info, Unlink, Edit3, ExternalLink,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import useAuthStore from '../../store/authStore';
import { useZones, useZone, calculateEffectiveFSI } from '../../hooks/useMasterPlan';
import { useUpdateProperty } from '../../hooks/useProperties';

const EDITOR_ROLES = ['admin', 'owner', 'editor', 'analyst'];

function fmt(n, decimals = 2) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: decimals });
}

export default function MasterPlanZonePanel({ property }) {
  const { user } = useAuthStore();
  const canEdit = EDITOR_ROLES.includes(String(user?.role || '').toLowerCase());

  const [search, setSearch] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [zoneNotesDraft, setZoneNotesDraft] = useState(property?.zone_notes || '');

  const updateProp = useUpdateProperty();
  const { data: zone, isLoading: zoneLoading } = useZone(property?.zone_id);
  const { data: searchResults = [], isLoading: searching } = useZones(
    search.trim().length >= 1
      ? { search: search.trim(), status: 'approved', limit: 15 }
      : { status: 'approved', limit: 15 },
  );

  const roadWidthM = property?.road_width_mtrs ?? property?.road_width_m ?? null;
  const effectiveFsi = useMemo(
    () => (zone ? calculateEffectiveFSI(zone, roadWidthM) : null),
    [zone, roadWidthM],
  );

  const manualOverride = property?.permissible_fsi != null && zone
    && Number(property.permissible_fsi).toFixed(2) !== (effectiveFsi == null ? '' : Number(effectiveFsi).toFixed(2));

  const assignZone = async (z) => {
    await updateProp.mutateAsync({
      id: property.id,
      data: { zoneId: z.id, zoneNotes: zoneNotesDraft || null },
    });
    setShowPicker(false);
    setSearch('');
  };

  const clearZone = async () => {
    await updateProp.mutateAsync({ id: property.id, data: { zoneId: null } });
  };

  const saveNotes = async () => {
    await updateProp.mutateAsync({ id: property.id, data: { zoneNotes: zoneNotesDraft || null } });
  };

  if (!property?.id) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={16} className="text-primary-600" />
          <h3 className="text-sm font-semibold text-gray-800">Master Plan Zone</h3>
        </div>
        <p className="text-xs text-gray-400 italic">
          Link a property to this deal to assign a master plan zone.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-primary-600" />
          <h3 className="text-sm font-semibold text-gray-800">Master Plan Zone</h3>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowPicker((s) => !s)}
              className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline"
            >
              <Edit3 size={12} />
              {zone ? 'Change' : 'Assign'}
            </button>
            {zone && (
              <button
                onClick={clearZone}
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 ml-2"
                title="Unassign zone"
              >
                <Unlink size={12} /> Clear
              </button>
            )}
          </div>
        )}
      </div>

      {showPicker && canEdit && (
        <div className="mb-3 p-3 rounded-lg border border-gray-200 bg-gray-50">
          <div className="relative mb-2">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search approved zones (e.g. R1, Commercial)…"
              className="input pl-7 text-sm"
            />
          </div>
          {searching ? (
            <p className="text-xs text-gray-400">Searching…</p>
          ) : searchResults.length === 0 ? (
            <div className="text-xs text-gray-400 italic">
              No approved zones yet.{' '}
              <Link to="/dashboard/settings/master-plan" className="text-primary-600 hover:underline">
                Seed the zone library
              </Link>
              .
            </div>
          ) : (
            <ul className="max-h-56 overflow-y-auto divide-y divide-gray-100">
              {searchResults.map((z) => (
                <li key={z.id}>
                  <button
                    onClick={() => assignZone(z)}
                    className="w-full text-left px-2 py-2 hover:bg-white rounded flex items-start justify-between gap-2"
                  >
                    <div>
                      <div className="text-sm font-medium text-gray-800">
                        {z.zone_code} — {z.zone_name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {z.plan_version || '—'}
                        {z.permissible_fsi_base != null ? ` • FSI base ${z.permissible_fsi_base}` : ''}
                      </div>
                    </div>
                    <CheckCircle2 size={14} className="text-primary-500 flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!property.zone_id ? (
        <p className="text-xs text-gray-500 italic">
          No master plan zone assigned.{' '}
          {canEdit
            ? 'Use “Assign” above to search and link one.'
            : 'Ask an analyst to assign a zone to pull regulatory data.'}
        </p>
      ) : zoneLoading ? (
        <p className="text-xs text-gray-400">Loading zone…</p>
      ) : !zone ? (
        <p className="text-xs text-red-500">Assigned zone not found — it may have been removed.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-900">
                {zone.zone_code} — {zone.zone_name}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                Source: {zone.plan_version || 'Master Plan'}
                {zone.source_section ? ` • ${zone.source_section}` : ''}
                {zone.source_page ? ` • p.${zone.source_page}` : ''}
              </div>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs">
              <CheckCircle2 size={11} /> Analyst-approved
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Effective FSI" value={fmt(effectiveFsi)} accent />
            <Stat label="FSI Base" value={fmt(zone.permissible_fsi_base)} />
            <Stat label="FSI Max" value={fmt(zone.permissible_fsi_max)} />
            <Stat label="Ground Cov %" value={fmt(zone.ground_coverage_pct, 1)} />
          </div>

          {Array.isArray(zone.fsi_road_width_rules) && zone.fsi_road_width_rules.length > 0 && (
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs font-medium text-gray-600 mb-1">Road-width FSI tiers</div>
              <div className="flex flex-wrap gap-2">
                {[...zone.fsi_road_width_rules]
                  .sort((a, b) => Number(a.road_width_m) - Number(b.road_width_m))
                  .map((r, i) => {
                    const active = roadWidthM != null && Number(roadWidthM) >= Number(r.road_width_m)
                      && effectiveFsi != null && Number(r.fsi) === Number(effectiveFsi);
                    return (
                      <span
                        key={i}
                        className={clsx(
                          'text-xs px-2 py-0.5 rounded-full',
                          active ? 'bg-primary-100 text-primary-700 font-medium' : 'bg-white text-gray-600 border border-gray-200',
                        )}
                      >
                        ≥ {r.road_width_m}m → FSI {r.fsi}
                      </span>
                    );
                  })}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                Road width on file: {roadWidthM != null ? `${roadWidthM} m` : 'not set'}
              </div>
            </div>
          )}

          {(zone.setback_rules?.front_m != null
            || zone.setback_rules?.rear_m != null
            || zone.setback_rules?.side_m != null) && (
            <div className="text-xs text-gray-600">
              <span className="font-medium text-gray-700">Setbacks:</span>{' '}
              front {fmt(zone.setback_rules?.front_m)} m • rear {fmt(zone.setback_rules?.rear_m)} m • side {fmt(zone.setback_rules?.side_m)} m
            </div>
          )}

          {Array.isArray(zone.permissible_uses) && zone.permissible_uses.length > 0 && (
            <div className="text-xs text-gray-600">
              <span className="font-medium text-gray-700">Permissible:</span> {zone.permissible_uses.join(', ')}
            </div>
          )}
          {Array.isArray(zone.prohibited_uses) && zone.prohibited_uses.length > 0 && (
            <div className="text-xs text-gray-600">
              <span className="font-medium text-gray-700">Prohibited:</span> {zone.prohibited_uses.join(', ')}
            </div>
          )}

          {zone.notes && (
            <div className="rounded-lg bg-amber-50 border border-amber-100 p-3">
              <div className="text-xs font-medium text-amber-800 mb-1">Verbatim clause</div>
              <p className="text-xs text-amber-900 whitespace-pre-wrap">{zone.notes}</p>
            </div>
          )}

          {manualOverride && (
            <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-100 p-2 text-xs text-blue-800">
              <Info size={12} className="mt-0.5 flex-shrink-0" />
              <div>
                Manual FSI override in use ({fmt(property.permissible_fsi)}). Master plan suggests {fmt(effectiveFsi)}.
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Zone Notes (site-specific)</label>
            <textarea
              rows={2}
              value={zoneNotesDraft}
              onChange={(e) => setZoneNotesDraft(e.target.value)}
              disabled={!canEdit}
              placeholder="Analyst notes about why this zone applies, deviations, pending verification, etc."
              className="input text-sm w-full"
            />
            {canEdit && zoneNotesDraft !== (property?.zone_notes || '') && (
              <div className="flex justify-end mt-1">
                <button onClick={saveNotes} className="text-xs text-primary-600 hover:underline">
                  Save notes
                </button>
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 text-[11px] text-gray-500 border-t border-gray-100 pt-2">
            <Info size={11} className="mt-0.5 flex-shrink-0" />
            <div>
              Regulatory data sourced from {zone.plan_version || 'Bengaluru Master Plan'} (OpenCity.in).
              Verify with BBMP / BDA before using in underwriting.
              {zone.reviewed_at && (
                <> Last reviewed: {String(zone.reviewed_at).slice(0, 10)}.</>
              )}
              {canEdit && (
                <>
                  {' '}
                  <Link to="/dashboard/settings/master-plan" className="text-primary-600 hover:underline inline-flex items-center gap-0.5">
                    Manage zones <ExternalLink size={10} />
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className={clsx('rounded-lg p-2 text-center', accent ? 'bg-primary-50' : 'bg-gray-50')}>
      <div className="text-[10px] uppercase text-gray-500 tracking-wide">{label}</div>
      <div className={clsx('text-sm font-semibold', accent ? 'text-primary-700' : 'text-gray-800')}>{value}</div>
    </div>
  );
}
