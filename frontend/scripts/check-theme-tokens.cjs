#!/usr/bin/env node
/**
 * Theme-token guard — fails when raw Tailwind palette utilities (e.g. bg-red-50,
 * text-green-700, border-amber-200, bg-primary-600) appear in app UI code.
 *
 * Why: REDIP is themeable (default dark, light supported) via a single
 * html[data-theme] flip. Raw palette utilities compile to fixed hex and break
 * in the theme they weren't tuned for. All colors must route through the
 * semantic tokens documented in docs/THEMING_TOKENS.md.
 *
 * Usage:  node frontend/scripts/check-theme-tokens.cjs   (exit 1 if violations)
 * Reused by the vitest guard test so it runs in CI via `npm test`.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'src');
const SCAN_DIRS = ['components', 'pages'];

// Families that have semantic-token equivalents and must NOT be hardcoded.
const FAMILIES = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan',
  'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'primary',
].join('|');
const PROPS = 'bg|text|border|ring|divide|from|to|via|fill|stroke|placeholder|outline|decoration|caret|ring-offset';
// A palette utility, optionally with variant prefixes, NOT opacity-modified.
// Negative lookahead (?![\d/]) skips opacity forms (bg-red-500/10) and avoids
// partial matches on longer numbers.
const RE = new RegExp(
  `(?:^|[\\s"'\\\`{(\\[])((?:[a-z-]+:)*(?:${PROPS})-(?:${FAMILIES})-(?:50|100|200|300|400|500|600|700|800|900))(?![\\d/\\w])`,
  'g',
);

// Opacity-suffixed forms that STILL break the theme flip. The primary RE
// deliberately skips ALL `/opacity` forms because mid-shade tints
// (bg-*-500/10, ring-*-400/40) read correctly on both themes — those stay
// blessed (see docs/THEMING_TOKENS.md). But two families of opacity utility
// are genuinely broken and must be caught:
//   • LIGHT backgrounds/borders/rings (shades 50/100/200) stay near-white even
//     at low alpha → a glaring wash on the near-black dark workspace;
//   • DARK text shades (700/800/900) stay near-black → invisible ink on dark.
// These two narrow arms flag exactly those, leaving every mid-tint alone.
const BG_PROPS = 'bg|border|ring|divide|from|to|via|fill|outline|ring-offset';
const TEXT_PROPS = 'text|placeholder|decoration|caret|stroke';
const BOUND = `(?:^|[\\s"'\\\`{(\\[])`;
const RE_WASH = new RegExp(
  `${BOUND}((?:[a-z-]+:)*(?:${BG_PROPS})-(?:${FAMILIES})-(?:50|100|200)/\\d{1,3})`
  + `|${BOUND}((?:[a-z-]+:)*(?:${TEXT_PROPS})-(?:${FAMILIES})-(?:700|800|900)/\\d{1,3})`,
  'g',
);

// Allowlisted paths (relative to src/) — intentional exceptions.
const ALLOW = [
  /^pages[\\/]+landing[\\/]/,                     // art-directed marketing surface
  /^components[\\/]+auth[\\/]+GoogleSignInButton/, // Google brand logo palette
];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function scan() {
  const files = [];
  for (const d of SCAN_DIRS) {
    const dir = path.join(ROOT, d);
    if (fs.existsSync(dir)) walk(dir, files);
  }
  const violations = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (ALLOW.some((re) => re.test(path.relative(ROOT, file)))) continue;
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      // ignore line comments to avoid flagging historical notes
      const code = line.replace(/\/\/.*$/, '');
      RE.lastIndex = 0;
      let m;
      while ((m = RE.exec(code)) !== null) {
        violations.push({ file: rel, line: i + 1, match: m[1] });
      }
      RE_WASH.lastIndex = 0;
      while ((m = RE_WASH.exec(code)) !== null) {
        violations.push({ file: rel, line: i + 1, match: m[1] || m[2] });
      }
    });
  }
  return violations;
}

module.exports = { scan };

if (require.main === module) {
  const v = scan();
  if (v.length === 0) {
    console.log('✓ theme-token guard: no raw palette utilities in components/pages.');
    process.exit(0);
  }
  console.error(`✗ theme-token guard: ${v.length} raw palette utilities found (use semantic tokens — see docs/THEMING_TOKENS.md):\n`);
  const byFile = {};
  for (const x of v) (byFile[x.file] ||= []).push(x);
  for (const f of Object.keys(byFile).sort()) {
    console.error(`  ${f}`);
    for (const x of byFile[f].slice(0, 12)) console.error(`    L${x.line}: ${x.match}`);
    if (byFile[f].length > 12) console.error(`    … +${byFile[f].length - 12} more`);
  }
  process.exit(1);
}
