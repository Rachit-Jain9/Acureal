// ProductTour — the orchestrator. Shows the welcome modal first, then
// walks the user through the visible sidebar nav items as Coachmarks.
// Steps whose target isn't in the DOM (e.g. admin items a Viewer can't
// see) are filtered out before the tour begins, so the step counter
// always reflects what the user is actually about to see.
//
// Mounted once at the app shell (Layout). State lives in the Zustand
// tourStore, so a "Show tour again" button in Settings can flip it
// back on whenever the operator wants.

import { useEffect, useState } from 'react';
import useTourStore from '../../store/tourStore';
import WelcomeModal from './WelcomeModal';
import Coachmark from './Coachmark';
import { TOUR_STEPS } from './tourSteps';

const isStepVisible = (step) => {
  const el = document.querySelector(step.target);
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

export default function ProductTour() {
  const active = useTourStore((s) => s.active);
  const dismiss = useTourStore((s) => s.dismiss);

  const [phase, setPhase] = useState('welcome'); // 'welcome' | 'tour'
  const [stepIndex, setStepIndex] = useState(0);
  const [availableSteps, setAvailableSteps] = useState([]);

  // Reset when the tour goes inactive so the next replay starts clean.
  useEffect(() => {
    if (!active) {
      setPhase('welcome');
      setStepIndex(0);
      setAvailableSteps([]);
    }
  }, [active]);

  if (!active) return null;

  const handleStartTour = () => {
    const available = TOUR_STEPS.filter(isStepVisible);
    if (available.length === 0) {
      // No tour targets exist on this page — nothing useful to show.
      dismiss();
      return;
    }
    setAvailableSteps(available);
    setStepIndex(0);
    setPhase('tour');
  };

  if (phase === 'welcome') {
    return <WelcomeModal open onStartTour={handleStartTour} onSkip={dismiss} />;
  }

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
