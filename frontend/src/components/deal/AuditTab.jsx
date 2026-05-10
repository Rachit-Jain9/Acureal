import { useState, useMemo, useEffect } from 'react';
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
  ArrowRight,
  Archive,
  ArchiveRestore,
  GitBranch,
  UserCog,
  Trash2,
  Edit3,
  Layers,
  Download,
  X,
  ExternalLink,
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
import { financialsAPI } from '../../services/api';
import { toast } from '../common/Toast';

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
  // Financial computations (HMAC-signed via deal_events)
  calculate_and_save:  { label: 'Calculate & Save',    tone: 'success' },
  scenario_recompute:  { label: 'Scenario Recompute',  tone: 'info' },
  sensitivity_run:     { label: 'Sensitivity Run',     tone: 'info' },
  manual_replay:       { label: 'Manual Replay',       tone: 'neutral' },
  graph_snapshot:      { label: 'Graph Snapshot',      tone: 'neutral' },
  export_snapshot:     { label: 'Export Snapshot',     tone: 'neutral' },
  // Mutation events (deal_audit_log)
  stage_changed:       { label: 'Stage changed',       tone: 'info',     icon: GitBranch },
  archived:            { label: 'Archived',            tone: 'warning',  icon: Archive },
  restored:            { label: 'Restored',            tone: 'success',  icon: ArchiveRestore },
  deleted:             { label: 'Deleted',             tone: 'danger',   icon: Trash2 },
  reassigned:          { label: 'Reassigned',          tone: 'info',     icon: UserCog },
  updated:             { label: 'Edited',              tone: 'neutral',  icon: Edit3 },
  bulk_archived:       { label: 'Archived (bulk)',     tone: 'warning',  icon: Layers },
  bulk_reassigned:     { label: 'Reassigned (bulk)',   tone: 'info',     icon: Layers },
  bulk_stage_changed:  { label: 'Stage changed (bulk)', tone: 'info',    icon: Layers },
  bulk_deleted:        { label: 'Deleted (bulk)',      tone: 'danger',   icon: Layers },
};

// Human-readable labels for the per-field diff renderer. Kept in sync
// with the UPDATED_FIELDS_TRACKED list on the backend.
const FIELD_LABELS = {
  stage: 'Stage',
  is_archived: 'Archived',
  archived_reason: 'Archive reason',
  assigned_to: 'Assignee',
  name: 'Name',
  deal_type: 'Deal type',
  priority: 'Priority',
  asset_class: 'Asset class',
  deal_structure: 'Deal structure',
  target_launch_date: 'Target launch',
  expected_close_date: 'Expected close',
  land_ask_price_cr: 'Land ask (₹ Cr)',
  negotiated_price_cr: 'Negotiated (₹ Cr)',
  jv_split_developer_pct: 'JV split — dev %',
  jv_split_landowner_pct: 'JV split — owner %',
  rera_number: 'RERA number',
  rera_expiry_date: 'RERA expiry',
  notes: 'Notes',
};

// Render a value for the diff pill. Strings stay as-is; nulls and
// blanks render as a muted em-dash. Booleans render Yes/No. Dates
// render their date portion only.
const fmtFieldValue = (raw) => {
  if (raw === null || raw === undefined || raw === '') return '—';
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  if (typeof raw === 'number') {
    return raw.toLocaleString('en-IN', { maximumFractionDigits: 4 });
  }
  // ISO date heuristic
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    try {
      return new Date(raw).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
    } catch {
      return raw;
    }
  }
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
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

