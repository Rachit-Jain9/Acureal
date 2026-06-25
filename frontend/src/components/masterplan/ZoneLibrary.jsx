import { useMemo, useState } from 'react';
import { CheckCircle2, Clock, Edit3, Plus, Search, Shield, XCircle } from 'lucide-react';
import EmptyState from '../common/EmptyState';
import Badge from '../common/Badge';
import { Skeleton } from '../../design-system';
import {
  useZones,
  useCreateZone,
  useUpdateZone,
  useReviewZone,
} from '../../hooks/useMasterPlan';
import ZoneGeoJsonImportButton from './ZoneGeoJsonImportButton';
import ZoneModal from './ZoneModal';

/**
 * Tone + icon mapping for a zone's review status. Local to ZoneLibrary —
 * no other component needs this dictionary.
 */
function StatusBadge({ status }) {
  const cfg = {
    approved: { tone: 'success', icon: CheckCircle2, label: 'Approved' },
    pending:  { tone: 'warn', icon: Clock, label: 'Pending review' },
    rejected: { tone: 'danger', icon: XCircle, label: 'Rejected' },
  }[status] || { tone: 'neutral', icon: Clock, label: status || '—' };
  const Icon = cfg.icon;
  return (
    <Badge tone={cfg.tone} className="gap-1">
      <Icon size={11} />
      {cfg.label}
    </Badge>
  );
}

/**
 * Skeleton shown while the zones list is loading. Mirrors the table-row
 * layout so the load-in is visually stable.
 */
function ZoneTableSkeleton() {
  return (
    <div role="status" aria-busy="true" className="overflow-hidden rounded-lg border border-hairline bg-bg-elevated">
      <div className="grid grid-cols-[0.7fr,1.4fr,1fr,0.7fr,0.8fr,0.9fr] gap-3 border-b border-hairline-strong px-4 py-3">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <Skeleton key={item} className="h-3 rounded" />
        ))}
      </div>
      <div className="divide-y divide-hairline">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="grid grid-cols-[0.7fr,1.4fr,1fr,0.7fr,0.8fr,0.9fr] gap-3 px-4 py-3">
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <Skeleton key={item} className="h-8 rounded" />
            ))}
          </div>
        ))}
      </div>
      <span className="sr-only">Loading master plan zones</span>
    </div>
  );
}

/**
 * Zone Library tab — searchable, filterable list of curated RMP zones
 * with add / edit / approve / reject actions for editors.
 *
 * Extracted from `pages/MasterPlanAdminPage.jsx` as part of the Task #6
 * decomposition (Tier C — tab-panel extractions). Behaviour-preserving
 * move, no logic changes.
 *
 * Props:
 *   - canEdit: whether the current operator can mutate zones (admin /
 *              owner / editor / analyst). Non-editors see an approved-only
 *              read-only view.
 */
export default function ZoneLibrary({ canEdit }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(canEdit ? '' : 'approved');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingZone, setEditingZone] = useState(null);

  const params = useMemo(() => {
    const p = { limit: 200 };
    if (search) p.search = search;
    if (statusFilter) p.status = statusFilter;
    return p;
  }, [search, statusFilter]);

  const { data: zones = [], isLoading } = useZones(params);
  const createMut = useCreateZone();
  const updateMut = useUpdateZone();
  const reviewMut = useReviewZone();

  const openCreate = () => { setEditingZone(null); setModalOpen(true); };
  const openEdit = (z) => { setEditingZone(z); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setEditingZone(null); };

  const handleSubmit = async (payload) => {
    if (editingZone) {
      await updateMut.mutateAsync({ id: editingZone.id, data: payload });
    } else {
      await createMut.mutateAsync(payload);
    }
    closeModal();
  };

  const submitting = createMut.isPending || updateMut.isPending;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
          <input
            className="input pl-8"
            placeholder="Search zone code or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {canEdit && (
          <select className="input max-w-[180px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
          </select>
        )}
        {canEdit && (
          <button onClick={openCreate} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-sm hover:bg-accent-hover">
            <Plus size={14} /> Add Zone
          </button>
        )}
        {canEdit && <ZoneGeoJsonImportButton />}
      </div>

      {isLoading ? (
        <ZoneTableSkeleton />
      ) : zones.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="No zones found"
          description={canEdit
            ? 'Add zones manually from the RMP 2031 Zoning Regulations PDF to seed the library.'
            : 'No approved zones available yet. An analyst is curating the master plan data.'}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline-strong text-left text-xs text-content-secondary uppercase">
                <th className="py-2 pr-3">Code</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Plan</th>
                <th className="py-2 pr-3">FSI</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Effective</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id} className="border-b border-hairline hover:bg-bg-secondary">
                  <td className="py-2 pr-3 font-semibold text-content-primary">{z.zone_code}</td>
                  <td className="py-2 pr-3 text-content-secondary">{z.zone_name}</td>
                  <td className="py-2 pr-3 text-content-secondary text-xs">{z.plan_version || '—'}</td>
                  <td className="py-2 pr-3 text-xs">
                    {z.permissible_fsi_base != null ? `${z.permissible_fsi_base}` : '—'}
                    {z.permissible_fsi_max != null ? ` – ${z.permissible_fsi_max}` : ''}
                    {Array.isArray(z.fsi_road_width_rules) && z.fsi_road_width_rules.length > 0 && (
                      <span className="ml-1 text-content-muted">({z.fsi_road_width_rules.length} tier{z.fsi_road_width_rules.length === 1 ? '' : 's'})</span>
                    )}
                  </td>
                  <td className="py-2 pr-3"><StatusBadge status={z.review_status} /></td>
                  <td className="py-2 pr-3 text-xs text-content-secondary">
                    {z.effective_from ? String(z.effective_from).slice(0, 10) : '—'}
                    {z.effective_to ? ` → ${String(z.effective_to).slice(0, 10)}` : ''}
                  </td>
                  <td className="py-2">
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(z)} className="p-1.5 rounded hover:bg-bg-secondary text-content-secondary" title="Edit zone">
                          <Edit3 size={14} />
                        </button>
                        {z.review_status !== 'approved' && (
                          <button
                            onClick={() => reviewMut.mutate({ id: z.id, status: 'approved' })}
                            className="px-2 py-1 rounded text-xs bg-pos-soft text-data-positive hover:bg-pos-soft"
                          >
                            Approve
                          </button>
                        )}
                        {z.review_status !== 'rejected' && (
                          <button
                            onClick={() => reviewMut.mutate({ id: z.id, status: 'rejected' })}
                            className="px-2 py-1 rounded text-xs bg-neg-soft text-data-negative hover:bg-neg-soft"
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ZoneModal
        isOpen={modalOpen}
        onClose={closeModal}
        zone={editingZone}
        onSubmit={handleSubmit}
        submitting={submitting}
      />
    </div>
  );
}
