#!/usr/bin/env node
/**
 * One-shot batch: geocode every supplied comp via Google Geocoding API and
 * emit a single SQL UPDATE block on stdout. Companion to
 * nominatim-geocode-batch.mjs — same I/O contract, different provider.
 *
 * Use this when a server-side Google Maps API key is available (key with
 * Application restrictions = None or IP allowlist + API restrictions = Geocoding API).
 *
 * Throttle: 5 req/sec — well under Google's 50 QPS ceiling, polite to billing.
 *
 * Drift guard: 5km from existing locality centroid — same as the Nominatim
 * variant. Keeps Google from corrupting good data when it matches a
 * same-named place elsewhere (e.g. "Whitefield, India" vs "Whitefield, USA").
 *
 * Env: GOOGLE_BULK_GEOCODING_KEY — must be set. Distinct from
 * GOOGLE_MAPS_API_KEY (which is browser-restricted for the frontend map).
 *
 * Input (stdin): JSON array of { id, project_name, locality, city, lat, lng }
 * Output (stdout): SQL UPDATE block, one statement per upgraded row
 * Trace (stderr): per-row status line
 */

const KEY = process.env.GOOGLE_BULK_GEOCODING_KEY;
if (!KEY) {
  process.stderr.write('FATAL: set GOOGLE_BULK_GEOCODING_KEY env var.\n');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const haversineKm = (a, b) => {
  if (a == null || b == null) return null;
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

// Google location_type → my geocode_quality enum (see migration 20260516)
const LOCATION_TYPE_MAP = {
  ROOFTOP: 'rooftop',
  RANGE_INTERPOLATED: 'range_interpolated',
  GEOMETRIC_CENTER: 'geometric_center',
  APPROXIMATE: 'approximate',
};

const QUALITY_RANK = {
  rooftop: 5,
  range_interpolated: 4,
  geometric_center: 3,
  approximate: 2,
  locality_centroid: 1,
  manual: 6,
};
const isUpgrade = (oldQ, newQ) =>
  (QUALITY_RANK[newQ] || 0) > (QUALITY_RANK[oldQ] || 0);

const MAX_DRIFT_KM = 5;
const REQUEST_DELAY_MS = 200; // 5 req/sec

async function geocode(query) {
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?region=in&key=' +
    encodeURIComponent(KEY) +
    '&address=' +
    encodeURIComponent(query);
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const json = await res.json();
  if (json.status === 'REQUEST_DENIED' || json.status === 'OVER_QUERY_LIMIT') {
    throw new Error('Google API ' + json.status + ': ' + (json.error_message || ''));
  }
  if (json.status === 'ZERO_RESULTS' || !json.results?.length) {
    return null;
  }
  const r = json.results[0];
  return {
    lat: r.geometry?.location?.lat,
    lng: r.geometry?.location?.lng,
    locationType: r.geometry?.location_type,
    placeId: r.place_id,
  };
}

function escapeSqlString(s) {
  return String(s).replace(/'/g, "''");
}

async function main() {
  const stdinChunks = [];
  for await (const chunk of process.stdin) stdinChunks.push(chunk);
  const rows = JSON.parse(Buffer.concat(stdinChunks).toString('utf8'));

  const updates = [];
  const summary = {
    picked: rows.length,
    upgraded: 0,
    skipped_no_match: 0,
    skipped_drift: 0,
    skipped_too_coarse: 0,
    errored: 0,
    by_quality: {},
  };

  for (const row of rows) {
    const oldCoord = { lat: Number(row.lat), lng: Number(row.lng) };
    const oldQuality = 'locality_centroid';
    const queryParts = [row.project_name, row.locality, row.city, 'India'].filter(Boolean);
    const query = queryParts.join(', ');

    let result = null;
    try {
      result = await geocode(query);
    } catch (err) {
      process.stderr.write(`  [ERR ] ${row.project_name.slice(0, 42).padEnd(44)} ${err.message}\n`);
      summary.errored += 1;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    if (!result) {
      process.stderr.write(`  [MISS] ${row.project_name.slice(0, 42).padEnd(44)} no Google hit\n`);
      summary.skipped_no_match += 1;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    const newQuality = LOCATION_TYPE_MAP[result.locationType] || null;
    if (!newQuality || !isUpgrade(oldQuality, newQuality)) {
      process.stderr.write(
        `  [-   ] ${row.project_name.slice(0, 42).padEnd(44)} ${result.locationType} (no upgrade)\n`,
      );
      summary.skipped_too_coarse += 1;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    const newCoord = { lat: result.lat, lng: result.lng };
    const drift = haversineKm(oldCoord, newCoord);
    if (drift != null && drift > MAX_DRIFT_KM) {
      process.stderr.write(
        `  [DRIFT] ${row.project_name.slice(0, 42).padEnd(44)} ${drift.toFixed(1)}km away → kept\n`,
      );
      summary.skipped_drift += 1;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    process.stderr.write(
      `  [OK  ] ${row.project_name.slice(0, 42).padEnd(44)} → ${newQuality.padEnd(20)} (${newCoord.lat.toFixed(4)}, ${newCoord.lng.toFixed(4)}) drift=${drift?.toFixed(2) ?? '?'}km\n`,
    );
    summary.upgraded += 1;
    summary.by_quality[newQuality] = (summary.by_quality[newQuality] || 0) + 1;

    updates.push(
      `UPDATE comps SET lat = ${newCoord.lat}, lng = ${newCoord.lng}, ` +
        `geocode_quality = '${newQuality}', updated_at = NOW() ` +
        `WHERE id = '${row.id}'; -- ${escapeSqlString(row.project_name)}`,
    );

    await sleep(REQUEST_DELAY_MS);
  }

  process.stderr.write('\n=== Summary ===\n');
  process.stderr.write(JSON.stringify(summary, null, 2) + '\n');

  process.stdout.write(updates.join('\n') + '\n');
}

main().catch((err) => {
  process.stderr.write('FATAL: ' + err.stack + '\n');
  process.exit(2);
});
