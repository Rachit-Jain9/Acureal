'use strict';

/**
 * Static pins for database/migrations/20260805_revoke_postgrest_exposure.sql —
 * the migration that closes the PostgREST parallel door.
 *
 * The defect: Acureal has two doors into the same database. Every prior review
 * reasoned about the Express API; nobody inventoried Supabase's PostgREST Data
 * API, which is live and internet-facing and serves `public`. Supabase's
 * default privileges had granted `anon` and `authenticated` full CRUD on all 83
 * tables in `public` plus EXECUTE on every function — including the six auth
 * SECURITY DEFINER helpers the M1 RLS rollout itself introduced. With only the
 * project's publishable key that reached password hashes, TOTP seeds, the
 * cross-org signup roster, account provisioning, and a refresh_token_grants
 * INSERT that forges a session for any user without a password.
 *
 * These tests pin the repair's shape so a future edit cannot quietly drop a
 * revoke, re-grant to an API role, or lock the application out of its own auth
 * bootstrap.
 */

const fs = require('fs');
const path = require('path');

const MIGRATION = path.resolve(
  __dirname, '..', '..', 'database', 'migrations', '20260805_revoke_postgrest_exposure.sql',
);
const sql = fs.readFileSync(MIGRATION, 'utf8');

// The header documents the break-glass rollback as commented GRANT statements.
// Strip comments so assertions only ever see SQL that actually runs.
const executable = sql
  .replace(/^--.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const AUTH_DEFINERS = [
  'auth_find_user_for_login',
  'auth_find_user_by_oauth',
  'auth_find_mfa_challenge',
  'auth_lookup_verified_domain',
  'auth_find_invitation',
  'auth_provision_signup',
  'admin_list_signups',
  'admin_signup_summary',
];

describe('the API roles lose every object privilege', () => {
  test.each(['public', 'regulatory_data'])(
    'revokes tables, sequences and functions in %s from anon and authenticated',
    (schema) => {
      for (const objectType of ['TABLES', 'SEQUENCES', 'FUNCTIONS']) {
        expect(executable).toMatch(
          new RegExp(
            `REVOKE\\s+ALL\\s+PRIVILEGES\\s+ON\\s+ALL\\s+${objectType}\\s+IN\\s+SCHEMA\\s+${schema}\\s+FROM\\s+anon,\\s*authenticated`,
            'i',
          ),
        );
      }
    },
  );

  test('revokes USAGE on regulatory_data, which has no PUBLIC grant to defeat it', () => {
    expect(executable).toMatch(/REVOKE\s+USAGE\s+ON\s+SCHEMA\s+regulatory_data\s+FROM\s+anon,\s*authenticated/i);
  });

  test('does NOT revoke USAGE on public — that would need a revoke FROM PUBLIC, a far wider blast radius', () => {
    // Deliberate: the `public` schema ACL carries a bare `=U/pg_database_owner`
    // entry, so USAGE reaches anon through PUBLIC. Object-level revokes already
    // make the schema yield nothing; see the migration header.
    expect(executable).not.toMatch(/REVOKE\s+USAGE\s+ON\s+SCHEMA\s+public/i);
  });
});

describe('the SECURITY DEFINER surface is named explicitly', () => {
  test.each(AUTH_DEFINERS)('%s is revoked from anon, authenticated AND PUBLIC', (fn) => {
    const stmt = new RegExp(
      `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?\\)\\s*FROM\\s+anon,\\s*authenticated,\\s*PUBLIC`,
      'i',
    );
    expect(executable).toMatch(stmt);
  });

  test('every definer that returns credential material is covered', () => {
    // auth_find_user_for_login returns password_hash; auth_find_mfa_challenge
    // returns mfa_secret; admin_list_signups returns the cross-org PII roster;
    // auth_provision_signup writes users/orgs/memberships.
    for (const fn of [
      'auth_find_user_for_login', 'auth_find_mfa_challenge',
      'admin_list_signups', 'auth_provision_signup',
    ]) {
      expect(AUTH_DEFINERS).toContain(fn);
    }
  });
});

describe('the door cannot reopen on the next CREATE TABLE', () => {
  test.each(['public', 'regulatory_data'])(
    'default privileges for role postgres in %s are revoked for all three object types',
    (schema) => {
      for (const clause of ['ALL ON TABLES', 'ALL ON SEQUENCES', 'EXECUTE ON FUNCTIONS']) {
        expect(executable).toMatch(
          new RegExp(
            `ALTER\\s+DEFAULT\\s+PRIVILEGES\\s+FOR\\s+ROLE\\s+postgres\\s+IN\\s+SCHEMA\\s+${schema}\\s+REVOKE\\s+${clause.replace(/ /g, '\\s+')}\\s+FROM\\s+anon,\\s*authenticated`,
            'i',
          ),
        );
      }
    },
  );

  test('the supabase_admin defaults are attempted but tolerated when membership is absent', () => {
    expect(executable).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/);
    expect(executable).toMatch(/EXCEPTION[\s\S]*?WHEN\s+insufficient_privilege/i);
  });
});

