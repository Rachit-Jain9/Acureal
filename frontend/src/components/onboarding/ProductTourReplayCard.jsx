// ProductTourReplayCard — Settings-page card that lets the user replay
// REDIP's onboarding surfaces:
//   - The welcome / sidebar tour (3-pane intro + coachmark walkthrough).
//   - The deal-workspace tour (per-tab coachmarks inside an open deal).
//   - The Getting Started first-run dashboard panel.
//
// Wraps the tourStore so SettingsPage doesn't need to know how the
// onboarding surfaces are wired up.

import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Button } from '../../design-system';
import useTourStore from '../../store/tourStore';
import { toast } from '../common/Toast';

export default function ProductTourReplayCard() {
  const replaySidebar = useTourStore((s) => s.replay);
  const replayDealTour = useTourStore((s) => s.replayDealTour);
  const replayGettingStarted = useTourStore((s) => s.replayGettingStarted);
  const navigate = useNavigate();

  const handleReplayGettingStarted = () => {
    // Clear the dismissed flag in the store — DashboardPage reads it
    // reactively, so the panel will re-render next time we land there.
    replayGettingStarted();
    navigate('/dashboard');
    toast.success('Getting Started panel restored.');
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-hairline-strong p-6">
      <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
        <Sparkles size={18} />
        Onboarding
      </h3>
      <p className="mt-1 text-sm text-content-secondary">
        Replay any of REDIP&apos;s first-run surfaces — the dashboard
        Getting Started panel, the welcome tour that introduces REDIP
        and walks through each section in the sidebar, or the per-tab
        walkthrough that opens the first time you visit a deal.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={handleReplayGettingStarted}>
          Show Getting Started again
        </Button>
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
