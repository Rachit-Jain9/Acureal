'use strict';

/**
 * Parcel intelligence admin — status + schema readiness + AI usage rollup.
 *
 * The dashboard endpoint `/api/parcel-intelligence/status` is the single
 * caller for `getStatus`. It composes:
 *   - schema readiness probe (which migrations are applied)
 *   - review-queue counts by status across the 4 review types
 *   - AI usage last-7-day rollup (from ai_call_logs)
 *   - red-flag rules registry (from parcelRedFlags.engine)
 *   - provider availability (Gemini / Claude / Landeed / KGIS)
 *
 * All read-only. No transactions. No DB writes.
 *
 * Extracted from parcelIntelligenceAdmin.service.js as part of the Bet 3
 * decomposition.
 */

const { query } = require('../../config/database');
const { getProviderAvailability } = require('../ai/providerRegistry');
const { listRegistryDescriptors: listRedFlagRuleDescriptors } = require('../../engines/parcelRedFlags.engine');
const landeedAdapter = require('../adapters/landeed.adapter');

// ── Schema readiness specs ─────────────────────────────────────────────────

const REQUIRED_SCHEMA_RELATIONS = [
  ['properties', 'Properties table'],
  ['deals', 'Deals table'],
  ['documents', 'Documents table'],
  ['activities', 'Activities table'],
  ['evidence_links', 'Evidence links'],
  ['regulatory_data.master_plan_zones', 'Master plan zones'],
  ['regulatory_data.evidence_sources', 'Evidence sources'],
  ['regulatory_data.evidence_facts', 'Evidence facts'],
  ['regulatory_data.guidance_values', 'Guidance values'],
  ['regulatory_data.far_rules', 'FAR rules'],
  ['regulatory_data.kgis_cache', 'K-GIS cache'],
  ['regulatory_data.parcel_intelligence_snapshots', 'Parcel intelligence snapshots'],
];

const REQUIRED_SCHEMA_COLUMNS = [
  ['public', 'properties', 'zone_id', 'Assigned planning zone'],
  ['public', 'properties', 'survey_number', 'Survey number input'],
  ['public', 'properties', 'pid', 'PID input'],
  ['public', 'properties', 'khata_no', 'Khata input'],
  ['public', 'properties', 'owner_name', 'Owner input'],
  ['public', 'properties', 'land_area_sqft', 'Land area sqft'],
  ['public', 'properties', 'land_area_input_value', 'Land area source value'],
  ['public', 'properties', 'land_area_input_unit', 'Land area source unit'],
  ['public', 'properties', 'road_width_mtrs', 'Road width input'],
  ['public', 'properties', 'lat', 'Latitude'],
  ['public', 'properties', 'lng', 'Longitude'],
  ['regulatory_data', 'evidence_sources', 'document_id', 'Evidence source document link'],
  ['regulatory_data', 'evidence_sources', 'source_kind', 'Evidence source kind'],
  ['regulatory_data', 'evidence_sources', 'review_status', 'Evidence source review status'],
  ['regulatory_data', 'evidence_sources', 'approved_facts', 'Approved fact payload'],
  ['regulatory_data', 'evidence_facts', 'source_id', 'Evidence fact source link'],
  ['regulatory_data', 'evidence_facts', 'fact_type', 'Evidence fact type'],
  ['regulatory_data', 'evidence_facts', 'fact_key', 'Evidence fact key'],
  ['regulatory_data', 'evidence_facts', 'fact_value', 'Evidence fact value'],
  ['regulatory_data', 'evidence_facts', 'review_status', 'Evidence fact review status'],
  ['regulatory_data', 'evidence_facts', 'reviewed_by', 'Evidence fact reviewer'],
  ['regulatory_data', 'evidence_facts', 'reviewed_at', 'Evidence fact review time'],
  ['regulatory_data', 'guidance_values', 'locality', 'Guidance locality'],
  ['regulatory_data', 'guidance_values', 'road_name', 'Guidance road'],
  ['regulatory_data', 'guidance_values', 'land_use_type', 'Guidance land use'],
  ['regulatory_data', 'guidance_values', 'value_inr_per_sqft', 'Guidance INR per sqft'],
  ['regulatory_data', 'guidance_values', 'review_status', 'Guidance review status'],
  ['regulatory_data', 'far_rules', 'zone_code', 'FAR zone code'],
  ['regulatory_data', 'far_rules', 'land_use_family', 'FAR land use family'],
  ['regulatory_data', 'far_rules', 'base_far', 'Base FAR'],
  ['regulatory_data', 'far_rules', 'max_far', 'Max FAR'],
  ['regulatory_data', 'far_rules', 'review_status', 'FAR review status'],
  ['regulatory_data', 'parcel_intelligence_snapshots', 'property_id', 'Snapshot property link'],
  ['regulatory_data', 'parcel_intelligence_snapshots', 'output_json', 'Snapshot output JSON'],
  ['public', 'evidence_links', 'owner_kind', 'Evidence link owner type'],
  ['public', 'evidence_links', 'owner_id', 'Evidence link owner id'],
  ['public', 'evidence_links', 'link_kind', 'Evidence link kind'],
];

