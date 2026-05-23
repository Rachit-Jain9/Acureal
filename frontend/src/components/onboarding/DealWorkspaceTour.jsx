// DealWorkspaceTour — the second tour. Mounts on the deal-detail page
// and walks the user through every tab in the deal workspace with a
// coachmark, the first time they land on a deal. State lives in the
// shared tourStore so a "Replay" button in Settings can flip it back on.
//
// Defers to the sidebar tour: if that's still active, this one stays
// quiet until the user finishes or skips it.

import { useEffect, useState } from 'react';
import useTourStore from '../../store/tourStore';
import Coachmark from './Coachmark';
import { DEAL_TOUR_STEPS } from './tourSteps';

const isStepVisible = (step) => {
  const el = document.querySelector(step.target);
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

export default function DealWorkspaceTour() {
  const sidebarActive = useTourStore((s) => s.active);
  const dealTourActive = useTourStore((s) => s.dealTourActive);
  const dismiss = useTourStore((s) => s.dismissDealTour);

  const [stepIndex, setStepIndex] = useState(0);
  const [availableSteps, setAvailableSteps] = useState([]);

  // Wait a beat for the deal-detail page's tab strip to render, then
  // pick the steps whose targets actually exist. The brief delay lets
  // the deal payload + Tabs settle before we start measuring positions.
  useEffect(() => {
    if (!dealTourActive || sidebarActive) {
      setAvailableSteps([]);
      setStepIndex(0);
      return undefined;
    }

    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      const available = DEAL_TOUR_STEPS.filter(isStepVisible);
      if (available.length > 0) {
        setAvailableSteps(available);
        setStepIndex(0);
      }
    }, 700);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [dealTourActive, sidebarActive]);

  if (!dealTourActive || sidebarActive) return null;
  if (availableSteps.length === 0) return null;

  const step = availableSteps[stepIndex];
  if (!step) return null;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === availableSteps.length - 1;

  return (
    <Coachmark
      key={step.id}
      target={step.target}
      title={step.title}
      body={step.body}
      step={stepIndex + 1}
      total={availableSteps.length}
      isFirst={isFirst}
      isLast={isLast}
      onNext={() => (isLast ? dismiss() : setStepIndex((i) => i + 1))}
      onBack={() => setStepIndex((i) => Math.max(0, i - 1))}
      onSkip={dismiss}
    />
  );
}
