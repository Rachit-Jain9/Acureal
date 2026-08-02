'use strict';

/**
 * Unit tests for scripts/check-postgrest-exposure.js — the CI regression fence
 * that stops a new migration reopening the PostgREST Data API.
 *
 * CI has no database credentials, so the guard is necessarily static: it lints
 * post-containment migrations for grants to the API roles and for SECURITY
 * DEFINER functions created without a pinned search_path, a REVOKE from PUBLIC,
 * or a review. The live half is the hourly `api_exposure` canary in
 * healthCheck.service.js; this file also pins that the two allowlists agree,
 * because they are deliberate mirrors (the Vercel bundle ships only `backend/**`,
 * so the backend cannot require the root script).
 */

const guard = require('../../scripts/check-postgrest-exposure');
const health = require('../src/services/healthCheck.service');

describe('forbiddenGrants', () => {
  test('flags a grant to each PostgREST role', () => {
    for (const role of ['anon', 'authenticated', 'PUBLIC']) {
      const hits = guard.forbiddenGrants(`GRANT SELECT ON public.deals TO ${role};`);
      expect(hits).toHaveLength(1);
      expect(hits[0].grantees).toEqual([role.toLowerCase()]);
    }
  });

  test('flags an API role hidden in a multi-grantee list', () => {
    const hits = guard.forbiddenGrants('GRANT SELECT ON public.deals TO redip_app, anon;');
    expect(hits).toHaveLength(1);
    expect(hits[0].grantees).toEqual(['anon']);
  });

  test('allows the roles the application legitimately uses', () => {
    expect(guard.forbiddenGrants('GRANT SELECT ON public.deals TO redip_app;')).toEqual([]);
    expect(guard.forbiddenGrants('GRANT SELECT ON public.deals TO service_role;')).toEqual([]);
  });

  test('ignores grants that appear only in comments', () => {
    // The containment migration documents its break-glass rollback as commented
    // GRANT statements — the guard must not flag the file that closes the hole.
    const sql = `
      -- GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
      /* GRANT SELECT ON public.users TO anon; */
      GRANT SELECT ON public.deals TO redip_app;
    `;
    expect(guard.forbiddenGrants(sql)).toEqual([]);
  });

  test('does not mistake a REVOKE for a GRANT', () => {
    expect(guard.forbiddenGrants('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;')).toEqual([]);
  });
});

describe('securityDefinerFunctions', () => {
  const definer = (extra) => `
    CREATE OR REPLACE FUNCTION public.auth_find_user_for_login(p_email text)
    RETURNS TABLE (id uuid)
    LANGUAGE sql
    SECURITY DEFINER
    ${extra}
    AS $$ SELECT id FROM public.users WHERE email = p_email $$;
  `;

  test('detects a SECURITY DEFINER function and accepts pg_temp last', () => {
    const found = guard.securityDefinerFunctions(definer('SET search_path = pg_catalog, public, pg_temp'));
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('public.auth_find_user_for_login');
    expect(found[0].searchPathSafe).toBe(true);
  });

  test('rejects a search_path without pg_temp last', () => {
    expect(guard.securityDefinerFunctions(definer('SET search_path = pg_temp, public'))[0].searchPathSafe).toBe(false);
    expect(guard.securityDefinerFunctions(definer(''))[0].searchPathSafe).toBe(false);
  });

  test('ignores SECURITY INVOKER functions entirely', () => {
    const sql = `
      CREATE FUNCTION public.helper() RETURNS int
      LANGUAGE sql SECURITY INVOKER AS $$ SELECT 1 $$;
    `;
    expect(guard.securityDefinerFunctions(sql)).toEqual([]);
  });

  test('reads a one-line search_path without swallowing the body into the last schema name', () => {
    // `SET search_path = a, b, pg_temp AS $$ … $$` is valid SQL. A capture that
    // runs to end-of-line makes the last schema read "pg_temp AS $$ SELECT 1 $$"
    // and wrongly reports a correctly-pinned definer as unpinned.
    const sql = `
      CREATE FUNCTION public.widget() RETURNS int LANGUAGE sql SECURITY DEFINER
      SET search_path = pg_catalog, public, pg_temp AS $$ SELECT 1 $$;
    `;
    expect(guard.securityDefinerFunctions(sql)[0].searchPathSafe).toBe(true);
  });

  test('qualifies a bare function name to the public schema', () => {
    const sql = `
      CREATE FUNCTION widget() RETURNS int LANGUAGE sql SECURITY DEFINER
      SET search_path = pg_catalog, public, pg_temp AS $$ SELECT 1 $$;
    `;
    expect(guard.securityDefinerFunctions(sql)[0].name).toBe('public.widget');
  });
});

