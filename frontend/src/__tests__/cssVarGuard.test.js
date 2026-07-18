import { describe, it, expect } from 'vitest';
import guard from '../../scripts/check-css-vars.cjs';

// CI gate against the "invisible element" bug class: an inline
// `var(--color-…)` that references a token which isn't defined in index.css
// resolves to nothing and renders transparent — no error, no build warning.
// This caught a real one (an invisible waterfall "Costs" bar + System Health
// status stripe using `--color-content-muted`, which doesn't exist; the real
// token is `--color-text-muted`). See frontend/scripts/check-css-vars.cjs.
describe('css-var guard', () => {
  it('has zero undefined var(--color-*) references in components/pages', () => {
    const violations = guard.scan();
    if (violations.length > 0) {
      const sample = violations.map((v) => `  ${v.file}:${v.line}  ${v.varName}`).join('\n');
      throw new Error(`${violations.length} undefined CSS-variable reference(s):\n${sample}`);
    }
    expect(violations.length).toBe(0);
  });
});
