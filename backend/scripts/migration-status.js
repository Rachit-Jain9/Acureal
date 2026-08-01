#!/usr/bin/env node
'use strict';

/**
 * migration-status — reconcile the repo's migration files against the
 * database's applied-migration ledger, and generate the backfill SQL that
 * makes the ledger honest again.
 *
 *   node backend/scripts/migration-status.js            # report
 *   node backend/scripts/migration-status.js --sql      # + backfill INSERTs
 *
 * Why this exists (2026-08-01): the Supabase ledger's newest row was
 * ~20260717 while migrations through 20260803 were demonstrably live —
 * nobody could tell from the repo OR the dashboard what had actually
 * shipped. Worse, the ledger keys rows by APPLY-timestamp while files are
 * named by AUTHOR-date, so the two sides cannot be joined on version at
 * all; only the slug matches. This tool is that join, plus evidence.
 *
 * For every repo migration missing from the ledger it goes one step
 * further than "unrecorded": it parses the file for the objects it creates
 * (tables / indexes / functions / added columns) and PROBES the live
 * database for them, schema-qualified — a lesson paid for during the
 * audit, where an unqualified to_regclass() false-negatived a table that
 * simply lived outside `public`. Verdicts:
 *
 *   RECORDED         slug present in the ledger
 *   LIVE, UNRECORDED probes found its objects — applied, ledger missed it
 *   NOT APPLIED      probes found nothing — genuinely pending
 *   UNVERIFIABLE     file creates nothing probeable (pure seeds/DML)
 *
 * READ-ONLY by design. It prints backfill INSERTs for the operator to
 * paste; it never writes the ledger itself — production DDL/DML stays a
 * human act (CLAUDE.md).
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'database', 'migrations');

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/** 20260726_deal_registers.sql → { version: '20260726', slug: 'deal_registers' } */
const parseFileName = (fileName) => {
  const m = /^(\d{8})_(.+)\.sql$/.exec(fileName);
  if (!m) return null;
  return { version: m[1], slug: m[2], fileName };
};

/**
 * SQL comments must go before probe extraction. The first live run proved
 * why: a header comment reading "-- Idempotent: CREATE TABLE IF NOT EXISTS,
 * DROP POLICY..." parses as DDL, the comma after EXISTS makes the regex
 * backtrack out of the optional IF-NOT-EXISTS group, and the keyword `IF`
 * becomes a phantom object whose probe can never pass — dragging a fully
 * applied migration into PARTIAL.
 */
const stripSqlComments = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ');

/** Backtracking artifacts: a capture that is itself a keyword is never a real object name. */
const KEYWORD_CAPTURE = /^(?:if|not|exists|only|concurrently)$/i;

/**
 * Extract probeable objects from migration SQL. Deliberately conservative:
 * only unambiguous DDL shapes; anything else contributes nothing (and a
 * file with zero probes reports UNVERIFIABLE rather than guessing).
 */
