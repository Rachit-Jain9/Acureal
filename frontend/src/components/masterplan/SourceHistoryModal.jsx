import { X } from 'lucide-react';
import Badge from '../common/Badge';
import { ErrorState } from '../../design-system';
import {
  formatHistoryDate,
  formatHistoryField,
  formatHistoryValue,
  normalizePreviousValues,
} from '../../utils/masterPlanHelpers';

/**
 * Read-only audit-trail modal showing the version history of a master-plan
 * source document's metadata edits.
 *
 * Extracted from `pages/MasterPlanAdminPage.jsx` as part of the Task #6
 * decomposition (Tier B — modal extractions). Behaviour-preserving move,
 * no logic changes.
 *
 * Props:
 *   - doc:       the source document whose history is being viewed
 *   - isOpen:    whether the modal is currently mounted
 *   - onClose:   closes the modal
 *   - versions:  the version-history payload (array; default [])
 *   - isLoading: shows skeleton rows while the history fetch is in flight
 *   - isError:   shows an error panel with a retry button
 *   - onRetry:   called when the user clicks Retry on the error state
 */
export default function SourceHistoryModal({
  doc,
  isOpen,
  onClose,
  versions = [],
  isLoading,
  isError,
  onRetry,
}) {
  if (!isOpen || !doc) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40 transition-opacity duration-150 ease-out" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-history-title"
        className="relative mx-4 max-h-[84vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-bg-elevated p-6 shadow-xl motion-safe:animate-[fadeInUp_220ms_cubic-bezier(0.16,1,0.3,1)]"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="source-history-title" className="truncate text-lg font-semibold text-content-primary">
              Source review history
            </h2>
            <p className="mt-0.5 truncate text-xs text-content-secondary">{doc.plan_name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close source review history"
            className="rounded-lg p-1.5 text-content-muted transition-colors duration-150 ease-out hover:bg-bg-secondary hover:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98]"
          >
            <X size={18} />
          </button>
        </div>

        {isLoading ? (
          <div role="status" aria-busy="true" className="space-y-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="rounded-lg border border-hairline bg-bg-elevated p-3">
                <div className="h-3 w-36 rounded bg-bg-secondary animate-pulse" />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="h-8 rounded bg-bg-secondary animate-pulse" />
                  <div className="h-8 rounded bg-bg-secondary animate-pulse" />
                </div>
              </div>
            ))}
            <span className="sr-only">Loading source review history</span>
          </div>
        ) : isError ? (
          <ErrorState
            tone="danger"
            title="Could not load history"
            action={(
              <button
                type="button"
                onClick={onRetry}
                className="rounded-lg border border-hairline bg-bg-elevated px-3 py-1.5 text-xs font-medium text-content-secondary transition-colors duration-150 ease-out hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 active:scale-[0.98]"
              >
                Retry
              </button>
            )}
          >
            The source registry kept the edit, but the history list could not be loaded.
          </ErrorState>
        ) : versions.length === 0 ? (
          <div className="rounded-lg border border-hairline bg-bg-elevated px-4 py-8 text-center">
            <p className="text-sm font-medium text-content-primary">No source review history yet.</p>
            <p className="mt-1 text-xs text-content-secondary">Metadata edits will appear here after the first review save.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {versions.map((version) => {
              const previousValues = normalizePreviousValues(version.previous_values);
              const changedFields = Object.entries(previousValues);
              return (
                <article key={version.id} className="rounded-lg border border-hairline bg-bg-elevated p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="neutral">{version.changed_by_name || 'System'}</Badge>
                        <span className="text-xs text-content-muted">{formatHistoryDate(version.changed_at)}</span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-content-secondary">
                        {version.change_reason || 'Source metadata review'}
                      </p>
                    </div>
                    <Badge tone="info">{changedFields.length} field{changedFields.length === 1 ? '' : 's'}</Badge>
                  </div>

                  {changedFields.length > 0 ? (
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {changedFields.map(([field, value]) => (
                        <div key={field} className="rounded-lg border border-hairline-soft bg-bg-secondary px-3 py-2">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-content-muted">
                            Previous {formatHistoryField(field)}
                          </div>
                          <div className="mt-1 break-words text-xs font-medium text-content-primary">
                            {formatHistoryValue(field, value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-content-muted">No changed fields were recorded for this entry.</p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
