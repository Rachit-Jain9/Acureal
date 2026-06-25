import { useRef, useCallback, useEffect } from 'react';
import { FileText, Loader2, RefreshCw, X } from 'lucide-react';
import Badge from '../common/Badge';
import { ErrorState, Skeleton } from '../../design-system';
import { formatPercent, pageStatusTone } from '../../utils/masterPlanHelpers';
import useFocusTrap from '../../hooks/useFocusTrap';
import useScrollLock from '../../hooks/useScrollLock';

/**
 * Page-level source ledger modal — shows the page-by-page OCR / review
 * status for a master-plan source PDF, with a control to prepare empty
 * page rows before OCR or citation anchoring runs.
 *
 * Extracted from `pages/MasterPlanAdminPage.jsx` as part of the Task #6
 * decomposition (Tier B — modal extractions). Behaviour-preserving move,
 * no logic changes.
 *
 * Props:
 *   - doc:       the source document whose page ledger is being viewed
 *   - isOpen:    whether the modal is currently mounted
 *   - onClose:   closes the modal
 *   - data:      payload from the page-ledger endpoint
 *                ({ pages, schema_ready, message? })
 *   - isLoading: shows skeleton rows while the page fetch is in flight
 *   - isError:   shows the error panel with a retry button
 *   - onRetry:   called when the user clicks Retry on the error state
 *   - onPrepare: called when the user clicks "Prepare pages" / "Fill missing"
 *   - preparing: disables the prepare button while the mutation runs
 */
export default function SourcePagesModal({
  doc,
  isOpen,
  onClose,
  data,
  isLoading,
  isError,
  onRetry,
  onPrepare,
  preparing,
}) {
  // Trap focus + lock body scroll while open; onClose stabilised so a re-render
  // doesn't re-arm the trap. Hooks run before the early return below.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  const handleClose = useCallback(() => onCloseRef.current?.(), []);
  const trapRef = useFocusTrap(isOpen, { onEscape: handleClose });
  useScrollLock(isOpen);

  if (!isOpen || !doc) return null;

  const pages = data?.pages || [];
  const schemaReady = data?.schema_ready !== false;
  const canPrepare = schemaReady && Number(doc.page_count) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40 transition-opacity duration-150 ease-out" onClick={onClose} />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-pages-title"
        className="relative mx-4 max-h-[84vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-bg-elevated p-6 shadow-xl motion-safe:animate-[fadeInUp_220ms_cubic-bezier(0.16,1,0.3,1)]"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="source-pages-title" className="truncate text-lg font-semibold text-content-primary">
              Source page ledger
            </h2>
            <p className="mt-0.5 truncate text-xs text-content-secondary">{doc.plan_name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close source page ledger"
            className="rounded-lg p-1.5 text-content-muted transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
          >
            <X size={18} />
          </button>
        </div>

        {isLoading ? (
          <div role="status" aria-busy="true" className="space-y-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="rounded-lg border border-hairline bg-bg-elevated p-3">
                <Skeleton className="h-3 w-28 rounded" />
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Skeleton className="h-8 rounded" />
                  <Skeleton className="h-8 rounded" />
                  <Skeleton className="h-8 rounded" />
                </div>
              </div>
            ))}
            <span className="sr-only">Loading source page ledger</span>
          </div>
        ) : isError ? (
          <ErrorState
            tone="danger"
            title="Could not load page ledger"
            action={(
              <button
                type="button"
                onClick={onRetry}
                className="rounded-lg border border-hairline bg-bg-elevated px-3 py-1.5 text-xs font-medium text-content-secondary transition-colors duration-150 ease-out hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
              >
                Retry
              </button>
            )}
          >
            Page-level source review could not be loaded.
          </ErrorState>
        ) : !schemaReady ? (
          <ErrorState tone="warn" title="Page storage not applied yet">
            {data?.message || 'Apply the page-level source storage migration before preparing OCR pages.'}
          </ErrorState>
        ) : pages.length === 0 ? (
          <div className="rounded-lg border border-hairline bg-bg-elevated px-4 py-8 text-center">
            <p className="text-sm font-medium text-content-primary">No pages prepared yet.</p>
            <p className="mt-1 text-xs text-content-secondary">
              {canPrepare
                ? 'Prepare empty page rows before OCR, citation anchoring, or reviewer notes are attached.'
                : 'Set a page count in source review before preparing the page ledger.'}
            </p>
            <button
              type="button"
              onClick={onPrepare}
              disabled={!canPrepare || preparing}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent transition-colors duration-150 ease-out hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {preparing ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
              {preparing ? 'Preparing...' : 'Prepare pages'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Badge tone="neutral">{pages.length} page{pages.length === 1 ? '' : 's'}</Badge>
              <button
                type="button"
                onClick={onPrepare}
                disabled={!canPrepare || preparing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-bg-elevated px-3 py-1.5 text-xs font-medium text-content-secondary transition-colors duration-150 ease-out hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {preparing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {preparing ? 'Preparing...' : 'Fill missing pages'}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {pages.map((page) => (
                <article key={page.id || page.page_number} className="rounded-lg border border-hairline bg-bg-elevated p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-content-primary">Page {page.page_number}</p>
                      <p className="mt-0.5 text-xs text-content-secondary">{page.page_label || 'No page label'}</p>
                    </div>
                    <Badge tone={pageStatusTone(page.ocr_status)}>{String(page.ocr_status || 'not_started').replace(/_/g, ' ')}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge tone={pageStatusTone(page.review_status)}>{String(page.review_status || 'pending').replace(/_/g, ' ')}</Badge>
                    {formatPercent(page.text_coverage_ratio) && (
                      <Badge tone="neutral">Text {formatPercent(page.text_coverage_ratio)}</Badge>
                    )}
                    {page.confidence_score !== null && page.confidence_score !== undefined && (
                      <Badge tone="neutral">Confidence {formatPercent(page.confidence_score)}</Badge>
                    )}
                  </div>
                  <p className="mt-3 line-clamp-2 text-xs text-content-muted">
                    {page.reviewer_notes || page.page_checksum_sha256 || 'OCR text and citation anchors are not stored for this page yet.'}
                  </p>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
