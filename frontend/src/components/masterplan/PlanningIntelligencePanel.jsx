import DecisionStrip from './DecisionStrip';
import BuildabilityLab from './BuildabilityLab';
import LandUseInsightPanel from './LandUseInsightPanel';
import DistrictIntelligencePanel from './DistrictIntelligencePanel';
import SourceExplorerPanel from './SourceExplorerPanel';
import UavBenchmarkPanel from './UavBenchmarkPanel';
import BengaluruStreetLookupPanel from './BengaluruStreetLookupPanel';
import BbmpWardSummaryPanel from './BbmpWardSummaryPanel';
import BulkAddressLookupPanel from './BulkAddressLookupPanel';
import ReviewQueuePanel from './ReviewQueuePanel';

/**
 * The "Planning Intelligence" tab of the Master Plan admin page.
 *
 * This is a pure composition of nine pre-existing analytic / lookup
 * panels stacked vertically. Each child panel manages its own data and
 * state — this component is purely layout.
 *
 * Extracted from `pages/MasterPlanAdminPage.jsx` as part of the Task #6
 * decomposition (Tier C — tab-panel extractions). Behaviour-preserving
 * move, no logic changes.
 */
export default function PlanningIntelligencePanel() {
  return (
    <div className="space-y-10">
      <DecisionStrip />
      <div className="border-t border-hairline pt-8">
        <BuildabilityLab />
      </div>
      <div className="border-t border-hairline pt-8">
        <LandUseInsightPanel />
      </div>
      <div className="border-t border-hairline pt-8">
        <DistrictIntelligencePanel />
      </div>
      <div className="border-t border-hairline pt-8">
        <SourceExplorerPanel />
      </div>
      <div className="border-t border-hairline pt-8">
        <UavBenchmarkPanel />
      </div>
      <div className="border-t border-hairline pt-8">
        <BengaluruStreetLookupPanel />
      </div>
      <div className="border-t border-hairline pt-8">
        <BbmpWardSummaryPanel />
      </div>
      {/* C-5: bulk address → context lookup. Paste up to 50 addresses,
          get a derived-context table back. Useful for screening leads
          before creating deals. */}
      <div className="border-t border-hairline pt-8">
        <BulkAddressLookupPanel />
      </div>
      <div className="border-t border-hairline pt-8">
        <ReviewQueuePanel />
      </div>
    </div>
  );
}
