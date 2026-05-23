// WelcomeModal — the multi-pane "what is REDIP" intro shown the first
// time a user lands on the app. Three panes (what it is, how it helps,
// let's tour), with Back / Next / Skip controls and a terminal
// "Take the tour" CTA on the last pane.

import { useState } from 'react';
import { Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';
import { Modal, Button } from '../../design-system';
import { WELCOME_PANES } from './tourSteps';

export default function WelcomeModal({ open, onStartTour, onSkip }) {
  const [paneIndex, setPaneIndex] = useState(0);
  const pane = WELCOME_PANES[paneIndex];
  const isLast = paneIndex === WELCOME_PANES.length - 1;
  const isFirst = paneIndex === 0;

  const handleClose = () => {
    setPaneIndex(0);
    onSkip();
  };

  const footer = (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {WELCOME_PANES.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 w-1.5 rounded-full transition-colors duration-150 ease-out ${
              i === paneIndex ? 'bg-accent' : 'bg-hairline-strong'
            }`}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        {!isFirst && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPaneIndex((i) => i - 1)}
            leftIcon={<ChevronLeft size={13} />}
          >
            Back
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={handleClose}>
          Skip — I'll explore
        </Button>
        {!isLast && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setPaneIndex((i) => i + 1)}
            rightIcon={<ChevronRight size={13} />}
          >
            Next
          </Button>
        )}
        {isLast && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setPaneIndex(0);
              onStartTour();
            }}
            rightIcon={<ChevronRight size={13} />}
          >
            Take the tour
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="md"
      ariaLabel="Welcome to REDIP"
      footer={footer}
      closeOnOverlayClick={false}
    >
      <div className="py-2">
        <div className="flex items-center gap-1.5 text-eyebrow font-medium uppercase text-accent">
          <Sparkles size={13} aria-hidden="true" />
          Getting started · {paneIndex + 1} of {WELCOME_PANES.length}
        </div>
        <h2 className="mt-2 text-2xl font-semibold text-content-primary">
          {pane.title}
        </h2>
        {pane.body && (
          <p className="mt-3 text-sm leading-relaxed text-content-secondary">
            {pane.body}
          </p>
        )}
        {pane.bullets && (
          <ul className="mt-4 space-y-2.5">
            {pane.bullets.map((bullet, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 text-sm leading-relaxed text-content-secondary"
              >
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                  aria-hidden="true"
                />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
