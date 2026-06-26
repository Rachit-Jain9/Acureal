const { query } = require('../config/database');
const { buildVisibleDealCondition } = require('../utils/dealVisibility');
const { inferAssetClass } = require('../utils/assetClass');
const { percentile } = require('../utils/percentile');
const { getCompsNearLocation, assetClassToProjectType } = require('./comps.service');
const { generateDealInsights, generateRiskNarrative, generateSensitivityNarrative, generateDocumentInsights } = require('./export.insights.service');
// PR-NX67 (2026-05-19) — AI market-context augment layer. Generates 5
// market-context sections (Why This Area, Demographics, Job Growth,
// Social Infrastructure, Supply & Demand Pipeline) from Claude's general
// knowledge when REDIP's structured payload is empty. Each section carries
// an explicit "AI-generated from general knowledge — verify before IC"
// disclaimer per CLAUDE.md.
const aiMarketContext = require('./aiMarketContext.service');
// PR-NX69 (2026-05-19) — BETA per-user quota for the AI augment layer.
// Free tier: 1 augmented report per user. Admin/owner: unlimited.
const aiAugmentEntitlement = require('./aiAugmentEntitlement.service');
const { enrichPdWithDemographics } = require('./parcelContext.service');
const { buildReadinessSummary, deriveNextSteps } = require('./dealReadiness.service');
const masterplanService = require('./masterplan.service');
// PR-B (2026-05-25) — attach the latest Recommendation Engine run + Deal
// Doctor view to the export context so the DOCX builder can render both
// sections. Persistence is migration-tolerant; pre-deploy returns nulls.
const recommendationPersistence = require('./recommendation/persistence');
const recommendationEngine = require('./recommendation');
const dealDoctor = require('./recommendation/dealDoctor');
const { summariseRecommendations, summariseFindings } = require('./recommendation/summarise');

const OPEN_RISK_STATUSES = new Set(['open', 'flagged']);
const CLOSED_DD_STATUSES = new Set(['completed', 'not_applicable']);

const DEAL_EXPORT_SQL = `
  SELECT d.*,
    COALESCE(
      NULLIF(p.name, ''),
      NULLIF(p.address, ''),
      CONCAT(COALESCE(NULLIF(p.city, ''), 'Unknown city'), ' land opportunity')
    ) AS property_name,
    p.address AS property_address,
    p.city,
    p.state,
    NULL::text AS micro_market,
    p.pincode,
    p.land_area_sqft,
    p.land_area_acres,
    p.zoning,
    p.survey_number,
    p.owner_name,
    p.circle_rate_per_sqft,
    p.existing_fsi,
    p.permissible_fsi,
    p.road_width_mtrs,
    p.setback_details,
    p.ownership_type,
    p.encumbrance_status,
    p.notes AS property_notes,
    p.lat AS property_lat,
    p.lng AS property_lng,
    p.geocode_status,
    p.geocode_confidence,
    p.property_type,
    -- PR-NX41 (2026-05-18) — auto-derived planning-district code lets the
    -- DOCX Demographics section look up census + RMP facts. Set via
    -- PR #381's apply-auto-derived-context endpoint. NULL on:
    --   - non-Bengaluru deals (BBMP master plan only covers KA)
    --   - deals that haven't run the AutoFillParcelContextCard derive yet
    p.auto_derived_pd_code,
    p.auto_derived_ward_no,
    p.auto_derived_zone_code,
    u.name AS assigned_to_name,
    f.land_cost_cr,
    f.total_construction_cost_cr AS construction_cost_cr,
    f.approval_cost_cr,
    f.marketing_cost_cr,
    f.finance_cost_cr,
    f.gst_cost_cr,
    f.stamp_duty_cr,
    f.total_cost_cr,
    f.total_revenue_cr,
    f.gross_profit_cr,
    f.gross_margin_pct,
    f.irr_pct,
    f.npv_cr,
    f.equity_multiple,
    f.residual_land_value_cr,
    f.saleable_area_sqft,
    f.gross_area_sqft,
    f.carpet_area_sqft,
    f.super_builtup_area_sqft,
    f.selling_rate_per_sqft,
    f.construction_cost_per_sqft,
    f.fsi,
    f.loading_factor,
    f.plot_area_sqft,
    f.discount_rate_pct,
    f.project_duration_months,
    f.developer_margin_pct,
    f.developer_profit_cr,
    f.noi_cr,
    f.yield_on_cost_pct,
    f.exit_value_cr,
    f.entry_value_cr,
    f.dscr,
    f.stabilized_noi_cr,
    f.asset_class AS financial_asset_class,
    f.model_params,
    f.cash_flows,
    f.sensitivity_matrix
  FROM deals d
  LEFT JOIN properties p ON d.property_id = p.id
  LEFT JOIN users u ON d.assigned_to = u.id
  LEFT JOIN financials f ON d.id = f.deal_id
  WHERE d.id = $1
    AND ${buildVisibleDealCondition('d')}
`;

const num = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const round = (value, decimals = 2) => {
  const parsed = num(value);
  if (parsed === null) return null;
  const factor = 10 ** decimals;
  return Math.round(parsed * factor) / factor;
};

const parseMaybeJson = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const humanizeKey = (value) =>
  String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());

const normalizeCityVariants = (city) => {
  const normalized = String(city || '').trim().toLowerCase();
  if (!normalized) return [];
  if (normalized === 'bengaluru' || normalized === 'bangalore') {
    return ['bengaluru'];
  }
  return [normalized];
};

