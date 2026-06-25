import { useState } from 'react';
import {
  Sparkles, ChevronRight, ChevronDown, AlertTriangle, Info, FileSearch,
  X, Clock, CheckCircle2, Eye, EyeOff, RefreshCw,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useDealContext } from '../../hooks/useDealContext';
import { useRecommendationVerdict } from '../../hooks/useRecommendationVerdict';
import { useEvidenceNavigate } from '../../hooks/useEvidenceNavigate';
import { isNavigableRef } from '../../utils/evidenceRef';
import { formatRelativeTime } from '../../utils/format';

/**
 * RecommendationsPanel — surfaces the deterministic Recommendation Engine
 * candidates on the deal Overview. Each card is built from kernel + comp +
 * approval signals; the AI narrator (PR-4) only rephrases AI-narratable cards.
 * The legal carve-out cards (ai_narratable === false) ship the deterministic
 * template — the AI narrator MUST NOT rephrase them.
 *
 * PR-C — operator can dismiss / snooze / mark-acted-on a card. Verdict
 * persists server-side and the card is hidden on subsequent loads. Hidden
 * cards are surfaced via a "Show dismissed" toggle so the operator can
 * restore them.
 *
 * Visual rules (CLAUDE.md / feedback_uiux_standards.md):
 *   - Editorial, not tacky. Neutral chrome + colored chip on the verb.
 *   - Severity drives the chip tint, not the whole card.
 *   - Evidence is collapsed by default; one click reveals provenance.
 *   - "Not enough data yet" empty state — never a spinner.
 */

const VERB_TONE = {
  Recommend:    'bg-accent-soft text-accent border-hairline',
  Consider:     'bg-bg-secondary text-content-secondary border-hairline',
  'Re-examine': 'bg-premium-soft text-premium border-hairline',
  Flag:         'bg-neg-soft text-data-negative border-hairline',
  'Stress-test':'bg-accent-soft text-accent border-hairline',
};

const SEVERITY_ICON = (severity) => {
  if (severity >= 4) return <AlertTriangle size={14} className="text-data-negative" />;
  if (severity >= 3) return <Info size={14} className="text-premium" />;
  return <Info size={14} className="text-content-muted" />;
};

/**
 * Tone for the "Adapted for your team" chip — P8-PR2 (Learning Loop v2).
 * The aggregator emits `team_feedback` on cards with any verdict history in
 * the trailing 90-day window. The chip:
 *
 *   - shows ONLY when there's something meaningful to surface (the
 *     aggregator already returns null for the empty case, but we belt-and-
 *     braces it here)
 *   - reads `reason` when the multiplier de-ranked the card ("Dismissed 8×
 *     by your team in the last 90 days.")
 *   - falls back to a positive-feedback variant when the team has APPLIED
 *     the rule more often than dismissed ("Applied 5× by your team")
 *   - stays subdued — this is platform-aware metadata, not a primary signal.
 *
 * Surfaces visibly that the platform is learning. CLAUDE.md respected:
 * never zeros out a card; only re-orders + explains the reorder.
 */
function TeamFeedbackChip({ feedback }) {
  if (!feedback) return null;
  const { multiplier, dismiss_count: dismissed, acted_count: acted, reason } = feedback;
  // If the aggregator de-ranked, show the reason it provided.
  if (multiplier < 1.0 && reason) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-hairline bg-premium-soft text-premium text-[10px] font-medium"
        title="The platform de-ranked this card because your team has dismissed similar ones recently. Click the card to act on it anyway."
      >
        <Sparkles size={10} />
        Adapted: dismissed {dismissed}× this month
      </span>
    );
  }
  // Positive feedback — team has applied this rule more often than dismissed.
  if (acted > 0 && acted >= dismissed) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-hairline bg-pos-soft text-data-positive text-[10px] font-medium"
        title="Your team has applied this kind of recommendation before."
      >
        <Sparkles size={10} />
        Applied {acted}× by your team
      </span>
    );
  }
  return null;
}

