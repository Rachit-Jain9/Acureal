import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { useFocusTrap } from '../../hooks/useFocusTrap';

/**
 * Lightweight modal for one-click verification of a Needs-Verification item.
 *
 * Captures either an external URL (e.g. a Kaveri/IGR/BBMP page) or a free-
 * text note describing how the analyst confirmed the item. The submitted
 * payload becomes an evidence_link row keyed to the latest parcel snapshot.
 */
export default function VerifyItemDialog({ item, onClose, onSubmit, isPending }) {
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (item) {
      setUrl('');
      setNotes('');
      setError('');
    }
  }, [item?.key]);

  // Hook must run on every render (rules of hooks); pass `!!item` so the trap
  // deactivates when the dialog is conceptually closed (early-returned below).
  const trapRef = useFocusTrap(!!item, { onEscape: onClose });

  if (!item) return null;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!url.trim() && !notes.trim()) {
      setError('Add a source URL or a verification note before saving.');
      return;
    }
    setError('');
    onSubmit({
      itemKey: item.key,
      externalUrl: url.trim() || null,
      notes: notes.trim() || null,
    });
  };

  return (
    <div
      ref={trapRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-editorial border border-hairline bg-bg-elevated shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.12em] text-content-muted">
              Mark verified
            </div>
            <div className="mt-1 text-base font-semibold text-content-primary">
              {item.label}
            </div>
            {item.detail ? (
              <div className="mt-1 text-xs text-content-secondary">{item.detail}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-content-muted hover:bg-bg-secondary"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <label className="block">
            <span className="text-xs font-medium text-content-secondary">
              Source URL <span className="text-content-muted">(optional)</span>
            </span>
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://kaveri.karnataka.gov.in/..."
              className="mt-1 w-full rounded-editorial border border-hairline bg-bg-secondary px-3 py-2 text-sm text-content-primary placeholder:text-content-muted focus:border-accent focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-content-secondary">
              Verification note
            </span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="What you confirmed and where (e.g. IGR Annexure-IV 2025, Hebbal SRO, INR 12,000/sqft)"
              className="mt-1 w-full rounded-editorial border border-hairline bg-bg-secondary px-3 py-2 text-sm text-content-primary placeholder:text-content-muted focus:border-accent focus:outline-none"
            />
          </label>
          {error ? (
            <div className="text-xs text-data-negative">{error}</div>
          ) : (
            <div className="text-[11px] text-content-muted">
              Citations are appended to the latest parcel snapshot and surface as a
              "Manually verified" pill on this item.
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-hairline px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-editorial border border-hairline bg-bg-elevated px-3 py-2 text-xs font-semibold text-content-primary hover:border-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className={clsx(
              'rounded-editorial bg-accent px-3 py-2 text-xs font-semibold text-content-inverse hover:bg-accent',
              isPending && 'opacity-60'
            )}
          >
            {isPending ? 'Saving...' : 'Mark Verified'}
          </button>
        </div>
      </form>
    </div>
  );
}
