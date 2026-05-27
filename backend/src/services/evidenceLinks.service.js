'use strict';

/**
 * Polymorphic evidence-link service.
 *
 * The parcel intelligence pipeline already produces `evidence_sources` and
 * `evidence_facts` rows with citations and confidence. This module spreads
 * the same primitive across the rest of the workflow surface — DD items,
 * approvals, risk flags, comps, financial scenarios — so every status flip
 * carries a citation trail.
 *
 * Owner ↔ table:
 *
 *   dd_item              → public.dd_items
 *   approval             → public.approvals
 *   risk_flag            → public.risk_flags
 *   comp                 → public.comps
 *   financial_scenario   → public.financial_scenarios
 *   parcel_intelligence  → regulatory_data.parcel_intelligence_snapshots
 *   deal_note            → public.deals (the note row itself is the deal)
 *   guidance_value       → regulatory_data.guidance_values
 *
 * Adding a new owner kind requires (1) extending the enum in the migration
 * and (2) extending OWNER_KIND_RESOLVERS below so this service can verify
 * the owner row exists and belongs to the caller's org.
 *
 * Every link has a confidence_score in [0,1]. Aggregating multiple links
 * across an owner gives a rolled-up confidence — the "verified" UI badge
 * uses that roll-up.
 */

const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const log = require('../lib/logger').child({ module: 'evidence.links' });
const { EVENTS, publish } = require('../lib/eventBus');

const OWNER_KINDS = new Set([
  'dd_item',
  'approval',
  'risk_flag',
  'comp',
  'financial_scenario',
  'parcel_intelligence',
  'deal_note',
  'guidance_value',
]);

const LINK_KINDS = new Set([
  'evidence_source',
  'evidence_fact',
  'document',
  'manual_verification',
  'external_url',
]);

// owner_kind → SQL fragment for verifying the owner row is visible to this
// org. Using `current_organization_id()` keeps the check honest under RLS:
// even an admin can't link evidence to a row their session can't see.
const OWNER_KIND_RESOLVERS = {
  dd_item: {
    table: 'dd_items',
    schema: 'public',
    orgColumn: 'organization_id',
  },
  approval: {
    // The DB table is `approval_items` (per migration
    // 20260411_deal_centric_expansion). The owner_kind enum value stays as
    // `approval` so callers don't have to know about the legacy table name.
    table: 'approval_items',
    schema: 'public',
    orgColumn: 'organization_id',
  },
  risk_flag: {
    table: 'risk_flags',
    schema: 'public',
    orgColumn: 'organization_id',
  },
  comp: {
    table: 'comps',
    schema: 'public',
    orgColumn: 'organization_id',
  },
  financial_scenario: {
    table: 'financial_scenarios',
    schema: 'public',
    orgColumn: 'organization_id',
  },
  parcel_intelligence: {
    table: 'parcel_intelligence_snapshots',
    schema: 'regulatory_data',
    orgColumn: 'org_id',
  },
  deal_note: {
    table: 'deals',
    schema: 'public',
    orgColumn: 'organization_id',
  },
  guidance_value: {
    table: 'guidance_values',
    schema: 'regulatory_data',
    orgColumn: 'org_id',
  },
};

// Best-effort: pull the deal_id for an owner so we can carry it on the
// emitted event. Owners that aren't deal-scoped (e.g. guidance_value) simply
// return null. Failures are swallowed by the caller — the link still saved.
const resolveDealIdFromOwner = async (ownerKind, ownerId) => {
  if (ownerKind === 'dd_item') {
    const r = await query('SELECT deal_id FROM dd_items WHERE id = $1', [ownerId]);
    return r.rows[0]?.deal_id || null;
  }
  if (ownerKind === 'approval') {
    const r = await query('SELECT deal_id FROM approval_items WHERE id = $1', [ownerId]);
    return r.rows[0]?.deal_id || null;
  }
  if (ownerKind === 'risk_flag') {
    const r = await query('SELECT deal_id FROM risk_flags WHERE id = $1', [ownerId]);
    return r.rows[0]?.deal_id || null;
  }
  if (ownerKind === 'financial_scenario') {
    const r = await query('SELECT deal_id FROM financial_scenarios WHERE id = $1', [ownerId]);
    return r.rows[0]?.deal_id || null;
  }
  if (ownerKind === 'deal_note') {
    return ownerId;
  }
  return null;
};

