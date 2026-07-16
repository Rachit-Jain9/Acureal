import { clsx } from 'clsx';
import {
  FileText, CheckCircle2, AlertCircle, Loader2, X, Info,
} from 'lucide-react';

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS = {
  queued:    { label: 'Ready',      tone: 'text-content-muted' },
  uploading: { label: 'Uploading',  tone: 'text-accent' },
  done:      { label: 'Uploaded',   tone: 'text-data-positive' },
  error:     { label: 'Failed',     tone: 'text-data-negative' },
};

/**
 * The staged multi-file upload queue. Presentational — all state lives in
 * useUploadQueue. Follows FRONTEND_GUIDELINES: each row slides+fades in from
 * the top (220ms decelerate), the status pill cross-fades (180ms), the
 * progress bar animates transform only, and everything collapses under
 * prefers-reduced-motion. The container is a polite live region so a
 * screen-reader hears batch progress without stealing focus.
 */
export default function UploadQueueList({ items, onRemove, isRunning }) {
  if (!items.length) return null;

  return (
    <ul className="space-y-1.5" role="status" aria-live="polite" aria-busy={isRunning}>
      {items.map((item) => {
        const status = STATUS[item.status] || STATUS.queued;
        const storedOnly = item.tier === 'stored_only' && item.status !== 'error';
        return (
          <li
            key={item.id}
            className="redip-slide-in-top flex items-center gap-3 rounded-lg border border-hairline bg-bg-secondary px-3 py-2"
          >
            <FileText size={16} className="flex-shrink-0 text-content-muted" />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-content-primary">{item.name}</p>
                <span className="flex-shrink-0 text-[11px] text-content-muted">{formatBytes(item.size)}</span>
              </div>

              {/* Progress bar — only while uploading; transform-only animation. */}
              {item.status === 'uploading' && (
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-bg-elevated">
                  <div
                    className="h-full origin-left rounded-full bg-accent transition-transform duration-200 ease-out motion-reduce:transition-none"
                    style={{ transform: `scaleX(${Math.max(0.02, item.progress / 100)})` }}
                  />
                </div>
              )}

              {/* Per-file error — the honest, specific reason this one failed. */}
              {item.status === 'error' && item.error && (
                <p className="mt-0.5 text-[11px] text-data-negative">{item.error}</p>
              )}

              {/* Honest note: a stored-only file uploads fine but won't be
                  auto-read. Say so up front rather than after the fact. */}
              {storedOnly && item.status !== 'uploading' && (
                <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-content-muted">
                  <Info size={11} className="flex-shrink-0" />
                  {item.label} — stored, but not AI-readable
                </p>
              )}
            </div>

            <span
              className={clsx(
                'flex items-center gap-1 text-[11px] font-medium transition-opacity duration-200 motion-reduce:transition-none',
                status.tone,
              )}
            >
              {item.status === 'uploading' && <Loader2 size={12} className="animate-spin motion-reduce:animate-none" />}
              {item.status === 'done' && <CheckCircle2 size={12} />}
              {item.status === 'error' && <AlertCircle size={12} />}
              {item.status === 'uploading' ? `${item.progress}%` : status.label}
            </span>

            {/* Remove — allowed until the row starts uploading. */}
            {(item.status === 'queued' || item.status === 'error') && !isRunning && (
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                className="rounded p-0.5 text-content-muted transition-colors duration-150 hover:text-data-negative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label={`Remove ${item.name} from the upload list`}
              >
                <X size={14} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
