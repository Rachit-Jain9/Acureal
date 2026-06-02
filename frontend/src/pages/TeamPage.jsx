import { useState } from 'react';
import {
  UserPlus, ShieldCheck, Globe, Trash2, Check, Copy, UserCheck,
} from 'lucide-react';
import {
  Button, Modal, Field, Input, Select, SkeletonList, confirm, Card, SectionHeader, ErrorState,
} from '../design-system';
import Badge from '../components/common/Badge';
import PageHeader from '../components/common/PageHeader';
import { toast } from '../components/common/Toast';
import useAuthStore from '../store/authStore';
import { roleSatisfies, ROLE_LABEL } from '../utils/roles';
import {
  useOrganizationMembers, useInviteMember, useUpdateMemberRole, useRemoveMember,
  useJoinRequests, useApproveJoinRequest, useRejectJoinRequest,
  useOrganizationDomains, useAddDomain, useVerifyDomain,
  useSetDomainPolicy, useRemoveDomain,
} from '../hooks/useOrganization';

// Role rank, low → high. Used to cap what an actor may assign and to tell when a
// member outranks the actor (read-only then). Mirrors backend ROLE_PRIORITY.
const ROLE_ORDER = ['viewer', 'editor', 'admin', 'owner'];
const rankOf = (role) => ROLE_ORDER.indexOf(role);

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '—';
  }
};

// A row in the active roster. Pending join requests render via PendingRow
// below — they are a distinct list, never mixed in here.
function MemberRow({ member, actorRole, selfId, busy, onChangeRole, onRemove }) {
  const isSelf = member.id === selfId;
  const actorRank = rankOf(actorRole);
  const memberRank = rankOf(member.role);
  const canManage = roleSatisfies(actorRole, ['admin']);
  // You can act on someone only if they don't outrank you, and never on yourself
  // through these controls (you can't remove your own access here).
  const canActOnMember = canManage && !isSelf && memberRank <= actorRank;
  const assignableRoles = ROLE_ORDER.filter((_, i) => i <= actorRank);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 border-b border-hairline-soft last:border-b-0" role="listitem">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-content-primary truncate">
          {member.name || member.email}
          {isSelf && <span className="ml-1.5 text-content-muted font-normal">(you)</span>}
        </div>
        <div className="text-xs text-content-muted truncate">{member.email}</div>
      </div>

      <div className="hidden sm:block text-xs text-content-muted tabular-nums w-24 text-right">
        {fmtDate(member.joined_at)}
      </div>

      <div className="flex items-center gap-2 w-[13.5rem] justify-end">
        {canActOnMember ? (
          <>
            <Select
              aria-label={`Role for ${member.name || member.email}`}
              value={member.role}
              disabled={busy}
              onChange={(e) => onChangeRole(member, e.target.value)}
              className="!py-1 !text-xs w-28"
            >
              {assignableRoles.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </Select>
            <Button size="sm" variant="ghost" onClick={() => onRemove(member)}
              aria-label={`Remove ${member.name || member.email}`}>
              <Trash2 size={14} />
            </Button>
          </>
        ) : (
          <Badge tone={member.role === 'owner' ? 'premium' : 'neutral'}>
            {ROLE_LABEL[member.role] || member.role}
          </Badge>
        )}
      </div>
    </div>
  );
}

// A pending domain auto-join awaiting an admin's decision. Distinct from the
// roster: approving moves the person into the workspace at the role they were
// routed to; declining removes the request entirely.
function PendingRow({ request, canManage, busy, onApprove, onDecline }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 border-b border-hairline-soft last:border-b-0" role="listitem">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-content-primary truncate">
          {request.name || request.email}
        </div>
        <div className="text-xs text-content-muted truncate">{request.email}</div>
      </div>

      <div className="hidden sm:block text-xs text-content-muted w-28 text-right">
        wants {ROLE_LABEL[request.role] || request.role}
      </div>

      <div className="flex items-center gap-2 w-[13.5rem] justify-end">
        {canManage ? (
          <>
            <Button size="sm" variant="secondary" leftIcon={<Check size={14} />}
              loading={busy} onClick={() => onApprove(request)}>
              Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDecline(request)} aria-label={`Decline ${request.name || request.email}`}>
              <Trash2 size={14} />
            </Button>
          </>
        ) : <Badge tone="warn">Pending</Badge>}
      </div>
    </div>
  );
}

