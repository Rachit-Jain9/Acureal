'use strict';

const crypto = require('crypto');
const { query, transaction } = require('../config/database');
const { createError } = require('../middleware/errorHandler');

const SUPPORTED_KINDS = Object.freeze([
  'terms_of_service',
  'privacy_policy',
  'cookie_policy',
  'data_processing_addendum',
  'acceptable_use',
]);

// Kinds the signup form must collect acceptance for. T&C + Privacy are
// always required; Cookie is informational and acceptance is implicit by
// continued use under our minimal-essentials policy.
const SIGNUP_REQUIRED_KINDS = Object.freeze(['terms_of_service', 'privacy_policy']);

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const assertKind = (kind) => {
  if (!SUPPORTED_KINDS.includes(kind)) {
    throw createError(`Unsupported legal document kind: ${kind}`, 400);
  }
};

const mapDocumentRow = (row) =>
  row
    ? {
        id: row.id,
        kind: row.kind,
        version: row.version,
        effective_at: row.effective_at,
        body_md: row.body_md,
        content_sha256: row.content_sha256,
        is_current: row.is_current,
        created_at: row.created_at,
      }
    : null;

const getCurrentLegalDocument = async (kind) => {
  assertKind(kind);
  const result = await query(
    `SELECT id, kind, version, effective_at, body_md, content_sha256, is_current, created_at
       FROM public.legal_documents
      WHERE kind = $1 AND is_current = true
      LIMIT 1`,
    [kind]
  );
  return mapDocumentRow(result.rows[0]);
};

const getLegalDocumentByVersion = async (kind, version) => {
  assertKind(kind);
  const result = await query(
    `SELECT id, kind, version, effective_at, body_md, content_sha256, is_current, created_at
       FROM public.legal_documents
      WHERE kind = $1 AND version = $2
      LIMIT 1`,
    [kind, version]
  );
  return mapDocumentRow(result.rows[0]);
};

const getCurrentLegalDocuments = async () => {
  const result = await query(
    `SELECT id, kind, version, effective_at, body_md, content_sha256, is_current, created_at
       FROM public.legal_documents
      WHERE is_current = true`
  );
  const out = {};
  for (const row of result.rows) {
    out[row.kind] = mapDocumentRow(row);
  }
  return out;
};

// Idempotent acceptance recording. Called from the registration transaction
// (with a `client`) and from the standalone /accept endpoint (which gets a
// pooled connection).
const recordAcceptance = async (
  { userId, documentIds, ipAddress = null, userAgent = null },
  client = null
) => {
  if (!Array.isArray(documentIds) || documentIds.length === 0) {
    throw createError('At least one document_id required to record acceptance.', 400);
  }
  const exec = client ? client.query.bind(client) : query;

  // Insert acceptance rows (idempotent — UNIQUE on user/document).
  await exec(
    `INSERT INTO public.user_legal_acceptances (user_id, document_id, ip_address, user_agent)
     SELECT $1, doc_id, $2::inet, $3
       FROM unnest($4::bigint[]) AS doc_id
       ON CONFLICT (user_id, document_id) DO NOTHING`,
    [userId, ipAddress, userAgent, documentIds]
  );

  // Update users shortcut columns for any kind whose document is in the
  // accepted list. Only flips the timestamp forward (never back).
  await exec(
    `UPDATE public.users u
        SET terms_accepted_at = GREATEST(
              COALESCE(u.terms_accepted_at, 'epoch'::timestamptz),
              COALESCE((SELECT MAX(la.accepted_at)
                          FROM public.user_legal_acceptances la
                          JOIN public.legal_documents d ON d.id = la.document_id
                         WHERE la.user_id = u.id AND d.kind = 'terms_of_service'),
                       u.terms_accepted_at)
            ),
            privacy_accepted_at = GREATEST(
              COALESCE(u.privacy_accepted_at, 'epoch'::timestamptz),
              COALESCE((SELECT MAX(la.accepted_at)
                          FROM public.user_legal_acceptances la
                          JOIN public.legal_documents d ON d.id = la.document_id
                         WHERE la.user_id = u.id AND d.kind = 'privacy_policy'),
                       u.privacy_accepted_at)
            ),
            updated_at = NOW()
      WHERE u.id = $1`,
    [userId]
  );
};

