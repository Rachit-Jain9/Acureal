const { query } = require('../config/database');
const { buildVisibleDealCondition } = require('../utils/dealVisibility');
const { getCompsNearLocation } = require('./comps.service');
const { generateDealInsights } = require('./export.insights.service');

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
    p.land_area_sqft,
    p.zoning,
    p.survey_number,
    p.owner_name,
    p.circle_rate_per_sqft,
    p.permissible_fsi,
    p.lat AS property_lat,
    p.lng AS property_lng,
    p.geocode_status,
    p.geocode_confidence,
    p.property_type,
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
    f.selling_rate_per_sqft,
    f.construction_cost_per_sqft,
    f.fsi,
    f.loading_factor,
    f.plot_area_sqft,
    f.discount_rate_pct,
    f.project_duration_months,
    f.developer_margin_pct,
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

const mapAssetClassToCompType = (assetClass, propertyType) => {
  const normalizedAssetClass = String(assetClass || '').trim().toLowerCase();
  const normalizedPropertyType = String(propertyType || '').trim().toLowerCase();

  if (normalizedPropertyType === 'office' || normalizedAssetClass === 'commercial_office') return 'office';
  if (normalizedPropertyType === 'retail' || normalizedAssetClass === 'retail') return 'retail';
  if (normalizedPropertyType === 'industrial' || normalizedAssetClass === 'industrial_warehousing') return 'industrial';
  if (normalizedPropertyType === 'hospitality' || normalizedAssetClass === 'hospitality') return 'hospitality';
  return 'residential';
};

const percentile = (sortedValues, fraction) => {
  if (!sortedValues.length) return null;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor(sortedValues.length * fraction)));
  return sortedValues[index];
};

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

const computeRecommendation = ({ ddSummary, riskSummary, hasFinancialModel, irrPct, grossMarginPct }) => {
  const critical = Number(riskSummary.critical || 0);
  const high = Number(riskSummary.high || 0);
  const openDealBreakers = Number(ddSummary.open_deal_breakers || 0);
  const ddCompletionPct = Number(ddSummary.completion_pct || 0);

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
      reason: 'Financial model outputs are missing, so the IC view is not yet decision-ready.',
    };
  }

  if (high >= 2 || ddCompletionPct < 50) {
    return {
      label: 'Proceed With Conditions',
      tone: 'caution',
      reason: 'The opportunity has potential, but diligence completion or high-severity risk load needs tightening.',
    };
  }

  if ((num(irrPct) || 0) >= 18 && (num(grossMarginPct) || 0) >= 18) {
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
    `SELECT project_name, developer, city, locality, project_type, bhk_config,
      rate_per_sqft, launch_year, possession_year, source, is_verified
     FROM comps
     WHERE ${conditions.join(' AND ')}
     ORDER BY is_verified DESC, rate_per_sqft DESC NULLS LAST
     LIMIT 8`,
    params
  );

  return result.rows;
};

const getDealExportContext = async (dealId) => {
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

  const [ddSummaryResult, ddItemsResult, riskSummaryResult, riskItemsResult] = await Promise.all([
    query(
      `SELECT
        COUNT(*) FILTER (WHERE is_required) AS total_required,
        COUNT(*) FILTER (WHERE is_required AND status IN ('completed', 'not_applicable')) AS completed_required,
        COUNT(*) FILTER (WHERE severity = 'deal_breaker' AND status NOT IN ('completed', 'not_applicable')) AS open_deal_breakers
       FROM dd_items
       WHERE deal_id = $1`,
      [dealId]
    ),
    query(
      `SELECT item_name, category, severity, status, assigned_to, due_date, notes
       FROM dd_items
       WHERE deal_id = $1
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
       WHERE deal_id = $1`,
      [dealId]
    ),
    query(
      `SELECT title, severity, category, status, description, mitigation
       FROM risk_flags
       WHERE deal_id = $1 AND status IN ('open', 'flagged')
       ORDER BY CASE severity
         WHEN 'critical' THEN 1
         WHEN 'high' THEN 2
         WHEN 'medium' THEN 3
         WHEN 'low' THEN 4
         ELSE 5
       END, created_at DESC`,
      [dealId]
    ),
  ]);

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

  const compType = mapAssetClassToCompType(deal.asset_class || deal.financial_asset_class, deal.property_type);
  const propertyLat = num(deal.property_lat);
  const propertyLng = num(deal.property_lng);

  let nearbyComps = [];
  if (propertyLat !== null && propertyLng !== null) {
    nearbyComps = await getCompsNearLocation(propertyLat, propertyLng, 5, compType).catch(() => []);
  }
  const cityComps = await fetchCityComps({ city: deal.city, compType }).catch(() => []);
  const exportComps = (nearbyComps.length ? nearbyComps : cityComps).slice(0, 10);
  const benchmarks = deriveBenchmarks(exportComps);

  const durationYears = deal.project_duration_months
    ? round(deal.project_duration_months / 12, 2)
    : num(modelParams?.inputs?.projectDurationYears);
  const effectiveDate = modelParams?.inputs?.effectiveDate || null;
  const hasFinancialModel = deal.total_cost_cr !== null && deal.total_revenue_cr !== null;

  const recommendation = computeRecommendation({
    ddSummary,
    riskSummary,
    hasFinancialModel,
    irrPct: deal.irr_pct,
    grossMarginPct: deal.gross_margin_pct,
  });

  const ai = await generateDealInsights({
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
      'AI-generated IC opinion is informational only. Verify all facts and risks before any investment decision.',
  }));

  return {
    deal,
    hasFinancialModel,
    durationYears,
    effectiveDate,
    generatedAt: new Date().toISOString(),
    assumptions: buildDynamicAssumptions(modelParams?.inputs || {}),
    cashFlows,
    sensitivity,
    dd: {
      summary: ddSummary,
      items: ddItemsResult.rows,
    },
    risks: {
      summary: riskSummary,
      items: riskItemsResult.rows,
      recommendation,
    },
    market: {
      projectType: compType,
      nearbyComps,
      cityComps,
      exportComps,
      benchmarks,
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
    ai,
  };
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
