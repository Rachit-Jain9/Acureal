import { useState, useMemo, useEffect } from 'react';
import EmptyState from '../common/EmptyState';
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
  X,
  ExternalLink,
  Sparkles,
  FileText,
} from 'lucide-react';
import { clsx } from 'clsx';
import Badge from '../common/Badge';
import { Card, SectionHeader, SkeletonList, ErrorState } from '../../design-system';
import { useDealContext } from '../../hooks/useDealContext';
import {
  useDealEvents,
  useVerifyDealEvent,
  useReplayDealEvent,
  useVerifyDealChain,
} from '../../hooks/useDealEvents';
import { financialsAPI } from '../../services/api';

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

// PR-NX31 (2026-05-17): document-ingestion auto-fill events use the DB
// event_type 'updated' (since they're just deals/properties UPDATEs at
// the DB level) but carry metadata.source='document_extraction'. The
// generic "Edited" label loses the actual story — "Rachit approved 7
// fields extracted from sale-deed.pdf via the auto-fill workflow."
// resolveEffectiveCfg returns a synthetic cfg for these rows so the
// timeline reads like a first-class document-ingestion event rather
// than a generic edit.
const DOC_EXTRACTION_CFG = {
  label: 'Auto-filled from documents',
  tone: 'info',
  icon: Sparkles,
};
const resolveEffectiveCfg = (event) => {
  if (event?.event_type === 'updated' && event?.metadata?.source === 'document_extraction') {
    return DOC_EXTRACTION_CFG;
  }
  return EVENT_TYPE_CONFIG[event?.event_type] || { label: event?.event_type, tone: 'neutral' };
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

// Group a chronological event list into date-bucketed sections so the
// audit timeline reads "Today / Yesterday / This week / 4 Apr 2026"
// instead of a dense flat list. Events are assumed newest-first (the
// useDealEvents hook already orders them that way); within each bucket
// we preserve that order.
//
// The bucket label is purely cosmetic — every event still carries its
// own relative + absolute timestamp on the row.
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};

const dateBucketLabel = (iso) => {
  if (!iso) return 'Unknown date';
  const t = startOfDay(iso);
  if (Number.isNaN(t)) return 'Unknown date';
  const today = startOfDay(new Date());
  const day = 86400000;
  if (t === today) return 'Today';
  if (t === today - day) return 'Yesterday';
  if (t > today - 7 * day) return 'Earlier this week';
  const d = new Date(iso);
  const now = new Date();
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
};

