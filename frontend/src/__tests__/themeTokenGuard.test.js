import { describe, it, expect } from 'vitest';
import guard from '../../scripts/check-theme-tokens.cjs';

// CI gate for the dark-mode theming migration (2026-06-25): no raw Tailwind
// palette utilities (bg-red-50, text-green-700, bg-primary-600, …) may appear in
// src/components or src/pages. All colors must route through the semantic theme
// tokens so the single html[data-theme] flip stays correct. See
// docs/THEMING_TOKENS.md. The allowlist (marketing landing, brand colors,
// opacity-modified utilities) lives in the guard script itself.
describe('theme-token guard', () => {
  it('has zero raw Tailwind palette utilities in components/pages', () => {
    const violations = guard.scan();
    if (violations.length > 0) {
      const sample = violations
        .slice(0, 25)
        .map((v) => `  ${v.file}:${v.line}  ${v.match}`)
        .join('\n');
      throw new Error(
        `${violations.length} raw palette utilities found — use semantic tokens (docs/THEMING_TOKENS.md):\n${sample}`,
      );
    }
    expect(violations.length).toBe(0);
  });
});
