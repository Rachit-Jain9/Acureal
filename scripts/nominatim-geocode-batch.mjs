#!/usr/bin/env node
/**
 * One-shot batch: geocode every supplied comp via Nominatim and emit a
 * single UPDATE-many statement on stdout. The orchestrator (Claude in
 * the chat session) reads the SQL and applies it via the Supabase MCP.
 *
 * Why Nominatim and not Google: the user's GOOGLE_MAPS_API_KEY is
 * browser-restricted (HTTP referer only) which blocks server-side
 * calls. Nominatim is free, no key, returns place_rank we can map
 * directly to our geocode_quality enum.
 *
 * Throttle: 1.2s between requests, well above Nominatim's 1 req/sec
 * Usage Policy ceiling. Batch of 57 takes ~70s.
 *
 * Drift guard: same as the Google variant — if the new pin is more
 * than 5 km from the existing locality centroid, treat the result as
 * a misfire (Nominatim matched a same-named place elsewhere) and
 * leave the row alone.
 *
 * Input: a JSON array on stdin like
 *   [{ "id": "...", "project_name": "...", "locality": "...", "city": "...",
 *      "lat": 12.97, "lng": 77.55 }, ...]
 *
 * Output:
 *   - stderr: per-row trace
 *   - stdout: a SQL block of UPDATE statements (one per upgraded row)
 */

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

// place_rank → my geocode_quality enum (see migration 20260516)
//   30      → rooftop (POI / building)
//   26-29   → range_interpolated (street level)
//   22-25   → geometric_center (suburb / neighbourhood polygon)
//   ≤21     → too coarse to be an upgrade from locality_centroid
function rankToQuality(rank) {
  if (rank == null) return null;
  const r = Number(rank);
  if (r >= 30) return 'rooftop';
  if (r >= 26) return 'range_interpolated';
  if (r >= 22) return 'geometric_center';
  return null; // city-level or worse — don't upgrade
}

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
const REQUEST_DELAY_MS = 1200;

async function geocode(query) {
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&addressdetails=0&q=' +
    encodeURIComponent(query);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Acureal-geocoder/1.0 (rachitjain348@gmail.com)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error('Nominatim ' + res.status);
  }
  const arr = await res.json();
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
}

function escapeSqlString(s) {
  return String(s).replace(/'/g, "''");
}

async function main() {
  // Read JSON array from stdin
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
    const oldQuality = 'locality_centroid'; // these rows were filtered to this state

    // Build a tight query: project name + locality + city. Avoid "India" —
    // countrycodes=in already constrains.
    const queryParts = [row.project_name, row.locality, row.city].filter(Boolean);
    const query = queryParts.join(', ');

    let result = null;
    try {
      result = await geocode(query);
    } catch (err) {
      process.stderr.write(`  [ERR ] ${row.project_name.slice(0, 40)}: ${err.message}\n`);
      summary.errored += 1;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    if (!result) {
      process.stderr.write(`  [MISS] ${row.project_name.slice(0, 40)} — no Nominatim hit\n`);
      summary.skipped_no_match += 1;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    const newQuality = rankToQuality(result.place_rank);
    if (!newQuality || !isUpgrade(oldQuality, newQuality)) {
      process.stderr.write(
        `  [-   ] ${row.project_name.slice(0, 40)} — rank=${result.place_rank} → ${newQuality || 'too coarse'}, no upgrade\n`,
      );
      summary.skipped_too_coarse += 1;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    const newCoord = { lat: Number(result.lat), lng: Number(result.lon) };
    const drift = haversineKm(oldCoord, newCoord);
    if (drift != null && drift > MAX_DRIFT_KM) {
      process.stderr.write(
        `  [DRIFT] ${row.project_name.slice(0, 40)} — ${drift.toFixed(1)}km away, suspicious → kept\n`,
      );
      summary.skipped_drift += 1;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    process.stderr.write(
      `  [OK  ] ${row.project_name.slice(0, 40).padEnd(42)} ${oldQuality} → ${newQuality.padEnd(20)} (${newCoord.lat.toFixed(4)}, ${newCoord.lng.toFixed(4)}) drift=${drift?.toFixed(2) ?? '?'}km\n`,
    );

    summary.upgraded += 1;
    summary.by_quality[newQuality] = (summary.by_quality[newQuality] || 0) + 1;

    // Emit a SQL UPDATE for this row. Numeric cast ensures we don't write
    // string-typed lat/lng. updated_at refresh keeps audit trails honest.
    updates.push(
      `UPDATE comps SET lat = ${newCoord.lat}, lng = ${newCoord.lng}, ` +
        `geocode_quality = '${newQuality}', updated_at = NOW() ` +
        `WHERE id = '${row.id}'; -- ${escapeSqlString(row.project_name)}`,
    );

    await sleep(REQUEST_DELAY_MS);
  }

  process.stderr.write('\n=== Summary ===\n');
  process.stderr.write(JSON.stringify(summary, null, 2) + '\n');

  // SQL block on stdout for the orchestrator to apply
  process.stdout.write(updates.join('\n') + '\n');
}

main().catch((err) => {
  process.stderr.write('FATAL: ' + err.stack + '\n');
  process.exit(2);
});
