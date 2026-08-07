const express = require('express');
const { body } = require('express-validator');
const financialService = require('../services/financial.service');
const modelConfidenceService = require('../services/modelConfidence.service');
const dealService = require('../services/deal.service');
const { generateSensitivityNarrative } = require('../services/export.insights.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/aiLimiter');
const { handleValidation } = require('../middleware/validate');
const { ASSET_CLASSES } = require('../constants/assetClasses');

// PR-NX48 (2026-05-19) — parse sensitivity_matrix JSONB into the shape
// generateSensitivityNarrative expects. Mirrors normalizeSensitivityMatrix
// in dealExport.service.js — kept inline to avoid cross-service imports
// for a single helper.
const parseSensitivityMatrix = (raw) => {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    variations: Array.isArray(parsed.variations) ? parsed.variations : [],
    sellingRates: Array.isArray(parsed.sellingRates) ? parsed.sellingRates : [],
    constructionCosts: Array.isArray(parsed.constructionCosts) ? parsed.constructionCosts : [],
    irrGrid: Array.isArray(parsed.irrGrid) ? parsed.irrGrid : [],
  };
};

const { exportAudit } = require('../middleware/exportAudit');

const router = express.Router();

// Attachment responses here (the financial-model CSV export) land in the
// export_events audit ledger, same as everything under /api/exports.
router.use(exportAudit);

const baseValidation = [
  body('assetClass').optional().isIn(ASSET_CLASSES).withMessage('Invalid asset class'),
];

const modelValidation = [
  // Land & site
  body('plotAreaSqft').optional().isFloat({ min: 1 }),
  body('fsi').optional().isFloat({ min: 0.1, max: 20 }),
  body('loadingFactor').optional().isFloat({ min: 0, max: 1 }),
  // Construction
  body('constructionCostPerSqft').optional().isFloat({ min: 1 }),
  body('constructionStartMonths').optional().isInt({ min: 0, max: 180 }),
  body('constructionEndMonths').optional().isInt({ min: 1, max: 180 }),
  body('contingencyPct').optional().isFloat({ min: 0, max: 25 }),
  // Soft costs
  body('approvalCostCr').optional().isFloat({ min: 0 }),
  body('approvalCostPerSqft').optional().isFloat({ min: 0 }),
  body('gstPct').optional().isFloat({ min: 0, max: 100 }),
  body('architectFeePct').optional().isFloat({ min: 0, max: 10 }),
  body('pmcFeePct').optional().isFloat({ min: 0, max: 10 }),
  // Revenue & pricing
  body('sellingRatePerSqft').optional().isFloat({ min: 1 }),
  body('landCostCr').optional().isFloat({ min: 0 }),
  body('marketingCostPct').optional().isFloat({ min: 0, max: 100 }),
  body('pricingEscalationPct').optional().isFloat({ min: 0, max: 50 }),
  body('developerMarginPct').optional().isFloat({ min: 0, max: 100 }),
  // Financing & capital stack
  body('financeCostPct').optional().isFloat({ min: 0, max: 100 }),
  body('debtLTV').optional().isFloat({ min: 0, max: 1 }),
  body('avgUnitSizeSqft').optional().isFloat({ min: 100, max: 20000 }),
  body('debtRatePct').optional().isFloat({ min: 0, max: 30 }),
  // Project timeline
  body('projectDurationMonths').optional().isInt({ min: 12, max: 180 }),
  body('discountRatePct').optional().isFloat({ min: 0, max: 100 }),
  // Plotted-specific
  body('totalLandSqft').optional().isFloat({ min: 1 }),
  body('saleableLandPct').optional().isFloat({ min: 10, max: 90 }),
  body('avgPlotSizeSqft').optional().isFloat({ min: 100 }),
  body('sellingRatePerSqyd').optional().isFloat({ min: 1 }),
  body('devCostPerSqft').optional().isFloat({ min: 0 }),
  // Income asset specific
  body('leasableAreaSqft').optional().isFloat({ min: 1 }),
  body('baseRentPerSqftMonth').optional().isFloat({ min: 1 }),
  body('rentEscalationPct').optional().isFloat({ min: 0, max: 30 }),
  body('vacancyPct').optional().isFloat({ min: 0, max: 100 }),
  body('opexPct').optional().isFloat({ min: 0, max: 100 }),
  body('tiPerSqft').optional().isFloat({ min: 0 }),
  body('lcMonths').optional().isFloat({ min: 0, max: 24 }),
  body('entryCapRate').optional().isFloat({ min: 1, max: 30 }),
  body('exitCapRate').optional().isFloat({ min: 1, max: 30 }),
  // exitStrategy, terminalValueMethod, exitMultiple, perpetuityGrowthPct, the
  // lrd* trio and forwardPurchasePriceCr are deliberately NOT accepted. The
  // deterministic kernel dereferences none of them (zero references across
  // packages/financial-kernel/src and backend/src/engines), so validating and
  // storing them only ever produced inputs the model silently discarded — and
  // a UI badge that contradicted the number beside it. Their controls are
  // removed in the same change; re-add both halves together if and when the
  // kernel models these exit methods.
  body('holdPeriodYears').optional().isInt({ min: 1, max: 20 }),
  body('debtCoverage').optional().isFloat({ min: 0, max: 1 }),
  body('amortizationYears').optional().isFloat({ min: 5, max: 30 }),
  body('interestRatePct').optional().isFloat({ min: 0, max: 50 }),
  body('anchorPct').optional().isFloat({ min: 0, max: 100 }),
  body('anchorRentDiscount').optional().isFloat({ min: 0, max: 80 }),
  // Hospitality-specific
  body('keys').optional().isInt({ min: 1, max: 5000 }),
  body('adr').optional().isFloat({ min: 1 }),
  body('stabilizedOccPct').optional().isFloat({ min: 10, max: 100 }),
  body('constructionCostPerKey').optional().isFloat({ min: 0 }),
  body('preOpeningCostPerKey').optional().isFloat({ min: 0 }),
  body('gopMarginPct').optional().isFloat({ min: 0, max: 100 }),
  body('ebitdaMarginPct').optional().isFloat({ min: 0, max: 100 }),
  body('fbRevPct').optional().isFloat({ min: 0, max: 100 }),
  body('otherRevPct').optional().isFloat({ min: 0, max: 100 }),
  body('adrGrowthPct').optional().isFloat({ min: 0, max: 30 }),
];

