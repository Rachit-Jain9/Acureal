const { query } = require('../config/database');

const buildSearchText = (property = {}) =>
  [
    property.address,
    property.city,
    property.state,
    property.pincode,
    property.survey_number ? `survey ${property.survey_number}` : null,
  ]
    .filter(Boolean)
    .join(' ')
    .trim();

const normalizeLandUse = (property = {}) => {
  const zoning = String(property.zoning || property.property_type || '').toLowerCase();
  if (zoning.includes('commercial') || zoning.includes('office') || zoning.includes('retail')) return 'commercial';
  if (zoning.includes('industrial')) return 'industrial';
  return 'residential';
};

const buildCitation = (row) => ({
  id: row.id ? `guidance-value-${row.id}` : 'guidance-value',
  kind: 'guidance_value',
  label: row.source_section || row.source_title || 'Guidance value reference',
  source_title: row.source_title || 'Karnataka IGR guidance value reference',
  source_url: row.source_url || null,
  authority: row.authority_name || 'Karnataka IGR',
  page: row.source_page || null,
  section: row.source_section || null,
  status: row.org_id ? 'org_reviewed' : 'global_reference',
});

const findGuidanceMatches = async (property = {}) => {
  const searchText = buildSearchText(property);

  if (!searchText) {
    return {
      status: 'needs_input',
      confidence: 0,
      message: 'Address/locality is required to match official guidance values.',
      matches: [],
      selected: null,
    };
  }

  try {
    const result = await query(
      `SELECT
          gv.*,
          es.source_title,
          es.source_url,
          es.authority_name,
          GREATEST(
            similarity(LOWER(COALESCE(gv.locality, '')), LOWER($1)),
            similarity(LOWER(CONCAT_WS(' ', gv.locality, gv.road_name)), LOWER($1))
          ) AS match_score
       FROM regulatory_data.guidance_values gv
       LEFT JOIN regulatory_data.evidence_sources es ON es.id = gv.evidence_source_id
       WHERE gv.review_status = 'approved'
         AND LOWER(COALESCE(gv.city, 'bengaluru')) = LOWER($2)
         AND (
           gv.land_use_type IS NULL
           OR LOWER(gv.land_use_type) = LOWER($3)
         )
       ORDER BY
         (gv.org_id IS NOT NULL) DESC,
         match_score DESC,
         gv.effective_from DESC NULLS LAST
       LIMIT 5`,
      [searchText, property.city || 'Bengaluru', normalizeLandUse(property)]
    );

    const matches = result.rows.map((row) => ({
      id: row.id,
      sro_name: row.sro_name,
      locality: row.locality,
      road_name: row.road_name,
      land_use_type: row.land_use_type,
      value_inr_per_sqft: row.value_inr_per_sqft ? Number(row.value_inr_per_sqft) : null,
      value_inr_per_acre: row.value_inr_per_acre ? Number(row.value_inr_per_acre) : null,
      unit_type: row.unit_type,
      match_score: Number(row.match_score || 0),
      confidence: Number(row.match_score || 0),
      review_status: row.review_status,
      effective_from: row.effective_from,
      effective_to: row.effective_to,
      citation: buildCitation(row),
    }));

    const selected = matches[0] || null;
    const confidence = selected ? Math.min(0.95, Math.max(0.05, selected.confidence)) : 0;

    return {
      status: selected ? (confidence >= 0.55 ? 'matched' : 'low_confidence') : 'not_available',
      confidence,
      message: selected
        ? confidence >= 0.55
          ? 'Guidance value matched from approved reference data.'
          : 'A guidance value candidate exists, but locality confidence is low.'
        : 'No approved guidance value rows are available for this property.',
      matches,
      selected,
      citations: selected ? [selected.citation] : [],
    };
  } catch (error) {
    if (error.code === '42P01' || /regulatory_data\.guidance_values/i.test(error.message || '')) {
      return {
        status: 'not_configured',
        confidence: 0,
        message: 'Guidance-value reference tables are not migrated/configured yet.',
        matches: [],
        selected: null,
        citations: [],
      };
    }
    throw error;
  }
};

module.exports = {
  findGuidanceMatches,
  buildSearchText,
  normalizeLandUse,
};
