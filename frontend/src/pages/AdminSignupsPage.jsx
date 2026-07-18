import { useState } from 'react';
import {
  Users,
  UserPlus,
  Search,
  RefreshCcw,
  BadgeCheck,
  Building2,
  Mail,
} from 'lucide-react';
import { clsx } from 'clsx';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { Card, SectionHeader, SkeletonList, ErrorState } from '../design-system';
import { useCountUp } from '../hooks/useCountUp';
import { useSignups } from '../hooks/useSignups';

/**
 * Admin · Signups — the open-beta "who has joined" roster.
 *
 * REDIP registration is open to everyone; this operator-only page is how the
 * founder actually SEES it happening. It lists every account platform-wide,
 * newest first, with the profile detail each person volunteered at sign-up
 * (company / role / city) plus account timestamps and how they joined.
 *
 * Reads /api/admin/signups (platform-admin gated, cross-org by design).
 * Read-only. Never renders secrets — only descriptive profile + timestamps.
 */

const fmtRelTime = (iso) => {
  if (!iso) return '—';
  const dt = new Date(iso).getTime();
  if (!Number.isFinite(dt)) return '—';
  const secs = Math.floor((Date.now() - dt) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 86400 * 30) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN');
};

const fmtAbsTime = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const dash = (v) => {
  const s = v === undefined || v === null ? '' : String(v).trim();
  return s || '—';
};

// A number that rolls to its value on change (reduced-motion snaps instantly).
function LiveNumber({ value }) {
  const n = useCountUp(Number.isFinite(Number(value)) ? Number(value) : 0);
  return <span className="tabular-nums">{Math.round(n).toLocaleString('en-IN')}</span>;
}

function StatTile({ icon: Icon, label, value, hint }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2.5">
        <div className="shrink-0 p-2 rounded-md bg-bg-secondary">
          <Icon size={15} className="text-content-muted" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">
          {label}
        </div>
      </div>
      <div className="mt-2 text-3xl font-display font-bold text-content-primary tabular-nums">
        <LiveNumber value={value} />
      </div>
      {hint && <div className="mt-1 text-[11px] text-content-muted">{hint}</div>}
    </Card>
  );
}

function MethodBadge({ oauthProvider }) {
  const isGoogle = oauthProvider === 'google';
  return (
    <Badge tone={isGoogle ? 'info' : 'neutral'} className="text-[10px] inline-flex items-center gap-1">
      <Mail size={9} />
      {isGoogle ? 'Google' : 'Email'}
    </Badge>
  );
}

