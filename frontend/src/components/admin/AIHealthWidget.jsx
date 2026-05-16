import { useEffect, useState, useCallback } from 'react';
import { Activity, CheckCircle2, AlertTriangle, XCircle, HelpCircle, RefreshCw, ChevronDown } from 'lucide-react';
import api from '../../services/api';
import { Skeleton } from '../../design-system';

/**
 * AI Health widget — live operational status for the 3 AI providers
 * (Gemini / Claude / OpenAI). Reads from /api/admin/ai-health (PR-NX22),
 * admin/analyst-gated, org-scoped via RLS.
 *
 * Editorial layout per FRONTEND_GUIDELINES.md:
 *  - Hairline borders, neutral greys, single accent on active state.
 *  - Tabular numbers for latency / success rate.
 *  - Status pill colors map to semantic data-* tokens.
 *  - Auto-refresh every 60s (matches FX cron cadence).
 *  - Expandable row reveals last-call detail + 7d aggregates.
 *
 * Why this exists: today the operator's only way to know "is the AI dark?"
 * is to download a deal export and check the briefing footer for
 * "templated fallback." With this widget they see 3 pills at a glance —
 * red pill says exactly which env var (e.g., ANTHROPIC_API_KEY) needs
 * attention, and clicking expands to show the actual error message
 * from the most recent failed call.
 */

const BAND_STYLE = {
  healthy:   { dot: 'bg-data-positive',  text: 'text-data-positive',  label: 'Healthy'   },
  degraded:  { dot: 'bg-data-highlight', text: 'text-data-highlight', label: 'Degraded'  },
  unhealthy: { dot: 'bg-data-negative',  text: 'text-data-negative',  label: 'Unhealthy' },
  unknown:   { dot: 'bg-content-tertiary', text: 'text-content-tertiary', label: 'Unknown' },
};

const BAND_ICON = {
  healthy:   CheckCircle2,
  degraded:  AlertTriangle,
  unhealthy: XCircle,
  unknown:   HelpCircle,
};

