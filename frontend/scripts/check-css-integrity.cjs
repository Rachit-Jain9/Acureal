#!/usr/bin/env node
/**
 * CSS integrity guard — fails when a rule has an EMPTY selector: a `{` that
 * opens a declaration block with nothing before it on its line.
 *
 * Why: this is the exact bug class that silently shipped THREE dead entrance
 * animations to production. A rule written as
 *     { animation: fadeInUp 260ms ...; }
 * (the selector accidentally deleted) is INVALID CSS — every browser drops it,
 * so the class never applies and the motion silently does nothing. Nothing in
 * the build or the existing tests caught it, because the className string still
 * matched; only the CSS was dead.
 *
 * Convention in this repo: a `{` always shares its line with the selector,
 * at-rule (@media/@keyframes/@supports), or keyframe stop (0%/100%/from/to)
 * that owns it. So any line whose FIRST non-whitespace character is `{` is a
 * selector-less (dead) rule. (Verified: zero legitimate lines start with `{`.)
 *
 * Usage:  node frontend/scripts/check-css-integrity.cjs   (exit 1 if violations)
 * Reused by the vitest guard test so it runs in CI via `npm test`.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'src');

function findCss(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') findCss(full, out);
    } else if (entry.name.endsWith('.css')) {
      out.push(full);
    }
  }
  return out;
}

function scan() {
  const files = fs.existsSync(ROOT) ? findCss(ROOT, []) : [];
  const violations = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/^\s*\{/.test(line)) {
        violations.push({ file: rel, line: i + 1, text: line.trim().slice(0, 70) });
      }
    });
  }
  return violations;
}

module.exports = { scan };

if (require.main === module) {
  const v = scan();
  if (v.length === 0) {
    console.log('✓ css integrity: no selector-less rules.');
    process.exit(0);
  }
  console.error(`✗ css integrity: ${v.length} selector-less rule(s) — a dropped rule means dead styles:\n`);
  for (const x of v) console.error(`  ${x.file}:${x.line}  ${x.text}`);
  process.exit(1);
}
