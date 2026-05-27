import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck,
  ArrowUpRight,
  Filter,
  RefreshCcw,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { clsx } from 'clsx';
import PageHeader from '../components/common/PageHeader';
import Badge from '../components/common/Badge';
import { Card, SectionHeader, SkeletonList, ErrorState } from '../design-system';
import { useAuditTrail } from '../hooks/useAuditTrail';

/**
 * E7-PR2 — Admin Audit Trail
 *
 * Operator-only view of `deal_events` — the HMAC-signed audit log of every
 * kernel run on every deal (calculate_and_save, scenario_recompute,
 * sensitivity_run, manual_replay). Each row carries a cryptographic
 * signature so a tamper of inputs/outputs after-the-fact is detectable.
 *
 * The dashboard already shows the 10-event tail in a small widget. This
 * page is the full surface: filters (time window / event type / deal),
 * click-through to the affected deal, and a compact table that scales to
 * 200 rows.
 *
 * Read-only — never mutates audit rows. Org-scoped via RLS on deal_events.
 * Operator-only. Polished per FRONTEND_GUIDELINES.md.
 */

const WINDOW_OPTIONS = [
  { days: 1,   label: '24h' },
  { days: 7,   label: '7d' },
  { days: 30,  label: '30d' },
  { days: 90,  label: '90d' },
  { days: 365, label: 'Year' },
];

const LIMIT_OPTIONS = [50, 100, 200];

const fmtNum = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));

const fmtRelTime = (iso) => {
  if (!iso) return '—';
  const dt = new Date(iso).getTime();
  if (!Number.isFinite(dt)) return '—';
  const secs = Math.floor((Date.now() - dt) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 86400 * 30) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN');
};

const fmtAbsTime = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

const humanizeEventType = (s) =>
  String(s || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

// Map event_type → tone. The dominant kernel-run events are all neutral
// info; replays and manual-rebuilds are amber so they catch the eye.
const EVENT_TONE = {
  calculate_and_save:   'info',
  scenario_recompute:   'info',
  sensitivity_run:      'info',
  manual_replay:        'amber',
  rebuild:              'amber',
  rollback:             'rose',
};

const TONE_CLASS = {
  info:  'bg-sky-50 text-sky-700 border-sky-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  rose:  'bg-rose-50 text-rose-700 border-rose-200',
  slate: 'bg-bg-secondary text-content-secondary border-hairline',
};

function EventTypeBadge({ eventType }) {
  const tone = EVENT_TONE[eventType] || 'slate';
  return (
    <span className={clsx(
      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider border whitespace-nowrap',
      TONE_CLASS[tone],
    )}>
      {humanizeEventType(eventType)}
    </span>
  );
}

function FilterChip({ active, onClick, children, ariaLabel }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={clsx(
        'px-2.5 py-1 rounded text-[11px] font-medium border transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        active
          ? 'bg-accent text-white border-accent'
          : 'bg-bg-elevated text-content-secondary border-hairline hover:border-accent/40 hover:text-content-primary',
      )}
    >
      {children}
    </button>
  );
}

