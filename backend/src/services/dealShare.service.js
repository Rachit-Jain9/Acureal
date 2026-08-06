'use strict';

const { query, transaction } = require('../config/database');
const { createError } = require('../middleware/errorHandler');

const shareDeal = async (dealId, sharedByUserId, sharedWithEmail, permission = 'viewer') => {
  if (!['viewer', 'editor'].includes(permission)) {
    throw createError('Permission must be viewer or editor.', 400);
  }

  return transaction(async (client) => {
    // Verify the deal exists and belongs to the requesting user
    const dealResult = await client.query(
      'SELECT id, created_by, name, organization_id FROM deals WHERE id = $1 AND created_by = $2',
      [dealId, sharedByUserId]
    );

    if (dealResult.rows.length === 0) {
      throw createError('Deal not found or you are not the owner.', 404);
    }

    const deal = dealResult.rows[0];

    // Resolve the recipient WITHIN the deal's workspace.
    //
    // This lookup used to be `WHERE LOWER(email) = LOWER($1)` with no
    // organisation comparison at all, so a deal owner could hand a complete
    // deal — documents, financial model, diligence, risks, full activity
    // history — to any account on the platform, including one inside another
    // customer's workspace. Nine `*_shared_read` RLS policies made the database
    // honour it (dropped in 20260806). Membership in the deal's organisation is
    // now the gate, enforced here rather than inferred.
    const userResult = await client.query(
      `SELECT u.id, u.email, u.name
         FROM users u
         JOIN organization_members om
           ON om.user_id = u.id
          AND om.organization_id = $2
        WHERE LOWER(u.email) = LOWER($1)
          AND u.is_active = TRUE
        LIMIT 1`,
      [sharedWithEmail, deal.organization_id]
    );

    if (userResult.rows.length === 0) {
      // Deliberately does not distinguish "no such account" from "account
      // exists in another workspace" — that difference is a membership oracle
      // for any other customer's user list.
      throw createError(
        'No active member of this workspace was found with that email. '
        + 'Deals can only be shared with people in your own workspace.',
        404,
      );
    }

    const targetUser = userResult.rows[0];

    if (targetUser.id === sharedByUserId) {
      throw createError('You cannot share a deal with yourself.', 400);
    }

    // Upsert the share
    const shareResult = await client.query(
      `INSERT INTO deal_shares (deal_id, shared_by, shared_with, permission)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (deal_id, shared_with)
       DO UPDATE SET permission = EXCLUDED.permission, updated_at = NOW()
       RETURNING id, deal_id, shared_by, shared_with, permission, created_at`,
      [dealId, sharedByUserId, targetUser.id, permission]
    );

    return {
      ...shareResult.rows[0],
      shared_with_email: targetUser.email,
      shared_with_name: targetUser.name,
    };
  });
};

/**
 * Colleagues the caller may share THIS deal with — the data behind the
 * Share Deal picker.
 *
 * Scoped by ORGANISATION MEMBERSHIP, not by email-domain string matching.
 * The user-visible promise ("only my colleagues appear") is the same, but
 * membership is the boundary RLS and the 20260806 share lock already enforce,
 * and a verified domain claim is what produces membership — so the two cannot
 * drift apart. Splitting an address on '@' would add a second, weaker boundary
 * beside the real one, and two firms can share a public-provider domain.
 *
 * Excluded server-side, never client-side: the caller (you cannot share with
 * yourself), anyone already holding a share, and inactive accounts/memberships.
 *
 * `q` is an optional type-ahead filter over name and email. It is matched with
 * a literal-escaped LIKE — the raw string would otherwise let '%' turn a
 * one-character keystroke into a full roster dump.
 */
const listShareCandidates = async (dealId, requestingUserId, { q = '', limit = 20 } = {}) => {
  const dealResult = await query(
    'SELECT id, organization_id FROM deals WHERE id = $1 AND created_by = $2',
    [dealId, requestingUserId]
  );
  if (dealResult.rows.length === 0) {
    throw createError('Deal not found or you are not the owner.', 404);
  }
  const { organization_id: organizationId } = dealResult.rows[0];

  const term = String(q || '').trim();
  // Escape LIKE metacharacters so a typed '%' or '_' is literal.
  const pattern = term ? `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));

  const result = await query(
    `SELECT u.id, u.name, u.email, om.role
       FROM organization_members om
       INNER JOIN users u ON u.id = om.user_id
      WHERE om.organization_id = $1
        AND om.is_active = TRUE
        AND COALESCE(u.is_active, TRUE) = TRUE
        AND u.account_closed_at IS NULL
        AND u.erased_at IS NULL
        AND u.id <> $2
        AND NOT EXISTS (
          SELECT 1 FROM deal_shares ds
           WHERE ds.deal_id = $3 AND ds.shared_with = u.id
        )
        AND ($4::text IS NULL OR u.name ILIKE $4 ESCAPE '\\' OR u.email ILIKE $4 ESCAPE '\\')
      ORDER BY u.name ASC NULLS LAST, u.email ASC
      LIMIT $5`,
    [organizationId, requestingUserId, dealId, pattern, safeLimit]
  );

  return result.rows;
};

const revokeDealShare = async (dealId, sharedByUserId, sharedWithUserId) =>
  transaction(async (client) => {
    // Verify the deal belongs to the requesting user
    const dealResult = await client.query(
      'SELECT id FROM deals WHERE id = $1 AND created_by = $2',
      [dealId, sharedByUserId]
    );

    if (dealResult.rows.length === 0) {
      throw createError('Deal not found or you are not the owner.', 404);
    }

    const deleteResult = await client.query(
      'DELETE FROM deal_shares WHERE deal_id = $1 AND shared_with = $2 RETURNING id',
      [dealId, sharedWithUserId]
    );

    if (deleteResult.rows.length === 0) {
      throw createError('Share not found.', 404);
    }

    return { revoked: true };
  });

const listDealShares = async (dealId, userId) => {
  // User must be the deal owner to see shares
  const result = await query(
    `SELECT
       ds.id,
       ds.deal_id,
       ds.shared_with,
       ds.permission,
       ds.created_at,
       u.email AS shared_with_email,
       u.name AS shared_with_name
     FROM deal_shares ds
     INNER JOIN users u ON u.id = ds.shared_with
     WHERE ds.deal_id = $1 AND ds.shared_by = $2
     ORDER BY ds.created_at ASC`,
    [dealId, userId]
  );

  return result.rows;
};

const listDealsSharedWithMe = async (userId) => {
  const result = await query(
    `SELECT
       ds.id AS share_id,
       ds.deal_id,
       ds.permission,
       ds.created_at AS shared_at,
       d.name AS deal_name,
       d.stage,
       d.deal_type,
       sharer.name AS shared_by_name,
       sharer.email AS shared_by_email
     FROM deal_shares ds
     INNER JOIN deals d ON d.id = ds.deal_id
     INNER JOIN users sharer ON sharer.id = ds.shared_by
     WHERE ds.shared_with = $1
     ORDER BY ds.created_at DESC`,
    [userId]
  );

  return result.rows;
};

module.exports = {
  shareDeal,
  listShareCandidates,
  revokeDealShare,
  listDealShares,
  listDealsSharedWithMe,
};
