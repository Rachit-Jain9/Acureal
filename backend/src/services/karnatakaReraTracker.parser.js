'use strict';

/**
 * Karnataka RERA portal HTML parser.
 *
 * Inputs: a page of HTML scraped from rera.karnataka.gov.in/viewAllProjects
 * Outputs: an array of normalised project rows ready for
 *          karnatakaReraTracker.service.upsertProject().
 *
 * **Tested against a synthetic fixture** in
 * `backend/tests/karnatakaReraTracker.parser.test.js`. The fixture mirrors
 * the publicly-documented column structure of the K-RERA portal listing —
 * once an operator captures a real rendered HTML sample, drop it into
 * `backend/scripts/k-rera-fixtures/` and the parser stays unchanged.
 *
 * Defensive: the K-RERA portal's column order has changed historically
 * (e.g. they added "Type of Project" between V1 and V2). The parser uses
 * a header-row lookup to map columns by NAME rather than by index, so a
 * portal reorder doesn't break it.
 *
 * No regex over HTML strings — uses cheerio for DOM-level parsing.
 */

const cheerio = require('cheerio');

// ─────────────────────────────────────────────────────────────────────────────
//  Header normalisation — maps the portal's header text (case + spacing
//  variants) to our internal column keys.
// ─────────────────────────────────────────────────────────────────────────────

const HEADER_MAP = new Map([
  ['registration no', 'rera_project_id'],
  ['registration number', 'rera_project_id'],
  ['project registration no', 'rera_project_id'],
  ['rera no', 'rera_project_id'],
  ['project name', 'project_name'],
  ['name of project', 'project_name'],
  ['promoter name', 'promoter_name'],
  ['promoter', 'promoter_name'],
  ['name of promoter', 'promoter_name'],
  ['city', 'city'],
  ['district', 'district'],
  ['locality', 'locality_text'],
  ['location', 'locality_text'],
  ['area', 'locality_text'],
  ['project type', 'asset_class_raw'],
  ['type of project', 'asset_class_raw'],
  ['project category', 'asset_class_raw'],
  ['registration date', 'registration_date_raw'],
  ['date of registration', 'registration_date_raw'],
  ['proposed completion date', 'proposed_completion_raw'],
  ['proposed completion', 'proposed_completion_raw'],
  ['completion date', 'actual_completion_raw'],
  ['status', 'status_raw'],
  ['project status', 'status_raw'],
  ['total units', 'total_units_raw'],
  ['number of apartments', 'total_units_raw'],
  ['no of apartments', 'total_units_raw'],
  ['total area', 'total_saleable_sqft_raw'],
  ['total saleable area', 'total_saleable_sqft_raw'],
  ['carpet area', 'total_carpet_area_sqft_raw'],
]);

const normaliseHeader = (raw) =>
  String(raw || '').trim().toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ');

// ─────────────────────────────────────────────────────────────────────────────
//  Field normalisers — convert portal raw text into typed values.
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_TYPE_TO_ASSET_CLASS = {
  residential: 'residential_apartments',
  apartment: 'residential_apartments',
  group_housing: 'residential_apartments',
  group_housing_residential: 'residential_apartments',
  villa: 'villas',
  villas: 'villas',
  plotted: 'plotted_development',
  plotted_development: 'plotted_development',
  layout: 'plotted_development',
  commercial: 'commercial_office',
  commercial_office: 'commercial_office',
  office: 'commercial_office',
  retail: 'retail',
  mall: 'retail',
  industrial: 'industrial_warehousing',
  warehousing: 'industrial_warehousing',
  warehouse: 'industrial_warehousing',
  logistics: 'industrial_warehousing',
  hotel: 'hospitality',
  hospitality: 'hospitality',
  mixed_use: 'mixed_use',
  mixed: 'mixed_use',
};

const normaliseAssetClass = (raw) => {
  if (!raw) return null;
  const key = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, '_')
    .replace(/^_|_$/g, '');
  return PROJECT_TYPE_TO_ASSET_CLASS[key] || null;
};

const STATUS_NORMAL_MAP = {
  registered: 'registered',
  active: 'registered',
  ongoing: 'registered',
  'registration valid': 'registered',
  extended: 'extended',
  'extension granted': 'extended',
  completed: 'completed',
  closed: 'completed',
  lapsed: 'lapsed',
  expired: 'lapsed',
  revoked: 'revoked',
  withdrawn: 'withdrawn',
  rejected: 'revoked',
};

const normaliseStatus = (raw) => {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  return STATUS_NORMAL_MAP[key] || null;
};