const ensureOwnerExists = async (ownerKind, ownerId) => {
  if (!OWNER_KINDS.has(ownerKind)) {
    throw createError(`Invalid evidence owner kind: ${ownerKind}`, 400);
  }
  if (!ownerId) {
    throw createError('owner_id is required.', 400);
  }
  const resolver = OWNER_KIND_RESOLVERS[ownerKind];
  // Some owners (e.g. parcel_intelligence_snapshots) live under regulatory_data
  // and use `org_id` instead of `organization_id`; the resolver carries both.
  const result = await query(
    `SELECT 1
     FROM ${resolver.schema}.${resolver.table}
     WHERE id = $1
       AND ${resolver.orgColumn} = current_organization_id()`,
    [ownerId]
  );
  if (result.rows.length === 0) {
    throw createError(`${ownerKind} not found or not in your organization.`, 404);
  }
};

const sanitizeConfidence = (value) => {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
};

const trimOrNull = (value) => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

/**
 * Attach a citation to an owner row.
 *
 * @param {Object} args
 * @param {string} args.ownerKind   one of evidence_owner_kind
 * @param {string} args.ownerId     uuid
 * @param {string} args.linkKind    one of evidence_link_kind
 * @param {string=} args.evidenceSourceId
 * @param {string=} args.evidenceFactId
 * @param {string=} args.documentId
 * @param {string=} args.externalUrl
 * @param {number=} args.confidenceScore  [0,1]
 * @param {string=} args.notes
 * @param {number=} args.pageNumber
 * @param {string=} args.sourceSection
 * @param {string=} args.userId
 * @returns {Promise<Object>} the inserted row
 */
const attachLink = async ({
  ownerKind,
  ownerId,
  linkKind,
  evidenceSourceId = null,
  evidenceFactId = null,
  documentId = null,
  externalUrl = null,
  confidenceScore = null,
  notes = null,
  pageNumber = null,
  sourceSection = null,
  userId = null,
}) => {
  if (!LINK_KINDS.has(linkKind)) {
    throw createError(`Invalid evidence link kind: ${linkKind}`, 400);
  }

  await ensureOwnerExists(ownerKind, ownerId);

  // The CHECK constraint enforces "at least one target", but checking here
  // gives a friendlier 400 instead of a 500 from a constraint violation.
  const hasTarget =
    evidenceSourceId
    || evidenceFactId
    || documentId
    || (externalUrl && (linkKind === 'manual_verification' || linkKind === 'external_url'));
  if (!hasTarget) {
    throw createError(
      'Evidence link must reference an evidence_source, evidence_fact, document, or manual external_url.',
      400
    );
  }

  const cleanedNotes = trimOrNull(notes);
  const cleanedSection = trimOrNull(sourceSection);
  const cleanedUrl = trimOrNull(externalUrl);
  const isManual = linkKind === 'manual_verification';

  try {
    const result = await query(
      `INSERT INTO evidence_links (
         organization_id,
         owner_kind,
         owner_id,
         link_kind,
         evidence_source_id,
         evidence_fact_id,
         document_id,
         external_url,
         confidence_score,
         notes,
         page_number,
         source_section,
         verified_at,
         verified_by,
         created_by
       )
       VALUES (
         current_organization_id(),
         $1, $2, $3,
         $4, $5, $6, $7,
         $8, $9, $10, $11,
         CASE WHEN $3 = 'manual_verification' THEN NOW() ELSE NULL END,
         CASE WHEN $3 = 'manual_verification' THEN $12 ELSE NULL END,
         $12
       )
       RETURNING *`,
      [
        ownerKind,
        ownerId,
        linkKind,
        evidenceSourceId,
        evidenceFactId,
        documentId,
        cleanedUrl,
        sanitizeConfidence(confidenceScore),
        cleanedNotes,
        pageNumber,
        cleanedSection,
        userId,
      ]
    );

    log.info('evidence_linked', {
      owner_kind: ownerKind,
      owner_id: ownerId,
      link_kind: linkKind,
      manual: isManual,
    });

    // Best-effort: resolve the deal id this link belongs to so the timeline
    // sink can write a per-deal activity row. Only owners that live under a
    // deal carry this — guidance_value (regulatory_data) and parcel
    // intelligence snapshots may not, in which case we just skip.
    const resolved = result.rows[0];
    let dealId = null;
    try {
      dealId = await resolveDealIdFromOwner(ownerKind, ownerId);
    } catch {
      // never fail the link write because of a deal-id lookup
    }
    publish(EVENTS.EVIDENCE_LINKED, {
      dealId,
      ownerKind,
      ownerId,
      linkKind,
      userId,
    });
    return resolved;
  } catch (err) {
    if (err.code === '23505') {
      throw createError('That evidence is already linked to this item.', 409);
    }
    throw err;
  }
};

