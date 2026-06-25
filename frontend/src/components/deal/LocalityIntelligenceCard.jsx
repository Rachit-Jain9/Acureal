import { Link } from 'react-router-dom';
import { Network, ArrowRight } from 'lucide-react';
import { Card } from '../../design-system';
import Badge from '../common/Badge';

/**
 * T8 — Locality intelligence card.
 *
 * Surfaces what your fund already knows about this locality from prior deals
 * (within-tenant only). Editorial: info-dense, neutral chrome, attribution
 * chips, no pastel tile fills.
 *
 * Three states:
 *   - data === undefined: hidden (no locality on the property yet)
 *   - data.empty:        first-deal in locality empty state (one line)
 *   - data populated:    aggregated metrics + peer-deal list + recurring flags
 */

const formatInr = (n) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const num = Number(n);
  if (num >= 100000) return `₹${(num / 100000).toFixed(1)}L`;
  return `₹${num.toLocaleString('en-IN')}`;
};

const formatRange = (min, max) => {
  if (min == null || max == null) return '—';
  if (min === max) return formatInr(min);
  return `${formatInr(min)}–${formatInr(max)}`;
};

const formatRelative = (iso) => {
  if (!iso) return null;
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const days = Math.round((now - then) / (1000 * 60 * 60 * 24));
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
};

const SEVERITY_TONE = { high: 'danger', medium: 'warn', low: 'neutral' };

const STAT_LABEL_CLASSES = 'text-[10px] uppercase tracking-[0.12em] text-content-muted font-semibold';

export default function LocalityIntelligenceCard({ data }) {
  if (data === undefined || data === null) return null;

  const localityLabel = data.locality || 'this locality';
  const lastSeen = formatRelative(data.last_activity_at);

  // Empty state — first deal in this locality.
  if (data.empty) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-bg-secondary p-2 text-content-muted">
            <Network size={15} />
          </div>
          <div className="min-w-0">
            <div className={STAT_LABEL_CLASSES}>Locality intelligence</div>
            <div className="mt-1 text-sm font-medium text-content-primary">
              First deal in {localityLabel}
            </div>
            <p className="mt-1 text-xs text-content-secondary leading-relaxed">
              Future deals in this locality will inherit your verified guidance values, approved evidence sources, and recurring red flags. Build the moat with this deal.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const guidance = data.guidance_summary;
  const evidence = data.evidence_summary;
  const flags = data.common_red_flags || [];
  const peerDeals = data.peer_deals || [];

  // Editorial layout: eyebrow + headline → 4-col stat strip → recurring flags + peer-deal list
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Network size={13} className="text-content-muted" />
            <span className={STAT_LABEL_CLASSES}>Locality intelligence</span>
          </div>
          <div className="mt-1 text-sm font-medium text-content-primary">
            {data.deals_count} prior {data.deals_count === 1 ? 'deal' : 'deals'} in {localityLabel}
            {lastSeen && (
              <span className="ml-2 text-xs text-content-muted font-normal">last touched {lastSeen}</span>
            )}
          </div>
        </div>
      </div>

      {/* Stat strip — neutral chrome, never tile-fill. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div>
          <div className={STAT_LABEL_CLASSES}>Peer deals</div>
          <div className="mt-1 font-display text-2xl tabular-nums text-content-primary">
            {data.deals_count}
          </div>
        </div>
        <div>
          <div className={STAT_LABEL_CLASSES}>Guidance ₹/sqft</div>
          <div className="mt-1 font-display text-2xl tabular-nums text-content-primary">
            {guidance ? formatRange(guidance.min_inr_per_sqft, guidance.max_inr_per_sqft) : '—'}
          </div>
          {guidance?.count > 0 && (
            <div className="mt-0.5 text-[10px] text-content-muted tabular-nums">
              {guidance.count} approved {guidance.count === 1 ? 'row' : 'rows'}
            </div>
          )}
        </div>
        <div>
          <div className={STAT_LABEL_CLASSES}>Evidence sources</div>
          <div className="mt-1 font-display text-2xl tabular-nums text-content-primary">
            {evidence?.count ?? 0}
          </div>
          {evidence?.sources?.[0]?.authority && (
            <div className="mt-0.5 text-[10px] text-content-muted truncate" title={evidence.sources[0].authority}>
              {evidence.sources[0].authority}
            </div>
          )}
        </div>
        <div>
          <div className={STAT_LABEL_CLASSES}>Recurring flags</div>
          <div className="mt-1 font-display text-2xl tabular-nums text-content-primary">
            {flags.reduce((s, f) => s + (f.count || 0), 0)}
          </div>
        </div>
      </div>

      {/* Recurring red flags — Bloomberg-style two-column row */}
      {flags.length > 0 && (
        <div className="border-t border-hairline-soft pt-3 mb-3">
          <div className={`${STAT_LABEL_CLASSES} mb-2`}>
            Most common flags in {localityLabel}
          </div>
          <div className="space-y-1.5">
            {flags.map((flag) => (
              <div
                key={`${flag.label}-${flag.severity}`}
                className="flex items-center justify-between gap-3 text-[12px]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Badge tone={SEVERITY_TONE[flag.severity] || 'neutral'} className="text-[9px] shrink-0">
                    {flag.severity}
                  </Badge>
                  <span className="truncate text-content-primary" title={flag.label}>{flag.label}</span>
                </div>
                <span className="text-content-muted tabular-nums shrink-0">
                  {flag.count} {flag.count === 1 ? 'deal' : 'deals'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Peer deals — attribution chips, click-through links */}
      {peerDeals.length > 0 && (
        <div className="border-t border-hairline-soft pt-3">
          <div className={`${STAT_LABEL_CLASSES} mb-2`}>
            Peer deals
          </div>
          <div className="divide-y divide-hairline-soft">
            {peerDeals.map((deal) => (
              <Link
                key={deal.deal_id}
                to={`/dashboard/deals/${deal.deal_id}`}
                className="group flex items-center justify-between gap-3 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-content-primary font-medium truncate group-hover:text-accent transition-colors" title={deal.deal_name}>
                    {deal.deal_name || deal.property_name || 'Unnamed deal'}
                  </div>
                  <div className="text-[10px] text-content-muted mt-0.5">
                    {deal.stage ? deal.stage.replace(/_/g, ' ') : 'No stage'} · {formatRelative(deal.updated_at) || '—'}
                  </div>
                </div>
                <ArrowRight size={12} className="shrink-0 text-content-muted group-hover:text-accent transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
