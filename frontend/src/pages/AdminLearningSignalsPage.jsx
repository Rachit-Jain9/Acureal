import { useState, useMemo } from 'react';
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  RefreshCcw,
  Hash,
  Users,
  Layers,
} from 'lucide-react';
import { clsx } from 'clsx';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { Card, SectionHeader, SkeletonList, ErrorState } from '../design-system';
import { useLearningSignals } from '../hooks/useLearningSignals';

/**
 * E7-PR1 — Admin Learning Signal Health
 *
 * Operator-only view of the learning-loop telemetry the platform has
 * captured. Pairs with PR #618's consumer-side aggregator (which uses the
 * same data to re-rank recommendation cards within each org) so the
 * operator can SEE what the platform is learning and which rules are
 * being de-ranked right now.
 *
 * Read-only, RLS-scoped (the API filters by current_organization_id),
 * no AI, no writes. The page renders four sections:
 *
 *   1. Top-line summary — verdicts captured, dismiss/act rates, attribution
 *   2. Currently-active adjustments — rules being de-ranked right now,
 *      with the exact multiplier the engine applies + the policy reason
 *   3. Top dismissed + top applied — the two leaderboards side-by-side
 *   4. Daily trend — verdict counts per day across the window
 *
 * Sticking to FRONTEND_GUIDELINES.md + feedback_pace_and_polish.md:
 *   • Skeletons (not spinners) for loading
 *   • Tabular numerals throughout
 *   • Semantic tokens only — no raw hex
 *   • Focus-visible rings on every interactive element
 *   • Editorial / Bloomberg-like, never AI-SaaS tacky
 */

const WINDOW_OPTIONS = [
  { days: 7,   label: '7 days' },
  { days: 30,  label: '30 days' },
  { days: 90,  label: '90 days' },
  { days: 365, label: 'Year' },
];

const fmtNum = (v) => {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('en-IN');
};

const fmtPct = (v) => {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `${Number(v).toFixed(1)}%`;
};

const fmtMultiplier = (v) => {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `${Number(v).toFixed(2)}×`;
};

