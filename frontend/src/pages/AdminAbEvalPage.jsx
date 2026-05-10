import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  Beaker,
  CheckCircle2,
  ChevronRight,
  Clock,
  Layers,
  Play,
  RefreshCcw,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { clsx } from 'clsx';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { Card, SectionHeader, SkeletonList, ErrorState } from '../design-system';
import { adminAPI } from '../services/api';
import { toast } from '../components/common/Toast';

// Tier-2 #14 finish — admin surface for the A/B eval harness.
//
// Lists past runs persisted to `ab_eval_runs` (migration 20260526),
// lets the operator drill into per-fixture detail, and exposes a
// "Run new evaluation" button that triggers a fresh comparison via
// POST /api/admin/ab-eval/runs.
//
// Per CLAUDE.md:
//   • Bloomberg/Stripe register — flat tiles, hairline borders,
//     tabular numerals on every score.
//   • No fabrication — empty state explains the harness is
//     CLI-runnable too, doesn't pretend a run is "loading."
//   • All numbers come from the persisted run rows; the page
//     itself does no math.

const TASK_LABELS = {
  parcel_narrative: 'Parcel verdict narrative',
  export_insights:  'Export deck IC opinion',
};

const TASK_DESCRIPTIONS = {
  parcel_narrative: 'The 60–200 word verdict shown on every parcel detail card.',
  export_insights:  'The IC-style opinion paragraph on the deal export deck.',
};

const STATUS_META = {
  completed: { tone: 'success', label: 'Completed', icon: CheckCircle2 },
  running:   { tone: 'info',    label: 'Running',   icon: Activity },
  failed:    { tone: 'danger',  label: 'Failed',    icon: XCircle },
};

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
  if (n >= 1) return `$${n.toFixed(2)}`;
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

// Pick the winning candidate by avg_overall, returning { winnerId, deltaVsOthers }.
const pickWinner = (summaryByCandidate) => {
  if (!summaryByCandidate || typeof summaryByCandidate !== 'object') return null;
  const entries = Object.entries(summaryByCandidate)
    .filter(([_, s]) => s && Number.isFinite(Number(s.avg_overall)));
  if (entries.length < 2) return null;
  entries.sort(([, a], [, b]) => (b.avg_overall || 0) - (a.avg_overall || 0));
  const [winnerId, winnerSummary] = entries[0];
  const [, runnerUpSummary] = entries[1];
  return {
    winnerId,
    avgOverall: winnerSummary.avg_overall,
    delta: winnerSummary.avg_overall - runnerUpSummary.avg_overall,
  };
};

// ── Run trigger card ───────────────────────────────────────────────────────

function RunTriggerCard({ onRunComplete }) {
  const [task, setTask] = useState('parcel_narrative');
  const [limit, setLimit] = useState(10);
  const [candidatesText, setCandidatesText] = useState('claude:claude-sonnet-4-6, openai:gpt-5.4-mini');
  const [running, setRunning] = useState(false);

  const handleRun = useCallback(async () => {
    const candidates = candidatesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (candidates.length < 2) {
      toast.error('At least two candidates required');
      return;
    }
    const totalCalls = candidates.length * Number(limit);
    if (totalCalls > 50) {
      const ok = window.confirm(
        `This run will fire ${totalCalls} LLM calls (~$${(totalCalls * 0.012).toFixed(2)}). Continue?`,
      );
      if (!ok) return;
    }
    setRunning(true);
    try {
      const res = await adminAPI.runAbEval({ task, candidates, limit: Number(limit) });
      const status = res?.data?.data?.status;
      if (status === 'completed') toast.success('Evaluation complete');
      else if (status === 'failed') toast.error(`Failed: ${res?.data?.data?.error_message || 'unknown'}`);
      else toast.success('Evaluation persisted');
      onRunComplete?.();
    } catch (err) {
      toast.error(err?.response?.data?.message || err.message || 'Run failed');
    } finally {
      setRunning(false);
    }
  }, [task, limit, candidatesText, onRunComplete]);

  return (
    <Card className="p-4">
      <SectionHeader
        size="sm"
        eyebrow="A/B harness"
        title="Run new evaluation"
        sub="Spawns each candidate against the held-out fixture set, scores deterministically, and persists. Capped at 50 fixtures × 60s — larger runs go through the CLI."
      />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-content-muted font-medium mb-1">
            Task
          </label>
          <select
            value={task}
            onChange={(e) => setTask(e.target.value)}
            disabled={running}
            className="w-full text-sm border border-hairline rounded-md px-2 py-1.5 bg-bg-elevated text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <option value="parcel_narrative">Parcel verdict narrative</option>
            <option value="export_insights">Export deck IC opinion</option>
          </select>
          <p className="mt-1 text-[10px] text-content-muted">
            {TASK_DESCRIPTIONS[task]}
          </p>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-content-muted font-medium mb-1">
            Fixture limit
          </label>
          <input
            type="number"
            min={1}
            max={50}
            value={limit}
            disabled={running}
            onChange={(e) => setLimit(Math.max(1, Math.min(50, Number(e.target.value) || 10)))}
            className="w-full text-sm border border-hairline rounded-md px-2 py-1.5 bg-bg-elevated text-content-primary tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
          <p className="mt-1 text-[10px] text-content-muted">
            Max 50 — larger runs use the CLI.
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[11px] uppercase tracking-wider text-content-muted font-medium mb-1">
            Candidates (comma-separated <span className="font-mono">provider:model</span>)
          </label>
          <input
            type="text"
            value={candidatesText}
            disabled={running}
            onChange={(e) => setCandidatesText(e.target.value)}
            className="w-full text-sm border border-hairline rounded-md px-2 py-1.5 bg-bg-elevated text-content-primary font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            placeholder="claude:claude-sonnet-4-6, openai:gpt-5.4-mini"
          />
          <p className="mt-1 text-[10px] text-content-muted">
            Empty model = provider default (read from <span className="font-mono">backend/.env</span>).
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
        >
          {running ? <Activity size={11} className="animate-pulse" /> : <Play size={11} />}
          {running ? 'Running…' : 'Run evaluation'}
        </button>
      </div>
    </Card>
  );
}

