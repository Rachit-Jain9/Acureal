'use strict';

/**
 * authDefiners — decides whether the auth bootstrap should route through the
 * SECURITY DEFINER helper functions (migration 20260801) or the original
 * direct queries.
 *
 * Why this exists (M1 Phase 2): once the app connects via a non-BYPASSRLS
 * role, the pre-identity auth reads/writes (login-by-email, register INSERT,
 * OAuth lookups, MFA-challenge join) are blocked by RLS. The definer functions
 * perform exactly those operations as owner. Under today's bypass role both
 * paths return byte-identical results, so preferring the definer path when it
 * exists is behavior-neutral — and makes the eventual role flip a pure config
 * change.
 *
 * Probe semantics (red-team hardened):
 *   - Probes the LAST/most-complex function (auth_provision_signup) so a
 *     partial deployment fails the probe CLOSED (all six ship atomically in
 *     one migration; if the complex one is present, all are).
 *   - Caches ONLY a definitive true/false obtained from a successful query.
 *     A thrown/transient probe error is NEVER cached (a cold-start pooler
 *     hiccup must not pin a warm post-flip instance onto the direct path).
 *   - RLS_ENFORCED=true (set in the SAME Vercel deploy that flips DATABASE_URL
 *     to the non-bypass role) makes the direct fallback UNREACHABLE: a probe
 *     error or a definitive "functions absent" throws a loud 503 instead of
 *     silently running direct queries that RLS would empty out.
 *   - NODE_ENV==='test' short-circuits to false without touching the DB so the
 *     existing mocked auth suites keep exercising the (still supported)
 *     direct path deterministically. Tests opt into the definer path via
 *     __forceForTests().
 */

const { createError } = require('../middleware/errorHandler');

// Full signature of the most complex definer — the probe target. Kept in one
// place so the migration, the probe, and the static migration-scan test agree.
const PROBE_SIGNATURE =
  'public.auth_provision_signup(text,text,text,text,text,text,text,boolean,boolean,text,text,text,text,text[],text,text,bigint[],inet,text)';

let cached = null; // null = unknown; true/false = definitively probed
let forcedForTests = null;

const rlsEnforced = () => process.env.RLS_ENFORCED === 'true';

const requireDefinerPath = async () => {
  if (process.env.NODE_ENV === 'test') {
    return forcedForTests ?? false;
  }
  if (cached !== null) {
    return cached;
  }

  let present;
  try {
    // Lazy-required to avoid a config/database ↔ lib cycle at module load.
    const { query } = require('../config/database');
    const result = await query(
      'SELECT to_regprocedure($1) IS NOT NULL AS present',
      [PROBE_SIGNATURE]
    );
    present = result.rows[0]?.present === true;
  } catch (probeError) {
    if (rlsEnforced()) {
      // Post-flip, the direct path would silently return RLS-emptied rows —
      // that is the one outcome this module exists to prevent. Fail loud.
      throw createError(
        'Authentication backend is temporarily unavailable (definer probe failed under enforced RLS). Please retry.',
        503
      );
    }
    // Pre-flip a transient probe failure is safe to survive: the direct path
    // is fully correct under the bypass role. Do NOT cache — retry next call.
    return false;
  }

  if (!present && rlsEnforced()) {
    // Definitive absence while RLS is enforced = misconfigured deploy
    // (DATABASE_URL flipped before the migration was applied). Fail loud —
    // never fall back to direct queries that would silently see zero rows.
    throw createError(
      'Authentication backend is misconfigured (RLS enforced but auth definer functions are absent). Apply migration 20260801.',
      503
    );
  }

  cached = present;
  return cached;
};

// Test hooks — no production caller uses these.
const __forceForTests = (value) => { forcedForTests = value; };
const __resetForTests = () => { forcedForTests = null; cached = null; };

module.exports = { requireDefinerPath, rlsEnforced, PROBE_SIGNATURE, __forceForTests, __resetForTests };
