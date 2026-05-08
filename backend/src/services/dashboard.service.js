const { query } = require('../config/database');
const { buildVisibleDealCondition, buildVisiblePropertyCondition } = require('../utils/dealVisibility');

const getDashboardStats = async (userId) => {
  const liveStageArray = [
    'sourced',
    'screening',
    'site_visit',
    'loi',
    'due_diligence',
    'underwriting',
    'ic_review',
    'negotiation',
    'active',
  ];

  // Total deals stats
  const dealsStatsResult = await query(
    `SELECT
      COUNT(*) FILTER (WHERE ${buildVisibleDealCondition('d')}) as total_deals,
      COUNT(*) FILTER (WHERE d.is_archived = FALSE AND d.stage = ANY($1::deal_stage[])) as active_deals_count,
      COUNT(*) FILTER (WHERE d.is_archived = FALSE AND d.stage = 'closed' AND d.updated_at >= DATE_TRUNC('month', NOW())) as deals_closed_this_month,
      COUNT(*) FILTER (WHERE d.is_archived = FALSE AND d.stage = 'dead') as dead_deals,
      COUNT(*) FILTER (WHERE d.is_archived = TRUE) as archived_deals,
      COALESCE(SUM(f.total_revenue_cr) FILTER (WHERE d.is_archived = FALSE AND d.stage = ANY($1::deal_stage[])), 0) as total_pipeline_value_cr,
      AVG(f.irr_pct) FILTER (WHERE f.irr_pct IS NOT NULL AND d.is_archived = FALSE AND d.stage <> 'dead') as avg_irr_pct
     FROM deals d
     LEFT JOIN financials f ON d.id = f.deal_id
     WHERE (d.organization_id = current_organization_id() OR d.id IN (SELECT ds.deal_id FROM deal_shares ds WHERE ds.shared_with = current_user_id()))`,
    [liveStageArray]
  );

  const dealsStats = dealsStatsResult.rows[0];

  // Deals by stage
  const dealsByStageResult = await query(
    `SELECT d.stage, COUNT(*) as count,
      COALESCE(SUM(f.total_revenue_cr), 0) as value_cr
     FROM deals d
     LEFT JOIN financials f ON d.id = f.deal_id
     WHERE ${buildVisibleDealCondition('d')}
     GROUP BY d.stage
     ORDER BY CASE d.stage
       WHEN 'sourced' THEN 1
       WHEN 'screening' THEN 2
       WHEN 'site_visit' THEN 3
       WHEN 'loi' THEN 4
       WHEN 'due_diligence' THEN 5
       WHEN 'underwriting' THEN 6
       WHEN 'ic_review' THEN 7
       WHEN 'negotiation' THEN 8
       WHEN 'active' THEN 9
       WHEN 'closed' THEN 10
       WHEN 'dead' THEN 11
     END`
  );

  const dealsByStage = {};
  const stageDistribution = [];
  for (const row of dealsByStageResult.rows) {
    dealsByStage[row.stage] = {
      count: parseInt(row.count, 10),
      value_cr: parseFloat(row.value_cr) || 0,
    };
    stageDistribution.push({
      stage: row.stage,
      count: parseInt(row.count, 10),
      value_cr: parseFloat(row.value_cr) || 0,
    });
  }

  // Total properties
  const propertiesResult = await query(
    `SELECT COUNT(*) as total
     FROM properties p
     WHERE ${buildVisiblePropertyCondition('p', 'linked_deal')}`
  );
  const totalProperties = parseInt(propertiesResult.rows[0].total, 10);

  // Recent activities (global, last 10)
  const recentActivitiesResult = await query(
    `SELECT a.*,
      u.name as performed_by_name,
      d.name as deal_name,
      p.city as deal_city
     FROM activities a
     LEFT JOIN users u ON a.performed_by = u.id
     LEFT JOIN deals d ON a.deal_id = d.id
     LEFT JOIN properties p ON d.property_id = p.id
     WHERE ${buildVisibleDealCondition('d')}
     ORDER BY a.activity_date DESC
     LIMIT 10`
  );

  // Top deals by IRR
  const topDealsResult = await query(
    `SELECT d.id, d.name, d.stage, p.city, f.irr_pct, f.total_revenue_cr, f.gross_margin_pct
     FROM deals d
     LEFT JOIN properties p ON d.property_id = p.id
     LEFT JOIN financials f ON d.id = f.deal_id
     WHERE (d.organization_id = current_organization_id() OR d.id IN (SELECT ds.deal_id FROM deal_shares ds WHERE ds.shared_with = current_user_id()))
       AND f.irr_pct IS NOT NULL AND d.stage NOT IN ('dead', 'closed') AND d.is_archived = FALSE
     ORDER BY f.irr_pct DESC
     LIMIT 5`
  );

  // Monthly deal activity (last 6 months)
  const monthlyActivityResult = await query(
    `SELECT
      TO_CHAR(d.created_at, 'Mon YYYY') as month,
      DATE_TRUNC('month', d.created_at) as month_date,
      COUNT(*) as new_deals,
      COUNT(*) FILTER (WHERE d.stage = 'closed') as closed_deals
     FROM deals d
     WHERE (d.organization_id = current_organization_id() OR d.id IN (SELECT ds.deal_id FROM deal_shares ds WHERE ds.shared_with = current_user_id()))
       AND d.created_at >= NOW() - INTERVAL '6 months' AND d.is_archived = FALSE
       AND d.stage <> 'dead'
     GROUP BY DATE_TRUNC('month', d.created_at), TO_CHAR(d.created_at, 'Mon YYYY')
     ORDER BY month_date ASC`
  );

  // Cities distribution
  const citiesResult = await query(
    `SELECT p.city, COUNT(d.id) as deal_count
     FROM deals d
     LEFT JOIN properties p ON d.property_id = p.id
     WHERE ${buildVisibleDealCondition('d')}
     GROUP BY p.city
     ORDER BY deal_count DESC
     LIMIT 8`
  );

  // Comps review queue counts — surfaced on the dashboard's "Action items"
  // row so reviewers see pending work as soon as they land. RLS scopes
  // to the current org automatically. Aggregate in one pass — three
  // FILTER clauses, one row, one round trip.
  const queueCountsResult = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending_review')     AS pending_review,
       COUNT(*) FILTER (WHERE status = 'pending_extraction') AS pending_extraction,
       COUNT(*) FILTER (WHERE status = 'failed')             AS failed
     FROM comps_review_queue
     WHERE organization_id = current_organization_id()`
  );
  const queueCounts = queueCountsResult.rows[0] || {};

  return {
    stats: {
      total_deals: parseInt(dealsStats.total_deals, 10),
      active_deals_count: parseInt(dealsStats.active_deals_count, 10),
      deals_closed_this_month: parseInt(dealsStats.deals_closed_this_month, 10),
      dead_deals: parseInt(dealsStats.dead_deals, 10),
      archived_deals: parseInt(dealsStats.archived_deals, 10),
      total_pipeline_value_cr: parseFloat(dealsStats.total_pipeline_value_cr) || 0,
      avg_irr_pct: dealsStats.avg_irr_pct ? parseFloat(dealsStats.avg_irr_pct) : null,
      total_properties: totalProperties,
      // Tier-0 ingestion queue surface — feeds the dashboard's "Action items"
      // row that links straight to the reviewer. Numbers are 0 for orgs
      // without any queue activity yet, so the tile hides cleanly.
      comps_queue_pending_review:     parseInt(queueCounts.pending_review, 10)     || 0,
      comps_queue_pending_extraction: parseInt(queueCounts.pending_extraction, 10) || 0,
      comps_queue_failed:             parseInt(queueCounts.failed, 10)             || 0,
    },
    deals_by_stage: dealsByStage,
    stage_distribution: stageDistribution,
    recent_activities: recentActivitiesResult.rows,
    top_deals_by_irr: topDealsResult.rows,
    monthly_activity: monthlyActivityResult.rows,
    cities_distribution: citiesResult.rows.map((row) => ({
      city: row.city || 'Unknown',
      deal_count: parseInt(row.deal_count, 10) || 0,
    })),
  };
};

module.exports = { getDashboardStats };
