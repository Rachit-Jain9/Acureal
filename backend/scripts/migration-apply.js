#!/usr/bin/env node
'use strict';

/**
 * migration-apply — the applier between migration-status.js (read-only
 * reconciler) and run-sql.js (single-file executor). Replaces the manual
 * paste-into-a-browser-editor step that has already been corrupted once by a
 * browser extension injecting text, and has already left one migration
 * unapplied for a month.
 *
 *   node backend/scripts/migration-apply.js                 # DRY RUN (default): print the plan, change nothing
 *   node backend/scripts/migration-apply.js --apply         # execute the plan
 *   node backend/scripts/migration-apply.js --only <file>   # restrict to one migration (required for seed/DML files)
 *   node backend/scripts/migration-apply.js --dir <path>    # alternate migrations dir (rehearsals, tests)
 *
 * Connection: MIGRATIONS_DATABASE_URL, falling back to DATABASE_URL (via
 * backend/.env). DDL needs an admin role — if the URL carries a restricted
 * role, the failed statement aborts that migration's transaction and the run
 * stops; nothing half-applies.
 *
 * THE CONTRACT (operator-decided, 2026-08-02 — do not weaken):
 *   • Operator-invoked, never auto-on-deploy. Automatic DDL on every deploy
 *     converts a bad migration into an automatic outage.
 *   • Dry-run by default; applying requires the explicit --apply flag.
 *   • Each migration runs in its own transaction; the run STOPS at the first
 *     failure and never continues past it.
 *   • Every applied migration is recorded in the same ledger
 *     migration-status.js reads (supabase_migrations.schema_migrations),
 *     version = apply-timestamp, name = slug — the ledger's own convention.
 *   • Already-applied migrations are skipped, so re-runs are safe.
 *
 * HOW A FILE IS CLASSIFIED (verdicts come from migration-status.js):
 *   RECORDED          → SKIP        already applied and in the ledger
 *   LIVE, UNRECORDED  → RECORD      objects exist live; write the ledger row only
 *   NOT APPLIED       → APPLY       genuinely pending DDL
 *   PARTIAL           → HALT        some objects exist, some don't — a human call.
 *                                   The apply run stops AT the file's position:
 *                                   everything before it lands, nothing after it
 *                                   is attempted until it is resolved.
 *   UNVERIFIABLE      → needs --only pure seed/DML files create nothing probeable,
 *                                   so "already applied?" cannot be answered from
 *                                   the database. A bulk run passes over them
 *                                   (with a notice); applying one is an explicit,
 *                                   named act.
 *
 * TRANSACTION SHAPES. Repo convention wraps operator-paste files in
 * BEGIN/COMMIT. Rather than performing textual surgery on someone else's SQL:
 *   • a bare file (no transaction control) is wrapped by the applier —
 *     migration + ledger row commit or roll back together;
 *   • a fully wrapped file (exactly BEGIN…COMMIT) runs as written, and the
 *     ledger row is written immediately after. If the process dies between the
 *     two, the next run classifies the file LIVE, UNRECORDED and heals the
 *     ledger — recorded-late is recoverable, half-applied is not;
 *   • anything else (multiple transactions, savepoints, CONCURRENTLY) is
 *     refused: run it deliberately via run-sql.js instead.
 *
 * PL/pgSQL bodies are full of the word BEGIN — the transaction scan strips
 * comments, string literals and dollar-quoted bodies before looking, so a
 * definer function never masquerades as transaction control.
 */

const fs = require('fs');
const path = require('path');

const { parseFileName, extractProbes, probeSql } = require('./migration-status');

const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'database', 'migrations');
const LEDGER = 'supabase_migrations.schema_migrations';

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/**
 * Remove everything that can hide or fake a transaction-control keyword:
 * comments, single-quoted literals, and dollar-quoted bodies. What remains is
 * safe to token-scan.
 */
const sanitizeForTxnScan = (sql) => String(sql)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  // Dollar-quoted bodies ($$…$$, $tag$…$tag$) — non-greedy to the MATCHING tag.
  .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' <body> ')
  // Single-quoted literals, tolerant of doubled quotes inside.
  .replace(/'(?:[^']|'')*'/g, " '' ");

