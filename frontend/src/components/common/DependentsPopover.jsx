import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Network, X, ArrowUpRight, FileText, ShieldCheck, AlertTriangle, ListChecks, Building2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Link } from 'react-router-dom';
import { evidenceLinksAPI } from '../../services/api';

/**
 * DependentsPopover (E2-PR1, 2026-05-27)
 *
 * Reverse-traversal of the polymorphic evidence-link graph.
 *
 * Answers the impact-of-retraction question: "if I delete this document /
 * retract this regulatory source / mark this comp as unverified, which DD
 * items / approvals / risk flags / financial scenarios across my org will
 * lose a citation?"
 *
 * Mounted from any surface that owns an evidence source (a document row,
 * an evidence-source pill, a comp card). Takes `sourceKind` + `sourceId`
 * + an optional `triggerLabel` (defaults to "What depends on this?"). The
 * trigger button is render-prop friendly — pass `renderTrigger` to embed
 * inside a menu, or rely on the default chip.
 *
 * UX rules:
 *   - Opens in a popover, not a full-screen modal. Closing returns the
 *     user to the surface they came from.
 *   - Each dependent is a link to its parent deal (open in new tab) so
 *     the operator can drill in without losing the popover.
 *   - Empty state ("Nothing depends on this") is explicit, not blank.
 *   - The "comp" source kind returns `supported: false` with a note —
 *     surface the note instead of pretending the list is empty.
 *   - CLAUDE.md respected: pure read, no AI, no derived claims.
 */

// Visual rules per owner kind — icon + plain-English label.
const OWNER_KIND_META = {
  dd_item:            { icon: ListChecks,  label: 'DD item' },
  approval:           { icon: ShieldCheck, label: 'Approval' },
  risk_flag:          { icon: AlertTriangle, label: 'Risk flag' },
  comp:               { icon: Building2,   label: 'Comp' },
  financial_scenario: { icon: FileText,    label: 'Financial scenario' },
  parcel_intelligence:{ icon: FileText,    label: 'Parcel intelligence' },
  deal_note:          { icon: FileText,    label: 'Deal note' },
  guidance_value:     { icon: FileText,    label: 'Guidance value' },
};

const OWNER_KIND_TONE = {
  dd_item: 'bg-sky-50 text-sky-700 border-sky-200',
  approval: 'bg-violet-50 text-violet-700 border-violet-200',
  risk_flag: 'bg-rose-50 text-rose-700 border-rose-200',
  comp: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  financial_scenario: 'bg-amber-50 text-amber-700 border-amber-200',
  parcel_intelligence: 'bg-slate-50 text-slate-700 border-slate-200',
  deal_note: 'bg-slate-50 text-slate-700 border-slate-200',
  guidance_value: 'bg-slate-50 text-slate-700 border-slate-200',
};

const formatConfidence = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return `${Math.round(Number(n) * 100)}%`;
};