function groupEventsByDate(events) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const groups = [];
  let current = null;
  for (const ev of events) {
    const label = dateBucketLabel(ev.created_at);
    if (!current || current.label !== label) {
      current = { label, items: [] };
      groups.push(current);
    }
    current.items.push(ev);
  }
  return groups;
}

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

  // PR-NX31: prepend a document-ingestion attribution line when the
  // metadata flags it. Gives the operator immediate context — "this
  // wasn't a manual edit; this was an approve-from-extraction" — before
  // they read the per-field diff. Falls back gracefully when any of the
  // expected metadata pieces are missing (e.g., legacy rows pre-NX25).
  const isDocExtraction = metadata?.source === 'document_extraction';
  const appliedCount = Number(metadata?.applied_fields_count) || null;
  const targetTable = metadata?.target_table || null;
  const ontologyVersion = metadata?.ontology_version || null;
  const sourceExtractionCount = Array.isArray(metadata?.source_extraction_ids)
    ? metadata.source_extraction_ids.length
    : null;

  const docExtractionHeader = isDocExtraction ? (
    <div className="inline-flex flex-wrap items-center gap-1.5 text-[11px] text-content-secondary mb-1.5 px-2 py-1 rounded-md bg-accent-50/60 border border-accent-100">
      <FileText size={11} className="text-accent flex-shrink-0" />
      <span>
        <span className="font-medium text-content-primary">
          {appliedCount != null ? `${appliedCount} field${appliedCount === 1 ? '' : 's'}` : 'Fields'}
        </span>
        {' '}applied from{' '}
        {sourceExtractionCount != null && sourceExtractionCount > 0
          ? `${sourceExtractionCount} document extraction${sourceExtractionCount === 1 ? '' : 's'}`
          : 'document extraction'}
        {targetTable ? ` → ${targetTable === 'deals' ? 'deal record' : targetTable === 'properties' ? 'linked property' : targetTable}` : ''}
      </span>
      {ontologyVersion && (
        <span className="text-[9px] text-content-tertiary font-mono">v{ontologyVersion}</span>
      )}
    </div>
  ) : null;

  if (changed.length === 0) {
    // Synthesize a useful row from metadata when the diff is empty.
    if (metadata?.bulk_id || metadata?.bulk_size) {
      return (
        <div className="text-xs text-content-secondary">
          {docExtractionHeader}
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
    // PR-NX31: doc-extraction header is informative even with an empty
    // diff (e.g., the auto-fill went through but every approved value
    // was the same as the existing one — rare but possible).
    return docExtractionHeader;
  }

  return (
    <div>
      {docExtractionHeader}
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
    </div>
  );
}

function MutationRow({ event, onPeekBatch }) {
  // PR-NX31: pick the synthetic cfg for document_extraction-sourced
  // updates so the icon + label + tone reflect the ingestion provenance.
  const cfg = resolveEffectiveCfg(event);
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

// ── Computation Integrity ────────────────────────────────────────────────────
//
// One-click, whole-deal cryptographic verification — the "verify our numbers
// yourself" trust artifact. Re-hashes every signed computation, re-checks each
// HMAC signature, and re-runs the kernel on the latest one. The per-event
// results are REAL; the staggered reveal below is purely presentational (it
// snaps to the verdict under prefers-reduced-motion).

const REDUCE_MOTION =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

const fmtDateOnly = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
};

// A compact per-event reveal: one cell per signed computation, flipping to a
// green check (or red alert) as it's "checked". For dense chains (>28) it
// degrades to a slim progress bar so we never render a wall of dots.
function IntegrityTicks({ events, revealed }) {
  const total = events.length;
  if (total === 0) return null;
  if (total > 28) {
    const pct = Math.round((revealed / total) * 100);
    return (
      <div className="mt-3 h-1.5 rounded-full bg-bg-secondary overflow-hidden" aria-hidden="true">
        <div
          className="h-full bg-data-positive transition-[width] duration-100 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap gap-1.5" aria-hidden="true">
      {events.map((e, i) => {
        const shown = i < revealed;
        return (
          <span
            key={e.id}
            title={`${e.event_type} · ${e.ok ? 'verified' : 'failed'}`}
            className={clsx(
              'inline-flex items-center justify-center w-5 h-5 rounded-[5px] border transition-all duration-150 ease-out',
              !shown && 'bg-bg-secondary border-hairline scale-90 opacity-40',
              shown && e.ok && 'bg-pos-soft border-transparent text-data-positive scale-100 opacity-100',
              shown && !e.ok && 'bg-neg-soft border-transparent text-data-negative scale-100 opacity-100',
            )}
          >
            {shown ? (e.ok ? <Check size={11} /> : <AlertTriangle size={11} />) : null}
          </span>
        );
      })}
    </div>
  );
}

function IntegrityPanel({ dealId, signedCount }) {
  const verify = useVerifyDealChain();
  const [phase, setPhase] = useState('idle'); // idle | verifying | done
  const [report, setReport] = useState(null);
  const [revealed, setRevealed] = useState(0);

  // Drive the staggered reveal once the report lands. Reduced-motion (or an
  // empty chain) snaps straight to the verdict.
  useEffect(() => {
    if (phase !== 'verifying' || !report) return undefined;
    const total = report.events.length;
    if (REDUCE_MOTION || total === 0) {
      setRevealed(total);
      setPhase('done');
      return undefined;
    }
    const per = Math.max(28, Math.min(80, Math.floor(900 / total)));
    let i = 0;
    let timer = setTimeout(function tick() {
      i += 1;
      setRevealed(i);
      if (i >= total) {
        setPhase('done');
        return;
      }
      timer = setTimeout(tick, per);
    }, per);
    return () => clearTimeout(timer);
  }, [phase, report]);

  const run = async () => {
    setReport(null);
    setRevealed(0);
    setPhase('verifying');
    try {
      const r = await verify.mutateAsync(dealId);
      setReport(r); // the effect above runs the reveal cascade
    } catch {
      setPhase('idle'); // hook surfaces a toast
    }
  };

  const cascading = phase === 'verifying' && report && revealed < report.events.length;
  const busy = phase === 'verifying' && (!report || cascading);

  const allOk = report && report.all_verified && report.key_available;
  const anyFail = report && report.failed > 0;

  return (
    <Card elevated className="p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="shrink-0 w-9 h-9 rounded-lg bg-accent-soft text-accent flex items-center justify-center">
            <ShieldCheck size={18} />
          </div>
          <div className="min-w-0">
            <div className="font-display text-sm font-semibold text-content-primary">
              Computation integrity
            </div>
            <div className="text-xs text-content-secondary mt-0.5 max-w-[52ch]">
              Every number in this deal came from a signed, replayable computation.
              Verify it yourself — REDIP re-hashes each record, re-checks its signature,
              and re-runs the kernel. Nothing is taken on trust.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60 shrink-0"
        >
          <RotateCcw size={13} className={busy ? 'animate-spin' : ''} />
          {busy ? 'Verifying…' : phase === 'done' ? 'Re-verify' : 'Verify integrity'}
          {phase === 'idle' && signedCount > 0 && (
            <span className="text-white/80 tabular-nums">· {signedCount}</span>
          )}
        </button>
      </div>

      {/* Reveal cascade while verifying */}
      {phase === 'verifying' && report && (
        <div>
          <IntegrityTicks events={report.events} revealed={revealed} />
          <div className="mt-2 text-[11px] text-content-muted tabular-nums">
            Checking {Math.min(revealed, report.events.length)} of {report.events.length} signed computation
            {report.events.length === 1 ? '' : 's'}…
          </div>
        </div>
      )}

      {/* Verdict */}
      {phase === 'done' && report && (
        <div className={clsx(
          'mt-3 flex items-start gap-3 rounded-editorial border p-3',
          allOk && 'bg-pos-soft border-transparent',
          anyFail && 'bg-neg-soft border-transparent',
          !allOk && !anyFail && 'bg-bg-secondary border-hairline',
        )}>
          <div className="shrink-0 mt-0.5">
            {allOk ? (
              <ShieldCheck size={20} className="text-data-positive" />
            ) : anyFail ? (
              <AlertTriangle size={20} className="text-data-negative" />
            ) : (
              <ShieldCheck size={20} className="text-content-muted" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-content-primary">
              {report.total_events === 0
                ? 'No signed computations yet'
                : allOk
                  ? `${report.verified} computation${report.verified === 1 ? '' : 's'} verified`
                  : anyFail
                    ? `Integrity issue on ${report.failed} of ${report.total_events}`
                    : 'Signatures could not be checked'}
            </div>
            <div className="text-xs text-content-secondary mt-0.5">
              {report.total_events === 0
                ? 'Run the financial model to start a signed, verifiable computation trail.'
                : allOk
                  ? 'Every stored number is cryptographically authentic and untampered — re-hashed and signature-checked just now.'
                  : anyFail
                    ? 'One or more signed records no longer match their signature. Expand the timeline below to inspect the affected events.'
                    : 'The server signing key is unavailable, so HMAC signatures can’t be verified right now. Stored content hashes were still checked.'}
            </div>

            {report.total_events > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-content-muted">
                {report.engine_versions?.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span className="text-content-muted">engine</span>
                    <span className="font-mono text-content-secondary">{report.engine_versions.join(', ')}</span>
                  </span>
                )}
                {report.first_at && report.last_at && (
                  <span className="tabular-nums">
                    signed {fmtDateOnly(report.first_at)}
                    {report.total_events > 1 ? ` – ${fmtDateOnly(report.last_at)}` : ''}
                  </span>
                )}
              </div>
            )}

            {report.replay?.attempted && (
              <div className={clsx(
                'mt-2 inline-flex items-start gap-1.5 text-[11px]',
                report.replay.ok ? 'text-data-positive' : 'text-content-muted',
              )}>
                <RotateCcw size={11} className="mt-0.5 shrink-0" />
                <span>
                  {report.replay.ok
                    ? 'The latest computation re-runs to the same numbers under today’s engine.'
                    : 'The latest computation was signed under an earlier engine build — its numbers are authentic, but today’s engine yields a slightly different result.'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function AuditTab() {
  const { dealId } = useDealContext();
  const { data, isLoading, isError, error, refetch } = useDealEvents(dealId);

  const [filter, setFilter] = useState('all');
  const [peekBulkId, setPeekBulkId] = useState(null);

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
      <Card className="p-6">
        <EmptyState
          size="md"
          icon={ShieldCheck}
          title="No audit events yet"
          description="Every material change to this deal lands here — financial computations, stage transitions, archive / restore, reassignments. Run the financial model or move the deal across stages to start the trail."
        />
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
      <SectionHeader
        size="sm"
        eyebrow="Append-only audit trail"
        title="Audit trail"
        sub={`${breakdown}. Newest first. Click a financial row to inspect cryptographic provenance, verify the signature, or replay the kernel.`}
      />

      {/* One-click whole-deal integrity — the "verify our numbers yourself"
          artifact. Only shown when there's at least one signed computation. */}
      {financialCount > 0 && (
        <IntegrityPanel dealId={dealId} signedCount={financialCount} />
      )}

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
          {/* Date-grouped rendering: each bucket carries a sticky-style
              eyebrow header ("Today", "Yesterday", "12 May 2026"), then
              its events in chronological order. The flat list still
              works visually because each event row keeps its own
              relative + absolute timestamp; the bucket header just
              scaffolds the day-to-day rhythm. */}
          {groupEventsByDate(visibleEvents).map((group) => (
            <div key={group.label}>
              <div className="px-4 py-1.5 bg-bg-secondary border-b border-hairline-soft text-[10px] uppercase tracking-wider font-semibold text-content-muted">
                {group.label}
              </div>
              {group.items.map((ev) => (
                ev.kind === 'mutation' ? (
                  <MutationRow
                    key={ev.id}
                    event={ev}
                    onPeekBatch={(id) => setPeekBulkId(id)}
                  />
                ) : (
                  <EventRow key={ev.id} event={ev} dealId={dealId} />
                )
              ))}
            </div>
          ))}
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

// Export the pure helpers for tests so we can verify behaviour
// without mounting the React tree.
export { attachDeltas, groupEventsByDate, dateBucketLabel };
