#!/usr/bin/env node
/**
 * CSS-variable guard — fails when a component/page references a `--color-*`
 * custom property via `var(--color-…)` that is NOT defined in index.css.
 *
 * Why: a mistyped token name (e.g. `var(--color-content-muted)` when the real
 * token is `--color-text-muted`) resolves to NOTHING — the element renders
 * transparent/invisible with no error, no build warning, nothing. This exact
 * bug shipped twice (an invisible waterfall "Costs" bar + an invisible System
 * Health status stripe). Inline `style={{ backgroundColor: 'var(--color-…)' }}`
 * is the common escape hatch that the Tailwind theme-token guard can't see, so
 * this closes that gap.
 *
 * Usage:  node frontend/scripts/check-css-vars.cjs   (exit 1 if violations)
 * Reused by the vitest guard test so it runs in CI via `npm test`.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src');

function definedVars() {
  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8');
  return new Set([...css.matchAll(/(--color-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '__tests__') walk(full, out);
    } else if (/\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function scan() {
  const defined = definedVars();
  const dirs = ['components', 'pages'].map((d) => path.join(SRC, d)).filter((d) => fs.existsSync(d));
  const files = dirs.flatMap((d) => walk(d, []));
  const violations = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/var\((--color-[a-z0-9-]+)\)/g)) {
        if (!defined.has(m[1])) violations.push({ file: rel, line: i + 1, varName: m[1] });
      }
    });
  }
  return violations;
}

module.exports = { scan };

if (require.main === module) {
  const v = scan();
  if (v.length === 0) {
    console.log('✓ css-var guard: every var(--color-*) reference is defined in index.css.');
    process.exit(0);
  }
  console.error(`✗ css-var guard: ${v.length} undefined CSS-variable reference(s) — these render invisible:\n`);
  for (const x of v) console.error(`  ${x.file}:${x.line}  ${x.varName}`);
  process.exit(1);
}
