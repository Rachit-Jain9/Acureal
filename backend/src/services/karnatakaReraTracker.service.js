'use strict';

/**
 * Karnataka RERA Tracker — Phase 1 / Pillar 6.
 *
 * Read API + UPSERT writer over the three K-RERA mirror tables shipped in
 * migration 20260617:
 *
 *   • karnataka_rera_projects
 *   • karnataka_rera_quarterly_filings
 *   • karnataka_rera_promoter_index   (view; computed, not stored)
 *
 * **MVP scope honesty (CLAUDE.md "no fake connectivity"):** the upstream
 * portal (rera.karnataka.gov.in/viewAllProjects) is JS-rendered. A pure
 * `axios + cheerio` fetcher is shipped here for the static-table HTML
 * shape, but ACTIVATING the cron requires either:
 *
 *   (a) operator-provided sample HTML (paste a single rendered page into
 *       `backend/scripts/k-rera-fixtures/`) — parser is already tested
 *       against that shape via the parser unit tests; OR
 *   (b) a one-time Puppeteer / Playwright pull (heavyweight; deferred
 *       until the operator decides to pay for Actowiz or run a worker).
 *
 * Until (a) or (b) lands, the parser + service + read API ship inert —
 * tables remain empty; PromoterProfileCard and downstream Best Use
 * Simulator fall back to "no K-RERA data yet" empty states. This is the
 * right posture per CLAUDE.md: no fake connectivity; engineering is real,
 * data ingestion is honestly gated on an operator action.
 *
 * What IS shippable right now (this PR):
 *   • Schema applied → all three tables RLS-on, ready for inserts.
 *   • Parser unit tests with a synthetic fixture proving the column
 *     mapping is right.
 *   • UPSERT writer ready (idempotent; safe for re-runs).
 *   • Read API ready — getProjectsByLocality, getPromoterStats, etc.
 *
 * What lands in P1-PR6:
 *   • Fuzzy-match (trigram + Levenshtein) of deal promoter names against
 *     the promoter_index view.
 *   • Wire into PromoterProfileCard so K-RERA delivery-delay flows into
 *     the existing posture computation.
 */

const { query } = require('../config/database');
const log = require('../lib/logger').child({ module: 'karnatakaReraTracker' });

const PG_UNDEFINED_TABLE = '42P01';
const isMissingTable = (err) => Boolean(err) && err.code === PG_UNDEFINED_TABLE;

// ─────────────────────────────────────────────────────────────────────────────
//  Read API — used by PromoterProfileCard, Best Use Simulator, MicroMarketBriefing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Projects in a Bengaluru micro-market, optionally filtered by asset class +
 * status. Used by the Best Use Simulator's "supply pipeline" signal (Pillar 2)
 * and by the MicroMarketBriefing panel's "X registered projects in this
 * locality" line.
 */
const getProjectsByLocality = async (localityCode, { assetClass = null, statusIn = null, limit = 50 } = {}) => {
  if (!localityCode) return [];
  try {
    const params = [localityCode];
    const conditions = ['locality_code = $1'];
    if (assetClass) {
      params.push(assetClass);
      conditions.push(`asset_class = $${params.length}`);
    }
    if (Array.isArray(statusIn) && statusIn.length > 0) {
      params.push(statusIn);
      conditions.push(`status = ANY($${params.length}::text[])`);
    }
    params.push(limit);
    const result = await query(
      `SELECT rera_project_id, project_name, promoter_name, asset_class, status,
              registration_date, proposed_completion, actual_completion, total_units,
              total_saleable_sqft, locality_text, last_seen_at
         FROM regulatory_data.karnataka_rera_projects
        WHERE ${conditions.join(' AND ')}
        ORDER BY registration_date DESC NULLS LAST
        LIMIT $${params.length}`,
      params,
    );
    return result.rows;
  } catch (err) {
    if (isMissingTable(err)) return [];
    log.warn('getProjectsByLocality_failed', { error: err.message, locality_code: localityCode });
    return [];
  }
};

/**
 * Aggregate stats for a single promoter (or a fuzzy-match candidate).
 * Returns the promoter_index view row keyed by exact promoter_name.
 */
const getPromoterStats = async (promoterName) => {
  if (!promoterName) return null;
  try {
    const result = await query(
      `SELECT promoter_name, total_projects, completed_projects, ongoing_projects,
              lapsed_projects, delivered_on_time, avg_delivery_delay_months,
              earliest_registration, latest_registration
         FROM regulatory_data.karnataka_rera_promoter_index
        WHERE promoter_name = $1
        LIMIT 1`,
      [promoterName],
    );
    return result.rows[0] || null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    log.warn('getPromoterStats_failed', { error: err.message });
    return null;
  }
};

/**
 * Trigram-similar promoter candidates — for the fuzzy-match flow (P1-PR6).
 * Returns the top-N candidates by similarity threshold; UI surfaces them
 * for operator confirmation before linking a deal's promoter to the index.
 */