const extractProbes = (rawSql) => {
  const sql = stripSqlComments(rawSql);
  const probes = [];
  const seen = new Set();
  const push = (probe) => {
    if (KEYWORD_CAPTURE.test(probe.name) || (probe.column && KEYWORD_CAPTURE.test(probe.column))) return;
    const key = `${probe.kind}:${probe.schema}.${probe.name}${probe.column ? `.${probe.column}` : ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      probes.push(probe);
    }
  };
  const qualify = (raw) => {
    const clean = raw.replace(/"/g, '');
    const [a, b] = clean.split('.');
    return b ? { schema: a, name: b } : { schema: 'public', name: a };
  };

  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_"][\w."]*)/gi;
  // An index CANNOT be schema-qualified at creation — Postgres places it in
  // its table's schema. So the schema comes from the ON clause, never from a
  // default. (The first live run false-negatived all 20 regulatory_data
  // indexes by assuming public.)
  const indexRe = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_"][\w"]*)\s+ON\s+(?:ONLY\s+)?([A-Za-z_"][\w."]*)/gi;
  const funcRe = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z_"][\w."]*)/gi;
  const addColRe = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([A-Za-z_"][\w."]*)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_"][\w"]*)/gi;

  let m;
  while ((m = tableRe.exec(sql))) push({ kind: 'table', ...qualify(m[1]) });
  while ((m = indexRe.exec(sql))) {
    push({ kind: 'index', schema: qualify(m[2]).schema, name: m[1].replace(/"/g, '') });
  }
  while ((m = funcRe.exec(sql))) push({ kind: 'function', ...qualify(m[1]) });
  while ((m = addColRe.exec(sql))) {
    const target = qualify(m[1]);
    push({ kind: 'column', ...target, column: m[2].replace(/"/g, '') });
  }
  return probes;
};

/** One EXISTS() SQL expression per probe — schema-qualified, no public assumption. */
const probeSql = (probe) => {
  const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
  switch (probe.kind) {
    case 'table':
      return `EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${lit(probe.schema)} AND c.relname = ${lit(probe.name)} AND c.relkind IN ('r','p'))`;
    case 'index':
      return `EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${lit(probe.schema)} AND c.relname = ${lit(probe.name)} AND c.relkind = 'i')`;
    case 'function':
      return `EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ${lit(probe.schema)} AND p.proname = ${lit(probe.name)})`;
    case 'column':
      return `EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ${lit(probe.schema)} AND table_name = ${lit(probe.name)} AND column_name = ${lit(probe.column)})`;
    default:
      return 'FALSE';
  }
};

/** Applied-timestamp version for a backfill row: file date + midnight suffix. */
const backfillVersion = (fileVersion) => `${fileVersion}000000`;

const buildBackfillSql = (rows) => {
  if (rows.length === 0) return null;
  // version is the ledger's primary key, but two migrations can share an
  // author-date (the first live run had two 20260602 files). A colliding
  // second row would be SILENTLY dropped by ON CONFLICT DO NOTHING — so
  // same-day rows get incrementing second-suffixes instead.
  const used = new Set();
  const uniqueVersion = (fileVersion) => {
    let n = 0;
    let v = backfillVersion(fileVersion);
    while (used.has(v)) {
      n += 1;
      v = `${fileVersion}${String(n).padStart(6, '0')}`;
    }
    used.add(v);
    return v;
  };
  const values = rows
    .map((r) => `  ('${uniqueVersion(r.version)}', '${r.slug}')`)
    .join(',\n');
  return [
    '-- migration-status backfill: ledger rows for migrations verified LIVE',
    '-- in production but never recorded. Generated read-only; review, then',
    '-- paste into the Supabase SQL editor. Idempotent (ON CONFLICT DO NOTHING).',
    'INSERT INTO supabase_migrations.schema_migrations (version, name)',
    'VALUES',
    `${values}`,
    'ON CONFLICT (version) DO NOTHING;',
  ].join('\n');
};

// ── Main (requires DATABASE_URL; everything above is testable without it) ──

const main = async () => {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .map(parseFileName)
    .filter(Boolean)
    .sort((a, b) => a.fileName.localeCompare(b.fileName));

  const backendNodeModules = path.resolve(__dirname, '..', 'node_modules');
  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(path.join(backendNodeModules, 'dotenv')).config({ path: path.resolve(__dirname, '..', '.env') });
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Set it (or backend/.env) and re-run.');
    process.exit(2);
  }
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const { Client } = require(path.join(backendNodeModules, 'pg'));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const ledger = await client.query(
      'SELECT version, name FROM supabase_migrations.schema_migrations',
    );
    const ledgerSlugs = new Set(ledger.rows.map((r) => r.name));

    const report = [];
    for (const file of files) {
      if (ledgerSlugs.has(file.slug) || ledgerSlugs.has(file.fileName.replace(/\.sql$/, ''))) {
        report.push({ ...file, verdict: 'RECORDED', evidence: 'slug in ledger' });
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file.fileName), 'utf8');
      const probes = extractProbes(sql);
      if (probes.length === 0) {
        report.push({ ...file, verdict: 'UNVERIFIABLE', evidence: 'no probeable DDL (seed/DML file)' });
        continue;
      }
      const exprs = probes.map((p, i) => `${probeSql(p)} AS p${i}`).join(', ');
      // eslint-disable-next-line no-await-in-loop
      const probed = await client.query(`SELECT ${exprs}`);
      const hits = probes.filter((_, i) => probed.rows[0][`p${i}`] === true);
      const verdict = hits.length === probes.length
        ? 'LIVE, UNRECORDED'
        : (hits.length === 0 ? 'NOT APPLIED' : 'PARTIAL');
      report.push({
        ...file,
        verdict,
        evidence: `${hits.length}/${probes.length} objects present (${probes.slice(0, 3).map((p) => `${p.kind}:${p.name}${p.column ? `.${p.column}` : ''}`).join(', ')}${probes.length > 3 ? ', …' : ''})`,
      });
    }

    const pad = (s, n) => String(s).padEnd(n);
    console.log(`\n${pad('MIGRATION', 56)} ${pad('VERDICT', 18)} EVIDENCE`);
    console.log('-'.repeat(110));
    for (const row of report) {
      console.log(`${pad(row.fileName, 56)} ${pad(row.verdict, 18)} ${row.evidence}`);
    }
    const counts = report.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] || 0) + 1 }), {});
    console.log(`\n${JSON.stringify(counts)}`);

    if (process.argv.includes('--sql')) {
      const backfill = buildBackfillSql(report.filter((r) => r.verdict === 'LIVE, UNRECORDED'));
      console.log(backfill ? `\n${backfill}` : '\n-- nothing to backfill: ledger already covers every live migration.');
      const partial = report.filter((r) => r.verdict === 'PARTIAL');
      if (partial.length) {
        console.log('\n-- PARTIAL verdicts above need a human decision — some of the file\'s');
        console.log('-- objects exist and some do not. Do NOT backfill those blindly.');
      }
    }
  } finally {
    await client.end();
  }
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { parseFileName, extractProbes, probeSql, backfillVersion, buildBackfillSql };
