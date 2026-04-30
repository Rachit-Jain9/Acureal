'use strict';

const { query } = require('../config/database');
const { mergeStructuredFields } = require('../utils/extractionFields');
const igrPdfAdapter = require('./adapters/igrPdf.adapter');

const REGULATORY_DOC_TYPES = new Set([
  'sale_deed',
  'ec',
  'rtc_pahani',
  'mutation',
  'conversion_certificate',
  'khata',
  'guidance_value_report',
  'igr_guidance_pdf',
  'bbmp_uav_pdf',
  'zoning_certificate',
  'e_khata',
  'layout_approval',
  'sanctioned_plan',
  'rmp_table',
  'kgis_extract',
]);

const FACT_EXCLUDED_KEYS = new Set([
  'rules',
  'rows',
  'raw_text',
  'needs_human_review',
  'verification_notes',
]);

const ROW_COUNT_FACT_DOC_TYPES = new Set(['igr_guidance_pdf', 'bbmp_uav_pdf']);

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const parseJsonField = (value, fallback = {}) => {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
};

const hasValue = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return true;
};

const textOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!normalized) return null;
  const numeric = Number(normalized[0]);
  return Number.isFinite(numeric) ? numeric : null;
};

const dateOrNull = (value) => {
  const normalized = textOrNull(value);
  return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
};

