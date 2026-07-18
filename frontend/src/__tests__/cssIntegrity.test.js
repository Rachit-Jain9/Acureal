import { describe, it, expect } from 'vitest';
import guard from '../../scripts/check-css-integrity.cjs';

// CI gate against the "dead animation" bug class: a CSS rule with an empty
// selector (`{ animation: … }` with the selector accidentally deleted) is
// invalid and silently dropped by every browser, so the motion does nothing in
// production while the className still matches. This caught three real ones
// (.redip-empty-in / .redip-slide-in-top / .redip-toast-in). See
// frontend/scripts/check-css-integrity.cjs.
describe('css integrity guard', () => {
  it('has zero selector-less CSS rules (dead styles)', () => {
    const violations = guard.scan();
    if (violations.length > 0) {
      const sample = violations
        .map((v) => `  ${v.file}:${v.line}  ${v.text}`)
        .join('\n');
      throw new Error(`${violations.length} selector-less CSS rule(s) found (dead styles):\n${sample}`);
    }
    expect(violations.length).toBe(0);
  });
});
