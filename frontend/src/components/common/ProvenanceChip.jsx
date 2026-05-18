import { useState, useRef, useEffect } from 'react';
import { Info, FileText } from 'lucide-react';
import { clsx } from 'clsx';

/**
 * ProvenanceChip (PR-NX50 — 2026-05-19)
 *
 * A tiny inline (i) chip rendered next to deal/property field values
 * that were auto-applied from a document extraction (PR-NX25). Hover
 * or focus opens a popover with the full provenance:
 *
 *   - Source ("Auto-filled from sale-deed.pdf")
 *   - Applied at (relative time, e.g., "2 days ago")
 *   - Applied by (user name)
 *   - Source document type (e.g., "sale_deed")
 *   - Ontology version used by the apply pipeline
 *
 * Renders NOTHING when no provenance entry exists for the field (the
 * value was manually entered, not auto-filled). This means consumers
 * can drop the chip in every field renderer without worrying about
 * conditional rendering — only fields that ARE auto-filled show the chip.
 *
 * Usage:
 *   <ProvenanceChip field="land_area_sqft" provenance={fieldProvenance} />
 *
 * Where `provenance` is the `field_provenance` map returned by
 * useFieldProvenance(dealId).
 */

const formatRelativeTime = (iso) => {
  if (!iso) return '';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN');
};

const humanizeDocType = (docType) => String(docType || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

export default function ProvenanceChip({ field, provenance, compact = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on Escape + click-outside (for keyboard users who tabbed in)
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const entry = provenance?.[field];
  if (!entry) return null;

  const docName = Array.isArray(entry.source_document_names) ? entry.source_document_names[0] : null;
  const docType = Array.isArray(entry.source_document_types) ? entry.source_document_types[0] : null;
  const docTypeLabel = docType ? humanizeDocType(docType) : null;

  return (
    <span ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={clsx(
          'inline-flex items-center justify-center rounded-full text-content-tertiary hover:text-accent transition-colors cursor-help',
          compact ? 'w-3.5 h-3.5' : 'w-4 h-4',
        )}
        aria-label={`Auto-filled from ${docName || 'document extraction'}`}
        aria-expanded={open}
      >
        <Info size={compact ? 9 : 11} />
      </button>

      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-50 w-64 rounded-md border border-hairline-strong bg-paper shadow-lg p-3 text-left"
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <FileText size={12} className="text-accent flex-shrink-0" />
            <span className="text-[11px] font-semibold text-content-primary">
              Auto-filled from {docTypeLabel || 'document extraction'}
            </span>
          </div>
          {docName && (
            <div className="text-[11px] text-content-secondary truncate mb-1">{docName}</div>
          )}
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px] text-content-tertiary">
            {entry.applied_at && (
              <>
                <span>Applied:</span>
                <span className="text-content-secondary">{formatRelativeTime(entry.applied_at)}</span>
              </>
            )}
            {entry.applied_by_name && (
              <>
                <span>By:</span>
                <span className="text-content-secondary truncate">{entry.applied_by_name}</span>
              </>
            )}
            {entry.target_table && (
              <>
                <span>Target:</span>
                <span className="text-content-secondary font-mono">{entry.target_table}.{field}</span>
              </>
            )}
            {entry.ontology_version && (
              <>
                <span>Ontology:</span>
                <span className="text-content-secondary font-mono">v{entry.ontology_version}</span>
              </>
            )}
          </div>
        </span>
      )}
    </span>
  );
}
