#!/usr/bin/env node
// scripts/seed-bbmp-uav-register.js
// Bulk-upsert the completed BBMP UAV street register (both residential +
// non-residential gazette registers) from tmp/bbmp-uav-register-final.json
// into regulatory_data.bbmp_street_index.
//
// Source JSON is produced by:
//   scripts/parse-bbmp-uav-register.py   (deterministic parse of the 686-page PDF)
//   scripts/build-bbmp-street-register-sql.py  (merge + visual fixups -> *-final.json)
//
// Reads DATABASE_URL from backend/.env (same pg pool the live API uses).
//
// Idempotent: ON CONFLICT (lower(street_name_en), ward_no, page_number) DO
// UPDATE refreshes register/zone/band/excerpt in place. A one-time prelude
// retires the legacy partial non-residential rows (page_number >= 363, no
// provenance) so the complete re-parse fully supersedes them.
//
// Usage: node scripts/seed-bbmp-uav-register.js [--no-prelude]

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });

const JSON_PATH = path.join(__dirname, '..', 'tmp', 'bbmp-uav-register-final.json');
const SOURCE_DOC = 'BBMP Guidance Value Notification No. 384 (09-Mar-2016)';
const BATCH_SIZE = 500;
const SKIP_PRELUDE = process.argv.includes('--no-prelude');

const VALID_ZONES = new Set(['A', 'B', 'C', 'D', 'E', 'F']);
const VALID_REGISTERS = new Set(['residential', 'non_residential']);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL missing from backend/.env');
    process.exit(1);
  }
  if (!fs.existsSync(JSON_PATH)) {
    console.error(`ERROR: missing ${JSON_PATH} — run build-bbmp-street-register-sql.py first`);
    process.exit(1);
  }

  const rows = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
  console.log(`Loaded ${rows.length} street entries from ${path.basename(JSON_PATH)}`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 4,
  });

  try {
    const before = await pool.query('SELECT COUNT(*)::int AS n FROM regulatory_data.bbmp_street_index');
    console.log(`Before: ${before.rows[0].n} rows present`);

    if (!SKIP_PRELUDE) {
      const del = await pool.query('DELETE FROM regulatory_data.bbmp_street_index WHERE page_number >= 363');
      console.log(`Prelude: retired ${del.rowCount} legacy non-residential rows (page >= 363)`);
    }

    let upserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const valuesSql = [];
      const params = [];
      for (const r of chunk) {
        const zone = r.zone_code && VALID_ZONES.has(String(r.zone_code).toUpperCase())
          ? String(r.zone_code).toUpperCase() : null;
        const register = VALID_REGISTERS.has(r.register) ? r.register : null;
        const b = params.length;
        params.push(
          String(r.street_name_en).slice(0, 300),
          r.ward_no ?? null,
          r.page_number,
          r.aro_section || null,
          register,
          zone,
          r.band_min_inr ?? null,
          r.band_max_inr ?? null,
          (r.row_excerpt || '').slice(0, 160),
          SOURCE_DOC,
          r.confidence_score ?? 0.9,
        );
        valuesSql.push(
          `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11})`,
        );
      }
      const sql = `
        INSERT INTO regulatory_data.bbmp_street_index
          (street_name_en, ward_no, page_number, aro_section, register, zone_code,
           guidance_value_band_min_inr, guidance_value_band_max_inr,
           row_excerpt, source_document, confidence_score)
        VALUES ${valuesSql.join(',')}
        ON CONFLICT (lower(street_name_en), ward_no, page_number) DO UPDATE SET
          register = EXCLUDED.register,
          aro_section = COALESCE(EXCLUDED.aro_section, regulatory_data.bbmp_street_index.aro_section),
          zone_code = COALESCE(EXCLUDED.zone_code, regulatory_data.bbmp_street_index.zone_code),
          guidance_value_band_min_inr = COALESCE(EXCLUDED.guidance_value_band_min_inr, regulatory_data.bbmp_street_index.guidance_value_band_min_inr),
          guidance_value_band_max_inr = COALESCE(EXCLUDED.guidance_value_band_max_inr, regulatory_data.bbmp_street_index.guidance_value_band_max_inr),
          row_excerpt = EXCLUDED.row_excerpt,
          confidence_score = EXCLUDED.confidence_score,
          updated_at = now()`;
      const res = await pool.query(sql, params);
      upserted += res.rowCount;
      if ((i / BATCH_SIZE) % 5 === 0) {
        process.stdout.write(`  …upserted ${upserted}\r`);
      }
    }
    console.log(`\nUpserted ${upserted} rows.`);

    const after = await pool.query(`
      SELECT register, COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE zone_code IS NOT NULL)::int AS zoned
      FROM regulatory_data.bbmp_street_index
      GROUP BY register ORDER BY register`);
    console.log('After (by register):');
    for (const r of after.rows) {
      console.log(`  ${r.register || 'NULL'}: ${r.n} rows (${r.zoned} zoned)`);
    }
    const tot = await pool.query('SELECT COUNT(*)::int AS n FROM regulatory_data.bbmp_street_index');
    console.log(`Total: ${tot.rows[0].n} rows`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