function DnsRecord({ verification }) {
  const copy = (text, label) => {
    try {
      navigator.clipboard?.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      /* clipboard unavailable — the value is shown for manual copy */
    }
  };
  const Field2 = ({ label, value }) => (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-xs text-content-muted w-16 shrink-0">{label}</span>
      <code className="text-xs text-content-primary font-mono truncate flex-1">{value}</code>
      <button type="button" onClick={() => copy(value, label)}
        className="shrink-0 p-1 rounded text-content-muted transition-colors hover:text-content-primary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        aria-label={`Copy ${label}`}>
        <Copy size={13} />
      </button>
    </div>
  );
  return (
    <div className="mt-2 rounded-lg bg-bg-secondary border border-hairline-soft px-3 py-2">
      <p className="text-xs text-content-secondary mb-1">
        Add this TXT record at your DNS provider, then click Verify:
      </p>
      <Field2 label="Type" value={verification.type} />
      <Field2 label="Host" value={verification.host} />
      <Field2 label="Value" value={verification.value} />
    </div>
  );
}

function DomainRow({ domain, busy, onVerify, onSetPolicy, onRemove }) {
  return (
    <div className="py-3 border-b border-hairline-soft last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <Globe size={15} className="text-content-muted shrink-0" />
          <span className="text-sm font-medium text-content-primary truncate">{domain.domain}</span>
          {domain.verified
            ? <Badge tone="success">Verified</Badge>
            : <Badge tone="warn">Unverified</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {!domain.verified && (
            <Button size="sm" variant="secondary" loading={busy} onClick={() => onVerify(domain)}>
              Verify
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onRemove(domain)} aria-label={`Remove ${domain.domain}`}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      {!domain.verified && domain.verification && <DnsRecord verification={domain.verification} />}

      {domain.verified && (
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <Field label="New teammates join as" className="!mb-0">
            <Select
              value={domain.default_role}
              disabled={busy}
              onChange={(e) => onSetPolicy(domain, { defaultRole: e.target.value })}
              className="!py-1 !text-xs w-32"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          <Field label="Joining" className="!mb-0">
            <Select
              value={domain.require_admin_approval ? 'approval' : 'auto'}
              disabled={busy}
              onChange={(e) => onSetPolicy(domain, { requireAdminApproval: e.target.value === 'approval' })}
              className="!py-1 !text-xs w-40"
            >
              <option value="auto">Automatic</option>
              <option value="approval">Needs admin approval</option>
            </Select>
          </Field>
        </div>
      )}
    </div>
  );
}

function InviteModal({ open, onClose, onSubmit, busy }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');

  const submit = (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    onSubmit({ email: email.trim(), role }, () => { setEmail(''); setRole('editor'); });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite a teammate"
      description="They'll get an email link to join this workspace at the role you choose."
      footer={<Button type="submit" form="invite-form" loading={busy}>Send invite</Button>}
    >
      <form id="invite-form" onSubmit={submit} className="space-y-4">
        <Field label="Work email" required>
          <Input type="email" value={email} placeholder="name@company.com"
            onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="Role" helper="Editors can work on deals; Admins also manage the team.">
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="viewer">Viewer — read-only</option>
            <option value="editor">Editor — full deal work</option>
            <option value="admin">Admin — manage the workspace</option>
          </Select>
        </Field>
      </form>
    </Modal>
  );
}

export default function TeamPage() {
  const user = useAuthStore((s) => s.user);
  const canManage = roleSatisfies(user?.role, ['admin']);

  const { data: members, isLoading: membersLoading, isError: membersError } = useOrganizationMembers();
  const { data: domains, isLoading: domainsLoading } = useOrganizationDomains();
  // Pending join requests are admin-gated on the server, so only fetch them for
  // managers — viewers never see this section.
  const { data: joinRequests } = useJoinRequests(canManage);

  const invite = useInviteMember();
  const changeRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const approve = useApproveJoinRequest();
  const decline = useRejectJoinRequest();
  const addDomain = useAddDomain();
  const verifyDomain = useVerifyDomain();
  const setDomainPolicy = useSetDomainPolicy();
  const removeDomain = useRemoveDomain();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [newDomain, setNewDomain] = useState('');

  const memberBusy = changeRole.isPending || removeMember.isPending;
  const requestBusy = approve.isPending || decline.isPending;
  const domainBusy = addDomain.isPending || verifyDomain.isPending
    || setDomainPolicy.isPending || removeDomain.isPending;

  const activeCount = (members || []).length;
  const pending = joinRequests || [];

  const handleInvite = ({ email, role }, reset) => {
    invite.mutate({ email, role }, { onSuccess: () => { reset(); setInviteOpen(false); } });
  };

  const handleRemove = async (member) => {
    const ok = await confirm({
      title: `Remove ${member.name || member.email}?`,
      message: 'They will lose access to this workspace. You can re-invite them anytime.',
      tone: 'danger',
      confirmLabel: 'Remove access',
    });
    if (ok) removeMember.mutate(member.id);
  };

  const handleDecline = async (request) => {
    const ok = await confirm({
      title: `Decline ${request.name || request.email}?`,
      message: 'Their pending request to join will be removed. They can request again later.',
      tone: 'danger',
      confirmLabel: 'Decline',
    });
    if (ok) decline.mutate(request.id);
  };

  const handleAddDomain = (e) => {
    e.preventDefault();
    const value = newDomain.trim();
    if (!value) return;
    addDomain.mutate(value, { onSuccess: () => setNewDomain('') });
  };

  const handleRemoveDomain = async (domain) => {
    const ok = await confirm({
      title: `Remove ${domain.domain}?`,
      message: domain.verified
        ? 'New teammates with this domain will no longer auto-join.'
        : 'This unverified claim will be removed.',
      tone: 'danger',
      confirmLabel: 'Remove',
    });
    if (ok) removeDomain.mutate(domain.id);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        eyebrow="Workspace"
        title="Team & Members"
        description="Manage who can access this workspace, what they can do, and how new teammates join."
        actions={canManage && (
          <Button variant="primary" leftIcon={<UserPlus size={15} />} onClick={() => setInviteOpen(true)}>
            Invite
          </Button>
        )}
      />

      {/* Pending join requests — admin/owner only, shown only when some exist.
          Kept above the roster so an admin sees decisions that need making
          before the (longer) list of existing members. */}
      {canManage && pending.length > 0 && (
        <Card className="p-5">
          <SectionHeader
            icon={UserCheck}
            title="Pending requests"
            sub={`${pending.length} ${pending.length === 1 ? 'person is' : 'people are'} waiting to join via your company domain.`}
          />
          <div role="list">
            {pending.map((request) => (
              <PendingRow
                key={request.id}
                request={request}
                canManage={canManage}
                busy={requestBusy}
                onApprove={(r) => approve.mutate(r.id)}
                onDecline={handleDecline}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Members */}
      <Card className="p-5">
        <SectionHeader
          icon={ShieldCheck}
          title="Members"
          sub={membersLoading ? 'Loading the roster…' : `${activeCount} active`}
        />

        {membersLoading ? (
          <SkeletonList rows={5} columns={3} />
        ) : membersError ? (
          <ErrorState tone="danger" title="Couldn't load the team">
            Refresh the page to try again.
          </ErrorState>
        ) : (members || []).length === 0 ? (
          <ErrorState tone="info" title="No members yet">
            Invite your first teammate to get started.
          </ErrorState>
        ) : (
          <div role="list">
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                actorRole={user?.role}
                selfId={user?.id}
                busy={memberBusy}
                onChangeRole={(m, role) => changeRole.mutate({ userId: m.id, role })}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
        {!canManage && (members || []).length > 0 && (
          <p className="mt-4 text-xs text-content-muted">
            Only owners and admins can invite or change roles.
          </p>
        )}
      </Card>

      {/* Domains — admin/owner only */}
      {canManage && (
        <Card className="p-5">
          <SectionHeader
            icon={Globe}
            title="Company domains"
            sub="Verify your email domain so teammates auto-join this workspace instead of creating their own."
          />

          <form onSubmit={handleAddDomain} className="flex flex-wrap items-end gap-3 mb-5">
            <Field label="Add a domain" className="!mb-0 flex-1 min-w-[12rem]">
              <Input value={newDomain} placeholder="acme.in"
                onChange={(e) => setNewDomain(e.target.value)} />
            </Field>
            <Button type="submit" variant="secondary" loading={addDomain.isPending}>Add</Button>
          </form>

          {domainsLoading ? (
            <SkeletonList rows={2} columns={2} />
          ) : (domains || []).length === 0 ? (
            <p className="text-sm text-content-muted">
              No domains claimed yet. Free providers (Gmail, Outlook, …) can't be claimed.
            </p>
          ) : (
            <div role="list">
              {domains.map((domain) => (
                <DomainRow
                  key={domain.id}
                  domain={domain}
                  busy={domainBusy}
                  onVerify={(d) => verifyDomain.mutate(d.id)}
                  onSetPolicy={(d, policy) => setDomainPolicy.mutate({ domainId: d.id, policy })}
                  onRemove={handleRemoveDomain}
                />
              ))}
            </div>
          )}
        </Card>
      )}

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSubmit={handleInvite}
        busy={invite.isPending}
      />
    </div>
  );
}