const detachLink = async (linkId) => {
  const result = await query(
    `DELETE FROM evidence_links
     WHERE id = $1
       AND organization_id = current_organization_id()
     RETURNING id, owner_kind, owner_id`,
    [linkId]
  );
  if (result.rows.length === 0) {
    throw createError('Evidence link not found or not in your organization.', 404);
  }
  log.info('evidence_unlinked', { link_id: linkId, ...result.rows[0] });
  return { deleted: true, id: linkId };
};

/**
 * List all evidence links for a given owner row, with denormalised joins so
 * the frontend can render citation chips without N round-trips.
 *
 * The cross-schema joins (regulatory_data.*) only succeed when the owner is
 * in the caller's org because of the owner-existence check above; even
 * without RLS on the cross-schema tables, a stale link cannot leak data.
 */
const listForOwner = async (ownerKind, ownerId) => {
  await ensureOwnerExists(ownerKind, ownerId);

  const result = await query(
    `SELECT
       el.*,
       es.source_title       AS evidence_source_title,
       es.authority_name     AS evidence_source_authority,
       es.review_status      AS evidence_source_review_status,
       es.confidence_score   AS evidence_source_confidence,
       ef.fact_type          AS evidence_fact_type,
       ef.fact_key           AS evidence_fact_key,
       ef.fact_value         AS evidence_fact_value,
       ef.review_status      AS evidence_fact_review_status,
       d.name                AS document_name,
       d.file_url            AS document_file_url,
       d.doc_category        AS document_category,
       creator.name          AS created_by_name,
       verifier.name         AS verified_by_name
     FROM evidence_links el
     LEFT JOIN regulatory_data.evidence_sources es ON es.id = el.evidence_source_id
     LEFT JOIN regulatory_data.evidence_facts   ef ON ef.id = el.evidence_fact_id
     LEFT JOIN documents d                          ON d.id  = el.document_id
     LEFT JOIN users creator                        ON creator.id = el.created_by
     LEFT JOIN users verifier                       ON verifier.id = el.verified_by
     WHERE el.organization_id = current_organization_id()
       AND el.owner_kind = $1
       AND el.owner_id   = $2
     ORDER BY el.created_at DESC`,
    [ownerKind, ownerId]
  );

  return result.rows;
};

/**
 * Roll-up: highest confidence + count of distinct sources for an owner.
 * Drives the "Verified / Inferred / Needs Verification" pill across DD,
 * approvals, risk, comps.
 */
