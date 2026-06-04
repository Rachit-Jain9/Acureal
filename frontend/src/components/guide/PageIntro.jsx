// PageIntro — a calm, dismissible "what this page is for" banner shown the
// first time a user visits a page. Content comes from the productGuide catalog,
// so it never drifts from the Guide or the tour. A "More in the Guide" link
// deep-links to the full topic. Dismissal persists per-topic in localStorage;
// once dismissed it renders nothing — the always-present Header "?" reopens the
// Guide, so the page stays uncluttered.

import { useState } from 'react';
import { X, ArrowRight } from 'lucide-react';
import { getGuideEntry } from '../../utils/productGuide';
import { GuideIcon } from './guideIcons';
import useReducedMotion from '../../hooks/useReducedMotion';

const storageKey = (id) => `redip.pageIntro.${id}.seen`;
const wasSeen = (id) => {
  try { return window.localStorage.getItem(storageKey(id)) === '1'; } catch (_) { return false; }
};
const markSeen = (id) => {
  try { window.localStorage.setItem(storageKey(id), '1'); } catch (_) { /* private mode */ }
};

export default function PageIntro({ topicId, className = '' }) {
  const entry = getGuideEntry(topicId);
  const reduced = useReducedMotion();
  const [dismissed, setDismissed] = useState(() => wasSeen(topicId));

  if (!entry || dismissed) return null;

  const dismiss = () => { markSeen(topicId); setDismissed(true); };
  const openGuide = () => {
    window.dispatchEvent(new CustomEvent('redip:guide-open', { detail: { topicId } }));
  };

  return (
    <div
      className={`${reduced ? '' : 'redip-empty-in'} mb-6 flex items-start gap-3 rounded-lg border border-hairline bg-bg-secondary p-4 ${className}`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-hairline-soft bg-bg-elevated text-accent">
        <GuideIcon name={entry.icon} size={16} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed text-content-secondary">
          <span className="font-medium text-content-primary">{entry.label} — </span>
          {entry.what}
        </p>
        <button
          type="button"
          onClick={openGuide}
          className="mt-1.5 inline-flex items-center gap-1 rounded text-xs font-medium text-accent transition-colors duration-150 ease-out hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          More in the Guide
          <ArrowRight size={12} aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss this introduction"
        className="shrink-0 rounded p-1 text-content-muted transition-colors duration-150 ease-out hover:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <X size={14} />
      </button>
    </div>
  );
}
