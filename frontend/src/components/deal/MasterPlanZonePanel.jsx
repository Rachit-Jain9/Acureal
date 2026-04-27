import { useState } from 'react';
import { CheckCircle2, Edit3, ExternalLink, Info, Search, Shield, Unlink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import useAuthStore from '../../store/authStore';
import { useZones, useZone } from '../../hooks/useMasterPlan';
import { useUpdateProperty } from '../../hooks/useProperties';
import { SectionHeader, ErrorState } from '../../design-system';

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

  const assignZone = async (selectedZone) => {
    await updateProp.mutateAsync({
      id: property.id,
      data: { zoneId: selectedZone.id, zoneNotes: zoneNotesDraft || null },
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
          Link a property before assigning a master plan zone.
        </p>
      </div>
    );
  }

  return (
    <div className="card-editorial p-0 overflow-hidden">
      <div
        className={clsx(
          'relative px-5 py-4 flex items-start justify-between gap-3',
          zone
            ? 'bg-primary-600 text-white'
            : 'bg-bg-elevated border-b border-hairline',
        )}
      >
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={clsx(
              'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
              zone ? 'bg-white/20 text-white' : 'bg-primary-50 text-primary-600',
            )}
          >
            <Shield size={16} />
          </div>
          <div className="min-w-0">
            <div
              className={clsx(
                'text-[10px] font-semibold uppercase tracking-[0.14em]',
                zone ? 'text-white/80' : 'text-content-secondary',
              )}
            >
              Reviewed Zone Assignment
            </div>
            {zone ? (
              <>
                <div className="mt-0.5 text-base font-semibold truncate">
                  {zone.zone_code} <span className="font-normal opacity-80">{zone.zone_name}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-white/80">
                  {[zone.plan_version, zone.source_section, zone.source_page ? `p.${zone.source_page}` : null]
                    .filter(Boolean)
                    .join(' | ')}
                </div>
              </>
            ) : (
              <>
                <div className="mt-0.5 text-base font-semibold text-content-primary">Not assigned</div>
                <div className="mt-0.5 text-[11px] text-content-secondary">
                  Assign a reviewed zone to unlock backend FAR matrix matching.
                </div>
              </>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setShowPicker((value) => !value)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition',
                zone ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-primary-50 text-primary-700 hover:bg-primary-100',
              )}
            >
              <Edit3 size={13} />
              {zone ? 'Change' : 'Assign'}
            </button>
            {zone && (
              <button
                type="button"
                onClick={clearZone}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20"
              >
                <Unlink size={13} />
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {showPicker && canEdit && (
        <div className="border-b border-hairline bg-bg-elevated p-4">
          <label className="relative block">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="input w-full pl-9 text-sm"
              placeholder="Search approved zones by code or name"
            />
          </label>

          <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-hairline">
            {searching || zoneLoading ? (
              <div className="p-4 text-sm text-content-secondary">Loading zones...</div>
            ) : searchResults.length === 0 ? (
              <div className="p-4 text-sm text-content-secondary">No approved zones found.</div>
            ) : (
              searchResults.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => assignZone(candidate)}
                  className="flex w-full items-start justify-between gap-3 border-b border-hairline px-4 py-3 text-left last:border-0 hover:bg-bg-secondary"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-content-primary">
                      {candidate.zone_code} - {candidate.zone_name}
                    </div>
                    <div className="mt-0.5 text-xs text-content-secondary">
                      {[candidate.plan_version, candidate.source_section, candidate.source_page ? `p.${candidate.source_page}` : null]
                        .filter(Boolean)
                        .join(' | ')}
                    </div>
                  </div>
                  {candidate.id === property.zone_id && <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="space-y-4 p-5">
        {zone ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <ZoneFact label="Zone code" value={zone.zone_code} />
            <ZoneFact label="Plan version" value={zone.plan_version || 'Needs verification'} />
            <ZoneFact label="Review status" value={zone.review_status || 'pending'} />
          </div>
        ) : (
          <ErrorState tone="warn">
            No reviewed zone is assigned. Parcel Intelligence will keep FAR and buildability in needs-verification state.
          </ErrorState>
        )}

        {zone?.notes && (
          <details className="rounded-lg border border-hairline bg-bg-secondary">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-content-secondary">
              Source notes
            </summary>
            <p className="whitespace-pre-wrap px-3 pb-3 text-xs text-content-secondary">{zone.notes}</p>
          </details>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-content-secondary">Site-specific zone notes</label>
          <textarea
            rows={2}
            value={zoneNotesDraft}
            onChange={(event) => setZoneNotesDraft(event.target.value)}
            disabled={!canEdit}
            placeholder="Why this zone applies here, deviations, pending clarifications with BBMP/BDA..."
            className="input w-full text-sm"
          />
          {canEdit && zoneNotesDraft !== (property?.zone_notes || '') && (
            <div className="mt-1 flex justify-end">
              <button type="button" onClick={saveNotes} className="text-xs font-medium text-primary-600 hover:underline">
                Save notes
              </button>
            </div>
          )}
        </div>

        <div className="flex items-start gap-2 border-t border-hairline pt-3 text-[11px] text-content-secondary">
          <Info size={11} className="mt-0.5 shrink-0" />
          <div>
            Zone assignment is source context only. FAR/buildability is calculated by the backend Parcel Intelligence API.
            {zone?.reviewed_at && <> Last reviewed {String(zone.reviewed_at).slice(0, 10)}.</>}
            {canEdit && (
              <>
                {' '}
                <Link to="/dashboard/settings/master-plan" className="inline-flex items-center gap-0.5 text-primary-600 hover:underline">
                  Manage zones <ExternalLink size={10} />
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ZoneFact({ label, value }) {
  return (
    <div className="rounded-lg border border-hairline bg-bg-secondary p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-content-muted">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-content-primary">{value || 'Needs verification'}</div>
    </div>
  );
}
