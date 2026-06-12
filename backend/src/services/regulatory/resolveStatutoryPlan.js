'use strict';

/**
 * Statutory-plan resolver (Workstream 0 — the legal spine)
 * --------------------------------------------------------
 * Given a parcel's administrative hierarchy (and optional coordinates),
 * determine WHICH planning authority and WHICH operative master plan govern it,
 * so its FAR rules can be scoped to the correct rulebook.
 *
 * TABULAR-FIRST. The PRIMARY signal is the K-GIS-detected taluk / village NAME
 * matched against `planning_authorities.taluk_aliases` — no polygon required and
 * available today. (Point-in-polygon against admin-boundary geometry is a later
 * refinement, only where we actually hold the boundary.) This deliberately does
 * NOT route on user-typed `property.city`, which is unreliable.
 *
 * HONEST DEGRADATION (CLAUDE.md hard rules):
 *   - Never throws. If the registry tables are absent (migration not applied) or
 *     the query fails, returns an `unresolved` result and the caller behaves
 *     exactly as before (no plan scoping) — so this code is safe to ship before
 *     the migration lands.
 *   - When no positive authority signal exists, defaults to BDA (the operative
 *     authority for the Bengaluru core) but flags `needs_authority_confirmation`
 *     and a sub-1.0 confidence with an explicit basis. The snapshot then says
 *     "likely applicable plan: X (confidence N%, verify with authority)", never
 *     "verified zoning".
 *
 * Output shape:
 *   {
 *     resolved: boolean,                 // false => registry unavailable; caller no-ops
 *     authority: { id, code, name, kind, status, status_note } | null,
 *     plan:      { id, code, name, legal_status, version_label, notes } | null,
 *     method: 'taluk_alias' | 'village_alias' | 'default_bda' | 'unresolved',
 *     confidence: number,                // 0..1
 *     basis: string,                     // human-readable, e.g. "K-GIS taluk = Anekal -> Anekal PA"
 *     needs_authority_confirmation: boolean,
 *     alternates: Array<{ code, name }>,
 *   }
 */

const { query } = require('../../config/database');

const norm = (value) =>
  value === null || value === undefined ? null : String(value).trim().toLowerCase();

const DEFAULT_AUTHORITY_CODE = 'BDA';

const UNRESOLVED = Object.freeze({
  resolved: false,
  authority: null,
  plan: null,
  method: 'unresolved',
  confidence: 0,
  basis: 'Statutory-plan registry is unavailable; FAR rules are not plan-scoped.',
  needs_authority_confirmation: true,
  alternates: [],
});

// Load every authority visible to the current org (global + org overrides) with
// its single operative plan. One round-trip; the matching happens in JS so the
// logic is unit-testable and easy to reason about.
const loadAuthoritiesWithOperativePlan = async () => {
  const result = await query(
    `SELECT
        pa.id            AS authority_id,
        pa.authority_code,
        pa.authority_name,
        pa.authority_kind,
        pa.status        AS authority_status,
        pa.status_note,
        pa.taluk_aliases,
        sp.id            AS plan_id,
        sp.plan_code,
        sp.plan_name,
        sp.legal_status  AS plan_legal_status,
        sp.version_label AS plan_version_label,
        sp.notes         AS plan_notes
      FROM regulatory_data.planning_authorities pa
      LEFT JOIN LATERAL (
        SELECT s.*
          FROM regulatory_data.statutory_plans s
         WHERE s.authority_id = pa.id
           AND s.legal_status = 'operative'
           AND (s.org_id IS NULL OR s.org_id = current_organization_id())
         ORDER BY (s.org_id IS NOT NULL) DESC, s.effective_from DESC NULLS LAST
         LIMIT 1
      ) sp ON TRUE
     WHERE pa.org_id IS NULL OR pa.org_id = current_organization_id()`,
  );
  return result.rows || [];
};

const toAuthorityShape = (row) => ({
  id: row.authority_id,
  code: row.authority_code,
  name: row.authority_name,
  kind: row.authority_kind,
  status: row.authority_status,
  status_note: row.status_note || null,
});

const toPlanShape = (row) =>
  row.plan_id
    ? {
        id: row.plan_id,
        code: row.plan_code,
        name: row.plan_name,
        legal_status: row.plan_legal_status,
        version_label: row.plan_version_label || null,
        notes: row.plan_notes || null,
      }
    : null;

const aliasesOf = (row) =>
  Array.isArray(row.taluk_aliases) ? row.taluk_aliases.map((a) => norm(a)).filter(Boolean) : [];

/**
 * resolveStatutoryPlan({ taluk, hobli, village, lat, lng, city })
 */
