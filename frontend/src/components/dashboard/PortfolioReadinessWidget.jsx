import { Link } from 'react-router-dom';
import {
  Target, ArrowRight, AlertCircle, CheckCircle2, Sparkles,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Card, SectionHeader } from '../../design-system';
import EmptyState from '../common/EmptyState';
import { usePortfolioReadiness } from '../../hooks/useDashboard';

/**
 * Portfolio Readiness widget — Phase 4 prologue.
 *
 * Workspace-level rollup of every live deal's IC + RERA readiness. Pairs
 * with the per-deal IC Readiness Pack on the DD tab (the same posture
 * surfaced at portfolio zoom).
 *
 * Five sections, scannable top-to-bottom:
 *   1. Header — overall posture badge + portfolio average score.
 *   2. Tier strip — counts of deals at each tier (IC-ready / Pre-IC /
 *      Diligence / Early).
 *   3. Portfolio blockers — across-deal patterns ("8 deals without a
 *      financial model", "3 deals with open deal-breakers") sorted by
 *      severity. Each row clickable to the affected deal list (filter
 *      query param).
 *   4. Top IC-ready deals — up to 5 deal rows, each linking to the deal.
 *   5. Top needs-attention — up to 5 deals that need most work.
 *
 * Empty state: brand-new workspace with no live deals shows an
 * "Add your first deal" CTA so the widget doesn't read as a wall of zeros.
 */

const TIER_TONE = {
  ic_ready:  { label: 'IC-ready',  pill: 'bg-green-50 text-green-700 border-green-200', bar: 'bg-green-500', dot: 'bg-green-500' },
  pre_ic:    { label: 'Pre-IC',    pill: 'bg-sky-50 text-sky-700 border-sky-200',       bar: 'bg-sky-500',   dot: 'bg-sky-500' },
  diligence: { label: 'Diligence', pill: 'bg-amber-50 text-amber-800 border-amber-200', bar: 'bg-amber-500', dot: 'bg-amber-500' },
  early:     { label: 'Early',     pill: 'bg-slate-50 text-slate-700 border-slate-200', bar: 'bg-slate-400', dot: 'bg-slate-400' },
};

const SEVERITY_TONE = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  high:     'bg-orange-50 text-orange-700 border-orange-200',
  medium:   'bg-amber-50 text-amber-700 border-amber-200',
  low:      'bg-slate-50 text-slate-700 border-slate-200',
};

// Pick the portfolio's headline posture from tier mix.
function overallPosture(totals) {
  if (!totals || totals.total === 0) return null;
  if (totals.ic_ready === totals.total) return 'all_ic_ready';
  if (totals.early > totals.ic_ready + totals.pre_ic) return 'mostly_early';
  if (totals.ic_ready > 0) return 'mixed';
  return 'in_progress';
}

const POSTURE_COPY = {
  all_ic_ready: { label: 'Every live deal IC-ready', pill: 'bg-green-50 text-green-700 border-green-200', accent: 'text-green-700' },
  mixed:        { label: 'Mixed — some IC-ready',     pill: 'bg-sky-50 text-sky-700 border-sky-200',       accent: 'text-sky-700' },
  in_progress:  { label: 'IC prep in progress',       pill: 'bg-amber-50 text-amber-700 border-amber-200', accent: 'text-amber-700' },
  mostly_early: { label: 'Mostly early-stage',        pill: 'bg-slate-50 text-slate-700 border-slate-200', accent: 'text-slate-700' },
};

function TierProportionBar({ totals }) {
  const total = totals.total || 0;
  if (total === 0) {
    return <div className="h-2 w-full rounded-full bg-bg-secondary" />;
  }
  const pct = (n) => (n / total) * 100;
  return (
    <div className="h-2 w-full rounded-full bg-bg-secondary overflow-hidden flex" aria-label="portfolio tier breakdown">
      {totals.ic_ready > 0 && (
        <span className="bg-green-500" style={{ width: `${pct(totals.ic_ready)}%` }} title={`${totals.ic_ready} IC-ready`} />
      )}
      {totals.pre_ic > 0 && (
        <span className="bg-sky-500" style={{ width: `${pct(totals.pre_ic)}%` }} title={`${totals.pre_ic} Pre-IC`} />
      )}
      {totals.diligence > 0 && (
        <span className="bg-amber-500" style={{ width: `${pct(totals.diligence)}%` }} title={`${totals.diligence} Diligence-stage`} />
      )}
      {totals.early > 0 && (
        <span className="bg-slate-400" style={{ width: `${pct(totals.early)}%` }} title={`${totals.early} Early`} />
      )}
    </div>
  );
}

function TierStat({ tier, count }) {
  const t = TIER_TONE[tier] || TIER_TONE.early;
  return (
    <div className="bg-bg-secondary rounded p-2">
      <div className="flex items-center gap-1.5">
        <span className={clsx('w-1.5 h-1.5 rounded-full', t.dot)} />
        <span className="text-[10px] uppercase tracking-wider text-content-muted">{t.label}</span>
      </div>
      <div className="text-lg font-semibold text-content-primary tabular-nums mt-0.5">{count}</div>
    </div>
  );
}