describe('the application is never locked out', () => {
  test('no REVOKE targets redip_app, service_role or postgres', () => {
    const revokes = executable.match(/REVOKE[^;]*;/gi) || [];
    expect(revokes.length).toBeGreaterThan(0);
    for (const stmt of revokes) {
      expect(stmt).not.toMatch(/\bFROM\b[^;]*\bredip_app\b/i);
      expect(stmt).not.toMatch(/\bFROM\b[^;]*\bservice_role\b/i);
      expect(stmt).not.toMatch(/\bFROM\b[^;]*\bpostgres\b/i);
    }
  });

  test('the app role is re-granted EXECUTE on all eight definers, guarded for databases without the role', () => {
    for (const fn of AUTH_DEFINERS) {
      expect(executable).toMatch(
        new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?\\)\\s*TO\\s+redip_app`, 'i'),
      );
    }
    expect(executable).toMatch(/IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+pg_roles\s+WHERE\s+rolname\s*=\s*'redip_app'/i);
  });

  test('the only GRANTs in executable SQL go to redip_app — never to an API role', () => {
    const grants = executable.match(/\bGRANT\b[\s\S]*?;/gi) || [];
    expect(grants.length).toBeGreaterThan(0);
    for (const stmt of grants) {
      expect(stmt).toMatch(/TO\s+redip_app/i);
      expect(stmt).not.toMatch(/\bTO\b[^;]*\b(anon|authenticated)\b/i);
    }
  });
});

describe('operational shape', () => {
  test('is wrapped in an explicit transaction and uses no CONCURRENTLY', () => {
    expect(executable).toMatch(/^\s*BEGIN;/m);
    expect(executable).toMatch(/^\s*COMMIT;/m);
    expect(executable).not.toMatch(/CONCURRENTLY/i);
  });

  test('the break-glass rollback exists but only as commentary, never as runnable SQL', () => {
    expect(sql).toMatch(/EMERGENCY BREAK-GLASS ROLLBACK/);
    // If this ever fails, someone uncommented the rollback and the migration
    // now re-opens the hole it was written to close.
    expect(executable).not.toMatch(/GRANT\s+ALL\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public\s+TO\s+anon/i);
  });

  test('ends with a verification query the operator can read as proof', () => {
    expect(executable).toMatch(/public_tables_still_exposed/);
    expect(executable).toMatch(/anon_can_read_password_hashes/);
    expect(executable).toMatch(/app_tables_intact/);
  });

  test('the function check counts only SECURITY DEFINER functions', () => {
    // Amended after the live apply. Counting every non-extension function
    // reported 10 — all ordinary SECURITY INVOKER helpers reachable through
    // Postgres's default EXECUTE-to-PUBLIC grant, which run with the CALLER's
    // privileges (anon now has none). Only a DEFINER runs as its owner, so
    // only a DEFINER is a hole. A read-back that cries wolf is worse than none.
    expect(executable).toMatch(/AND p\.prosecdef/);
    expect(executable).toMatch(/AS definers_still_exposed/);
  });

  test('the default-privilege check names the grantor rather than counting rows', () => {
    // `postgres` cannot ALTER another role's defaults, so supabase_admin's
    // survive by design. Naming the grantor distinguishes an entry we can fix
    // from one we cannot.
    expect(executable).toMatch(/AS unrevokable_default_grantors/);
    expect(executable).toMatch(/pg_get_userbyid\(da\.defaclrole\)/);
  });
});
