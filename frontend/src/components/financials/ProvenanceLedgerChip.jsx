import { lazy, Suspense, useState } from 'react';
import { Fingerprint, ChevronRight } from 'lucide-react';
import { Modal, Card, SkeletonList } from '../../design-system';

const ProvenanceTab = lazy(() => import('../deal/ProvenanceTab'));

/**
 * ProvenanceLedgerChip — compact footer one-liner that opens the deal's full
 * provenance ledger (its chain of custody) in a modal on click.
 *
 * (Named to disambiguate from the field-level `common/ProvenanceChip`, which
 * is a per-field "where this value came from" popover — a different thing.)
 *
 * Provenance was a top-level deal tab (#1010). But its audience is investment
 * committee / buyer diligence, not the operator's daily underwriting — so on
 * 2026-07-19 it was demoted to this one-liner, mirroring the sibling
 * AuditTrailChip that sits beside it on the Financial tab footer.
 *
 * Zero cost until clicked: the ProvenanceTab bundle is React.lazy and its
 * evidence ledger is only fetched when the modal actually opens (the child is
 * gated on `open`). Recovers a slot on the already-overflowing deal tab strip
 * while keeping the "prove every number" receipts one click away.
 */
export default function ProvenanceLedgerChip({ dealId }) {
  const [open, setOpen] = useState(false);

  if (!dealId) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-hairline bg-bg-elevated text-xs text-content-secondary hover:border-hairline-strong hover:text-content-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        aria-label="Open provenance — every figure this deal rests on, traced to its source"
      >
        <Fingerprint size={12} className="text-accent shrink-0" />
        <span className="font-medium">Provenance</span>
        <span className="text-content-muted">·</span>
        <span>every figure traced</span>
        <ChevronRight size={11} className="text-content-muted shrink-0" />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="xl"
        title="Provenance"
        description="Every figure this deal's decision rests on — traced to an honest, typed source. Kernel-computed numbers are HMAC-signed and replayable."
      >
        {open && (
          <Suspense
            fallback={
              <Card className="p-4">
                <SkeletonList rows={6} columns={3} />
              </Card>
            }
          >
            <ProvenanceTab embedded />
          </Suspense>
        )}
      </Modal>
    </>
  );
}
