import { useMemo, useState, useRef } from 'react';
import EmptyState from '../common/EmptyState';
import { useScrollOnMount } from '../../hooks/useEvidenceNavigate';
import {
  Upload,
  Download,
  Trash2,
  FileText,
  FilePlus,
  FileSearch,
  FileStack,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Sparkles,
  Network,
} from 'lucide-react';
import { clsx } from 'clsx';
import DependentsPopover from '../common/DependentsPopover';
// PR-NX72 (2026-05-19) — Phase A1.1: DocumentsTab read path migrated from
// its own `useDocuments(dealId)` React-Query call to the shared
// `useDealDocuments()` selector backed by the workspace endpoint. One
// network round-trip per deal page load (workspace) instead of two (deal
// metadata + documents). Mutations stay on useUploadDocument /
// useDeleteDocument / useExtractDocument — they already invalidate the
// `['deal-workspace', dealId]` query key so the shared cache stays fresh.
import { useUploadDocument, useDeleteDocument, useExtractDocument } from '../../hooks/useDocuments';
import { useUploadQueue } from '../../hooks/useUploadQueue';
import { useDealExtractions } from '../../hooks/useDealExtractions';
import { useDealContext, useDealRecord, useDealDocuments } from '../../hooks/useDealContext';
import { useCanEdit } from '../../hooks/useCanEdit';
import { documentsAPI } from '../../services/api';
import { toast } from '../common/Toast';
import { SectionHeader, SkeletonList, confirm } from '../../design-system';
import SemanticSearchPanel from '../common/SemanticSearchPanel';
import UploadQueueList from './UploadQueueList';
import AutoFillFromDocumentsModal from './AutoFillFromDocumentsModal';
import {
  ACCEPT_ATTRIBUTE, extractionTierFor, isExtractable, labelFor,
} from '../../utils/documentFormats';
// PR-NX49 (2026-05-19) — surface Claude's cross-document analysis +
// inconsistency findings inline on the Documents tab. Same content
// that ships in the DOCX Document-Derived Insights section (PR-NX45).
import DocumentInsightsPanel from './DocumentInsightsPanel';
import { formatDate } from '../../utils/format';
import { downloadAxiosResponse } from '../../utils/download';

const CATEGORIES = [
  { value: 'om', label: 'OM / Offering Memo', color: 'bg-accent-soft text-accent' },
  { value: 'financials', label: 'Financials', color: 'bg-pos-soft text-data-positive' },
  { value: 'legal', label: 'Legal', color: 'bg-premium-soft text-premium' },
  { value: 'technical', label: 'Technical', color: 'bg-accent-soft text-accent' },
  { value: 'approvals', label: 'Approvals', color: 'bg-accent-soft text-accent' },
  { value: 'other', label: 'Other', color: 'bg-bg-secondary text-content-secondary' },
];

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.value, c]));

// Two different limits, deliberately named apart (they were one number, which
// is what let the UI imply that anything it accepts, it can read):
//   MAX_SIZE_MB     what Acureal accepts and STORES. Ours to choose — a product
//                   decision, not a platform ceiling.
//   MAX_READ_MB     what the document READER accepts. Bounded by Gemini's PDF
//                   ceiling (50 MB / 1,000 pages), which no paid plan raises.
// They are equal today. When storage rises, this copy must keep telling the
// truth about the gap rather than implying a bigger number means a bigger read.
const MAX_SIZE_MB = 50;
const MAX_READ_MB = 50;
const MAX_READ_PAGES = 1000;

