import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Gauge, ArrowRight, Clock, AlertCircle, TrendingDown, Activity,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Card, SectionHeader, Skeleton } from '../../design-system';
import EmptyState from '../common/EmptyState';
import { usePipelineVelocity } from '../../hooks/useDashboard';

/**
 * Pipeline Velocity widget — deterministic deal-flow analytics.
 *
 * The "how fast do deals move and where do they stall?" view a team usually
 * exports to Excel, rendered from deal_stage_history:
 *   1. Headline — live deals, median days-to-active, aging count, biggest leak.
 *   2. Funnel — horizontal bars (reached count per stage, narrowing), each row
 *      fused with its median dwell + conversion-to-next. The bars draw in on
 *      mount (motion-safe).
 *   3. Cycle tiles — median days from genesis to underwriting / IC / active.
 *   4. Aging — live deals parked past their stage typical, clickable to the deal.
 *   5. Throughput — a 6-month sparkline of forward stage-advances.
 *
 * Honest by construction: a median shown only where there's enough history; thin
 * stages render an em-dash, never a misleading "0d". Restraint over decoration
 * (FRONTEND_GUIDELINES §0): solid calm bars, one accent, hairline rules, tabular
 * numerals — no gradients, glow, or pulsing.
 */

// null / undefined → em-dash; otherwise "<1d" or "Nd" (keeps one decimal under 10).
const fmtDays = (d) => {
  if (d == null || !Number.isFinite(Number(d))) return '—';
  const n = Number(d);
  if (n > 0 && n < 1) return '<1d';
  return `${n < 10 ? Math.round(n * 10) / 10 : Math.round(n)}d`;
};
const fmtPct = (p) => (p == null || !Number.isFinite(Number(p)) ? '—' : `${Math.round(Number(p))}%`);

function HeadlineStat({ label, value, tone = 'text-content-primary', sub }) {
  return (
    <div className="bg-bg-secondary rounded p-2.5 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-content-muted truncate">{label}</div>
      <div className={clsx('text-lg font-semibold tabular-nums mt-0.5', tone)}>{value}</div>
      {sub && <div className="text-[10px] text-content-muted truncate mt-0.5">{sub}</div>}
    </div>
  );
}

function FunnelRow({ row, medianDays, maxReached, mounted, isLeak }) {
  const pct = maxReached > 0 ? (row.reached / maxReached) * 100 : 0;
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-[5.5rem] shrink-0 text-xs text-content-secondary truncate" title={row.label}>
        {row.label}
      </span>
      <div className="flex-1 min-w-0">
        <div className="h-6 rounded bg-bg-secondary overflow-hidden relative">
          <div
            className={clsx(
              'h-full rounded transition-[width] duration-700 ease-out',
              isLeak ? 'bg-premium' : 'bg-accent',
            )}
            style={{ width: mounted ? `${Math.max(pct, row.reached > 0 ? 4 : 0)}%` : '0%' }}
          />
          <span className="absolute inset-y-0 left-2 flex items-center text-[11px] font-semibold text-content-primary tabular-nums">
            {row.reached}
            {row.current > 0 && (
              <span className="ml-1.5 font-normal text-content-muted">· {row.current} now</span>
            )}
          </span>
        </div>
      </div>
      <span className="w-12 shrink-0 text-right text-[11px] text-content-muted tabular-nums" title="median time in stage">
        {fmtDays(medianDays)}
      </span>
      <span
        className={clsx(
          'w-10 shrink-0 text-right text-[11px] tabular-nums',
          isLeak ? 'text-premium font-semibold' : 'text-content-muted',
        )}
        title="conversion to the next stage"
      >
        {row.conversion_to_next_pct == null ? '' : fmtPct(row.conversion_to_next_pct)}
      </span>
    </div>
  );
}

function CycleTile({ item }) {
  return (
    <div className="bg-bg-secondary rounded p-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wider text-content-muted truncate">to {item.label}</div>
      <div className="text-base font-semibold text-content-primary tabular-nums mt-0.5">
        {fmtDays(item.median_days)}
      </div>
      <div className="text-[10px] text-content-muted mt-0.5">
        {item.reached_count} deal{item.reached_count === 1 ? '' : 's'}
      </div>
    </div>
  );
}

function AgingRow({ deal }) {
  return (
    <Link
      to={`/dashboard/deals/${deal.deal_id}`}
      className="flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-bg-secondary/60 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.99]"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-premium" />
        <span className="text-sm font-medium text-content-primary truncate">{deal.deal_name}</span>
        <span className="text-[10px] text-content-muted truncate">· {deal.stage_label}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
        <span className="text-sm font-semibold text-content-primary">{deal.days_in_stage}d</span>
        {deal.typical_days != null && (
          <span className="text-[10px] text-content-muted">vs ~{Math.round(deal.typical_days)}d</span>
        )}
      </div>
    </Link>
  );
}

