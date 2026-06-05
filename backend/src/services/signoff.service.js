'use strict';

const { query } = require('../config/database');
const { EVENTS, publish } = require('../lib/eventBus');
const { SIGNOFF_TEMPLATES } = require('../constants/domain');

// Migration-tolerance: until 20260701_deal_signoffs is applied the table is
// absent. Reads degrade to empty (so the board + workspace + K-RERA cockpit are
// unaffected); writes surface the underlying error (the operator applies the
// migration before using the board).
const isUndefinedTable = (err) =>
  !!err && (err.code === '42P01' || /relation .*deal_signoffs.* does not exist/i.test(err.message || ''));

// Bump the parent deal's updated_at so the deterministic workspace cache (which
// fingerprints deals.updated_at directly) invalidates on a sign-off change — a
// signed sign-off feeds the K-RERA cockpit's professional-certificate
// verification, so the cockpit must reflect it on the next load. Best-effort;
// never fails the mutation. (deal_signoffs is deliberately NOT in
// VERSIONED_DEAL_TABLES — this avoids disabling the cache before the migration
// is applied, when the table is absent.)
async function bumpDeal(dealId) {
  if (!dealId) return;
  try {
    await query('UPDATE deals SET updated_at = NOW() WHERE id = $1', [dealId]);
  } catch {
    /* cache invalidation is best-effort */
  }
}

// snake_case column → camelCase request alias (null = no alias). A partial PUT
// touches only the keys the caller actually sent.
const SIGNOFF_FIELD_ALIASES = {
  professional_role: 'professionalRole',
  professional_name: 'professionalName',
  scope: null,
  form_ref: 'formRef',
  status: null,
  requested_at: 'requestedAt',
  signed_at: 'signedAt',
  expires_at: 'expiresAt',
  document_id: 'documentId',
  notes: null,
};

const normalizePayload = (data = {}) => {
  const has = (k) => Object.prototype.hasOwnProperty.call(data, k);
  const out = {};
  for (const [snake, camel] of Object.entries(SIGNOFF_FIELD_ALIASES)) {
    const key = has(snake) ? snake : (camel && has(camel) ? camel : null);
    if (!key) continue;
    out[snake] = data[key];
  }
  return out;
};

async function listByDeal(dealId) {
  try {
    const result = await query(
      `SELECT s.*, d.name AS document_name
         FROM deal_signoffs s
         LEFT JOIN documents d ON d.id = s.document_id
        WHERE s.deal_id = $1
          AND s.organization_id = current_organization_id()
        ORDER BY s.created_at`,
      [dealId],
    );
    return result.rows;
  } catch (err) {
    if (isUndefinedTable(err)) return [];
    throw err;
  }
}

async function create(dealId, data) {
  const n = normalizePayload(data);
  const {
    professional_role,
    professional_name = null,
    scope,
    form_ref = null,
    status = 'not_started',
    requested_at = null,
    signed_at = null,
    expires_at = null,
    document_id = null,
    notes = null,
  } = n;

  const result = await query(
    `INSERT INTO deal_signoffs
       (deal_id, professional_role, professional_name, scope, form_ref, status,
        requested_at, signed_at, expires_at, document_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [dealId, professional_role, professional_name, scope, form_ref, status,
      requested_at, signed_at, expires_at, document_id, notes],
  );
  await bumpDeal(dealId);
  return result.rows[0];
}

async function update(id, data) {
  const n = normalizePayload(data);
  const allowed = [
    'professional_role', 'professional_name', 'scope', 'form_ref', 'status',
    'requested_at', 'signed_at', 'expires_at', 'document_id', 'notes',
  ];

  const setClauses = [];
  const values = [];
  let idx = 1;
  for (const field of allowed) {
    if (Object.prototype.hasOwnProperty.call(n, field)) {
      setClauses.push(`${field} = $${idx}`);
      values.push(n[field]);
      idx += 1;
    }
  }

  if (setClauses.length === 0) {
    const existing = await query(
      'SELECT * FROM deal_signoffs WHERE id = $1 AND organization_id = current_organization_id()',
      [id],
    );
    return existing.rows[0] || null;
  }

  values.push(id);
  const result = await query(
    `UPDATE deal_signoffs SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${idx} AND organization_id = current_organization_id()
       RETURNING *`,
    values,
  );
  const row = result.rows[0] || null;
  if (row) {
    await bumpDeal(row.deal_id);
    if (Object.prototype.hasOwnProperty.call(n, 'status')) {
      publish(EVENTS.SIGNOFF_STATUS_CHANGED, {
        dealId: row.deal_id,
        signoffId: row.id,
        role: row.professional_role,
        scope: row.scope,
        status: row.status,
      });
    }
  }
  return row;
}

async function deleteSignoff(id) {
  const result = await query(
    'DELETE FROM deal_signoffs WHERE id = $1 AND organization_id = current_organization_id() RETURNING id, deal_id',
    [id],
  );
  const row = result.rows[0] || null;
  if (row) await bumpDeal(row.deal_id);
  return row;
}

// Seed the standard professional sign-off set for a deal (idempotent — skips
// scopes already present).
async function seedForDeal(dealId) {
  const existing = await query(
    'SELECT scope FROM deal_signoffs WHERE deal_id = $1 AND organization_id = current_organization_id()',
    [dealId],
  );
  const existingScopes = new Set(existing.rows.map((r) => r.scope));
  const toInsert = SIGNOFF_TEMPLATES.filter((t) => !existingScopes.has(t.scope));
  if (toInsert.length === 0) return [];

  const placeholders = [];
  const values = [];
  let idx = 1;
  for (const t of toInsert) {
    placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
    values.push(dealId, t.professional_role, t.scope, t.form_ref);
    idx += 4;
  }
  const result = await query(
    `INSERT INTO deal_signoffs (deal_id, professional_role, scope, form_ref)
     VALUES ${placeholders.join(', ')}
     RETURNING *`,
    values,
  );
  await bumpDeal(dealId);
  return result.rows;
}

module.exports = {
  listByDeal,
  create,
  update,
  delete: deleteSignoff,
  seedForDeal,
  // exported for tests
  normalizePayload,
};
