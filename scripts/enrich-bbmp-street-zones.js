#!/usr/bin/env node
// scripts/enrich-bbmp-street-zones.js
// Phase 2 — call Gemini multimodal on every Guidance Value page that
// has at least one street in regulatory_data.bbmp_street_index, ask it
// for the zone classification of each street, then UPDATE the matching
// rows with zone_code + guidance_value_band_min/max.
//
// Designed to be re-runnable: rows that already have a zone_code are
// skipped at SQL level (no API call), and per-page API failures only
// skip that page rather than aborting the run.
//
// Usage:
//   node scripts/enrich-bbmp-street-zones.js [--limit N] [--page P] [--dry-run]
//
// Flags:
//   --limit N    Only process the first N pages (smoke test).
//   --page  P    Only process page P (debugging).
//   --dry-run    Hit Gemini, log the result, skip the DB UPDATE.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

// Load both env files, with .env.local overriding .env (Vercel convention).
// Strip the UTF-8 BOM that Vercel CLI writes — without this, the first key
// in .env.local fails to load.
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

const { GoogleGenerativeAI } = require('@google/generative-ai');

const PDF_PAGES_DIR = path.join(__dirname, '..', 'tmp', 'pdf-pages');
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const CONCURRENCY = Number(process.env.ENRICHMENT_CONCURRENCY || 4);

// CLI flags
const args = process.argv.slice(2);
const limit = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? Number(args[i + 1]) : null;
})();
const onlyPage = (() => {
  const i = args.indexOf('--page');
  return i >= 0 ? Number(args[i + 1]) : null;
})();
const dryRun = args.includes('--dry-run');

const PROMPT = `You are extracting structured zone classification data from one page of the BBMP Guidance Value gazette (Notification No. 384 dated 09-Mar-2016).

Each page contains an ARO (Assistant Revenue Officer) jurisdiction header at the top, followed by tables of streets organized BY ZONE. Each zone section has:
  - A "ZONE X" header (X is A, B, C, D, E, or F)
  - A "GUIDANCE VALUE BANDWIDTH" line stating the Rs./sqft band for that zone
  - A list of street rows with columns: Sl.No | Ward No | Street Name (English) | Street Name (Kannada)

The streets that appear BETWEEN consecutive zone headers belong to the zone whose header IMMEDIATELY PRECEDES them (in visual document order).

Return STRICT JSON with this exact schema:
{
  "page_number": <integer>,
  "aro_section": <string or null>,
  "zones": [
    {
      "zone_code": "A" | "B" | "C" | "D" | "E" | "F",
      "guidance_value_band_min_inr": <integer or null>,
      "guidance_value_band_max_inr": <integer or null>,
      "streets": [
        { "street_name": "<English street name only, uppercased>", "ward_no": <integer or null> }
      ]
    }
  ]
}

Rules:
- Use only the ENGLISH portion of each street row; ignore the Kannada column entirely.
- Strip trailing punctuation and Kannada glyphs that leak into the English cell.
- If the page has no street rows (e.g., it's only notification/Table preamble), return zones: [].
- If guidance value is "Rs. 7001 & Above", set min=7001, max=null.
- If guidance value is "Rs. 2001 to Rs. 3500", set min=2001, max=3500.
- Output ONLY the JSON, no prose. Do not wrap in markdown fences.`;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL missing from backend/.env');
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY missing from backend/.env');
    process.exit(1);
  }
  if (!fs.existsSync(PDF_PAGES_DIR)) {
    console.error(`ERROR: ${PDF_PAGES_DIR} missing — run scripts/split-guidance-value-pdf.py first`);
    process.exit(1);
  }

  const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genai.getGenerativeModel({ model: MODEL });
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 6,
  });

  // Find pages that have street rows but no zone enrichment yet.
  let pages;
  if (onlyPage) {
    pages = [onlyPage];
  } else {
    const result = await pool.query(`
      SELECT page_number,
             COUNT(*) FILTER (WHERE zone_code IS NULL) AS unenriched,
             COUNT(*) AS total
      FROM regulatory_data.bbmp_street_index
      GROUP BY page_number
      HAVING COUNT(*) FILTER (WHERE zone_code IS NULL) > 0
      ORDER BY page_number
    `);
    pages = result.rows.map((r) => r.page_number);
  }

  if (limit) pages = pages.slice(0, limit);

  console.log(`Processing ${pages.length} pages with unenriched street rows (model=${MODEL}, concurrency=${CONCURRENCY}, dry-run=${dryRun})`);

  let succeeded = 0;
  let failed = 0;
  let totalUpdated = 0;

  // Simple bounded-concurrency runner.
  const queue = [...pages];
  const workers = Array.from({ length: CONCURRENCY }, async (_, workerId) => {
    while (queue.length) {
      const pageNumber = queue.shift();
      try {
        const pdfPath = path.join(PDF_PAGES_DIR, `page-${String(pageNumber).padStart(3, '0')}.pdf`);
        const base64 = fs.readFileSync(pdfPath).toString('base64');
        const promptWithPage = `${PROMPT}\n\nThis is page ${pageNumber}.`;
        const response = await model.generateContent([
          promptWithPage,
          { inlineData: { data: base64, mimeType: 'application/pdf' } },
        ]);
        const text = (response.response.text() || '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();

        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (parseErr) {
          throw new Error(`bad JSON: ${parseErr.message} :: ${text.slice(0, 200)}`);
        }

        const zones = Array.isArray(parsed.zones) ? parsed.zones : [];
        let pageUpdated = 0;

        if (!dryRun) {
          for (const zone of zones) {
            if (!zone.zone_code || !Array.isArray(zone.streets)) continue;
            for (const street of zone.streets) {
              if (!street.street_name) continue;
              const result = await pool.query(
                `UPDATE regulatory_data.bbmp_street_index
                 SET zone_code = $1,
                     guidance_value_band_min_inr = $2,
                     guidance_value_band_max_inr = $3,
                     confidence_score = 0.85
                 WHERE page_number = $4
                   AND lower(street_name_en) = lower($5)
                   AND (ward_no = $6 OR (ward_no IS NULL AND $6 IS NULL))
                   AND zone_code IS NULL`,
                [
                  zone.zone_code,
                  zone.guidance_value_band_min_inr ?? null,
                  zone.guidance_value_band_max_inr ?? null,
                  pageNumber,
                  street.street_name,
                  street.ward_no ?? null,
                ],
              );
              pageUpdated += result.rowCount;
            }
          }
        }

        succeeded += 1;
        totalUpdated += pageUpdated;
        process.stdout.write(`\r  [w${workerId}] page ${pageNumber}: ${zones.length} zones → ${pageUpdated} rows updated. ${succeeded}/${pages.length} pages done (${failed} failed, ${totalUpdated} total updates).      `);
      } catch (err) {
        failed += 1;
        console.error(`\n  [w${workerId}] page ${pageNumber} FAILED: ${err.message}`);
      }
    }
  });

  await Promise.all(workers);
  process.stdout.write('\n');

  if (!dryRun) {
    const after = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE zone_code IS NOT NULL)::int AS enriched,
             COUNT(*)::int AS total
      FROM regulatory_data.bbmp_street_index
    `);
    console.log(`\nFinal: ${after.rows[0].enriched}/${after.rows[0].total} rows have zone_code (${succeeded} pages succeeded, ${failed} failed)`);
  } else {
    console.log(`\nDry run complete: ${succeeded} pages succeeded, ${failed} failed.`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Enrichment failed:', err);
  process.exit(1);
});