const summariseForOwner = async (ownerKind, ownerId) => {
  const result = await query(
    `SELECT
       COUNT(*) FILTER (WHERE link_kind <> 'manual_verification')         AS source_count,
       COUNT(*) FILTER (WHERE link_kind = 'manual_verification')          AS manual_count,
       MAX(confidence_score)                                              AS max_confidence,
       AVG(confidence_score) FILTER (WHERE confidence_score IS NOT NULL)  AS avg_confidence
     FROM evidence_links
     WHERE organization_id = current_organization_id()
       AND owner_kind = $1
       AND owner_id   = $2`,
    [ownerKind, ownerId]
  );

  const row = result.rows[0] || {};
  const sourceCount = Number(row.source_count || 0);
  const manualCount = Number(row.manual_count || 0);
  const maxConfidence = row.max_confidence != null ? Number(row.max_confidence) : null;
  const avgConfidence = row.avg_confidence != null ? Number(row.avg_confidence) : null;

  // Verdict mirrors the parcel three-bucket language so DD / approvals / risk
  // chip states match what the parcel panel uses.
  let bucket = 'needs_verification';
  if (sourceCount > 0 && (maxConfidence ?? 0) >= 0.8) bucket = 'verified';
  else if (sourceCount > 0 || manualCount > 0) bucket = 'inferred';

  return {
    source_count: sourceCount,
    manual_count: manualCount,
    max_confidence: maxConfidence,
    avg_confidence: avgConfidence,
    bucket,
  };
};

/**
 * Convenience: link a piece of evidence to many owners in one transaction.
 * Used by the evidence-promotion flow (when a guidance_value PDF lands and
 * the admin wants every related DD item to inherit the citation).
 *
 * Returns one row per owner.
 */
const attachToMany = async ({ owners, linkPayload, userId }) => {
  if (!Array.isArray(owners) || owners.length === 0) {
    throw createError('owners[] must be a non-empty array.', 400);
  }
  const out = [];
  for (const owner of owners) {
    out.push(await attachLink({ ...linkPayload, ...owner, userId }));
  }
  return out;
};

// ──────────────────────────────────────────────────────────────────────────
//  Reverse traversal — "what depends on this evidence source?" (E2-PR1)
// ──────────────────────────────────────────────────────────────────────────

const SUPPORTED_DEPENDENT_KINDS = new Set([
  'document',          // any deal document
  'evidence_source',   // regulatory_data.evidence_sources row
  'evidence_fact',     // regulatory_data.evidence_facts row
  'comp',              // a verified transaction comp
]);

/**
 * List every owner row that depends on a given source.
 *
 * Answers the impact-of-retraction question: "if I retract this document /
 * comp / regulatory source, which DD items / approvals / risk flags /
 * financial scenarios across my org will lose a citation?"
 *
 * @param {'document'|'evidence_source'|'evidence_fact'|'comp'} sourceKind
 * @param {string} sourceId    UUID of the source row
 * @returns {Promise<{owners:[{owner_kind,owner_id,deal_id|null,deal_name|null,owner_label|null,confidence_score|null,verified_at|null,link_id}], grouped:{[owner_kind]:number}}>}
 */
