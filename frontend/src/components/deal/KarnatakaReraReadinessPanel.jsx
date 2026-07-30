import { useState, useEffect, useMemo } from 'react';
import {
  FileCheck, ChevronRight, ChevronDown, CheckCircle2, Circle,
  AlertCircle, AlertTriangle, Info, Sparkles, Download, Loader2,
  ExternalLink, HelpCircle, SlidersHorizontal, MinusCircle, ShieldAlert, ScanSearch, CalendarClock,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useDealContext, useDealReraReadiness } from '../../hooks/useDealContext';
import { dealsAPI, exportsAPI } from '../../services/api';
import { toast } from '../common/Toast';
import { useCountUp } from '../../hooks/useCountUp';
import { formatDate } from '../../utils/format';

/**
 * KarnatakaReraReadinessPanel — the "Compliance Cockpit" (Phase 4).
 *
 * A deterministic, evidence-backed K-RERA readiness surface for residential /
 * plotted / villas / mixed-use / redevelopment deals (and any commercial deal
 * whose unit-sale crosses the statutory thresholds). Surfaces:
 *
 *   - Applicability verdict (in scope / likely exempt / uncertain) with a
 *     transparent "why" rule-trace — never a legal compliance verdict.
 *   - A count-up readiness meter + tier (early / partial / mostly / filing-ready
 *     / blocked) where fatal blockers cap the score.
 *   - A pre-registration → registration → post-registration milestone band.
 *   - Fatal blockers, then the 7+ requirement buckets with per-item evidence
 *     status + an official-source link, then the gap list.
 *   - An estimated registration fee, clearly labelled as an estimate.
 *   - An inline "project facts" form (unit/plot count, sale-intent, completion
 *     date) feeding the applicability engine.
 *   - A quiet marketing caution when registration appears required and none is
 *     on file.
 *
 * **CLAUDE.md hard rule respected**: an organisation aid for the operator's CA /
 * architect / lawyer, never a statutory verdict. All numbers are deterministic.
 */

const STATUS_TONE = {
  verified:  { icon: CheckCircle2, tone: 'text-data-positive', bg: 'bg-pos-soft text-data-positive border-hairline' },
  uploaded:  { icon: CheckCircle2, tone: 'text-accent',   bg: 'bg-accent-soft text-accent border-hairline' },
  available: { icon: Circle,       tone: 'text-premium', bg: 'bg-premium-soft text-premium border-hairline' },
  pending:   { icon: Circle,       tone: 'text-premium', bg: 'bg-premium-soft text-premium border-hairline' },
  missing:   { icon: AlertCircle,  tone: 'text-data-negative',   bg: 'bg-neg-soft text-data-negative border-hairline' },
};

const STATUS_LABEL = {
  verified: 'Verified', uploaded: 'Uploaded', available: 'Available', pending: 'Pending', missing: 'Missing',
};

const SEVERITY_TONE = {
  critical: 'bg-neg-soft text-data-negative border-hairline',
  high:     'bg-premium-soft text-premium border-hairline',
  medium:   'bg-premium-soft text-premium border-hairline',
  low:      'bg-bg-secondary text-content-secondary border-hairline',
};

const READINESS_TIER_TONE = {
  filing_ready: 'bg-pos-soft text-data-positive border-hairline',
  mostly_ready: 'bg-accent-soft text-accent border-hairline',
  partial:      'bg-premium-soft text-premium border-hairline',
  early:        'bg-bg-secondary text-content-secondary border-hairline',
  blocked:      'bg-neg-soft text-data-negative border-hairline',
};

const READINESS_TIER_LABEL = {
  filing_ready: 'Filing-ready', mostly_ready: 'Mostly ready', partial: 'Partial', early: 'Early', blocked: 'Blocked',
};

const METER_BAR = {
  filing_ready: 'bg-data-positive', mostly_ready: 'bg-accent', partial: 'bg-premium', early: 'bg-content-muted', blocked: 'bg-data-negative',
};

