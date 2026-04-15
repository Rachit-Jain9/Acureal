import { useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Filter,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  useActivityFeed,
  useCreateActivity,
  useDeleteActivity,
  useUpdateActivity,
  useUpdateActivityStatus,
} from '../hooks/useActivities';
import { useDeals } from '../hooks/useDeals';
import LoadingSpinner from '../components/common/LoadingSpinner';
import EmptyState from '../components/common/EmptyState';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import {
  ACTIVITY_PRIORITY_CONFIG,
  ACTIVITY_STATUS_CONFIG,
  formatDate,
  formatRelativeTime,
} from '../utils/format';

const ACTIVITY_TYPE_CONFIG = {
  call: { label: 'Call', color: 'bg-blue-100 text-blue-700' },
  site_visit: { label: 'Site Visit', color: 'bg-emerald-100 text-emerald-700' },
  meeting: { label: 'Meeting', color: 'bg-violet-100 text-violet-700' },
  loi_sent: { label: 'LOI Sent', color: 'bg-amber-100 text-amber-700' },
  offer_received: { label: 'Offer Received', color: 'bg-teal-100 text-teal-700' },
  email: { label: 'Email', color: 'bg-cyan-100 text-cyan-700' },
  note: { label: 'Note', color: 'bg-orange-100 text-orange-700' },
};

const buildForm = (activity) => ({
  dealId: activity?.deal_id || '',
  type: activity?.activity_type || 'meeting',
  description: activity?.description || '',
  activityDate: activity?.activity_date ? activity.activity_date.slice(0, 10) : new Date().toISOString().slice(0, 10),
  nextFollowUp: activity?.next_follow_up ? activity.next_follow_up.slice(0, 10) : '',
  status: activity?.status || 'open',
  priority: activity?.priority || 'medium',
  isImportant: Boolean(activity?.is_important),
});

