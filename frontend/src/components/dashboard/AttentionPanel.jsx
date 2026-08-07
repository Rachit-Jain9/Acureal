import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  ShieldAlert,
  Moon,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Card, SectionHeader, ErrorState, Skeleton } from '../../design-system';
import EmptyState from '../common/EmptyState';
import SinceYouLooked from './SinceYouLooked';
import { useAttention } from '../../hooks/useDashboard';
import { usePrefetchDealWorkspace } from '../../hooks/useDeals';

/**
 * AttentionPanel — "what should I do today?" tile on the dashboard.
 *
 * Pairs with PortfolioRiskRadarWidget: the radar shows aggregate counts;
 * this panel surfaces the SPECIFIC ITEMS those aggregates roll up from,
 * so the user can click straight to the work that needs doing.
 *
 * Four signal sections plus a footer activity feed:
 *   1. Overdue diligence            — clicks open the deal's DD tab
 *   2. Approvals expiring (30 d)    — clicks open the deal's DD tab
 *   3. New risks (last 7 d)         — clicks open the deal's Risk tab
 *   4. Stale deals (14+ d inactive) — clicks open the deal Overview
 *   5. Recent activity (last 10)    — read-only feed at the bottom
 *
 * If every list is empty, renders a polite "all caught up" empty state
 * so the tile doesn't shout when there's nothing to shout about.
 */

const STAGE_LABEL = {
  sourced: 'Sourced',
  screening: 'Screening',
  site_visit: 'Site visit',
  loi: 'LOI',
  due_diligence: 'Due diligence',
  underwriting: 'Underwriting',
  ic_review: 'IC review',
  negotiation: 'Negotiation',
  active: 'Active',
};

const SEVERITY_DOT = {
  critical: 'bg-data-negative',
  high: 'bg-premium',
  medium: 'bg-premium',
  low: 'bg-content-tertiary',
};

const formatRelativeTime = (iso) => {
  if (!iso) return '';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN');
};

const formatDate = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
};

// Small label that wraps deal name + stage chip. Used inside every list
// row so the user can see at a glance which deal an item belongs to and
// where it sits in the pipeline.
function DealContextChip({ name, stage }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-content-tertiary">
      <span className="truncate max-w-[160px]">{name}</span>
      {stage && (
        <span className="px-1 py-0.5 rounded bg-bg-secondary text-[9px] uppercase tracking-wider font-medium">
          {STAGE_LABEL[stage] || stage}
        </span>
      )}
    </span>
  );
}

// One row inside a signal section. `href` opens the right place; `right`
// is a tiny tabular-nums label (days overdue, expiry date, severity).
//
// `dealId` (optional) lets the row prefetch the deal's workspace payload
// on hover / focus, so clicking from Today's Attention lands on the
// deal page instantly. Reuses the same `usePrefetchDealWorkspace` hook
// the Deals list card uses.
function SignalRow({ href, title, deal_name, deal_stage, right, rightTone = 'neutral', subtitle, dealId }) {
  const prefetchWorkspace = usePrefetchDealWorkspace();
  const onIntent = dealId
    ? () => prefetchWorkspace(dealId)
    : undefined;
  const RIGHT_TONE = {
    danger: 'text-data-negative',
    warn: 'text-premium',
    neutral: 'text-content-secondary',
    muted: 'text-content-tertiary',
  };
  return (
    <Link
      to={href}
      onMouseEnter={onIntent}
      onFocus={onIntent}
      className="flex items-start justify-between gap-3 px-3 py-2 -mx-3 hover:bg-bg-secondary transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
    >
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-content-primary truncate">
          {title}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <DealContextChip name={deal_name} stage={deal_stage} />
          {subtitle && (
            <span className="text-[10px] text-content-tertiary truncate">
              · {subtitle}
            </span>
          )}
        </div>
      </div>
      <span className={clsx('text-[11px] font-semibold tabular-nums shrink-0', RIGHT_TONE[rightTone])}>
        {right}
      </span>
    </Link>
  );
}

// A signal block header (icon + name + total).
function SignalHeader({ icon: Icon, label, total, tone = 'neutral' }) {
  const TONE = {
    danger: 'text-data-negative',
    warn: 'text-premium',
    neutral: 'text-content-secondary',
  };
  return (
    <div className="flex items-center justify-between mb-1.5 px-1">
      <span className={clsx('inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider', TONE[tone])}>
        <Icon size={11} />
        {label}
      </span>
      {total > 0 && (
        <span className="text-[10px] text-content-tertiary tabular-nums">
          {total}
        </span>
      )}
    </div>
  );
}

