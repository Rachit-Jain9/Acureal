// Convert GBA Comps Report Table 3 (Residential apartment locality baskets,
// 27 rows) into a SQL migration that inserts them as comp rows.
//
// Run:
//   node scripts/build-residential-baskets-migration.mjs <path-to-tsv>
//   > database/migrations/20260508_residential_apartment_baskets_q1_2026.sql
//
// Input format: tab-separated rows extracted from the docx via Python
// (one-off; the TSV is read inline below to avoid a python-docx dep here).

import { argv } from 'node:process';

const ORG_ID = 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b';
const AS_OF = '2026-05-04';

// Hardcoded TSV from the docx Table 3 — 27 rows. Format:
// Micro-market | Project | Developer | Locality | Type/Unit Mix | Rate | Units/Scale | Launch | Source
const RAW = String.raw`AECS Layout Marathahalli|AECS Layout resale apartment basket|Multiple local developers / RWAs|AECS Layout, Marathahalli|Older multistorey resale apartments|9,622-15,416 | avg 12,519 INR/sqft|Project-level units not public|N.A.|MagicBricks Property Rates
Marathahalli|Marathahalli resale apartment basket|Multiple developers|Marathahalli / ORR-East|2/3 BHK apartments; older resale-heavy stock|7,033-11,451 | avg 9,242 INR/sqft|Project-level units not public|N.A.|MagicBricks Marathahalli
Whitefield|Prestige Park Grove / Whitefield resale basket|Prestige Group + secondary market|Seegehalli / Whitefield|1/2/3/4 BHK apartments; 4 BHK villas|9,960-16,451 | avg 13,206 INR/sqft|3,627 apartments + villas (project)|2023|MagicBricks Whitefield
Electronic City|Brigade Valencia / E-City benchmark basket|Brigade Group + local stock|Electronic City / Hosur Road belt|3/4 BHK apartments; mid-premium stock|6,419-11,338 | avg 8,879 INR/sqft|Project-level units not fully public|2024 RERA|MagicBricks Electronic City
Yelahanka|Brigade Insignia / Yelahanka basket|Brigade Group|Yelahanka / Kogilu-Airport Road belt|3/4/5 BHK luxury apartments|7,489-12,505 | avg 9,997 INR/sqft|379 units|2024 RERA|MagicBricks Yelahanka
Yelahanka New Town|Yelahanka New Town apartment/plot basket|Multiple developers|Yelahanka New Town|2/3 BHK apartments; plotted-layout stock|7,131-11,763 | avg 9,447 INR/sqft|Project-level units not public|N.A.|MagicBricks Property Rates
Devanahalli|Birla Trimaya / Godrej MSR City|Birla Estates / Godrej Properties|Shettigere-Devanahalli airport corridor|1/2/3/4 BHK township apartments|7,772-11,365 | avg 9,568 INR/sqft|Birla Phase 4: 548 residences; Godrej Phase 1: 1,961 apartments|2023-2026 phased|MagicBricks Devanahalli
Hebbal|Embassy Lake Terraces / Karle Zenith benchmark|Embassy Group / Karle Infra|Hebbal / Nagavara / Bellary Road|Premium 3/4/5 BHK apartments|12,270-20,404 | avg 16,337 INR/sqft|Project-level units not public|N.A.|MagicBricks Hebbal
Hebbal Kempapura|Hebbal Kempapura apartment basket|Multiple developers|Hebbal Kempapura|2/3 BHK apartments|6,896-11,883 | avg 9,389 INR/sqft|Project-level units not public|N.A.|MagicBricks Property Rates
Thanisandra|Sobha City / Thanisandra basket|Sobha Limited + others|Thanisandra Main Road / Manyata fringe|2/3/4 BHK apartments; gated communities|8,989-14,288 | avg 11,638 INR/sqft|Sobha City: 2,200+ units (multi-phase)|2014-2026 phased|MagicBricks Thanisandra
Hennur Bagalur Main Road|Hennur-Bagalur apartment basket|Multiple developers|Hennur-Bagalur belt|2/3 BHK apartments; emerging premium|7,394-12,173 | avg 9,783 INR/sqft|Project-level units not public|N.A.|MagicBricks Property Rates
Hennur Main Road|Hennur Main Road apartment basket|Multiple developers|Hennur Main Road|2/3 BHK family apartments|7,482-13,040 | avg 10,261 INR/sqft|Project-level units not public|N.A.|MagicBricks Hennur Main Road
Rajajinagar|Brigade Gateway / Rajajinagar basket|Brigade Group + redevelopers|Rajajinagar West|2/3/4 BHK premium apartments|18,251-29,153 | avg 23,702 INR/sqft|Brigade Gateway: 800+ units|2010-2024 phased|MagicBricks Rajajinagar
Rajajinagar 1st Block|Rajajinagar 1st Block premium basket|Mixed redevelopment|Rajajinagar 1st Block|3/4 BHK premium apartments|21,148-29,252 | avg 25,200 INR/sqft|Project-level units not public|N.A.|MagicBricks Property Rates
Defence Colony Indiranagar|Defence Colony Indiranagar redevelopment basket|Boutique builders|Defence Colony / Indiranagar|3/4 BHK builder-floor + redevelopment|21,626-24,941 | avg 23,284 INR/sqft|Project-level units not public|N.A.|MagicBricks Property Rates
Indiranagar|Indiranagar redevelopment / 100 Ft Road basket|Boutique + Embassy|Indiranagar 100 Feet Road / 1st-12th Main|3/4 BHK redevelopment + boutique|14,740-22,807 | avg 18,773 INR/sqft|Project-level units not public|N.A.|MagicBricks Indiranagar
Bellandur|Adarsh Palm Retreat / Bellandur basket|Adarsh Developers + others|Bellandur / ORR-South|3/4 BHK apartments; villas|11,121-19,092 | avg 15,106 INR/sqft|Project-level units not public|N.A.|MagicBricks Bellandur
Marathahalli-Sarjapur ORR|Marathahalli-Sarjapur ORR basket|Multiple developers (Embassy TechVillage adjacent)|Kadubeesanahalli / Bellandur ORR|3/4 BHK premium apartments|11,507-18,783 | avg 15,145 INR/sqft|Project-level units not public|N.A.|MagicBricks Property Rates
Bannerghatta Main Road|Prestige Elysian / Bannerghatta basket|Prestige Group + Sattva|Arekere / IIM-Bannerghatta corridor|3/4 BHK premium apartments|7,237-12,810 | avg 10,024 INR/sqft|Prestige Elysian: 487 units|2017-2024|MagicBricks Bannerghatta Main Road
Jayanagar|Sobha Opal / Jayanagar redevelopment basket|Sobha + boutique redevelopers|Jayanagar 1st-9th Block|3/4 BHK redevelopment + boutique|11,114-17,467 | avg 14,290 INR/sqft|Project-level units not public|N.A.|MagicBricks Jayanagar
Koramangala|Koramangala 1st-8th Block apartment basket|Boutique + redevelopers|Koramangala 1st-8th Block|3/4 BHK boutique + redevelopment|11,827-19,347 | avg 15,587 INR/sqft|Project-level units not public|N.A.|MagicBricks Koramangala
Koramangala 1st Block|Koramangala 1st Block premium basket|Boutique builders|Koramangala 1st Block|3/4 BHK premium boutique|14,483-23,555 | avg 19,019 INR/sqft|Project-level units not public|N.A.|MagicBricks Property Rates
JP Nagar|JP Nagar Phase 1-9 apartment basket|Multiple developers|JP Nagar Phases 1-9|2/3/4 BHK; very high stage-wise dispersion|7,426-12,361 | avg 9,893 INR/sqft|Project-level units not public|N.A.|MagicBricks JP Nagar
Kanakapura Road|Mantri Serenity / Prestige Falcon City|Mantri Developers / Prestige Group|Kanakapura Road / Metro Green Line|2/3/4 BHK apartments + plotted-villa|7,788-13,200 | avg 10,494 INR/sqft|Mantri Serenity: 1,400 units; Falcon City: 3,001 units|2015-2025 phased|MagicBricks Kanakapura Road
HSR Layout|HSR Layout apartment basket|Boutique + redevelopers|HSR Layout Sectors 1-7|3/4 BHK; layout plot premium|7,714-11,012 | avg 9,363 INR/sqft|Project-level units not public|N.A.|MagicBricks HSR Layout
Sarjapur Road|Sarjapur Road / Carmelaram apartment basket|Multiple developers|Inner Sarjapur Road / Carmelaram|3/4 BHK premium gated|8,972-15,014 | avg 11,993 INR/sqft|Project-level units not public|N.A.|MagicBricks Sarjapur Road
Ambalipura-Sarjapur Road|Ambalipura-Sarjapur ORR basket|Multiple developers|Ambalipura / Sarjapur-ORR junction|3/4 BHK premium gated|9,031-14,740 | avg 11,885 INR/sqft|Project-level units not public|N.A.|MagicBricks Property Rates`;

