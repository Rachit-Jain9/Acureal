import { useMemo, useState } from 'react';
import {
  Shield, Search, CheckCircle2, Info, Unlink, Edit3, ExternalLink, Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import useAuthStore from '../../store/authStore';
import { useZones, useZone } from '../../hooks/useMasterPlan';
import { useUpdateProperty } from '../../hooks/useProperties';
import { calculateEffectiveFSI, matchedTier, fmtNum } from '../../utils/buildability';
import { SectionHeader } from '../../design-system';

const EDITOR_ROLES = ['admin', 'owner', 'editor', 'analyst'];

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
  const activeTier = useMemo(
    () => (zone ? matchedTier(zone, roadWidthM) : null),
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
      <div className="card-editorial">
        <SectionHeader size="sm" icon={Shield} title="Master Plan Zone" className="mb-2" />
        <p className="text-xs text-content-muted italic">
          Link a property to this deal to assign a master plan zone.
        </p>
      </div>
    );
  }

  return (
    <div className="card-editorial p-0 overflow-hidden">
      {/* Header */}
      <div className={clsx(
        'relative px-5 py-4 flex items-start justify-between gap-3',
        zone
          ? 'bg-gradient-to-r from-primary-600 via-primary-500 to-indigo-500 text-white'
          : 'bg-gradient-to-r from-gray-50 to-white border-b border-hairline',
      )}>
        <div className="flex items-start gap-3">
          <div className={clsx(
            'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
            zone ? 'bg-white/20 text-white' : 'bg-primary-50 text-primary-600',
          )}>
            <Shield size={16} />
          </div>
          <div>
            <div className={clsx(
              'text-[10px] font-semibold uppercase tracking-[0.14em]',
              zone ? 'text-white/80' : 'text-content-secondary',
            )}>
              Master Plan Zone
            </div>
            {zone ? (
              <>
                <div className="text-base font-semibold mt-0.5">
                  {zone.zone_code} <span className="opacity-80 font-normal">— {zone.zone_name}</span>
                </div>
                <div className="text-[11px] mt-0.5 text-white/80">
                  {zone.plan_version || 'Bengaluru Master Plan'}
                  {zone.source_section ? ` · ${zone.source_section}` : ''}
                  {zone.source_page ? ` · p.${zone.source_page}` : ''}
                </div>
              </>
            ) : (
              <>
                <div className="text-base font-semibold mt-0.5 text-content-primary">Not assigned</div>
                <div className="text-[11px] mt-0.5 text-content-secondary">
                  Link a regulated zone to drive FSI, setbacks, and buildability downstream.
                </div>
              </>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setShowPicker((s) => !s)}
              className={clsx(
                'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                zone
                  ? 'bg-white/15 hover:bg-white/25 text-white'
                  : 'bg-primary-50 hover:bg-primary-100 text-primary-700',
              )}
            >
              <Edit3 size={11} />
              {zone ? 'Change' : 'Assign'}
            </button>
            {zone && (
              <button
                onClick={clearZone}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white/90 text-xs"
                title="Unassign zone"
              >
                <Unlink size={11} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Picker */}
      {showPicker && canEdit && (
        <div className="px-5 py-3 border-b border-hairline bg-bg-secondary">
          <div className="relative mb-2">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-content-muted" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search approved zones (e.g. R-PZ-A, Commercial)…"
              className="input pl-7 text-sm"
            />
          </div>
          {searching ? (
            <p className="text-xs text-content-muted">Searching…</p>
          ) : searchResults.length === 0 ? (
            <div className="text-xs text-content-muted italic">
              No approved zones yet.{' '}
              <Link to="/dashboard/settings/master-plan" className="text-primary-600 hover:underline">
                Open the zone library
              </Link>
              .
            </div>
          ) : (
            <ul className="max-h-56 overflow-y-auto divide-y divide-hairline rounded-lg bg-white border border-hairline">
              {searchResults.map((z) => (
                <li key={z.id}>
                  <button
                    onClick={() => assignZone(z)}
                    className="w-full text-left px-3 py-2 hover:bg-primary-50/40 flex items-start justify-between gap-2"
                  >
                    <div>
                      <div className="text-sm font-medium text-content-primary">
                        {z.zone_code} <span className="text-content-muted">—</span> {z.zone_name}
                      </div>
                      <div className="text-xs text-content-secondary">
                        {z.plan_version || '—'}
                        {z.permissible_fsi_base != null ? ` · FSI base ${z.permissible_fsi_base}` : ''}
                      </div>
                    </div>
                    <CheckCircle2 size={14} className="text-primary-500 flex-shrink-0 mt-0.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Body */}
      <div className="p-5">
        {!property.zone_id ? (
          <p className="text-sm text-content-secondary italic">
            {canEdit
              ? 'Use “Assign” above to search and link a zone.'
              : 'Ask an analyst to assign a zone to pull regulatory data.'}
          </p>
        ) : zoneLoading ? (
          <p className="text-xs text-content-muted">Loading zone…</p>
        ) : !zone ? (
          <p className="text-xs text-red-500">Assigned zone not found — it may have been removed.</p>
        ) : (
          <div className="space-y-4">
            {/* Headline stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <HeadlineStat label="Effective FSI" value={fmtNum(effectiveFsi, 2)} accent="primary" icon={Sparkles} />
              <HeadlineStat label="FSI Base"      value={fmtNum(zone.permissible_fsi_base, 2)} />
              <HeadlineStat label="FSI Max"       value={fmtNum(zone.permissible_fsi_max, 2)} />
              <HeadlineStat label="Ground Cov %"  value={zone.ground_coverage_pct != null ? `${fmtNum(zone.ground_coverage_pct, 1)}%` : '—'} />
            </div>

            {/* Tiers */}
            {Array.isArray(zone.fsi_road_width_rules) && zone.fsi_road_width_rules.length > 0 && (
              <div className="rounded-xl bg-gradient-to-br from-gray-50 to-white border border-hairline p-3">
                <div className="text-[11px] font-semibold text-content-secondary uppercase tracking-[0.1em] mb-2">
                  Road-width FSI tiers
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[...zone.fsi_road_width_rules]
                    .sort((a, b) => Number(a.road_width_m) - Number(b.road_width_m))
                    .map((r, i) => {
                      const isActive = activeTier && Number(activeTier.rule.road_width_m) === Number(r.road_width_m);
                      return (
                        <span
                          key={i}
                          className={clsx(
                            'text-xs px-2.5 py-1 rounded-full border transition-all',
                            isActive
                              ? 'bg-primary-600 text-white border-primary-600 shadow-sm scale-105 font-semibold'
                              : 'bg-white text-content-secondary border-hairline-strong',
                          )}
                        >
                          <span className="opacity-70">≥</span> {r.road_width_m}m → <span className="font-semibold">FSI {r.fsi}</span>
                        </span>
                      );
                    })}
                </div>
                <div className="mt-2 text-[11px] text-content-secondary flex items-center gap-1">
                  <Info size={10} />
                  Road width on file: {roadWidthM != null ? <span className="font-medium text-content-secondary ml-1">{roadWidthM} m</span> : 'not set'}
                  {activeTier ? <span className="text-primary-600 ml-2">• matched tier applied</span> : null}
                </div>
              </div>
            )}

            {/* Setbacks inline */}
            {(zone.setback_rules?.front_m != null
              || zone.setback_rules?.rear_m != null
              || zone.setback_rules?.side_m != null) && (
              <div className="text-xs text-content-secondary flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium text-content-secondary">Setbacks</span>
                <span>front {fmtNum(zone.setback_rules?.front_m, 1)} m</span>
                <span className="text-content-muted">•</span>
                <span>rear {fmtNum(zone.setback_rules?.rear_m, 1)} m</span>
                <span className="text-content-muted">•</span>
                <span>side {fmtNum(zone.setback_rules?.side_m, 1)} m</span>
                {zone.building_height_max_m != null && (
                  <>
                    <span className="text-content-muted">•</span>
                    <span>height cap {zone.building_height_max_m} m</span>
                  </>
                )}
              </div>
            )}

            {/* Uses */}
            {(Array.isArray(zone.permissible_uses) && zone.permissible_uses.length > 0) && (
              <div className="text-xs text-content-secondary">
                <span className="font-medium text-content-secondary">Permissible:</span> {zone.permissible_uses.join(', ')}
              </div>
            )}
            {(Array.isArray(zone.prohibited_uses) && zone.prohibited_uses.length > 0) && (
              <div className="text-xs text-content-secondary">
                <span className="font-medium text-content-secondary">Prohibited:</span> {zone.prohibited_uses.join(', ')}
              </div>
            )}

            {/* Verbatim clause */}
            {zone.notes && (
              <details className="rounded-lg bg-amber-50 border border-amber-100 group" open>
                <summary className="px-3 py-2 cursor-pointer text-xs font-semibold text-amber-800 list-none flex items-center justify-between">
                  <span>Verbatim clause</span>
                  <span className="text-[10px] font-normal text-amber-600 opacity-70">
                    {zone.source_section || zone.plan_version || 'Source'}
                  </span>
                </summary>
                <p className="px-3 pb-3 text-xs text-amber-900 whitespace-pre-wrap">{zone.notes}</p>
              </details>
            )}

            {/* Manual override banner */}
            {manualOverride && (
              <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-100 p-2 text-xs text-blue-800">
                <Info size={12} className="mt-0.5 flex-shrink-0" />
                <div>
                  Manual FSI override in use ({fmtNum(property.permissible_fsi, 2)}).
                  Master plan suggests <span className="font-semibold">{fmtNum(effectiveFsi, 2)}</span> at this road width.
                </div>
              </div>
            )}

            {/* Site notes */}
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Site-specific zone notes</label>
              <textarea
                rows={2}
                value={zoneNotesDraft}
                onChange={(e) => setZoneNotesDraft(e.target.value)}
                disabled={!canEdit}
                placeholder="Why this zone applies here, deviations, pending clarifications with BBMP / BDA…"
                className="input text-sm w-full"
              />
              {canEdit && zoneNotesDraft !== (property?.zone_notes || '') && (
                <div className="flex justify-end mt-1">
                  <button onClick={saveNotes} className="text-xs text-primary-600 hover:underline font-medium">
                    Save notes
                  </button>
                </div>
              )}
            </div>

            {/* Footer disclaimer */}
            <div className="flex items-start gap-2 text-[11px] text-content-secondary border-t border-hairline pt-3">
              <Info size={11} className="mt-0.5 flex-shrink-0" />
              <div>
                Regulatory data sourced from {zone.plan_version || 'Bengaluru Master Plan'}.
                Verify with BBMP / BDA before using in underwriting.
                {zone.reviewed_at && (
                  <> Last reviewed {String(zone.reviewed_at).slice(0, 10)}.</>
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
    </div>
  );
}

function HeadlineStat({ label, value, accent, icon: Icon }) {
  const cls = accent === 'primary'
    ? 'bg-gradient-to-br from-primary-50 to-indigo-50 border border-primary-100'
    : 'bg-bg-secondary border border-hairline';
  const textCls = accent === 'primary' ? 'text-primary-700' : 'text-content-primary';
  return (
    <div className={clsx('rounded-xl p-3 relative overflow-hidden', cls)}>
      {Icon && accent === 'primary' && (
        <Icon size={32} className="absolute -right-1 -bottom-1 text-primary-200/60" />
      )}
      <div className="text-[10px] uppercase tracking-[0.1em] font-medium text-content-secondary">{label}</div>
      <div className={clsx('mt-1 text-lg font-bold leading-none', textCls)}>{value}</div>
    </div>
  );
}
