// ProductTourReplayCard — small Settings-page card that lets the user
// replay either of REDIP's onboarding tours (the welcome / sidebar tour
// and the deal-workspace tour). Wraps the tourStore so SettingsPage
// doesn't need to know how the tours are wired up.

import { Sparkles } from 'lucide-react';
import { Button } from '../../design-system';
import useTourStore from '../../store/tourStore';

export default function ProductTourReplayCard() {
  const replaySidebar = useTourStore((s) => s.replay);
  const replayDealTour = useTourStore((s) => s.replayDealTour);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-hairline-strong p-6">
      <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
        <Sparkles size={18} />
        Product tour
      </h3>
      <p className="mt-1 text-sm text-content-secondary">
        Replay the welcome tour that introduces REDIP and walks through each
        section in the sidebar, or re-do the per-tab walk-through that opens
        the first time you visit a deal.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={replaySidebar}>
          Replay the welcome tour
        </Button>
        <Button variant="secondary" size="sm" onClick={replayDealTour}>
          Replay the deal-workspace tour
        </Button>
      </div>
    </div>
  );
}