export default function AttentionPanel() {
  const { data, isLoading, isError, refetch } = useAttention();
  const prefetchWorkspace = usePrefetchDealWorkspace();

  if (isLoading) {
    return (
      <Card elevated className="p-5">
        <SectionHeader
          eyebrow="Today"
          title="What needs your attention"
          className="mb-4"
        />
        {/* Skeleton that mirrors the final 2-column signal grid (guidelines §4:
            skeletons, never spinners) so nothing reflows when data lands. */}
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading today's attention items"
          className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-4"
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-2.5 w-28 rounded" />
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-5/6 rounded-md" />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card elevated className="p-5">
        <SectionHeader eyebrow="Today" title="What needs your attention" className="mb-3" />
        <ErrorState
          tone="danger"
          title="Couldn't load the attention list"
          action={(
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded text-xs font-medium text-accent transition-colors hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Try again
            </button>
          )}
        >
          Something went wrong fetching today&apos;s items.
        </ErrorState>
      </Card>
    );
  }

  const {
    totals = {},
    overdue_dd_items = [],
    expiring_approvals = [],
    new_risk_flags = [],
    stale_deals = [],
    recent_activity = [],
    since_you_looked = null,
    thresholds = {},
  } = data || {};

  if (!totals.any) {
    // A quiet day is exactly when "since you last looked" earns its place: no
    // absolute threshold has been crossed, but your portfolio may still have
    // moved while you were away. The strip renders ABOVE the all-caught-up
    // state rather than replacing it — both statements are true at once.
    return (
      <Card elevated className="p-5">
        <SectionHeader eyebrow="Today" title="What needs your attention" className="mb-3" />
        <SinceYouLooked data={since_you_looked} onPrefetchDeal={prefetchWorkspace} />
        <EmptyState
          size="sm"
          icon={CheckCircle2}
          title="All caught up."
          description="No overdue diligence, no expiring approvals, no new risks, no stale deals. The next time something needs your eyes, it shows up here."
        />
      </Card>
    );
  }

  return (
    <Card elevated className="p-5">
      <SectionHeader
        eyebrow="Today"
        title="What needs your attention"
        action={
          <span className="text-[10px] text-content-tertiary">
            Updated {formatRelativeTime(data.generated_at)}
          </span>
        }
        className="mb-4 items-center"
      />

      <SinceYouLooked data={since_you_looked} onPrefetchDeal={prefetchWorkspace} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-4">
        {/* Overdue DD */}
        {overdue_dd_items.length > 0 && (
          <div>
            <SignalHeader
              icon={AlertTriangle}
              label="Overdue diligence"
              tone="danger"
              total={totals.overdue_dd}
            />
            <ul className="space-y-0.5">
              {overdue_dd_items.slice(0, 5).map((it) => (
                <li key={it.id}>
                  <SignalRow
                    href={`/dashboard/deals/${it.deal_id}?tab=dd`}
                    title={it.item_name}
                    deal_name={it.deal_name}
                    deal_stage={it.deal_stage}
                    subtitle={it.severity ? it.severity : null}
                    right={`${it.days_overdue}d over`}
                    rightTone="danger"
                    dealId={it.deal_id}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Expiring approvals */}
        {expiring_approvals.length > 0 && (
          <div>
            <SignalHeader
              icon={CalendarClock}
              label={`Approvals expiring (${thresholds.expiring_window_days || 30}d)`}
              tone="warn"
              total={totals.expiring_approvals}
            />
            <ul className="space-y-0.5">
              {expiring_approvals.slice(0, 5).map((it) => (
                <li key={it.id}>
                  <SignalRow
                    href={`/dashboard/deals/${it.deal_id}?tab=dd`}
                    title={it.name}
                    deal_name={it.deal_name}
                    deal_stage={it.deal_stage}
                    subtitle={it.approval_type
                      ? it.approval_type.replace(/_/g, ' ')
                      : null}
                    right={`${it.days_until_expiry}d · ${formatDate(it.expiry_date)}`}
                    rightTone="warn"
                    dealId={it.deal_id}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* New risk flags */}
        {new_risk_flags.length > 0 && (
          <div>
            <SignalHeader
              icon={ShieldAlert}
              label={`New risks (last ${thresholds.new_risk_window_days || 7}d)`}
              tone="danger"
              total={totals.new_risk_flags}
            />
            <ul className="space-y-0.5">
              {new_risk_flags.slice(0, 5).map((it) => (
                <li key={it.id}>
                  <SignalRow
                    href={`/dashboard/deals/${it.deal_id}?tab=risk`}
                    title={(
                      <span className="inline-flex items-center gap-1.5">
                        <span className={clsx('inline-block w-1.5 h-1.5 rounded-full', SEVERITY_DOT[it.severity] || 'bg-content-tertiary')} />
                        {it.title}
                      </span>
                    )}
                    deal_name={it.deal_name}
                    deal_stage={it.deal_stage}
                    subtitle={it.category}
                    right={formatRelativeTime(it.created_at)}
                    rightTone="muted"
                    dealId={it.deal_id}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Stale deals — the row's title IS the deal name (because the
            "item" here is the deal itself, not a sub-item like a DD or
            risk row), so we leave deal_name null and render the stage
            as a proper stage chip in the secondary line. */}
        {stale_deals.length > 0 && (
          <div>
            <SignalHeader
              icon={Moon}
              label={`Stale (no activity > ${thresholds.stale_deal_days || 14}d)`}
              tone="neutral"
              total={totals.stale_deals}
            />
            <ul className="space-y-0.5">
              {stale_deals.slice(0, 5).map((it) => (
                <li key={it.id}>
                  <SignalRow
                    href={`/dashboard/deals/${it.id}`}
                    title={it.name}
                    deal_name={null}
                    deal_stage={it.stage}
                    right={`${it.days_stale}d quiet`}
                    rightTone="muted"
                    dealId={it.id}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Recent activity — tucked at the bottom so it doesn't crowd the
          action items. Read-only chronology, no per-row click target. */}
      {recent_activity.length > 0 && (
        <div className="mt-5 pt-4 border-t border-hairline-soft">
          <SignalHeader
            icon={Activity}
            label="Latest across the portfolio"
            tone="neutral"
            total={recent_activity.length}
          />
          <ul className="space-y-1.5">
            {recent_activity.slice(0, 5).map((it) => (
              <li
                key={it.id}
                className="flex items-start justify-between gap-3 text-[11px] text-content-secondary"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/dashboard/deals/${it.deal_id}`}
                    className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 rounded"
                  >
                    <span className="font-medium text-content-primary">{it.deal_name}</span>
                  </Link>
                  <span className="text-content-tertiary"> — {it.description}</span>
                  {it.performed_by_name && (
                    <span className="text-content-tertiary"> · {it.performed_by_name}</span>
                  )}
                </div>
                <span className="shrink-0 text-[10px] text-content-tertiary tabular-nums">
                  {formatRelativeTime(it.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