// ────────────────────────────────────────────────────────────────────────────
// GET /financials/defaults[/:assetClass]
//
// Return the single-source-of-truth defaults registry from
// packages/financial-kernel/src/config/defaults.ts. Every entry carries
// the metadata envelope { value, unit, range, source, lastReviewed,
// description } so the UI can render provenance badges and what-if
// sliders that respect declared ranges.
//
// Without :assetClass → full registry (globals + every asset class).
// With    :assetClass → that class's effective map (globals ∪ asset
// overrides, asset wins). Unknown class = 404.
//
// Registered BEFORE the `/:dealId` handlers below so Express doesn't
// match "defaults" as a UUID.
// ────────────────────────────────────────────────────────────────────────────
router.get('/defaults/:assetClass?', authenticate, (req, res, next) => {
  try {
    let kernel;
    try {
      // eslint-disable-next-line global-require
      kernel = require('../../../packages/financial-kernel/dist');
    } catch (err) {
      return res.status(503).json({
        success: false,
        message: 'Financial-kernel dist/ not built. Run '
          + '`cd packages/financial-kernel && npx tsc -p tsconfig.build.json`.',
      });
    }

    const {
      GLOBAL_DEFAULTS_META,
      ASSET_DEFAULTS_META,
      SUPPORTED_ASSET_CLASSES,
      listDefaultKeys,
      getDefaultMeta,
    } = kernel;

    if (!req.params.assetClass) {
      return res.json({
        success: true,
        data: {
          global: GLOBAL_DEFAULTS_META,
          perAsset: ASSET_DEFAULTS_META,
          supportedAssetClasses: SUPPORTED_ASSET_CLASSES,
        },
      });
    }

    const cls = req.params.assetClass;
    if (!SUPPORTED_ASSET_CLASSES.includes(cls)) {
      return res.status(404).json({
        success: false,
        message: `Unknown asset class "${cls}". Supported: `
          + SUPPORTED_ASSET_CLASSES.join(', '),
      });
    }

    const effective = {};
    for (const key of listDefaultKeys(cls)) {
      effective[key] = getDefaultMeta(cls, key);
    }

    return res.json({
      success: true,
      data: {
        assetClass: cls,
        effective,
        globalOnly: GLOBAL_DEFAULTS_META,
        assetOverridesOnly: ASSET_DEFAULTS_META[cls],
      },
    });
  } catch (error) {
    next(error);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /financials/quick-compute
//
// Stateless kernel-first "what-if" runner. Takes { assetClass, raw } in the
// body, runs the canonical kernel's `computeDeal`, and returns a compact
// `{ kpis, costs, revenue, areas, engineVersion }` payload. No DB read,
// no DB write, no legacy-engine fallback — this endpoint exists to power
// the live what-if slider UI, so every extra layer is latency the user
// feels.
//
// Registered BEFORE `/:dealId` so Express doesn't match "quick-compute"
// as a UUID. Auth + role gate unchanged from /calculate.
// ────────────────────────────────────────────────────────────────────────────
router.post(
  '/quick-compute',
  authenticate,
  requireRole('admin', 'analyst'),
  [...baseValidation, ...modelValidation],
  handleValidation,
  (req, res) => {
    let kernel;
    try {
      // eslint-disable-next-line global-require
      kernel = require('../../../packages/financial-kernel/dist');
    } catch (err) {
      return res.status(503).json({
        success: false,
        message: 'Financial-kernel dist/ not built. Run '
          + '`cd packages/financial-kernel && npx tsc -p tsconfig.build.json`.',
      });
    }

    const { computeDeal, isSupportedAssetClass } = kernel;
    const assetClass = req.body.assetClass || 'residential_apartments';
    if (!isSupportedAssetClass(assetClass)) {
      return res.status(422).json({
        success: false,
        message: `Asset class "${assetClass}" is not supported by the kernel.`,
      });
    }

    try {
      const result = computeDeal({ assetClass, raw: req.body });
      const { kpis, costs, revenue, areas } = result;
      // Unwrap Decimal → number at the boundary. The kernel keeps high-
      // precision decimals internally; the UI only needs display numbers.
      const toNum = (d) => (d && typeof d.toNumber === 'function' ? d.toNumber() : d);
      return res.json({
        success: true,
        data: {
          assetClass,
          engineVersion: 'v2',
          kpis: {
            revenue: toNum(kpis.revenue),
            totalCost: toNum(kpis.totalCost),
            grossProfit: toNum(kpis.grossProfit),
            grossMarginPct: kpis.grossMarginPct,
            npv: toNum(kpis.npv),
            irr: kpis.irr,
            equityMultiple: kpis.equityMultiple,
            residualLandValue: kpis.residualLandValue ? toNum(kpis.residualLandValue) : null,
            ...(kpis.extras || {}),
          },
          costs: costs
            ? Object.fromEntries(Object.entries(costs).map(([k, v]) => [k, toNum(v)]))
            : null,
          revenue: revenue
            ? Object.fromEntries(Object.entries(revenue).map(([k, v]) => [k, toNum(v)]))
            : null,
          areas: areas || null,
        },
      });
    } catch (err) {
      if (err && err.name === 'DealInputError') {
        return res.status(422).json({ success: false, message: err.message });
      }
      return res.status(500).json({
        success: false,
        message: process.env.NODE_ENV === 'production'
          ? 'quick-compute failed.'
          : `quick-compute failed: ${err.message}`,
      });
    }
  }
);

// POST /financials/:dealId/calculate
router.post(
  '/:dealId/calculate',
  authenticate,
  requireRole('admin', 'analyst'),
  [...baseValidation, ...modelValidation],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await financialService.calculateAndSave(
        req.params.dealId,
        req.body,
        { actorId: req.user?.id || null },
      );
      res.status(201).json({ success: true, message: 'Financials calculated and saved.', data: result });
    } catch (error) {
      // Only a genuine kernel INPUT error (bad/missing assumptions the operator
      // can fix) surfaces as a 422 with its message. Identify it precisely by
      // the kernel's error type / "kernel input error" prefix — NOT merely
      // "has a message but no code/statusCode", which ALSO matches internal
      // TypeErrors / Decimal faults and would leak their raw message to the
      // client. Anything else falls through to the central error handler, which
      // redacts to a generic 500 in production.
      const isKernelInputError =
        error?.name === 'DealInputError'
        || /kernel input error/i.test(error?.message || '');
      if (isKernelInputError) {
        return res.status(422).json({ success: false, message: error.message });
      }
      next(error);
    }
  }
);

// GET /financials/:dealId
router.get('/:dealId', authenticate, async (req, res, next) => {
  try {
    const financials = await financialService.getFinancials(req.params.dealId);
    res.json({ success: true, data: financials });
  } catch (error) {
    next(error);
  }
});

// PUT /financials/:dealId
router.put(
  '/:dealId',
  authenticate,
  requireRole('admin', 'analyst'),
  [...baseValidation, ...modelValidation],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await financialService.updateFinancials(
        req.params.dealId,
        req.body,
        { actorId: req.user?.id || null },
      );
      res.json({ success: true, message: 'Financials updated.', data: result });
    } catch (error) {
      next(error);
    }
  }
);