function VerdictMenu({ card, dealId, snapshotHash, onClose }) {
  const verdict = useRecommendationVerdict();
  const ruleId = card.id;
  const meta = { topic: card.topic, verb: card.verb, severity: card.severity };

  const submit = (payload) => {
    verdict.mutate(
      { dealId, ruleId, snapshotHash, ...meta, ...payload },
      { onSettled: onClose },
    );
  };

  return (
    <div
      className="absolute right-0 top-7 z-10 w-56 rounded-md border border-hairline-strong bg-bg-elevated shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => submit({ verdict: 'acted' })}
        disabled={verdict.isPending}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-content-secondary hover:bg-bg-secondary disabled:opacity-50"
      >
        <CheckCircle2 size={14} className="text-data-positive" />
        Mark as acted-on
      </button>
      <div className="border-t border-hairline" />
      <button
        type="button"
        onClick={() => submit({ verdict: 'snoozed', snoozeUntilSnapshotChange: true })}
        disabled={verdict.isPending}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-content-secondary hover:bg-bg-secondary disabled:opacity-50"
      >
        <Clock size={14} className="text-premium" />
        Snooze until inputs change
      </button>
      <button
        type="button"
        onClick={() => submit({ verdict: 'snoozed', snoozeDays: 7 })}
        disabled={verdict.isPending}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-content-secondary hover:bg-bg-secondary disabled:opacity-50"
      >
        <Clock size={14} className="text-premium" />
        Snooze 7 days
      </button>
      <button
        type="button"
        onClick={() => submit({ verdict: 'snoozed', snoozeDays: 30 })}
        disabled={verdict.isPending}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-content-secondary hover:bg-bg-secondary disabled:opacity-50"
      >
        <Clock size={14} className="text-premium" />
        Snooze 30 days
      </button>
      <div className="border-t border-hairline" />
      <button
        type="button"
        onClick={() => submit({ verdict: 'dismissed' })}
        disabled={verdict.isPending}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-data-negative hover:bg-neg-soft disabled:opacity-50"
      >
        <X size={14} />
        Dismiss
      </button>
    </div>
  );
}

