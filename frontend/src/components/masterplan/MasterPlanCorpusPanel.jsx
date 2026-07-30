import { useMemo } from 'react';
import {
  CheckCircle2, AlertTriangle, FileText, ScanLine, Hand, ImageIcon, FileQuestion, RefreshCw, Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import Badge from '../common/Badge';
import { Card, ErrorState, SectionHeader, Skeleton, StatTile } from '../../design-system';
import { useMasterPlanCorpus } from '../../hooks/useMasterPlan';

const PROCESSING_LABEL = {
  text_extraction: { label: 'Text extraction', icon: FileText, tone: 'info' },
  ocr_required: { label: 'OCR required', icon: ScanLine, tone: 'warn' },
  image_review: { label: 'Image review', icon: ImageIcon, tone: 'warn' },
  manual_entry: { label: 'Manual entry', icon: Hand, tone: 'neutral' },
  not_extractable: { label: 'Not extractable', icon: FileQuestion, tone: 'neutral' },
};

const LEGAL_TONE = {
  gazetted: 'success',
  draft: 'warn',
  provisional: 'warn',
  advisory: 'info',
  user_supplied: 'neutral',
  vendor: 'neutral',
  unknown: 'neutral',
};

const ROLE_LABEL = {
  operative_regulation: 'Operative regulation',
  draft_plan: 'Draft plan',
  provisional_plan: 'Provisional plan',
  base_map: 'Base map',
  land_use_schedule: 'Land-use schedule',
  guidance_value: 'Guidance value',
  property_tax_uav: 'Property-tax UAV',
  derived_notes: 'Derived notes',
  supporting_dataset: 'Supporting dataset',
  other: 'Other',
};

const EXTRACTION_TONE = {
  pending: 'neutral',
  in_progress: 'info',
  completed: 'success',
  failed: 'danger',
};

function pretty(value) {
  if (!value) return '';
  return String(value).replace(/_/g, ' ');
}

function formatPercent(ratio) {
  const n = Number(ratio);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—';
}

function CorpusSkeleton() {
  return (
    <Card elevated className="p-6">
      <div className="space-y-3">
        <Skeleton className="h-3 w-40 rounded" />
        <Skeleton className="h-5 w-2/3 rounded" />
        <Skeleton className="h-3 w-1/2 rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-3">
          <Skeleton className="h-16 w-full rounded" />
          <Skeleton className="h-16 w-full rounded" />
          <Skeleton className="h-16 w-full rounded" />
          <Skeleton className="h-16 w-full rounded" />
        </div>
        <div className="space-y-2 pt-2">
          <Skeleton className="h-10 w-full rounded" />
          <Skeleton className="h-10 w-full rounded" />
          <Skeleton className="h-10 w-full rounded" />
        </div>
      </div>
      <span className="sr-only">Loading source corpus</span>
    </Card>
  );
}

function ProcessingBadge({ mode }) {
  const cfg = PROCESSING_LABEL[mode] || { label: pretty(mode) || 'Unknown', icon: FileText, tone: 'neutral' };
  const Icon = cfg.icon;
  return (
    <Badge tone={cfg.tone} className="gap-1">
      <Icon size={11} />
      {cfg.label}
    </Badge>
  );
}

function LegalStatusBadge({ status }) {
  const tone = LEGAL_TONE[status] || 'neutral';
  return <Badge tone={tone} className="capitalize">{pretty(status) || '—'}</Badge>;
}

function UploadStatusBadge({ entry }) {
  if (!entry.uploaded) {
    return (
      <Badge tone="neutral" className="gap-1">
        <AlertTriangle size={11} />
        Awaiting upload
      </Badge>
    );
  }
  const status = entry.document?.extraction_status || 'pending';
  return (
    <Badge tone={EXTRACTION_TONE[status] || 'neutral'} className="gap-1">
      <CheckCircle2 size={11} />
      Uploaded
      <span className="text-content-muted">·</span>
      <span className="capitalize">{pretty(status)}</span>
    </Badge>
  );
}

export default function MasterPlanCorpusPanel() {
  const { data, isLoading, isError, refetch, isFetching } = useMasterPlanCorpus();
  const corpus = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const summary = useMemo(() => {
    const total = corpus.length;
    const uploaded = corpus.filter((entry) => entry.uploaded).length;
    const pending = Math.max(0, total - uploaded);
    const ocrPending = corpus.filter((entry) => (
      entry.ocr_required
      && (!entry.uploaded || entry.document?.extraction_status !== 'completed')
    )).length;
    return { total, uploaded, pending, ocrPending };
  }, [corpus]);

  if (isLoading) return <CorpusSkeleton />;

  if (isError) {
    return (
      <ErrorState
        tone="warn"
        title="Could not load source corpus"
        action={(
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-1 text-xs font-medium text-content-secondary hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-2 py-1"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        )}
      >
        Acureal could not reach the corpus endpoint. Try again, or check the master-plan service.
      </ErrorState>
    );
  }

  if (corpus.length === 0) {
    return (
      <ErrorState tone="info" title="No corpus configured">
        The Bengaluru RMP 2031 corpus manifest is empty in this environment.
      </ErrorState>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Source corpus"
        title="Bengaluru RMP 2031 — expected sources"
        sub="Acureal knows what files belong in the regulatory corpus and how each should be classified. Upload via the Source Documents tab; Acureal applies the role, legal status, authority, and processing mode shown here."
        action={(
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-content-secondary hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-2 py-1"
          >
            {isFetching ? <Loader2 size={12} className="animate-spin motion-reduce:animate-none" /> : <RefreshCw size={12} />}
            Refresh
          </button>
        )}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Expected" value={summary.total} footnote="canonical corpus" />
        <StatTile label="Uploaded" value={summary.uploaded} footnote={`of ${summary.total}`} />
        <StatTile
          label="Awaiting"
          value={summary.pending}
          footnote={summary.pending === 0 ? 'all uploaded' : 'still missing'}
          negative={summary.pending > 0}
        />
        <StatTile
          label="OCR pending"
          value={summary.ocrPending}
          footnote="needs OCR before extraction"
        />
      </div>

      <Card elevated className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-eyebrow uppercase tracking-[0.08em] text-content-muted bg-bg-secondary border-b border-hairline">
              <tr>
                <th className="text-left font-medium px-4 py-2">File</th>
                <th className="text-left font-medium px-4 py-2">Plan / Authority</th>
                <th className="text-left font-medium px-4 py-2">Role</th>
                <th className="text-left font-medium px-4 py-2">Legal status</th>
                <th className="text-left font-medium px-4 py-2">Processing</th>
                <th className="text-left font-medium px-4 py-2">Confidence</th>
                <th className="text-left font-medium px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {corpus.map((entry) => {
                const isBbmp = entry.canonical_name === 'guidance-value.pdf';
                return (
                  <tr
                    key={entry.canonical_name}
                    className={clsx(
                      'transition-colors duration-150 hover:bg-bg-secondary/60',
                      !entry.uploaded && 'bg-bg-secondary/20',
                    )}
                  >
                    <td className="px-4 py-3 align-top max-w-[18rem]">
                      <div className="font-mono text-xs text-content-secondary truncate" title={entry.canonical_name}>
                        {entry.canonical_name}
                      </div>
                      <div className="text-content-primary mt-0.5 leading-snug">
                        {entry.plan_name}
                      </div>
                      {isBbmp && (
                        <div className="text-[11px] text-content-muted mt-1">
                          BBMP property tax — separate from IGR sale guidance
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-content-secondary leading-snug">
                      <div>{entry.plan_version}</div>
                      <div className="text-content-muted text-xs mt-0.5">{entry.authority_name}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-content-secondary capitalize">
                      {ROLE_LABEL[entry.source_role] || pretty(entry.source_role) || '—'}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <LegalStatusBadge status={entry.legal_status} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <ProcessingBadge mode={entry.processing_mode} />
                    </td>
                    <td className="px-4 py-3 align-top tabular-nums text-content-secondary">
                      {formatPercent(entry.source_confidence)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <UploadStatusBadge entry={entry} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
