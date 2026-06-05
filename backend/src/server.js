require('./config/loadEnv');
require('./config/validateEnv').validateEnv();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { runWithRequestContext } = require('./lib/requestContext');
const { requestIdMiddleware, requestLoggingMiddleware } = require('./middleware/requestId');
const log = require('./lib/logger').child({ module: 'server' });

// Route imports
const authRoutes = require('./routes/auth.routes');
const propertyRoutes = require('./routes/property.routes');
const dealRoutes = require('./routes/deal.routes');
const financialRoutes = require('./routes/financial.routes');
const waterfallRoutes = require('./routes/waterfall.routes');
const compsRoutes = require('./routes/comps.routes');
const documentRoutes = require('./routes/document.routes');
const uploadRoutes = require('./routes/upload.routes');
const activityRoutes = require('./routes/activity.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const exportRoutes = require('./routes/export.routes');
const healthRoutes = require('./routes/health.routes');
const intelligenceRoutes = require('./routes/intelligence.routes');
const ddRoutes = require('./routes/dd.routes');
const approvalsRoutes = require('./routes/approvals.routes');
const signoffRoutes = require('./routes/signoff.routes');
const riskRoutes = require('./routes/risk.routes');
const extractionRoutes = require('./routes/extraction.routes');
// fx.routes retired 2026-05-24 — multi-currency display feature removed
const parcelCronRoutes = require('./routes/parcelCron.routes');
const adminRoutes = require('./routes/admin.routes');
const searchRoutes = require('./routes/search.routes');
const localityIntelligenceRoutes = require('./routes/localityIntelligence.routes');
const masterPlanRoutes = require('./routes/masterplan.routes');
const parcelIntelligenceRoutes = require('./routes/parcelIntelligence.routes');
const evidenceLinksRoutes = require('./routes/evidenceLinks.routes');
const legalRoutes = require('./routes/legal.routes');
const compsReviewQueueRoutes = require('./routes/compsReviewQueue.routes');
const ingestRoutes = require('./routes/ingest.routes');
const consentRoutes = require('./routes/consent.routes');
const privacyRoutes = require('./routes/privacy.routes');
const promoterRoutes = require('./routes/promoter.routes');
const organizationRoutes = require('./routes/organization.routes');
const recommendationRoutes = require('./routes/recommendation.routes');
const microMarketRoutes = require('./routes/microMarket.routes');
const bestUseSimulatorRoutes = require('./routes/bestUseSimulator.routes');
const dealStructureRecommenderRoutes = require('./routes/dealStructureRecommender.routes');
const capitalStackOptimizerRoutes = require('./routes/capitalStackOptimizer.routes');

// Wire the deal-event sink early — it's pure subscription, no side effects
// until events fire, but registering at module load keeps test isolation
// simple (tests can call dealEventsService.unregister()).
require('./services/dealEvents.service').register();
// P1-PR4 (2026-05-26) — auto-run the cross-document inconsistency detector
// every time a new extraction completes. Debounced 90s per deal so a burst
// of uploads collapses to one detector pass. Fire-and-forget — never blocks.
require('./services/inconsistencyDetector.sink').register();
// Immutable sensitive-document access log (CLAUDE.md "log access to sensitive
// documents"). Subscribes to DOCUMENT_ACCESSED and writes an append-only row
// to document_access_log on every signed-URL issuance / byte-stream download.
require('./services/documentAccessLog.sink').register();

const app = express();

app.use((req, res, next) => {
  runWithRequestContext({}, next);
});
app.use(requestIdMiddleware);

// Vercel and other reverse proxies forward client IPs via X-Forwarded-* headers.
// Trust the first proxy hop so express-rate-limit and auth middleware read them correctly.
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// Cookie parser — populates req.cookies for the auth middleware (access
// cookie read), refresh-token endpoint (refresh cookie read), and any
// future feature that needs cookies. Must come before any route that
// reads cookies.
app.use(cookieParser());

// CORS
const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .filter(Boolean)
  .map((o) => o.trim());

const allowedOrigins = new Set(corsOrigins);
const isLoopbackOrigin = (origin) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
const isVercelOrigin = (origin) => /\.vercel\.app$/i.test(origin);
const isLocalRuntime = !process.env.VERCEL;

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    if (isLocalRuntime && isLoopbackOrigin(origin)) {
      return callback(null, true);
    }

    // Allow same-origin requests on Vercel (preview & production URLs)
    if (process.env.VERCEL && isVercelOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-organization-id'],
}));

