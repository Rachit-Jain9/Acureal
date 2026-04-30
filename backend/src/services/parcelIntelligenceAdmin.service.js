'use strict';

/**
 * Parcel intelligence admin — re-export shim.
 *
 * The original 1,801-LOC service was decomposed during the Bet 3 refactor
 * (2026-04-30) into four concern-bounded modules under
 * `services/parcelIntelligence/`:
 *
 *   - `_helpers.js`            — pure validators, normalizers, promotion
 *                                shape builders, queue param normalizers,
 *                                and the constants exported here.
 *   - `status.service.js`      — `getStatus`, `getSchemaReadiness`,
 *                                `getAiUsageLast7Days`. Dashboard backing.
 *   - `reviewQueue.service.js` — `listReviewQueue`, `reviewItem`,
 *                                `reviewItems`. Per-type queue + review
 *                                actions.
 *   - `authorityInputs.service.js` — `createAuthorityInput`. Manual
 *                                evidence entry path with auto-promote.
 *   - `batchPromote.service.js`    — `promoteEvidenceFactToProperty`,
 *                                `promoteEvidenceFactsToProperty`,
 *                                `buildBatchPromotionPlan`. Approved-fact
 *                                → property field promotion (single +
 *                                batch).
 *
 * This file preserves the legacy import path so callers
 * (`backend/src/routes/parcelIntelligence.routes.js` and
 * `backend/tests/parcelIntelligenceAdmin.service.test.js`) don't change.
 * New callers should import the concern-specific module directly.
 */

const helpers = require('./parcelIntelligence/_helpers');
const status = require('./parcelIntelligence/status.service');
const reviewQueue = require('./parcelIntelligence/reviewQueue.service');
const authorityInputs = require('./parcelIntelligence/authorityInputs.service');
const batchPromote = require('./parcelIntelligence/batchPromote.service');

module.exports = {
  // status / readiness
  getStatus: status.getStatus,
  getSchemaReadiness: status.getSchemaReadiness,
  // review queue
  listReviewQueue: reviewQueue.listReviewQueue,
  reviewItem: reviewQueue.reviewItem,
  reviewItems: reviewQueue.reviewItems,
  // batch promotion
  promoteEvidenceFactToProperty: batchPromote.promoteEvidenceFactToProperty,
  promoteEvidenceFactsToProperty: batchPromote.promoteEvidenceFactsToProperty,
  buildBatchPromotionPlan: batchPromote.buildBatchPromotionPlan,
  // authority inputs
  createAuthorityInput: authorityInputs.createAuthorityInput,
  // shared helper exposed for tests + admin tooling
  buildPromotionUpdate: helpers.buildPromotionUpdate,
  // constants
  REVIEW_TYPES: helpers.REVIEW_TYPES,
  REVIEW_STATUSES: helpers.REVIEW_STATUSES,
  AUTHORITY_INPUT_KINDS: helpers.AUTHORITY_INPUT_KINDS,
};