// Delegates to the canonical comps mapper so the result is always a VALID
// comps.project_type enum member. The previous bespoke map returned
// 'office'/'retail'/'industrial'/'hospitality' — none of which are enum
// members — so the nearby + city comp queries threw and were caught as
// "0 comps" for every commercial-family deal's export.
const mapAssetClassToCompType = (assetClass, propertyType) =>
  assetClassToProjectType(assetClass, propertyType);

const deriveBenchmarks = (comps) => {
  const rates = (Array.isArray(comps) ? comps : [])
    .map((comp) => num(comp.rate_per_sqft))
    .filter((value) => value && value > 0)
    .sort((a, b) => a - b);

  if (!rates.length) {
    return {
      available: false,
      count: 0,
      avg_rate_per_sqft: null,
      median_rate_per_sqft: null,
      min_rate_per_sqft: null,
      max_rate_per_sqft: null,
      p25_rate_per_sqft: null,
      p75_rate_per_sqft: null,
    };
  }

  const average = rates.reduce((sum, value) => sum + value, 0) / rates.length;

  return {
    available: true,
    count: rates.length,
    avg_rate_per_sqft: round(average, 0),
    median_rate_per_sqft: round(percentile(rates, 0.5), 0),
    min_rate_per_sqft: round(rates[0], 0),
    max_rate_per_sqft: round(rates[rates.length - 1], 0),
    p25_rate_per_sqft: round(percentile(rates, 0.25), 0),
    p75_rate_per_sqft: round(percentile(rates, 0.75), 0),
  };
};

const normalizeCashFlowRows = (rows, fallbackPrefix) => {
  if (!Array.isArray(rows)) return [];

  let cumulative = 0;
  return rows.map((row, index) => {
    const net = num(row?.net ?? row);
    cumulative += net || 0;

    return {
      quarter: num(row?.quarter),
      year: num(row?.year),
      label: row?.label || `${fallbackPrefix}${index + 1}`,
      startDate: row?.startDate || null,
      endDate: row?.endDate || null,
      net: round(net, 2) || 0,
      cumulative: round(cumulative, 2) || 0,
    };
  });
};

const buildYearlyFromQuarterly = (quarterly) => {
  if (!quarterly.length) return [];

  const buckets = new Map();
  quarterly.forEach((row, index) => {
    const year = row.year || Math.floor(index / 4) + 1;
    const existing = buckets.get(year) || {
      year,
      label: `Year ${year}`,
      startDate: row.startDate || null,
      endDate: row.endDate || null,
      net: 0,
    };
    existing.startDate = existing.startDate || row.startDate || null;
    existing.endDate = row.endDate || existing.endDate || null;
    existing.net += num(row.net) || 0;
    buckets.set(year, existing);
  });

  return normalizeCashFlowRows([...buckets.values()].sort((a, b) => a.year - b.year), 'Year ');
};

const summarizeCashFlows = (cashFlowsRaw) => {
  const cashFlows = parseMaybeJson(cashFlowsRaw) || {};
  const quarterly = normalizeCashFlowRows(
    Array.isArray(cashFlows.quarterly) ? cashFlows.quarterly : Array.isArray(cashFlows) ? cashFlows : [],
    'Quarter '
  );
  const yearly = normalizeCashFlowRows(
    Array.isArray(cashFlows.yearly) ? cashFlows.yearly : buildYearlyFromQuarterly(quarterly),
    'Year '
  );

  const sourceRows = quarterly.length ? quarterly : yearly;
  const totalInflow = sourceRows.filter((row) => row.net > 0).reduce((sum, row) => sum + row.net, 0);
  const totalOutflow = Math.abs(sourceRows.filter((row) => row.net < 0).reduce((sum, row) => sum + row.net, 0));
  const net = totalInflow - totalOutflow;
  const peakDeployment = Math.abs(Math.min(0, ...sourceRows.map((row) => row.cumulative || 0)));
  const firstPositivePeriod = sourceRows.find((row) => row.cumulative > 0);

  return {
    quarterly,
    yearly,
    summary: {
      totalInflow: round(cashFlows?.summary?.totalInflow ?? totalInflow, 2) || 0,
      totalOutflow: round(cashFlows?.summary?.totalOutflow ?? totalOutflow, 2) || 0,
      net: round(net, 2) || 0,
      peakDeployment: round(peakDeployment, 2) || 0,
      firstPositiveLabel: firstPositivePeriod?.label || null,
    },
  };
};

const normalizeSensitivityMatrix = (rawMatrix) => {
  const sensitivity = parseMaybeJson(rawMatrix) || {};
  return {
    variations: Array.isArray(sensitivity.variations) ? sensitivity.variations : [],
    sellingRates: Array.isArray(sensitivity.sellingRates) ? sensitivity.sellingRates : [],
    constructionCosts: Array.isArray(sensitivity.constructionCosts) ? sensitivity.constructionCosts : [],
    irrGrid: Array.isArray(sensitivity.irrGrid) ? sensitivity.irrGrid : [],
  };
};

const buildDynamicAssumptions = (inputs) =>
  Object.entries(inputs || {})
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value) && value !== '')
    .map(([key, value]) => ({
      key,
      label: humanizeKey(key),
      value,
    }));

const summarizeApprovals = (rows = []) => {
  const required = rows.filter((item) => item.is_required);
  const validated = required.filter(
    (item) => item.is_validated || ['validated', 'approved'].includes(item.status),
  );
  const pendingRequired = required.filter(
    (item) => !(item.is_validated || ['validated', 'approved'].includes(item.status)),
  );

  return {
    total: rows.length,
    required: required.length,
    validated: validated.length,
    pendingRequired: pendingRequired.length,
    available: rows.filter((item) => item.is_available).length,
    uploaded: rows.filter((item) => item.is_uploaded || item.document_id).length,
    inProgress: rows.filter((item) => item.status === 'in_progress').length,
    items: rows,
  };
};

