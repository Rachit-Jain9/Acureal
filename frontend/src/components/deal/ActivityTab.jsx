import { useState } from 'react';
import {
  Phone,
  MapPin,
  Users,
  Send,
  Tag,
  Mail,
  StickyNote,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useDealContext } from '../../hooks/useDealContext';
import { clsx } from 'clsx';
import {
  useActivities,
  useCreateActivity,
  useUpdateActivityStatus,
  useDeleteActivity,
} from '../../hooks/useActivities';
import Badge from '../common/Badge';
import LoadingSpinner from '../common/LoadingSpinner';
import { SectionHeader } from '../../design-system';
import AuditTimelineView from '../financials/AuditTimelineView';
import {
  formatDate,
  formatRelativeTime,
  ACTIVITY_STATUS_CONFIG,
  ACTIVITY_PRIORITY_CONFIG,
} from '../../utils/format';

const ACTIVITY_TYPES = [
  { value: 'call', label: 'Call', Icon: Phone },
  { value: 'site_visit', label: 'Site Visit', Icon: MapPin },
  { value: 'meeting', label: 'Meeting', Icon: Users },
  { value: 'loi_sent', label: 'LOI Sent', Icon: Send },
  { value: 'offer_received', label: 'Offer Received', Icon: Tag },
  { value: 'email', label: 'Email', Icon: Mail },
  { value: 'note', label: 'Note', Icon: StickyNote },
];

const TYPE_MAP = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.value, t]));

const buildForm = () => ({
  type: 'meeting',
  description: '',
  activityDate: new Date().toISOString().slice(0, 10),
  priority: 'medium',
  status: 'open',
  nextFollowUp: '',
});

function ActivityIcon({ type }) {
  const match = TYPE_MAP[type];
  if (!match) return <StickyNote size={15} className="text-content-muted" />;
  const { Icon } = match;
  return <Icon size={15} className="text-content-muted" />;
}

