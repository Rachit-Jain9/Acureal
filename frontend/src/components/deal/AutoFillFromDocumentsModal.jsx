import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { X, Sparkles, FileText, CheckCircle2, AlertTriangle, Info, RotateCcw } from 'lucide-react';
import { clsx } from 'clsx';
import { useDealExtractions } from '../../hooks/useDealExtractions';
import { useApplyExtractions } from '../../hooks/useApplyExtractions';
import useFocusTrap from '../../hooks/useFocusTrap';
import useScrollLock from '../../hooks/useScrollLock';
import ontologyV1 from '@redip/real-estate-ontology';

/**
 * AutoFillFromDocumentsModal (PR-NX26) — the operator-visible half of
 * document ingestion. Renders one row per extracted-and-mapped field:
 *
 *   • CURRENT deal value (on the left)
 *   • PROPOSED extracted value (on the right) with confidence pill +
 *     source-document chip + per-field india_context tooltip
 *   • APPROVE checkbox (defaults on for HIGH-confidence rows)
 *
 * Bulk actions: select-all-high, select-all-medium, clear-all, plus a
 * sticky "Apply N selected" footer button. On apply, POSTs to
 * /api/deals/:id/apply-extractions and surfaces the applied/skipped
 * breakdown via toast.
 *
 * Per AI_ROADMAP §10 (UX/UI conventions for AI surfaces):
 *   - Mandatory "AI-assisted — requires human review" banner.
 *   - Confidence rendered as bands (high/medium/low), not raw %.
 *   - Source-document chips name the originating document (full name on hover).
 *   - Skeleton-then-list on initial extraction load.
 *
 * The ontology field_map is the single source of truth for field labels +
 * india_context — the same v1.json the backend validates writes against.
 */

const FIELD_SPECS = ontologyV1.extraction_field_map.fields;
const CONFIDENCE_BANDS = ontologyV1.confidence_bands.bands;

const bandFor = (confidence) => {
  if (confidence == null || !Number.isFinite(Number(confidence))) return null;
  const n = Number(confidence);
  for (const band of CONFIDENCE_BANDS) {
    if (n >= band.min && n <= band.max) return band;
  }
  return null;
};

const formatValue = (value, valueType) => {
  if (value == null || value === '') return '—';
  if (valueType === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    // Show large numbers with Indian locale (lakhs/crores grouping)
    return n >= 10000 ? n.toLocaleString('en-IN') : String(n);
  }
  return String(value);
};

const BAND_PILL = {
  high:   'bg-pos-soft text-data-positive border-hairline',
  medium: 'bg-premium-soft text-premium border-hairline',
  low:    'bg-bg-secondary text-content-secondary border-hairline',
};

