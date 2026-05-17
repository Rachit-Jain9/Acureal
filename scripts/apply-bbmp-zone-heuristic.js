#!/usr/bin/env node
// scripts/apply-bbmp-zone-heuristic.js
// Apply tmp/bbmp-street-zone-heuristic.sql (Phase 2a heuristic enrichment)
// to the database through the backend pg pool. Idempotent — every UPDATE
// only touches rows where zone_code IS NULL.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const dotenv = require('dotenv');

// Load env, .env.local first (with BOM-strip), then .env as fallback.
const loadEnv = (file) => {
  const p = path.join(__dirname, '..', 'backend', file);
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, 'utf-8').replace(/^﻿/, '');
  for (const [k, v] of Object.entries(dotenv.parse(raw))) {
    if (!(k in process.env)) process.env[k] = v;
  }
};
loadEnv('.env.local');
loadEnv('.env');

const SQL_PATH = path.join(__dirname, '..', 'tmp', 'bbmp-street-zone-heuristic.sql');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL missing');
    process.exit(1);
  }
  if (!fs.existsSync(SQL_PATH)) {
    console.error(`ERROR: ${SQL_PATH} missing — run heuristic-enrich-bbmp-zones.py first`);
    process.exit(1);
  }

  const sqlContent = fs.readFileSync(SQL_PATH, 'utf-8');
  // Split into individual UPDATE statements (drop BEGIN/COMMIT/comments).
  const statements = sqlContent
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('UPDATE '));

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 6,
  });

  const before = await pool.query(
    "SELECT COUNT(*)::int AS n FROM regulatory_data.bbmp_street_index WHERE zone_code IS NOT NULL"
  );
  console.log(`Before: ${before.rows[0].n} rows already have zone_code.`);
  console.log(`Applying ${statements.length} heuristic UPDATEs...`);

  let updated = 0;
  let progress = 0;
  // Run in small concurrent chunks so the pool stays healthy.
  const CHUNK = 50;
  for (let i = 0; i < statements.length; i += CHUNK) {
    const chunk = statements.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map((s) => pool.query(s)));
    for (const r of results) updated += r.rowCount;
    progress += chunk.length;
    if (progress % 500 === 0 || progress === statements.length) {
      process.stdout.write(`\r  ${progress}/${statements.length} statements applied (+${updated} rows updated)   `);
    }
  }
  process.stdout.write('\n');

  const after = await pool.query(
    "SELECT COUNT(*)::int AS n FROM regulatory_data.bbmp_street_index WHERE zone_code IS NOT NULL"
  );
  const total = await pool.query("SELECT COUNT(*)::int AS n FROM regulatory_data.bbmp_street_index");
  console.log(`After:  ${after.rows[0].n}/${total.rows[0].n} rows have zone_code (${updated} new)`);

  await pool.end();
}

main().catch((err) => {
  console.error('Apply failed:', err);
  process.exit(1);
});
