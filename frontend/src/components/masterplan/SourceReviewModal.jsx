import { useEffect, useState, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import {
  SOURCE_DOC_TYPES,
  SOURCE_ROLES,
  LEGAL_STATUSES,
  PROCESSING_MODES,
  ratioToPct,
  pctToRatio,
} from '../../utils/masterPlanHelpers';
import useFocusTrap from '../../hooks/useFocusTrap';
import useScrollLock from '../../hooks/useScrollLock';

/**
 * Operator-facing modal for editing a master-plan source document's metadata.
 *
 * Extracted from `pages/MasterPlanAdminPage.jsx` as part of the Task #6
 * decomposition (Tier B — modal extractions). Behaviour-preserving move,
 * no logic changes.
 *
 * Props:
 *   - doc:        the source document being reviewed (shape from the
 *                 master-plan documents endpoint)
 *   - isOpen:     whether the modal is currently mounted
 *   - onClose:    closes the modal without saving
 *   - onSubmit:   called with the normalised payload on save
 *   - submitting: disables the save button while a mutation is in flight
 */
export default function SourceReviewModal({ doc, isOpen, onClose, onSubmit, submitting }) {
  const [form, setForm] = useState({
    docType: 'rmp_table',
    sourceRole: '',
    legalStatus: '',
    authorityName: '',
    publishedOn: '',
    sourceUrl: '',
    pageCount: '',
    processingMode: 'text_extraction',
    textCoveragePct: '',
    ocrRequired: false,
    sourceConfidencePct: '',
    registryNotes: '',
  });

  // Trap focus + lock body scroll while open; onClose stabilised so a re-render
  // doesn't re-arm the trap mid-typing.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  const handleClose = useCallback(() => onCloseRef.current?.(), []);
  const trapRef = useFocusTrap(isOpen, { onEscape: handleClose });
  useScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen || !doc) return;
    setForm({
      docType: doc.doc_type || 'rmp_table',
      sourceRole: doc.source_role || '',
      legalStatus: doc.legal_status || '',
      authorityName: doc.authority_name || '',
      publishedOn: doc.published_on ? String(doc.published_on).slice(0, 10) : '',
      sourceUrl: doc.source_url || '',
      pageCount: doc.page_count ?? '',
      processingMode: doc.processing_mode || 'text_extraction',
      textCoveragePct: ratioToPct(doc.text_coverage_ratio),
      ocrRequired: Boolean(doc.ocr_required),
      sourceConfidencePct: ratioToPct(doc.source_confidence),
      registryNotes: doc.registry_notes || '',
    });
  }, [doc, isOpen]);

  if (!isOpen || !doc) return null;

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (event) => {
    event.preventDefault();
    const processingMode = form.processingMode || 'text_extraction';
    onSubmit({
      docType: form.docType || null,
      sourceRole: form.sourceRole || null,
      legalStatus: form.legalStatus || null,
      authorityName: form.authorityName.trim() || null,
      publishedOn: form.publishedOn || null,
      sourceUrl: form.sourceUrl.trim() || null,
      pageCount: form.pageCount === '' ? null : Number(form.pageCount),
      processingMode,
      textCoverageRatio: pctToRatio(form.textCoveragePct),
      ocrRequired: form.ocrRequired || processingMode === 'ocr_required' || processingMode === 'image_review',
      sourceConfidence: pctToRatio(form.sourceConfidencePct),
      registryNotes: form.registryNotes.trim() || null,
      changeReason: 'source registry review',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-review-title"
        className="relative mx-4 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-bg-elevated p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="source-review-title" className="truncate text-lg font-semibold text-content-primary">
              Review source metadata
            </h2>
            <p className="mt-0.5 truncate text-xs text-content-secondary">{doc.plan_name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-content-muted transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98]"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label htmlFor="source-review-doc-type" className="block text-xs font-medium text-content-secondary mb-1">Document type</label>
              <select id="source-review-doc-type" className="input text-sm" value={form.docType} onChange={(e) => set('docType', e.target.value)}>
                {SOURCE_DOC_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="source-review-role" className="block text-xs font-medium text-content-secondary mb-1">Source role</label>
              <select id="source-review-role" className="input text-sm" value={form.sourceRole} onChange={(e) => set('sourceRole', e.target.value)}>
                {SOURCE_ROLES.map((role) => (
                  <option key={role.value || 'none'} value={role.value}>{role.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="source-review-legal-status" className="block text-xs font-medium text-content-secondary mb-1">Legal status</label>
              <select id="source-review-legal-status" className="input text-sm" value={form.legalStatus} onChange={(e) => set('legalStatus', e.target.value)}>
                {LEGAL_STATUSES.map((status) => (
                  <option key={status.value || 'none'} value={status.value}>{status.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label htmlFor="source-review-authority" className="block text-xs font-medium text-content-secondary mb-1">Authority</label>
              <input id="source-review-authority" className="input text-sm" value={form.authorityName} onChange={(e) => set('authorityName', e.target.value)} placeholder="BDA / BBMP" />
            </div>
            <div>
              <label htmlFor="source-review-published" className="block text-xs font-medium text-content-secondary mb-1">Published on</label>
              <input id="source-review-published" type="date" className="input text-sm" value={form.publishedOn} onChange={(e) => set('publishedOn', e.target.value)} />
            </div>
            <div>
              <label htmlFor="source-review-pages" className="block text-xs font-medium text-content-secondary mb-1">Page count</label>
              <input id="source-review-pages" type="number" min="1" className="input text-sm" value={form.pageCount} onChange={(e) => set('pageCount', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr),160px,160px]">
            <div>
              <label htmlFor="source-review-processing" className="block text-xs font-medium text-content-secondary mb-1">Processing</label>
              <select id="source-review-processing" className="input text-sm" value={form.processingMode} onChange={(e) => set('processingMode', e.target.value)}>
                {PROCESSING_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>{mode.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="source-review-coverage" className="block text-xs font-medium text-content-secondary mb-1">Text coverage %</label>
              <input id="source-review-coverage" type="number" min="0" max="100" className="input text-sm" value={form.textCoveragePct} onChange={(e) => set('textCoveragePct', e.target.value)} />
            </div>
            <div>
              <label htmlFor="source-review-confidence" className="block text-xs font-medium text-content-secondary mb-1">Confidence %</label>
              <input id="source-review-confidence" type="number" min="0" max="100" className="input text-sm" value={form.sourceConfidencePct} onChange={(e) => set('sourceConfidencePct', e.target.value)} />
            </div>
          </div>

          <div>
            <label htmlFor="source-review-url" className="block text-xs font-medium text-content-secondary mb-1">Source URL</label>
            <input id="source-review-url" className="input text-sm" value={form.sourceUrl} onChange={(e) => set('sourceUrl', e.target.value)} placeholder="Official page or archive URL" />
          </div>

          <div>
            <label htmlFor="source-review-notes" className="block text-xs font-medium text-content-secondary mb-1">Registry notes</label>
            <textarea id="source-review-notes" rows={3} className="input text-sm" value={form.registryNotes} onChange={(e) => set('registryNotes', e.target.value)} placeholder="OCR completed, image review pending, derived source, authority caveat..." />
          </div>

          <div className="flex flex-col gap-3 border-t border-hairline pt-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-hairline px-3 text-xs font-medium text-content-secondary transition-colors duration-150 ease-out hover:bg-bg-secondary focus-within:ring-2 focus-within:ring-primary-500/40 active:scale-[0.99]">
              <input
                type="checkbox"
                checked={form.ocrRequired}
                onChange={(e) => set('ocrRequired', e.target.checked)}
                className="h-4 w-4 rounded border-hairline text-primary-600 focus:ring-primary-500/40"
              />
              OCR needed
            </label>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="btn btn-secondary text-sm">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="btn btn-primary text-sm">
                {submitting ? 'Saving...' : 'Save review'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