// PR-NX48 (2026-05-19) — Live AI sensitivity-narrative endpoint.
//
// Surfaces the same 2-paragraph OpenAI synthesis (driver decomposition
// + recommended stress tests) that ships in the DOCX Financials section
// (PR-NX44), now consumable by the frontend FinancialsPage in the live
// workspace — operators no longer need to download a DOCX to read the
// AI sensitivity interpretation. Uses the same generateSensitivityNarrative
// service so the XLSX / DOCX / PPTX / frontend all see identical content.
//
// Cascade: OpenAI (primary) → Claude (secondary) → unavailable. Returns
// canonical envelope: { available, driver_decomposition_paragraph,
// stress_test_paragraph, dominant_driver, confidence, provider,
// fallbackReason, disclaimer }.
//
// Fast-no-op paths: missing sensitivity_matrix OR sparse grid (< 3 rows
// or < 3 cols) → returns { available: false, reason } without firing
// any AI call.
//
// Auth: authenticate only (all deal members can read sensitivity —
// matches the GET /:dealId scope above).
router.get('/:dealId/sensitivity-narrative', authenticate, aiLimiter, async (req, res, next) => {
  try {
    const dealId = req.params.dealId;
    const [deal, financials] = await Promise.all([
      dealService.getDealById(dealId),
      financialService.getFinancials(dealId).catch((err) => {
        // 404 from getFinancials is a soft-fail — no financial row yet
        // means no sensitivity to narrate. Return null, downstream
        // generateSensitivityNarrative returns its own unavailable.
        if (err?.statusCode === 404 || err?.status === 404) return null;
        throw err;
      }),
    ]);
    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal not found' });
    }
    if (!financials) {
      return res.json({ success: true, data: {
        available: false,
        reason: 'no financial model on this deal yet',
        driver_decomposition_paragraph: null,
        stress_test_paragraph: null,
        dominant_driver: null,
        confidence: null,
      }});
    }

    const sensitivityMatrix = parseSensitivityMatrix(financials.sensitivity_matrix);
    const narrative = await generateSensitivityNarrative({
      deal,
      sensitivityMatrix,
      financials,
    });
    return res.json({ success: true, data: narrative });
  } catch (err) {
    next(err);
  }
});