function ThroughputSparkline({ series }) {
  const max = Math.max(1, ...series.map((m) => m.advances));
  return (
    <div className="flex items-end gap-1.5 h-12" aria-label="forward stage-advances per month">
      {series.map((m) => (
        <div key={m.month} className="flex-1 flex flex-col items-center gap-1 group">
          <div className="w-full flex items-end justify-center h-9">
            <div
              className="w-full max-w-[1.5rem] rounded-sm bg-accent/70 group-hover:bg-accent transition-colors duration-150 ease-out"
              style={{ height: `${(m.advances / max) * 100}%`, minHeight: m.advances > 0 ? '3px' : '0' }}
              title={`${m.advances} advance${m.advances === 1 ? '' : 's'} · ${m.month}`}
            />
          </div>
          <span className="text-[9px] text-content-muted tabular-nums">{m.month.split(' ')[0]}</span>
        </div>
      ))}
    </div>
  );
}

export default function PipelineVelocityWidget() {
  const { data, isLoading, isError } = usePipelineVelocity();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Defer one frame so the bars transition from 0 → target (draw-in).
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const hasData = !isLoading && !isError && data;
  const total = data?.headline?.total_deals || 0;
  const medianByStage = {};
  if (hasData) for (const t of data.time_in_stage || []) medianByStage[t.stage] = t.median_days;
  const funnelRows = hasData ? (data.funnel || []).filter((f) => f.reached > 0) : [];
  const maxReached = funnelRows.length ? funnelRows[0].reached : 0;
  const leakStage = data?.headline?.biggest_dropoff?.from_stage || null;

  return (
    <Card className="overflow-hidden">
      <SectionHeader
        title="Pipeline Velocity"
        icon={Gauge}
        sub="How deals move, where they convert, and what's stalling."
      />
      <div className="px-4 sm:px-5 pb-4 space-y-4">
        {isLoading && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded" ariaLabel={null} role="presentation" />)}
            </div>
            <Skeleton className="h-40 rounded" ariaLabel={null} role="presentation" />
          </div>
        )}

        {isError && !isLoading && (
          <EmptyState
            title="Couldn't load pipeline velocity"
            description="This is a display issue — your deals are unaffected."
          />
        )}

        {hasData && total === 0 && (
          <div className="py-6">
            <EmptyState
              title="No pipeline history yet"
              description="As deals move through stages, their velocity, conversion, and aging show up here."
              action={
                <Link to="/dashboard/deals" className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent">
                  Go to deals <ArrowRight size={12} />
                </Link>
              }
            />
          </div>
        )}

        {hasData && total > 0 && (
          <>
            {/* Headline */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <HeadlineStat label="Live deals" value={data.headline.live_deals} />
              <HeadlineStat
                label="Median to active"
                value={fmtDays(data.headline.median_days_to_active)}
                sub="genesis → active"
              />
              <HeadlineStat
                label="Aging"
                value={data.headline.aging_count}
                tone={data.headline.aging_count > 0 ? 'text-premium' : 'text-content-primary'}
                sub="need a nudge"
              />
              {data.headline.biggest_dropoff ? (
                <div className="bg-bg-secondary rounded p-2.5 min-w-0">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-content-muted truncate">
                    <TrendingDown size={11} className="text-premium shrink-0" /> Biggest leak
                  </div>
                  <div className="text-sm font-semibold text-content-primary tabular-nums mt-1 truncate">
                    {fmtPct(data.headline.biggest_dropoff.conversion_pct)} through
                  </div>
                  <div className="text-[10px] text-content-muted truncate mt-0.5">
                    {data.headline.biggest_dropoff.from_label} → next
                  </div>
                </div>
              ) : (
                <HeadlineStat label="Deals analysed" value={total} sub="incl. closed/archived" />
              )}
            </div>

            {/* Funnel */}
            {funnelRows.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Activity size={12} className="text-content-muted" />
                    <span className="text-xs uppercase tracking-wider font-medium text-content-secondary">Funnel</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-content-muted">
                    <span>reached · now</span>
                    <span className="w-12 text-right">median</span>
                    <span className="w-10 text-right">conv.</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {funnelRows.map((row) => (
                    <FunnelRow
                      key={row.stage}
                      row={row}
                      medianDays={medianByStage[row.stage]}
                      maxReached={maxReached}
                      mounted={mounted}
                      isLeak={row.stage === leakStage}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Cycle time */}
            {data.cycle_time && data.cycle_time.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Clock size={12} className="text-content-muted" />
                  <span className="text-xs uppercase tracking-wider font-medium text-content-secondary">Cycle time</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {data.cycle_time.map((c) => <CycleTile key={c.milestone} item={c} />)}
                </div>
              </div>
            )}

            {/* Aging + throughput */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <AlertCircle size={12} className="text-premium" />
                  <span className="text-xs uppercase tracking-wider font-medium text-content-secondary">
                    Aging — needs a nudge
                  </span>
                </div>
                {data.aging && data.aging.length > 0 ? (
                  <div className="space-y-0.5">
                    {data.aging.slice(0, 5).map((d) => <AgingRow key={d.deal_id} deal={d} />)}
                  </div>
                ) : (
                  <p className="text-xs text-content-muted py-2 px-2">No live deal is parked beyond its stage's typical dwell. ✓</p>
                )}
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Activity size={12} className="text-content-muted" />
                  <span className="text-xs uppercase tracking-wider font-medium text-content-secondary">
                    Throughput · 6 mo
                  </span>
                </div>
                {data.throughput && data.throughput.length > 0 && (
                  <ThroughputSparkline series={data.throughput} />
                )}
              </div>
            </div>

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