// ── Internal helpers ───────────────────────────────────────────────────────

const countByStatus = async (tableName) => {
  const result = await query(
    `SELECT review_status, COUNT(*)::int AS count
     FROM ${tableName}
     GROUP BY review_status`
  );

  return result.rows.reduce((acc, row) => {
    acc[row.review_status || 'unknown'] = Number(row.count || 0);
    return acc;
  }, {});
};

const countScalar = async (sql, params = []) => {
  const result = await query(sql, params);
  return Number(result.rows[0]?.count || 0);
};

const sqlLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;

const readinessValuesSql = (rows) => rows
  .map((row) => `(${row.map(sqlLiteral).join(', ')}, 'critical')`)
  .join(',\n       ');

const summarizeSchemaReadiness = ({ relationRows = [], columnRows = [] }) => {
  const relationChecks = relationRows.map((row) => ({
    type: 'relation',
    name: row.name,
    label: row.label,
    severity: row.severity || 'critical',
    present: row.present === true,
  }));
  const columnChecks = columnRows.map((row) => ({
    type: 'column',
    name: row.name,
    label: row.label,
    severity: row.severity || 'critical',
    present: row.present === true,
  }));
  const checks = [...relationChecks, ...columnChecks];
  const missing = checks.filter((check) => !check.present);
  const missingCritical = missing.filter((check) => check.severity === 'critical');
  const status = missingCritical.length ? 'action_required' : 'ready';

  return {
    status,
    message: status === 'ready'
      ? 'Required parcel intelligence schema objects are present.'
      : 'Parcel intelligence schema is incomplete. Apply the missing migrations before relying on review operations.',
    checked_at: new Date().toISOString(),
    summary: {
      required_relations: relationChecks.length,
      required_columns: columnChecks.length,
      missing_critical: missingCritical.length,
      missing_warning: missing.length - missingCritical.length,
    },
    missing,
    checks: {
      relations: relationChecks,
      columns: columnChecks,
    },
  };
};

const emptyReviewQueueStatus = () => ({
  pending_or_needs_review: 0,
  evidence_sources: {},
  evidence_facts: {},
  guidance_values: {},
  far_rules: {},
});

const buildProviderStatus = (providerAvailability) => ({
  landeed: landeedAdapter.getStatus(),
  igr_pdf: {
    provider: 'igr_pdf',
    status: providerAvailability.gemini ? 'parser_available' : 'not_configured',
    message: providerAvailability.gemini
      ? 'IGR PDF text parsing can propose guidance rows, but human approval is required before use.'
      : 'Set GEMINI_API_KEY to enable PDF extraction into the review queue.',
  },
  kgis: {
    provider: 'kgis',
    status: process.env.KGIS_BASE_URL ? 'configured' : 'default_endpoint',
    message: 'K-GIS hierarchy/survey/geometry lookup is reference-only and cached per property.',
  },
});

// ── Public API ─────────────────────────────────────────────────────────────

const getSchemaReadiness = async () => {
  try {
    const relationResult = await query(
      `WITH required(name, label, severity) AS (
         VALUES
       ${readinessValuesSql(REQUIRED_SCHEMA_RELATIONS)}
       )
       SELECT
         name,
         label,
         severity,
         to_regclass(name) IS NOT NULL AS present
       FROM required
       ORDER BY name`
    );

    const columnResult = await query(
      `WITH required(schema_name, table_name, column_name, label, severity) AS (
         VALUES
       ${readinessValuesSql(REQUIRED_SCHEMA_COLUMNS)}
       )
       SELECT
         schema_name || '.' || table_name || '.' || column_name AS name,
         label,
         severity,
         EXISTS (
           SELECT 1
           FROM information_schema.columns c
           WHERE c.table_schema = required.schema_name
             AND c.table_name = required.table_name
             AND c.column_name = required.column_name
         ) AS present
       FROM required
       ORDER BY schema_name, table_name, column_name`
    );

    return summarizeSchemaReadiness({
      relationRows: relationResult.rows,
      columnRows: columnResult.rows,
    });
  } catch (error) {
    return {
      status: 'unknown',
      message: error.message || 'Could not verify parcel intelligence schema readiness.',
      checked_at: new Date().toISOString(),
      summary: {
        required_relations: REQUIRED_SCHEMA_RELATIONS.length,
        required_columns: REQUIRED_SCHEMA_COLUMNS.length,
        missing_critical: null,
        missing_warning: null,
      },
      missing: [],
      checks: { relations: [], columns: [] },
    };
  }
};