const findPromoterCandidates = async (rawName, { limit = 5, minSimilarity = 0.4 } = {}) => {
  if (!rawName || rawName.trim().length === 0) return [];
  try {
    const result = await query(
      `SELECT DISTINCT promoter_name,
              similarity(lower(promoter_name), lower($1)) AS sim_score
         FROM regulatory_data.karnataka_rera_projects
        WHERE promoter_name IS NOT NULL
          AND similarity(lower(promoter_name), lower($1)) >= $2
        ORDER BY sim_score DESC, promoter_name
        LIMIT $3`,
      [rawName, minSimilarity, limit],
    );
    return result.rows;
  } catch (err) {
    if (isMissingTable(err)) return [];
    if (err.message && err.message.includes('similarity')) {
      // pg_trgm not loaded — surface a clear log and return empty.
      log.warn('findPromoterCandidates_pg_trgm_missing');
      return [];
    }
    log.warn('findPromoterCandidates_failed', { error: err.message });
    return [];
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  Write API — UPSERT a parsed project (called by the scraper cron)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Idempotent UPSERT keyed on rera_project_id. The full raw_payload is
 * preserved on every run so we can re-parse historical fixtures without
 * re-scraping if the parser improves.
 */
const upsertProject = async (project, { scrapeRunId = null } = {}) => {
  if (!project || !project.rera_project_id) return null;
  try {
    const result = await query(
      `INSERT INTO regulatory_data.karnataka_rera_projects
         (rera_project_id, project_name, promoter_name, promoter_entity_type,
          city, district, locality_text, locality_code, asset_class,
          total_units, total_carpet_area_sqft, total_saleable_sqft,
          registration_date, proposed_completion, actual_completion, status,
          source_url, raw_payload, scrape_run_id, last_seen_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, NOW(), NOW())
       ON CONFLICT (rera_project_id) DO UPDATE
         SET project_name = EXCLUDED.project_name,
             promoter_name = EXCLUDED.promoter_name,
             promoter_entity_type = EXCLUDED.promoter_entity_type,
             city = EXCLUDED.city,
             district = EXCLUDED.district,
             locality_text = EXCLUDED.locality_text,
             locality_code = EXCLUDED.locality_code,
             asset_class = EXCLUDED.asset_class,
             total_units = EXCLUDED.total_units,
             total_carpet_area_sqft = EXCLUDED.total_carpet_area_sqft,
             total_saleable_sqft = EXCLUDED.total_saleable_sqft,
             registration_date = EXCLUDED.registration_date,
             proposed_completion = EXCLUDED.proposed_completion,
             actual_completion = EXCLUDED.actual_completion,
             status = EXCLUDED.status,
             source_url = EXCLUDED.source_url,
             raw_payload = EXCLUDED.raw_payload,
             scrape_run_id = EXCLUDED.scrape_run_id,
             last_seen_at = NOW(),
             updated_at = NOW()
       RETURNING rera_project_id`,
      [
        project.rera_project_id,
        project.project_name || null,
        project.promoter_name || null,
        project.promoter_entity_type || null,
        project.city || null,
        project.district || null,
        project.locality_text || null,
        project.locality_code || null,
        project.asset_class || null,
        project.total_units ?? null,
        project.total_carpet_area_sqft ?? null,
        project.total_saleable_sqft ?? null,
        project.registration_date || null,
        project.proposed_completion || null,
        project.actual_completion || null,
        project.status || null,
        project.source_url || null,
        JSON.stringify(project.raw_payload || {}),
        scrapeRunId,
      ],
    );
    return result.rows[0]?.rera_project_id || null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    log.warn('upsertProject_failed', { error: err.message, project_id: project.rera_project_id });
    return null;
  }
};

const upsertQuarterlyFiling = async (filing, { scrapeRunId = null } = {}) => {
  if (!filing || !filing.rera_project_id || !filing.quarter_label) return null;
  try {
    const result = await query(
      `INSERT INTO regulatory_data.karnataka_rera_quarterly_filings
         (rera_project_id, quarter_label, filing_date, status, form_type,
          physical_progress_pct, financial_progress_pct, proposed_completion_in_filing,
          source_url, raw_payload, scrape_run_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
       ON CONFLICT (rera_project_id, quarter_label, form_type) DO UPDATE
         SET filing_date = EXCLUDED.filing_date,
             status = EXCLUDED.status,
             physical_progress_pct = EXCLUDED.physical_progress_pct,
             financial_progress_pct = EXCLUDED.financial_progress_pct,
             proposed_completion_in_filing = EXCLUDED.proposed_completion_in_filing,
             source_url = EXCLUDED.source_url,
             raw_payload = EXCLUDED.raw_payload,
             scrape_run_id = EXCLUDED.scrape_run_id
       RETURNING id`,
      [
        filing.rera_project_id,
        filing.quarter_label,
        filing.filing_date || null,
        filing.status || null,
        filing.form_type || null,
        filing.physical_progress_pct ?? null,
        filing.financial_progress_pct ?? null,
        filing.proposed_completion_in_filing || null,
        filing.source_url || null,
        JSON.stringify(filing.raw_payload || {}),
        scrapeRunId,
      ],
    );
    return result.rows[0]?.id || null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    log.warn('upsertQuarterlyFiling_failed', { error: err.message });
    return null;
  }
};

module.exports = {
  getProjectsByLocality,
  getPromoterStats,
  findPromoterCandidates,
  upsertProject,
  upsertQuarterlyFiling,
};