const pageOrNull = (value) => {
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const confidenceFor = (scores, key, fallback = null) => {
  const raw = scores?.[key] ?? scores?._overall ?? fallback;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
};

const sourceTitleFor = (row) => {
  const docType = row.doc_type || row.document_doc_type || 'regulatory_document';
  const name = row.document_name || row.document_id;
  return `${name} (${docType})`;
};

const loadExtraction = async (extractionId) => {
  const result = await query(
    `SELECT
       de.*,
       d.name AS document_name,
       d.file_url AS document_file_url,
       d.organization_id AS document_organization_id,
       d.doc_category AS document_category
     FROM document_extractions de
     JOIN documents d ON d.id = de.document_id
     WHERE de.id = $1`,
    [extractionId]
  );
  return result.rows[0] || null;
};

const findOrCreateSource = async ({ row, fields, scores, userId }) => {
  const orgId = row.organization_id || row.document_organization_id || null;
  let existing;
  if (row.document_id) {
    existing = await query(
      `SELECT id
       FROM regulatory_data.evidence_sources
       WHERE document_id = $1
         AND (
           ($2::uuid IS NULL AND org_id IS NULL)
           OR org_id = $2::uuid
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [row.document_id, orgId]
    );
  } else {
    existing = await query(
      `SELECT id
       FROM regulatory_data.evidence_sources
       WHERE document_id IS NULL
         AND source_title = $1
         AND COALESCE(storage_path, '') = COALESCE($2, '')
         AND (
           ($3::uuid IS NULL AND org_id IS NULL)
           OR org_id = $3::uuid
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [sourceTitleFor(row), row.storage_path || row.document_file_url || null, orgId]
    );
  }

  const extractionStatus = row.extraction_status === 'failed' ? 'failed' : 'completed';
  const params = [
    orgId,
    row.document_id || null,
    row.source_kind || 'user_upload',
    textOrNull(fields.issuing_authority) || textOrNull(fields.authority_name) || textOrNull(row.authority_name),
    sourceTitleFor(row),
    row.source_url || null,
    row.document_file_url || null,
    row.storage_path || null,
    textOrNull(fields.city) || textOrNull(fields.district),
    textOrNull(fields.plan_version),
    dateOrNull(fields.effective_from),
    dateOrNull(fields.effective_to),
    extractionStatus,
    confidenceFor(scores, '_overall'),
    userId || null,
  ];

  if (existing.rows[0]) {
    const updated = await query(
      `UPDATE regulatory_data.evidence_sources
       SET authority_name = COALESCE($1, authority_name),
           source_kind = COALESCE($2, source_kind),
           source_title = $3,
           source_url = COALESCE($4, source_url),
           file_url = COALESCE($5, file_url),
           storage_path = COALESCE($6, storage_path),
           city = COALESCE($7, city),
           plan_version = COALESCE($8, plan_version),
           effective_from = COALESCE($9, effective_from),
           effective_to = COALESCE($10, effective_to),
           extraction_status = $11,
           confidence_score = COALESCE($12, confidence_score),
           notes = 'Auto-created from document extraction; human approval required before use.',
           updated_at = NOW()
       WHERE id = $13
       RETURNING id`,
      [
        params[3],
        params[2],
        params[4],
        params[5],
        params[6],
        params[7],
        params[8],
        params[9],
        params[10],
        params[11],
        params[12],
        params[13],
        existing.rows[0].id,
      ]
    );
    return updated.rows[0].id;
  }

  const created = await query(
    `INSERT INTO regulatory_data.evidence_sources (
       org_id,
       document_id,
       source_kind,
       authority_name,
       source_title,
       source_url,
       file_url,
       storage_path,
       city,
       plan_version,
       effective_from,
       effective_to,
       extraction_status,
       review_status,
       confidence_score,
       approved_facts,
       notes,
       created_by
     )
     VALUES (
       COALESCE($1::uuid, current_organization_id()),
       $2,
       $3,
       $4,
       $5,
       $6,
       $7,
       $8,
       $9,
       $10,
       $11,
       $12,
       $13,
       'pending',
       $14,
       '{}'::jsonb,
       'Auto-created from document extraction; human approval required before use.',
       $15
     )
     RETURNING id`,
    params
  );

  return created.rows[0].id;
};

const buildEvidenceFacts = ({ docType, fields, scores }) => {
  const facts = [];
  const page = pageOrNull(fields.source_page);
  const sourceSection = textOrNull(fields.source_section) || textOrNull(fields.table_number);

  for (const [key, value] of Object.entries(fields)) {
    if (FACT_EXCLUDED_KEYS.has(key) || !hasValue(value)) continue;
    facts.push({
      fact_type: docType,
      fact_key: key,
      fact_value: value,
      page_number: page,
      source_section: sourceSection,
      confidence_score: confidenceFor(scores, key),
    });
  }

  if (docType === 'rmp_table' && Array.isArray(fields.rules) && fields.rules.length > 0) {
    facts.push({
      fact_type: 'rmp_table',
      fact_key: 'rule_count',
      fact_value: fields.rules.length,
      page_number: page,
      source_section: sourceSection,
      confidence_score: confidenceFor(scores, 'rules'),
    });
  }

  if (ROW_COUNT_FACT_DOC_TYPES.has(docType) && Array.isArray(fields.rows) && fields.rows.length > 0) {
    facts.push({
      fact_type: docType,
      fact_key: 'row_count',
      fact_value: fields.rows.length,
      page_number: page,
      source_section: sourceSection,
      confidence_score: confidenceFor(scores, 'rows', confidenceFor(scores, '_overall')),
    });
  }

  return facts;
};

const replacePendingFacts = async ({ sourceId, orgId, userId, facts }) => {
  await query(
    `DELETE FROM regulatory_data.evidence_facts
     WHERE source_id = $1
       AND review_status = 'pending'`,
    [sourceId]
  );

  let created = 0;
  for (const fact of facts) {
    await query(
      `INSERT INTO regulatory_data.evidence_facts (
         source_id,
         org_id,
         fact_type,
         fact_key,
         fact_value,
         page_number,
         source_section,
         confidence_score,
         review_status,
         created_by
       )
       VALUES ($1, COALESCE($2::uuid, current_organization_id()), $3, $4, $5::jsonb, $6, $7, $8, 'pending', $9)`,
      [
        sourceId,
        orgId,
        fact.fact_type,
        fact.fact_key,
        JSON.stringify(fact.fact_value),
        fact.page_number,
        fact.source_section,
        fact.confidence_score,
        userId || null,
      ]
    );
    created += 1;
  }

  return created;
};

const insertGuidanceValueCandidate = async ({ sourceId, orgId, fields, scores }) => {
  const locality = textOrNull(fields.locality);
  const valueSqft = numberOrNull(fields.guidance_value_per_sqft || fields.value_inr_per_sqft);
  const valueAcre = numberOrNull(fields.guidance_value_per_acre || fields.value_inr_per_acre);

  if (!locality || (valueSqft === null && valueAcre === null)) {
    return 0;
  }

  const row = {
    city: textOrNull(fields.city) || textOrNull(fields.district),
    sro_name: textOrNull(fields.sro_name) || textOrNull(fields.sub_registrar_office),
    locality,
    road_name: textOrNull(fields.road_name),
    land_use_type: textOrNull(fields.land_use_type) || 'unspecified',
    value_inr_per_sqft: valueSqft,
    value_inr_per_acre: valueAcre,
    unit_type: textOrNull(fields.unit) || (valueSqft !== null ? 'sqft' : 'acre'),
    effective_from: dateOrNull(fields.effective_from),
    effective_to: dateOrNull(fields.effective_to),
    source_page: pageOrNull(fields.source_page),
    source_section: textOrNull(fields.source_section),
    confidence_score: confidenceFor(scores, '_overall'),
  };

  const duplicate = await query(
    `SELECT id
     FROM regulatory_data.guidance_values
     WHERE evidence_source_id = $1
       AND locality IS NOT DISTINCT FROM $2
       AND road_name IS NOT DISTINCT FROM $3
       AND land_use_type IS NOT DISTINCT FROM $4
       AND value_inr_per_sqft IS NOT DISTINCT FROM $5
       AND value_inr_per_acre IS NOT DISTINCT FROM $6
     LIMIT 1`,
    [
      sourceId,
      row.locality,
      row.road_name,
      row.land_use_type,
      row.value_inr_per_sqft,
      row.value_inr_per_acre,
    ]
  );

  if (duplicate.rows[0]) {
    return 0;
  }

  await query(
    `INSERT INTO regulatory_data.guidance_values (
       org_id,
       evidence_source_id,
       city,
       sro_name,
       locality,
       road_name,
       land_use_type,
       value_inr_per_sqft,
       value_inr_per_acre,
       unit_type,
       effective_from,
       effective_to,
       source_page,
       source_section,
       review_status,
       confidence_score,
       notes
     )
     VALUES (
       COALESCE($1::uuid, current_organization_id()),
       $2,
       $3,
       $4,
       $5,
       $6,
       $7,
       $8,
       $9,
       $10,
       $11,
       $12,
       $13,
       $14,
       'pending',
       $15,
       'Proposed from document extraction; verify against source before approval.'
     )`,
    [
      orgId,
      sourceId,
      row.city,
      row.sro_name,
      row.locality,
      row.road_name,
      row.land_use_type,
      row.value_inr_per_sqft,
      row.value_inr_per_acre,
      row.unit_type,
      row.effective_from,
      row.effective_to,
      row.source_page,
      row.source_section,
      row.confidence_score,
    ]
  );

  return 1;
};

// IGR PDFs list dozens of localities per page. Gemini structured extraction may miss rows the
// regex parser catches (and vice versa); we run both, then rely on the SQL dedup inside
// insertGuidanceValueCandidate to keep candidates unique on (locality, road, value).
const buildGuidanceFieldsFromRow = (row, headerFields) => {
  const unit = textOrNull(row.unit_type) || textOrNull(row.unit);
  const value = numberOrNull(row.value);
  return {
    city: textOrNull(row.city) || textOrNull(headerFields.city) || textOrNull(headerFields.district),
    sro_name: textOrNull(row.sro_name) || textOrNull(headerFields.sro_name),
    locality: textOrNull(row.locality),
    road_name: textOrNull(row.road_name),
    land_use_type: textOrNull(row.land_use_type) || textOrNull(headerFields.land_use_type) || 'unspecified',
    guidance_value_per_sqft: unit === 'sqft' && value !== null ? value : numberOrNull(row.guidance_value_per_sqft),
    guidance_value_per_acre: unit === 'acre' && value !== null ? value : numberOrNull(row.guidance_value_per_acre),
    unit,
    effective_from: dateOrNull(row.effective_from) || dateOrNull(headerFields.effective_from),
    effective_to: dateOrNull(row.effective_to) || dateOrNull(headerFields.effective_to),
    source_page: pageOrNull(row.source_page) || pageOrNull(headerFields.source_page),
    source_section: textOrNull(row.source_section) || textOrNull(headerFields.source_section),
  };
};

const insertIgrGuidanceCandidates = async ({ sourceId, orgId, fields, scores }) => {
  const headerFields = {
    city: fields.city,
    district: fields.district,
    sro_name: fields.sro_name,
    land_use_type: fields.land_use_type,
    effective_from: fields.effective_from,
    effective_to: fields.effective_to,
    source_page: fields.source_page,
    source_section: fields.source_section,
  };

  let created = 0;
  const overallScore = confidenceFor(scores, '_overall');

  if (Array.isArray(fields.rows)) {
    for (const row of fields.rows) {
      const mergedFields = buildGuidanceFieldsFromRow(row, headerFields);
      const rowScore = numberOrNull(row.confidence);
      const rowScores = { _overall: rowScore !== null ? rowScore : overallScore };
      created += await insertGuidanceValueCandidate({
        sourceId,
        orgId,
        fields: mergedFields,
        scores: rowScores,
      });
    }
  }

  const rawText = textOrNull(fields.raw_text);
  if (rawText) {
    const parsed = igrPdfAdapter.parseGuidanceText(rawText, {
      sro_name: headerFields.sro_name,
      page_number: headerFields.source_page,
      source_section: headerFields.source_section,
      land_use_type: headerFields.land_use_type || 'residential',
    });

    for (const row of parsed.rows || []) {
      const mergedFields = buildGuidanceFieldsFromRow(row, headerFields);
      const rowScores = { _overall: numberOrNull(row.confidence) };
      created += await insertGuidanceValueCandidate({
        sourceId,
        orgId,
        fields: mergedFields,
        scores: rowScores,
      });
    }
  }

  return created;
};

const normalizedRulesFrom = (fields) => {
  if (Array.isArray(fields.rules)) return fields.rules;
  if (hasValue(fields.land_use_family) || hasValue(fields.base_far) || hasValue(fields.max_far)) {
    return [fields];
  }
  return [];
};

const insertFarRuleCandidates = async ({ sourceId, orgId, fields, scores }) => {
  let created = 0;
  const rules = normalizedRulesFrom(fields);

  for (const rule of rules) {
    const landUseFamily = textOrNull(rule.land_use_family);
    const baseFar = numberOrNull(rule.base_far);
    const maxFar = numberOrNull(rule.max_far);
    if (!landUseFamily || baseFar === null || maxFar === null) continue;

    const sourceSection = textOrNull(rule.source_section)
      || textOrNull(fields.source_section)
      || textOrNull(fields.table_number);

    const candidate = {
      city: textOrNull(rule.city) || textOrNull(fields.city),
      plan_version: textOrNull(rule.plan_version) || textOrNull(fields.plan_version),
      zone_code: textOrNull(rule.zone_code),
      planning_zone: textOrNull(rule.planning_zone),
      land_use_family: landUseFamily,
      plot_area_min_sqm: numberOrNull(rule.plot_area_min_sqm),
      plot_area_max_sqm: numberOrNull(rule.plot_area_max_sqm),
      road_width_min_m: numberOrNull(rule.road_width_min_m),
      road_width_max_m: numberOrNull(rule.road_width_max_m),
      base_far: baseFar,
      additional_far: numberOrNull(rule.additional_far),
      max_far: maxFar,
      ground_coverage_pct: numberOrNull(rule.ground_coverage_pct),
      front_setback_m: numberOrNull(rule.front_setback_m),
      rear_setback_m: numberOrNull(rule.rear_setback_m),
      side_setback_m: numberOrNull(rule.side_setback_m),
      tdr_eligible: typeof rule.tdr_eligible === 'boolean' ? rule.tdr_eligible : null,
      premium_far_cap: numberOrNull(rule.premium_far_cap),
      tdr_road_threshold_m: numberOrNull(rule.tdr_road_threshold_m),
      source_page: pageOrNull(rule.source_page) || pageOrNull(fields.source_page),
      source_section: sourceSection,
      rule_notes: textOrNull(rule.rule_notes) || textOrNull(rule.notes),
      confidence_score: confidenceFor(scores, 'rules', confidenceFor(scores, '_overall')),
    };

    const duplicate = await query(
      `SELECT id
       FROM regulatory_data.far_rules
       WHERE evidence_source_id = $1
         AND zone_code IS NOT DISTINCT FROM $2
         AND planning_zone IS NOT DISTINCT FROM $3
         AND land_use_family = $4
         AND plot_area_min_sqm IS NOT DISTINCT FROM $5
         AND plot_area_max_sqm IS NOT DISTINCT FROM $6
         AND road_width_min_m IS NOT DISTINCT FROM $7
         AND road_width_max_m IS NOT DISTINCT FROM $8
         AND base_far = $9
         AND max_far = $10
       LIMIT 1`,
      [
        sourceId,
        candidate.zone_code,
        candidate.planning_zone,
        candidate.land_use_family,
        candidate.plot_area_min_sqm,
        candidate.plot_area_max_sqm,
        candidate.road_width_min_m,
        candidate.road_width_max_m,
        candidate.base_far,
        candidate.max_far,
      ]
    );

    if (duplicate.rows[0]) continue;

    await query(
      `INSERT INTO regulatory_data.far_rules (
         org_id,
         evidence_source_id,
         city,
         plan_version,
         plan_status,
         zone_code,
         planning_zone,
         land_use_family,
         plot_area_min_sqm,
         plot_area_max_sqm,
         road_width_min_m,
         road_width_max_m,
         base_far,
         additional_far,
         max_far,
         ground_coverage_pct,
         front_setback_m,
         rear_setback_m,
         side_setback_m,
         tdr_eligible,
         premium_far_cap,
         tdr_road_threshold_m,
         source_page,
         source_section,
         rule_notes,
         confidence_score,
         review_status
       )
       VALUES (
         COALESCE($1::uuid, current_organization_id()),
         $2,
         $3,
         $4,
         'draft_reference',
         $5,
         $6,
         $7,
         $8,
         $9,
         $10,
         $11,
         $12,
         $13,
         $14,
         $15,
         $16,
         $17,
         $18,
         $19,
         $20,
         $21,
         $22,
         $23,
         $24,
         $25,
         'pending'
       )`,
      [
        orgId,
        sourceId,
        candidate.city,
        candidate.plan_version,
        candidate.zone_code,
        candidate.planning_zone,
        candidate.land_use_family,
        candidate.plot_area_min_sqm,
        candidate.plot_area_max_sqm,
        candidate.road_width_min_m,
        candidate.road_width_max_m,
        candidate.base_far,
        candidate.additional_far,
        candidate.max_far,
        candidate.ground_coverage_pct,
        candidate.front_setback_m,
        candidate.rear_setback_m,
        candidate.side_setback_m,
        candidate.tdr_eligible,
        candidate.premium_far_cap,
        candidate.tdr_road_threshold_m,
        candidate.source_page,
        candidate.source_section,
        candidate.rule_notes,
        candidate.confidence_score,
      ]
    );
    created += 1;
  }

  return created;
};

const normalizedZonesFrom = (fields) => {
  if (Array.isArray(fields.zones)) return fields.zones;
  if (
    hasValue(fields.zone_code)
    && (hasValue(fields.zone_name) || hasValue(fields.zoning_classification))
  ) {
    return [fields];
  }
  return [];
};

const upsertPlanningDistrict = async ({ city, district }) => {
  const code = textOrNull(district?.pd_code || district?.planning_district_code || district?.code);
  if (!code) return null;

  const result = await query(
    `INSERT INTO regulatory_data.planning_districts (pd_code, pd_name, city)
     VALUES ($1, $2, COALESCE($3, 'Bengaluru'))
     ON CONFLICT (pd_code) DO UPDATE
       SET pd_name = COALESCE(EXCLUDED.pd_name, regulatory_data.planning_districts.pd_name),
           city = COALESCE(EXCLUDED.city, regulatory_data.planning_districts.city)
     RETURNING id`,
    [
      code,
      textOrNull(district?.pd_name || district?.planning_district_name || district?.name),
      city,
    ],
  );

  return result.rows[0]?.id || null;
};

const buildPlanningDistrictMap = async ({ fields, city }) => {
  const map = new Map();
  const districts = Array.isArray(fields.planning_districts) ? fields.planning_districts : [];

  for (const district of districts) {
    const code = textOrNull(district?.pd_code || district?.planning_district_code || district?.code);
    if (!code) continue;
    const id = await upsertPlanningDistrict({ city, district });
    if (id) map.set(code, id);
  }

  return map;
};

const insertMasterPlanZoneCandidates = async ({
  sourceId,
  orgId,
  fields,
  scores,
  masterPlanDocumentId = null,
}) => {
  const zones = normalizedZonesFrom(fields);
  if (!zones.length) return 0;

  const city = textOrNull(fields.city) || textOrNull(fields.district) || 'Bengaluru';
  const planVersion = textOrNull(fields.plan_version);
  const pdMap = await buildPlanningDistrictMap({ fields, city });
  let created = 0;

  for (const zone of zones) {
    const zoneCode = textOrNull(zone.zone_code || zone.code);
    const zoneName = textOrNull(zone.zone_name || zone.name || zone.zoning_classification);
    if (!zoneCode || !zoneName) continue;

    const pdCode = textOrNull(
      zone.planning_district_code
        || zone.pd_code
        || fields.planning_district_code
        || fields.pd_code,
    );
    let planningDistrictId = pdCode ? pdMap.get(pdCode) : null;
    if (!planningDistrictId && pdCode) {
      planningDistrictId = await upsertPlanningDistrict({
        city,
        district: {
          pd_code: pdCode,
          pd_name: zone.planning_district_name || fields.planning_district_name,
        },
      });
    }

    const sourceSection = textOrNull(zone.source_section)
      || textOrNull(fields.source_section)
      || textOrNull(fields.table_number);

    const duplicate = await query(
      `SELECT id
       FROM regulatory_data.master_plan_zones
       WHERE document_id IS NOT DISTINCT FROM $1::uuid
         AND zone_code = $2
         AND plan_version IS NOT DISTINCT FROM $3
         AND planning_district_id IS NOT DISTINCT FROM $4::uuid
       LIMIT 1`,
      [
        masterPlanDocumentId,
        zoneCode.toUpperCase(),
        textOrNull(zone.plan_version) || planVersion,
        planningDistrictId,
      ],
    );

    if (duplicate.rows[0]) continue;

    const inserted = await query(
      `INSERT INTO regulatory_data.master_plan_zones (
         document_id,
         planning_district_id,
         city,
         plan_version,
         zone_code,
         zone_name,
         permissible_fsi_base,
         permissible_fsi_max,
         fsi_road_width_rules,
         ground_coverage_pct,
         building_height_max_m,
         road_width_min_m,
         setback_rules,
         permissible_uses,
         prohibited_uses,
         notes,
         source_page,
         source_section,
         confidence_score,
         review_status
       )
       VALUES (
         $1::uuid,
         $2::uuid,
         COALESCE($3, 'Bengaluru'),
         $4,
         $5,
         $6,
         $7,
         $8,
         $9::jsonb,
         $10,
         $11,
         $12,
         $13::jsonb,
         $14,
         $15,
         $16,
         $17,
         $18,
         $19,
         'pending'
       )
       ON CONFLICT (zone_code, plan_version, planning_district_id) DO NOTHING
       RETURNING id`,
      [
        masterPlanDocumentId,
        planningDistrictId,
        textOrNull(zone.city) || city,
        textOrNull(zone.plan_version) || planVersion,
        zoneCode.toUpperCase(),
        zoneName,
        numberOrNull(zone.permissible_fsi_base || zone.base_fsi || zone.base_far),
        numberOrNull(zone.permissible_fsi_max || zone.max_fsi || zone.max_far),
        JSON.stringify(Array.isArray(zone.fsi_road_width_rules) ? zone.fsi_road_width_rules : []),
        numberOrNull(zone.ground_coverage_pct),
        numberOrNull(zone.building_height_max_m),
        numberOrNull(zone.road_width_min_m),
        JSON.stringify(isObject(zone.setback_rules) ? zone.setback_rules : {}),
        Array.isArray(zone.permissible_uses) ? zone.permissible_uses.map(String) : [],
        Array.isArray(zone.prohibited_uses) ? zone.prohibited_uses.map(String) : [],
        textOrNull(zone.notes)
          || `Proposed from source ${sourceId}; human approval required before use.`,
        pageOrNull(zone.source_page) || pageOrNull(fields.source_page),
        sourceSection,
        confidenceFor(scores, 'zones', confidenceFor(scores, '_overall')),
      ],
    );
    if (inserted.rows[0]) created += 1;
  }

  return created;
};

async function ingestRegulatoryFields({
  docType,
  fields,
  scores = {},
  source = {},
  userId = null,
} = {}) {
  if (!REGULATORY_DOC_TYPES.has(docType)) {
    return { skipped: true, reason: 'unsupported_doc_type', doc_type: docType || null };
  }

  if (!hasValue(fields)) {
    return { skipped: true, reason: 'no_structured_fields', doc_type: docType };
  }

  const row = {
    id: source.extraction_id || null,
    doc_type: docType,
    extraction_status: source.extraction_status || 'completed',
    organization_id: source.org_id || source.organization_id || null,
    document_organization_id: source.org_id || source.document_organization_id || null,
    document_id: source.document_id || null,
    document_name: source.document_name || source.source_title || source.file_name,
    document_file_url: source.file_url || null,
    storage_path: source.storage_path || null,
    source_url: source.source_url || null,
    source_kind: source.source_kind || 'user_upload',
    authority_name: source.authority_name || null,
  };

  const orgId = row.organization_id || row.document_organization_id || null;
  const sourceId = await findOrCreateSource({ row, fields, scores, userId });
  const facts = buildEvidenceFacts({ docType, fields, scores });

  const evidenceFactsCreated = await replacePendingFacts({
    sourceId,
    orgId,
    userId,
    facts,
  });

  let guidanceValuesCreated = 0;
  if (docType === 'guidance_value_report') {
    guidanceValuesCreated = await insertGuidanceValueCandidate({ sourceId, orgId, fields, scores });
  } else if (docType === 'igr_guidance_pdf') {
    guidanceValuesCreated = await insertIgrGuidanceCandidates({ sourceId, orgId, fields, scores });
  }

  const farRulesCreated = docType === 'rmp_table'
    ? await insertFarRuleCandidates({ sourceId, orgId, fields, scores })
    : 0;

  const zonesCreated = docType === 'rmp_table' || docType === 'zoning_certificate'
    ? await insertMasterPlanZoneCandidates({
      sourceId,
      orgId,
      fields,
      scores,
      masterPlanDocumentId: source.master_plan_document_id || null,
    })
    : 0;

  return {
    skipped: false,
    source_id: sourceId,
    evidence_facts_created: evidenceFactsCreated,
    guidance_values_created: guidanceValuesCreated,
    far_rules_created: farRulesCreated,
    zones_created: zonesCreated,
  };
}

async function ingestExtraction(extractionId, userId = null) {
  const row = await loadExtraction(extractionId);
  if (!row) {
    return { skipped: true, reason: 'extraction_not_found' };
  }

  const docType = row.doc_type;
  if (!REGULATORY_DOC_TYPES.has(docType)) {
    return { skipped: true, reason: 'unsupported_doc_type', doc_type: docType || null };
  }

  const baseFields = parseJsonField(row.structured_fields);
  const corrections = parseJsonField(row.human_corrections);
  const fields = mergeStructuredFields(baseFields, corrections);
  if (!hasValue(fields)) {
    return { skipped: true, reason: 'no_structured_fields', doc_type: docType };
  }

  const scores = parseJsonField(row.confidence_scores);
  return ingestRegulatoryFields({
    docType,
    fields,
    scores,
    source: row,
    userId,
  });
}

module.exports = {
  REGULATORY_DOC_TYPES,
  buildEvidenceFacts,
  ingestRegulatoryFields,
  ingestExtraction,
};