function PortfolioBlockerRow({ blocker }) {
  return (
    <li className="flex items-start gap-2.5 py-2 px-3 border-b border-hairline last:border-0">
      <div className="mt-0.5 shrink-0">
        <AlertCircle size={14} className="text-content-muted" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <span className="text-sm font-medium text-content-primary">{blocker.label}</span>
          <div className="flex items-center gap-2 shrink-0">
            <span className={clsx(
              'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border',
              SEVERITY_TONE[blocker.severity] || SEVERITY_TONE.low,
            )}>
              {blocker.severity}
            </span>
            <span className="text-sm font-semibold text-content-primary tabular-nums">{blocker.affected_count}</span>
          </div>
        </div>
        {blocker.recommended_action && (
          <p className="text-xs text-content-secondary mt-0.5 leading-snug">{blocker.recommended_action}</p>
        )}
      </div>
    </li>
  );
}

function DealStrip({ deal }) {
  const t = TIER_TONE[deal.tier] || TIER_TONE.early;
  return (
    <Link
      to={`/dashboard/deals/${deal.deal_id}`}
      className="flex items-center justify-between gap-2 py-1.5 px-2 hover:bg-bg-secondary/60 rounded transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', t.dot)} />
        <span className="text-sm font-medium text-content-primary truncate">{deal.deal_name}</span>
        {deal.top_blocker && (
          <span className="text-[10px] text-content-muted truncate">· {deal.top_blocker}</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={clsx(
          'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border',
          t.pill,
        )}>
          {t.label}
        </span>
        <span className="text-sm font-semibold text-content-primary tabular-nums w-8 text-right">
          {deal.score}
        </span>
      </div>
    </Link>
  );
}

export default function PortfolioReadinessWidget() {
  const { data, isLoading, isError } = usePortfolioReadiness();

  return (
    <Card className="overflow-hidden">
      <SectionHeader
        title="Portfolio Readiness"
        Icon={Target}
        subtitle="IC + RERA readiness rolled up across every live deal."
      />
      <div className="px-4 sm:px-5 pb-4 space-y-4">
        {isLoading && (
          <div className="space-y-3 animate-pulse">
            <div className="h-2 bg-bg-secondary rounded-full" />
            <div className="grid grid-cols-4 gap-2">
              <div className="h-14 bg-bg-secondary rounded" />
              <div className="h-14 bg-bg-secondary rounded" />
              <div className="h-14 bg-bg-secondary rounded" />
              <div className="h-14 bg-bg-secondary rounded" />
            </div>
            <div className="h-32 bg-bg-secondary rounded" />
          </div>
        )}
        {isError && !isLoading && (
          <EmptyState
            title="Couldn't load portfolio readiness"
            description="This is a display issue — your deals are unaffected."
          />
        )}
        {!isLoading && !isError && data && data.totals?.total === 0 && (
          <div className="py-6">
            <EmptyState
              title="No live deals yet"
              description="Add your first deal to see portfolio-level IC readiness here."
              action={
                <Link
                  to="/dashboard/deals"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-500"
                >
                  Go to deals <ArrowRight size={12} />
                </Link>
              }
            />
          </div>
        )}
        {!isLoading && !isError && data && data.totals?.total > 0 && (
          <>
            {/* Header strip — posture + average score */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                {(() => {
                  const posture = overallPosture(data.totals);
                  const copy = POSTURE_COPY[posture];
                  return copy ? (
                    <span className={clsx(
                      'text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded border',
                      copy.pill,
                    )}>
                      {copy.label}
                    </span>
                  ) : null;
                })()}
                <p className="text-xs text-content-secondary mt-1.5 leading-snug">
                  {data.totals.total} live deal{data.totals.total === 1 ? '' : 's'} · average score {data.average_score} / 100
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold text-content-primary tabular-nums">
                  {data.average_score}
                  <span className="text-content-muted text-sm font-normal">/100</span>
                </div>
              </div>
            </div>

            {/* Tier proportion bar */}
            <TierProportionBar totals={data.totals} />

            {/* Tier counts */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <TierStat tier="ic_ready"  count={data.totals.ic_ready} />
              <TierStat tier="pre_ic"    count={data.totals.pre_ic} />
              <TierStat tier="diligence" count={data.totals.diligence} />
              <TierStat tier="early"     count={data.totals.early} />
            </div>

            {/* Portfolio-wide blockers */}
            {data.portfolio_blockers && data.portfolio_blockers.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Sparkles size={12} className="text-content-muted" />
                  <span className="text-xs uppercase tracking-wider font-medium text-content-secondary">
                    Top blockers across portfolio
                  </span>
                </div>
                <ul className="border border-hairline rounded">
                  {data.portfolio_blockers.slice(0, 5).map((b) => (
                    <PortfolioBlockerRow key={b.id} blocker={b} />
                  ))}
                </ul>
              </div>
            )}

            {/* Top IC-ready + needs attention */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {data.top_ready && data.top_ready.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <CheckCircle2 size={12} className="text-green-600" />
                    <span className="text-xs uppercase tracking-wider font-medium text-content-secondary">
                      Top by readiness
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {data.top_ready.slice(0, 5).map((d) => <DealStrip key={d.deal_id} deal={d} />)}
                  </div>
                </div>
              )}
              {data.top_needs_attention && data.top_needs_attention.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <AlertCircle size={12} className="text-amber-600" />
                    <span className="text-xs uppercase tracking-wider font-medium text-content-secondary">
                      Needs most attention
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {data.top_needs_attention.slice(0, 5).map((d) => <DealStrip key={d.deal_id} deal={d} />)}
                  </div>
                </div>
              )}
            </div>

            {/* Disclaimer */}
            {data.disclaimer && (
              <p className="text-[10px] text-content-muted italic leading-snug pt-2 border-t border-hairline">
                {data.disclaimer}
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
