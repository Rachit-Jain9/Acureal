'use strict';

// CI guard: bundle-size budget (PLATFORM_OPERATIONS_PLAN.md §2).
//
// The bug class: a heavyweight vendor silently becoming a static dependency of
// a hot route (the Leaflet chunk rode along with every /deals visit until PR
// #943), or steady chunk bloat nobody notices. This runs AFTER `npm run build`
// and fails CI when the emitted JS exceeds budget.
//
// Budgets (calibrated 2026-07-08 against a healthy build: 108 chunks,
// 3.09 MB raw total, largest 424 KB = the intentionally-isolated recharts
// vendor). Generous headroom so routine growth passes; a new heavyweight
// vendor or a mis-chunked route fails loudly.
//
//   PER_CHUNK_BUDGET  520 KB raw  (recharts 424 KB + headroom)
//   TOTAL_BUDGET      4.0 MB raw  (current 3.09 MB + ~30% headroom)
//
// If a budget is hit legitimately (e.g. a deliberate new vendor), raise it in
// the SAME PR with a sentence of justification in the PR body.

const fs = require('fs');
const path = require('path');

const DIST = path.resolve(__dirname, '..', 'dist', 'assets');
const PER_CHUNK_BUDGET = 520 * 1024;
const TOTAL_BUDGET = 4.0 * 1024 * 1024;

function main() {
  if (!fs.existsSync(DIST)) {
    console.error('[check-bundle-budget] dist/assets not found — run `npm run build` first.');
    process.exit(1);
  }
  const chunks = fs
    .readdirSync(DIST)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ file: f, size: fs.statSync(path.join(DIST, f)).size }))
    .sort((a, b) => b.size - a.size);

  const total = chunks.reduce((s, c) => s + c.size, 0);
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  const failures = [];

  for (const c of chunks) {
    if (c.size > PER_CHUNK_BUDGET) {
      failures.push(`chunk over budget: ${c.file} = ${kb(c.size)} (budget ${kb(PER_CHUNK_BUDGET)})`);
    }
  }
  if (total > TOTAL_BUDGET) {
    failures.push(`total JS over budget: ${kb(total)} (budget ${kb(TOTAL_BUDGET)})`);
  }

  console.log(
    `[check-bundle-budget] ${chunks.length} chunks · total ${kb(total)} / ${kb(TOTAL_BUDGET)} · largest ${chunks[0] ? `${chunks[0].file} ${kb(chunks[0].size)}` : 'n/a'} / ${kb(PER_CHUNK_BUDGET)}`,
  );

  if (failures.length) {
    console.error('\nBundle budget FAILED:');
    failures.forEach((f) => console.error(`  ✗ ${f}`));
    console.error(
      '\nLikely cause: a heavyweight dependency became a static import of a route chunk.'
      + ' Lazy-load it (React.lazy) or justify + raise the budget in this PR.',
    );
    process.exit(1);
  }
  console.log('[check-bundle-budget] within budget.');
}

main();
