import { History } from 'lucide-react';
import { useDealContext } from '../../hooks/useDealContext';
import { useDealVisit } from '../../hooks/useDeals';
import Badge from '../common/Badge';
import { chipsFor, relativeTime } from './sinceLastVisitChips';

/**
 * "Since your last visit" — the watermark strip on the deal Overview.
 *
 * Contract (mirrors ProvenanceChip): renders NOTHING unless there is genuine
 * news — no watermark yet (first visit / migration pending), zero changes,
 * loading, or error all produce null. Consumers drop it in without guarding.
 *
 * Copy is counts of deterministic events only — no AI, no ranking, no
 * editorialising. The chips reuse the app's Badge tones: risk arrivals are
 * the only danger-toned news; everything else is quiet.
 */

export default function SinceLastVisit() {
  const { dealId } = useDealContext();
  const { data } = useDealVisit(dealId);

  if (!data?.since || !(data.total > 0) || !data.changes) return null;

  const chips = chipsFor(data.changes);
  if (chips.length === 0) return null;

  const when = relativeTime(data.since);

  return (
    <div
      className="redip-empty-in flex flex-wrap items-center gap-x-3 gap-y-2 rounded-editorial border border-hairline bg-bg-secondary px-3.5 py-2.5"
      role="status"
      aria-label="Changes since your last visit"
    >
      <span className="inline-flex items-center gap-1.5 text-xs text-content-muted">
        <History size={13} aria-hidden="true" />
        Since your last visit{when ? ` · ${when}` : ''}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => (
          <Badge key={c.key} tone={c.tone}>{c.label(c.n)}</Badge>
        ))}
      </span>
    </div>
  );
}
