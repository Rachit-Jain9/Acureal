import { useState } from 'react';
import {
  FileSignature,
  Plus,
  Trash2,
  AlertCircle,
  Loader2,
  BadgeCheck,
  Paperclip,
} from 'lucide-react';
import EmptyState from '../common/EmptyState';
import Badge from '../common/Badge';
import { SkeletonList, SectionHeader, confirm } from '../../design-system';
import { formatDate } from '../../utils/format';
import {
  useSignoffs,
  useCreateSignoff,
  useUpdateSignoff,
  useDeleteSignoff,
  useSeedSignoffs,
} from '../../hooks/useSignoffs';

// ── Config — kept local to the board (mirrors the backend domain constants) ──

const ROLE_OPTIONS = [
  { value: 'advocate', label: 'Advocate' },
  { value: 'ca', label: 'Chartered Accountant' },
  { value: 'architect', label: 'Architect' },
  { value: 'engineer', label: 'Engineer' },
  { value: 'structural_engineer', label: 'Structural Engineer' },
  { value: 'banker', label: 'Banker' },
  { value: 'other', label: 'Other' },
];
const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));

const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not started' },
  { value: 'requested', label: 'Requested' },
  { value: 'signed', label: 'Signed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
];
const STATUS_TONE = {
  not_started: 'neutral',
  requested: 'info',
  signed: 'success',
  rejected: 'danger',
  expired: 'warn',
};
const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, s.label]));

const buildSignoffForm = () => ({
  professional_role: 'advocate',
  professional_name: '',
  scope: '',
  form_ref: '',
  status: 'not_started',
  requested_at: '',
  signed_at: '',
  expires_at: '',
  notes: '',
});

/**
 * SignoffsSection — the professional sign-off board for a deal. Tracks who must
 * certify the deal (advocate / CA / architect / engineer / structural engineer
 * / banker) and where each certificate stands. A SIGNED sign-off marks its
 * matching K-RERA cockpit item "Verified" server-side — surfaced here with a
 * green check so the link is visible.
 */
