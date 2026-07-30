'use strict';

/**
 * Mirror the BDA RMP 2015 Proposed-Land-Use tiles into Acureal-owned storage.
 *
 * WHY: today the frontend loads these tiles CLIENT-SIDE from Map Warper's
 * community server (Map Warper 403s Vercel's egress, so the same-origin proxy
 * can't reach it; the user's browser fetches them from its own IP). That works
 * but depends on a no-SLA community host. Mirroring the tiles to Vercel Blob
 * makes the overlay bulletproof + same-origin:
 *
 *   1.  node backend/scripts/mirror-rmp2015-tiles.js            (full run)
 *       node backend/scripts/mirror-rmp2015-tiles.js --dry-run  (fetch-only, no upload)
 *   2.  Set MASTER_PLAN_RMP2015_TILE_BASE (backend) to the printed Blob base.
 *   3.  Set VITE_MASTER_PLAN_TILE_URL (frontend) to
 *       /api/master-plan-tiles/rmp2015/{z}/{x}/{y}.png  → served same-origin,
 *       CDN-cached, Map-Warper-independent.
 *
 * This host CAN fetch Map Warper (verified 200, unlike Vercel). Upload needs
 * BLOB_READ_WRITE_TOKEN in the environment (the only credentialed step).
 *
 * Flags:
 *   --dry-run            fetch every tile (verify reachability) but do NOT upload
 *   --min-zoom=N         default 9
 *   --max-zoom=N         default MIRROR_MAX_Z (env MASTER_PLAN_MIRROR_MAX_Z, else 15)
 *   --concurrency=N      default 6
 */

// Auto-load backend/.env so BLOB_READ_WRITE_TOKEN is picked up without exporting
// it by hand (no-op if dotenv or the file is absent — e.g. a --dry-run).
try {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
} catch { /* dotenv optional */ }

const {
  enumerateTiles,
  tileStorageKey,
  MIN_Z,
  MIRROR_MAX_Z,
} = require('../src/utils/rmp2015Tiles');

const SOURCE_BASE = (process.env.MASTER_PLAN_MIRROR_SOURCE_BASE
  || 'https://mapwarper.net/layers/tile/2147').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (compatible; Acureal-tile-mirror/1.0; +https://redip.vercel.app)';
const FETCH_TIMEOUT_MS = 15000;

// Blob store access. Starts 'public', but auto-flips to 'private' the first time
// Vercel rejects a public put (private-only stores — e.g. the one holding
// private documents). Private tiles are then served via the same-origin proxy,
// which authenticates to Blob with the token (the browser never sees it).
let blobAccess = 'public';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const n = Number(hit.split('=')[1]);
  return Number.isFinite(n) ? n : dflt;
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

async function fetchTile(z, x, y) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SOURCE_BASE}/${z}/${x}/${y}.png`, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'image/png,image/*' },
    });
    if (!res.ok) return null; // 404 = unrectified/blank tile inside the bbox — skip
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Existing keys already in Blob → resumable (re-runs skip what's stored).
async function loadExistingKeys(blob, token) {
  const existing = new Set();
  let cursor;
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await blob.list({ prefix: 'master-plan/rmp2015/', token, cursor, limit: 1000 });
    for (const b of page.blobs) existing.add(b.pathname);
    cursor = page.hasMore ? page.cursor : null;
  } while (cursor);
  return existing;
}

async function runPool(items, concurrency, worker, onProgress) {
  let idx = 0;
  let done = 0;
  const next = async () => {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      // eslint-disable-next-line no-await-in-loop
      await worker(items[i]);
      done += 1;
      if (onProgress && done % 50 === 0) onProgress(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

async function main() {
  const dryRun = hasFlag('dry-run');
  const minZoom = arg('min-zoom', MIN_Z);
  const maxZoom = arg('max-zoom', MIRROR_MAX_Z);
  const concurrency = arg('concurrency', 6);

  const tiles = enumerateTiles(minZoom, maxZoom);
  const byZoom = {};
  for (const t of tiles) byZoom[t.z] = (byZoom[t.z] || 0) + 1;

  console.log(`RMP 2015 tile mirror — zoom ${minZoom}..${maxZoom}, source ${SOURCE_BASE}`);
  console.log(`Candidate tiles intersecting the bbox: ${tiles.length}`);
  console.log('Per zoom:', JSON.stringify(byZoom));
  console.log(dryRun ? 'MODE: dry-run (fetch only, no upload)\n' : 'MODE: live (fetch + upload to Vercel Blob)\n');

  let blob = null;
  let token = null;
  let existing = new Set();
  if (!dryRun) {
    token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      console.error('ERROR: BLOB_READ_WRITE_TOKEN is not set — cannot upload. Re-run with --dry-run, or set the token.');
      process.exit(1);
    }
    // eslint-disable-next-line global-require
    blob = require('@vercel/blob');
    process.stdout.write('Listing already-mirrored tiles… ');
    existing = await loadExistingKeys(blob, token);
    console.log(`${existing.size} present (will skip).`);
  }

  const stat = { stored: 0, blank: 0, skipped: 0, failed: 0, baseUrl: null };

  await runPool(tiles, concurrency, async ({ z, x, y }) => {
    const key = tileStorageKey(z, x, y);
    if (existing.has(key)) { stat.skipped += 1; return; }
    const buf = await fetchTile(z, x, y);
    if (!buf) { stat.blank += 1; return; }
    if (dryRun) { stat.stored += 1; return; }
    try {
      const putOpts = { addRandomSuffix: false, allowOverwrite: true, contentType: 'image/png', token };
      let out;
      try {
        out = await blob.put(key, buf, { ...putOpts, access: blobAccess });
      } catch (err) {
        // Private-only store rejects public puts — flip to private + retry (and
        // every subsequent tile then uploads private without re-erroring).
        if (blobAccess === 'public' && /private store/i.test(err?.message || '')) {
          blobAccess = 'private';
          out = await blob.put(key, buf, { ...putOpts, access: 'private' });
        } else {
          throw err;
        }
      }
      if (!stat.baseUrl) {
        // Derive the store base from the first upload's URL.
        stat.baseUrl = out.url.replace(/\/master-plan\/rmp2015\/.*$/, '/master-plan/rmp2015');
      }
      stat.stored += 1;
    } catch (e) {
      stat.failed += 1;
      if (stat.failed <= 5) console.error(`  upload failed ${key}: ${e.message}`);
    }
  }, (d, total) => process.stdout.write(`\r  ${d}/${total} processed…`));

  console.log('\n\nDone.');
  console.log(`  ${dryRun ? 'fetchable (real)' : 'uploaded'}: ${stat.stored}`);
  console.log(`  blank/unrectified (skipped): ${stat.blank}`);
  if (!dryRun) {
    console.log(`  already present (skipped): ${stat.skipped}`);
    console.log(`  failed: ${stat.failed}`);
    console.log(`  store access: ${blobAccess}${blobAccess === 'private' ? ' (served via the same-origin proxy, which reads Blob with the token)' : ''}`);
    if (stat.baseUrl) {
      console.log('\nNext steps:');
      console.log(`  • Set backend env  MASTER_PLAN_RMP2015_TILE_BASE = ${stat.baseUrl}`);
      console.log('  • Set frontend env VITE_MASTER_PLAN_TILE_URL = /api/master-plan-tiles/rmp2015/{z}/{x}/{y}.png');
    }
  }
}

main().catch((e) => {
  console.error('\nMirror failed:', e);
  process.exit(1);
});
