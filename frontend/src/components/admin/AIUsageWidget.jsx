import { useEffect, useState } from 'react';
import { Brain, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import api from '../../services/api';
import { Skeleton, SkeletonKpi } from '../../design-system';

// Compact in-platform AI usage dashboard. Reads from /api/admin/ai-usage
// (admin/analyst gated, org-scoped via RLS). Surfaces what Anthropic +
// Google's billing dashboards cannot — task-level cost, cache hit rate,
// retry recovery, p95 latency, per-doctype quality breakdown.
//
// Editorial chrome: matches the SettingsPage card styling rather than
// introducing new visual conventions. Numbers are tabular-nums.

const WINDOW_OPTIONS = [
  { value: 7,  label: 'Last 7 days'  },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
];

const formatUsd = (n) => {
  const num = Number(n || 0);
  if (num === 0) return '$0.00';
  if (num < 0.01) return `<$0.01`;
  return `$${num.toFixed(2)}`;
};

const formatInt = (n) => Number(n || 0).toLocaleString('en-IN');

const formatMs = (n) => {
  const num = Number(n || 0);
  if (num === 0) return '—';
  if (num < 1000) return `${num} ms`;
  return `${(num / 1000).toFixed(1)} s`;
};

export default function AIUsageWidget() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async (targetDays) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/admin/ai-usage', { params: { days: targetDays } });
      setData(res.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load AI usage');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(days);
  }, [days]);

  const summary = data?.summary;
  const byTaskProvider = data?.by_task_provider || [];
  const byDoctype = data?.by_doctype || [];

  return (
    <div className="bg-bg-elevated rounded-xl shadow-sm border border-hairline-strong p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
          <Brain size={18} />
          AI Usage
        </h3>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-2 py-1 border border-hairline-strong rounded text-xs bg-bg-elevated"
          >
            {WINDOW_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            onClick={() => load(days)}
            disabled={loading}
            className="btn btn-ghost p-1.5"
            title="Refresh"
            type="button"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
      </div>
      <p className="text-xs text-content-secondary mb-4">
        Cost, latency, and cache health for AI calls run by your workspace. Read-only — does not move money.
      </p>

      {error && (
        <div className="flex items-start gap-2 text-sm bg-rose-50 border border-rose-200 text-rose-900 rounded p-3 mb-4">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {loading && !data ? (
          <>
            <SkeletonKpi />
            <SkeletonKpi />
            <SkeletonKpi />
            <SkeletonKpi />
          </>
        ) : (
          <>
            <UsageTile
              label="Total Spend (USD)"
              value={formatUsd(summary?.total_cost_usd)}
              foot={`${formatInt(summary?.total_calls)} calls · billed by providers`}
            />
            <UsageTile
              label="Cache Hit Rate"
              value={summary ? `${summary.cache_hit_rate_pct.toFixed(1)}%` : '—'}
              foot={`${formatInt(summary?.cache_hits)} of ${formatInt(summary?.total_calls)}`}
            />
            <UsageTile label="p95 Latency" value={formatMs(summary?.p95_latency_ms)} foot={`avg ${formatMs(summary?.avg_latency_ms)}`} />
            <UsageTile
              label="Errors / Recoveries"
              value={`${formatInt(summary?.errors)} / ${formatInt(summary?.recovered_via_retry)}`}
              foot={summary?.cost_capped > 0 ? `${formatInt(summary?.cost_capped)} cost-capped` : 'No cost-cap blocks'}
              tone={Number(summary?.errors || 0) > 0 ? 'warn' : 'neutral'}
            />
          </>
        )}
      </div>

      {/* Breakdown table */}
      <div className="border border-hairline rounded-lg overflow-hidden">
        <div className="bg-bg-secondary px-3 py-2 text-xs font-medium text-content-secondary uppercase tracking-wide">
          By Task × Provider
        </div>
        {loading && !data ? (
          <div className="p-3">
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : byTaskProvider.length === 0 ? (
          <div className="p-4 text-sm text-content-muted text-center">No AI calls in this window.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-content-muted">
              <tr className="border-b border-hairline">
                <th className="text-left px-3 py-2 font-medium">Task</th>
                <th className="text-left px-3 py-2 font-medium">Provider</th>
                <th className="text-right px-3 py-2 font-medium">Calls</th>
                <th className="text-right px-3 py-2 font-medium">Cost (USD)</th>
                <th className="text-right px-3 py-2 font-medium">Cache hits</th>
                <th className="text-right px-3 py-2 font-medium">Avg latency</th>
              </tr>
            </thead>
            <tbody>
              {byTaskProvider.map((row, i) => (
                <tr key={`${row.task}-${row.provider}-${row.model}-${i}`} className="border-b border-hairline-soft last:border-0">
                  <td className="px-3 py-2">
                    <div className="text-content-primary">{row.task}</div>
                  </td>
                  <td className="px-3 py-2 text-content-secondary">
                    {row.provider}
                    {row.model && <span className="text-content-muted text-xs ml-1">({row.model})</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInt(row.calls)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatUsd(row.cost_usd)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-content-muted">{formatInt(row.cache_hits)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-content-muted">{formatMs(row.avg_latency_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Per-doctype table — only shows when at least one call has populated
          the new doctype/language columns. Empty until extraction call sites
          start tagging language + doctype (PR #155). */}
      {byDoctype.length > 0 && (
        <div className="border border-hairline rounded-lg overflow-hidden mt-5">
          <div className="bg-bg-secondary px-3 py-2 text-xs font-medium text-content-secondary uppercase tracking-wide">
            By Doctype × Language
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-content-muted">
              <tr className="border-b border-hairline">
                <th className="text-left px-3 py-2 font-medium">Doctype</th>
                <th className="text-left px-3 py-2 font-medium">Language</th>
                <th className="text-right px-3 py-2 font-medium">Calls</th>
                <th className="text-right px-3 py-2 font-medium">Success</th>
                <th className="text-right px-3 py-2 font-medium">Errors</th>
                <th className="text-right px-3 py-2 font-medium">Cost (USD)</th>
              </tr>
            </thead>
            <tbody>
              {byDoctype.map((row, i) => (
                <tr key={`${row.doctype}-${row.language}-${i}`} className="border-b border-hairline-soft last:border-0">
                  <td className="px-3 py-2 text-content-primary">{row.doctype}</td>
                  <td className="px-3 py-2 text-content-secondary">{row.language}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInt(row.calls)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{formatInt(row.successes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-rose-700">{formatInt(row.errors)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatUsd(row.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UsageTile({ label, value, foot, tone = 'neutral' }) {
  const valueClass = tone === 'warn' ? 'text-amber-700' : 'text-content-primary';
  return (
    <div className="bg-bg-elevated border border-hairline rounded-lg p-3">
      <div className="text-eyebrow uppercase text-content-muted mb-1.5 font-medium">{label}</div>
      <div className={`font-display text-xl font-semibold tabular-nums tracking-tight ${valueClass}`}>
        {value}
      </div>
      {foot && <div className="text-[11px] text-content-muted mt-1">{foot}</div>}
    </div>
  );
}