describe('revokesExecuteFromPublic', () => {
  test('finds the revoke regardless of the argument list', () => {
    const sql = 'REVOKE ALL ON FUNCTION public.auth_find_user_for_login(text) FROM anon, authenticated, PUBLIC;';
    expect(guard.revokesExecuteFromPublic(sql, 'public.auth_find_user_for_login')).toBe(true);
  });

  test('is false when the revoke omits PUBLIC', () => {
    const sql = 'REVOKE ALL ON FUNCTION public.auth_find_user_for_login(text) FROM anon;';
    expect(guard.revokesExecuteFromPublic(sql, 'public.auth_find_user_for_login')).toBe(false);
  });

  test('is false when a different function is revoked', () => {
    const sql = 'REVOKE ALL ON FUNCTION public.something_else(text) FROM PUBLIC;';
    expect(guard.revokesExecuteFromPublic(sql, 'public.auth_find_user_for_login')).toBe(false);
  });
});

describe('lintFile', () => {
  test('a well-formed new definer migration passes', () => {
    const sql = `
      CREATE OR REPLACE FUNCTION public.auth_find_invitation(p_token text)
      RETURNS TABLE (id uuid) LANGUAGE sql SECURITY DEFINER
      SET search_path = pg_catalog, public, pg_temp
      AS $$ SELECT id FROM public.invitations WHERE token = p_token $$;
      REVOKE ALL ON FUNCTION public.auth_find_invitation(text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.auth_find_invitation(text) TO redip_app;
    `;
    expect(guard.lintFile('20260901_x.sql', sql)).toEqual([]);
  });

  test('an unreviewed definer is rejected even when otherwise perfect', () => {
    const sql = `
      CREATE FUNCTION public.brand_new_definer() RETURNS int LANGUAGE sql SECURITY DEFINER
      SET search_path = pg_catalog, public, pg_temp AS $$ SELECT 1 $$;
      REVOKE ALL ON FUNCTION public.brand_new_definer() FROM PUBLIC;
    `;
    const issues = guard.lintFile('20260901_x.sql', sql);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/not on the reviewed allowlist/);
  });

  test('a grant to anon is rejected with an actionable message', () => {
    const issues = guard.lintFile('20260901_x.sql', 'GRANT SELECT ON public.deals TO anon;');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/Grant to redip_app instead/);
  });
});

describe('scope', () => {
  test('lints only migrations dated after the containment migration', () => {
    expect(guard.isLinted('20260806_new_thing.sql')).toBe(true);
    expect(guard.isLinted(`${guard.CONTAINMENT_MIGRATION_DATE}_revoke_postgrest_exposure.sql`)).toBe(false);
    // Pre-containment grants are real and are neutralised wholesale by 20260805;
    // rewriting applied history to satisfy a linter would be worse than useless.
    expect(guard.isLinted('20260526_ab_eval_runs.sql')).toBe(false);
    expect(guard.isLinted('not-a-migration.sql')).toBe(false);
  });
});

describe('the live corpus', () => {
  test('passes the guard today', () => {
    expect(guard.runCheck().failures).toBe(0);
  });
});

describe('allowlist parity', () => {
  test('the guard and the runtime canary agree on the reviewed definers', () => {
    // Deliberate mirrors: the backend cannot require the root script because
    // vercel.json only bundles `backend/**`. Change one, change both.
    expect([...guard.APPROVED_DEFINERS].sort()).toEqual([...health.APPROVED_DEFINERS].sort());
  });

  test('every reviewed definer is schema-qualified', () => {
    for (const fn of guard.APPROVED_DEFINERS) expect(fn).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });
});