function SignupRow({ s }) {
  const closed = Boolean(s.account_closed_at) || s.is_active === false;
  return (
    <tr className="border-b border-hairline-soft last:border-b-0 hover:bg-bg-secondary/40 transition-colors">
      {/* Person */}
      <td className="py-2.5 pr-3 align-top min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-content-primary truncate max-w-[14rem]">
            {dash(s.name)}
          </span>
          {closed && (
            <span className="text-[9px] uppercase tracking-wider text-content-muted border border-hairline rounded px-1 py-0.5">
              Closed
            </span>
          )}
        </div>
        <div className="text-[11px] text-content-secondary truncate max-w-[16rem]">{dash(s.email)}</div>
      </td>
      {/* Company / role */}
      <td className="py-2.5 pr-3 align-top">
        <div className="text-[12px] text-content-primary truncate max-w-[12rem]">{dash(s.company)}</div>
        <div className="text-[11px] text-content-muted truncate max-w-[12rem]">{dash(s.job_title)}</div>
      </td>
      {/* City */}
      <td className="py-2.5 pr-3 align-top text-[12px] text-content-secondary whitespace-nowrap">
        {dash(s.city)}
      </td>
      {/* Phone */}
      <td className="py-2.5 pr-3 align-top text-[11px] text-content-secondary tabular-nums whitespace-nowrap">
        {dash(s.phone)}
      </td>
      {/* Joined */}
      <td
        className="py-2.5 pr-3 align-top text-[11px] text-content-secondary tabular-nums whitespace-nowrap"
        title={fmtAbsTime(s.created_at)}
      >
        {fmtRelTime(s.created_at)}
      </td>
      {/* Status */}
      <td className="py-2.5 pr-3 align-top whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <MethodBadge oauthProvider={s.oauth_provider} />
          {s.email_verified_at ? (
            <Badge tone="success" className="text-[10px] inline-flex items-center gap-1">
              <BadgeCheck size={9} /> Verified
            </Badge>
          ) : (
            <Badge tone="neutral" className="text-[10px]">Unverified</Badge>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function AdminSignupsPage() {
  const [search, setSearch] = useState('');
  const { data, isLoading, isError, refetch, isFetching } = useSignups({ search });

  const signups = data?.signups || [];
  const summary = data?.summary || {};

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Growth"
        title="Signups"
        description="Everyone who has joined REDIP, newest first. Registration is open to all during the beta — this is where you see who it's attracting, with the company, role and city they shared when they signed up. You also get an email the moment each new person joins."
        actions={
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
            title="Refresh the list"
          >
            <RefreshCcw size={12} className={clsx(isFetching && 'animate-spin')} />
            Refresh
          </button>
        }
      />

      {/* Summary tiles */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Users} label="Total signups" value={summary.total ?? 0} />
        <StatTile icon={UserPlus} label="Last 7 days" value={summary.last_7_days ?? 0} hint="new this week" />
        <StatTile icon={UserPlus} label="Last 30 days" value={summary.last_30_days ?? 0} hint="new this month" />
        <StatTile icon={BadgeCheck} label="Email verified" value={summary.verified ?? 0} hint={`${summary.via_google ?? 0} via Google`} />
      </div>

      {/* Search + table */}
      <Card className="p-0 overflow-hidden">
        <div className="px-5 pt-5 flex items-center justify-between gap-3 flex-wrap">
          <SectionHeader
            size="sm"
            icon={Building2}
            eyebrow={search ? 'Filtered' : 'All accounts'}
            title={
              isLoading
                ? 'Loading…'
                : `${signups.length.toLocaleString('en-IN')} shown`
            }
            sub="Sorted newest first. Search by name, email, company or city."
          />
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search signups…"
              aria-label="Search signups by name, email, company or city"
              className="w-56 pl-8 pr-3 py-1.5 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary placeholder:text-content-muted transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          </div>
        </div>

        {isError && (
          <div className="px-5 py-6">
            <ErrorState tone="danger" title="Could not load signups">
              The admin endpoint returned an error. Try Refresh; if it persists, check the
              Vercel runtime logs for /api/admin/signups.
            </ErrorState>
          </div>
        )}

        {isLoading && (
          <div className="px-5 pb-5 pt-2">
            <SkeletonList rows={6} />
          </div>
        )}

        {!isLoading && !isError && signups.length === 0 && (
          <div className="px-5 py-12 text-center text-[12px] text-content-muted">
            {search
              ? 'No signups match your search.'
              : 'No signups yet. As soon as someone creates an account, they will appear here.'}
          </div>
        )}

        {!isLoading && !isError && signups.length > 0 && (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary/40 border-y border-hairline-soft">
                <tr>
                  <th scope="col" className="text-left px-5 py-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">Person</th>
                  <th scope="col" className="text-left py-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">Company / role</th>
                  <th scope="col" className="text-left py-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">City</th>
                  <th scope="col" className="text-left py-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">Phone</th>
                  <th scope="col" className="text-left py-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">Joined</th>
                  <th scope="col" className="text-left py-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">Status</th>
                </tr>
              </thead>
              <tbody className="[&>tr>td]:px-0 [&>tr>td:first-child]:pl-5 [&>tr>td:last-child]:pr-5">
                {signups.map((s) => (
                  <SignupRow key={s.id} s={s} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-5 py-2.5 border-t border-hairline-soft text-[10px] text-content-muted leading-relaxed">
          <Users size={10} className="inline -mt-0.5 mr-1 text-accent" />
          Platform-wide operator view. Company, role and city are optional and shown only if the
          person filled them in. Registration is open to everyone during the beta.
        </div>
      </Card>
    </div>
  );
}