export default function AutoFillFromDocumentsModal({ dealId, open, onClose, dealCurrentValues = {}, propertyCurrentValues = {} }) {
  const { data: extractionData, isLoading, isError, refetch } = useDealExtractions(dealId);
  const applyMutation = useApplyExtractions(dealId);

  // Trap focus + lock body scroll while open (this dialog previously had
  // neither, plus no Escape-to-close). Escape is a deliberate action so it
  // isn't gated on the in-flight apply the way the backdrop click is. onClose
  // is stabilised so a re-render doesn't re-arm the trap mid-typing.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  const handleClose = useCallback(() => onCloseRef.current?.(), []);
  const trapRef = useFocusTrap(open, { onEscape: handleClose });
  useScrollLock(open);

  // Build the candidate row list from the field_map keys + ontology specs.
  // field_map (built server-side by extraction.service.buildFieldMap) is
  // keyed by canonical field name; each value has { value, confidence,
  // raw_key, document_id, document_name, doc_type, extraction_id }.
  const candidates = useMemo(() => {
    const fieldMap = extractionData?.field_map || {};
    return Object.entries(fieldMap)
      .map(([canonicalKey, source]) => {
        const spec = FIELD_SPECS[canonicalKey];
        // Skip canonical keys we don't yet route via the ontology. They
        // still exist in the backend FIELD_MAP_RULES for buildability
        // calcs but have no apply-extractions destination.
        if (!spec) return null;

        // Current value lookup — properties.* fields live on
        // propertyCurrentValues; deals.* on dealCurrentValues.
        const currentBag = spec.table === 'properties' ? propertyCurrentValues : dealCurrentValues;
        const currentValue = currentBag[spec.column] ?? null;

        const band = bandFor(source.confidence);

        return {
          canonicalKey,
          spec,
          source,
          currentValue,
          band,
        };
      })
      .filter(Boolean);
  }, [extractionData?.field_map, dealCurrentValues, propertyCurrentValues]);

  // Approval state — Set of canonical keys the operator has approved.
  // Default: every HIGH-confidence row is checked on first render.
  const [approvedKeys, setApprovedKeys] = useState(() => new Set());

  // Inline corrections — canonical key → operator-typed value. A key present
  // here means the operator edited that row's proposed value; a key absent
  // means they are taking the AI's extracted value as-is.
  const [editedValues, setEditedValues] = useState({});

  // Reset / re-seed approvals + edits whenever the candidate list changes
  // (e.g., after the modal re-opens with fresh extractions).
  useEffect(() => {
    setEditedValues({});
    if (!candidates.length) {
      setApprovedKeys(new Set());
      return;
    }
    const defaults = new Set();
    for (const c of candidates) {
      if (c.band?.key === 'high') defaults.add(c.canonicalKey);
    }
    setApprovedKeys(defaults);
  }, [candidates.length]); // re-seed when the count changes

  if (!open) return null;

  const toggle = (key) => {
    setApprovedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllByBand = (bandKey) => {
    setApprovedKeys((prev) => {
      const next = new Set(prev);
      for (const c of candidates) {
        if (c.band?.key === bandKey) next.add(c.canonicalKey);
      }
      return next;
    });
  };

  const clearAll = () => setApprovedKeys(new Set());

  // The value that will actually be applied for a row: the operator's
  // correction if they made one, otherwise the AI's extracted value.
  const effectiveValueOf = (c) =>
    Object.prototype.hasOwnProperty.call(editedValues, c.canonicalKey)
      ? editedValues[c.canonicalKey]
      : c.source.value;

  // True only when the operator's typed value genuinely differs from the AI's
  // — typing the AI value back, character for character, is not an edit.
  const isEditedRow = (c) =>
    Object.prototype.hasOwnProperty.call(editedValues, c.canonicalKey) &&
    String(editedValues[c.canonicalKey] ?? '') !== String(c.source.value ?? '');

  const setEditedValue = (key, value) => {
    setEditedValues((prev) => ({ ...prev, [key]: value }));
    // Correcting a value signals intent to apply it — auto-select the row.
    setApprovedKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  };

  const resetEditedValue = (key) =>
    setEditedValues((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, key)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

  const handleApply = async () => {
    const approved = candidates
      .filter((c) => approvedKeys.has(c.canonicalKey))
      .map((c) => ({
        canonical_field: c.canonicalKey,
        value: effectiveValueOf(c),
        source_extraction_id: c.source.extraction_id || null,
        source_document_id: c.source.document_id || null,
        source_field: c.source.raw_key || null,
        confidence: c.source.confidence != null ? Number(c.source.confidence) : null,
      }));

    if (approved.length === 0) return;

    try {
      await applyMutation.mutateAsync(approved);
      onClose?.();
    } catch {
      // Toast surfaced by the hook
    }
  };

  const approvedCount = approvedKeys.size;
  const totalCount = candidates.length;
  const isSubmitting = applyMutation.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="autofill-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose?.();
      }}
    >
      <div ref={trapRef} className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl bg-paper shadow-2xl border border-hairline-strong overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-hairline">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 w-9 h-9 rounded-lg bg-accent-50 flex items-center justify-center flex-shrink-0">
              <Sparkles size={18} className="text-accent" />
            </div>
            <div className="min-w-0">
              <h2 id="autofill-modal-title" className="text-base font-semibold text-content-primary leading-tight">
                Auto-fill deal from extracted documents
              </h2>
              <p className="text-xs text-content-secondary mt-0.5">
                Review each proposed value, correct it if the AI got it wrong, then apply. Ontology v{ontologyV1.ontology_version}.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 text-content-tertiary hover:text-content-primary hover:bg-paper-200 rounded transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Mandatory AI disclosure (CLAUDE.md hard rule) */}
        <div className="px-6 py-2.5 bg-premium-soft border-b border-hairline flex items-start gap-2 text-xs">
          <AlertTriangle size={14} className="text-premium mt-0.5 flex-shrink-0" />
          <p className="text-premium">
            <span className="font-semibold">AI-assisted — requires human review.</span>{' '}
            Each value was extracted from a document by AI. Check each one — edit it inline if it is wrong — before applying. The system records who applied what, and whether each value was kept or corrected.
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="px-6 py-8 text-center text-sm text-content-secondary">
              Loading extractions…
            </div>
          )}

          {isError && (
            <div className="px-6 py-8 text-center text-sm text-data-negative">
              Could not load extractions.{' '}
              <button onClick={() => refetch()} className="underline hover:no-underline">
                Retry
              </button>
            </div>
          )}

          {!isLoading && !isError && candidates.length === 0 && (
            <div className="px-6 py-10 text-center">
              <FileText size={28} className="text-content-tertiary mx-auto mb-2" />
              <p className="text-sm text-content-secondary">
                No mapped extractions on this deal yet. Upload a sale deed, EC, or khata extract, then run extraction.
              </p>
            </div>
          )}

          {!isLoading && candidates.length > 0 && (
            <>
              {/* Bulk action toolbar */}
              <div className="sticky top-0 z-10 px-6 py-2.5 bg-paper border-b border-hairline flex items-center gap-2 text-xs">
                <span className="text-content-secondary mr-2">Bulk:</span>
                <button
                  type="button"
                  onClick={() => selectAllByBand('high')}
                  className="px-2 py-1 rounded border border-hairline text-content-primary hover:bg-paper-200"
                >
                  Select all high-confidence
                </button>
                <button
                  type="button"
                  onClick={() => selectAllByBand('medium')}
                  className="px-2 py-1 rounded border border-hairline text-content-primary hover:bg-paper-200"
                >
                  + medium
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  className="px-2 py-1 rounded border border-hairline text-content-tertiary hover:bg-paper-200 ml-1"
                >
                  Clear
                </button>
                <span className="ml-auto text-content-tertiary tabular-nums">
                  {approvedCount} of {totalCount} selected
                </span>
              </div>

              {/* Field rows */}
              <ul className="divide-y divide-hairline">
                {candidates.map((c) => {
                  const isApproved = approvedKeys.has(c.canonicalKey);
                  const edited = isEditedRow(c);
                  const proposedDisplay = Object.prototype.hasOwnProperty.call(editedValues, c.canonicalKey)
                    ? editedValues[c.canonicalKey]
                    : (c.source.value == null ? '' : String(c.source.value));
                  const willOverwrite = c.currentValue != null && c.currentValue !== '' && String(c.currentValue) !== String(effectiveValueOf(c));
                  return (
                    <li
                      key={c.canonicalKey}
                      className={clsx(
                        'px-6 py-3 grid grid-cols-12 gap-3 items-start hover:bg-paper-200/40 transition-colors',
                        isApproved && 'bg-pos-soft',
                      )}
                    >
                      {/* Checkbox */}
                      <label className="col-span-1 flex items-start pt-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isApproved}
                          onChange={() => toggle(c.canonicalKey)}
                          disabled={isSubmitting}
                          className="h-4 w-4 rounded border-hairline-strong text-accent focus:ring-accent disabled:opacity-50"
                          aria-label={`Approve ${c.spec.label}`}
                        />
                      </label>

                      {/* Field label + india_context */}
                      <div className="col-span-4 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-medium text-content-primary">{c.spec.label}</span>
                          {c.spec.india_context && (
                            <span
                              title={c.spec.india_context}
                              className="inline-flex items-center text-content-tertiary cursor-help"
                            >
                              <Info size={11} />
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-content-tertiary mt-0.5 break-words">
                          → {c.spec.table}.{c.spec.column}
                          {c.spec.transform && (
                            <span className="ml-1 text-premium">· transform: {c.spec.transform}</span>
                          )}
                        </p>
                      </div>

                      {/* Current vs proposed */}
                      <div className="col-span-3 text-xs">
                        <div className="text-[10px] uppercase tracking-wider text-content-tertiary mb-0.5">Current</div>
                        <div className="text-sm text-content-secondary tabular-nums break-words">
                          {formatValue(c.currentValue, c.spec.value_type)}
                        </div>
                      </div>

                      <div className="col-span-3 text-xs">
                        <div className="text-[10px] uppercase tracking-wider text-content-tertiary mb-0.5 flex items-center gap-1.5">
                          Proposed
                          {edited && <span className="text-accent font-semibold">· edited</span>}
                          {willOverwrite && <span className="text-premium font-semibold">· overwrites</span>}
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            inputMode={c.spec.value_type === 'number' ? 'decimal' : 'text'}
                            value={proposedDisplay}
                            onChange={(e) => setEditedValue(c.canonicalKey, e.target.value)}
                            disabled={isSubmitting}
                            aria-label={`Proposed value for ${c.spec.label}`}
                            className={clsx(
                              'w-full text-sm font-medium tabular-nums rounded px-2 py-1',
                              'bg-transparent border transition-colors',
                              'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
                              'disabled:opacity-50',
                              edited
                                ? 'text-accent border-accent/40 bg-accent-50/40'
                                : 'text-content-primary border-transparent hover:border-hairline',
                            )}
                          />
                          {edited && (
                            <button
                              type="button"
                              onClick={() => resetEditedValue(c.canonicalKey)}
                              disabled={isSubmitting}
                              title="Reset to the AI-extracted value"
                              aria-label={`Reset ${c.spec.label} to the AI-extracted value`}
                              className="p-0.5 text-content-tertiary hover:text-content-primary rounded transition-colors disabled:opacity-50 flex-shrink-0"
                            >
                              <RotateCcw size={12} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Source + confidence */}
                      <div className="col-span-1 flex flex-col items-end gap-1">
                        {c.band && (
                          <span
                            className={clsx(
                              'inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border tabular-nums',
                              BAND_PILL[c.band.key],
                            )}
                            title={c.band.applies}
                          >
                            {c.band.label} · {(c.source.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                        {c.source.document_name && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] text-content-tertiary truncate max-w-[120px]"
                            title={`From: ${c.source.document_name}${c.source.doc_type ? ` (${c.source.doc_type})` : ''}`}
                          >
                            <FileText size={9} />
                            <span className="truncate">{c.source.document_name}</span>
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-hairline bg-paper-200/50 flex items-center justify-between">
          <div className="text-xs text-content-tertiary">
            {totalCount === 0
              ? 'Upload + extract documents to see auto-fill candidates here.'
              : `${approvedCount} field${approvedCount === 1 ? '' : 's'} ready to apply.`}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3 py-1.5 text-sm text-content-secondary hover:text-content-primary rounded border border-hairline hover:bg-paper-200 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={isSubmitting || approvedCount === 0}
              className="px-3 py-1.5 text-sm text-content-inverse bg-accent hover:bg-accent-700 rounded inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 size={14} />
              {isSubmitting ? 'Applying…' : `Apply ${approvedCount || ''} field${approvedCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