// Rate limiting
// Auth endpoints: strict (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again in 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// AI generation and export endpoints: moderate (cost protection)
const heavyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Rate limit reached for this operation. Please wait before retrying.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// General API: relaxed global limit
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please slow down.' },
  skip: () => process.env.NODE_ENV === 'test',
});

app.use('/api/auth', authLimiter);
app.use('/api/intelligence', heavyLimiter);
app.use('/api/exports', heavyLimiter);
app.use('/api/extraction', heavyLimiter);
app.use('/api/privacy', heavyLimiter);
app.use('/api', generalLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging — structured JSON in prod/Vercel; morgan kept for human-friendly dev tail.
if (process.env.NODE_ENV !== 'test') {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    app.use(requestLoggingMiddleware);
  } else {
    app.use(morgan('dev'));
    app.use(requestLoggingMiddleware);
  }
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/financials', financialRoutes);
app.use('/api/waterfall', waterfallRoutes);
app.use('/api/comps', compsRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/intelligence', intelligenceRoutes);
app.use('/api/exports', exportRoutes);
app.use('/api/health', healthRoutes);
app.use('/api', ddRoutes);
app.use('/api', approvalsRoutes);
app.use('/api', signoffRoutes);
app.use('/api', riskRoutes);
app.use('/api', promoterRoutes);
app.use('/api', extractionRoutes);
app.use('/api/cron', parcelCronRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/locality-intelligence', localityIntelligenceRoutes);
app.use('/api/master-plan', masterPlanRoutes);
app.use('/api/parcel-intelligence', parcelIntelligenceRoutes);
app.use('/api', evidenceLinksRoutes);
app.use('/api/legal', legalRoutes);
app.use('/api/comps-review-queue', compsReviewQueueRoutes);
app.use('/api/ingest', ingestRoutes);
app.use('/api/consent', consentRoutes);
app.use('/api/privacy', privacyRoutes);
app.use('/api/organization', organizationRoutes);
// PR-C (2026-05-25) — recommendation verdict capture (dismiss / snooze / acted).
// Routes are deal-scoped under /api/deals/:dealId/recommendations/*.
app.use('/api', recommendationRoutes);
// P1-PR2 (2026-05-26) — Micro-Market Intelligence pre-deal-create endpoints
// (classify / defaults / list). Briefing for a deal already lives on the
// /deals/:id/workspace endpoint as `micro_market` slice.
app.use('/api/micro-market', microMarketRoutes);

// Best Use Simulator (Phase 2 / Pillar 2) — deal-independent. Per-deal
// scores already live on the /deals/:id/workspace endpoint as `best_use`
// slice. This route serves parcel-first sourcing where coordinates are
// known before a deal exists.
app.use('/api/best-use', bestUseSimulatorRoutes);

// Deal-Structure Recommender (Phase 2 / Pillar 3, first half) — deal-
// independent. Per-deal scores already live on the workspace endpoint as
// `deal_structure_recommender` slice. This route serves stateless
// asset-class + promoter-posture exploration before a deal exists.
app.use('/api/deal-structure-recommender', dealStructureRecommenderRoutes);

// Capital-Stack Optimizer (Phase 2 / Pillar 3, second half) — deal-
// independent. Per-deal scenarios already live on the workspace endpoint
// as `capital_stack_optimizer` slice. This route serves stateless
// scenario-stress / IC sensitivity flows.
app.use('/api/capital-stack-optimizer', capitalStackOptimizerRoutes);

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Start server (skip in serverless/test environments)
const PORT = parseInt(process.env.PORT, 10) || 5000;

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    log.info('server_started', {
      port: PORT,
      environment: process.env.NODE_ENV || 'development',
      health_check: `http://localhost:${PORT}/api/health`,
    });
  });
}

module.exports = app;
