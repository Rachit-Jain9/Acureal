'use strict';

/**
 * P4 — Parcel cache sweep + stale-snapshot watchdog.
 *
 * Runs daily via Vercel cron (see vercel.json). Two responsibilities:
 *   1. Purge expired rows from regulatory_data.kgis_cache and
 *      regulatory_data.osm_road_cache so cache size stays bounded.
 *   2. Surface a count of parcels whose last snapshot is older than 30 days
 *      so the team can monitor stale parcel intelligence proactively.
 *      (The snapshot_stale red-flag rule already shows the *visible* signal
 *      per-parcel — this is the org-wide proactive sweep.)
 *
 * The function is idempotent and side-effect-free beyond DELETE on expired
 * rows. It never writes back into snapshots; staleness is reported to logs.
 */

const { query } = require('../config/database');
const log = require('../lib/logger').child({ module: 'parcel.cache.sweep' });

const STALE_DAYS = Number(process.env.PARCEL_SNAPSHOT_STALE_DAYS || 30);

const purgeKgisCache = async () => {
  try {
    const result = await query(
      `DELETE FROM regulatory_data.kgis_cache
       WHERE expires_at IS NOT NULL AND expires_at < NOW()
       RETURNING id`
    );
    return result.rowCount || 0;
  } catch (error) {
    log.warn('kgis_cache_purge_failed', { error: error.message });
    return 0;
  }
};

const purgeOsmRoadCache = async () => {
  try {
    const result = await query(
      `DELETE FROM regulatory_data.osm_road_cache
       WHERE expires_at IS NOT NULL AND expires_at < NOW()
       RETURNING id`
    );
    return result.rowCount || 0;
  } catch (error) {
    log.warn('osm_road_cache_purge_failed', { error: error.message });
    return 0;
  }
};

const countStaleSnapshots = async () => {
  try {
    const result = await query(
      `SELECT
         COUNT(*)::int AS total_parcels,
         COUNT(*) FILTER (WHERE generated_at < NOW() - ($1 || ' days')::interval)::int AS stale_parcels
       FROM (
         SELECT property_id, MAX(generated_at) AS generated_at
         FROM regulatory_data.parcel_intelligence_snapshots
         GROUP BY property_id
       ) AS latest`,
      [STALE_DAYS]
    );
    return {
      total_parcels: result.rows[0]?.total_parcels || 0,
      stale_parcels: result.rows[0]?.stale_parcels || 0,
      stale_threshold_days: STALE_DAYS,
    };
  } catch (error) {
    log.warn('stale_snapshot_count_failed', { error: error.message });
    return { total_parcels: 0, stale_parcels: 0, stale_threshold_days: STALE_DAYS, error: error.message };
  }
};

const runSweep = async () => {
  const start = Date.now();
  const [kgisPurged, osmPurged, snapshotStats] = await Promise.all([
    purgeKgisCache(),
    purgeOsmRoadCache(),
    countStaleSnapshots(),
  ]);
  const summary = {
    kgis_cache_rows_purged: kgisPurged,
    osm_road_cache_rows_purged: osmPurged,
    snapshot_stats: snapshotStats,
    duration_ms: Date.now() - start,
  };

  if (snapshotStats.stale_parcels > 0) {
    log.warn('parcel_snapshots_stale', summary);
  } else {
    log.info('parcel_cache_sweep_completed', summary);
  }

  return summary;
};

module.exports = {
  runSweep,
  // Exported for tests
  purgeKgisCache,
  purgeOsmRoadCache,
  countStaleSnapshots,
};