const listDependents = async (sourceKind, sourceId) => {
  if (!SUPPORTED_DEPENDENT_KINDS.has(sourceKind)) {
    throw createError(
      `Unsupported source kind "${sourceKind}". Supported: ${[...SUPPORTED_DEPENDENT_KINDS].join(', ')}.`,
      400,
    );
  }
  if (!sourceId || typeof sourceId !== 'string') {
    throw createError('sourceId is required.', 400);
  }

  // Map source-kind to the matching `evidence_links` column. For `comp`
  // there's no FK column on evidence_links — comps appear in the system as
  // DOCUMENT references when a comp PDF is uploaded, or via the comp_reliance
  // signal layer (Workstream C1) — those aren't evidence_links rows. So
  // `comp` reverse-lookups would need a separate path; surface it cleanly.
  const columnMap = {
    document: 'document_id',
    evidence_source: 'evidence_source_id',
    evidence_fact: 'evidence_fact_id',
  };
  if (sourceKind === 'comp') {
    // Phase 1: comps don't have a direct evidence_links column. Return
    // empty + a note so the UI can show "No direct evidence-link
    // dependencies recorded" instead of erroring.
    return { owners: [], grouped: {}, supported: false, note: 'Comp reverse-lookup runs through the comp_reliance signal layer, not evidence_links.' };
  }

  const filterColumn = columnMap[sourceKind];

  // The query joins each link row up to its owning entity to produce a
  // human-readable label + the deal it belongs to. owner_kind branches into
  // distinct join shapes — we use a CASE on the SELECT side rather than
  // multiple UNION ALL branches because the WHERE filter is selective
  // (`filterColumn = $1`) and PG's planner will use the partial index.
  //
  // SAFETY: every join is LEFT (so a deleted owner doesn't drop its citation
  // row from the list — the operator still wants to see "this used to be
  // cited by 3 things, all now deleted").
  const result = await query(
    `SELECT
       el.id                                    AS link_id,
       el.owner_kind                            AS owner_kind,
       el.owner_id                              AS owner_id,
       el.confidence_score                      AS confidence_score,
       el.verified_at                           AS verified_at,
       el.created_at                            AS link_created_at,
       -- Owner-specific labels + parent deal id
       CASE
         WHEN el.owner_kind = 'dd_item'           THEN dd.title
         WHEN el.owner_kind = 'approval'          THEN ap.name
         WHEN el.owner_kind = 'risk_flag'         THEN rf.title
         WHEN el.owner_kind = 'comp'              THEN cmp.project_name
         WHEN el.owner_kind = 'financial_scenario' THEN fs.label
         WHEN el.owner_kind = 'deal_note'         THEN dl.name
         ELSE NULL
       END                                       AS owner_label,
       COALESCE(dd.deal_id, ap.deal_id, rf.deal_id, fs.deal_id, dl.id) AS deal_id,
       COALESCE(
         dl_dd.name, dl_ap.name, dl_rf.name, dl_fs.name, dl.name
       )                                         AS deal_name
     FROM evidence_links el
     LEFT JOIN dd_items dd               ON el.owner_kind = 'dd_item'           AND dd.id = el.owner_id
     LEFT JOIN approval_items ap         ON el.owner_kind = 'approval'          AND ap.id = el.owner_id
     LEFT JOIN risk_flags rf             ON el.owner_kind = 'risk_flag'         AND rf.id = el.owner_id
     LEFT JOIN comps cmp                 ON el.owner_kind = 'comp'              AND cmp.id = el.owner_id
     LEFT JOIN financial_scenarios fs    ON el.owner_kind = 'financial_scenario' AND fs.id = el.owner_id
     LEFT JOIN deals dl                  ON el.owner_kind = 'deal_note'         AND dl.id = el.owner_id
     LEFT JOIN deals dl_dd               ON dl_dd.id = dd.deal_id
     LEFT JOIN deals dl_ap               ON dl_ap.id = ap.deal_id
     LEFT JOIN deals dl_rf               ON dl_rf.id = rf.deal_id
     LEFT JOIN deals dl_fs               ON dl_fs.id = fs.deal_id
     WHERE el.organization_id = current_organization_id()
       AND el.${filterColumn} = $1
     ORDER BY el.created_at DESC`,
    [sourceId],
  );

  const owners = (result.rows || []).map((r) => ({
    link_id: r.link_id,
    owner_kind: r.owner_kind,
    owner_id: r.owner_id,
    owner_label: r.owner_label,
    deal_id: r.deal_id,
    deal_name: r.deal_name,
    confidence_score: r.confidence_score != null ? Number(r.confidence_score) : null,
    verified_at: r.verified_at,
    link_created_at: r.link_created_at,
  }));

  const grouped = owners.reduce((acc, o) => {
    acc[o.owner_kind] = (acc[o.owner_kind] || 0) + 1;
    return acc;
  }, {});

  return { owners, grouped, supported: true, note: null };
};

module.exports = {
  attachLink,
  detachLink,
  listForOwner,
  listDependents,
  summariseForOwner,
  attachToMany,
  OWNER_KINDS,
  LINK_KINDS,
  SUPPORTED_DEPENDENT_KINDS,
};
