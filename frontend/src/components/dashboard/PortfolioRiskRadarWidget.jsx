import { Link } from 'react-router-dom';
import {
  ShieldAlert, ArrowRight, AlertTriangle, CheckCircle, HelpCircle, Clock,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Card, SectionHeader } from '../../design-system';
import EmptyState from '../common/EmptyState';
import { usePortfolioRiskRadar } from '../../hooks/useDashboard';
import { formatRelativeTime, STAGE_CONFIG } from '../../utils/format';

/**
 * Portfolio Risk Radar widget — the moat surface at the dashboard zoom level.
 *
 * Aggregates every live deal's Risk Radar into a single tile: how many deals
 * are flagged / unverified / cleared, open critical+high counts across the
 * portfolio, per-failure-mode breakdown, and the top-5 deals that need IC
 * attention. Every number is deterministic (no AI) and clickable through to
 * the deal's Risk tab.
 *
 * Five sections, scannable top-to-bottom:
 *   1. Header — overall posture pill + portfolio risk score.
 *   2. Stat strip — totals.deals · flagged · unverified · cleared, plus
 *      open_severity.critical and open_severity.high.
 *   3. Failure-mode bars — five rows, each showing the flagged/unverified/
 *      cleared deal split for that failure mode.
 *   4. Top deals at risk — up to 5 deal rows, each linking to /deals/:id?tab=risk.
 *   5. Recently flagged — last 5 flags raised in the past 7 days.
 *
 * Tile-level empty state: a brand-new workspace with no live deals shows an
 * "Add your first deal" CTA so the widget doesn't render as a wall of zeros.
 */

const POSTURE_COPY = {
  flagged: {
    label: 'Action needed',
    pill: 'bg-neg-soft text-data-negative border-hairline',
    Icon: AlertTriangle,
    accent: 'text-data-negative',
    headline: 'Portfolio has open critical or high risks awaiting action.',
  },
  unverified: {
    label: 'Not verified',
    pill: 'bg-premium-soft text-premium border-hairline',
    Icon: HelpCircle,
    accent: 'text-premium',
    headline: 'Failure modes not yet fully verified across the portfolio.',
  },
  cleared: {
    label: 'Cleared',
    pill: 'bg-pos-soft text-data-positive border-hairline',
    Icon: CheckCircle,
    accent: 'text-data-positive',
    headline: 'Every live deal has its required diligence in place — no open flags.',
  },
};

// Derive an overall portfolio posture from the totals breakdown. Matches the
// per-deal radar's worst-case rule.
function overallPosture(totals) {
  if (!totals) return 'unverified';
  if (totals.flagged > 0) return 'flagged';
  if (totals.unverified > 0) return 'unverified';
  return 'cleared';
}

function PostureBar({ flagged, unverified, cleared }) {
  const total = flagged + unverified + cleared;
  if (total === 0) {
    return <div className="h-1.5 w-24 rounded-full bg-bg-secondary" />;
  }
  const fPct = (flagged / total) * 100;
  const uPct = (unverified / total) * 100;
  const cPct = (cleared / total) * 100;
  return (
    <div className="h-1.5 w-24 rounded-full bg-bg-secondary overflow-hidden flex">
      {flagged > 0 && (
        <span className="bg-data-negative" style={{ width: `${fPct}%` }} title={`${flagged} flagged`} />
      )}
      {unverified > 0 && (
        <span className="bg-premium" style={{ width: `${uPct}%` }} title={`${unverified} not verified`} />
      )}
      {cleared > 0 && (
        <span className="bg-data-positive" style={{ width: `${cPct}%` }} title={`${cleared} cleared`} />
      )}
    </div>
  );
}

const SEVERITY_TONE = {
  critical: 'bg-neg-soft text-data-negative border-hairline',
  high: 'bg-premium-soft text-premium border-hairline',
  medium: 'bg-premium-soft text-premium border-hairline',
  // The "low" tone used `bg-slate-50 text-slate-700 border-slate-200` —
  // a legacy combo from the pre-theme era. Replaced with semantic
  // tokens so it adapts to dark mode without needing the override block
  // in index.css.
  low: 'bg-bg-secondary text-content-secondary border-hairline',
};

function SeverityPill({ severity }) {
  const tone = SEVERITY_TONE[String(severity || '').toLowerCase()] || SEVERITY_TONE.low;
  return (
    <span
      className={clsx(
        'inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border tabular-nums',
        tone,
      )}
    >
      {severity}
    </span>
  );
}

