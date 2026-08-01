import { History } from 'lucide-react';
import { useDealContext } from '../../hooks/useDealContext';
import { useDealVisit } from '../../hooks/useDeals';
import Badge from '../common/Badge';

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

const relativeTime = (iso) => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Order = narrative priority: evidence first, then risk, then process.
const CHIP_DEFS = [
  { key: 'documents_added', tone: 'info', label: (n) => `+${plural(n, 'document', 'documents')}` },
  { key: 'extractions_completed', tone: 'info', label: (n) => `${plural(n, 'file', 'files')} read` },
  { key: 'risks_added', tone: 'danger', label: (n) => `+${plural(n, 'risk', 'risks')}` },
  { key: 'risks_updated', tone: 'warn', label: (n) => `${plural(n, 'risk', 'risks')} updated` },
  { key: 'dd_updated', tone: 'neutral', label: (n) => `${plural(n, 'DD item', 'DD items')} updated` },
  { key: 'approvals_updated', tone: 'neutral', label: (n) => `${plural(n, 'approval', 'approvals')} updated` },
  { key: 'financials_updated', tone: 'info', label: () => 'model updated' },
  { key: 'activities_added', tone: 'neutral', label: (n) => `+${plural(n, 'activity', 'activities')}` },
];

export default function SinceLastVisit() {
  const { dealId } = useDealContext();
  const { data } = useDealVisit(dealId);

  if (!data?.since || !(data.total > 0) || !data.changes) return null;

  const chips = CHIP_DEFS
    .map((def) => ({ ...def, n: Number(data.changes[def.key]) || 0 }))
    .filter((c) => c.n > 0);
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