const PROMOTER_ENTITY_MAP = {
  individual: 'individual',
  partnership: 'partnership',
  llp: 'llp',
  'limited liability partnership': 'llp',
  'private limited': 'private_limited',
  'private limited company': 'private_limited',
  'private limited co': 'private_limited',
  'pvt ltd': 'private_limited',
  'pvt. ltd.': 'private_limited',
  'public limited': 'public_limited',
  'public limited company': 'public_limited',
  ltd: 'public_limited',
  trust: 'trust',
  society: 'trust',
  cooperative: 'trust',
  // Fallback: bare "Limited" suffix in Indian corporate naming convention
  // implies a publicly listed company (Reliance Industries Limited, Prestige
  // Estates Projects Limited). MUST come after "private limited" and
  // "public limited" so the more-specific matches win in iteration order.
  limited: 'public_limited',
};

const inferPromoterEntityType = (promoterName) => {
  if (!promoterName) return null;
  const low = String(promoterName).toLowerCase();
  for (const [needle, type] of Object.entries(PROMOTER_ENTITY_MAP)) {
    if (low.includes(needle)) return type;
  }
  return null;
};

const parseIntegerLoose = (raw) => {
  if (raw == null) return null;
  const m = String(raw).replace(/,/g, '').match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
};

const parseFloatLoose = (raw) => {
  if (raw == null) return null;
  const m = String(raw).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

// K-RERA uses several date formats: DD/MM/YYYY, DD-MM-YYYY, "12 Jan 2024".
// Returns ISO date string (YYYY-MM-DD) or null.
const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const parseDateLoose = (raw) => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // DD/MM/YYYY or DD-MM-YYYY
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  // DD MMM YYYY
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) return `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
//  Public parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a page of K-RERA portal HTML and return an array of project rows.
 * Always returns an array — empty when the HTML carries no table.
 */
const parseListingPage = (html, { sourceUrl = null } = {}) => {
  if (!html || typeof html !== 'string') return [];
  const $ = cheerio.load(html);
  const out = [];

  // K-RERA portal renders a <table> with thead + tbody. The header text is
  // in the first row — we read it and build a column-index map keyed by our
  // internal field names.
  $('table').each((_, table) => {
    const headerCells = $(table).find('thead th, thead td, tr:first-child th, tr:first-child td');
    if (headerCells.length === 0) return;
    const colIndex = new Map(); // internal_key → 0-based column index
    headerCells.each((idx, cell) => {
      const normalised = normaliseHeader($(cell).text());
      const key = HEADER_MAP.get(normalised);
      if (key && !colIndex.has(key)) colIndex.set(key, idx);
    });
    // Bail out if we didn't see at least a rera_project_id column — this
    // table is something else (a sidebar, a nav).
    if (!colIndex.has('rera_project_id')) return;

    const rows = $(table).find('tbody tr');
    rows.each((_rIdx, row) => {
      const cells = $(row).find('td');
      if (cells.length === 0) return;
      const cellText = (key) => {
        const i = colIndex.get(key);
        if (i == null) return null;
        return $(cells[i]).text().trim() || null;
      };
      const reraId = cellText('rera_project_id');
      if (!reraId) return; // skip rows without an ID (footers, summary rows)
      const promoterName = cellText('promoter_name');
      const row_out = {
        rera_project_id: reraId,
        project_name: cellText('project_name'),
        promoter_name: promoterName,
        promoter_entity_type: inferPromoterEntityType(promoterName),
        city: cellText('city'),
        district: cellText('district'),
        locality_text: cellText('locality_text'),
        locality_code: null, // mapped to bengaluru_micro_markets by the cron, not here
        asset_class: normaliseAssetClass(cellText('asset_class_raw')),
        total_units: parseIntegerLoose(cellText('total_units_raw')),
        total_saleable_sqft: parseFloatLoose(cellText('total_saleable_sqft_raw')),
        total_carpet_area_sqft: parseFloatLoose(cellText('total_carpet_area_sqft_raw')),
        registration_date: parseDateLoose(cellText('registration_date_raw')),
        proposed_completion: parseDateLoose(cellText('proposed_completion_raw')),
        actual_completion: parseDateLoose(cellText('actual_completion_raw')),
        status: normaliseStatus(cellText('status_raw')),
        source_url: sourceUrl,
        raw_payload: {
          // Preserve the row exactly so a parser improvement can re-extract
          // without re-scraping. Lightweight — only the cell texts.
          cells: cells.map((__, c) => $(c).text().trim()).get(),
          headers: Array.from(colIndex.keys()),
        },
      };
      out.push(row_out);
    });
  });

  return out;
};

module.exports = {
  parseListingPage,
  // Exported for unit tests.
  normaliseHeader,
  normaliseAssetClass,
  normaliseStatus,
  inferPromoterEntityType,
  parseIntegerLoose,
  parseFloatLoose,
  parseDateLoose,
  HEADER_MAP,
  PROJECT_TYPE_TO_ASSET_CLASS,
};