// POST /financials/:dealId/sensitivity
router.post('/:dealId/sensitivity', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const matrix = await financialService.runSensitivity(
      req.params.dealId,
      req.body,
      { actorId: req.user?.id || null },
    );
    res.json({ success: true, data: matrix });
  } catch (error) {
    next(error);
  }
});

// GET /financials/:dealId/scenarios — returns base/bull/bear scenario comparison
router.get('/:dealId/scenarios', authenticate, async (req, res, next) => {
  try {
    const scenarios = await financialService.getScenarios(req.params.dealId);
    res.json({ success: true, data: scenarios });
  } catch (error) {
    next(error);
  }
});

// GET /financials/:dealId/financial-graph — provenance DAG for the deal's model
// Returns: { nodes, edges, nodeCount, edgeCount, assetClass, engineVersion, generatedAt }
// Every KPI, cost bucket, and revenue line traces back through computations
// to the user-supplied inputs. Powers the MethodologyExplorer DAG view + IC
// deck "show derivation" drawers.
router.get('/:dealId/financial-graph', authenticate, async (req, res, next) => {
  try {
    const graph = await financialService.getFinancialGraph(req.params.dealId);
    res.json({ success: true, data: graph });
  } catch (error) {
    next(error);
  }
});

// GET /financials/:dealId/model-confidence — Workstream A (Provenance Spine).
//
// Deterministic, read-side summary of how much of the saved underwriting
// rests on inputs set specifically for THIS deal versus inputs still on
// Acureal's cited benchmark library. Changes no math, touches no kernel.
//
// Returns either { available: true, dealSetCount, defaultCount, total,
// confidencePct, band, inputs[] } or { available: false, reason } — the
// service never throws for a missing model / uncatalogued class, so the
// panel can simply hide itself. Auth: authenticate only (same read scope
// as GET /:dealId).
router.get('/:dealId/model-confidence', authenticate, async (req, res, next) => {
  try {
    const summary = await modelConfidenceService.getModelConfidence(req.params.dealId);
    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Investor-grade audit trail.
//
// GET    /financials/:dealId/events                   — list signed events
// GET    /financials/:dealId/events/verify-chain       — verify the WHOLE deal
// GET    /financials/:dealId/events/:eventId/verify    — hash + HMAC check
// POST   /financials/:dealId/events/:eventId/replay    — re-run kernel, diff
//
// Rows come from `deal_events` (HMAC-signed on write, append-only via RLS).
// The verify endpoint performs the cryptographic check; replay additionally
// re-executes the kernel from the stored inputs and compares outputs — this
// is the "prove the number on the pitch deck" primitive.
// ──────────────────────────────────────────────────────────────────────────
router.get('/:dealId/events', authenticate, async (req, res, next) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10) || 50;
    // Audit tab on the deal page passes ?include_outputs_summary=true
    // so it can render KPI deltas between consecutive events without
    // N round-trips. Other callers (programmatic / verify-only flows)
    // get the lighter projection by default.
    const includeOutputsSummary =
      req.query.include_outputs_summary === 'true' ||
      req.query.include_outputs_summary === '1';
    const events = await financialService.listDealEvents(req.params.dealId, {
      limit,
      includeOutputsSummary,
    });
    res.json({ success: true, data: events });
  } catch (error) {
    next(error);
  }
});

