import { useEffect, useState } from 'react';
import { ShieldCheck, ChevronRight } from 'lucide-react';
import { Modal } from '../../design-system';
import { financialsAPI } from '../../services/api';
import AuditTimelineView from './AuditTimelineView';

/**
 * AuditTrailChip — compact footer credibility chip that opens the full
 * HMAC-signed audit timeline in a modal on click.
 *
 * Why a chip (not a card): the audit log is non-negotiable infrastructure
 * (CLAUDE.md mandates an immutable trail for every material change), but
 * its UI is for diligence partners + auditors, not the operator's daily
 * workflow. Pre-2026-05-28 the full collapsed `AuditTimelineView` card
 * lived on the FinancialTab, the standalone FinancialsPage, AND the
 * ActivityTab — three places, ~80px of chrome each, on every page load.
 *
 * This chip renders a single line:
 *
 *   🛡 Audit signed · HMAC-SHA256 · N events · open
 *
 * which preserves the credibility signal (especially when the count is
 * visible — "this kernel run is row #47 of an immutable signed log") and
 * recovers ~75px of vertical space on three surfaces. Click opens the
 * full timeline (events list + Verify + Replay primitives) in a modal.
 *
 * Soft-fails silently when the audit log is unavailable so the chip
 * doesn't render a "broken" empty state for deals on infrastructure that
 * hasn't applied the deal_events migration yet.
 */
export default function AuditTrailChip({ dealId }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!dealId) return undefined;
    let cancelled = false;
    financialsAPI
      .events(dealId, 50)
      .then((res) => {
        if (cancelled) return;
        const rows = res?.data?.data || [];
        // The /financials/:id/events endpoint returns a merged feed
        // (financial computations + mutation log rows). The audit chip
        // surfaces only the signed financial subset — mutation rows are
        // not HMAC-signed and live elsewhere.
        const financialOnly = (Array.isArray(rows) ? rows : []).filter(
          (r) => r?.kind !== 'mutation',
        );
        setCount(financialOnly.length);
      })
      .catch(() => {
        if (cancelled) return;
        setUnavailable(true);
      });
    return () => { cancelled = true; };
  }, [dealId]);

  if (!dealId || unavailable) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-hairline bg-bg-elevated text-xs text-content-secondary hover:border-emerald-200 hover:text-content-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
        aria-label="Open signed audit trail"
      >
        <ShieldCheck size={12} className="text-emerald-600 shrink-0" />
        <span className="font-medium">Audit signed</span>
        <span className="text-content-muted">·</span>
        <span className="font-mono text-[10px] tracking-tight">HMAC-SHA256</span>
        {count != null && (
          <>
            <span className="text-content-muted">·</span>
            <span className="tabular-nums">
              {count} event{count === 1 ? '' : 's'}
            </span>
          </>
        )}
        <ChevronRight size={11} className="text-content-muted shrink-0" />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="xl"
        title="Signed audit trail"
        description="HMAC-SHA256 signed kernel runs. Verify re-hashes the stored JSON; replay re-executes the deterministic kernel against the stored inputs."
      >
        <AuditTimelineView dealId={dealId} embedded />
      </Modal>
    </>
  );
}
