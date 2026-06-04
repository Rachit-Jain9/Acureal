import { describe, it, expect } from 'vitest';
import { TOUR_STEPS, DEAL_TOUR_STEPS, WELCOME_PANES } from '../tourSteps';

// The tours derive from utils/productGuide.js. These tests lock the derivation
// so a future catalog edit (reorder, new entry, renamed id) can't silently
// break ProductTour/DealWorkspaceTour — both depend on these exact ids (for the
// Coachmark `key`) and CSS-selector targets (for DOM measurement).

describe('tourSteps derivation', () => {
  it('derives the 11 sidebar steps in sidebar order', () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      'dashboard', 'deals', 'intelligence', 'comps', 'reports',
      'master-plan', 'parcel-intel', 'comps-queue', 'ai-usage', 'ab-eval',
      'settings',
    ]);
  });

  it('anchors each sidebar step to its data-tour selector', () => {
    TOUR_STEPS.forEach((s) => {
      expect(s.target).toBe(`[data-tour="nav-${s.id}"]`);
    });
  });

  it('derives the 10 deal-tab steps in tab order', () => {
    expect(DEAL_TOUR_STEPS.map((s) => s.id)).toEqual([
      'overview', 'parcel', 'zoning', 'documents', 'activity',
      'financial', 'dd', 'risk', 'comps', 'audit',
    ]);
  });

  it('anchors each deal step to its #tab- selector', () => {
    DEAL_TOUR_STEPS.forEach((s) => {
      expect(s.target).toBe(`#tab-${s.id}`);
    });
  });

  it('gives every step a non-empty title and body', () => {
    [...TOUR_STEPS, ...DEAL_TOUR_STEPS].forEach((s) => {
      expect(s.title).toBeTruthy();
      expect(s.body).toBeTruthy();
    });
  });

  it('keeps the three welcome panes (middle pane carries the bullets)', () => {
    expect(WELCOME_PANES).toHaveLength(3);
    expect(WELCOME_PANES[1].bullets).toHaveLength(3);
  });
});
