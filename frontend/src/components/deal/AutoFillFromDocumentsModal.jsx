import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { X, Sparkles, FileText, CheckCircle2, AlertTriangle, Info, RotateCcw, ShieldCheck, ScanLine, HelpCircle, ShieldAlert } from 'lucide-react';
import { clsx } from 'clsx';
import { useDealExtractions } from '../../hooks/useDealExtractions';
import { useApplyExtractions } from '../../hooks/useApplyExtractions';
import useFocusTrap from '../../hooks/useFocusTrap';
import useScrollLock from '../../hooks/useScrollLock';
import ontologyV1 from '@redip/real-estate-ontology';

/**
 * AutoFillFromDocumentsModal (PR-NX26; verification-signal redesign 2026-07-16)
 * — the operator-visible half of document ingestion. One row per
 * extracted-and-mapped field:
 *
 *   • CURRENT deal value
 *   • PROPOSED extracted value (editable inline)
 *   • a VERIFICATION BASIS — not a percentage. Each field carries a
 *     deterministic status computed by the backend
 *     (utils/extractionFieldQuality): whether the value was found verbatim in
 *     the document, whether its shape checks out, and whether it is one of
 *     CLAUDE.md's "legal four" statutory facts that a human must verify.
 *   • an APPROVE checkbox
 *
 * What changed and why: the old surface showed a "confidence %" that was
 * actually a fill-rate (1.0 for any non-empty field) multiplied by an alias
 * preference, and PRE-TICKED every field scoring ≥0.80 — which was ~all of
 * them, including ownership and survey numbers. This version pre-ticks ONLY
 * values proven verbatim against the source AND outside the legal four, shows
 * the operator WHY each value is or isn't trusted, and never auto-selects a
 * statutory fact at any strength.
 *
 * The ontology field_map is the single source of truth for field labels +
 * india_context. The per-field signal comes from the backend field_map's
 * `signal` (status/reason/lane/grounded); when it is absent (a document
 * extracted before this shipped, or before migration 20260728), the row
 * degrades to "review" and is never pre-ticked — honest by default.
 */

const FIELD_SPECS = ontologyV1.extraction_field_map.fields;

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

/**
 * Verification-status → display. `autoFill` gates BOTH the default pre-tick and
 * the "Select verified" bulk action — only `source_verified` (found verbatim,
 * shape valid, NOT legal-four) is ever selected without a human touching it.
 * `chip` is one restrained soft tone (no chip-soup, FRONTEND_GUIDELINES §0);
 * the short label is the at-a-glance signal, the backend `reason` is the
 * explanation shown beneath the field — together one composite signal (§11).
 */
const SIGNAL_DISPLAY = {
  source_verified: { label: 'Found in source', short: 'Verified', Icon: ShieldCheck, chip: 'bg-pos-soft text-data-positive', autoFill: true },
  format_checked:  { label: 'Format checked',  short: 'Check',    Icon: ScanLine,   chip: 'bg-bg-secondary text-content-secondary', autoFill: false },
  unverified:      { label: 'Unverified',      short: 'Review',   Icon: HelpCircle, chip: 'bg-bg-secondary text-content-secondary', autoFill: false },
  not_in_source:   { label: 'Not in source',   short: 'Not found', Icon: AlertTriangle, chip: 'bg-neg-soft text-data-negative', autoFill: false },
  format_mismatch: { label: 'Format mismatch', short: 'Mismatch', Icon: AlertTriangle, chip: 'bg-neg-soft text-data-negative', autoFill: false },
  verify_legal:    { label: 'Verify — legal',  short: 'Legal',    Icon: ShieldAlert, chip: 'bg-premium-soft text-premium', autoFill: false },
  absent:          { label: '—',               short: '—',        Icon: HelpCircle, chip: 'bg-bg-secondary text-content-tertiary', autoFill: false },
};

// A field whose extraction predates the signal (no field_quality persisted).
// Honest default: show it as review-required, never pre-ticked.
const FALLBACK_DISPLAY = { label: 'Review', short: 'Review', Icon: HelpCircle, chip: 'bg-bg-secondary text-content-secondary', autoFill: false };
const FALLBACK_REASON = 'Read by AI. Check this value against the source document before applying.';

