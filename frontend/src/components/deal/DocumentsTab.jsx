import { useMemo, useState, useRef } from 'react';
import EmptyState from '../common/EmptyState';
import {
  Upload,
  Download,
  Trash2,
  FileText,
  FilePlus,
  FileSearch,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { clsx } from 'clsx';
// PR-NX72 (2026-05-19) — Phase A1.1: DocumentsTab read path migrated from
// its own `useDocuments(dealId)` React-Query call to the shared
// `useDealDocuments()` selector backed by the workspace endpoint. One
// network round-trip per deal page load (workspace) instead of two (deal
// metadata + documents). Mutations stay on useUploadDocument /
// useDeleteDocument / useExtractDocument — they already invalidate the
// `['deal-workspace', dealId]` query key so the shared cache stays fresh.
import { useUploadDocument, useDeleteDocument, useExtractDocument } from '../../hooks/useDocuments';
import { useDealExtractions } from '../../hooks/useDealExtractions';
import { useDealContext, useDealRecord, useDealDocuments } from '../../hooks/useDealContext';
import { documentsAPI } from '../../services/api';
import { toast } from '../common/Toast';
import { SectionHeader, SkeletonList, confirm } from '../../design-system';
import SemanticSearchPanel from '../common/SemanticSearchPanel';
import AutoFillFromDocumentsModal from './AutoFillFromDocumentsModal';
// PR-NX49 (2026-05-19) — surface Claude's cross-document analysis +
// inconsistency findings inline on the Documents tab. Same content
// that ships in the DOCX Document-Derived Insights section (PR-NX45).
import DocumentInsightsPanel from './DocumentInsightsPanel';
import { formatDate } from '../../utils/format';
import { downloadAxiosResponse } from '../../utils/download';

const CATEGORIES = [
  { value: 'om', label: 'OM / Offering Memo', color: 'bg-blue-100 text-blue-700' },
  { value: 'financials', label: 'Financials', color: 'bg-green-100 text-green-700' },
  { value: 'legal', label: 'Legal', color: 'bg-amber-100 text-amber-700' },
  { value: 'technical', label: 'Technical', color: 'bg-cyan-100 text-cyan-700' },
  { value: 'approvals', label: 'Approvals', color: 'bg-purple-100 text-purple-700' },
  { value: 'other', label: 'Other', color: 'bg-bg-secondary text-content-secondary' },
];

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.value, c]));

const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
];
const MAX_SIZE_MB = 50;

function formatBytes(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPdfDocument(doc) {
  const type = String(doc?.file_type || doc?.mime_type || doc?.type || '').toLowerCase();
  const name = String(doc?.original_name || doc?.file_name || doc?.name || '').toLowerCase();
  return type.includes('pdf') || name.endsWith('.pdf');
}

function formatDocType(docType) {
  return docType ? docType.replace(/_/g, ' ') : 'extracted';
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
  const uploadDoc = useUploadDocument();
  const deleteDoc = useDeleteDocument();
  const extractDoc = useExtractDocument();

  const [showUploadForm, setShowUploadForm] = useState(false);
  const [category, setCategory] = useState('other');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
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

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    setFileError('');
    if (!selected) {
      setFile(null);
      return;
    }
    if (!ALLOWED_TYPES.includes(selected.type)) {
      setFileError('Only PDF, DOC, DOCX, XLS, XLSX, PNG, JPG files are allowed.');
      setFile(null);
      return;
    }
    if (selected.size > MAX_SIZE_MB * 1024 * 1024) {
      setFileError(`File must be under ${MAX_SIZE_MB} MB.`);
      setFile(null);
      return;
    }
    setFile(selected);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) {
      setFileError('Please select a file.');
      return;
    }

    try {
      const uploaded = await uploadDoc.mutateAsync({
        dealId,
        file,
        category,
        description: description.trim() || undefined,
      });
      const uploadedDoc = uploaded?.data || uploaded;
      setShowUploadForm(false);
      setFile(null);
      setDescription('');
      setCategory('other');
      if (fileRef.current) fileRef.current.value = '';
      if (uploadedDoc?.id && isPdfDocument(file)) {
        await handleExtract(uploadedDoc);
      }
    } catch {
      // Handled by mutation hook
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
        <AlertCircle size={28} className="text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-600 mb-3">Failed to load documents.</p>
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
                File <span className="text-content-muted">(PDF, DOC, DOCX, XLS, XLSX, PNG, JPG · max 50 MB)</span>
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                onChange={handleFileChange}
                className="block w-full text-sm text-content-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
              />
              {fileError && <p className="text-xs text-red-600 mt-1">{fileError}</p>}
              {file && !fileError && (
                <p className="text-xs text-content-secondary mt-1">
                  {file.name} · {formatBytes(file.size)}
                </p>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowUploadForm(false);
                  setFile(null);
                  setFileError('');
                }}
                className="btn btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={uploadDoc.isPending || !file}
                className="btn btn-primary text-sm flex items-center gap-1.5"
              >
                {uploadDoc.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Upload size={14} />
                )}
                {uploadDoc.isPending ? 'Uploading...' : 'Upload'}
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
                    const canExtract = isPdfDocument(doc);
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
                          {extraction && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                              <CheckCircle2 size={10} />
                              {formatDocType(extraction.doc_type)}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {canExtract && (
                          <button
                            onClick={() => handleExtract(doc)}
                            disabled={isExtracting || extractingDocId !== null}
                            className="p-1.5 text-content-muted hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors disabled:opacity-50"
                            title={extraction ? 'Re-run extraction' : 'Extract evidence'}
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
                          className="p-1.5 text-content-muted hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                          title="Download"
                        >
                          {downloading === doc.id ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <Download size={15} />
                          )}
                        </button>
                        <button
                          onClick={() => handleDelete(doc.id)}
                          disabled={deleteDoc.isPending}
                          className="p-1.5 text-content-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={15} />
                        </button>
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
