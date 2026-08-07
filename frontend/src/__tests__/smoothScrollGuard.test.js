import { describe, it, expect, vi, afterEach } from 'vitest';
import guard from '../../scripts/check-smooth-scroll.cjs';
import { scrollIntoView, prefersReducedMotion } from '../utils/motion';

// CI gate for reduced motion (FRONTEND_GUIDELINES §9). Ten components already
// honoured `prefers-reduced-motion`; five imperative `scrollIntoView` call
// sites missed it, so a user who had asked the OS to stop moving things still
// got the page swept out from under them. Fixed by routing every imperative
// scroll through `utils/motion.js`. This keeps the raw literal from returning.
describe('smooth-scroll guard', () => {
  it('has zero unconditional smooth scrolls in src', () => {
    const violations = guard.scan();
    if (violations.length > 0) {
      const sample = violations
        .slice(0, 25)
        .map((v) => `  ${v.file}:${v.line}  ${v.match}`)
        .join('\n');
      throw new Error(
        `${violations.length} unconditional smooth scroll(s) — use scrollIntoView from utils/motion (FRONTEND_GUIDELINES §9):\n${sample}`,
      );
    }
    expect(violations.length).toBe(0);
  });
});

describe('utils/motion scrollIntoView', () => {
  const setMatches = (matches) => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches, addEventListener() {}, removeEventListener() {} })));
  };
  afterEach(() => vi.unstubAllGlobals());

  it('scrolls smoothly when motion is allowed', () => {
    setMatches(false);
    const el = { scrollIntoView: vi.fn() };
    scrollIntoView(el, { block: 'center' });
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  });

  it('jumps instantly when the user asked for reduced motion', () => {
    setMatches(true);
    const el = { scrollIntoView: vi.fn() };
    scrollIntoView(el, { block: 'center' });
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
  });

  it('reduced motion overrides an explicitly requested smooth behavior', () => {
    // Call sites must not be able to opt out of the accessibility setting.
    setMatches(true);
    const el = { scrollIntoView: vi.fn() };
    scrollIntoView(el, { behavior: 'smooth' });
    expect(el.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto' });
  });

  it('is a no-op for a missing element — every call site relied on ?. before', () => {
    setMatches(false);
    expect(() => scrollIntoView(null)).not.toThrow();
    expect(() => scrollIntoView(undefined)).not.toThrow();
    expect(() => scrollIntoView({})).not.toThrow();
  });

  it('prefersReducedMotion is false when matchMedia is unavailable (SSR-safe)', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});
