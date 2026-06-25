import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  FileSearch,
  FileText,
  History,
  Loader2,
  RefreshCw,
  Upload,
  XCircle,
} from 'lucide-react';
import { clsx } from 'clsx';
import Badge from '../common/Badge';
import EmptyState from '../common/EmptyState';
import { Skeleton } from '../../design-system';
import {
  useMasterPlanDocuments,
  useUploadMasterPlanDocument,
  useExtractMasterPlanDocument,
  useExtractMasterPlanDocumentsBatch,
  useUpdateMasterPlanDocumentMetadata,
  useMasterPlanDocumentVersions,
  useMasterPlanDocumentPages,
  usePrepareMasterPlanDocumentPages,
  useOpenMasterPlanDocument,
} from '../../hooks/useMasterPlan';
import {
  SOURCE_DOC_TYPES,
  SOURCE_ROLES,
  LEGAL_STATUSES,
  PROCESSING_MODES,
  READINESS_FILTERS,
  formatBytes,
  formatDocType,
  formatOption,
  formatPercent,
  legalStatusTone,
  getSourceReadiness,
} from '../../utils/masterPlanHelpers';
import SourceReviewModal from './SourceReviewModal';
import SourceHistoryModal from './SourceHistoryModal';
import SourcePagesModal from './SourcePagesModal';

/**
 * Doc-status icon/tone mapping used by the SourceStatusBadge below.
 * Kept private to DocumentsPanel — no other surface needs this.
 */
const DOC_STATUS_META = {
  pending: { label: 'pending', tone: 'neutral', icon: Clock },
  in_progress: { label: 'extracting', tone: 'info', icon: Loader2 },
  completed: { label: 'queued for review', tone: 'success', icon: CheckCircle2 },
  failed: { label: 'failed', tone: 'danger', icon: XCircle },
};

function SourceStatusBadge({ status }) {
  const cfg = DOC_STATUS_META[status] || DOC_STATUS_META.pending;
  const Icon = cfg.icon;
  const spinning = status === 'in_progress';
  return (
    <Badge tone={cfg.tone} className="gap-1">
      <Icon size={11} className={spinning ? 'animate-spin' : ''} />
      {cfg.label}
    </Badge>
  );
}

/**
 * Skeleton placeholder for the source-documents list while it loads.
 */
function SourceDocumentsSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <div className="rounded-lg border border-hairline bg-bg-elevated p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-4 w-36 rounded" />
            <Skeleton className="h-3 w-80 max-w-full rounded" />
          </div>
          <Skeleton className="h-6 w-20 rounded" />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-hairline bg-bg-elevated">
        {[0, 1, 2].map((row) => (
          <div key={row} className="grid grid-cols-1 gap-3 border-b border-hairline px-4 py-3 last:border-b-0 md:grid-cols-[minmax(260px,1.4fr),minmax(160px,0.9fr),minmax(180px,0.9fr),minmax(150px,0.7fr)]">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-12 w-full rounded" />
            ))}
          </div>
        ))}
      </div>
      <span className="sr-only">Loading source documents</span>
    </div>
  );
}

/**
 * "Source Documents" tab — uploads, readiness filters, document list,
 * and the three operator modals (review metadata, view history, page
 * ledger).
 *
 * Extracted from `pages/MasterPlanAdminPage.jsx` as part of the Task #6
 * decomposition (Tier C — tab-panel extractions). Behaviour-preserving
 * move, no logic changes. The four operator modals it composes were
 * already extracted in Tier B.
 *
 * Props:
 *   - canEdit: whether the current operator can upload / extract / edit
 *              source documents.
 */