const sq = (v) => {
  if (v == null || v === '' || v === 'N.A.') return 'NULL';
  const s = String(v);
  return `'${s.replace(/'/g, "''")}'`;
};
const num = (v) => {
  if (v == null || v === '' || v === 'N.A.') return 'NULL';
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? `${n}` : 'NULL';
};

// Parse "9,622-15,416 | avg 12,519 INR/sqft" → { low, high, avg }
const parseRate = (s) => {
  // Try the explicit "low-high | avg X" pattern first.
  const m = s.match(/([\d,]+)\s*-\s*([\d,]+).*?avg\s*([\d,]+)/i);
  if (m) {
    return {
      low: Number(m[1].replace(/,/g, '')),
      high: Number(m[2].replace(/,/g, '')),
      avg: Number(m[3].replace(/,/g, '')),
    };
  }
  // Fallback: just a single number.
  const single = s.match(/([\d,]+)/);
  if (single) {
    const n = Number(single[1].replace(/,/g, ''));
    return { low: n, high: n, avg: n };
  }
  return { low: null, high: null, avg: null };
};

// Parse "1/2/3/4 BHK apartments; 4 BHK villas" → "1, 2, 3, 4 BHK"
const parseBhk = (s) => {
  const m = s.match(/([\d/]+)\s*BHK/);
  if (!m) return null;
  // Normalise "1/2/3/4" → "1,2,3,4 BHK"
  return m[1].replace(/\//g, ',') + ' BHK';
};

// Parse "2024 RERA phase / market basket" → 2024
const parseLaunchYear = (s) => {
  const m = s.match(/(20\d{2})/);
  return m ? Number(m[1]) : null;
};

// Parse Units/Scale field: "Birla Phase 4: 548 residences; Godrej Phase 1: 1,961 apartments"
// → sum if multiple "X units" tokens; else single number; else NULL.
const parseUnits = (s) => {
  if (!s || /not public|not fully public|N\.A\./i.test(s)) return null;
  // Take the first concrete number that looks like a unit count.
  const m = s.match(/([\d,]+)\s*(?:units|apartments|residences|villas)/i);
  if (m) return Number(m[1].replace(/,/g, ''));
  return null;
};

// Map developer string → clean canonical name (best-effort).
const cleanDeveloper = (s) => {
  if (!s || /multiple|mixed|boutique|local developers|secondary market/i.test(s)) {
    // Aggregate basket — leave NULL so the comps table doesn't pretend a
    // single developer authored the basket.
    return null;
  }
  return s.split(/[+;\/]/)[0].trim();
};

const rows = RAW.split('\n').map((line) => {
  const parts = line.split('|').map((s) => s.trim());
  return {
    micro_market: parts[0],
    project: parts[1],
    developer: parts[2],
    locality: parts[3],
    type_mix: parts[4],
    rate: parts[5],
    units: parts[6],
    launch: parts[7],
    source: parts[8],
  };
});

const out = [];
out.push(`-- 20260508_residential_apartment_baskets_q1_2026.sql`);
out.push(`-- ─────────────────────────────────────────────────────────────────`);
out.push(`-- Tier 1.1: load all 27 residential apartment locality baskets`);
out.push(`-- from GBA Comps Report Table 3 (Bengaluru_GBA_Micro_Market_Asset_`);
out.push(`-- Class_Comps_06May2026.docx) into the comps table.`);
out.push(`--`);
out.push(`-- These are LOCALITY-LEVEL "baskets" — each row represents the`);
out.push(`-- aggregate market signal for a micro-market's apartment stock,`);
out.push(`-- with rate range (low/high/avg) sourced from MagicBricks. Some`);
out.push(`-- rows are anchored by a flagship project (Prestige Park Grove,`);
out.push(`-- Brigade Insignia, Embassy Lake Terraces); others are pure`);
out.push(`-- aggregate baskets with NULL developer.`);
out.push(`--`);
out.push(`-- These complement (do NOT replace):`);
out.push(`--   • The April 2026 internal_benchmark seed (21 rows)`);
out.push(`--   • The Q1 2026 v0.2 premium-project comps (30 rows from PR #163)`);
out.push(`-- Tagged data_type='ipc_q1_2026_v0_2_locality_basket' so the`);
out.push(`-- existing data-type segmentation continues to work.`);
out.push(``);
out.push(`BEGIN;`);
out.push(``);
out.push(`INSERT INTO comps (`);
out.push(`  organization_id, project_name, developer, city, locality,`);
out.push(`  project_type, bhk_config, rate_per_sqft, rate_per_sqft_min,`);
out.push(`  rate_per_sqft_max, total_units, launch_year, source, source_url,`);
out.push(`  data_type, as_of_date, is_verified`);
out.push(`) VALUES`);

const inserts = rows.map((r) => {
  const rate = parseRate(r.rate);
  const bhk = parseBhk(r.type_mix);
  const launch = parseLaunchYear(r.launch);
  const units = parseUnits(r.units);
  const dev = cleanDeveloper(r.developer);
  return `  (${[
    `'${ORG_ID}'`,
    sq(r.project),
    dev ? sq(dev) : 'NULL',
    "'Bengaluru'",
    sq(r.locality),
    "'residential'",
    sq(bhk),
    num(rate.avg),
    num(rate.low),
    num(rate.high),
    num(units),
    launch != null ? `${launch}` : 'NULL',
    sq(r.source + '; Bengaluru/GBA Q1 2026 Comps Report Table 3'),
    "'https://www.magicbricks.com/Property-Rates-Trends/ALL-RESIDENTIAL-rates-in-Bangalore'",
    "'ipc_q1_2026_v0_2_locality_basket'",
    `'${AS_OF}'`,
    'TRUE',
  ].join(', ')})`;
});
out.push(inserts.join(',\n'));
out.push(`ON CONFLICT (project_name, city) DO NOTHING;`);
out.push(``);
out.push(`COMMIT;`);

console.log(out.join('\n'));