/**
 * Classify the file's transaction shape from the sanitized text.
 *   'bare'    — no transaction control; the applier owns the transaction
 *   'wrapped' — exactly one BEGIN first and one COMMIT last; runs as written
 *   'complex' — anything else; refused (run via run-sql.js deliberately)
 */
const classifyTransactionShape = (sql) => {
  const sanitized = sanitizeForTxnScan(sql);
  const tokens = [...sanitized.matchAll(/\b(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT|PREPARE\s+TRANSACTION)\b/gi)]
    .map((m) => m[1].toUpperCase().replace(/\s+/g, ' '));
  if (tokens.length === 0) return 'bare';
  const isWrapped = tokens.length === 2
    && (tokens[0] === 'BEGIN' || tokens[0] === 'START TRANSACTION')
    && tokens[1] === 'COMMIT';
  return isWrapped ? 'wrapped' : 'complex';
};

/** CREATE INDEX CONCURRENTLY cannot run inside any transaction — refuse it. */
const hasConcurrently = (sql) => /\bCONCURRENTLY\b/i.test(sanitizeForTxnScan(sql));

/** Map a verdict to a plan action. `only` marks an explicitly named target. */
const planAction = (verdict, { only = false } = {}) => {
  switch (verdict) {
    case 'RECORDED': return 'SKIP';
    case 'LIVE, UNRECORDED': return 'RECORD';
    case 'NOT APPLIED': return 'APPLY';
    case 'PARTIAL': return 'HALT';
    case 'UNVERIFIABLE': return only ? 'APPLY' : 'NEEDS --only';
    default: return 'HALT';
  }
};

/**
 * Ledger version for a row written now: apply-timestamp (UTC, YYYYMMDDHHMMSS),
 * bumped by a second while it collides with an existing version — the column
 * is the ledger's primary key.
 */
const applyVersionFor = (date, usedVersions) => {
  let t = date.getTime();
  const fmt = (ms) => {
    const d = new Date(ms);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  };
  let version = fmt(t);
  while (usedVersions.has(version)) {
    t += 1000;
    version = fmt(t);
  }
  usedVersions.add(version);
  return version;
};

// ── Main ────────────────────────────────────────────────────────────────────

