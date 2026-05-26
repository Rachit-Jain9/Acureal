import { useState } from 'react';
import {
  FileCheck, ChevronRight, ChevronDown, CheckCircle2, Circle,
  AlertCircle, Info, Sparkles, Download, Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useDealContext, useDealReraReadiness } from '../../hooks/useDealContext';
import { exportsAPI } from '../../services/api';
import { toast } from '../common/Toast';

/**
 * KarnatakaReraReadinessPanel — Phase 3 / Pillar 4.
 *
 * For residential / plotted / villas / mixed-use / redevelopment deals,
 * surfaces the Karnataka RERA readiness checklist:
 *
 *   - Overall completeness % + readiness tier (early / partial / mostly /
 *     filing-ready) with a deterministic 0-100 score
 *   - Seven buckets (Application & Declaration, Title & Ownership, Plan &
 *     Approvals, Project Specs, Promoter Identity, Escrow & Finance,
 *     Professional Certificates) with completeness % per bucket
 *   - Per-item evidence status (verified / uploaded / available / pending
 *     / missing) with the source surfaced (approval row, document, or
 *     extracted field)
 *   - Top gaps with recommended actions, sorted by severity
 *
 * **CLAUDE.md hard rule respected**: the panel surfaces an explicit
 * disclaimer that this is an organisation aid, NOT a RERA compliance
 * verdict. Recommended actions are operational ("upload the EC document")
 * not statutory ("the deal is RERA-compliant").
 */

const STATUS_TONE = {
  verified:  { icon: CheckCircle2, tone: 'text-green-600', bg: 'bg-green-50 text-green-700 border-green-200' },
  uploaded:  { icon: CheckCircle2, tone: 'text-sky-600',   bg: 'bg-sky-50 text-sky-700 border-sky-200' },
  available: { icon: Circle,       tone: 'text-amber-600', bg: 'bg-amber-50 text-amber-700 border-amber-200' },
  pending:   { icon: Circle,       tone: 'text-amber-600', bg: 'bg-amber-50 text-amber-700 border-amber-200' },
  missing:   { icon: AlertCircle,  tone: 'text-red-500',   bg: 'bg-red-50 text-red-700 border-red-200' },
};

const STATUS_LABEL = {
  verified:  'Verified',
  uploaded:  'Uploaded',
  available: 'Available',
  pending:   'Pending',
  missing:   'Missing',
};

const SEVERITY_TONE = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  high:     'bg-orange-50 text-orange-700 border-orange-200',
  medium:   'bg-amber-50 text-amber-700 border-amber-200',
  low:      'bg-slate-50 text-slate-700 border-slate-200',
};

const READINESS_TIER_TONE = {
  filing_ready: 'bg-green-50 text-green-700 border-green-200',
  mostly_ready: 'bg-sky-50 text-sky-700 border-sky-200',
  partial:      'bg-amber-50 text-amber-700 border-amber-200',
  early:        'bg-slate-50 text-slate-700 border-slate-200',
};

const READINESS_TIER_LABEL = {
  filing_ready: 'Filing-ready',
  mostly_ready: 'Mostly ready',
  partial:      'Partial',
  early:        'Early',
};

const BUCKET_STATUS_BAR = {
  complete: 'bg-green-500',
  partial:  'bg-amber-500',
  missing:  'bg-slate-400',
};