const summarizeDocuments = (rows = []) => {
  const byCategory = rows.reduce((acc, row) => {
    const key = row.doc_category || 'other';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const imageLike = rows.filter((row) => {
    const fileType = String(row.file_type || '').toLowerCase();
    return fileType.startsWith('image/');
  });

  const planLike = rows.filter((row) =>
    /(plan|layout|site|drawing|elevation|parcel|survey)/i.test(
      `${row.name || ''} ${row.description || ''}`,
    ),
  );

  const mapLike = rows.filter((row) =>
    /(map|location|satellite|google|survey|parcel)/i.test(
      `${row.name || ''} ${row.description || ''}`,
    ),
  );

  return {
    total: rows.length,
    byCategory,
    imageCount: imageLike.length,
    planCount: planLike.length,
    mapCount: mapLike.length,
    visuals: {
      hasImages: imageLike.length > 0,
      hasPlans: planLike.length > 0,
      hasMaps: mapLike.length > 0,
    },
    featured: rows.slice(0, 8),
  };
};

const computeRecommendation = ({
  ddSummary,
  riskSummary,
  hasFinancialModel,
  irrPct,
  grossMarginPct,
  totalRevenueCr,
  totalCostCr,
  askPriceCr,
  residualLandValueCr,
}) => {
  const critical = Number(riskSummary.critical || 0);
  const high = Number(riskSummary.high || 0);
  const openDealBreakers = Number(ddSummary.open_deal_breakers || 0);
  const ddCompletionPct = Number(ddSummary.completion_pct || 0);
  const irr = num(irrPct);
  const grossMargin = num(grossMarginPct);
  const totalRevenue = num(totalRevenueCr);
  const totalCost = num(totalCostCr);
  const askPrice = num(askPriceCr);
  const residualLandValue = num(residualLandValueCr);
  const isValueDestructive =
    (irr !== null && irr < 0)
    || (grossMargin !== null && grossMargin < 0)
    || (totalRevenue !== null && totalCost !== null && totalRevenue < totalCost);

  if (critical > 0 || openDealBreakers > 0) {
    return {
      label: 'Requires Review',
      tone: 'negative',
      reason: 'Critical risk flags or unresolved deal-breaker diligence items remain open.',
    };
  }

  if (!hasFinancialModel) {
    return {
      label: 'Incomplete Underwriting',
      tone: 'caution',
      reason: 'Financial model outputs are missing, so the Investor-Grade view is not yet decision-ready.',
    };
  }

  if (isValueDestructive) {
    return {
      label: 'Reprice / Rework',
      tone: 'negative',
      reason: 'Current underwriting is value-destructive at the stored price and program assumptions, so pricing, cost, or product mix must be reset before the deal is advanced.',
    };
  }

  if (
    high >= 2
    || ddCompletionPct < 50
    || (askPrice !== null && residualLandValue !== null && askPrice > residualLandValue)
  ) {
    return {
      label: 'Proceed With Conditions',
      tone: 'caution',
      reason: 'The opportunity may be actionable, but diligence closure, pricing alignment, or risk load still needs tightening.',
    };
  }

  if ((irr || 0) >= 18 && (grossMargin || 0) >= 18) {
    return {
      label: 'Proceed',
      tone: 'positive',
      reason: 'Returns clear baseline investor thresholds and the current issue stack appears manageable.',
    };
  }

  return {
    label: 'Proceed With Conditions',
    tone: 'caution',
    reason: 'The current return profile is investable but not yet strong enough for a clean go-forward call.',
  };
};

const fetchCityComps = async ({ city, compType }) => {
  if (!city) return [];

  const params = [`%${city}%`];
  const conditions = ['city ILIKE $1'];
  if (compType) {
    params.push(compType);
    conditions.push(`project_type = $${params.length}`);
  }

  const result = await query(
    // Provenance columns (data_type / source_url / as_of_date / updated_at) feed
    // the per-row "Source · Verified · as of <date>" treatment in every export
    // format via utils/compProvenance.deriveCompProvenance — the CLAUDE.md hard
    // rule that comps must always surface source, freshness, and confidence.
    `SELECT project_name, developer, city, locality, project_type, bhk_config,
      rate_per_sqft, launch_year, possession_year, source, is_verified,
      data_type, source_url, as_of_date, updated_at
     FROM comps
     WHERE ${conditions.join(' AND ')}
     ORDER BY is_verified DESC, rate_per_sqft DESC NULLS LAST
     LIMIT 8`,
    params
  );

  return result.rows;
};

const fetchCityBenchmarks = async ({ city }) => {
  const cityVariants = normalizeCityVariants(city);
  if (!cityVariants.length) return [];

  const result = await query(
    `SELECT micro_market, avg_price_min_per_sqft, avg_price_max_per_sqft,
            yoy_growth_min_pct, yoy_growth_max_pct, anchor_hub, data_period, is_verified
     FROM micro_market_benchmarks
     WHERE LOWER(city) = ANY($1::text[])
     ORDER BY avg_price_max_per_sqft DESC NULLS LAST, micro_market ASC
     LIMIT 8`,
    [cityVariants],
  );

  return result.rows;
};

// PR-NX41 (2026-05-18) — Demographics enrichment for the DOCX export.
//
// PR #381 added `auto_derived_pd_code` to public.properties via the
// AutoFillParcelContextCard apply flow. PR A2 seeded the demographics
// (population_2011, area_ha, gross_density_pph, wards_in_pd,
// villages_count, notes) into regulatory_data.evidence_facts as a JSON
// array keyed by pd_code. Pre-NX41 the DOCX Demographics section never
// joined the two — every Bengaluru deal silently showed the "manual
// input required" placeholder.
//
// This helper:
//   1. Returns null fast when no auto_derived_pd_code is set
//      (non-Bengaluru deal, or derive flow hasn't been run yet).
//   2. Looks up the PD name from regulatory_data.planning_districts
//      so the section header reads "Yelahanka (PD-07)" not just "PD-07".
//   3. Calls enrichPdWithDemographics() which queries the evidence_facts
//      JSON array and shape-maps to { population_2011, area_ha,
//      gross_density_pph, wards_in_pd, villages_count, notes }.
//   4. Maps the RMP-shape fields into the DOCX-renderer-friendly shape
//      (population_total, population_density, etc.) while also passing
//      through the PD-specific extras (wards, villages, area_ha) as
//      direct fields the renderer can show inline.
//   5. Soft-fails on any DB error so a missing planning_districts table
//      doesn't crash the export.
const fetchDealDemographics = async (deal) => {
  const pdCode = deal?.auto_derived_pd_code;
  if (!pdCode) return null;

  try {
    // Resolve pd_name + city so the section can label itself authoritatively.
    const pdResult = await query(
      `SELECT pd_code, pd_name, city
       FROM regulatory_data.planning_districts
       WHERE pd_code = $1
       LIMIT 1`,
      [pdCode],
    );
    if (!pdResult.rows.length) return null;
    const pd = pdResult.rows[0];

    // Enrich with the RMP demographics blob.
    const enriched = await enrichPdWithDemographics(pd);
    if (!enriched) return null;

    // Shape-map RMP fields → DOCX-renderer-expected keys so the existing
    // labelValueRow renderer in buildDemographics can pick them up
    // without changes. Pass through the PD-specific extras alongside.
    return {
      // PD identity (rendered in header)
      pd_code: enriched.pd_code,
      pd_name: enriched.pd_name,
      city: enriched.city,
      // Census-shape fields (existing renderer keys)
      population_total: enriched.population_2011 != null ? Number(enriched.population_2011) : null,
      // gross_density_pph (persons per HECTARE) → persons / km² for
      // operator readability. 1 km² = 100 ha.
      population_density: enriched.gross_density_pph != null
        ? Math.round(Number(enriched.gross_density_pph) * 100)
        : null,
      // PD-specific extras (rendered as new rows in NX41-extended buildDemographics)
      area_ha: enriched.area_ha != null ? Number(enriched.area_ha) : null,
      wards_in_pd: enriched.wards_in_pd != null ? Number(enriched.wards_in_pd) : null,
      villages_count: enriched.villages_count != null ? Number(enriched.villages_count) : null,
      notes: enriched.notes || null,
      // Provenance — operator can verify which dataset the figures came from
      source: 'BBMP RMP-2031 (2011 census base)',
      vintage: 'Census 2011 + RMP planning facts',
    };
  } catch (err) {
    // Soft-fail — log + return null so DOCX falls back to placeholder
    // (better than crashing the entire export).
    // eslint-disable-next-line no-console
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[dealExport.demographics] fetch failed for pd=${pdCode}: ${err.message}`);
    }
    return null;
  }
};

const getDealExportContext = async (dealId, options = {}) => {
  // PR-NX69 (2026-05-19) — caller passes { userId, userRole } from
  // req.user so the AI augment layer can enforce the BETA per-user quota
  // (1 free report; admin/owner unlimited). Backward-compat: when callers
  // omit options, entitlement check treats the request as unauthenticated
  // and denies the augment — preserving the option for batch / cron jobs
  // to opt out of consuming quota.
  const { userId = null, userRole = null } = options;
  const dealResult = await query(DEAL_EXPORT_SQL, [dealId]);
  if (!dealResult.rows.length) {
    return null;
  }

  const row = dealResult.rows[0];
  const modelParams = parseMaybeJson(row.model_params) || {};
  const cashFlows = summarizeCashFlows(row.cash_flows);
  const sensitivity = normalizeSensitivityMatrix(row.sensitivity_matrix);

  const deal = {
    ...row,
    model_params: modelParams,
    cash_flows: cashFlows,
    sensitivity_matrix: sensitivity,
  };

  const [
    ddSummaryResult,
    ddItemsResult,
    riskSummaryResult,
    riskItemsResult,
    approvalsResult,
    documentsResult,
    cityBenchmarks,
    autoFillEventsResult,
    extractionStatusResult,
    // PR-NX45 (2026-05-18) — completed extractions with their actual
    // structured_fields, fed to generateDocumentInsights for the new
    // Document-Derived Insights DOCX section.
    completedExtractionsResult,
  ] = await Promise.all([
    query(
      `SELECT
        COUNT(*) FILTER (WHERE is_required) AS total_required,
        COUNT(*) FILTER (WHERE is_required AND status IN ('completed', 'not_applicable')) AS completed_required,
        COUNT(*) FILTER (WHERE severity = 'deal_breaker' AND status NOT IN ('completed', 'not_applicable')) AS open_deal_breakers
       FROM dd_items
       WHERE deal_id = $1
         AND deleted_at IS NULL`,
      [dealId]
    ),
    query(
      `SELECT item_name, category, severity, status, assigned_to, due_date, notes
       FROM dd_items
       WHERE deal_id = $1
         AND deleted_at IS NULL
       ORDER BY CASE severity
         WHEN 'deal_breaker' THEN 1
         WHEN 'buildability_blocker' THEN 2
         WHEN 'commercial_blocker' THEN 3
         WHEN 'secondary' THEN 4
         ELSE 5
       END, due_date NULLS LAST, item_name`,
      [dealId]
    ),
    query(
      `SELECT
        COUNT(*) FILTER (WHERE status IN ('open', 'flagged') AND severity = 'critical') AS critical,
        COUNT(*) FILTER (WHERE status IN ('open', 'flagged') AND severity = 'high') AS high,
        COUNT(*) FILTER (WHERE status IN ('open', 'flagged') AND severity = 'medium') AS medium,
        COUNT(*) FILTER (WHERE status IN ('open', 'flagged') AND severity = 'low') AS low
       FROM risk_flags
       WHERE deal_id = $1
         AND deleted_at IS NULL`,
      [dealId]
    ),
    query(
      `SELECT title, severity, category, status, description, mitigation
       FROM risk_flags
       WHERE deal_id = $1 AND deleted_at IS NULL AND status IN ('open', 'flagged')
        ORDER BY CASE severity
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
       END, created_at DESC`,
      [dealId]
    ),
    query(
      `SELECT a.*, d.name AS document_name
       FROM approval_items a
       LEFT JOIN documents d ON d.id = a.document_id
       WHERE a.deal_id = $1
         AND a.deleted_at IS NULL
       ORDER BY a.approval_type, a.created_at`,
      [dealId]
    ),
    query(
      `SELECT id, name, file_type, doc_category, description, created_at
       FROM documents
       WHERE deal_id = $1
         AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [dealId]
    ),
    fetchCityBenchmarks({ city: deal.city }).catch(() => []),
    // PR-NX36 (2026-05-17) — auto-fill audit slice
    //
    // Surfaces every `apply-extractions` event for this deal so the DOCX
    // Provenance / Source Register section can render a "what was extracted
    // from which document, applied when, and to which table" timeline. The
    // metadata.source='document_extraction' tag is written by
    // dealApplyExtractions.service.js (PR-NX25). Soft-fails on 42P01 (table
    // not yet migrated) so existing exports keep working.
    query(
      `SELECT
         id, created_at, actor_id, before_json, after_json, metadata
       FROM deal_audit_log
       WHERE deal_id = $1
         AND event_type = 'updated'
         AND metadata ->> 'source' = 'document_extraction'
       ORDER BY created_at DESC
       LIMIT 50`,
      [dealId]
    ).catch((err) => {
      if (err && err.code === '42P01') return { rows: [] }; // migration not yet applied
      throw err;
    }),
    // PR-NX36 (2026-05-17) — per-document extraction status
    //
    // Surfaces which uploaded documents have been processed (Gemini OCR)
    // and how many structured fields they produced. The DOCX Provenance
    // section uses this to show "sale-deed.pdf — 12 fields extracted ·
    // 7 applied to deal" per document. Soft-fails on missing table.
    query(
      `SELECT
         id, document_id, extraction_status, doc_type, provider,
         (CASE WHEN structured_fields IS NOT NULL
               THEN (SELECT COUNT(*) FROM jsonb_object_keys(structured_fields))
               ELSE 0 END) AS field_count,
         (CASE WHEN correction_history IS NOT NULL
               THEN jsonb_array_length(correction_history)
               ELSE 0 END) AS history_count,
         extracted_at, created_at
       FROM document_extractions
       WHERE deal_id = $1
       ORDER BY created_at DESC`,
      [dealId]
    ).catch((err) => {
      if (err && err.code === '42P01') return { rows: [] };
      throw err;
    }),
    // PR-NX45 (2026-05-18) — fetch the FULL structured_fields JSON for
    // completed extractions so the new DOCX "Document-Derived Insights"
    // section can render extracted facts AND have Claude detect cross-
    // document inconsistencies. Capped at 20 most-recent completed
    // extractions to keep prompt budget manageable. Soft-fails on
    // missing table.
    query(
      `SELECT id, document_id, doc_type, provider, structured_fields,
              extracted_at
         FROM document_extractions
        WHERE deal_id = $1
          AND extraction_status = 'completed'
          AND structured_fields IS NOT NULL
        ORDER BY extracted_at DESC NULLS LAST, created_at DESC
        LIMIT 20`,
      [dealId]
    ).catch((err) => {
      if (err && err.code === '42P01') return { rows: [] };
      throw err;
    }),
  ]);

  // PR-NX45 (2026-05-18) — extract the completed extractions with
  // structured_fields for the document-insights AI call. Empty array
  // when table missing (42P01) or no completed extractions.
  const completedExtractions = (completedExtractionsResult?.rows || []);

  const ddSummary = {
    total_required: Number(ddSummaryResult.rows[0]?.total_required || 0),
    completed_required: Number(ddSummaryResult.rows[0]?.completed_required || 0),
    open_deal_breakers: Number(ddSummaryResult.rows[0]?.open_deal_breakers || 0),
  };
  ddSummary.completion_pct = ddSummary.total_required
    ? round((ddSummary.completed_required / ddSummary.total_required) * 100, 0)
    : 0;

  const riskSummary = {
    critical: Number(riskSummaryResult.rows[0]?.critical || 0),
    high: Number(riskSummaryResult.rows[0]?.high || 0),
    medium: Number(riskSummaryResult.rows[0]?.medium || 0),
    low: Number(riskSummaryResult.rows[0]?.low || 0),
  };
  riskSummary.total =
    riskSummary.critical + riskSummary.high + riskSummary.medium + riskSummary.low;

  const approvals = approvalsResult.rows;
  const documents = documentsResult.rows;
  const approvalSummary = summarizeApprovals(approvals);
  const documentSummary = summarizeDocuments(documents);

  const inferredAssetClass = inferAssetClass({ deal, inputs: modelParams?.inputs || {} });
  const compType = mapAssetClassToCompType(inferredAssetClass, deal.property_type);
  const propertyLat = num(deal.property_lat);
  const propertyLng = num(deal.property_lng);

  let nearbyComps = [];
  if (propertyLat !== null && propertyLng !== null) {
    nearbyComps = await getCompsNearLocation(propertyLat, propertyLng, 5, compType).catch(() => []);
  }
  const cityComps = await fetchCityComps({ city: deal.city, compType }).catch(() => []);
  const exportComps = (nearbyComps.length ? nearbyComps : cityComps).slice(0, 10);
  // Credibility (CLAUDE.md): the tear-sheet labels this benchmark "verified
  // comps", so it must be computed from VERIFIED comps only — never present an
  // unverified/mixed set as an authoritative benchmark rate. When no verified
  // comp exists, deriveBenchmarks returns count 0 / median null and the caption
  // falls through to its honest "verified comps required" state. The full nearby
  // set still feeds the comps table (which renders a Verified Yes/No column).
  const verifiedComps = exportComps.filter((c) => c && c.is_verified);
  const benchmarks = deriveBenchmarks(verifiedComps);

  const durationYears = deal.project_duration_months
    ? round(deal.project_duration_months / 12, 2)
    : num(modelParams?.inputs?.projectDurationYears);
  const effectiveDate = modelParams?.inputs?.effectiveDate || null;
  const hasFinancialModel = deal.total_cost_cr !== null && deal.total_revenue_cr !== null;

  const readiness = buildReadinessSummary({
    ddItems: ddItemsResult.rows,
    approvals,
    riskFlags: riskItemsResult.rows,
    financials: hasFinancialModel ? deal : null,
    documentCount: documents.length,
  });

  const nextSteps = deriveNextSteps({
    deal,
    ddItems: ddItemsResult.rows,
    approvals,
    riskFlags: riskItemsResult.rows,
    financials: hasFinancialModel ? deal : null,
    documentCount: documents.length,
    documentCategoryCounts: documentSummary.byCategory,
    readinessSummary: readiness,
  });

  const recommendation = computeRecommendation({
    ddSummary,
    riskSummary,
    hasFinancialModel,
    irrPct: deal.irr_pct,
    grossMarginPct: deal.gross_margin_pct,
    totalRevenueCr: deal.total_revenue_cr,
    totalCostCr: deal.total_cost_cr,
    askPriceCr: deal.land_ask_price_cr,
    residualLandValueCr: deal.residual_land_value_cr,
  });

  // PR-NX41 + NX43 + NX44 + NX45 + NX67 (2026-05-18 → 2026-05-19): demographics
  // + IC opinion + risk narrative + sensitivity narrative + document insights
  // + AI market-context augment all run in parallel to keep export latency flat.
  // Each .catch()es independently so one failing never aborts the others.
  const [ai, demographics, riskNarrative, sensitivityNarrative, documentInsights, aiMarketContextNarratives] = await Promise.all([
    generateDealInsights({
      deal,
      ddCounts: ddSummary,
      riskCounts: riskSummary,
      financials: deal,
      benchmarks,
      topRiskFlags: riskItemsResult.rows.slice(0, 5),
      topDdItems: ddItemsResult.rows
        .filter((item) => !CLOSED_DD_STATUSES.has(item.status))
        .slice(0, 5),
      cashFlowSummary: cashFlows.summary,
    }).catch((error) => ({
      available: false,
      reason: error.message,
      ic_opinion: null,
      top_risks: [],
      next_steps: [],
      confidence: null,
      disclaimer:
        'AI-generated Investor-Grade opinion is informational only. Verify all facts and risks before any investment decision.',
    })),
    fetchDealDemographics(deal).catch(() => null),
    // PR-NX43 (2026-05-18) — 2-paragraph Claude synthesis of the risk
    // profile + critical-spotlight callout. Auto-no-op on empty / all-
    // closed risk lists; otherwise cascades Claude → OpenAI → unavailable.
    generateRiskNarrative({
      deal,
      riskCounts: riskSummary,
      items: riskItemsResult.rows,
    }).catch((error) => ({
      available: false,
      reason: error.message,
      summary_paragraph: null,
      critical_spotlight_paragraph: null,
      confidence: null,
    })),
    // PR-NX44 (2026-05-18) — 2-paragraph OpenAI synthesis of the
    // sensitivity analysis (driver decomposition + recommended stress
    // tests). Cascades OpenAI → Claude → unavailable. Auto-no-op when
    // the sensitivity grid is too sparse (< 3 rows or < 3 cols).
    generateSensitivityNarrative({
      deal,
      sensitivityMatrix: sensitivity,
      financials: deal,
    }).catch((error) => ({
      available: false,
      reason: error.message,
      driver_decomposition_paragraph: null,
      stress_test_paragraph: null,
      dominant_driver: null,
      confidence: null,
    })),
    // PR-NX45 (2026-05-18) — Claude (primary) cross-document reasoning
    // over the completed extractions. Surfaces inconsistencies + a 1-
    // paragraph summary of what the doc set tells us. Auto-no-op when
    // no extractions have structured_fields populated.
    generateDocumentInsights({
      deal,
      extractions: completedExtractions,
    }).catch((error) => ({
      available: false,
      reason: error.message,
      summary_paragraph: null,
      findings: [],
      confidence: null,
    })),
    // PR-NX67 + NX69 (2026-05-19) — AI market-context augment layer with
    // BETA per-user quota gate. The augment fires only when the caller has
    // remaining quota (or is admin/owner — unlimited). On exhaustion the
    // generator is bypassed and a special envelope is returned so the
    // DOCX renderer can emit a "Premium AI Insights · Quota Exceeded"
    // message INSTEAD of the generic "Manual input required" placeholder.
    //
    // Usage counter is incremented ONLY after the augment actually produced
    // at least one available:true narrative — so Claude outages don't burn
    // a user's free report.
    (async () => {
      const entitlement = await aiAugmentEntitlement.checkEntitlement({ userId, userRole });
      if (!entitlement.allowed) {
        // Quota exhausted or check failed — synthesize a deny envelope
        // shaped like a per-section unavailable so renderers don't need
        // to change their existing aiAugment[...] reads.
        const denyEnvelope = {
          available: false,
          reason: entitlement.reason, // 'quota_exceeded' | 'unauthenticated' | 'user_not_found' | 'check_failed'
          quotaLimit: entitlement.limit,
          quotaUsed: entitlement.used,
        };
        return aiMarketContext.SECTION_KEYS.reduce((acc, key) => {
          acc[key] = denyEnvelope;
          return acc;
        }, { _entitlement: entitlement });
      }
      const narratives = await aiMarketContext.generateAllSections({
        payload: {
          locality: deal.micro_market || deal.city || null,
          city: deal.city || null,
          asset_class: deal.asset_class || null,
          property_name: deal.property_name || deal.name || null,
          micro_market: deal.micro_market || null,
          zoning: deal.zoning || null,
          deal_type: deal.deal_type || null,
        },
        dealId: deal.id,
        organizationId: deal.organization_id || null,
      });
      // Record usage ONLY if at least one section produced real content.
      // Claude-down scenario → all envelopes return available:false →
      // user is not charged (next export retries fresh).
      const anyAvailable = Object.values(narratives || {})
        .some((env) => env && env.available === true);
      if (anyAvailable && !entitlement.unlimited) {
        const recorded = await aiAugmentEntitlement.recordUsage({ userId, userRole });
        narratives._entitlement = {
          ...entitlement,
          recorded: recorded.recorded,
          newCount: recorded.newCount,
        };
      } else {
        narratives._entitlement = entitlement;
      }
      return narratives;
    })().catch((error) => {
      // Never block the export. If the entitlement/augment chain throws,
      // log and return empty so renderers fall through to placeholders.
      console.warn('[dealExport] aiMarketContext + entitlement chain failed:', error.message);
      return {};
    }),
  ]);

  // PR-B (2026-05-25) — Recommendation Engine + Deal Doctor slices. Prefer the
  // persisted run (so the DOCX matches what the operator sees in the workspace);
  // fall back to a one-shot re-compute when no run is on file. Both are
  // bounded — the engine itself is cheap deterministic code; the AI narrator
  // skips for export so the DOCX prose stays the deterministic copy (which is
  // the audit-ready surface anyway).
  const recommendationsSlice = await (async () => {
    try {
      const latest = await recommendationPersistence.getLatestRun(deal.id);
      if (latest && Array.isArray(latest.recommendations)) {
        return {
          recommendations: latest.recommendations,
          signals: latest.signals || [],
          summary: summariseRecommendations(latest.recommendations),
          snapshot_hash: latest.snapshot_hash,
          generated_at: latest.created_at,
          narrator_status: latest.narrator_status,
        };
      }
      // No persisted run yet — compute on the fly for the export. Use a
      // minimal workspace shape from the export data we already have.
      const liveWorkspace = {
        deal,
        financial: { summary: { kpis: modelParams?.kpis || null } },
        comps: { entries: nearbyComps || [] },
        approvals: approvalsResult?.rows || [],
        dd: { items: ddItemsResult.rows || [] },
        risk: { flags: riskItemsResult.rows || [] },
      };
      const live = await recommendationEngine.generateForWorkspace(liveWorkspace);
      return {
        recommendations: live.recommendations,
        signals: live.signals,
        summary: summariseRecommendations(live.recommendations),
        snapshot_hash: live.snapshot_hash,
        generated_at: live.generated_at,
        narrator_status: 'skipped',
      };
    } catch (err) {
      console.warn('[dealExport] recommendation slice failed:', err.message);
      return null;
    }
  })();

  const dealDoctorSlice = await (async () => {
    try {
      const liveWorkspace = {
        deal,
        financial: { summary: { kpis: modelParams?.kpis || null } },
        comps: { entries: nearbyComps || [] },
        approvals: approvalsResult?.rows || [],
        dd: { items: ddItemsResult.rows || [] },
        risk: { flags: riskItemsResult.rows || [] },
      };
      const out = await dealDoctor.generateForWorkspace(liveWorkspace);
      return {
        findings: out.findings,
        groups: out.groups,
        finding_count: out.finding_count,
        signal_count: out.signal_count,
        summary: summariseFindings(out.findings),
        generated_at: out.generated_at,
      };
    } catch (err) {
      console.warn('[dealExport] deal doctor slice failed:', err.message);
      return null;
    }
  })();

  return {
    deal,
    recommendations: recommendationsSlice,
    deal_doctor: dealDoctorSlice,
    hasFinancialModel,
    durationYears,
    effectiveDate,
    generatedAt: new Date().toISOString(),
    assumptions: buildDynamicAssumptions(modelParams?.inputs || {}),
    cashFlows,
    sensitivity,
    // PR-NX44 (2026-05-18) — AI-synthesized 2-paragraph driver
    // decomposition + recommended stress tests, consumed by DOCX
    // buildFinancials → renders above the sensitivity tornado chart.
    sensitivityNarrative,
    dd: {
      summary: ddSummary,
      items: ddItemsResult.rows,
    },
    risks: {
      summary: riskSummary,
      items: riskItemsResult.rows,
      recommendation,
      // PR-NX43 (2026-05-18) — AI-synthesized 2-paragraph narrative
      // (summary + critical-spotlight) consumed by DOCX buildRiskRegister.
      // Null-shape returned for empty/all-closed risk lists so the
      // existing structured-only render stays the default.
      narrative: riskNarrative,
    },
    market: {
      projectType: compType,
      nearbyComps,
      cityComps,
      exportComps,
      benchmarks,
      cityBenchmarks,
      // PR-NX41 (2026-05-18): planning-district demographics joined via
      // properties.auto_derived_pd_code. Null when the deal hasn't run
      // the AutoFillParcelContextCard derive yet OR is outside Bengaluru.
      // DOCX buildDemographics renders this if populated; falls back to
      // the "manual input required" placeholder otherwise.
      demographics,
      // PR-NX67 (2026-05-19) — AI market-context augment narratives.
      // Five envelopes (whyThisArea, demographics, jobGrowth,
      // socialInfrastructure, supplyDemandPipeline) — each carries
      // { available, paragraphs|paragraph|bullets|buckets, summary?, caution?,
      //   provider, confidence, dataQuality, disclaimer, fallbackReason }.
      // Consumed by the DOCX section builders as a SECOND-CHANCE FALLBACK
      // when REDIP's structured payload (intelligence_briefs, infra_proximity,
      // demographics fact-row) is empty for the deal.
      //
      // NEVER overrides verified structured data — only fills the gap when
      // structured data is absent. Operator can disable globally via the
      // AI_MARKET_CONTEXT_ENABLED=false env flag.
      aiAugment: aiMarketContextNarratives || {},
      pricingGapPct:
        num(deal.selling_rate_per_sqft) && num(benchmarks.median_rate_per_sqft)
          ? round(
              ((num(deal.selling_rate_per_sqft) - num(benchmarks.median_rate_per_sqft)) /
                num(benchmarks.median_rate_per_sqft)) *
                100,
              1
            )
          : null,
    },
    approvals: {
      summary: approvalSummary,
      items: approvals,
    },
    documents: {
      summary: documentSummary,
      items: documents,
      // PR-NX45 (2026-05-18) — full structured_fields per completed
      // extraction so DOCX buildDocumentInsights can render extracted
      // facts grouped by doctype. Capped at 20 rows; soft-empty when
      // no doc-ingest has happened.
      completedExtractions,
      // PR-NX45 (2026-05-18) — Claude-synthesized cross-document insights
      // (summary paragraph + 0-5 inconsistency findings). Null-shape
      // when no extractions have structured_fields populated.
      insights: documentInsights,
    },
    // PR-NX36 (2026-05-17) — Provenance / Source Register payload.
    //
    // Consumed by the DOCX Provenance section. XLSX + PPTX ignore today
    // (additive, backward-compatible). Two slices:
    //
    //   - autoFillEvents[]: every `apply-extractions` audit row with
    //     metadata.source='document_extraction', shaped for direct render
    //     into a "what was applied when, from which extraction" table.
    //
    //   - extractionStatus[]: per-document_extractions row showing which
    //     uploaded docs were processed, by which provider, how many
    //     structured fields they produced, and how many history entries
    //     (corrections + apply events) they carry.
    provenance: {
      autoFillEvents: (autoFillEventsResult?.rows || []).map((row) => ({
        id: row.id,
        applied_at: row.created_at,
        actor_id: row.actor_id,
        applied_fields_count: Number(row.metadata?.applied_fields_count) || null,
        source_extraction_ids: Array.isArray(row.metadata?.source_extraction_ids)
          ? row.metadata.source_extraction_ids
          : [],
        target_table: row.metadata?.target_table || null,
        ontology_version: row.metadata?.ontology_version || null,
        changed_fields: row.after_json && typeof row.after_json === 'object'
          ? Object.keys(row.after_json)
          : [],
      })),
      extractionStatus: (extractionStatusResult?.rows || []).map((row) => ({
        id: row.id,
        document_id: row.document_id,
        doc_type: row.doc_type,
        provider: row.provider,
        extraction_status: row.extraction_status,
        field_count: Number(row.field_count) || 0,
        history_count: Number(row.history_count) || 0,
        extracted_at: row.extracted_at,
        created_at: row.created_at,
      })),
    },
    planning: await getPlanningContextForDeal(deal),
    readiness,
    nextSteps,
    ai,
  };
};

