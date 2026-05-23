import { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  XCircle,
  PlayCircle,
  Fingerprint,
  Clock,
} from 'lucide-react';
import { financialsAPI } from '../../services/api';
import useAuthStore from '../../store/authStore';

// ─── Copy / labels ───────────────────────────────────────────────────────────
//
// The timeline intentionally speaks in engineering terms — investors don't need
// to see this, but diligence partners, fund admins, and auditors do. Each row
// proves a calculation was produced by a specific engine version against a
// specific input tuple at a specific time, with an HMAC to prove the row
// itself hasn't been edited.

const EVENT_LABELS = {
  calculate_and_save: 'Model saved',
  scenario_recompute: 'Scenario recomputed',
  sensitivity_run: 'Sensitivity run',
  manual_replay: 'Manual replay',
  graph_snapshot: 'Graph snapshot',
  export_snapshot: 'Export snapshot',
};

const EVENT_COLORS = {
  calculate_and_save: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  scenario_recompute: 'bg-sky-50 text-sky-700 border-sky-200',
  sensitivity_run: 'bg-amber-50 text-amber-700 border-amber-200',
  manual_replay: 'bg-violet-50 text-violet-700 border-violet-200',
  graph_snapshot: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  export_snapshot: 'bg-bg-secondary text-content-secondary border-hairline-strong',
};

const REPLAY_ROLES = new Set(['admin', 'analyst']);

function formatEventTime(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

function shortHash(hex, len = 10) {
  if (!hex || typeof hex !== 'string') return '—';
  return `${hex.slice(0, len)}…`;
}

function CheckRow({ label, ok, detail }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      {ok ? (
        <CheckCircle2 size={14} className="text-emerald-600 mt-0.5 flex-shrink-0" />
      ) : (
        <XCircle size={14} className="text-red-600 mt-0.5 flex-shrink-0" />
      )}
      <div className="flex-1">
        <span className={ok ? 'text-emerald-700' : 'text-red-700'}>
          {label}
        </span>
        {detail && <div className="text-content-secondary font-mono mt-0.5">{detail}</div>}
      </div>
    </div>
  );
}

/**
 * Per-deal audit timeline — reads the signed event log that the backend
 * writes every time the kernel produces a persisted result.
 *
 * Each row proves three things:
 *   1. the inputs that were used           (inputs_hash)
 *   2. the outputs that were computed      (outputs_hash)
 *   3. that the row hasn't been tampered   (HMAC signature)
 *
 * The Verify action re-hashes the stored JSON and re-signs with the current
 * HMAC key, surfacing which of the three layers passes/fails. Replay
 * additionally re-runs the TS kernel against the stored inputs and compares
 * the new output hash to the original — this is the primitive behind the
 * claim "the number on the pitch deck is reproducible from first principles".
 *
 * Replay is intentionally gated to admin/analyst roles to match the backend
 * route's `requireRole` policy; non-privileged users see the button disabled
 * with a tooltip. Verify is visible to anyone who can see the deal.
 */
