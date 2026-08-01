'use strict';

/**
 * Static pins for database/migrations/20260804_rls_flip_repair.sql — the
 * repair for everything the 2026-07-28 redip_app flip broke (found in the
 * 2026-08-01 production error sweep).
 *
 * The defect being repaired: three May-era migrations wrote RLS policies
 * against current_setting('redip.organization_id') — a settings namespace
 * NOTHING in the application has ever written (the canonical context is
 * app.current_organization_id via current_organization_id()). Under the old
 * BYPASSRLS role the mismatch was invisible; under redip_app those tables
 * denied every read and write. These tests pin the repair's shape so a
 * future edit can't quietly reintroduce the phantom namespace or drop the
 * definer hardening.
 */

const fs = require('fs');
const path = require('path');

const MIGRATION = path.resolve(
  __dirname, '..', '..', 'database', 'migrations', '20260804_rls_flip_repair.sql',
);
const sql = fs.readFileSync(MIGRATION, 'utf8');

// Comments discuss the phantom namespace by name; strip them so assertions
// see only executable SQL.
const executable = sql
  .replace(/^--.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('the phantom GUC namespace is gone from executable SQL', () => {
  test('no created policy references redip.organization_id', () => {
    expect(executable).not.toMatch(/redip\.organization_id/);
  });

  test('every broken policy from 20260508/20260525/20260526 is dropped', () => {
    for (const name of [
      'residential_segmented_benchmarks_select_org',
      'residential_segmented_benchmarks_modify_org',
      'niche_asset_class_benchmarks_select_org',
      'niche_asset_class_benchmarks_modify_org',
      'ab_eval_runs_select_org',
      'ab_eval_runs_modify_org',
      'ab_eval_results_select_org',
      'ab_eval_results_modify_org',
    ]) {
      expect(executable).toMatch(new RegExp(`DROP POLICY IF EXISTS "?${name}"?`));
    }
  });

  test('benchmarks get the reference-data pattern: open SELECT, org-scoped writes', () => {
    // Mirrors market_transactions / micro_market_benchmarks (20260411):
    // shared platform reference rows must be readable from every org context.
    expect(executable).toMatch(/residential_segmented_benchmarks_select_all"[\s\S]{0,200}?FOR SELECT USING \(true\)/);
    expect(executable).toMatch(/niche_asset_class_benchmarks_select_all"[\s\S]{0,200}?FOR SELECT USING \(true\)/);
    expect(executable).toMatch(/residential_segmented_benchmarks_modify_org"[\s\S]{0,300}?current_organization_id\(\)/);
    expect(executable).toMatch(/niche_asset_class_benchmarks_modify_org"[\s\S]{0,300}?current_organization_id\(\)/);
  });

  test('ab_eval tables are org-scoped on both verbs via the canonical helper', () => {
    for (const table of ['ab_eval_runs', 'ab_eval_results']) {
      expect(executable).toMatch(new RegExp(`${table}_select_org"[\\s\\S]{0,300}?current_organization_id\\(\\)`));
      expect(executable).toMatch(new RegExp(`${table}_modify_org"[\\s\\S]{0,400}?WITH CHECK \\(organization_id = current_organization_id\\(\\)\\)`));
    }
  });
});

describe('improvement_signals finally has a write policy', () => {
  test('INSERT policy checks the canonical org context', () => {
    expect(executable).toMatch(/improvement_signals_org_write[\s\S]{0,300}?FOR INSERT[\s\S]{0,200}?WITH CHECK \(organization_id = current_organization_id\(\)\)/);
  });
});

describe('the signups definers follow the 20260802 hardening pattern', () => {
  const fnBlock = (name) => {
    const start = executable.indexOf(`FUNCTION public.${name}`);
    expect(start).toBeGreaterThan(-1);
    return executable.slice(start, start + 2200);
  };

  test.each(['admin_list_signups', 'admin_signup_summary'])(
    '%s is SECURITY DEFINER with a pinned search_path ending in pg_temp',
    (name) => {
      const block = fnBlock(name);
      expect(block).toMatch(/SECURITY DEFINER/);
      expect(block).toMatch(/SET search_path = pg_catalog, public, pg_temp/);
    },
  );

  test.each(['admin_list_signups', 'admin_signup_summary'])(
    '%s is gated INSIDE the body on the persisted is_platform_admin flag',
    (name) => {
      expect(fnBlock(name)).toMatch(/is_platform_admin/);
      expect(fnBlock(name)).toMatch(/current_user_id\(\)/);
    },
  );

  test('EXECUTE is revoked from PUBLIC on both definers', () => {
    expect(executable).toMatch(/REVOKE ALL ON FUNCTION public\.admin_list_signups\(text, integer\) FROM PUBLIC/);
    expect(executable).toMatch(/REVOKE ALL ON FUNCTION public\.admin_signup_summary\(\) FROM PUBLIC/);
  });

  test('the redip_app grant is guarded so the file applies before OR after the role exists', () => {
    expect(executable).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'redip_app'\)/);
  });
});

describe('the operator flag backfill', () => {
  test('covers both operator accounts, idempotently', () => {
    expect(executable).toMatch(/rachitjain348@gmail\.com/);
    expect(executable).toMatch(/rachitj579@gmail\.com/);
    expect(executable).toMatch(/is_platform_admin IS DISTINCT FROM TRUE/);
  });
});

describe('transactional hygiene', () => {
  test('the migration is wrapped in BEGIN/COMMIT', () => {
    expect(executable).toMatch(/\bBEGIN\b/);
    expect(executable).toMatch(/\bCOMMIT\b/);
  });
});