const relTime = (iso) => {
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

const humanRuleId = (id) =>
  String(id || '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const humanTopic = (t) =>
  String(t || '')
    .replace(/^legal_/, 'Legal · ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

// ─── KPI Stat ────────────────────────────────────────────────────────────

function KpiStat({ label, value, sub, icon: Icon, tone = 'neutral' }) {
  const toneCls = {
    neutral: 'text-content-primary',
    success: 'text-emerald-700',
    warn:    'text-amber-700',
    danger:  'text-rose-700',
    accent:  'text-accent',
  }[tone] || 'text-content-primary';
  return (
    <div className="flex items-start gap-3 p-4 rounded-md border border-hairline bg-bg-elevated">
      {Icon && (
        <div className="shrink-0 p-1.5 rounded bg-bg-secondary">
          <Icon size={14} className="text-content-muted" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-[0.12em] text-content-muted font-semibold">
          {label}
        </div>
        <div className={clsx('mt-0.5 text-2xl font-display tabular-nums', toneCls)}>
          {value}
        </div>
        {sub && <div className="mt-0.5 text-[11px] text-content-muted">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Active adjustment row ───────────────────────────────────────────────

function AdjustmentRow({ row }) {
  const dangerTone = row.multiplier <= 0.7;
  return (
    <li className="border border-hairline-soft rounded-md px-3 py-2.5 hover:bg-bg-secondary/40 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-medium text-content-primary truncate">
              {humanRuleId(row.rule_id)}
            </span>
            {row.last_verb && (
              <span className="text-[10px] uppercase tracking-wider text-content-muted">
                {row.last_verb}
              </span>
            )}
            {row.is_legal_carve_out && (
              <span className="text-[10px] uppercase tracking-wider text-rose-700 inline-flex items-center gap-1">
                <ShieldAlert size={10} />
                Legal carve-out
              </span>
            )}
          </div>
          {row.topic && (
            <div className="text-[11px] text-content-muted mt-0.5">
              {humanTopic(row.topic)}
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-content-secondary">
            <span className="inline-flex items-center gap-1">
              <TrendingDown size={11} className="text-rose-600" />
              <span className="tabular-nums">{row.dismiss_count}</span> dismissed
            </span>
            {row.snooze_count > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="tabular-nums">{row.snooze_count}</span> snoozed
              </span>
            )}
            {row.acted_count > 0 && (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 size={11} className="text-emerald-600" />
                <span className="tabular-nums">{row.acted_count}</span> applied
              </span>
            )}
            <span className="text-content-muted">·</span>
            <span className="text-content-muted">{relTime(row.last_verdict_at)}</span>
          </div>
          {row.reason && (
            <div className="mt-1 text-[11px] text-content-secondary italic">
              {row.reason}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className={clsx(
            'text-lg font-display tabular-nums',
            dangerTone ? 'text-rose-700' : 'text-amber-700',
          )}>
            {fmtMultiplier(row.multiplier)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-content-muted">
            Sort weight
          </div>
        </div>
      </div>
    </li>
  );
}

// ─── Leaderboard row ─────────────────────────────────────────────────────

function LeaderboardRow({ row, primaryKey }) {
  const primary = row[primaryKey] || 0;
  const isDismissed = primaryKey === 'dismiss_count';
  return (
    <li className="border border-hairline-soft rounded-md px-3 py-2 hover:bg-bg-secondary/40 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-medium text-content-primary truncate">
              {humanRuleId(row.rule_id)}
            </span>
            {row.last_verb && (
              <span className="text-[10px] uppercase tracking-wider text-content-muted">
                {row.last_verb}
              </span>
            )}
            {row.is_legal_carve_out && (
              <span className="text-[10px] uppercase tracking-wider text-rose-700">
                Legal
              </span>
            )}
          </div>
          {row.topic && (
            <div className="text-[11px] text-content-muted">
              {humanTopic(row.topic)}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className={clsx(
            'text-base font-display tabular-nums',
            isDismissed ? 'text-rose-700' : 'text-emerald-700',
          )}>
            {primary}×
          </div>
          <div className="text-[10px] uppercase tracking-wider text-content-muted">
            {isDismissed ? 'Dismissed' : 'Applied'}
          </div>
        </div>
      </div>
    </li>
  );
}

// ─── Daily-trend sparkline (no chart library — keeps bundle slim) ────────

function DailyTrend({ series }) {
  const max = useMemo(
    () => Math.max(1, ...series.map((d) => d.total)),
    [series],
  );
  if (!series || series.length === 0) {
    return (
      <div className="text-[11px] text-content-muted text-center py-8">
        No verdicts in this window yet. Dismiss / snooze / apply some
        recommendation cards on a deal and the trend will populate here.
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex items-end gap-0.5 h-24" role="img" aria-label="Daily verdict counts">
        {series.map((d) => {
          const dismissH = (d.dismissed / max) * 100;
          const snoozeH  = (d.snoozed / max) * 100;
          const actedH   = (d.acted / max) * 100;
          return (
            <div
              key={d.date}
              className="flex-1 flex flex-col-reverse min-w-[2px]"
              title={`${d.date}: ${d.total} verdicts (${d.dismissed} dismissed, ${d.snoozed} snoozed, ${d.acted} applied)`}
            >
              {dismissH > 0 && (
                <div className="bg-rose-500/70" style={{ height: `${dismissH}%` }} />
              )}
              {snoozeH > 0 && (
                <div className="bg-amber-500/70" style={{ height: `${snoozeH}%` }} />
              )}
              {actedH > 0 && (
                <div className="bg-emerald-500/70" style={{ height: `${actedH}%` }} />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[10px] text-content-muted">
        <span>{series[0]?.date}</span>
        <span className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-500/70" />Dismissed</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500/70" />Snoozed</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/70" />Applied</span>
        </span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function AdminLearningSignalsPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, isError, refetch, isFetching } = useLearningSignals(days);

  const summary = data?.summary;
  const topDismissed = data?.top_dismissed || [];
  const topActed = data?.top_acted || [];
  const activeAdjustments = data?.active_adjustments?.adjustments || [];
  const adjustedRuleCount = data?.active_adjustments?.adjusted_rule_count || 0;
  const dailySeries = data?.daily_series || [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Learning Loop"
        title="Learning Signal Health"
        sub="Operator-only view of the verdicts your team has logged on recommendation cards. Pairs with the consumer-side aggregator (PR #618) that uses this data to re-rank cards within your org."
      />

      {/* Window picker + refresh */}
      <div className="flex items-center gap-2 flex-wrap">
        {WINDOW_OPTIONS.map((o) => (
          <button
            key={o.days}
            type="button"
            onClick={() => setDays(o.days)}
            className={clsx(
              'px-2.5 py-1 rounded text-[11px] font-medium border transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              days === o.days
                ? 'bg-accent text-white border-accent'
                : 'bg-bg-elevated text-content-secondary border-hairline hover:border-accent/40 hover:text-content-primary',
            )}
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-hairline bg-bg-elevated text-content-secondary hover:text-content-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCcw size={11} className={clsx(isFetching && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {isError && (
        <ErrorState
          title="Could not load learning-signal data"
          detail="The admin endpoint returned an error. Try Refresh; if it persists, check the Vercel runtime logs for /api/admin/learning-signals."
        />
      )}

      {isLoading && <SkeletonList rows={4} />}

      {!isLoading && !isError && summary && (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiStat
              label="Verdicts captured"
              value={fmtNum(summary.total_verdicts)}
              sub={`across ${fmtNum(summary.distinct_rules)} distinct rules`}
              icon={Sparkles}
            />
            <KpiStat
              label="Dismissed"
              value={fmtPct(summary.dismissed_rate_pct)}
              sub={`${fmtNum(summary.dismissed)} cards`}
              icon={TrendingDown}
              tone={summary.dismissed_rate_pct > 60 ? 'warn' : 'neutral'}
            />
            <KpiStat
              label="Applied"
              value={fmtPct(summary.acted_rate_pct)}
              sub={`${fmtNum(summary.acted)} cards`}
              icon={CheckCircle2}
              tone={summary.acted_rate_pct >= 20 ? 'success' : 'neutral'}
            />
            <KpiStat
              label="Attribution rate"
              value={fmtPct(summary.attributed_rate_pct)}
              sub="users with product_improvement consent"
              icon={Users}
            />
          </div>

          {/* Daily trend */}
          <Card className="p-5">
            <SectionHeader
              size="sm"
              icon={TrendingUp}
              eyebrow="Trend"
              title={`Verdicts per day · ${days}-day window`}
              sub="Stacked: dismissed (red) / snoozed (amber) / applied (green). Hover a bar for the exact counts."
            />
            <div className="mt-4">
              <DailyTrend series={dailySeries} />
            </div>
          </Card>

          {/* Active adjustments */}
          <Card className="p-5">
            <SectionHeader
              size="sm"
              icon={AlertTriangle}
              eyebrow="Right now"
              title={
                adjustedRuleCount === 0
                  ? 'No rules are currently being de-ranked'
                  : `${adjustedRuleCount} rule${adjustedRuleCount === 1 ? '' : 's'} currently being de-ranked`
              }
              sub="Rules where the consumer-side aggregator applies a multiplier < 1.0. These cards still show on every deal, but rank lower. Legal carve-out topics (title / RERA / approvals / encumbrance) never de-rank."
            />
            {activeAdjustments.length === 0 ? (
              <div className="mt-3 text-[11px] text-content-muted py-4 text-center">
                Either your team hasn't dismissed enough recurring cards yet, or every dismissal is offset by an "Applied".
                The platform learns once a rule crosses 3 dismissals in 90 days.
              </div>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {activeAdjustments.map((row) => (
                  <AdjustmentRow key={row.rule_id} row={row} />
                ))}
              </ul>
            )}
          </Card>

          {/* Top dismissed + Top applied */}
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-5">
              <SectionHeader
                size="sm"
                icon={TrendingDown}
                eyebrow="Top dismissed"
                title="Rules your team dismisses most"
                sub={`In the last ${days} day${days === 1 ? '' : 's'}.`}
              />
              {topDismissed.length === 0 ? (
                <div className="mt-3 text-[11px] text-content-muted py-4 text-center">
                  No dismissals yet.
                </div>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {topDismissed.map((row) => (
                    <LeaderboardRow key={row.rule_id} row={row} primaryKey="dismiss_count" />
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-5">
              <SectionHeader
                size="sm"
                icon={CheckCircle2}
                eyebrow="Top applied"
                title="Rules your team applies most"
                sub={`In the last ${days} day${days === 1 ? '' : 's'}.`}
              />
              {topActed.length === 0 ? (
                <div className="mt-3 text-[11px] text-content-muted py-4 text-center">
                  No "Applied" verdicts yet. Mark a recommendation as acted-on (the ✓ button on the card) to see it here.
                </div>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {topActed.map((row) => (
                    <LeaderboardRow key={row.rule_id} row={row} primaryKey="acted_count" />
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Honesty footer */}
          <div className="text-[11px] text-content-muted leading-relaxed">
            <span className="font-medium">How this works:</span>{' '}
            every dismiss / snooze / apply verdict on a recommendation card writes a values-free row to
            <code className="mx-1 font-mono text-content-secondary">improvement_signals</code>
            (user_id only populated when the operator holds <em>product_improvement</em> consent).
            The consumer-side aggregator reads those rows back per-(org, rule) over a 90-day window and applies a
            deterministic multiplier (legal carve-outs stay at 1.0; ≥6 dismissals → 0.7 floor; ≥3 → 0.85; acted ≥ dismissed → 1.0).
            This page mirrors the consumer's policy exactly — the "Adjustments" list above is what the engine
            is using to re-rank cards right now.
            {summary.last_verdict_at && (
              <>
                {' '}<span className="text-content-secondary">Last verdict captured {relTime(summary.last_verdict_at)}.</span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
