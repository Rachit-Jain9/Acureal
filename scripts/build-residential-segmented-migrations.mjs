// Builds two migrations from REDIP-COMPS/redip_bengaluru_micro_market_rates_v0_2_2026Q1.json:
//   1. Schema:  database/migrations/20260508_residential_segmented_benchmarks_schema.sql
//   2. Data:    database/migrations/20260508_residential_segmented_benchmarks_data.sql
//
// The 5 asset classes loaded here were flagged in TODO_DATA.md as "schema follow-up"
// from the v0.2 rate-pack refresh — the existing benchmark tables can't hold them
// because they have different units (INR/sqft for plot/house/builder-floor,
// INR mn/acre for land, SRO PDF placeholder for guidance value).
//
// Per the methodology footnote in TODO_DATA.md:
//   "Create separate tabs/layers in the REDIP UI: Listing Benchmarks, IPC Benchmarks,
//    Guidance Value, Internal Deals. Blending them silently will destroy credibility."
//
// We honor that by tagging each row with `data_type` = 'listing_q1_2026_v0_2'
// for portal-derived rows and 'guidance_q1_2026_v0_2_pending' for SRO placeholders.
//
// Run:
//   node scripts/build-residential-segmented-migrations.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const ORG_ID  = 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b';
const AS_OF   = '2026-05-04';
const SRC_JSON = path.resolve(repoRoot, '..', 'REDIP-COMPS', 'redip_bengaluru_micro_market_rates_v0_2_2026Q1.json');

// asset_class values in the JSON → enum-friendly slugs
const ASSET_CLASS_MAP = {
  'Builder floor apartments':                'builder_floor',
  'Plotted development / residential plot':  'plotted_development',
  'Land - residential plotted':              'land_residential_plotted',
  'Residential house / villa':               'villa_house',
  'Guidance value / circle rate':            'guidance_value',
};

// data_type values in the JSON → REDIP-internal data_type tags
const DATA_TYPE_MAP = {
  'Listing portal asking-price benchmark':                                'listing_q1_2026_v0_2',
  'Listing portal asking-price benchmark; converted from INR/sqyd':       'listing_q1_2026_v0_2',
  'Listing portal plot asking-price benchmark':                           'listing_q1_2026_v0_2',
  'Derived from Housing plot INR/sqft':                                   'listing_q1_2026_v0_2_derived',
  'Derived from listing-portal plot INR/sqyd':                            'listing_q1_2026_v0_2_derived',
  'Official government guidance-value source':                            'guidance_q1_2026_v0_2_pending',
};

const sqlEscape = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
};

const TABLE_NAME = 'residential_segmented_benchmarks';

const buildSchema = () => `-- 20260508_residential_segmented_benchmarks_schema.sql
-- =============================================================================
-- Schema for residential asset classes that the existing benchmark tables can't
-- hold. The v0.2 rate-pack ships 5 such classes (builder floor, plotted dev,
-- land residential plotted, villa/house, guidance value) — they share shape
-- (micro-market × metric × value × source) so we put them in one table.
-- =============================================================================
--
-- Methodology rule (TODO_DATA.md):
--   "Create separate tabs/layers in the REDIP UI: Listing Benchmarks, IPC
--    Benchmarks, Guidance Value, Internal Deals. Blending them silently will
--    destroy credibility."
--
-- The 'data_type' column carries the layer ('listing_q1_2026_v0_2',
-- 'listing_q1_2026_v0_2_derived', 'guidance_q1_2026_v0_2_pending') so the UI
-- can split-by-layer rather than rolling everything into one number.

BEGIN;

CREATE TABLE IF NOT EXISTS public.${TABLE_NAME} (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID            NOT NULL,

  city              TEXT            NOT NULL,
  micro_market      TEXT            NOT NULL,
  zone_cluster      TEXT,
  asset_class       TEXT            NOT NULL
                                      CHECK (asset_class IN (
                                        'builder_floor',
                                        'plotted_development',
                                        'land_residential_plotted',
                                        'villa_house',
                                        'guidance_value'
                                      )),
  metric            TEXT            NOT NULL,
  unit              TEXT            NOT NULL,

  value_low         NUMERIC,
  value_high        NUMERIC,
  value_avg         NUMERIC,
  qoq_change_pct    NUMERIC,
  yoy_change_pct    NUMERIC,

  source            TEXT            NOT NULL,
  source_url        TEXT,
  data_type         TEXT            NOT NULL,
  data_period       TEXT,
  as_of_date        DATE            NOT NULL,
  is_verified       BOOLEAN         NOT NULL DEFAULT FALSE,
  verification_status TEXT,
  notes             TEXT,

  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ${TABLE_NAME}_org_city_idx
  ON public.${TABLE_NAME} (organization_id, city);

CREATE INDEX IF NOT EXISTS ${TABLE_NAME}_asset_class_idx
  ON public.${TABLE_NAME} (asset_class);

CREATE INDEX IF NOT EXISTS ${TABLE_NAME}_data_type_idx
  ON public.${TABLE_NAME} (data_type);

CREATE UNIQUE INDEX IF NOT EXISTS ${TABLE_NAME}_unique_idx
  ON public.${TABLE_NAME} (organization_id, city, micro_market, asset_class, metric, data_type);

ALTER TABLE public.${TABLE_NAME} ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "${TABLE_NAME}_select_org" ON public.${TABLE_NAME};
CREATE POLICY "${TABLE_NAME}_select_org" ON public.${TABLE_NAME}
  FOR SELECT
  USING (organization_id = current_setting('redip.organization_id', true)::uuid);

DROP POLICY IF EXISTS "${TABLE_NAME}_modify_org" ON public.${TABLE_NAME};
CREATE POLICY "${TABLE_NAME}_modify_org" ON public.${TABLE_NAME}
  FOR ALL
  USING (organization_id = current_setting('redip.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('redip.organization_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.${TABLE_NAME} TO authenticated;

COMMIT;
`;

