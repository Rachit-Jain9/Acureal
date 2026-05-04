const crypto = require('crypto');
const express = require('express');
const { body } = require('express-validator');
const intelligenceService = require('../services/intelligence.service');
const monitoring = require('../services/monitoring.supabase');
const { computeInvestorPackage: invokeKernelHandler } = require('../engines/investorPackage.adapter');
const { authenticate, requireRole } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

const router = express.Router();

const sha256 = (obj) =>
  crypto.createHash('sha256').update(typeof obj === 'string' ? obj : JSON.stringify(obj)).digest('hex');

router.get('/daily-brief', authenticate, async (req, res, next) => {
  try {
    const brief = await intelligenceService.getDailyBrief(req.user.id, req.query.date);
    res.json({ success: true, data: brief });
  } catch (error) {
    next(error);
  }
});

router.post('/daily-brief', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const brief = await intelligenceService.getDailyBrief(req.user.id, req.body?.date || req.query.date);
    res.json({ success: true, data: brief });
  } catch (error) {
    next(error);
  }
});

// GET /intelligence/market-notes — returns all three sections
router.get('/market-notes', authenticate, async (req, res, next) => {
  try {
    const notes = await intelligenceService.getMarketNotes();
    res.json({ success: true, data: notes });
  } catch (error) {
    next(error);
  }
});

// PUT /intelligence/market-notes — admin only, saves one section at a time
router.put(
  '/market-notes',
  authenticate,
  requireRole('admin'),
  [
    body('section').isIn(['micro_market', 'slowdown', 'strategic']).withMessage('Invalid section'),
    body('items').isArray().withMessage('items must be an array'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const saved = await intelligenceService.saveMarketNotes(
        req.body.section,
        req.body.items,
        req.user.id
      );
      res.json({ success: true, message: 'Market notes saved.', data: saved });
    } catch (error) {
      next(error);
    }
  }
);

// GET /intelligence/market-transactions
router.get('/market-transactions', authenticate, async (req, res, next) => {
  try {
    const data = await intelligenceService.getMarketTransactions({
      city:     req.query.city,
      fy:       req.query.fy,
      quarter:  req.query.quarter,
      dealType: req.query.dealType,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /intelligence/micro-market-benchmarks
router.get('/micro-market-benchmarks', authenticate, async (req, res, next) => {
  try {
    const data = await intelligenceService.getMicroMarketBenchmarks({ city: req.query.city });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// POST /intelligence/deal-analysis/:dealId — Claude-powered deal memo
router.post('/deal-analysis/:dealId', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const result = await intelligenceService.getDealAnalysis(req.params.dealId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// POST /intelligence/deal-analysis/:dealId/stream — SSE-streamed deal memo
//
// Same prompt + same data assembly as the JSON variant above, but writes
// text deltas back as Server-Sent Events as Claude generates them.
// Perceived latency: <1s first paint vs ~30s wait for the JSON variant.
//
// SSE frame format:
//   data: { "type": "text", "text": "<delta>" }\n\n
//   ...
//   data: { "type": "done", "callId": "<uuid>", "generatedAt": "...", "dealName": "..." }\n\n
//   data: { "type": "error", "message": "..." }\n\n   (on failure)
//
// Client-disconnect handling: req.on('close') aborts the upstream Anthropic
// call so we don't keep paying for tokens nobody will read.
router.post(
  '/deal-analysis/:dealId/stream',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const stream = await intelligenceService.streamDealAnalysis(req.params.dealId);
      if (stream.error) {
        return res.status(stream.status || 500).json({ success: false, message: stream.error });
      }

      // SSE headers — disable proxy/CDN buffering so chunks reach the client
      // as the model generates them. `flushHeaders()` ensures headers ship
      // before the first data frame instead of after.
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      const writeFrame = (obj) => {
        if (res.writableEnded) return;
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
      };

      // Client disconnects (browser tab close, navigation, Cancel button) →
      // abort the upstream Anthropic call. Without this we'd keep paying for
      // the full token budget on calls nobody is reading.
      let aborted = false;
      req.on('close', () => {
        if (!res.writableEnded) {
          aborted = true;
          stream.abort();
        }
      });

      stream.onText((delta) => writeFrame({ type: 'text', text: delta }));

      try {
        const final = await stream.done();
        if (!aborted) {
          writeFrame({
            type: 'done',
            callId: final.callId,
            dealName: final.dealName,
            generatedAt: final.generatedAt,
          });
        }
      } catch (err) {
        if (!aborted) {
          writeFrame({ type: 'error', message: err.message || 'Stream failed' });
        }
      } finally {
        if (!res.writableEnded) res.end();
      }
      return undefined;
    } catch (error) {
      return next(error);
    }
  },
);

/**
 * POST /intelligence/investor-package
 *
 * Thin adapter over the kernel's pure HTTP handler. Body is a full
 * `OrchestrationInput` (dealId, totalMonths, facilities, cfadsInputs,
 * waterfall, intelligence). Response mirrors the handler envelope:
 *   { package, engineVersion, flagState }
 *
 * Every call persists a package snapshot and a monitoring event
 * fire-and-forget so a Supabase outage does not break the compute path.
 * `engineVersion` ∈ {inline, python, safe-mode}; `safe-mode` means the
 * operator kill-switch (`DEBT_ENGINE_KILL=1`) is engaged.
 */
router.post(
  '/investor-package',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    const organizationId = req.organization?.id || req.user?.organization_id || null;
    const input = req.body || {};
    const dealId = typeof input.dealId === 'string' ? input.dealId : null;
    try {
      const result = await invokeKernelHandler(input, process.env);
      const { status, body } = result;
      const engineVersion = body?.engineVersion || 'inline';

      if (status >= 200 && status < 300 && body?.package && dealId) {
        monitoring.persistInvestorPackageSnapshot({
          organizationId,
          dealId,
          engineVersion,
          source: 'backend',
          inputHash: sha256(input),
          body: body.package,
        }).catch(() => {});
      }

      monitoring.recordMonitoringEvent({
        organizationId,
        dealId,
        source: 'backend',
        event: status < 300 ? 'investor_package_ok' : 'investor_package_error',
        severity:
          status < 300
            ? engineVersion === 'safe-mode' ? 'medium' : 'info'
            : status >= 500 ? 'high' : 'medium',
        engineVersion,
        payload: {
          status,
          hasPackage: Boolean(body?.package),
          killSwitch: Boolean(body?.flagState?.killSwitch),
        },
      }).catch(() => {});

      res.status(status).json({ success: status < 400, data: body });
    } catch (error) {
      monitoring.recordMonitoringEvent({
        organizationId,
        dealId,
        source: 'backend',
        event: 'investor_package_exception',
        severity: 'critical',
        payload: { message: error.message },
      }).catch(() => {});
      next(error);
    }
  }
);

module.exports = router;