async function resolveStatutoryPlan(input = {}) {
  const taluk = norm(input.taluk);
  const village = norm(input.village);

  let rows;
  try {
    rows = await loadAuthoritiesWithOperativePlan();
  } catch (err) {
    // Registry not present (migration not applied) or DB error → no-op honestly.
    return { ...UNRESOLVED };
  }

  if (!rows.length) {
    return { ...UNRESOLVED };
  }

  const bdaRow = rows.find((r) => r.authority_code === DEFAULT_AUTHORITY_CODE) || null;
  const alternatesFrom = (chosenCode) =>
    rows
      .filter((r) => r.authority_code !== chosenCode)
      .map((r) => ({ code: r.authority_code, name: r.authority_name }));

  // 1. PRIMARY — taluk name matches a non-default authority's alias list.
  //    (A specific LPA always beats the BDA default if both somehow match.)
  if (taluk) {
    const talukMatches = rows.filter((r) => aliasesOf(r).includes(taluk));
    const specific = talukMatches.find((r) => r.authority_code !== DEFAULT_AUTHORITY_CODE);
    const chosenRow = specific || talukMatches[0] || null;
    if (chosenRow) {
      const isDefault = chosenRow.authority_code === DEFAULT_AUTHORITY_CODE;
      return {
        resolved: true,
        authority: toAuthorityShape(chosenRow),
        plan: toPlanShape(chosenRow),
        method: 'taluk_alias',
        confidence: chosenRow.plan_id ? (isDefault ? 0.85 : 0.9) : 0.5,
        basis: `K-GIS taluk = ${input.taluk} → ${chosenRow.authority_name}`,
        needs_authority_confirmation: !chosenRow.plan_id,
        alternates: alternatesFrom(chosenRow.authority_code),
      };
    }
  }

  // 2. SECONDARY — village name matches an alias (weaker than taluk).
  if (village) {
    const villageMatches = rows.filter((r) => aliasesOf(r).includes(village));
    const specific = villageMatches.find((r) => r.authority_code !== DEFAULT_AUTHORITY_CODE);
    const chosenRow = specific || villageMatches[0] || null;
    if (chosenRow) {
      return {
        resolved: true,
        authority: toAuthorityShape(chosenRow),
        plan: toPlanShape(chosenRow),
        method: 'village_alias',
        confidence: chosenRow.plan_id ? 0.75 : 0.45,
        basis: `K-GIS village = ${input.village} → ${chosenRow.authority_name}`,
        needs_authority_confirmation: !chosenRow.plan_id,
        alternates: alternatesFrom(chosenRow.authority_code),
      };
    }
  }

  // 3. DEFAULT — fall back to BDA (operative for the Bengaluru core), but flag it.
  if (bdaRow) {
    const hadSignal = Boolean(taluk || village);
    return {
      resolved: true,
      authority: toAuthorityShape(bdaRow),
      plan: toPlanShape(bdaRow),
      method: 'default_bda',
      confidence: hadSignal ? 0.35 : 0.3,
      basis: hadSignal
        ? `Taluk "${input.taluk || input.village}" is not in any seeded authority's coverage list — defaulted to BDA. Confirm the governing Planning Authority.`
        : 'No administrative hierarchy available — defaulted to BDA. Confirm the governing Planning Authority.',
      needs_authority_confirmation: true,
      alternates: alternatesFrom(DEFAULT_AUTHORITY_CODE),
    };
  }

  // 4. Registry present but no BDA row (unexpected) — honest unresolved.
  return { ...UNRESOLVED };
}

/**
 * Best-effort audit write. Records HOW the authority/plan was decided for a
 * parcel. Never throws (a missing table or RLS hiccup must not break a refresh).
 */
async function logJurisdictionResolution({ propertyId, inputs = {}, resolution, userId = null } = {}) {
  if (!resolution || !resolution.resolved) return null;
  try {
    const result = await query(
      `INSERT INTO regulatory_data.jurisdiction_resolution_log
         (org_id, property_id, inputs, resolved_authority_id, resolved_authority_code,
          resolved_plan_id, resolved_plan_code, method, confidence, basis,
          needs_authority_confirmation, alternates, resolved_by)
       VALUES
         (current_organization_id(), $1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
       RETURNING id`,
      [
        propertyId || null,
        JSON.stringify({
          taluk: inputs.taluk ?? null,
          hobli: inputs.hobli ?? null,
          village: inputs.village ?? null,
          lat: inputs.lat ?? null,
          lng: inputs.lng ?? null,
          city: inputs.city ?? null,
        }),
        resolution.authority?.id || null,
        resolution.authority?.code || null,
        resolution.plan?.id || null,
        resolution.plan?.code || null,
        resolution.method,
        resolution.confidence,
        resolution.basis,
        Boolean(resolution.needs_authority_confirmation),
        JSON.stringify(resolution.alternates || []),
        userId || null,
      ],
    );
    return result.rows[0]?.id || null;
  } catch {
    return null;
  }
}

module.exports = {
  resolveStatutoryPlan,
  logJurisdictionResolution,
  // exported for unit tests
  _internal: { norm, DEFAULT_AUTHORITY_CODE },
};
