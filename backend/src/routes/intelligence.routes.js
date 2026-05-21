const crypto = require('crypto');
const express = require('express');
const { body } = require('express-validator');
const intelligenceService = require('../services/intelligence.service');
const icMemoService = require('../services/icMemo.service');
const icEvidenceService = require('../services/icEvidence.service');
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
    const data = await intelligenceService.getMicroMarketBenchmarks({
      city: req.query.city,
      dataType: req.query.dataType,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /intelligence/office-benchmarks
router.get('/office-benchmarks', authenticate, async (req, res, next) => {
  try {
    const data = await intelligenceService.getOfficeBenchmarks({
      city: req.query.city,
      levelType: req.query.levelType,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /intelligence/retail-benchmarks
router.get('/retail-benchmarks', authenticate, async (req, res, next) => {
  try {
    const data = await intelligenceService.getRetailBenchmarks({
      city: req.query.city,
      format: req.query.format,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /intelligence/industrial-benchmarks
router.get('/industrial-benchmarks', authenticate, async (req, res, next) => {
  try {
    const data = await intelligenceService.getIndustrialBenchmarks({
      city: req.query.city,
      segment: req.query.segment,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /intelligence/hospitality-benchmarks
router.get('/hospitality-benchmarks', authenticate, async (req, res, next) => {
  try {
    const data = await intelligenceService.getHospitalityBenchmarks({
      city: req.query.city,
      segment: req.query.segment,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /intelligence/residential-segmented-benchmarks
// Asset classes loaded here: builder_floor, plotted_development,
// land_residential_plotted, villa_house, guidance_value.
// Source: v0.2 rate-pack flagged in TODO_DATA.md as schema follow-up.
router.get('/residential-segmented-benchmarks', authenticate, async (req, res, next) => {
  try {
    const data = await intelligenceService.getResidentialSegmentedBenchmarks({
      city: req.query.city,
      assetClass: req.query.assetClass,
      dataType: req.query.dataType,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /intelligence/niche-asset-class-benchmarks
// Asset classes loaded here: coworking, student_housing, senior_living,
// data_center. Source: operator-uploaded IPC reports / broker quotes
// flowing through the comps review queue. Soft-fails to [] when the
// migration hasn't been applied yet (Tier 1 #6–#9 from the v0.2 handoff).
router.get('/niche-asset-class-benchmarks', authenticate, async (req, res, next) => {
  try {
    const data = await intelligenceService.getNicheAssetClassBenchmarks({
      city: req.query.city,
      assetClass: req.query.assetClass,
      dataType: req.query.dataType,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /intelligence/macro-kpis
router.get('/macro-kpis', authenticate, async (req, res, next) => {
  try {
    const data = await intelligenceService.getMacroKpis({
      city: req.query.city,
      assetClass: req.query.assetClass,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /intelligence/deal-analysis/:dealId/cached — last persisted analysis
//
// Returns the most recent ai_artifacts row for this deal + 'deal_analysis'
// type, or 200 with `{ data: null }` when no cached artifact exists yet.
// Lets the deal Overview tab show the last generation immediately on mount
// instead of regenerating from Claude on every page open.
router.get(
  '/deal-analysis/:dealId/cached',
  authenticate,
  async (req, res, next) => {
    try {
      const cached = await intelligenceService.getCachedDealAnalysis(req.params.dealId);
      if (!cached) {
        return res.json({ success: true, data: null });
      }
      return res.json({
        success: true,
        data: {
          analysis: cached.content_md,
          generatedAt: cached.generated_at,
          callId: cached.generated_by_call_id,
          status: cached.status,
          snapshotHash: cached.snapshot_hash,
          // Tier-1 #3 — post-hoc numerical verifier output. Surfaced
          // alongside the narrative so the UI can render a "claims
          // flagged" badge next to the AI-assisted disclaimer.
          numericalDrifts: cached.numerical_drifts,
          verifiedAt: cached.verified_at,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

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
            // Forward verifier output so the UI can render the
            // drift badge immediately after streaming completes,
            // without a follow-up GET to /cached.
            numericalDrifts: final.numericalDrifts,
            verifiedAt: final.verifiedAt,
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

// ─── IC Memo (Tier-2 #13) ──────────────────────────────────────────────────
// Same trio as deal-analysis (cached / generate / stream) but pulls
// comprehensive context (risks, DD, approvals) and produces longer-form
// structured markdown across 8 IC sections.

// GET /intelligence/ic-memo/:dealId/cached — last persisted memo or null
router.get(
  '/ic-memo/:dealId/cached',
  authenticate,
  async (req, res, next) => {
    try {
      const cached = await icMemoService.getCached(req.params.dealId);
      if (!cached) {
        return res.json({ success: true, data: null });
      }
      return res.json({
        success: true,
        data: {
          memo: cached.content_md,
          generatedAt: cached.generated_at,
          callId: cached.generated_by_call_id,
          status: cached.status,
          snapshotHash: cached.snapshot_hash,
          numericalDrifts: cached.numerical_drifts,
          verifiedAt: cached.verified_at,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

// GET /intelligence/ic-memo/:dealId/evidence — Workstream A (Provenance Spine).
//
// The deterministic evidence ledger beneath the IC memo: every material number
// the IC decision rests on, each with an honest typed source (kernel-computed,
// analyst-set, REDIP benchmark, deal records, verified feed). No AI — this is
// the auditable claim layer the AI narrative sits on top of. Soft-fails to
// { available: false } so the panel can hide.
router.get(
  '/ic-memo/:dealId/evidence',
  authenticate,
  async (req, res, next) => {
    try {
      const ledger = await icEvidenceService.getEvidenceLedger(req.params.dealId);
      res.json({ success: true, data: ledger });
    } catch (error) {
      next(error);
    }
  },
);

// POST /intelligence/ic-memo/:dealId — non-streaming generation (rare path,
// kept for symmetry + automated callers)
router.post(
  '/ic-memo/:dealId',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const result = await icMemoService.generate(req.params.dealId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

// POST /intelligence/ic-memo/:dealId/stream — SSE-streamed IC memo
router.post(
  '/ic-memo/:dealId/stream',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const stream = await icMemoService.stream(req.params.dealId);
      if (stream.error) {
        return res.status(stream.status || 500).json({ success: false, message: stream.error });
      }
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      const writeFrame = (obj) => {
        if (res.writableEnded) return;
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
      };

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
            snapshotHash: final.snapshotHash,
            artifactId: final.artifactId,
            numericalDrifts: final.numericalDrifts,
            verifiedAt: final.verifiedAt,
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