export default function ActivityTab() {
  const { dealId } = useDealContext();
  const { data: activitiesData, isLoading, isError, refetch } = useActivities(dealId);
  const createActivity = useCreateActivity();
  const updateStatus = useUpdateActivityStatus();
  const deleteActivity = useDeleteActivity();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(buildForm());

  const activities = Array.isArray(activitiesData)
    ? activitiesData
    : Array.isArray(activitiesData?.data)
      ? activitiesData.data
      : [];

  // Sort descending by date
  const sorted = [...activities].sort(
    (a, b) =>
      new Date(b.activity_date || b.created_at) - new Date(a.activity_date || a.created_at)
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createActivity.mutateAsync({
        dealId,
        data: {
          type: form.type,
          description: form.description,
          activityDate: form.activityDate,
          priority: form.priority,
          status: form.status,
          nextFollowUp: form.nextFollowUp || undefined,
        },
      });
      setForm(buildForm());
      setShowForm(false);
    } catch {
      // Handled by mutation hook
    }
  };

  const handleMarkComplete = (activityId) => {
    updateStatus.mutate({ activityId, status: 'completed' });
  };

  const handleDelete = (activityId) => {
    if (!window.confirm('Delete this activity entry?')) return;
    deleteActivity.mutate(activityId);
  };

  if (isLoading) return <LoadingSpinner className="py-16" />;

  if (isError) {
    return (
      <div className="card-editorial text-center py-12">
        <AlertCircle size={28} className="text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-600 mb-3">Failed to load activities.</p>
        <button onClick={refetch} className="btn btn-secondary text-sm">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-content-secondary">
            {activities.length} activit{activities.length !== 1 ? 'ies' : 'y'}
          </p>
          <p className="text-xs text-content-muted mt-0.5">
            Manual log of calls, visits, meetings &amp; notes — kernel audit trail below.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn btn-primary flex items-center gap-1.5 text-sm"
        >
          <Plus size={14} />
          Add Activity
        </button>
      </div>

      {/* Add Activity Form */}
      {showForm && (
        <div className="card-editorial border-accent-200 bg-accent-50/40">
          <SectionHeader size="sm" title="Log Activity" />
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  className="input text-sm"
                >
                  {ACTIVITY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Date</label>
                <input
                  type="date"
                  value={form.activityDate}
                  onChange={(e) => setForm((f) => ({ ...f, activityDate: e.target.value }))}
                  className="input text-sm"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What happened? Key discussion points, outcomes, next steps..."
                rows={3}
                required
                className="input text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Priority</label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                  className="input text-sm"
                >
                  {Object.entries(ACTIVITY_PRIORITY_CONFIG).map(([v, cfg]) => (
                    <option key={v} value={v}>{cfg.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="input text-sm"
                >
                  {Object.entries(ACTIVITY_STATUS_CONFIG).map(([v, cfg]) => (
                    <option key={v} value={v}>{cfg.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">
                  Next Follow-Up <span className="text-content-muted">(optional)</span>
                </label>
                <input
                  type="date"
                  value={form.nextFollowUp}
                  onChange={(e) => setForm((f) => ({ ...f, nextFollowUp: e.target.value }))}
                  className="input text-sm"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setForm(buildForm());
                }}
                className="btn btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createActivity.isPending}
                className="btn btn-primary text-sm flex items-center gap-1.5"
              >
                {createActivity.isPending && <Loader2 size={14} className="animate-spin" />}
                {createActivity.isPending ? 'Saving...' : 'Log Activity'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Activity List */}
      {sorted.length === 0 ? (
        <div className="card-editorial text-center py-16">
          <StickyNote size={32} className="text-content-muted mx-auto mb-3" />
          <p className="text-sm font-medium text-content-secondary mb-1">No activities logged yet</p>
          <p className="text-xs text-content-muted">
            Track calls, site visits, meetings, and notes for this deal.
          </p>
        </div>
      ) : (
        <div className="card-editorial p-0 overflow-hidden">
          <ul className="divide-y divide-hairline">
            {sorted.map((activity) => {
              const actType = activity.activity_type || activity.type || 'note';
              const statusCfg =
                ACTIVITY_STATUS_CONFIG[activity.status] || ACTIVITY_STATUS_CONFIG.open;
              const priorityCfg =
                ACTIVITY_PRIORITY_CONFIG[activity.priority] || ACTIVITY_PRIORITY_CONFIG.medium;
              const isCompleted = activity.status === 'completed';

              return (
                <li key={activity.id} className="px-4 py-4 hover:bg-bg-secondary">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 w-7 h-7 rounded-full bg-bg-secondary flex items-center justify-center flex-shrink-0">
                      <ActivityIcon type={actType} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-medium text-content-secondary capitalize">
                          {(TYPE_MAP[actType]?.label || actType).replace(/_/g, ' ')}
                        </span>
                        <Badge tone={statusCfg.tone}>{statusCfg.label}</Badge>
                        <Badge tone={priorityCfg.tone}>{priorityCfg.label}</Badge>
                        <span className="text-xs text-content-muted ml-auto">
                          {formatRelativeTime(activity.activity_date || activity.created_at)}
                        </span>
                      </div>
                      <p
                        className={clsx(
                          'text-sm',
                          isCompleted ? 'text-content-secondary line-through' : 'text-content-primary'
                        )}
                      >
                        {activity.description}
                      </p>
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {activity.performed_by_name && (
                          <span className="text-xs text-content-muted">
                            by {activity.performed_by_name}
                          </span>
                        )}
                        <span className="text-xs text-content-muted">
                          {formatDate(activity.activity_date)}
                        </span>
                        {activity.next_follow_up && (
                          <span className="text-xs text-amber-600">
                            Follow-up: {formatDate(activity.next_follow_up)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        {!isCompleted && (
                          <button
                            onClick={() => handleMarkComplete(activity.id)}
                            disabled={updateStatus.isPending}
                            className="text-xs text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
                          >
                            <CheckCircle2 size={12} />
                            Mark complete
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(activity.id)}
                          disabled={deleteActivity.isPending}
                          className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                        >
                          <Trash2 size={12} />
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Kernel audit trail — signed deal_events log, reproducible on replay. */}
      <AuditTimelineView dealId={dealId} />
    </div>
  );
}
