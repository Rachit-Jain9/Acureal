// ProductTourReplayCard — Settings-page card that lets the user replay
// REDIP's onboarding surfaces:
//   - The welcome / sidebar tour (3-pane intro + coachmark walkthrough).
//   - The deal-workspace tour (per-tab coachmarks inside an open deal).
//   - The Getting Started first-run dashboard panel.
//
// Wraps the tourStore so SettingsPage doesn't need to know how the
// onboarding surfaces are wired up.
//
// Why each handler navigates instead of just flipping the flag: the
// onboarding panels only render on their host surface (welcome modal
// + sidebar coachmarks at /dashboard, deal-workspace coachmarks on a
// deal-detail page, Getting Started on the dashboard). Flipping the
// flag from Settings without navigating gives the operator zero visible
// feedback — "did anything happen?". Each handler now takes the user
// to the surface where the replayed UI will actually appear.

import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Button } from '../../design-system';
import { useDeals } from '../../hooks/useDeals';
import useTourStore from '../../store/tourStore';
import { toast } from '../common/Toast';

export default function ProductTourReplayCard() {
  const replaySidebar = useTourStore((s) => s.replay);
  const replayDealTour = useTourStore((s) => s.replayDealTour);
  const replayGettingStarted = useTourStore((s) => s.replayGettingStarted);
  const navigate = useNavigate();

  // The deal-workspace tour only renders on a deal-detail page. Grab
  // the most-recent active deal up front so the Replay button can
  // navigate the user straight to it. If the workspace has no deals,
  // we toast a friendly note instead of dropping them on a blank page.
  const { data: dealsData } = useDeals({ limit: 1, liveOnly: true });
  const firstDealId = dealsData?.data?.[0]?.id || null;

  const handleReplayGettingStarted = () => {
    replayGettingStarted();
    navigate('/dashboard');
    toast.success('Getting Started panel restored.');
  };

  const handleReplaySidebar = () => {
    replaySidebar();
    // The welcome modal mounts on every authenticated route via Layout,
    // but the coachmarks anchor to sidebar nav items — easiest to land
    // on the dashboard so the first highlighted target is obvious.
    navigate('/dashboard');
    toast.success('Welcome tour will start now.');
  };

  const handleReplayDealTour = () => {
    replayDealTour();
    if (firstDealId) {
      navigate(`/dashboard/deals/${firstDealId}?tab=overview`);
      toast.success('Deal-workspace tour will start on this deal.');
    } else {
      toast('Open any deal to see the workspace tour.', { icon: 'ⓘ' });
    }
  };

  return (
    <div className="bg-bg-elevated rounded-xl shadow-sm border border-hairline-strong p-6">
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
        <Button variant="secondary" size="sm" onClick={handleReplaySidebar}>
          Replay the welcome tour
        </Button>
        <Button variant="secondary" size="sm" onClick={handleReplayDealTour}>
          Replay the deal-workspace tour
        </Button>
      </div>
    </div>
  );
}