const BUCKET_STATUS_BAR = { complete: 'bg-data-positive', partial: 'bg-premium', missing: 'bg-content-muted' };

const APPLICABILITY_CFG = {
  in_scope:      { label: 'In scope', cls: 'bg-accent-soft text-accent border-hairline', icon: AlertCircle },
  uncertain:     { label: 'Uncertain', cls: 'bg-premium-soft text-premium border-hairline', icon: HelpCircle },
  likely_exempt: { label: 'Likely exempt', cls: 'bg-bg-secondary text-content-secondary border-hairline', icon: Circle },
  na:            { label: 'Not applicable', cls: 'bg-bg-secondary text-content-secondary border-hairline', icon: Circle },
};

const MILESTONE_STOPS = [
  { key: 'pre_registration', label: 'Pre-registration' },
  { key: 'registration', label: 'Registration' },
  { key: 'post_registration', label: 'Post-registration' },
];

const formatFeeInr = (n) => {
  if (!Number.isFinite(Number(n))) return null;
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n));
  } catch {
    return `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;
  }
};

function StatusPill({ status }) {
  const t = STATUS_TONE[status] || STATUS_TONE.missing;
  const Icon = t.icon;
  return (
    <span className={clsx('inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border transition-colors duration-150 ease-out', t.bg)}>
      <Icon size={10} />
      {STATUS_LABEL[status] || status}
    </span>
  );
}

// ── Readiness meter — count-up score + tier-coloured progress bar ───────────
function ReadinessMeter({ pct, tier }) {
  const animated = useCountUp(Number.isFinite(pct) ? pct : 0);
  const shown = Math.round(animated);
  const bar = METER_BAR[tier] || METER_BAR.early;
  return (
    <div className="min-w-[150px]">
      <div className="flex items-baseline justify-end gap-1">
        <span className="text-3xl font-semibold text-content-primary tabular-nums leading-none">{shown}</span>
        <span className="text-content-muted text-sm">/100</span>
      </div>
      <div className="mt-2 w-full h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all duration-700 ease-out', bar)} style={{ width: `${Math.max(0, Math.min(100, pct || 0))}%` }} />
      </div>
    </div>
  );
}

// ── Applicability chip + transparent "why" rule trace ───────────────────────
function ApplicabilityChip({ applicability }) {
  const [open, setOpen] = useState(false);
  if (!applicability || !applicability.status) return null;
  const cfg = APPLICABILITY_CFG[applicability.status] || APPLICABILITY_CFG.uncertain;
  const Icon = cfg.icon;
  const trace = Array.isArray(applicability.rule_trace) ? applicability.rule_trace : [];
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={clsx('inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded border transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40', cfg.cls)}
        title="Why? — the deterministic applicability rule trace"
      >
        <Icon size={12} />
        <span>{cfg.label}</span>
        {trace.length > 0 && <span className="opacity-70">· why?</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-hairline bg-bg-elevated shadow-lg p-2.5">
          {applicability.reason && (
            <p className="text-[11px] text-content-secondary leading-snug mb-2">{applicability.reason}</p>
          )}
          <ul className="space-y-1">
            {trace.map((t, i) => {
              const res = t.result;
              const RIcon = res === true ? CheckCircle2 : res === false ? MinusCircle : Circle;
              const rtone = res === true ? 'text-data-positive' : res === false ? 'text-content-muted' : 'text-premium';
              return (
                <li key={i} className="flex items-start gap-1.5">
                  <RIcon size={12} className={clsx('mt-0.5 shrink-0', rtone)} />
                  <span className="text-[11px] text-content-secondary leading-snug">{t.text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Milestone band — pre-registration → registration → post-registration ────
function MilestoneBand({ milestone }) {
  if (!milestone || !milestone.phase) return null;
  const activeIdx = Math.max(0, MILESTONE_STOPS.findIndex((s) => s.key === milestone.phase));
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5">
        {MILESTONE_STOPS.map((stop, i) => {
          const reached = i <= activeIdx;
          const isActive = i === activeIdx;
          return (
            <div key={stop.key} className="flex items-center gap-1.5 flex-1 min-w-0">
              <div className="flex flex-col items-start min-w-0 flex-1">
                <div className={clsx('w-full h-1 rounded-full transition-all duration-500 ease-out', reached ? 'bg-accent' : 'bg-bg-tertiary')} />
                <span className={clsx('mt-1 text-[10px] truncate w-full', isActive ? 'text-content-primary font-medium' : 'text-content-muted')}>
                  {stop.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {milestone.derived_from && (
        <p className="text-[10px] text-content-muted mt-0.5 italic leading-snug">{milestone.derived_from}</p>
      )}
    </div>
  );
}

// ── Fatal blockers callout ──────────────────────────────────────────────────
function BlockersCallout({ blockers }) {
  if (!blockers || blockers.length === 0) return null;
  return (
    <div className="mb-3 rounded-md border border-hairline bg-neg-soft px-3 py-2">
      <div className="flex items-center gap-1.5 mb-1">
        <ShieldAlert size={13} className="text-data-negative shrink-0" />
        <span className="text-xs uppercase tracking-wider font-semibold text-data-negative">
          {blockers.length} fatal blocker{blockers.length > 1 ? 's' : ''} — filing premature until resolved
        </span>
      </div>
      <ul className="space-y-0.5 pl-5 list-disc">
        {blockers.map((b) => (
          <li key={b.item_id} className="text-[11px] text-data-negative/90 leading-snug">{b.item_label}</li>
        ))}
      </ul>
    </div>
  );
}

// ── Fee estimate line ───────────────────────────────────────────────────────
function FeeLine({ fee }) {
  if (!fee) return null;
  const amount = formatFeeInr(fee.fee_inr);
  return (
    <div className="mb-3 rounded-md border border-hairline bg-bg-secondary/40 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wider text-content-muted">Est. registration fee</span>
        {amount ? (
          <span className="text-sm font-semibold text-content-primary tabular-nums">{amount}{fee.is_overridden ? ' (override)' : ''}</span>
        ) : (
          <span className="text-[11px] text-content-secondary">{fee.reason || 'Unavailable'}</span>
        )}
      </div>
      <p className="text-[10px] text-content-muted mt-0.5 leading-snug">
        {fee.category_label ? `${fee.category_label} · ` : ''}
        Estimate only — verify on the{' '}
        <a href={fee.source_url || 'https://rera.karnataka.gov.in/'} target="_blank" rel="noopener noreferrer"
           className="underline hover:text-content-secondary inline-flex items-center gap-0.5">
          K-RERA portal<ExternalLink size={9} />
        </a>
        {fee.last_verified ? ` · rates checked ${fee.last_verified}` : ''}
      </p>
    </div>
  );
}

// ── Quiet marketing caution (operator chose: subtle, in-panel only) ─────────
function MarketingNote({ applicability }) {
  if (!applicability) return null;
  const sellableStatus = applicability.status === 'in_scope' || applicability.status === 'uncertain';
  const registered = applicability.signals && applicability.signals.already_registered;
  if (!sellableStatus || registered) return null;
  return (
    <div className="mt-3 flex items-start gap-1.5 rounded-md border border-hairline bg-premium-soft px-2.5 py-1.5">
      <AlertTriangle size={12} className="text-premium mt-0.5 shrink-0" />
      <p className="text-[11px] text-premium leading-snug">
        K-RERA registration appears required and none is on file. Confirm with your counsel before any
        advertising, booking or sale — RERA bars marketing of a covered project before registration.
      </p>
    </div>
  );
}

// ── Inline "project facts" form — feeds the applicability engine ────────────
function ProjectFactsForm({ dealId, currentInputs, onSaved }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [units, setUnits] = useState('');
  const [saleIntent, setSaleIntent] = useState('unsure'); // yes | no | unsure
  const [completion, setCompletion] = useState('');

  useEffect(() => {
    const c = currentInputs || {};
    setUnits(c.unit_or_plot_count != null ? String(c.unit_or_plot_count) : '');
    setSaleIntent(c.sale_intent === true ? 'yes' : c.sale_intent === false ? 'no' : 'unsure');
    setCompletion(typeof c.completion_date === 'string' ? c.completion_date : '');
  }, [currentInputs, open]);

  const save = async () => {
    if (saving || !dealId) return;
    setSaving(true);
    try {
      const reraInputs = {};
      if (units.trim() !== '' && Number.isFinite(Number(units))) reraInputs.unit_or_plot_count = Math.round(Number(units));
      if (saleIntent === 'yes') reraInputs.sale_intent = true;
      else if (saleIntent === 'no') reraInputs.sale_intent = false;
      if (completion) reraInputs.completion_date = completion;
      await dealsAPI.update(dealId, { reraInputs });
      toast.success('Project facts saved');
      setOpen(false);
      if (onSaved) await onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not save project facts');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-3 border border-hairline rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left px-3 py-2 bg-bg-secondary/50 hover:bg-bg-secondary flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 transition-colors duration-150 ease-out"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <SlidersHorizontal size={12} className="text-content-muted" />
        <span className="text-xs uppercase tracking-wider font-medium text-content-secondary">Set project facts</span>
        <span className="text-[10px] text-content-muted ml-auto">drives the applicability check</span>
      </button>
      {open && (
        <div className="p-3 space-y-3 bg-bg-elevated">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] text-content-secondary">Units / plots (all phases)</span>
              <input
                type="number" min="0" inputMode="numeric" value={units}
                onChange={(e) => setUnits(e.target.value)}
                placeholder="e.g. 48"
                className="mt-1 w-full rounded border border-hairline bg-bg-secondary px-2 py-1 text-sm text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-content-secondary">Target completion date</span>
              <input
                type="date" value={completion}
                onChange={(e) => setCompletion(e.target.value)}
                className="mt-1 w-full rounded border border-hairline bg-bg-secondary px-2 py-1 text-sm text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              />
            </label>
          </div>
          <div>
            <span className="text-[11px] text-content-secondary">Are units / plots being sold, booked or marketed?</span>
            <div className="mt-1 inline-flex rounded border border-hairline overflow-hidden">
              {[['yes', 'Selling'], ['no', 'Not selling'], ['unsure', 'Not sure']].map(([val, label]) => (
                <button
                  key={val} type="button" onClick={() => setSaleIntent(val)}
                  className={clsx(
                    'px-2.5 py-1 text-xs transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    saleIntent === val ? 'bg-accent text-content-inverse' : 'bg-bg-secondary text-content-secondary hover:bg-bg-tertiary',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button" onClick={save} disabled={saving}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded bg-accent text-content-inverse hover:bg-accent-hover disabled:opacity-60 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              {saving ? 'Saving…' : 'Save facts'}
            </button>
            <span className="text-[10px] text-content-muted">Used only to assess whether registration is required.</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemRow({ item }) {
  const ev = item.evidence || {};
  const src = item.official_source;
  return (
    <li className="py-2 px-3 border-b border-hairline last:border-0">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 shrink-0">
          {(() => {
            const t = STATUS_TONE[ev.status] || STATUS_TONE.missing;
            const Icon = t.icon;
            return <Icon size={14} className={t.tone} />;
          })()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <span className="text-sm font-medium text-content-primary flex items-center gap-1">
              {item.label}
              {item.is_blocker && (
                <span className="text-[9px] uppercase tracking-wide text-data-negative border border-hairline bg-neg-soft rounded px-1" title="Fatal blocker — caps readiness until resolved">blocker</span>
              )}
            </span>
            <StatusPill status={ev.status} />
          </div>
          <p className="text-xs text-content-secondary mt-0.5 leading-snug">{item.description}</p>
          {ev.evidence_label && (
            <p className="text-[11px] text-content-muted mt-1 italic">
              Source: {ev.evidence_label}{ev.reference_number && ` · #${ev.reference_number}`}
            </p>
          )}
          {item.recommended_action && (
            <p className="text-[11px] text-content-secondary mt-1 leading-snug">
              <span className="font-medium">Next step:</span> {item.recommended_action}
            </p>
          )}
          {src && src.url && (
            <a href={src.url} target="_blank" rel="noopener noreferrer"
               className="text-[10px] text-content-muted hover:text-content-secondary mt-1 inline-flex items-center gap-0.5 underline">
              {src.label || 'Official source'}<ExternalLink size={9} />
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function BucketCard({ bucket }) {
  const [open, setOpen] = useState(false);
  const pct = bucket.completeness_pct ?? 0;
  const barColor = BUCKET_STATUS_BAR[bucket.bucket_status] || BUCKET_STATUS_BAR.missing;
  return (
    <div className="border-b border-hairline last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-center gap-1.5 min-w-0">
            {open ? <ChevronDown size={12} className="text-content-muted shrink-0" /> : <ChevronRight size={12} className="text-content-muted shrink-0" />}
            <span className="text-sm font-medium text-content-primary truncate">{bucket.label}</span>
            <span className="text-[10px] text-content-muted shrink-0">({bucket.total_items} items)</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm font-semibold text-content-primary tabular-nums">{pct}%</span>
          </div>
        </div>
        <div className="mt-1.5 w-full h-1 bg-bg-tertiary rounded-full overflow-hidden">
          <div className={clsx('h-full transition-all duration-500 ease-out', barColor)} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[11px] text-content-secondary mt-1 leading-snug">{bucket.description}</p>
      </button>
      {open && (
        <ul className="bg-bg-secondary/30 rounded mb-2">
          {bucket.items.map((item) => <ItemRow key={item.id} item={item} />)}
        </ul>
      )}
    </div>
  );
}

function GapStrip({ gap }) {
  return (
    <li className="py-1.5 px-2 border-b border-hairline last:border-0">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-sm font-medium text-content-primary">{gap.item_label}</span>
            <span className="text-[10px] text-content-muted">· {gap.bucket_label}</span>
            <span className={clsx('text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border shrink-0', SEVERITY_TONE[gap.severity] || SEVERITY_TONE.low)}>
              {gap.severity}
            </span>
          </div>
          {gap.recommended_action && (
            <p className="text-[11px] text-content-secondary mt-0.5 leading-snug">{gap.recommended_action}</p>
          )}
        </div>
      </div>
    </li>
  );
}

// ── Title & Parcel Consistency — deterministic cross-document mismatch findings
function FindingRow({ finding }) {
  const tone = SEVERITY_TONE[finding.severity] || SEVERITY_TONE.low;
  return (
    <li className="py-2 px-3 border-b border-hairline last:border-0">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-sm font-medium text-content-primary">{finding.title}</span>
        <span className={clsx('text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border shrink-0', tone)}>
          {finding.severity}
        </span>
      </div>
      {finding.description && (
        <p className="text-[11px] text-content-secondary mt-1 leading-snug">{finding.description}</p>
      )}
      {finding.evidence && finding.evidence.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {finding.evidence.map((e, i) => (
            <p key={i} className="text-[10px] text-content-muted leading-snug">
              <span className="uppercase tracking-wide">{String(e.doc_type || 'doc').replace(/_/g, ' ')}</span>
              {e.field ? ` · ${e.field}` : ''}: <span className="text-content-secondary">{String(e.value ?? '—')}</span>
            </p>
          ))}
        </div>
      )}
      {finding.mitigation && (
        <p className="text-[11px] text-content-secondary mt-1 leading-snug">
          <span className="font-medium">Next step:</span> {finding.mitigation}
        </p>
      )}
    </li>
  );
}

function ConsistencySection({ consistency }) {
  const [open, setOpen] = useState(true);
  if (!consistency || !consistency.available) return null;
  const findings = consistency.findings || [];
  const extractions = consistency.extractions_count || 0;
  // Nothing extracted yet → no signal to show; keep the panel uncluttered.
  if (findings.length === 0 && extractions === 0) return null;
  const summary = consistency.summary || { total: findings.length, critical: 0 };
  return (
    <div className="mb-3 border border-hairline rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left px-3 py-2 bg-bg-secondary/60 hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 transition-colors duration-150 ease-out"
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <ScanSearch size={12} className="text-content-muted" />
          <span className="text-xs uppercase tracking-wider font-medium text-content-secondary">Title &amp; Parcel Consistency</span>
          {findings.length > 0 ? (
            <span className="text-[10px] text-content-muted">
              {summary.total} finding{summary.total === 1 ? '' : 's'}{summary.critical ? ` · ${summary.critical} critical` : ''}
            </span>
          ) : (
            <span className="text-[10px] text-data-positive">no conflicts</span>
          )}
        </div>
      </button>
      {open && (
        <div className="bg-bg-elevated">
          {findings.length === 0 ? (
            <p className="text-[11px] text-content-secondary px-3 py-2 flex items-center gap-1.5">
              <CheckCircle2 size={12} className="text-data-positive shrink-0" />
              No cross-document conflicts detected across the uploaded documents.
            </p>
          ) : (
            <>
              <ul>
                {findings.map((f, i) => <FindingRow key={f.pair_key || i} finding={f} />)}
              </ul>
              <p className="text-[10px] text-content-muted italic px-3 py-1.5 border-t border-hairline">
                Deterministic cross-document checks — flagged items need human / legal verification, not an automated verdict.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Post-Registration Compliance Calendar — deterministic due schedule ──────
const CAL_STATUS = {
  overdue:  { cls: 'bg-neg-soft text-data-negative border-hairline', label: 'Overdue' },
  due_soon: { cls: 'bg-premium-soft text-premium border-hairline', label: 'Due soon' },
  upcoming: { cls: 'bg-bg-secondary text-content-secondary border-hairline', label: 'Upcoming' },
};

function CalendarItemRow({ item }) {
  const t = CAL_STATUS[item.status] || CAL_STATUS.upcoming;
  const when = item.days_until < 0
    ? `${Math.abs(item.days_until)}d ago`
    : item.days_until === 0 ? 'today' : `in ${item.days_until}d`;
  return (
    <li className="py-2 px-3 border-b border-hairline last:border-0">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-sm font-medium text-content-primary">{item.label}</span>
        <span className={clsx('text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border shrink-0', t.cls)}>
          {t.label}
        </span>
      </div>
      <div className="flex items-baseline gap-2 mt-0.5">
        <span className="text-[11px] text-content-secondary tabular-nums">{formatDate(item.due_date)}</span>
        <span className="text-[10px] text-content-muted">· {when}</span>
      </div>
      {item.description && <p className="text-[11px] text-content-secondary mt-1 leading-snug">{item.description}</p>}
    </li>
  );
}

function ComplianceCalendarSection({ calendar }) {
  const [open, setOpen] = useState(true);
  if (!calendar || !calendar.applicable) return null;

  if (calendar.status === 'preview') {
    return (
      <div className="mb-3 flex items-start gap-1.5 rounded-md border border-hairline bg-bg-secondary/40 px-2.5 py-1.5">
        <CalendarClock size={12} className="text-content-muted mt-0.5 shrink-0" />
        <p className="text-[11px] text-content-secondary leading-snug">{calendar.note}</p>
      </div>
    );
  }

  const items = calendar.items || [];
  if (items.length === 0) return null;
  const summary = calendar.summary || { total: items.length, overdue: 0, due_soon: 0 };
  return (
    <div className="mb-3 border border-hairline rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left px-3 py-2 bg-bg-secondary/60 hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 transition-colors duration-150 ease-out"
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <CalendarClock size={12} className="text-content-muted" />
          <span className="text-xs uppercase tracking-wider font-medium text-content-secondary">Post-Registration Compliance</span>
          <span className="text-[10px] text-content-muted">
            {summary.total} deadline{summary.total === 1 ? '' : 's'}
            {summary.overdue ? ` · ${summary.overdue} overdue` : summary.due_soon ? ` · ${summary.due_soon} due soon` : ''}
          </span>
        </div>
      </button>
      {open && (
        <div className="bg-bg-elevated">
          <ul>{items.map((it) => <CalendarItemRow key={it.id} item={it} />)}</ul>
          {calendar.note && (
            <p className="text-[10px] text-content-muted italic px-3 py-1.5 border-t border-hairline">{calendar.note}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function KarnatakaReraReadinessPanel() {
  const slice = useDealReraReadiness();
  const { dealId, refetch, workspace } = useDealContext();
  const [gapsOpen, setGapsOpen] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const currentInputs = useMemo(() => workspace?.deal?.rera_inputs || null, [workspace?.deal?.rera_inputs]);

  const handleDownload = async () => {
    if (downloading || !dealId) return;
    setDownloading(true);
    try {
      const res = await exportsAPI.dealReraReadinessDocx(dealId);
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (slice?.deal_name || 'deal').replace(/[^a-z0-9]/gi, '-').toLowerCase();
      a.download = `acureal-${safeName}-rera-readiness-${new Date().toISOString().slice(0, 10)}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('K-RERA Readiness Pack downloaded');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not download the readiness pack');
    } finally {
      setDownloading(false);
    }
  };

  if (!slice) return null;

  // Not applicable empty state — surface honest reason
  if (slice.applicable === false && slice.reason_if_not !== 'unavailable') {
    return (
      <div className="card-editorial">
        <h3 className="text-base font-semibold text-content-primary flex items-center gap-2 mb-2">
          <FileCheck size={16} className="text-content-muted" />
          K-RERA Readiness Pack
        </h3>
        {slice.applicability && <div className="mb-2"><ApplicabilityChip applicability={slice.applicability} /></div>}
        <p className="text-sm text-content-muted py-2">{slice.reason_if_not}</p>
      </div>
    );
  }

  // Unavailable (workspace error / migration not applied) — render nothing
  if (slice.applicable === false && slice.reason_if_not === 'unavailable') {
    return null;
  }

  const { overall, buckets, gaps, disclaimer, fee_estimate, milestone, applicability, consistency, compliance_calendar } = slice;
  const tier = overall?.readiness_tier || 'early';
  const tierLabel = READINESS_TIER_LABEL[tier] || tier;
  const tierTone = READINESS_TIER_TONE[tier] || READINESS_TIER_TONE.early;
  const pct = overall?.completeness_pct ?? 0;
  const byStatus = overall?.by_status || {};
  const totalItems = overall?.total_items ?? 0;
  const verifiedCount = byStatus.verified || 0;
  const uploadedCount = byStatus.uploaded || 0;
  const missingCount = byStatus.missing || 0;
  const blockers = overall?.blockers || [];

  return (
    <div className="card-editorial">
      {/* Header — readiness tier + meter */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
            <FileCheck size={16} className="text-content-muted" />
            K-RERA Readiness Pack
          </h3>
          <p className="text-xs text-content-secondary mt-1 leading-snug max-w-2xl">
            Inventory of documents + form fields Karnataka RERA project registration requires. Reads
            from approvals + uploaded documents already on this deal.
          </p>
          {applicability && <div className="mt-2"><ApplicabilityChip applicability={applicability} /></div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-content-secondary hover:text-content-primary disabled:text-content-muted transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded border border-bg-tertiary px-2 py-1"
            title="Download the readiness pack as a Word document for your CA / architect / lawyer"
          >
            {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            <span>{downloading ? 'Preparing…' : 'Download DOCX'}</span>
          </button>
          <span className={clsx('text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded border', tierTone)}>
            {tierLabel}
          </span>
          <ReadinessMeter pct={pct} tier={tier} />
        </div>
      </div>

      {/* Milestone band */}
      <MilestoneBand milestone={milestone} />

      {/* Post-registration compliance calendar */}
      <ComplianceCalendarSection calendar={compliance_calendar} />

      {/* Project facts inputs */}
      <ProjectFactsForm dealId={dealId} currentInputs={currentInputs} onSaved={refetch} />

      {/* Fatal blockers */}
      <BlockersCallout blockers={blockers} />

      {/* Cross-document title & parcel consistency */}
      <ConsistencySection consistency={consistency} />

      {/* Fee estimate */}
      <FeeLine fee={fee_estimate} />

      {/* Headline metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <div className="bg-bg-secondary rounded p-2">
          <div className="text-[10px] text-content-muted uppercase tracking-wider">Verified</div>
          <div className="text-lg font-semibold text-data-positive tabular-nums">
            {verifiedCount}<span className="text-content-muted font-normal text-xs">/{totalItems}</span>
          </div>
        </div>
        <div className="bg-bg-secondary rounded p-2">
          <div className="text-[10px] text-content-muted uppercase tracking-wider">Uploaded</div>
          <div className="text-lg font-semibold text-accent tabular-nums">{uploadedCount}</div>
        </div>
        <div className="bg-bg-secondary rounded p-2">
          <div className="text-[10px] text-content-muted uppercase tracking-wider">Missing</div>
          <div className="text-lg font-semibold text-data-negative tabular-nums">{missingCount}</div>
        </div>
        <div className="bg-bg-secondary rounded p-2">
          <div className="text-[10px] text-content-muted uppercase tracking-wider">Top gap</div>
          <div className="text-xs font-medium text-content-primary truncate">{gaps?.[0]?.item_label || '—'}</div>
        </div>
      </div>

      {/* Buckets */}
      <div className="border border-hairline rounded-md overflow-hidden px-3">
        {buckets.map((bucket) => <BucketCard key={bucket.id} bucket={bucket} />)}
      </div>

      {/* Top gaps */}
      {gaps && gaps.length > 0 && (
        <div className="mt-3 border border-hairline rounded-md overflow-hidden">
          <button
            type="button"
            onClick={() => setGapsOpen((v) => !v)}
            aria-expanded={gapsOpen}
            className="w-full text-left px-3 py-2 bg-bg-secondary/60 hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <div className="flex items-center gap-1.5">
              {gapsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Sparkles size={12} className="text-content-muted" />
              <span className="text-xs uppercase tracking-wider font-medium text-content-secondary">
                Top {Math.min(gaps.length, 8)} gaps · sorted by severity
              </span>
            </div>
          </button>
          {gapsOpen && (
            <ul className="bg-bg-elevated px-2">
              {gaps.slice(0, 8).map((gap) => <GapStrip key={gap.item_id} gap={gap} />)}
            </ul>
          )}
        </div>
      )}

      {/* Marketing caution */}
      <MarketingNote applicability={applicability} />

      {/* CLAUDE.md disclaimer */}
      {disclaimer && (
        <div className="mt-3 pt-2 border-t border-hairline flex items-start gap-1.5">
          <Info size={11} className="text-content-muted mt-0.5 shrink-0" />
          <p className="text-[10px] text-content-muted italic leading-snug">{disclaimer}</p>
        </div>
      )}
    </div>
  );
}
