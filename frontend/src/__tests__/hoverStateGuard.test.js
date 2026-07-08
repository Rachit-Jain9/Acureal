import { describe, it, expect } from 'vitest';
import guard from '../../scripts/check-hover-states.cjs';

// CI gate for hover feedback (2026-07-08): no interactive element may declare a
// hover: utility identical to its resting token (`text-accent hover:text-accent`)
// — a "dead hover" that reads as unfinished. 22 of these were fixed in PRs
// #943/#945; this keeps the count at zero. Deliberate exceptions go in the
// ALLOWLIST inside scripts/check-hover-states.cjs with a reason.
describe('hover-state guard', () => {
  it('has zero no-op hover classes in src', () => {
    const violations = guard.scan();
    if (violations.length > 0) {
      const sample = violations
        .slice(0, 25)
        .map((v) => `  ${v.file}:${v.line}  ${v.match}`)
        .join('\n');
      throw new Error(
        `${violations.length} no-op hover class(es) — hover must differ from the resting token (FRONTEND_GUIDELINES §3):\n${sample}`,
      );
    }
    expect(violations.length).toBe(0);
  });
});
