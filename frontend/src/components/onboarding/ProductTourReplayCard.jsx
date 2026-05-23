// ProductTourReplayCard — a small Settings-page card that lets the user
// replay the welcome tour. Wraps the tourStore so SettingsPage doesn't
// need to know how the tour is wired up.

import { Sparkles } from 'lucide-react';
import { Button } from '../../design-system';
import useTourStore from '../../store/tourStore';

export default function ProductTourReplayCard() {
  const replay = useTourStore((s) => s.replay);
  return (
    <div className="bg-white rounded-xl shadow-sm border border-hairline-strong p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-content-primary flex items-center gap-2">
            <Sparkles size={18} />
            Product tour
          </h3>
          <p className="mt-1 text-sm text-content-secondary">
            Replay the welcome tour that introduces REDIP and walks through each
            section in the sidebar.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={replay} className="shrink-0">
          Show the tour
        </Button>
      </div>
    </div>
  );
}
