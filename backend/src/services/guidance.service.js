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

const buildGuidanceSearchTerms = (property = {}) => {
  const terms = [
    property.address,
    property.locality,
    property.village,
    property.city,
    property.state,
    property.pincode,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return terms.replace(/\s+/g, ' ').trim();
};

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
      // Score first, join second. The evidence-source join used to run for all
      // ~1,194 candidate rows before LIMIT 5 discarded 1,189 of them — the
      // slowest app query in production, and it runs twice per deal open.
      // Nothing in the ORDER BY reads an `es` column, so joining only the five
      // survivors is behaviour-identical. Measured on production:
      // 2,447 buffers → 69.
      //
      // Deliberately NOT adding a trigram pre-filter on locality/road_name:
      // verified against real deal addresses that `gv.road_name IS NULL` makes
      // the OR chain evaluate NULL rather than TRUE, dropping the winning row
      // for Krishnasagara (0.569) and Jigani (0.432) and silently blanking the
      // land-rate-vs-guidance signal.
      `SELECT m.*, es.source_title, es.source_url, es.authority_name
       FROM (
         SELECT
            gv.*,
            LEAST(
              1,
              GREATEST(
                similarity(LOWER(COALESCE(gv.locality, '')), LOWER($1)),
                similarity(LOWER(CONCAT_WS(' ', gv.locality, gv.road_name)), LOWER($1))
              )
              + CASE
                  WHEN $4 ILIKE '%' || LOWER(COALESCE(gv.locality, '')) || '%' THEN 0.35
                  ELSE 0
                END
              + CASE
                  WHEN gv.road_name IS NOT NULL
                   AND $4 ILIKE '%' || LOWER(gv.road_name) || '%' THEN 0.15
                  ELSE 0
                END
            ) AS match_score
         FROM regulatory_data.guidance_values gv
         WHERE gv.review_status = 'approved'
           AND LOWER(COALESCE(gv.city, 'bengaluru')) = LOWER($2)
           AND (
             gv.land_use_type IS NULL
             OR LOWER(gv.land_use_type) = LOWER($3)
           )
         -- gv.id is a TIEBREAKER, not a preference. Without it the sort is
         -- non-deterministic at the tail: verified on production that two
         -- Whitefield rows tie at score 0.041667 with the same org flag and
         -- the same effective_from, so which one lands at rank 5 was decided
         -- by whatever order the scan happened to produce. A deterministic
         -- engine should not return a different answer to the same question,
         -- and a reader comparing two runs should not have to wonder whether
         -- the data changed. Ranks 1-3 were never affected.
         -- (No backticks in this comment: it lives inside a JS template
         -- literal, where a backtick would terminate the string.)
         ORDER BY
           (gv.org_id IS NOT NULL) DESC,
           match_score DESC,
           gv.effective_from DESC NULLS LAST,
           gv.id
         LIMIT 5
       ) m
       LEFT JOIN regulatory_data.evidence_sources es ON es.id = m.evidence_source_id
       -- Repeated on the outer query on purpose. A subquery's ORDER BY is only
       -- guaranteed to drive its own LIMIT; row order out of the join is not
       -- promised by the standard, and callers here read rows[0] as the best
       -- match. Five rows, so the sort is free.
       ORDER BY
         (m.org_id IS NOT NULL) DESC,
         m.match_score DESC,
         m.effective_from DESC NULLS LAST,
         m.id`,
      [searchText, property.city || 'Bengaluru', normalizeLandUse(property), buildGuidanceSearchTerms(property)]
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
  buildGuidanceSearchTerms,
  normalizeLandUse,
};
