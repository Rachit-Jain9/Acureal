'use strict';

/**
 * One-click verification for parcel-intelligence "Needs Verification" items.
 *
 * The compose pipeline emits a small set of Needs-Verification items (zone
 * assignment, FAR, guidance value, Landeed, coordinates) — each with a stable
 * `key`. An analyst who has independently checked the official source can
 * mark the item verified without going through the admin review queue.
 *
 * Under the hood this is a plain `evidence_links` row keyed to the latest
 * parcel_intelligence_snapshots row, with `source_section = 'item:<key>'`
 * and `link_kind = manual_verification | document | external_url`.
 * The panel renders any matching link as a "verified manually" pill against
 * the item.
 */

const evidenceLinks = require('./evidenceLinks.service');
const { loadLatestSnapshotMeta, NEEDS_VERIFICATION_KEYS } = require('./parcelIntelligence.service');
const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');

const ITEM_PREFIX = 'item:';

const buildSourceSection = (itemKey) => `${ITEM_PREFIX}${itemKey}`;

const verifyItem = async ({
  propertyId,
  itemKey,
  documentId = null,
  externalUrl = null,
  notes = null,
  userId = null,
}) => {
  if (!NEEDS_VERIFICATION_KEYS.has(itemKey)) {
    throw createError(`Unknown verification item key: ${itemKey}`, 400);
  }

  const snapshotId = (await loadLatestSnapshotMeta(propertyId))?.id || null;
  if (!snapshotId) {
    throw createError(
      'No parcel intelligence snapshot exists for this property yet. Refresh parcel intelligence first.',
      409
    );
  }

  // Pick the link kind from the strongest target the caller supplied:
  // an uploaded document beats a URL, which beats a free-text note.
  let linkKind;
  if (documentId) linkKind = 'document';
  else if (externalUrl) linkKind = 'manual_verification';
  else if (notes) linkKind = 'manual_verification';
  else throw createError('Provide a document, URL, or note for verification.', 400);

  return evidenceLinks.attachLink({
    ownerKind: 'parcel_intelligence',
    ownerId: snapshotId,
    linkKind,
    documentId,
    externalUrl,
    notes,
    sourceSection: buildSourceSection(itemKey),
    confidenceScore: 0.9,
    userId,
  });
};

const listVerifications = async (propertyId) => {
  const snapshotId = (await loadLatestSnapshotMeta(propertyId))?.id || null;
  if (!snapshotId) {
    return { snapshot_id: null, verifications: [] };
  }
  let links;
  try {
    links = await evidenceLinks.listForOwner('parcel_intelligence', snapshotId);
  } catch (error) {
    if (error.statusCode === 404) {
      return { snapshot_id: null, verifications: [] };
    }
    throw error;
  }
  const verifications = links
    .filter((link) => typeof link.source_section === 'string' && link.source_section.startsWith(ITEM_PREFIX))
    .map((link) => ({
      ...link,
      item_key: link.source_section.slice(ITEM_PREFIX.length),
    }));
  return { snapshot_id: snapshotId, verifications };
};

const removeVerification = async ({ propertyId, linkId }) => {
  const snapshotId = (await loadLatestSnapshotMeta(propertyId))?.id || null;
  if (!snapshotId) {
    throw createError(
      'No parcel intelligence snapshot exists for this property yet. Refresh parcel intelligence first.',
      409
    );
  }

  const result = await query(
    `SELECT 1
     FROM evidence_links
     WHERE id = $1
       AND owner_kind = 'parcel_intelligence'
       AND owner_id = $2
       AND organization_id = current_organization_id()
       AND source_section LIKE $3
     LIMIT 1`,
    [linkId, snapshotId, `${ITEM_PREFIX}%`]
  );

  if (result.rows.length === 0) {
    throw createError('Verification link not found for this parcel snapshot.', 404);
  }

  return evidenceLinks.detachLink(linkId);
};

module.exports = {
  verifyItem,
  listVerifications,
  removeVerification,
};