function EventRow({ event }) {
  return (
    <tr className="border-b border-hairline-soft last:border-b-0 hover:bg-bg-secondary/40 transition-colors">
      <td className="py-2 pr-3 align-top whitespace-nowrap text-[11px] text-content-secondary tabular-nums" title={fmtAbsTime(event.created_at)}>
        {fmtRelTime(event.created_at)}
      </td>
      <td className="py-2 pr-3 align-top">
        <EventTypeBadge eventType={event.event_type} />
      </td>
      <td className="py-2 pr-3 align-top min-w-0">
        {event.deal_id && event.deal_name ? (
          <Link
            to={`/deals/${event.deal_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-content-primary hover:text-accent inline-flex items-center gap-1 group"
            title="Open deal in new tab"
          >
            <span className="truncate max-w-[18rem]">{event.deal_name}</span>
            <ArrowUpRight size={11} className="text-content-muted group-hover:text-accent shrink-0" />
          </Link>
        ) : (
          <span className="text-sm text-content-muted italic">(deal removed)</span>
        )}
        {event.asset_class && (
          <div className="text-[10px] text-content-muted mt-0.5">
            {event.asset_class.replace(/_/g, ' ')}
          </div>
        )}
      </td>
      <td className="py-2 pr-3 align-top text-[11px] text-content-secondary truncate max-w-[10rem]">
        {event.actor_name || <span className="text-content-muted italic">system</span>}
      </td>
      <td className="py-2 pr-3 align-top text-[10px] font-mono text-content-muted whitespace-nowrap">
        v{event.engine_version || '—'}
      </td>
    </tr>
  );
}

export default function AdminAuditTrailPage() {
  const [days, setDays] = useState(7);
  const [eventType, setEventType] = useState(null);
  const [limit, setLimit] = useState(50);

  const { data, isLoading, isError, refetch, isFetching } = useAuditTrail({
    days, eventType, limit,
  });

  const events = data?.events || [];
  const catalog = data?.event_type_catalog || [];

  const totalEvents = useMemo(
    () => catalog.reduce((sum, c) => sum + (c.count || 0), 0),
    [catalog],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Audit"
        title="Audit Trail"
        sub="Every financial-engine run on every deal is recorded here, with HMAC-signed inputs + outputs hashes. The signature lets you detect after-the-fact tampering. Operator-only."
      />

      {/* Filters */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.12em] font-medium text-content-muted mr-1">Window</span>
          {WINDOW_OPTIONS.map((o) => (
            <FilterChip
              key={o.days}
              active={days === o.days}
              onClick={() => setDays(o.days)}
              ariaLabel={`Time window ${o.label}`}
            >
              {o.label}
            </FilterChip>
          ))}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.12em] font-medium text-content-muted mr-1">Event type</span>
          <FilterChip active={eventType === null} onClick={() => setEventType(null)} ariaLabel="All event types">
            All ({fmtNum(totalEvents)})
          </FilterChip>
          {catalog.map((c) => (
            <FilterChip
              key={c.event_type}
              active={eventType === c.event_type}
              onClick={() => setEventType(c.event_type)}
              ariaLabel={`Filter to ${c.event_type}`}
            >
              {humanizeEventType(c.event_type)} ({fmtNum(c.count)})
            </FilterChip>
          ))}
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[10px] uppercase tracking-[0.12em] font-medium text-content-muted mr-1">Limit</span>
          {LIMIT_OPTIONS.map((l) => (
            <FilterChip
              key={l}
              active={limit === l}
              onClick={() => setLimit(l)}
              ariaLabel={`Show up to ${l} rows`}
            >
              {l}
            </FilterChip>
          ))}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="ml-2 inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-hairline bg-bg-elevated text-content-secondary hover:text-content-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCcw size={11} className={clsx(isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        <SectionHeader
          size="sm"
          icon={ShieldCheck}
          eyebrow={eventType ? 'Filtered events' : 'Recent events'}
          title={
            isLoading
              ? 'Loading…'
              : `${fmtNum(events.length)} event${events.length === 1 ? '' : 's'} in the last ${days} day${days === 1 ? '' : 's'}`
          }
          sub="Click a deal name to open its workspace in a new tab. Sorted newest first."
          className="px-5 pt-5"
        />

        {isError && (
          <div className="px-5 py-6">
            <ErrorState
              title="Could not load audit-trail"
              detail="The admin endpoint returned an error. Try Refresh; if it persists, check the Vercel runtime logs for /api/admin/audit-trail."
            />
          </div>
        )}

        {isLoading && (
          <div className="px-5 pb-5">
            <SkeletonList rows={6} />
          </div>
        )}

        {!isLoading && !isError && events.length === 0 && (
          <div className="px-5 py-10 text-center text-[12px] text-content-muted">
            No events in this window with the current filters.
            {eventType && ' Try clearing the event-type filter.'}
          </div>
        )}

        {!isLoading && !isError && events.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary/40 border-y border-hairline-soft">
                <tr>
                  <th scope="col" className="text-left px-5 py-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">When</th>
                  <th scope="col" className="text-left py-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">Event</th>
                  <th scope="col" className="text-left py-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">Deal</th>
                  <th scope="col" className="text-left py-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">Actor</th>
                  <th scope="col" className="text-left py-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">Engine</th>
                </tr>
              </thead>
              <tbody className="px-5">
                {events.map((e) => (
                  <tr key={e.id} className="hidden">{/* spacer; rendered below */}</tr>
                ))}
              </tbody>
              <tbody className="[&>tr>td]:px-0 [&>tr>td:first-child]:pl-5 [&>tr>td:last-child]:pr-5">
                {events.map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Cryptographic-signature footer — explains the HMAC chain */}
        <div className="px-5 py-2.5 border-t border-hairline-soft text-[10px] text-content-muted leading-relaxed">
          <ShieldCheck size={10} className="inline -mt-0.5 mr-1 text-emerald-700" />
          Every row carries an HMAC-SHA256 signature over the engine inputs + outputs hashes,
          chain-keyed to <code className="font-mono">DEAL_EVENTS_HMAC_KEY</code>. The dashboard's
          Activity / Override timeline reads the same source; this page is the full operator view.
        </div>
      </Card>
    </div>
  );
}
