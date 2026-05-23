import { describe, it, expect, beforeEach } from 'vitest';
import useTourStore from '../tourStore';

const STORAGE_KEY = 'redip.productTour.completed';

describe('tourStore', () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    useTourStore.setState({ active: true });
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
});
