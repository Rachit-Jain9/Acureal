import { useState } from 'react';
import { Users, UserPlus, Shield, Eye, Edit3, Loader2, Trash2, Lock } from 'lucide-react';
import { SectionHeader, confirm } from '../../design-system';
import { useDealContext, useDealRecord } from '../../hooks/useDealContext';
import { useDealShares, useShareDeal, useRevokeShare } from '../../hooks/useDealShares';
import useAuthStore from '../../store/authStore';

const PERMISSION_OPTIONS = [
  { value: 'viewer', label: 'View only' },
  { value: 'editor', label: 'Can edit' },
];

// In-tab "Team & access" panel — surfaces deal sharing exactly where the
// operator looks for it (the Activity tab), instead of only behind the
// header Share button. Reuses the owner-only sharing endpoints via
// useDealShares. Non-owners see a "managed by the owner" note (the backend
// returns an empty list to them, so an empty-state would be misleading).
export default function DealAccessSection() {
  const { dealId } = useDealContext();
  const deal = useDealRecord();
  const user = useAuthStore((s) => s.user);
  const isOwner = Boolean(deal?.created_by && user?.id && deal.created_by === user.id);

  const { data: shares = [], isLoading } = useDealShares(dealId, { enabled: isOwner });
  const shareDeal = useShareDeal();
  const revokeShare = useRevokeShare();

  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState('viewer');

  const handleShare = async (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    try {
      await shareDeal.mutateAsync({ dealId, email: trimmed, permission });
      setEmail('');
      setPermission('viewer');
    } catch {
      // toast handled in the mutation hook
    }
  };

  const handleRevoke = async (share) => {
    const who = share.shared_with_name || share.shared_with_email;
    const ok = await confirm({
      title: `Remove ${who}'s access?`,
      tone: 'danger',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    revokeShare.mutate({ dealId, userId: share.shared_with });
  };

  return (
    <div className="card-editorial">
      <SectionHeader
        size="sm"
        icon={Users}
        title="Team & access"
        sub="Share this deal workspace with your team"
        action={
          isOwner ? (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-content-muted">
              <Users size={13} />
              {shares.length} {shares.length === 1 ? 'person' : 'people'}
            </span>
          ) : null
        }
      />

      {!isOwner ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-hairline bg-bg-secondary px-3.5 py-3">
          <Lock size={15} className="mt-0.5 shrink-0 text-content-muted" />
          <p className="text-sm text-content-secondary">
            Access to this workspace is managed by the deal owner. Ask them to add you if you need to view or edit it.
          </p>
        </div>
      ) : (
        <>
          <form onSubmit={handleShare} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="sr-only" htmlFor="deal-share-email">Teammate email</label>
            <input
              id="deal-share-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              className="input text-sm flex-1"
              required
            />
            <label className="sr-only" htmlFor="deal-share-permission">Permission</label>
            <select
              id="deal-share-permission"
              value={permission}
              onChange={(e) => setPermission(e.target.value)}
              className="input text-sm sm:w-40"
            >
              {PERMISSION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={shareDeal.isPending}
              className="btn btn-primary text-sm flex items-center justify-center gap-1.5"
            >
              {shareDeal.isPending ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              Share
            </button>
          </form>

          <p className="mt-2 flex items-center gap-1.5 text-xs text-content-muted">
            <Shield size={12} className="shrink-0" />
            The person must already have a REDIP account. They&apos;ll then see this deal in their dashboard.
          </p>

          <div className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-content-muted">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : shares.length === 0 ? (
              <p className="rounded-lg border border-dashed border-hairline-strong bg-bg-secondary px-3.5 py-4 text-center text-sm text-content-muted">
                This deal is private — only you can see it. Invite a teammate above to collaborate.
              </p>
            ) : (
              <ul className="space-y-2">
                {shares.map((share) => {
                  const PermIcon = share.permission === 'editor' ? Edit3 : Eye;
                  const who = share.shared_with_name || share.shared_with_email;
                  const revoking = revokeShare.isPending && revokeShare.variables?.userId === share.shared_with;
                  return (
                    <li
                      key={share.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2.5 transition-colors hover:border-hairline-strong"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-secondary text-xs font-semibold uppercase text-content-secondary">
                          {(who || '?')[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-content-primary">{who}</p>
                          {share.shared_with_name && (
                            <p className="truncate text-xs text-content-muted">{share.shared_with_email}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded bg-bg-secondary px-2 py-0.5 text-xs font-medium text-content-secondary">
                          <PermIcon size={11} />
                          {share.permission === 'editor' ? 'Editor' : 'Viewer'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRevoke(share)}
                          disabled={revoking}
                          className="rounded-lg p-1.5 text-content-muted transition-colors hover:bg-neg-soft hover:text-data-negative disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                          title="Remove access"
                          aria-label={`Remove ${who}'s access`}
                        >
                          {revoking ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