const parseArgs = (argv) => {
  const args = { apply: false, only: null, dir: DEFAULT_MIGRATIONS_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--only') args.only = argv[i += 1] || null;
    else if (argv[i] === '--dir') args.dir = path.resolve(argv[i += 1] || '.');
    else {
      console.error(`Unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  return args;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  require('./../src/config/loadEnv');
  const { normalizeDatabaseUrl } = require('../src/config/databaseUrl');
  const { resolveSslConfig } = require('../src/config/databaseSsl');
  const { Client } = require('pg');

  const rawUrl = process.env.MIGRATIONS_DATABASE_URL || process.env.DATABASE_URL;
  if (!rawUrl) {
    console.error('Set MIGRATIONS_DATABASE_URL or DATABASE_URL (backend/.env) and re-run.');
    process.exit(2);
  }
  const databaseUrl = normalizeDatabaseUrl(rawUrl);

  const files = fs.readdirSync(args.dir)
    .map(parseFileName)
    .filter(Boolean)
    .filter((f) => !args.only || f.fileName === args.only)
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
  if (args.only && files.length === 0) {
    console.error(`--only ${args.only}: no such migration in ${args.dir}`);
    process.exit(2);
  }

  const client = new Client({ connectionString: databaseUrl, ssl: resolveSslConfig(process.env) });
  await client.connect();

  try {
    // Who and where — the "wrong database" failure mode dies in daylight.
    const identity = (await client.query(
      'SELECT current_user, current_database(), inet_server_addr()::text AS addr',
    )).rows[0];
    const host = new URL(databaseUrl.replace(/^postgres(ql)?:/, 'http:')).hostname;
    console.log(`\nTarget   ${host} · db=${identity.current_database} · role=${identity.current_user}`);
    console.log(`Ledger   ${LEDGER}`);
    console.log(`Source   ${args.dir} (${files.length} migration file${files.length === 1 ? '' : 's'})`);
    console.log(`Mode     ${args.apply ? 'APPLY' : 'DRY RUN (pass --apply to execute)'}\n`);

    // A migration must never outwait a lock silently, and never run unbounded.
    await client.query("SET lock_timeout = '30s'");
    await client.query("SET statement_timeout = '600s'");

    const ledgerExists = (await client.query(
      "SELECT to_regclass($1) IS NOT NULL AS ok", [LEDGER],
    )).rows[0].ok;
    if (!ledgerExists) {
      console.error(`${LEDGER} does not exist on this database — this does not look like a Supabase project. Refusing to guess.`);
      process.exit(1);
    }

    const ledger = await client.query(`SELECT version, name FROM ${LEDGER}`);
    const ledgerSlugs = new Set(ledger.rows.map((r) => r.name));
    const usedVersions = new Set(ledger.rows.map((r) => r.version));

    // ── Build the plan (same classification as migration-status.js) ──────────
    const plan = [];
    for (const file of files) {
      const sql = fs.readFileSync(path.join(args.dir, file.fileName), 'utf8');
      let verdict;
      let evidence;
      if (ledgerSlugs.has(file.slug) || ledgerSlugs.has(file.fileName.replace(/\.sql$/, ''))) {
        verdict = 'RECORDED';
        evidence = 'slug in ledger';
      } else {
        const probes = extractProbes(sql);
        if (probes.length === 0) {
          verdict = 'UNVERIFIABLE';
          evidence = 'no probeable DDL (seed/DML file)';
        } else {
          const exprs = probes.map((p, i) => `${probeSql(p)} AS p${i}`).join(', ');
          // eslint-disable-next-line no-await-in-loop
          const probed = await client.query(`SELECT ${exprs}`);
          const hits = probes.filter((_, i) => probed.rows[0][`p${i}`] === true);
          verdict = hits.length === probes.length
            ? 'LIVE, UNRECORDED'
            : (hits.length === 0 ? 'NOT APPLIED' : 'PARTIAL');
          evidence = `${hits.length}/${probes.length} objects present`;
        }
      }
      const action = planAction(verdict, { only: !!args.only });
      const shape = classifyTransactionShape(sql);
      const refusal = action === 'APPLY'
        ? (hasConcurrently(sql)
          ? 'contains CONCURRENTLY — cannot run in a transaction; use run-sql.js deliberately'
          : (shape === 'complex' ? 'multiple transactions / savepoints — use run-sql.js deliberately' : null))
        : null;
      plan.push({ ...file, sql, verdict, evidence, action: refusal ? 'HALT' : action, shape, refusal });
    }

    const pad = (s, n) => String(s).padEnd(n);
    console.log(`${pad('MIGRATION', 56)} ${pad('VERDICT', 18)} ${pad('PLAN', 13)} EVIDENCE`);
    console.log('-'.repeat(118));
    for (const p of plan) {
      console.log(`${pad(p.fileName, 56)} ${pad(p.verdict, 18)} ${pad(p.action, 13)} ${p.refusal || p.evidence}`);
    }
    const counts = plan.reduce((acc, p) => ({ ...acc, [p.action]: (acc[p.action] || 0) + 1 }), {});
    console.log(`\n${JSON.stringify(counts)}`);

    if (!args.apply) {
      const pending = plan.filter((p) => p.action === 'APPLY' || p.action === 'RECORD');
      const named = plan.filter((p) => p.action === 'NEEDS --only');
      const halts = plan.filter((p) => p.action === 'HALT');
      if (named.length) {
        console.log('\nSeed/DML files are applied one at a time, by name:');
        for (const n of named) console.log(`  node backend/scripts/migration-apply.js --apply --only ${n.fileName}`);
      }
      if (halts.length) {
        console.log(`\n${halts.length} migration(s) need a human decision — an apply run will stop when it reaches the first one:`);
        for (const h of halts) console.log(`  ${h.fileName} — ${h.refusal || h.evidence}`);
      }
      console.log(pending.length
        ? `\nDry run only. ${pending.length} migration(s) would change this database — re-run with --apply.`
        : '\nNothing to apply — the database and the ledger agree.');
      return;
    }

    // ── Execute in order, stopping at the first failure or human decision ────
    // Seed/DML files (NEEDS --only) are passed over with a notice, not applied:
    // "already applied?" is unanswerable for them, and years-old seeds would
    // otherwise dead-stop every run forever. A PARTIAL file stops the run AT
    // ITS POSITION — everything before it (in date order) lands, nothing after
    // it is attempted until a human resolves it.
    console.log('');
    let applied = 0;
    let recorded = 0;
    const passedOver = [];
    for (const p of plan) {
      if (p.action === 'SKIP') continue;
      if (p.action === 'NEEDS --only') {
        passedOver.push(p);
        continue;
      }
      if (p.action === 'HALT') {
        console.error(`\n⏸ STOPPED at ${p.fileName} — ${p.refusal || p.evidence}.`);
        console.error('  This needs a human decision (some of its objects exist, some do not, or its');
        console.error('  transaction shape cannot be run safely). Resolve it deliberately — e.g.');
        console.error(`  node backend/scripts/run-sql.js ${path.join(path.relative(process.cwd(), args.dir), p.fileName)}`);
        console.error('  — then re-run this applier; a resolved file re-classifies as LIVE, UNRECORDED');
        console.error('  and its ledger row is written. Nothing after this file was attempted.');
        console.error(`  Progress before stopping: ${applied} applied · ${recorded} recorded.`);
        process.exit(1);
      }

      const version = applyVersionFor(new Date(), usedVersions);
      const started = Date.now();
      try {
        if (p.action === 'RECORD') {
          await client.query(
            `INSERT INTO ${LEDGER} (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
            [version, p.slug],
          );
          recorded += 1;
          console.log(`± recorded ${p.fileName} (live but unrecorded) · ledger ${version}`);
          continue;
        }

        if (p.shape === 'bare') {
          await client.query('BEGIN');
          await client.query(p.sql);
          await client.query(
            `INSERT INTO ${LEDGER} (version, name) VALUES ($1, $2)`,
            [version, p.slug],
          );
          await client.query('COMMIT');
        } else {
          // Wrapped file: runs its own BEGIN…COMMIT; any error inside aborts
          // that transaction, the COMMIT degrades to ROLLBACK, and the throw
          // below stops the run. The ledger row lands right after — a crash
          // between the two self-heals as LIVE, UNRECORDED on the next run.
          await client.query(p.sql);
          await client.query(
            `INSERT INTO ${LEDGER} (version, name) VALUES ($1, $2)`,
            [version, p.slug],
          );
        }
        applied += 1;
        console.log(`✓ applied ${p.fileName} (${Date.now() - started}ms) · ledger ${version}`);
      } catch (err) {
        if (p.shape === 'bare') {
          await client.query('ROLLBACK').catch(() => {});
        }
        console.error(`\n✗ FAILED ${p.fileName} after ${Date.now() - started}ms — run stopped, nothing after it was attempted.`);
        console.error(`  ${err.message}`);
        console.error('  The failed migration was rolled back and NOT recorded in the ledger.');
        process.exit(1);
      }
    }
    console.log(`\nDone. ${applied} applied · ${recorded} recorded · ${plan.filter((p) => p.action === 'SKIP').length} skipped.`);
    if (passedOver.length) {
      console.log(`\n${passedOver.length} seed/DML file(s) were passed over (unverifiable from the database) — apply each deliberately if pending:`);
      for (const n of passedOver) console.log(`  node backend/scripts/migration-apply.js --apply --only ${n.fileName}`);
    }
  } finally {
    await client.end().catch(() => {});
  }
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  sanitizeForTxnScan,
  classifyTransactionShape,
  hasConcurrently,
  planAction,
  applyVersionFor,
};
