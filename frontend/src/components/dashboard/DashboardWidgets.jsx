import { Link } from 'react-router-dom';
// recharts lives only in the lazy-loaded DashboardCharts.jsx now — the two
// chart widgets (Pipeline / Cities) moved there so this module (and every
// non-chart dashboard widget) no longer drags the recharts vendor chunk onto
// the dashboard's first-paint critical path.
import {
  TrendingUp, ArrowRight, Clock, Inbox, Hourglass, ShieldCheck,
  Zap, AlertTriangle, Activity,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Badge from '../common/Badge';
import EmptyState from '../common/EmptyState';
import { Card, SectionHeader, MetricTile, Button, Skeleton } from '../../design-system';
import { adminAPI } from '../../services/api';
import {
  formatCrores, formatPct, formatRelativeTime, STAGE_CONFIG,
} from '../../utils/format';

// ── shared section-card chrome ────────────────────────────────────────────
export function SectionCard({ title, children, action, eyebrow }) {
  return (
    <Card elevated className="p-5">
      <SectionHeader
        eyebrow={eyebrow}
        title={title}
        action={action}
        className="mb-4 items-center"
      />
      {children}
    </Card>
  );
}

// ── KPI strip ──────────────────────────────────────────────────────────────
// PR-NX60 (2026-05-19) — every KPI now passes raw numeric `value` + a
// `format` callback so MetricTile's built-in `useCountUp` hook animates
// the value smoothly from previous → next over 600ms whenever the
// dashboard refetches (per docs/FRONTEND_GUIDELINES.md §5 "Live data —
// surface change, don't hide it"). Pre-NX60 the KPI tiles passed
// pre-formatted strings, so the count-up never fired even though the
// design-system primitive supported it.
//
// Format functions guard against null/undefined so a missing stat falls
// back to the em-dash convention (FRONTEND_GUIDELINES §11).
const formatCroresWithDash = (n) => (Number.isFinite(n) ? formatCrores(n) : '—');
const formatPctWithDash = (n) => (Number.isFinite(n) ? formatPct(n) : '—');
const formatIntWithDash = (n) => (Number.isFinite(n) ? n.toLocaleString('en-IN') : '—');
export function KpiStripWidget({ stats = {} }) {
  const activeDeals     = stats.active_deals_count   || 0;
  const pipelineValue   = stats.total_pipeline_value_cr || 0;
  // Avg IRR is left NULLABLE — the backend honestly returns null when no
  // deals carry a modelled IRR. Coercing `|| 0` would render a confident
  // "0.0% · Below bench" red tag on a brand-new org as if it were a real
  // portfolio result (CLAUDE.md data-honesty rule). `avgIrrFinite` gates the
  // benchmark tag/tone so a missing value shows a neutral "—" instead.
  const avgIrr          = stats.avg_irr_pct;
  const avgIrrFinite    = Number.isFinite(avgIrr);
  const icReadyDeals    = stats.ic_ready_count        || 0;
  const dealsWithRisk   = stats.deals_with_open_risks || 0;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <MetricTile
        interactive
        label="Pipeline Value"
        value={pipelineValue}
        format={formatCroresWithDash}
        footnote="Cumulative ask · active deals"
      />
      <MetricTile
        interactive
        label="Active Deals"
        value={activeDeals}
        format={formatIntWithDash}
        footnote="Live in pipeline"
        delta={dealsWithRisk > 0 ? `${dealsWithRisk} with open risk` : null}
        tone={dealsWithRisk > 0 ? 'down' : 'neutral'}
      />
      <MetricTile
        interactive
        label="Avg IRR"
        value={avgIrrFinite ? avgIrr : '—'}
        format={formatPctWithDash}
        footnote="Across modelled deals"
        delta={avgIrrFinite ? (avgIrr >= 20 ? 'Above 20% bench' : avgIrr >= 12 ? null : 'Below bench') : null}
        tone={avgIrrFinite ? (avgIrr >= 20 ? 'up' : avgIrr >= 12 ? 'neutral' : 'down') : 'neutral'}
      />
      <MetricTile
        interactive
        label="Investor-Grade"
        value={icReadyDeals}
        format={formatIntWithDash}
        footnote="IC-ready · fully vetted"
        delta={icReadyDeals > 0 ? 'Ready to deploy' : null}
        tone={icReadyDeals > 0 ? 'up' : 'neutral'}
      />
    </div>
  );
}

