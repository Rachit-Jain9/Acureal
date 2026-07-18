import {
  Activity,
  ShieldCheck,
  FileStack,
  Cpu,
  RefreshCcw,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
} from 'lucide-react';
import { clsx } from 'clsx';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { Card, SectionHeader, SkeletonCard, ErrorState } from '../design-system';
import { useCountUp } from '../hooks/useCountUp';
import { useSystemHealth } from '../hooks/useSystemHealth';

// Admin-only System Health — the operator-facing face of the liveness watchdog.
//
// Reads /api/admin/system-health (the same four subsystem checks the hourly
// cron runs: AI provider error share, audit-write liveness, stuck extractions,
// and the tenant-isolation fail-closed canary) and renders them as a calm,
// precise vitals board. The point of this surface is a single trustworthy
// "is the platform healthy right now?" view — so the operator learns about
// degradation from a dashboard instead of by personally hitting the bug.
//
// Read-only. Cross-org aggregate health only (counts + statuses, no tenant
// data). Refreshes on a gentle interval + window focus via the hook.

const STATUS_META = {
  healthy: {
    tone: 'success',
    label: 'Operational',
    Icon: CheckCircle2,
    stripe: 'var(--color-data-positive)',
  },
  unhealthy: {
    tone: 'danger',
    label: 'Needs attention',
    Icon: AlertTriangle,
    stripe: 'var(--color-data-negative)',
  },
  unknown: {
    tone: 'neutral',
    label: 'No signal',
    Icon: HelpCircle,
    stripe: 'var(--color-text-muted)',
  },
};

const fmtRelative = (iso) => {
  if (!iso) return '—';
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const s = Math.round(ms / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    return `${Math.round(m / 60)}h ago`;
  } catch {
    return '—';
  }
};

// A number that rolls to its value on change (reduced-motion snaps instantly).
function LiveNumber({ value, className }) {
  const n = useCountUp(Number.isFinite(Number(value)) ? Number(value) : 0);
  return (
    <span className={clsx('tabular-nums', className)}>
      {Math.round(n).toLocaleString('en-IN')}
    </span>
  );
}

function OverallBanner({ overall, unhealthyCount, unknownCount, windowHours }) {
  const ok = overall !== 'unhealthy';
  const stripe = ok ? 'var(--color-data-positive)' : 'var(--color-data-negative)';
  return (
    <Card elevated className="relative overflow-hidden p-5">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: stripe }} />
      <div className="pl-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          {ok ? (
            <CheckCircle2 size={24} className="text-data-positive shrink-0" />
          ) : (
            <AlertTriangle size={24} className="text-data-negative shrink-0" />
          )}
          <div className="min-w-0">
            <div className="font-display text-lg font-semibold text-content-primary leading-tight">
              {ok
                ? 'All systems nominal'
                : `${unhealthyCount} subsystem${unhealthyCount === 1 ? '' : 's'} need${unhealthyCount === 1 ? 's' : ''} attention`}
            </div>
            <div className="text-xs text-content-muted mt-0.5">
              Watched hourly · {windowHours}h detection window
              {unknownCount > 0
                ? ` · ${unknownCount} check${unknownCount === 1 ? '' : 's'} without signal`
                : ''}
            </div>
          </div>
        </div>
        <Badge tone={ok ? 'success' : 'danger'} className="text-[11px] shrink-0">
          {ok ? 'HEALTHY' : 'DEGRADED'}
        </Badge>
      </div>
    </Card>
  );
}

function VitalCard({ icon: Icon, title, status, metric, metricLabel, detail, extra }) {
  const meta = STATUS_META[status] || STATUS_META.unknown;
  const StatusIcon = meta.Icon;
  return (
    <Card className="relative overflow-hidden p-5">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: meta.stripe }} />
      <div className="pl-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="shrink-0 p-2 rounded-md bg-bg-secondary">
              <Icon size={16} className="text-content-muted" />
            </div>
            <div className="min-w-0">
              <div className="font-display text-sm font-semibold text-content-primary leading-tight truncate">
                {title}
              </div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-content-muted font-semibold mt-0.5">
                {metricLabel}
              </div>
            </div>
          </div>
          <Badge tone={meta.tone} className="text-[10px] shrink-0 inline-flex items-center gap-1">
            <StatusIcon size={10} />
            {meta.label}
          </Badge>
        </div>

        <div className="mt-3">
          <span
            className={clsx(
              'text-3xl font-display font-bold tabular-nums',
              status === 'unhealthy' ? 'text-data-negative' : 'text-content-primary',
            )}
          >
            {metric}
          </span>
        </div>

        <p className="mt-2 text-xs text-content-muted leading-relaxed">{detail}</p>
        {extra}
      </div>
    </Card>
  );
}