// GET /financials/:dealId/events/verify-chain
// One-click whole-deal integrity check — re-hashes and re-verifies the HMAC
// signature on EVERY signed computation, and re-runs the kernel on the latest
// one to prove the numbers still reproduce. Backs the Audit tab's "Verify Deal
// Integrity" panel. Fixed path segment, so it must be declared BEFORE the
// `/:eventId/verify` route to avoid `verify-chain` being read as an eventId.
router.get('/:dealId/events/verify-chain', authenticate, async (req, res, next) => {
  try {
    const result = await financialService.verifyDealChain(req.params.dealId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.get('/:dealId/events/:eventId/verify', authenticate, async (req, res, next) => {
  try {
    const result = await financialService.verifyDealEvent(req.params.dealId, req.params.eventId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/:dealId/events/:eventId/replay',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const result = await financialService.replayDealEvent(req.params.dealId, req.params.eventId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /financials/:dealId/export/csv — download financial model as CSV
router.get('/:dealId/export/csv', authenticate, async (req, res, next) => {
  try {
    const csv = await financialService.exportFinancialCSV(req.params.dealId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="financial-model-${req.params.dealId}.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

// GET /financials/audit/bulk/:bulkId — list every deal touched by a
// single bulk operation. Used by the AuditTab "view batch" peek.
router.get('/audit/bulk/:bulkId', authenticate, async (req, res, next) => {
  try {
    const rows = await financialService.listDealsForBulkBatch(req.params.bulkId);
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