export default function AuditTimelineView({ dealId, defaultOpen = false }) {
  const { user } = useAuthStore();
  const role = String(user?.role || '').toLowerCase();
  const canReplay = REPLAY_ROLES.has(role);

  const [open, setOpen] = useState(defaultOpen);
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | ok | error
  const [errorMsg, setErrorMsg] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [resultById, setResultById] = useState({});
  const [busyId, setBusyId] = useState(null);

  const load = useMemo(
    () => () => {
      if (!dealId) return;
      setStatus('loading');
      financialsAPI
        .events(dealId, 50)
        .then((res) => {
          const rows = res?.data?.data || [];
          // The /financials/:id/events endpoint now returns a merged
          // feed of financial computations + mutation log rows. This
          // FinancialsPage timeline is the kernel-replay-and-verify
          // panel, so filter to the signed financial subset only.
          // The deal page's AuditTab renders the merged feed.
          const financialOnly = (Array.isArray(rows) ? rows : []).filter(
            (r) => r?.kind !== 'mutation',
          );
          setEvents(financialOnly);
          setStatus('ok');
        })
        .catch((err) => {
          setErrorMsg(err?.response?.data?.message || err.message || 'Failed to load events.');
          setStatus('error');
        });
    },
    [dealId],
  );

  useEffect(() => {
    if (!open || !dealId) return;
    load();
  }, [open, dealId, load]);

  const toggleRow = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const runVerify = (event) => {
    setBusyId(event.id);
    financialsAPI
      .verifyEvent(dealId, event.id)
      .then((res) => {
        const payload = res?.data?.data || null;
        setResultById((m) => ({ ...m, [event.id]: { ...m[event.id], verify: payload } }));
      })
      .catch((err) => {
        setResultById((m) => ({
          ...m,
          [event.id]: {
            ...m[event.id],
            verify: { error: err?.response?.data?.message || err.message || 'Verify failed.' },
          },
        }));
      })
      .finally(() => setBusyId(null));
  };

  const runReplay = (event) => {
    setBusyId(event.id);
    financialsAPI
      .replayEvent(dealId, event.id)
      .then((res) => {
        const payload = res?.data?.data || null;
        setResultById((m) => ({ ...m, [event.id]: { ...m[event.id], replay: payload } }));
      })
      .catch((err) => {
        setResultById((m) => ({
          ...m,
          [event.id]: {
            ...m[event.id],
            replay: { error: err?.response?.data?.message || err.message || 'Replay failed.' },
          },
        }));
      })
      .finally(() => setBusyId(null));
  };

  if (!dealId) return null;

  return (
    <div className="card-editorial">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-left group"
      >
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-content-secondary" />
          <h4 className="text-sm font-semibold text-content-secondary uppercase tracking-wider">
            Signed audit trail
          </h4>
          <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            HMAC-SHA256
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-content-muted">
          {status === 'loading' && <RefreshCw size={12} className="animate-spin" />}
          {status === 'ok' && (
            <span className="hidden sm:inline">
              {events.length} event{events.length === 1 ? '' : 's'}
            </span>
          )}
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-content-secondary max-w-2xl">
            Every calculation persisted by the kernel is logged to an append-only table with an
            HMAC signature over <code className="font-mono text-[11px]">inputs_hash | outputs_hash
            | engine_version</code>. Verify re-hashes the stored JSON; replay additionally re-runs
            the deterministic kernel against the stored inputs to prove the numbers are
            reproducible.
          </p>

          {status === 'error' && (
            <div className="flex items-start gap-2 p-2 rounded border border-amber-200 bg-amber-50 text-xs text-amber-800">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{errorMsg || 'Audit log unavailable.'}</span>
            </div>
          )}

          {status === 'ok' && events.length === 0 && (
            <div className="text-xs text-content-secondary italic py-3">
              No signed events yet. Run a calculation to produce the first audit row.
            </div>
          )}

          {status === 'ok' && events.length > 0 && (
            <div className="border rounded-lg bg-bg-elevated divide-y divide-hairline">
              {events.map((event) => {
                const label = EVENT_LABELS[event.event_type] || event.event_type;
                const badge = EVENT_COLORS[event.event_type] || EVENT_COLORS.export_snapshot;
                const isExpanded = expandedId === event.id;
                const result = resultById[event.id] || {};
                const busy = busyId === event.id;
                const verify = result.verify;
                const replay = result.replay;

                return (
                  <div key={event.id} className="text-sm">
                    <button
                      type="button"
                      onClick={() => toggleRow(event.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-bg-secondary text-left transition-colors"
                    >
                      <Clock size={14} className="text-content-muted flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-content-primary font-medium">{label}</span>
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${badge}`}
                          >
                            {event.event_type}
                          </span>
                          {event.engine_version && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-bg-secondary text-content-secondary border border-hairline-strong">
                              {event.engine_version}
                            </span>
                          )}
                          {event.asset_class && (
                            <span className="text-[10px] text-content-secondary">{event.asset_class}</span>
                          )}
                        </div>
                        <div className="text-xs text-content-secondary mt-0.5 flex items-center gap-3">
                          <span>{formatEventTime(event.created_at)}</span>
                          <span className="font-mono flex items-center gap-1">
                            <Fingerprint size={11} />
                            sig {shortHash(event.signature, 12)}
                          </span>
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronDown size={14} className="text-content-muted" />
                      ) : (
                        <ChevronRight size={14} className="text-content-muted" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 bg-bg-secondary/60 border-t border-hairline space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          <div>
                            <div className="text-content-muted uppercase tracking-wider text-[10px]">
                              Inputs hash
                            </div>
                            <div className="font-mono break-all text-content-secondary">
                              {event.inputs_hash}
                            </div>
                          </div>
                          <div>
                            <div className="text-content-muted uppercase tracking-wider text-[10px]">
                              Outputs hash
                            </div>
                            <div className="font-mono break-all text-content-secondary">
                              {event.outputs_hash}
                            </div>
                          </div>
                          <div className="sm:col-span-2">
                            <div className="text-content-muted uppercase tracking-wider text-[10px]">
                              Signature (HMAC-SHA256)
                            </div>
                            <div className="font-mono break-all text-content-secondary">
                              {event.signature}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => runVerify(event)}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-hairline-strong bg-bg-elevated text-xs font-medium text-content-secondary hover:bg-bg-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {busy && !verify ? (
                              <RefreshCw size={12} className="animate-spin" />
                            ) : (
                              <ShieldCheck size={12} />
                            )}
                            Verify signature
                          </button>

                          <button
                            type="button"
                            onClick={() => runReplay(event)}
                            disabled={busy || !canReplay}
                            title={
                              canReplay
                                ? 'Re-run the kernel against the stored inputs and compare the output hash.'
                                : 'Replay requires admin or analyst role.'
                            }
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-hairline-strong bg-bg-elevated text-xs font-medium text-content-secondary hover:bg-bg-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {busy && !replay ? (
                              <RefreshCw size={12} className="animate-spin" />
                            ) : (
                              <PlayCircle size={12} />
                            )}
                            Replay kernel
                          </button>
                        </div>

                        {verify && (
                          <div
                            className={`rounded border p-2.5 space-y-1.5 ${
                              verify.error
                                ? 'border-red-200 bg-red-50'
                                : verify.verification?.ok
                                  ? 'border-emerald-200 bg-emerald-50'
                                  : 'border-amber-200 bg-amber-50'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 text-xs font-semibold">
                              {verify.error ? (
                                <>
                                  <ShieldAlert size={12} className="text-red-600" />
                                  <span className="text-red-700">Verification error</span>
                                </>
                              ) : verify.verification?.ok ? (
                                <>
                                  <ShieldCheck size={12} className="text-emerald-600" />
                                  <span className="text-emerald-700">Signature valid</span>
                                </>
                              ) : (
                                <>
                                  <ShieldAlert size={12} className="text-amber-600" />
                                  <span className="text-amber-700">Signature mismatch</span>
                                </>
                              )}
                            </div>
                            {verify.error ? (
                              <div className="text-xs text-red-700">{verify.error}</div>
                            ) : verify.verification?.checks ? (
                              <div className="space-y-1">
                                <CheckRow
                                  label="Inputs JSON hashes correctly"
                                  ok={verify.verification.checks.inputsHashMatches}
                                />
                                <CheckRow
                                  label="Outputs JSON hashes correctly"
                                  ok={verify.verification.checks.outputsHashMatches}
                                />
                                <CheckRow
                                  label="HMAC signature matches current key"
                                  ok={verify.verification.checks.signatureMatches}
                                />
                              </div>
                            ) : null}
                          </div>
                        )}

                        {replay && (
                          <div
                            className={`rounded border p-2.5 space-y-1.5 ${
                              replay.error
                                ? 'border-red-200 bg-red-50'
                                : replay.replay?.ok
                                  ? 'border-emerald-200 bg-emerald-50'
                                  : 'border-amber-200 bg-amber-50'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 text-xs font-semibold">
                              {replay.error ? (
                                <>
                                  <ShieldAlert size={12} className="text-red-600" />
                                  <span className="text-red-700">Replay error</span>
                                </>
                              ) : replay.replay?.ok ? (
                                <>
                                  <CheckCircle2 size={12} className="text-emerald-600" />
                                  <span className="text-emerald-700">
                                    Kernel reproduced the stored outputs exactly
                                  </span>
                                </>
                              ) : (
                                <>
                                  <XCircle size={12} className="text-amber-600" />
                                  <span className="text-amber-700">
                                    Replay produced a different output hash
                                  </span>
                                </>
                              )}
                            </div>
                            {replay.error ? (
                              <div className="text-xs text-red-700">{replay.error}</div>
                            ) : replay.replay ? (
                              <div className="text-xs space-y-1">
                                {replay.replay.reason === 'kernel_error' ? (
                                  <div className="text-red-700 font-mono">
                                    {replay.replay.message}
                                  </div>
                                ) : (
                                  <>
                                    <div className="flex gap-2">
                                      <span className="text-content-secondary w-28">Original hash</span>
                                      <span className="font-mono text-content-secondary break-all">
                                        {replay.replay.originalOutputsHash}
                                      </span>
                                    </div>
                                    <div className="flex gap-2">
                                      <span className="text-content-secondary w-28">Replay hash</span>
                                      <span className="font-mono text-content-secondary break-all">
                                        {replay.replay.replayOutputsHash}
                                      </span>
                                    </div>
                                  </>
                                )}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
