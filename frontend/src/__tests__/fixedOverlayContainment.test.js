import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard: page-level wrappers must never become containing blocks for
 * `position: fixed` descendants.
 *
 * ── The bug this pins (fixed 2026-07-17, introduced by #884 on 2026-06-25) ──
 * `.redip-tab-fade` / `.redip-route-fade` wrap ENTIRE pages. Their fade
 * animation carried two properties that each — independently and permanently —
 * turn the wrapper into the containing block for every fixed-positioned
 * descendant:
 *
 *   1. `will-change: transform` — per the CSS will-change spec, listing
 *      `transform` induces a containing block exactly as an actual transform
 *      would, even while the element is idle.
 *   2. `animation-fill-mode: both` (or `forwards`) — retains the final
 *      keyframe's `transform: translateY(0)` forever, and ANY non-none
 *      transform value, including the identity, creates a containing block.
 *
 * Result: every non-portaled modal/drawer opened inside a page (17 files at
 * the time) had its "fullscreen" overlay positioned against the page wrapper
 * instead of the viewport. The operator's AutoFill modal rendered with its
 * footer — and the Apply button — below the fold, with nothing scrollable,
 * because the card never hit its 90vh cap while the page's scroll was locked.
 *
 * These assertions are deliberately BROAD (any stylesheet, any element): a
 * will-change:transform or a retained transform is only ever safe on leaf
 * elements that never host fixed descendants, and no current Acureal style
 * needs either. If a future animation genuinely does, it must scope the
 * transform to animation-time only (fill-mode `backwards`/`none`) and leave
 * will-change to `opacity` — then update this guard with that reasoning.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(here, '..');

const collectCssFiles = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectCssFiles(full, out);
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
};

const cssFiles = collectCssFiles(SRC_ROOT);
// Strip /* … */ comments before scanning — the hazard note in index.css
// legitimately NAMES the banned declarations while explaining them.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const stylesheets = cssFiles.map((file) => ({ file, css: stripComments(readFileSync(file, 'utf8')) }));

describe('fixed-overlay containment guard', () => {
  it('found the stylesheets (guard cannot silently no-op)', () => {
    expect(cssFiles.length).toBeGreaterThan(0);
    expect(cssFiles.some((f) => f.endsWith('index.css'))).toBe(true);
  });

  it('no stylesheet declares will-change with transform', () => {
    const offenders = [];
    for (const { file, css } of stylesheets) {
      const matches = css.match(/will-change\s*:[^;]*transform[^;]*;/gi) || [];
      for (const m of matches) offenders.push(`${file}: ${m.trim()}`);
    }
    expect(offenders).toEqual([]);
  });

  it('no animation retains its end-state via fill-mode both/forwards (one audited exception)', () => {
    // A retained keyframe transform is the second trigger. Acureal's entrance
    // animations use `backwards` (pre-start frame kept, end state released) —
    // visually identical because every 100% keyframe equals the natural state.
    //
    // AUDITED EXCEPTION — `redip-toast-out`: an EXIT animation genuinely must
    // hold its end state (invisible, slid away) until Toast.jsx removes the
    // node ~200ms later, or the toast would flash back for a frame. Toasts are
    // leaf nodes inside the fixed toast stack and can never host a
    // fixed-position descendant, so the retained transform cannot trap
    // anything. Any NEW exception must be argued here the same way.
    const ALLOWED = [/redip-toast-out/];
    const offenders = [];
    for (const { file, css } of stylesheets) {
      const matches = css.match(/animation\s*:[^;]*\b(both|forwards)\b[^;]*;/gi) || [];
      for (const m of matches) {
        if (ALLOWED.some((rx) => rx.test(m))) continue;
        offenders.push(`${file}: ${m.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the page-fade wrappers use the safe form explicitly', () => {
    const index = stylesheets.find(({ file }) => file.endsWith('index.css'));
    // The selector appears twice: the reduced-motion override (animation:none)
    // and the real rule. Assert the ANIMATED rule carries the safe form.
    const rules = index.css.match(/\.redip-tab-fade\s*,\s*\.redip-route-fade\s*\{[^}]*\}/g) || [];
    const animated = rules.find((r) => /redip-content-fade/.test(r));
    expect(animated).toBeTruthy();
    expect(animated).toMatch(/animation\s*:[^;]*backwards/);
    expect(animated).toMatch(/will-change\s*:\s*opacity\s*[;}]/);
  });
});
