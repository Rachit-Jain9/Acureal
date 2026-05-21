#!/usr/bin/env node
'use strict';

// CI-safe lint for database/migrations/*.sql files.
//
// Catches mistakes that would otherwise only surface when the operator runs
// the migration:
//
//   FILE HYGIENE
//   - Filenames must follow YYYYMMDD_*.sql so chronological ordering matches
//     filesystem ordering and Supabase migration history.
//   - No two files may share the same YYYYMMDD prefix without distinct
//     descriptors — duplicate prefixes create ambiguous apply order.
//   - Files must not be empty.
//
//   RE-RUNNABILITY
//   - CREATE INDEX CONCURRENTLY is forbidden — Supabase SQL editor auto-wraps
//     every paste in a transaction (see PR #80 for the incident).
//   - CREATE TABLE must use IF NOT EXISTS so a migration is safe to re-paste.
//
//   TENANT ISOLATION  (the five-layer data model — enforced, not just documented)
//   - Any table created with an `organization_id` / `org_id` column MUST have
//     row-level security enabled on it somewhere in the migration corpus.
//     A tenant-scoped table without RLS is a cross-org data leak — the single
//     most damaging multi-tenant bug class. The check is corpus-wide (RLS may
//     be enabled in a later migration than the CREATE TABLE) and column-based
//     (a mere mention of org_id in an index or an INSERT does not trip it).
//   - A small, documented allowlist (RLS_EXEMPT) covers the reference /
//     market-intelligence tables that are deliberately isolated by
//     service-layer org-filtering instead of RLS.
//
// Exit code 0 = clean, exit code 1 = lint failures (with details printed).

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'database', 'migrations');
const FILENAME_RE = /^\d{8}_[a-z0-9_]+\.sql$/;

// ── Tenant-isolation allowlist ──────────────────────────────────────────────
// Org-scoped tables that deliberately rely on service-layer org-filtering
// rather than RLS. Each entry is a conscious, reviewed exception — adding a
// table here must be a deliberate decision, never a reflex to silence the
// lint. (A future hardening could give these defense-in-depth RLS; that is a
// careful production migration, tracked separately.)
const MARKET_INTEL_REASON =
  'Market-intelligence benchmark table — org-scoped but isolated by '
  + 'service-layer org-filtering, consistent with the pre-existing '
  + 'micro_market_benchmarks pattern.';
const RLS_EXEMPT = new Map([
  [
    'master_plan_documents',
    'regulatory_data reference schema — isolated by service-layer '
      + 'org-filtering, not RLS (see backend/src/services/evidenceLinks.service.js).',
  ],
  ['office_market_benchmarks', MARKET_INTEL_REASON],
  ['retail_market_benchmarks', MARKET_INTEL_REASON],
  ['industrial_market_benchmarks', MARKET_INTEL_REASON],
  ['hospitality_market_benchmarks', MARKET_INTEL_REASON],
  ['market_macro_kpis', MARKET_INTEL_REASON],
]);

// ── SQL pattern matchers ────────────────────────────────────────────────────

// A CREATE TABLE statement: name (optionally schema-qualified) + the
// parenthesised column body, up to the closing `);` on its own line.
const CREATE_TABLE_RE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w.]*)\s*\(([\s\S]*?)\n\s*\);/gi;
// CREATE TABLE with an optional IF NOT EXISTS — used for the idempotency check.
const CREATE_TABLE_ANY_RE =
  /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w.]*)/gi;
// An org-scoping column declared at the start of a line inside a table body.
const ORG_COLUMN_RE = /^\s*(?:organization_id|org_id)\b/im;
// `ALTER TABLE [IF EXISTS] <name> ENABLE ROW LEVEL SECURITY`.
const ENABLE_RLS_RE =
  /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][\w.]*)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;

// Normalise a (possibly schema-qualified) table name to a bare, lower-cased
// identifier so a CREATE in one file and an ALTER in another line up.
const bareName = (name) => String(name).split('.').pop().toLowerCase();

// Strip SQL comments so the pattern matchers never trip on prose — a header
// comment like "-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY ..."
// must not read as a real statement. Worst case this hides content, which
// only ever makes the lint under-flag — it can never invent a false positive.
function stripSqlComments(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/--[^\n]*/g, '');          // line comments
}

// Tables this file CREATEs that carry an org-scoping column.
function orgScopedTablesCreated(contents) {
  const code = stripSqlComments(contents);
  const out = [];
  let m;
  CREATE_TABLE_RE.lastIndex = 0;
  while ((m = CREATE_TABLE_RE.exec(code)) !== null) {
    const [, rawName, body] = m;
    if (ORG_COLUMN_RE.test(body)) out.push({ bare: bareName(rawName), raw: rawName });
  }
  return out;
}

// Tables this file ENABLEs row-level security on.
function rlsEnabledTables(contents) {
  const code = stripSqlComments(contents);
  const out = [];
  let m;
  ENABLE_RLS_RE.lastIndex = 0;
  while ((m = ENABLE_RLS_RE.exec(code)) !== null) out.push(bareName(m[1]));
  return out;
}

// CREATE TABLE statements in this file that omit IF NOT EXISTS.
function nonIdempotentCreateTables(contents) {
  const code = stripSqlComments(contents);
  const out = [];
  let m;
  CREATE_TABLE_ANY_RE.lastIndex = 0;
  while ((m = CREATE_TABLE_ANY_RE.exec(code)) !== null) {
    if (!m[1]) out.push(m[2]);
  }
  return out;
}