export default function DocumentsPanel({ canEdit }) {
  const { data: docs = [], isLoading, isError, refetch } = useMasterPlanDocuments();
  const uploadMut = useUploadMasterPlanDocument();
  const extractMut = useExtractMasterPlanDocument();
  const batchExtractMut = useExtractMasterPlanDocumentsBatch();
  const updateDocMut = useUpdateMasterPlanDocumentMetadata();
  const openMut = useOpenMasterPlanDocument();
  const preparePagesMut = usePrepareMasterPlanDocumentPages();

  const [file, setFile] = useState(null);
  const [form, setForm] = useState({
    city: 'Bengaluru',
    planName: '',
    planVersion: 'RMP 2031 Provisional',
    docType: 'rmp_table',
    sourceRole: '',
    legalStatus: '',
    authorityName: '',
    processingMode: 'text_extraction',
    ocrRequired: false,
    registryNotes: '',
  });
  const [extractingId, setExtractingId] = useState(null);
  const [fileError, setFileError] = useState('');
  const [readinessFilter, setReadinessFilter] = useState('all');
  const [reviewingDoc, setReviewingDoc] = useState(null);
  const [historyDoc, setHistoryDoc] = useState(null);
  const [pagesDoc, setPagesDoc] = useState(null);
  const historyQuery = useMasterPlanDocumentVersions(historyDoc?.id);
  const pagesQuery = useMasterPlanDocumentPages(pagesDoc?.id);

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const docsWithReadiness = useMemo(
    () => docs.map((doc) => ({ doc, readiness: getSourceReadiness(doc) })),
    [docs],
  );

  const readinessCounts = useMemo(() => {
    const counts = { all: docs.length };
    docsWithReadiness.forEach(({ readiness }) => {
      counts[readiness.key] = (counts[readiness.key] || 0) + 1;
    });
    return counts;
  }, [docs.length, docsWithReadiness]);

  const filteredDocs = useMemo(
    () => (readinessFilter === 'all'
      ? docsWithReadiness
      : docsWithReadiness.filter(({ readiness }) => readiness.key === readinessFilter)),
    [docsWithReadiness, readinessFilter],
  );

  // "Extract all eligible" — every doc whose readiness allows extraction and
  // whose status isn't already in_progress / completed. Capped at 25 by the
  // backend so it doesn't fan out indefinitely.
  const eligibleForBatchExtract = useMemo(
    () => docsWithReadiness
      .filter(({ doc, readiness }) => (
        readiness.canExtract
        && doc.extraction_status !== 'in_progress'
        && doc.extraction_status !== 'completed'
      ))
      .map(({ doc }) => doc.id)
      .slice(0, 25),
    [docsWithReadiness],
  );

  const handleBatchExtract = async () => {
    if (eligibleForBatchExtract.length === 0) return;
    await batchExtractMut.mutateAsync(eligibleForBatchExtract);
  };

  const handleFile = (event) => {
    const selected = event.target.files?.[0] || null;
    setFileError('');
    setFile(selected);
    if (!selected) return;
    const lower = selected.name.toLowerCase();
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'].some((ext) => lower.endsWith(ext));
    if (!allowed) {
      setFileError('Upload a PDF or image source file.');
      setFile(null);
      return;
    }
    if (!form.planName.trim()) {
      set('planName', selected.name.replace(/\.[^.]+$/, ''));
    }
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!file) {
      setFileError('Select a source file first.');
      return;
    }
    await uploadMut.mutateAsync({
      file,
      city: form.city,
      planName: form.planName.trim() || file.name,
      planVersion: form.planVersion.trim() || null,
      docType: form.docType,
      sourceRole: form.sourceRole || null,
      legalStatus: form.legalStatus || null,
      authorityName: form.authorityName.trim() || null,
      processingMode: form.processingMode || 'text_extraction',
      ocrRequired: form.ocrRequired || form.processingMode === 'ocr_required' || form.processingMode === 'image_review',
      registryNotes: form.registryNotes.trim() || null,
    });
    setFile(null);
  };

  const handleExtract = async (doc) => {
    setExtractingId(doc.id);
    try {
      await extractMut.mutateAsync({ id: doc.id, docType: doc.doc_type || form.docType });
    } finally {
      setExtractingId(null);
    }
  };

  const handleReviewSubmit = async (payload) => {
    if (!reviewingDoc?.id) return;
    await updateDocMut.mutateAsync({ id: reviewingDoc.id, data: payload });
    setReviewingDoc(null);
  };

  const handlePreparePages = async () => {
    if (!pagesDoc?.id) return;
    await preparePagesMut.mutateAsync({
      id: pagesDoc.id,
      pageCount: pagesDoc.page_count || undefined,
    });
  };

  if (isLoading) return <SourceDocumentsSkeleton />;

  if (isError) {
    return (
      <div className="card-editorial text-center py-12">
        <AlertTriangle size={28} className="text-data-negative mx-auto mb-2" />
        <p className="text-sm text-data-negative mb-3">Failed to load source documents.</p>
        <button onClick={refetch} className="btn btn-secondary text-sm inline-flex items-center gap-1.5">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {canEdit && (
        <form onSubmit={handleUpload} className="card-editorial border-hairline-strong bg-bg-elevated">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-content-primary">Source document intake</h3>
              <p className="mt-0.5 text-xs text-content-secondary">
                Upload official Masterplan, RMP, FAR, zoning, or guidance source files for review-backed extraction.
              </p>
            </div>
            <SourceStatusBadge status="pending" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">City</label>
              <input className="input text-sm" value={form.city} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Plan version</label>
              <input className="input text-sm" value={form.planVersion} onChange={(e) => set('planVersion', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Document type</label>
              <select className="input text-sm" value={form.docType} onChange={(e) => set('docType', e.target.value)}>
                {SOURCE_DOC_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Source file</label>
              <input
                type="file"
                accept=".pdf,.docx,.doc,.rtf,.odt,.txt,.md,.xlsx,.xls,.xlsm,.csv,.tsv,.ods,.pptx,.ppt,.odp,.jpg,.jpeg,.png,.webp,.tif,.tiff,.gif,.bmp,.heic,.heif,.geojson,.kml,.kmz,.gpx,.json,.xml"
                onChange={handleFile}
                className="block w-full text-sm text-content-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-accent-soft file:text-accent hover:file:bg-accent-soft cursor-pointer"
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Source role</label>
              <select className="input text-sm" value={form.sourceRole} onChange={(e) => set('sourceRole', e.target.value)}>
                {SOURCE_ROLES.map((role) => (
                  <option key={role.value || 'none'} value={role.value}>{role.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Legal status</label>
              <select className="input text-sm" value={form.legalStatus} onChange={(e) => set('legalStatus', e.target.value)}>
                {LEGAL_STATUSES.map((status) => (
                  <option key={status.value || 'none'} value={status.value}>{status.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Authority</label>
              <input
                className="input text-sm"
                value={form.authorityName}
                onChange={(e) => set('authorityName', e.target.value)}
                placeholder="BDA / BBMP"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Processing</label>
              <select
                className="input text-sm"
                value={form.processingMode}
                onChange={(e) => set('processingMode', e.target.value)}
              >
                {PROCESSING_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>{mode.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3">
            <label className="block text-xs font-medium text-content-secondary mb-1">Source title</label>
            <input
              className="input text-sm"
              value={form.planName}
              onChange={(e) => set('planName', e.target.value)}
              placeholder="Volume-6 Zoning Regulations"
            />
            {fileError && <p className="mt-1 text-xs text-data-negative">{fileError}</p>}
            {file && !fileError && (
              <p className="mt-1 text-xs text-content-muted">{file.name} | {formatBytes(file.size)}</p>
            )}
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr),auto] gap-3 md:items-end">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Registry notes</label>
              <input
                className="input text-sm"
                value={form.registryNotes}
                onChange={(e) => set('registryNotes', e.target.value)}
                placeholder="Draft source, image-only PDF, derived from user remarks..."
              />
            </div>
            <label className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-hairline px-3 text-xs font-medium text-content-secondary transition-colors duration-150 ease-out hover:bg-bg-secondary focus-within:ring-2 focus-within:ring-accent/40 active:scale-[0.99]">
              <input
                type="checkbox"
                checked={form.ocrRequired}
                onChange={(e) => set('ocrRequired', e.target.checked)}
                className="h-4 w-4 rounded border-hairline text-accent focus:ring-accent/40"
              />
              OCR needed
            </label>
          </div>


          <div className="mt-4 flex items-center justify-between gap-3 border-t border-hairline pt-3">
            <Link to="/dashboard/settings/parcel-intelligence" className="text-xs font-medium text-accent hover:underline">
              Review queue
            </Link>
            <button
              type="submit"
              disabled={uploadMut.isPending || !file}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98] disabled:opacity-60"
            >
              {uploadMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploadMut.isPending ? 'Uploading...' : 'Upload source'}
            </button>
          </div>
        </form>
      )}

      {docs.length > 0 && (
        <div className="rounded-lg border border-hairline bg-bg-elevated p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-content-primary">Source readiness</h3>
              <p className="mt-0.5 text-xs text-content-secondary">
                Text-ready sources, OCR gaps, and manual-reference documents.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canEdit && eligibleForBatchExtract.length > 0 && (
                <button
                  type="button"
                  onClick={handleBatchExtract}
                  disabled={batchExtractMut.isPending}
                  title={`Queue ${eligibleForBatchExtract.length} extraction${eligibleForBatchExtract.length === 1 ? '' : 's'} in parallel — runs in the background`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98] disabled:opacity-60"
                >
                  {batchExtractMut.isPending ? (
                    <Loader2 size={12} className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <FileSearch size={12} />
                  )}
                  Extract {eligibleForBatchExtract.length} eligible
                </button>
              )}
              <Badge tone="neutral">{docs.length} total</Badge>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
            {READINESS_FILTERS.map((filter) => {
              const selected = readinessFilter === filter.key;
              const count = readinessCounts[filter.key] || 0;
              return (
                <button
                  key={filter.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setReadinessFilter(filter.key)}
                  className={clsx(
                    'rounded-lg border px-3 py-2 text-left transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]',
                    selected
                      ? 'border-hairline bg-accent-soft text-accent'
                      : 'border-hairline bg-bg-elevated text-content-secondary hover:border-hairline-strong hover:bg-bg-secondary',
                  )}
                >
                  <div className="text-lg font-semibold tabular-nums">{count}</div>
                  <div className="truncate text-[11px] font-medium">{filter.label}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No master plan source documents"
          description="Upload reviewed source material to extract candidate zones, FAR rules, planning districts, and guidance values into the review queue."
        />
      ) : filteredDocs.length === 0 ? (
        <div className="rounded-lg border border-hairline bg-bg-elevated px-4 py-8 text-center">
          <p className="text-sm font-medium text-content-primary">No sources match this readiness view.</p>
          <p className="mt-1 text-xs text-content-secondary">The registry has no documents in this readiness state.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-hairline bg-bg-elevated">
          <div className="hidden border-b border-hairline-strong px-4 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-content-secondary md:grid md:grid-cols-[minmax(260px,1.4fr),minmax(160px,0.9fr),minmax(180px,0.9fr),minmax(150px,0.7fr)] md:gap-3">
            <div>Source</div>
            <div>Extraction</div>
            <div>Review candidates</div>
            <div className="text-right">Actions</div>
          </div>
          <div className="divide-y divide-hairline">
            {filteredDocs.map(({ doc, readiness }) => {
              const counts = [
                ['zones', doc.zones_extracted],
                ['FAR', doc.far_rules_extracted],
                ['guidance', doc.guidance_rows_extracted],
                ['facts', doc.evidence_facts_extracted],
              ].filter(([, value]) => Number(value) > 0);
              const busy = extractingId === doc.id || doc.extraction_status === 'in_progress';
              const textCoverage = formatPercent(doc.text_coverage_ratio);

              return (
                <div
                  key={doc.id}
                  className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[minmax(260px,1.4fr),minmax(160px,0.9fr),minmax(180px,0.9fr),minmax(150px,0.7fr)] md:items-center hover:bg-bg-secondary"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-content-primary">{doc.plan_name}</div>
                    <div className="mt-0.5 text-xs text-content-secondary">
                      {[doc.city, doc.plan_version || null, doc.file_name || null].filter(Boolean).join(' | ')}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {doc.legal_status && (
                        <Badge tone={legalStatusTone(doc.legal_status)}>
                          {formatOption(LEGAL_STATUSES, doc.legal_status)}
                        </Badge>
                      )}
                      {doc.source_role && (
                        <Badge tone="neutral">{formatOption(SOURCE_ROLES, doc.source_role)}</Badge>
                      )}
                      {doc.authority_name && (
                        <span className="rounded-md bg-bg-secondary px-2 py-1 text-xs font-medium text-content-secondary">
                          {doc.authority_name}
                        </span>
                      )}
                      {doc.ocr_required && !readiness.isReferenceMap && <Badge tone="warn">OCR needed</Badge>}
                      {textCoverage && !readiness.isReferenceMap && <Badge tone="neutral">Text {textCoverage}</Badge>}
                      <Badge tone={readiness.tone}>{readiness.label}</Badge>
                    </div>
                  </div>

                  <div className="space-y-1">
                    {readiness.isReferenceMap ? (
                      <Badge tone="success" className="gap-1">
                        <CheckCircle2 size={11} />
                        stored
                      </Badge>
                    ) : (
                      <SourceStatusBadge status={doc.extraction_status} />
                    )}
                    <div className="text-xs text-content-muted">{formatDocType(doc.doc_type)}</div>
                    <div className="text-xs text-content-muted">{readiness.description}</div>
                    {doc.extraction_error && (
                      <div className="line-clamp-2 text-xs text-data-negative">{doc.extraction_error}</div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {counts.length === 0 ? (
                      <span className="text-xs text-content-muted">No queued rows yet</span>
                    ) : counts.map(([label, value]) => (
                      <span key={label} className="rounded-md bg-bg-secondary px-2 py-1 text-xs font-medium text-content-secondary">
                        {value} {label}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-end gap-1.5">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setReviewingDoc(doc)}
                        className="rounded-lg p-1.5 text-content-muted transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
                        title="Review source"
                        aria-label={`Review source ${doc.plan_name}`}
                      >
                        <Edit3 size={15} />
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setHistoryDoc(doc)}
                        className="rounded-lg p-1.5 text-content-muted transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
                        title="Review history"
                        aria-label={`Review history ${doc.plan_name}`}
                      >
                        <History size={15} />
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setPagesDoc(doc)}
                        className="rounded-lg p-1.5 text-content-muted transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
                        title="Page ledger"
                        aria-label={`Page ledger ${doc.plan_name}`}
                      >
                        <FileText size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openMut.mutate(doc.id)}
                      disabled={openMut.isPending}
                      className="rounded-lg p-1.5 text-content-muted transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98] disabled:opacity-50"
                      title="Open source"
                    >
                      <ExternalLink size={15} />
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleExtract(doc)}
                        disabled={busy || extractingId !== null || !readiness.canExtract}
                        title={readiness.blockReason || readiness.description}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent transition-colors duration-150 ease-out hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98] disabled:opacity-50"
                      >
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <FileSearch size={13} />}
                        {busy ? 'Extracting...' : readiness.actionLabel}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <SourceReviewModal
        doc={reviewingDoc}
        isOpen={Boolean(reviewingDoc)}
        onClose={() => setReviewingDoc(null)}
        onSubmit={handleReviewSubmit}
        submitting={updateDocMut.isPending}
      />
      <SourceHistoryModal
        doc={historyDoc}
        isOpen={Boolean(historyDoc)}
        onClose={() => setHistoryDoc(null)}
        versions={historyQuery.data || []}
        isLoading={historyQuery.isLoading || historyQuery.isFetching}
        isError={historyQuery.isError}
        onRetry={() => historyQuery.refetch()}
      />
      <SourcePagesModal
        doc={pagesDoc}
        isOpen={Boolean(pagesDoc)}
        onClose={() => setPagesDoc(null)}
        data={pagesQuery.data}
        isLoading={pagesQuery.isLoading || pagesQuery.isFetching}
        isError={pagesQuery.isError}
        onRetry={() => pagesQuery.refetch()}
        onPrepare={handlePreparePages}
        preparing={preparePagesMut.isPending}
      />
    </div>
  );
}
