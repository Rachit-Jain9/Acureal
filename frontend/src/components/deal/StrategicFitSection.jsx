import { Compass, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { clsx } from 'clsx';
import {
  useDealBestUse,
  useDealStructureRecommender,
  useDealCapitalStack,
} from '../../hooks/useDealContext';
import BestUseSimulatorPanel from './BestUseSimulatorPanel';
import DealStructureRecommenderPanel from './DealStructureRecommenderPanel';
import CapitalStackOptimizerPanel from './CapitalStackOptimizerPanel';

/**
 * StrategicFitSection — Phase 2 closeout, the property-consultant trio.
 *
 * Visual unification of the three Phase 2 strategic-fit panels:
 *
 *   1. Best Use Simulator       — "what asset class fits this parcel?"
 *   2. Deal-Structure Recommender — "how should this deal be structured?"
 *   3. Capital-Stack Optimizer    — "how should this project be funded?"
 *
 * Each card retains its own expandable functionality. This wrapper:
 *
 *   • Renders a section header ("Strategic Fit Analysis") that explains
 *     the three questions the cards together answer.
 *   • Surfaces a glanceable summary strip with the top-fit verdict from
 *     each card, so the deal team can scan the consultant answer in one
 *     line before deep-diving into any individual card.
 *   • Stacks the three cards full-width below (each card already grids
 *     internally — three columns would be too cramped).
 *   • Bows out cleanly when all three are unavailable (e.g. fresh deal,
 *     no asset class, no kernel run yet) — renders nothing instead of
 *     a hollow section header.
 *
 * Reads from the same hooks the individual panels read from, so we never
 * pay the cost of duplicate data fetches. The composed slices are
 * computed server-side on the workspace endpoint.
 */

const VERDICT_TONE = {
  Recommend:    'bg-green-50 text-green-700 border-green-200',
  Consider:     'bg-sky-50 text-sky-700 border-sky-200',
  'Re-examine': 'bg-amber-50 text-amber-800 border-amber-200',
  'Stress-test':'bg-orange-50 text-orange-700 border-orange-200',
  Flag:         'bg-red-50 text-red-700 border-red-200',
};

// Honest reason → human label for the summary strip's missing-state copy.
const REASON_LABEL = {
  no_asset_class:           'asset class needed',
  no_parcel_coordinates:    'coordinates needed',
  no_micro_market_match:    'outside seeded markets',
  no_financial_model:       'kernel not run',
  incomplete_kernel_output: 'kernel incomplete',
  unavailable:              'unavailable',
  no_locality:              'no locality',
  no_briefing_data:         'no briefing',
};

function TopFitChip({ label, value, verdict, missingReason }) {
  if (missingReason) {
    return (
      <div className="flex items-baseline gap-1.5 text-xs">
        <span className="text-content-muted font-medium">{label}:</span>
        <span className="text-content-muted italic">{REASON_LABEL[missingReason] || missingReason}</span>
      </div>
    );
  }
  return (
    <div className="flex items-baseline gap-1.5 text-xs flex-wrap">
      <span className="text-content-muted font-medium">{label}:</span>
      <span className="text-content-primary font-medium truncate max-w-[200px]">{value}</span>
      {verdict && (
        <span
          className={clsx(
            'text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border shrink-0',
            VERDICT_TONE[verdict] || VERDICT_TONE.Flag,
          )}
        >
          {verdict}
        </span>
      )}
    </div>
  );
}

export default function StrategicFitSection() {
  const bestUse = useDealBestUse();
  const dealStructure = useDealStructureRecommender();
  const capitalStack = useDealCapitalStack();
  const [collapsed, setCollapsed] = useState(false);

  // Top-fit summaries for the at-a-glance strip
  const bestUseTop = bestUse?.scores?.[0] || null;
  const dealStructureTop = dealStructure?.scores?.[0] || null;
  const capitalStackTop = capitalStack?.scenarios?.[0] || null;

  // If every panel reports unavailable + nothing to show, bow out cleanly
  // rather than render a hollow section.
  const allUnavailable =
    !bestUseTop &&
    !dealStructureTop &&
    !capitalStackTop &&
    (bestUse?.reason === 'unavailable' || !bestUse?.reason) &&
    (dealStructure?.reason === 'unavailable' || !dealStructure?.reason) &&
    (capitalStack?.reason === 'unavailable' || !capitalStack?.reason);

  if (allUnavailable) return null;

  return (
    <section className="bg-bg-secondary/40 rounded-xl border border-hairline overflow-hidden">
      {/* Section header — explains the three questions the cards together answer */}
      <div className="px-4 sm:px-5 py-3 border-b border-hairline bg-bg-secondary/60">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 rounded"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {collapsed ? (
                <ChevronRight size={14} className="text-content-muted shrink-0" />
              ) : (
                <ChevronDown size={14} className="text-content-muted shrink-0" />
              )}
              <Compass size={16} className="text-content-muted shrink-0" />
              <h2 className="text-base font-semibold text-content-primary">Strategic Fit Analysis</h2>
            </div>
            <span className="text-[10px] uppercase tracking-wider text-content-muted shrink-0">
              Phase 2 / Pillars 2-3
            </span>
          </div>
          <p className="text-xs text-content-secondary mt-1.5 leading-snug">
            What to build · How to structure the deal · How to fund the project. Three deterministic
            scoring cards reading the same micro-market + promoter + kernel inputs.
          </p>
        </button>

        {/* At-a-glance summary strip — surfaces top-fit per question */}
        <div className="mt-2.5 flex flex-col sm:flex-row sm:flex-wrap gap-x-5 gap-y-1.5">
          <TopFitChip
            label="Best Use"
            value={bestUseTop?.label}
            verdict={bestUseTop?.verdict}
            missingReason={!bestUseTop ? bestUse?.reason : null}
          />
          <TopFitChip
            label="Structure"
            value={dealStructureTop?.label}
            verdict={dealStructureTop?.verdict}
            missingReason={!dealStructureTop ? dealStructure?.reason : null}
          />
          <TopFitChip
            label="Capital Stack"
            value={capitalStackTop?.label}
            verdict={capitalStackTop?.verdict}
            missingReason={!capitalStackTop ? capitalStack?.reason : null}
          />
        </div>
      </div>

      {/* Body — the three cards, stacked. Collapsible to reduce vertical
          weight when the operator wants to focus on other Overview content. */}
      {!collapsed && (
        <div className="p-3 sm:p-4 space-y-3 sm:space-y-4">
          <BestUseSimulatorPanel />
          <DealStructureRecommenderPanel />
          <CapitalStackOptimizerPanel />
        </div>
      )}
    </section>
  );
}