// ── Per-file lint ───────────────────────────────────────────────────────────

function lintFile(name, contents) {
  const issues = [];

  if (!FILENAME_RE.test(name)) {
    issues.push('filename does not match YYYYMMDD_<snake_case>.sql convention');
  }

  if (!contents.trim()) {
    issues.push('file is empty');
  }

  if (/CREATE\s+INDEX\s+CONCURRENTLY/i.test(stripSqlComments(contents))) {
    issues.push(
      'uses CREATE INDEX CONCURRENTLY — fails inside Supabase SQL editor\'s '
      + 'auto-transaction. Use plain CREATE INDEX wrapped in BEGIN/COMMIT instead.',
    );
  }

  for (const t of nonIdempotentCreateTables(contents)) {
    issues.push(
      `CREATE TABLE ${t} is not idempotent — use CREATE TABLE IF NOT EXISTS so `
      + 'the migration is safe to re-paste.',
    );
  }

  return issues;
}

// ── Corpus lint ─────────────────────────────────────────────────────────────

/**
 * Lint every migration. Pure — prints a report and returns a result object;
 * never calls process.exit, so it is safe to call from tests.
 *
 * @returns {{ failures:number, fileCount:number, orgTableCount:number }}
 */
function runLint() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('[lint-migrations] no database/migrations/ directory — nothing to lint.');
    return { failures: 0, fileCount: 0, orgTableCount: 0 };
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('[lint-migrations] no migration files found.');
    return { failures: 0, fileCount: 0, orgTableCount: 0 };
  }

  let failures = 0;
  const dateBuckets = new Map();
  const orgScopedTables = new Map(); // bare name -> { file, raw }
  const rlsTables = new Set();       // bare names with RLS enabled anywhere

  for (const name of files) {
    const contents = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
    const issues = lintFile(name, contents);

    const datePrefix = name.slice(0, 8);
    if (FILENAME_RE.test(name)) {
      const bucket = dateBuckets.get(datePrefix) || [];
      bucket.push(name);
      dateBuckets.set(datePrefix, bucket);
    }

    for (const t of orgScopedTablesCreated(contents)) {
      if (!orgScopedTables.has(t.bare)) orgScopedTables.set(t.bare, { file: name, raw: t.raw });
    }
    for (const t of rlsEnabledTables(contents)) rlsTables.add(t);

    if (issues.length > 0) {
      failures += issues.length;
      console.error(`✗ ${name}`);
      for (const issue of issues) console.error(`    - ${issue}`);
    }
  }

  for (const [prefix, names] of dateBuckets) {
    if (names.length > 1) {
      const distinctSuffixes = new Set(names.map((n) => n.slice(8)));
      if (distinctSuffixes.size !== names.length) {
        failures += 1;
        console.error(`✗ duplicate filenames at date ${prefix}: ${names.join(', ')}`);
      }
    }
  }

  // Tenant-isolation gate — every org-scoped table must have RLS, unless it is
  // a documented service-layer-isolated exception.
  const unprotected = [];
  let exemptCount = 0;
  for (const [bare, info] of orgScopedTables) {
    if (rlsTables.has(bare)) continue;
    if (RLS_EXEMPT.has(bare)) {
      exemptCount += 1;
      continue;
    }
    unprotected.push({ bare, ...info });
  }
  if (unprotected.length > 0) {
    failures += unprotected.length;
    console.error('\n✗ tenant-isolation: org-scoped tables created without row-level security');
    for (const t of unprotected) {
      console.error(
        `    - ${t.raw} (in ${t.file}) — declares an org column but no migration `
        + 'ENABLEs row-level security on it. Add ALTER TABLE ... ENABLE ROW LEVEL '
        + 'SECURITY, or — if it is deliberately service-layer isolated — add it to '
        + 'RLS_EXEMPT in scripts/lint-migrations.js with a reason.',
      );
    }
  }

  // Soft note: an allowlisted table that has since gained RLS should be
  // removed from RLS_EXEMPT so the allowlist does not rot.
  for (const bare of RLS_EXEMPT.keys()) {
    if (rlsTables.has(bare)) {
      console.log(
        `[lint-migrations] note: "${bare}" is in RLS_EXEMPT but now has RLS — `
        + 'remove it from the allowlist.',
      );
    }
  }

  if (failures === 0) {
    const protectedCount = orgScopedTables.size - exemptCount;
    console.log(
      `[lint-migrations] ${files.length} migration${files.length === 1 ? '' : 's'} clean · `
      + `${orgScopedTables.size} org-scoped table${orgScopedTables.size === 1 ? '' : 's'} `
      + `(${protectedCount} RLS-protected, ${exemptCount} documented service-layer exempt).`,
    );
    return { failures: 0, fileCount: files.length, orgTableCount: orgScopedTables.size };
  }

  console.error(
    `\n[lint-migrations] ${failures} issue${failures === 1 ? '' : 's'} across ${files.length} migrations.`,
  );
  return { failures, fileCount: files.length, orgTableCount: orgScopedTables.size };
}

module.exports = {
  lintFile,
  stripSqlComments,
  orgScopedTablesCreated,
  rlsEnabledTables,
  nonIdempotentCreateTables,
  runLint,
  RLS_EXEMPT,
};

// Run as a script — exit non-zero on any failure so CI fails.
if (require.main === module) {
  process.exit(runLint().failures === 0 ? 0 : 1);
}
