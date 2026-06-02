'use strict';

/**
 * Organization-level settings routes. Mounted at /api/organization.
 *
 * Currently hosts the benchmark-contribution control — Workstream C2, the
 * org-level half of the docs/DATA_GOVERNANCE.md Layer-4 consent gate. An
 * owner/admin decides whether the organisation's de-identified deal data may
 * contribute to the planned anonymized market-benchmark layer.
 *
 * Reads are open to any member (transparency: every member may see the
 * organisation's data-governance posture). Writes are owner/admin-only — the
 * route guard is the gate; org scoping happens at the data layer via RLS.
 */

const express = require('express');
const { body, param } = require('express-validator');
const organizationConsent = require('../services/organizationConsent.service');
const benchmarkEligibility = require('../services/benchmarkEligibility.service');
const organizationService = require('../services/organization.service');
const organizationDomain = require('../services/organizationDomain.service');
const organizationAuditLog = require('../services/organizationAuditLog.service');
const { normalizeRole, ORGANIZATION_ROLES } = require('../constants/roles');
const { authenticate, requireRole } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

const router = express.Router();

// Assemble the benchmark-setting payload: the org-level opt-out state, its
// append-only change history, and — for the calling user — whether deals they
// create would currently be eligible to contribute (both gate conditions).
const buildBenchmarkPayload = async (organizationId, userId) => {
  const [{ state, available }, history, yourEligibility] = await Promise.all([
    organizationConsent.getOrgConsentState(organizationId),
    organizationConsent.getOrgConsentHistory(organizationId),
    benchmarkEligibility.evaluateEligibility({ organizationId, userId }),
  ]);
  return {
    opted_out: state.benchmark_opt_out,
    available,
    history,
    your_eligibility: yourEligibility,
  };
};

