#!/usr/bin/env node
/**
 * Tier-1 #10 — Project-precise geocoding for the comps table.
 *
 * Up to now, every comp's lat/lng sat at a locality centroid (the bulk
 * geocode migrations from 2026-05-08 mapped every Whitefield comp to
 * one (12.97, 77.75) point, every Hebbal comp to another, etc.). The
 * cluster-pin UI from PR #169 was a workaround for that artificial
 * stacking. This script upgrades each comp to a project-precise pin
 * by querying the Google Geocoding API for `{project_name}, {locality},
 * {city}, India` and writing the result + a quality tag back to the
 * row.
 *
 * Companion to migration 20260516_comps_geocode_quality.sql. Run AFTER
 * the migration is applied (the script depends on the geocode_quality
 * column).
 *
 * Behaviour:
 *   • Picks rows where geocode_quality IN (NULL, 'locality_centroid',
 *     'approximate'). Skips rows tagged 'rooftop' / 'range_interpolated' /
 *     'manual' — those are already as good as we can make them.
 *   • Throttled at ~5 req/sec (well under Google's per-second QPS limit
 *     of 50 to stay polite). Override via --rps.
 *   • Idempotent — already-upgraded rows are skipped on re-runs. Cached
 *     responses also dedupe across retries.
 *   • Persists Google's `geometry.location_type` directly:
 *       ROOFTOP / RANGE_INTERPOLATED / GEOMETRIC_CENTER / APPROXIMATE
 *   • For results that fall back to APPROXIMATE we ALSO compare against
 *     the existing locality centroid — if the new lat/lng is more than
 *     5 km from the centroid, we treat the result as a misfire and
 *     leave the row alone.
 *
 * Required env (read from `backend/.env` automatically):
 *   GOOGLE_MAPS_API_KEY
 *   DATABASE_URL  (Mumbai pooler)
 *
 * Usage (run from the `backend/` directory so the `pg` import resolves —
 * same convention as scripts/migrate-tokyo-to-mumbai.mjs):
 *
 *   cd backend
 *   node ../scripts/upgrade-comps-geocoding.mjs              # dry run
 *   node ../scripts/upgrade-comps-geocoding.mjs --apply      # actually update
 *   node ../scripts/upgrade-comps-geocoding.mjs --apply --limit 10
 *   node ../scripts/upgrade-comps-geocoding.mjs --rps 2 --apply
 *
 * Cost: ~$0.005 per call. 80 comps × 1 call each = ~$0.40. Cached calls
 * are free (served from geocode_cache — though this script does not yet
 * read/write that cache; future improvement).
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
const RPS = (() => {
  const idx = args.indexOf('--rps');
  return idx >= 0 ? Math.max(0.5, Math.min(10, parseFloat(args[idx + 1]))) : 5;
})();
const LIMIT = (() => {
  const idx = args.indexOf('--limit');
  return idx >= 0 ? parseInt(args[idx + 1], 10) : null;
})();
const DELAY_MS = Math.ceil(1000 / RPS);

// Maximum drift between the new geocode and the historical locality
// centroid. If a result lands further than this, we assume Google
// matched a different "Whitefield" or similar — the result is suspect
// and we keep the existing centroid.
const MAX_DRIFT_KM = 5;

// ─── helpers ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const haversineKm = (a, b) => {
  if (a == null || b == null || a.lat == null || b.lat == null) return null;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(aa));
};

const QUALITY_RANK = {
  rooftop: 5,
  range_interpolated: 4,
  geometric_center: 3,
  approximate: 2,
  locality_centroid: 1,
  manual: 6, // higher than rooftop — reviewer overrides everything
};
const isUpgrade = (oldQ, newQ) =>
  (QUALITY_RANK[newQ] || 0) > (QUALITY_RANK[oldQ] || 0);

const mapLocationType = (t) => {
  switch (t) {
    case 'ROOFTOP': return 'rooftop';
    case 'RANGE_INTERPOLATED': return 'range_interpolated';
    case 'GEOMETRIC_CENTER': return 'geometric_center';
    case 'APPROXIMATE': return 'approximate';
    default: return 'approximate';
  }
};

async function geocodeOnce(query) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', query);
  url.searchParams.set('region', 'in');
  url.searchParams.set('key', GOOGLE_KEY);

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const json = await res.json();

  if (json.status === 'REQUEST_DENIED' || json.status === 'OVER_QUERY_LIMIT') {
    throw new Error(`Google API failure: ${json.status} ${json.error_message || ''}`);
  }
  if (json.status === 'ZERO_RESULTS' || !json.results?.length) {
    return null;
  }

  const r = json.results[0];
  const loc = r.geometry?.location || {};
  return {
    lat: loc.lat,
    lng: loc.lng,
    locationType: r.geometry?.location_type,
    formattedAddress: r.formatted_address,
    placeId: r.place_id,
  };
}

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
  skipped_no_match: 0,
  skipped_drift: 0,
  errored: 0,
  by_quality: {},
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
  console.log('');

  for (const row of candidates.rows) {
    const queryParts = [row.project_name, row.locality, row.city, 'India'].filter(Boolean);
    const query = queryParts.join(', ');
    const oldCoord = { lat: parseFloat(row.lat), lng: parseFloat(row.lng) };
    const oldQuality = row.geocode_quality || 'NULL';

    let g = null;
    try {
      g = await geocodeOnce(query);
    } catch (err) {
      console.error(`  [ERR ] ${row.project_name?.slice(0, 50)}: ${err.message}`);
      summary.errored += 1;
      await sleep(DELAY_MS);
      continue;
    }

    if (!g) {
      console.log(`  [SKIP] ${row.project_name?.slice(0, 50)} — no match`);
      summary.skipped_no_match += 1;
      await sleep(DELAY_MS);
      continue;
    }

    const newQuality = mapLocationType(g.locationType);
    const newCoord = { lat: g.lat, lng: g.lng };

    if (!isUpgrade(oldQuality, newQuality)) {
      console.log(`  [-   ] ${row.project_name?.slice(0, 50)} — already at ${oldQuality}, no upgrade`);
      summary.unchanged += 1;
      await sleep(DELAY_MS);
      continue;
    }

    // Drift guard: if we had a locality centroid and the new pin is far
    // from it, Google probably matched a same-named place elsewhere. Skip.
    if (oldQuality === 'locality_centroid' && oldCoord.lat && oldCoord.lng) {
      const drift = haversineKm(oldCoord, newCoord);
      if (drift != null && drift > MAX_DRIFT_KM) {
        console.log(
          `  [DRIFT] ${row.project_name?.slice(0, 50)} — ${drift.toFixed(1)}km from centroid, suspicious match → kept`,
        );
        summary.skipped_drift += 1;
        await sleep(DELAY_MS);
        continue;
      }
    }

    summary.upgraded += 1;
    summary.by_quality[newQuality] = (summary.by_quality[newQuality] || 0) + 1;
    console.log(
      `  [OK  ] ${row.project_name?.slice(0, 50)} — ${oldQuality} → ${newQuality} (${newCoord.lat.toFixed(4)}, ${newCoord.lng.toFixed(4)})`,
    );

    if (APPLY) {
      await client.query(
        `UPDATE comps
            SET lat = $1,
                lng = $2,
                geocode_quality = $3,
                updated_at = NOW()
          WHERE id = $4`,
        [newCoord.lat, newCoord.lng, newQuality, row.id],
      );
    }

    await sleep(DELAY_MS);
  }

  await client.end();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('────────────────────────────────────────────────────');
  console.log(`Done in ${elapsed}s.`);
  console.log(`  picked:               ${summary.picked}`);
  console.log(`  upgraded:             ${summary.upgraded}`);
  console.log(`  unchanged (was good): ${summary.unchanged}`);
  console.log(`  skipped (no match):   ${summary.skipped_no_match}`);
  console.log(`  skipped (drift):      ${summary.skipped_drift}`);
  console.log(`  errored:              ${summary.errored}`);
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