const buildData = (records) => {
  const lines = [];
  lines.push(`-- 20260508_residential_segmented_benchmarks_data.sql`);
  lines.push(`-- =============================================================================`);
  lines.push(`-- Data load for residential_segmented_benchmarks — ${records.length} rows from`);
  lines.push(`-- the v0.2 rate-pack (REDIP-COMPS/redip_bengaluru_micro_market_rates_v0_2_2026Q1.json).`);
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push(`-- =============================================================================`);
  lines.push(`--`);
  lines.push(`-- Run AFTER 20260508_residential_segmented_benchmarks_schema.sql`);
  lines.push(`-- (schema must exist before INSERT runs).`);
  lines.push(`--`);
  lines.push(`-- ON CONFLICT DO NOTHING (composite unique key on org+city+micro_market+`);
  lines.push(`-- asset_class+metric+data_type) → idempotent re-runs.`);
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');
  lines.push(`INSERT INTO public.${TABLE_NAME} (`);
  lines.push(`  organization_id, city, micro_market, zone_cluster, asset_class,`);
  lines.push(`  metric, unit, value_low, value_high, value_avg,`);
  lines.push(`  qoq_change_pct, yoy_change_pct,`);
  lines.push(`  source, source_url, data_type, data_period, as_of_date,`);
  lines.push(`  is_verified, verification_status, notes`);
  lines.push(`) VALUES`);

  const rowSqls = records.map((r) => {
    const ac = ASSET_CLASS_MAP[r.asset_class];
    const dt = DATA_TYPE_MAP[r.data_type] || 'listing_q1_2026_v0_2';
    if (!ac) throw new Error(`Unmapped asset_class: ${r.asset_class}`);

    return [
      sqlEscape(ORG_ID),
      sqlEscape('Bengaluru'),
      sqlEscape(r.micro_market),
      sqlEscape(r.zone_cluster ?? null),
      sqlEscape(ac),
      sqlEscape(r.metric),
      sqlEscape(r.unit),
      sqlEscape(r.value_low ?? null),
      sqlEscape(r.value_high ?? null),
      sqlEscape(r.value_avg ?? null),
      sqlEscape(r.qoq_change ?? null),
      sqlEscape(r.yoy_change ?? null),
      sqlEscape(r.source),
      sqlEscape(r.source_url ?? null),
      sqlEscape(dt),
      sqlEscape(r.period ?? 'Q1 2026 v0.2'),
      sqlEscape(AS_OF),
      // is_verified TRUE for IPC; portal-derived stays FALSE; guidance placeholder FALSE
      r.data_type === 'Official government guidance-value source' ? 'FALSE' : 'TRUE',
      sqlEscape(r.verification_status ?? null),
      sqlEscape(r.notes_for_redip ?? null),
    ].map((v) => `${v}`).join(', ');
  });

  lines.push(rowSqls.map((s) => `  (${s})`).join(',\n'));
  lines.push(`ON CONFLICT (organization_id, city, micro_market, asset_class, metric, data_type) DO NOTHING;`);
  lines.push('');
  lines.push('COMMIT;');
  lines.push('');
  return lines.join('\n');
};

const main = async () => {
  const raw = await fs.readFile(SRC_JSON, 'utf8');
  const json = JSON.parse(raw);

  const target = new Set(Object.keys(ASSET_CLASS_MAP));
  const records = json.records.filter((r) => target.has(r.asset_class));

  console.log(`Loaded ${json.records.length} records; ${records.length} match target asset classes.`);

  const counts = records.reduce((m, r) => { m[r.asset_class] = (m[r.asset_class] || 0) + 1; return m; }, {});
  console.log('By asset class:');
  for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k}: ${v}`);

  const schemaPath = path.resolve(repoRoot, 'database/migrations/20260508_residential_segmented_benchmarks_schema.sql');
  const dataPath   = path.resolve(repoRoot, 'database/migrations/20260508_residential_segmented_benchmarks_data.sql');

  await fs.writeFile(schemaPath, buildSchema(), 'utf8');
  await fs.writeFile(dataPath,   buildData(records), 'utf8');

  console.log(`\nWrote ${schemaPath}`);
  console.log(`Wrote ${dataPath}`);
};

main().catch((e) => { console.error(e); process.exit(1); });
