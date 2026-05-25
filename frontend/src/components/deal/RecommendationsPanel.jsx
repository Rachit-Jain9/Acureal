import { useState } from 'react';
import {
  Sparkles, ChevronRight, ChevronDown, AlertTriangle, Info, FileSearch,
} from 'lucide-react';
import { clsx } from 'clsx';

/**
 * RecommendationsPanel — surfaces the deterministic Recommendation Engine
 * candidates on the deal Overview. Each card is built from kernel + comp +
 * approval signals; no AI in this PR (the narrator lands in PR-4 and only
 * rephrases AI-narratable cards). The legal carve-out cards
 * (ai_narratable === false) ship the deterministic template — the AI
 * narrator MUST NOT rephrase them.
 *
 * Visual rules (CLAUDE.md / feedback_uiux_standards.md):
 *   - Editorial, not tacky. Neutral chrome + colored chip on the verb.
 *   - Severity drives the chip tint, not the whole card.
 *   - Evidence is collapsed by default; one click reveals provenance.
 *   - "Not enough data yet" empty state — never a spinner.
 */

const VERB_TONE = {
  Recommend:    'bg-blue-50 text-blue-700 border-blue-200',
  Consider:     'bg-slate-50 text-slate-700 border-slate-200',
  'Re-examine': 'bg-amber-50 text-amber-800 border-amber-200',
  Flag:         'bg-red-50 text-red-700 border-red-200',
  'Stress-test':'bg-purple-50 text-purple-700 border-purple-200',
};

const SEVERITY_ICON = (severity) => {
  if (severity >= 4) return <AlertTriangle size={14} className="text-red-600" />;
  if (severity >= 3) return <Info size={14} className="text-amber-600" />;
  return <Info size={14} className="text-slate-500" />;
};

function RecommendationCard({ card }) {
  const [open, setOpen] = useState(false);
  const verbCls = VERB_TONE[card.verb] || 'bg-slate-50 text-slate-700 border-slate-200';

  return (
    <div className="border border-hairline rounded-md bg-surface px-3 py-2.5">
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
          </div>
          <div className="text-sm text-content-primary leading-snug">{card.headline}</div>
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
              {card.evidence.map((e, i) => (
                <li key={i} className="text-[11px] text-content-muted flex items-start gap-1.5">
                  <FileSearch size={11} className="mt-0.5 shrink-0" />
                  <span>{e.label}{e.ref ? ` — ${e.ref}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RecommendationsPanel({ recommendations }) {
  const cards = Array.isArray(recommendations?.recommendations)
    ? recommendations.recommendations
    : [];

  return (
    <div className="card-editorial">
      <h3 className="text-base font-semibold text-content-primary flex items-center gap-2 mb-3">
        <Sparkles size={16} className="text-content-muted" />
        Recommendations
        {cards.length > 0 && (
          <span className="text-xs text-content-muted ml-1">({cards.length})</span>
        )}
      </h3>
      {cards.length === 0 ? (
        <div className="text-sm text-content-muted py-4 text-center">
          Not enough data yet. Upload documents, run the financial model, and add comps to
          generate recommendations.
        </div>
      ) : (
        <div className="space-y-2">
          {cards.map((c) => (
            <RecommendationCard key={c.id} card={c} />
          ))}
        </div>
      )}
      {recommendations?.snapshot_hash && cards.length > 0 && (
        <div className="mt-3 pt-2 border-t border-hairline text-[10px] text-content-muted">
          Snapshot {recommendations.snapshot_hash.slice(0, 8)} ·{' '}
          {recommendations.signal_count} signal{recommendations.signal_count === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}