// Pulls verified RMP 2031 city-level callouts (and the deal's assigned
// zone, if any) into the export context so the IC PPTX deck can render
// the Planning Context slide without making a second API round-trip.
// Failures are non-fatal: a deck is more valuable than a missing one.
const getPlanningContextForDeal = async (deal) => {
  // Only inject planning context for Bengaluru deals — that's where we
  // have RMP 2031 corpus coverage. Future cities will gate similarly.
  const city = (deal?.city || deal?.property_city || '').toLowerCase();
  if (city && !city.includes('bengaluru') && !city.includes('bangalore')) {
    return { callouts: [], zone: null, city: deal?.city || null };
  }
  try {
    const landUse = await masterplanService.getLandUseIntelligence();
    return {
      callouts: Array.isArray(landUse?.callouts) ? landUse.callouts : [],
      zone: deal?.zone_id ? { id: deal.zone_id } : null,
      city: deal?.city || 'Bengaluru',
      disclaimer: landUse?.disclaimer || null,
    };
  } catch (err) {
    // Don't let a master-plan service hiccup take down the export.
    return { callouts: [], zone: null, city: deal?.city || null, error: err?.message || 'master-plan service unavailable' };
  }
};

module.exports = {
  getDealExportContext,
  __testables: {
    deriveBenchmarks,
    computeRecommendation,
    summarizeCashFlows,
    mapAssetClassToCompType,
  },
};