export default function SignoffsSection({ dealId, canEdit }) {
  const { data, isLoading, isError, refetch } = useSignoffs(dealId);
  const createSignoff = useCreateSignoff();
  const updateSignoff = useUpdateSignoff();
  const deleteSignoff = useDeleteSignoff();
  const seedSignoffs = useSeedSignoffs();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(buildSignoffForm());

  const signoffs = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await createSignoff.mutateAsync({
        dealId,
        data: {
          professional_role: form.professional_role,
          professional_name: form.professional_name || undefined,
          scope: form.scope,
          form_ref: form.form_ref || undefined,
          status: form.status,
          requested_at: form.requested_at || undefined,
          signed_at: form.signed_at || undefined,
          expires_at: form.expires_at || undefined,
          notes: form.notes || undefined,
        },
      });
      setForm(buildSignoffForm());
      setShowForm(false);
    } catch {
      // surfaced via toast in the hook
    }
  };

  const handleStatusChange = (item, status) => {
    updateSignoff.mutate({ dealId, id: item.id, data: { status } });
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Remove this sign-off?',
      tone: 'danger',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    deleteSignoff.mutate({ dealId, id });
  };

  if (isLoading) return <div className="py-2"><SkeletonList rows={4} columns={4} /></div>;

  if (isError) {
    return (
      <div className="text-center py-8">
        <AlertCircle size={24} className="text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-600 mb-2">Failed to load the sign-off board.</p>
        <button onClick={refetch} className="btn btn-secondary text-sm">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        size="sm"
        icon={FileSignature}
        title="Professional Sign-off Board"
        sub="Who must certify this deal — and where each stands. A signed certificate marks its matching K-RERA item verified."
        action={canEdit ? (
          <div className="flex items-center gap-2">
            {signoffs.length === 0 && (
              <button
                onClick={() => seedSignoffs.mutate({ dealId })}
                disabled={seedSignoffs.isPending}
                className="btn btn-secondary text-sm flex items-center gap-1.5"
              >
                {seedSignoffs.isPending && <Loader2 size={13} className="animate-spin" />}
                Seed Standard Board
              </button>
            )}
            <button
              onClick={() => setShowForm((v) => !v)}
              className="btn btn-primary text-sm flex items-center gap-1.5"
            >
              <Plus size={14} />
              Add Sign-off
            </button>
          </div>
        ) : undefined}
      />

      {/* Add form */}
      {showForm && (
        <div className="card-editorial border-accent-200 bg-accent-50/40">
          <h4 className="text-sm font-semibold text-content-primary mb-3">New Sign-off</h4>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="signoff-form-role" className="block text-xs font-medium text-content-secondary mb-1">Professional</label>
                <select
                  id="signoff-form-role"
                  value={form.professional_role}
                  onChange={(e) => setForm((f) => ({ ...f, professional_role: e.target.value }))}
                  className="input text-sm"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="signoff-form-name" className="block text-xs font-medium text-content-secondary mb-1">Firm / person <span className="text-content-muted">(optional)</span></label>
                <input
                  id="signoff-form-name"
                  type="text"
                  value={form.professional_name}
                  onChange={(e) => setForm((f) => ({ ...f, professional_name: e.target.value }))}
                  placeholder="e.g. Rao & Associates"
                  className="input text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="signoff-form-scope" className="block text-xs font-medium text-content-secondary mb-1">Scope</label>
                <input
                  id="signoff-form-scope"
                  type="text"
                  value={form.scope}
                  onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
                  placeholder="e.g. Title, encumbrance & litigation opinion"
                  required
                  className="input text-sm"
                />
              </div>
              <div>
                <label htmlFor="signoff-form-formref" className="block text-xs font-medium text-content-secondary mb-1">Form ref <span className="text-content-muted">(optional)</span></label>
                <input
                  id="signoff-form-formref"
                  type="text"
                  value={form.form_ref}
                  onChange={(e) => setForm((f) => ({ ...f, form_ref: e.target.value }))}
                  placeholder="e.g. Form-1"
                  className="input text-sm"
                />
              </div>
              <div>
                <label htmlFor="signoff-form-status" className="block text-xs font-medium text-content-secondary mb-1">Status</label>
                <select
                  id="signoff-form-status"
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="input text-sm"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="signoff-form-requested" className="block text-xs font-medium text-content-secondary mb-1">Requested</label>
                <input
                  id="signoff-form-requested"
                  type="date"
                  value={form.requested_at}
                  onChange={(e) => setForm((f) => ({ ...f, requested_at: e.target.value }))}
                  className="input text-sm"
                />
              </div>
              <div>
                <label htmlFor="signoff-form-signed" className="block text-xs font-medium text-content-secondary mb-1">Signed</label>
                <input
                  id="signoff-form-signed"
                  type="date"
                  value={form.signed_at}
                  onChange={(e) => setForm((f) => ({ ...f, signed_at: e.target.value }))}
                  className="input text-sm"
                />
              </div>
              <div>
                <label htmlFor="signoff-form-expires" className="block text-xs font-medium text-content-secondary mb-1">Expires</label>
                <input
                  id="signoff-form-expires"
                  type="date"
                  value={form.expires_at}
                  onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
                  className="input text-sm"
                />
              </div>
            </div>
            <div>
              <label htmlFor="signoff-form-notes" className="block text-xs font-medium text-content-secondary mb-1">Notes</label>
              <textarea
                id="signoff-form-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="input text-sm"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setShowForm(false); setForm(buildSignoffForm()); }}
                className="btn btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createSignoff.isPending}
                className="btn btn-primary text-sm flex items-center gap-1.5"
              >
                {createSignoff.isPending && <Loader2 size={13} className="animate-spin" />}
                Add
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Board */}
      {signoffs.length === 0 ? (
        <EmptyState
          size="sm"
          icon={FileSignature}
          title="No sign-offs yet"
          description="Seed the standard board (advocate, CA, architect, engineer, structural engineer, banker) or add one manually."
        />
      ) : (
        <div className="card-editorial p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary border-b border-hairline">
                <tr>
                  <th className="text-left text-xs font-semibold text-content-secondary px-4 py-2.5">Professional</th>
                  <th className="text-left text-xs font-semibold text-content-secondary px-3 py-2.5">Scope</th>
                  <th className="text-left text-xs font-semibold text-content-secondary px-3 py-2.5">Form</th>
                  <th className="text-left text-xs font-semibold text-content-secondary px-3 py-2.5">Status</th>
                  <th className="text-left text-xs font-semibold text-content-secondary px-3 py-2.5">Signed</th>
                  <th className="text-left text-xs font-semibold text-content-secondary px-3 py-2.5">Expires</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {signoffs.map((item) => {
                  const isSigned = item.status === 'signed';
                  return (
                    <tr key={item.id} className="hover:bg-bg-secondary">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {isSigned && (
                            <BadgeCheck
                              size={14}
                              className="text-green-500 shrink-0"
                              aria-label="Signed — verifies the matching K-RERA item"
                            />
                          )}
                          <p className="font-medium text-content-primary">{ROLE_LABEL[item.professional_role] || item.professional_role}</p>
                        </div>
                        {item.professional_name && (
                          <p className="text-xs text-content-muted">{item.professional_name}</p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-content-secondary">
                        <span>{item.scope}</span>
                        {item.document_name && (
                          <span className="flex items-center gap-1 text-xs text-content-muted mt-0.5">
                            <Paperclip size={11} className="shrink-0" />
                            {item.document_name}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-content-secondary">{item.form_ref || <span className="text-content-muted">–</span>}</td>
                      <td className="px-3 py-3">
                        {canEdit ? (
                          <select
                            value={item.status}
                            onChange={(e) => handleStatusChange(item, e.target.value)}
                            className="text-xs bg-transparent border-0 focus:ring-0 cursor-pointer text-content-secondary p-0"
                            aria-label="Sign-off status"
                          >
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </select>
                        ) : (
                          <Badge tone={STATUS_TONE[item.status] || 'neutral'}>{STATUS_LABEL[item.status] || item.status}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-content-secondary">{formatDate(item.signed_at)}</td>
                      <td className="px-3 py-3 text-xs text-content-secondary">{formatDate(item.expires_at)}</td>
                      <td className="px-3 py-3">
                        {canEdit && (
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="p-1 text-content-muted hover:text-red-500 transition-colors"
                            aria-label="Remove sign-off"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
