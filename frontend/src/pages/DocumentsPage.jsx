import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Upload,
  FileText,
  Download,
  Trash2,
  FolderOpen,
  File,
  Search,
} from 'lucide-react';
import { useDocumentDealOptions, useDocuments, useUploadDocument, useDeleteDocument } from '../hooks/useDocuments';
import LoadingSpinner from '../components/common/LoadingSpinner';
import EmptyState from '../components/common/EmptyState';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { formatRelativeTime } from '../utils/format';
import { documentsAPI } from '../services/api';
import { toast } from '../components/common/Toast';
import { downloadAxiosResponse } from '../utils/download';

const CATEGORIES = [
  { value: 'om', label: 'Offering Memorandum' },
  { value: 'financials', label: 'Financials' },
  { value: 'legal', label: 'Legal' },
  { value: 'technical', label: 'Technical' },
  { value: 'approvals', label: 'Approvals' },
  { value: 'other', label: 'Other' },
];

const CATEGORY_COLORS = {
  om: 'bg-blue-100 text-blue-800',
  financials: 'bg-green-100 text-green-800',
  legal: 'bg-purple-100 text-purple-800',
  technical: 'bg-orange-100 text-orange-800',
  approvals: 'bg-yellow-100 text-yellow-800',
  other: 'bg-gray-100 text-gray-800',
};

export default function DocumentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedDealId, setSelectedDealId] = useState(searchParams.get('dealId') || '');
  const [uploadCategory, setUploadCategory] = useState('other');
  const [description, setDescription] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    const dealIdFromUrl = searchParams.get('dealId') || '';
    if (dealIdFromUrl !== selectedDealId) {
      setSelectedDealId(dealIdFromUrl);
    }
  }, [searchParams, selectedDealId]);

  const { data: dealOptions = [] } = useDocumentDealOptions();

  const { data: documents, isLoading: docsLoading } = useDocuments(selectedDealId);
  const docsList = documents?.documents || [];

  const uploadMutation = useUploadDocument();
  const deleteMutation = useDeleteDocument();

  const handleDealChange = (dealId) => {
    setSelectedDealId(dealId);
    if (dealId) {
      setSearchParams({ dealId });
    } else {
      setSearchParams({});
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];

    if (!file) {
      toast.error('Please select a file');
      return;
    }

    if (!selectedDealId) {
      toast.error('Please select a deal first');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', uploadCategory);
    if (description.trim()) formData.append('description', description.trim());

    uploadMutation.mutate(
      { dealId: selectedDealId, formData },
      {
        onSuccess: () => {
          if (fileRef.current) {
            fileRef.current.value = '';
          }
          setDescription('');
          setUploadCategory('other');
        },
      }
    );
  };

  const handleDownload = async (doc) => {
    try {
      const response = await documentsAPI.download(selectedDealId, doc.id);
      downloadAxiosResponse(response, doc.name || 'document');
    } catch {
      toast.error('Download failed');
    }
  };

  const handleDelete = (doc) => {
    if (!window.confirm(`Delete "${doc.name}"?`)) return;
    deleteMutation.mutate({ dealId: selectedDealId, docId: doc.id });
  };

  const grouped = docsList.reduce((acc, doc) => {
    const category = doc.doc_category || 'other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(doc);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        description="Manage deal documents and files"
      />

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">Select Deal</label>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <select
            value={selectedDealId}
            onChange={(e) => handleDealChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">-- Choose a deal --</option>
            {dealOptions.map((deal) => (
              <option key={deal.id} value={deal.id}>
                {deal.name} {deal.city ? `(${deal.city})` : ''} {deal.stage ? `- ${deal.stage.replace(/_/g, ' ')}` : ''}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Live deals are shown first. Archived deals are hidden from this selector until they are restored.
        </p>
      </div>

      {!selectedDealId ? (
        <EmptyState
          icon={FolderOpen}
          title="No deal selected"
          description="Select a deal above to view and manage its documents."
        />
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Upload size={16} />
              Upload Document
            </h3>
            <form onSubmit={handleUpload} className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs text-gray-500 mb-1">File</label>
                <input
                  ref={fileRef}
                  type="file"
                  className="w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                />
              </div>
              <div className="w-44">
                <label className="block text-xs text-gray-500 mb-1">Category</label>
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                  className="input"
                >
                  {CATEGORIES.map((category) => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs text-gray-500 mb-1">Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                  className="input"
                />
              </div>
              <button
                type="submit"
                disabled={uploadMutation.isPending}
                className="btn btn-primary"
              >
                <Upload size={14} />
                {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
              </button>
            </form>
          </div>

          {docsLoading ? (
            <LoadingSpinner />
          ) : docsList.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No documents yet"
              description="Upload your first document using the form above."
            />
          ) : (
            <div className="space-y-6">
              {CATEGORIES.map(({ value, label }) => {
                const docs = grouped[value];
                if (!docs || docs.length === 0) return null;

                return (
                  <div key={value} className="bg-white rounded-xl shadow-sm border border-gray-200">
                    <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
                      <Badge className={CATEGORY_COLORS[value]}>{label}</Badge>
                      <span className="text-xs text-gray-500">
                        {docs.length} file{docs.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <ul className="divide-y divide-gray-100">
                      {docs.map((doc) => (
                        <li key={doc.id} className="px-6 py-3 flex items-center justify-between hover:bg-gray-50">
                          <div className="flex items-center gap-3 min-w-0">
                            <File size={18} className="text-gray-400 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{doc.name}</p>
                              {doc.description && (
                                <p className="text-xs text-gray-500 truncate">{doc.description}</p>
                              )}
                              <p className="text-xs text-gray-400">
                                {formatRelativeTime(doc.created_at)}
                                {doc.uploaded_by_name && ` by ${doc.uploaded_by_name}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-4">
                            <button
                              onClick={() => handleDownload(doc)}
                              className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition"
                              title="Download"
                            >
                              <Download size={16} />
                            </button>
                            <button
                              onClick={() => handleDelete(doc)}
                              disabled={deleteMutation.isPending}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                              title="Delete"
                            >
                              <Trash2 size={16} />
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
        </>
      )}
    </div>
  );
}
