import { Link } from 'react-router-dom';
import { History } from 'lucide-react';
import Badge from '../common/Badge';
import { chipsFor, relativeTime } from '../deal/sinceLastVisitChips';

/**
 * "Since you last looked" — the portfolio strip at the top of AttentionPanel.
 *
 * The four signal sections below this one answer "what crossed an absolute
 * threshold?" — overdue by N days, expiring within 30, stale for 14. None of
 * them know what THIS user has already seen, so returning after three days
 * looks identical to returning after three minutes. This strip answers the
 * missing question, per user, per deal.
 *
 * Deliberately a strip inside an existing panel, not a widget and not a page.
 * Two portfolio widgets have already been built and removed as clutter here,
 * and a hero band was reverted — the lesson taken is that the dashboard earns
 * more from one panel that answers a second question than from a second box.
 *
 * Clicking a row opens the deal, which stamps the visit, which is what removes
 * the row. The loop closes itself; nothing to dismiss, no unread state to
 * maintain.
 *
 * Three states, all distinct on purpose:
 *   • `data == null`  → render nothing. The query failed or the visits table
 *                       is not migrated. Silence, never a false "all quiet".
 *   • no moved deals  → one quiet line. No box, no chart, no illustration.
 *   • moved deals     → up to five rows, newest signal first.
 */

const STAGE_LABEL = {
  sourced: 'Sourced',
  screening: 'Screening',
  site_visit: 'Site visit',
  loi: 'LOI',
  due_diligence: 'Due diligence',
  underwriting: 'Underwriting',
  ic_review: 'IC review',
  negotiation: 'Negotiation',
  active: 'Active',
};

const neverOpenedNote = (n) =>
  n === 1 ? '1 deal not yet opened' : `${n} deals not yet opened`;

export default function SinceYouLooked({ data, onPrefetchDeal }) {
  // null is "could not compute", which is not the same claim as "nothing
  // moved" — say nothing rather than something untrue.
  if (!data) return null;

  const deals = Array.isArray(data.deals) ? data.deals : [];
  const neverOpened = Number(data.never_opened) || 0;

  if (deals.length === 0) {
    // Quiet line only. A user with nothing new should feel the product is
    // calm, not that it failed to load.
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-hairline pb-3 mb-4">
        <span className="inline-flex items-center gap-1.5 text-xs text-content-muted">
          <History size={13} aria-hidden="true" />
          Nothing has moved since your last pass
        </span>
        {neverOpened > 0 && (
          <span className="text-xs text-content-tertiary tabular-nums">{neverOpenedNote(neverOpened)}</span>
        )}
      </div>
    );
  }

  return (
    <section aria-label="Deals that changed since you last opened them" className="border-b border-hairline pb-4 mb-4">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-2.5">
        <h4 className="inline-flex items-center gap-1.5 text-xs font-medium text-content-secondary">
          <History size={13} aria-hidden="true" />
          Since you last looked
          <span className="text-content-muted font-normal">
            · {deals.length === 1 ? '1 deal moved' : `${deals.length} deals moved`}
          </span>
        </h4>
        {neverOpened > 0 && (
          <span className="text-xs text-content-tertiary tabular-nums">{neverOpenedNote(neverOpened)}</span>
        )}
      </header>

      <ul className="space-y-1">
        {deals.map((deal) => {
          const chips = chipsFor(deal.changes);
          const when = relativeTime(deal.last_visited_at);
          return (
            <li key={deal.deal_id}>
              <Link
                to={`/dashboard/deals/${deal.deal_id}`}
                onMouseEnter={() => onPrefetchDeal?.(deal.deal_id)}
                onFocus={() => onPrefetchDeal?.(deal.deal_id)}
                className="group flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-editorial px-2 py-1.5 -mx-2 transition-colors duration-150 ease-out hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <span className="text-sm font-medium text-content-primary group-hover:text-accent transition-colors duration-150 ease-out">
                  {deal.name}
                </span>
                <span className="text-xs text-content-tertiary">
                  {STAGE_LABEL[deal.stage] || deal.stage}
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {chips.map((c) => (
                    <Badge key={c.key} tone={c.tone}>{c.label(c.n)}</Badge>
                  ))}
                </span>
                {when && (
                  <span className="ml-auto text-xs text-content-muted tabular-nums whitespace-nowrap">
                    opened {when}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
