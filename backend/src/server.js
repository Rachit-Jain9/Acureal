require('dotenv').config({ override: process.env.NODE_ENV !== 'production' });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Route imports
const authRoutes = require('./routes/auth.routes');
const propertyRoutes = require('./routes/property.routes');
const dealRoutes = require('./routes/deal.routes');
const financialRoutes = require('./routes/financial.routes');
const compsRoutes = require('./routes/comps.routes');
const documentRoutes = require('./routes/document.routes');
const activityRoutes = require('./routes/activity.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const exportRoutes = require('./routes/export.routes');
const healthRoutes = require('./routes/health.routes');
const intelligenceRoutes = require('./routes/intelligence.routes');
const ddRoutes = require('./routes/dd.routes');
const approvalsRoutes = require('./routes/approvals.routes');
const riskRoutes = require('./routes/risk.routes');
const extractionRoutes = require('./routes/extraction.routes');

const app = express();

// Security middleware
app.use(helmet());

// CORS
const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .filter(Boolean)
  .map((o) => o.trim());

const allowedOrigins = new Set(corsOrigins);
const isLoopbackOrigin = (origin) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
const isVercelOrigin = (origin) => /\.vercel\.app$/i.test(origin);

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    if (process.env.NODE_ENV !== 'production' && isLoopbackOrigin(origin)) {
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
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/financials', financialRoutes);
app.use('/api/comps', compsRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/intelligence', intelligenceRoutes);
app.use('/api/exports', exportRoutes);
app.use('/api/health', healthRoutes);
app.use('/api', ddRoutes);
app.use('/api', approvalsRoutes);
app.use('/api', riskRoutes);
app.use('/api', extractionRoutes);

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Start server (skip in serverless/test environments)
const PORT = parseInt(process.env.PORT, 10) || 5000;

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`REDIP API server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
  });
}

module.exports = app;
