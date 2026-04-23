#!/usr/bin/env node
/**
 * Fail CI if the financial-kernel asset-class defaults haven't been reviewed
 * against their source in the last 90 days.
 *
 * Every default in `packages/financial-kernel/src/config/defaults.ts` carries
 * a `lastReviewed` ISO date. The defaults registry funnels every entry
 * through `M(...)` which stamps a single fallback date — so in practice one
 * date governs the entire registry. This script extracts that fallback date
 * and compares it against today.
 *
 * Why this exists:
 *   - Market assumptions (stamp duty, GST, ADR, occupancy, cap rates) drift
 *     with regulation and market conditions. A stale default is indistinguishable
 *     from a hardcoded rate until an investor notices the miss.
 *   - We don't have a live market feed (tracked in TODO_DATA.md). Until we do,
 *     a staleness check is the cheapest accountability mechanism: the
 *     reviewer must manually cite the source when bumping `lastReviewed`.
 *
 * Usage:
 *   node scripts/check-defaults-staleness.mjs            # default 90-day window
 *   node scripts/check-defaults-staleness.mjs --max-age-days 60
 *   node scripts/check-defaults-staleness.mjs --warn     # warn only, never fail
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULTS_PATH = resolve(
  __dirname,
  '..',
  'packages',
  'financial-kernel',
  'src',
  'config',
  'defaults.ts',
);

// CLI: parse --max-age-days N, --warn
const args = process.argv.slice(2);
const MAX_AGE_DAYS = (() => {
  const idx = args.indexOf('--max-age-days');
  if (idx === -1) return 90;
  const n = parseInt(args[idx + 1], 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.error('--max-age-days requires a positive integer');
    process.exit(2);
  }
  return n;
})();
const WARN_ONLY = args.includes('--warn');

function extractFallbackDate(source) {
  // Match: lastReviewed: opts?.lastReviewed ?? 'YYYY-MM-DD'
  const match = source.match(/lastReviewed\s*:\s*opts\?\.lastReviewed\s*\?\?\s*'(\d{4}-\d{2}-\d{2})'/);
  if (!match) {
    throw new Error(
      'Could not find the `lastReviewed` fallback date in defaults.ts. ' +
        'Did the `M()` helper signature change? Update this script to match.',
    );
  }
  return match[1];
}

function daysBetween(isoDate) {
  const reviewed = new Date(`${isoDate}T00:00:00Z`).getTime();
  const now = Date.now();
  if (!Number.isFinite(reviewed)) {
    throw new Error(`Invalid ISO date in defaults.ts: ${isoDate}`);
  }
  return Math.floor((now - reviewed) / (1000 * 60 * 60 * 24));
}

function main() {
  const source = readFileSync(DEFAULTS_PATH, 'utf8');
  const reviewedDate = extractFallbackDate(source);
  const ageDays = daysBetween(reviewedDate);

  const prefix = `[defaults-staleness] lastReviewed=${reviewedDate} age=${ageDays}d threshold=${MAX_AGE_DAYS}d`;

  if (ageDays <= MAX_AGE_DAYS) {
    console.log(`${prefix} — OK`);
    return;
  }

  const msg =
    `${prefix} — STALE. Defaults in packages/financial-kernel/src/config/defaults.ts ` +
    `have not been reviewed in ${ageDays} days (> ${MAX_AGE_DAYS}-day window). ` +
    `Re-check each default against its cited source (regulatory notices, market ` +
    `benchmarks), and bump the fallback date in the \`M()\` helper. Track any ` +
    `unresolved feed blockers in TODO_DATA.md.`;

  if (WARN_ONLY) {
    console.warn(`WARNING: ${msg}`);
    return;
  }

  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

main();
