'use strict';

/**
 * Cron auth middleware. Mounts on Vercel-cron-triggered endpoints
 * (`/api/fx/refresh/daily`, `/api/cron/*`).
 *
 * Vercel-cron requests carry `Authorization: Bearer ${CRON_SECRET}` plus an
 * `x-vercel-cron` header. We accept the bearer token as the canonical proof —
 * the header is informational. If `CRON_SECRET` is unset we 503 rather than
 * silently allow, so misconfigured envs don't expose expensive endpoints to
 * the open internet.
 *
 * Replaces two duplicated `getCronToken` helpers that had drifted between
 * `parcelCron.routes.js` and `fx.routes.js`.
 */

const expectedToken = () => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  return `Bearer ${secret}`;
};

const requireCronAuth = (req, res, next) => {
  const expected = expectedToken();
  if (!expected) {
    return res.status(503).json({
      success: false,
      message: 'CRON_SECRET is not configured.',
    });
  }
  if (req.get('authorization') !== expected) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized cron request.',
    });
  }
  return next();
};

module.exports = { requireCronAuth };
