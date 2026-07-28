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
  let fallbackIsSafe;
  try {
    // Lazy-required to avoid a config/database ↔ lib cycle at module load.
    const { query } = require('../config/database');
    // Both facts in ONE round trip: are the definers present, and could the
    // direct fallback even work? The fallback is only correct when the
    // connecting role bypasses RLS — that is a property of the live
    // connection, not of an env var someone might delete, so we read it from
    // the database rather than trusting configuration.
    const result = await query(
      `SELECT to_regprocedure($1) IS NOT NULL AS present,
              COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS bypasses_rls`,
      [PROBE_SIGNATURE]
    );
    present = result.rows[0]?.present === true;
    fallbackIsSafe = result.rows[0]?.bypasses_rls === true;
  } catch (probeError) {
    // A probe failure means we could not DETERMINE which path is safe.
    //
    // This used to fall through to `return false` whenever RLS_ENFORCED was
    // absent, on the reasoning that the direct path is correct under a
    // BYPASSRLS role. That reasoning expired on 2026-07-28: production now
    // connects as `redip_app`, which cannot bypass RLS, so the direct path
    // returns RLS-emptied rows — a login that silently reports "invalid email
    // or password" rather than an outage.
    //
    // The danger was that `rlsEnforced()` reads the env var at CALL time, so a
    // single removed or mistyped `RLS_ENFORCED` would re-arm that silent
    // failure across every auth path at once. An env var is the wrong thing to
    // stake the auth boundary on. We now fail loud unconditionally: guessing
    // wrong in the safe direction costs one retry, guessing wrong in the other
    // direction costs a total auth outage disguised as user error.
    //
    // Deliberately NOT cached — a transient DB blip must not pin this state.
    throw createError(
      'Authentication backend is temporarily unavailable (could not verify the auth definer functions). Please retry.',
      503
    );
  }

  if (!present && !fallbackIsSafe) {
    // The definers are absent AND the connecting role cannot bypass RLS, so
    // the direct fallback would read RLS-emptied rows and report a correct
    // password as invalid. Fail loud instead.
    //
    // The gate used to be `rlsEnforced()` — an env var. It is now the live
    // role's own RLS posture, so the guard cannot be disarmed by editing
    // configuration, and it self-configures for any environment: a dev
    // database still on the bypass role keeps its working fallback, while
    // anything running restricted is protected.
    throw createError(
      'Authentication backend is misconfigured (the database role cannot bypass RLS but the auth definer functions are absent). Apply migration 20260801.',
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
