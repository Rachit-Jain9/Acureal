#!/usr/bin/env node
/**
 * Tier-1 #10 — Project-precise geocoding for the comps table.
 *
 * Up to now, every comp's lat/lng sat at a locality centroid (the bulk
 * geocode migrations from 2026-05-08 mapped every Whitefield comp to
 * one (12.97, 77.75) point, every Hebbal comp to another, etc.). The
 * cluster-pin UI from PR #169 was a workaround for that artificial
 * stacking. This script upgrades each comp to a project-precise pin
 * by querying the Google Geocoding API and writing the result + a
 * quality tag back to the row.
 *
 * The pure two-stage upgrade logic lives in
 * `backend/src/utils/geocodeUpgrade.js` so it can be unit-tested with
 * a mocked fetch and reused by future admin endpoints. This script
 * is the operator-facing wrapper around that utility.
 *
 * Companion to migration 20260516_comps_geocode_quality.sql.
 *
 * Behaviour:
 *   • Picks rows where geocode_quality IN (NULL, 'locality_centroid',
 *     'approximate'). Skips rows tagged 'rooftop' / 'range_interpolated' /
 *     'manual' — those are already as good as we can make them.
 *   • Two-stage geocode:
 *       Stage 1 — `(project_name, locality, city, India)` query.
 *                 Drift guard: > 5 km from locality centroid = reject.
 *       Stage 2 — `(project_name, city, India)` query (fallback when
 *                 stage 1 drifts and `--allow-cross-locality` is set).
 *                 Accepted only at rooftop / range_interpolated quality.
 *                 Used when a project's true coords are in a different
 *                 locality from what's recorded on the comp row.
 *   • Throttled at ~5 req/sec (well under Google's QPS limit). Override
 *     via --rps. Note: stage-2 fires only on stage-1 drift, so the
 *     real worst case is ~10 req/sec, still under Google's 50 ceiling.
 *   • Idempotent — already-upgraded rows are skipped on re-runs.
 *   • Persists Google's `geometry.location_type` directly:
 *       ROOFTOP / RANGE_INTERPOLATED / GEOMETRIC_CENTER / APPROXIMATE
 *
 * Required env (read from `backend/.env` automatically):
 *   GOOGLE_MAPS_API_KEY
 *   DATABASE_URL  (Mumbai pooler)
 *
 * Usage (run from the `backend/` directory so the `pg` import resolves —
 * same convention as scripts/migrate-tokyo-to-mumbai.mjs):
 *
 *   cd backend
 *   node ../scripts/upgrade-comps-geocoding.mjs                              # dry run, stage-1 only
 *   node ../scripts/upgrade-comps-geocoding.mjs --apply                      # commit, stage-1 only
 *   node ../scripts/upgrade-comps-geocoding.mjs --allow-cross-locality       # dry run with stage-2 fallback
 *   node ../scripts/upgrade-comps-geocoding.mjs --apply --allow-cross-locality
 *   node ../scripts/upgrade-comps-geocoding.mjs --apply --limit 10
 *   node ../scripts/upgrade-comps-geocoding.mjs --rps 2 --apply
 *
 * Cost: ~$0.005 per call. 80 comps × 1–2 calls = ~$0.40–$0.80 worst case.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

// `pg` and `dotenv` live in backend/node_modules — resolve them from
// there explicitly so this script works regardless of CWD or whether a
// root-level package.json exists.
const _dir = dirname(fileURLToPath(import.meta.url));
const requireFromBackend = createRequire(
  resolve(_dir, '..', 'backend', 'package.json'),
);
const pg = requireFromBackend('pg');
// Pure two-stage upgrade logic lives in backend/src/utils so a future
// admin endpoint and the test suite can both consume it.
const {
  upgradeOneComp,
  MAX_DRIFT_KM_DEFAULT,
} = requireFromBackend('./src/utils/geocodeUpgrade.js');

// ─── env loader ─────────────────────────────────────────────────────────────
const ENV_PATH = resolve(_dir, '..', 'backend', '.env');

function loadEnv() {
  if (!existsSync(ENV_PATH)) return;
  const raw = readFileSync(ENV_PATH, 'utf8');
  // Use the same dotenv that backend uses so we hit the exact same
  // parser semantics — handles CRLF, quoted values, multi-line values,
  // export prefixes, etc. without a hand-rolled regex that bites on
  // Windows line endings (the original cost: pg auth failed because
  // DATABASE_URL ended in `\r`).
  const dotenv = requireFromBackend('dotenv');
  const parsed = dotenv.parse(raw);
  for (const [k, v] of Object.entries(parsed)) {
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
const DB_URL = process.env.DATABASE_URL;

if (!GOOGLE_KEY || !GOOGLE_KEY.startsWith('AIza')) {
  console.error('GOOGLE_MAPS_API_KEY is not configured. Set it in backend/.env.');
  process.exit(1);
}
if (!DB_URL) {
  console.error('DATABASE_URL is not configured. Set it in backend/.env.');
  process.exit(1);
}

// ─── args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALLOW_CROSS_LOCALITY = args.includes('--allow-cross-locality');
const RPS = (() => {
  const idx = args.indexOf('--rps');
  return idx >= 0 ? Math.max(0.5, Math.min(10, parseFloat(args[idx + 1]))) : 5;
})();
const LIMIT = (() => {
  const idx = args.indexOf('--limit');
  return idx >= 0 ? parseInt(args[idx + 1], 10) : null;
})();
const DELAY_MS = Math.ceil(1000 / RPS);

// Imported from backend/src/utils/geocodeUpgrade.js for parity with the
// admin endpoint and the unit tests.
const MAX_DRIFT_KM = MAX_DRIFT_KM_DEFAULT;

// ─── helpers ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── main ───────────────────────────────────────────────────────────────────

const { Client } = pg;
const client = new Client({
  connectionString: DB_URL,
  ssl: DB_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

const startTime = Date.now();
const summary = {
  picked: 0,
  unchanged: 0,
  upgraded: 0,
  upgraded_stage1: 0,
  upgraded_stage2: 0,
  skipped_no_match: 0,
  skipped_drift: 0,
  skipped_stage2_low_precision: 0,
  errored: 0,
  by_quality: {},
  cross_locality_corrections: [],
};

async function main() {
  await client.connect();

  const limitClause = LIMIT ? `LIMIT ${parseInt(LIMIT, 10)}` : '';
  const candidates = await client.query(
    `SELECT id, project_name, locality, city, lat, lng, geocode_quality
       FROM comps
      WHERE geocode_quality IS NULL
         OR geocode_quality IN ('locality_centroid', 'approximate')
      ORDER BY (geocode_quality IS NULL) DESC, created_at ASC
      ${limitClause}`
  );
  summary.picked = candidates.rows.length;

  console.log(`Found ${summary.picked} candidate comps to upgrade.`);
  console.log(`Mode: ${APPLY ? 'APPLY (writes will commit)' : 'DRY RUN (read-only)'}`);
  console.log(`Throttle: ${RPS} req/sec (~${DELAY_MS}ms between calls)`);
  console.log(
    `Cross-locality fallback: ${ALLOW_CROSS_LOCALITY ? 'ENABLED — stage 2 fires on stage-1 drift' : 'OFF (use --allow-cross-locality to enable)'}`,
  );
  console.log('');

  for (const row of candidates.rows) {
    const oldQuality = row.geocode_quality || 'locality_centroid';

    let outcome = null;
    try {
      outcome = await upgradeOneComp({
        comp: {
          project_name: row.project_name,
          locality: row.locality,
          city: row.city,
          lat: row.lat,
          lng: row.lng,
          geocode_quality: oldQuality,
        },
        apiKey: GOOGLE_KEY,
        fetchImpl: fetch,
        maxDriftKm: MAX_DRIFT_KM,
        allowCrossLocality: ALLOW_CROSS_LOCALITY,
      });
    } catch (err) {
      console.error(`  [ERR ] ${row.project_name?.slice(0, 50)}: ${err.message}`);
      summary.errored += 1;
      await sleep(DELAY_MS);
      continue;
    }

    if (outcome.action === 'skip') {
      switch (outcome.reason) {
        case 'no_match':
          console.log(`  [SKIP] ${row.project_name?.slice(0, 50)} — no match`);
          summary.skipped_no_match += 1;
          break;
        case 'no_upgrade':
          console.log(`  [-   ] ${row.project_name?.slice(0, 50)} — already at ${oldQuality}, no upgrade (Google returned ${outcome.newQuality})`);
          summary.unchanged += 1;
          break;
        case 'drift':
          console.log(
            `  [DRIFT] ${row.project_name?.slice(0, 50)} — ${outcome.drift_km?.toFixed?.(1) ?? '?'}km from centroid, suspicious match → kept`,
          );
          summary.skipped_drift += 1;
          break;
        case 'stage2_low_precision':
          console.log(
            `  [S2-LP] ${row.project_name?.slice(0, 50)} — stage 2 returned ${outcome.newQuality}, not high-precision → kept`,
          );
          summary.skipped_stage2_low_precision += 1;
          break;
        default:
          console.log(`  [SKIP] ${row.project_name?.slice(0, 50)} — ${outcome.reason}`);
      }
      await sleep(DELAY_MS);
      continue;
    }

    // outcome.action === 'accept'
    summary.upgraded += 1;
    summary.by_quality[outcome.quality] = (summary.by_quality[outcome.quality] || 0) + 1;
    if (outcome.stage === 1) summary.upgraded_stage1 += 1;
    else summary.upgraded_stage2 += 1;

    const tag = outcome.stage === 2 ? '[OK-S2]' : '[OK   ]';
    const localityNote = outcome.stage === 2 && outcome.locality
      ? ` (cross-locality: ${row.locality} → ${outcome.locality})`
      : '';
    console.log(
      `  ${tag} ${row.project_name?.slice(0, 50)} — ${oldQuality} → ${outcome.quality} (${outcome.lat.toFixed(4)}, ${outcome.lng.toFixed(4)})${localityNote}`,
    );

    if (outcome.stage === 2 && outcome.locality && outcome.locality !== row.locality) {
      summary.cross_locality_corrections.push({
        id: row.id,
        project_name: row.project_name,
        old_locality: row.locality,
        new_locality: outcome.locality,
        formatted_address: outcome.formatted_address,
      });
    }

    if (APPLY) {
      // We update lat/lng/quality. Locality stays as-is — flipping
      // a comp's locality field is a separate review action so the
      // analyst can spot-check what Google decided. The cross-
      // locality_corrections summary above lists every row that
      // would benefit from a manual locality edit.
      await client.query(
        `UPDATE comps
            SET lat = $1,
                lng = $2,
                geocode_quality = $3,
                updated_at = NOW()
          WHERE id = $4`,
        [outcome.lat, outcome.lng, outcome.quality, row.id],
      );
    }

    await sleep(DELAY_MS);
  }

  await client.end();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('────────────────────────────────────────────────────');
  console.log(`Done in ${elapsed}s.`);
  console.log(`  picked:                          ${summary.picked}`);
  console.log(`  upgraded:                        ${summary.upgraded}`);
  console.log(`    via stage 1:                   ${summary.upgraded_stage1}`);
  console.log(`    via stage 2 (cross-locality):  ${summary.upgraded_stage2}`);
  console.log(`  unchanged (was good):            ${summary.unchanged}`);
  console.log(`  skipped (no match):              ${summary.skipped_no_match}`);
  console.log(`  skipped (drift):                 ${summary.skipped_drift}`);
  console.log(`  skipped (stage 2 low precision): ${summary.skipped_stage2_low_precision}`);
  console.log(`  errored:                         ${summary.errored}`);
  if (summary.cross_locality_corrections.length) {
    console.log('');
    console.log('Cross-locality corrections (manual locality edit recommended):');
    for (const c of summary.cross_locality_corrections.slice(0, 20)) {
      console.log(`  ${c.id}  ${c.project_name?.slice(0, 40).padEnd(42)}  ${c.old_locality} → ${c.new_locality}`);
    }
    if (summary.cross_locality_corrections.length > 20) {
      console.log(`  ...and ${summary.cross_locality_corrections.length - 20} more`);
    }
  }
  if (Object.keys(summary.by_quality).length) {
    console.log('  upgraded by quality:');
    for (const [k, v] of Object.entries(summary.by_quality)) {
      console.log(`    ${k.padEnd(20)} ${v}`);
    }
  }
  if (!APPLY) {
    console.log('');
    console.log('DRY RUN — no rows were modified. Re-run with --apply to commit.');
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