export default function PortfolioRiskRadarWidget() {
  const { data: radar, isLoading, isError, refetch } = usePortfolioRiskRadar();

  // Loading skeleton — mirrors the card shape so layout doesn't reflow.
  if (isLoading) {
    return (
      <Card elevated className="p-5">
        <SectionHeader
          eyebrow="Portfolio risk"
          title="Risk Radar — portfolio"
          className="mb-4 items-center"
        />
        <div className="space-y-3" role="status" aria-busy="true" aria-label="Loading portfolio risk radar">
          <div className="redip-skeleton h-12 w-full rounded" />
          <div className="redip-skeleton h-32 w-full rounded" />
          <div className="redip-skeleton h-24 w-full rounded" />
        </div>
      </Card>
    );
  }

  if (isError || !radar) {
    return (
      <Card elevated className="p-5">
        <SectionHeader eyebrow="Portfolio risk" title="Risk Radar — portfolio" className="mb-3 items-center" />
        <div className="text-sm text-content-muted flex items-center justify-between gap-3">
          <span>Couldn&apos;t load the portfolio risk radar — your data is safe.</span>
          <button
            type="button"
            onClick={() => refetch()}
            className="btn btn-secondary text-xs"
          >
            Retry
          </button>
        </div>
      </Card>
    );
  }

  // Brand-new workspace: the per-deal radar can't roll up to anything yet, so
  // we explain the surface and point to the deal-creation flow.
  if (radar.empty) {
    return (
      <Card elevated className="p-5">
        <SectionHeader eyebrow="Portfolio risk" title="Risk Radar — portfolio" className="mb-4 items-center" />
        <EmptyState
          size="md"
          icon={ShieldAlert}
          title="No live deals to assess"
          description="Once you add a deal, the radar shows where critical and high-severity risk is concentrated across the portfolio."
          action={(
            <Link
              to="/dashboard/deals"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Create your first deal
              <ArrowRight size={13} />
            </Link>
          )}
        />
      </Card>
    );
  }

  const posture = overallPosture(radar.totals);
  const cfg = POSTURE_COPY[posture];
  const { totals, open_severity, failure_modes, top_deals_at_risk, recently_flagged } = radar;

  return (
    <Card elevated className="p-5">
      <SectionHeader
        eyebrow="Portfolio risk"
        title="Risk Radar — portfolio"
        action={(
          <span
            className={clsx(
              'inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded border',
              cfg.pill,
            )}
          >
            <cfg.Icon size={11} />
            {cfg.label}
          </span>
        )}
        className="mb-3 items-center"
      />

      <p className="text-xs text-content-muted mb-4">{cfg.headline}</p>

      {/* Stat strip — totals + open severity + overdue + portfolio score */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <div className="rounded-md border border-hairline-soft bg-surface px-3 py-2.5">
          <p className="text-eyebrow uppercase text-content-muted text-[10px] font-medium tracking-wider mb-1">Live deals</p>
          <p className="text-xl font-bold text-content-primary tabular-nums">{totals.deals}</p>
          <p className="text-[11px] text-content-muted mt-0.5">
            <span className="text-data-negative font-semibold">{totals.flagged}</span> flagged
            {' · '}
            <span className="text-premium font-semibold">{totals.unverified}</span> not verified
            {' · '}
            <span className="text-data-positive font-semibold">{totals.cleared}</span> cleared
          </p>
        </div>
        <div className="rounded-md border border-hairline-soft bg-surface px-3 py-2.5">
          <p className="text-eyebrow uppercase text-content-muted text-[10px] font-medium tracking-wider mb-1">Open critical</p>
          <p className={clsx('text-xl font-bold tabular-nums', open_severity.critical > 0 ? 'text-data-negative' : 'text-content-secondary')}>
            {open_severity.critical}
          </p>
          <p className="text-[11px] text-content-muted mt-0.5">Severity-1 flags across portfolio</p>
        </div>
        <div className="rounded-md border border-hairline-soft bg-surface px-3 py-2.5">
          <p className="text-eyebrow uppercase text-content-muted text-[10px] font-medium tracking-wider mb-1">Open high</p>
          <p className={clsx('text-xl font-bold tabular-nums', open_severity.high > 0 ? 'text-premium' : 'text-content-secondary')}>
            {open_severity.high}
          </p>
          <p className="text-[11px] text-content-muted mt-0.5">Severity-2 flags across portfolio</p>
        </div>
        <div className="rounded-md border border-hairline-soft bg-surface px-3 py-2.5">
          <p className="text-eyebrow uppercase text-content-muted text-[10px] font-medium tracking-wider mb-1">Overdue DD</p>
          <p className={clsx('text-xl font-bold tabular-nums', open_severity.overdue_dd > 0 ? 'text-data-negative' : 'text-content-secondary')}>
            {open_severity.overdue_dd ?? 0}
          </p>
          <p className="text-[11px] text-content-muted mt-0.5">Required DD past its due date</p>
        </div>
        <div className="rounded-md border border-hairline-soft bg-surface px-3 py-2.5">
          <p className="text-eyebrow uppercase text-content-muted text-[10px] font-medium tracking-wider mb-1">Portfolio score</p>
          <p className={clsx('text-xl font-bold tabular-nums', open_severity.portfolio_score > 60 ? 'text-data-negative' : open_severity.portfolio_score > 30 ? 'text-premium' : 'text-data-positive')}>
            {open_severity.portfolio_score}
            <span className="text-xs font-normal text-content-muted ml-0.5">/100</span>
          </p>
          <p className="text-[11px] text-content-muted mt-0.5">Avg of per-deal severity weights</p>
        </div>
      </div>

      {/* Failure-mode breakdown */}
      <div className="mb-5">
        <p className="text-eyebrow uppercase text-content-muted text-[10px] font-medium tracking-wider mb-2">Failure modes</p>
        <div className="space-y-1.5">
          {failure_modes.map((mode) => (
            <div key={mode.key} className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-surface border border-hairline-soft">
              <div className="flex items-center gap-2 min-w-0">
                <PostureBar
                  flagged={mode.flagged_deals}
                  unverified={mode.unverified_deals}
                  cleared={mode.cleared_deals}
                />
                <span className="text-sm font-medium text-content-primary truncate">{mode.label}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-content-muted shrink-0 tabular-nums">
                {mode.flagged_deals > 0 && (
                  <span className="text-data-negative font-semibold">{mode.flagged_deals} flagged</span>
                )}
                {mode.overdue_total > 0 && (
                  <span className="text-data-negative">
                    {mode.overdue_total}{' '}
                    <span className="font-normal text-content-muted">overdue</span>
                  </span>
                )}
                {mode.unverified_deals > 0 && (
                  <span className="text-premium">{mode.unverified_deals} unverified</span>
                )}
                {mode.cleared_deals > 0 && mode.flagged_deals === 0 && mode.unverified_deals === 0 && (
                  <span className="text-data-positive">All cleared</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top deals at risk */}
      {top_deals_at_risk.length > 0 && (
        <div className="mb-5">
          <p className="text-eyebrow uppercase text-content-muted text-[10px] font-medium tracking-wider mb-2">
            Top deals at risk <span className="text-content-muted/70 font-normal normal-case ml-1">— click to open the Risk tab</span>
          </p>
          <ul className="divide-y divide-hairline-soft border border-hairline-soft rounded-md overflow-hidden">
            {top_deals_at_risk.map((d) => {
              const stageConf = STAGE_CONFIG[d.stage] || {};
              return (
                <li key={d.id}>
                  <Link
                    to={`/dashboard/deals/${d.id}?tab=risk`}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-content-primary truncate">{d.name}</p>
                      <p className="text-[11px] text-content-muted mt-0.5 truncate">
                        {stageConf.label || d.stage}
                        {d.worst_category && (
                          <>
                            <span className="mx-1">·</span>
                            <span>{d.worst_category}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {d.open_critical > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-data-negative tabular-nums">
                          {d.open_critical} <span className="font-normal text-content-muted">crit</span>
                        </span>
                      )}
                      {d.open_high > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-premium tabular-nums">
                          {d.open_high} <span className="font-normal text-content-muted">high</span>
                        </span>
                      )}
                      {d.overdue > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-data-negative tabular-nums">
                          {d.overdue} <span className="font-normal text-content-muted">overdue</span>
                        </span>
                      )}
                      <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-content-primary tabular-nums px-1.5 py-0.5 rounded bg-bg-secondary">
                        {d.score}
                      </span>
                      <ArrowRight size={12} className="text-content-muted" />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Recently flagged (last 7 days) */}
      {recently_flagged.length > 0 && (
        <div>
          <p className="text-eyebrow uppercase text-content-muted text-[10px] font-medium tracking-wider mb-2">
            Recently flagged <span className="text-content-muted/70 font-normal normal-case">— last 7 days</span>
          </p>
          <ul className="space-y-1.5">
            {recently_flagged.map((f) => (
              <li key={f.flag_id}>
                <Link
                  to={`/dashboard/deals/${f.deal_id}?tab=risk`}
                  className="flex items-start gap-2.5 px-3 py-2 rounded-md bg-surface border border-hairline-soft hover:border-hairline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <SeverityPill severity={f.severity} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-content-primary leading-snug truncate">{f.title}</p>
                    <p className="text-[11px] text-content-muted mt-0.5">
                      <Clock size={10} className="inline mr-0.5" />
                      {formatRelativeTime(f.created_at)}
                      <span className="mx-1">·</span>
                      <span className="text-content-secondary">{f.deal_name}</span>
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Cleared portfolio — no top deals and no recent flags, but we still
          render the widget rather than hide it, so the operator gets the
          positive signal that everything is in order. */}
      {top_deals_at_risk.length === 0 && recently_flagged.length === 0 && (
        <div className="px-3 py-3 rounded-md bg-pos-soft border border-hairline flex items-center gap-2 text-xs text-data-positive">
          <CheckCircle size={14} className="shrink-0" />
          <span>No deals need IC attention right now — required diligence is in place across the portfolio.</span>
        </div>
      )}
    </Card>
  );
}
