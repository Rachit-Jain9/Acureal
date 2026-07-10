import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { clsx } from 'clsx';
import useAuthStore from '../../store/authStore';
import { toast } from '../common/Toast';
import { ROLE_LABEL } from '../../utils/roles';

// Workspace switcher for users who belong to more than one organization. The
// backend already re-scopes every request from the X-Organization-Id header
// (api.js interceptor reads the cached user.organization_id), so switching is:
// set active org → re-hydrate the user for that org → refetch all queries.
export default function WorkspaceSwitcher({ collapsed = false }) {
  const user = useAuthStore((s) => s.user);
  const setActiveOrganization = useAuthStore((s) => s.setActiveOrganization);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef(null);

  const orgs = (user?.organizations || []).filter((o) => o.is_active !== false);
  const activeId = user?.organization_id;
  const active = orgs.find((o) => o.id === activeId) || orgs[0];

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Only meaningful when the user is in more than one workspace.
  if (orgs.length <= 1 || !active) return null;

  const switchTo = async (orgId) => {
    setOpen(false);
    if (orgId === activeId) return;
    setSwitching(true);
    const previousId = activeId;
    try {
      setActiveOrganization(orgId);
      const refreshed = await refreshUser();
      // refreshUser swallows its own error and returns null on failure. If we
      // can't re-hydrate the user for the new org, roll the active org back —
      // otherwise the app is stranded scoped to a workspace it couldn't load
      // and every subsequent request 403s.
      if (!refreshed) {
        setActiveOrganization(previousId);
        // removeQueries (not invalidate): any query that raced the brief org
        // flip could hold the OTHER workspace's rows under this one's keys —
        // drop them so nothing stale survives the rollback.
        queryClient.removeQueries();
        toast.error('Could not switch workspace. Please try again.');
        return;
      }
      // removeQueries (not invalidate): invalidation keeps serving the OLD
      // workspace's rows while refetching in the background — a cross-tenant
      // flash. Removing them puts every mounted surface into its skeleton
      // state and refetches under the new X-Organization-Id immediately.
      queryClient.removeQueries();
      const name = refreshed?.organization?.name
        || orgs.find((o) => o.id === orgId)?.name
        || 'workspace';
      toast.success(`Switched to ${name}`);
      navigate('/dashboard');
    } finally {
      setSwitching(false);
    }
  };

  const initialOf = (name) => (name || '?').trim().charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={clsx(
          'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
          'hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          'active:scale-[0.99] disabled:opacity-60',
        )}
        title={collapsed ? active.name : undefined}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-accent-soft text-accent text-xs font-semibold">
          {initialOf(active.name)}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-content-primary">{active.name}</span>
              <span className="block truncate text-[11px] text-content-muted capitalize">
                {ROLE_LABEL[active.role] || active.role}
              </span>
            </span>
            <ChevronsUpDown size={14} className="shrink-0 text-content-muted" />
          </>
        )}
      </button>

      {open && !collapsed && (
        <div
          role="listbox"
          aria-label="Switch workspace"
          className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border border-hairline bg-bg-elevated shadow-editorial"
        >
          <div className="px-2 pt-2 pb-1 text-[11px] uppercase tracking-wider text-content-muted">
            Switch workspace
          </div>
          {orgs.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === activeId}
              onClick={() => switchTo(o.id)}
              className={clsx(
                'flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors',
                'hover:bg-surface focus-visible:outline-none focus-visible:bg-surface',
                o.id === activeId ? 'text-accent' : 'text-content-secondary',
              )}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-bg-secondary text-[10px] font-semibold text-content-muted">
                {initialOf(o.name)}
              </span>
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              {o.id === activeId && <Check size={14} className="shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
