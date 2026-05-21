'use strict';

/**
 * Tests for scripts/lint-migrations.js — Workstream F (foundations).
 *
 * Covers the per-file hygiene rules, SQL-comment stripping (the regression
 * that comment prose must not read as a statement), the corpus-wide
 * tenant-isolation detection, and a standing assertion that the LIVE
 * migration corpus passes the full lint with zero failures.
 */

const {
  lintFile,
  stripSqlComments,
  orgScopedTablesCreated,
  rlsEnabledTables,
  nonIdempotentCreateTables,
  runLint,
  RLS_EXEMPT,
} = require('../../scripts/lint-migrations');

describe('lint-migrations — file hygiene', () => {
  it('flags a filename off the YYYYMMDD_snake.sql convention', () => {
    expect(lintFile('bad-name.sql', 'SELECT 1;')).toEqual(
      expect.arrayContaining([expect.stringMatching(/filename/i)]),
    );
    expect(lintFile('20260601_ok_name.sql', 'SELECT 1;')).toEqual([]);
  });

  it('flags an empty file', () => {
    expect(lintFile('20260601_empty.sql', '   ')).toEqual(
      expect.arrayContaining([expect.stringMatching(/empty/i)]),
    );
  });

  it('flags CREATE INDEX CONCURRENTLY', () => {
    expect(lintFile('20260601_x.sql', 'CREATE INDEX CONCURRENTLY foo_idx ON foo (bar);')).toEqual(
      expect.arrayContaining([expect.stringMatching(/CONCURRENTLY/)]),
    );
  });

  it('flags a non-idempotent CREATE TABLE but accepts IF NOT EXISTS', () => {
    expect(lintFile('20260601_x.sql', 'CREATE TABLE foo (id int);')).toEqual(
      expect.arrayContaining([expect.stringMatching(/idempotent/i)]),
    );
    expect(lintFile('20260601_x.sql', 'CREATE TABLE IF NOT EXISTS foo (id int);')).toEqual([]);
  });
});

describe('lint-migrations — comment stripping', () => {
  it('removes line and block comments', () => {
    expect(stripSqlComments('SELECT 1; -- a comment')).not.toMatch(/comment/);
    expect(stripSqlComments('SELECT /* block */ 1;')).not.toMatch(/block/);
  });

  it('does not let comment prose trip the matchers (regression)', () => {
    // A header comment mentioning the pattern must not read as a real statement.
    const sql =
      '-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS.\n'
      + 'CREATE TABLE IF NOT EXISTS public.real_table (id int);';
    expect(nonIdempotentCreateTables(sql)).toEqual([]);
  });
});

describe('lint-migrations — tenant-isolation detection', () => {
  const ORG_TABLE = `CREATE TABLE IF NOT EXISTS public.deal_widget (
    id BIGSERIAL PRIMARY KEY,
    deal_id UUID NOT NULL,
    organization_id UUID NOT NULL DEFAULT current_organization_id(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`;

  it('detects a CREATE TABLE that declares an org column', () => {
    const found = orgScopedTablesCreated(ORG_TABLE);
    expect(found).toHaveLength(1);
    expect(found[0].bare).toBe('deal_widget');
  });

  it('does not flag a table with no org column', () => {
    expect(
      orgScopedTablesCreated('CREATE TABLE IF NOT EXISTS public.global_ref (id int, label text);'),
    ).toEqual([]);
  });

  it('does not mistake an org_id mention in an index for a table column', () => {
    // A CREATE INDEX on organization_id is not a CREATE TABLE — must not flag.
    expect(
      orgScopedTablesCreated('CREATE INDEX foo_org_idx ON foo (organization_id);'),
    ).toEqual([]);
  });

  it('detects ENABLE ROW LEVEL SECURITY targets', () => {
    expect(rlsEnabledTables('ALTER TABLE public.deal_widget ENABLE ROW LEVEL SECURITY;')).toEqual([
      'deal_widget',
    ]);
  });
});

describe('lint-migrations — the live migration corpus', () => {
  it('passes the full lint with zero failures', () => {
    expect(runLint().failures).toBe(0);
  });

  it('keeps the RLS exemption allowlist a small, deliberate set', () => {
    // Guard against the allowlist bloating instead of tables getting real RLS.
    expect(RLS_EXEMPT.size).toBeGreaterThan(0);
    expect(RLS_EXEMPT.size).toBeLessThanOrEqual(8);
  });
});
