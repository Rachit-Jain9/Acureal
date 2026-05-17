#!/usr/bin/env node
// scripts/seed-bbmp-street-index.js
// Bulk-insert the 9,913-row Bengaluru street index from
// tmp/bbmp-street-index.json into regulatory_data.bbmp_street_index.
// Reads DATABASE_URL from backend/.env so the same pg pool the live API uses
// also gets the seed — no second connection string to manage.
//
// Usage:
//   node scripts/seed-bbmp-street-index.js
//
// Idempotent: the unique index (lower(street_name_en), ward_no, page_number)
// silently drops duplicates via ON CONFLICT DO NOTHING.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });

const JSON_PATH = path.join(__dirname, '..', 'tmp', 'bbmp-street-index.json');
const BATCH_SIZE = 500;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL missing from backend/.env');
    process.exit(1);
  }
  if (!fs.existsSync(JSON_PATH)) {
    console.error(`ERROR: missing ${JSON_PATH} — run build-bbmp-street-index.py first`);
    process.exit(1);
  }

  const rows = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
  console.log(`Loaded ${rows.length} street entries from ${JSON_PATH}`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 4,
  });

  const before = await pool.query('SELECT COUNT(*)::int AS n FROM regulatory_data.bbmp_street_index');
  console.log(`Before seed: ${before.rows[0].n} rows already present`);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const valuesSql = [];
    const params = [];
    for (const r of chunk) {
      const aro = (r.aro_section || '').replace(/ /g, ' ').trim() || null;
      const idx = params.length;
      params.push(r.street_name_en, r.ward_no ?? null, r.page_number, aro, r.row_excerpt ?? null);
      valuesSql.push(`($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5})`);
    }
    const sql = `
      INSERT INTO regulatory_data.bbmp_street_index
        (street_name_en, ward_no, page_number, aro_section, row_excerpt)
      VALUES ${valuesSql.join(', ')}
      ON CONFLICT (lower(street_name_en), ward_no, page_number) DO NOTHING
      RETURNING 1`;
    const result = await pool.query(sql, params);
    inserted += result.rowCount;
    process.stdout.write(`\r  Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(rows.length / BATCH_SIZE)}  (+${result.rowCount} new, ${inserted} total inserted)`);
  }
  process.stdout.write('\n');

  const after = await pool.query('SELECT COUNT(*)::int AS n FROM regulatory_data.bbmp_street_index');
  console.log(`After seed: ${after.rows[0].n} rows`);
  await pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