function formatBytes(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// A document is AI-readable if the shared format registry says its type is
// native (PDF/image) or parseable (spreadsheet/doc/deck/CSV/JSON/KML…). This
// replaced the old PDF-only gate, which was stricter than the backend, which
// has always read images too.
function docIsExtractable(doc) {
  const fileName = String(doc?.original_name || doc?.file_name || doc?.name || '');
  const fileType = String(doc?.file_type || doc?.mime_type || doc?.type || '');
  return isExtractable({ fileName, fileType });
}

function docLabel(doc) {
  const fileName = String(doc?.original_name || doc?.file_name || doc?.name || '');
  return labelFor(fileName);
}

function formatDocType(docType) {
  return docType ? docType.replace(/_/g, ' ') : 'extracted';
}

/**
 * The coverage chip's label — how much of the document actually reached the
 * reader.
 *
 * The word is "sent", never "read": a successful provider call is not evidence
 * that a model attended to page 847, and Acureal does not claim what it cannot
 * show. The backend receipt uses the same vocabulary (`submitted_pages`).
 *
 * Returns null — rendering nothing — when there is nothing true to say:
 * documents extracted before receipts existed, and transcribed formats
 * (spreadsheets, CSV) where "pages" are not a meaningful unit. Silence beats a
 * guess.
 */
export function coverageLabel(extraction) {
  const c = extraction?.coverage;
  if (!c || c.method === 'parsed_text' || c.method === 'image') return null;
  const { detected_pages: detected, submitted_pages: submitted } = c;
  if (!Number.isInteger(detected) || !Number.isInteger(submitted) || detected < 1) return null;
  return submitted === detected
    ? `All ${detected.toLocaleString('en-IN')} pages sent`
    : `${submitted.toLocaleString('en-IN')} of ${detected.toLocaleString('en-IN')} pages sent`;
}

export default function DocumentsTab() {
  // PR-NX72 (2026-05-19) — Phase A1.1: read deal + documents + loading
  // state from the shared workspace cache (1 query) instead of running
  // a parallel useDocuments(dealId) query. Mutations below still invalidate
  // `['deal-workspace', dealId]` (see useDocuments.js lines 87, 102, 123)
  // so the shared cache refreshes automatically on upload / extract / delete.
  const { dealId, isLoading, isError, refetch } = useDealContext();
  const dealRecord = useDealRecord();
  const docs = useDealDocuments();
  const { data: extractionData } = useDealExtractions(dealId);
  useScrollOnMount();
  const uploadDoc = useUploadDocument();
  const deleteDoc = useDeleteDocument();
  const extractDoc = useExtractDocument();
  const canEdit = useCanEdit();
  const queue = useUploadQueue(uploadDoc);

  const [showUploadForm, setShowUploadForm] = useState(false);
  const [category, setCategory] = useState('other');
  const [description, setDescription] = useState('');
  const [downloading, setDownloading] = useState(null);
  const [extractingDocId, setExtractingDocId] = useState(null);
  const [autoFillOpen, setAutoFillOpen] = useState(false);
  const fileRef = useRef(null);

  // PR-NX26: count of canonical fields that have at least one extraction
  // mapped (regardless of confidence). Drives the "Auto-fill (N)" button
  // visibility — no button = no mapped extractions yet.
  const mappedFieldCount = useMemo(
    () => Object.keys(extractionData?.field_map || {}).length,
    [extractionData?.field_map],
  );

  // PR-NX72 (2026-05-19) — `docs` is now provided directly by the shared
  // `useDealDocuments()` selector (always a flat array — handles all the
  // server-side shapes internally). Removed the redundant runtime
  // array-coercion block.

  // Group by category
  const grouped = CATEGORIES.reduce((acc, cat) => {
    const items = docs.filter(
      (d) => (d.category || d.document_category || 'other') === cat.value
    );
    if (items.length > 0) acc[cat.value] = items;
    return acc;
  }, {});

  const extractionByDocument = useMemo(() => {
    const rows = extractionData?.extractions || [];
    return new Map(rows.map((item) => [item.document_id, item]));
  }, [extractionData?.extractions]);

  // Documents whose latest extraction failed or is still processing. The
  // backend lists here only those with NO usable extraction, so this never
  // collides with extractionByDocument — a failed document gets an explicit
  // "Extraction failed — retry" state instead of looking like it was never
  // extracted.
  const failureByDocument = useMemo(() => {
    const rows = extractionData?.failures || [];
    return new Map(rows.map((item) => [item.document_id, item]));
  }, [extractionData?.failures]);

  const handleFileChange = (e) => {
    queue.addFiles(e.target.files);
    // Clear the native input so re-selecting the same file re-adds it.
    if (fileRef.current) fileRef.current.value = '';
  };

  const closeUploadForm = () => {
    setShowUploadForm(false);
    queue.reset();
    setDescription('');
    setCategory('other');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (queue.counts.queued === 0) return;

    const { uploaded, failed, uploadedDocs } = await queue.run({
      dealId,
      category,
      description: description.trim() || undefined,
    });

    // ONE summary toast for the whole batch instead of N per-file toasts.
    if (uploaded > 0 && failed === 0) {
      toast.success(uploaded === 1 ? 'Document uploaded' : `${uploaded} documents uploaded`);
    } else if (uploaded > 0 && failed > 0) {
      toast.warning(`${uploaded} uploaded · ${failed} failed`);
    } else if (failed > 0) {
      toast.error(failed === 1 ? 'Upload failed' : `${failed} uploads failed`);
    }

    // Auto-extract the readable uploads, one at a time (each is a synchronous
    // provider call; serial keeps cost + the UI lock sane). Stored-only files
    // are skipped — they were accepted for the record, not for reading.
    const readable = uploadedDocs.filter((d) => d.tier !== 'stored_only');
    if (uploaded > 0 && failed === 0 && queue.counts.error === 0) {
      // Clean batch — close the form; extraction continues in the list below.
      closeUploadForm();
    }
    for (const doc of readable) {
      if (doc?.id) await handleExtract(doc); // eslint-disable-line no-await-in-loop
    }
  };

  const handleExtract = async (doc) => {
    if (!doc?.id) return;
    setExtractingDocId(doc.id);
    try {
      await extractDoc.mutateAsync({ dealId, documentId: doc.id });
    } catch {
      // Handled by mutation hook
    } finally {
      setExtractingDocId(null);
    }
  };

  const handleDelete = async (docId) => {
    const ok = await confirm({
      title: 'Delete this document?',
      message: 'This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await deleteDoc.mutateAsync({ dealId, docId });
  };

  const handleDownload = async (doc) => {
    setDownloading(doc.id);
    try {
      const res = await documentsAPI.download(dealId, doc.id);
      downloadAxiosResponse(res, doc.original_name || doc.file_name || 'document');
    } catch {
      toast.error('Download failed');
    } finally {
      setDownloading(null);
    }
  };

  if (isLoading) return <div className="py-2"><SkeletonList rows={5} columns={5} /></div>;

  if (isError) {
    return (
      <div className="card-editorial text-center py-12">
        <AlertCircle size={28} className="text-data-negative mx-auto mb-2" />
        <p className="text-sm text-data-negative mb-3">Failed to load documents.</p>
        <button onClick={refetch} className="btn btn-secondary text-sm">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Semantic search — find clauses / facts across the workspace's
          uploaded documents. Powered by pgvector + OpenAI embeddings. */}
      <SemanticSearchPanel dealId={dealId} />

      {/* PR-NX49 (2026-05-19) — AI cross-document analysis. Same Claude
          synthesis + findings as the DOCX Document-Derived Insights
          section (PR-NX45). Renders nothing when no extractions exist. */}
      <DocumentInsightsPanel dealId={dealId} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-content-secondary">
          {docs.length} document{docs.length !== 1 ? 's' : ''} uploaded
        </p>
        {canEdit && (
        <div className="flex items-center gap-2">
          {mappedFieldCount > 0 && (
            <button
              type="button"
              onClick={() => setAutoFillOpen(true)}
              className="btn btn-secondary flex items-center gap-1.5 text-sm"
              title="Review extracted fields and apply approved values to the deal"
            >
              <Sparkles size={14} className="text-accent" />
              Auto-fill from documents ({mappedFieldCount})
            </button>
          )}
          <button
            onClick={() => setShowUploadForm((v) => !v)}
            className="btn btn-primary flex items-center gap-1.5 text-sm"
          >
            <FilePlus size={14} />
            Upload Document
          </button>
        </div>
        )}
      </div>

      {/* Auto-fill modal (PR-NX26) — operator reviews mapped extractions
          and applies approved values to the deal + linked property. */}
      <AutoFillFromDocumentsModal
        dealId={dealId}
        open={autoFillOpen}
        onClose={() => setAutoFillOpen(false)}
        dealCurrentValues={dealRecord || {}}
        propertyCurrentValues={dealRecord || {}}
      />


      {/* Upload Form */}
      {showUploadForm && (
        <div className="card-editorial border-accent-200 bg-accent-50/40">
          <SectionHeader size="sm" icon={Upload} title="Upload New Document" />
          <form onSubmit={handleUpload} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="input text-sm"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description"
                  className="input text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">
                Files <span className="text-content-muted">(PDF, images, Office, CSV, JSON, KML/KMZ &amp; more · pick several · max {MAX_SIZE_MB} MB each)</span>
              </label>
              {/* Storing and reading are different limits. Saying only "max
                  50 MB" implies everything accepted can be read — the exact
                  overclaim that makes a silently-unread pack look like a
                  success. State both, and what happens when a file exceeds the
                  reader: it is kept, not lost. */}
              <p className="mt-1 text-[11px] text-content-tertiary">
                PDFs are read up to {MAX_READ_MB} MB and {MAX_READ_PAGES.toLocaleString('en-IN')} pages.
                Anything larger is still stored, versioned and downloadable — Acureal will tell you it could not read it rather than read part of it silently.
              </p>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={ACCEPT_ATTRIBUTE}
                onChange={handleFileChange}
                disabled={queue.isRunning}
                className="block w-full text-sm text-content-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-accent-soft file:text-accent hover:file:bg-accent-soft cursor-pointer disabled:opacity-60"
              />
              <p className="mt-1 text-[11px] text-content-muted">
                Acureal reads PDFs, images, spreadsheets, Word/PowerPoint, CSV/JSON and map files in English, Hindi &amp; Kannada. CAD, BIM, SketchUp and Primavera files are stored for the record but not auto-read.
              </p>
            </div>

            {queue.items.length > 0 && (
              <UploadQueueList items={queue.items} onRemove={queue.remove} isRunning={queue.isRunning} />
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={closeUploadForm}
                disabled={queue.isRunning}
                className="btn btn-secondary text-sm"
              >
                {queue.counts.done > 0 ? 'Done' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={queue.isRunning || queue.counts.queued === 0}
                className="btn btn-primary text-sm flex items-center gap-1.5"
              >
                {queue.isRunning ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Upload size={14} />
                )}
                {queue.isRunning
                  ? 'Uploading…'
                  : queue.counts.queued > 1
                    ? `Upload ${queue.counts.queued} files`
                    : 'Upload'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Documents List */}
      {docs.length === 0 ? (
        <div className="card-editorial">
          <EmptyState
            size="md"
            icon={FileText}
            title="No documents uploaded yet"
            description="Upload title documents, financial models, site photos, and legal documents for this deal."
          />
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([catKey, items]) => {
            const catConfig = CATEGORY_MAP[catKey] || CATEGORY_MAP.other;
            return (
              <div key={catKey} className="card-editorial p-0 overflow-hidden">
                <div className={clsx('px-4 py-2.5 border-b border-hairline', catConfig.color)}>
                  <span className="text-xs font-semibold uppercase tracking-wider">
                    {catConfig.label}
                  </span>
                </div>
                <ul className="divide-y divide-hairline">
                  {items.map((doc) => {
                    const extraction = extractionByDocument.get(doc.id);
                    const failure = failureByDocument.get(doc.id);
                    const canExtract = docIsExtractable(doc);
                    const isExtracting = extractingDocId === doc.id;

                    return (
                    <li
                      key={doc.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-bg-secondary"
                    >
                      <FileText size={18} className="text-content-muted flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-content-primary truncate">
                          {doc.original_name || doc.file_name || 'Untitled'}
                        </p>
                        <p className="text-xs text-content-muted">
                          {formatBytes(doc.file_size)} ·{' '}
                          {formatDate(doc.uploaded_at || doc.created_at)}
                          {doc.description && ` · ${doc.description}`}
                          {extraction && extraction.has_data && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-hairline bg-pos-soft px-1.5 py-0.5 text-[10px] font-medium text-data-positive">
                              <CheckCircle2 size={10} />
                              {formatDocType(extraction.doc_type)}
                            </span>
                          )}
                          {/* Coverage receipt — Acureal's account of what it did
                              with every page. A doc-type chip says WHAT was
                              found; this says HOW MUCH of the document was
                              actually sent to the reader, which is the part a
                              reviewer cannot otherwise know. Deliberately says
                              "sent", never "read". Absent on documents
                              extracted before the receipt existed — in which
                              case we show nothing rather than guess. */}
                          {coverageLabel(extraction) && (
                            <span
                              className="ml-2 inline-flex items-center gap-1 rounded-full border border-hairline bg-bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-content-secondary tabular-nums"
                              title={extraction.coverage?.summary || undefined}
                            >
                              <FileStack size={10} />
                              {coverageLabel(extraction)}
                            </span>
                          )}
                          {extraction && !extraction.has_data && (
                            <span
                              className="ml-2 inline-flex items-center gap-1 rounded-full border border-hairline bg-bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-content-muted"
                              title="The document was processed but no extractable fields were found in it."
                            >
                              <AlertCircle size={10} />
                              No fields found
                            </span>
                          )}
                          {!extraction && failure?.status === 'failed' && (
                            <span
                              className="ml-2 inline-flex items-center gap-1 rounded-full border border-hairline bg-neg-soft px-1.5 py-0.5 text-[10px] font-medium text-data-negative"
                              title={failure.error_message || 'Extraction failed. Use the extract button to retry.'}
                            >
                              <AlertCircle size={10} />
                              Extraction failed
                            </span>
                          )}
                          {!extraction && failure?.status === 'processing' && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-hairline bg-premium-soft px-1.5 py-0.5 text-[10px] font-medium text-premium">
                              <Loader2 size={10} className="animate-spin motion-reduce:animate-none" />
                              Extracting…
                            </span>
                          )}
                          {/* Stored-only formats carry no extract button —
                              explain the absence honestly rather than leaving
                              a mystery. */}
                          {!canExtract && (
                            <span
                              className="ml-2 inline-flex items-center gap-1 rounded-full border border-hairline bg-bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-content-muted"
                              title={`${docLabel(doc)} files are stored and downloadable, but Acureal cannot read them with AI yet.`}
                            >
                              <FileText size={10} />
                              Stored · not AI-readable
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {canEdit && canExtract && (
                          <button
                            onClick={() => handleExtract(doc)}
                            disabled={isExtracting || extractingDocId !== null}
                            className="p-1.5 text-content-muted hover:text-accent hover:bg-accent-soft rounded-lg transition-colors disabled:opacity-50"
                            title={extraction ? 'Re-run extraction' : failure ? 'Retry extraction' : 'Extract evidence'}
                          >
                            {isExtracting ? (
                              <Loader2 size={15} className="animate-spin" />
                            ) : (
                              <FileSearch size={15} />
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => handleDownload(doc)}
                          disabled={downloading === doc.id}
                          className="p-1.5 text-content-muted hover:text-accent hover:bg-accent-soft rounded-lg transition-colors"
                          title="Download"
                        >
                          {downloading === doc.id ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <Download size={15} />
                          )}
                        </button>
                        {/* E2-PR1 (2026-05-27) — reverse provenance:
                            "what depends on this document?" Operator
                            clicks to see every DD item / approval / risk
                            flag / scenario across the org that cites this
                            file. Defensible-retraction surface. */}
                        <DependentsPopover
                          sourceKind="document"
                          sourceId={doc.id}
                          triggerLabel="Dependents"
                          renderTrigger={({ onOpen, open: openState }) => (
                            <button
                              type="button"
                              onClick={onOpen}
                              className={clsx(
                                'p-1.5 rounded-lg transition-colors',
                                openState
                                  ? 'text-accent bg-accent-soft'
                                  : 'text-content-muted hover:text-accent hover:bg-accent-soft',
                              )}
                              title="See what cites this document (DD / approvals / risk / scenarios)"
                              aria-label="Show dependents"
                            >
                              <Network size={15} />
                            </button>
                          )}
                        />
                        {canEdit && (
                          <button
                            onClick={() => handleDelete(doc.id)}
                            disabled={deleteDoc.isPending}
                            className="p-1.5 text-content-muted hover:text-data-negative hover:bg-neg-soft rounded-lg transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
