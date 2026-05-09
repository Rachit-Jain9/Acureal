import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronRight,
  DollarSign,
  Hash,
  Layers,
  RefreshCcw,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import { clsx } from 'clsx';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { Card, SectionHeader, SkeletonList, ErrorState } from '../design-system';
import { useAiUsage } from '../hooks/useAiUsage';

// Admin-only AI cost / latency dashboard.
//
// Reads /api/admin/ai-usage which aggregates `ai_call_logs` server-side.
// Org-scoped via RLS (the SELECT policy filters to current_organization_id).
// Read-only — no mutations, no LLM calls; this is just instrumentation
// surfaced for an operator who's spending real money on Claude / Gemini /
// OpenAI and wants to know where it's going.

const WINDOW_OPTIONS = [
  { days: 1,   label: 'Today' },
  { days: 7,   label: '7 days' },
  { days: 30,  label: '30 days' },
  { days: 90,  label: '90 days' },
  { days: 365, label: 'Year' },
];

const fmtNum = (v, decimals = 0) => {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const fmtUsd = (v) => {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (n >= 1000) return `$${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  if (n >= 1)    return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
};

const fmtMs = (v) => {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(1)} s`;
};

const fmtRelative = (iso) => {
  if (!iso) return '—';
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.round(ms / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  } catch {
    return '—';
  }
};

const STATUS_TONE = {
  success:    'success',
  cache_hit:  'success',
  error:      'danger',
  timeout:    'danger',
  cost_capped:'warn',
  skipped:    'neutral',
};

// ── KPI tile ───────────────────────────────────────────────────────────────
function KpiTile({ icon: Icon, label, value, sub, tone = 'default' }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-eyebrow uppercase text-content-muted mb-2 font-medium">
        {Icon && <Icon size={12} />}
        {label}
      </div>
      <div
        className={clsx(
          'text-2xl font-bold tabular-nums',
          tone === 'positive' && 'text-data-positive',
          tone === 'negative' && 'text-data-negative',
          tone === 'default' && 'text-content-primary',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-content-muted">{sub}</div>}
    </Card>
  );
}

// ── Sparkline-style daily bar list (no chart lib) ──────────────────────────
function DailyBars({ daily, maxCost }) {
  if (!daily?.length) {
    return (
      <p className="text-sm text-content-muted py-6 text-center">
        No calls in this window.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      {daily.map((d) => {
        const pct = maxCost > 0 ? (d.cost_usd / maxCost) * 100 : 0;
        return (
          <div key={d.day} className="flex items-center gap-3 text-xs">
            <span className="shrink-0 w-20 text-content-muted tabular-nums">{d.day}</span>
            <div className="flex-1 h-3 bg-bg-secondary rounded overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-200"
                style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
              />
            </div>
            <span className="shrink-0 w-16 text-right text-content-primary tabular-nums">
              {fmtUsd(d.cost_usd)}
            </span>
            <span className="shrink-0 w-14 text-right text-content-muted tabular-nums">
              {fmtNum(d.calls)} calls
            </span>
            {d.failures > 0 && (
              <span className="shrink-0 text-data-negative tabular-nums" title={`${d.failures} failures`}>
                {d.failures}✗
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Per-task / provider table ──────────────────────────────────────────────
function ByTaskProviderTable({ rows, totalCost }) {
  if (!rows?.length) {
    return <p className="text-sm text-content-muted py-6 text-center">No usage data yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b border-hairline text-content-muted uppercase tracking-wide">
          <tr>
            <th className="text-left py-2 px-3 font-medium">Task</th>
            <th className="text-left py-2 px-3 font-medium">Provider</th>
            <th className="text-left py-2 px-3 font-medium">Model</th>
            <th className="text-right py-2 px-3 font-medium">Calls</th>
            <th className="text-right py-2 px-3 font-medium">Cost</th>
            <th className="text-right py-2 px-3 font-medium">% of total</th>
            <th className="text-right py-2 px-3 font-medium">Cache</th>
            <th className="text-right py-2 px-3 font-medium">Avg latency</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const pct = totalCost > 0 ? (r.cost_usd / totalCost) * 100 : 0;
            return (
              <tr key={`${r.task}-${r.provider}-${r.model}-${i}`} className="border-b border-hairline last:border-b-0 hover:bg-bg-secondary/40">
                <td className="py-2 px-3 text-content-primary">{r.task}</td>
                <td className="py-2 px-3 text-content-secondary">
                  <Badge tone="neutral" className="text-[10px] uppercase">{r.provider}</Badge>
                </td>
                <td className="py-2 px-3 text-content-muted font-mono text-[10px]">{r.model || '—'}</td>
                <td className="py-2 px-3 text-right text-content-primary tabular-nums">{fmtNum(r.calls)}</td>
                <td className="py-2 px-3 text-right text-content-primary tabular-nums font-medium">{fmtUsd(r.cost_usd)}</td>
                <td className="py-2 px-3 text-right text-content-muted tabular-nums">{pct.toFixed(1)}%</td>
                <td className="py-2 px-3 text-right text-content-muted tabular-nums">
                  {r.cache_hits > 0 ? `${fmtNum(r.cache_hits)}` : '—'}
                </td>
                <td className="py-2 px-3 text-right text-content-muted tabular-nums">{fmtMs(r.avg_latency_ms)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Top-cost individual calls ──────────────────────────────────────────────
function TopCostCallsTable({ rows }) {
  if (!rows?.length) {
    return <p className="text-sm text-content-muted py-6 text-center">No cost data yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b border-hairline text-content-muted uppercase tracking-wide">
          <tr>
            <th className="text-left py-2 px-3 font-medium">When</th>
            <th className="text-left py-2 px-3 font-medium">Task</th>
            <th className="text-left py-2 px-3 font-medium">Provider</th>
            <th className="text-left py-2 px-3 font-medium">Status</th>
            <th className="text-right py-2 px-3 font-medium">Cost</th>
            <th className="text-right py-2 px-3 font-medium">Tokens</th>
            <th className="text-right py-2 px-3 font-medium">Latency</th>
            <th className="text-left py-2 px-3 font-medium">Linked</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-hairline last:border-b-0 hover:bg-bg-secondary/40">
              <td className="py-2 px-3 text-content-muted tabular-nums" title={c.created_at}>
                {fmtRelative(c.created_at)}
              </td>
              <td className="py-2 px-3 text-content-primary">{c.task}</td>
              <td className="py-2 px-3 text-content-secondary">
                <Badge tone="neutral" className="text-[10px] uppercase">{c.provider}</Badge>
                <span className="ml-1.5 text-[10px] text-content-muted font-mono">{c.model}</span>
              </td>
              <td className="py-2 px-3">
                <Badge tone={STATUS_TONE[c.status] || 'neutral'} className="text-[10px]">{c.status}</Badge>
              </td>
              <td className="py-2 px-3 text-right text-content-primary tabular-nums font-medium">{fmtUsd(c.cost_usd)}</td>
              <td className="py-2 px-3 text-right text-content-muted tabular-nums">{fmtNum(c.total_tokens)}</td>
              <td className="py-2 px-3 text-right text-content-muted tabular-nums">{fmtMs(c.latency_ms)}</td>
              <td className="py-2 px-3 text-content-muted">
                {c.deal_id ? (
                  <Link
                    to={`/dashboard/deals/${c.deal_id}`}
                    className="text-accent hover:underline inline-flex items-center gap-0.5"
                    title="Open deal"
                  >
                    Deal <ChevronRight size={10} />
                  </Link>
                ) : c.document_id ? (
                  <span className="text-content-muted">Doc</span>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminAiUsagePage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, isError, error, refetch, isFetching } = useAiUsage(days);

  const summary = data?.summary;
  const daily = data?.daily || [];
  const byTaskProvider = data?.by_task_provider || [];
  const topCost = data?.top_cost_calls || [];

  const maxDailyCost = useMemo(
    () => daily.reduce((m, d) => Math.max(m, Number(d.cost_usd) || 0), 0),
    [daily],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Observability"
        title="AI usage & cost"
        description="Cost, latency, and reliability across every Gemini / Claude / OpenAI call. Org-scoped via RLS — you only see your own organization's spend. Refreshed on each visit and on window focus."
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-md border border-hairline overflow-hidden bg-bg-elevated">
              {WINDOW_OPTIONS.map((w, i) => (
                <button
                  key={w.days}
                  type="button"
                  onClick={() => setDays(w.days)}
                  className={clsx(
                    'px-2.5 py-1.5 text-xs font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    days === w.days
                      ? 'bg-accent text-white'
                      : 'text-content-secondary hover:text-content-primary hover:bg-bg-secondary',
                    i > 0 && 'border-l border-hairline',
                  )}
                >
                  {w.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
              title="Refresh"
            >
              <RefreshCcw size={12} className={isFetching ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        }
      />

      {isLoading && (
        <Card className="p-4">
          <SkeletonList rows={6} columns={4} />
        </Card>
      )}

      {isError && !isLoading && (
        <ErrorState
          tone="danger"
          title="Couldn't load AI usage"
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

      {!isLoading && !isError && summary && (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiTile
              icon={DollarSign}
              label="Total cost"
              value={fmtUsd(summary.total_cost_usd)}
              sub={`${fmtNum(summary.total_calls)} calls · ${fmtNum(summary.total_tokens)} tokens`}
            />
            <KpiTile
              icon={Activity}
              label="Latency p50 / p95"
              value={`${fmtMs(summary.p50_latency_ms)} / ${fmtMs(summary.p95_latency_ms)}`}
              sub={`Avg ${fmtMs(summary.avg_latency_ms)}`}
            />
            <KpiTile
              icon={Zap}
              label="Cache hit rate"
              value={`${summary.cache_hit_rate_pct}%`}
              sub={`${fmtNum(summary.cache_hits)} cached · ${fmtNum(summary.prompt_cache_used)} prompt-cache reads`}
              tone={summary.cache_hit_rate_pct >= 30 ? 'positive' : 'default'}
            />
            <KpiTile
              icon={summary.errors > 0 ? AlertTriangle : CheckCircle2}
              label="Errors"
              value={fmtNum(summary.errors)}
              sub={
                summary.recovered_via_retry > 0
                  ? `${fmtNum(summary.recovered_via_retry)} recovered via retry`
                  : summary.cost_capped > 0
                  ? `${fmtNum(summary.cost_capped)} cost-capped`
                  : 'No retry recoveries needed'
              }
              tone={summary.errors > 0 ? 'negative' : 'positive'}
            />
          </div>

          {/* Daily bars */}
          <div>
            <SectionHeader
              size="sm"
              eyebrow="Trend"
              title={`Daily spend — last ${summary.window_days} day${summary.window_days === 1 ? '' : 's'}`}
              sub="Bar length is proportional to that day's cost. Failures column flags days with non-success calls."
            />
            <Card className="p-4 mt-3">
              <DailyBars daily={daily} maxCost={maxDailyCost} />
            </Card>
          </div>

          {/* Per-task / provider */}
          <div>
            <SectionHeader
              size="sm"
              eyebrow="Where the spend is going"
              title="By task × provider × model"
              sub={`Top ${byTaskProvider.length} cells by cost. Cache hits column tells you how often this combo was served from the response cache.`}
            />
            <Card className="p-0 mt-3 overflow-hidden">
              <ByTaskProviderTable rows={byTaskProvider} totalCost={summary.total_cost_usd} />
            </Card>
          </div>

          {/* Top-cost calls */}
          <div>
            <SectionHeader
              size="sm"
              eyebrow="Outliers"
              title="Top 20 most expensive individual calls"
              sub="Useful for spotting one runaway extraction that blew the budget. Status pill flags wasted spend."
            />
            <Card className="p-0 mt-3 overflow-hidden">
              <TopCostCallsTable rows={topCost} />
            </Card>
          </div>

          {data?.by_doctype && data.by_doctype.length > 0 && (
            <div>
              <SectionHeader
                size="sm"
                eyebrow="Extraction quality"
                title="By document type & language"
                sub="Surfaces how reliable extraction is per language — useful for the Kannada vs English calibration question."
              />
              <Card className="p-0 mt-3 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="border-b border-hairline text-content-muted uppercase tracking-wide">
                      <tr>
                        <th className="text-left py-2 px-3 font-medium">Doctype</th>
                        <th className="text-left py-2 px-3 font-medium">Language</th>
                        <th className="text-right py-2 px-3 font-medium">Calls</th>
                        <th className="text-right py-2 px-3 font-medium">Successes</th>
                        <th className="text-right py-2 px-3 font-medium">Errors</th>
                        <th className="text-right py-2 px-3 font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_doctype.map((d, i) => (
                        <tr key={`${d.doctype}-${d.language}-${i}`} className="border-b border-hairline last:border-b-0 hover:bg-bg-secondary/40">
                          <td className="py-2 px-3 text-content-primary font-mono text-[10px]">{d.doctype}</td>
                          <td className="py-2 px-3 text-content-secondary">{d.language}</td>
                          <td className="py-2 px-3 text-right text-content-primary tabular-nums">{fmtNum(d.calls)}</td>
                          <td className="py-2 px-3 text-right text-data-positive tabular-nums">{fmtNum(d.successes)}</td>
                          <td className="py-2 px-3 text-right text-data-negative tabular-nums">{fmtNum(d.errors)}</td>
                          <td className="py-2 px-3 text-right text-content-muted tabular-nums">{fmtUsd(d.cost_usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          <p className="text-[11px] text-content-muted">
            Generated {fmtRelative(data.generated_at)}. Org-scoped via row-level security on
            <span className="font-mono"> ai_call_logs</span>.
          </p>
        </>
      )}
    </div>
  );
}
