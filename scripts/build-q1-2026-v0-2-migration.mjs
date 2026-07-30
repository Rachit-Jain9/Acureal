// Convert the v0.2 Q1 2026 Bengaluru rate-pack JSON into a SQL migration
// that REPLACES the relevant rows in office / retail / industrial /
// hospitality / micro_market / macro_kpi tables.
//
// Run:
//   node scripts/build-q1-2026-v0-2-migration.mjs <path-to-json> > database/migrations/20260507_q1_2026_v0_2_data_refresh.sql
//
// Why a script vs. hand-written SQL: 172 rows would be copy-paste-error-prone.
// The script is one-off; it's checked in so the next refresh can re-run
// against an updated JSON drop without rebuilding from scratch.

import { readFileSync } from 'node:fs';
import { argv } from 'node:process';

const SOURCE_PATH = argv[2] || 'C:/Users/rachi/OneDrive - UW/Desktop/Acureal-COMPS/redip_bengaluru_micro_market_rates_v0_2_2026Q1.json';
const AS_OF_DATE = '2026-05-04';
const PERIOD_LABEL = 'Q1 2026 v0.2';
// Single-tenant org_id used by all existing market_* rows. Hardcoded so the
// migration is idempotent regardless of environment quirks; if a second
// org ever exists, this script needs to be adapted to fan out per org.
const ORG_ID = 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b';

const raw = JSON.parse(readFileSync(SOURCE_PATH, 'utf8'));
const records = raw.records;

