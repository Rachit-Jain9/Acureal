/**
 * The "since you last looked" chip vocabulary — ONE definition.
 *
 * Two surfaces render these counts: the per-deal banner on the Overview tab
 * (SinceLastVisit) and the portfolio strip on the dashboard (SinceYouLooked).
 * They read the same eight slices from the same backend definition
 * (dealVisits.service CHANGE_SLICES), so their LABELS and TONES have to come
 * from one place too. A dashboard row reading "3 risks updated" beside a deal
 * banner reading "3 risk updates" is the kind of small disagreement that makes
 * a user stop trusting both.
 *
 * Order = narrative priority: evidence first, then risk, then process.
 * Risk arrivals are the only danger-toned news; everything else is quiet.
 */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const CHIP_DEFS = [
  { key: 'documents_added', tone: 'info', label: (n) => `+${plural(n, 'document', 'documents')}` },
  { key: 'extractions_completed', tone: 'info', label: (n) => `${plural(n, 'file', 'files')} read` },
  { key: 'risks_added', tone: 'danger', label: (n) => `+${plural(n, 'risk', 'risks')}` },
  { key: 'risks_updated', tone: 'warn', label: (n) => `${plural(n, 'risk', 'risks')} updated` },
  { key: 'dd_updated', tone: 'neutral', label: (n) => `${plural(n, 'DD item', 'DD items')} updated` },
  { key: 'approvals_updated', tone: 'neutral', label: (n) => `${plural(n, 'approval', 'approvals')} updated` },
  { key: 'financials_updated', tone: 'info', label: () => 'model updated' },
  { key: 'activities_added', tone: 'neutral', label: (n) => `+${plural(n, 'activity', 'activities')}` },
];

/** The non-zero chips for a `changes` map, in narrative order. */
export const chipsFor = (changes) => {
  if (!changes) return [];
  return CHIP_DEFS
    .map((def) => ({ ...def, n: Number(changes[def.key]) || 0 }))
    .filter((c) => c.n > 0);
};

/**
 * Compact relative time. Shared so "2h ago" on the dashboard and "2h ago" on
 * the deal page cannot round differently.
 */
export const relativeTime = (iso) => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
