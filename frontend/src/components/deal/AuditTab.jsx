import { useState, useMemo } from 'react';
import {
  ShieldCheck,
  Clock,
  ChevronDown,
  ChevronUp,
  Check,
  AlertTriangle,
  RotateCcw,
  Hash,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import { clsx } from 'clsx';
import Badge from '../common/Badge';
import { Card, SectionHeader, SkeletonList, ErrorState } from '../../design-system';
import { useDealContext } from '../../hooks/useDealContext';
import {
  useDealEvents,
  useVerifyDealEvent,
  useReplayDealEvent,
} from '../../hooks/useDealEvents';

/**
 * Investor-grade audit trail for a deal.
 *
 * Reads from `deal_events` (HMAC-signed, append-only via RLS). Each row
 * is one persisted financial computation — calculate_and_save, scenario
 * recompute, sensitivity run, manual replay, graph snapshot, export
 * snapshot. The UI layers three things on top:
 *
 *   1. **Timeline.** Newest first, with actor + relative timestamp.
 *   2. **KPI delta.** When two consecutive events both have an
 *      `outputs_summary`, render the per-KPI delta (IRR, NPV, revenue,
 *      cost, gross margin, equity multiple). Numbers tabular, deltas
 *      colored by direction. This is the "what materially changed"
 *      view that the original handoff asked for.
 *   3. **Verify / Replay.** Per-row buttons that hit the cryptographic
 *      verifier (re-hash + HMAC) and the kernel replayer (re-run the
 *      stored inputs through the engine, diff against stored outputs).
 *
 * Per CLAUDE.md hard rules: every diff number is computed in
 * deterministic JS, never the LLM. The audit table itself is
 * append-only — this UI is purely read-side.
 */

const EVENT_TYPE_CONFIG = {
  calculate_and_save:  { label: 'Calculate & Save',    tone: 'success' },
  scenario_recompute:  { label: 'Scenario Recompute',  tone: 'info' },
  sensitivity_run:     { label: 'Sensitivity Run',     tone: 'info' },
  manual_replay:       { label: 'Manual Replay',       tone: 'neutral' },
  graph_snapshot:      { label: 'Graph Snapshot',      tone: 'neutral' },
  export_snapshot:     { label: 'Export Snapshot',     tone: 'neutral' },
};

const KPI_FIELDS = [
  { key: 'irr_pct',          label: 'IRR',           unit: '%',     decimals: 2 },
  { key: 'npv_cr',           label: 'NPV',           unit: 'INR Cr', decimals: 2 },
  { key: 'total_revenue_cr', label: 'Revenue',       unit: 'INR Cr', decimals: 2 },
  { key: 'total_cost_cr',    label: 'Total Cost',    unit: 'INR Cr', decimals: 2 },
  { key: 'gross_profit_cr',  label: 'Gross Profit',  unit: 'INR Cr', decimals: 2 },
  { key: 'gross_margin_pct', label: 'Gross Margin',  unit: '%',     decimals: 1 },
  { key: 'equity_multiple',  label: 'Equity Mult.',  unit: 'x',     decimals: 2 },
  { key: 'residual_land_value_cr', label: 'RLV',     unit: 'INR Cr', decimals: 2 },
];

const fmtNum = (v, decimals) => {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const fmtRelative = (iso) => {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  return `${mo}mo ago`;
};

const fmtAbsolute = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

// Pure: walk the events array and attach a `delta` to each row that
// references the prior event's outputs_summary. Events are newest-
// first so "prior" means index+1.
function attachDeltas(events) {
  const arr = Array.isArray(events) ? [...events] : [];
  return arr.map((ev, i) => {
    const prev = arr[i + 1] || null;
    if (!ev?.outputs_summary || !prev?.outputs_summary) {
      return { ...ev, delta: null };
    }
    const delta = {};
    for (const { key } of KPI_FIELDS) {
      const cur = ev.outputs_summary[key];
      const old = prev.outputs_summary[key];
      if (cur == null || old == null) continue;
      if (Number(cur) === Number(old)) continue;
      const deltaVal = Number(cur) - Number(old);
      const pct = Number(old) === 0 ? null : (deltaVal / Math.abs(Number(old))) * 100;
      delta[key] = { from: old, to: cur, delta: deltaVal, pct };
    }
    return {
      ...ev,
      delta: Object.keys(delta).length > 0 ? delta : null,
    };
  });
}

function VerificationPill({ verification }) {
  if (!verification) return null;
  const allOk =
    verification.checks?.inputsHashMatches &&
    verification.checks?.outputsHashMatches &&
    verification.checks?.signatureMatches;
  const tone = allOk ? 'success' : 'danger';
  return (
    <Badge tone={tone} className="text-[10px]">
      {allOk ? 'Verified' : 'Verification failed'}
    </Badge>
  );
}

function DeltaCell({ field, change }) {
  if (!change) {
    return <span className="text-content-muted text-xs">—</span>;
  }
  const up = change.delta > 0;
  const colorClass = up ? 'text-data-positive' : 'text-data-negative';
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={clsx('inline-flex items-center gap-0.5 text-xs tabular-nums', colorClass)}>
      <Icon size={10} />
      <span>
        {up ? '+' : ''}
        {fmtNum(change.delta, field.decimals)} {field.unit}
      </span>
      {change.pct != null && (
        <span className="text-content-muted ml-0.5">
          ({up ? '+' : ''}{change.pct.toFixed(1)}%)
        </span>
      )}
    </span>
  );
}

function EventRow({ event, dealId }) {
  const [expanded, setExpanded] = useState(false);
  const verifyMutation = useVerifyDealEvent();
  const replayMutation = useReplayDealEvent();
  const [verification, setVerification] = useState(null);

  const cfg = EVENT_TYPE_CONFIG[event.event_type] || { label: event.event_type, tone: 'neutral' };
  const actorName = event.actor?.name || event.actor?.email || (event.actor_id ? 'Unknown user' : 'System');

  const handleVerify = async () => {
    try {
      const result = await verifyMutation.mutateAsync({ dealId, eventId: event.id });
      setVerification(result.verification || result);
    } catch {
      // hook surfaces toast
    }
  };

  const handleReplay = () => {
    replayMutation.mutate({ dealId, eventId: event.id });
  };

  const hasDelta = event.delta && Object.keys(event.delta).length > 0;

  return (
    <div className="border-t border-hairline first:border-t-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:bg-bg-secondary"
        aria-expanded={expanded}
      >
        <div className="shrink-0 mt-0.5 w-7 h-7 rounded-md bg-accent-soft text-accent flex items-center justify-center">
          <ShieldCheck size={13} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={cfg.tone} className="text-[10px]">{cfg.label}</Badge>
            <span className="text-xs text-content-secondary">
              by <span className="text-content-primary font-medium">{actorName}</span>
            </span>
            <span className="text-xs text-content-muted tabular-nums" title={fmtAbsolute(event.created_at)}>
              {fmtRelative(event.created_at)}
            </span>
            {event.engine_version && (
              <span className="text-[10px] text-content-muted">
                engine {event.engine_version}
              </span>
            )}
            <VerificationPill verification={verification} />
          </div>

          {/* Inline delta summary — surfaces only the fields that changed. */}
          {hasDelta && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
              {KPI_FIELDS.map((field) =>
                event.delta?.[field.key] ? (
                  <span key={field.key} className="text-xs text-content-secondary">
                    <span className="text-content-muted">{field.label}: </span>
                    <DeltaCell field={field} change={event.delta[field.key]} />
                  </span>
                ) : null,
              )}
            </div>
          )}
          {!hasDelta && event.outputs_summary && (
            <div className="mt-1 text-xs text-content-muted">
              No KPI changes from prior event.
            </div>
          )}
        </div>
        {expanded ? (
          <ChevronUp size={14} className="shrink-0 text-content-muted mt-1" />
        ) : (
          <ChevronDown size={14} className="shrink-0 text-content-muted mt-1" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pl-14 space-y-3">
          {/* Full KPI snapshot for this event */}
          {event.outputs_summary && (
            <div>
              <div className="text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
                Outputs snapshot
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                {KPI_FIELDS.map((field) => {
                  const val = event.outputs_summary[field.key];
                  return (
                    <div key={field.key}>
                      <div className="text-[10px] text-content-muted">{field.label}</div>
                      <div className="text-sm font-medium text-content-primary tabular-nums">
                        {fmtNum(val, field.decimals)} {val != null && field.unit}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cryptographic provenance */}
          <div>
            <div className="text-eyebrow uppercase text-content-muted mb-1.5 font-medium">
              Cryptographic provenance
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono text-content-secondary">
              <div className="flex items-center gap-1.5">
                <Hash size={10} className="text-content-muted shrink-0" />
                <span className="text-content-muted">inputs:</span>
                <span className="truncate" title={event.inputs_hash}>{event.inputs_hash?.slice(0, 16)}…</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Hash size={10} className="text-content-muted shrink-0" />
                <span className="text-content-muted">outputs:</span>
                <span className="truncate" title={event.outputs_hash}>{event.outputs_hash?.slice(0, 16)}…</span>
              </div>
              <div className="flex items-center gap-1.5 sm:col-span-2">
                <Hash size={10} className="text-content-muted shrink-0" />
                <span className="text-content-muted">signature:</span>
                <span className="truncate" title={event.signature}>{event.signature?.slice(0, 24)}…</span>
              </div>
            </div>
          </div>

          {/* Action row */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleVerify}
              disabled={verifyMutation.isPending}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
              title="Re-hash the stored inputs/outputs and verify the HMAC signature"
            >
              {verifyMutation.isPending ? (
                <Clock size={11} />
              ) : verification?.checks?.signatureMatches ? (
                <Check size={11} />
              ) : verification?.checks ? (
                <AlertTriangle size={11} />
              ) : (
                <ShieldCheck size={11} />
              )}
              Verify
            </button>
            <button
              type="button"
              onClick={handleReplay}
              disabled={replayMutation.isPending}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
              title="Re-run the kernel against stored inputs and diff against stored outputs"
            >
              <RotateCcw size={11} />
              {replayMutation.isPending ? 'Replaying…' : 'Replay'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AuditTab() {
  const { dealId } = useDealContext();
  const { data, isLoading, isError, error, refetch } = useDealEvents(dealId);

  const events = useMemo(() => attachDeltas(data || []), [data]);

  if (isLoading) {
    return (
      <Card className="p-4">
        <SkeletonList rows={5} columns={3} />
      </Card>
    );
  }

  if (isError) {
    return (
      <ErrorState
        tone="danger"
        title="Couldn't load the audit trail"
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
    );
  }

  if (!events.length) {
    return (
      <Card className="p-8 text-center">
        <ShieldCheck size={28} className="mx-auto text-content-muted mb-3" />
        <p className="text-sm font-medium text-content-primary">No audit events yet</p>
        <p className="text-xs text-content-muted mt-1 max-w-md mx-auto leading-relaxed">
          Every persisted financial computation lands here — calculate &amp; save, scenario recompute,
          sensitivity run, replay, snapshot. Run the financial model on this deal to start the trail.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        size="sm"
        eyebrow="Append-only · HMAC-signed"
        title="Audit trail"
        sub={`${events.length} signed event${events.length === 1 ? '' : 's'}. Newest first. Click a row to inspect cryptographic provenance, verify the signature, or replay the kernel.`}
      />

      <Card className="p-0 overflow-hidden">
        {events.map((ev) => (
          <EventRow key={ev.id} event={ev} dealId={dealId} />
        ))}
      </Card>

      <p className="text-[11px] text-content-muted">
        Rows are immutable under application credentials (RLS grants SELECT + INSERT only). Signature
        binds (inputs hash · outputs hash · engine version) under the server-side
        <span className="font-mono"> DEAL_EVENTS_HMAC_KEY</span>.
      </p>
    </div>
  );
}

// Export the pure delta builder for tests so we can verify the math
// without mounting the React tree.
export { attachDeltas };