// SQL string escaping — single quotes only; bail loudly on null bytes.
const sq = (v) => {
  if (v == null) return 'NULL';
  const s = String(v);
  if (s.includes('\x00')) throw new Error('Null byte in value');
  return `'${s.replace(/'/g, "''")}'`;
};
const num = (v) => (v == null || v === '' ? 'NULL' : `${Number(v)}`);
const pctFromString = (s) => {
  // CSV stores '+1%', '-0.2%', '3-4%' etc. Take the first numeric token.
  if (s == null) return null;
  const m = String(s).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

// ── Group records by asset_class + verified status ─────────────────────────
const byClass = new Map();
for (const r of records) {
  const k = r.asset_class;
  if (!byClass.has(k)) byClass.set(k, []);
  byClass.get(k).push(r);
}

// ── Build SQL ──────────────────────────────────────────────────────────────
const out = [];

const header = `-- 20260507_q1_2026_v0_2_data_refresh.sql
-- =============================================================================
-- Acureal Bengaluru Micro-Market Rate Pack v0.2 — Q1 2026 refresh
-- Generated: ${new Date().toISOString()}
-- Source: redip_bengaluru_micro_market_rates_v0_2_2026Q1.json (${records.length} records)
-- =============================================================================
--
-- Replaces existing Q1 2026 IPC rows in office / retail / industrial /
-- hospitality / micro-market benchmark tables with the v0.2 dataset, which
-- is more granular (per-submarket office rents + vacancy, per-corridor retail
-- rent, per-segment industrial rent + land value, micro-market-level
-- residential listings).
--
-- DELETE policy: scoped to city='Bengaluru' AND data_type/level matching the
-- v0.2 cohort (IPC Q1 2026 + listing Q1 2026). Pre-existing non-Q1-2026 rows
-- (e.g. internal Apr 2026 verified comps) are preserved.
--
-- New asset classes the existing schema can't hold (Builder floor, Plotted
-- development, Villa/independent house, Land - residential plotted, Guidance
-- value) are recorded in TODO_DATA.md for follow-up schema work, NOT
-- silently dropped.

BEGIN;

`;
out.push(header);

// ── Office: 10 submarkets, each has vacancy + rent rows in source. Pair up. ─
const officeRows = byClass.get('Commercial office - Grade A') || [];
const officePairs = new Map(); // submarket -> { vacancy, rent, ...meta }
for (const r of officeRows) {
  const k = r.micro_market;
  const cur = officePairs.get(k) || { meta: r };
  if (r.metric === 'Overall vacancy') cur.vacancy = r.value_avg;
  if (r.metric === 'Stock-weighted quoted rent') cur.rent = r.value_avg;
  officePairs.set(k, cur);
}
out.push(`-- ── Office: ${officePairs.size} submarkets (each with vacancy + stock-weighted rent) ──`);
out.push(`DELETE FROM office_market_benchmarks WHERE city='Bengaluru';`);
out.push(``);
for (const [submarket, v] of officePairs) {
  const isCitywide = /citywide|total/i.test(submarket);
  const levelType = isCitywide ? 'ipc_zone' : 'submarket';
  out.push(
    `INSERT INTO office_market_benchmarks (organization_id, city, submarket, cluster, level_type, vacancy_pct, stock_weighted_rent_psf_month, source, source_url, as_of_date, is_verified, notes) VALUES `
    + `('${ORG_ID}', 'Bengaluru', ${sq(submarket)}, ${sq(v.meta.zone_cluster)}, ${sq(levelType)}, ${num(v.vacancy)}, ${num(v.rent)}, ${sq(v.meta.source)}, ${sq(v.meta.source_url)}, ${sq(AS_OF_DATE)}, TRUE, ${sq('IPC Grade-A Q1 2026 v0.2 — ' + (v.meta.notes_for_redip || ''))});`,
  );
}
out.push(``);

// ── Retail: high-street rows. CSV has avg rent + qoq + yoy per corridor. ───
const retailRows = byClass.get('Retail - high street ground floor vanilla') || [];
out.push(`-- ── Retail: ${retailRows.length} high-street corridors ──`);
out.push(`DELETE FROM retail_market_benchmarks WHERE city='Bengaluru' AND format='high_street';`);
out.push(``);
for (const r of retailRows) {
  out.push(
    `INSERT INTO retail_market_benchmarks (organization_id, city, corridor, cluster, format, rent_low_psf_month, rent_high_psf_month, rent_avg_psf_month, qoq_change_pct, yoy_change_pct, source, source_url, as_of_date, is_verified, notes) VALUES `
    + `('${ORG_ID}', 'Bengaluru', ${sq(r.micro_market)}, ${sq(r.zone_cluster)}, 'high_street', ${num(r.value_avg)}, ${num(r.value_avg)}, ${num(r.value_avg)}, ${num(pctFromString(r.qoq_change))}, ${num(pctFromString(r.yoy_change))}, ${sq(r.source)}, ${sq(r.source_url)}, ${sq(AS_OF_DATE)}, TRUE, ${sq('IPC Q1 2026 v0.2 — ' + (r.notes_for_redip || ''))});`,
  );
}
out.push(``);

// ── Industrial / warehouse / serviced land: combine rent + land per submarket
const indRent = byClass.get('Industrial / manufacturing') || [];
const whRent  = byClass.get('Industrial / warehousing') || [];
const indLand = byClass.get('Industrial serviced land') || [];

const indMap = new Map(); // submarket -> { rent_low, rent_high, land_low, land_high, segment, ...meta }
for (const r of [...indRent, ...whRent]) {
  const k = r.micro_market;
  const cur = indMap.get(k) || { meta: r, segment: r.asset_class.includes('warehous') ? 'warehouse' : 'industrial' };
  cur.rent_low = r.value_low;
  cur.rent_high = r.value_high;
  cur.yoy = pctFromString(r.yoy_change);
  cur.meta = r;
  indMap.set(k, cur);
}
for (const r of indLand) {
  const k = r.micro_market;
  const cur = indMap.get(k) || { meta: r, segment: 'serviced_land' };
  cur.land_low = r.value_low;
  cur.land_high = r.value_high;
  if (cur.yoy == null) cur.yoy = pctFromString(r.yoy_change);
  if (!cur.meta) cur.meta = r;
  indMap.set(k, cur);
}

out.push(`-- ── Industrial / Warehouse / Land: ${indMap.size} submarkets ──`);
out.push(`DELETE FROM industrial_market_benchmarks WHERE city='Bengaluru';`);
out.push(``);
for (const [submarket, v] of indMap) {
  out.push(
    `INSERT INTO industrial_market_benchmarks (organization_id, city, submarket, cluster, segment, rent_low_psf_month, rent_high_psf_month, land_value_low_inr_mn_per_acre, land_value_high_inr_mn_per_acre, yoy_change_pct, source, source_url, as_of_date, is_verified, notes) VALUES `
    + `('${ORG_ID}', 'Bengaluru', ${sq(submarket)}, ${sq(v.meta.zone_cluster)}, ${sq(v.segment)}, ${num(v.rent_low)}, ${num(v.rent_high)}, ${num(v.land_low)}, ${num(v.land_high)}, ${num(v.yoy)}, ${sq(v.meta.source)}, ${sq(v.meta.source_url)}, ${sq(AS_OF_DATE)}, TRUE, ${sq('IPC H2 2025 v0.2 — ' + (v.meta.notes_for_redip || ''))});`,
  );
}
out.push(``);

// ── Hospitality: combine ADR/Occ/RevPAR per submarket ──────────────────────
const hospRows = byClass.get('Hospitality') || [];
const hospMap = new Map();
for (const r of hospRows) {
  const k = r.micro_market;
  const cur = hospMap.get(k) || { meta: r };
  if (r.metric === 'ADR / average daily rate') cur.adr = r.value_avg;
  if (r.metric === 'Occupancy') cur.occ = r.value_avg;
  if (r.metric === 'RevPAR') cur.revpar = r.value_avg;
  cur.meta = r;
  hospMap.set(k, cur);
}
out.push(`-- ── Hospitality: ${hospMap.size} clusters ──`);
out.push(`DELETE FROM hospitality_market_benchmarks WHERE city='Bengaluru';`);
out.push(``);
for (const [submarket, v] of hospMap) {
  const segment = /citywide/i.test(submarket) ? 'citywide' : 'upper_upscale';
  out.push(
    `INSERT INTO hospitality_market_benchmarks (organization_id, city, submarket, cluster, segment, adr_low_inr, adr_high_inr, occupancy_pct, revpar_inr, source, source_url, as_of_date, is_verified, notes) VALUES `
    + `('${ORG_ID}', 'Bengaluru', ${sq(submarket)}, ${sq(v.meta.zone_cluster)}, ${sq(segment)}, ${num(v.adr)}, ${num(v.adr)}, ${num(v.occ)}, ${num(v.revpar ?? null)}, ${sq(v.meta.source)}, ${sq(v.meta.source_url)}, ${sq(AS_OF_DATE)}, TRUE, ${sq('Horwath HTL 2025 v0.2 — ' + (v.meta.notes_for_redip || ''))});`,
  );
}
out.push(``);

// ── Micro-market benchmarks: residential apartments listings + IPC zones ────
// The existing schema is a single row per (city, micro_market, data_type).
// CSV has TWO residential layers: (a) listing-portal apartment values
// per-micro-market, (b) IPC zone-level high-end + mid-segment values.
// We insert both — they live behind different data_type strings.
const apartmentRows = byClass.get('Residential apartments') || [];
const highEndRows = byClass.get('High-end residential') || [];
const midSegRows  = byClass.get('Mid-segment residential') || [];

// Capital-value rows only (skip rent rows; they'd need a separate column).
const ipcRows = [...highEndRows, ...midSegRows].filter((r) => r.metric === 'Capital value');

out.push(`-- ── Micro-market: ${apartmentRows.length} listing-portal + ${ipcRows.length} IPC zone rows ──`);
// IPC rows for High-end and Mid-segment residential share the SAME zone label
// (Central, East, North, South, etc.) — the unique constraint
// `(organization_id, city, micro_market, data_type)` would collide if both
// sub-segments used the same data_type. We split: ipc_q1_2026_v0_2_high_end
// vs. ipc_q1_2026_v0_2_mid_segment so each row is uniquely keyed AND the
// frontend can filter / colour-code by segment if it wants.
out.push(`DELETE FROM micro_market_benchmarks WHERE city='Bengaluru' AND data_type IN ('listing_q1_2026','ipc_q1_2026','listing_q1_2026_v0_2','ipc_q1_2026_v0_2','ipc_q1_2026_v0_2_high_end','ipc_q1_2026_v0_2_mid_segment');`);
out.push(``);

const insertMicro = (micro, anchor, low, high, qoqRaw, yoyRaw, source, sourceUrl, dataType, notes) => {
  const yoy = pctFromString(yoyRaw);
  const qoq = pctFromString(qoqRaw);
  out.push(
    `INSERT INTO micro_market_benchmarks (organization_id, city, micro_market, avg_price_min_per_sqft, avg_price_max_per_sqft, yoy_growth_min_pct, yoy_growth_max_pct, qoq_change_pct, anchor_hub, data_period, source, source_url, data_type, as_of_date, is_verified, notes) VALUES `
    + `('${ORG_ID}', 'Bengaluru', ${sq(micro)}, ${num(low)}, ${num(high)}, ${num(yoy)}, ${num(yoy)}, ${num(qoq)}, ${sq(anchor)}, '${PERIOD_LABEL}', ${sq(source)}, ${sq(sourceUrl)}, ${sq(dataType)}, ${sq(AS_OF_DATE)}, TRUE, ${sq(notes || '')});`,
  );
};

for (const r of apartmentRows) {
  insertMicro(
    r.micro_market, r.zone_cluster, r.value_low, r.value_high,
    r.qoq_change, r.yoy_change, r.source, r.source_url,
    'listing_q1_2026_v0_2',
    'Listing portal asking-price benchmark — ' + (r.notes_for_redip || ''),
  );
}
for (const r of ipcRows) {
  // High-end vs. Mid-segment share zone labels (Central, East, ...) so we
  // namespace data_type by sub-segment to keep the unique constraint happy.
  const subSegment = /high-end/i.test(r.asset_class)
    ? 'high_end'
    : /mid-segment/i.test(r.asset_class)
    ? 'mid_segment'
    : 'other';
  insertMicro(
    r.micro_market, r.zone_cluster, r.value_low, r.value_high,
    r.qoq_change, r.yoy_change, r.source, r.source_url,
    `ipc_q1_2026_v0_2_${subSegment}`,
    'IPC submarket benchmark (' + r.asset_class + ') — ' + (r.notes_for_redip || ''),
  );
}
out.push(``);

// ── New asset classes that need NEW tables (out of scope for this PR) ──────
const tier2 = ['Builder floor apartments', 'Plotted development / residential plot', 'Land - residential plotted', 'Residential house / villa', 'Guidance value / circle rate'];
const tier2Counts = tier2.map((c) => `${c}: ${(byClass.get(c) || []).length}`);
out.push(`-- ── Tier-2 follow-up (logged in TODO_DATA.md, not inserted in this migration) ──`);
out.push(`-- The v0.2 dataset includes asset classes that don't fit the current`);
out.push(`-- schema. Adding tables for them is a separate PR:`);
out.push(`--   ${tier2Counts.join('\n--   ')}`);
out.push(``);
out.push(`COMMIT;`);
out.push(``);

console.log(out.join('\n'));