function RecommendationCard({ card, dealId, snapshotHash, hidden = false }) {
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const verdict = useRecommendationVerdict();
  const navigateToEvidence = useEvidenceNavigate();
  const verbCls = VERB_TONE[card.verb] || 'bg-bg-secondary text-content-secondary border-hairline';

  // Hidden (verdict-applied) cards render in a quieter, muted style + show
  // a Restore button.
  return (
    <div
      className={clsx(
        'border rounded-md px-3 py-2.5 relative',
        hidden ? 'border-hairline-soft bg-bg-secondary opacity-70' : 'border-hairline bg-surface',
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="shrink-0 mt-0.5">{SEVERITY_ICON(card.severity)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span
              className={clsx(
                'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border',
                verbCls,
              )}
            >
              {card.verb}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-content-muted">
              {card.topic_label}
            </span>
            {!card.ai_narratable && (
              <span className="text-[10px] uppercase tracking-wider text-content-muted italic">
                Deterministic
              </span>
            )}
            {card.verdict?.kind === 'dismissed' && (
              <span className="text-[10px] uppercase tracking-wider text-data-negative">Dismissed</span>
            )}
            {card.verdict?.kind === 'snoozed' && (
              <span className="text-[10px] uppercase tracking-wider text-premium">Snoozed</span>
            )}
            <TeamFeedbackChip feedback={card.team_feedback} />
          </div>
          <div className={clsx('text-sm leading-snug', hidden ? 'text-content-secondary' : 'text-content-primary')}>
            {card.headline}
          </div>
          {card.detail && (
            <div className="text-xs text-content-secondary mt-1 leading-relaxed">
              {card.detail}
            </div>
          )}
          {Array.isArray(card.evidence) && card.evidence.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="mt-1.5 text-[11px] inline-flex items-center gap-1 text-content-secondary hover:text-content-primary"
              aria-expanded={open}
            >
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {open ? 'Hide evidence' : `Show evidence (${card.evidence.length})`}
            </button>
          )}
          {open && Array.isArray(card.evidence) && card.evidence.length > 0 && (
            <ul className="mt-1.5 space-y-1 border-t border-hairline pt-1.5">
              {card.evidence.map((e, i) => {
                const navigable = isNavigableRef(e.ref);
                if (navigable) {
                  return (
                    <li key={i} className="text-[11px] flex items-start gap-1.5">
                      <FileSearch size={11} className="mt-0.5 shrink-0 text-content-muted" />
                      <button
                        type="button"
                        onClick={() => navigateToEvidence(e.ref)}
                        className="text-left text-content-secondary hover:text-accent underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm"
                        title={`Jump to ${e.ref}`}
                      >
                        {e.label}{e.ref ? ` — ${e.ref}` : ''}
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={i} className="text-[11px] text-content-muted flex items-start gap-1.5">
                    <FileSearch size={11} className="mt-0.5 shrink-0" />
                    <span>{e.label}{e.ref ? ` — ${e.ref}` : ''}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {/* Actions: dismiss / snooze / mark-acted-on. Restore on hidden cards. */}
        {!hidden ? (
          <div className="shrink-0 relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Recommendation actions"
              className="p-1 rounded hover:bg-bg-secondary text-content-muted hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <ChevronDown size={14} />
            </button>
            {menuOpen && (
              <VerdictMenu
                card={card}
                dealId={dealId}
                snapshotHash={snapshotHash}
                onClose={() => setMenuOpen(false)}
              />
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => verdict.mutate({
              dealId,
              ruleId: card.id,
              verdict: 'acted', // re-activates the card; the workspace re-render shows it
              topic: card.topic,
              verb: card.verb,
              severity: card.severity,
            })}
            disabled={verdict.isPending}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-content-secondary hover:text-content-primary px-1.5 py-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Eye size={11} />
            Restore
          </button>
        )}
      </div>
    </div>
  );
}

export default function RecommendationsPanel({ recommendations }) {
  const { dealId, refetch, isLoading, isAiPending } = useDealContext();
  const [showHidden, setShowHidden] = useState(false);
  const cards = Array.isArray(recommendations?.recommendations)
    ? recommendations.recommendations
    : [];
  const hidden = Array.isArray(recommendations?.hidden_by_verdict)
    ? recommendations.hidden_by_verdict
    : [];
  const snapshotHash = recommendations?.snapshot_hash || null;
  const generatedAt = recommendations?.generated_at || null;

  return (
    <div className="card-editorial">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
          <Sparkles size={16} className="text-content-muted" />
          Recommendations
          {cards.length > 0 && (
            <span className="text-xs text-content-muted ml-1">({cards.length})</span>
          )}
        </h3>
        {hidden.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-content-secondary hover:text-content-primary px-1.5 py-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-expanded={showHidden}
          >
            {showHidden ? <EyeOff size={12} /> : <Eye size={12} />}
            {showHidden ? 'Hide dismissed' : `${hidden.length} dismissed`}
          </button>
        )}
      </div>
      {cards.length === 0 && hidden.length === 0 ? (
        <div className="text-sm text-content-muted py-4 text-center">
          Not enough data yet. Upload documents, run the financial model, and add comps to
          generate recommendations.
        </div>
      ) : (
        <div className="space-y-2">
          {cards.map((c) => (
            <RecommendationCard
              key={c.id}
              card={c}
              dealId={dealId}
              snapshotHash={snapshotHash}
            />
          ))}
          {showHidden && hidden.map((c) => (
            <RecommendationCard
              key={c.id}
              card={c}
              dealId={dealId}
              snapshotHash={snapshotHash}
              hidden
            />
          ))}
        </div>
      )}
      {(snapshotHash || generatedAt) && (cards.length > 0 || hidden.length > 0) && (
        <div className="mt-3 pt-2 border-t border-hairline flex items-center justify-between gap-2 text-[10px] text-content-muted">
          <span>
            {snapshotHash && (
              <>Snapshot {snapshotHash.slice(0, 8)} · </>
            )}
            {recommendations.signal_count} signal{recommendations.signal_count === 1 ? '' : 's'}
            {generatedAt && (
              <> · computed {formatRelativeTime(generatedAt)}</>
            )}
            {isAiPending && (
              <span className="text-accent"> · refining wording with AI…</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => refetch?.()}
            disabled={isLoading}
            aria-label="Refresh recommendations"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          >
            <RefreshCw size={11} className={clsx(isLoading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}