export default function AdminSystemHealthPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useSystemHealth();

  const checks = data?.checks || {};
  const ai = checks.ai_providers || {};
  const audit = checks.audit_trail || {};
  const extractions = checks.extractions || {};
  const tenant = checks.tenant_isolation || {};
  const windowHours = data?.window_hours ?? 3;

  const aiOffenders = Array.isArray(ai.offenders) ? ai.offenders : [];
  const auditRows = (Number(audit.audit_writes) || 0) + (Number(audit.event_writes) || 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Reliability"
        title="System Health"
        description="The liveness watchdog. REDIP's costliest failures have been silent — a subsystem quietly doing nothing while everything looks fine. These four checks run hourly (alerting on degradation) and on demand here, so the platform detects its own decline instead of waiting for someone to hit the bug."
        actions={
          <div className="flex items-center gap-3">
            {data?.generated_at && (
              <span className="text-[11px] text-content-muted tabular-nums hidden sm:inline">
                Checked {fmtRelative(data.generated_at)}
              </span>
            )}
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
              title="Re-run checks now"
            >
              <RefreshCcw size={12} className={isFetching ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        }
      />

      {isLoading && (
        <div className="space-y-4">
          <SkeletonCard />
          <div className="grid gap-4 sm:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
      )}

      {isError && !isLoading && (
        <ErrorState
          tone="danger"
          title="Couldn't load system health"
          action={
            <button
              type="button"
              onClick={() => refetch()}
              className="text-sm text-accent hover:underline focus-visible:outline-none focus-visible:underline"
            >
              Try again
            </button>
          }
        >
          {error?.response?.data?.message || error?.message || 'Network error.'}
        </ErrorState>
      )}

      {!isLoading && !isError && data && (
        <>
          <OverallBanner
            overall={data.overall}
            unhealthyCount={data.unhealthy_count || 0}
            unknownCount={data.unknown_count || 0}
            windowHours={windowHours}
          />

          <SectionHeader
            size="sm"
            eyebrow="Subsystems"
            title="What's being watched"
            sub="Each check is the sentinel for a failure that has actually shipped silently before."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            {/* AI providers */}
            <VitalCard
              icon={Cpu}
              title="AI providers"
              status={ai.status || 'unknown'}
              metric={
                ai.status === 'unhealthy' ? (
                  <LiveNumber value={aiOffenders.length} />
                ) : (
                  <LiveNumber value={ai.models_checked ?? 0} />
                )
              }
              metricLabel={
                ai.status === 'unhealthy'
                  ? 'models over error threshold'
                  : `models watched · ${windowHours}h`
              }
              detail={ai.detail || ai.error || 'No signal.'}
              extra={
                aiOffenders.length > 0 ? (
                  <div className="mt-3 space-y-1">
                    {aiOffenders.map((o) => (
                      <div
                        key={`${o.provider}-${o.model}`}
                        className="flex items-center justify-between gap-2 text-[11px] rounded-md bg-neg-soft px-2 py-1"
                      >
                        <span className="font-mono text-content-secondary truncate">
                          {o.provider}/{o.model}
                        </span>
                        <span className="text-data-negative tabular-nums shrink-0">
                          {Math.round((o.error_share || 0) * 100)}% · {o.failures}/{o.calls}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null
              }
            />

            {/* Audit trail */}
            <VitalCard
              icon={ShieldCheck}
              title="Audit trail"
              status={audit.status || 'unknown'}
              metric={<LiveNumber value={auditRows} />}
              metricLabel={`audit rows · ${windowHours}h`}
              detail={audit.detail || audit.error || 'No signal.'}
              extra={
                audit.status && audit.status !== 'unknown' ? (
                  <div className="mt-2 text-[11px] text-content-muted tabular-nums">
                    {Number(audit.deal_mutations) || 0} deal mutation
                    {Number(audit.deal_mutations) === 1 ? '' : 's'} ·{' '}
                    {Number(audit.activity_writes) || 0} activit
                    {Number(audit.activity_writes) === 1 ? 'y' : 'ies'} in window
                  </div>
                ) : null
              }
            />

            {/* Document extractions */}
            <VitalCard
              icon={FileStack}
              title="Document extractions"
              status={extractions.status || 'unknown'}
              metric={<LiveNumber value={extractions.stuck ?? 0} />}
              metricLabel={`stuck > ${extractions.threshold_minutes ?? 15}m`}
              detail={extractions.detail || extractions.error || 'No signal.'}
            />

            {/* Tenant isolation */}
            <VitalCard
              icon={Activity}
              title="Tenant isolation"
              status={tenant.status || 'unknown'}
              metric={<LiveNumber value={tenant.scoped_visible_deals ?? 0} />}
              metricLabel="rows leaked with no context · want 0"
              detail={tenant.detail || tenant.error || 'No signal.'}
              extra={
                tenant.db_role ? (
                  <div className="mt-2 text-[11px] text-content-muted">
                    DB role <span className="font-mono text-content-secondary">{tenant.db_role}</span>
                    {' · '}
                    {tenant.bypasses_rls
                      ? 'bypasses RLS — app-layer wall only (M1)'
                      : 'RLS enforced by Postgres'}
                  </div>
                ) : null
              }
            />
          </div>

          <div className="text-[11px] text-content-muted leading-relaxed pt-1">
            <span className="font-medium">How this works.</span> The hourly cron runs these exact
            checks and raises a grouped alert per unhealthy subsystem; this page runs them on demand
            without alerting. All checks are read-only, cross-org aggregates (counts and statuses
            only — no tenant data). Operator-only, off the customer surface per the AI-disclosure
            policy.
          </div>
        </>
      )}
    </div>
  );
}
