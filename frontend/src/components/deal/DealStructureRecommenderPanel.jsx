import { useState } from 'react';
import { Layers, ChevronRight, ChevronDown, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { useDealStructureRecommender } from '../../hooks/useDealContext';

/**
 * DealStructureRecommenderPanel — Phase 2 / Pillar 3 (first half).
 *
 * For the deal's asset class + promoter posture + micro-market context,
 * ranks the eight deal structures on strategic fit:
 *
 *   1. Outright
 *   2. Joint Venture (JV)
 *   3. Joint Development Agreement (JDA)
 *   4. Revenue Share
 *   5. Area Share
 *   6. Profit Share
 *   7. Ground Lease
 *   8. Hybrid
 *
 * Each row carries a verdict from the closed dictionary
 * (Recommend / Consider / Re-examine / Stress-test / Flag), a 0-100 score
 * with score bar, a 2-3 line rationale, and an expandable factor
 * breakdown (structural validity, promoter compatibility, capital
 * efficiency, market posture, execution complexity).
 *
 * Pure compute — no AI narration on this panel. Every factor cites the
 * input that produced it.
 */

const VERDICT_TONE = {
  Recommend:    'bg-green-50 text-green-700 border-green-200',
  Consider:     'bg-sky-50 text-sky-700 border-sky-200',
  'Re-examine': 'bg-amber-50 text-amber-800 border-amber-200',
  'Stress-test':'bg-orange-50 text-orange-700 border-orange-200',
  Flag:         'bg-red-50 text-red-700 border-red-200',
};

const BAND_BAR = {
  high:   'bg-green-500',
  medium: 'bg-amber-500',
  low:    'bg-slate-400',
};

const FACTOR_LABEL = {
  structural_validity:    'Structural validity',
  promoter_compatibility: 'Promoter compatibility',
  capital_efficiency:     'Capital efficiency',
  market_posture:         'Market posture',
  execution_complexity:   'Execution complexity',
};

function ScoreBar({ score, band }) {
  const pct = Math.max(0, Math.min(100, Number(score) || 0));
  return (
    <div className="w-full h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
      <div
        className={clsx('h-full transition-all duration-500 ease-out', BAND_BAR[band] || BAND_BAR.low)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function FactorBreakdown({ factors }) {
  return (
    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
      {Object.entries(factors).map(([key, f]) => (
        <div key={key} className="flex items-start gap-2 text-xs">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-content-secondary font-medium">{FACTOR_LABEL[key] || key}</span>
              <span className="text-content-muted tabular-nums shrink-0">
                {f.score} / {f.of}
              </span>
            </div>
            <div className="text-content-muted leading-snug">{f.signal}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function StructureRow({ entry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-hairline last:border-0 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 rounded"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {open ? (
              <ChevronDown size={12} className="text-content-muted shrink-0" />
            ) : (
              <ChevronRight size={12} className="text-content-muted shrink-0" />
            )}
            <span className="text-sm font-medium text-content-primary truncate">{entry.label}</span>
            <span
              className={clsx(
                'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border shrink-0',
                VERDICT_TONE[entry.verdict] || VERDICT_TONE.Flag,
              )}
            >
              {entry.verdict}
            </span>
          </div>
          <span className="text-sm font-semibold text-content-primary tabular-nums shrink-0">
            {entry.score}
            <span className="text-content-muted font-normal text-xs">/100</span>
          </span>
        </div>

        <div className="mt-1.5">
          <ScoreBar score={entry.score} band={entry.band} />
        </div>

        <ul className="mt-1.5 space-y-0.5">
          {entry.rationale.map((r, i) => (
            <li key={i} className="text-xs text-content-secondary leading-snug">
              {r}
            </li>
          ))}
        </ul>
      </button>

      {open && entry.factors && <FactorBreakdown factors={entry.factors} />}
    </div>
  );
}

export default function DealStructureRecommenderPanel() {
  const slice = useDealStructureRecommender();
  const { scores = [], reason } = slice;

  // Empty / unhappy states surfaced honestly.
  if (reason === 'no_asset_class') {
    return (
      <div className="card-editorial">
        <h3 className="text-base font-semibold text-content-primary flex items-center gap-2 mb-2">
          <Layers size={16} className="text-content-muted" />
          Deal-Structure Recommender
        </h3>
        <div className="text-sm text-content-muted py-2">
          Pick an asset class for this deal to score the eight deal structures.
        </div>
      </div>
    );
  }

  if (reason === 'unavailable' || scores.length === 0) {
    return null;
  }

  const top = scores[0];

  return (
    <div className="card-editorial">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
            <Layers size={16} className="text-content-muted" />
            Deal-Structure Recommender
          </h3>
          <div className="text-xs text-content-secondary mt-1">
            Eight structures scored on structural validity, promoter compatibility, capital
            efficiency, market posture, and execution complexity.
          </div>
        </div>
        {top && (
          <span className="text-[10px] uppercase tracking-wider text-content-muted shrink-0 flex items-center gap-1">
            <Sparkles size={11} />
            Top fit: <span className="text-content-primary font-medium normal-case tracking-normal">{top.label}</span>
          </span>
        )}
      </div>

      <div>
        {scores.map((entry) => (
          <StructureRow key={entry.deal_structure} entry={entry} />
        ))}
      </div>

      <div className="mt-3 pt-2 border-t border-hairline text-[10px] text-content-muted italic">
        Scores compose the deal-structure validity matrix, promoter posture, and micro-market
        signals. Click any row to see the five factor breakdowns.
      </div>
    </div>
  );
}
