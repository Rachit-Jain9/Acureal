'use strict';

/**
 * A very small Postgres column-resolution simulator.
 *
 * Service unit tests mock `query`, so SQL that names a column the live
 * database does not have looks perfectly healthy to Jest. That blind spot is
 * how `users.organization_id` shipped three times — the org-scoped admin user
 * picker (broken 2026-06-16 until the 2026-08-01 error-log sweep), the deal
 * bulk-reassign target check, and the comps-queue bulk-reassign target check.
 * All three raised 42703 (undefined_column) on every call and returned a raw
 * HTTP 500. None had a test that could see it, because the mock answered
 * cheerfully no matter what the SQL said.
 *
 * `assertColumnsResolve` closes that gap: hand it the SQL a service is about
 * to run and it raises the same `code: '42703'` error Postgres would whenever
 * a column is resolved against a table that does not have it.
 *
 * Deliberately narrow. It knows the two tables involved in the org-membership
 * defect and inspects only statements that touch them; everything else passes
 * through untouched. This is a regression net for a specific, thrice-repeated
 * production bug, not a general SQL parser. If you add a column to `users` or
 * `organization_members`, add it here too.
 */

// public.users — the base definition in database/schema.sql plus every
// `ALTER TABLE users ADD COLUMN` across schema.sql and database/migrations/.
// Note what is absent: `organization_id`. Membership lives in
// organization_members; `users.default_organization_id` is a *preference*
// (which workspace to open on login), not a membership edge.
const TABLE_COLUMNS = {
  users: new Set([
    'id', 'email', 'password_hash', 'name', 'role', 'phone', 'is_active',
    'last_login_at', 'created_at', 'updated_at',
    'account_closed_at', 'ai_augment_last_used_at', 'ai_augment_reports_used',
    'city', 'company', 'default_organization_id', 'email_verified_at',
    'erased_at', 'is_platform_admin', 'job_title', 'mfa_enrolled_at',
    'mfa_recovery_codes', 'mfa_secret', 'oauth_provider', 'oauth_subject',
    'password_set', 'platform_admin_granted_at', 'platform_admin_granted_by',
    'privacy_accepted_at', 'terms_accepted_at',
  ]),
  organization_members: new Set([
    'id', 'organization_id', 'user_id', 'role', 'invited_by', 'is_active',
    'joined_at', 'created_at', 'updated_at',
  ]),
};

// Words that can follow a table name without being an alias.
const NOT_AN_ALIAS = new Set([
  'where', 'on', 'join', 'inner', 'left', 'right', 'full', 'outer', 'cross',
  'lateral', 'set', 'limit', 'order', 'group', 'having', 'returning', 'union',
  'and', 'or', 'as', 'using', 'select', 'from', 'values', 'natural',
]);

const undefinedColumn = (table, column) => {
  const err = new Error(`column "${column}" does not exist`);
  err.code = '42703';
  err.table = table;
  return err;
};

const QUALIFIED_REF = /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi;

/**
 * Map each table reference in the statement to the name it is addressed by —
 * its alias when it has one, otherwise the table name itself.
 */
const buildAliasMap = (sql) => {
  const aliases = new Map();
  const re = /\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)(?:\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?/gi;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const table = match[1].toLowerCase();
    const candidate = (match[2] || '').toLowerCase();
    const alias = candidate && !NOT_AN_ALIAS.has(candidate) ? candidate : table;
    aliases.set(alias, table);
  }
  return aliases;
};

/**
 * Throws a Postgres-shaped 42703 if `sql` resolves a column against a table
 * this guard knows and that table has no such column. No-ops for statements
 * that touch none of the known tables.
 */
const assertColumnsResolve = (sql) => {
  if (typeof sql !== 'string' || sql.length === 0) return;

  const aliases = buildAliasMap(sql);
  const tables = new Set(aliases.values());
  const known = [...tables].filter((table) => TABLE_COLUMNS[table]);
  if (known.length === 0) return;

  // 1. Qualified references — `u.organization_id`, `om.role`, ...
  QUALIFIED_REF.lastIndex = 0;
  let match;
  while ((match = QUALIFIED_REF.exec(sql)) !== null) {
    const table = aliases.get(match[1].toLowerCase());
    const columns = table && TABLE_COLUMNS[table];
    if (columns && !columns.has(match[2].toLowerCase())) {
      throw undefinedColumn(table, match[2]);
    }
  }

  // 2. Unqualified references in a single-table statement resolve to that
  //    table — the exact shape all three production bugs took:
  //      SELECT id FROM users WHERE id = $1 AND organization_id = ...
  //
  //    Rather than guess which bare tokens are columns (function names and
  //    keywords make that a false-positive factory), flag only tokens that
  //    ARE a real column of some *other* table in this guard's schema but not
  //    of this one. That is precisely the mistake being defended against:
  //    `organization_id` is a genuine column — of organization_members, never
  //    of users.
  if (tables.size !== 1) return;
  const table = known[0];
  const columns = TABLE_COLUMNS[table];
  const columnsElsewhere = new Set(
    Object.entries(TABLE_COLUMNS)
      .filter(([name]) => name !== table)
      .flatMap(([, cols]) => [...cols]),
  );

  const unqualified = sql.replace(QUALIFIED_REF, ' ');
  for (const token of unqualified.match(/\b[a-z_][a-z0-9_]*\b/gi) || []) {
    const name = token.toLowerCase();
    if (columns.has(name) || NOT_AN_ALIAS.has(name)) continue;
    if (columnsElsewhere.has(name)) throw undefinedColumn(table, name);
  }
};

module.exports = { assertColumnsResolve, TABLE_COLUMNS };
