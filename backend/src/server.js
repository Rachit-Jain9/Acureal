require('./config/loadEnv');

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
const riskRoutes = require('./routes/risk.routes');
const extractionRoutes = require('./routes/extraction.routes');
const fxRoutes = require('./routes/fx.routes');
const parcelCronRoutes = require('./routes/parcelCron.routes');
const adminRoutes = require('./routes/admin.routes');
const searchRoutes = require('./routes/search.routes');
const localityIntelligenceRoutes = require('./routes/localityIntelligence.routes');
const masterPlanRoutes = require('./routes/masterplan.routes');
const parcelIntelligenceRoutes = require('./routes/parcelIntelligence.routes');
const evidenceLinksRoutes = require('./routes/evidenceLinks.routes');
const legalRoutes = require('./routes/legal.routes');
const compsReviewQueueRoutes = require('./routes/compsReviewQueue.routes');

// Wire the deal-event sink early — it's pure subscription, no side effects
// until events fire, but registering at module load keeps test isolation
// simple (tests can call dealEventsService.unregister()).
require('./services/dealEvents.service').register();

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
app.use('/api/fx/refresh', heavyLimiter);
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
app.use('/api', riskRoutes);
app.use('/api', extractionRoutes);
app.use('/api/fx', fxRoutes);
app.use('/api/cron', parcelCronRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/locality-intelligence', localityIntelligenceRoutes);
app.use('/api/master-plan', masterPlanRoutes);
app.use('/api/parcel-intelligence', parcelIntelligenceRoutes);
app.use('/api', evidenceLinksRoutes);
app.use('/api/legal', legalRoutes);
app.use('/api/comps-review-queue', compsReviewQueueRoutes);

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
