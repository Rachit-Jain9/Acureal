'use strict';

/**
 * migration-status — the pure planning layer (2026-08-01).
 *
 * The live-DB half of the script is operator-run; what CI can and should pin
 * is the planning layer: filename parsing (the version/slug split the whole
 * reconciliation hinges on), DDL probe extraction, the schema-QUALIFIED probe
 * SQL (an unqualified to_regclass false-negatived a real table during the
 * audit — that mistake is why these probes carry explicit schemas), and the
 * idempotent backfill emitter.
 */

const {
  parseFileName,
  extractProbes,
  probeSql,
  backfillVersion,
  buildBackfillSql,
} = require('../scripts/migration-status');

describe('parseFileName', () => {
  test('splits date-prefixed migrations into version + slug', () => {
    expect(parseFileName('20260726_deal_registers.sql')).toEqual({
      version: '20260726',
      slug: 'deal_registers',
      fileName: '20260726_deal_registers.sql',
    });
  });

  test('rejects non-migration files rather than inventing versions', () => {
    expect(parseFileName('README.md')).toBeNull();
    expect(parseFileName('rollback_helper.sql')).toBeNull();
  });
});

describe('extractProbes', () => {
  test('finds schema-qualified and unqualified tables, indexes, functions, added columns', () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS public.deal_user_visits (id BIGINT);
      CREATE TABLE regulatory_data.planning_authorities (id BIGINT);
      CREATE UNIQUE INDEX IF NOT EXISTS duv_user_deal_idx ON public.deal_user_visits (user_id);
      CREATE OR REPLACE FUNCTION public.current_user_id() RETURNS uuid AS $$ SELECT NULL $$ LANGUAGE sql;
      ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;
    `;
    const probes = extractProbes(sql);
    expect(probes).toContainEqual({ kind: 'table', schema: 'public', name: 'deal_user_visits' });
    expect(probes).toContainEqual({ kind: 'table', schema: 'regulatory_data', name: 'planning_authorities' });
    expect(probes).toContainEqual({ kind: 'index', schema: 'public', name: 'duv_user_deal_idx' });
    expect(probes).toContainEqual({ kind: 'function', schema: 'public', name: 'current_user_id' });
    expect(probes).toContainEqual({ kind: 'column', schema: 'public', name: 'users', column: 'is_platform_admin' });
  });

  test('a pure seed file yields zero probes — UNVERIFIABLE, never guessed', () => {
    const sql = `
      INSERT INTO regulatory_data.guidance_values (street, band) VALUES ('X', 1);
      UPDATE public.deals SET city = 'Bengaluru' WHERE city = 'Bangalore';
    `;
    expect(extractProbes(sql)).toEqual([]);
  });

  test('dedupes repeated objects (idempotent re-CREATE blocks)', () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS a (id INT);
      CREATE TABLE IF NOT EXISTS a (id INT);
    `;
    expect(extractProbes(sql)).toHaveLength(1);
  });
});

describe('probeSql', () => {
  test('table probes are schema-qualified — never bare to_regclass', () => {
    const sql = probeSql({ kind: 'table', schema: 'regulatory_data', name: 'planning_authorities' });
    expect(sql).toContain("n.nspname = 'regulatory_data'");
    expect(sql).toContain("c.relname = 'planning_authorities'");
    expect(sql).not.toContain('to_regclass');
  });

  test('column probes hit information_schema with all three coordinates', () => {
    const sql = probeSql({ kind: 'column', schema: 'public', name: 'users', column: 'company' });
    expect(sql).toContain("table_schema = 'public'");
    expect(sql).toContain("table_name = 'users'");
    expect(sql).toContain("column_name = 'company'");
  });

  test('single quotes in identifiers are escaped, not interpolated', () => {
    const sql = probeSql({ kind: 'table', schema: 'public', name: "odd'name" });
    expect(sql).toContain("'odd''name'");
  });
});

describe('backfill emission', () => {
  test('versions sort after every real apply-timestamp from the same day', () => {
    expect(backfillVersion('20260726')).toBe('20260726000000');
  });

  test('emits idempotent INSERT for LIVE-UNRECORDED rows only', () => {
    const sql = buildBackfillSql([
      { version: '20260726', slug: 'deal_registers' },
      { version: '20260803', slug: 'users_platform_admin_flag' },
    ]);
    expect(sql).toContain('INSERT INTO supabase_migrations.schema_migrations (version, name)');
    expect(sql).toContain("('20260726000000', 'deal_registers')");
    expect(sql).toContain("('20260803000000', 'users_platform_admin_flag')");
    expect(sql).toContain('ON CONFLICT (version) DO NOTHING');
  });

  test('nothing to backfill → null, so the caller prints the honest message', () => {
    expect(buildBackfillSql([])).toBeNull();
  });
});