// ── Run row ───────────────────────────────────────────────────────────────

function RunRow({ run, onSelect, selected }) {
  const meta = STATUS_META[run.status] || STATUS_META.completed;
  const Icon = meta.icon || CheckCircle2;
  const winner = pickWinner(run.summary_json);
  return (
    <button
      type="button"
      onClick={() => onSelect(run.id)}
      className={clsx(
        'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors border-t border-hairline first:border-t-0',
        selected ? 'bg-accent-soft' : 'hover:bg-bg-secondary',
      )}
    >
      <div className="shrink-0 mt-0.5 w-7 h-7 rounded-md bg-bg-secondary text-content-secondary flex items-center justify-center">
        <Icon size={13} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={meta.tone} className="text-[10px]">{meta.label}</Badge>
          <span className="text-xs text-content-secondary font-medium">
            {TASK_LABELS[run.task] || run.task}
          </span>
          <span className="text-[10px] text-content-muted tabular-nums">
            {run.fixture_count} fx · {run.total_calls} calls · ~{fmtUsd(run.estimated_cost_usd)}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-3 flex-wrap text-xs">
          {(run.candidate_ids || []).map((cid) => {
            const summary = run.summary_json?.[cid];
            const isWinner = winner && winner.winnerId === cid;
            return (
              <span
                key={cid}
                className={clsx(
                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px]',
                  isWinner ? 'bg-accent-soft text-accent' : 'bg-bg-secondary text-content-secondary',
                )}
              >
                {isWinner && <TrendingUp size={9} />}
                {cid}
                {summary && (
                  <span className="ml-1 tabular-nums">{fmtNum(summary.avg_overall, 0)}</span>
                )}
              </span>
            );
          })}
          {winner && (
            <span className="text-[10px] text-content-muted">
              winner +{fmtNum(winner.delta, 0)} pts
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-content-muted">
          <Clock size={9} />
          {fmtRelative(run.created_at)}
          {run.duration_ms && <span>· {fmtMs(run.duration_ms)}</span>}
          {run.triggered_by_name && <span>· by {run.triggered_by_name}</span>}
        </div>
        {run.status === 'failed' && run.error_message && (
          <div className="mt-1.5 inline-flex items-start gap-1.5 text-[10px] text-data-negative">
            <AlertTriangle size={9} className="mt-0.5 shrink-0" />
            <span className="line-clamp-2">{run.error_message}</span>
          </div>
        )}
      </div>
      <ChevronRight size={14} className="shrink-0 text-content-muted mt-1" />
    </button>
  );
}

// ── Run detail panel ─────────────────────────────────────────────────────

function RunDetailPanel({ runId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    adminAPI
      .getAbEvalRun(runId)
      .then((res) => {
        if (alive) {
          setData(res?.data?.data || null);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (alive) {
          setError(err?.response?.data?.message || err.message || 'Failed to load');
          setLoading(false);
        }
      });
    return () => { alive = false; };
  }, [runId]);

  if (loading) {
    return (
      <Card className="p-4">
        <SkeletonList rows={5} columns={3} />
      </Card>
    );
  }
  if (error || !data) {
    return (
      <ErrorState tone="danger" title="Couldn't load run">
        {error || 'Run not found.'}
      </ErrorState>
    );
  }

  // Group results by fixture so we can render side-by-side per row.
  const byFixture = {};
  for (const r of data.results || []) {
    if (!byFixture[r.fixture_id]) byFixture[r.fixture_id] = {};
    byFixture[r.fixture_id][r.candidate_id] = r;
  }
  const fixtureIds = Object.keys(byFixture).sort();
  const candidateIds = data.candidate_ids || [];

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-hairline flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-content-primary">
            {TASK_LABELS[data.task] || data.task}
          </div>
          <div className="text-[11px] text-content-muted mt-0.5">
            {data.fixture_count} fixtures · {data.total_calls} calls · {fmtRelative(data.created_at)}
            {data.duration_ms && <> · {fmtMs(data.duration_ms)}</>}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-content-muted hover:text-content-primary transition-colors focus-visible:outline-none focus-visible:underline"
        >
          Close
        </button>
      </div>

      {/* Per-candidate aggregate strip */}
      <div className="px-4 py-3 border-b border-hairline grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {candidateIds.map((cid) => {
          const summary = data.summary_json?.[cid] || {};
          return (
            <div key={cid} className="border border-hairline rounded-md p-3 bg-bg-elevated">
              <div className="text-[10px] uppercase tracking-wider text-content-muted font-mono truncate">
                {cid}
              </div>
              <div className="mt-1 grid grid-cols-3 gap-2 text-xs tabular-nums">
                <div>
                  <div className="text-[9px] text-content-muted">Overall</div>
                  <div className="font-semibold text-content-primary">{fmtNum(summary.avg_overall, 0)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-content-muted">Halluc</div>
                  <div className="font-semibold text-content-primary">{fmtNum(summary.avg_hallucination, 0)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-content-muted">Tone</div>
                  <div className="font-semibold text-content-primary">{fmtNum(summary.avg_tone, 0)}</div>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-content-muted">
                {summary.failed > 0 && <span className="text-data-negative">{summary.failed} errored · </span>}
                {summary.total_fabricated_numbers > 0 && (
                  <span>{summary.total_fabricated_numbers} fab #s · </span>
                )}
                {summary.total_tone_violations > 0 && (
                  <span>{summary.total_tone_violations} tone violations</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Per-fixture detail table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse min-w-[640px]">
          <thead>
            <tr className="border-b-2 border-hairline-strong bg-bg-secondary">
              <th className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary">Fixture</th>
              {candidateIds.map((cid) => (
                <th key={cid} colSpan={3} className="text-left py-2 px-3 font-semibold text-[11px] tracking-wide uppercase text-content-secondary border-l border-hairline font-mono">
                  {cid}
                </th>
              ))}
            </tr>
            <tr className="border-b border-hairline bg-bg-secondary">
              <th className="py-1 px-3" />
              {candidateIds.map((cid) => (
                <>
                  <th key={`${cid}-overall`} className="text-right py-1 px-2 text-[10px] text-content-muted border-l border-hairline">Overall</th>
                  <th key={`${cid}-halluc`} className="text-right py-1 px-2 text-[10px] text-content-muted">Halluc</th>
                  <th key={`${cid}-tone`} className="text-right py-1 px-2 text-[10px] text-content-muted">Tone</th>
                </>
              ))}
            </tr>
          </thead>
          <tbody>
            {fixtureIds.map((fid) => (
              <tr key={fid} className="border-b border-hairline">
                <td className="py-2 px-3 font-mono text-[11px] text-content-primary">{fid}</td>
                {candidateIds.map((cid) => {
                  const r = byFixture[fid]?.[cid];
                  if (!r) return (
                    <>
                      <td key={`${cid}-o`} className="text-right py-2 px-2 text-content-muted border-l border-hairline">—</td>
                      <td key={`${cid}-h`} className="text-right py-2 px-2 text-content-muted">—</td>
                      <td key={`${cid}-t`} className="text-right py-2 px-2 text-content-muted">—</td>
                    </>
                  );
                  if (r.error_message) {
                    return (
                      <td key={`${cid}-err`} colSpan={3} className="text-right py-2 px-2 text-[10px] text-data-negative border-l border-hairline truncate max-w-[200px]" title={r.error_message}>
                        {r.error_message.slice(0, 40)}…
                      </td>
                    );
                  }
                  return (
                    <>
                      <td key={`${cid}-o`} className="text-right py-2 px-2 tabular-nums text-content-primary border-l border-hairline">
                        {fmtNum(r.overall_score, 0)}
                      </td>
                      <td key={`${cid}-h`} className="text-right py-2 px-2 tabular-nums text-content-primary">
                        {fmtNum(r.hallucination_score, 0)}
                      </td>
                      <td key={`${cid}-t`} className="text-right py-2 px-2 tabular-nums text-content-primary">
                        {fmtNum(r.tone_score, 0)}
                      </td>
                    </>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function AdminAbEvalPage() {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState(null);

  const refresh = useCallback(() => {
    setError(null);
    adminAPI
      .listAbEvalRuns()
      .then((res) => setRuns(res?.data?.data || []))
      .catch((err) => setError(err?.response?.data?.message || err.message || 'Failed to load'));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const winnerCount = useMemo(() => {
    if (!runs) return null;
    const counts = {};
    for (const r of runs) {
      const w = pickWinner(r.summary_json);
      if (!w) continue;
      counts[w.winnerId] = (counts[w.winnerId] || 0) + 1;
    }
    return counts;
  }, [runs]);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Admin · A/B harness"
        title="Model A/B evaluations"
        sub="Compare Claude vs OpenAI (or any pair of provider:model specs) on the held-out fixture set. Scoring is deterministic JS — hallucinated numbers and tone violations counted, no LLM judge."
        right={
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <RefreshCcw size={11} />
            Refresh
          </button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <RunTriggerCard onRunComplete={refresh} />
        <Card className="p-4">
          <SectionHeader
            size="sm"
            eyebrow="Tally"
            title="Winners across persisted runs"
            sub="Sum of how often each candidate had the higher avg_overall."
          />
          {!runs && <SkeletonList rows={3} columns={1} />}
          {runs && Object.keys(winnerCount || {}).length === 0 && (
            <div className="mt-3 text-xs text-content-muted">
              No completed runs yet. Trigger one above or via the CLI:
              <span className="font-mono ml-1">node backend/scripts/run-ab-eval.js --confirm</span>.
            </div>
          )}
          {runs && Object.keys(winnerCount || {}).length > 0 && (
            <div className="mt-3 space-y-2">
              {Object.entries(winnerCount)
                .sort((a, b) => b[1] - a[1])
                .map(([cid, count]) => (
                  <div key={cid} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-content-primary truncate">{cid}</span>
                    <span className="tabular-nums text-content-secondary">{count} win{count === 1 ? '' : 's'}</span>
                  </div>
                ))}
            </div>
          )}
        </Card>
      </div>

      <SectionHeader
        size="sm"
        eyebrow="History"
        title={`Runs (${runs?.length || 0})`}
        sub="Click a row to inspect per-fixture scores."
      />

      {error && (
        <ErrorState tone="danger" title="Couldn't load runs">
          {error}
        </ErrorState>
      )}

      {!runs && !error && (
        <Card className="p-4">
          <SkeletonList rows={5} columns={3} />
        </Card>
      )}

      {runs && runs.length === 0 && !error && (
        <Card className="p-8 text-center">
          <Beaker size={28} className="mx-auto text-content-muted mb-3" />
          <p className="text-sm font-medium text-content-primary">No runs persisted yet</p>
          <p className="text-xs text-content-muted mt-1 max-w-md mx-auto leading-relaxed">
            Trigger one above, or run the harness from the CLI:{' '}
            <span className="font-mono">node backend/scripts/run-ab-eval.js</span>.
            CLI runs do not persist — only web-triggered runs land here.
          </p>
        </Card>
      )}

      {runs && runs.length > 0 && (
        <Card className="p-0 overflow-hidden">
          {runs.map((r) => (
            <RunRow
              key={r.id}
              run={r}
              selected={selectedRunId === r.id}
              onSelect={(id) => setSelectedRunId(id === selectedRunId ? null : id)}
            />
          ))}
        </Card>
      )}

      {selectedRunId && (
        <div className="space-y-2">
          <SectionHeader
            size="sm"
            eyebrow="Detail"
            title="Run breakdown"
            sub="Per-fixture scores side-by-side. Empty cells = candidate skipped this fixture (usually a runtime error)."
          />
          <RunDetailPanel runId={selectedRunId} onClose={() => setSelectedRunId(null)} />
        </div>
      )}

      <p className="text-[11px] text-content-muted">
        Per CLAUDE.md: scoring is deterministic JS only — hallucinated numbers + tone violations counted. The
        LLMs under test produce text; the JS scorer judges it. Daily AI cost cap still applies.
      </p>
    </div>
  );
}
