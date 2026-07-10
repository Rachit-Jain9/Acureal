import { useState, useEffect, useCallback } from 'react';
import { X, Share2, Loader2, Trash2, UserPlus, Shield, Eye, Edit3 } from 'lucide-react';
import { dealsAPI } from '../../services/api';
import { toast } from '../common/Toast';
import { useFocusTrap } from '../../hooks/useFocusTrap';

const PERMISSION_OPTIONS = [
  { value: 'viewer', label: 'View only', icon: Eye, description: 'Can view deal data but cannot edit' },
  { value: 'editor', label: 'Can edit', icon: Edit3, description: 'Can view and edit deal data' },
];

export default function ShareDealPanel({ dealId, dealName, isOwner, onClose, onSharesChange }) {
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState('viewer');
  const [sharing, setSharing] = useState(false);
  const [revokingId, setRevokingId] = useState(null);
  // A11y: trap Tab focus inside the dialog and restore focus to the opener on
  // close (WAI-ARIA dialog pattern). This was the only dialog missing it.
  const trapRef = useFocusTrap(true, { onEscape: onClose });

  const loadShares = useCallback(async () => {
    setLoading(true);
    try {
      const response = await dealsAPI.listShares(dealId);
      const list = response.data?.data || [];
      setShares(list);
      // Let the opener (deal header Share button) keep its live count in sync
      // after a share/revoke — no page refetch needed.
      onSharesChange?.(list.length);
    } catch {
      // Shares may not load if user is not owner
      setShares([]);
    } finally {
      setLoading(false);
    }
  }, [dealId, onSharesChange]);

  useEffect(() => {
    // Only the owner can list/manage shares (the API 403s everyone else).
    // Non-owners get an honest static state below — fetching would just
    // swallow a 403 and, worse, report a misleading count of 0 upward.
    if (isOwner) {
      loadShares();
    } else {
      setLoading(false);
    }
  }, [isOwner, loadShares]);

  const handleShare = async (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error('Email is required');
      return;
    }

    setSharing(true);
    try {
      await dealsAPI.shareDeal(dealId, trimmed, permission);
      toast.success(`Deal shared with ${trimmed}`);
      setEmail('');
      setPermission('viewer');
      await loadShares();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to share deal');
    } finally {
      setSharing(false);
    }
  };

  const handleRevoke = async (userId, userName) => {
    setRevokingId(userId);
    try {
      await dealsAPI.revokeShare(dealId, userId);
      toast.success(`Access revoked for ${userName}`);
      await loadShares();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to revoke access');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 py-8 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-deal-dialog-title"
    >
      <div ref={trapRef} className="bg-bg-elevated rounded-xl shadow-xl w-full max-w-lg mx-4 my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent-soft flex items-center justify-center">
              <Share2 size={16} className="text-accent" />
            </div>
            <div>
              <h3 id="share-deal-dialog-title" className="text-base font-semibold text-content-primary">Share Deal</h3>
              <p className="text-xs text-content-secondary truncate max-w-[280px]">{dealName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close share deal dialog"
            className="text-content-muted hover:text-content-secondary p-1 rounded-lg hover:bg-bg-secondary transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Share form */}
        {isOwner && (
          <form onSubmit={handleShare} className="px-6 py-4 border-b border-hairline">
            <div className="flex items-center gap-2 mb-3">
              <UserPlus size={14} className="text-content-muted" />
              <span className="text-sm font-medium text-content-secondary">Invite by email</span>
            </div>
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                className="flex-1 px-3 py-2 border border-hairline-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                required
              />
              <select
                value={permission}
                onChange={(e) => setPermission(e.target.value)}
                className="px-3 py-2 border border-hairline-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-bg-elevated"
              >
                {PERMISSION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={sharing}
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-content-inverse rounded-lg text-sm font-medium transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {sharing ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
                Share
              </button>
            </div>
            <p className="mt-2 text-xs text-content-muted">
              The user must have a REDIP account. They will see this deal in their dashboard.
            </p>
          </form>
        )}

        {/* Shared with list (owner) / honest read-only note (everyone else) */}
        <div className="px-6 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={14} className="text-content-muted" />
            <span className="text-sm font-medium text-content-secondary">
              People with access
            </span>
            {isOwner && <span className="text-xs text-content-muted">({shares.length})</span>}
          </div>

          {!isOwner ? (
            <div className="py-6 text-center">
              <p className="text-sm text-content-muted">
                This deal was shared with you — access is managed by the deal owner.
              </p>
            </div>
          ) : loading ? (
            <div className="flex items-center gap-2 py-6 justify-center text-sm text-content-muted">
              <Loader2 size={14} className="animate-spin" />
              Loading...
            </div>
          ) : shares.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-content-muted">
                This deal is private. Only you can see it.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {shares.map((share) => {
                const PermIcon = share.permission === 'editor' ? Edit3 : Eye;
                return (
                  <div
                    key={share.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-hairline hover:border-hairline-strong transition"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-bg-secondary flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-semibold text-content-secondary uppercase">
                          {(share.shared_with_name || share.shared_with_email || '?')[0]}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-content-primary truncate">
                          {share.shared_with_name || share.shared_with_email}
                        </p>
                        {share.shared_with_name && (
                          <p className="text-xs text-content-muted truncate">{share.shared_with_email}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-bg-secondary text-content-secondary">
                        <PermIcon size={11} />
                        {share.permission === 'editor' ? 'Editor' : 'Viewer'}
                      </span>
                      {isOwner && (
                        <button
                          onClick={() => handleRevoke(share.shared_with, share.shared_with_name || share.shared_with_email)}
                          disabled={revokingId === share.shared_with}
                          className="p-1.5 rounded-lg text-content-muted hover:text-data-negative hover:bg-neg-soft transition disabled:opacity-50"
                          title="Revoke access"
                        >
                          {revokingId === share.shared_with ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Trash2 size={13} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-hairline flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-content-secondary hover:bg-bg-secondary rounded-lg transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