const getUserAcceptances = async (userId) => {
  const result = await query(
    `SELECT la.id, la.document_id, la.accepted_at, la.ip_address, la.user_agent,
            d.kind, d.version, d.effective_at
       FROM public.user_legal_acceptances la
       JOIN public.legal_documents d ON d.id = la.document_id
      WHERE la.user_id = $1
      ORDER BY la.accepted_at DESC`,
    [userId]
  );
  return result.rows;
};

const userHasAcceptedCurrent = async (userId, kind) => {
  assertKind(kind);
  const result = await query(
    `SELECT 1
       FROM public.user_legal_acceptances la
       JOIN public.legal_documents d ON d.id = la.document_id
      WHERE la.user_id = $1 AND d.kind = $2 AND d.is_current = true
      LIMIT 1`,
    [userId, kind]
  );
  return result.rowCount > 0;
};

// Resolve current versions for every kind the signup form collects, and
// validate the versions the client claimed it accepted. Returns the array
// of legal_document IDs to record. Throws 400 on any mismatch.
const resolveSignupAcceptance = async ({ acceptedTermsVersion, acceptedPrivacyVersion }) => {
  if (!acceptedTermsVersion || !acceptedPrivacyVersion) {
    throw createError(
      'You must accept the current Terms of Service and Privacy Policy to create an account.',
      400
    );
  }

  const current = await getCurrentLegalDocuments();
  const tos = current.terms_of_service;
  const privacy = current.privacy_policy;

  if (!tos || !privacy) {
    throw createError(
      'Legal documents are not yet published. Please contact the workspace administrator.',
      503
    );
  }

  if (tos.version !== acceptedTermsVersion) {
    throw createError(
      `The Terms of Service have been updated. Please reload the signup form to accept version ${tos.version}.`,
      409
    );
  }
  if (privacy.version !== acceptedPrivacyVersion) {
    throw createError(
      `The Privacy Policy has been updated. Please reload the signup form to accept version ${privacy.version}.`,
      409
    );
  }

  return [tos.id, privacy.id];
};

// Publish a new version of a legal document. Called by scripts/publish-legal-doc.js
// (operator) and by tests. Wraps in a transaction so old current is unset
// atomically with the new current insert.
const publishLegalDocument = async ({ kind, version, effectiveAt, bodyMd, createdBy = null }) => {
  assertKind(kind);
  if (!version || !effectiveAt || !bodyMd) {
    throw createError('publishLegalDocument requires kind, version, effectiveAt, bodyMd.', 400);
  }
  const contentSha256 = sha256Hex(bodyMd);

  return transaction(async (client) => {
    await client.query(
      `UPDATE public.legal_documents SET is_current = false WHERE kind = $1 AND is_current = true`,
      [kind]
    );
    const inserted = await client.query(
      `INSERT INTO public.legal_documents
         (kind, version, effective_at, body_md, content_sha256, is_current, created_by)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       ON CONFLICT (kind, version) DO UPDATE
         SET body_md = EXCLUDED.body_md,
             content_sha256 = EXCLUDED.content_sha256,
             effective_at = EXCLUDED.effective_at,
             is_current = true,
             created_by = COALESCE(public.legal_documents.created_by, EXCLUDED.created_by)
       RETURNING id, kind, version, effective_at, body_md, content_sha256, is_current, created_at`,
      [kind, version, effectiveAt, bodyMd, contentSha256, createdBy]
    );
    return mapDocumentRow(inserted.rows[0]);
  });
};

module.exports = {
  SUPPORTED_KINDS,
  SIGNUP_REQUIRED_KINDS,
  sha256Hex,
  getCurrentLegalDocument,
  getLegalDocumentByVersion,
  getCurrentLegalDocuments,
  recordAcceptance,
  getUserAcceptances,
  userHasAcceptedCurrent,
  resolveSignupAcceptance,
  publishLegalDocument,
};