// Pure: walk the events array and attach a `delta` to each financial
// row that references the prior financial event's outputs_summary.
// Events are newest-first so "prior" means the next financial row in
// the array. Mutation rows are skipped — they have their own
// before/after diff.
function attachDeltas(events) {
  const arr = Array.isArray(events) ? [...events] : [];
  return arr.map((ev, i) => {
    if (ev?.kind === 'mutation') return ev;
    if (!ev?.outputs_summary) return { ...ev, delta: null };
    // Find the next financial event with a summary; skip intervening
    // mutation rows so a stage transition between two computations
    // doesn't break the KPI delta.
    let prev = null;
    for (let j = i + 1; j < arr.length; j += 1) {
      if (arr[j]?.kind !== 'mutation' && arr[j]?.outputs_summary) {
        prev = arr[j];
        break;
      }
    }
    if (!prev) return { ...ev, delta: null };
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

/**
 * Render a per-field before → after pill set for a mutation event.
 *
 * Logic:
 *   - Walk the union of keys in `before` and `after`.
 *   - Skip keys whose values are equal (defensive; recordAudit shouldn't
 *     write these but cheap to check).
 *   - Render each one as "Label: from → to" with bold values, muted
 *     hyphens for missing data.
 *
 * For events that don't carry any tracked diff (e.g. bulk_deleted writes
 * empty before/after by design), surface metadata.bulk_id + bulk_size
 * instead so the row still tells a story.
 */
function MutationDiff({ before, after, metadata, eventType }) {
  const beforeObj = before || {};
  const afterObj = after || {};
  const keys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]));
  const changed = keys.filter((k) => {
    const b = beforeObj[k];
    const a = afterObj[k];
    return JSON.stringify(b) !== JSON.stringify(a);
  });

  if (changed.length === 0) {
    // Synthesize a useful row from metadata when the diff is empty.
    if (metadata?.bulk_id || metadata?.bulk_size) {
      return (
        <div className="text-xs text-content-secondary">
          Part of a <span className="font-medium text-content-primary">bulk batch</span>
          {metadata.bulk_size ? (
            <> of {metadata.bulk_size} deal{metadata.bulk_size === 1 ? '' : 's'}</>
          ) : null}
          .
        </div>
      );
    }
    if (eventType === 'deleted') {
      return (
        <div className="text-xs text-content-secondary">
          The deal record was permanently deleted.
        </div>
      );
    }
    return null;
  }

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {changed.map((key) => {
        const label = FIELD_LABELS[key] || key;
        return (
          <div key={key} className="text-xs text-content-secondary inline-flex items-center gap-1.5 flex-wrap">
            <span className="text-content-muted">{label}:</span>
            <span className="line-through text-content-muted tabular-nums">
              {fmtFieldValue(beforeObj[key])}
            </span>
            <ArrowRight size={10} className="text-content-muted" />
            <span className="text-content-primary font-medium tabular-nums">
              {fmtFieldValue(afterObj[key])}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MutationRow({ event, onPeekBatch }) {
  const cfg = EVENT_TYPE_CONFIG[event.event_type] || { label: event.event_type, tone: 'neutral' };
  const Icon = cfg.icon || ShieldCheck;
  const actorName = event.actor?.name || event.actor?.email || (event.actor_id ? 'Unknown user' : 'System');
  const bulkId = event.metadata?.bulk_id;

  return (
    <div className="border-t border-hairline first:border-t-0">
      <div className="w-full flex items-start gap-3 px-4 py-3 text-left">
        <div className="shrink-0 mt-0.5 w-7 h-7 rounded-md bg-bg-secondary text-content-secondary flex items-center justify-center">
          <Icon size={13} />
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
            {event.metadata?.notes && (
              <span className="text-[10px] text-content-muted italic truncate max-w-[24ch]" title={event.metadata.notes}>
                "{event.metadata.notes}"
              </span>
            )}
            {bulkId && onPeekBatch && (
              <button
                type="button"
                onClick={() => onPeekBatch(bulkId)}
                className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline focus-visible:outline-none focus-visible:underline"
                title="View every deal that moved in this same bulk action"
              >
                <ExternalLink size={9} />
                View batch
              </button>
            )}
          </div>
          <div className="mt-1.5">
            <MutationDiff
              before={event.before}
              after={event.after}
              metadata={event.metadata}
              eventType={event.event_type}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Modal that lists every deal touched by a single bulk operation.
 * Fetched on open. Closes via ESC, backdrop click, or X.
 */
function BulkBatchPeek({ bulkId, currentDealId, onClose }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  // Fetch on mount. Single-shot — modal is short-lived so no
  // re-fetch logic needed. The endpoint is org-scoped via RLS so
  // there's no admin-only gate to worry about.
  useEffect(() => {
    let alive = true;
    financialsAPI
      .bulkBatch(bulkId)
      .then((res) => {
        if (alive) setRows(res?.data?.data || []);
      })
      .catch((err) => {
        if (alive) {
          setError(err?.response?.data?.message || err.message || 'Failed to load batch');
        }
      });
    return () => { alive = false; };
  }, [bulkId]);

  // ESC to dismiss — keyboard parity with backdrop-click + close-button.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bulk batch details"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <Card className="relative w-full max-w-2xl p-0 overflow-hidden">
        <div className="flex items-start justify-between px-5 py-3 border-b border-hairline">
          <div>
            <div className="text-sm font-semibold text-content-primary">Bulk batch</div>
            <div className="text-[11px] text-content-muted font-mono mt-0.5" title={bulkId}>
              id {bulkId.slice(0, 8)}…
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <X size={14} className="text-content-secondary" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {rows === null && !error && (
            <div className="p-5">
              <SkeletonList rows={4} columns={2} />
            </div>
          )}
          {error && (
            <div className="p-5 text-sm text-data-negative">{error}</div>
          )}
          {rows && rows.length === 0 && !error && (
            <div className="p-5 text-sm text-content-muted">
              No batch records found. The batch may have been older than the audit
              log retention window.
            </div>
          )}
          {rows && rows.length > 0 && (
            <ul className="divide-y divide-hairline">
              {rows.map((r) => (
                <li
                  key={`${r.deal_id}-${r.created_at}`}
                  className={clsx(
                    'flex items-center gap-3 px-5 py-2.5 text-sm',
                    r.deal_id === currentDealId && 'bg-accent-soft/40',
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-content-primary font-medium truncate">
                      {r.deal_name || 'Unnamed deal'}
                      {r.deal_id === currentDealId && (
                        <span className="ml-2 text-[10px] text-accent">(this deal)</span>
                      )}
                    </div>
                    <div className="text-[11px] text-content-muted">
                      {r.event_type} · stage {r.deal_stage || '—'}
                      {r.deal_is_archived ? ' · archived' : ''}
                    </div>
                  </div>
                  <span className="text-[11px] text-content-muted tabular-nums">
                    {fmtAbsolute(r.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-hairline bg-bg-secondary text-[11px] text-content-muted">
          Bulk actions stamp every affected deal with a shared id so the trail
          can be reconstructed across deals.
        </div>
      </Card>
    </div>
  );
}

/**
 * Trigger a CSV download of the merged audit feed for the current
 * deal. Uses the standard blob → object-URL → click-anchor pattern
 * shared with the rest of the app's CSV exporters.
 */
async function downloadAuditCSV(dealId) {
  try {
    const res = await financialsAPI.exportAuditCSV(dealId);
    const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().slice(0, 10);
    a.download = `deal-audit-${dealId}-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    toast.success('Audit feed exported');
  } catch (err) {
    toast.error(err?.response?.data?.message || err.message || 'Audit export failed');
  }
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

// Filter chip definitions. 'all' shows the full merged feed; the
// other two narrow to one kind. Keeping this as a small enum lets us
// add 'risk' / 'docs' filters later without re-plumbing.
const FILTER_OPTIONS = [
  { id: 'all',        label: 'All' },
  { id: 'financial',  label: 'Financial' },
  { id: 'mutations',  label: 'Mutations' },
];

const matchesFilter = (event, filterId) => {
  if (filterId === 'all') return true;
  if (filterId === 'mutations') return event.kind === 'mutation';
  // 'financial' covers any non-mutation row (legacy events default
  // to undefined kind).
  return event.kind !== 'mutation';
};

export default function AuditTab() {
  const { dealId } = useDealContext();
  const { data, isLoading, isError, error, refetch } = useDealEvents(dealId);

  const [filter, setFilter] = useState('all');
  const [peekBulkId, setPeekBulkId] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Compute deltas FIRST on the full feed, then filter for display —
  // this way the financial KPI deltas are still computed against the
  // true previous financial event, not the previous one that
  // happened to pass the filter. Otherwise toggling to "Mutations"
  // and back could produce different deltas, which would be a lie.
  const events = useMemo(() => attachDeltas(data || []), [data]);
  const visibleEvents = useMemo(
    () => events.filter((e) => matchesFilter(e, filter)),
    [events, filter],
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadAuditCSV(dealId);
    } finally {
      setExporting(false);
    }
  };

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
          Every material change to this deal lands here — financial computations,
          stage transitions, archive / restore, reassignments. Run the financial model
          or move the deal across stages to start the trail.
        </p>
      </Card>
    );
  }

  const financialCount = events.filter((e) => e.kind !== 'mutation').length;
  const mutationCount = events.filter((e) => e.kind === 'mutation').length;
  const breakdown = [
    financialCount > 0
      ? `${financialCount} signed financial event${financialCount === 1 ? '' : 's'}`
      : null,
    mutationCount > 0
      ? `${mutationCount} mutation event${mutationCount === 1 ? '' : 's'}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <SectionHeader
          size="sm"
          eyebrow="Append-only audit trail"
          title="Audit trail"
          sub={`${breakdown}. Newest first. Click a financial row to inspect cryptographic provenance, verify the signature, or replay the kernel.`}
        />
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-hairline bg-bg-elevated text-content-primary hover:bg-bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 shrink-0"
          title="Download the merged audit feed as CSV (financial computations + mutation log)"
        >
          <Download size={11} />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-1.5" role="tablist" aria-label="Filter audit feed">
        {FILTER_OPTIONS.map((opt) => {
          const count = opt.id === 'all'
            ? events.length
            : opt.id === 'mutations'
              ? mutationCount
              : financialCount;
          const active = filter === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(opt.id)}
              className={clsx(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                active
                  ? 'bg-accent text-white border-accent'
                  : 'bg-bg-elevated text-content-secondary border-hairline hover:bg-bg-secondary',
              )}
            >
              {opt.label}
              <span
                className={clsx(
                  'tabular-nums',
                  active ? 'text-white/80' : 'text-content-muted',
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {visibleEvents.length === 0 ? (
        <Card className="p-6 text-center text-sm text-content-muted">
          No {filter === 'mutations' ? 'mutation' : 'financial'} events in this trail yet.
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          {visibleEvents.map((ev) =>
            ev.kind === 'mutation' ? (
              <MutationRow
                key={ev.id}
                event={ev}
                onPeekBatch={(id) => setPeekBulkId(id)}
              />
            ) : (
              <EventRow key={ev.id} event={ev} dealId={dealId} />
            ),
          )}
        </Card>
      )}

      <p className="text-[11px] text-content-muted">
        Rows are immutable under application credentials (RLS grants SELECT + INSERT only). Signature
        binds (inputs hash · outputs hash · engine version) under the server-side
        <span className="font-mono"> DEAL_EVENTS_HMAC_KEY</span>.
      </p>

      {peekBulkId && (
        <BulkBatchPeek
          bulkId={peekBulkId}
          currentDealId={dealId}
          onClose={() => setPeekBulkId(null)}
        />
      )}
    </div>
  );
}

// Export the pure delta builder for tests so we can verify the math
// without mounting the React tree.
export { attachDeltas };
