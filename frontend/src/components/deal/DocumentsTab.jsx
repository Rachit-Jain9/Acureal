import { useState, useRef } from 'react';
import {
  Upload,
  Download,
  Trash2,
  FileText,
  FilePlus,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useDocuments, useUploadDocument, useDeleteDocument } from '../../hooks/useDocuments';
import { documentsAPI } from '../../services/api';
import { toast } from '../common/Toast';
import LoadingSpinner from '../common/LoadingSpinner';
import { formatDate } from '../../utils/format';

const CATEGORIES = [
  { value: 'om', label: 'OM / Offering Memo', color: 'bg-blue-100 text-blue-700' },
  { value: 'financials', label: 'Financials', color: 'bg-green-100 text-green-700' },
  { value: 'legal', label: 'Legal', color: 'bg-amber-100 text-amber-700' },
  { value: 'technical', label: 'Technical', color: 'bg-cyan-100 text-cyan-700' },
  { value: 'approvals', label: 'Approvals', color: 'bg-purple-100 text-purple-700' },
  { value: 'other', label: 'Other', color: 'bg-gray-100 text-gray-700' },
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
const MAX_SIZE_MB = 10;

function formatBytes(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsTab({ dealId }) {
  const { data: docsData, isLoading, isError, refetch } = useDocuments(dealId);
  const uploadDoc = useUploadDocument();
  const deleteDoc = useDeleteDocument();

  const [showUploadForm, setShowUploadForm] = useState(false);
  const [category, setCategory] = useState('other');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [downloading, setDownloading] = useState(null);
  const fileRef = useRef(null);

  // The API returns { data: [...] } or an array directly
  const docs = Array.isArray(docsData)
    ? docsData
    : Array.isArray(docsData?.documents)
      ? docsData.documents
      : Array.isArray(docsData?.data)
        ? docsData.data
      : [];

  // Group by category
  const grouped = CATEGORIES.reduce((acc, cat) => {
    const items = docs.filter(
      (d) => (d.category || d.document_category || 'other') === cat.value
    );
    if (items.length > 0) acc[cat.value] = items;
    return acc;
  }, {});

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
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);
    if (description.trim()) formData.append('description', description.trim());

    try {
      await uploadDoc.mutateAsync({ dealId, formData });
      setShowUploadForm(false);
      setFile(null);
      setDescription('');
      setCategory('other');
      if (fileRef.current) fileRef.current.value = '';
    } catch {
      // Handled by mutation hook
    }
  };

  const handleDelete = async (docId) => {
    if (!window.confirm('Delete this document? This cannot be undone.')) return;
    await deleteDoc.mutateAsync({ dealId, docId });
  };

  const handleDownload = async (doc) => {
    setDownloading(doc.id);
    try {
      const res = await documentsAPI.download(dealId, doc.id);
      // Expect a signed URL or blob
      const url = res.data?.url || res.data?.data?.url;
      if (url) {
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.original_name || doc.file_name || 'document';
        a.target = '_blank';
        a.click();
      } else {
        toast.error('Download link unavailable');
      }
    } catch {
      toast.error('Download failed');
    } finally {
      setDownloading(null);
    }
  };

  if (isLoading) return <LoadingSpinner className="py-16" />;

  if (isError) {
    return (
      <div className="card text-center py-12">
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {docs.length} document{docs.length !== 1 ? 's' : ''} uploaded
        </p>
        <button
          onClick={() => setShowUploadForm((v) => !v)}
          className="btn btn-primary flex items-center gap-1.5 text-sm"
        >
          <FilePlus size={14} />
          Upload Document
        </button>
      </div>

      {/* Upload Form */}
      {showUploadForm && (
        <div className="card border-primary-200 bg-primary-50/30">
          <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Upload size={15} className="text-primary-600" />
            Upload New Document
          </h3>
          <form onSubmit={handleUpload} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
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
                <label className="block text-xs font-medium text-gray-700 mb-1">
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
              <label className="block text-xs font-medium text-gray-700 mb-1">
                File <span className="text-gray-400">(PDF, DOC, DOCX, XLS, XLSX, PNG, JPG · max 10 MB)</span>
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
              />
              {fileError && <p className="text-xs text-red-600 mt-1">{fileError}</p>}
              {file && !fileError && (
                <p className="text-xs text-gray-500 mt-1">
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
        <div className="card text-center py-16">
          <FileText size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-600 mb-1">No documents uploaded yet</p>
          <p className="text-xs text-gray-400">
            Upload title documents, financial models, site photos, and legal documents for this
            deal.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([catKey, items]) => {
            const catConfig = CATEGORY_MAP[catKey] || CATEGORY_MAP.other;
            return (
              <div key={catKey} className="card p-0 overflow-hidden">
                <div className={clsx('px-4 py-2.5 border-b border-gray-100', catConfig.color)}>
                  <span className="text-xs font-semibold uppercase tracking-wider">
                    {catConfig.label}
                  </span>
                </div>
                <ul className="divide-y divide-gray-100">
                  {items.map((doc) => (
                    <li
                      key={doc.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50"
                    >
                      <FileText size={18} className="text-gray-300 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {doc.original_name || doc.file_name || 'Untitled'}
                        </p>
                        <p className="text-xs text-gray-400">
                          {formatBytes(doc.file_size)} ·{' '}
                          {formatDate(doc.uploaded_at || doc.created_at)}
                          {doc.description && ` · ${doc.description}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleDownload(doc)}
                          disabled={downloading === doc.id}
                          className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
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
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