export default function ActivitiesPage() {
  const [filters, setFilters] = useState({
    search: '',
    dealId: '',
    status: '',
    priority: '',
  });
  const [showComposer, setShowComposer] = useState(false);
  const [editingActivity, setEditingActivity] = useState(null);
  const [form, setForm] = useState(buildForm());

  const queryParams = useMemo(() => ({
    limit: 150,
    search: filters.search || undefined,
    dealId: filters.dealId || undefined,
    status: filters.status || undefined,
    priority: filters.priority || undefined,
  }), [filters]);

  const { data, isLoading, isError } = useActivityFeed(queryParams);
  const { data: dealsData } = useDeals({ limit: 200 });
  const createActivity = useCreateActivity();
  const updateActivity = useUpdateActivity();
  const updateActivityStatus = useUpdateActivityStatus();
  const deleteActivity = useDeleteActivity();

  const activities = data?.data || [];
  const deals = dealsData?.data || [];

  const openCreate = () => {
    setEditingActivity(null);
    setForm(buildForm());
    setShowComposer(true);
  };

  const openEdit = (activity) => {
    setEditingActivity(activity);
    setForm(buildForm(activity));
    setShowComposer(true);
  };

  const closeComposer = () => {
    setEditingActivity(null);
    setForm(buildForm());
    setShowComposer(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (editingActivity) {
      await updateActivity.mutateAsync({
        activityId: editingActivity.id,
        data: {
          type: form.type,
          description: form.description,
          activityDate: form.activityDate,
          nextFollowUp: form.nextFollowUp || undefined,
          status: form.status,
          priority: form.priority,
          isImportant: form.isImportant,
        },
      });
    } else {
      await createActivity.mutateAsync({
        dealId: form.dealId,
        data: {
          type: form.type,
          description: form.description,
          activityDate: form.activityDate,
          nextFollowUp: form.nextFollowUp || undefined,
          status: form.status,
          priority: form.priority,
          isImportant: form.isImportant,
        },
      });
    }

    closeComposer();
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      dealId: '',
      status: '',
      priority: '',
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activities"
        description="Track follow-ups, completions, and next steps across the live pipeline"
        actions={(
          <button onClick={openCreate} className="btn btn-primary flex items-center gap-2">
            <Plus size={16} />
            New Activity
          </button>
        )}
      />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Search descriptions, deals, cities..."
              className="input w-full pl-9"
            />
          </div>

          <select
            value={filters.dealId}
            onChange={(event) => setFilters((current) => ({ ...current, dealId: event.target.value }))}
            className="input w-auto min-w-[220px]"
          >
            <option value="">All deals</option>
            {deals.map((deal) => (
              <option key={deal.id} value={deal.id}>
                {deal.name}
              </option>
            ))}
          </select>

          <select
            value={filters.status}
            onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
            className="input w-auto"
          >
            <option value="">All statuses</option>
            {Object.entries(ACTIVITY_STATUS_CONFIG).map(([value, config]) => (
              <option key={value} value={value}>{config.label}</option>
            ))}
          </select>

          <select
            value={filters.priority}
            onChange={(event) => setFilters((current) => ({ ...current, priority: event.target.value }))}
            className="input w-auto"
          >
            <option value="">All priorities</option>
            {Object.entries(ACTIVITY_PRIORITY_CONFIG).map(([value, config]) => (
              <option key={value} value={value}>{config.label}</option>
            ))}
          </select>

          <button onClick={clearFilters} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <Filter size={14} />
            Reset
          </button>
        </div>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : isError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-12 text-center text-red-600">
          Failed to load activities.
        </div>
      ) : activities.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activities found"
          description="Try clearing the filters or log a new activity for one of your deals."
          action={(
            <button onClick={openCreate} className="btn btn-primary mt-2">
              <Plus size={16} className="mr-1 inline" />
              New Activity
            </button>
          )}
        />
      ) : (
        <div className="space-y-4">
          {activities.map((activity) => {
            const typeConfig = ACTIVITY_TYPE_CONFIG[activity.activity_type] || ACTIVITY_TYPE_CONFIG.note;
            const statusConfig = ACTIVITY_STATUS_CONFIG[activity.status] || ACTIVITY_STATUS_CONFIG.open;
            const priorityConfig = ACTIVITY_PRIORITY_CONFIG[activity.priority] || ACTIVITY_PRIORITY_CONFIG.medium;

            return (
              <div key={activity.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={typeConfig.color}>{typeConfig.label}</Badge>
                      <Badge className={statusConfig.color}>{statusConfig.label}</Badge>
                      <Badge className={priorityConfig.color}>{priorityConfig.label}</Badge>
                      {activity.is_important && <Badge className="bg-red-100 text-red-700">Important</Badge>}
                    </div>

                    <p className="mt-3 text-sm font-medium text-gray-900">{activity.description}</p>

                    <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                      <span>{activity.deal_name || 'Unlinked deal'}</span>
                      {activity.property_name && <span>{activity.property_name}</span>}
                      <span>{formatDate(activity.activity_date)}</span>
                      <span>{formatRelativeTime(activity.activity_date)}</span>
                      {activity.performed_by_name && <span>by {activity.performed_by_name}</span>}
                      {activity.next_follow_up && <span>Next follow-up {formatDate(activity.next_follow_up)}</span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {activity.status !== 'completed' && (
                      <button
                        onClick={() => updateActivityStatus.mutate({ activityId: activity.id, status: 'completed' })}
                        className="btn btn-secondary text-emerald-700"
                      >
                        <CheckCircle2 size={14} />
                        Complete
                      </button>
                    )}
                    <button onClick={() => openEdit(activity)} className="btn btn-secondary">
                      <Pencil size={14} />
                      Edit
                    </button>
                    <button
                      onClick={() => deleteActivity.mutate(activity.id)}
                      className="btn btn-secondary text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showComposer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {editingActivity ? 'Edit Activity' : 'New Activity'}
                </h2>
                <p className="text-sm text-gray-500">Capture follow-ups without losing deal context.</p>
              </div>
              <button onClick={closeComposer} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Deal</label>
                  <select
                    value={form.dealId}
                    onChange={(event) => setForm((current) => ({ ...current, dealId: event.target.value }))}
                    className="input w-full"
                    required={!editingActivity}
                    disabled={Boolean(editingActivity)}
                  >
                    <option value="">Select deal</option>
                    {deals.map((deal) => (
                      <option key={deal.id} value={deal.id}>{deal.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Activity Type</label>
                  <select
                    value={form.type}
                    onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}
                    className="input w-full"
                  >
                    {Object.entries(ACTIVITY_TYPE_CONFIG).map(([value, config]) => (
                      <option key={value} value={value}>{config.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  rows={4}
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  className="input w-full"
                  placeholder="Summarize what happened, why it matters, and the next action."
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Date</label>
                  <input
                    type="date"
                    value={form.activityDate}
                    onChange={(event) => setForm((current) => ({ ...current, activityDate: event.target.value }))}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Next Follow-up</label>
                  <input
                    type="date"
                    value={form.nextFollowUp}
                    onChange={(event) => setForm((current) => ({ ...current, nextFollowUp: event.target.value }))}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
                  <select
                    value={form.status}
                    onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                    className="input w-full"
                  >
                    {Object.entries(ACTIVITY_STATUS_CONFIG).map(([value, config]) => (
                      <option key={value} value={value}>{config.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Priority</label>
                  <select
                    value={form.priority}
                    onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
                    className="input w-full"
                  >
                    {Object.entries(ACTIVITY_PRIORITY_CONFIG).map(([value, config]) => (
                      <option key={value} value={value}>{config.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={form.isImportant}
                  onChange={(event) => setForm((current) => ({ ...current, isImportant: event.target.checked }))}
                />
                Mark as important
              </label>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeComposer} className="btn btn-secondary">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createActivity.isPending || updateActivity.isPending}
                  className="btn btn-primary"
                >
                  {editingActivity ? (updateActivity.isPending ? 'Saving...' : 'Save Changes') : (createActivity.isPending ? 'Creating...' : 'Create Activity')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
