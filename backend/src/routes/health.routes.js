const express = require('express');
const { pool } = require('../config/database');
const { getStorageStatus } = require('../config/storage');

const router = express.Router();

// GET /health
router.get('/', async (req, res) => {
  const storage = getStorageStatus();

  res.json({
    success: true,
    status: 'healthy',
    storage: storage.status === 'healthy' ? 'ready' : storage.status,
    storage_provider: storage.provider,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// GET /health/detailed
router.get('/detailed', async (req, res) => {
  const checks = {
    server: { status: 'healthy' },
    database: { status: 'unknown' },
    storage: getStorageStatus(),
    memory: {},
  };

  // Database check
  try {
    const start = Date.now();
    const result = await pool.query('SELECT NOW() as now, current_database() as db');
    checks.database = {
      status: 'healthy',
      latency_ms: Date.now() - start,
      database: result.rows[0].db,
      server_time: result.rows[0].now,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
    };
  } catch (error) {
    checks.database = {
      status: 'unhealthy',
      error: error.message || error.code || 'Database connection failed.',
    };
  }

  // Memory usage
  const mem = process.memoryUsage();
  checks.memory = {
    rss_mb: Math.round(mem.rss / 1024 / 1024),
    heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
    heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
  };

  const isHealthy = checks.database.status === 'healthy';

  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  });
});

module.exports = router;