function StatusPill({ status }) {
  const t = STATUS_TONE[status] || STATUS_TONE.missing;
  const Icon = t.icon;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border',
        t.bg,
      )}
    >
      <Icon size={10} />
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function ItemRow({ item }) {
  const ev = item.evidence;
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
            <span className="text-sm font-medium text-content-primary">{item.label}</span>
            <StatusPill status={ev.status} />
          </div>
          <p className="text-xs text-content-secondary mt-0.5 leading-snug">{item.description}</p>
          {ev.evidence_label && (
            <p className="text-[11px] text-content-muted mt-1 italic">
              Source: {ev.evidence_label}
              {ev.reference_number && ` · #${ev.reference_number}`}
            </p>
          )}
          {item.recommended_action && (
            <p className="text-[11px] text-content-secondary mt-1 leading-snug">
              <span className="font-medium">Next step:</span> {item.recommended_action}
            </p>
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
        className="w-full text-left py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 rounded"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-center gap-1.5 min-w-0">
            {open ? (
              <ChevronDown size={12} className="text-content-muted shrink-0" />
            ) : (
              <ChevronRight size={12} className="text-content-muted shrink-0" />
            )}
            <span className="text-sm font-medium text-content-primary truncate">{bucket.label}</span>
            <span className="text-[10px] text-content-muted shrink-0">({bucket.total_items} items)</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm font-semibold text-content-primary tabular-nums">{pct}%</span>
          </div>
        </div>
        <div className="mt-1.5 w-full h-1 bg-bg-tertiary rounded-full overflow-hidden">
          <div
            className={clsx('h-full transition-all duration-500 ease-out', barColor)}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-[11px] text-content-secondary mt-1 leading-snug">{bucket.description}</p>
      </button>
      {open && (
        <ul className="bg-bg-secondary/30 rounded mb-2">
          {bucket.items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
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
            <span
              className={clsx(
                'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border shrink-0',
                SEVERITY_TONE[gap.severity] || SEVERITY_TONE.low,
              )}
            >
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

export default function KarnatakaReraReadinessPanel() {
  const slice = useDealReraReadiness();
  const { dealId } = useDealContext();
  const [gapsOpen, setGapsOpen] = useState(true);
  const [downloading, setDownloading] = useState(false);

  // Download the DOCX readiness pack. Server-side disclaimer is on every
  // page of the document — the user can hand the file to their CA /
  // architect / lawyer.
  const handleDownload = async () => {
    if (downloading || !dealId) return;
    setDownloading(true);
    try {
      const res = await exportsAPI.dealReraReadinessDocx(dealId);
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (slice?.deal_name || 'deal').replace(/[^a-z0-9]/gi, '-').toLowerCase();
      a.download = `redip-${safeName}-rera-readiness-${new Date().toISOString().slice(0, 10)}.docx`;
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
        <p className="text-sm text-content-muted py-2">{slice.reason_if_not}</p>
      </div>
    );
  }

  // Unavailable (workspace error / migration not applied) — render nothing
  if (slice.applicable === false && slice.reason_if_not === 'unavailable') {
    return null;
  }

  const { overall, buckets, gaps, disclaimer } = slice;
  const tier = overall?.readiness_tier || 'early';
  const tierLabel = READINESS_TIER_LABEL[tier] || tier;
  const tierTone = READINESS_TIER_TONE[tier] || READINESS_TIER_TONE.early;
  const pct = overall?.completeness_pct ?? 0;
  const byStatus = overall?.by_status || {};
  const totalItems = overall?.total_items ?? 0;
  const verifiedCount = byStatus.verified || 0;
  const uploadedCount = byStatus.uploaded || 0;
  const missingCount  = byStatus.missing || 0;

  return (
    <div className="card-editorial">
      {/* Header — readiness tier + completeness */}
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
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-content-secondary hover:text-content-primary disabled:text-content-muted transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 rounded border border-bg-tertiary px-2 py-1"
            title="Download the readiness pack as a Word document for your CA / architect / lawyer"
          >
            {downloading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Download size={12} />
            )}
            <span>{downloading ? 'Preparing…' : 'Download DOCX'}</span>
          </button>
          <span
            className={clsx(
              'text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded border',
              tierTone,
            )}
          >
            {tierLabel}
          </span>
          <div className="text-right">
            <span className="text-2xl font-semibold text-content-primary tabular-nums">{pct}</span>
            <span className="text-content-muted text-sm">/100</span>
          </div>
        </div>
      </div>

      {/* Headline metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <div className="bg-bg-secondary rounded p-2">
          <div className="text-[10px] text-content-muted uppercase tracking-wider">Verified</div>
          <div className="text-lg font-semibold text-green-700 tabular-nums">
            {verifiedCount}
            <span className="text-content-muted font-normal text-xs">/{totalItems}</span>
          </div>
        </div>
        <div className="bg-bg-secondary rounded p-2">
          <div className="text-[10px] text-content-muted uppercase tracking-wider">Uploaded</div>
          <div className="text-lg font-semibold text-sky-700 tabular-nums">{uploadedCount}</div>
        </div>
        <div className="bg-bg-secondary rounded p-2">
          <div className="text-[10px] text-content-muted uppercase tracking-wider">Missing</div>
          <div className="text-lg font-semibold text-red-600 tabular-nums">{missingCount}</div>
        </div>
        <div className="bg-bg-secondary rounded p-2">
          <div className="text-[10px] text-content-muted uppercase tracking-wider">Top gap</div>
          <div className="text-xs font-medium text-content-primary truncate">
            {gaps?.[0]?.item_label || '—'}
          </div>
        </div>
      </div>

      {/* Buckets */}
      <div className="border border-hairline rounded-md overflow-hidden px-3">
        {buckets.map((bucket) => (
          <BucketCard key={bucket.id} bucket={bucket} />
        ))}
      </div>

      {/* Top gaps with recommended next steps */}
      {gaps && gaps.length > 0 && (
        <div className="mt-3 border border-hairline rounded-md overflow-hidden">
          <button
            type="button"
            onClick={() => setGapsOpen((v) => !v)}
            aria-expanded={gapsOpen}
            className="w-full text-left px-3 py-2 bg-bg-secondary/60 hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
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
              {gaps.slice(0, 8).map((gap) => (
                <GapStrip key={gap.item_id} gap={gap} />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* CLAUDE.md disclaimer — no legal verdict */}
      {disclaimer && (
        <div className="mt-3 pt-2 border-t border-hairline flex items-start gap-1.5">
          <Info size={11} className="text-content-muted mt-0.5 shrink-0" />
          <p className="text-[10px] text-content-muted italic leading-snug">{disclaimer}</p>
        </div>
      )}
    </div>
  );
}