function GroupedSummary({ grouped }) {
  const entries = Object.entries(grouped || {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1">
      {entries.map(([kind, count]) => {
        const meta = OWNER_KIND_META[kind] || { label: kind };
        return (
          <span
            key={kind}
            className={clsx(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border',
              OWNER_KIND_TONE[kind] || 'bg-slate-50 text-slate-700 border-slate-200',
            )}
          >
            <span>{count}</span>
            <span>{meta.label}{count > 1 ? 's' : ''}</span>
          </span>
        );
      })}
    </div>
  );
}

function OwnerRow({ owner }) {
  const meta = OWNER_KIND_META[owner.owner_kind] || { icon: FileText, label: owner.owner_kind };
  const Icon = meta.icon;
  const confidence = formatConfidence(owner.confidence_score);
  return (
    <li className="border border-hairline-soft rounded-md px-2.5 py-2 hover:bg-bg-secondary/60 transition-colors">
      <div className="flex items-start gap-2">
        <Icon size={13} className="shrink-0 mt-0.5 text-content-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-content-muted">
              {meta.label}
            </span>
            {confidence && (
              <span className="text-[10px] text-content-muted">
                · {confidence} confidence
              </span>
            )}
            {owner.verified_at && (
              <span className="text-[10px] text-emerald-700 inline-flex items-center gap-0.5">
                · Verified
              </span>
            )}
          </div>
          <div className="text-xs text-content-primary leading-snug truncate" title={owner.owner_label || ''}>
            {owner.owner_label || <span className="italic text-content-muted">No label</span>}
          </div>
          {owner.deal_id && owner.deal_name && (
            <Link
              to={`/deals/${owner.deal_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-accent hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="truncate max-w-[14rem]">{owner.deal_name}</span>
              <ArrowUpRight size={10} />
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * @param {object} props
 * @param {'document'|'evidence_source'|'evidence_fact'|'comp'} props.sourceKind
 * @param {string} props.sourceId
 * @param {string=} props.triggerLabel  default "What depends on this?"
 * @param {function=} props.renderTrigger  optional `({onOpen, count}) => ReactNode`
 *                                         render-prop for embedding the
 *                                         trigger inside another UI shell.
 * @param {string=} props.className       optional class on the wrapping span.
 */
export default function DependentsPopover({
  sourceKind,
  sourceId,
  triggerLabel = 'What depends on this?',
  renderTrigger = null,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Click-outside + Esc close
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // Only fire the network when the popover is opened. Keeps cold loads of
  // the parent surface cheap; reverse-lookups can be expensive on busy
  // documents (e.g. a master plan PDF that 40 risk flags cite).
  const { data, isLoading, isError } = useQuery({
    queryKey: ['evidence-dependents', sourceKind, sourceId],
    queryFn: () => evidenceLinksAPI.dependents(sourceKind, sourceId).then((r) => r.data.data),
    enabled: open && Boolean(sourceKind) && Boolean(sourceId),
    staleTime: 30_000,
  });

  const ownerCount = data?.owners?.length ?? 0;

  const triggerContent = renderTrigger
    ? renderTrigger({ onOpen: () => setOpen((v) => !v), open, count: ownerCount })
    : (
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors',
          'border-hairline bg-bg-elevated text-content-secondary hover:bg-bg-secondary hover:text-content-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          open && 'bg-bg-secondary text-content-primary',
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="See which DD items / approvals / risk flags / scenarios cite this source"
      >
        <Network size={11} />
        {triggerLabel}
      </button>
    );

  return (
    <span ref={ref} className={clsx('relative inline-block', className)}>
      {triggerContent}

      {open && (
        <span
          role="dialog"
          aria-modal="false"
          aria-label="Dependent items"
          className="absolute z-50 mt-1 right-0 w-80 bg-bg-elevated border border-hairline rounded-md shadow-elevated text-left"
        >
          <div className="flex items-start justify-between px-3 py-2 border-b border-hairline-soft">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-content-muted">
                Dependents
              </div>
              <div className="text-xs text-content-secondary leading-tight mt-0.5">
                {isLoading
                  ? 'Looking up…'
                  : ownerCount === 0
                    ? 'Nothing depends on this'
                    : `${ownerCount} item${ownerCount === 1 ? '' : 's'} cite this source`}
              </div>
              {data?.grouped && <GroupedSummary grouped={data.grouped} />}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 p-0.5 ml-2 rounded text-content-muted hover:text-content-primary hover:bg-bg-secondary"
              aria-label="Close"
            >
              <X size={12} />
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto px-2 py-2">
            {isLoading && (
              <div className="text-[11px] text-content-muted py-3 text-center">
                Loading…
              </div>
            )}

            {isError && (
              <div className="text-[11px] text-rose-700 py-3 text-center">
                Could not load dependents. Try again.
              </div>
            )}

            {!isLoading && !isError && data && data.supported === false && data.note && (
              <div className="text-[11px] text-content-muted leading-snug py-2 px-1">
                {data.note}
              </div>
            )}

            {!isLoading && !isError && data && data.supported !== false && ownerCount === 0 && (
              <div className="text-[11px] text-content-muted py-3 text-center leading-snug">
                Nothing currently cites this. Safe to retract or replace
                without breaking any active DD / approval / risk flag.
              </div>
            )}

            {!isLoading && !isError && ownerCount > 0 && (
              <ul className="space-y-1.5">
                {data.owners.map((o) => (
                  <OwnerRow key={o.link_id} owner={o} />
                ))}
              </ul>
            )}
          </div>

          <div className="px-3 py-1.5 border-t border-hairline-soft text-[10px] text-content-muted">
            Citations recorded in the deal workspace. Reverse-traversal only —
            this does not modify any state.
          </div>
        </span>
      )}
    </span>
  );
}
