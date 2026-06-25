import { AlertTriangle, ShieldAlert, Moon } from 'lucide-react';
import { clsx } from 'clsx';

/**
 * UrgencyStrip — per-deal "this needs action" badges on the Deals list card.
 *
 * Three signals mirror the dashboard "Today's Attention" panel rules so the
 * list-view chip and the dashboard rollup never disagree on what counts as
 * urgent:
 *
 *   • overdue_dd_count   — required, still-open DD items past due_date
 *   • new_risk_flag_count — open risk flags raised in the last 7 days
 *   • stale              — last_activity_date (or updated_at fallback) > 14d
 *
 * The component renders NOTHING when no signal fires, so a clean deal card
 * stays clean. Each chip is decorative (parent card is already the Link
 * target), so we avoid nested-anchor accessibility issues.
 */

const STALE_DAYS = 14;
const PILL_BASE = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider';

const daysSince = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
};

export default function UrgencyStrip({ deal }) {
  const overdue = Number(deal?.overdue_dd_count || 0);
  const newRisks = Number(deal?.new_risk_flag_count || 0);
  // Stale signal — prefers last_activity_date (computed server-side from
  // activities table), falls back to updated_at. A brand-new sourced deal
  // that hasn't been touched since creation is also stale once it crosses
  // the threshold; updated_at handles that fallback case.
  const lastTouch = deal?.last_activity_date || deal?.updated_at;
  const idleDays = daysSince(lastTouch);
  const isStale = idleDays != null && idleDays > STALE_DAYS;

  if (!overdue && !newRisks && !isStale) return null;

  return (
    <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Urgency signals">
      {overdue > 0 && (
        <span
          className={clsx(PILL_BASE, 'bg-neg-soft text-data-negative border border-hairline')}
          title={`${overdue} required DD item${overdue === 1 ? '' : 's'} past due date`}
        >
          <AlertTriangle size={10} />
          {overdue} overdue DD
        </span>
      )}
      {newRisks > 0 && (
        <span
          className={clsx(PILL_BASE, 'bg-premium-soft text-premium border border-hairline')}
          title={`${newRisks} risk flag${newRisks === 1 ? '' : 's'} raised in the last 7 days`}
        >
          <ShieldAlert size={10} />
          {newRisks} new risk{newRisks === 1 ? '' : 's'}
        </span>
      )}
      {isStale && (
        <span
          className={clsx(PILL_BASE, 'bg-bg-secondary text-content-secondary border border-hairline')}
          title={`No activity in ${idleDays} days — older than the ${STALE_DAYS}-day threshold`}
        >
          <Moon size={10} />
          {idleDays}d quiet
        </span>
      )}
    </div>
  );
}
