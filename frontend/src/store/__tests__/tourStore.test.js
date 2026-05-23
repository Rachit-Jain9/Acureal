import { describe, it, expect, beforeEach } from 'vitest';
import useTourStore from '../tourStore';

const STORAGE_KEY = 'redip.productTour.completed';
const DEAL_STORAGE_KEY = 'redip.dealWorkspaceTour.completed';
const GS_STORAGE_KEY = 'redip.gettingStarted.dismissed';

describe('tourStore', () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(DEAL_STORAGE_KEY);
    window.localStorage.removeItem(GS_STORAGE_KEY);
    useTourStore.setState({
      active: true,
      dealTourActive: true,
      gettingStartedDismissed: false,
    });
  });

  it('dismiss flips active off and persists completion', () => {
    useTourStore.getState().dismiss();
    expect(useTourStore.getState().active).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('replay flips active back on and clears the stored flag', () => {
    useTourStore.getState().dismiss();
    expect(useTourStore.getState().active).toBe(false);

    useTourStore.getState().replay();
    expect(useTourStore.getState().active).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('start flips active on without touching the stored flag', () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    useTourStore.setState({ active: false });

    useTourStore.getState().start();
    expect(useTourStore.getState().active).toBe(true);
    // start() is for ad-hoc re-opens; it does not write to storage.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  // Deal-workspace tour ─────────────────────────────────────────────────────

  it('dismissDealTour flips dealTourActive off and persists completion', () => {
    useTourStore.getState().dismissDealTour();
    expect(useTourStore.getState().dealTourActive).toBe(false);
    expect(window.localStorage.getItem(DEAL_STORAGE_KEY)).toBe('1');
  });

  it('replayDealTour flips dealTourActive back on and clears the stored flag', () => {
    useTourStore.getState().dismissDealTour();
    expect(useTourStore.getState().dealTourActive).toBe(false);

    useTourStore.getState().replayDealTour();
    expect(useTourStore.getState().dealTourActive).toBe(true);
    expect(window.localStorage.getItem(DEAL_STORAGE_KEY)).toBeNull();
  });

  it('the two tours are independent — dismissing one does not touch the other', () => {
    useTourStore.getState().dismiss();
    expect(useTourStore.getState().active).toBe(false);
    expect(useTourStore.getState().dealTourActive).toBe(true);

    useTourStore.getState().dismissDealTour();
    expect(useTourStore.getState().active).toBe(false);
    expect(useTourStore.getState().dealTourActive).toBe(false);
  });

  // Getting Started dashboard panel ────────────────────────────────────────

  it('dismissGettingStarted flips dismissed on and persists the flag', () => {
    useTourStore.getState().dismissGettingStarted();
    expect(useTourStore.getState().gettingStartedDismissed).toBe(true);
    expect(window.localStorage.getItem(GS_STORAGE_KEY)).toBe('1');
  });

  it('replayGettingStarted flips dismissed off and clears the stored flag', () => {
    useTourStore.getState().dismissGettingStarted();
    expect(useTourStore.getState().gettingStartedDismissed).toBe(true);

    useTourStore.getState().replayGettingStarted();
    expect(useTourStore.getState().gettingStartedDismissed).toBe(false);
    expect(window.localStorage.getItem(GS_STORAGE_KEY)).toBeNull();
  });

  it('Getting Started is independent of the two coachmark tours', () => {
    useTourStore.getState().dismissGettingStarted();
    expect(useTourStore.getState().gettingStartedDismissed).toBe(true);
    expect(useTourStore.getState().active).toBe(true);
    expect(useTourStore.getState().dealTourActive).toBe(true);
  });
});
