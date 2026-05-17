import { useMemo, useState } from 'react';
import { Sparkles, ChevronRight } from 'lucide-react';
import { useDealExtractions } from '../../hooks/useDealExtractions';
import { useDealRecord } from '../../hooks/useDealContext';
import AutoFillFromDocumentsModal from './AutoFillFromDocumentsModal';

/**
 * AutoFillReadyCard (PR-NX30) — discoverability surface for the auto-fill
 * workflow shipped in PR-NX26.
 *
 * The problem this solves: pre-NX30, the only entry point to the
 * AutoFillFromDocumentsModal was a button buried in the Documents tab
 * header. Operators landing on the deal Overview tab (the default first-
 * paint) had no way to know there were extractions ready to apply. The
 * entire auto-fill workflow was invisible unless the operator deliberately
 * navigated to Documents.
 *
 * This component renders a single compact card right where operators land:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ ✨ 7 fields ready to auto-fill from documents     Review now → │
 *   │    Sale deed extraction includes survey number, owner, ...      │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Renders nothing (returns null) when no extractions are mapped — no
 * empty state to clutter deals that haven't been extracted yet.
 *
 * Per FRONTEND_GUIDELINES.md feel-checks:
 *   - "Feel fast": uses the same useDealExtractions cache the modal does,
 *     so the count is instant after first load.
 *   - "Feel trustworthy": citation text names the doc types, never
 *     overpromises ("up to N fields" not "perfect autofill").
 *   - "Feel alive": clicking the card opens the modal with the same
 *     transition the Documents-tab button uses.
 */
export default function AutoFillReadyCard({ dealId }) {
  const dealRecord = useDealRecord();
  const { data: extractionData } = useDealExtractions(dealId);
  const [open, setOpen] = useState(false);

  // Compute the count of canonical fields the modal would actually show.
  // We mirror the modal's filter (only fields that have an ontology spec).
  // To keep this card import-light, we just use the raw field_map count —
  // matches the modal's "Auto-fill from documents (N)" button label.
  const fieldCount = useMemo(
    () => Object.keys(extractionData?.field_map || {}).length,
    [extractionData?.field_map],
  );

  // Sample up to 3 distinct doc types/names for the citation line.
  // Operators recognize "sale deed" + "EC" instantly; abstract counts don't
  // build trust.
  const sampleDocuments = useMemo(() => {
    const map = extractionData?.field_map || {};
    const seen = new Set();
    const samples = [];
    for (const source of Object.values(map)) {
      const label = source.doc_type
        ? source.doc_type.replace(/_/g, ' ')
        : source.document_name || null;
      if (!label || seen.has(label)) continue;
      seen.add(label);
      samples.push(label);
      if (samples.length >= 3) break;
    }
    return samples;
  }, [extractionData?.field_map]);

  // Hide entirely when there's nothing to apply — no empty state noise.
  if (fieldCount === 0) return null;

  const subtext = sampleDocuments.length > 0
    ? `Extracted from ${sampleDocuments.join(' · ')}. Review side-by-side, then approve to populate the deal.`
    : 'Review side-by-side with current values, then approve to populate the deal.';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left rounded-xl border border-hairline-strong bg-paper hover:bg-paper-200 transition-colors px-4 py-3 flex items-center gap-4 group"
        aria-label={`Auto-fill ${fieldCount} fields from extracted documents`}
      >
        <div className="w-10 h-10 rounded-lg bg-accent-50 flex items-center justify-center flex-shrink-0">
          <Sparkles size={18} className="text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-content-primary">
              {fieldCount} field{fieldCount === 1 ? '' : 's'} ready to auto-fill from documents
            </span>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-medium">
              AI-assisted
            </span>
          </div>
          <p className="text-xs text-content-secondary mt-0.5 truncate">{subtext}</p>
        </div>
        <span className="text-xs text-accent group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5 flex-shrink-0">
          Review now <ChevronRight size={14} />
        </span>
      </button>

      <AutoFillFromDocumentsModal
        dealId={dealId}
        open={open}
        onClose={() => setOpen(false)}
        dealCurrentValues={dealRecord || {}}
        propertyCurrentValues={dealRecord || {}}
      />
    </>
  );
}
