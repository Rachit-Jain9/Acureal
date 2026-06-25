import { useState } from 'react';
import {
  Target, ChevronRight, ChevronDown, CheckCircle2, Circle,
  AlertCircle, Info, Sparkles, Download, Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useDealContext, useDealIcReadiness } from '../../hooks/useDealContext';
import { exportsAPI } from '../../services/api';
import { toast } from '../common/Toast';
import { GuideHelp } from '../../design-system';

/**
 * IcReadinessPanel — Phase 3 / Pillar 5.
 *
 * Companion to the K-RERA Readiness Pack. For every deal — regardless of
 * asset class — surfaces a 7-bucket IC handoff inventory:
 *
 *   1. Financial Underwriting
 *   2. Title & Legal
 *   3. Statutory Approvals
 *   4. Market & Comps
 *   5. Promoter & Execution
 *   6. Risk & Diagnosis
 *   7. Document Hygiene
 *
 * Each row carries the five-tier evidence status, source attribution,
 * and a recommended next step when missing/pending. Top gaps surfaced
 * with severity. Download button produces a polished IC handoff DOCX.
 *
 * **CLAUDE.md respected**: disclaimer surfaces that this is an
 * organisation aid for the deal team's pre-IC prep — NOT an IC approval.
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
  ic_ready:  'bg-pos-soft text-data-positive border-hairline',
  pre_ic:    'bg-accent-soft text-accent border-hairline',
  diligence: 'bg-premium-soft text-premium border-hairline',
  early:     'bg-bg-secondary text-content-secondary border-hairline',
};

const READINESS_TIER_LABEL = {
  ic_ready:  'IC-ready',
  pre_ic:    'Pre-IC',
  diligence: 'Diligence-stage',
  early:     'Early',
};

const BUCKET_STATUS_BAR = {
  complete: 'bg-data-positive',
  partial:  'bg-premium',
  missing:  'bg-content-muted',
};

function StatusPill({ status }) {
  const t = STATUS_TONE[status] || STATUS_TONE.missing;
  const Icon = t.icon;
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border',
      t.bg,
    )}>
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
              {ev.source ? `${ev.source.replace(/_/g, ' ')}: ` : ''}{ev.evidence_label}
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
            <span className={clsx(
              'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border shrink-0',
              SEVERITY_TONE[gap.severity] || SEVERITY_TONE.low,
            )}>
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

export default function IcReadinessPanel() {
  const slice = useDealIcReadiness();
  const { dealId } = useDealContext();
  const [gapsOpen, setGapsOpen] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (downloading || !dealId) return;
    setDownloading(true);
    try {
      const res = await exportsAPI.dealIcReadinessDocx(dealId);
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (slice?.deal_name || 'deal').replace(/[^a-z0-9]/gi, '-').toLowerCase();
      a.download = `redip-${safeName}-ic-readiness-${new Date().toISOString().slice(0, 10)}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('IC Readiness Pack downloaded');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not download the IC readiness pack');
    } finally {
      setDownloading(false);
    }
  };

  if (!slice || !slice.overall) {
    return null; // workspace error / no data — render nothing
  }

  const { overall, buckets, gaps, disclaimer } = slice;
  const tier = overall.readiness_tier || 'early';
  const tierLabel = READINESS_TIER_LABEL[tier] || tier;
  const tierTone = READINESS_TIER_TONE[tier] || READINESS_TIER_TONE.early;
  const pct = overall.completeness_pct ?? 0;
  const byStatus = overall.by_status || {};
  const totalItems = overall.total_items ?? 0;
  const verifiedCount = byStatus.verified || 0;
  const uploadedCount = byStatus.uploaded || 0;
  const missingCount  = byStatus.missing || 0;

  return (
    <div className="card-editorial">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
            <Target size={16} className="text-content-muted" />
            IC Readiness Pack
            <GuideHelp topic="deal.ic-readiness" label="IC Readiness" />
          </h3>
          <p className="text-xs text-content-secondary mt-1 leading-snug max-w-2xl">
            Seven-bucket inventory of what an Investment Committee reviewer expects to see. Reads
            from every workspace surface — financial kernel, DD, approvals, market signals, promoter
            track record, Risk Radar, Deal Doctor, documents.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-content-secondary hover:text-content-primary disabled:text-content-muted transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded border border-bg-tertiary px-2 py-1"
            title="Download the IC readiness pack as a Word document for IC committee handoff"
          >
            {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            <span>{downloading ? 'Preparing…' : 'Download DOCX'}</span>
          </button>
          <span className={clsx(
            'text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded border',
            tierTone,
          )}>
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
          <div className="text-lg font-semibold text-data-positive tabular-nums">
            {verifiedCount}
            <span className="text-content-muted font-normal text-xs">/{totalItems}</span>
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
          <div className="text-xs font-medium text-content-primary truncate">
            {gaps?.[0]?.item_label || '—'}
          </div>
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

      {/* Disclaimer */}
      {disclaimer && (
        <div className="mt-3 pt-2 border-t border-hairline flex items-start gap-1.5">
          <Info size={11} className="text-content-muted mt-0.5 shrink-0" />
          <p className="text-[10px] text-content-muted italic leading-snug">{disclaimer}</p>
        </div>
      )}
    </div>
  );
}
