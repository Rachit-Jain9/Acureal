import { useState, useRef, useEffect, useId } from 'react';
import { Paperclip, FileText, Link as LinkIcon, CheckCircle2, ShieldQuestion, Sparkles, Loader2, ExternalLink, Settings2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useEvidenceLinks, deriveEvidenceChip } from '../../hooks/useEvidenceLinks';
import ManageEvidenceModal from './ManageEvidenceModal';

/**
 * EvidenceBadge — the Provenance Spine surface on workflow rows.
 *
 * Drop this next to any DD item, risk flag, approval, or comp title and
 * the user gets a one-click "where does this come from?" pop-over:
 *
 *   • The verdict chip (Verified / Inferred / Unverified) that mirrors
 *     the language used on the Parcel verdict.
 *   • The list of linked evidence — sale deed, RTC, manual verification,
 *     external URL — with page number, confidence %, who linked it.
 *
 * Why it's a hover/click chip and not auto-rendered detail:
 *   evidence_links queries are per-owner. A DD tab with 30 items rendering
 *   full detail by default would fire 30 requests on mount. The badge
 *   lazy-fetches only when the pop-over opens, so the tabs stay fast.
 *
 * Usage:
 *   <EvidenceBadge ownerKind="dd_item"  ownerId={item.id} />
 *   <EvidenceBadge ownerKind="risk_flag" ownerId={flag.id} />
 *
 * The chip is read-only for now. Attach / detach lives in a future
 * "Manage evidence" modal — for now the chip is the surface that proves
 * provenance exists, which is the immediate credibility play.
 */

const formatRelativeTime = (iso) => {
  if (!iso) return '';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN');
};

const formatConfidence = (score) => {
  if (score == null || Number.isNaN(Number(score))) return null;
  const pct = Math.round(Math.max(0, Math.min(1, Number(score))) * 100);
  return `${pct}% confidence`;
};

const LINK_KIND_META = {
  evidence_source: { icon: FileText, label: 'Source document' },
  evidence_fact: { icon: Sparkles, label: 'Extracted fact' },
  document: { icon: FileText, label: 'Document' },
  manual_verification: { icon: CheckCircle2, label: 'Manual verification' },
  external_url: { icon: ExternalLink, label: 'External reference' },
};

const renderLinkTitle = (link) => {
  // Prefer the most specific label available, falling back through the
  // join columns. This keeps the row readable whether the link points to
  // an evidence_source, an evidence_fact, an uploaded document, or a
  // bare external URL.
  if (link.evidence_source_title) return link.evidence_source_title;
  if (link.evidence_source_authority) return link.evidence_source_authority;
  if (link.evidence_fact_key) {
    return link.evidence_fact_value
      ? `${link.evidence_fact_key} = ${String(link.evidence_fact_value).slice(0, 40)}`
      : link.evidence_fact_key;
  }
  if (link.document_name) return link.document_name;
  if (link.external_url) {
    try {
      return new URL(link.external_url).hostname;
    } catch {
      return link.external_url.slice(0, 50);
    }
  }
  return LINK_KIND_META[link.link_kind]?.label || 'Linked evidence';
};

const renderLinkSubtitle = (link) => {
  const bits = [];
  if (link.page_number != null) bits.push(`p. ${link.page_number}`);
  if (link.source_section) bits.push(link.source_section);
  if (link.evidence_source_authority && link.evidence_source_title) {
    bits.push(link.evidence_source_authority);
  }
  return bits.join(' · ');
};

const BUCKET_PILL = {
  verified: 'bg-pos-soft text-data-positive border-hairline',
  inferred: 'bg-premium-soft text-premium border-hairline',
  needs_verification: 'bg-bg-secondary text-content-secondary border-hairline',
};

const BUCKET_ICON = {
  verified: CheckCircle2,
  inferred: Sparkles,
  needs_verification: ShieldQuestion,
};

