import { useState } from 'react';
import { CheckCircle2, Edit3, ExternalLink, Info, Search, Shield, Unlink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { useCanEdit } from '../../hooks/useCanEdit';
import { useZones, useZone, useAssignZoneToProperty } from '../../hooks/useMasterPlan';
import { useUpdateProperty } from '../../hooks/useProperties';
import { ErrorState, SectionHeader, Skeleton } from '../../design-system';
import Badge from '../common/Badge';
import RmpStatusBanner from '../masterplan/RmpStatusBanner';

export default function MasterPlanZonePanel({ property }) {
  const canEdit = useCanEdit();
  const [search, setSearch] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [zoneNotesDraft, setZoneNotesDraft] = useState(property?.zone_notes || '');

  const updateProp = useUpdateProperty();
  const assignZoneMutation = useAssignZoneToProperty();
  const { data: zone, isLoading: zoneLoading } = useZone(property?.zone_id);
  const { data: searchResults = [], isLoading: searching } = useZones(
    search.trim().length >= 1
      ? { search: search.trim(), status: 'approved', limit: 15 }
      : { status: 'approved', limit: 15 },
  );

  const isAssigned = Boolean(zone);
  const notesDirty = canEdit && zoneNotesDraft !== (property?.zone_notes || '');

  const assignZone = async (selectedZone) => {
    await assignZoneMutation.mutateAsync({
      zoneId: selectedZone.id,
      propertyId: property.id,
      notes: zoneNotesDraft || null,
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
      <div className="card-editorial p-5">
        <SectionHeader size="sm" icon={Shield} title="Master Plan Zone" className="mb-2" />
        <p className="text-xs text-content-muted italic">
          Link a property before assigning a master plan zone.
        </p>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'card-editorial p-0 overflow-hidden border-l-4 transition-colors duration-200 ease-out',
        isAssigned ? 'border-l-emerald-500' : 'border-l-amber-500',
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-hairline-soft px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={clsx(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hairline transition-colors duration-200 ease-out',
              isAssigned ? 'bg-emerald-50 text-emerald-700' : 'bg-bg-secondary text-content-muted',
            )}
          >
            <Shield size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-content-muted">
              Reviewed Zone Assignment
            </div>
            {isAssigned ? (
              <>
                <div className="mt-1 flex flex-wrap items-baseline gap-2">
                  <span className="font-display text-base font-semibold text-content-primary">
                    {zone.zone_code}
                  </span>
                  <span className="text-sm text-content-secondary">{zone.zone_name}</span>
                  <Badge tone="success" className="gap-1">
                    <CheckCircle2 size={11} />
                    Assigned
                  </Badge>
                </div>
                <div className="mt-1 text-[11px] text-content-secondary">
                  {[
                    zone.plan_version,
                    zone.source_section,
                    zone.source_page ? `p. ${zone.source_page}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </>
            ) : (
              <>
                <div className="mt-1 flex flex-wrap items-baseline gap-2">
                  <span className="font-display text-base font-semibold text-content-primary">
                    Not assigned
                  </span>
                  <Badge tone="warn">Needs review</Badge>
                </div>
                <div className="mt-1 text-[11px] text-content-secondary">
                  Assign a reviewed zone to unlock backend FAR matrix matching.
                </div>
              </>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowPicker((value) => !value)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-editorial border border-hairline bg-bg-secondary px-3 py-1.5 text-xs font-semibold text-content-primary',
                'transition-colors duration-150 ease-out',
                'hover:border-primary-300',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
                'active:scale-[0.98]',
                showPicker && 'border-primary-300',
              )}
              aria-expanded={showPicker}
            >
              <Edit3 size={13} />
              {isAssigned ? 'Change' : 'Assign'}
            </button>
            {isAssigned && (
              <button
                type="button"
                onClick={clearZone}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-editorial border border-hairline bg-bg-secondary px-3 py-1.5 text-xs font-semibold text-content-primary',
                  'transition-colors duration-150 ease-out',
                  'hover:border-rose-300 hover:text-rose-700',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40',
                  'active:scale-[0.98]',
                )}
              >
                <Unlink size={13} />
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {showPicker && canEdit && (
        <div
          className="border-b border-hairline-soft bg-bg-secondary p-4 motion-safe:animate-[zonepicker-slide_220ms_cubic-bezier(0.16,1,0.3,1)]"
          role="region"
          aria-label="Zone picker"
        >
          <label className="relative block">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoFocus
              className="input w-full pl-9 text-sm"
              placeholder="Search approved zones by code or name"
            />
          </label>

          <div className="mt-3 max-h-64 overflow-y-auto rounded-editorial border border-hairline bg-bg-elevated">
            {searching || zoneLoading ? (
              <div className="space-y-2 p-3">
                {[1, 2, 3].map((item) => (
                  <Skeleton key={item} className="h-12 w-full rounded" />
                ))}
              </div>
            ) : searchResults.length === 0 ? (
              <div className="p-6 text-center text-sm text-content-secondary">
                No approved zones found.
              </div>
            ) : (
              searchResults.map((candidate) => {
                const selected = candidate.id === property.zone_id;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => assignZone(candidate)}
                    className={clsx(
                      'flex w-full items-start justify-between gap-3 border-b border-hairline-soft px-4 py-3 text-left transition-colors duration-150 ease-out last:border-0',
                      'hover:bg-bg-secondary',
                      'focus-visible:outline-none focus-visible:bg-bg-secondary focus-visible:ring-2 focus-visible:ring-primary-500/40 focus-visible:ring-inset',
                      selected && 'bg-emerald-50/50',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-content-primary">
                        <span className="font-display">{candidate.zone_code}</span>
                        <span className="font-normal text-content-secondary"> · {candidate.zone_name}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-content-secondary">
                        {[
                          candidate.plan_version,
                          candidate.source_section,
                          candidate.source_page ? `p. ${candidate.source_page}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    {selected && (
                      <CheckCircle2
                        size={15}
                        className="mt-0.5 shrink-0 text-emerald-600 motion-safe:animate-[scaleIn_150ms_ease-out]"
                      />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      <div className="space-y-5 p-5">
        <RmpStatusBanner />
        {isAssigned ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <ZoneFact label="Zone code" value={zone.zone_code} />
            <ZoneFact label="Plan version" value={zone.plan_version} />
            <ZoneFact label="Review status" value={zone.review_status} format="status" />
          </div>
        ) : (
          <ErrorState tone="warn">
            No reviewed zone is assigned. Parcel Intelligence will keep FAR and buildability in needs-verification state.
          </ErrorState>
        )}

        {zone?.notes && (
          <details className="group rounded-editorial border border-hairline-soft bg-bg-secondary">
            <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-content-secondary transition-colors duration-150 ease-out hover:text-content-primary">
              <span>Source notes</span>
              <span className="text-content-muted transition-transform duration-200 ease-out group-open:rotate-90">
                ›
              </span>
            </summary>
            <p className="whitespace-pre-wrap border-t border-hairline-soft px-4 py-3 text-xs leading-relaxed text-content-secondary">
              {zone.notes}
            </p>
          </details>
        )}

        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-content-muted">
            Site-specific zone notes
          </label>
          <textarea
            rows={2}
            value={zoneNotesDraft}
            onChange={(event) => setZoneNotesDraft(event.target.value)}
            disabled={!canEdit}
            placeholder="Why this zone applies here, deviations, pending clarifications with BBMP/BDA..."
            className="input w-full text-sm"
          />
          {notesDirty && (
            <div className="mt-2 flex justify-end gap-2 motion-safe:animate-[fadeInUp_180ms_ease-out]">
              <button
                type="button"
                onClick={() => setZoneNotesDraft(property?.zone_notes || '')}
                className="text-xs font-medium text-content-secondary transition-colors duration-150 ease-out hover:text-content-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveNotes}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-editorial bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white',
                  'transition-colors duration-150 ease-out',
                  'hover:bg-primary-700',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
                  'active:scale-[0.98]',
                )}
              >
                Save notes
              </button>
            </div>
          )}
        </div>

        <div className="flex items-start gap-2 border-t border-hairline-soft pt-3 text-[11px] leading-relaxed text-content-muted">
          <Info size={11} className="mt-0.5 shrink-0" />
          <div>
            Zone assignment is source context only. FAR/buildability is calculated by the backend Parcel Intelligence API.
            {zone?.reviewed_at && <> Last reviewed {String(zone.reviewed_at).slice(0, 10)}.</>}
            {canEdit && (
              <>
                {' '}
                <Link
                  to="/dashboard/settings/master-plan"
                  className="inline-flex items-center gap-0.5 font-medium text-content-secondary underline-offset-2 transition-colors duration-150 ease-out hover:text-content-primary hover:underline"
                >
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

function ZoneFact({ label, value, format }) {
  const isMissing = !value || value === '';
  const isStatus = format === 'status';

  return (
    <div className="rounded-editorial border border-hairline bg-bg-elevated p-3 transition-colors duration-150 ease-out hover:border-hairline-strong">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-content-muted">
        {label}
      </div>
      <div className="mt-1.5 min-h-[24px]">
        {isMissing ? (
          <Badge tone="warn" className="gap-1">Needs review</Badge>
        ) : isStatus ? (
          <Badge tone={value === 'approved' ? 'success' : 'warn'}>
            {String(value).replace(/_/g, ' ')}
          </Badge>
        ) : (
          <span className="font-display text-sm font-semibold text-content-primary truncate block">
            {value}
          </span>
        )}
      </div>
    </div>
  );
}
