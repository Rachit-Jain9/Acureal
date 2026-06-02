'use strict';

const rateLimit = require('express-rate-limit');
// IPv6-safe normalisation for the unauthenticated fallback key — without it,
// every IPv6 address looks unique and a v6 client could bypass the limit
// (express-rate-limit ERR_ERL_KEY_GEN_IPV6).
const { ipKeyGenerator } = require('express-rate-limit');

/**
 * Dedicated limiter for the genuinely expensive, UNCACHED AI endpoints —
 * Deal Q&A, the on-demand sensitivity/risk narrative GETs, and Smart Property
 * Capture. Each request to these drives at least one live provider call
 * (Claude / OpenAI / Gemini), so the relaxed 120/min general limiter is far too
 * loose: an authenticated user (or a buggy retry loop / over-shared token)
 * could script hundreds of provider calls per minute and run up the AI bill
 * (cost-DoS) while starving the provider rate-limit for every tenant.
 *
 * Keyed by the authenticated user (falling back to IP for unauthenticated
 * hits, e.g. a 401 before `authenticate` populates req.user), so one abuser
 * can't exhaust the window for the whole shared IP/tenant pool. Apply AFTER
 * `authenticate` so req.user is populated.
 *
 * Deliberately NOT applied to the deal-workspace read: its narration is
 * response-cached (an unchanged deal is a cache hit, no provider call), so it
 * behaves like an ordinary read and rate-limiting it would throttle normal
 * deal-page navigation. The complementary hard ceiling is the per-day cost cap
 * (AI_DAILY_COST_CAP_USD) — see costGuard + validateEnv.
 */
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: {
    success: false,
    message: 'You are sending AI requests too quickly. Please wait a moment and try again.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

module.exports = { aiLimiter };
