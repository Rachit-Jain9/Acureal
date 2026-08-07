'use strict';

// CI guard: no unconditional smooth scrolling (FRONTEND_GUIDELINES §9).
//
// The bug class: `el.scrollIntoView({ behavior: 'smooth' })` written straight
// into a component or hook. It ignores `prefers-reduced-motion`, and a
// programmatic smooth scroll is one of the motions most reliably associated
// with vestibular discomfort — a user who has asked the OS for reduced motion
// still gets the page swept out from under them.
//
// This was NOT a design decision anywhere in this codebase: ten components
// already honoured the setting via `useReducedMotion`, and five imperative
// call sites simply missed it (BengaluruStreetLookupPanel, useEvidenceNavigate,
// useTargetRect, CompsPage, FinancialsPage). Missed instances, not intent.
//
// The fix is `scrollIntoView` from `src/utils/motion.js`, which reads the media
// query at call time and degrades to an instant jump. This guard keeps the raw
// literal from coming back.
//
// Allowlist: add `{ file, reason }` for a deliberate exception — e.g. a scroll
// inside a surface that is itself only shown when motion is already permitted.

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src');

const ALLOWLIST = [
  // motion.js is the one place allowed to name the literal — it is the
  // implementation that decides between 'smooth' and 'auto'.
  { file: 'utils/motion.js', reason: 'the helper that implements the choice' },
];

// `behavior: 'smooth'` / `behavior:"smooth"` with any spacing. A ternary such
// as `behavior: reduced ? 'auto' : 'smooth'` is CORRECT and must not trip the
// guard, so a `?` between `behavior:` and the literal exempts the line.
const RAW_SMOOTH = /behavior\s*:\s*(['"])smooth\1/;
const HAS_CONDITIONAL = /behavior\s*:\s*[^,}]*\?/;

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(full, out);
    } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

function scan() {
  const violations = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    if (ALLOWLIST.some((a) => rel === a.file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!RAW_SMOOTH.test(line)) return;
      if (HAS_CONDITIONAL.test(line)) return; // reduced ? 'auto' : 'smooth'
      violations.push({ file: rel, line: i + 1, match: line.trim().slice(0, 90) });
    });
  }
  return violations;
}

module.exports = { scan };

if (require.main === module) {
  const v = scan();
  if (v.length) {
    console.error(`${v.length} unconditional smooth scroll(s):`);
    v.forEach((x) => console.error(`  ${x.file}:${x.line}  ${x.match}`));
    process.exit(1);
  }
  console.log('[check-smooth-scroll] clean — every smooth scroll respects reduced motion.');
}