export default function EvidenceBadge({
  ownerKind,
  ownerId,
  compact = false,
  // Optional. When passed, the "Manage evidence" modal can offer the
  // deal's uploaded documents in its attach form. Owners that don't sit
  // inside a deal (e.g. a guidance_value) can omit it — the modal still
  // works via manual_verification and external_url.
  dealId = null,
  // Human-readable label for the modal header — usually the item title
  // (DD item name, risk flag title, comp project name).
  ownerLabel = null,
}) {
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const ref = useRef(null);
  const tooltipId = useId();

  // Lazy fetch — only when the pop-over has been opened at least once.
  // Once fetched, keep the data warm (60s staleTime is on the hook) so
  // reopening doesn't refetch.
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => { if (open) setHasOpened(true); }, [open]);

  const { data, isLoading, isError } = useEvidenceLinks(ownerKind, ownerId, {
    enabled: hasOpened,
  });

  // Close on Escape / outside click.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // Once the summary loads we can colour the chip itself by bucket; until
  // then, the chip stays neutral so the user doesn't see a flash of
  // "Unverified" on every row at mount.
  const summary = data?.summary;
  const chip = summary ? deriveEvidenceChip(summary) : null;
  const bucket = summary?.bucket || 'needs_verification';
  const BucketIcon = BUCKET_ICON[bucket];

  const sourceCount = Number(summary?.source_count ?? 0);
  const manualCount = Number(summary?.manual_count ?? 0);
  const totalLinks = sourceCount + manualCount;

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-expanded={open}
        aria-controls={tooltipId}
        aria-label={
          summary
            ? `Provenance: ${chip?.label || 'unknown'}. ${totalLinks} link${totalLinks === 1 ? '' : 's'}.`
            : 'Show provenance'
        }
        className={clsx(
          'inline-flex items-center gap-1 rounded-full border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 cursor-help',
          compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]',
          summary
            ? BUCKET_PILL[bucket]
            : 'bg-bg-secondary text-content-tertiary border-hairline',
        )}
      >
        {summary ? (
          <>
            <BucketIcon size={compact ? 9 : 11} />
            <span>{chip.label}</span>
            {totalLinks > 0 && (
              <span className="tabular-nums opacity-70">· {totalLinks}</span>
            )}
          </>
        ) : (
          <>
            <Paperclip size={compact ? 9 : 11} />
            <span>Evidence</span>
          </>
        )}
      </button>

      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute left-0 top-full mt-1 z-50 w-80 rounded-md border border-hairline-strong bg-paper shadow-lg p-3 text-left"
        >
          {isLoading && (
            <div className="flex items-center gap-2 text-[11px] text-content-tertiary">
              <Loader2 size={11} className="animate-spin" />
              Loading provenance…
            </div>
          )}

          {isError && (
            <div className="text-[11px] text-data-negative">
              Couldn't load evidence. Try again.
            </div>
          )}

          {!isLoading && !isError && summary && (
            <>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                    BUCKET_PILL[bucket],
                  )}
                >
                  <BucketIcon size={11} />
                  {chip.label}
                </span>
                <span className="text-[10px] text-content-tertiary">
                  {chip.sublabel}
                </span>
              </div>

              {data.links.length === 0 ? (
                <div className="text-[11px] text-content-tertiary leading-snug">
                  No evidence linked yet. Once a document is attached or a manual
                  verification is logged, the proof trail shows up here.
                </div>
              ) : (
                <ul className="space-y-2 max-h-64 overflow-y-auto -mx-1 px-1">
                  {data.links.slice(0, 8).map((link) => {
                    const Icon = LINK_KIND_META[link.link_kind]?.icon || LinkIcon;
                    const subtitle = renderLinkSubtitle(link);
                    const conf = formatConfidence(link.confidence_score);
                    return (
                      <li
                        key={link.id}
                        className="flex items-start gap-2 text-left"
                      >
                        <Icon
                          size={11}
                          className={clsx(
                            'shrink-0 mt-0.5',
                            link.link_kind === 'manual_verification'
                              ? 'text-data-positive'
                              : 'text-accent',
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium text-content-primary truncate">
                            {renderLinkTitle(link)}
                          </div>
                          {subtitle && (
                            <div className="text-[10px] text-content-tertiary truncate">
                              {subtitle}
                            </div>
                          )}
                          <div className="text-[10px] text-content-tertiary mt-0.5">
                            {conf && <span>{conf}</span>}
                            {conf && link.created_by_name && <span> · </span>}
                            {link.created_by_name && (
                              <span>
                                {link.link_kind === 'manual_verification' ? 'Verified by' : 'Linked by'}{' '}
                                <span className="text-content-secondary">{link.created_by_name}</span>
                              </span>
                            )}
                            {link.created_at && (
                              <span> · {formatRelativeTime(link.created_at)}</span>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                  {data.links.length > 8 && (
                    <li className="text-[10px] text-content-tertiary italic">
                      … and {data.links.length - 8} more.
                    </li>
                  )}
                </ul>
              )}

              {/* Footer: "Manage evidence" opens the attach / detach modal.
                  Only shown for owners we know how to manage from the UI;
                  for now that's everything the badge is mounted on. */}
              <div className="mt-2 pt-2 border-t border-hairline-soft">
                <button
                  type="button"
                  onMouseDown={(e) => {
                    // Stop the click-outside listener from closing the
                    // pop-over before the modal mounts and steals focus.
                    e.stopPropagation();
                  }}
                  onClick={() => { setManageOpen(true); setOpen(false); }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
                >
                  <Settings2 size={10} />
                  Manage evidence
                </button>
              </div>
            </>
          )}
        </span>
      )}

      {/* Modal renders outside the pop-over via a portal — opening it
          doesn't depend on the pop-over staying open. */}
      <ManageEvidenceModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        ownerKind={ownerKind}
        ownerId={ownerId}
        ownerLabel={ownerLabel}
        dealId={dealId}
      />
    </span>
  );
}