const formatRelativeTime = (iso) => {
  if (!iso) return '—';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

const formatLatency = (ms) => {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
};

const formatPct = (rate) => {
  if (rate == null) return '—';
  return `${(rate * 100).toFixed(1)}%`;
};

const ProviderRow = ({ provider, isExpanded, onToggle }) => {
  const band = provider.healthBand || 'unknown';
  const style = BAND_STYLE[band];
  const Icon = BAND_ICON[band];

  return (
    <div className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-paper-200 transition-colors"
      >
        {/* Status dot */}
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${style.dot} flex-shrink-0`} aria-hidden="true" />

        {/* Provider label */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-content-primary">{provider.label}</span>
            <Icon size={14} className={style.text} aria-hidden="true" />
            <span className={`text-xs font-medium ${style.text}`}>{style.label}</span>
          </div>
          <div className="text-xs text-content-secondary mt-0.5 tabular-nums">
            {provider.configured ? (
              <>
                Last call {formatRelativeTime(provider.lastCall?.occurredAt)}
                {provider.last7d?.calls > 0 && (
                  <span className="ml-2 text-content-tertiary">
                    · 7d: {provider.last7d.calls} calls · {formatPct(provider.last7d.successRate)} success
                  </span>
                )}
              </>
            ) : (
              <span className="text-content-tertiary">Not configured — set {provider.envVar} in Vercel</span>
            )}
          </div>
        </div>

        <ChevronDown
          size={16}
          className={`text-content-tertiary transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pt-1 bg-paper-200 text-xs">
          {!provider.configured ? (
            <p className="text-content-secondary">
              Provider is not configured. Set <code className="font-mono text-content-primary">{provider.envVar}</code> in your Vercel project's environment variables, then redeploy.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 tabular-nums">
              {/* Last call detail */}
              <div className="col-span-2 mt-1">
                <p className="text-content-tertiary uppercase tracking-wider text-[10px] font-semibold mb-1">Most recent call</p>
                {provider.lastCall ? (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <div className="text-content-secondary">Status:</div>
                    <div className={`font-medium ${provider.lastCall.status === 'error' ? 'text-data-negative' : 'text-content-primary'}`}>
                      {provider.lastCall.status}
                    </div>
                    <div className="text-content-secondary">Task:</div>
                    <div className="text-content-primary font-mono text-[11px]">{provider.lastCall.task || '—'}</div>
                    <div className="text-content-secondary">Latency:</div>
                    <div className="text-content-primary">{formatLatency(provider.lastCall.latencyMs)}</div>
                    {provider.lastCall.errorMessage && (
                      <>
                        <div className="text-content-secondary">Error:</div>
                        <div className="text-data-negative font-mono text-[11px] break-all">
                          {provider.lastCall.errorCode && <span className="mr-1">{provider.lastCall.errorCode}</span>}
                          {provider.lastCall.errorMessage}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-content-tertiary">No calls in the last 7 days.</p>
                )}
              </div>

              {/* 7d aggregates */}
              {provider.last7d?.calls > 0 && (
                <div className="col-span-2 mt-2">
                  <p className="text-content-tertiary uppercase tracking-wider text-[10px] font-semibold mb-1">Last 7 days</p>
                  <div className="grid grid-cols-4 gap-x-4">
                    <div>
                      <div className="text-[10px] text-content-tertiary uppercase tracking-wider">Calls</div>
                      <div className="text-sm font-semibold text-content-primary">{provider.last7d.calls.toLocaleString('en-IN')}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-content-tertiary uppercase tracking-wider">Success</div>
                      <div className="text-sm font-semibold text-content-primary">{formatPct(provider.last7d.successRate)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-content-tertiary uppercase tracking-wider">p50 Latency</div>
                      <div className="text-sm font-semibold text-content-primary">{formatLatency(provider.last7d.p50LatencyMs)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-content-tertiary uppercase tracking-wider">p95 Latency</div>
                      <div className="text-sm font-semibold text-content-primary">{formatLatency(provider.last7d.p95LatencyMs)}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default function AIHealthWidget() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null); // provider name string

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get('/admin/ai-health');
      setData(res.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load AI health');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Auto-refresh every 60s — quiet background poll, no UI churn
    const intervalId = setInterval(load, 60_000);
    return () => clearInterval(intervalId);
  }, [load]);

  const overallStyle = data?.overallBand ? BAND_STYLE[data.overallBand] : BAND_STYLE.unknown;

  return (
    <div className="bg-paper rounded-xl shadow-sm border border-hairline-strong overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-hairline flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity size={18} className="text-content-secondary" />
          <div>
            <h3 className="text-base font-semibold text-content-primary leading-tight">AI Provider Health</h3>
            <p className="text-xs text-content-secondary mt-0.5">
              Live status for Gemini, Claude, OpenAI · auto-refreshes every 60s
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className={`inline-block w-2 h-2 rounded-full ${overallStyle.dot}`} aria-hidden="true" />
              <span className={`font-medium ${overallStyle.text}`}>{overallStyle.label}</span>
            </div>
          )}
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded text-content-secondary hover:bg-paper-200 hover:text-content-primary transition-colors disabled:opacity-50"
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Body */}
      {loading && !data && (
        <div className="p-4 space-y-3">
          <Skeleton className="h-10 w-full rounded" />
          <Skeleton className="h-10 w-full rounded" />
          <Skeleton className="h-10 w-full rounded" />
        </div>
      )}

      {error && (
        <div className="px-4 py-3 text-sm text-data-negative bg-data-negative/5 border-b border-hairline">
          Failed to load: {error}
        </div>
      )}

      {data && (
        <div>
          {data.providers.map((p) => (
            <ProviderRow
              key={p.provider}
              provider={p}
              isExpanded={expanded === p.provider}
              onToggle={() => setExpanded(expanded === p.provider ? null : p.provider)}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      {data && (
        <div className="px-4 py-2 border-t border-hairline bg-paper-200 text-[11px] text-content-tertiary tabular-nums">
          Snapshot generated {formatRelativeTime(data.generatedAt)} · Click any row to see last-call details
        </div>
      )}
    </div>
  );
}
