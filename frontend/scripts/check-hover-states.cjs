'use strict';

// CI guard: no-op hover classes (PLATFORM_OPERATIONS_PLAN.md §2).
//
// The bug class: an interactive element whose hover: utility names the SAME
// token as its resting state — `text-accent hover:text-accent`,
// `bg-neg-soft … hover:bg-neg-soft` — so hovering visibly does nothing. This
// violates FRONTEND_GUIDELINES §3 (every interactive element needs all four
// states) and was fixed en masse in PRs #943/#945 (19 links + 3 buttons).
// This guard keeps it fixed.
//
// Detection: within a single line, a `text-*` or `bg-*` utility that reappears
// as `hover:<same utility>` with no suffix (a trailing `-shade`, `/opacity`
// etc. means the hover IS different and is fine).
//
// Allowlist: add `{ file, token }` entries for deliberate exceptions where
// some OTHER hover utility on the same element provides the feedback.

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src');

const ALLOWLIST = [
  // (none yet — add { file: 'pages/Foo.jsx', token: 'text-accent' } with a reason)
];

// The gap between the base token and its hover: twin may not cross a quote or
// a ternary `?` — that would join classes from DIFFERENT branches (e.g.
// `isActive ? 'bg-surface' : 'hover:bg-surface'`, where the hover is genuine
// feedback on the inactive branch).
const SAME_TOKEN_HOVER = /(?<![\w/-])((?:text|bg)-[a-z0-9-]+)\b(?![/-])[^\n'"`?]*\bhover:\1(?![\w/-])/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(jsx|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function scan() {
  const violations = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = SAME_TOKEN_HOVER.exec(line);
      if (!m) return;
      const token = m[1];
      if (ALLOWLIST.some((a) => rel.endsWith(a.file) && a.token === token)) return;
      violations.push({ file: rel, line: i + 1, match: `${token} … hover:${token}` });
    });
  }
  return violations;
}

module.exports = { scan };

if (require.main === module) {
  const v = scan();
  if (v.length) {
    console.error(`${v.length} no-op hover state(s):`);
    v.forEach((x) => console.error(`  ${x.file}:${x.line}  ${x.match}`));
    process.exit(1);
  }
  console.log('[check-hover-states] clean — no no-op hover classes.');
}