// ── Comps queue alert (role + activity-gated) ─────────────────────────────
// Returns null when there's nothing to show — the dashboard loop skips
// nulls so the widget effectively self-disables.
export function CompsQueueAlertWidget({ stats = {}, canCurate = true }) {
  const queuePendingReview     = stats.comps_queue_pending_review     || 0;
  const queuePendingExtraction = stats.comps_queue_pending_extraction || 0;
  const queueFailed            = stats.comps_queue_failed             || 0;
  const queueAttention         = queuePendingReview + queuePendingExtraction + queueFailed;
  if (!canCurate || queueAttention === 0) return null;
  return (
    <Card className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="shrink-0 w-9 h-9 rounded-md bg-amber-50 text-amber-700 flex items-center justify-center">
          <Inbox size={16} />
        </div>
        <div className="min-w-0">
          <div className="text-eyebrow uppercase text-content-muted font-medium">Comps review queue</div>
          <div className="text-sm text-content-primary font-medium tabular-nums">
            {queuePendingReview > 0 && (
              <><span className="text-amber-600">{queuePendingReview}</span> pending review</>
            )}
            {queuePendingReview === 0 && queuePendingExtraction > 0 && (
              <span className="inline-flex items-center gap-1 text-content-secondary">
                <Hourglass size={12} />
                {queuePendingExtraction} pending extraction
              </span>
            )}
            {queuePendingReview === 0 && queuePendingExtraction === 0 && queueFailed > 0 && (
              <span className="text-data-negative">{queueFailed} failed extractions</span>
            )}
            {queuePendingReview > 0 && (queuePendingExtraction > 0 || queueFailed > 0) && (
              <span className="text-content-muted ml-2 text-xs font-normal">
                {queuePendingExtraction > 0 && (<span>· {queuePendingExtraction} extracting</span>)}
                {queueFailed > 0 && (<span className="text-data-negative ml-1">· {queueFailed} failed</span>)}
              </span>
            )}
          </div>
        </div>
      </div>
      <Link
        to="/dashboard/admin/comps-queue"
        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        Open queue
        <ArrowRight size={13} />
      </Link>
    </Card>
  );
}

// Pipeline + Cities distribution charts moved to DashboardCharts.jsx (lazy)
// so recharts stays off the dashboard's first-paint critical path.