// Last-7-day Gemini/Claude/OpenAI usage rollup. Returns a per-provider list
// (count, p50/p95 latency, total cost, failure rate) plus a totals row.
// Failures gracefully — if ai_call_logs doesn't exist yet, return null.
const getAiUsageLast7Days = async () => {
  try {
    const result = await query(
      `SELECT
         provider,
         COUNT(*)::int AS calls,
         COUNT(*) FILTER (WHERE status <> 'success')::int AS failures,
         ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms))::int AS p50_latency_ms,
         ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms))::int AS p95_latency_ms,
         COALESCE(SUM(cost_usd), 0)::float AS total_cost_usd,
         COALESCE(SUM(total_tokens), 0)::int AS total_tokens
       FROM ai_call_logs
       WHERE created_at >= NOW() - INTERVAL '7 days'
       GROUP BY provider
       ORDER BY calls DESC`
    );

    const providers = result.rows.map((row) => ({
      provider: row.provider,
      calls: row.calls,
      failures: row.failures,
      failure_rate: row.calls > 0 ? Math.round((row.failures / row.calls) * 1000) / 1000 : 0,
      p50_latency_ms: row.p50_latency_ms,
      p95_latency_ms: row.p95_latency_ms,
      total_cost_usd: Math.round(row.total_cost_usd * 1000000) / 1000000,
      total_tokens: row.total_tokens,
    }));

    const totals = providers.reduce(
      (acc, p) => ({
        calls: acc.calls + p.calls,
        failures: acc.failures + p.failures,
        total_cost_usd: acc.total_cost_usd + p.total_cost_usd,
        total_tokens: acc.total_tokens + p.total_tokens,
      }),
      { calls: 0, failures: 0, total_cost_usd: 0, total_tokens: 0 }
    );

    return {
      window: 'last_7_days',
      providers,
      totals: {
        ...totals,
        failure_rate: totals.calls > 0 ? Math.round((totals.failures / totals.calls) * 1000) / 1000 : 0,
        total_cost_usd: Math.round(totals.total_cost_usd * 1000000) / 1000000,
      },
    };
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('AI usage rollup skipped:', error.message);
    }
    return null;
  }
};

const getStatus = async () => {
  const providerAvailability = getProviderAvailability();
  const schema = await getSchemaReadiness();
  const providers = buildProviderStatus(providerAvailability);

  if (schema.status !== 'ready') {
    return {
      degraded: true,
      schema,
      review_queue: emptyReviewQueueStatus(),
      providers,
      cache: {
        kgis_rows: 0,
        kgis_fresh_rows: 0,
        latest_snapshot_at: null,
        latest_evidence_source_at: null,
      },
      ai_usage: null,
      red_flag_rules: listRedFlagRuleDescriptors(),
    };
  }

  const [
    evidenceSources,
    evidenceFacts,
    guidanceValues,
    farRules,
    pendingQueueCount,
    kgisCacheCount,
    kgisFreshCount,
    latestSnapshot,
    latestEvidence,
    aiUsage,
  ] = await Promise.all([
    countByStatus('regulatory_data.evidence_sources'),
    countByStatus('regulatory_data.evidence_facts'),
    countByStatus('regulatory_data.guidance_values'),
    countByStatus('regulatory_data.far_rules'),
    countScalar(
      `SELECT (
        (SELECT COUNT(*) FROM regulatory_data.evidence_sources WHERE review_status IN ('pending', 'needs_review')) +
        (SELECT COUNT(*) FROM regulatory_data.evidence_facts WHERE review_status IN ('pending', 'needs_review')) +
        (SELECT COUNT(*) FROM regulatory_data.guidance_values WHERE review_status IN ('pending', 'needs_review')) +
        (SELECT COUNT(*) FROM regulatory_data.far_rules WHERE review_status IN ('pending', 'needs_review'))
      )::int AS count`
    ),
    countScalar('SELECT COUNT(*) FROM regulatory_data.kgis_cache'),
    countScalar(
      `SELECT COUNT(*)
       FROM regulatory_data.kgis_cache
       WHERE expires_at IS NULL OR expires_at > NOW()`
    ),
    query(
      `SELECT generated_at
       FROM regulatory_data.parcel_intelligence_snapshots
       ORDER BY generated_at DESC
       LIMIT 1`
    ),
    query(
      `SELECT created_at
       FROM regulatory_data.evidence_sources
       ORDER BY created_at DESC
       LIMIT 1`
    ),
    getAiUsageLast7Days(),
  ]);

  return {
    degraded: false,
    schema,
    review_queue: {
      pending_or_needs_review: pendingQueueCount,
      evidence_sources: evidenceSources,
      evidence_facts: evidenceFacts,
      guidance_values: guidanceValues,
      far_rules: farRules,
    },
    providers,
    cache: {
      kgis_rows: kgisCacheCount,
      kgis_fresh_rows: kgisFreshCount,
      latest_snapshot_at: latestSnapshot.rows[0]?.generated_at || null,
      latest_evidence_source_at: latestEvidence.rows[0]?.created_at || null,
    },
    ai_usage: aiUsage,
    red_flag_rules: listRedFlagRuleDescriptors(),
  };
};

module.exports = {
  getStatus,
  getSchemaReadiness,
  getAiUsageLast7Days,
};