// GET /api/organization/benchmark-setting
//
// Authenticated — any member may see the organisation's benchmark-contribution
// posture. Returns the org-level opt-out state, its change history, and the
// calling user's own current contribution eligibility.
router.get('/benchmark-setting', authenticate, async (req, res, next) => {
  try {
    const data = await buildBenchmarkPayload(req.user.organization_id, req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// PUT /api/organization/benchmark-setting
//
// Owner/admin only. Engages or releases the org-level "do not benchmark"
// opt-out. Body: { optedOut: boolean }. The decision is appended as a new
// ledger row — the organisation's governance history is preserved, never
// overwritten.
router.put(
  '/benchmark-setting',
  authenticate,
  requireRole('owner', 'admin'),
  [body('optedOut').isBoolean().withMessage('optedOut must be true or false.')],
  handleValidation,
  async (req, res, next) => {
    try {
      const organizationId = req.user.organization_id;
      await organizationConsent.recordOrgConsent({
        organizationId,
        purpose: 'benchmark_opt_out',
        granted: req.body.optedOut === true,
        changedBy: req.user.id,
        source: 'settings',
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      });
      const data = await buildBenchmarkPayload(organizationId, req.user.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================================
// Team & members — who is in the workspace and at what role. Reads are open to
// any member (roster transparency); writes are admin/owner. Org scoping is
// enforced at the data layer (RLS + req.user.organization_id).
// ============================================================================

// GET /api/organization/members — the workspace roster.
router.get('/members', authenticate, async (req, res, next) => {
  try {
    const members = await organizationService.listOrganizationMembers(req.user.organization_id);
    res.json({ success: true, data: { members } });
  } catch (error) {
    next(error);
  }
});

// POST /api/organization/invitations — invite a teammate by email (admin+).
router.post(
  '/invitations',
  authenticate,
  requireRole('admin'),
  [
    body('email').isEmail().withMessage('A valid email is required.').normalizeEmail(),
    body('role')
      .custom((value) => ['admin', 'editor', 'viewer'].includes(normalizeRole(value)))
      .withMessage('role must be admin, editor, or viewer.'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      // Returns { kind: 'added', member } when the email already has an account
      // (added to the workspace directly), or { kind: 'invited', invitation }
      // when an email invitation was created for a new signup.
      const result = await organizationService.inviteOrganizationMember({
        organizationId: req.user.organization_id,
        email: req.body.email,
        role: normalizeRole(req.body.role),
        invitedBy: req.user.id,
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/organization/members/:userId/role — change a member's role (admin+).
router.patch(
  '/members/:userId/role',
  authenticate,
  requireRole('admin'),
  [
    param('userId').isUUID().withMessage('userId must be a valid id.'),
    body('role')
      .custom((value) => ORGANIZATION_ROLES.includes(normalizeRole(value)))
      .withMessage('role must be owner, admin, editor, or viewer.'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const member = await organizationService.updateOrganizationMemberRole({
        organizationId: req.user.organization_id,
        targetUserId: req.params.userId,
        nextRole: req.body.role,
        actor: req.user,
      });
      res.json({ success: true, data: { member } });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/organization/members/:userId — remove a member from the
// workspace (admin+). Hard delete; re-inviting restores access. The service
// enforces the rank ceiling + last-active-owner guard server-side.
router.delete(
  '/members/:userId',
  authenticate,
  requireRole('admin'),
  [param('userId').isUUID().withMessage('userId must be a valid id.')],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await organizationService.removeOrganizationMember({
        organizationId: req.user.organization_id,
        targetUserId: req.params.userId,
        actor: req.user,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// ── Join requests — pending domain auto-joins awaiting admin approval ────────

router.get('/join-requests', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const requests = await organizationService.listPendingJoinRequests(req.user.organization_id);
    res.json({ success: true, data: { requests } });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/join-requests/:userId/approve',
  authenticate,
  requireRole('admin'),
  [param('userId').isUUID().withMessage('userId must be a valid id.')],
  handleValidation,
  async (req, res, next) => {
    try {
      const member = await organizationService.approveJoinRequest({
        organizationId: req.user.organization_id,
        targetUserId: req.params.userId,
        actor: req.user,
      });
      res.json({ success: true, data: { member } });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/join-requests/:userId/reject',
  authenticate,
  requireRole('admin'),
  [param('userId').isUUID().withMessage('userId must be a valid id.')],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await organizationService.rejectJoinRequest({
        organizationId: req.user.organization_id,
        targetUserId: req.params.userId,
        actor: req.user,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================================
// Domains — claim a corporate email domain so teammates auto-join the workspace.
// A claim is inert until verified via a DNS TXT record (deterministic, no AI).
// ============================================================================

// GET /api/organization/domains — list the org's domain claims (any member).
router.get('/domains', authenticate, async (req, res, next) => {
  try {
    const domains = await organizationDomain.listDomains(req.user.organization_id);
    res.json({ success: true, data: { domains } });
  } catch (error) {
    next(error);
  }
});

// POST /api/organization/domains — claim a corporate domain (admin+).
router.post(
  '/domains',
  authenticate,
  requireRole('admin'),
  [body('domain').isString().trim().notEmpty().withMessage('domain is required.')],
  handleValidation,
  async (req, res, next) => {
    try {
      const domain = await organizationDomain.addDomainClaim({
        organizationId: req.user.organization_id,
        domain: req.body.domain,
        actor: req.user,
      });
      res.status(201).json({ success: true, data: { domain } });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/organization/domains/:domainId/verify — prove control via DNS TXT.
router.post(
  '/domains/:domainId/verify',
  authenticate,
  requireRole('admin'),
  [param('domainId').isUUID().withMessage('domainId must be a valid id.')],
  handleValidation,
  async (req, res, next) => {
    try {
      const domain = await organizationDomain.verifyDomain({
        organizationId: req.user.organization_id,
        domainId: req.params.domainId,
        actor: req.user,
      });
      res.json({ success: true, data: { domain } });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/organization/domains/:domainId — tune the join policy (admin+).
router.patch(
  '/domains/:domainId',
  authenticate,
  requireRole('admin'),
  [
    param('domainId').isUUID().withMessage('domainId must be a valid id.'),
    body('defaultRole').optional().isString(),
    body('requireAdminApproval').optional().isBoolean(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const domain = await organizationDomain.setDomainPolicy({
        organizationId: req.user.organization_id,
        domainId: req.params.domainId,
        defaultRole: req.body.defaultRole,
        requireAdminApproval: req.body.requireAdminApproval,
        actor: req.user,
      });
      res.json({ success: true, data: { domain } });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/organization/domains/:domainId — drop a domain claim (admin+).
router.delete(
  '/domains/:domainId',
  authenticate,
  requireRole('admin'),
  [param('domainId').isUUID().withMessage('domainId must be a valid id.')],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await organizationDomain.removeDomainClaim({
        organizationId: req.user.organization_id,
        domainId: req.params.domainId,
        actor: req.user,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/organization/audit — org membership/domain audit trail (admin+).
router.get('/audit', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const events = await organizationAuditLog.listOrganizationAudit(req.user.organization_id, {
      limit: req.query.limit,
    });
    res.json({ success: true, data: { events } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
