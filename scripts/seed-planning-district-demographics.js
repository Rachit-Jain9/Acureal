#!/usr/bin/env node
// scripts/seed-planning-district-demographics.js
//
// Upserts the 42-entry Planning District demographics block into
// regulatory_data.evidence_facts as a single row of
// (fact_type='rmp_table', fact_key='planning_districts').
//
// The aggregate fact_value is an array of {pd_code, pd_name, notes, ...}
// objects in the exact shape that masterplan.service.js → parseDistrictNotes()
// expects. See scripts/extract-volume-4-pdr.py for the upstream extractor.
//
// Idempotency: deletes any prior "rich" PD facts (the ones whose entries
// carry a non-empty `notes` field) and inserts a fresh one. The thin
// routing-key facts (entries without notes) are left alone so the
// service's dual-fact tolerance keeps working.
//
// Usage:
//   node scripts/seed-planning-district-demographics.js [--dry-run]
//
// Optional env:
//   DATABASE_URL                       — Postgres connection string (required)
//   PD_DEMOGRAPHICS_SOURCE_ID          — UUID of the evidence_sources row for
//                                        Volume-4 PDR. Defaults to the existing
//                                        seed (3b3fcb12-e384-44a0-9105-dd0a155c45af).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

// Load env (Vercel convention)
const dotenv = require('dotenv');
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

const JSON_PATH = path.join(__dirname, '..', 'tmp', 'volume-4-pdr-demographics.json');
const SOURCE_ID = process.env.PD_DEMOGRAPHICS_SOURCE_ID
  || '3b3fcb12-e384-44a0-9105-dd0a155c45af'; // existing Volume-4 PDR row
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL missing from backend/.env');
    process.exit(1);
  }
  if (!fs.existsSync(JSON_PATH)) {
    console.error(`ERROR: missing ${JSON_PATH} — run scripts/extract-volume-4-pdr.py first`);
    process.exit(1);
  }

  const rows = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error(`ERROR: ${JSON_PATH} did not parse to a non-empty array`);
    process.exit(1);
  }
  console.log(`Loaded ${rows.length} PD demographics records from ${JSON_PATH}`);

  // Project the rows down to the shape the service expects on read.
  // We keep the structured numerics inline alongside the notes string
  // so future re-extraction doesn't need to re-parse the notes regex.
  const factValue = rows.map((r) => ({
    pd_code: r.pd_code,
    pd_name: r.pd_name,
    notes: r.notes,
    source_page: r.source_page ?? null,
    source_section: r.source_section ?? null,
    population_2011: r.population_2011_census ?? null,
    area_ha: r.area_ha ?? null,
    gross_density_pph: r.gross_density_pph ?? null,
    wards_in_pd: r.wards_in_pd ?? null,
    villages_count: r.villages_count ?? null,
  }));

  if (DRY_RUN) {
    console.log('--dry-run set — not writing to DB.');
    console.log('Sample entry:', JSON.stringify(factValue[0], null, 2));
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete any prior "rich" (notes-bearing) PD facts. Thin routing-key
    // facts (entries without notes) are left alone.
    const del = await client.query(`
      DELETE FROM regulatory_data.evidence_facts
      WHERE fact_type = 'rmp_table'
        AND fact_key = 'planning_districts'
        AND jsonb_typeof(fact_value) = 'array'
        AND jsonb_array_length(fact_value) > 10
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(fact_value) AS elem
          WHERE COALESCE(elem->>'notes', '') <> ''
        )
      RETURNING id
    `);
    console.log(`Deleted ${del.rowCount} prior rich PD facts (kept thin routing-key facts)`);

    const ins = await client.query(`
      INSERT INTO regulatory_data.evidence_facts
        (source_id, fact_type, fact_key, fact_value, page_number,
         source_section, confidence_score, review_status)
      VALUES
        ($1, 'rmp_table', 'planning_districts', $2::jsonb, NULL,
         'Volume-4 PDR per-PD demographics', 0.90, 'pending')
      RETURNING id
    `, [SOURCE_ID, JSON.stringify(factValue)]);

    await client.query('COMMIT');
    console.log(`Inserted fact id=${ins.rows[0].id} with ${factValue.length} PD entries.`);

    const verify = await client.query(`
      SELECT COUNT(*) FILTER (
        WHERE fact_type = 'rmp_table' AND fact_key = 'planning_districts'
      )::int AS total_pd_facts
      FROM regulatory_data.evidence_facts
    `);
    console.log(`Total rmp_table.planning_districts facts now: ${verify.rows[0].total_pd_facts}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