// ── Recent activities timeline ─────────────────────────────────────────────
export function RecentActivitiesWidget({ recent_activities = [] }) {
  return (
    <SectionCard
      title="Recent Activities"
      eyebrow="Timeline"
      action={
        <Link to="/dashboard/deals" className="text-xs hover:underline flex items-center gap-1 text-accent">
          View all <ArrowRight size={12} />
        </Link>
      }
    >
      {recent_activities.length > 0 ? (
        <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {recent_activities.map((activity, idx) => (
            <li key={activity.id || idx} className="flex items-start gap-3 p-3 rounded-md bg-surface border border-hairline-soft">
              <div className="w-1.5 h-1.5 mt-1.5 rounded-full flex-shrink-0 bg-accent" />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug text-content-primary">{activity.description}</p>
                <p className="text-xs mt-1 text-content-muted">
                  <Clock size={10} className="inline mr-1" />
                  {formatRelativeTime(activity.activity_date || activity.created_at)}
                  {activity.deal_name && (
                    <span className="ml-1 text-content-secondary">&middot; {activity.deal_name}</span>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          size="sm"
          icon={Activity}
          title="No activity yet"
          description="Stage changes, document uploads, and notes logged on your deals show up here."
        />
      )}
    </SectionCard>
  );
}

// ── Top deals by IRR ───────────────────────────────────────────────────────
export function TopDealsIrrWidget({ top_deals_by_irr = [] }) {
  return (
    <SectionCard
      title="Top Deals by IRR"
      eyebrow="Performance"
      action={
        <Link to="/dashboard/deals" className="text-xs hover:underline flex items-center gap-1 text-accent">
          All deals <ArrowRight size={12} />
        </Link>
      }
    >
      {top_deals_by_irr.length > 0 ? (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className="text-left py-2 pr-3 text-eyebrow uppercase text-content-muted font-medium">Deal</th>
                <th className="text-left py-2 pr-3 text-eyebrow uppercase text-content-muted font-medium">Stage</th>
                <th className="text-right py-2 pr-3 text-eyebrow uppercase text-content-muted font-medium">Value</th>
                <th className="text-right py-2 text-eyebrow uppercase text-content-muted font-medium">IRR</th>
              </tr>
            </thead>
            <tbody>
              {top_deals_by_irr.map((deal, idx) => {
                const stageConf = STAGE_CONFIG[deal.stage] || {};
                const irrToneClass = Number(deal.irr_pct) >= 20 ? 'text-data-positive' : Number(deal.irr_pct) >= 15 ? 'text-premium' : 'text-accent';
                return (
                  <tr key={deal.id || idx} className="border-b border-hairline-soft transition-colors hover:bg-surface">
                    <td className="py-2.5 pr-3">
                      <Link to={`/dashboard/deals/${deal.id}`} className="font-medium truncate max-w-[140px] block text-content-primary">
                        {deal.name}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge tone={stageConf.tone}>{stageConf.label || deal.stage}</Badge>
                    </td>
                    <td className="py-2.5 pr-3 text-right whitespace-nowrap tabular-nums text-content-secondary">{formatCrores(deal.total_revenue_cr)}</td>
                    <td className={`py-2.5 text-right font-semibold whitespace-nowrap tabular-nums ${irrToneClass}`}>{formatPct(deal.irr_pct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          size="sm"
          icon={TrendingUp}
          title="No modelled deals yet"
          description="Run the financial model on a deal to rank your pipeline by projected IRR."
          action={(
            <Button as={Link} to="/dashboard/deals" variant="secondary" size="sm" rightIcon={<ArrowRight size={13} />}>
              Go to deals
            </Button>
          )}
        />
      )}
    </SectionCard>
  );
}

// ── AI cost summary (today) ────────────────────────────────────────────────
// Self-fetching widget — pulls today's slice of /api/admin/ai-usage so
// the dashboard render doesn't have to plumb anything new through
// useDashboard. Renders a compact today-only view; the full dashboard
// lives at /dashboard/admin/ai-usage.
export function AiCostSummaryWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-ai-usage', 1],
    queryFn: () => adminAPI.getAiUsage(1).then((r) => r.data.data),
    staleTime: 60_000,
  });
  const summary = data?.summary;
  const cap = data?.cost_cap;
  return (
    <SectionCard
      title="AI cost (today)"
      eyebrow="Operations"
      action={
        <Link to="/dashboard/admin/ai-usage" className="text-xs hover:underline flex items-center gap-1 text-accent">
          Full dashboard <ArrowRight size={12} />
        </Link>
      }
    >
      {isLoading ? (
        // PR-NX60: a11y per FRONTEND_GUIDELINES §9 — loading indicators
        // get role="status" + aria-busy so screen readers announce them.
        <Skeleton className="h-24 rounded" role="status" ariaLabel="Loading AI cost summary" />
      ) : !summary ? (
        <EmptyState
          size="sm"
          icon={Zap}
          title="No AI usage today"
          description="Model calls and their cost appear here as the team extracts documents and drafts memos."
        />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-bg-secondary rounded-lg p-3">
              <p className="text-xs text-content-muted mb-1">Cost</p>
              <p className="text-lg font-bold text-content-primary tabular-nums">
                ${Number(summary.total_cost_usd || 0).toFixed(2)}
              </p>
            </div>
            <div className="bg-bg-secondary rounded-lg p-3">
              <p className="text-xs text-content-muted mb-1">Calls</p>
              <p className="text-lg font-bold text-content-primary tabular-nums">{summary.total_calls || 0}</p>
            </div>
            <div className="bg-bg-secondary rounded-lg p-3">
              <p className="text-xs text-content-muted mb-1">p95 latency</p>
              <p className="text-lg font-bold text-content-primary tabular-nums">
                {summary.p95_latency_ms != null ? `${(summary.p95_latency_ms / 1000).toFixed(1)}s` : '—'}
              </p>
            </div>
          </div>
          {cap?.enabled && (
            <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-surface border border-hairline-soft">
              <div className="flex items-center gap-1.5 text-xs text-content-secondary">
                <Zap size={11} className={cap.blocked ? 'text-data-negative' : 'text-content-muted'} />
                <span>Cap: ${Number(cap.cap_usd || 0).toFixed(0)}</span>
              </div>
              <span className={`text-xs tabular-nums font-semibold ${cap.blocked ? 'text-data-negative' : cap.pct_of_cap >= 75 ? 'text-premium' : 'text-content-secondary'}`}>
                {cap.pct_of_cap != null ? `${cap.pct_of_cap.toFixed(1)}%` : '—'}
              </span>
            </div>
          )}
          {summary.errors > 0 && (
            <div className="text-xs text-data-negative flex items-center gap-1.5">
              <AlertTriangle size={11} />
              {summary.errors} call{summary.errors === 1 ? '' : 's'} errored today
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ── Audit-trail tail ───────────────────────────────────────────────────────
const AUDIT_EVENT_LABELS = {
  calculate_and_save: 'Calculate & Save',
  scenario_recompute: 'Scenario Recompute',
  sensitivity_run:    'Sensitivity Run',
  manual_replay:      'Manual Replay',
  graph_snapshot:     'Graph Snapshot',
  export_snapshot:    'Export Snapshot',
};

export function AuditTrailTailWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-recent-events', 8],
    queryFn: () => adminAPI.getRecentEvents(8).then((r) => r.data.data),
    staleTime: 60_000,
  });
  const events = Array.isArray(data) ? data : [];
  return (
    <SectionCard
      title="Recent audit events"
      eyebrow="Append-only · HMAC-signed"
      action={
        <span className="text-[10px] uppercase tracking-wider text-content-muted">
          {events.length} latest
        </span>
      }
    >
      {isLoading ? (
        // PR-NX60: a11y per FRONTEND_GUIDELINES §9 — role="status" +
        // aria-busy so screen readers announce the loading state.
        // FRONTEND_GUIDELINES §4 also asks for staggered shimmer
        // (50-80ms across siblings) to feel alive — done via animation-delay.
        <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading recent audit events">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-10 rounded"
              style={{ animationDelay: `${i * 60}ms` }}
              ariaLabel={null}
              role="presentation"
            />
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          size="sm"
          icon={ShieldCheck}
          title="No audit events yet"
          description="The tamper-evident, HMAC-signed trail begins the first time you run the financial model."
        />
      ) : (
        <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {events.map((ev) => (
            <li key={ev.id} className="flex items-center gap-3 px-3 py-2 rounded-md bg-surface border border-hairline-soft">
              <ShieldCheck size={12} className="shrink-0 text-accent" />
              <div className="min-w-0 flex-1 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone="neutral" className="text-[10px]">{AUDIT_EVENT_LABELS[ev.event_type] || ev.event_type}</Badge>
                  {ev.deal_name && (
                    <Link to={`/dashboard/deals/${ev.deal_id}?tab=audit`} className="font-medium text-content-primary truncate hover:underline">
                      {ev.deal_name}
                    </Link>
                  )}
                </div>
                <p className="text-content-muted mt-0.5">
                  {ev.actor_name || 'System'} · {formatRelativeTime(ev.created_at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