const displayForSignal = (signal) => {
  if (!signal || !signal.status) return { display: FALLBACK_DISPLAY, reason: FALLBACK_REASON };
  return {
    display: SIGNAL_DISPLAY[signal.status] || FALLBACK_DISPLAY,
    reason: signal.reason || FALLBACK_REASON,
  };
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

        const { display, reason } = displayForSignal(source.signal);

        // Deterministic normalization ("34 Acres 32 Guntas" → 34.8,
        // "06.02.2024" → 2024-02-06). When present, the PROPOSED value is the
        // normalized one — the document's exact words stay visible beside it
        // and ride into the audit trail. Without it, such values would pass
        // review and then be silently skipped at apply ("could not coerce").
        const normalized = source.normalized && source.normalized.value !== undefined
          ? source.normalized
          : null;
        const proposedValue = normalized ? normalized.value : source.value;

        return {
          canonicalKey,
          spec,
          source,
          currentValue,
          display,
          reason,
          normalized,
          proposedValue,
          isLegal: Boolean(source.signal?.lane),
          autoFillable: display.autoFill,
        };
      })
      .filter(Boolean);
  }, [extractionData?.field_map, dealCurrentValues, propertyCurrentValues]);

  // A stable signature of WHICH fields (and their verification status) are on
  // offer. Re-seeding on this — instead of the old `candidates.length` — means
  // approvals reset correctly when the field set changes without a count
  // change, and never silently discards state on an unrelated re-render.
  const candidateSignature = useMemo(
    () => candidates.map((c) => `${c.canonicalKey}:${c.source.signal?.status || 'x'}`).join('|'),
    [candidates],
  );

  // Approval state — Set of canonical keys the operator has approved.
  // Default: ONLY source-verified, non-legal fields are pre-ticked. A statutory
  // fact (owner, survey number, RERA, approval status) is NEVER auto-selected,
  // however well it verifies — CLAUDE.md: extraction aid only, human verifies.
  const [approvedKeys, setApprovedKeys] = useState(() => new Set());

  // Inline corrections — canonical key → operator-typed value. A key present
  // here means the operator edited that row's proposed value; a key absent
  // means they are taking the AI's extracted value as-is.
  const [editedValues, setEditedValues] = useState({});

  useEffect(() => {
    setEditedValues({});
    const defaults = new Set();
    for (const c of candidates) {
      if (c.autoFillable) defaults.add(c.canonicalKey);
    }
    setApprovedKeys(defaults);
  }, [candidateSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const verifiedCount = useMemo(() => candidates.filter((c) => c.autoFillable).length, [candidates]);
  const legalCount = useMemo(() => candidates.filter((c) => c.isLegal).length, [candidates]);

  if (!open) return null;

  const toggle = (key) => {
    setApprovedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Bulk-select only what is safe to apply without reading each one: the
  // source-verified, non-legal rows. There is deliberately no "select all" —
  // that is the affordance that let unverified and statutory values slip in.
  const selectVerified = () => {
    setApprovedKeys((prev) => {
      const next = new Set(prev);
      for (const c of candidates) {
        if (c.autoFillable) next.add(c.canonicalKey);
      }
      return next;
    });
  };

  const clearAll = () => setApprovedKeys(new Set());

  // The value that will actually be applied for a row: the operator's
  // correction if they made one, otherwise the PROPOSED value (the
  // deterministic normalization when one exists, else the raw extraction).
  const effectiveValueOf = (c) =>
    Object.prototype.hasOwnProperty.call(editedValues, c.canonicalKey)
      ? editedValues[c.canonicalKey]
      : c.proposedValue;

  // True only when the operator's typed value genuinely differs from the
  // proposal — typing the proposed value back, character for character, is
  // not an edit.
  const isEditedRow = (c) =>
    Object.prototype.hasOwnProperty.call(editedValues, c.canonicalKey) &&
    String(editedValues[c.canonicalKey] ?? '') !== String(c.proposedValue ?? '');

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
        // Audit trail carries the verification BASIS (found-in-source /
        // legal-verify / …) and its deterministic score — not a fabricated
        // percentage. `confidence` stays for backward-compatible audit shape.
        verification_status: c.source.signal?.status || null,
        confidence: c.source.signal_score != null ? Number(c.source.signal_score) : null,
        // When the applied value came from a normalization, keep the
        // document's exact words + the versioned rule in the audit trail.
        ...(c.normalized ? {
          source_raw_value: String(c.source.value ?? ''),
          normalization_rule: c.normalized.rule,
        } : {}),
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
                Values proven against the source are pre-selected. Everything else — and every legal fact — is for you to check. Ontology v{ontologyV1.ontology_version}.
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
              {/* Bulk action toolbar. Only "verified" can be bulk-selected —
                  the rest must be reviewed one at a time. Legal-lane rows are
                  never in any bulk set. */}
              <div className="sticky top-0 z-10 px-6 py-2.5 bg-paper border-b border-hairline flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={selectVerified}
                  disabled={verifiedCount === 0}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-hairline text-content-primary
                    transition-colors duration-[120ms] ease-out hover:bg-paper-200
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:bg-paper-200/70
                    disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ShieldCheck size={12} className="text-data-positive" />
                  Select verified{verifiedCount > 0 ? ` (${verifiedCount})` : ''}
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  className="px-2.5 py-1 rounded border border-hairline text-content-tertiary
                    transition-colors duration-[120ms] ease-out hover:bg-paper-200
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:bg-paper-200/70"
                >
                  Clear
                </button>
                {legalCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] text-premium"
                    title="Title, encumbrance, RERA and statutory-approval facts are never selected automatically — tick each one only after checking it against the source document."
                  >
                    <ShieldAlert size={12} />
                    {legalCount} legal field{legalCount === 1 ? '' : 's'} need your review
                  </span>
                )}
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
                    : (c.proposedValue == null ? '' : String(c.proposedValue));
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

                      {/* Field label + the verification REASON (why this value
                          is or isn't trusted) — the schema-routing trivia that
                          used to sit here moved into the label's tooltip. */}
                      <div className="col-span-4 min-w-0">
                        <div className="flex items-center gap-1">
                          <span
                            className="text-sm font-medium text-content-primary"
                            title={`${c.spec.table}.${c.spec.column}${c.spec.transform ? ` · transform: ${c.spec.transform}` : ''}`}
                          >
                            {c.spec.label}
                          </span>
                          {c.spec.india_context && (
                            <span
                              title={c.spec.india_context}
                              className="inline-flex items-center text-content-tertiary cursor-help"
                            >
                              <Info size={11} />
                            </span>
                          )}
                        </div>
                        <p className={clsx(
                          'text-[11px] mt-0.5 break-words',
                          c.isLegal ? 'text-premium' : 'text-content-tertiary',
                        )}>
                          {c.reason}
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
                              title="Reset to the proposed value"
                              aria-label={`Reset ${c.spec.label} to the proposed value`}
                              className="p-0.5 text-content-tertiary hover:text-content-primary rounded transition-colors disabled:opacity-50 flex-shrink-0"
                            >
                              <RotateCcw size={12} />
                            </button>
                          )}
                        </div>
                        {/* Normalization provenance: the document's exact words
                            stay visible beside the standardised proposal — the
                            operator always sees what was converted from what. */}
                        {c.normalized && !edited && (
                          <p
                            className="mt-0.5 text-[10px] text-content-tertiary break-words"
                            title={c.normalized.reason}
                          >
                            from “{String(c.source.value)}”
                            {c.normalized.status === 'assumed' && (
                              <span className="text-premium font-medium"> · day-first assumed</span>
                            )}
                          </p>
                        )}
                      </div>

                      {/* Verification basis + source document. The pill is the
                          at-a-glance status; the reason under the field label
                          is its explanation — one composite signal (§11). */}
                      <div className="col-span-1 flex flex-col items-end gap-1">
                        <span
                          className={clsx(
                            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium',
                            c.display.chip,
                          )}
                          title={c.reason}
                        >
                          <c.display.Icon size={10} />
                          {c.display.short}
                        </span>
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
